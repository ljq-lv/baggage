(async function () {
  const STORAGE_KEY = "baggage-point-finder-v1";
  const DOCS_KEY = "baggage-training-docs-v1";
  const SVG_NS = "http://www.w3.org/2000/svg";

  const defaultDrawings = [
    { id: "b1", title: "B1层", image: "assets/floors/b1.jpg" },
    { id: "f1", title: "1层", image: "assets/floors/f1.jpg" },
    { id: "f2", title: "2层", image: "assets/floors/f2.jpg" },
    { id: "f3", title: "3层", image: "assets/floors/f3.jpg" },
    { id: "f3-transfer", title: "3层开包间", image: "assets/floors/f3-transfer.jpg" },
    { id: "f4", title: "4层", image: "assets/floors/f4.jpg" },
    { id: "overview-2d", title: "2D总览", image: "assets/floors/overview-2d.jpg" },
    { id: "overview-3d", title: "3D总览", image: "assets/floors/overview-3d.jpg" }
  ];
  let drawings = defaultDrawings.slice();

  const state = {
    currentDrawingId: defaultDrawings[0].id,
    tool: "pan",
    annotationsVisible: true,
    labelsVisible: false,
    annotations: [],
    groups: [],
    collapsedGroups: {},
    selectedForGroupMove: new Set(),
    groupMoveSelectionAnchorId: null,
    activeGroupId: "",
    renderPrefix: "",
    selectedId: null,
    highlightedId: null,
    transform: { x: 0, y: 0, scale: 1 },
    imageSize: { width: 1, height: 1 },
    activePointers: new Map(),
    drag: null,
    draft: null,
    autoNameEnabled: false,
    autoNameSegments: [],
    autoNameSeparators: [],
    autoNamePrimaryIdx: -1,
    batchCodes: [],
    batchCodeIndex: 0,
    batchCodeActive: false,
    lastPointCodeSource: "",
    activeModule: "points",
    docFolders: [],
    docs: [],
    activeFolderId: "",
    selectedDocId: null
  };

  const el = {
    drawingList: document.getElementById("drawingList"),
    drawingTotalCount: document.getElementById("drawingTotalCount"),
    searchInput: document.getElementById("searchInput"),
    searchButton: document.getElementById("searchButton"),
    searchResults: document.getElementById("searchResults"),
    showAnnotations: document.getElementById("showAnnotations"),
    showLabels: document.getElementById("showLabels"),
    annotationForm: document.getElementById("annotationForm"),
    emptyEditor: document.getElementById("emptyEditor"),
    pointCode: document.getElementById("pointCode"),
    pointNote: document.getElementById("pointNote"),
    deleteAnnotation: document.getElementById("deleteAnnotation"),
    exportButton: document.getElementById("exportButton"),
    importInput: document.getElementById("importInput"),
    statusText: document.getElementById("statusText"),
    currentDrawingTitle: document.getElementById("currentDrawingTitle"),
    annotationCount: document.getElementById("annotationCount"),
    modeHint: document.getElementById("modeHint"),
    viewport: document.getElementById("viewport"),
    stage: document.getElementById("stage"),
    image: document.getElementById("drawingImage"),
    overlay: document.getElementById("overlay"),
    fitButton: document.getElementById("fitButton"),
    minimap: document.querySelector(".minimap"),
    minimapCount: document.getElementById("minimapCount"),
    minimapBody: document.getElementById("minimapBody"),
    minimapImage: document.getElementById("minimapImage"),
    groupNameInput: document.getElementById("groupNameInput"),
    addGroupButton: document.getElementById("addGroupButton"),
    minimapList: document.getElementById("minimapList"),
    minimapOverlay: document.getElementById("minimapOverlay"),
    setBackupButton: document.getElementById("setBackupButton"),
    autoNameToggle: document.getElementById("autoNameToggle"),
    autoNameExpandBtn: document.getElementById("autoNameExpandBtn"),
    autoNameCompact: document.getElementById("autoNameCompact"),
    autoNameTemplate: document.getElementById("autoNameTemplate"),
    autoNameAdvanced: document.getElementById("autoNameAdvanced"),
    autoNamePreview: document.getElementById("autoNamePreview"),
    batchCodeInput: document.getElementById("batchCodeInput"),
    batchCodePreview: document.getElementById("batchCodePreview"),
    startBatchCodeButton: document.getElementById("startBatchCodeButton"),
    clearBatchCodeButton: document.getElementById("clearBatchCodeButton"),
    moduleTabs: document.querySelectorAll(".module-tab"),
    pointModule: document.getElementById("pointModule"),
    docsModule: document.getElementById("docsModule"),
    folderNameInput: document.getElementById("folderNameInput"),
    folderParentSelect: document.getElementById("folderParentSelect"),
    addFolderButton: document.getElementById("addFolderButton"),
    seedDocsButton: document.getElementById("seedDocsButton"),
    docUploadInput: document.getElementById("docUploadInput"),
    folderTree: document.getElementById("folderTree"),
    docsCurrentFolder: document.getElementById("docsCurrentFolder"),
    docsCount: document.getElementById("docsCount"),
    docSearchInput: document.getElementById("docSearchInput"),
    docList: document.getElementById("docList"),
    docEmptyState: document.getElementById("docEmptyState"),
    docReaderContent: document.getElementById("docReaderContent"),
    docTitleInput: document.getElementById("docTitleInput"),
    deleteDocButton: document.getElementById("deleteDocButton"),
    docMeta: document.getElementById("docMeta"),
    docBody: document.getElementById("docBody")
  };

  var BACKUP_KEY = STORAGE_KEY + "-backup";
  var drawingManifestSignature = "";
  var trainingManifestSignature = "";
  var AUTONAME_KEY = "baggage-autoname";
  var CURRENT_DRAWING_KEY = STORAGE_KEY + "-current-drawing";
  var SYNC_META_KEY = STORAGE_KEY + "-sync-meta";
  var SYNC_ENDPOINT = "/api/data";
  var MAX_UNDO_STEPS = 50;
  var customDrawingOrder = [];
  var drawingPointerDrag = null;
  var suppressDrawingClick = false;
  var syncState = {
    enabled: location.protocol === "http:" || location.protocol === "https:",
    applyingRemote: false,
    pushTimer: null,
    syncedAt: ""
  };
  var undoStack = [];

  try {
    var syncMeta = JSON.parse(localStorage.getItem(SYNC_META_KEY) || "{}");
    syncState.syncedAt = syncMeta.syncedAt || "";
  } catch (error) {}

  function getPointsPayload() {
    return {
      version: 1,
      currentDrawingId: state.currentDrawingId,
      drawings: drawings.map(function(d) { return { id: d.id, title: d.title, image: d.image }; }),
      groups: state.groups,
      collapsedGroups: state.collapsedGroups,
      annotations: state.annotations,
      batchCodes: state.batchCodes,
      batchCodeIndex: state.batchCodeIndex,
      batchCodeActive: state.batchCodeActive
    };
  }

  function savePointsLocal() {
    var json = JSON.stringify(getPointsPayload());
    try {
      localStorage.setItem(STORAGE_KEY, json);
      localStorage.setItem(BACKUP_KEY, json);
    } catch (error) {
      setStatus("保存失败，请导出数据备份。");
      console.error("Save failed:", error);
    }
    writeBackupFile(json);
  }

  function getDocsPayload() {
    return {
      version: 1,
      folders: state.docFolders,
      docs: state.docs,
      activeFolderId: state.activeFolderId,
      selectedDocId: state.selectedDocId
    };
  }

  function saveDocsLocal() {
    localStorage.setItem(DOCS_KEY, JSON.stringify(getDocsPayload()));
  }

  function getAutoNamePayload() {
    return {
      enabled: state.autoNameEnabled,
      segments: state.autoNameSegments,
      separators: state.autoNameSeparators,
      primaryIdx: state.autoNamePrimaryIdx
    };
  }

  function saveAutoNameLocal() {
    try {
      localStorage.setItem(AUTONAME_KEY, JSON.stringify(getAutoNamePayload()));
    } catch (e) {}
  }

  function getCombinedPayload() {
    return {
      version: 1,
      points: getPointsPayload(),
      docs: getDocsPayload(),
      autoName: getAutoNamePayload()
    };
  }

  function hasLocalData() {
    return state.annotations.length > 0 || state.groups.length > 0 || state.docs.length > 0 || state.docFolders.length > 0;
  }

  function payloadHasData(payload) {
    if (!payload || typeof payload !== "object") return false;
    const points = payload.points || payload;
    const docs = payload.docs || {};
    return (
      (Array.isArray(points.annotations) && points.annotations.length > 0) ||
      (Array.isArray(points.groups) && points.groups.length > 0) ||
      (Array.isArray(docs.docs) && docs.docs.length > 0) ||
      (Array.isArray(docs.folders) && docs.folders.length > 0)
    );
  }

  function hasPointData() {
    return state.annotations.length > 0 || state.groups.length > 0;
  }

  function payloadHasPointData(payload) {
    if (!payload || typeof payload !== "object") return false;
    const points = payload.points || payload;
    return (
      (Array.isArray(points.annotations) && points.annotations.length > 0) ||
      (Array.isArray(points.groups) && points.groups.length > 0)
    );
  }

  function saveSyncMeta(updatedAt) {
    syncState.syncedAt = updatedAt || new Date().toISOString();
    try {
      localStorage.setItem(SYNC_META_KEY, JSON.stringify({ syncedAt: syncState.syncedAt }));
    } catch (error) {}
  }

  function applyDrawingOrder(orderIds) {
    if (!Array.isArray(orderIds) || orderIds.length === 0) return;
    var orderMap = new Map();
    orderIds.forEach(function(id, index) {
      if (id && !orderMap.has(id)) orderMap.set(id, index);
    });
    drawings.sort(function(a, b) {
      var aIndex = orderMap.has(a.id) ? orderMap.get(a.id) : Number.MAX_SAFE_INTEGER;
      var bIndex = orderMap.has(b.id) ? orderMap.get(b.id) : Number.MAX_SAFE_INTEGER;
      if (aIndex !== bIndex) return aIndex - bIndex;
      return 0;
    });
  }

  function saveCurrentDrawingLocal() {
    try {
      localStorage.setItem(CURRENT_DRAWING_KEY, state.currentDrawingId || "");
    } catch (error) {}
  }

  function restoreCurrentDrawingLocal() {
    try {
      var drawingId = localStorage.getItem(CURRENT_DRAWING_KEY);
      if (drawingId && drawings.some(function(drawing) { return drawing.id === drawingId; })) {
        state.currentDrawingId = drawingId;
        return true;
      }
    } catch (error) {}
    return false;
  }

  function scheduleSyncPush() {
    if (!syncState.enabled || syncState.applyingRemote) return;
    window.clearTimeout(syncState.pushTimer);
    syncState.pushTimer = window.setTimeout(pushSyncData, 650);
  }

  async function pushSyncData() {
    if (!syncState.enabled || syncState.applyingRemote) return;
    try {
      const response = await fetch(SYNC_ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: getCombinedPayload() })
      });
      if (!response.ok) throw new Error("Sync save failed: " + response.status);
      const result = await response.json();
      saveSyncMeta(result.updatedAt);
      setStatus("已同步到服务器。");
    } catch (error) {
      console.warn("Sync push failed:", error);
      setStatus("本地已保存，服务器同步失败。");
    }
  }

  function applyRemoteData(remoteData) {
    if (!remoteData || typeof remoteData !== "object") return;
    syncState.applyingRemote = true;
    try {
      if (remoteData.points && typeof remoteData.points === "object") {
        if (Array.isArray(remoteData.points.drawings)) {
          customDrawingOrder = remoteData.points.drawings.map(function(drawing) { return drawing && drawing.id; }).filter(Boolean);
          applyDrawingOrder(customDrawingOrder);
        }
        if (Array.isArray(remoteData.points.groups)) {
          state.groups = remoteData.points.groups.map(toGroup).filter(Boolean);
        }
        if (remoteData.points.collapsedGroups && typeof remoteData.points.collapsedGroups === "object") {
          state.collapsedGroups = remoteData.points.collapsedGroups;
        }
        if (Array.isArray(remoteData.points.annotations)) {
          state.annotations = remoteData.points.annotations.map(toPointAnnotation).filter(Boolean);
        }
      }
      if (remoteData.docs && typeof remoteData.docs === "object") {
        state.docFolders = Array.isArray(remoteData.docs.folders)
          ? remoteData.docs.folders.filter((folder) => folder.id && folder.name)
          : [];
        state.docs = Array.isArray(remoteData.docs.docs)
          ? remoteData.docs.docs.filter((doc) => doc.id && doc.title)
          : [];
        state.activeFolderId = remoteData.docs.activeFolderId || "";
        state.selectedDocId = remoteData.docs.selectedDocId || null;
      }
      if (remoteData.autoName && typeof remoteData.autoName === "object") {
        if (typeof remoteData.autoName.enabled === "boolean") state.autoNameEnabled = remoteData.autoName.enabled;
        if (Array.isArray(remoteData.autoName.segments)) state.autoNameSegments = remoteData.autoName.segments;
        if (Array.isArray(remoteData.autoName.separators)) state.autoNameSeparators = remoteData.autoName.separators;
        if (typeof remoteData.autoName.primaryIdx === "number") state.autoNamePrimaryIdx = remoteData.autoName.primaryIdx;
      }
      syncAutoGroupsForAllDrawings();
      savePointsLocal();
      saveDocsLocal();
      saveAutoNameLocal();
    } finally {
      syncState.applyingRemote = false;
    }
    renderDrawingList();
    renderDocsModule();
    switchDrawing(state.currentDrawingId);
    setTool(state.tool || "pan");
    el.autoNameToggle.checked = state.autoNameEnabled;
    el.autoNameCompact.hidden = !state.autoNameEnabled;
    el.autoNameExpandBtn.hidden = !state.autoNameEnabled;
    el.autoNameTemplate.value = segmentsToTemplate(state.autoNameSegments, state.autoNameSeparators);
    updateAutoNamePreview();
  }

  async function loadStaticPointBackup() {
    try {
      var staticUrl = new URL("data-backup.json?v=" + Date.now(), document.baseURI).href;
      var staticResp = await fetch(staticUrl, { cache: "no-store" });
      if (!staticResp.ok) return false;
      var staticData = await staticResp.json();
      if (!payloadHasPointData(staticData)) return false;
      applyRemoteData({ points: staticData });
      return true;
    } catch (error) {
      console.warn("Static data load failed:", error.message);
      return false;
    }
  }

  async function initSync() {
    var loaded = false;

    if (syncState.enabled) {
      try {
        var response = await fetch(SYNC_ENDPOINT, { cache: "no-store" });
        if (response.ok) {
          var remote = await response.json();
          if (payloadHasData(remote.data)) {
            applyRemoteData(remote.data);
            saveSyncMeta(remote.updatedAt);
            loaded = true;
          }
        }
      } catch (e) {
        console.warn("Sync API unavailable, trying static JSON:", e.message);
      }
    }

    if (!loaded) {
      loaded = await loadStaticPointBackup() || loaded;
    }

    if (!loaded && hasLocalData() && syncState.enabled) {
      try {
        await pushSyncData();
        loaded = true;
      } catch (error) {
        console.warn("Initial sync push failed:", error.message);
      }
    }

    if (!loaded && hasLocalData()) {}
  }
  function loadData() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      raw = localStorage.getItem(BACKUP_KEY);
      setStatus("已从本地备份恢复。");
    }
    if (!raw) return;

    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      console.error("JSON parse failed, trying backup:", error);
      raw = localStorage.getItem(BACKUP_KEY);
      if (!raw) return;
      try {
        parsed = JSON.parse(raw);
        setStatus("主数据损坏，已从备份恢复。");
      } catch (backupError) {
        console.error("Backup also failed:", backupError);
        setStatus("数据读取失败，请检查浏览器控制台。");
        return;
      }
    }

    if (Array.isArray(parsed.groups)) {
      state.groups = parsed.groups.map(toGroup).filter(Boolean);
    }
    if (typeof parsed.currentDrawingId === "string") {
      state.currentDrawingId = parsed.currentDrawingId;
    }
    if (Array.isArray(parsed.drawings)) {
      customDrawingOrder = parsed.drawings.map(function(drawing) { return drawing && drawing.id; }).filter(Boolean);
      applyDrawingOrder(customDrawingOrder);
    }
    if (parsed.collapsedGroups && typeof parsed.collapsedGroups === "object") {
      state.collapsedGroups = parsed.collapsedGroups;
    }
    if (Array.isArray(parsed.annotations)) {
      var validAnnotations = [];
      var failedCount = 0;
      for (var i = 0; i < parsed.annotations.length; i++) {
        try {
          var result = toPointAnnotation(parsed.annotations[i]);
          if (result) validAnnotations.push(result);
          else failedCount++;
        } catch (error) {
          failedCount++;
          console.error("Annotation validation failed:", parsed.annotations[i], error);
        }
      }
      state.annotations = validAnnotations;
      if (failedCount > 0) {
        setStatus(failedCount + " 个标注数据异常已跳过。");
      }
    }

    if (Array.isArray(parsed.batchCodes)) {
      state.batchCodes = parseBatchCodes(parsed.batchCodes.join("\n"));
      state.batchCodeIndex = clamp(Number(parsed.batchCodeIndex) || 0, 0, state.batchCodes.length);
      state.batchCodeActive = Boolean(parsed.batchCodeActive && state.batchCodeIndex < state.batchCodes.length);
      if (el.batchCodeInput) el.batchCodeInput.value = state.batchCodes.join("\n");
    }

    var totalAnnotations = Array.isArray(parsed.annotations) ? parsed.annotations.length : 0;
    console.log(
      "Data loaded: " + state.annotations.length + "/" + totalAnnotations + " annotations, " +
      state.groups.length + " groups"
    );
    syncAutoGroupsForAllDrawings();
  }

  async function loadDrawingManifest() {
    try {
      const response = await fetch("assets/floors/manifest.json", { cache: "no-store" });
      if (!response.ok) return;
      const manifest = await response.json();
      if (!manifest || !Array.isArray(manifest.drawings) || manifest.drawings.length === 0) return;
      const signature = JSON.stringify(manifest.drawings.map((item) => ({
        id: item.id,
        title: item.title,
        image: item.image,
        pdf: item.pdf,
        width: item.width,
        height: item.height
      })));
      if (signature === drawingManifestSignature) return false;
      drawingManifestSignature = signature;

      drawings = manifest.drawings.map((item) => ({
        id: item.id,
        title: item.title || item.id,
        image: item.image && item.image.includes("/")
          ? item.image
          : `assets/floors/${item.image}`,
        pdf: item.pdf || "",
        width: item.width,
        height: item.height
      })).filter((item) => item.id && item.image);
      applyDrawingOrder(customDrawingOrder);

      if (!drawings.some((drawing) => drawing.id === state.currentDrawingId)) {
        state.currentDrawingId = drawings[0].id;
      }
      return true;
    } catch (error) {
      console.warn("Drawing manifest load failed:", error);
    }
    return false;
  }

  var backupFileHandle = null;

  // Try to restore the file handle from IndexedDB on startup
  (function restoreFileHandle() {
    if (!window.showSaveFilePicker) return; // Browser not supported
    var req = indexedDB.open("baggage-backup-db", 1);
    req.onerror = function() {};
    req.onupgradeneeded = function(e) {
      e.target.result.createObjectStore("handles");
    };
    req.onsuccess = function(e) {
      var tx = e.target.result.transaction("handles", "readonly");
      var getReq = tx.objectStore("handles").get("backupFile");
      getReq.onsuccess = function() {
        if (getReq.result) {
          backupFileHandle = getReq.result;
          // Verify permission still valid
          backupFileHandle.queryPermission({ mode: "readwrite" }).then(function(state) {
            if (state === "denied") {
              backupFileHandle = null;
              console.warn("Backup file permission denied, please re-select backup file.");
            }
          }).catch(function() {
            // queryPermission may fail on some browsers, keep handle and try anyway
          });
        }
      };
    };
  })();

  function setBackupFile() {
    if (!window.showSaveFilePicker) {
      setStatus("当前浏览器不支持自动备份文件句柄。");
      return;
    }
    window.showSaveFilePicker({
      suggestedName: "data-backup.json",
      types: [{ description: "JSON", accept: { "application/json": [".json"] } }]
    }).then(function(handle) {
      backupFileHandle = handle;
      // Store in IndexedDB
      var req = indexedDB.open("baggage-backup-db", 1);
      req.onsuccess = function(e) {
        var tx = e.target.result.transaction("handles", "readwrite");
        tx.objectStore("handles").put(handle, "backupFile");
        setStatus("自动备份文件已设置。");
      };
    }).catch(function(e) {
      if (e.name !== "AbortError") {
        console.error("File picker error:", e);
        setStatus("设置自动备份失败。");
      }
    });
  }

  function writeBackupFile(json) {
    if (!backupFileHandle) return;
    backupFileHandle.queryPermission({ mode: "readwrite" }).then(function(state) {
      if (state === "denied") {
        backupFileHandle = null;
        console.warn("Backup file permission denied. Please click '设置自动备份' to re-enable.");
        return;
      }
      if (state === "prompt") {
        return backupFileHandle.requestPermission({ mode: "readwrite" });
      }
    }).then(function(state) {
      if (state === "denied") return;
      return backupFileHandle.createWritable();
    }).then(function(writable) {
      if (!writable) return;
      return writable.write(json).then(function() {
        writable.close();
      });
    }).catch(function(err) {
      console.warn("Auto-backup write failed:", err);
      backupFileHandle = null;
    });
  }

  function saveData() {
    savePointsLocal();
    scheduleSyncPush();
    return;
    var json = JSON.stringify(getPointsPayload());
    try {
      localStorage.setItem(STORAGE_KEY, json);
      localStorage.setItem(BACKUP_KEY, json);
    } catch (error) {
      setStatus("保存失败，请导出数据备份。");
      console.error("Save failed:", error);
    }
    writeBackupFile(json);
  }

  function setStatus(message) {
    el.statusText.textContent = message;
    if (message) {
      window.clearTimeout(setStatus.timer);
      setStatus.timer = window.setTimeout(() => {
        el.statusText.textContent = "";
      }, 3500);
    }
  }

  function clonePlain(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createUndoSnapshot(label) {
    return {
      label: label || "操作",
      currentDrawingId: state.currentDrawingId,
      groups: clonePlain(state.groups),
      collapsedGroups: clonePlain(state.collapsedGroups),
      annotations: clonePlain(state.annotations),
      activeGroupId: state.activeGroupId,
      renderPrefix: state.renderPrefix,
      selectedId: state.selectedId,
      highlightedId: state.highlightedId,
      selectedForGroupMove: Array.from(state.selectedForGroupMove),
      groupMoveSelectionAnchorId: state.groupMoveSelectionAnchorId,
      batchCodes: clonePlain(state.batchCodes),
      batchCodeIndex: state.batchCodeIndex,
      batchCodeActive: state.batchCodeActive
    };
  }

  function recordUndoSnapshot(label) {
    undoStack.push(createUndoSnapshot(label));
    if (undoStack.length > MAX_UNDO_STEPS) undoStack.shift();
  }

  function restoreUndoSnapshot(snapshot) {
    const previousDrawingId = state.currentDrawingId;
    const previousTransform = { ...state.transform };
    state.currentDrawingId = snapshot.currentDrawingId;
    state.groups = clonePlain(snapshot.groups || []);
    state.collapsedGroups = clonePlain(snapshot.collapsedGroups || {});
    state.annotations = clonePlain(snapshot.annotations || []);
    state.activeGroupId = snapshot.activeGroupId || "";
    state.renderPrefix = snapshot.renderPrefix || "";
    state.selectedId = snapshot.selectedId || null;
    state.highlightedId = snapshot.highlightedId || null;
    state.selectedForGroupMove = new Set(snapshot.selectedForGroupMove || []);
    state.groupMoveSelectionAnchorId = snapshot.groupMoveSelectionAnchorId || null;
    state.batchCodes = clonePlain(snapshot.batchCodes || []);
    state.batchCodeIndex = snapshot.batchCodeIndex || 0;
    state.batchCodeActive = Boolean(snapshot.batchCodeActive);
    if (el.batchCodeInput) el.batchCodeInput.value = state.batchCodes.join("\n");
    saveData();
    renderDrawingList();
    renderMinimapList();
    updateBatchCodePanel();
    updateEditor();
    resetAutoNameInit();
    initAutoNameFromExisting();
    const drawing = currentDrawing();
    if (drawing) {
      if (el.image.getAttribute("src") !== drawing.image) el.image.src = drawing.image;
      if (el.minimapImage.getAttribute("src") !== drawing.image) el.minimapImage.src = drawing.image;
      el.currentDrawingTitle.textContent = drawing.title || "";
    }
    if (previousDrawingId === state.currentDrawingId) {
      state.transform = previousTransform;
      applyTransform();
    }
    renderOverlay();
  }

  function undoLastAction() {
    const snapshot = undoStack.pop();
    if (!snapshot) {
      setStatus("没有可撤回的操作。");
      return false;
    }
    restoreUndoSnapshot(snapshot);
    setStatus("已撤回：" + snapshot.label + "。");
    return true;
  }

  function pointsChanged(before, after) {
    if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) return true;
    for (let i = 0; i < before.length; i++) {
      if (Math.abs((before[i].x || 0) - (after[i].x || 0)) > 0.000001) return true;
      if (Math.abs((before[i].y || 0) - (after[i].y || 0)) > 0.000001) return true;
    }
    return false;
  }

  function isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  function uid() {
    return `ann-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function groupUid() {
    return `grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function firstFourDigits(value) {
    var match = String(value || "").match(/\d{4}/);
    return match ? match[0] : "";
  }

  function autoGroupUid(drawingId, prefix) {
    return "auto-" + String(drawingId || "").replace(/[^a-z0-9_-]/gi, "-") + "-" + prefix;
  }

  function groupDisplayName(group) {
    if (!group) return "未分组";
    return (hasGroupAlias(group) ? group.alias : (group.autoKey || group.name || "")).trim() || "未分组";
  }

  function hasGroupAlias(group) {
    if (!group || !group.alias) return false;
    var alias = String(group.alias).trim();
    var key = String(group.autoKey || group.name || "").trim();
    return alias !== key && alias !== firstFourDigits(alias);
  }

  function groupSubtitle(group, count) {
    if (group && group.isAuto && group.autoKey) return group.autoKey + " 路 " + count + " 个点位";
    return count + " 个点位";
  }

  function normalizeAutoGroup(group, prefix, drawingId) {
    if (!group || !prefix) return null;
    var oldName = String(group.name || "").trim();
    group.autoKey = prefix;
    group.isAuto = true;
    group.drawingId = group.drawingId || drawingId || state.currentDrawingId;
    if (!group.alias && oldName && oldName !== prefix) group.alias = oldName;
    group.name = prefix;
    return group;
  }

  function ensureAutoGroup(prefix, drawingId) {
    if (!prefix) return null;
    drawingId = drawingId || state.currentDrawingId;
    var group = state.groups.find(function(item) {
      return item.isAuto && item.autoKey === prefix && item.drawingId === drawingId;
    });
    if (group) return group;

    var id = autoGroupUid(drawingId, prefix);
    if (state.groups.some(function(item) { return item.id === id; })) id = groupUid();
    group = {
      id: id,
      name: prefix,
      alias: "",
      autoKey: prefix,
      isAuto: true,
      drawingId: drawingId,
      createdAt: new Date().toISOString()
    };
    state.groups.push(group);
    return group;
  }

  function syncAutoGroupsForDrawing(drawingId) {
    drawingId = drawingId || state.currentDrawingId;
    var changed = false;
    var byGroup = new Map();
    state.annotations.forEach(function(annotation) {
      if (annotation.drawingId !== drawingId || !annotation.groupId) return;
      if (!byGroup.has(annotation.groupId)) byGroup.set(annotation.groupId, []);
      byGroup.get(annotation.groupId).push(annotation);
    });

    state.groups.forEach(function(group) {
      if ((group.drawingId || drawingId) !== drawingId || group.isAuto) return;
      var items = byGroup.get(group.id) || [];
      if (!items.length) return;
      var prefixes = new Set(items.map(function(annotation) {
        return firstFourDigits(annotation.code);
      }).filter(Boolean));
      if (prefixes.size === 1) {
        normalizeAutoGroup(group, Array.from(prefixes)[0], drawingId);
        changed = true;
      }
    });

    state.annotations.forEach(function(annotation) {
      if (annotation.drawingId !== drawingId) return;
      var prefix = firstFourDigits(annotation.code);
      if (!prefix) return;
      var autoGroup = ensureAutoGroup(prefix, drawingId);
      if (autoGroup && annotation.groupId !== autoGroup.id) {
        annotation.groupId = autoGroup.id;
        changed = true;
      }
    });
    return changed;
  }

  function syncAutoGroupsForAllDrawings() {
    var changed = false;
    var drawingIds = new Set(drawings.map(function(drawing) { return drawing.id; }));
    state.annotations.forEach(function(annotation) {
      if (annotation.drawingId) drawingIds.add(annotation.drawingId);
    });
    drawingIds.forEach(function(drawingId) {
      changed = syncAutoGroupsForDrawing(drawingId) || changed;
    });
    return changed;
  }

  function docUid() {
    return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function folderUid() {
    return `fld-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function renameGroup(groupId, newName) {
    var name = String(newName || "").trim();
    var group = state.groups.find(function(g) { return g.id === groupId; });
    if (!group) return false;
    if (!name && !group.isAuto) return false;
    if (!group.isAuto && state.groups.some(function(g) {
      return g.id !== groupId && g.name === name && groupVisibleInDrawing(g.id, state.currentDrawingId);
    })) {
      setStatus("分组名已存在。");
      return false;
    }
    if (group.isAuto) {
      recordUndoSnapshot("编辑默认分组别名");
      group.alias = name === group.autoKey ? "" : name;
    } else {
      recordUndoSnapshot("重命名分组");
      group.name = name;
    }
    saveData();
    renderDrawingList();
    updateEditor();
    setStatus(group.isAuto ? "默认分组别名已保存。" : "分组已重命名。");
    return true;
  }

  function currentDrawing() {
    return drawings.find((drawing) => drawing.id === state.currentDrawingId) || drawings[0];
  }

  function currentDrawingAnnotations() {
    return state.annotations.filter((annotation) => annotation.drawingId === state.currentDrawingId);
  }

  function annotationMatchesPrefix(annotation, prefix) {
    return Boolean(prefix) && firstFourDigits(annotation && annotation.code) === prefix;
  }

  function drawingAnnotationCount(drawingId) {
    return state.annotations.filter((annotation) => annotation.drawingId === drawingId).length;
  }

  function drawingPrefixAnnotationCount(drawingId, prefix) {
    if (!prefix) return 0;
    return state.annotations.filter(function(annotation) {
      return annotation.drawingId === drawingId && annotationMatchesPrefix(annotation, prefix);
    }).length;
  }

  function currentAnnotations() {
    var annotations = currentDrawingAnnotations();
    if (state.renderPrefix) {
      return annotations.filter(function(annotation) {
        return annotationMatchesPrefix(annotation, state.renderPrefix) ||
          annotation.id === state.selectedId ||
          annotation.id === state.highlightedId;
      });
    }
    if (annotations.length > 500) {
      return annotations.filter(function(annotation) {
        return annotation.id === state.selectedId || annotation.id === state.highlightedId;
      });
    }
    return annotations;
  }

  function setRenderPrefix(prefix) {
    state.renderPrefix = firstFourDigits(prefix);
    renderDrawingList();
    renderOverlay();
    renderMinimapList();
  }

  function viewAutoGroupAcrossDrawings(groupId) {
    var group = state.groups.find(function(item) { return item.id === groupId; });
    if (!group || !group.isAuto || !group.autoKey) return;
    state.activeGroupId = group.id;
    state.renderPrefix = group.autoKey;
    renderDrawingList();
    renderOverlay();
    renderMinimapList();
    setStatus("正在查看 " + groupTitle(group.id) + " 在所有图层的点位数量。");
  }

  function renderPrefixForAnnotation(annotation) {
    return firstFourDigits(annotation && annotation.code);
  }

  function selectFirstAnnotatedDrawingIfNeeded() {
    if (state.annotations.some((annotation) => annotation.drawingId === state.currentDrawingId)) return;
    const drawing = drawings.find((item) => {
      return state.annotations.some((annotation) => annotation.drawingId === item.id);
    });
    if (drawing) state.currentDrawingId = drawing.id;
  }

  function groupTitle(groupId) {
    if (!groupId) return "未分组";
    return groupDisplayName(state.groups.find((group) => group.id === groupId));
  }

  function enableGroupRename(input) {
    input.readOnly = false;
    input.classList.add("editing");
    input.focus();
    input.select();
  }

  function finishGroupRename(groupId, input) {
    if (!input.classList.contains("editing")) {
      input.value = groupTitle(groupId);
      return;
    }
    if (renameGroup(groupId, input.value)) {
      input.value = groupTitle(groupId);
    }
    input.readOnly = true;
    input.classList.remove("editing");
  }

  function groupVisibleInDrawing(groupId, drawingId) {
    if (!groupId) return true;
    const group = state.groups.find((item) => item.id === groupId);
    if (!group) return false;
    if (group.drawingId === drawingId) return true;
    return state.annotations.some((annotation) => annotation.drawingId === drawingId && annotation.groupId === groupId);
  }

  function collapseGroupsInDrawing(drawingId) {
    var groupIds = new Set();
    state.annotations.forEach(function(annotation) {
      if (annotation.drawingId === drawingId) groupIds.add(annotation.groupId || "");
    });
    state.groups.forEach(function(group) {
      if (groupVisibleInDrawing(group.id, drawingId)) groupIds.add(group.id);
    });
    groupIds.forEach(function(groupId) {
      state.collapsedGroups[groupId] = true;
    });
  }

  function matchingAutoGroupInDrawing(group, drawingId) {
    if (!group || !group.isAuto || !group.autoKey) return null;
    return state.groups.find(function(item) {
      return item.isAuto && item.autoKey === group.autoKey && groupVisibleInDrawing(item.id, drawingId);
    }) || null;
  }

  function getSelected() {
    return state.annotations.find((annotation) => annotation.id === state.selectedId) || null;
  }

  function denormalize(point) {
    return {
      x: point.x * state.imageSize.width,
      y: point.y * state.imageSize.height
    };
  }

  function normalize(point) {
    return {
      x: clamp(point.x / state.imageSize.width, 0, 1),
      y: clamp(point.y / state.imageSize.height, 0, 1)
    };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  // ---- Auto-name functions ----

  function parseTemplateToSegments(template) {
    var segs = [];
    var seps = [];
    var primary = -1;

    // Find the # placeholder position
    var hashPos = template.indexOf("#");
    var bracePos = template.indexOf("{n");
    var numPos = hashPos >= 0 ? hashPos : bracePos;
    if (numPos < 0) {
      // No placeholder, treat entire template as text
      segs.push({ type: "text", value: template });
      return { segments: segs, separators: seps, primaryIdx: -1 };
    }

    var prefix = template.slice(0, numPos);
    var suffix = template.slice(numPos + (hashPos >= 0 ? 1 : template.indexOf("}", numPos) - numPos + 1));

    // Parse number settings from {n:step:carry:reset}
    var numSeg = { type: "number", value: 1, step: 1, carryAt: null, carryTarget: -1, carryAmount: 1, resetTo: 0 };
    if (bracePos >= 0) {
      var end = template.indexOf("}", bracePos);
      var inner = template.slice(bracePos + 2, end >= 0 ? end : template.length);
      var nums = inner.split(":");
      numSeg.step = parseInt(nums[0], 10) || 1;
      if (nums.length > 1 && nums[1]) numSeg.carryAt = parseInt(nums[1], 10);
      if (nums.length > 2 && nums[2]) numSeg.resetTo = parseInt(nums[2], 10);
    }

    // Detect separator from prefix/suffix boundaries
    var sep = ".";
    if (prefix.length > 0) {
      var lastChar = prefix.charAt(prefix.length - 1);
      if (lastChar === "." || lastChar === "-" || lastChar === "_" || lastChar === " ") {
        sep = lastChar;
        prefix = prefix.slice(0, -1);
      } else {
        sep = ""; // No separator, e.g., "E#" or "#鍙峰嵏杞界嚎"
      }
    } else if (suffix.length > 0) {
      var firstChar = suffix.charAt(0);
      if (firstChar === "." || firstChar === "-" || firstChar === "_" || firstChar === " ") {
        sep = firstChar;
        suffix = suffix.slice(1);
      } else {
        sep = "";
      }
    }

    // Split prefix by separator to create text segments
    if (prefix.length > 0) {
      var prefixParts = sep ? prefix.split(sep) : [prefix];
      for (var i = 0; i < prefixParts.length; i++) {
        if (prefixParts[i] !== "") {
          segs.push({ type: "text", value: prefixParts[i] });
          seps.push(sep);
        }
      }
    }

    // Add number segment
    segs.push(numSeg);
    primary = segs.length - 1;

    // Add suffix as text segment
    if (suffix.length > 0) {
      if (segs.length > 0) seps.push(sep);
      segs.push({ type: "text", value: suffix });
    }

    // Trim trailing empty separator
    if (seps.length >= segs.length) seps.pop();

    return { segments: segs, separators: seps, primaryIdx: primary };
  }

  function segmentsToTemplate(segments, separators) {
    var parts = [];
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      if (seg.type === "text") {
        parts.push(seg.value);
      } else {
        if (seg.step === 1 && !seg.carryAt) {
          parts.push("#");
        } else {
          var n = "{n:" + (seg.step || 1);
          n += ":" + (seg.carryAt != null ? seg.carryAt : "");
          n += ":" + (seg.resetTo != null ? seg.resetTo : "");
          n += "}";
          parts.push(n);
        }
      }
      if (i < separators.length) parts.push(separators[i] || "");
    }
    return parts.join("");
  }

  function buildAutoName(segments, separators) {
    var parts = [];
    for (var i = 0; i < segments.length; i++) {
      parts.push(segments[i].type === "text" ? segments[i].value : String(segments[i].value));
      if (i < separators.length) parts.push(separators[i] || "");
    }
    return parts.join("");
  }

  function getNumberSegIndices(segments) {
    var nums = [];
    for (var i = 0; i < segments.length; i++) {
      if (segments[i].type === "number") nums.push(i);
    }
    return nums;
  }

  function autoNameIncrement(segments, separators, primaryIdx) {
    var numSegs = getNumberSegIndices(segments);
    if (numSegs.length === 0) return;

    var primaryPos = -1;
    for (var j = 0; j < numSegs.length; j++) {
      if (numSegs[j] === primaryIdx) { primaryPos = j; break; }
    }
    if (primaryPos < 0) {
      primaryIdx = numSegs[numSegs.length - 1];
      primaryPos = numSegs.length - 1;
    }

    function processCarry(posInNums) {
      if (posInNums < 0) return;
      var segIdx = numSegs[posInNums];
      var seg = segments[segIdx];
      seg.value += seg.step;
      if (seg.carryAt !== null && seg.carryAt > 0 && seg.value > seg.carryAt) {
        seg.value = seg.resetTo || 0;
        var targetPos;
        if (seg.carryTarget === -1 || seg.carryTarget == null) {
          targetPos = posInNums - 1;
        } else {
          for (var k = 0; k < numSegs.length; k++) {
            if (numSegs[k] === seg.carryTarget) { targetPos = k; break; }
          }
        }
        if (targetPos !== undefined && targetPos >= 0 && targetPos < numSegs.length) {
          var targetSeg = segments[numSegs[targetPos]];
          targetSeg.value += (seg.carryAmount || 1);
          if (targetSeg.carryAt !== null && targetSeg.carryAt > 0 && targetSeg.value > targetSeg.carryAt) {
            processCarry(targetPos);
          }
        }
      }
    }

    processCarry(primaryPos);
  }

  function initAutoNameFromExisting() {
    var segs = state.autoNameSegments;
    var seps = state.autoNameSeparators;
    var prim = state.autoNamePrimaryIdx;
    if (segs.length === 0 || prim < 0) return;
    if (!segs[prim] || segs[prim].type !== "number") return;

    initSegmentsFromExisting(segs, seps, prim);

    // Sync editor if advanced panel is open
    if (!el.autoNameAdvanced.hidden) renderAutoNameAdvanced();
    el.autoNameTemplate.value = segmentsToTemplate(segs, seps);
    updateAutoNamePreview();
    saveAutoNameSettings();
  }

  function generateAutoName() {
    if (!state.autoNameEnabled) return "";
    var segs = state.autoNameSegments;
    var seps = state.autoNameSeparators;
    var prim = state.autoNamePrimaryIdx;
    if (segs.length === 0) return "";

    // Build name first (current value), then increment for next time
    var name = buildAutoName(segs, seps);
    autoNameIncrement(segs, seps, prim);
    saveAutoNameSettings();

    if (!el.autoNameAdvanced.hidden) renderAutoNameAdvanced();
    el.autoNameTemplate.value = segmentsToTemplate(segs, seps);
    updateAutoNamePreview();

    return name;
  }

  function previewNextName() {
    if (!state.autoNameEnabled) return "";
    var segs = state.autoNameSegments;
    var seps = state.autoNameSeparators;
    var prim = state.autoNamePrimaryIdx;
    if (segs.length === 0) return "";

    // Preview shows current value (what next click will generate)
    return buildAutoName(segs, seps);
  }

  function parseBatchCodes(text) {
    return String(text || "")
      .split(/[\n\r\t,，；;]+/)
      .map(function(item) { return item.trim(); })
      .filter(Boolean);
  }

  function normalizeDeviceCode(value) {
    return String(value == null ? "" : value).trim();
  }

  function batchCodeRemaining() {
    return Math.max(0, state.batchCodes.length - state.batchCodeIndex);
  }

  function previewBatchCode() {
    return state.batchCodes[state.batchCodeIndex] || "";
  }

  function batchCodeExists(code) {
    var normalized = normalizeDeviceCode(code);
    if (!normalized) return false;
    return state.annotations.some(function(annotation) {
      return normalizeDeviceCode(annotation.code) === normalized;
    });
  }

  function firstMissingBatchIndex() {
    for (var i = 0; i < state.batchCodes.length; i++) {
      if (!batchCodeExists(state.batchCodes[i])) return i;
    }
    return state.batchCodes.length > 0 ? 0 : -1;
  }

  function setBatchStartIndex(index, activate) {
    if (!state.batchCodes.length) {
      state.batchCodes = parseBatchCodes(el.batchCodeInput.value);
    }
    if (!state.batchCodes.length) {
      updateBatchCodePanel();
      return;
    }
    state.batchCodeIndex = clamp(index, 0, state.batchCodes.length - 1);
    if (activate) {
      state.batchCodeActive = true;
      setTool("point");
    }
    saveData();
    updateBatchCodePanel();
    updateModeHint();
    setStatus("批量点位从 " + state.batchCodes[state.batchCodeIndex] + " 开始。");
  }

  function syncBatchCodesFromInput(options = {}) {
    state.batchCodes = parseBatchCodes(el.batchCodeInput.value);
    if (options.pickFirstMissing) {
      var firstMissing = firstMissingBatchIndex();
      state.batchCodeIndex = firstMissing >= 0 ? firstMissing : 0;
    } else {
      state.batchCodeIndex = clamp(state.batchCodeIndex, 0, Math.max(0, state.batchCodes.length - 1));
    }
    if (!state.batchCodes.length) {
      state.batchCodeIndex = 0;
      state.batchCodeActive = false;
    }
    saveData();
  }

  function updateBatchCodePanel() {
    if (!el.batchCodeInput) return;
    var parsedCount = parseBatchCodes(el.batchCodeInput.value).length;
    var remaining = batchCodeRemaining();
    var stats = typeof requiredCoverageStats === "function" ? requiredCoverageStats() : { total: 0, covered: 0, missing: 0, extra: 0 };
    var coverageText = stats.total > 0 ? "覆盖 " + stats.covered + "/" + stats.total + "，未覆盖 " + stats.missing + "，多余 " + stats.extra + "。" : "";
    el.startBatchCodeButton.textContent = state.batchCodeActive ? "暂停批量" : "开始批量";
    el.startBatchCodeButton.classList.toggle("primary", state.batchCodeActive);
    el.startBatchCodeButton.disabled = !state.batchCodeActive && parsedCount === 0 && remaining === 0;
    if (el.nextRequiredDeviceButton) el.nextRequiredDeviceButton.disabled = stats.total === 0 || stats.missing === 0;
    if (state.batchCodeActive) {
      el.batchCodePreview.innerHTML = remaining > 0
        ? coverageText + " 批量中：下一个 <code>" + escapeHtml(previewBatchCode()) + "</code>，剩余 " + remaining + " 个"
        : coverageText + " 批量编号已用完";
      if (typeof renderRequiredDeviceList === "function") renderRequiredDeviceList();
      return;
    }
    if (remaining > 0) {
      el.batchCodePreview.innerHTML = coverageText + " 已暂停：下一个 <code>" + escapeHtml(previewBatchCode()) + "</code>，剩余 " + remaining + " 个";
      if (typeof renderRequiredDeviceList === "function") renderRequiredDeviceList();
      return;
    }
    el.batchCodePreview.textContent = coverageText || (parsedCount > 0 ? "待开始：" + parsedCount + " 个编号" : "未导入编号");
    if (typeof renderRequiredDeviceList === "function") renderRequiredDeviceList();
  }

  function startOrPauseBatchCodes() {
    if (state.batchCodeActive) {
      state.batchCodeActive = false;
      setStatus("已暂停批量点位。");
      updateBatchCodePanel();
      updateModeHint();
      return;
    }

    if (batchCodeRemaining() === 0 || state.batchCodes.length === 0) {
      syncBatchCodesFromInput({ pickFirstMissing: true });
    }

    if (state.batchCodes.length === 0) {
      setStatus("请先粘贴点位编号。");
      updateBatchCodePanel();
      return;
    }

    state.batchCodeActive = true;
    setTool("point");
    setStatus("已进入批量点位模式，请按顺序点击图纸。");
    updateBatchCodePanel();
  }

  function clearBatchCodes() {
    state.batchCodes = [];
    state.batchCodeIndex = 0;
    state.batchCodeActive = false;
    el.batchCodeInput.value = "";
    if (state.tool === "point") setTool("pan");
    saveData();
    setStatus("批量点位编号已清空。");
    updateBatchCodePanel();
    updateModeHint();
  }

  function consumeBatchCode() {
    if (!state.batchCodeActive) return "";
    var code = previewBatchCode();
    if (!code) {
      state.batchCodeActive = false;
      if (state.tool === "point") setTool("pan");
      updateBatchCodePanel();
      updateModeHint();
      setStatus("批量编号已用完。");
      return "";
    }
    state.batchCodeIndex += 1;
    if (state.batchCodeIndex >= state.batchCodes.length) {
      state.batchCodeActive = false;
      if (state.tool === "point") setTool("pan");
    }
    saveData();
    updateBatchCodePanel();
    updateModeHint();
    return code;
  }

  function nextPointCode() {
    state.lastPointCodeSource = "";
    if (state.batchCodeActive) {
      state.lastPointCodeSource = "batch";
      return consumeBatchCode() || null;
    }
    state.lastPointCodeSource = state.autoNameEnabled ? "auto" : "";
    return generateAutoName();
  }

  function initSegmentsFromExisting(segments, separators, primaryIdx) {
    // Use template pattern (with # placeholders) to extract prefix, not current values
    var template = segmentsToTemplate(segments, separators);
    var prefix = template;
    var lastHash = template.lastIndexOf("#");
    var lastBrace = template.lastIndexOf("{n");
    var numStart = Math.max(lastHash, lastBrace);
    if (numStart >= 0) prefix = template.slice(0, numStart);

    var numSegs = getNumberSegIndices(segments);
    if (numSegs.length === 0 || !prefix) return;

    // Simple case: one number segment only
    if (numSegs.length === 1) {
      var numIdx = numSegs[0];
      var maxNum = -1;

      if (numIdx === segments.length - 1) {
        // Number at end: match prefix (e.g., "3103.21.#")
        for (var i = 0; i < state.annotations.length; i++) {
          var code = state.annotations[i].code || "";
          if (prefix && code.indexOf(prefix) === 0) {
            var suffix = code.slice(prefix.length);
            var num = parseInt(suffix, 10);
            if (!isNaN(num) && num > maxNum) maxNum = num;
          }
        }
      } else if (numIdx === 0 && segments.length > 1) {
        // Number at beginning: match suffix (e.g., "#鍙峰嵏杞界嚎")
        var textSuffix = buildAutoName(segments.slice(1), separators.slice(1));
        for (var j = 0; j < state.annotations.length; j++) {
          var code2 = state.annotations[j].code || "";
          if (textSuffix && code2.slice(-textSuffix.length) === textSuffix) {
            var numStr = code2.slice(0, -textSuffix.length);
            var num2 = parseInt(numStr, 10);
            if (!isNaN(num2) && num2 > maxNum) maxNum = num2;
          }
        }
      }

      if (maxNum >= 0) {
        segments[numIdx].value = maxNum + 1;
      } else {
        segments[numIdx].value = 1;
      }
      for (var k = 0; k < numSegs.length; k++) segments[numSegs[k]]._initDone = true;
      return;
    }

    // Complex case: multiple number segments
    var maxVals = {};
    for (var j = 0; j < numSegs.length; j++) maxVals[numSegs[j]] = -1;

    for (var m = 0; m < state.annotations.length; m++) {
      var annCode = state.annotations[m].code || "";
      if (prefix && annCode.indexOf(prefix) !== 0) continue;
      var codePos = prefix.length;
      for (var n = 0; n < numSegs.length; n++) {
        var segIdx = numSegs[n];
        if (n < numSegs.length - 1 && segIdx < separators.length) {
          var sep = separators[segIdx] || ".";
          var sepPos = annCode.indexOf(sep, codePos);
          if (sep && sepPos >= 0) {
            var numStr = annCode.slice(codePos, sepPos);
            var val = parseInt(numStr, 10);
            if (!isNaN(val) && val > maxVals[segIdx]) maxVals[segIdx] = val;
            codePos = sepPos + sep.length;
          }
        } else {
          var rest = annCode.slice(codePos);
          var val2 = parseInt(rest, 10);
          if (!isNaN(val2) && val2 > maxVals[segIdx]) maxVals[segIdx] = val2;
        }
      }
    }

    for (var p = 0; p < numSegs.length; p++) {
      var idx = numSegs[p];
      if (maxVals[idx] >= 0) {
        segments[idx].value = maxVals[idx] + 1;
      } else {
        segments[idx].value = 1;
      }
      segments[idx]._initDone = true;
    }
  }

  function resetAutoNameInit() {
    for (var i = 0; i < state.autoNameSegments.length; i++) {
      if (state.autoNameSegments[i].type === "number") {
        state.autoNameSegments[i]._initDone = false;
      }
    }
  }

  function saveAutoNameSettings() {
    saveAutoNameLocal();
    scheduleSyncPush();
  }

  function loadAutoNameSettings() {
    var raw = localStorage.getItem(AUTONAME_KEY);
    if (!raw) return;
    try {
      var settings = JSON.parse(raw);
      if (typeof settings.enabled === "boolean") state.autoNameEnabled = settings.enabled;
      if (Array.isArray(settings.segments)) state.autoNameSegments = settings.segments;
      if (Array.isArray(settings.separators)) state.autoNameSeparators = settings.separators;
      if (typeof settings.primaryIdx === "number") state.autoNamePrimaryIdx = settings.primaryIdx;
    } catch (e) {}
  }

  function renderAutoNameAdvanced() {
    var container = el.autoNameAdvanced;
    if (!container) return;
    container.innerHTML = "";
    container.className = "auto-name-advanced";

    // Preview bar
    var previewBar = document.createElement("div");
    previewBar.style.cssText = "padding:6px 10px;margin-bottom:8px;border-radius:6px;background:#e8f5f3;font-size:13px;text-align:center;";
    previewBar.innerHTML = '<span style="color:var(--muted);">下一次点击将生成：</span> <strong style="font-family:monospace;font-size:15px;color:var(--accent);">' + previewNextName() + '</strong>';
    container.appendChild(previewBar);

    var segs = state.autoNameSegments;
    var seps = state.autoNameSeparators;
    var prim = state.autoNamePrimaryIdx;
    var numSegs = getNumberSegIndices(segs);

    var row = document.createElement("div");
    row.className = "auto-name-segments";

    function makeBlock(i, seg) {
      var block = document.createElement("div");
      block.className = "auto-name-seg";
      if (seg.type === "number") { block.classList.add("num"); if (i === prim) block.classList.add("primary"); }

      var badge = document.createElement("div");
      badge.className = "auto-name-seg-badge" + (seg.type === "text" ? " text-badge" : "");
      badge.textContent = seg.type === "text" ? "文本" : (i === prim ? "递增" : "数字");
      block.appendChild(badge);

      var valInput = document.createElement("input");
      valInput.className = "auto-name-seg-val";
      valInput.value = seg.value;
      valInput.addEventListener("input", (function(idx) {
        return function() {
          var v = this.value;
          if (segs[idx].type === "number") { v = parseInt(v, 10); if (!isNaN(v)) { segs[idx].value = v; segs[idx]._initDone = true; } }
          else { segs[idx].value = v; }
          updateAutoNamePreview();
          clearTimeout(valInput._saveTimer);
          valInput._saveTimer = setTimeout(function() { saveAutoNameSettings(); }, 400);
        };
      })(i));
      valInput.addEventListener("change", (function(idx) {
        return function() {
          var v = this.value;
          if (segs[idx].type === "number") { v = parseInt(v, 10); if (!isNaN(v)) { segs[idx].value = v; segs[idx]._initDone = true; } this.value = segs[idx].value; }
          else { segs[idx].value = v; }
          syncTemplateFromSegments(); saveAutoNameSettings();
          updateAutoNamePreview();
        };
      })(i));
      block.appendChild(valInput);

      var typeRow = document.createElement("div");
      typeRow.className = "auto-name-seg-type";
      var tBtn = document.createElement("button"); tBtn.textContent = "T"; tBtn.title = "文本";
      tBtn.classList.toggle("active", seg.type === "text");
      tBtn.addEventListener("click", (function(idx) { return function() {
        if (segs[idx].type === "text") return;
        segs[idx] = { type: "text", value: String(segs[idx].value) };
        fixPrimary(); syncTemplateFromSegments(); saveAutoNameSettings(); renderAutoNameAdvanced();
      }; })(i));
      var nBtn = document.createElement("button"); nBtn.textContent = "N"; nBtn.title = "数字";
      nBtn.classList.toggle("active", seg.type === "number");
      nBtn.addEventListener("click", (function(idx) { return function() {
        if (segs[idx].type === "number") return;
        var parsed = parseInt(segs[idx].value, 10);
        segs[idx] = { type: "number", value: isNaN(parsed) ? 0 : parsed, step: 1, carryAt: null, carryTarget: -1, carryAmount: 1, resetTo: 0 };
        if (state.autoNamePrimaryIdx < 0) state.autoNamePrimaryIdx = idx;
        fixPrimary(); syncTemplateFromSegments(); saveAutoNameSettings(); renderAutoNameAdvanced();
      }; })(i));
      typeRow.appendChild(tBtn); typeRow.appendChild(nBtn);
      block.appendChild(typeRow);

      if (seg.type === "number") {
        var setDiv = document.createElement("div"); setDiv.className = "auto-name-seg-settings";
        function addSet(label, key, min) {
          var lbl = document.createElement("label"); lbl.textContent = label;
          var inp = document.createElement("input"); inp.type = "number"; if (min != null) inp.min = String(min);
          inp.value = seg[key] != null ? seg[key] : "";
          inp.addEventListener("change", (function(idx, k) { return function() {
            var v = parseInt(this.value, 10); segs[idx][k] = isNaN(v) ? null : v;
            syncTemplateFromSegments(); saveAutoNameSettings();
            updateAutoNamePreview();
          }; })(i, key));
          lbl.appendChild(inp); setDiv.appendChild(lbl);
        }
        addSet("姝ラ暱", "step", 1);

        // repaired invalid text literal
        (function() {
          var lbl = document.createElement("label"); lbl.style.whiteSpace = "nowrap";
          lbl.appendChild(document.createTextNode(""));
          var inpAt = document.createElement("input"); inpAt.type = "number"; inpAt.min = "0";
          inpAt.value = seg.carryAt != null ? seg.carryAt : "";
          inpAt.style.width = "38px";
          inpAt.addEventListener("change", (function(idx) { return function() {
            var v = parseInt(this.value, 10); segs[idx].carryAt = isNaN(v) ? null : v;
            syncTemplateFromSegments(); saveAutoNameSettings(); updateAutoNamePreview();
          }; })(i));
          lbl.appendChild(inpAt);
          lbl.appendChild(document.createTextNode(""));
          var inpAmt = document.createElement("input"); inpAmt.type = "number"; inpAmt.min = "1";
          inpAmt.value = seg.carryAmount || 1;
          inpAmt.style.width = "38px";
          inpAmt.addEventListener("change", (function(idx) { return function() {
            var v = parseInt(this.value, 10); segs[idx].carryAmount = isNaN(v) || v < 1 ? 1 : v;
            syncTemplateFromSegments(); saveAutoNameSettings(); updateAutoNamePreview();
          }; })(i));
          lbl.appendChild(inpAmt);
          lbl.appendChild(document.createTextNode(""));
          setDiv.appendChild(lbl);
        })();

        // Combined row: initial value + primary increment
        (function() {
          var lbl = document.createElement("label"); lbl.style.whiteSpace = "nowrap";
          lbl.appendChild(document.createTextNode(""));
          var inpReset = document.createElement("input"); inpReset.type = "number"; inpReset.min = "0";
          inpReset.value = seg.resetTo != null ? seg.resetTo : 0;
          inpReset.style.width = "38px";
          inpReset.addEventListener("change", (function(idx) { return function() {
            var v = parseInt(this.value, 10); segs[idx].resetTo = isNaN(v) ? 0 : v;
            syncTemplateFromSegments(); saveAutoNameSettings(); updateAutoNamePreview();
          }; })(i));
          lbl.appendChild(inpReset);
          var primCheck = document.createElement("input"); primCheck.type = "checkbox";
          primCheck.checked = (i === prim); primCheck.style.marginLeft = "6px";
          primCheck.addEventListener("change", (function(idx) { return function() {
            if (this.checked) state.autoNamePrimaryIdx = idx;
            syncTemplateFromSegments(); saveAutoNameSettings(); renderAutoNameAdvanced();
            updateAutoNamePreview();
          }; })(i));
          lbl.appendChild(primCheck);
          lbl.appendChild(document.createTextNode(""));
          setDiv.appendChild(lbl);
        })();

        block.appendChild(setDiv);
      }

      var delBtn = document.createElement("button"); delBtn.className = "auto-name-seg-del"; delBtn.textContent = "x";
      delBtn.addEventListener("click", (function(idx) { return function() {
        if (segs.length <= 1) return;
        segs.splice(idx, 1);
        if (idx < seps.length) seps.splice(idx, 1); else seps.pop();
        fixPrimary(); syncTemplateFromSegments(); saveAutoNameSettings(); renderAutoNameAdvanced();
      }; })(i));
      block.appendChild(delBtn);
      return block;
    }

    function fixPrimary() {
      var nums = getNumberSegIndices(segs);
      if (nums.length === 0) { state.autoNamePrimaryIdx = -1; return; }
      var found = false;
      for (var j = 0; j < nums.length; j++) { if (nums[j] === state.autoNamePrimaryIdx) { found = true; break; } }
      if (!found) state.autoNamePrimaryIdx = nums[nums.length - 1];
    }

    for (var i = 0; i < segs.length; i++) {
      row.appendChild(makeBlock(i, segs[i]));
      if (i < segs.length - 1) {
        var sepWrap = document.createElement("div"); sepWrap.className = "auto-name-sep";
        var sepInput = document.createElement("input"); sepInput.value = seps[i] || ""; sepInput.placeholder = "分隔";
        sepInput.addEventListener("change", (function(idx) { return function() {
          seps[idx] = this.value; syncTemplateFromSegments(); saveAutoNameSettings();
        }; })(i));
        sepWrap.appendChild(sepInput); row.appendChild(sepWrap);
      }
    }
    container.appendChild(row);

    var addBtn = "";
    addBtn.addEventListener("click", function() {
      segs.push({ type: "text", value: "new" }); seps.push(".");
      fixPrimary(); syncTemplateFromSegments(); saveAutoNameSettings(); renderAutoNameAdvanced();
    });
    container.appendChild(addBtn);
  }

  function updateAutoNamePreview() {
    // Update advanced editor bar
    var bar = el.autoNameAdvanced.querySelector("div");
    if (bar) {
      var next = previewNextName();
      bar.innerHTML = "";
    }

    // Update 5-name preview below template input
    if (!el.autoNamePreview || !state.autoNameEnabled) return;
    var segs = state.autoNameSegments;
    var seps = state.autoNameSeparators;
    var prim = state.autoNamePrimaryIdx;
    if (segs.length === 0) { el.autoNamePreview.innerHTML = ""; return; }

    // Clone and produce next 5 names
    var cloned = [];
    for (var i = 0; i < segs.length; i++) {
      cloned.push(Object.assign({}, segs[i]));
    }
    var clonedSeps = seps.slice();

    var names = [];
    for (var n = 0; n < 5; n++) {
      names.push(buildAutoName(cloned, clonedSeps));
      autoNameIncrement(cloned, clonedSeps, prim);
    }

    el.autoNamePreview.innerHTML = '<span style="color:var(--muted);">即将生成：</span> ' +
      names.map(function(n) { return '<code>' + n + '</code>'; }).join(' &rarr; ');
  }

  function syncTemplateFromSegments() {
    el.autoNameTemplate.value = segmentsToTemplate(state.autoNameSegments, state.autoNameSeparators);
    updateAutoNamePreview();
  }

  function applyTemplateChange() {
    var template = el.autoNameTemplate.value.trim();
    if (!template) return;
    var parsed = parseTemplateToSegments(template);
    state.autoNameSegments = parsed.segments;
    state.autoNameSeparators = parsed.separators;
    state.autoNamePrimaryIdx = parsed.primaryIdx;
    resetAutoNameInit();
    initAutoNameFromExisting();
    saveAutoNameSettings();
    updateAutoNamePreview();
    if (!el.autoNameAdvanced.hidden) renderAutoNameAdvanced();
  }

  function toPointAnnotation(annotation) {
    if (!annotation || !annotation.id || !annotation.drawingId || !Array.isArray(annotation.points)) {
      return null;
    }

    const validPoints = annotation.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (validPoints.length === 0) return null;

    const bounds = pointsBounds(validPoints);
    return {
      ...annotation,
      type: "point",
      special: false,
      groupId: state.groups.some((group) => group.id === annotation.groupId) ? annotation.groupId : "",
      points: [{
        x: clamp((bounds.minX + bounds.maxX) / 2, 0, 1),
        y: clamp((bounds.minY + bounds.maxY) / 2, 0, 1)
      }]
    };
  }

  function toGroup(group) {
    if (!group || !group.id || !String(group.name || "").trim()) return null;
    return {
      id: String(group.id),
      name: String(group.name).trim(),
      createdAt: group.createdAt || new Date().toISOString()
    };
  }

  function pointsBounds(points) {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys)
    };
  }

  function expandBounds(bounds, padding) {
    return {
      minX: clamp(bounds.minX - padding, 0, state.imageSize.width),
      minY: clamp(bounds.minY - padding, 0, state.imageSize.height),
      maxX: clamp(bounds.maxX + padding, 0, state.imageSize.width),
      maxY: clamp(bounds.maxY + padding, 0, state.imageSize.height)
    };
  }

  function currentAnnotationsBounds() {
    const allPoints = currentAnnotations().map(annotationCenter);
    if (allPoints.length === 0) return null;

    const bounds = pointsBounds(allPoints);
    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);
    return expandBounds(bounds, Math.max(width, height, 120) * 0.12);
  }

  function minimapLayout(bodyRect) {
    const bounds = currentAnnotationsBounds();
    if (!bounds) return null;

    const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
    const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);
    const margin = 12;
    const scale = Math.min(
      (bodyRect.width - margin * 2) / boundsWidth,
      (bodyRect.height - margin * 2) / boundsHeight
    );
    const mapWidth = boundsWidth * scale;
    const mapHeight = boundsHeight * scale;

    return {
      bounds,
      scale,
      offsetX: (bodyRect.width - mapWidth) / 2,
      offsetY: (bodyRect.height - mapHeight) / 2
    };
  }

  function mapPointToMinimap(point, layout) {
    return {
      x: layout.offsetX + (point.x - layout.bounds.minX) * layout.scale,
      y: layout.offsetY + (point.y - layout.bounds.minY) * layout.scale
    };
  }

  function annotationCenter(annotation) {
    const points = annotation.points.map(denormalize);
    const bounds = pointsBounds(points);
    return {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2
    };
  }

  function annotationBounds(annotation) {
    return pointsBounds(annotation.points.map(denormalize));
  }

  function annotationTitle(annotation) {
    return annotation.code || annotation.note || "未命名";
  }

  function isCompactViewport() {
    return window.matchMedia("(max-width: 900px)").matches;
  }

  function applyTransform(options = {}) {
    const { x, y, scale } = state.transform;
    el.stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    if (options.renderMinimap !== false) renderMinimap();
  }

  function fitToViewport() {
    const rect = el.viewport.getBoundingClientRect();
    const scale = Math.min(
      rect.width / state.imageSize.width,
      rect.height / state.imageSize.height
    ) * 0.94;
    state.transform.scale = clamp(scale, 0.08, 8);
    state.transform.x = (rect.width - state.imageSize.width * state.transform.scale) / 2;
    state.transform.y = (rect.height - state.imageSize.height * state.transform.scale) / 2;
    applyTransform();
  }

  function screenToImage(clientX, clientY) {
    const rect = el.viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - state.transform.x) / state.transform.scale,
      y: (clientY - rect.top - state.transform.y) / state.transform.scale
    };
  }

  function imageToScreen(point) {
    const rect = el.viewport.getBoundingClientRect();
    return {
      x: rect.left + state.transform.x + point.x * state.transform.scale,
      y: rect.top + state.transform.y + point.y * state.transform.scale
    };
  }

  function setTool(tool) {
    state.tool = tool;
    state.draft = null;
    el.viewport.classList.toggle("drawing", tool !== "pan");
    document.querySelectorAll(".tool-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.tool === tool);
    });
    updateModeHint();
    renderOverlay();
  }

  function updateModeHint() {
    if (state.batchCodeActive && state.tool === "point") {
      var nextCode = previewBatchCode();
      el.modeHint.textContent = nextCode
        ? "设备轮询中：下一点 " + nextCode + "，剩余 " + batchCodeRemaining() + " 个。"
        : "设备清单已轮询完成。";
      return;
    }
    el.modeHint.textContent = {
      pan: "拖动画布浏览，滚轮缩放。1切换拖动，2切换点标注，F适配。",
      point: "点击画布添加点标注。Esc取消选择，Delete删除选中。"
    }[state.tool];
  }

  function ensureDrawingTotalCount() {
    if (el.drawingTotalCount) return el.drawingTotalCount;
    var title = el.drawingList && el.drawingList.previousElementSibling;
    if (!title) return null;
    title.classList.add("drawing-section-title");
    var total = document.createElement("small");
    total.id = "drawingTotalCount";
    title.appendChild(total);
    el.drawingTotalCount = total;
    return total;
  }

  function reorderDrawing(sourceId, targetId, insertAfter) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    var sourceIndex = drawings.findIndex(function(drawing) { return drawing.id === sourceId; });
    if (sourceIndex === -1) return;
    var moved = drawings.splice(sourceIndex, 1)[0];
    var targetIndex = drawings.findIndex(function(drawing) { return drawing.id === targetId; });
    if (targetIndex === -1) {
      drawings.splice(sourceIndex, 0, moved);
      return;
    }
    drawings.splice(targetIndex + (insertAfter ? 1 : 0), 0, moved);
    customDrawingOrder = drawings.map(function(drawing) { return drawing.id; });
    saveData();
    renderDrawingList();
    setStatus("图纸顺序已调整。");
  }

  function clearDrawingDropHints() {
    if (!el.drawingList) return;
    el.drawingList.querySelectorAll(".dragging, .drop-before, .drop-after").forEach((item) => {
      item.classList.remove("dragging", "drop-before", "drop-after");
    });
  }

  function updateDrawingDropTarget(clientX, clientY) {
    clearDrawingDropHints();
    if (!drawingPointerDrag) return;
    drawingPointerDrag.sourceButton.classList.add("dragging");
    var target = document.elementFromPoint(clientX, clientY);
    var item = target && target.closest ? target.closest(".drawing-item") : null;
    if (!item || !el.drawingList.contains(item) || item.dataset.id === drawingPointerDrag.id) {
      drawingPointerDrag.targetId = "";
      return;
    }
    var rect = item.getBoundingClientRect();
    drawingPointerDrag.targetId = item.dataset.id;
    drawingPointerDrag.insertAfter = clientY > rect.top + rect.height / 2;
    item.classList.toggle("drop-before", !drawingPointerDrag.insertAfter);
    item.classList.toggle("drop-after", drawingPointerDrag.insertAfter);
  }

  function beginDrawingPointerDrag(event, drawingId, button) {
    if (event.button !== 0) return;
    if (drawingPointerDrag) return;
    var moveEventName = event.type === "mousedown" ? "mousemove" : "pointermove";
    var upEventName = event.type === "mousedown" ? "mouseup" : "pointerup";
    drawingPointerDrag = {
      id: drawingId,
      sourceButton: button,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      targetId: "",
      insertAfter: false
    };

    function onMove(moveEvent) {
      if (!drawingPointerDrag) return;
      var dx = moveEvent.clientX - drawingPointerDrag.startX;
      var dy = moveEvent.clientY - drawingPointerDrag.startY;
      if (!drawingPointerDrag.active && Math.hypot(dx, dy) < 6) return;
      drawingPointerDrag.active = true;
      moveEvent.preventDefault();
      updateDrawingDropTarget(moveEvent.clientX, moveEvent.clientY);
    }

    function onUp(upEvent) {
      window.removeEventListener(moveEventName, onMove);
      window.removeEventListener(upEventName, onUp);
      var drag = drawingPointerDrag;
      drawingPointerDrag = null;
      clearDrawingDropHints();
      if (!drag || !drag.active) return;
      upEvent.preventDefault();
      suppressDrawingClick = true;
      window.setTimeout(function() { suppressDrawingClick = false; }, 0);
      reorderDrawing(drag.id, drag.targetId, drag.insertAfter);
    }

    window.addEventListener(moveEventName, onMove);
    window.addEventListener(upEventName, onUp);
  }

  function renderDrawingList() {
    el.drawingList.innerHTML = "";
    let totalVisibleCount = 0;
    for (const drawing of drawings) {
      const count = drawingAnnotationCount(drawing.id);
      const prefixCount = state.renderPrefix ? drawingPrefixAnnotationCount(drawing.id, state.renderPrefix) : 0;
      totalVisibleCount += state.renderPrefix ? prefixCount : count;
      const countLabel = state.renderPrefix
        ? `${prefixCount} 个标注`
        : `${count} 个标注`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "drawing-item";
      button.dataset.id = drawing.id;
      button.innerHTML = `${escapeHtml(drawing.title)}<small>${countLabel}</small>`;
      button.classList.toggle("active", drawing.id === state.currentDrawingId);
      button.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/plain", drawing.id);
        event.dataTransfer.effectAllowed = "move";
        button.classList.add("dragging");
      });
      button.addEventListener("dragend", () => {
        button.classList.remove("dragging");
        el.drawingList.querySelectorAll(".drop-before, .drop-after").forEach((item) => {
          item.classList.remove("drop-before", "drop-after");
        });
      });
      button.addEventListener("dragover", (event) => {
        event.preventDefault();
        var rect = button.getBoundingClientRect();
        var insertAfter = event.clientY > rect.top + rect.height / 2;
        event.dataTransfer.dropEffect = "move";
        button.classList.toggle("drop-before", !insertAfter);
        button.classList.toggle("drop-after", insertAfter);
      });
      button.addEventListener("dragleave", () => {
        button.classList.remove("drop-before", "drop-after");
      });
      button.addEventListener("drop", (event) => {
        event.preventDefault();
        button.classList.remove("drop-before", "drop-after");
        var sourceId = event.dataTransfer.getData("text/plain");
        var rect = button.getBoundingClientRect();
        reorderDrawing(sourceId, drawing.id, event.clientY > rect.top + rect.height / 2);
      });
      button.addEventListener("pointerdown", (event) => beginDrawingPointerDrag(event, drawing.id, button));
      button.addEventListener("mousedown", (event) => beginDrawingPointerDrag(event, drawing.id, button));
      button.addEventListener("click", (event) => {
        if (suppressDrawingClick) {
          event.preventDefault();
          return;
        }
        switchDrawing(drawing.id);
      });
      el.drawingList.appendChild(button);
    }
    const total = ensureDrawingTotalCount();
    if (total) total.textContent = `总计 ${totalVisibleCount} 个`;
  }

  function switchDrawing(drawingId, options = {}) {
    if (!drawings.some((drawing) => drawing.id === drawingId)) drawingId = drawings[0]?.id || "";
    var changedDrawing = state.currentDrawingId !== drawingId;
    var previousActiveGroup = state.groups.find(function(group) {
      return group.id === state.activeGroupId;
    }) || null;
    state.currentDrawingId = drawingId;
    state.selectedId = options.selectedId || null;
    state.highlightedId = options.highlightedId || null;
    if (!options.selectedId && !options.highlightedId) state.renderPrefix = "";
    if (changedDrawing) {
      syncAutoGroupsForDrawing(drawingId);
      collapseGroupsInDrawing(drawingId);
      var matchingGroup = !options.selectedId && !options.highlightedId
        ? matchingAutoGroupInDrawing(previousActiveGroup, drawingId)
        : null;
      if (matchingGroup) {
        state.activeGroupId = matchingGroup.id;
        state.renderPrefix = matchingGroup.autoKey || "";
      } else {
        state.activeGroupId = "";
      }
    } else if (!groupVisibleInDrawing(state.activeGroupId, drawingId)) {
      state.activeGroupId = "";
    }
    const drawing = currentDrawing();
    if (!drawing) return;
    var prevSrc = el.image.getAttribute("src") || "";
    var srcChanged = prevSrc !== drawing.image;
    if (srcChanged) {
      el.currentDrawingTitle.textContent = drawing.title + " 加载中...";
      el.viewport.classList.add("loading");
      clearTimeout(el.image._loadTimeout);
      el.image._loadTimeout = setTimeout(function() {
        if (el.viewport.classList.contains("loading")) {
          el.currentDrawingTitle.textContent = drawing.title + " 加载较慢，请稍候...";
        }
      }, 10000);
    } else {
      el.currentDrawingTitle.textContent = drawing.title;
    }
    el.image.src = drawing.image;
    el.minimapImage.src = drawing.image;
    // Fallback: poll image.complete in case load event doesn't fire (mobile Safari)
    if (srcChanged) {
      var pollCount = 0;
      var pollTimer = setInterval(function() {
        pollCount++;
        if (el.image.complete && el.image.naturalWidth > 0) {
          clearInterval(pollTimer);
          if (el.viewport.classList.contains("loading")) {
            el.image.dispatchEvent(new Event("load"));
          }
        } else if (pollCount > 60) {
          clearInterval(pollTimer);
        }
      }, 500);
    }
    renderDrawingList();
    renderMinimapList();
    updateEditor();
    if (changedDrawing && options.save !== false) saveData();
    saveCurrentDrawingLocal();
  }

  function renderOverlay(options = {}) {
    el.overlay.innerHTML = "";
    el.overlay.setAttribute("width", state.imageSize.width);
    el.overlay.setAttribute("height", state.imageSize.height);
    el.overlay.setAttribute("viewBox", `0 0 ${state.imageSize.width} ${state.imageSize.height}`);

    const visibleIds = new Set();
    const compactFocusId = isCompactViewport() && state.highlightedId ? state.highlightedId : null;
    if (state.annotationsVisible && !compactFocusId) {
      for (const annotation of currentAnnotations()) visibleIds.add(annotation.id);
    }
    if (state.highlightedId) visibleIds.add(state.highlightedId);
    if (state.selectedId) visibleIds.add(state.selectedId);

    for (const annotation of currentAnnotations()) {
      if (!visibleIds.has(annotation.id)) continue;
      drawAnnotation(annotation);
    }

    const visibleCount = currentAnnotations().length;
    const totalCount = currentDrawingAnnotations().length;
    el.annotationCount.textContent = state.renderPrefix
      ? `${state.renderPrefix} ${visibleCount}/${totalCount} 个标注`
      : `${visibleCount}/${totalCount} 个标注`;
    if (options.renderMinimap !== false) renderMinimap();
  }

  function renderOverlayOnly() {
    renderOverlay({ renderMinimap: false });
  }

  function renderMinimap(options = {}) {
    if (!state.imageSize.width || !el.minimapBody) return;
    const annotations = currentAnnotations();
    const totalAnnotations = currentDrawingAnnotations();
    if (el.minimapCount) {
      el.minimapCount.textContent = state.renderPrefix
        ? `${state.renderPrefix} ${annotations.length}/${totalAnnotations.length} 个点位`
        : `${annotations.length}/${totalAnnotations.length} 个点位`;
    }

    el.minimap.classList.toggle("empty", annotations.length === 0);
    el.minimapOverlay.innerHTML = "";
    if (options.renderList !== false) renderMinimapList();
    return;

    const bodyRect = el.minimapBody.getBoundingClientRect();
    if (!bodyRect.width || !bodyRect.height) {
      if (options.renderList !== false) renderMinimapList();
      return;
    }

    const layout = minimapLayout(bodyRect);
    el.minimapImage.style.display = "none";
    el.minimapOverlay.setAttribute("width", bodyRect.width);
    el.minimapOverlay.setAttribute("height", bodyRect.height);
    el.minimapOverlay.setAttribute("viewBox", `0 0 ${bodyRect.width} ${bodyRect.height}`);
    el.minimapOverlay.innerHTML = "";

    if (!layout) {
      if (options.renderList !== false) renderMinimapList();
      return;
    }

    const boundsRect = document.createElementNS(SVG_NS, "rect");
    boundsRect.setAttribute("x", layout.offsetX);
    boundsRect.setAttribute("y", layout.offsetY);
    boundsRect.setAttribute("width", (layout.bounds.maxX - layout.bounds.minX) * layout.scale);
    boundsRect.setAttribute("height", (layout.bounds.maxY - layout.bounds.minY) * layout.scale);
    boundsRect.setAttribute("fill", "#ffffff");
    boundsRect.setAttribute("stroke", "rgba(101, 115, 129, 0.45)");
    boundsRect.setAttribute("stroke-width", "1");
    el.minimapOverlay.appendChild(boundsRect);

    for (const annotation of currentAnnotations()) {
      const center = mapPointToMinimap(annotationCenter(annotation), layout);
      const shape = document.createElementNS(SVG_NS, "circle");
      const isActive = annotation.id === state.selectedId || annotation.id === state.highlightedId;

      shape.setAttribute("cx", center.x);
      shape.setAttribute("cy", center.y);
      shape.setAttribute("r", isActive ? "4" : "3");
      shape.setAttribute("fill", isActive ? "#f59e0b" : "#0f766e");
      shape.setAttribute("stroke", "#ffffff");
      shape.setAttribute("stroke-width", isActive ? "1.5" : "1");
      shape.setAttribute("vector-effect", "non-scaling-stroke");
      shape.style.cursor = "pointer";
      shape.addEventListener("click", (event) => {
        event.stopPropagation();
        focusAnnotationFromOverview(annotation.id);
      });
      el.minimapOverlay.appendChild(shape);

      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", center.x + 5);
      label.setAttribute("y", center.y - 5);
      label.setAttribute("fill", isActive ? "#92400e" : "#0b3835");
      label.setAttribute("paint-order", "stroke");
      label.setAttribute("stroke", "#fff");
      label.setAttribute("stroke-width", "3");
      label.setAttribute("font-size", "11");
      label.setAttribute("font-weight", "700");
      label.style.cursor = "pointer";
      label.textContent = annotationTitle(annotation);
      label.addEventListener("click", (event) => {
        event.stopPropagation();
        focusAnnotationFromOverview(annotation.id);
      });
      el.minimapOverlay.appendChild(label);
    }

    const viewportRect = el.viewport.getBoundingClientRect();
    const imageLeft = clamp(-state.transform.x / state.transform.scale, layout.bounds.minX, layout.bounds.maxX);
    const imageTop = clamp(-state.transform.y / state.transform.scale, layout.bounds.minY, layout.bounds.maxY);
    const imageRight = clamp((viewportRect.width - state.transform.x) / state.transform.scale, layout.bounds.minX, layout.bounds.maxX);
    const imageBottom = clamp((viewportRect.height - state.transform.y) / state.transform.scale, layout.bounds.minY, layout.bounds.maxY);
    const topLeft = mapPointToMinimap({ x: imageLeft, y: imageTop }, layout);
    const bottomRight = mapPointToMinimap({ x: imageRight, y: imageBottom }, layout);

    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", topLeft.x);
    rect.setAttribute("y", topLeft.y);
    rect.setAttribute("width", Math.max(8, bottomRight.x - topLeft.x));
    rect.setAttribute("height", Math.max(8, bottomRight.y - topLeft.y));
    rect.setAttribute("fill", "rgba(245, 158, 11, 0.18)");
    rect.setAttribute("stroke", "#f59e0b");
    rect.setAttribute("stroke-width", "2");
    el.minimapOverlay.appendChild(rect);
    if (options.renderList !== false) renderMinimapList();
  }

  function renderMinimapList() {
    if (!el.minimapList) return;
    if (syncAutoGroupsForAllDrawings()) saveData();
    const annotations = currentDrawingAnnotations();
    el.minimapList.innerHTML = "";

    var usedGroupIds = new Set();
    var currentDrawingId = state.currentDrawingId;
    var visibleGroups = state.groups.filter(function(group) {
      return group.drawingId === currentDrawingId;
    });

    // Bucket annotations by groups that belong to the current drawing. Legacy groups
    // without drawingId are shown only when a current annotation uses them.
    var groupBuckets = new Map();
    groupBuckets.set("", []);
    for (var i = 0; i < annotations.length; i++) {
      var gid = annotations[i].groupId || "";
      if (gid && !state.groups.some(function(g) { return g.id === gid; })) gid = "";
      if (gid) usedGroupIds.add(gid);
      if (groupBuckets.has(gid)) groupBuckets.get(gid).push(annotations[i]);
      else groupBuckets.set(gid, [annotations[i]]);
    }
    for (var i = 0; i < state.groups.length; i++) {
      var group = state.groups[i];
      if (!visibleGroups.some(function(item) { return item.id === group.id; }) && usedGroupIds.has(group.id)) {
        visibleGroups.push(group);
      }
    }
    for (var i = 0; i < visibleGroups.length; i++) {
      if (!groupBuckets.has(visibleGroups[i].id)) groupBuckets.set(visibleGroups[i].id, []);
    }

    if (annotations.length === 0 && state.groups.length === 0) {
      const empty = document.createElement("div");
      empty.className = "minimap-empty";
      empty.textContent = "暂无标注";
      el.minimapList.appendChild(empty);
      return;
    }

    // Sort annotations by dot-separated numeric segments (e.g. 3102.23.10)
    function naturalCompare(a, b) {
      var codeA = (a.code || "").toString();
      var codeB = (b.code || "").toString();
      var segsA = codeA.split(".");
      var segsB = codeB.split(".");
      var maxLen = Math.max(segsA.length, segsB.length);
      for (var i = 0; i < maxLen; i++) {
        var segA = i < segsA.length ? parseInt(segsA[i], 10) : -1;
        var segB = i < segsB.length ? parseInt(segsB[i], 10) : -1;
        if (isNaN(segA) && isNaN(segB)) {
          var cmp = segsA[i].localeCompare(segsB[i]);
          if (cmp !== 0) return cmp;
          continue;
        }
        if (isNaN(segA)) return 1;
        if (isNaN(segB)) return -1;
        if (segA !== segB) return segA - segB;
      }
      return 0;
    }
    for (var _buckets of groupBuckets) {
      _buckets[1].sort(naturalCompare);
    }

    let runningIndex = 0;
    const visibleAnnotationIds = [];
    function applyGroupMoveSelection(annotationId, checked, isRangeSelection) {
      const anchorIndex = visibleAnnotationIds.indexOf(state.groupMoveSelectionAnchorId);
      const targetIndex = visibleAnnotationIds.indexOf(annotationId);
      if (isRangeSelection && anchorIndex !== -1 && targetIndex !== -1) {
        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);
        for (let i = start; i <= end; i++) {
          if (checked) {
            state.selectedForGroupMove.add(visibleAnnotationIds[i]);
          } else {
            state.selectedForGroupMove.delete(visibleAnnotationIds[i]);
          }
        }
      } else if (checked) {
        state.selectedForGroupMove.add(annotationId);
      } else {
        state.selectedForGroupMove.delete(annotationId);
      }
      state.groupMoveSelectionAnchorId = annotationId;
      renderMinimapList();
    }

    for (const [groupId, groupedAnnotations] of groupBuckets) {
      const groupMeta = state.groups.find((group) => group.id === groupId);
      const isAutoGroup = Boolean(groupMeta && groupMeta.isAuto);
      if (groupedAnnotations.length === 0 && groupId !== "") {
        const section = document.createElement("section");
        section.className = "minimap-group";
        const heading = document.createElement("div");
        heading.className = "minimap-group-title";
        heading.classList.toggle("auto-group", isAutoGroup);
        heading.dataset.groupId = groupId;
        const groupInput = document.createElement("input");
        groupInput.type = "text";
        groupInput.className = "minimap-group-name";
        groupInput.value = groupTitle(groupId);
        groupInput.readOnly = true;
        groupInput.placeholder = isAutoGroup ? groupMeta.autoKey : "";
        groupInput.setAttribute("aria-label", isAutoGroup ? "默认分组别名" : "分组名称");
        groupInput.addEventListener("pointerdown", function(ev) {
          if (groupInput.readOnly) return;
          ev.stopPropagation();
        });
        groupInput.addEventListener("click", function(ev) {
          if (!groupInput.readOnly) ev.stopPropagation();
        });
        groupInput.addEventListener("dblclick", function(ev) { ev.stopPropagation(); enableGroupRename(groupInput); });
        groupInput.addEventListener("change", function() {
          finishGroupRename(groupId, groupInput);
        });
        groupInput.addEventListener("blur", function() {
          finishGroupRename(groupId, groupInput);
        });
        groupInput.addEventListener("keydown", function(ev) {
          if (ev.key === "Enter") { ev.preventDefault(); groupInput.blur(); }
          if (ev.key === "Escape") {
            ev.preventDefault();
            groupInput.value = groupTitle(groupId);
            groupInput.readOnly = true;
            groupInput.classList.remove("editing");
            groupInput.blur();
          }
        });
        const spacer = document.createElement("span");
        spacer.className = "minimap-group-spacer";
        spacer.setAttribute("aria-hidden", "true");
        heading.appendChild(spacer);
        heading.appendChild(groupInput);
        const count = document.createElement("small");
        count.textContent = groupSubtitle(groupMeta, 0);
        heading.appendChild(count);
        if (isAutoGroup && hasGroupAlias(groupMeta)) {
          const badge = document.createElement("span");
          badge.className = "minimap-group-badge";
          badge.textContent = groupMeta.autoKey;
          heading.appendChild(badge);
        }

        heading.addEventListener("pointerdown", (event) => event.stopPropagation());
        heading.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          showGroupContextMenu(event, groupId, groupInput);
        });
        heading.addEventListener("click", (event) => {
          event.stopPropagation();
          if (state.selectedForGroupMove.size > 0) {
            moveSelectedAnnotationsToGroup(groupId);
            return;
          }
          state.activeGroupId = groupId;
          state.renderPrefix = groupMeta && groupMeta.autoKey ? groupMeta.autoKey : "";
          renderDrawingList();
          renderOverlay();
          renderMinimapList();
          setStatus("当前分组：" + groupTitle(groupId));
        });
        heading.addEventListener("dragover", (event) => {
          event.preventDefault();
          heading.classList.add("drop-target");
        });
        heading.addEventListener("dragleave", () => heading.classList.remove("drop-target"));
        heading.addEventListener("drop", (event) => {
          event.preventDefault();
          event.stopPropagation();
          heading.classList.remove("drop-target");
          const annotationId = event.dataTransfer.getData("text/plain");
          moveDraggedAnnotationsToGroup(annotationId, groupId);
        });
        section.appendChild(heading);
        el.minimapList.appendChild(section);
        continue;
      }
      if (groupedAnnotations.length === 0) continue;

      const section = document.createElement("section");
      section.className = "minimap-group";
      section.classList.toggle("auto-group", isAutoGroup);
      section.classList.toggle("collapsed", Boolean(state.collapsedGroups[groupId]));

      const heading = document.createElement("div");
      heading.className = "minimap-group-title";
      heading.classList.toggle("auto-group", isAutoGroup);
      heading.classList.toggle("active", state.activeGroupId === groupId);
      heading.dataset.groupId = groupId;
      const toggleButton = document.createElement("button");
      toggleButton.type = "button";
      toggleButton.className = "minimap-group-toggle";
      toggleButton.textContent = state.collapsedGroups[groupId] ? "+" : "-";
      toggleButton.setAttribute("aria-label", state.collapsedGroups[groupId] ? "展开分组" : "折叠分组");
      toggleButton.addEventListener("pointerdown", (event) => event.stopPropagation());
      toggleButton.addEventListener("click", (event) => {
        event.stopPropagation();
        state.collapsedGroups[groupId] = !state.collapsedGroups[groupId];
        saveData();
        renderMinimapList();
      });

      const groupInput = document.createElement("input");
      groupInput.type = "text";
      groupInput.className = "minimap-group-name";
      groupInput.value = groupTitle(groupId);
      groupInput.readOnly = true;
      groupInput.placeholder = isAutoGroup && groupMeta ? groupMeta.autoKey : "";
      groupInput.setAttribute("aria-label", isAutoGroup ? "默认分组别名" : "分组名称");
      groupInput.addEventListener("pointerdown", function(ev) {
        if (groupInput.readOnly) return;
        ev.stopPropagation();
      });
      groupInput.addEventListener("click", function(ev) {
        if (!groupInput.readOnly) ev.stopPropagation();
      });
      groupInput.addEventListener("dblclick", function(ev) { ev.stopPropagation(); enableGroupRename(groupInput); });
      groupInput.addEventListener("change", function() {
        finishGroupRename(groupId, groupInput);
      });
      groupInput.addEventListener("blur", function() {
        finishGroupRename(groupId, groupInput);
      });
      groupInput.addEventListener("keydown", function(ev) {
        if (ev.key === "Enter") { ev.preventDefault(); groupInput.blur(); }
        if (ev.key === "Escape") {
          ev.preventDefault();
          groupInput.value = groupTitle(groupId);
          groupInput.readOnly = true;
          groupInput.classList.remove("editing");
          groupInput.blur();
        }
      });

      const count = document.createElement("small");
      count.textContent = groupSubtitle(groupMeta, groupedAnnotations.length);

      heading.appendChild(toggleButton);
      heading.appendChild(groupInput);
      heading.appendChild(count);
      if (isAutoGroup && groupMeta && hasGroupAlias(groupMeta)) {
        const badge = document.createElement("span");
        badge.className = "minimap-group-badge";
        badge.textContent = groupMeta.autoKey;
        heading.appendChild(badge);
      }

      heading.addEventListener("pointerdown", (event) => event.stopPropagation());
      heading.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        showGroupContextMenu(event, groupId, groupInput);
      });
      heading.addEventListener("click", (event) => {
        event.stopPropagation();
        if (state.selectedForGroupMove.size > 0) {
          moveSelectedAnnotationsToGroup(groupId);
          return;
        }
        state.activeGroupId = groupId;
        state.renderPrefix = groupMeta && groupMeta.autoKey ? groupMeta.autoKey : "";
        renderDrawingList();
        renderOverlay();
        renderMinimapList();
        setStatus(groupId ? `当前分组：${groupTitle(groupId)}` : "当前分组：未分组");
      });
      heading.addEventListener("dragover", (event) => {
        event.preventDefault();
        heading.classList.add("drop-target");
      });
      heading.addEventListener("dragleave", () => heading.classList.remove("drop-target"));
      heading.addEventListener("drop", (event) => {
        event.preventDefault();
        event.stopPropagation();
        heading.classList.remove("drop-target");
        const annotationId = event.dataTransfer.getData("text/plain");
        moveDraggedAnnotationsToGroup(annotationId, groupId);
      });
      section.appendChild(heading);

      if (state.collapsedGroups[groupId]) {
        el.minimapList.appendChild(section);
        continue;
      }

      if (state.renderPrefix && (!groupMeta || groupMeta.autoKey !== state.renderPrefix)) {
        el.minimapList.appendChild(section);
        continue;
      }

      for (const annotation of groupedAnnotations) {
        runningIndex += 1;
        visibleAnnotationIds.push(annotation.id);
      const row = document.createElement("div");
      row.className = "minimap-item";
      row.dataset.id = annotation.id;
      row.draggable = true;
      row.classList.toggle("active", annotation.id === state.selectedId);
      row.classList.toggle("checked", state.selectedForGroupMove.has(annotation.id));
      row.classList.toggle("special-device", Boolean(annotation.special));
      row.addEventListener("dragstart", (event) => {
        event.stopPropagation();
        if (state.selectedForGroupMove.has(annotation.id)) {
          row.classList.add("dragging-batch");
        }
        event.dataTransfer.setData("text/plain", annotation.id);
        event.dataTransfer.effectAllowed = "move";
      });
      row.addEventListener("dragend", (event) => {
        event.stopPropagation();
        row.classList.remove("dragging-batch");
        el.minimapList.querySelectorAll(".drop-target").forEach((target) => target.classList.remove("drop-target"));
      });

      const batchCheck = document.createElement("input");
      batchCheck.type = "checkbox";
      batchCheck.className = "minimap-item-check";
      batchCheck.checked = state.selectedForGroupMove.has(annotation.id);
      batchCheck.setAttribute("aria-label", "批量选择点位");
      batchCheck.addEventListener("pointerdown", (event) => event.stopPropagation());
      batchCheck.addEventListener("click", (event) => {
        event.stopPropagation();
        applyGroupMoveSelection(annotation.id, batchCheck.checked, event.shiftKey);
      });

      const indexBadge = document.createElement("button");
      indexBadge.type = "button";
      indexBadge.className = "minimap-item-index";
      indexBadge.textContent = String(runningIndex);
      indexBadge.addEventListener("pointerdown", (event) => event.stopPropagation());
      indexBadge.addEventListener("click", (event) => {
        event.stopPropagation();
        focusAnnotationFromOverview(annotation.id);
      });

      const title = document.createElement("input");
      title.className = "minimap-item-title";
      title.value = annotationTitle(annotation);
      title.setAttribute("aria-label", "点位名称");
      title.addEventListener("pointerdown", (event) => event.stopPropagation());
      title.addEventListener("dblclick", (event) => {
        event.stopPropagation();
        title.select();
      });
      title.addEventListener("click", (event) => {
        event.stopPropagation();
        if (event.shiftKey) {
          applyGroupMoveSelection(annotation.id, !state.selectedForGroupMove.has(annotation.id), true);
          return;
        }
        selectAnnotationFromList(annotation.id);
      });
      title.addEventListener("input", () => {
        annotation.code = title.value.trim();
        annotation.updatedAt = new Date().toISOString();
        if (state.selectedId === annotation.id) {
          el.pointCode.value = annotation.code;
        }
      });
      title.addEventListener("change", () => {
        syncAutoGroupsForAllDrawings();
        saveData();
        renderDrawingList();
        updateEditor();
        renderOverlay();
      });
      title.addEventListener("blur", () => {
        syncAutoGroupsForAllDrawings();
        saveData();
        renderDrawingList();
        updateEditor();
        renderOverlay();
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "minimap-item-delete";
      deleteButton.textContent = "";
      deleteButton.addEventListener("pointerdown", (event) => event.stopPropagation());
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteAnnotationById(annotation.id);
      });

      row.appendChild(batchCheck);
      row.appendChild(indexBadge);
      row.appendChild(title);
      row.appendChild(deleteButton);
      if (annotation.special) {
        const badge = document.createElement("span");
        badge.className = "special-device-badge";
        badge.textContent = "特殊";
        row.appendChild(badge);
      }
        section.appendChild(row);
      }

      el.minimapList.appendChild(section);
    }
  }

  function hideGroupContextMenu() {
    var old = document.querySelector(".group-context-menu");
    if (old) old.remove();
  }

  function showGroupContextMenu(event, groupId, groupInput) {
    hideGroupContextMenu();
    if (!groupId) return;
    var group = state.groups.find(function(item) { return item.id === groupId; });
    if (!group) return;

    var menu = document.createElement("div");
    menu.className = "group-context-menu";
    menu.style.left = event.clientX + "px";
    menu.style.top = event.clientY + "px";

    function addItem(label, handler, danger, disabled) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      if (danger) button.className = "danger";
      button.disabled = Boolean(disabled);
      button.addEventListener("click", function(ev) {
        ev.stopPropagation();
        if (button.disabled) return;
        hideGroupContextMenu();
        handler();
      });
      menu.appendChild(button);
    }

    addItem(group.isAuto ? "编辑别名" : "重命名分组", function() {
      enableGroupRename(groupInput);
    });

    if (group.isAuto) {
      addItem("查看当前所有点位", function() {
        viewAutoGroupAcrossDrawings(groupId);
      }, false, !group.autoKey);
      addItem("清空别名", function() {
        if (!group.alias) return;
        group.alias = "";
        saveData();
        renderMinimapList();
        setStatus("默认分组别名已清空。");
      }, false, !hasGroupAlias(group));
      addItem("删除本组点位", function() {
        deleteGroupWithAnnotations(groupId);
      }, true);
    } else {
      addItem("删除分组，保留点位", function() {
        deleteGroup(groupId);
      });
      addItem("删除分组和点位", function() {
        deleteGroupWithAnnotations(groupId);
      }, true);
    }

    document.body.appendChild(menu);
    var rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = Math.max(8, window.innerWidth - rect.width - 8) + "px";
    if (rect.bottom > window.innerHeight) menu.style.top = Math.max(8, window.innerHeight - rect.height - 8) + "px";
  }

  function markActiveMinimapItem(id) {
    if (!el.minimapList) return;
    el.minimapList.querySelectorAll(".minimap-item").forEach((row) => {
      row.classList.toggle("active", row.dataset.id === id);
    });
  }

  function drawAnnotation(annotation) {
    const center = annotationCenter(annotation);
    const isHighlighted = annotation.id === state.highlightedId;
    const isSelected = annotation.id === state.selectedId;
    const isCompactFocus = isCompactViewport() && isHighlighted;

    if (isCompactFocus) {
      const halo = document.createElementNS(SVG_NS, "circle");
      halo.classList.add("annotation-focus-ring");
      halo.setAttribute("cx", center.x);
      halo.setAttribute("cy", center.y);
      halo.setAttribute("r", 18 / Math.sqrt(state.transform.scale));
      el.overlay.appendChild(halo);
    }

    const shape = document.createElementNS(SVG_NS, "circle");
    shape.classList.add("annotation-shape", "point-shape");
    shape.classList.toggle("selected", isSelected);
    shape.classList.toggle("highlight", isHighlighted);
    shape.classList.toggle("special-device", Boolean(annotation.special));
    shape.classList.toggle("compact-focus", isCompactFocus);
    shape.classList.toggle("inactive", state.tool !== "pan");
    shape.dataset.id = annotation.id;
    shape.setAttribute("cx", center.x);
    shape.setAttribute("cy", center.y);
    shape.setAttribute("r", (isCompactFocus ? 7 : 3.5) / Math.sqrt(state.transform.scale));

    shape.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      event.preventDefault();
      selectAnnotation(annotation.id);
      if (state.tool !== "pan") return;
      beginMoveAnnotation(event, annotation.id);
    });
    el.overlay.appendChild(shape);

    const shouldShowLabel = annotation.code && (
      state.labelsVisible ||
      isSelected ||
      isHighlighted
    );
    if (shouldShowLabel) {
      const label = document.createElementNS(SVG_NS, "text");
      label.classList.add("annotation-label");
      label.classList.toggle("compact-focus", isCompactFocus);
      label.setAttribute("x", center.x + (isCompactFocus ? 14 / state.transform.scale : 6));
      label.setAttribute("y", center.y - (isCompactFocus ? 14 / state.transform.scale : 6));
      if (isCompactFocus) {
        label.style.fontSize = `${18 / state.transform.scale}px`;
        label.style.strokeWidth = `${5 / state.transform.scale}px`;
      }
      label.textContent = annotationTitle(annotation);
      el.overlay.appendChild(label);
    }
  }

  function selectAnnotation(id) {
    const selected = state.annotations.find((item) => item.id === id);
    if (!selected) return;
    window.clearTimeout(focusAnnotation.timer);
    state.selectedId = id;
    state.highlightedId = null;
    state.renderPrefix = renderPrefixForAnnotation(selected);
    renderDrawingList();
    el.pointCode.value = selected.code || "";
    el.pointNote.value = selected.note || "";
    updateEditor();
    renderOverlay();
  }

  function clearSelection() {
    state.selectedId = null;
    state.highlightedId = null;
    updateEditor();
    renderOverlay();
  }

  function cancelDraft() {
    if (!state.draft) return false;
    state.draft = null;
    renderOverlay();
    setStatus("已取消当前绘制。");
    return true;
  }

  function deleteSelectedAnnotation() {
    if (!state.selectedId) return false;
    recordUndoSnapshot("删除点位");
    state.selectedForGroupMove.delete(state.selectedId);
    if (state.groupMoveSelectionAnchorId === state.selectedId) state.groupMoveSelectionAnchorId = null;
    state.annotations = state.annotations.filter((annotation) => annotation.id !== state.selectedId);
    state.selectedId = null;
    state.highlightedId = null;
    saveData();
    renderDrawingList();
    renderOverlay();
    updateEditor();
    resetAutoNameInit();
    initAutoNameFromExisting();
    setStatus("标注已删除。");
    return true;
  }

  function deleteAnnotationById(id) {
    const annotation = state.annotations.find((item) => item.id === id);
    if (!annotation) return false;

    recordUndoSnapshot("删除点位");
    state.selectedForGroupMove.delete(id);
    if (state.groupMoveSelectionAnchorId === id) state.groupMoveSelectionAnchorId = null;
    state.annotations = state.annotations.filter((item) => item.id !== id);
    if (state.selectedId === id) state.selectedId = null;
    if (state.highlightedId === id) state.highlightedId = null;
    saveData();
    renderDrawingList();
    renderOverlay();
    updateEditor();
    resetAutoNameInit();
    initAutoNameFromExisting();
    setStatus("标注已删除。");
    return true;
  }

  function addGroup() {
    const name = el.groupNameInput.value.trim();
    if (!name) {
      setStatus("请输入分组名称。");
      el.groupNameInput.focus();
      return;
    }

    const existing = state.groups.find((group) => group.name === name && groupVisibleInDrawing(group.id, state.currentDrawingId));
    if (existing) {
      el.groupNameInput.value = "";
      setStatus("分组名已存在。");
      return;
    }

    recordUndoSnapshot("新增分组");
    state.groups.push({
      id: groupUid(),
      name,
      drawingId: state.currentDrawingId,
      createdAt: new Date().toISOString()
    });
    el.groupNameInput.value = "";
    saveData();
    renderMinimapList();
    setStatus("分组已新增。");
  }

  function deleteGroup(groupId) {
    if (!groupId) return;
    var group = state.groups.find(function(g) { return g.id === groupId; });
    if (!group) return;
    if (group.isAuto) {
      recordUndoSnapshot("Clear default group alias");
      group.alias = "";
      saveData();
      renderMinimapList();
      setStatus("Default group alias cleared.");
      return;
    }

    var count = state.annotations.filter(function(a) { return a.groupId === groupId; }).length;
    var msg = count > 0
      ? "Delete group " + group.name + "? " + count + " annotations will move to ungrouped."
      : "Delete empty group " + group.name + "?";
    if (!window.confirm(msg)) return;

    recordUndoSnapshot("Delete group");
    for (var i = 0; i < state.annotations.length; i++) {
      if (state.annotations[i].groupId === groupId) {
        state.annotations[i].groupId = "";
        state.annotations[i].updatedAt = new Date().toISOString();
      }
    }
    state.groups = state.groups.filter(function(g) { return g.id !== groupId; });
    if (state.activeGroupId === groupId) state.activeGroupId = "";
    saveData();
    renderDrawingList();
    renderMinimapList();
    setStatus("Group deleted." + (count > 0 ? " Annotations moved to ungrouped." : ""));
  }

  function deleteGroupWithAnnotations(groupId) {
    if (!groupId) return;
    var group = state.groups.find(function(g) { return g.id === groupId; });
    if (!group) return;
    if (group.isAuto) {
      setStatus("Default groups are generated from point codes.");
      return;
    }
    var count = state.annotations.filter(function(a) { return a.groupId === groupId; }).length;
    var msg = "Delete group " + group.name + " and " + count + " annotations? This cannot be undone.";
    if (!window.confirm(msg)) return;

    recordUndoSnapshot("Delete group and annotations");
    state.annotations = state.annotations.filter(function(a) { return a.groupId !== groupId; });
    state.groups = state.groups.filter(function(g) { return g.id !== groupId; });
    if (state.activeGroupId === groupId) state.activeGroupId = "";
    resetAutoNameInit();
    initAutoNameFromExisting();
    saveData();
    renderDrawingList();
    renderMinimapList();
    updateEditor();
    setStatus("Group and " + count + " annotations deleted.");
  }

  function moveAnnotationToGroup(annotationId, groupId) {
    const annotation = state.annotations.find((item) => item.id === annotationId);
    if (!annotation) return;
    if ((annotation.groupId || "") === (groupId || "")) return;

    recordUndoSnapshot("移动点位分组");
    annotation.groupId = groupId;
    annotation.updatedAt = new Date().toISOString();
    saveData();
    renderMinimapList();
    setStatus("点位已移动到分组。");
  }

  function moveDraggedAnnotationsToGroup(annotationId, groupId) {
    if (state.selectedForGroupMove.has(annotationId)) {
      moveSelectedAnnotationsToGroup(groupId);
      return;
    }
    moveAnnotationToGroup(annotationId, groupId);
  }

  function moveSelectedAnnotationsToGroup(groupId) {
    const ids = new Set(state.selectedForGroupMove);
    if (ids.size === 0) return;
    recordUndoSnapshot("批量移动点位分组");
    let moved = 0;
    for (const annotation of state.annotations) {
      if (!ids.has(annotation.id)) continue;
      annotation.groupId = groupId;
      annotation.updatedAt = new Date().toISOString();
      moved += 1;
    }
    state.selectedForGroupMove.clear();
    state.groupMoveSelectionAnchorId = null;
    saveData();
    renderMinimapList();
    setStatus(groupId ? `Moved ${moved} points to ${groupTitle(groupId)}.` : `Moved ${moved} points to ungrouped.`);
  }

  function updateEditor() {
    const selected = getSelected();
    el.annotationForm.hidden = !selected;
    el.emptyEditor.hidden = Boolean(selected);
    if (selected) {
      el.pointCode.value = selected.code || "";
      el.pointNote.value = selected.note || "";
    }
  }

  function createAnnotation(type, imagePoints) {
    var now = new Date().toISOString();
    var code = nextPointCode();
    if (code === null) return;
    var autoGroup = ensureAutoGroup(firstFourDigits(code), state.currentDrawingId);
    recordUndoSnapshot("新增点位");
    var annotation = {
      id: uid(),
      drawingId: state.currentDrawingId,
      type: type,
      groupId: autoGroup ? autoGroup.id : state.activeGroupId,
      code: code,
      note: "",
      special: false,
      points: imagePoints.map(normalize),
      createdAt: now,
      updatedAt: now
    };
    state.annotations.push(annotation);
    saveData();
    renderDrawingList();
    renderOverlay();
    selectAnnotation(annotation.id);
    if (code && state.lastPointCodeSource === "batch" && state.batchCodeIndex >= state.batchCodes.length) {
      setStatus("已新增 " + code + "。批量编号已全部添加。");
    } else {
      setStatus(code ? "已新增 " + code : "已新增点位。");
    }
  }

  function beginMoveAnnotation(event, id) {
    const start = screenToImage(event.clientX, event.clientY);
    const annotation = state.annotations.find((item) => item.id === id);
    state.drag = {
      type: "move-annotation",
      id,
      start,
      originalPoints: annotation.points.map((point) => ({ ...point })),
      undoSnapshot: createUndoSnapshot("移动点位")
    };
    el.overlay.setPointerCapture(event.pointerId);
  }

  function handlePointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();

    if (event.pointerType === "touch") {
      state.activePointers.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY
      });
      el.viewport.setPointerCapture(event.pointerId);

      if (state.activePointers.size >= 2) {
        const points = Array.from(state.activePointers.values()).slice(0, 2);
        const center = pointerCenter(points);
        state.drag = {
          type: "pinch",
          startDistance: pointerDistance(points),
          startScale: state.transform.scale,
          centerImage: screenToImage(center.x, center.y)
        };
        el.viewport.classList.add("grabbing");
        return;
      }
    }

    if (state.tool === "pan") {
      state.drag = {
        type: "pan",
        startX: event.clientX,
        startY: event.clientY,
        originX: state.transform.x,
        originY: state.transform.y
      };
      el.viewport.classList.add("grabbing");
      el.viewport.setPointerCapture(event.pointerId);
      return;
    }

    const point = screenToImage(event.clientX, event.clientY);
    if (state.tool === "point") {
      createAnnotation("point", [point]);
      renderOverlay();
    }
  }

  function handlePointerMove(event) {
    if (event.pointerType === "touch" && state.activePointers.has(event.pointerId)) {
      state.activePointers.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY
      });
    }
    if (!state.drag) return;

    if (state.drag.type === "pinch") {
      const points = Array.from(state.activePointers.values()).slice(0, 2);
      if (points.length < 2) return;
      const center = pointerCenter(points);
      const nextScale = state.drag.startScale * (pointerDistance(points) / state.drag.startDistance);
      state.transform.scale = clamp(nextScale, 0.08, 8);
      state.transform.x = center.x - el.viewport.getBoundingClientRect().left - state.drag.centerImage.x * state.transform.scale;
      state.transform.y = center.y - el.viewport.getBoundingClientRect().top - state.drag.centerImage.y * state.transform.scale;
      applyTransform();
      renderOverlay();
      return;
    }

    if (state.drag.type === "pan") {
      state.transform.x = state.drag.originX + event.clientX - state.drag.startX;
      state.transform.y = state.drag.originY + event.clientY - state.drag.startY;
      applyTransform();
      return;
    }

    const point = screenToImage(event.clientX, event.clientY);

    if (state.drag.type === "move-annotation") {
      const annotation = state.annotations.find((item) => item.id === state.drag.id);
      const dx = (point.x - state.drag.start.x) / state.imageSize.width;
      const dy = (point.y - state.drag.start.y) / state.imageSize.height;
      annotation.points = state.drag.originalPoints.map((original) => ({
        x: clamp(original.x + dx, 0, 1),
        y: clamp(original.y + dy, 0, 1)
      }));
      annotation.updatedAt = new Date().toISOString();
      renderOverlay();
      return;
    }
  }

  function handlePointerUp(event) {
    if (event.pointerType === "touch") {
      state.activePointers.delete(event.pointerId);
    }
    if (!state.drag) return;

    if (state.drag.type === "move-annotation") {
      const annotation = state.annotations.find((item) => item.id === state.drag.id);
      if (annotation && pointsChanged(state.drag.originalPoints, annotation.points)) {
        undoStack.push(state.drag.undoSnapshot);
        if (undoStack.length > MAX_UNDO_STEPS) undoStack.shift();
      }
      saveData();
      renderDrawingList();
    }

    if (state.drag.type === "pinch" && state.activePointers.size > 0) {
      el.viewport.classList.remove("grabbing");
      state.drag = null;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch (error) {
        // Pointer capture may already be released by the browser.
      }
      return;
    }

    el.viewport.classList.remove("grabbing");
    state.drag = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch (error) {
      // Pointer capture may already be released by the browser.
    }
    renderOverlay();
  }

  function handleGlobalKeydown(event) {
    if (isTypingTarget(event.target)) return;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undoLastAction();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      hideSearchResults();
      if (!cancelDraft()) clearSelection();
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      if (state.selectedId) {
        event.preventDefault();
        deleteSelectedAnnotation();
      }
      return;
    }

    if (event.key === "1") {
      event.preventDefault();
      setTool("pan");
      return;
    }

    if (event.key === "2") {
      event.preventDefault();
      setTool("point");
      return;
    }

    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      fitToViewport();
    }
  }

  function centerFromMinimap(event) {
    const bodyRect = el.minimapBody.getBoundingClientRect();
    const layout = minimapLayout(bodyRect);
    if (!layout) return;

    const x = clamp(
      (event.clientX - bodyRect.left - layout.offsetX) / layout.scale + layout.bounds.minX,
      layout.bounds.minX,
      layout.bounds.maxX
    );
    const y = clamp(
      (event.clientY - bodyRect.top - layout.offsetY) / layout.scale + layout.bounds.minY,
      layout.bounds.minY,
      layout.bounds.maxY
    );
    const viewportRect = el.viewport.getBoundingClientRect();
    state.transform.x = viewportRect.width / 2 - x * state.transform.scale;
    state.transform.y = viewportRect.height / 2 - y * state.transform.scale;
    applyTransform();
  }

  function zoomAt(clientX, clientY, deltaY) {
    const before = screenToImage(clientX, clientY);
    const factor = deltaY < 0 ? 1.12 : 0.88;
    state.transform.scale = clamp(state.transform.scale * factor, 0.08, 8);
    const screen = imageToScreen(before);
    state.transform.x += clientX - screen.x;
    state.transform.y += clientY - screen.y;
    applyTransform();
    renderOverlay();
  }

  function pointerCenter(points) {
    return {
      x: (points[0].clientX + points[1].clientX) / 2,
      y: (points[0].clientY + points[1].clientY) / 2
    };
  }

  function pointerDistance(points) {
    const dx = points[0].clientX - points[1].clientX;
    const dy = points[0].clientY - points[1].clientY;
    return Math.max(1, Math.hypot(dx, dy));
  }

  function search() {
    const query = el.searchInput.value.trim().toLowerCase();
    el.searchResults.innerHTML = "";
    if (!query) {
      state.renderPrefix = "";
      renderDrawingList();
      renderOverlay();
      renderMinimapList();
      return;
    }
    const queryPrefix = firstFourDigits(query);
    if (queryPrefix && queryPrefix !== state.renderPrefix) {
      state.renderPrefix = queryPrefix;
      renderDrawingList();
      renderOverlay();
      renderMinimapList();
    }

    const startsWithMatches = [];
    const includesMatches = [];
    for (const annotation of state.annotations) {
      const code = (annotation.code || "").toLowerCase();
      const note = (annotation.note || "").toLowerCase();
      const haystack = `${code} ${note}`;
      if (code.startsWith(query)) {
        startsWithMatches.push(annotation);
      } else if (haystack.includes(query)) {
        includesMatches.push(annotation);
      }
    }
    const matches = [...startsWithMatches, ...includesMatches];

    if (matches.length === 0) {
      el.searchResults.textContent = "未找到匹配点位";
      return;
    }

    for (const match of matches.slice(0, 50)) {
      const drawing = drawings.find((item) => item.id === match.drawingId);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "result-item";
      button.innerHTML = `${escapeHtml(match.code || "未命名")}<small>${escapeHtml(drawing ? drawing.title : "")} ${escapeHtml(match.note || "")}</small>`;
      button.addEventListener("click", () => focusAnnotation(match.id));
      el.searchResults.appendChild(button);
    }

    if (matches.length === 1) focusAnnotation(matches[0].id);
  }

  function hideSearchResults() {
    el.searchResults.innerHTML = "";
  }

  function focusAnnotation(id) {
    const annotation = state.annotations.find((item) => item.id === id);
    if (!annotation) return;
    state.selectedId = id;
    state.highlightedId = id;
    state.renderPrefix = renderPrefixForAnnotation(annotation);
    renderDrawingList();
    if (annotation.drawingId !== state.currentDrawingId) {
      switchDrawing(annotation.drawingId, { selectedId: id, highlightedId: id });
      return;
    }
    zoomToAnnotation(annotation);
    if (isCompactViewport()) {
      el.searchInput.blur();
      el.searchResults.innerHTML = "";
    }
    updateEditor();
    renderOverlay();
    window.clearTimeout(focusAnnotation.timer);
    focusAnnotation.timer = window.setTimeout(() => {
      state.highlightedId = null;
      renderOverlay();
    }, 3000);
  }

  function centerOnAnnotation(annotation) {
    const center = annotationCenter(annotation);
    const rect = el.viewport.getBoundingClientRect();
    state.transform.x = rect.width / 2 - center.x * state.transform.scale;
    state.transform.y = rect.height / 2 - center.y * state.transform.scale;
    applyTransform();
  }

  function zoomToAnnotation(annotation) {
    const bounds = annotationBounds(annotation);
    const center = annotationCenter(annotation);
    const rect = el.viewport.getBoundingClientRect();
    const boundsWidth = Math.max(40, bounds.maxX - bounds.minX);
    const boundsHeight = Math.max(40, bounds.maxY - bounds.minY);
    const focusPadding = isCompactViewport() ? 2.2 : 3;
    const scale = Math.min(rect.width / (boundsWidth * focusPadding), rect.height / (boundsHeight * focusPadding));

    state.transform.scale = clamp(scale, isCompactViewport() ? 0.55 : 0.25, isCompactViewport() ? 5 : 5);
    state.transform.x = rect.width / 2 - center.x * state.transform.scale;
    state.transform.y = rect.height / 2 - center.y * state.transform.scale;
    applyTransform();
  }

  function focusAnnotationFromOverview(id) {
    const annotation = state.annotations.find((item) => item.id === id);
    if (!annotation) return;

    state.selectedId = id;
    state.highlightedId = id;
    state.renderPrefix = renderPrefixForAnnotation(annotation);
    renderDrawingList();
    zoomToAnnotation(annotation);
    updateEditor();
    renderOverlay();
    window.clearTimeout(focusAnnotation.timer);
    focusAnnotation.timer = window.setTimeout(() => {
      state.highlightedId = null;
      renderOverlay();
    }, 3000);
  }

  function selectAnnotationFromList(id) {
    const annotation = state.annotations.find((item) => item.id === id);
    if (!annotation) return;

    window.clearTimeout(focusAnnotation.timer);
    state.selectedId = id;
    state.highlightedId = null;
    state.renderPrefix = renderPrefixForAnnotation(annotation);
    renderDrawingList();

    const bounds = annotationBounds(annotation);
    const center = annotationCenter(annotation);
    const rect = el.viewport.getBoundingClientRect();
    const boundsWidth = Math.max(40, bounds.maxX - bounds.minX);
    const boundsHeight = Math.max(40, bounds.maxY - bounds.minY);
    const scale = Math.min(rect.width / (boundsWidth * 3), rect.height / (boundsHeight * 3));

    state.transform.scale = clamp(scale, 0.25, 5);
    state.transform.x = rect.width / 2 - center.x * state.transform.scale;
    state.transform.y = rect.height / 2 - center.y * state.transform.scale;
    applyTransform({ renderMinimap: false });
    updateEditor();
    renderOverlayOnly();
    renderMinimap({ renderList: false });
    markActiveMinimapItem(id);
  }

  function exportData() {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      drawings: drawings.map(({ id, title, image }) => ({ id, title, image })),
      groups: state.groups,
      collapsedGroups: state.collapsedGroups,
      annotations: state.annotations
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "data-backup.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!Array.isArray(parsed.annotations)) {
          throw new Error("Invalid annotations");
        }
        recordUndoSnapshot("导入数据");
        state.groups = Array.isArray(parsed.groups) ? parsed.groups.map(toGroup).filter(Boolean) : [];
        state.collapsedGroups = parsed.collapsedGroups && typeof parsed.collapsedGroups === "object" ? parsed.collapsedGroups : {};
        state.annotations = parsed.annotations.map(toPointAnnotation).filter(Boolean);
        saveData();
        state.selectedId = null;
        state.highlightedId = null;
        selectFirstAnnotatedDrawingIfNeeded();
        renderDrawingList();
        renderOverlay();
        updateEditor();
        resetAutoNameInit();
        initAutoNameFromExisting();
        setStatus("数据已导入。");
      } catch (error) {
        setStatus("导入失败，请检查 JSON 文件。");
      }
    };
    reader.readAsText(file, "utf8");
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char];
    });
  }

  function loadDocsData() {
    try {
      const raw = localStorage.getItem(DOCS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      state.docFolders = Array.isArray(parsed.folders) ? parsed.folders.filter((folder) => folder.id && folder.name) : [];
      state.docs = Array.isArray(parsed.docs) ? parsed.docs.filter((doc) => doc.id && doc.title) : [];
      state.activeFolderId = parsed.activeFolderId || "";
      state.selectedDocId = parsed.selectedDocId || null;
    } catch (error) {
      console.warn("Training docs load failed:", error);
    }
  }

  function saveDocsData() {
    saveDocsLocal();
    scheduleSyncPush();
  }

  async function loadRepoTrainingDocs() {
    let manifest;
    try {
      const response = await fetch("assets/training-docs-manifest.json", { cache: "no-store" });
      if (!response.ok) return;
      manifest = await response.json();
    } catch (error) {
      return;
    }

    if (!manifest || !Array.isArray(manifest.docs)) return;
    const signature = JSON.stringify(manifest.docs.map((item) => ({
      path: item.path,
      size: item.size,
      mtimeMs: item.mtimeMs
    })));
    if (signature === trainingManifestSignature) return false;
    trainingManifestSignature = signature;

    let changed = false;
    const rootFolderId = "";

    // Create folders from manifest (including empty ones)
    if (Array.isArray(manifest.folders)) {
      for (const f of manifest.folders) {
        if (!f || !f.path || !f.name) continue;
        const parentPath = String(f.path).split("/").filter(Boolean).slice(0, -1).join("/");
        const parentResult = getOrCreateDocFolderByPath(parentPath.length ? parentPath : null, rootFolderId, true);
        changed = parentResult.created || changed;
        var existingFolder = state.docFolders.find(function(df) {
          return df.name === f.name && (df.parentId || "") === (parentResult.folderId || "");
        });
        if (!existingFolder) {
          state.docFolders.push({
            id: folderUid(),
            name: f.name,
            parentId: parentResult.folderId || "",
            createdAt: new Date().toISOString()
          });
          changed = true;
        }
      }
    }

    for (const item of manifest.docs) {
      if (!item || !item.path || !item.name) continue;
      const folderPath = String(item.path).split(/[\\/]+/).filter(Boolean).slice(0, -1).join("/");
      const folderResult = getOrCreateDocFolderByPath(folderPath, rootFolderId, true);
      changed = folderResult.created || changed;

      const existing = state.docs.find((doc) => doc.sourcePath === item.path);
      if (existing && existing.manifestMtimeMs === item.mtimeMs && existing.manifestSize === item.size) {
        if (existing.folderId !== folderResult.folderId) {
          existing.folderId = folderResult.folderId;
          changed = true;
        }
        continue;
      }

      try {
        const response = await fetch(item.url, { cache: "no-store" });
        if (!response.ok) continue;
        const blob = await response.blob();
        const file = new File([blob], item.name, { type: item.type || blob.type });
        const doc = await addTrainingDoc(file, folderResult.folderId, item.path);
        doc.manifestMtimeMs = item.mtimeMs;
        doc.manifestSize = item.size;
        doc.repoManaged = true;
        changed = true;
      } catch (error) {
        console.warn("Repo training doc load failed:", item.path, error);
      }
    }

    const manifestPaths = new Set(manifest.docs.map((item) => item.path));
    const before = state.docs.length;
    state.docs = state.docs.filter((doc) => !doc.repoManaged || manifestPaths.has(doc.sourcePath));
    changed = changed || state.docs.length !== before;

    const usedFolderIds = new Set(state.docs.map((doc) => doc.folderId).filter(Boolean));
    let removedEmptyFolder = true;
    while (removedEmptyFolder) {
      removedEmptyFolder = false;
      const parentIds = new Set(state.docFolders.map((folder) => folder.parentId).filter(Boolean));
      const nextFolders = state.docFolders.filter((folder) => {
        if (!folder.repoManaged || usedFolderIds.has(folder.id) || parentIds.has(folder.id)) return true;
        removedEmptyFolder = true;
        return false;
      });
      state.docFolders = nextFolders;
      changed = changed || removedEmptyFolder;
    }

    if (changed) saveDocsData();
    return changed;
  }

  function folderTitle(folderId) {
    if (!folderId) return "全部资料";
    return state.docFolders.find((folder) => folder.id === folderId)?.name || "全部资料";
  }

  function childFolders(parentId) {
    return state.docFolders.filter((folder) => (folder.parentId || "") === (parentId || ""));
  }

  function docsInFolder(folderId) {
    if (!folderId) return state.docs;
    return state.docs.filter((doc) => doc.folderId === folderId);
  }

  function getFolderPath(folderId) {
    var parts = [];
    var currentId = folderId;
    var visited = new Set();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      var folder = state.docFolders.find(function(f) { return f.id === currentId; });
      if (!folder) break;
      parts.unshift(folder.name);
      currentId = folder.parentId || "";
    }
    return parts.join("/");
  }

  function getOrCreateDocFolderByPath(path, rootFolderId = "", repoManaged = false) {
    const parts = String(path || "").split(/[\\/]+/).map((part) => part.trim()).filter(Boolean);
    let parentId = rootFolderId || "";
    let created = false;

    for (const part of parts) {
      let folder = state.docFolders.find((item) => item.name === part && (item.parentId || "") === parentId);
      if (!folder) {
        folder = {
          id: folderUid(),
          name: part,
          parentId,
          repoManaged,
          createdAt: new Date().toISOString()
        };
        state.docFolders.push(folder);
        created = true;
      } else if (repoManaged && !folder.repoManaged) {
        folder.repoManaged = true;
        created = true;
      }
      parentId = folder.id;
    }

    return { folderId: parentId, created };
  }

  function switchModule(moduleName) {
    state.activeModule = moduleName;
    el.moduleTabs.forEach((button) => {
      button.classList.toggle("active", button.dataset.module === moduleName);
    });
    el.pointModule.hidden = moduleName !== "points";
    el.docsModule.hidden = moduleName !== "docs";
    if (moduleName === "docs") renderDocsModule();
    if (moduleName === "points") renderOverlay();
  }

  function renderFolderParentOptions() {
    el.folderParentSelect.innerHTML = "";
    const rootOption = document.createElement("option");
    rootOption.value = "";
    rootOption.textContent = "顶层目录";
    el.folderParentSelect.appendChild(rootOption);
    for (const folder of state.docFolders) {
      const option = document.createElement("option");
      option.value = folder.id;
      option.textContent = folder.name;
      el.folderParentSelect.appendChild(option);
    }
    el.folderParentSelect.value = state.activeFolderId || "";
  }

  function renderFolderTree() {
    el.folderTree.innerHTML = "";
    const allButton = document.createElement("button");
    allButton.type = "button";
    allButton.className = "folder-item";
    allButton.classList.toggle("active", !state.activeFolderId);
    allButton.innerHTML = `<span>全部资料</span><small>${state.docs.length} 篇文档</small>`;
    allButton.addEventListener("click", () => {
      state.activeFolderId = "";
      saveDocsData();
      renderDocsModule();
    });
    el.folderTree.appendChild(allButton);

    const renderBranch = (parentId, depth) => {
      for (const folder of childFolders(parentId)) {
        const count = docsInFolder(folder.id).length;
        const row = document.createElement("div");
        row.className = "folder-row";
        row.style.marginLeft = `${depth * 14}px`;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "folder-item";
        button.classList.toggle("active", state.activeFolderId === folder.id);
        button.innerHTML = `<span>${escapeHtml(folder.name)}</span><small>${count} 篇文档</small>`;
        button.addEventListener("click", () => {
          state.activeFolderId = folder.id;
          saveDocsData();
          renderDocsModule();
        });
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "folder-delete";
        deleteButton.title = "删除目录";
        deleteButton.setAttribute("aria-label", `删除目录 ${folder.name}`);
        deleteButton.textContent = "×";
        deleteButton.addEventListener("click", () => deleteDocFolder(folder.id));
        row.append(button, deleteButton);
        el.folderTree.appendChild(row);
        renderBranch(folder.id, depth + 1);
      }
    };
    renderBranch("", 0);
  }

  function renderDocList() {
    const query = el.docSearchInput.value.trim().toLowerCase();
    const docs = docsInFolder(state.activeFolderId).filter((doc) => {
      return !query || `${doc.title} ${doc.sourceFileName || ""}`.toLowerCase().includes(query);
    });
    el.docList.innerHTML = "";
    el.docsCurrentFolder.textContent = folderTitle(state.activeFolderId);
    el.docsCount.textContent = `${docs.length} docs`;

    if (docs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "minimap-empty";
      empty.textContent = "No documents in this folder.";
      el.docList.appendChild(empty);
      return;
    }

    for (const doc of docs) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "doc-item";
      button.classList.toggle("active", doc.id === state.selectedDocId);
      button.innerHTML = `<span class="doc-title">${escapeHtml(doc.title)}</span><small>${escapeHtml(doc.sourceFileName || "")}</small>`;
      button.addEventListener("click", () => {
        state.selectedDocId = doc.id;
        saveDocsData();
        renderDocsModule();
      });
      el.docList.appendChild(button);
    }
  }

  function renderDocReader() {
    const doc = state.docs.find((item) => item.id === state.selectedDocId);
    el.docEmptyState.hidden = Boolean(doc);
    el.docReaderContent.hidden = !doc;
    if (!doc) return;

    el.docTitleInput.value = doc.title;
    el.docMeta.textContent = `${doc.sourceFileName || "DOCX"} / ${folderTitle(doc.folderId)} / ${new Date(doc.createdAt).toLocaleString()}`;
    el.docBody.innerHTML = doc.htmlContent || `<div class="doc-body-placeholder">文档已加入资料库，但暂未解析出可显示正文。</div>`;
  }

  function renderDocsModule() {
    renderFolderParentOptions();
    renderFolderTree();
    renderDocList();
    renderDocReader();
  }

  function addDocFolder() {
    var name = el.folderNameInput.value.trim();
    if (!name) {
      el.folderNameInput.focus();
      setStatus("请输入目录名称。");
      return;
    }
    var parentId = el.folderParentSelect.value || "";
    var duplicate = state.docFolders.some(function(f) {
      return f.name === name && (f.parentId || "") === parentId;
    });
    if (duplicate) {
      setStatus("同级目录已存在。");
      el.folderNameInput.select();
      return;
    }
    // Create folder on server (if sync enabled)
    if (syncState.enabled) {
      var parentFolder = state.docFolders.find(function(f) { return f.id === parentId; });
      var parentPath = parentFolder ? getFolderPath(parentFolder.id) : "";
      fetch("/api/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name, parentPath: parentPath })
      }).catch(function(e) { console.warn("Server folder creation failed:", e); });
    }

    state.docFolders.push({
      id: folderUid(),
      name: name,
      parentId: parentId,
      createdAt: new Date().toISOString()
    });
    el.folderNameInput.value = "";
    saveDocsData();
    renderDocsModule();
    setStatus("目录已新增。");
  }

  function collectFolderIds(folderId) {
    const ids = new Set([folderId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of state.docFolders) {
        if (!ids.has(folder.id) && ids.has(folder.parentId || "")) {
          ids.add(folder.id);
          changed = true;
        }
      }
    }
    return ids;
  }

  function deleteDocFolder(folderId) {
    const folder = state.docFolders.find((item) => item.id === folderId);
    if (!folder) return;
    // repaired invalid text literal
    const ids = collectFolderIds(folderId);

    // Delete from server disk
    if (syncState.enabled) {
      var folderPath = getFolderPath(folderId);
      fetch("/api/delete?path=" + encodeURIComponent(folderPath), { method: "DELETE" })
        .catch(function(e) { console.warn("Server folder delete failed:", e); });
    }

    state.docFolders = state.docFolders.filter((item) => !ids.has(item.id));
    state.docs = state.docs.filter((doc) => !ids.has(doc.folderId));
    if (ids.has(state.activeFolderId)) state.activeFolderId = "";
    if (!state.docs.some((doc) => doc.id === state.selectedDocId)) state.selectedDocId = null;
    saveDocsData();
    renderDocsModule();
  }

  function seedTrainingDocs() {
    const seedTag = "sample-training-seed";
    const existingSample = state.docs.find((doc) => Array.isArray(doc.tags) && doc.tags.includes(seedTag));
    if (existingSample) {
      state.activeFolderId = existingSample.folderId || "";
      state.selectedDocId = existingSample.id;
      saveDocsData();
      renderDocsModule();
      setStatus("Sample docs already exist.");
      return;
    }
    const now = new Date().toISOString();
    const folderByPath = new Map();
    const getFolder = (path) => {
      const parts = path.split("/").filter(Boolean);
      let parentId = "";
      let key = "";
      for (const part of parts) {
        key = key ? key + "/" + part : part;
        let folder = folderByPath.get(key) || state.docFolders.find((item) => item.name === part && (item.parentId || "") === parentId);
        if (!folder) {
          folder = { id: folderUid(), name: part, parentId, createdAt: now };
          state.docFolders.push(folder);
        }
        folderByPath.set(key, folder);
        parentId = folder.id;
      }
      return parentId;
    };
    ["Mechanical/Conveyor/Belt", "Mechanical/Maintenance/Daily", "Electrical/Power/MCC", "IT/PLC/Network"].forEach(getFolder);
    const makeDoc = (title, folderPath, items) => ({
      id: docUid(), title, folderId: getFolder(folderPath), sourceFileName: title + ".sample", size: 0, type: "sample",
      linkedPointIds: [], tags: [seedTag], createdAt: now, updatedAt: now,
      htmlContent: '<section class="sample-doc-section"><h3>Reference</h3><ul>' + items.map((item) => "<li>" + escapeHtml(item) + "</li>").join("") + "</ul></section>",
      textContent: items.join("\n"), parseStatus: "sample"
    });
    const samples = [
      makeDoc("Belt daily inspection", "Mechanical/Maintenance/Daily", ["Check belt tracking, rollers, and tension.", "Record device code and point code."]),
      makeDoc("MCC power-on checklist", "Electrical/Power/MCC", ["Confirm cabinet number and circuit name.", "Check voltage and HMI status after power-on."]),
      makeDoc("PLC network troubleshooting", "IT/PLC/Network", ["Check switch power, ports, and fiber status.", "Isolate by area and record affected points."])
    ];
    state.docs.push(...samples);
    state.activeFolderId = samples[0].folderId;
    state.selectedDocId = samples[0].id;
    saveDocsData();
    renderDocsModule();
    setStatus("Sample docs created.");
  }

  async function uploadDocs(files) {
    const list = Array.from(files || []);
    if (list.length === 0) return;
    setStatus("正在上传...");
    for (const file of list) {
      // Upload raw file to server
      if (syncState.enabled) {
        try {
          var formData = new FormData();
          formData.append("file", file);
          var folder = state.docFolders.find(function(f) { return f.id === state.activeFolderId; });
          var folderPath = folder ? getFolderPath(folder.id) : "";
          var uploadUrl = SYNC_ENDPOINT.replace("/api/data", "/api/upload");
          if (folderPath) uploadUrl += "?folder=" + encodeURIComponent(folderPath);
          var resp = await fetch(uploadUrl, { method: "POST", body: formData });
          if (resp.ok) {
            var result = await resp.json();
            // Also add to local state for immediate viewing
            await addTrainingDoc(file, state.activeFolderId || "", result.path || "");
          } else {
            await addTrainingDoc(file, state.activeFolderId || "");
          }
        } catch (e) {
          console.warn("Upload to server failed, local only:", e);
          await addTrainingDoc(file, state.activeFolderId || "");
        }
      } else {
        await addTrainingDoc(file, state.activeFolderId || "");
      }
    }
    state.selectedDocId = state.docs[state.docs.length - 1]?.id || null;
    el.docUploadInput.value = "";
    saveDocsData();
    renderDocsModule();
    setStatus("上传完成。");
  }

  async function addTrainingDoc(file, folderId, sourcePath = "") {
    const parsed = await parseTrainingFile(file);
    const now = new Date().toISOString();
    const doc = {
      id: docUid(),
      title: file.name.replace(/\.(docx|pdf|xlsx|xls|csv|pptx)$/i, ""),
      folderId: folderId || "",
      sourceFileName: file.name,
      sourcePath,
      size: file.size,
      type: file.type,
      linkedPointIds: [],
      tags: [],
      createdAt: now,
      updatedAt: now,
      htmlContent: parsed.html,
      textContent: parsed.text,
      parseStatus: parsed.status
    };

    const existing = sourcePath
      ? state.docs.find((item) => item.sourcePath === sourcePath)
      : null;
    if (existing) {
      Object.assign(existing, doc, { id: existing.id, createdAt: existing.createdAt || now });
      return existing;
    }
    state.docs.push(doc);
    return doc;
  }

  async function parseTrainingFile(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    try {
      if (ext === "docx") return await parseDocxFile(file);
      if (ext === "pptx") return await parsePptxFile(file);
      if (ext === "xlsx" || ext === "xls" || ext === "csv") return await parseSpreadsheetFile(file);
      if (ext === "pdf") return await parsePdfFile(file);
      return {
        html: `<div class="doc-body-placeholder">暂不支持解析 ${escapeHtml(ext)} 文件，但已保存文件条目。</div>`,
        text: "",
        status: "unsupported"
      };
    } catch (error) {
      console.warn("File parse failed:", file.name, error);
      return {
        html: `<div class="doc-body-placeholder">解析失败：${escapeHtml(error.message || "未知错误")}。文件条目已保存。</div>`,
        text: "",
        status: "failed"
      };
    }
  }

  async function parseDocxFile(file) {
    // repaired invalid text literal
    var zip, documentXml;
    try {
      zip = await window.JSZip.loadAsync(await file.arrayBuffer());
    } catch (e) {
      throw new Error("文件不是有效的 DOCX/ZIP 格式");
    }
    var docPaths = ["word/document.xml", "word/document2.xml"];
    for (var p = 0; p < docPaths.length; p++) {
      var entry = zip.file(docPaths[p]);
      if (entry) {
        try { documentXml = await entry.async("text"); } catch (e) {}
        if (documentXml) break;
      }
    }
    if (!documentXml) {
      var allFiles = Object.keys(zip.files).slice(0, 20).join(", ");
      // repaired invalid text literal
    }

    // Extract images from word/media/
    var imageMap = {};
    var mediaFiles = Object.keys(zip.files).filter(function(name) {
      return /^word\/media\//.test(name);
    });
    for (var i = 0; i < mediaFiles.length; i++) {
      var mediaName = mediaFiles[i];
      try {
        var imgEntry = zip.file(mediaName);
        if (!imgEntry) continue;
        var blob = await imgEntry.async("uint8array");
        var ext = mediaName.split(".").pop().toLowerCase();
        var mime = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "bmp" ? "image/bmp" : ext === "svg" ? "image/svg+xml" : "application/octet-stream";
        var binary = "";
        for (var j = 0; j < blob.length; j++) {
          binary += String.fromCharCode(blob[j]);
        }
        imageMap[mediaName] = "data:" + mime + ";base64," + btoa(binary);
      } catch (e) { console.warn("Image extract failed:", mediaName, e); }
    }

    var paragraphs = extractWordParagraphs(documentXml);
    var text = paragraphs.join("\n");
    var html = paragraphs.length
      ? paragraphs.map(function(line) { return "<p>" + escapeHtml(line) + "</p>"; }).join("")
      : "<div class=\"doc-body-placeholder\">Word 鏂囦欢宸茶鍙栵紝浣嗘病鏈夋彁鍙栧埌姝ｆ枃銆?/div>";

    // Replace image references with base64 img tags
    for (var key in imageMap) {
      if (imageMap.hasOwnProperty(key)) {
        var dataUri = imageMap[key];
        // Replace r:embed references (simplified: just add images at end)
        html += "<p><img src=\"" + dataUri + "\" style=\"max-width:100%;\" alt=\"\"></p>";
      }
    }

    return {
      html: html,
      text: text,
      status: "parsed"
    };
  }

  async function parsePptxFile(file) {
    // repaired invalid text literal
    const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => Number(a.match(/slide(\d+)/)?.[1] || 0) - Number(b.match(/slide(\d+)/)?.[1] || 0));
    const slides = [];
    for (const slideFile of slideFiles) {
      const xml = await zip.file(slideFile).async("text");
      const lines = extractXmlText(xml, "a:t");
      slides.push(lines.join(" ").trim());
    }
    const filtered = slides.filter(Boolean);
    return {
      html: filtered.length
        ? filtered.map((text, index) => `<section class="doc-slide"><h3>绗?${index + 1} 椤?/h3><p>${escapeHtml(text)}</p></section>`).join("")
        : `<div class="doc-body-placeholder">PPT 鏂囦欢宸茶鍙栵紝浣嗘病鏈夋彁鍙栧埌鏂囧瓧銆?/div>`,
      text: filtered.join("\n"),
      status: "parsed"
    };
  }

  async function parseSpreadsheetFile(file) {
    // repaired invalid text literal
    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
    const parts = [];
    const textParts = [];
    for (const sheetName of workbook.SheetNames) {
      const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, blankrows: false });
      textParts.push(sheetName, ...rows.map((row) => row.join("\t")));
      parts.push(`<section class="doc-sheet"><h3>${escapeHtml(sheetName)}</h3>${rowsToTable(rows)}</section>`);
    }
    return {
      html: parts.join("") || `<div class="doc-body-placeholder">表格文件已读取，但没有提取到内容。</div>`,
      text: textParts.join("\n"),
      status: "parsed"
    };
  }

  async function parsePdfFile(file) {
    const pdfjs = await import("./node_modules/pdfjs-dist/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "./node_modules/pdfjs-dist/build/pdf.worker.mjs";
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item) => item.str).join(" ").trim();
      pages.push(text);
    }
    const filtered = pages.filter(Boolean);
    return {
      html: filtered.length
        ? filtered.map((text, index) => `<section class="doc-pdf-page"><h3>绗?${index + 1} 椤?/h3><p>${escapeHtml(text)}</p></section>`).join("")
        : `<div class="doc-body-placeholder">PDF 宸茶鍙栵紝浣嗘病鏈夋彁鍙栧埌鏂囧瓧銆?/div>`,
      text: filtered.join("\n"),
      status: "parsed"
    };
  }

  function extractWordParagraphs(xml) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    return Array.from(doc.getElementsByTagName("w:p")).map((paragraph) => {
      return Array.from(paragraph.childNodes).map((node) => {
        return Array.from(node.getElementsByTagName ? node.getElementsByTagName("w:t") : [])
          .map((textNode) => textNode.textContent)
          .join("");
      }).join("").trim();
    }).filter(Boolean);
  }

  function extractXmlText(xml, tagName) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    return Array.from(doc.getElementsByTagName(tagName)).map((node) => node.textContent || "").filter(Boolean);
  }

  function rowsToTable(rows) {
    if (!rows.length) return `<div class="doc-body-placeholder">绌哄伐浣滆〃</div>`;
    return `<div class="doc-table-wrap"><table class="doc-table">${rows.map((row) => {
      return `<tr>${row.map((cell) => `<td>${escapeHtml(cell == null ? "" : cell)}</td>`).join("")}</tr>`;
    }).join("")}</table></div>`;
  }

  function updateSelectedDocTitle() {
    const doc = state.docs.find((item) => item.id === state.selectedDocId);
    if (!doc) return;
    // repaired invalid text literal
    doc.updatedAt = new Date().toISOString();
    saveDocsData();
    renderDocsModule();
  }

  function deleteSelectedDoc() {
    if (!state.selectedDocId) return;
    var doc = state.docs.find(function(d) { return d.id === state.selectedDocId; });
    if (!doc) return;
    // repaired invalid text literal

    // Delete from server disk
    if (syncState.enabled) {
      var folderPath = doc.folderId ? getFolderPath(doc.folderId) : "";
      var filePath = folderPath ? folderPath + "/" + doc.sourceFileName : doc.sourceFileName;
      fetch("/api/delete?path=" + encodeURIComponent(filePath), { method: "DELETE" })
        .catch(function(e) { console.warn("Server delete failed:", e); });
    }

    state.docs = state.docs.filter(function(d) { return d.id !== state.selectedDocId; });
    state.selectedDocId = null;
    saveDocsData();
    renderDocsModule();
  }

  function bindEvents() {
    const preventPageZoom = (event) => {
      event.preventDefault();
    };
    const preventNativeDrag = (event) => {
      if (
        event.target instanceof Element &&
        !isTypingTarget(event.target) &&
        (event.target.closest("#viewport") || event.target.closest(".minimap"))
      ) {
        event.preventDefault();
      }
    };

    ["gesturestart", "gesturechange", "gestureend"].forEach((eventName) => {
      document.addEventListener(eventName, preventPageZoom, { passive: false });
    });
    el.viewport.addEventListener("touchmove", (event) => {
      if (event.touches && event.touches.length > 1) event.preventDefault();
    }, { passive: false });

    document.querySelectorAll(".tool-button").forEach((button) => {
      button.addEventListener("click", () => setTool(button.dataset.tool));
    });
    el.moduleTabs.forEach((button) => {
      button.addEventListener("click", () => switchModule(button.dataset.module));
    });
    el.addFolderButton.addEventListener("click", addDocFolder);
    el.seedDocsButton.addEventListener("click", seedTrainingDocs);
    el.folderNameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addDocFolder();
      }
    });
    el.docUploadInput.addEventListener("change", () => uploadDocs(el.docUploadInput.files));
    el.docSearchInput.addEventListener("input", renderDocList);
    el.docTitleInput.addEventListener("change", updateSelectedDocTitle);
    el.docTitleInput.addEventListener("blur", updateSelectedDocTitle);
    el.deleteDocButton.addEventListener("click", deleteSelectedDoc);
    el.fitButton.addEventListener("click", fitToViewport);
    el.addGroupButton.addEventListener("click", (event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      addGroup();
    });
    document.addEventListener("click", (event) => {
      if (event.target === el.addGroupButton) {
        event.preventDefault();
        event.stopPropagation();
        addGroup();
      }
    }, true);
    document.addEventListener("pointerdown", (event) => {
      if (event.target instanceof Element && event.target.closest(".group-context-menu")) {
        return;
      }
      hideGroupContextMenu();
      if (
        event.target instanceof Element &&
        (event.target === el.searchInput ||
          event.target === el.searchButton ||
          event.target.closest("#searchResults"))
      ) {
        return;
      }
      hideSearchResults();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hideGroupContextMenu();
    });
    el.setBackupButton.addEventListener("click", setBackupFile);
    el.groupNameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addGroup();
      }
    });

    // Auto-name bindings
    el.autoNameToggle.addEventListener("change", function() {
      state.autoNameEnabled = el.autoNameToggle.checked;
      el.autoNameCompact.hidden = !state.autoNameEnabled;
      el.autoNameExpandBtn.hidden = !state.autoNameEnabled;
      el.autoNameAdvanced.hidden = true;
      if (state.autoNameEnabled) {
        if (state.autoNameSegments.length === 0) {
          var parsed = parseTemplateToSegments("3103.21.#");
          state.autoNameSegments = parsed.segments;
          state.autoNameSeparators = parsed.separators;
          state.autoNamePrimaryIdx = parsed.primaryIdx;
          el.autoNameTemplate.value = "3103.21.#";
        }
        resetAutoNameInit();
        initAutoNameFromExisting();
      } else {
        el.autoNamePreview.innerHTML = "";
      }
      saveAutoNameSettings();
    });

    el.autoNameExpandBtn.addEventListener("click", function() {
      var advanced = el.autoNameAdvanced;
      var isHidden = advanced.hidden;
      advanced.hidden = !isHidden;
      el.autoNameExpandBtn.textContent = isHidden ? "Hide" : "Settings";
      if (isHidden) renderAutoNameAdvanced();
    });

    el.autoNameTemplate.addEventListener("change", applyTemplateChange);
    el.autoNameTemplate.addEventListener("blur", applyTemplateChange);
    el.batchCodeInput.addEventListener("input", function() {
      syncBatchCodesFromInput({ pickFirstMissing: true });
      updateBatchCodePanel();
    });
    el.startBatchCodeButton.addEventListener("click", startOrPauseBatchCodes);
    el.clearBatchCodeButton.addEventListener("click", clearBatchCodes);
    [el.viewport, el.stage, el.image, el.minimapImage].forEach((target) => {
      target.addEventListener("dragstart", (event) => event.preventDefault());
      target.addEventListener("dragover", (event) => event.preventDefault());
      target.addEventListener("drop", (event) => event.preventDefault());
      target.addEventListener("selectstart", (event) => {
        if (!isTypingTarget(event.target)) event.preventDefault();
      });
    });
    document.addEventListener("dragstart", preventNativeDrag);
    document.addEventListener("dragover", preventNativeDrag);
    document.addEventListener("drop", preventNativeDrag);
    el.minimap.addEventListener("pointerdown", (event) => event.stopPropagation());
    el.minimap.addEventListener("click", (event) => event.stopPropagation());
    el.minimap.addEventListener("wheel", (event) => {
      event.preventDefault();
      event.stopPropagation();
      el.minimapList.scrollTop += event.deltaY;
    }, { passive: false });
    el.minimapBody.addEventListener("pointerdown", (event) => event.stopPropagation());
    el.minimapBody.addEventListener("click", (event) => {
      event.stopPropagation();
      centerFromMinimap(event);
    });
    el.showAnnotations.addEventListener("change", () => {
      state.annotationsVisible = el.showAnnotations.checked;
      renderOverlay();
    });
    el.showLabels.addEventListener("change", () => {
      state.labelsVisible = el.showLabels.checked;
      renderOverlay();
    });
    el.viewport.addEventListener("pointerdown", handlePointerDown);
    el.viewport.addEventListener("pointermove", handlePointerMove);
    el.viewport.addEventListener("pointerup", handlePointerUp);
    el.viewport.addEventListener("pointercancel", handlePointerUp);
    el.viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, event.deltaY);
    }, { passive: false });
    el.searchButton.addEventListener("click", search);
    el.searchInput.addEventListener("input", search);
    el.searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") search();
    });
    window.addEventListener("keydown", handleGlobalKeydown);
    el.annotationForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const selected = getSelected();
      if (!selected) return;
      const nextCode = el.pointCode.value.trim();
      const nextNote = el.pointNote.value.trim();
      if (selected.code === nextCode && selected.note === nextNote) return;
      recordUndoSnapshot("编辑点位");
      selected.code = nextCode;
      selected.note = nextNote;
      selected.updatedAt = new Date().toISOString();
      saveData();
      renderDrawingList();
      renderOverlay();
      setStatus("标注已保存。");
    });
    el.deleteAnnotation.addEventListener("click", deleteSelectedAnnotation);
    el.exportButton.addEventListener("click", exportData);
    el.importInput.addEventListener("change", () => importData(el.importInput.files[0]));
    window.addEventListener("resize", renderOverlay);
    el.image.addEventListener("load", () => {
      clearTimeout(el.image._loadTimeout);
      el.viewport.classList.remove("loading");
      el.currentDrawingTitle.textContent = currentDrawing()?.title || "";
      console.log("Image loaded: " + el.image.src.split("/").pop() + " " + el.image.naturalWidth + "x" + el.image.naturalHeight);
      state.imageSize.width = el.image.naturalWidth;
      state.imageSize.height = el.image.naturalHeight;
      el.stage.style.width = `${state.imageSize.width}px`;
      el.stage.style.height = `${state.imageSize.height}px`;
      fitToViewport();
      if (state.highlightedId) {
        const annotation = state.annotations.find((item) => item.id === state.highlightedId);
        if (annotation) {
          zoomToAnnotation(annotation);
        }
        window.clearTimeout(focusAnnotation.timer);
        focusAnnotation.timer = window.setTimeout(() => {
          state.highlightedId = null;
          renderOverlay();
        }, 3000);
      }
      renderOverlay();
      renderMinimap();
    });
    el.image.addEventListener("error", () => {
      clearTimeout(el.image._loadTimeout);
      el.viewport.classList.remove("loading");
      el.currentDrawingTitle.textContent = (currentDrawing()?.title || "") + " 加载失败";
      setTimeout(function() {
        if (el.currentDrawingTitle.textContent.indexOf("加载失败") >= 0) {
          el.currentDrawingTitle.textContent = currentDrawing()?.title || "";
        }
      }, 5000);
    });
  }

  function startManifestSync() {
    window.setInterval(async () => {
      const drawingsChanged = await loadDrawingManifest();
      if (drawingsChanged) {
        renderDrawingList();
        switchDrawing(state.currentDrawingId);
      }

      const docsChanged = await loadRepoTrainingDocs();
      if (docsChanged && state.activeModule === "docs") {
        renderDocsModule();
      }
    }, 5000);
  }

  await loadDrawingManifest();
  loadData();
  restoreCurrentDrawingLocal();
  loadAutoNameSettings();
  loadDocsData();
  await loadRepoTrainingDocs();
  bindEvents();
  startManifestSync();
  await initSync();
  syncAutoGroupsForAllDrawings();
  restoreCurrentDrawingLocal();
  renderDrawingList();
  renderDocsModule();

  switchDrawing(state.currentDrawingId);
  setTool("pan");

  // Sync auto-name UI
  if (state.autoNameEnabled) {
    el.autoNameToggle.checked = true;
    el.autoNameCompact.hidden = false;
    el.autoNameExpandBtn.hidden = false;
    el.autoNameTemplate.value = segmentsToTemplate(state.autoNameSegments, state.autoNameSeparators);
    updateAutoNamePreview();
  }
  updateBatchCodePanel();
})();
