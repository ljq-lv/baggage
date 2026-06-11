import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import XLSX from "xlsx";

const root = path.resolve(import.meta.dirname, "..");
const sourcePath = process.argv[2];
const syncPath = path.join(root, "data", "sync-data.json");
const backupPath = path.join(root, "outputs", "sync-data.before-reference-update-20260611.json");

if (!sourcePath) {
  throw new Error("Usage: node scripts/apply-reference-point-updates.mjs <source.xls>");
}

function normalizeCode(value) {
  return String(value ?? "")
    .trim()
    .split(".")
    .map((segment) => (/^\d+$/.test(segment) ? String(Number(segment)) : segment.toUpperCase()))
    .join(".");
}

function uniquePoints(annotations) {
  const points = [];
  const seen = new Set();

  for (const annotation of annotations) {
    for (const point of annotation.points || []) {
      const key = `${point.x}|${point.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push({ x: point.x, y: point.y });
    }
  }

  return points;
}

const syncData = JSON.parse(fs.readFileSync(syncPath, "utf8"));
const annotations = syncData.data.points.annotations;
const snapshot = structuredClone(annotations);
const snapshotByCode = new Map();

for (const annotation of snapshot) {
  const code = normalizeCode(annotation.code);
  if (!snapshotByCode.has(code)) snapshotByCode.set(code, []);
  snapshotByCode.get(code).push(annotation);
}

const workbook = XLSX.readFile(sourcePath, { cellDates: true });
const rowsByCode = new Map();

for (const sheetName of workbook.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: null,
    raw: false,
  });

  for (let index = 0; index < rows.length; index += 1) {
    const rawCode = String(rows[index]?.[3] ?? "").trim();
    if (!/\.[A-Za-z][A-Za-z0-9-]*$/.test(rawCode)) continue;

    const code = rawCode.replace(/\.[A-Za-z][A-Za-z0-9-]*$/, "");
    const normalizedCode = normalizeCode(code);
    if (!snapshotByCode.has(normalizedCode)) continue;

    const reference = String(rows[index]?.[6] ?? "").trim();
    const item = {
      sheetName,
      row: index + 1,
      code,
      normalizedCode,
      reference,
      normalizedReference: normalizeCode(reference),
    };

    if (!rowsByCode.has(normalizedCode)) rowsByCode.set(normalizedCode, []);
    rowsByCode.get(normalizedCode).push(item);
  }
}

fs.mkdirSync(path.dirname(backupPath), { recursive: true });
if (!fs.existsSync(backupPath)) fs.copyFileSync(syncPath, backupPath);

const updatedAt = new Date().toISOString();
const updatedCodes = [];
const legacyCodes = [];
const unchangedCodes = [];

for (const [normalizedCode, rows] of rowsByCode) {
  const references = [...new Set(rows.map((row) => row.normalizedReference).filter(Boolean))];
  const missingReferences = references.filter((reference) => !snapshotByCode.has(reference));

  if (missingReferences.length > 0) {
    legacyCodes.push({
      code: rows[0].code,
      rows: rows.map((row) => `${row.sheetName}!${row.row}`),
      missingReferences: rows
        .filter((row) => missingReferences.includes(row.normalizedReference))
        .map((row) => row.reference),
    });
    continue;
  }

  const targets = references.flatMap((reference) => snapshotByCode.get(reference));
  const drawings = [...new Set(targets.map((target) => target.drawingId))];
  if (drawings.length !== 1) {
    legacyCodes.push({
      code: rows[0].code,
      rows: rows.map((row) => `${row.sheetName}!${row.row}`),
      missingReferences: [`参考点跨图纸: ${drawings.join(", ")}`],
    });
    continue;
  }

  const points = uniquePoints(targets);
  const target = targets[0];
  const sources = annotations.filter((annotation) => normalizeCode(annotation.code) === normalizedCode);
  let changed = false;

  for (const source of sources) {
    const nextPoints = structuredClone(points);
    if (
      source.drawingId !== target.drawingId ||
      source.groupId !== target.groupId ||
      JSON.stringify(source.points || []) !== JSON.stringify(nextPoints)
    ) {
      source.drawingId = target.drawingId;
      source.groupId = target.groupId;
      source.points = nextPoints;
      source.updatedAt = updatedAt;
      changed = true;
    }
  }

  const summary = {
    code: rows[0].code,
    references: rows.map((row) => row.reference),
    pointCount: points.length,
    annotationCount: sources.length,
  };

  if (changed) updatedCodes.push(summary);
  else unchangedCodes.push(summary);
}

syncData.updatedAt = updatedAt;
fs.writeFileSync(syncPath, `${JSON.stringify(syncData, null, 2)}\n`);

console.log(JSON.stringify({
  sourceRowsMatched: [...rowsByCode.values()].reduce((total, rows) => total + rows.length, 0),
  existingCodes: rowsByCode.size,
  updatedCodes: updatedCodes.length,
  unchangedCodes: unchangedCodes.length,
  legacyCodes: legacyCodes.length,
  updated: updatedCodes,
  legacy: legacyCodes,
}, null, 2));
