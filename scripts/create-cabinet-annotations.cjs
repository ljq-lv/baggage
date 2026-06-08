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

// Clear all old cabinet notes from anchors
console.log('Clearing old cabinet notes...');
let cleared = 0;
annotations.forEach(a => {
  if ((a.note || '').includes('电柜:')) {
    a.note = a.note.split('\n').filter(l => !l.startsWith('电柜:')).join('\n').trim();
    cleared++;
  }
});
console.log('Cleared ' + cleared + ' annotations');

// Clear old device-info cabinet entries
let diCleared = 0;
for (const [code, entry] of Object.entries(di.items)) {
  if (entry.sheet === '电柜清单' || entry.sheet === '急停电柜清单') {
    delete di.items[code];
    diCleared++;
  }
}
di.count = Object.keys(di.items).length;
console.log('Cleared ' + diCleared + ' device-info entries, base count: ' + di.count);

const now = new Date().toISOString();
let totalCreated = 0;
let totalSkipped = 0;
let totalAnchorNotFound = 0;

// ========================================
// EXCEL 1: 本地电柜
// ========================================
console.log('\n=== Excel 1: 本地电柜 ===');

const xl1 = 'c:/Users/Administrator/Desktop/行李智察/3392.ICS预分拣线设备清单.xlsx';
const wb1 = XLSX.readFile(xl1);
const ws1 = wb1.Sheets[wb1.SheetNames[0]];
const data1 = XLSX.utils.sheet_to_json(ws1, {header: 1});

const targetTypes1 = new Set([
  'ICS汇流-本地电柜', 'ICS分流-本地电柜', '普通人工值机控制箱',
  '自助值机接口盒', '大件行李值机控制箱', 'VIP人工值机控制箱',
]);

const manualAnchors1 = {
  '3302': '3302.25.1', '3202': '3202.25.1', '3104': '3104.33.2',
  '3281': '3281.3.1', '3103': '3103.1.1', '3105': '3105.1.1',
  '3164': '3164.1.1', '3101': '3101.1.1', '3165': '3165.1.1',
};

for (let i = 1; i < data1.length; i++) {
  const type = String(data1[i][18] || '').trim();
  const bodyCode = String(data1[i][21] || '').trim();
  if (!bodyCode || !targetTypes1.has(type)) continue;

  const segs = bodyCode.split('.');
  const anchorPrefix = segs.slice(0, 2).join('.');
  const firstSeg = segs[0];

  let anchor = annotations.find(a => {
    const aCode = String(a.code || '');
    const aSegs = aCode.split('.');
    return aSegs.slice(0, 2).join('.') === anchorPrefix;
  });

  if (!anchor) {
    const manualCode = manualAnchors1[firstSeg];
    if (!manualCode) { totalSkipped++; continue; }
    anchor = annotations.find(a => a.code === manualCode);
    if (!anchor) { totalAnchorNotFound++; continue; }
  }

  // Check if cabinet annotation already exists
  if (annotations.some(a => a.code === bodyCode)) { totalSkipped++; continue; }

  // Create cabinet annotation at same coordinates
  const prefix4 = bodyCode.match(/\d{4}/) ? bodyCode.match(/\d{4}/)[0] : '';
  const resp = rz.items[prefix4] || {};
  const note = '本地电柜 | ' + type;

  const cabinetAnnot = {
    id: uid(),
    drawingId: anchor.drawingId,
    type: 'point',
    groupId: anchor.groupId,
    code: bodyCode,
    note: note,
    points: JSON.parse(JSON.stringify(anchor.points)),
    createdAt: now,
    updatedAt: now,
    special: true,
  };
  annotations.push(cabinetAnnot);
  totalCreated++;

  // device-info entry
  const deviceName = String(data1[i][2] || data1[i][1] || '').trim();
  di.items[bodyCode] = {
    code: bodyCode, sheet: '电柜清单', row: i + 1,
    fields: [
      { label: '责任分队', value: resp.team || '' },
      { label: '责任区域', value: resp.location || '' },
      { label: '规格/型号', value: type },
      { label: '设备名称', value: deviceName || type },
    ],
    note: '责任分队: ' + (resp.team || '') + '；责任区域: ' + (resp.location || '') + '；规格/型号: ' + type + '；设备名称: ' + (deviceName || type),
  };
}

console.log('Excel1 - Created: ' + totalCreated + ', Skipped: ' + totalSkipped + ', Anchor not found: ' + totalAnchorNotFound);

// ========================================
// EXCEL 2: 主电柜 / 副电柜
// ========================================
console.log('\n=== Excel 2: 急停系统 ===');

const xl2 = 'c:/Users/Administrator/Desktop/T3行李系统急停系统设备清单(1).xlsx';
const wb2 = XLSX.readFile(xl2);
const ws2 = wb2.Sheets[wb2.SheetNames[0]];
const data2 = XLSX.utils.sheet_to_json(ws2, {header: 1});

const manualAnchors2 = { '3291.5.11': '3291.5.10' };
let created2 = 0, skipped2 = 0, anchorNotFound2 = 0;

function cabinetLabel(code) {
  const isEstop = code.startsWith('38');
  if (code.endsWith('99')) return isEstop ? '急停中央控制主柜' : '中央控制主柜';
  if (code.endsWith('98')) return isEstop ? '急停中央控制副柜' : '中央控制副柜';
  return '未知';
}

for (let i = 1; i < data2.length; i++) {
  let anchorCode = String(data2[i][20] || '').trim();
  const cabinetCode = String(data2[i][21] || '').trim();
  const deviceModel = String(data2[i][18] || data2[i][2] || '').trim();
  if (!anchorCode || !cabinetCode) continue;

  if (manualAnchors2[anchorCode]) anchorCode = manualAnchors2[anchorCode];

  const anchor = annotations.find(a => a.code === anchorCode);
  if (!anchor) { anchorNotFound2++; continue; }

  if (annotations.some(a => a.code === cabinetCode)) { skipped2++; continue; }

  const label = cabinetLabel(cabinetCode);
  const prefix4 = cabinetCode.match(/\d{4}/) ? cabinetCode.match(/\d{4}/)[0] : '';
  const resp = rz.items[prefix4] || {};
  const note = label;

  const cabinetAnnot = {
    id: uid(),
    drawingId: anchor.drawingId,
    type: 'point',
    groupId: anchor.groupId,
    code: cabinetCode,
    note: note,
    points: JSON.parse(JSON.stringify(anchor.points)),
    createdAt: now,
    updatedAt: now,
    special: true,
  };
  annotations.push(cabinetAnnot);
  created2++;

  di.items[cabinetCode] = {
    code: cabinetCode, sheet: '急停电柜清单', row: i + 1,
    fields: [
      { label: '责任分队', value: resp.team || '' },
      { label: '责任区域', value: resp.location || '' },
      { label: '规格/型号', value: label },
      { label: '设备名称', value: deviceModel || label },
    ],
    note: '责任分队: ' + (resp.team || '') + '；责任区域: ' + (resp.location || '') + '；规格/型号: ' + label + '；设备名称: ' + (deviceModel || label),
  };
}

console.log('Excel2 - Created: ' + created2 + ', Skipped: ' + skipped2 + ', Anchor not found: ' + anchorNotFound2);

totalCreated += created2;
totalSkipped += skipped2;
totalAnchorNotFound += anchorNotFound2;

// ========================================
// SAVE
// ========================================
di.count = Object.keys(di.items).length;
di.generatedAt = new Date().toISOString();
syncData.updatedAt = new Date().toISOString();

fs.writeFileSync(syncPath, JSON.stringify(syncData, null, 2));
fs.writeFileSync(diPath, JSON.stringify(di, null, 2));

// ========================================
// VERIFY
// ========================================
const v = JSON.parse(fs.readFileSync(syncPath, 'utf8'));
const va = v.data.points.annotations;
const specials = va.filter(a => a.special);

console.log('\n=== VERIFICATION ===');
console.log('Total annotations: ' + va.length);
console.log('Special (cabinet) annotations: ' + specials.length);
console.log('Device-info total: ' + JSON.parse(fs.readFileSync(diPath, 'utf8')).count);

console.log('\nSample cabinets:');
specials.slice(0, 5).forEach(a => {
  console.log('  ' + a.code + ' | ' + a.drawingId + ' | ' + a.note + ' | groupId: ' + a.groupId);
});

// Verify 3808
const test3808 = va.find(a => a.code === '3808.00.99');
const testAnchor = va.find(a => a.code === '3291.5.10');
if (test3808 && testAnchor) {
  console.log('\n3808.00.99 & 3291.5.10:');
  console.log('  Same drawing: ' + (test3808.drawingId === testAnchor.drawingId));
  console.log('  Same coords: ' + (JSON.stringify(test3808.points) === JSON.stringify(testAnchor.points)));
  console.log('  Same group: ' + (test3808.groupId === testAnchor.groupId));
}

// Verify 3392
const test3392 = va.find(a => a.code === '3392.43.98');
if (test3392) {
  const anchor3392 = va.find(a => a.code === '3392.43.1');
  console.log('\n3392.43.98 & 3392.43.1:');
  console.log('  Same drawing: ' + (test3392.drawingId === anchor3392.drawingId));
  console.log('  Same coords: ' + (JSON.stringify(test3392.points) === JSON.stringify(anchor3392.points)));
}

console.log('\n=== DONE ===');
