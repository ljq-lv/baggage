const fs = require('fs');
const path = require('path');

const root = path.dirname(__dirname);
const syncPath = path.join(root, 'data', 'sync-data.json');

const syncData = JSON.parse(fs.readFileSync(syncPath, 'utf8'));
const annotations = syncData.data.points.annotations;

function uid() {
  return 'grp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// Find all new module annotations (special + created recently)
const now = new Date().toISOString().substring(0, 10); // today's date prefix
const newModules = annotations.filter(a => a.special && a.createdAt && a.createdAt.startsWith(now));
console.log('New modules found: ' + newModules.length);

// Extract type from note field: "急停模块 | 位于3372.00.99内" -> "急停模块"
function extractType(note) {
  if (!note) return '未知';
  const parts = note.split(' | ');
  return parts[0].trim();
}

// Group modules by type + drawing
const typeDrawingMap = new Map(); // "type|drawingId" -> [annotations]
newModules.forEach(a => {
  const type = extractType(a.note);
  const key = type + '|' + a.drawingId;
  if (!typeDrawingMap.has(key)) typeDrawingMap.set(key, []);
  typeDrawingMap.get(key).push(a);
});

console.log('Unique type+drawing groups: ' + typeDrawingMap.size);

// Create groups for each type+drawing
const existingGroupNames = new Set(syncData.data.points.groups.map(g => g.name));

for (const [key, mods] of typeDrawingMap) {
  const [type, drawingId] = key.split('|');
  const groupName = type;

  // Check if group already exists for this drawing+type
  let group = syncData.data.points.groups.find(g =>
    g.name === groupName && (g.drawingId || drawingId) === drawingId
  );

  if (!group) {
    group = {
      id: uid(),
      name: groupName,
      alias: '',
      drawingId: drawingId,
      isAuto: false,
      createdAt: new Date().toISOString(),
    };
    syncData.data.points.groups.push(group);
    console.log('Created group: ' + groupName + ' on ' + drawingId + ' (' + mods.length + ' modules)');
  } else {
    console.log('Existing group: ' + groupName + ' on ' + drawingId + ' (' + mods.length + ' modules)');
  }

  // Assign group
  mods.forEach(a => {
    a.groupId = group.id;
  });
}

// Save
syncData.updatedAt = new Date().toISOString();
fs.writeFileSync(syncPath, JSON.stringify(syncData, null, 2));

// Verify
const v = JSON.parse(fs.readFileSync(syncPath, 'utf8'));
const groups = v.data.points.groups;
const newGroups = groups.filter(g => g.name && g.createdAt && g.createdAt.startsWith(now.substring(0, 10)));

console.log('\n=== VERIFICATION ===');
console.log('Total groups: ' + groups.length);
console.log('New type groups: ' + newGroups.length);

// Show group distribution
const groupSummary = new Map();
newGroups.forEach(g => {
  const count = v.data.points.annotations.filter(a => a.groupId === g.id).length;
  groupSummary.set(g.name + ' (' + g.drawingId + ')', count);
});
console.log('\nNew groups:');
for (const [name, count] of groupSummary) {
  console.log('  ' + name + ': ' + count + ' modules');
}

// Check that all new modules have proper group
const ungrouped = v.data.points.annotations.filter(a =>
  a.special && a.createdAt && a.createdAt.startsWith(now) &&
  (!a.groupId || !groups.some(g => g.id === a.groupId))
);
console.log('\nUngrouped modules: ' + ungrouped.length);
