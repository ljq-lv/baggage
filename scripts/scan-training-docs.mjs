import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const trainingDir = path.join(root, "training-docs");
const manifestPath = path.join(root, "assets", "training-docs-manifest.json");

const supportedExts = new Set([".docx", ".pdf", ".xlsx", ".xls", ".csv", ".pptx"]);
const mimeTypes = {
  ".csv": "text/csv",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

function toUrlPath(filePath) {
  return filePath.split(path.sep).map(encodeURIComponent).join("/");
}

async function walk(dir, base = "") {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    return [];
  }

  const docs = [];
  const folders = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true }))) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = base ? path.join(base, entry.name) : entry.name;
    if (entry.isDirectory()) {
      folders.push({
        name: entry.name,
        path: relativePath.split(path.sep).join("/"),
        type: "folder"
      });
      const sub = await walk(fullPath, relativePath);
      docs.push(...sub.docs);
      folders.push(...sub.folders);
      continue;
    }
    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (!supportedExts.has(ext)) continue;

    const info = await stat(fullPath);
    const normalizedPath = relativePath.split(path.sep).join("/");
    docs.push({
      name: entry.name,
      path: normalizedPath,
      url: `training-docs/${toUrlPath(relativePath)}`,
      type: mimeTypes[ext] || "",
      size: info.size,
      mtimeMs: Math.round(info.mtimeMs)
    });
  }
  return { docs, folders };
}

export async function scanTrainingDocs() {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await mkdir(trainingDir, { recursive: true });
  const result = await walk(trainingDir);
  const manifest = {
    generatedAt: new Date().toISOString(),
    root: "training-docs",
    docs: result.docs,
    folders: result.folders
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`Training docs manifest: ${docs.length} files`);
  return manifest;
}

if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  scanTrainingDocs().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
