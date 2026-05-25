(function () {
  const STORAGE_KEY = "baggage-point-finder-v1";
  const DOCS_KEY = "baggage-training-docs-v1";
  const SVG_NS = "http://www.w3.org/2000/svg";

  const drawings = [
    { id: "b1", title: "B1层", image: "assets/floors/b1.png" },
    { id: "f1", title: "1层", image: "assets/floors/f1.png" },
    { id: "f2", title: "2层", image: "assets/floors/f2.png" },
    { id: "f3", title: "3层", image: "assets/floors/f3.png" },
    { id: "f3-transfer", title: "3层开包间", image: "assets/floors/f3-transfer.png" },
    { id: "f4", title: "4层", image: "assets/floors/f4.png" },
    { id: "overview-2d", title: "2D总览", image: "assets/floors/overview-2d.png" },
    { id: "overview-3d", title: "3D总览", image: "assets/floors/overview-3d.png" }
  ];

  const state = {
    currentDrawingId: drawings[0].id,
    tool: "pan",
    annotationsVisible: true,
    labelsVisible: false,
    annotations: [],
    groups: [],
    collapsedGroups: {},
    selectedForGroupMove: new Set(),
    activeGroupId: "",
    selectedId: null,
    highlightedId: null,
    transform: { x: 0, y: 0, scale: 1 },
    imageSize: { width: 1, height: 1 },
    drag: null,
    draft: null,
    autoNameEnabled: false,
    autoNameSegments: [],
    autoNameSeparators: [],
    autoNamePrimaryIdx: -1,
    activeModule: "points",
    docFolders: [],
    docs: [],
    activeFolderId: "",
    selectedDocId: null
  };

  const el = {
    drawingList: document.getElementById("drawingList"),
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
    moduleTabs: document.querySelectorAll(".module-tab"),
    pointModule: document.getElementById("pointModule"),
    docsModule: document.getElementById("docsModule"),
    folderNameInput: document.getElementById("folderNameInput"),
    folderParentSelect: document.getElementById("folderParentSelect"),
    addFolderButton: document.getElementById("addFolderButton"),
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

  function loadData() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      raw = localStorage.getItem(BACKUP_KEY);
      if (raw) setStatus("已从备份恢复数据。");
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

    var totalAnnotations = Array.isArray(parsed.annotations) ? parsed.annotations.length : 0;
    console.log(
      "Data loaded: " + state.annotations.length + "/" + totalAnnotations + " annotations, " +
      state.groups.length + " groups"
    );
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
      setStatus("当前浏览器不支持文件系统访问，请使用 Chrome 或 Edge。");
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
        setStatus("备份文件已设置。数据将自动保存到该文件。");
      };
    }).catch(function(e) {
      if (e.name !== "AbortError") {
        console.error("File picker error:", e);
        setStatus("设置备份文件失败。");
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
    var payload = {
      version: 1,
      drawings: drawings.map(function(d) { return { id: d.id, title: d.title, image: d.image }; }),
      groups: state.groups,
      collapsedGroups: state.collapsedGroups,
      annotations: state.annotations
    };
    var json = JSON.stringify(payload);
    try {
      localStorage.setItem(STORAGE_KEY, json);
      localStorage.setItem(BACKUP_KEY, json);
    } catch (error) {
      setStatus("保存失败，可能存储空间不足。请导出数据备份。");
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

  function docUid() {
    return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function folderUid() {
    return `fld-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function renameGroup(groupId, newName) {
    var name = String(newName || "").trim();
    if (!name) return false;
    var group = state.groups.find(function(g) { return g.id === groupId; });
    if (!group) return false;
    if (state.groups.some(function(g) { return g.id !== groupId && g.name === name; })) {
      setStatus("分组名已存在。");
      return false;
    }
    group.name = name;
    saveData();
    renderDrawingList();
    updateEditor();
    setStatus("分组已重命名。");
    return true;
  }

  function currentDrawing() {
    return drawings.find((drawing) => drawing.id === state.currentDrawingId);
  }

  function currentAnnotations() {
    return state.annotations.filter((annotation) => annotation.drawingId === state.currentDrawingId);
  }

  function groupTitle(groupId) {
    if (!groupId) return "未分组";
    return state.groups.find((group) => group.id === groupId)?.name || "未分组";
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
        sep = ""; // No separator, e.g., "E#" or "#号卸载线"
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
        // Number at beginning: match suffix (e.g., "#号卸载线")
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
    var settings = {
      enabled: state.autoNameEnabled,
      segments: state.autoNameSegments,
      separators: state.autoNameSeparators,
      primaryIdx: state.autoNamePrimaryIdx
    };
    try {
      localStorage.setItem("baggage-autoname", JSON.stringify(settings));
    } catch (e) {}
  }

  function loadAutoNameSettings() {
    var raw = localStorage.getItem("baggage-autoname");
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
    previewBar.innerHTML = '<span style="color:var(--muted);">下次点击将生成：</span> <strong style="font-family:monospace;font-size:15px;color:var(--accent);">' + previewNextName() + '</strong>';
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
        addSet("步长", "step", 1); addSet("进位阈值", "carryAt", 0);
        addSet("进位增量", "carryAmount", 1); addSet("重置为", "resetTo", 0);

        var primLbl = document.createElement("label");
        var primCheck = document.createElement("input"); primCheck.type = "checkbox"; primCheck.checked = (i === prim);
        primCheck.addEventListener("change", (function(idx) { return function() {
          if (this.checked) state.autoNamePrimaryIdx = idx;
          syncTemplateFromSegments(); saveAutoNameSettings(); renderAutoNameAdvanced();
          updateAutoNamePreview();
        }; })(i));
        primLbl.appendChild(primCheck); primLbl.appendChild(document.createTextNode("主递增"));
        setDiv.appendChild(primLbl);
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

    var addBtn = document.createElement("button"); addBtn.className = "auto-name-add-seg"; addBtn.textContent = "+ 段";
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
      bar.innerHTML = '<span style="color:var(--muted);">下次点击将生成：</span> <strong style="font-family:monospace;font-size:15px;color:var(--accent);">' + (next || "—") + '</strong>';
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
    el.modeHint.textContent = {
      pan: "拖动画布浏览，滚轮缩放。1切换拖动，2切换点标注，F适配。",
      point: "点击画布添加点标注。Esc取消选择，Delete删除选中。"
    }[tool];
    renderOverlay();
  }

  function renderDrawingList() {
    el.drawingList.innerHTML = "";
    for (const drawing of drawings) {
      const count = state.annotations.filter((item) => item.drawingId === drawing.id).length;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "drawing-item";
      button.dataset.id = drawing.id;
      button.innerHTML = `${escapeHtml(drawing.title)}<small>${count} 个标注</small>`;
      button.classList.toggle("active", drawing.id === state.currentDrawingId);
      button.addEventListener("click", () => switchDrawing(drawing.id));
      el.drawingList.appendChild(button);
    }
  }

  function switchDrawing(drawingId, options = {}) {
    state.currentDrawingId = drawingId;
    state.selectedId = options.selectedId || null;
    state.highlightedId = options.highlightedId || null;
    const drawing = currentDrawing();
    el.currentDrawingTitle.textContent = drawing.title;
    el.image.src = drawing.image;
    el.minimapImage.src = drawing.image;
    renderDrawingList();
    updateEditor();
  }

  function renderOverlay(options = {}) {
    el.overlay.innerHTML = "";
    el.overlay.setAttribute("width", state.imageSize.width);
    el.overlay.setAttribute("height", state.imageSize.height);
    el.overlay.setAttribute("viewBox", `0 0 ${state.imageSize.width} ${state.imageSize.height}`);

    const visibleIds = new Set();
    if (state.annotationsVisible) {
      for (const annotation of currentAnnotations()) visibleIds.add(annotation.id);
    }
    if (state.highlightedId) visibleIds.add(state.highlightedId);
    if (state.selectedId) visibleIds.add(state.selectedId);

    for (const annotation of currentAnnotations()) {
      if (!visibleIds.has(annotation.id)) continue;
      drawAnnotation(annotation);
    }

    const count = currentAnnotations().length;
    el.annotationCount.textContent = `${count} 个标注`;
    if (options.renderMinimap !== false) renderMinimap();
  }

  function renderOverlayOnly() {
    renderOverlay({ renderMinimap: false });
  }

  function renderMinimap(options = {}) {
    if (!state.imageSize.width || !el.minimapBody) return;
    const annotations = currentAnnotations();
    if (el.minimapCount) {
      el.minimapCount.textContent = `${annotations.length} 个点位`;
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
    const annotations = currentAnnotations();
    el.minimapList.innerHTML = "";

    const groupBuckets = new Map();
    groupBuckets.set("", []);
    for (const group of state.groups) groupBuckets.set(group.id, []);
    for (const annotation of annotations) {
      const groupId = state.groups.some((group) => group.id === annotation.groupId) ? annotation.groupId : "";
      groupBuckets.get(groupId).push(annotation);
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
    for (const [groupId, groupedAnnotations] of groupBuckets) {
      if (groupedAnnotations.length === 0 && groupId !== "") {
        const section = document.createElement("section");
        section.className = "minimap-group";
        const heading = document.createElement("div");
        heading.className = "minimap-group-title";
        heading.dataset.groupId = groupId;
        const groupInput = document.createElement("input");
        groupInput.type = "text";
        groupInput.className = "minimap-group-name";
        groupInput.value = groupTitle(groupId);
        groupInput.setAttribute("aria-label", "分组名称");
        groupInput.addEventListener("pointerdown", function(ev) { ev.stopPropagation(); });
        groupInput.addEventListener("click", function(ev) { ev.stopPropagation(); });
        groupInput.addEventListener("dblclick", function(ev) { ev.stopPropagation(); groupInput.select(); });
        groupInput.addEventListener("change", function() {
          if (renameGroup(groupId, groupInput.value)) {
            groupInput.value = groupTitle(groupId);
          }
        });
        groupInput.addEventListener("blur", function() {
          if (renameGroup(groupId, groupInput.value)) {
            groupInput.value = groupTitle(groupId);
          }
        });
        groupInput.addEventListener("keydown", function(ev) {
          if (ev.key === "Enter") { ev.preventDefault(); groupInput.blur(); }
        });
        heading.appendChild(groupInput);
        const count = document.createElement("small");
        count.textContent = "0 个点位";
        heading.appendChild(count);

        // Delete group button
        var delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "minimap-item-delete";
        delBtn.textContent = "删";
        delBtn.style.cssText = "min-height:22px;padding:0 5px;font-size:10px;";
        delBtn.addEventListener("pointerdown", function(ev) { ev.stopPropagation(); });
        delBtn.addEventListener("click", function(ev) {
          ev.stopPropagation();
          if (ev.shiftKey) {
            deleteGroupWithAnnotations(groupId);
          } else {
            deleteGroup(groupId);
          }
        });
        heading.appendChild(delBtn);

        heading.addEventListener("pointerdown", (event) => event.stopPropagation());
        heading.addEventListener("click", (event) => {
          event.stopPropagation();
          if (state.selectedForGroupMove.size > 0) {
            moveSelectedAnnotationsToGroup(groupId);
            return;
          }
          state.activeGroupId = groupId;
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
      section.classList.toggle("collapsed", Boolean(state.collapsedGroups[groupId]));

      const heading = document.createElement("div");
      heading.className = "minimap-group-title";
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
      groupInput.setAttribute("aria-label", "分组名称");
      groupInput.addEventListener("pointerdown", function(ev) { ev.stopPropagation(); });
      groupInput.addEventListener("click", function(ev) { ev.stopPropagation(); });
      groupInput.addEventListener("dblclick", function(ev) { ev.stopPropagation(); groupInput.select(); });
      groupInput.addEventListener("change", function() {
        renameGroup(groupId, groupInput.value);
      });
      groupInput.addEventListener("blur", function() {
        if (renameGroup(groupId, groupInput.value)) {
          groupInput.value = groupTitle(groupId);
        }
      });
      groupInput.addEventListener("keydown", function(ev) {
        if (ev.key === "Enter") { ev.preventDefault(); groupInput.blur(); }
      });

      const count = document.createElement("small");
      count.textContent = `${groupedAnnotations.length} 个点位`;

      heading.appendChild(toggleButton);
      heading.appendChild(groupInput);
      heading.appendChild(count);

      // Delete group button
      var delGrpBtn = document.createElement("button");
      delGrpBtn.type = "button";
      delGrpBtn.className = "minimap-item-delete";
      delGrpBtn.textContent = "删";
      delGrpBtn.style.cssText = "min-height:22px;padding:0 5px;font-size:10px;";
      delGrpBtn.addEventListener("pointerdown", function(ev) { ev.stopPropagation(); });
      delGrpBtn.addEventListener("click", function(ev) {
        ev.stopPropagation();
        if (ev.shiftKey) {
          deleteGroupWithAnnotations(groupId);
        } else {
          deleteGroup(groupId);
        }
      });
      heading.appendChild(delGrpBtn);

      heading.addEventListener("pointerdown", (event) => event.stopPropagation());
      heading.addEventListener("click", (event) => {
        event.stopPropagation();
        if (state.selectedForGroupMove.size > 0) {
          moveSelectedAnnotationsToGroup(groupId);
          return;
        }
        state.activeGroupId = groupId;
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

      for (const annotation of groupedAnnotations) {
        runningIndex += 1;
      const row = document.createElement("div");
      row.className = "minimap-item";
      row.dataset.id = annotation.id;
      row.draggable = true;
      row.classList.toggle("active", annotation.id === state.selectedId);
      row.classList.toggle("checked", state.selectedForGroupMove.has(annotation.id));
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
      batchCheck.addEventListener("click", (event) => event.stopPropagation());
      batchCheck.addEventListener("change", () => {
        if (batchCheck.checked) {
          state.selectedForGroupMove.add(annotation.id);
        } else {
          state.selectedForGroupMove.delete(annotation.id);
        }
        row.classList.toggle("checked", batchCheck.checked);
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
        saveData();
        renderDrawingList();
        updateEditor();
        renderOverlayOnly();
      });
      title.addEventListener("blur", () => {
        saveData();
        renderDrawingList();
        updateEditor();
        renderOverlayOnly();
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "minimap-item-delete";
      deleteButton.textContent = "删";
      deleteButton.addEventListener("pointerdown", (event) => event.stopPropagation());
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteAnnotationById(annotation.id);
      });

      row.appendChild(batchCheck);
      row.appendChild(indexBadge);
      row.appendChild(title);
      row.appendChild(deleteButton);
        section.appendChild(row);
      }

      el.minimapList.appendChild(section);
    }
  }

  function markActiveMinimapItem(id) {
    if (!el.minimapList) return;
    el.minimapList.querySelectorAll(".minimap-item").forEach((row) => {
      row.classList.toggle("active", row.dataset.id === id);
    });
  }

  function drawAnnotation(annotation) {
    const center = annotationCenter(annotation);
    const shape = document.createElementNS(SVG_NS, "circle");
    shape.classList.add("annotation-shape", "point-shape");
    shape.classList.toggle("selected", annotation.id === state.selectedId);
    shape.classList.toggle("highlight", annotation.id === state.highlightedId);
    shape.classList.toggle("inactive", state.tool !== "pan");
    shape.dataset.id = annotation.id;
    shape.setAttribute("cx", center.x);
    shape.setAttribute("cy", center.y);
    shape.setAttribute("r", 3.5 / Math.sqrt(state.transform.scale));

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
      annotation.id === state.selectedId ||
      annotation.id === state.highlightedId
    );
    if (shouldShowLabel) {
      const label = document.createElementNS(SVG_NS, "text");
      label.classList.add("annotation-label");
      label.setAttribute("x", center.x + 6);
      label.setAttribute("y", center.y - 6);
      label.textContent = annotation.code || "未命名";
      el.overlay.appendChild(label);
    }
  }

  function selectAnnotation(id) {
    state.selectedId = id;
    const selected = getSelected();
    if (selected) {
      el.pointCode.value = selected.code || "";
      el.pointNote.value = selected.note || "";
    }
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

    const existing = state.groups.find((group) => group.name === name);
    if (existing) {
      el.groupNameInput.value = "";
      setStatus("分组已存在。");
      return;
    }

    state.groups.push({
      id: groupUid(),
      name,
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

    var count = state.annotations.filter(function(a) { return a.groupId === groupId; }).length;
    var msg = count > 0
      ? "删除分组 \"" + group.name + "\"？将保留 " + count + " 个标注并移入未分组。"
      : "删除空分组 \"" + group.name + "\"？";

    if (!window.confirm(msg)) return;

    // Move annotations to ungrouped
    for (var i = 0; i < state.annotations.length; i++) {
      if (state.annotations[i].groupId === groupId) {
        state.annotations[i].groupId = "";
        state.annotations[i].updatedAt = new Date().toISOString();
      }
    }

    // Remove group
    state.groups = state.groups.filter(function(g) { return g.id !== groupId; });
    if (state.activeGroupId === groupId) state.activeGroupId = "";

    saveData();
    renderDrawingList();
    renderMinimapList();
    setStatus("分组已删除。" + (count > 0 ? " 标注已移入未分组。" : ""));
  }

  function deleteGroupWithAnnotations(groupId) {
    if (!groupId) return;
    var group = state.groups.find(function(g) { return g.id === groupId; });
    if (!group) return;

    var count = state.annotations.filter(function(a) { return a.groupId === groupId; }).length;
    var msg = "删除分组 \"" + group.name + "\" 及其中 " + count + " 个标注？此操作不可恢复。";

    if (!window.confirm(msg)) return;

    // Delete annotations in group
    state.annotations = state.annotations.filter(function(a) { return a.groupId !== groupId; });

    // Remove group
    state.groups = state.groups.filter(function(g) { return g.id !== groupId; });
    if (state.activeGroupId === groupId) state.activeGroupId = "";

    resetAutoNameInit();
    initAutoNameFromExisting();
    saveData();
    renderDrawingList();
    renderMinimapList();
    updateEditor();
    setStatus("分组及 " + count + " 个标注已删除。");
  }

  function moveAnnotationToGroup(annotationId, groupId) {
    const annotation = state.annotations.find((item) => item.id === annotationId);
    if (!annotation) return;

    annotation.groupId = groupId;
    annotation.updatedAt = new Date().toISOString();
    saveData();
    renderMinimapList();
    setStatus(groupId ? `已移入 ${groupTitle(groupId)}。` : "已移入未分组。");
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
    let moved = 0;
    for (const annotation of state.annotations) {
      if (!ids.has(annotation.id)) continue;
      annotation.groupId = groupId;
      annotation.updatedAt = new Date().toISOString();
      moved += 1;
    }
    state.selectedForGroupMove.clear();
    saveData();
    renderMinimapList();
    setStatus(groupId ? `已将 ${moved} 个点位移入 ${groupTitle(groupId)}。` : `已将 ${moved} 个点位移入未分组。`);
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
    var code = generateAutoName();
    var annotation = {
      id: uid(),
      drawingId: state.currentDrawingId,
      type: type,
      groupId: state.activeGroupId,
      code: code,
      note: "",
      points: imagePoints.map(normalize),
      createdAt: now,
      updatedAt: now
    };
    state.annotations.push(annotation);
    saveData();
    renderDrawingList();
    renderOverlay();
    selectAnnotation(annotation.id);
    setStatus(code ? "已新增: " + code : "已新增点位。");
  }

  function beginMoveAnnotation(event, id) {
    const start = screenToImage(event.clientX, event.clientY);
    const annotation = state.annotations.find((item) => item.id === id);
    state.drag = {
      type: "move-annotation",
      id,
      start,
      originalPoints: annotation.points.map((point) => ({ ...point }))
    };
    el.overlay.setPointerCapture(event.pointerId);
  }

  function handlePointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();

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
    if (!state.drag) return;

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
    if (!state.drag) return;

    if (state.drag.type === "move-annotation") {
      saveData();
      renderDrawingList();
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

    if (event.key === "Escape") {
      event.preventDefault();
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

  function search() {
    const query = el.searchInput.value.trim().toLowerCase();
    el.searchResults.innerHTML = "";
    if (!query) return;

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
      button.innerHTML = `${escapeHtml(match.code || "未命名")}<small>${escapeHtml(drawing.title)} ${escapeHtml(match.note || "")}</small>`;
      button.addEventListener("click", () => focusAnnotation(match.id));
      el.searchResults.appendChild(button);
    }

    if (matches.length === 1) focusAnnotation(matches[0].id);
  }

  function focusAnnotation(id) {
    const annotation = state.annotations.find((item) => item.id === id);
    if (!annotation) return;
    state.selectedId = id;
    state.highlightedId = id;
    if (annotation.drawingId !== state.currentDrawingId) {
      switchDrawing(annotation.drawingId, { selectedId: id, highlightedId: id });
      return;
    }
    centerOnAnnotation(annotation);
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
    const scale = Math.min(rect.width / (boundsWidth * 3), rect.height / (boundsHeight * 3));

    state.transform.scale = clamp(scale, 0.25, 5);
    state.transform.x = rect.width / 2 - center.x * state.transform.scale;
    state.transform.y = rect.height / 2 - center.y * state.transform.scale;
    applyTransform();
  }

  function focusAnnotationFromOverview(id) {
    const annotation = state.annotations.find((item) => item.id === id);
    if (!annotation) return;

    state.selectedId = id;
    state.highlightedId = id;
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

    state.selectedId = id;
    state.highlightedId = id;

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
    link.download = `baggage-points-${new Date().toISOString().slice(0, 10)}.json`;
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
        state.groups = Array.isArray(parsed.groups) ? parsed.groups.map(toGroup).filter(Boolean) : [];
        state.collapsedGroups = parsed.collapsedGroups && typeof parsed.collapsedGroups === "object" ? parsed.collapsedGroups : {};
        state.annotations = parsed.annotations.map(toPointAnnotation).filter(Boolean);
        saveData();
        state.selectedId = null;
        state.highlightedId = null;
        renderDrawingList();
        renderOverlay();
        updateEditor();
        resetAutoNameInit();
        initAutoNameFromExisting();
        setStatus("导入完成。");
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
    const payload = {
      version: 1,
      folders: state.docFolders,
      docs: state.docs,
      activeFolderId: state.activeFolderId,
      selectedDocId: state.selectedDocId
    };
    localStorage.setItem(DOCS_KEY, JSON.stringify(payload));
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
        const button = document.createElement("button");
        button.type = "button";
        button.className = "folder-item";
        button.style.marginLeft = `${depth * 14}px`;
        button.classList.toggle("active", state.activeFolderId === folder.id);
        button.innerHTML = `<span>${escapeHtml(folder.name)}</span><small>${count} 篇文档</small>`;
        button.addEventListener("click", () => {
          state.activeFolderId = folder.id;
          saveDocsData();
          renderDocsModule();
        });
        el.folderTree.appendChild(button);
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
    el.docsCount.textContent = `${docs.length} 篇文档`;

    if (docs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "minimap-empty";
      empty.textContent = "当前目录暂无文档";
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
    el.docMeta.textContent = `${doc.sourceFileName || "DOCX"} · ${folderTitle(doc.folderId)} · ${new Date(doc.createdAt).toLocaleString()}`;
    el.docBody.innerHTML = doc.htmlContent || `<div class="doc-body-placeholder">DOCX 已加入资料库。当前版本先保存目录、标题和文件信息；后续接入 Word 解析库后，这里会显示正文内容，并可识别点位编号做联动。</div>`;
  }

  function renderDocsModule() {
    renderFolderParentOptions();
    renderFolderTree();
    renderDocList();
    renderDocReader();
  }

  function addDocFolder() {
    const name = el.folderNameInput.value.trim();
    if (!name) {
      el.folderNameInput.focus();
      return;
    }
    state.docFolders.push({
      id: folderUid(),
      name,
      parentId: el.folderParentSelect.value || "",
      createdAt: new Date().toISOString()
    });
    el.folderNameInput.value = "";
    saveDocsData();
    renderDocsModule();
  }

  function uploadDocs(files) {
    const list = Array.from(files || []);
    if (list.length === 0) return;
    for (const file of list) {
      state.docs.push({
        id: docUid(),
        title: file.name.replace(/\.docx$/i, ""),
        folderId: state.activeFolderId || "",
        sourceFileName: file.name,
        size: file.size,
        type: file.type,
        linkedPointIds: [],
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        htmlContent: ""
      });
    }
    state.selectedDocId = state.docs[state.docs.length - 1]?.id || null;
    el.docUploadInput.value = "";
    saveDocsData();
    renderDocsModule();
  }

  function updateSelectedDocTitle() {
    const doc = state.docs.find((item) => item.id === state.selectedDocId);
    if (!doc) return;
    doc.title = el.docTitleInput.value.trim() || doc.sourceFileName || "未命名文档";
    doc.updatedAt = new Date().toISOString();
    saveDocsData();
    renderDocsModule();
  }

  function deleteSelectedDoc() {
    if (!state.selectedDocId) return;
    state.docs = state.docs.filter((doc) => doc.id !== state.selectedDocId);
    state.selectedDocId = null;
    saveDocsData();
    renderDocsModule();
  }

  function bindEvents() {
    const preventNativeDrag = (event) => {
      if (
        event.target instanceof Element &&
        !isTypingTarget(event.target) &&
        (event.target.closest("#viewport") || event.target.closest(".minimap"))
      ) {
        event.preventDefault();
      }
    };

    document.querySelectorAll(".tool-button").forEach((button) => {
      button.addEventListener("click", () => setTool(button.dataset.tool));
    });
    el.moduleTabs.forEach((button) => {
      button.addEventListener("click", () => switchModule(button.dataset.module));
    });
    el.addFolderButton.addEventListener("click", addDocFolder);
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
      el.autoNameExpandBtn.textContent = isHidden ? "▲" : "⚙";
      if (isHidden) renderAutoNameAdvanced();
    });

    el.autoNameTemplate.addEventListener("change", applyTemplateChange);
    el.autoNameTemplate.addEventListener("blur", applyTemplateChange);
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
      selected.code = el.pointCode.value.trim();
      selected.note = el.pointNote.value.trim();
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
      state.imageSize.width = el.image.naturalWidth;
      state.imageSize.height = el.image.naturalHeight;
      el.stage.style.width = `${state.imageSize.width}px`;
      el.stage.style.height = `${state.imageSize.height}px`;
      fitToViewport();
      if (state.highlightedId) {
        const annotation = state.annotations.find((item) => item.id === state.highlightedId);
        if (annotation) centerOnAnnotation(annotation);
        window.clearTimeout(focusAnnotation.timer);
        focusAnnotation.timer = window.setTimeout(() => {
          state.highlightedId = null;
          renderOverlay();
        }, 3000);
      }
      renderOverlay();
      renderMinimap();
    });
  }

  loadData();
  loadAutoNameSettings();
  loadDocsData();
  bindEvents();
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
})();
