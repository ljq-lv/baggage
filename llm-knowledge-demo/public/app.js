const els = {
  docList: document.getElementById("docList"),
  refreshBtn: document.getElementById("refreshBtn"),
  docTitle: document.getElementById("docTitle"),
  docMeta: document.getElementById("docMeta"),
  docContent: document.getElementById("docContent"),
  askForm: document.getElementById("askForm"),
  questionInput: document.getElementById("questionInput"),
  answer: document.getElementById("answer"),
  sources: document.getElementById("sources"),
  status: document.getElementById("status"),
  ollamaToggle: document.getElementById("ollamaToggle")
};

let docs = [];
let activeDocId = null;

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle("error", isError);
}

function renderDocs() {
  els.docList.innerHTML = "";
  if (docs.length === 0) {
    els.docList.textContent = "服务器资料目录为空。";
    return;
  }

  for (const doc of docs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `doc-item${doc.id === activeDocId ? " active" : ""}`;
    button.innerHTML = `
      <strong>${doc.title}</strong>
      <span>${formatSize(doc.size)} · ${new Date(doc.updatedAt).toLocaleString()}</span>
    `;
    button.addEventListener("click", () => loadDoc(doc.filename));
    els.docList.appendChild(button);
  }
}

async function loadDocs() {
  setStatus("正在加载目录");
  const response = await fetch("/api/docs", { cache: "no-store" });
  if (!response.ok) throw new Error("资料目录加载失败");
  const data = await response.json();
  docs = data.docs || [];
  renderDocs();
  setStatus(`已加载 ${docs.length} 份资料`);
}

async function loadDoc(filename) {
  activeDocId = encodeURIComponent(filename);
  renderDocs();
  els.docTitle.textContent = "正在加载资料";
  els.docContent.textContent = "";

  const response = await fetch(`/api/docs/${encodeURIComponent(filename)}`, { cache: "no-store" });
  if (!response.ok) throw new Error("资料正文加载失败");
  const doc = await response.json();
  els.docTitle.textContent = doc.title;
  els.docMeta.textContent = `${formatSize(doc.size)} · ${new Date(doc.updatedAt).toLocaleString()}`;
  els.docContent.textContent = doc.content;
}

function renderSources(sources) {
  els.sources.innerHTML = "";
  if (!sources || sources.length === 0) return;
  for (const source of sources) {
    const item = document.createElement("div");
    item.className = "source";
    item.innerHTML = `<strong>${source.title} · 第 ${source.chunk} 段</strong><br>${source.preview}`;
    els.sources.appendChild(item);
  }
}

async function ask(question) {
  setStatus("正在检索资料");
  els.answer.textContent = "正在生成答案...";
  els.sources.innerHTML = "";

  const response = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      useOllama: els.ollamaToggle.checked
    })
  });
  if (!response.ok) throw new Error("问答接口请求失败");
  const data = await response.json();

  els.answer.textContent = data.answer;
  renderSources(data.sources);

  if (data.mode === "ollama") {
    setStatus(`已由 Ollama ${data.model} 回答`);
  } else if (data.llmError) {
    setStatus(`Ollama 未连接，已返回检索演示答案`, true);
  } else {
    setStatus("已返回检索演示答案");
  }
}

els.refreshBtn.addEventListener("click", async () => {
  try {
    await fetch("/api/reindex", { method: "POST" });
    await loadDocs();
  } catch (error) {
    setStatus(error.message, true);
  }
});

els.askForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = els.questionInput.value.trim();
  if (!question) return;
  try {
    await ask(question);
  } catch (error) {
    els.answer.textContent = error.message;
    setStatus("请求失败", true);
  }
});

loadDocs().catch((error) => setStatus(error.message, true));
