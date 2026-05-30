import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createReadStream, existsSync, watch } from "node:fs";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, "data");
const dataFile = path.join(dataDir, "sync-data.json");
const pdfDir = path.join(root, "pdf");
const trainingDir = path.join(root, "training-docs");
const port = Number(process.env.PORT || 8082);
const host = process.env.HOST || "0.0.0.0";
const cloudMode = process.env.CLOUD_MODE === "1";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".csv": "text/csv; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

async function buildLocalManifests() {
  await mkdir(pdfDir, { recursive: true });
  await mkdir(trainingDir, { recursive: true });
  await renderPdfs();
  await scanTrainingDocs();
}

async function renderPdfs() {
  const mod = await import("./scripts/render-pdfs.mjs");
  return mod.renderPdfs();
}

async function scanTrainingDocs() {
  const mod = await import("./scripts/scan-training-docs.mjs");
  return mod.scanTrainingDocs();
}

function scheduleBuild(label, task) {
  clearTimeout(scheduleBuild.timers[label]);
  scheduleBuild.timers[label] = setTimeout(async () => {
    try {
      await task();
    } catch (error) {
      console.error(`${label} failed:`, error);
    }
  }, 300);
}
scheduleBuild.timers = {};

function watchLocalDirectory(dir, label, task) {
  if (!existsSync(dir)) return;
  try {
    watch(dir, { recursive: true }, () => scheduleBuild(label, task));
  } catch (error) {
    console.warn(`Watch not available for ${dir}: ${error.message}`);
  }
}

async function readSyncData() {
  try {
    const raw = await readFile(dataFile, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { updatedAt: null, data: null };
    }
    throw error;
  }
}

async function writeSyncData(data) {
  await mkdir(dataDir, { recursive: true });
  const payload = {
    updatedAt: new Date().toISOString(),
    data
  };
  await writeFile(dataFile, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 25 * 1024 * 1024) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleUpload(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const folder = (url.searchParams.get("folder") || "").replace(/[/\\]/g, "").trim();
  const contentType = req.headers["content-type"] || "";
  const parts = contentType.split(";").map((s) => s.trim());
  const isMultipart = parts[0] === "multipart/form-data" || parts[0] === "multipart/form-data; boundary";

  if (!isMultipart) {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      try {
        const buffer = Buffer.concat(chunks);
        const dispHeader = contentType.includes("filename=") ? contentType : "";
        const filenameMatch = dispHeader.match(/filename[^;=\n]*=["']?([^"';\n]*)["']?/);
        let filename = filenameMatch ? filenameMatch[1] : "uploaded-file";
        if (!filename || filename === "blob") filename = `upload-${Date.now()}`;
        // Decode filename if it contains non-ASCII Latin-1 bytes
        if (/[\x80-\xFF]/.test(filename)) {
          filename = Buffer.from(filename, "latin1").toString("utf8");
        }
        const targetDir = folder ? path.join(trainingDir, folder) : trainingDir;
        await mkdir(targetDir, { recursive: true });
        const destPath = path.join(targetDir, filename);
        await writeFile(destPath, buffer);
        console.log(`Uploaded: ${destPath} (${buffer.length} bytes)`);
        scheduleBuild("scan training docs", scanTrainingDocs);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, path: `${folder ? folder + "/" : ""}${filename}` }));
      } catch (error) {
        console.error("Upload error:", error);
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: error.message }));
      }
    });
    return;
  }

  // multipart: extract boundary
  const boundaryMatch = parts.find((p) => p.startsWith("boundary="));
  if (!boundaryMatch) {
    res.writeHead(400);
    res.end(JSON.stringify({ ok: false, error: "No boundary in multipart" }));
    return;
  }
  const boundary = boundaryMatch.slice("boundary=".length).replace(/^"|"$/g, "");
  const rawChunks = [];
  req.on("data", (chunk) => rawChunks.push(chunk));
  req.on("end", async () => {
    try {
      const buffer = Buffer.concat(rawChunks);
      const str = buffer.toString("binary");
      const parts2 = str.split("--" + boundary);
      for (const part of parts2) {
        if (part.indexOf("Content-Disposition") < 0) continue;
        const headerEnd = part.indexOf("\r\n\r\n");
        if (headerEnd < 0) continue;
        const headers = part.slice(0, headerEnd);
        const filenameMatch = headers.match(/filename[^;=\n]*=["']?([^"';\n]*)["']?/);
        const nameMatch = headers.match(/name[^;=\n]*=["']?([^"';\n]*)["']?/);
        if (!filenameMatch && !nameMatch) continue;

        let raw = part.slice(headerEnd + 4);
        if (raw.endsWith("\r\n")) raw = raw.slice(0, -2);
        const fileBuffer = Buffer.from(raw, "binary");

        if (filenameMatch) {
          let filename = filenameMatch[1] || `upload-${Date.now()}`;
          // Check for RFC 5987 filename*=UTF-8''... format
          var rfc5987Match = headers.match(/filename\*\s*=\s*UTF-8''([^;]*)/i);
          if (rfc5987Match) {
            filename = decodeURIComponent(rfc5987Match[1]);
          } else if (/[\x80-\xFF]/.test(filename)) {
            // Non-ASCII in Latin-1 -> convert from bytes to UTF-8
            filename = Buffer.from(filename, "latin1").toString("utf8");
          }
          const targetDir = folder ? path.join(trainingDir, folder) : trainingDir;
          await mkdir(targetDir, { recursive: true });
          var destPath = path.join(targetDir, filename);
          // Avoid overwriting: append suffix if exists
          if (existsSync(destPath)) {
            var ext = path.extname(filename);
            var base = filename.slice(0, -ext.length);
            var counter = 1;
            while (existsSync(path.join(targetDir, base + " (" + counter + ")" + ext))) {
              counter++;
            }
            destPath = path.join(targetDir, base + " (" + counter + ")" + ext);
          }
          await writeFile(destPath, fileBuffer);
          console.log(`Uploaded: ${destPath} (${fileBuffer.length} bytes)`);
          scheduleBuild("scan training docs", scanTrainingDocs);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, path: path.relative(trainingDir, destPath).split(path.sep).join("/"), size: fileBuffer.length }));
          return;
        }
      }
      res.writeHead(400);
      res.end(JSON.stringify({ ok: false, error: "No file found in upload" }));
    } catch (error) {
      console.error("Upload error:", error);
      res.writeHead(500);
      res.end(JSON.stringify({ ok: false, error: error.message }));
    }
  });
}

async function handleFolder(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.end("Method Not Allowed");
    return;
  }
  const body = await readRequestBody(req);
  let name, parentPath;
  try {
    const parsed = JSON.parse(body || "{}");
    name = (parsed.name || "").trim();
    parentPath = (parsed.parentPath || "").replace(/[/\\]/g, "/").replace(/^\/+|\/+$/g, "");
  } catch (e) {
    res.writeHead(400);
    res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
    return;
  }
  if (!name) {
    res.writeHead(400);
    res.end(JSON.stringify({ ok: false, error: "Folder name is required" }));
    return;
  }
  var targetPath = parentPath
    ? path.join(trainingDir, parentPath, name)
    : path.join(trainingDir, name);
  // Security: ensure path is within trainingDir
  if (!targetPath.startsWith(trainingDir)) {
    res.writeHead(403);
    res.end(JSON.stringify({ ok: false, error: "Forbidden" }));
    return;
  }
  if (existsSync(targetPath)) {
    res.writeHead(409);
    res.end(JSON.stringify({ ok: false, error: "Folder already exists" }));
    return;
  }
  try {
    await mkdir(targetPath, { recursive: true });
    scheduleBuild("scan training docs", scanTrainingDocs);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, path: parentPath ? parentPath + "/" + name : name }));
  } catch (error) {
    console.error("Folder creation error:", error);
    res.writeHead(500);
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
}

async function handleDelete(req, res) {
  if (req.method !== "DELETE") {
    res.writeHead(405, { Allow: "DELETE" });
    res.end("Method Not Allowed");
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const relativePath = (url.searchParams.get("path") || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!relativePath) {
    res.writeHead(400);
    res.end(JSON.stringify({ ok: false, error: "Path is required" }));
    return;
  }
  const targetPath = path.join(trainingDir, relativePath);
  if (!targetPath.startsWith(trainingDir)) {
    res.writeHead(403);
    res.end(JSON.stringify({ ok: false, error: "Forbidden" }));
    return;
  }
  try {
    if (existsSync(targetPath)) {
      const { rm } = await import("node:fs/promises");
      await rm(targetPath, { recursive: true, force: true });
      scheduleBuild("scan training docs", scanTrainingDocs);
      console.log(`Deleted: ${targetPath}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ ok: false, error: "Not found" }));
    }
  } catch (error) {
    console.error("Delete error:", error);
    res.writeHead(500);
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
}

async function handleApi(req, res) {
  if (req.method === "GET") {
    sendJson(res, 200, await readSyncData());
    return;
  }

  if (req.method === "PUT") {
    if (cloudMode) {
      sendJson(res, 403, { error: "云端模式为只读，请通过 GitHub push 更新数据。本地修改仅保存在浏览器中。" });
      return;
    }
    const body = await readRequestBody(req);
    const parsed = body ? JSON.parse(body) : {};
    sendJson(res, 200, await writeSyncData(parsed.data || parsed));
    return;
  }

  res.writeHead(405, { Allow: "GET, PUT" });
  res.end("Method Not Allowed");
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const requestedPath = path.resolve(root, `.${pathname}`);

  if (!requestedPath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  let info;
  try {
    info = await stat(requestedPath);
  } catch (error) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  if (!info.isFile()) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  const ext = path.extname(requestedPath).toLowerCase();
  const mimeType = mimeTypes[ext] || "application/octet-stream";
  // Cache images and static assets, but not HTML/API
  const isStatic = /\.(png|jpe?g|gif|svg|ico|webp|css|js|mjs|woff2?|pdf)$/.test(ext);
  const cacheHeader = isStatic ? "public, max-age=86400" : "no-cache";
  const stream = createReadStream(requestedPath);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(500);
      res.end("Internal Server Error");
      return;
    }
    res.destroy();
  });
  res.writeHead(200, {
    "Content-Type": mimeType,
    "Cache-Control": cacheHeader
  });
  stream.pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    if (req.url?.startsWith("/api/delete")) {
      await handleDelete(req, res);
      return;
    }
    if (req.url?.startsWith("/api/upload")) {
      await handleUpload(req, res);
      return;
    }
    if (req.url?.startsWith("/api/folder")) {
      await handleFolder(req, res);
      return;
    }
    if (req.url?.startsWith("/api/data")) {
      await handleApi(req, res);
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Internal Server Error" });
  }
});

server.listen(port, host, () => {
  console.log(`行李智查 running at http://localhost:${port}`);
  console.log(`Mode: ${cloudMode ? "CLOUD (read-only)" : "LOCAL (read-write)"}`);
  console.log(`Floor PDFs: ${pdfDir}`);
  console.log(`Training docs: ${trainingDir}`);
});

if (process.env.BUILD_MANIFESTS === "1") {
  buildLocalManifests().catch((error) => {
    console.error("Initial local manifest build failed:", error);
  });
}
watchLocalDirectory(pdfDir, "render PDFs", renderPdfs);
watchLocalDirectory(trainingDir, "scan training docs", scanTrainingDocs);
