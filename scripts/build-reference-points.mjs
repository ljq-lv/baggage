import fs from "node:fs/promises";
import path from "node:path";
import XLSX from "xlsx";

const sourcePath = process.argv[2];
const outputPath = process.argv[3] || "data/reference-points.json";

if (!sourcePath) {
  throw new Error("Usage: node scripts/build-reference-points.mjs <source.xls> [output.json]");
}

function cleanCode(value) {
  return String(value ?? "").trim();
}

function normalizeCode(value) {
  return cleanCode(value)
    .split(".")
    .map((segment) => (/^\d+$/.test(segment) ? String(Number(segment)) : segment.toUpperCase()))
    .join(".");
}

const workbook = XLSX.readFile(sourcePath, { cellDates: true });
const items = {};
let sourceRows = 0;

for (const sheetName of workbook.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: null,
    raw: false,
  });

  for (let index = 0; index < rows.length; index += 1) {
    const rawCode = cleanCode(rows[index]?.[3]);
    if (!/\.[A-Za-z][A-Za-z0-9-]*$/.test(rawCode)) continue;

    const cabinetCode = rawCode.replace(/\.[A-Za-z][A-Za-z0-9-]*$/, "");
    const referenceCode = cleanCode(rows[index]?.[6]);
    if (!cabinetCode || !referenceCode) continue;

    const key = normalizeCode(cabinetCode);
    if (!items[key]) {
      items[key] = {
        cabinetCode,
        references: [],
      };
    }

    if (!items[key].references.some((item) => normalizeCode(item) === normalizeCode(referenceCode))) {
      items[key].references.push(referenceCode);
    }
    sourceRows += 1;
  }
}

const payload = {
  version: 1,
  source: path.basename(sourcePath),
  generatedAt: new Date().toISOString(),
  count: Object.keys(items).length,
  sourceRows,
  items,
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Wrote ${payload.count} cabinet reference mappings from ${sourceRows} rows.`);
