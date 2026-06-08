const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const root = path.dirname(__dirname);
const syncPath = path.join(root, 'data', 'sync-data.json');
const diPath = path.join(root, 'data', 'device-info.json');
const rzPath = path.join(root, 'data', 'responsibility-zones.json');

const syncData = JSON.parse(fs.readFileSync(syncPath, 'utf8'));
const di = JSON.parse(fs.readFileSync(diPath, 'utf8'));
const rz = JSON.parse(fs.readFileSync(rzPath, 'utf8'));
const annotations = syncData.data.points.annotations;

function uid() {
  return 'ann-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// Build normalized annotation lookup (strip leading zeros)
const annotByNormalized = new Map();
annotations.forEach(a => {
  const normalized = String(a.code || '').split('.').map(s => String(Number(s))).join('.');
  annotByNormalized.set(normalized, a);
});

// Neighbor fallback map for unmatched cabinets
const neighborMap = {
  '3456.16.1': '3456.15.1',
  '3455.14.1': '3455.13.1',
  '3455.12.1': '3455.11.1',
  '3454.14.1': '3454.13.1',
  '3372.24.1': '3372.23.1',
  '3371.26.2': '3371.25.1',
};

// Types to skip (no location in AC column)
const skipTypes = new Set(['行李系统配电柜', '安检配电箱']);

// Read Excel
const xlPath = 'c:/Users/Administrator/Desktop/工作簿1.xlsx';
const wb = XLSX.readFile(xlPath);
const ws = wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(ws, {header: 1});

const now = new Date().toISOString();
let created = 0, skipped = 0, noAnchor = 0;
const createdList = [];

for (let i = 1; i < data.length; i++) {
  const type = String(data[i][18] || '').trim();
  const code = String(data[i][21] || '').trim();
  const location = String(data[i][28] || '').trim();
  if (!code) continue;
  if (skipTypes.has(type)) { skipped++; continue; }

  // Parse cabinet code from AC column
  const cabinetMatch = location.match(/(\d+\.\d+\.\d+)/);
  const rawCabinet = cabinetMatch ? cabinetMatch[1] : '';
  const normalizedCabinet = rawCabinet.split('.').map(s => String(Number(s))).join('.');

  // Find parent cabinet annotation
  let parent = annotByNormalized.get(normalizedCabinet);

  // Try neighbor fallback
  if (!parent && neighborMap[rawCabinet]) {
    const neighborCode = neighborMap[rawCabinet];
    parent = annotations.find(a => a.code === neighborCode);
  }

  if (!parent) { noAnchor++; continue; }

  // Check if module annotation already exists
  if (annotations.some(a => a.code === code)) { skipped++; continue; }

  // Create module annotation at parent coordinates
  const note = type + ' | 位于' + parent.code + '内';
  const prefix4 = code.match(/\d{4}/) ? code.match(/\d{4}/)[0] : '';
  const resp = rz.items[prefix4] || {};

  const moduleAnnot = {
    id: uid(),
    drawingId: parent.drawingId,
    type: 'point',
    groupId: parent.groupId,
    code: code,
    note: note,
    points: JSON.parse(JSON.stringify(parent.points)),
    createdAt: now,
    updatedAt: now,
    special: true,
  };
  annotations.push(moduleAnnot);
  created++;

  // device-info
  if (!di.items[code]) {
    di.items[code] = {
      code: code, sheet: '模块清单', row: i + 1,
      fields: [
        { label: '责任分队', value: resp.team || '' },
        { label: '责任区域', value: resp.location || '' },
        { label: '规格/型号', value: type },
        { label: '所在电柜', value: parent.code },
      ],
      note: '责任分队: ' + (resp.team || '') + '；责任区域: ' + (resp.location || '') + '；规格/型号: ' + type + '；所在电柜: ' + parent.code,
    };
  }
}

// Save
di.count = Object.keys(di.items).length;
di.generatedAt = new Date().toISOString();
syncData.updatedAt = new Date().toISOString();
fs.writeFileSync(syncPath, JSON.stringify(syncData, null, 2));
fs.writeFileSync(diPath, JSON.stringify(di, null, 2));

// Verify
const v = JSON.parse(fs.readFileSync(syncPath, 'utf8'));
const va = v.data.points.annotations;
const specials = va.filter(a => a.special);

console.log('=== RESULTS ===');
console.log('Created: ' + created);
console.log('Skipped: ' + skipped);
console.log('No anchor found: ' + noAnchor);
console.log('Total annotations: ' + va.length);
console.log('Total special: ' + specials.length);
console.log('Device-info total: ' + JSON.parse(fs.readFileSync(diPath, 'utf8')).count);

// Samples by type
const byType = new Map();
specials.filter(a => a.createdAt === now).forEach(a => {
  const type = (a.note || '').split(' | ')[0];
  byType.set(type, (byType.get(type) || 0) + 1);
});
console.log('\nNew modules by type:');
for (const [t, c] of byType) console.log('  ' + t + ': ' + c);

// Show some samples
console.log('\nSamples:');
specials.filter(a => a.createdAt === now).slice(0, 5).forEach(a => {
  console.log('  ' + a.code + ' | ' + a.drawingId + ' | ' + a.note);
});
