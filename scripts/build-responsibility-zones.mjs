import fs from "node:fs/promises";
import path from "node:path";
import XLSX from "xlsx";

const sourcePath = process.argv[2] || "data/responsibility-zones-source.xlsx";
const outputPath = process.argv[3] || "data/responsibility-zones.json";

const teamColors = {
  "一分队": { className: "team-1", color: "#0f766e", bg: "#e8f5f3" },
  "二分队": { className: "team-2", color: "#2563eb", bg: "#eff6ff" },
  "三分队": { className: "team-3", color: "#d97706", bg: "#fff7ed" },
  "四分队": { className: "team-4", color: "#7c3aed", bg: "#f5f3ff" }
};

function clean(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function firstFourDigits(value) {
  const match = clean(value).match(/\d{4}/);
  return match ? match[0] : "";
}

const workbook = XLSX.readFile(sourcePath, { cellDates: true });
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const rows = XLSX.utils.sheet_to_json(sheet, {
  header: 1,
  defval: "",
  blankrows: false,
  raw: false,
  range: 0
});

const headerRowIndex = rows.findIndex((row) => {
  const labels = row.map(clean);
  return labels.includes("责任分队") && labels.includes("设备PLC区域");
});

if (headerRowIndex < 0) {
  throw new Error("Cannot find responsibility header row.");
}

const header = rows[headerRowIndex].map(clean);
const teamIndex = header.indexOf("责任分队");
const prefixIndex = header.indexOf("设备PLC区域");
const descriptionIndex = header.indexOf("区域位置描述");
const items = {};
const duplicates = [];

for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex++) {
  const row = rows[rowIndex] || [];
  const prefix = firstFourDigits(row[prefixIndex]);
  const team = clean(row[teamIndex]);
  if (!prefix || !team) continue;
  const location = clean(row[descriptionIndex]);
  if (items[prefix]) {
    duplicates.push(prefix);
    continue;
  }
  const color = teamColors[team] || { className: "team-unknown", color: "#64748b", bg: "#f8fafc" };
  items[prefix] = {
    prefix,
    team,
    location,
    className: color.className,
    color: color.color,
    bg: color.bg,
    sourceRow: rowIndex + 1
  };
}

const manualCorrections = {
  "3222": {
    prefix: "3222",
    team: "二分队",
    location: "国内",
    inferred: true,
    note: "责任分区表缺少 3222；按 3220-3223 相邻分区补齐。"
  }
};

for (const item of Object.values(manualCorrections)) {
  if (items[item.prefix]) continue;
  const color = teamColors[item.team] || { className: "team-unknown", color: "#64748b", bg: "#f8fafc" };
  items[item.prefix] = {
    ...item,
    className: color.className,
    color: color.color,
    bg: color.bg
  };
}

const payload = {
  version: 1,
  source: path.basename(sourcePath),
  sheet: sheetName,
  generatedAt: new Date().toISOString(),
  count: Object.keys(items).length,
  teams: teamColors,
  manualCorrections,
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
