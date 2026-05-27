import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourcePath = path.join(root, "data", "sync-data.json");
const fallbackPath = path.join(root, "data-backup.json");
const outDir = path.join(root, "data");
const drawingsDir = path.join(outDir, "drawings");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

let raw;
try {
  raw = await readJson(sourcePath);
} catch {
  raw = await readJson(fallbackPath);
}

const points = raw.data?.points || raw.points || raw;
const annotations = Array.isArray(points.annotations) ? points.annotations : [];
const groups = Array.isArray(points.groups) ? points.groups : [];
const drawings = Array.isArray(points.drawings) ? points.drawings : [];
const collapsedGroups = points.collapsedGroups && typeof points.collapsedGroups === "object"
  ? points.collapsedGroups
  : {};

await mkdir(drawingsDir, { recursive: true });

const byDrawing = new Map();
for (const annotation of annotations) {
  if (!annotation || !annotation.drawingId) continue;
  if (!byDrawing.has(annotation.drawingId)) byDrawing.set(annotation.drawingId, []);
  byDrawing.get(annotation.drawingId).push(annotation);
}

const counts = {};
for (const [drawingId, items] of byDrawing) {
  counts[drawingId] = items.length;
  await writeFile(
    path.join(drawingsDir, `${drawingId}.json`),
    JSON.stringify({ version: 1, drawingId, annotations: items }),
    "utf8"
  );
}

const searchIndex = annotations.map((annotation) => ({
  id: annotation.id,
  drawingId: annotation.drawingId,
  code: annotation.code || "",
  note: annotation.note || ""
}));

await writeFile(
  path.join(outDir, "search-index.json"),
  JSON.stringify({ version: 1, items: searchIndex }),
  "utf8"
);

await writeFile(
  path.join(outDir, "points-manifest.json"),
  JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
    currentDrawingId: points.currentDrawingId || "",
    drawings,
    groups,
    collapsedGroups,
    counts,
    totalAnnotations: annotations.length,
    searchIndex: "data/search-index.json",
    drawingPattern: "data/drawings/{id}.json"
  }),
  "utf8"
);

console.log(`Wrote ${annotations.length} annotations across ${Object.keys(counts).length} drawings.`);
