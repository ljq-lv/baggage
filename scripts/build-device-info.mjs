import fs from "node:fs/promises";
import path from "node:path";
import XLSX from "xlsx";

const sourcePath = process.argv[2] || "data/device-list-source.xlsx";
const outputPath = process.argv[3] || "data/device-info.json";
const workbook = XLSX.readFile(sourcePath, { cellDates: true });
const sheetName = workbook.SheetNames.find((name) => name.trim() === "清单") || workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });

function cleanLabel(value, fallback) {
  const text = String(value || "").replace(/\s+/g, "").trim();
  return text || fallback;
}

function cleanValue(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

const header = rows[0] || [];
const labels = header.map((value, index) => {
  if (index === 0) return "点位编号";
  return cleanLabel(value, "字段" + (index + 1));
});

const items = {};
const duplicates = [];

for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
  const row = rows[rowIndex] || [];
  const code = cleanValue(row[0]);
  if (!code) continue;

  const fields = [];
  for (let colIndex = 1; colIndex < labels.length; colIndex++) {
    const value = cleanValue(row[colIndex]);
    if (!value) continue;
    fields.push({
      label: labels[colIndex],
      value
    });
  }

  const item = {
    code,
    sheet: sheetName,
    row: rowIndex + 1,
    fields,
    note: fields.map((field) => field.label + ": " + field.value).join("；")
  };

  if (items[code]) duplicates.push(code);
  items[code] = item;
}

const payload = {
  version: 1,
  source: path.basename(sourcePath),
  sheet: sheetName,
  generatedAt: new Date().toISOString(),
  count: Object.keys(items).length,
  duplicates: Array.from(new Set(duplicates)),
  items
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(payload), "utf8");
console.log(JSON.stringify({
  outputPath,
  sheetName,
  count: payload.count,
  duplicates: payload.duplicates.length
}, null, 2));
