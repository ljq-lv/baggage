import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "public");
const docsDir = path.join(root, "training-docs");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8095);
const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const ollamaModel = process.env.OLLAMA_MODEL || "qwen3:8b";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

let cachedIndex = null;
let cachedSignature = "";

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store"
  });
  res.end(text);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function listDocFiles() {
  const entries = await readdir(docsDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (![".txt", ".md"].includes(ext)) continue;
    const fullPath = path.join(docsDir, entry.name);
    const info = await stat(fullPath);
    files.push({
      id: encodeURIComponent(entry.name),
      filename: entry.name,
      title: path.basename(entry.name, ext),
      size: info.size,
      updatedAt: info.mtime.toISOString()
    });
  }
  return files.sort((a, b) => a.title.localeCompare(b.title, "zh-Hans-CN"));
}

async function readDoc(filename) {
  const safeName = path.basename(filename);
  const fullPath = path.join(docsDir, safeName);
  if (!fullPath.startsWith(docsDir)) {
    throw Object.assign(new Error("Invalid path"), { status: 400 });
  }
  return readFile(fullPath, "utf8");
}

function splitIntoChunks(text, doc) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const paragraphs = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chunks = [];
  let buffer = "";
  for (const paragraph of paragraphs) {
    if ((buffer + "\n\n" + paragraph).length > 700 && buffer) {
      chunks.push(buffer);
      buffer = paragraph;
    } else {
      buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks.map((content, index) => ({
    id: `${doc.id}#${index + 1}`,
    docId: doc.id,
    title: doc.title,
    filename: doc.filename,
    chunk: index + 1,
    content
  }));
}

function makeSignature(docs) {
  return docs.map((doc) => `${doc.filename}:${doc.size}:${doc.updatedAt}`).join("|");
}

async function buildIndex() {
  const docs = await listDocFiles();
  const signature = makeSignature(docs);
  if (cachedIndex && cachedSignature === signature) return cachedIndex;

  const chunks = [];
  for (const doc of docs) {
    const content = await readDoc(doc.filename);
    chunks.push(...splitIntoChunks(content, doc));
  }

  cachedSignature = signature;
  cachedIndex = { docs, chunks, builtAt: new Date().toISOString() };
  return cachedIndex;
}

function tokenize(text) {
  return Array.from(new Set(
    text
      .toLowerCase()
      .replace(/[^\p{Script=Han}a-z0-9]+/gu, " ")
      .split(/\s+/)
      .flatMap((part) => {
        if (!part) return [];
        if (/^\p{Script=Han}+$/u.test(part)) {
          const terms = [];
          for (let i = 0; i < part.length; i += 1) terms.push(part[i]);
          for (let i = 0; i < part.length - 1; i += 1) terms.push(part.slice(i, i + 2));
          return terms;
        }
        return [part];
      })
      .filter((item) => item.length > 0)
  ));
}

function searchChunks(question, chunks, limit = 5) {
  const terms = tokenize(question);
  if (terms.length === 0) return chunks.slice(0, limit);

  return chunks
    .map((chunk) => {
      const haystack = `${chunk.title}\n${chunk.content}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (haystack.includes(term)) score += term.length > 1 ? 3 : 1;
      }
      return { ...chunk, score };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function fallbackAnswer(question, chunks) {
  if (chunks.length === 0) {
    return "资料库里没有检索到足够相关的内容。可以换一个更具体的问题，或先补充培训资料。";
  }
  const lines = chunks.map((chunk, index) => {
    const summary = chunk.content.replace(/\s+/g, " ").slice(0, 180);
    return `${index + 1}. ${summary}${chunk.content.length > 180 ? "..." : ""}`;
  });
  return [
    `未连接本地大模型时，这是基于资料检索生成的演示答案。问题是：“${question}”。`,
    "",
    "检索到的相关资料片段：",
    ...lines,
    "",
    "安装并启动 Ollama 后，后端会把这些片段交给本地大模型生成更自然的回答。"
  ].join("\n");
}

async function askOllama(question, chunks) {
  const context = chunks.map((chunk, index) => {
    return `资料${index + 1}《${chunk.title}》第${chunk.chunk}段：\n${chunk.content}`;
  }).join("\n\n");

  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ollamaModel,
      stream: false,
      messages: [
        {
          role: "system",
          content: "你是培训资料知识库助手。只能根据提供的资料回答；资料不足时明确说明没有找到依据。回答要简洁、可执行。"
        },
        {
          role: "user",
          content: `以下是检索到的培训资料：\n\n${context}\n\n用户问题：${question}`
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status}`);
  }
  const data = await response.json();
  return data.message?.content || "";
}

async function handleAsk(req, res) {
  const raw = await readRequestBody(req);
  const body = raw ? JSON.parse(raw) : {};
  const question = String(body.question || "").trim();
  const useOllama = body.useOllama === true;

  if (!question) {
    sendJson(res, 400, { error: "Question is required." });
    return;
  }

  const index = await buildIndex();
  const chunks = searchChunks(question, index.chunks, 5);
  let mode = "search-only";
  let answer = fallbackAnswer(question, chunks);
  let llmError = null;

  if (useOllama) {
    try {
      const generated = await askOllama(question, chunks);
      if (generated) {
        mode = "ollama";
        answer = generated;
      }
    } catch (error) {
      llmError = error.message;
    }
  }

  sendJson(res, 200, {
    answer,
    mode,
    model: mode === "ollama" ? ollamaModel : null,
    llmError,
    sources: chunks.map((chunk) => ({
      docId: chunk.docId,
      title: chunk.title,
      chunk: chunk.chunk,
      preview: chunk.content.replace(/\s+/g, " ").slice(0, 160)
    }))
  });
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/docs") {
    const index = await buildIndex();
    sendJson(res, 200, { docs: index.docs, builtAt: index.builtAt });
    return true;
  }

  if (url.pathname.startsWith("/api/docs/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/docs/".length));
    const index = await buildIndex();
    const doc = index.docs.find((item) => item.filename === id);
    if (!doc) {
      sendJson(res, 404, { error: "Document not found." });
      return true;
    }
    const content = await readDoc(doc.filename);
    sendJson(res, 200, { ...doc, content });
    return true;
  }

  if (url.pathname === "/api/reindex" && req.method === "POST") {
    cachedIndex = null;
    const index = await buildIndex();
    sendJson(res, 200, { ok: true, docs: index.docs.length, chunks: index.chunks.length });
    return true;
  }

  if (url.pathname === "/api/ask" && req.method === "POST") {
    await handleAsk(req, res);
    return true;
  }

  return false;
}

async function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const fullPath = path.normalize(path.join(publicDir, decodeURIComponent(pathname)));
  if (!fullPath.startsWith(publicDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  try {
    const buffer = await readFile(fullPath);
    const type = mimeTypes[path.extname(fullPath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(buffer);
  } catch (error) {
    sendText(res, 404, "Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);
      if (!handled) sendJson(res, 404, { error: "API route not found." });
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || "Internal server error." });
  }
});

server.listen(port, host, () => {
  console.log(`Knowledge demo running at http://${host}:${port}/`);
  console.log(`Docs directory: ${docsDir}`);
  console.log(`Optional Ollama endpoint: ${ollamaUrl}, model: ${ollamaModel}`);
});
