# Mobile Loading Performance Optimization — Design Spec

**Date**: 2026-06-09  
**Status**: Approved  
**Deployment**: GitHub Pages (static hosting, no backend server)

---

## Problem

Mobile users accessing the app via GitHub Pages experience very slow initial load times. The root cause is that `initSync()` prioritizes downloading a **3.8MB `data-backup.json`** before trying the efficient lazy-loading system (which only needs ~230KB).

```
Current flow:  Remote API ❌ → data-backup.json (3.8MB!) ✅ → done (lazy loading never reached)
```

## Solution Overview

Five-part optimization targeting data loading, caching, preloading, device data, and startup sequence.

---

## Part 1: Data Loading Priority Swap (Core Fix)

**File**: `app.js` — `initSync()` function (line 565-606)

**Change**: Reorder the fallback chain in `initSync()` so lazy loading is tried BEFORE the static backup JSON:

```
New flow:  Remote API ❌ → Lazy Point Data (230KB) ✅ → done
```

```
Old priority:  API → loadStaticPointBackup  → loadLazyPointData  → loadStaticSyncData
New priority:  API → loadLazyPointData      → loadStaticPointBackup → loadStaticSyncData
```

**Impact**:
- Initial data load: 3.8MB → ~230KB (points-manifest.json 28KB + current drawing shard ~200KB)
- ~16x reduction in data transfer for first load
- `data-backup.json` and `data/sync-data.json` remain as ultimate fallbacks
- Lazy loading system is already well-tested; this just gives it the right priority

**Risk**: Very low. Lazy loading system already works correctly; it simply wasn't being reached in the GitHub Pages deployment scenario.

---

## Part 2: Cache Strategy Optimization

**Files**: `app.js` — all `fetch()` calls for data assets

**Change**:
1. Remove `{ cache: "no-store" }` from all data fetches (manifest files, drawing shards, search index, responsibility zones, device info)
2. Replace with `{ cache: "default" }` (browser default heuristic caching)
3. Use the existing version query parameter `?v=...` for cache invalidation when data changes
4. Version string should be updated whenever `data-backup.json` or drawing shards are rebuilt

**Specific fetches to update**:
- `loadStaticPointBackup()` — `data-backup.json`
- `loadStaticSyncData()` — `data/sync-data.json`
- `loadLazyPointData()` — `data/points-manifest.json`
- `loadLazyDrawing()` — `data/drawings/{id}.json`
- `loadSearchIndex()` — `data/search-index.json`
- `loadResponsibilityZones()` — `data/responsibility-zones.json`
- `loadDeviceInfo()` — `data/device-info.json`
- `loadDrawingManifest()` — `assets/floors/manifest.json`

**Impact**:
- First visit: downloads all needed data (already reduced by Part 1)
- Subsequent visits: 304 Not Modified responses via ETag/Last-Modified (GitHub Pages provides these)
- Essentially instant reload for returning users

**Risk**: Low. Version query parameter gives explicit control over cache invalidation. GitHub Pages serves proper ETag and Last-Modified headers.

---

## Part 3: Mobile Background Preloading

**File**: `app.js` — `startLazyBackgroundLoad()` function (line 509-531)

**Change**:
1. Remove the `if (isCompactViewport()) return;` guard — enable preloading on mobile
2. Use conservative delays for mobile:
   - Desktop: `requestIdleCallback` + 800ms initial delay + 450ms between drawings (unchanged)
   - Mobile: `requestIdleCallback` with 2000ms timeout + 1000ms between drawings
3. Preload priority: sort remaining drawings by floor proximity to current drawing (e.g., if viewing F3, preload F2→F4→F1→B1→...)

**Implementation sketch**:
```javascript
function startLazyBackgroundLoad() {
    if (!lazyPoints.enabled || lazyPoints.backgroundStarted) return;
    lazyPoints.backgroundStarted = true;
    
    var compact = isCompactViewport();
    var ids = FIXED_DRAWING_ORDER.filter(/* ... */);
    
    // Sort by proximity to current drawing on mobile
    if (compact) {
        var currentIdx = ids.indexOf(state.currentDrawingId);
        ids.sort(function(a, b) {
            return Math.abs(ids.indexOf(a) - currentIdx) - Math.abs(ids.indexOf(b) - currentIdx);
        });
    }
    
    // ... loadNext with compact-aware delays
    var delay = compact ? 2000 : 800;
    var gap = compact ? 1000 : 450;
}
```

**Impact**:
- Switching to adjacent floors is instant (already preloaded)
- No perceived delay when browsing drawings on mobile
- Conservative delays prevent preloading from competing with user interactions

**Risk**: Low-Medium. Uses more mobile data (each shard 150-700KB). Mitigation: preloading only starts after initial drawing is fully loaded and idle.

---

## Part 4: Device Info Optimization

**File**: `app.js` — `loadDeviceInfo()`, new file: `scripts/build-device-shards.mjs`

**Change** (two-phase approach):

**Phase 4a — Simple**: Ensure GitHub Pages serves gzip-compressed `device-info.json`
- GitHub Pages automatically gzips JSON files when the client sends `Accept-Encoding: gzip`
- 11MB JSON typically compresses to 1-2MB with gzip
- Verify this is working; add explicit check

**Phase 4b — Sharding** (if Phase 4a isn't sufficient):
- Add build script `scripts/build-device-shards.mjs` that:
  1. Reads `data/device-info.json`
  2. Groups entries by PLC prefix (first 2-4 digits of device code)
  3. Writes `data/devices/{prefix}.json` shards
  4. Writes a lightweight `data/device-index.json` mapping device codes → prefix shards
- Modify `loadDeviceInfo()` to:
  1. Load `device-index.json` first (~200KB)
  2. When a specific device is queried, load only the relevant shard (~10-50KB)
  3. Cache loaded shards in memory

**Impact**:
- Phase 4a: Zero code change, relies on HTTP compression — immediate benefit
- Phase 4b: Device lookup goes from 11MB → ~200KB index + ~30KB shard per query

**Risk**: Phase 4a is zero-risk. Phase 4b requires build script validation and index integrity checks.

---

## Part 5: Startup Sequence Optimization

**File**: `app.js` — main IIFE execution block (lines 5672-5693)

**Change**: Reorder startup to prioritize first paint, defer non-critical work.

**Before**:
```
loadDrawingManifest → loadData → restoreCurrentDrawing → loadDocsData 
→ bindEvents → startManifestSync → renderDrawingList → switchDrawing 
→ setTool → loadResponsibilityZones → initSync (blocking chain)
```

**After**:
```
Phase 1 — First Paint (critical path):
  loadDrawingManifest → loadData → restoreCurrentDrawing → bindEvents 
  → renderDrawingList → switchDrawing → setTool → updateBatchCodePanel

Phase 2 — Async (non-blocking, fire-and-forget):
  loadDocsData()
  loadResponsibilityZones()
  startManifestSync()
  
Phase 3 — Data sync (async, updates UI when complete):
  initSync() → syncAutoGroups → re-render if data changed
```

**Implementation sketch**:
```javascript
// Phase 1: Critical — show the drawing ASAP
await loadDrawingManifest();
loadData();
restoreCurrentDrawingLocal();
bindEvents();
startManifestSync();
renderDrawingList();
renderDuplicatePanel();
switchDrawing(state.currentDrawingId);
setTool("pan");
updateBatchCodePanel();

// Phase 2: Non-critical — fire and forget
loadDocsData();
loadResponsibilityZones();

// Phase 3: Data sync — update when ready
initSync().then(function() {
    syncAutoGroupsForAllDrawings();
    restoreCurrentDrawingLocal();
    renderDrawingList();
    renderDuplicatePanel();
    if (state.activeModule === "docs") renderDocsModule();
    switchDrawing(state.currentDrawingId, { save: false });
    updateBatchCodePanel();
});
```

**Impact**:
- User sees the floor plan drawing much sooner (first paint)
- Non-essential data loads in background without blocking the UI
- Same eventual state as before, just perceived as faster

**Risk**: Medium. Must ensure `switchDrawing` doesn't depend on data that hasn't loaded yet. The `initSync()` callback already handles re-rendering when data arrives. Ensure no race conditions between `loadData()` (localStorage) and `initSync()` (remote/lazy data) merging.

---

## Implementation Order

1. **Part 1** (priority swap) — highest impact, lowest risk, one-line change
2. **Part 2** (cache strategy) — remove `no-store` from all fetches
3. **Part 5** (startup sequence) — reorder the IIFE block
4. **Part 3** (mobile preloading) — enable with conservative delays
5. **Part 4a** (gzip verification) — verify, no code change
6. **Part 4b** (device sharding) — only if 4a is insufficient

---

## Testing

- Test on GitHub Pages deployment (the actual deployment target)
- Measure with Chrome DevTools Lighthouse (mobile throttling)
- Key metrics: First Contentful Paint, Time to Interactive, total data transferred
- Test both first-visit (clean cache) and return-visit scenarios
- Test on real mobile device (not just DevTools emulation)
