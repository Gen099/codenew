// ===== CREATOR WORKSPACE  TASK COMBO ENGINE =====
// A "Task Combo" = closed-loop production pipeline:
//   1. Select images (from library or upload)
//   2. (Optional) Batch edit all images in folder with same preset/effect
//   3. Set video mode per image: Image-to-Video OR First-Last Frame
//   4. Create video(s)
//   5. QC: send to Telegram (individual or batch), see Approve/Reject + reason
//   6. Mark used images to prevent reuse
//
// Layout: LEFT=Image Source | CENTER=Task Combos (table) | RIGHT=Output/Library (collapsible)

// ---- STATE ----
let taskCombos = [];
let activeComboIdx = 0;
let comboCounter = 0;
let libraryOpen = true;
let batchEditVisible = false;
let selectedImageIds = [];
let bulkSelectMode = false;
let creatorPresenceTimer = 0;
let creatorAssetsLoaded = false;
let recalcAllCostsTimer = 0;
let creatorDraftSaveTimer = 0;
let creatorRealtimePollTimer = 0;
let creatorUploadProgressVisible = false;
let creatorLastQCSyncAt = 0;
let creatorLastLibraryRenderSignature = '';

// ---- DATA ALIASES (point to unified AppData) ----
const DEMO_IMAGES = AppData.images;
const DEMO_LIBRARY = AppData.library;
const PRESETS = AppData.presets;
const CAMERA_MOVES = AppData.cameraMoves;
const MODELS = [AppData.model];
const VIDEO_EFFECT_GROUPS = [
  { id: 'none', label: '-- None --' },
  { id: 'add_interior', label: 'Th\u00eam n\u1ed9i th\u1ea5t' },
  { id: 'four_seasons', label: '4 M\u00f9a' },
  { id: 'day_to_night', label: 'Ng\u00e0y sang \u0111\u00eam' },
  { id: 'noel_decor', label: 'Trang tr\u00ed Noel' },
  { id: 'add_person', label: 'Th\u00eam ng\u01b0\u1eddi' },
  { id: 'explosion', label: 'V\u1ee5 n\u1ed5' },
  { id: 'fire_effect', label: 'Hi\u1ec7u \u1ee9ng l\u1eeda' },
  { id: 'partial_build', label: 'X\u00e2y d\u1ef1ng t\u1eebng ph\u1ea7n' },
  { id: 'custom', label: 'T\u00f9y ch\u1ecdn kh\u00e1c' },
];

function getEffectGroupLabel(effectGroup) {
  const key = String(effectGroup || '').trim().toLowerCase() || 'none';
  const found = VIDEO_EFFECT_GROUPS.find((row) => String(row.id || '').trim().toLowerCase() === key);
  return found ? found.label : '-- None --';
}

function getTaskEffectDisplay(task) {
  const key = String(task?.effectGroup || '').trim().toLowerCase() || 'none';
  if (key === 'none') return '-- None --';
  if (key === 'custom') {
    const customText = String(task?.effectGroupCustom || '').trim();
    if (customText) return customText;
  }
  return getEffectGroupLabel(key);
}

function getComboEffectSummary(combo) {
  const tasks = Array.isArray(combo?.tasks) ? combo.tasks : [];
  const map = new Map();
  tasks.forEach((task) => {
    const key = getTaskEffectDisplay(task);
    map.set(key, Number(map.get(key) || 0) + 1);
  });
  if (map.size === 0) return '';
  let bestKey = '';
  let bestCount = -1;
  for (const [key, count] of map.entries()) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }
  return bestKey || '';
}

function getCreatorSessionId() {
  const activeShiftId = String(AppData?.activeShift?.id || '').trim();
  if (activeShiftId) return activeShiftId;
  const scopedUser = (typeof getScopeUsername === 'function') ? String(getScopeUsername() || '').trim() : '';
  return scopedUser || String(AppData?.currentUser?.username || '').trim() || 'default';
}

function getCreatorDraftStorageKey() {
  const scopedUser = (typeof getScopeUsername === 'function')
    ? String(getScopeUsername() || '').trim().toLowerCase()
    : String(AppData?.currentUser?.username || '').trim().toLowerCase();
  return `creatorDraft:${scopedUser || 'default'}`;
}

function serializeCreatorDraftTask(task) {
  const nextTask = task && typeof task === 'object' ? { ...task } : createDefaultTask();
  delete nextTask.__inflight;
  if (!Array.isArray(nextTask.runHistory)) nextTask.runHistory = [];
  return nextTask;
}

function saveCreatorDraftState() {
  try {
    const payload = {
      activeComboIdx: Number(activeComboIdx || 0),
      comboCounter: Number(comboCounter || 0),
      libraryOpen: !!libraryOpen,
      taskCombos: Array.isArray(taskCombos)
        ? taskCombos.map((combo, idx) => ({
            id: combo?.id || idx + 1,
            name: String(combo?.name || `CODE-${String(idx + 1).padStart(2, '0')}`),
            qcMode: String(combo?.qcMode || 'individual'),
            tasks: Array.isArray(combo?.tasks) ? combo.tasks.map(serializeCreatorDraftTask) : [],
          }))
        : [],
    };
    localStorage.setItem(getCreatorDraftStorageKey(), JSON.stringify(payload));
  } catch (_) {}
}

function scheduleSaveCreatorDraftState(delay = 120) {
  try {
    clearTimeout(creatorDraftSaveTimer);
    creatorDraftSaveTimer = setTimeout(() => {
      saveCreatorDraftState();
    }, Math.max(0, Number(delay || 0)));
  } catch (_) {}
}

function setCreatorUploadProgress(message) {
  const text = String(message || '').trim();
  const existing = document.getElementById('creatorUploadProgress');
  if (!text) {
    creatorUploadProgressVisible = false;
    if (existing) existing.remove();
    return;
  }
  creatorUploadProgressVisible = true;
  if (existing) {
    existing.textContent = text;
    return;
  }
  const host = document.getElementById('creatorContent') || document.body;
  if (!host) return;
  const el = document.createElement('div');
  el.id = 'creatorUploadProgress';
  el.className = 'cr-upload-progress';
  el.textContent = text;
  host.appendChild(el);
}

function clearCreatorDraftState() {
  try {
    localStorage.removeItem(getCreatorDraftStorageKey());
  } catch (_) {}
}

function ensureCreatorRealtimePolling() {
  try {
    if (creatorRealtimePollTimer) return;
    creatorRealtimePollTimer = setInterval(() => {
      try {
        autoPollRunningTasks();
        autoSyncQCStatuses();
      } catch (_) {}
    }, 2500);
  } catch (_) {}
}

function autoPollRunningTasks() {
  if (!Array.isArray(taskCombos) || taskCombos.length === 0) return;
  taskCombos.forEach((combo) => {
    const tasks = Array.isArray(combo?.tasks) ? combo.tasks : [];
    tasks.forEach((task) => {
      if (!task) return;
      if (String(task.status || '').toLowerCase() !== 'running') return;
      if (!String(task.taskId || '').trim()) return;
      if (task.__polling) return;
      pollTaskStatusByRef(task, combo, { silent: true });
    });
  });
}

function _applyTaskLifecycleState(task, nextState, extra = {}) {
  if (!task || typeof task !== 'object') return;
  const state = String(nextState || '').trim().toLowerCase();
  if (!state) return;
  const failMsg = Object.prototype.hasOwnProperty.call(extra, 'failMsg')
    ? _normalizeTaskFailureMessage(extra.failMsg || '')
    : String(task.failMsg || '').trim();
  const progressValue = Object.prototype.hasOwnProperty.call(extra, 'progress')
    ? Number(extra.progress || 0)
    : Number(task.progress || 0);

  if (state === 'submitting') {
    task.status = 'running';
    task.progress = 0;
    task.failMsg = '';
    task.__inflight = true;
    return;
  }
  if (state === 'running') {
    task.status = 'running';
    task.progress = Math.max(0, Math.min(99, Number.isFinite(progressValue) ? progressValue : 0));
    task.failMsg = '';
    return;
  }
  if (state === 'fail') {
    task.status = 'fail';
    task.progress = 0;
    task.failMsg = failMsg || 'Task thất bại';
    task.__inflight = false;
    task.__polling = false;
    if (!String(task.runFinishedAt || '').trim()) task.runFinishedAt = new Date().toISOString();
    return;
  }
  if (state === 'done') {
    task.status = 'done';
    task.progress = 100;
    task.failMsg = '';
    task.__inflight = false;
    task.__polling = false;
    if (!String(task.runFinishedAt || '').trim()) task.runFinishedAt = new Date().toISOString();
    return;
  }
  if (state === 'pending_qc' || state === 'approved' || state === 'rejected') {
    task.qcStatus = state;
    task.status = 'done';
    task.progress = 100;
    if (state === 'rejected' && failMsg) task.failMsg = failMsg;
    else if (state !== 'rejected') task.failMsg = '';
    task.__inflight = false;
    task.__polling = false;
    if (!String(task.runFinishedAt || '').trim()) task.runFinishedAt = new Date().toISOString();
  }
}

function applyTaskQCMeta(task, libItem, qcRow) {
  if (!task) return;
  const row = (qcRow && typeof qcRow === 'object' ? qcRow : (libItem && typeof libItem === 'object' ? libItem : {}));
  const statusRaw = String(row.status || '').trim().toLowerCase();
  const note = String(row.reject_reason || row.qcNote || row.qc_note || row.note || task.qcNote || '').trim();
  let nextQcStatus = String(task.qcStatus || '').trim().toLowerCase();
  if (statusRaw === 'pending') nextQcStatus = 'pending_qc';
  else if (statusRaw === 'pending_qc' || statusRaw === 'approved' || statusRaw === 'rejected') nextQcStatus = statusRaw;
  if (nextQcStatus) {
    task.qcStatus = nextQcStatus;
    _applyTaskLifecycleState(task, nextQcStatus, { failMsg: note, progress: 100 });
  }
  task.qcNote = note;
  task.qcReviewer = String(row.reviewer || row.qcReviewer || row.qc_reviewer || task.qcReviewer || '').trim();
  task.qcReviewedAt = row.reviewed_at || row.qcReviewedAt || row.qc_reviewed_at || task.qcReviewedAt || '';
  if (libItem) {
    if (task.qcStatus) {
      libItem.qcStatus = task.qcStatus;
      if (task.qcStatus === 'pending_qc' || task.qcStatus === 'approved' || task.qcStatus === 'rejected') {
        libItem.status = task.qcStatus;
      }
    }
    libItem.qcNote = task.qcNote || '';
    libItem.qcReviewer = task.qcReviewer || '';
    libItem.qcReviewedAt = task.qcReviewedAt || '';
  }
}

async function syncTaskQCStatusByRef(task, comboRef = null, options = {}) {
  const silent = !!options?.silent;
  const combo = comboRef || _findTaskOwnerCombo(task) || taskCombos[activeComboIdx];
  if (!task || !combo) return;
  const taskId = String(task.taskId || '').trim();
  if (!taskId) return;
  if (task.__qcPolling) return;
  const beforeSignature = _getTaskRuntimeSignature(task);
  task.__qcPolling = true;
  try {
    if (!API || typeof API.getQCStatus !== 'function') return;
    const libItem = AppData.library.find((i) => i.id === task.id || i.taskId === taskId) || null;
    const row = await API.getQCStatus(taskId);
    const rowStatus = String(row && row.status ? row.status : '').trim().toLowerCase();
    if (row && rowStatus && rowStatus !== 'none') {
      applyTaskQCMeta(task, libItem, row);
      return;
    }
    const libQcStatus = String(libItem?.qcStatus || '').trim().toLowerCase();
    if (libItem && libQcStatus && libQcStatus !== 'none') {
      applyTaskQCMeta(task, libItem, null);
    }
  } catch (err) {
    if (!silent) showToast(`Lấy trạng thái QC thất bại: ${err && err.message ? err.message : 'Lỗi không xác định'}`, 'error');
  } finally {
    task.__qcPolling = false;
  }
  const afterSignature = _getTaskRuntimeSignature(task);
  if (afterSignature !== beforeSignature) {
    _rerenderTaskByRef(task, combo);
    renderLibraryIfChanged();
    scheduleSaveCreatorDraftState(0);
  }
}

function autoSyncQCStatuses() {
  const now = Date.now();
  if (now - creatorLastQCSyncAt < 4000) return;
  creatorLastQCSyncAt = now;
  taskCombos.forEach((combo) => {
    const tasks = Array.isArray(combo?.tasks) ? combo.tasks : [];
    tasks.forEach((task) => {
      if (!task) return;
      if (!String(task.taskId || '').trim()) return;
      syncTaskQCStatusByRef(task, combo, { silent: true }).catch(() => {});
    });
  });
}

function _getTaskRuntimeSignature(task) {
  if (!task || typeof task !== 'object') return '';
  return JSON.stringify({
    status: String(task.status || '').trim(),
    progress: Math.round(Number(task.progress || 0) || 0),
    taskId: String(task.taskId || '').trim(),
    resultUrl: String(task.resultUrl || '').trim(),
    failMsg: String(task.failMsg || '').trim(),
    qcStatus: String(task.qcStatus || '').trim(),
    qcNote: String(task.qcNote || '').trim(),
    qcReviewer: String(task.qcReviewer || '').trim(),
    qcReviewedAt: String(task.qcReviewedAt || '').trim(),
    inflight: !!task.__inflight,
    polling: !!task.__polling,
    runHistoryCount: Array.isArray(task.runHistory) ? task.runHistory.length : 0,
  });
}

function _getLibraryRenderSignature() {
  const rows = Array.isArray(DEMO_LIBRARY) ? DEMO_LIBRARY : [];
  return JSON.stringify(rows.map((item) => ({
    id: String(item?.id || '').trim(),
    taskId: String(item?.taskId || '').trim(),
    status: String(item?.status || '').trim(),
    qcStatus: String(item?.qcStatus || '').trim(),
    qcNote: String(item?.qcNote || '').trim(),
    qcReviewer: String(item?.qcReviewer || '').trim(),
    qcReviewedAt: String(item?.qcReviewedAt || '').trim(),
    pct: Math.round(Number(item?.pct || 0) || 0),
    resultUrl: String(item?.resultUrl || '').trim(),
    credits: Number(item?.credits || 0) || 0,
  })));
}

function renderLibraryIfChanged(force = false) {
  const nextSignature = _getLibraryRenderSignature();
  if (!force && nextSignature === creatorLastLibraryRenderSignature) return false;
  creatorLastLibraryRenderSignature = nextSignature;
  renderLibrary();
  return true;
}

function loadCreatorDraftState() {
  try {
    const raw = localStorage.getItem(getCreatorDraftStorageKey());
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    const combos = Array.isArray(parsed?.taskCombos) ? parsed.taskCombos : [];
    if (!combos.length) return false;
    taskCombos = combos.map((combo, idx) => ({
      id: combo?.id || idx + 1,
      name: String(combo?.name || `CODE-${String(idx + 1).padStart(2, '0')}`),
      qcMode: String(combo?.qcMode || 'individual'),
      tasks: Array.isArray(combo?.tasks) ? combo.tasks.map((task) => serializeCreatorDraftTask(task)) : [],
    }));
    comboCounter = Math.max(Number(parsed?.comboCounter || taskCombos.length), taskCombos.length);
    activeComboIdx = Math.max(0, Math.min(Number(parsed?.activeComboIdx || 0), taskCombos.length - 1));
    libraryOpen = true;
    normalizeTaskCombos();
    return true;
  } catch (_) {
    return false;
  }
}

function mapInputAssetToCreatorImage(row) {
  const id = String(row?.id || '').trim();
  const fileName = String(row?.file_name || 'asset').trim() || 'asset';
  const sourceUrl = String(row?.source_url || '').trim();
  const folderName = String(row?.folder_name || '').trim();
  const codeTag = String(row?.code_tag || '').trim();
  const createdAt = Number(row?.created_at || 0);
  return {
    id: id || ('img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
    name: fileName,
    originalName: fileName,
    displayName: fileName,
    folder: folderName,
    codeTag,
    staffId: String(row?.user_name || '').trim() || String(AppData?.currentUser?.username || '').trim(),
    uploadTime: createdAt > 0 ? new Date(createdAt * 1000).toISOString() : new Date().toISOString(),
    width: Number(row?.width || 0),
    height: Number(row?.height || 0),
    mimeType: String(row?.mime_type || '').trim(),
    sourceUrl,
    previewUrl: sourceUrl,
    uploadedUrl: sourceUrl,
    used: false,
    usedAs: null,
    usedInTask: null,
    edited: !!row?.edited,
    inputAssetId: id || '',
  };
}

async function loadCreatorInputAssetsFromServer() {
  if (!API || typeof API.getInputAssets !== 'function') return;
  try {
    const rows = await API.getInputAssets({ sessionId: getCreatorSessionId(), limit: 2000 });
    if (!Array.isArray(rows)) return;
    const mapped = rows.map(mapInputAssetToCreatorImage);
    DEMO_IMAGES.splice(0, DEMO_IMAGES.length, ...mapped);
    creatorAssetsLoaded = true;
  } catch (_) {}
}

function getProviderCatalogRows() {
  return Array.isArray(AppData?.providerCatalog?.providers) ? AppData.providerCatalog.providers : [];
}

function getProviderRow(providerId) {
  const wanted = String(providerId || AppData?.providerSettings?.default_provider || 'provider1').trim().toLowerCase();
  return getProviderCatalogRows().find((row) => String(row.id || '').trim().toLowerCase() === wanted) || null;
}

function getDefaultProviderId() {
  return String(AppData?.providerSettings?.default_provider || 'provider1').trim().toLowerCase() || 'provider1';
}

function canChangeTaskProvider() {
  return String(AppData?.currentUser?.role || '').toLowerCase() === 'admin';
}

function getDefaultModelId(providerId) {
  const defaults = AppData?.providerSettings?.default_models || {};
  const fallback = providerId === 'provider2' ? 'kling25_turbo' : 'kling25_turbo_pro';
  return String(defaults[providerId] || fallback).trim() || fallback;
}

function getTaskModelMeta(task) {
  const providerId = String(task?.provider || getDefaultProviderId()).trim().toLowerCase() || 'provider1';
  const provider = getProviderRow(providerId);
  const models = Array.isArray(provider?.models) ? provider.models : [];
  const modelId = String(task?.modelId || getDefaultModelId(providerId)).trim();
  return models.find((row) => String(row.id || '').trim() === modelId) || models[0] || null;
}

function getModelOptionList(model, key) {
  return Array.isArray(model?.[key])
    ? model[key].map((value) => String(value || '').trim()).filter(Boolean)
    : [];
}

function getTaskSourceImage(task) {
  if (!task || typeof task !== 'object') return null;
  const sourceIds = [task.sourceImgId, task.firstFrameId, task.lastFrameId].filter(Boolean);
  for (const imgId of sourceIds) {
    const img = DEMO_IMAGES.find((row) => String(row.id || '') === String(imgId || ''));
    if (img) return img;
  }
  return null;
}

function getTaskSourceRatio(task) {
  const img = getTaskSourceImage(task);
  const width = Number(img?.width || 0);
  const height = Number(img?.height || 0);
  if (width <= 0 || height <= 0) return '';
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const divisor = gcd(width, height) || 1;
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function getTaskRatioValue(task) {
  const rawRatio = String(task?.ratio || '16:9').trim();
  if (rawRatio === 'original') return getTaskSourceRatio(task) || '16:9';
  return rawRatio || '16:9';
}

function getTaskAspectRatioCss(task) {
  const ratio = getTaskRatioValue(task);
  const [width, height] = ratio.split(':').map((value) => Number(value || 0));
  if (width > 0 && height > 0) return `${width}/${height}`;
  return '16/9';
}

function getTaskMediaProfile(task) {
  const model = getTaskModelMeta(task);
  const resolutionOptions = getModelOptionList(model, 'resolution_options');
  const fpsOptions = getModelOptionList(model, 'fps_options');
  const defaultResolution = String(model?.default_resolution || AppData?.fixedResolution || '1080p').trim() || '1080p';
  const defaultFps = String(model?.default_fps || AppData?.fixedFPS || '24').trim() || '24';
  const rawResolution = String(task?.resolution || '').trim();
  const rawFps = String(task?.fps || '').trim();
  const resolution = resolutionOptions.length > 0
    ? (resolutionOptions.includes(rawResolution) ? rawResolution : (defaultResolution || resolutionOptions[0] || ''))
    : (rawResolution || defaultResolution);
  const fps = fpsOptions.length > 0
    ? (fpsOptions.includes(rawFps) ? rawFps : (defaultFps || fpsOptions[0] || ''))
    : (rawFps || defaultFps);
  return {
    resolution,
    fps,
    resolutionOptions,
    fpsOptions,
    resolutionDisplay: resolution || String(model?.resolution_display || '1080p').trim() || '1080p',
    fpsDisplay: fps || String(model?.fps_display || '-').trim() || '-',
  };
}

function applyTaskMediaProfile(task) {
  if (!task || typeof task !== 'object') return getTaskMediaProfile({});
  const media = getTaskMediaProfile(task);
  task.resolution = media.resolution || String(AppData?.fixedResolution || '1080p').trim() || '1080p';
  task.fps = media.fps;
  return media;
}

function calcTaskCost(task) {
  const model = getTaskModelMeta(task);
  const duration = String(task?.duration || '5s') === '10s' ? 10 : 5;
  if (!model) return 0;
  return Number(duration >= 10 ? model.cost_10s : model.cost_5s) || 0;
}

function getTaskCostLabel(task) {
  const model = getTaskModelMeta(task);
  const cost = calcTaskCost(task);
  const unit = String(model?.unit || '').toLowerCase();
  return unit === 'usd' ? `$${cost.toFixed(2)}` : `${cost.toLocaleString()} cr`;
}

function _buildHistoryCodeName(item, idx = 1) {
  const rawCode = String(item?.codeTag || item?.product_code || '').trim();
  if (rawCode) return rawCode;
  const rawTaskId = String(item?.taskId || item?.id || '').trim();
  if (rawTaskId) return `CODE-${rawTaskId.slice(0, 8).toUpperCase()}`;
  return `CODE-HISTORY-${String(idx).padStart(2, '0')}`;
}

function _mapLibraryStatusToTaskStatus(item) {
  const qcStatus = String(item?.qcStatus || '').toLowerCase();
  const status = String(item?.status || '').toLowerCase();
  if (status === 'done' || status === 'approved' || status === 'rejected' || qcStatus === 'approved' || qcStatus === 'rejected') return 'done';
  if (status === 'processing' || status === 'pending' || qcStatus === 'pending') return 'running';
  if (status === 'pending_qc' || qcStatus === 'pending_qc') return 'done';
  if (status === 'fail' || status === 'failed') return 'fail';
  return 'idle';
}

function _isTaskActuallyRunning(task) {
  if (!task || String(task.status || '').toLowerCase() !== 'running') return false;
  const qcStatus = String(task.qcStatus || '').toLowerCase();
  if (qcStatus === 'pending_qc' || qcStatus === 'approved' || qcStatus === 'rejected') return false;
  const progress = Number(task.progress || 0);
  if (Number.isFinite(progress) && progress >= 100) return false;
  const taskId = String(task.taskId || '').trim();
  if (!taskId) return true;
  const rows = Array.isArray(AppData?.library) ? AppData.library : [];
  const lib = rows.find((item) => String(item?.taskId || item?.id || '').trim() === taskId);
  if (!lib) return false;
  const libStatus = String(lib.status || '').toLowerCase();
  const libQc = String(lib.qcStatus || '').toLowerCase();
  if (libStatus === 'processing' || libStatus === 'pending' || libStatus === 'running' || libStatus === 'queued') return true;
  if (libStatus === 'done' || libStatus === 'approved' || libStatus === 'rejected' || libStatus === 'pending_qc' || libStatus === 'success' || libStatus === 'fail' || libStatus === 'failed') return false;
  if (libQc === 'pending_qc' || libQc === 'approved' || libQc === 'rejected') return false;
  return false;
}

function _hasTaskExecution(task) {
  if (!task || typeof task !== 'object') return false;
  if (String(task.taskId || '').trim()) return true;
  if (String(task.resultUrl || '').trim()) return true;
  if (String(task.failMsg || '').trim()) return true;
  if (String(task.status || '').trim().toLowerCase() === 'done') return true;
  if (String(task.status || '').trim().toLowerCase() === 'fail') return true;
  if (Number(task.progress || 0) > 0) return true;
  return false;
}

function _isCreditExhaustedMessage(message) {
  const text = String(message || '').trim().toLowerCase();
  if (!text) return false;
  return [
    'insufficient',
    'exhaust',
    'out of credit',
    'out of credits',
    'no credit',
    'no credits',
    'not enough credit',
    'not enough balance',
    'credit exhausted',
    'balance',
    'quota',
    'recharge',
    'hết tiền',
    'het tien',
    'không đủ',
    'khong du',
    'số dư',
    'so du',
  ].some((token) => text.includes(token));
}

function _normalizeTaskFailureMessage(message) {
  const raw = String(message || '').trim();
  if (!raw) return 'Gửi task thất bại';
  if (_isCreditExhaustedMessage(raw)) return 'Hết tiền';
  return raw;
}

function _canStartTaskNow(task) {
  if (!task || task.__inflight) return false;
  return !_isTaskActuallyRunning(task);
}

function _taskHasRunHistory(task) {
  return !!(_hasTaskExecution(task) || (Array.isArray(task?.runHistory) && task.runHistory.length > 0));
}

function _buildTaskRunSnapshot(task) {
  if (!_hasTaskExecution(task)) return null;
  return {
    taskId: String(task.taskId || '').trim(),
    status: String(task.status || '').trim().toLowerCase() || 'idle',
    progress: Math.max(0, Math.min(100, Number(task.progress || 0) || 0)),
    resultUrl: String(task.resultUrl || '').trim(),
    failMsg: String(task.failMsg || '').trim(),
    qcStatus: String(task.qcStatus || '').trim(),
    qcNote: String(task.qcNote || '').trim(),
    qcReviewer: String(task.qcReviewer || '').trim(),
    prompt: String(task.prompt || '').trim(),
    provider: String(task.provider || '').trim(),
    modelId: String(task.modelId || '').trim(),
    duration: String(task.duration || '').trim(),
    ratio: String(task.ratio || '').trim(),
    cameraMove: String(task.cameraMove || '').trim(),
    credits: Number(task.credits || 0) || 0,
    runStartedAt: String(task.runStartedAt || '').trim(),
    runFinishedAt: String(task.runFinishedAt || '').trim(),
    archivedAt: new Date().toISOString(),
  };
}

function _archiveCurrentTaskRun(task) {
  if (!task || typeof task !== 'object') return;
  const snapshot = _buildTaskRunSnapshot(task);
  if (!snapshot) return;
  if (!Array.isArray(task.runHistory)) task.runHistory = [];
  const newest = task.runHistory[0];
  if (newest && newest.taskId && snapshot.taskId && newest.taskId === snapshot.taskId) return;
  task.runHistory.unshift(snapshot);
}

function _resetTaskForRerun(task) {
  if (!task || typeof task !== 'object') return;
  task.status = 'idle';
  task.progress = 0;
  task.taskId = '';
  task.resultUrl = '';
  task.failMsg = '';
  task.qcStatus = null;
  task.qcNote = '';
  task.qcReviewer = '';
  task.qcReviewedAt = '';
  task.runStartedAt = '';
  task.runFinishedAt = '';
}

function _formatTaskRunTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  try {
    return date.toLocaleString('vi-VN');
  } catch (_) {
    return raw;
  }
}

function _getTaskRunStatusMeta(status, qcStatus, failMsg) {
  const qc = String(qcStatus || '').trim().toLowerCase();
  const st = String(status || '').trim().toLowerCase();
  if (qc === 'approved') return { cls: 'approved', label: 'Đã duyệt' };
  if (qc === 'rejected') return { cls: 'rejected', label: 'Từ chối' };
  if (qc === 'pending_qc' || qc === 'pending') return { cls: 'pending', label: 'Chờ QC' };
  if (st === 'running') return { cls: 'pending', label: 'Đang chạy' };
  if (st === 'done') return { cls: 'approved', label: 'Hoàn tất' };
  if (st === 'fail') return { cls: 'rejected', label: failMsg ? 'Thất bại' : 'Lỗi' };
  return { cls: 'idle', label: 'Chưa chạy' };
}

function _renderTaskRunHistory(task) {
  const rows = [];
  if (_hasTaskExecution(task)) {
    rows.push({
      kind: 'current',
      title: 'Lần hiện tại',
      ..._buildTaskRunSnapshot(task),
    });
  }
  if (Array.isArray(task?.runHistory)) {
    task.runHistory.forEach((row, idx) => {
      rows.push({
        kind: 'history',
        title: `Lần trước #${idx + 1}`,
        ...row,
      });
    });
  }
  if (!rows.length) {
    return `
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;min-height:96px">
        <div style="font-size:9px;font-weight:700;color:var(--muted);margin-bottom:6px"><i class="fa-solid fa-clock-rotate-left" style="color:var(--blue)"></i> LỊCH SỬ CHẠY</div>
        <div style="font-size:10px;color:var(--muted);line-height:1.5">Chưa có lần chạy nào.</div>
      </div>
    `;
  }
  const items = rows.map((row, idx) => {
    const meta = _getTaskRunStatusMeta(row.status, row.qcStatus, row.failMsg);
    const when = _formatTaskRunTime(row.runFinishedAt || row.runStartedAt || row.archivedAt);
    const note = String(row.qcNote || row.failMsg || '').trim();
    return `
      <div style="${idx > 0 ? 'padding:8px 0 0 0;border-top:1px solid var(--border);margin-top:8px' : 'padding:0'}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div style="font-size:10px;font-weight:700;color:var(--text)">${row.title}</div>
          <span class="cr-qc-badge ${meta.cls}">${meta.label}</span>
        </div>
        <div style="font-size:10px;color:var(--muted);line-height:1.5;margin-top:4px">
          ${row.taskId ? `Task ID: ${row.taskId}<br>` : ''}
          ${when ? `Thời điểm: ${when}<br>` : ''}
          ${row.progress ? `Tiến độ cuối: ${Math.round(row.progress)}%<br>` : ''}
          ${note ? `Lý do/Ghi chú: ${note}` : ''}
        </div>
      </div>
    `;
  }).join('');
  return `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;min-height:96px">
      <div style="font-size:9px;font-weight:700;color:var(--muted);margin-bottom:6px"><i class="fa-solid fa-clock-rotate-left" style="color:var(--blue)"></i> LỊCH SỬ CHẠY</div>
      <div style="font-size:10px;color:var(--text);line-height:1.5">${items}</div>
    </div>
  `;
}

function _normalizeMatchText(value) {
  return String(value || '').trim().toLowerCase();
}

function _getComboCodeTag(combo) {
  return String(combo?.codeTag || combo?.name || '').trim();
}

function _getLibraryRowTimestamp(item) {
  const raw = item?.createdAt || item?.completedAt || item?.reviewedAt || '';
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return raw > 1e12 ? raw : raw * 1000;
  }
  const asText = String(raw || '').trim();
  if (!asText) return 0;
  const asNum = Number(asText);
  if (Number.isFinite(asNum) && asNum > 0) return asNum > 1e12 ? asNum : asNum * 1000;
  const parsed = Date.parse(asText);
  return Number.isFinite(parsed) ? parsed : 0;
}

function _buildRunSnapshotFromLibraryItem(item) {
  if (!item || typeof item !== 'object') return null;
  const mappedStatus = _mapLibraryStatusToTaskStatus(item);
  return {
    taskId: String(item.taskId || item.id || '').trim(),
    status: mappedStatus,
    progress: mappedStatus === 'done' ? 100 : Math.max(0, Math.min(100, Number(item.pct || item.progress || 0) || 0)),
    resultUrl: String(item.resultUrl || '').trim(),
    failMsg: mappedStatus === 'fail' ? String(item.qcNote || item.failMsg || '').trim() : '',
    qcStatus: String(item.qcStatus || '').trim(),
    qcNote: String(item.qcNote || '').trim(),
    qcReviewer: String(item.qcReviewer || '').trim(),
    prompt: String(item.prompt || '').trim(),
    provider: String(item.provider || '').trim(),
    modelId: String(item.modelId || '').trim(),
    duration: String(item.duration || '').trim(),
    ratio: String(item.ratio || '').trim(),
    cameraMove: String(item.cameraMove || '').trim(),
    credits: Number(item.credits || 0) || 0,
    runStartedAt: String(item.createdAt || '').trim(),
    runFinishedAt: String(item.createdAt || '').trim(),
    archivedAt: String(item.createdAt || '').trim() || new Date().toISOString(),
  };
}

function _dedupeRunSnapshots(rows) {
  const out = [];
  const seen = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row || typeof row !== 'object') return;
    const key = String(row.taskId || '').trim() || `${String(row.archivedAt || '').trim()}::${String(row.prompt || '').trim()}`;
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(row);
  });
  return out;
}

function _isFinalTaskState(status, qcStatus = '') {
  const st = String(status || '').trim().toLowerCase();
  const qc = String(qcStatus || '').trim().toLowerCase();
  if (qc === 'pending_qc' || qc === 'approved' || qc === 'rejected') return true;
  return st === 'done' || st === 'fail' || st === 'approved' || st === 'rejected' || st === 'pending_qc';
}

function _isLibraryItemFinalSnapshot(item) {
  if (!item || typeof item !== 'object') return false;
  return _isFinalTaskState(String(item.status || '').trim(), String(item.qcStatus || '').trim());
}

function _mergeTaskRunHistoryFromCandidates(task, candidates, primaryItemId = '') {
  const primaryId = String(primaryItemId || '').trim();
  const historicalSnapshots = (Array.isArray(candidates) ? candidates : [])
    .filter((entry) => String(entry?.itemTaskId || '').trim() !== primaryId)
    .map((entry) => _buildRunSnapshotFromLibraryItem(entry.item))
    .filter(Boolean);
  const existingSnapshots = Array.isArray(task?.runHistory) ? task.runHistory : [];
  const nextHistory = _dedupeRunSnapshots([...historicalSnapshots, ...existingSnapshots]);
  const before = JSON.stringify(existingSnapshots);
  const after = JSON.stringify(nextHistory);
  task.runHistory = nextHistory;
  return before !== after;
}

function _getCandidateLibraryRowsForTask(task, combo) {
  const rows = Array.isArray(AppData?.library) ? AppData.library : [];
  const wantedSessionId = _normalizeMatchText(getCreatorSessionId());
  const wantedCodeTag = _normalizeMatchText(_getComboCodeTag(combo));
  const wantedTaskId = _normalizeMatchText(task?.taskId);
  const wantedPrompt = _normalizeMatchText(task?.prompt);
  const wantedProvider = _normalizeMatchText(task?.provider);
  const wantedModelId = _normalizeMatchText(task?.modelId);
  const wantedDuration = _normalizeMatchText(task?.duration);
  const wantedRatio = _normalizeMatchText(task?.ratio);
  const wantedCameraMove = _normalizeMatchText(task?.cameraMove);
  const wantedEffectGroup = _normalizeMatchText(task?.effectGroup);
  const hasExecution = _hasTaskExecution(task) || (Array.isArray(task?.runHistory) && task.runHistory.length > 0);
  const requireFinalStateOnly = !wantedTaskId;

  if (!wantedTaskId && !hasExecution) return [];

  return rows
    .filter((item) => String(item?.type || 'video').toLowerCase() === 'video')
    .map((item) => {
      const itemTaskId = _normalizeMatchText(item?.taskId || item?.id);
      const itemSessionId = _normalizeMatchText(item?.sessionId);
      const itemCodeTag = _normalizeMatchText(item?.codeTag || item?.product_code);
      const itemStatus = String(item?.status || '').trim().toLowerCase();
      const itemQcStatus = String(item?.qcStatus || '').trim().toLowerCase();
      if (wantedSessionId && itemSessionId && itemSessionId !== wantedSessionId) return null;
      if (wantedCodeTag && itemCodeTag && itemCodeTag !== wantedCodeTag) return null;
      if (requireFinalStateOnly) {
        const isFinal = (
          itemStatus === 'done' ||
          itemStatus === 'approved' ||
          itemStatus === 'rejected' ||
          itemStatus === 'fail' ||
          itemStatus === 'failed' ||
          itemStatus === 'pending_qc' ||
          itemQcStatus === 'approved' ||
          itemQcStatus === 'rejected' ||
          itemQcStatus === 'pending_qc'
        );
        if (!isFinal) return null;
      }

      let score = 0;
      if (wantedTaskId && itemTaskId && itemTaskId === wantedTaskId) score += 1000;
      if (wantedPrompt && _normalizeMatchText(item?.prompt) === wantedPrompt) score += 10;
      if (wantedProvider && _normalizeMatchText(item?.provider) === wantedProvider) score += 4;
      if (wantedModelId && _normalizeMatchText(item?.modelId) === wantedModelId) score += 4;
      if (wantedDuration && _normalizeMatchText(item?.duration) === wantedDuration) score += 2;
      if (wantedRatio && _normalizeMatchText(item?.ratio) === wantedRatio) score += 2;
      if (wantedCameraMove && _normalizeMatchText(item?.cameraMove) === wantedCameraMove) score += 1;
      if (wantedEffectGroup && _normalizeMatchText(item?.effectGroup) === wantedEffectGroup) score += 1;
      if (String(task?.resultName || '').trim() && _normalizeMatchText(item?.name) === _normalizeMatchText(task.resultName)) score += 2;
      if (score <= 0) return null;

      return {
        item,
        score,
        timestamp: _getLibraryRowTimestamp(item),
        itemTaskId: itemTaskId || String(item?.id || '').trim(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.timestamp - a.timestamp;
    });
}

function _syncTaskStateFromLibrary(task, combo, usedPrimaryIds) {
  if (!task || typeof task !== 'object') return false;
  const candidates = _getCandidateLibraryRowsForTask(task, combo);
  if (!candidates.length) return false;
  const wantedTaskId = String(task.taskId || '').trim();
  const taskIsLive = !!task.__inflight || !!task.__polling || _isTaskActuallyRunning(task);

  const exactCandidates = wantedTaskId
    ? candidates.filter((entry) => String(entry.itemTaskId || '').trim() === wantedTaskId)
    : [];

  let primary = exactCandidates.find((entry) => !usedPrimaryIds.has(entry.itemTaskId)) || null;
  if (!primary) {
    if (taskIsLive) {
      return _mergeTaskRunHistoryFromCandidates(task, candidates, '');
    }
    primary = candidates.find((entry) => !usedPrimaryIds.has(entry.itemTaskId)) || candidates[0];
  }

  if (!primary) return false;
  usedPrimaryIds.add(primary.itemTaskId);

  const primaryItem = primary.item;
  const exactMatch = !!wantedTaskId && String(primary.itemTaskId || '').trim() === wantedTaskId;
  const primaryIsFinal = _isLibraryItemFinalSnapshot(primaryItem);
  if (taskIsLive && (!exactMatch || !primaryIsFinal)) {
    return _mergeTaskRunHistoryFromCandidates(task, candidates, primary.itemTaskId);
  }
  if (!exactMatch && !primaryIsFinal) {
    return _mergeTaskRunHistoryFromCandidates(task, candidates, primary.itemTaskId);
  }

  const previousSignature = JSON.stringify({
    taskId: String(task.taskId || '').trim(),
    status: String(task.status || '').trim(),
    progress: Number(task.progress || 0) || 0,
    resultUrl: String(task.resultUrl || '').trim(),
    qcStatus: String(task.qcStatus || '').trim(),
    qcNote: String(task.qcNote || '').trim(),
    runHistory: Array.isArray(task.runHistory) ? task.runHistory.length : 0,
  });

  const mappedStatus = _mapLibraryStatusToTaskStatus(primaryItem);
  if (exactMatch || !wantedTaskId) {
    task.taskId = String(primaryItem.taskId || primaryItem.id || '').trim();
  }
  task.resultUrl = String(primaryItem.resultUrl || task.resultUrl || '').trim();
  task.resultName = String(primaryItem.name || task.resultName || '').trim() || task.resultName;
  if (primaryIsFinal) {
    task.status = mappedStatus;
    task.progress = mappedStatus === 'done'
      ? 100
      : mappedStatus === 'fail'
        ? 0
        : Math.max(0, Math.min(99, Number(primaryItem.pct || primaryItem.progress || 0) || 0));
  }
  task.qcStatus = String(primaryItem.qcStatus || task.qcStatus || '').trim() || null;
  task.qcNote = String(primaryItem.qcNote || primaryItem.rejectReason || task.qcNote || '').trim();
  task.qcReviewer = String(primaryItem.qcReviewer || task.qcReviewer || '').trim();
  task.qcReviewedAt = String(primaryItem.qcReviewedAt || task.qcReviewedAt || '').trim();
  task.credits = Number(primaryItem.credits || task.credits || 0) || 0;
  task.runStartedAt = String(primaryItem.createdAt || task.runStartedAt || '').trim();
  if (primaryIsFinal && (mappedStatus === 'done' || mappedStatus === 'fail')) {
    task.runFinishedAt = String(primaryItem.createdAt || task.runFinishedAt || '').trim();
  }
  if (primaryIsFinal && mappedStatus === 'fail') {
    task.failMsg = String(primaryItem.qcNote || primaryItem.rejectReason || primaryItem.failMsg || task.failMsg || '').trim();
  } else if (primaryIsFinal && mappedStatus === 'done') {
    task.failMsg = '';
  }

  _mergeTaskRunHistoryFromCandidates(task, candidates, primary.itemTaskId);

  const nextSignature = JSON.stringify({
    taskId: String(task.taskId || '').trim(),
    status: String(task.status || '').trim(),
    progress: Number(task.progress || 0) || 0,
    resultUrl: String(task.resultUrl || '').trim(),
    qcStatus: String(task.qcStatus || '').trim(),
    qcNote: String(task.qcNote || '').trim(),
    runHistory: Array.isArray(task.runHistory) ? task.runHistory.length : 0,
  });
  return previousSignature !== nextSignature;
}

function _hydrateCreatorCombosFromRuntimeData() {
  if (!Array.isArray(taskCombos) || taskCombos.length > 0) return;
  const rows = Array.isArray(AppData?.library) ? AppData.library : [];
  const currentSessionId = String(getCreatorSessionId() || '').trim();
  const videoRows = rows.filter((item) => {
    if (String(item?.type || 'video').toLowerCase() !== 'video') return false;
    const sessionId = String(item?.sessionId || '').trim();
    const codeTag = String(item?.codeTag || '').trim();
    if (!sessionId || !codeTag) return false;
    return sessionId === currentSessionId;
  });
  if (videoRows.length === 0) {
    return;
  }

  const byCode = new Map();
  videoRows.forEach((item, idx) => {
    const codeName = _buildHistoryCodeName(item, idx + 1);
    if (!byCode.has(codeName)) byCode.set(codeName, []);
    byCode.get(codeName).push(item);
  });

  const combos = [];
  let comboId = 1;
  byCode.forEach((items, codeName) => {
    const sortedItems = [...items].sort((a, b) => _getLibraryRowTimestamp(b) - _getLibraryRowTimestamp(a));
    const tasks = sortedItems.map((item) => {
      const task = createDefaultTask();
      task.status = _mapLibraryStatusToTaskStatus(item);
      task.taskId = String(item?.taskId || item?.id || '').trim();
      task.resultUrl = String(item?.resultUrl || '').trim();
      task.resultName = String(item?.name || '').trim() || (task.taskId ? `${task.taskId}.mp4` : `${codeName}_${Date.now()}.mp4`);
      task.qcStatus = String(item?.qcStatus || item?.status || '').trim() || null;
      task.qcNote = String(item?.qcNote || '').trim();
      task.credits = Number(item?.credits || 0) || task.credits;
      task.prompt = String(item?.prompt || '').trim();
      task.provider = String(item?.provider || task.provider || getDefaultProviderId()).trim().toLowerCase() || getDefaultProviderId();
      task.modelId = String(item?.modelId || task.modelId || getDefaultModelId(task.provider)).trim();
      task.duration = String(item?.duration || task.duration || '5s').includes('10') ? '10s' : '5s';
      task.ratio = String(item?.ratio || task.ratio || '9:16').trim() || '9:16';
      task.cameraMove = String(item?.cameraMove || task.cameraMove || '-- None --').trim() || '-- None --';
      task.effectGroup = String(item?.effectGroup || item?.effect_group || 'none').trim().toLowerCase() || 'none';
      task.effectGroupCustom = String(item?.effectGroupDetail || item?.effect_group_detail || '').trim();
      task.progress = task.status === 'done' ? 100 : Math.max(0, Number(item?.pct || 0));
      task.runHistory = [];
      applyTaskMediaProfile(task);
      return task;
    });
    combos.push({
      id: comboId++,
      name: codeName,
      codeTag: codeName,
      tasks,
      qcMode: 'individual',
    });
  });

  if (combos.length > 0) {
    taskCombos = combos;
    comboCounter = combos.length;
    activeComboIdx = 0;
  }
}

// ---- MAIN BUILD (called by app.js) ----
function buildCreator() {
  MODELS[0] = AppData.model;
  const el = document.getElementById('creatorContent');
  el.innerHTML = `
    <!-- TOP TOOLBAR -->
    <div class="cr-topbar">
      <div class="cr-topbar-left">
        <div class="cr-model-badge">
          <span class="cr-model-label">M&#212; H&#204;NH</span>
          <select class="form-select cr-model-select" id="globalModel" onchange="recalcAllCosts()">
            ${MODELS.map((m,i) => `<option value="${i}">${m.name} - ${m.cr5} cr/5s</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="cr-topbar-actions">
        <button class="cr-btn cr-btn-ghost" onclick="clearAllCombos()">
          <i class="fa-solid fa-trash"></i> X&#243;a h&#7871;t
        </button>
        <div class="cr-credit-pill">
          <i class="fa-solid fa-coins"></i>
          <span id="totalCost">0</span> cr
        </div>
        <label class="cr-toggle-wrap">
          <input type="checkbox" checked id="autoRetry">
          <span class="cr-toggle-track"></span>
          <span>T&#7921; th&#7917; l&#7841;i</span>
        </label>
        <button class="cr-btn cr-btn-run" onclick="runAllCombos()">
          <i class="fa-solid fa-play"></i> Ch&#7841;y t&#7845;t c&#7843;
        </button>
      </div>
    </div>

    <!-- MAIN 3-PANEL LAYOUT -->
    <div class="cr-workspace">

      <!-- ===== LEFT PANEL: NGUON ANH ===== -->
      <div class="cr-panel cr-panel-left" id="panelLeft">
        <div class="cr-panel-header">
          <span class="cr-panel-title"><i class="fa-solid fa-images"></i> Ngu&#7891;n &#7843;nh</span>
          <span class="cr-badge-count" id="srcTotalBadge">${DEMO_IMAGES.length}</span>
        </div>

        <!-- Source toolbar: view mode -->
        <div class="cr-source-toolbar">
          <div class="cr-source-breadcrumb" id="srcBreadcrumb">
            <span class="cr-bc-item active" onclick="srcGoRoot()"><i class="fa-solid fa-home"></i> T&#7845;t c&#7843;</span>
          </div>
        </div>

        <!-- Rename panel (hidden by default) -->
        <div class="cr-src-rename-panel" id="srcRenamePanel" style="display:none">
          <div style="font-size:11px;font-weight:700;margin-bottom:6px"><i class="fa-solid fa-pen" style="color:var(--brand)"></i> &#272;&#7893;i t&#234;n th&#432; m&#7909;c theo CODE</div>
          <select class="form-select" id="srcRenameRule" style="font-size:11px;margin-bottom:6px" onchange="previewSrcRename()">
            <option value="keep">Gi&#7919; t&#234;n g&#7889;c</option>
            <option value="code">Theo CODE hi&#7879;n t&#7841;i</option>
            <option value="custom">T&#249;y ch&#7881;nh prefix...</option>
          </select>
          <input type="text" class="form-input" id="srcRenameCustom" style="font-size:11px;display:none;margin-bottom:6px" placeholder="Nh&#7853;p prefix..." oninput="previewSrcRename()">
          <div id="srcRenamePreview" style="font-size:10px;color:var(--muted);line-height:1.5;margin-bottom:6px"></div>
          <div style="display:flex;gap:6px">
            <button class="cr-btn cr-btn-primary" style="flex:1;font-size:11px" onclick="applySrcRename()"><i class="fa-solid fa-check"></i> &#193;p d&#7909;ng</button>
            <button class="cr-btn cr-btn-ghost" style="font-size:11px" onclick="document.getElementById('srcRenamePanel').style.display='none'">H&#7911;y</button>
          </div>
        </div>

        <!-- Upload zone -->
        <div class="cr-source-body" id="sourceBody">
          <div class="cr-upload-zone" id="sourceUploadZone"
               ondragover="event.preventDefault();this.classList.add('drag')"
               ondragleave="this.classList.remove('drag')"
               ondrop="handleSrcDrop(event)">
            <i class="fa-solid fa-folder-open"></i>
            <div>T&#7843;i l&#234;n Th&#432; m&#7909;c / &#7842;nh</div>
            <span>K&#233;o th&#7843; ho&#7863;c ch&#7885;n b&#234;n d&#432;&#7899;i: PNG, JPG, WEBP</span>
            <span style="color:var(--yellow);font-weight:600">K&#237;ch th&#432;&#7899;c t&#7889;i &#273;a m&#7895;i &#7843;nh: 20MB (t&#7921; &#273;&#7897;ng n&#233;n n&#7871;u l&#7899;n h&#417;n)</span>
            <div style="display:flex;gap:8px;margin-top:8px">
              <button class="cr-btn cr-btn-primary" style="font-size:11px;padding:6px 14px" onclick="event.stopPropagation();document.getElementById('srcFolderInput').click()">
                <i class="fa-solid fa-folder"></i> Ch&#7885;n Th&#432; m&#7909;c
              </button>
              <button class="cr-btn cr-btn-ghost" style="font-size:11px;padding:6px 14px" onclick="event.stopPropagation();document.getElementById('srcFileInput').click()">
                <i class="fa-solid fa-images"></i> Ch&#7885;n &#7843;nh
              </button>
            </div>
          </div>
          <input type="file" id="srcFolderInput" webkitdirectory directory multiple accept="image/*" style="display:none" onchange="handleSrcSelect(event)">
          <input type="file" id="srcFileInput" multiple accept="image/*" style="display:none" onchange="handleSrcSelect(event)">
          <div class="cr-src-info" id="srcInfo">
            <span><i class="fa-solid fa-images"></i> <span id="srcCount">${DEMO_IMAGES.length}</span> &#7843;nh</span>
            <span style="color:var(--muted);font-size:10px">Nh&#7845;n &#273;&#250;p th&#432; m&#7909;c &#273;&#7875; m&#7903;</span>
          </div>
          <div class="cr-img-grid" id="srcImageList"></div>
        </div>

        <!-- Batch Edit Section (collapsible) -->
        <div class="cr-batch-edit" id="batchEditSection" style="display:${batchEditVisible ? 'block' : 'none'}">
          <div class="cr-panel-header" style="border-top:1px solid var(--border)">
            <span class="cr-panel-title"><i class="fa-solid fa-wand-sparkles" style="color:var(--purple)"></i> Ch&#7881;nh H&#224;ng Lo&#7841;t</span>
            <button class="cr-icon-btn" onclick="toggleBatchEdit()"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div style="padding:10px">
            <div class="cr-batch-info">
              <i class="fa-solid fa-info-circle" style="color:var(--blue)"></i>
            <span>T&#7845;t c&#7843; &#7843;nh ch&#432;a d&#249;ng trong c&#249;ng th&#432; m&#7909;c s&#7869; &#273;&#432;&#7907;c ch&#7881;nh theo c&#249;ng hi&#7879;u &#7913;ng</span>
            </div>
            <div class="form-group" style="margin-bottom:8px">
              <label>Th&#432; m&#7909;c &#225;p d&#7909;ng</label>
              <select class="form-select" style="font-size:11px" id="batchFolder">
                <option value="all">T&#7845;t c&#7843; th&#432; m&#7909;c</option>
                ${[...new Set(DEMO_IMAGES.map(i=>i.folder))].map(f => `<option value="${f}">${f}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="margin-bottom:8px">
              <label>Ki&#7875;u D&#7921;ng S&#7861;n</label>
              <div class="cr-preset-grid">
                ${PRESETS.map((p,i) => `<button class="cr-preset-btn ${i===0?'active':''}" onclick="selectBatchPreset(this)">${p}</button>`).join('')}
              </div>
            </div>
            <div class="form-group" style="margin-bottom:8px">
              <label>Prompt t&#249;y ch&#7881;nh (&#225;p d&#7909;ng cho t&#7845;t c&#7843;)</label>
              <textarea class="form-textarea" style="height:48px;font-size:11px" id="batchPrompt" placeholder="VD: &#225;nh s&#225;ng studio, n&#7873;n tr&#7855;ng tinh, s&#7843;n ph&#7849;m n&#7893;i b&#7853;t..."></textarea>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">
              <div class="form-group" style="margin:0">
                <label>M&#244; h&#236;nh</label>
                <select class="form-select" style="font-size:11px">
                  <option>nano-banana-pro (18 cr)</option>
                  <option>gpt-image-1.5 (22 cr)</option>
                </select>
              </div>
              <div class="form-group" style="margin:0">
                <label>&#272;&#7897; ph&#226;n gi&#7843;i</label>
                <select class="form-select" style="font-size:11px">
                  <option>1K</option><option>2K</option><option>4K</option>
                </select>
              </div>
            </div>
            <div class="cr-batch-cost">
              <i class="fa-solid fa-coins"></i>
              <span id="batchEditCount">${DEMO_IMAGES.filter(i=>!i.used).length}</span> &#7843;nh  18 cr = 
              <strong id="batchEditCost">${DEMO_IMAGES.filter(i=>!i.used).length * 18}</strong> cr
            </div>
            <button class="cr-btn cr-btn-primary" style="width:100%;margin-top:8px" onclick="runBatchEdit()">
              <i class="fa-solid fa-bolt"></i> Ch&#7881;nh t&#7845;t c&#7843; &#7843;nh
            </button>
          </div>
        </div>
      </div>

      <!-- ===== CENTER PANEL: TASK COMBOS ===== -->
      <div class="cr-panel cr-panel-center" id="panelCenter">
        <div class="cr-combo-tabs" id="comboTabs"></div>
        <div class="cr-tasks-area" id="tasksArea"></div>
      </div>

    </div>

    <!-- AI Chat Floating FAB -->
    <div class="ai-fab" id="aiFab" onclick="toggleAIChat()">
      <i class="fa-solid fa-robot"></i>
      <span class="ai-fab-pulse"></span>
    </div>
    <div class="ai-chat-panel collapsed" id="aiChatPanel">
      <div class="ai-chat-header">
        <div style="display:flex;align-items:center;gap:8px">
          <i class="fa-solid fa-robot" style="color:var(--brand)"></i>
          <span>Tr&#7907; l&#253; prompt</span>
        </div>
        <button class="cr-icon-btn" onclick="clearChatHistory()" style="border:none" title="X&#243;a l&#7883;ch s&#7917;"><i class="fa-solid fa-trash" style="font-size:10px;color:var(--muted)"></i></button>
        <button class="cr-icon-btn" onclick="toggleAIChat()" style="border:none" title="Thu g&#7885;n"><i class="fa-solid fa-chevron-down" id="aiChatChevron" style="font-size:10px;color:var(--muted)"></i></button>
      </div>
      <div class="ai-chat-body" id="aiChatBody">
        <div id="chatMessages" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px;max-height:640px;overflow-y:auto">
          <div class="chat-bubble ai">Xin ch&#224;o. &#272;&#226;y l&#224; Tr&#7907; l&#253; prompt. T&#244;i gi&#250;p b&#7841;n t&#7841;o prompt, ph&#226;n t&#237;ch &#7843;nh, t&#432; v&#7845;n quy tr&#236;nh.<br><small style="color:var(--muted)">Ch&#7885;n &#7843;nh, nh&#7853;p c&#226;u l&#7879;nh, sau &#273;&#243; g&#7917;i c&#249;ng m&#7897;t l&#432;&#7907;t.</small></div>
        </div>
        <div id="chatPendingAttachment" class="ai-chat-attachment" style="display:none"></div>
        <div style="display:flex;gap:6px;align-items:flex-end">
          <button class="ai-upload-btn" onclick="document.getElementById('aiImgUpload').click()" title="Ch&#7885;n &#7843;nh &#273;&#237;nh k&#232;m">
            <i class="fa-solid fa-paperclip"></i>
          </button>
          <input type="file" id="aiImgUpload" accept="image/*" style="display:none" onchange="handleAIImageUpload(event)">
          <input type="text" class="form-input" id="chatInput" placeholder="Nh&#7853;p c&#226;u l&#7879;nh cho Tr&#7907; l&#253; prompt..." style="font-size:12px;flex:1"
                 onkeydown="if(event.key==='Enter')sendChat()">
          <button class="btn-primary btn-sm" onclick="sendChat()"><i class="fa-solid fa-paper-plane"></i></button>
        </div>
      </div>
    </div>
  `;

  const legacyModelBox = el.querySelector('.cr-model-badge');
  if (legacyModelBox) legacyModelBox.remove();
  const hasDraftState = loadCreatorDraftState();
  normalizeTaskCombos();
  if ((Array.isArray(taskCombos) ? taskCombos.length : 0) > 0) scheduleSaveCreatorDraftState(0);

  renderComboTabs();
  renderActiveCombo();
  renderLibrary();
  renderSourceImages();
  recalcAllCosts();
  updateStatusBar();
  injectCreatorCSS();
  ensureCreatorRealtimePolling();
  autoPollRunningTasks();
  if (typeof loadChatHistory === 'function') loadChatHistory();
  if (!creatorAssetsLoaded) {
    loadCreatorInputAssetsFromServer().then(() => {
      try { renderSourceImages(); } catch (_) {}
    });
  }
}

function pushCreatorPresence() {
  try {
    clearTimeout(creatorPresenceTimer);
    creatorPresenceTimer = setTimeout(() => {
      try {
        if (typeof API === 'undefined' || !API || typeof API.heartbeat !== 'function') return;
        if (String(AppData?.viewingAsUserId || '').trim()) return;
        if (String(AppData?.currentUser?.role || '').toLowerCase() !== 'staff') return;
        const combo = taskCombos[(typeof activeComboIdx !== 'undefined' ? activeComboIdx : 0)] || null;
        API.heartbeat({
          current_code: String(combo?.name || '').trim(),
          current_task: combo ? `${Number(Array.isArray(combo.tasks) ? combo.tasks.length : 0)} task` : '',
          current_entries: Array.isArray(taskCombos) ? taskCombos.map((c) => ({
            code: String(c?.name || '').trim(),
            task: `${Number(Array.isArray(c?.tasks) ? c.tasks.length : 0)} task`,
            effect_group: String(getComboEffectSummary(c) || '').trim(),
          })).filter((entry) => entry.code) : [],
          current_entries_json: JSON.stringify(Array.isArray(taskCombos) ? taskCombos.map((c) => ({
            code: String(c?.name || '').trim(),
            task: `${Number(Array.isArray(c?.tasks) ? c.tasks.length : 0)} task`,
            effect_group: String(getComboEffectSummary(c) || '').trim(),
          })).filter((entry) => entry.code) : []),
          current_entries_csv: (Array.isArray(taskCombos) ? taskCombos.map((c) => ({
            code: String(c?.name || '').trim(),
            task: `${Number(Array.isArray(c?.tasks) ? c.tasks.length : 0)} task`,
            effect_group: String(getComboEffectSummary(c) || '').trim(),
          })).filter((entry) => entry.code) : []).map((entry) => `${entry.code}::${entry.task || ''}`).join('|'),
        }).catch(() => {});
      } catch (_) {}
    }, 1200);
  } catch (_) {}
}

// ========== COMBO MANAGEMENT ==========
function addNewCombo(silent) {
  comboCounter++;
  const codeName = 'CODE-' + String(comboCounter).padStart(2,'0');
  const combo = {
    id: comboCounter,
    name: codeName,
    codeTag: codeName,
    tasks: [],
    qcMode: 'individual', // individual | batch
  };
  taskCombos.push(combo);
  activeComboIdx = taskCombos.length - 1;
  scheduleSaveCreatorDraftState(0);
  pushCreatorPresence();
  if (!silent) {
    renderComboTabs();
    renderActiveCombo();
    recalcAllCosts();
    showToast(`\u0110\u00E3 t\u1EA1o ${combo.name}`, 'success');
  }
}

function createDefaultTask() {
  const providerId = getDefaultProviderId();
  const presetList = Array.isArray(PRESETS) && PRESETS.length ? PRESETS : ['Default'];
  const cameraMoveList = Array.isArray(CAMERA_MOVES) && CAMERA_MOVES.length ? CAMERA_MOVES : ['-- None --'];
  const task = {
    id: 'tsk_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
    provider: providerId,
    modelId: getDefaultModelId(providerId),
    mode: 'i2v',
    sourceImg: null,
    sourceImgId: null,
    firstFrame: null,
    firstFrameId: null,
    lastFrame: null,
    lastFrameId: null,
    duration: '5s',
    ratio: '9:16',
    resolution: '',
    fps: '',
    cameraMove: cameraMoveList.includes('-- None --') ? '-- None --' : String(cameraMoveList[0]),
    prompt: '',
    style: presetList[0],
    effectGroup: 'none',
    effectGroupCustom: '',
    status: 'idle',
    progress: 0,
    resultName: null,
    qcStatus: null,
    qcNote: '',
    qcReviewer: '',
    qcReviewedAt: '',
    assignedQcUser: '',
    assignedQcDisplay: '',
    taskId: '',
    resultUrl: '',
    failMsg: '',
    runStartedAt: '',
    runFinishedAt: '',
    runHistory: [],
    credits: 0,
  };
  applyTaskMediaProfile(task);
  task.credits = calcTaskCost(task);
  return task;
}

function getFirstValidComboIndex() {
  for (let i = 0; i < taskCombos.length; i += 1) {
    if (taskCombos[i]) return i;
  }
  return -1;
}

function normalizeTaskCombos() {
  if (!Array.isArray(taskCombos)) {
    taskCombos = [];
    return;
  }
  taskCombos = taskCombos.filter(Boolean).map((combo, idx) => {
    const normalizedTasks = (Array.isArray(combo?.tasks) ? combo.tasks : []).map((task) => {
      if (!task || typeof task !== 'object') return createDefaultTask();
      const nextTask = { ...task };
      if (!nextTask.provider) nextTask.provider = getDefaultProviderId();
      if (!nextTask.modelId) nextTask.modelId = getDefaultModelId(String(nextTask.provider || '').trim().toLowerCase() || 'provider1');
      if (!nextTask.effectGroup) nextTask.effectGroup = 'none';
      if (typeof nextTask.effectGroupCustom !== 'string') nextTask.effectGroupCustom = '';
      if (!Array.isArray(nextTask.runHistory)) nextTask.runHistory = [];
      if (String(nextTask.status || '').toLowerCase() === 'running' && !String(nextTask.taskId || '').trim()) {
        nextTask.status = 'idle';
        nextTask.progress = 0;
      }
      applyTaskMediaProfile(nextTask);
      nextTask.credits = calcTaskCost(nextTask);
      return nextTask;
    });
    return {
      id: combo?.id || idx + 1,
      name: String(combo?.name || `CODE-${String(idx + 1).padStart(2, '0')}`),
      codeTag: String(combo?.codeTag || combo?.name || `CODE-${String(idx + 1).padStart(2, '0')}`),
      tasks: normalizedTasks,
      qcMode: combo?.qcMode || 'individual',
    };
  });
  if (taskCombos.length === 0) {
    activeComboIdx = 0;
    return;
  }
  if (!Number.isInteger(activeComboIdx) || activeComboIdx < 0 || activeComboIdx >= taskCombos.length) {
    activeComboIdx = 0;
  }
}

function getActiveComboContext() {
  normalizeTaskCombos();
  const firstValidIdx = getFirstValidComboIndex();
  const resolvedIdx = activeComboIdx >= 0 && taskCombos[activeComboIdx]
    ? activeComboIdx
    : (firstValidIdx >= 0 ? firstValidIdx : -1);
  if (resolvedIdx >= 0) activeComboIdx = resolvedIdx;
  return {
    idx: resolvedIdx,
    combo: resolvedIdx >= 0 ? taskCombos[resolvedIdx] : null,
  };
}

function switchCombo(idx) {
  const nextIdx = Number(idx);
  activeComboIdx = Number.isFinite(nextIdx) && taskCombos[nextIdx] ? nextIdx : getFirstValidComboIndex();
  if (activeComboIdx < 0) activeComboIdx = 0;
  renderComboTabs();
  renderActiveCombo();
  updateStatusBar();
  scheduleSaveCreatorDraftState(0);
  pushCreatorPresence();
}

function removeCombo(idx) {
  // Unmark used images for this combo
  const combo = taskCombos[idx];
  combo.tasks.forEach(t => {
    if (t.sourceImgId) unmarkImage(t.sourceImgId);
    if (t.firstFrameId) unmarkImage(t.firstFrameId);
    if (t.lastFrameId) unmarkImage(t.lastFrameId);
  });
  taskCombos.splice(idx, 1);
  if (activeComboIdx >= taskCombos.length) activeComboIdx = Math.max(0, taskCombos.length - 1);
  renderComboTabs();
  renderActiveCombo();
  renderSourceImages();
  recalcAllCosts();
  scheduleSaveCreatorDraftState(0);
  pushCreatorPresence();
}

function clearAllCombos() {
  // Unmark all images
  DEMO_IMAGES.forEach(img => { img.used = false; img.usedAs = null; img.usedInTask = null; });
  taskCombos = [];
  comboCounter = 0;
  renderComboTabs();
  renderActiveCombo();
  renderSourceImages();
  recalcAllCosts();
  clearCreatorDraftState();
  pushCreatorPresence();
  showToast('\u0110\u00E3 x\u00F3a t\u1EA5t c\u1EA3 Task Combos', 'info');
}

function renameCombo(idx) {
  const name = prompt('\u0110\u1ED5i t\u00EAn Task Combo:', taskCombos[idx].name);
  if (name && name.trim()) {
    taskCombos[idx].name = name.trim();
    renderComboTabs();
    renderActiveCombo();
    scheduleSaveCreatorDraftState(0);
    pushCreatorPresence();
  }
}

// ========== RENDER COMBO TABS ==========
function renderComboTabs() {
  normalizeTaskCombos();
  syncCreatorQCFromLibrary({ render: false });
  const el = document.getElementById('comboTabs');
  if (!el) return;
  el.innerHTML = taskCombos.map((c, i) => {
    const done = c.tasks.filter(t => t.status === 'done').length;
    const total = c.tasks.length;
    const hasRunning = c.tasks.some((t) => _isTaskActuallyRunning(t));
    return `
      <div class="cr-combo-tab ${i === activeComboIdx ? 'active' : ''}" onclick="switchCombo(${i})" ondblclick="renameCombo(${i})">
        ${hasRunning ? '<i class="fa-solid fa-spinner fa-spin" style="font-size:10px;color:var(--brand)"></i>' : '<i class="fa-solid fa-layer-group"></i>'}
        <span>${c.name}</span>
        <span class="cr-combo-count">${done}/${total}</span>
        ${taskCombos.length > 1 ? `<button class="cr-combo-close" onclick="event.stopPropagation();removeCombo(${i})" title="Xa combo"><i class="fa-solid fa-xmark"></i></button>` : ''}
      </div>
    `;
  }).join('') + `
    <button class="cr-combo-add" onclick="addNewCombo()" title="Them Task Combo"><i class="fa-solid fa-plus"></i></button>
  `;
}

function syncActiveComboTabMeta() {
  const combo = taskCombos[activeComboIdx];
  if (!combo) return;
  const tab = document.querySelectorAll('.cr-combo-tab')[activeComboIdx];
  if (!tab) return;
  const done = combo.tasks.filter((t) => t.status === 'done').length;
  const total = combo.tasks.length;
  const countEl = tab.querySelector('.cr-combo-count');
  if (countEl) countEl.textContent = `${done}/${total}`;
}

// ========== RENDER TASK TABLE ==========
function renderActiveCombo() {
  normalizeTaskCombos();
  const el = document.getElementById('tasksArea');
  if (!el) return;
  if (taskCombos.length === 0) {
    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100%;min-height:280px">
        <button class="cr-combo-add" onclick="addNewCombo()" title="Them CODE" style="width:42px;height:42px;border-radius:10px">
          <i class="fa-solid fa-plus"></i>
        </button>
      </div>
    `;
    pushCreatorPresence();
    return;
  }
  const firstValidIdx = getFirstValidComboIndex();
  if (activeComboIdx < 0 || !taskCombos[activeComboIdx]) {
    activeComboIdx = firstValidIdx >= 0 ? firstValidIdx : 0;
  }
  const combo = taskCombos[activeComboIdx] || taskCombos[0];
  if (!combo) return;
  const isBatchRunning = !!combo.__batchRunning;
  syncCreatorQCFromLibrary({ render: false });

  el.innerHTML = `
    <div class="cr-tasks-header">
      <span class="cr-tasks-title">
        <i class="fa-solid fa-layer-group" style="color:var(--brand)"></i>
        ${combo.name}
        <span style="color:var(--muted);font-weight:400;font-size:12px">- ${combo.tasks.length} task</span>
      </span>
      <div style="display:flex;gap:6px;align-items:center">
        <label class="cr-qc-mode" title="Ch&#7871; &#273;&#7897; g&#7917;i QC">
          <select class="form-select" style="font-size:10px;padding:3px 6px;width:auto" onchange="setComboQCMode(this.value)">
            <option value="individual" ${combo.qcMode==='individual'?'selected':''}>QC t&#7915;ng video</option>
            <option value="batch" ${combo.qcMode==='batch'?'selected':''}>QC g&#7897;p 1 l&#7847;n</option>
          </select>
        </label>
        <button class="cr-btn cr-btn-ghost" style="font-size:11px" onclick="window.addTaskRow()" ${isBatchRunning ? 'disabled style="opacity:.6;cursor:not-allowed;font-size:11px"' : ''}>
          <i class="fa-solid fa-plus"></i> Th&#234;m D&#242;ng
        </button>
        <button class="cr-btn cr-btn-ghost" style="font-size:11px" onclick="sendComboQC()">
          <i class="fab fa-telegram"></i> G&#7917;i QC
        </button>
        <button class="cr-btn cr-btn-run" style="font-size:11px;padding:5px 14px" onclick="runAllCombos()" ${isBatchRunning ? 'disabled style="font-size:11px;padding:5px 14px;opacity:.6;cursor:not-allowed"' : ''}>
          <i class="fa-solid fa-play"></i> Ch&#7841;y
        </button>
      </div>
    </div>
    <div class="cr-tasks-scroll">
      <div class="cr-task-list">
        <div class="cr-task-list-head">
          <div>#</div>
          <div>Ch&#7871; &#273;&#7897;</div>
          <div>Ngu&#7891;n / Khung</div>
          <div>Server</div>
          <div>Model</div>
          <div>Chi ph&#237;</div>
          <div>Prompt chuy&#7875;n &#273;&#7897;ng</div>
          <div>QC</div>
          <div>Thao t&#225;c</div>
        </div>
        <div id="taskTableBody" class="cr-task-list-body">
          ${combo.tasks.length > 0
            ? combo.tasks.map((t, i) => renderTaskRow(t, i)).join('')
            : `<div class="cr-task-empty-state">Ch&#432;a c&#243; task. B&#7845;m "Th&#234;m D&#242;ng" &#273;&#7875; t&#7841;o task m&#7899;i.</div>`}
        </div>
      </div>
    </div>
  `;
  pushCreatorPresence();
  
  // Ensure all textareas are expanded after rendering
  setTimeout(adjustAllTextareas, 50);
}

function renderTaskRow(t, idx) {
  const providerRows = getProviderCatalogRows();
  const selectedProvider = String(t.provider || getDefaultProviderId()).trim().toLowerCase() || 'provider1';
  const selectedProviderRow = getProviderRow(selectedProvider);
  const mediaProfile = applyTaskMediaProfile(t);
  const providerOpts = providerRows.map((row) => `<option value="${String(row.id || '').replace(/"/g, '&quot;')}" ${String(row.id || '') === selectedProvider ? 'selected' : ''}>${String(row.name || row.id || '')}</option>`).join('');
  const modelRows = Array.isArray(selectedProviderRow?.models) ? selectedProviderRow.models : [];
  const selectedModelId = String(t.modelId || getDefaultModelId(selectedProvider)).trim();
  const modelOpts = modelRows.map((row) => `<option value="${String(row.id || '').replace(/"/g, '&quot;')}" ${String(row.id || '') === selectedModelId ? 'selected' : ''}>${String(row.label || row.id || '')}</option>`).join('');
  const providerControl = canChangeTaskProvider()
    ? `<select class="cr-cell-select" onchange="updateTask(${idx},'provider',this.value)">${providerOpts}</select>`
    : `<span class="cr-cell-fixed" style="font-size:11px;color:var(--text);font-weight:600">${String(selectedProviderRow?.name || selectedProvider || '-')}</span>`;
  const modeOpts = `
    <option value="i2v" ${t.mode==='i2v'?'selected':''}>&#7842;nh &rarr; Video</option>
    <option value="flf" ${t.mode==='flf'?'selected':''}>Khung &#273;&#7847;u-cu&#7889;i</option>
  `;
  const durOpts = `<option value="5s" ${t.duration==='5s'?'selected':''}>5s</option><option value="10s" ${t.duration==='10s'?'selected':''}>10s</option>`;
  const ratioOpts = `<option value="9:16" ${t.ratio==='9:16'?'selected':''}>9:16</option><option value="16:9" ${t.ratio==='16:9'?'selected':''}>16:9</option><option value="1:1" ${t.ratio==='1:1'?'selected':''}>1:1</option><option value="original" ${t.ratio==='original'?'selected':''}>Theo t&#7927; l&#7879; &#7843;nh g&#7889;c</option>`;
  const resolutionControl = mediaProfile.resolutionOptions.length > 1
    ? `<select class="cr-cell-select" onchange="updateTask(${idx},'resolution',this.value)">${mediaProfile.resolutionOptions.map((value) => `<option value="${String(value).replace(/"/g, '&quot;')}" ${mediaProfile.resolution === value ? 'selected' : ''}>${value}</option>`).join('')}</select>`
    : `<span class="cr-cell-fixed" data-task-resolution="${t.id}" style="font-size:11px;color:var(--text);font-weight:600">${mediaProfile.resolutionDisplay}</span>`;
  const fpsControl = mediaProfile.fpsOptions.length > 1
    ? `<select class="cr-cell-select" onchange="updateTask(${idx},'fps',this.value)">${mediaProfile.fpsOptions.map((value) => `<option value="${String(value).replace(/"/g, '&quot;')}" ${mediaProfile.fps === value ? 'selected' : ''}>${value}</option>`).join('')}</select>`
    : `<span class="cr-cell-fixed" data-task-fps="${t.id}" style="font-size:11px;color:var(--text);font-weight:600">${mediaProfile.fpsDisplay}</span>`;
  const cameraMoveList = Array.isArray(CAMERA_MOVES) && CAMERA_MOVES.length ? CAMERA_MOVES : ['-- None --'];
  const camOpts = cameraMoveList.map(c => `<option ${t.cameraMove===c?'selected':''}>${c}</option>`).join('');
  const isCustomEffect = String(t.effectGroup || 'none') === 'custom';
  const effectOpts = VIDEO_EFFECT_GROUPS.map((row) => `<option value="${String(row.id || '').replace(/"/g, '&quot;')}" ${String(t.effectGroup || 'none') === String(row.id || '') ? 'selected' : ''}>${row.label}</option>`).join('');
  const popupCustomEffectInput = String(t.effectGroup || 'none') === 'custom'
    ? `<input class="cr-cell-input" style="font-size:11px;font-weight:600" placeholder="Nh\u1eadp hi\u1ec7u \u1ee9ng t\u00f9y ch\u1ecdn..." value="${String(t.effectGroupCustom || '').replace(/"/g, '&quot;')}" oninput="updateTask(${idx},'effectGroupCustom',this.value)">`
    : '';
  const customEffectInput = String(t.effectGroup || 'none') === 'custom'
    ? `<input class="cr-cell-input" placeholder="Nh\u1eadp hi\u1ec7u \u1ee9ng t\u00f9y ch\u1ecdn..." value="${String(t.effectGroupCustom || '').replace(/"/g, '&quot;')}" oninput="updateTask(${idx},'effectGroupCustom',this.value)">`
    : '';
  const customEffectControl = customEffectInput || `<div class="cr-effect-custom-empty"></div>`;
  const costText = getTaskCostLabel(t);

  // Source HTML depends on mode  with drag-drop support
  let sourceHTML;
  if (t.mode === 'i2v') {
    sourceHTML = `
      <button class="cr-src-btn cr-drop-target ${t.sourceImg ? 'filled' : ''}" data-task-idx="${idx}" data-role="i2v"
        onclick="pickSourceForTask(${idx},'i2v')" title="${t.sourceImg || 'K&#233;o th&#7843; ho&#7863;c b&#7845;m &#273;&#7875; ch&#7885;n &#7843;nh'}"
        ondragover="handleSrcBtnDragOver(event)" ondragleave="handleSrcBtnDragLeave(event)" ondrop="handleSrcBtnDrop(event,${idx},'i2v')">
        ${t.sourceImg
          ? `<i class="fa-solid fa-check" style="color:var(--green)"></i><span class="cr-src-label">${t.sourceImg}</span>`
          : '<i class="fa-solid fa-upload"></i><span class="cr-src-label">Ch&#7885;n &#7843;nh</span>'}
      </button>`;
  } else {
    sourceHTML = `
      <div class="cr-flf-btns">
        <button class="cr-src-btn mini cr-drop-target ${t.firstFrame?'filled':''}" data-task-idx="${idx}" data-role="first"
          onclick="pickSourceForTask(${idx},'first')" title="${t.firstFrame || 'K&#233;o th&#7843; ho&#7863;c b&#7845;m ch&#7885;n First frame'}"
          ondragover="handleSrcBtnDragOver(event)" ondragleave="handleSrcBtnDragLeave(event)" ondrop="handleSrcBtnDrop(event,${idx},'first')">
          ${t.firstFrame ? `<i class="fa-solid fa-check" style="color:var(--green)"></i> F` : '<i class="fa-solid fa-play" style="color:var(--green)"></i> F'}
        </button>
        <button class="cr-src-btn mini cr-drop-target ${t.lastFrame?'filled':''}" data-task-idx="${idx}" data-role="last"
          onclick="pickSourceForTask(${idx},'last')" title="${t.lastFrame || 'K&#233;o th&#7843; ho&#7863;c b&#7845;m ch&#7885;n Last frame'}"
          ondragover="handleSrcBtnDragOver(event)" ondragleave="handleSrcBtnDragLeave(event)" ondrop="handleSrcBtnDrop(event,${idx},'last')">
          ${t.lastFrame ? `<i class="fa-solid fa-check" style="color:var(--green)"></i> L` : '<i class="fa-solid fa-stop" style="color:var(--red)"></i> L'}
        </button>
      </div>`;
  }

  const isSubmitting = !!t.__inflight && !String(t.taskId || '').trim();
  const isRuntimeRunning = isSubmitting || t.status === 'running';
  const canStartTask = _canStartTaskNow(t);
  const isRerun = _taskHasRunHistory(t);
  const hasResultUrl = !!String(t.resultUrl || '').trim();
  const progressPct = Math.max(0, Math.min(100, Number(t.progress || 0) || 0));

  // QC status with send button
  let qcHTML;
  const onlineQCReviewers = getOnlineQCReviewers();
  if (canSendTaskQC(t)) {
    const qcAssignControl = onlineQCReviewers.length
      ? `<select class="cr-cell-select" style="min-width:120px;font-size:11px" onchange="assignTaskQCDisplay(${idx},this)">
           <option value="">QC t&#7921; do</option>
           <option value="__telegram__" ${String(t.assignedQcUser || '') === '__telegram__' ? 'selected' : ''}>G&#7917;i tele (Admin)</option>
           ${onlineQCReviewers.map((row) => `<option value="${row.username.replace(/"/g, '&quot;')}" ${String(t.assignedQcUser || '') === row.username ? 'selected' : ''}>${row.display}</option>`).join('')}
         </select>`
      : `<span class="cr-qc-badge idle">Kh&#244;ng c&#243; QC online</span>`;
    qcHTML = `${qcAssignControl}<button class="cr-qc-send-btn" onclick="sendTaskQC(${idx})" title="G&#7917;i QC"><i class="fa-solid fa-paper-plane"></i> G&#7917;i QC</button>`;
  } else if (t.qcStatus === 'pending_qc') {
    qcHTML = `<span class="cr-qc-badge pending"><i class="fa-solid fa-clock"></i> Ch&#7901;</span>${t.assignedQcDisplay ? `<span class="cr-qc-badge idle" title="QC &#273;&#432;&#7907;c giao">${t.assignedQcDisplay}</span>` : ''}`;
  } else if (t.qcStatus === 'approved') {
    qcHTML = '<span class="cr-qc-badge approved"><i class="fa-solid fa-check"></i> Pass</span>';
  } else if (t.qcStatus === 'rejected') {
    qcHTML = `<span class="cr-qc-badge rejected" title="${t.qcNote||''}"><i class="fa-solid fa-xmark"></i> Reject</span>`;
  } else {
    qcHTML = '<span class="cr-qc-badge idle">Ch&#432;a g&#7917;i</span>';
  }

  // Row status class
  const rowCls = isRuntimeRunning ? 'running' : t.status === 'done' ? 'done' : t.status === 'fail' ? 'fail' : '';

  return `
    <div class="cr-task-row-shell" data-task-idx="${idx}">
      <div class="cr-task-row ${rowCls}" data-task="${t.id}" data-task-idx="${idx}">
        <div class="cr-task-wrap-cell">
          <div class="cr-task-block ${idx % 2 === 1 ? 'is-alt' : 'is-base'}" style="cursor:pointer" onclick="openTaskDetailPopup(${idx}, event)">
            <div class="cr-task-line cr-task-line-top">
              <div class="cr-task-chip cr-task-chip-index" style="cursor:pointer" onclick="openTaskDetailPopup(${idx}, event)" title="Click xem chi tiet">
                <span class="cr-task-chip-num">
                  ${isRuntimeRunning ? '<span class="cr-dot running"></span>' : t.status === 'done' ? '<span class="cr-dot done"></span>' : t.status === 'fail' ? '<span class="cr-dot fail"></span>' : ''}
                  <span>${idx + 1}</span>
                </span>
                <button class="cr-icon-btn view" onclick="event.stopPropagation();openTaskDetailPopup(${idx});return false;" title="M&#7903; chi ti&#7871;t task"><i class="fa-solid fa-up-right-and-down-left-from-center"></i></button>
              </div>
              <div class="cr-task-chip"><select class="cr-cell-select" onchange="updateTask(${idx},'mode',this.value)">${modeOpts}</select></div>
              <div class="cr-task-chip cr-task-chip-source">${sourceHTML}</div>
              <div class="cr-task-chip cr-task-chip-provider">${providerControl}</div>
              <div class="cr-task-chip cr-task-chip-model"><select class="cr-cell-select" onchange="updateTask(${idx},'modelId',this.value)">${modelOpts}</select></div>
              <div class="cr-task-chip cr-task-chip-cost"><span class="cr-cell-fixed" data-task-cost="${t.id}" style="font-size:11px;color:var(--yellow);font-weight:700">${costText}</span></div>
              <div class="cr-task-chip cr-task-chip-prompt"><textarea class="cr-cell-textarea cr-cell-textarea-wide" id="promptInput_${idx}" placeholder="camera slow pan, product rotating..." oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px';updateTask(${idx},'prompt',this.value)" onfocus="this.style.height='auto';this.style.height=this.scrollHeight+'px'" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()" onpointerdown="event.stopPropagation()" ontouchstart="event.stopPropagation()">${t.prompt}</textarea></div>
              <div class="cr-task-chip cr-task-chip-qc">${qcHTML}</div>
              <div class="cr-task-chip cr-task-chip-actions">
                <div class="cr-row-actions">
                  ${canStartTask ? `<button class="cr-icon-btn run" onclick="event.stopPropagation();runSingleTask(${idx});return false;" title="${isRerun ? 'Re-run' : 'Ch&#7841;y'}"><i class="fa-solid ${isRerun ? 'fa-rotate-right' : 'fa-play'}"></i></button>` : ''}
                  ${isSubmitting ? `<button class="cr-icon-btn view" disabled title="&#272;ang g&#7917;i task"><i class="fa-solid fa-spinner fa-spin"></i></button><span style="font-size:9px;color:var(--muted);font-weight:700">&#272;ang g&#7917;i</span>` : ''}
                  ${t.status==='running' ? `<button class="cr-icon-btn view" onclick="event.stopPropagation();pollTaskStatus(${idx});return false;" title="C&#7853;p nh&#7853;t tr&#7841;ng th&#225;i"><i class="fa-solid fa-rotate-right"></i></button>` : ''}
                  ${(isSubmitting || isRuntimeRunning) ? `<span style="font-size:9px;color:var(--brand);font-weight:700">${isSubmitting ? '0%' : `${Math.round(progressPct)}%`}</span>` : ''}
                  ${hasResultUrl ? `<button class="cr-icon-btn view" onclick="event.stopPropagation();previewTaskVideo(${idx});return false;" title="Xem k&#7871;t qu&#7843;"><i class="fa-solid fa-eye"></i></button>` : ''}
                  ${t.qcStatus==='approved' ? `<button class="cr-icon-btn dl" onclick="event.stopPropagation();downloadTask(${idx});return false;" title="T&#7843;i v&#7873;"><i class="fa-solid fa-download"></i></button>` : ''}
                  <button class="cr-icon-btn del" onclick="event.stopPropagation();removeTaskRow(${idx});return false;" title="X&#243;a"><i class="fa-solid fa-trash"></i></button>
                </div>
              </div>
            </div>
            <div class="cr-task-line cr-task-line-bottom">
              <div class="cr-task-grid-bottom">
                <div class="cr-task-metric cr-bottom-col5">
                  <div class="cr-task-metric-label">Nh&#243;m hi&#7879;u &#7913;ng</div>
                  <div class="cr-task-metric-control"><select class="cr-cell-select" onchange="updateTask(${idx},'effectGroup',this.value)">${effectOpts}</select></div>
                </div>
                <div class="cr-task-metric cr-bottom-col6 ${isCustomEffect ? '' : 'is-hidden'}">
                  <div class="cr-task-metric-label">Nh&#7853;p hi&#7879;u &#7913;ng</div>
                  <div class="cr-task-metric-control">${customEffectControl}</div>
                </div>
                <div class="cr-task-metric cr-bottom-col7">
                  <div class="cr-task-metric-label">Th&#7901;i l&#432;&#7907;ng</div>
                  <div class="cr-task-metric-control"><select class="cr-cell-select" onchange="updateTask(${idx},'duration',this.value)">${durOpts}</select></div>
                </div>
                <div class="cr-task-metric cr-bottom-col8">
                  <div class="cr-task-metric-label">T&#7881; l&#7879;</div>
                  <div class="cr-task-metric-control"><select class="cr-cell-select" onchange="updateTask(${idx},'ratio',this.value)">${ratioOpts}</select></div>
                </div>
                <div class="cr-task-metric cr-bottom-col9">
                  <div class="cr-task-metric-label">&#272;&#7897; ph&#226;n gi&#7843;i</div>
                  <div class="cr-task-metric-control">${resolutionControl}</div>
                </div>
                <div class="cr-task-metric cr-bottom-col10">
                  <div class="cr-task-metric-label">FPS</div>
                  <div class="cr-task-metric-control">${fpsControl}</div>
                </div>
                <div class="cr-task-metric cr-bottom-col11">
                  <div class="cr-task-metric-label">Chuy&#7875;n &#273;&#7897;ng</div>
                  <div class="cr-task-metric-control"><select class="cr-cell-select" onchange="updateTask(${idx},'cameraMove',this.value);autoCameraPrompt(${idx},this.value)">${camOpts}</select></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      ${isRuntimeRunning ? `<div class="cr-progress-row" data-task-idx="${idx}"><div class="progress-bar" style="height:3px"><div class="progress-fill orange" style="width:${Math.max(2, Number(t.progress || 0))}%"></div></div></div>` : ''}
      ${t.qcStatus === 'rejected' && t.qcNote ? `<div class="cr-qc-note-row" data-task-idx="${idx}"><div class="cr-qc-reason"><i class="fa-solid fa-comment-dots"></i> QC: "${t.qcNote}"</div></div>` : ''}
      <div class="cr-task-gap-row" data-task-idx="${idx}"></div>
    </div>
  `;
}

function rerenderTaskRow(idx) {
  const { combo } = getActiveComboContext();
  const body = document.getElementById('taskTableBody');
  if (!combo || !body || !combo.tasks[idx]) {
    renderActiveCombo();
    return;
  }
  const currentNodes = Array.from(body.querySelectorAll(`.cr-task-row-shell[data-task-idx="${idx}"]`));
  if (!currentNodes.length) {
    renderActiveCombo();
    return;
  }
  const nextSibling = currentNodes[currentNodes.length - 1].nextSibling;
  const temp = document.createElement('div');
  temp.innerHTML = renderTaskRow(combo.tasks[idx], idx);
  const newNodes = Array.from(temp.children);
  currentNodes.forEach((node) => node.remove());
  if (!newNodes.length) return;
  newNodes.forEach((node) => body.insertBefore(node, nextSibling));
  adjustAllTextareas();
}

function _getTaskIndexInCombo(task, comboRef = null) {
  const combo = comboRef || _findTaskOwnerCombo(task) || null;
  if (!combo || !Array.isArray(combo.tasks)) return -1;
  return combo.tasks.indexOf(task);
}

function _refreshTaskDetailPopupByRef(task, comboRef = null) {
  const container = document.getElementById('taskDetailPopupContainer');
  if (!container) return;
  const combo = comboRef || _findTaskOwnerCombo(task) || null;
  if (!combo || combo !== taskCombos[activeComboIdx]) return;
  const idx = _getTaskIndexInCombo(task, combo);
  if (idx < 0) return;
  refreshTaskDetailPopup(idx);
}

function _rerenderTaskByRef(task, comboRef = null) {
  const combo = comboRef || _findTaskOwnerCombo(task) || null;
  if (!combo) return;
  if (combo !== taskCombos[activeComboIdx]) {
    renderComboTabs();
    updateStatusBar();
    return;
  }
  const idx = _getTaskIndexInCombo(task, combo);
  if (idx < 0) return;
  rerenderTaskRow(idx);
  _refreshTaskDetailPopupByRef(task, combo);
  syncActiveComboTabMeta();
  updateStatusBar();
}

function refreshActiveComboSurface(options = {}) {
  renderActiveCombo();
  syncActiveComboTabMeta();
  if (options.withSourceImages) renderSourceImages();
  if (options.withCosts) recalcAllCosts();
  updateStatusBar();
}

// ========== TASK CRUD ==========
function removeTaskRow(idx) {
  const { combo } = getActiveComboContext();
  if (!combo || !combo.tasks[idx]) return;
  const t = combo.tasks[idx];
  // Unmark images
  if (t.sourceImgId) unmarkImage(t.sourceImgId);
  if (t.firstFrameId) unmarkImage(t.firstFrameId);
  if (t.lastFrameId) unmarkImage(t.lastFrameId);
  combo.tasks.splice(idx, 1);
  refreshActiveComboSurface({ withSourceImages: true, withCosts: true });
  scheduleSaveCreatorDraftState(0);
}

function syncTaskMetricDisplays(task) {
  if (!task || !task.id) return;
  const mediaProfile = applyTaskMediaProfile(task);
  const costText = getTaskCostLabel(task);
  document.querySelectorAll(`[data-task-cost="${task.id}"]`).forEach((el) => { el.textContent = costText; });
  document.querySelectorAll(`[data-task-resolution="${task.id}"]`).forEach((el) => { el.textContent = mediaProfile.resolutionDisplay; });
  document.querySelectorAll(`[data-task-fps="${task.id}"]`).forEach((el) => { el.textContent = mediaProfile.fpsDisplay; });
}

function updateTask(idx, field, value) {
  const { combo } = getActiveComboContext();
  if (!combo) return;
  const t = combo.tasks[idx];
  if (!t) return;
  if (field === 'provider' && !canChangeTaskProvider()) return;

  if (field === 'mode' && value !== t.mode) {
    // When switching mode, clear source assignments
    if (t.sourceImgId) unmarkImage(t.sourceImgId);
    if (t.firstFrameId) unmarkImage(t.firstFrameId);
    if (t.lastFrameId) unmarkImage(t.lastFrameId);
    t.sourceImg = null; t.sourceImgId = null;
    t.firstFrame = null; t.firstFrameId = null;
    t.lastFrame = null; t.lastFrameId = null;
    renderSourceImages();
  }

  t[field] = value;

  if (field === 'provider') {
    t.modelId = getDefaultModelId(String(value || '').trim().toLowerCase() || 'provider1');
    applyTaskMediaProfile(t);
    t.credits = calcTaskCost(t);
    recalcAllCosts();
    rerenderTaskRow(idx);
    refreshTaskDetailPopup(idx);
    scheduleSaveCreatorDraftState(0);
    return;
  }
  if (field === 'effectGroup') {
    if (String(value || '').trim().toLowerCase() !== 'custom') t.effectGroupCustom = '';
    rerenderTaskRow(idx);
    refreshTaskDetailPopup(idx);
    scheduleSaveCreatorDraftState(0);
    pushCreatorPresence();
    return;
  }
  if (field === 'modelId') {
    applyTaskMediaProfile(t);
    t.credits = calcTaskCost(t);
    recalcAllCosts();
    rerenderTaskRow(idx);
    refreshTaskDetailPopup(idx);
    scheduleSaveCreatorDraftState(0);
    return;
  }
  if (field === 'duration' || field === 'resolution' || field === 'fps') {
    t.credits = calcTaskCost(t);
    syncTaskMetricDisplays(t);
    recalcAllCosts();
    refreshTaskDetailPopup(idx);
    scheduleSaveCreatorDraftState(0);
    return;
  }
  if (field === 'mode') {
    rerenderTaskRow(idx);
    refreshTaskDetailPopup(idx);
    scheduleSaveCreatorDraftState(0);
    return;
  }
  if (field === 'cameraMove' || field === 'ratio') {
    refreshTaskDetailPopup(idx);
    scheduleSaveCreatorDraftState(0);
    return;
  }
  if (field === 'prompt') {
    scheduleSaveCreatorDraftState(180);
    pushCreatorPresence();
    return;
  }
  if (field === 'effectGroupCustom') {
    scheduleSaveCreatorDraftState(0);
    pushCreatorPresence();
    return;
  }
  scheduleSaveCreatorDraftState(0);
}

function setComboQCMode(val) {
  taskCombos[activeComboIdx].qcMode = val;
}

// Camera move ? auto-fill prompt
const CAMERA_PROMPT_MAP = {
  '-- None --': '',
  'Pan Left': 'smooth slow pan left, cinematic movement, product centered',
  'Pan Right': 'smooth slow pan right, cinematic movement, product centered',
  'Zoom In': 'slow zoom in, focus on product details, shallow depth of field',
  'Zoom Out': 'slow zoom out, reveal full product, clean background',
  'Orbit Left': 'slow orbit left around product, 360 view, studio lighting',
  'Orbit Right': 'slow orbit right around product, 360 view, studio lighting',
  'Tilt Up': 'smooth tilt up, reveal product from bottom to top, dramatic angle',
  'Tilt Down': 'smooth tilt down, overhead to eye level, elegant reveal',
  'Push In': 'cinematic push in, dramatic approach, product hero shot',
  'Dolly Out': 'slow dolly out, product recedes, establishing shot, wide angle',
};

function autoCameraPrompt(idx, cameraMove) {
  const prompt = CAMERA_PROMPT_MAP[cameraMove];
  if (prompt === undefined || cameraMove === '-- None --') return;
  const combo = taskCombos[activeComboIdx];
  const t = combo?.tasks[idx];
  if (!t) return;

  // Update data
  t.prompt = prompt;
  
  // Update table UI
  const tablePrompt = document.getElementById('promptInput_' + idx);
  if (tablePrompt) {
    tablePrompt.value = prompt;
    tablePrompt.style.height = 'auto';
    tablePrompt.style.height = tablePrompt.scrollHeight + 'px';
  }
  
  // Update popup UI
  const popupPrompt = document.getElementById('taskDetailPrompt');
  if (popupPrompt) {
    popupPrompt.value = prompt;
    popupPrompt.style.height = 'auto';
    popupPrompt.style.height = popupPrompt.scrollHeight + 'px';
  }

  scheduleSaveCreatorDraftState(0);

  showToast(`\u0110\u00E3 \u00E1p d\u1EE5ng prompt: ${cameraMove}`, 'success');
}

function adjustAllTextareas() {
  document.querySelectorAll('.cr-cell-textarea, #taskDetailPrompt').forEach(ta => {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  });
}

// ========== IMAGE SOURCE MANAGEMENT ==========
let srcFilter = 'all'; // 'all' = show folder cards, folder name = show images inside

function switchSourceTab(tab, el) {
  srcFilter = tab;
  renderSourceImages();
}

function srcGoRoot() {
  srcFilter = 'all';
  renderSourceImages();
}

function srcOpenFolder(folderName) {
  srcFilter = folderName;
  renderSourceImages();
}

// Called from ondblclick with numeric index  avoids string escaping issues
function _srcOpenByIdx(idx) {
  const names = window._srcFolderNames;
  if (names && names[idx]) srcOpenFolder(names[idx]);
}

// ========== SOURCE RENAME ==========
function showSrcRename() {
  const panel = document.getElementById('srcRenamePanel');
  if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  previewSrcRename();
}

function previewSrcRename() {
  const rule = document.getElementById('srcRenameRule')?.value || 'keep';
  const customInput = document.getElementById('srcRenameCustom');
  if (customInput) customInput.style.display = rule === 'custom' ? 'block' : 'none';

  const folders = [...new Set(DEMO_IMAGES.map(i => i.folder))];
  const combo = taskCombos[activeComboIdx];
  const codeName = combo ? combo.name : '';
  const customPrefix = customInput?.value || codeName;

  const preview = document.getElementById('srcRenamePreview');
  if (!preview) return;

  preview.innerHTML = folders.map((f, i) => {
    let newName;
    if (rule === 'keep') newName = f;
    else if (rule === 'code') newName = codeName + '_Folder' + (i + 1);
    else newName = customPrefix + '_Folder' + (i + 1);
    return `<span style="color:var(--muted2)">${f}</span> ? <span style="color:var(--brand);font-weight:600">${newName}</span>`;
  }).join('<br>');
}

function applySrcRename() {
  const rule = document.getElementById('srcRenameRule')?.value || 'keep';
  if (rule === 'keep') { showToast('\u0047\u0069\u1EEF \u0074\u00EA\u006E \u0067\u1ED1\u0063, \u006B\u0068\u00F4\u006E\u0067 \u0074\u0068\u0061\u0079 \u0111\u1ED5\u0069', 'info'); return; }

  const folders = [...new Set(DEMO_IMAGES.map(i => i.folder))];
  const combo = taskCombos[activeComboIdx];
  const codeName = combo ? combo.name : '';
  const customPrefix = document.getElementById('srcRenameCustom')?.value || codeName;

  const renameMap = {};
  folders.forEach((f, i) => {
    if (rule === 'code') renameMap[f] = codeName + '_Folder' + (i + 1);
    else renameMap[f] = customPrefix + '_Folder' + (i + 1);
  });

  DEMO_IMAGES.forEach(img => {
    if (renameMap[img.folder]) img.folder = renameMap[img.folder];
  });

  document.getElementById('srcRenamePanel').style.display = 'none';
  srcFilter = 'all';
  renderSourceImages();
  showToast(`\u0110\u00E3 \u0111\u1ED5i t\u00EAn ${folders.length} th\u01B0 m\u1EE5c`, 'success');
}

function handleSrcSelect(e) {
  loadSourceImages(Array.from(e.target.files));
  e.target.value = '';
}

function handleSrcDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag');
  loadSourceImages(Array.from(e.dataTransfer.files));
}

function readImageDimensions(file) {
  return new Promise((resolve) => {
    try {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const result = { width: Number(img.naturalWidth || 0), height: Number(img.naturalHeight || 0) };
        URL.revokeObjectURL(objectUrl);
        resolve(result);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve({ width: 0, height: 0 });
      };
      img.src = objectUrl;
    } catch (_) {
      resolve({ width: 0, height: 0 });
    }
  });
}

function _canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob || null), mimeType, quality);
  });
}

function _splitFileName(name) {
  const raw = String(name || 'image').trim() || 'image';
  const idx = raw.lastIndexOf('.');
  if (idx <= 0) return { base: raw, ext: '' };
  return { base: raw.slice(0, idx), ext: raw.slice(idx + 1).toLowerCase() };
}

async function normalizeImageForUpload(file, maxBytes = 20 * 1024 * 1024) {
  if (!file || typeof file.size !== 'number') throw new Error('File không hợp lệ');
  if (file.size <= maxBytes) return { file, compressed: false, originalBytes: file.size, finalBytes: file.size };

  const mimeSrc = String(file.type || '').toLowerCase();
  if (!mimeSrc.startsWith('image/')) throw new Error('Chỉ hỗ trợ file ảnh');

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = objectUrl;
    });

    let width = Number(img.naturalWidth || 0);
    let height = Number(img.naturalHeight || 0);
    if (width <= 0 || height <= 0) throw new Error('Không đọc được kích thước ảnh');

    const maxSide = 4096;
    const sideScale = Math.min(1, maxSide / Math.max(width, height));
    let scale = sideScale;
    let quality = 0.9;
    const targetMime = (mimeSrc === 'image/jpeg' || mimeSrc === 'image/jpg' || mimeSrc === 'image/webp')
      ? (mimeSrc === 'image/jpg' ? 'image/jpeg' : mimeSrc)
      : 'image/jpeg';
    const targetExt = targetMime === 'image/webp' ? 'webp' : 'jpg';
    const { base } = _splitFileName(file.name);

    for (let attempt = 0; attempt < 14; attempt += 1) {
      const w = Math.max(1, Math.floor(width * scale));
      const h = Math.max(1, Math.floor(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Không khởi tạo được canvas');
      ctx.drawImage(img, 0, 0, w, h);

      const blob = await _canvasToBlob(canvas, targetMime, quality);
      if (!blob) throw new Error('Nén ảnh thất bại');
      if (blob.size <= maxBytes) {
        const outFile = new File([blob], `${base}.${targetExt}`, { type: targetMime, lastModified: Date.now() });
        return {
          file: outFile,
          compressed: true,
          originalBytes: file.size,
          finalBytes: outFile.size,
          originalWidth: width,
          originalHeight: height,
          finalWidth: w,
          finalHeight: h,
        };
      }

      if (quality > 0.45) {
        quality -= 0.1;
      } else {
        scale *= 0.82;
        quality = 0.82;
      }
    }
    throw new Error(`Không thể nén ảnh xuống dưới ${Math.floor(maxBytes / (1024 * 1024))}MB`);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadSourceImages(files) {
  if (!files.length) return;
  
  const imgExts = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'];
  const imageFiles = Array.from(files).filter(f => {
    const ext = f.name.split('.').pop().toLowerCase();
    return imgExts.includes(ext) || (f.type && f.type.startsWith('image/'));
  });
  
  if (!imageFiles.length) {
    showToast('\u004B\u0068\u00F4\u006E\u0067 \u0074\u00EC\u006D \u0074\u0068\u1EA5\u0079 \u1EA3\u006E\u0068 \u006E\u00E0\u006F \u0074\u0072\u006F\u006E\u0067 \u0074\u0068\u01B0 \u006D\u1EE5\u0063', 'error');
    return;
  }

  let defaultFolder = '';
  if (imageFiles[0].webkitRelativePath) {
    defaultFolder = imageFiles[0].webkitRelativePath.split('/')[0];
  }

  // Show rename modal for both single images (defaultFolder='') and folders
  const combo = taskCombos[activeComboIdx];
  const codeName = combo ? combo.name : '';
  const taskCount = combo ? combo.tasks.length : 0;

  showUploadRenameModal(imageFiles, defaultFolder, codeName, taskCount);
}

function showUploadRenameModal(files, defaultFolder, codeName, taskCount) {
  const container = document.createElement('div');
  container.id = 'uploadRenameModal';
  container.innerHTML = `
    <div class="cr-popup-overlay" onclick="closeUploadRenameModal()"></div>
    <div class="cr-popup show" style="width:480px">
      <div class="cr-popup-header">
        <div class="cr-popup-img-info">
          <i class="fa-solid fa-folder-open" style="color:var(--yellow)"></i>
          <span class="cr-popup-title">T&#7843;i l&#234;n ${files.length} &#7843;nh</span>
        </div>
        <button class="cr-popup-close" onclick="closeUploadRenameModal()"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="cr-popup-body">
        <div class="form-group" style="margin-bottom:10px; display:${defaultFolder ? 'block' : 'none'}">
          <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">
            <i class="fa-solid fa-folder" style="color:var(--yellow)"></i> T&#234;n th&#432; m&#7909;c
          </label>
          <input type="text" class="form-input" id="uploadFolderName" value="${defaultFolder}" style="font-size:12px">
        </div>
        <div class="form-group" style="margin-bottom:10px">
          <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">
            <i class="fa-solid fa-pen" style="color:var(--brand)"></i> &#272;&#7893;i t&#234;n &#7843;nh theo quy t&#7855;c
          </label>
          <select class="form-select" id="uploadRenameRule" style="font-size:11px" onchange="previewUploadRename()">
            <option value="keep">Gi&#7919; t&#234;n g&#7889;c</option>
            <option value="code">Theo CODE: ${codeName}_001, ${codeName}_002...</option>
            <option value="code_task">CODE + Task: ${codeName}_T1_001, ${codeName}_T2_002...</option>
            <option value="custom">T&#249;y ch&#7881;nh prefix...</option>
          </select>
        </div>
        <div class="form-group" id="customPrefixGroup" style="display:none;margin-bottom:10px">
          <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">Prefix t&#249;y ch&#7881;nh</label>
          <input type="text" class="form-input" id="uploadCustomPrefix" value="${codeName}" style="font-size:12px" oninput="previewUploadRename()">
        </div>
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:12px;max-height:120px;overflow-y:auto">
          <div style="font-size:10px;font-weight:700;color:var(--muted);margin-bottom:4px">Preview t&#234;n file:</div>
          <div id="uploadRenamePreview" style="font-size:10px;color:var(--text);line-height:1.6"></div>
        </div>
        <button class="cr-btn cr-btn-primary" style="width:100%;padding:10px;font-size:13px" onclick="confirmUploadRename()">
          <i class="fa-solid fa-upload"></i> T&#7843;i l&#234;n ${files.length} &#7843;nh
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(container);

  // Store files reference
  window._pendingUploadFiles = files;
  window._pendingUploadCodeName = codeName;
  window._pendingUploadTaskCount = taskCount;

  previewUploadRename();
}

function previewUploadRename() {
  const rule = document.getElementById('uploadRenameRule')?.value || 'keep';
  const customPrefix = document.getElementById('uploadCustomPrefix')?.value || '';
  const customGroup = document.getElementById('customPrefixGroup');

  if (customGroup) customGroup.style.display = rule === 'custom' ? 'block' : 'none';

  const files = window._pendingUploadFiles || [];
  const codeName = window._pendingUploadCodeName || 'CODE';
  const previewEl = document.getElementById('uploadRenamePreview');
  if (!previewEl) return;

  const maxShow = Math.min(files.length, 6);
  let previews = [];
  for (let i = 0; i < maxShow; i++) {
    const ext = files[i].name.split('.').pop();
    const num = String(i + 1).padStart(3, '0');
    let newName;
    if (rule === 'keep') newName = files[i].name;
    else if (rule === 'code') newName = `${codeName}_${num}.${ext}`;
    else if (rule === 'code_task') {
      const taskNum = Math.min(i, (window._pendingUploadTaskCount || 1) - 1) + 1;
      newName = `${codeName}_T${taskNum}_${num}.${ext}`;
    } else {
      newName = `${customPrefix || 'IMG'}_${num}.${ext}`;
    }
    previews.push(`<span style="color:var(--muted2)">${files[i].name}</span> ? <span style="color:var(--brand);font-weight:600">${newName}</span>`);
  }
  if (files.length > maxShow) previews.push(`<span style="color:var(--muted)">...v ${files.length - maxShow} file khc</span>`);
  previewEl.innerHTML = previews.join('<br>');
}

function closeUploadRenameModal() {
  const modal = document.getElementById('uploadRenameModal');
  if (modal) modal.remove();
  window._pendingUploadFiles = null;
}

function _splitBaseExt(name) {
  const raw = String(name || '').trim();
  const idx = raw.lastIndexOf('.');
  if (idx <= 0 || idx === raw.length - 1) return { base: raw || 'image', ext: '' };
  return { base: raw.slice(0, idx), ext: raw.slice(idx + 1) };
}

function _buildImageNameKey(folderName, fileName) {
  return `${String(folderName || '').trim().toLowerCase()}::${String(fileName || '').trim().toLowerCase()}`;
}

function _ensureUniqueImageName(folderName, desiredName, usedKeys) {
  const { base, ext } = _splitBaseExt(desiredName);
  const extPart = ext ? `.${ext}` : '';
  let candidate = `${base}${extPart}`;
  let suffix = 1;
  while (usedKeys.has(_buildImageNameKey(folderName, candidate))) {
    candidate = `${base}_${suffix}${extPart}`;
    suffix += 1;
  }
  usedKeys.add(_buildImageNameKey(folderName, candidate));
  return candidate;
}

async function confirmUploadRename() {
  const files = window._pendingUploadFiles;
  if (!files || !files.length) return;

  const rule = document.getElementById('uploadRenameRule')?.value || 'keep';
  const customPrefix = document.getElementById('uploadCustomPrefix')?.value || 'IMG';
  const folderName = document.getElementById('uploadFolderName')?.value || '';
  const codeName = window._pendingUploadCodeName || 'CODE';
  const taskCount = window._pendingUploadTaskCount || 1;
  const staffId = AppData.currentUser?.id || 'admin_1';
  const uploadTime = new Date().toISOString();
  const sessionId = getCreatorSessionId();
  let compressedCount = 0;
  let skippedCount = 0;
  let duplicateRenamedCount = 0;
  const totalFiles = files.length;
  setCreatorUploadProgress(`Đang chuẩn bị upload ${totalFiles} ảnh...`);
  const usedNameKeys = new Set();
  DEMO_IMAGES.forEach((img) => {
    usedNameKeys.add(_buildImageNameKey(String(img?.folder || ''), String(img?.name || '')));
  });

  for (let i = 0; i < files.length; i += 1) {
    const f = files[i];
    setCreatorUploadProgress(`Đang xử lý ảnh ${i + 1}/${totalFiles}: ${f.name}`);
    const ext = f.name.split('.').pop();
    const num = String(i + 1).padStart(3, '0');
    let newName;
    if (rule === 'keep') newName = f.name;
    else if (rule === 'code') newName = `${codeName}_${num}.${ext}`;
    else if (rule === 'code_task') {
      const taskNum = Math.min(i, taskCount - 1) + 1;
      newName = `${codeName}_T${taskNum}_${num}.${ext}`;
    } else {
      newName = `${customPrefix}_${num}.${ext}`;
    }
    const uniqueName = _ensureUniqueImageName(folderName.trim(), newName, usedNameKeys);
    if (uniqueName !== newName) duplicateRenamedCount += 1;
    newName = uniqueName;
    
    let uploadFile = f;
    try {
      setCreatorUploadProgress(`Đang nén/chuẩn hóa ảnh ${i + 1}/${totalFiles}: ${f.name}`);
      const normalized = await normalizeImageForUpload(f, 20 * 1024 * 1024);
      uploadFile = normalized.file;
      if (normalized.compressed) compressedCount += 1;
    } catch (compressErr) {
      skippedCount += 1;
      showToast(`Bỏ qua "${f.name}": ${compressErr && compressErr.message ? compressErr.message : 'nén thất bại'}`, 'error');
      continue;
    }

    const dims = await readImageDimensions(uploadFile);
    const localPreviewUrl = URL.createObjectURL(uploadFile);
    let uploadedAsset = null;
    try {
      if (API && typeof API.uploadInputAsset === 'function') {
        setCreatorUploadProgress(`Đang tải ảnh ${i + 1}/${totalFiles}: ${newName}`);
        const fd = new FormData();
        fd.append('file', uploadFile, newName);
        fd.append('session_id', sessionId);
        fd.append('code_tag', codeName);
        fd.append('folder_name', folderName.trim());
        fd.append('file_name', newName);
        fd.append('mime_type', uploadFile.type || '');
        fd.append('width', String(Number(dims.width || 0)));
        fd.append('height', String(Number(dims.height || 0)));
        const uploadResp = await API.uploadInputAsset(fd);
        if (uploadResp && uploadResp.ok && uploadResp.asset) {
          uploadedAsset = uploadResp.asset;
        }
      }
    } catch (_) {}

    if (uploadedAsset) {
      const item = mapInputAssetToCreatorImage(uploadedAsset);
      item.name = newName;
      item.originalName = f.name;
      item.displayName = newName;
      item.folder = folderName.trim();
      item.codeTag = codeName;
      item.staffId = staffId;
      item.uploadTime = uploadTime;
      item.width = Number(dims.width || item.width || 0);
      item.height = Number(dims.height || item.height || 0);
      item.mimeType = uploadFile.type || item.mimeType || '';
      item._file = uploadFile;
      item.previewUrl = item.sourceUrl || localPreviewUrl;
      item.uploadedUrl = item.sourceUrl || item.uploadedUrl || '';
      DEMO_IMAGES.unshift(item);
    } else {
      let legacyUploadedUrl = '';
      try {
        if (API && typeof API.uploadImage === 'function') {
          setCreatorUploadProgress(`Đang tải ảnh ${i + 1}/${totalFiles}: ${newName}`);
          const fdLegacy = new FormData();
          fdLegacy.append('file', uploadFile, uploadFile.name || newName);
          const upLegacy = await API.uploadImage(fdLegacy);
          legacyUploadedUrl = String(upLegacy?.url || '').trim();
        }
      } catch (_) {}
      DEMO_IMAGES.unshift({
        id: 'img_u' + Date.now() + '_' + i,
        name: newName,
        originalName: f.name,
        displayName: newName,
        folder: folderName.trim(),
        codeTag: codeName,
        staffId: staffId,
        uploadTime: uploadTime,
        _file: uploadFile,
        previewUrl: legacyUploadedUrl || localPreviewUrl,
        sourceUrl: legacyUploadedUrl,
        uploadedUrl: legacyUploadedUrl,
        width: Number(dims.width || 0),
        height: Number(dims.height || 0),
        mimeType: uploadFile.type || '',
        used: false,
        usedAs: null,
        usedInTask: null,
        edited: false,
      });
    }
  }

  closeUploadRenameModal();
  setCreatorUploadProgress('');
  renderSourceImages();
  const folderText = folderName.trim() ? `v\u00E0o th\u01B0 m\u1EE5c "${folderName.trim()}"` : '\u006E\u0068\u01B0 \u1EA3\u006E\u0068 \u006C\u1EBB';
  const uploadedCount = Math.max(0, files.length - skippedCount);
  if (uploadedCount > 0) {
    showToast(`\u0110\u00E3 t\u1EA3i l\u00EAn ${uploadedCount} \u1EA3nh ${folderText}`, 'success');
  }
  if (compressedCount > 0) {
    showToast(`\u0110\u00E3 n\u00E9n ${compressedCount} \u1EA3nh >20MB xu\u1ED1ng d\u01B0\u1EDBi 20MB`, 'info');
  }
  if (duplicateRenamedCount > 0) {
    showToast(`\u0110\u00E3 t\u1EF1 \u0111\u1ED9ng \u0111\u1ED5i t\u00EAn ${duplicateRenamedCount} \u1EA3nh do tr\u00F9ng t\u00EAn`, 'info');
  }
  if (uploadedCount === 0 && skippedCount > 0) {
    showToast('Không có ảnh nào upload thành công', 'error');
  }
}

async function deleteSourceImage(imgId) {
  const idx = DEMO_IMAGES.findIndex((img) => String(img?.id || '') === String(imgId || ''));
  if (idx < 0) return;
  const img = DEMO_IMAGES[idx];
  const imgName = String(img?.name || 'ảnh');
  const ok = window.confirm(`Xóa ảnh "${imgName}"?`);
  if (!ok) return;
  try {
    if (typeof unassignImg === 'function') unassignImg(String(img.id || ''));
    if (API && typeof API.deleteInputAsset === 'function' && img.inputAssetId) {
      await API.deleteInputAsset(String(img.inputAssetId));
    }
    DEMO_IMAGES.splice(idx, 1);
    refreshActiveComboSurface({ withSourceImages: true });
    showToast(`Đã xóa ảnh "${imgName}"`, 'success');
  } catch (err) {
    showToast(`Xóa ảnh thất bại: ${err && err.message ? err.message : 'Lỗi không xác định'}`, 'error');
  }
}

async function deleteSourceFolder(folderName) {
  const target = String(folderName || '').trim();
  if (!target) return;
  const items = DEMO_IMAGES.filter((img) => String(img?.folder || '').trim() === target);
  if (items.length === 0) return;
  const ok = window.confirm(`Xóa thư mục "${target}" và ${items.length} ảnh bên trong?`);
  if (!ok) return;
  let failed = 0;
  for (const img of items) {
    try {
      if (typeof unassignImg === 'function') unassignImg(String(img.id || ''));
      if (API && typeof API.deleteInputAsset === 'function' && img.inputAssetId) {
        await API.deleteInputAsset(String(img.inputAssetId));
      }
    } catch (_) {
      failed += 1;
    }
  }
  for (let i = DEMO_IMAGES.length - 1; i >= 0; i -= 1) {
    if (String(DEMO_IMAGES[i]?.folder || '').trim() === target) DEMO_IMAGES.splice(i, 1);
  }
  refreshActiveComboSurface({ withSourceImages: true });
  if (failed > 0) showToast(`Đã xóa thư mục "${target}" (${failed} ảnh chưa xóa được trên server)`, 'warning');
  else showToast(`Đã xóa thư mục "${target}"`, 'success');
}

function deleteSourceFolderByIdx(idx) {
  const names = Array.isArray(window._srcFolderNames) ? window._srcFolderNames : [];
  const target = names[Number(idx)];
  if (target) deleteSourceFolder(target);
}

function renderSourceImages() {
  const list = document.getElementById('srcImageList');
  const countEl = document.getElementById('srcCount');
  const badgeEl = document.getElementById('srcTotalBadge');
  if (!list) return;

  function getImgUsages(imgId) {
    const usages = [];
    taskCombos.forEach(c => c.tasks.forEach((t, ti) => {
      if (t.sourceImgId === imgId) usages.push({ combo: c.name, taskIdx: ti, role: 'I2V' });
      if (t.firstFrameId === imgId) usages.push({ combo: c.name, taskIdx: ti, role: 'Dau' });
      if (t.lastFrameId === imgId) usages.push({ combo: c.name, taskIdx: ti, role: 'Cuối' });
    }));
    return usages;
  }

  // Update breadcrumb
  const bc = document.getElementById('srcBreadcrumb');
  if (bc) {
    if (srcFilter === 'all') {
      bc.innerHTML = '<span class="cr-bc-item active"><i class="fa-solid fa-home"></i> Tat ca</span>';
    } else {
      bc.innerHTML = `<span class="cr-bc-item" onclick="srcGoRoot()"><i class="fa-solid fa-home"></i> Tat ca</span>
        <i class="fa-solid fa-chevron-right" style="font-size:7px;color:var(--muted2)"></i>
        <span class="cr-bc-item active"><i class="fa-solid fa-folder-open" style="color:var(--yellow)"></i> ${srcFilter}</span>`;
    }
  }

  let html = '';

  if (srcFilter === 'all') {
    // ===== ROOT VIEW: Show folder cards in grid =====
    const folders = {};
    const singleImgs = [];
    DEMO_IMAGES.forEach(img => {
      if (!img.folder || img.folder.trim() === '') singleImgs.push(img);
      else {
        if (!folders[img.folder]) folders[img.folder] = [];
        folders[img.folder].push(img);
      }
    });

    const folderNames = Object.keys(folders);
    // Store globally so onclick can access by index
    window._srcFolderNames = folderNames;

    if (folderNames.length === 0 && singleImgs.length === 0) {
      html = '<div style="padding:20px;text-align:center;color:var(--muted2);font-size:12px">Ch&#432;a c&#243; &#7843;nh ho&#7863;c th&#432; m&#7909;c n&#224;o</div>';
    } else {
      if (folderNames.length > 0) {
        html += '<div class="cr-folder-grid" style="margin-bottom:20px">';
        folderNames.forEach((fname, fIdx) => {
          const imgs = folders[fname];
          const editedCount = imgs.filter(i => i.edited).length;
          const assignedCount = imgs.filter(i => getImgUsages(i.id).length > 0).length;
          const safeName = fname.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
          html += `
            <div class="cr-folder-card" ondblclick="_srcOpenByIdx(${fIdx})" title="Nh&#7845;n &#273;&#250;p &#273;&#7875; m&#7903;">
              <button class="cr-delete-btn" onclick="event.stopPropagation();deleteSourceFolderByIdx(${fIdx})" title="X&#243;a th&#432; m&#7909;c"><i class="fa-solid fa-trash"></i></button>
              <div class="cr-folder-card-icon"><i class="fa-solid fa-folder"></i></div>
              <div class="cr-folder-card-name">${safeName}</div>
              <div class="cr-folder-card-meta">
                ${imgs.length} anh${editedCount > 0 ? '  <span style="color:#9B6EE0">' + editedCount + ' edited</span>' : ''}${assignedCount > 0 ? '  <span style="color:var(--green)">' + assignedCount + ' gn</span>' : ''}
              </div>
            </div>`;
        });
        html += '</div>';
      }

      if (singleImgs.length > 0) {
        const selCount = selectedImageIds.filter(id => singleImgs.some(i => i.id === id)).length;
        html += `<div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:8px;text-transform:uppercase;border-bottom:1px solid var(--border);padding-bottom:6px">&#7842;nh l&#7867; (${singleImgs.length})</div>`;
        html += `<div class="cr-bulk-toolbar" style="margin-bottom:12px;background:none;border:none;padding:0">
          <button class="cr-btn cr-btn-ghost cr-btn-sm ${bulkSelectMode ? 'active' : ''}" onclick="toggleBulkSelectMode()">
            <i class="fa-solid fa-check-double"></i> ${bulkSelectMode ? 'Thoát chọn' : 'Chọn nhiều'}
          </button>
          ${bulkSelectMode ? `
            <button class="cr-btn cr-btn-ghost cr-btn-sm" onclick="selectAllInFolder('')">
              <i class="fa-solid fa-square-check"></i> Tat ca
            </button>
            <button class="cr-btn cr-btn-ghost cr-btn-sm" onclick="deselectAll()">
              <i class="fa-regular fa-square"></i> Bỏ chọn
            </button>
            ${selCount > 0 ? `
              <button class="cr-btn cr-btn-primary cr-btn-sm" onclick="openBulkEditPopup()">
                <i class="fa-solid fa-wand-sparkles"></i> Edit Bulk (${selCount})
              </button>
              <button class="cr-btn cr-btn-ghost cr-btn-sm" onclick="sendBulkToLibrary()">
                <i class="fa-solid fa-arrow-right"></i> ? Lib (${selCount})
              </button>
            ` : ''}
          ` : ''}
        </div>`;

        html += '<div class="cr-grid-section">';
        singleImgs.forEach(img => {
          const ext = img.name.split('.').pop().toUpperCase();
          const colorHash = img.id.charCodeAt(img.id.length-1) % 5;
          const gradients = [
            'linear-gradient(135deg, rgba(217,122,43,.25), rgba(196,74,58,.18))',
            'linear-gradient(135deg, rgba(111,175,79,.25), rgba(74,158,232,.18))',
            'linear-gradient(135deg, rgba(74,158,232,.25), rgba(142,68,204,.18))',
            'linear-gradient(135deg, rgba(242,212,121,.25), rgba(217,122,43,.18))',
            'linear-gradient(135deg, rgba(196,74,58,.25), rgba(217,122,43,.18))'
          ];
          const bg = gradients[colorHash];
          
          const usages = getImgUsages(img.id);
          const assignedBadges = usages.map(u => `<span style="display:inline-block;background:var(--green);color:#fff;font-size:8px;padding:2px 4px;border-radius:4px;margin-right:2px">${u.combo} (T${u.taskIdx+1} ${u.role})</span>`).join('');
          
          let extBadge = img.edited 
            ? '<span class="cr-ext-badge" style="background:var(--purple);color:#fff"><i class="fa-solid fa-wand-sparkles" style="font-size:8px"></i> Edited</span>'
            : `<span class="cr-ext-badge">${ext}</span>`;

          const checked = selectedImageIds.includes(img.id);
          const selOverlay = bulkSelectMode ? `<div class="cr-card-select-overlay" onclick="toggleImageSelection('${img.id}', event)">
            <i class="${checked ? 'fa-solid fa-square-check active' : 'fa-regular fa-square'}"></i>
          </div>` : '';

          let displayImg = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center"><i class="fa-solid fa-image" style="font-size:32px;color:rgba(255,255,255,.2)"></i></div>`;
          if (img.url || img.uploadedUrl || img.sourceUrl || (img.edited && img.resultUrl)) {
            displayImg = `<img src="${img.url || img.uploadedUrl || img.sourceUrl || img.resultUrl}" style="width:100%;height:100%;object-fit:cover">`;
          } else if (img._file) {
            displayImg = `<img src="${URL.createObjectURL(img._file)}" style="width:100%;height:100%;object-fit:cover">`;
          }

          const clickHandler = bulkSelectMode 
            ? `toggleImageSelection('${img.id}', event)` 
            : `openImgPopup(event, '${img.id}')`;
            
          html += `
            <div class="cr-card ${checked ? 'selected' : ''}" draggable="true" ondragstart="handleImgDragStart(event, '${img.id}')" ondragend="handleImgDragEnd(event, '${img.id}')" onclick="${clickHandler}" oncontextmenu="event.preventDefault(); showContextMenu(event, 'image', '${img.id}')">
              <div class="cr-card-top" style="background:${bg};position:relative">
                <button class="cr-delete-btn" onclick="event.stopPropagation();deleteSourceImage('${img.id}')" title="X&#243;a &#7843;nh"><i class="fa-solid fa-trash"></i></button>
                ${displayImg}
                ${extBadge}
                ${selOverlay}
              </div>
              <div class="cr-card-bot">
                <div class="cr-card-name" title="${img.name}">${img.name}</div>
                <div class="cr-card-sub">${new Date(img.uploadTime).toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit'})}</div>
                ${usages.length > 0 ? `<div style="margin-top:4px">${assignedBadges}</div>` : ''}
              </div>
            </div>`;
        });
        html += '</div>';
      }
    }
  } else {
    // ===== FOLDER VIEW: Show images in grid =====
    const items = DEMO_IMAGES.filter(i => i.folder === srcFilter);
    if (items.length === 0) {
      html = '<div style="padding:20px;text-align:center;color:var(--muted2);font-size:12px">Th&#432; m&#7909;c tr&#7889;ng</div>';
    } else {
      // Bulk select toolbar
      const selCount = selectedImageIds.filter(id => items.some(i => i.id === id)).length;
      html += `<div class="cr-bulk-toolbar">
        <button class="cr-btn cr-btn-ghost cr-btn-sm ${bulkSelectMode ? 'active' : ''}" onclick="toggleBulkSelectMode()">
          <i class="fa-solid fa-check-double"></i> ${bulkSelectMode ? 'Thoát chọn' : 'Chọn nhiều'}
        </button>
        ${bulkSelectMode ? `
          <button class="cr-btn cr-btn-ghost cr-btn-sm" onclick="selectAllInFolder()">
            <i class="fa-solid fa-square-check"></i> Tat ca
          </button>
          <button class="cr-btn cr-btn-ghost cr-btn-sm" onclick="deselectAll()">
            <i class="fa-regular fa-square"></i> Bỏ chọn
          </button>
          ${selCount > 0 ? `
            <button class="cr-btn cr-btn-primary cr-btn-sm" onclick="openBulkEditPopup()">
              <i class="fa-solid fa-wand-sparkles"></i> Edit Bulk (${selCount})
            </button>
            <button class="cr-btn cr-btn-ghost cr-btn-sm" onclick="sendBulkToLibrary()">
              <i class="fa-solid fa-arrow-right"></i> ? Lib (${selCount})
            </button>
          ` : ''}
        ` : ''}
      </div>`;

      html += '<div class="cr-grid-section">';
      items.forEach(img => {
        const ext = img.name.split('.').pop().toUpperCase();
        const colorHash = img.id.charCodeAt(img.id.length-1) % 5;
        const gradients = [
          'linear-gradient(135deg, rgba(217,122,43,.25), rgba(196,74,58,.18))',
          'linear-gradient(135deg, rgba(111,175,79,.25), rgba(74,158,232,.18))',
          'linear-gradient(135deg, rgba(74,158,232,.25), rgba(142,68,204,.18))',
          'linear-gradient(135deg, rgba(242,212,121,.25), rgba(217,122,43,.18))',
          'linear-gradient(135deg, rgba(196,74,58,.25), rgba(242,212,121,.18))'
        ];
        const usages = getImgUsages(img.id);
        const usageCount = usages.length;
        const isSelected = selectedImageIds.includes(img.id);
        let badgeHTML = '';
        if (usageCount > 0) {
          const labels = usages.map(u => `T${u.taskIdx+1}`);
          badgeHTML = `<span class="cr-grid-usage-badge">${labels.join(',')}</span>`;
        }
        const clickHandler = bulkSelectMode
          ? `toggleImageSelection('${img.id}')`
          : `openImgPopup(event, '${img.id}')`;
        html += `
          <div class="cr-grid-item ${img.edited ? 'edited' : ''} ${usageCount > 0 ? 'assigned' : ''} ${isSelected ? 'selected' : ''}" data-id="${img.id}"
            draggable="true" ondragstart="handleImgDragStart(event,'${img.id}')" ondragend="handleImgDragEnd(event)">
            <div class="cr-grid-thumb" style="background:${gradients[colorHash]}" onclick="${clickHandler}" title="${bulkSelectMode ? 'Click để chọn/bỏ' : 'Không thể vào task hoặc bấm để gán'}">
              <button class="cr-delete-btn" onclick="event.stopPropagation();deleteSourceImage('${img.id}')" title="X&#243;a &#7843;nh"><i class="fa-solid fa-trash"></i></button>
              ${(img.previewUrl || img.sourceUrl || img.uploadedUrl || img.url) ? `<img class="cr-grid-thumb-img" src="${img.previewUrl || img.sourceUrl || img.uploadedUrl || img.url}" alt="${img.name}">` : ''}
              <i class="fa-solid fa-image"></i>
              ${img.edited ? '<span class="cr-edit-dot"></span>' : ''}
              <span class="cr-grid-ext">${ext}</span>
              ${badgeHTML}
              ${bulkSelectMode ? `<div class="cr-bulk-checkbox ${isSelected ? 'checked' : ''}"><i class="fa-solid ${isSelected ? 'fa-check-square' : 'fa-square'}"></i></div>` : `<div class="cr-grid-hover-hint"><i class="fa-solid fa-grip" style="font-size:14px"></i></div>`}
            </div>
            <div class="cr-grid-name" title="${img.name}">${img.name}</div>
            ${usageCount > 0 ? `<div class="cr-grid-usage-list">${usages.map(u => `<span class="cr-grid-usage-tag ${u.role === 'Đầu' ? 'first' : u.role === 'Cuối' ? 'last' : 'i2v'}" title="${u.combo} Task #${u.taskIdx+1}: ${u.role}">${u.combo} T#${u.taskIdx+1} ${u.role}</span>`).join('')}</div>` : ''}
          </div>
        `;
      });
      html += '</div>';
    }
  }

  list.innerHTML = html || '<div style="padding:20px;text-align:center;color:var(--muted2);font-size:12px">Kh&#244;ng c&#243; &#7843;nh</div>';

  if (countEl) countEl.textContent = DEMO_IMAGES.length;
  if (badgeEl) badgeEl.textContent = DEMO_IMAGES.length;

  // Update batch edit counts
  const bec = document.getElementById('batchEditCount');
  const becc = document.getElementById('batchEditCost');
  const editableCount = DEMO_IMAGES.filter(i => !i.edited).length;
  if (bec) bec.textContent = editableCount;
  if (becc) becc.textContent = editableCount * 18;
}

// ========== QUICK ASSIGN (one-click) ==========
function quickAssign(imgId, role) {
  const img = DEMO_IMAGES.find(i => i.id === imgId);
  if (!img) return;
  const combo = taskCombos[activeComboIdx];

  // Check duplicate: is this image already assigned with this role in this combo?
  const isDup = combo.tasks.some(t => {
    if (role === 'first' && t.firstFrameId === imgId) return true;
    if (role === 'last' && t.lastFrameId === imgId) return true;
    return false;
  });
  if (isDup) {
    showToast(`Ảnh "${img.name}" đã được dùng làm ${role === 'first' ? 'Khung Đầu' : 'Khung Cuối'} trong ${combo.name} rồi!`, 'warning');
    return;
  }

  // Find first idle task with empty slot for this role
  let task = null;
  if (role === 'first') {
    task = combo.tasks.find(t => t.status === 'idle' && t.mode === 'flf' && !t.firstFrame);
    if (!task) task = combo.tasks.find(t => t.status === 'idle' && t.mode === 'i2v' && !t.sourceImg);
    if (task && task.mode === 'i2v') { task.mode = 'flf'; task.sourceImg = null; task.sourceImgId = null; }
    if (task) { task.firstFrame = img.name; task.firstFrameId = img.id; }
  } else {
    task = combo.tasks.find(t => t.status === 'idle' && t.mode === 'flf' && !t.lastFrame);
    if (!task) task = combo.tasks.find(t => t.status === 'idle' && t.mode === 'i2v' && !t.sourceImg);
    if (task && task.mode === 'i2v') { task.mode = 'flf'; task.sourceImg = null; task.sourceImgId = null; }
    if (task) { task.lastFrame = img.name; task.lastFrameId = img.id; }
  }

  if (!task) {
    const newTask = createDefaultTask();
    newTask.mode = 'flf';
    if (role === 'first') { newTask.firstFrame = img.name; newTask.firstFrameId = img.id; }
    else { newTask.lastFrame = img.name; newTask.lastFrameId = img.id; }
    combo.tasks.push(newTask);
    task = newTask;
  }

  refreshActiveComboSurface({ withSourceImages: true, withCosts: true });
  const taskIdx = combo.tasks.indexOf(task);
  showToast(`Đã gán "${img.name}" ở ${combo.name} Task #${taskIdx+1} (${role === 'first' ? 'Khung Đầu' : 'Khung Cuối'})`, 'success');
}

// ========== IMAGE POPUP (detailed assign) ==========
let activePopupImgId = null;

function openImgPopup(event, imgId) {
  event.stopPropagation();
  const img = DEMO_IMAGES.find(i => i.id === imgId);
  if (!img) return;

  // Close existing popup
  closeImgPopup();
  activePopupImgId = imgId;

  const combo = taskCombos[activeComboIdx];
  const idleTasks = combo.tasks.filter(t => t.status === 'idle');

  // Count usages of this image
  function getImgUsagesLocal(id) {
    const u = [];
    taskCombos.forEach(c => c.tasks.forEach(t => {
      if (t.sourceImgId === id) u.push({ combo: c.name, taskIdx: c.tasks.indexOf(t), role: 'I2V' });
      if (t.firstFrameId === id) u.push({ combo: c.name, taskIdx: c.tasks.indexOf(t), role: 'Dau' });
      if (t.lastFrameId === id) u.push({ combo: c.name, taskIdx: c.tasks.indexOf(t), role: 'Cuối' });
    }));
    return u;
  }
  const usages = getImgUsagesLocal(imgId);

  // Generate a gradient for preview placeholder based on image id
  const previewColorHash = img.id.charCodeAt(img.id.length-1) % 5;
  const previewGradients = [
    'linear-gradient(135deg, rgba(217,122,43,.35), rgba(196,74,58,.25))',
    'linear-gradient(135deg, rgba(111,175,79,.35), rgba(74,158,232,.25))',
    'linear-gradient(135deg, rgba(74,158,232,.35), rgba(142,68,204,.25))',
    'linear-gradient(135deg, rgba(242,212,121,.35), rgba(217,122,43,.25))',
    'linear-gradient(135deg, rgba(196,74,58,.35), rgba(242,212,121,.25))'
  ];
  const previewGrad = previewGradients[previewColorHash];
  // Fallback ratio map for legacy seeded IDs; uploaded images use default when missing ratio metadata.
  const legacyRatioMap = { 'img_001':'3:4', 'img_002':'16:9', 'img_003':'1:1', 'img_004':'4:3', 'img_005':'3:4', 'img_006':'16:9', 'img_007':'1:1', 'img_008':'4:3', 'img_009':'3:4', 'img_010':'16:9' };
  const imgRatio = legacyRatioMap[img.id] || '3:4';
  const [rw, rh] = imgRatio.split(':').map(Number);
  const aspectPct = ((rh / rw) * 100).toFixed(1);

  let popupHTML = `
    <div class="cr-popup-overlay" onclick="closeImgPopup()"></div>
    <div class="cr-popup cr-popup-wide" id="imgPopup">
      <div class="cr-popup-header">
        <div class="cr-popup-img-info">
          <i class="fa-solid fa-image" style="color:var(--blue)"></i>
          <span class="cr-popup-title">${img.name}</span>
          <span class="cr-popup-ratio-tag">${imgRatio}  ${img.edited ? 'Edited' : 'Original'}</span>
        </div>
        <div class="cr-popup-header-actions">
          <button class="cr-popup-minimize" onclick="minimizeImgPopup('${img.id}')" title="Minimize ? Library">
            <i class="fa-solid fa-window-minimize"></i>
          </button>
          <button class="cr-popup-close" onclick="closeImgPopup()"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </div>
      <div class="cr-popup-layout">
      <div class="cr-popup-body">
  `;

  // Show ALL CODEs with their tasks
  taskCombos.forEach((code, codeIdx) => {
    const codeIdleTasks = code.tasks.filter(t => t.status === 'idle');
    const isActive = codeIdx === activeComboIdx;
    popupHTML += `
      <div class="cr-popup-code-section ${isActive ? 'active' : ''}">
        <div class="cr-popup-code-header" onclick="switchCombo(${codeIdx});">
          <i class="fa-solid fa-code" style="color:${isActive ? 'var(--brand)' : 'var(--muted)'}"></i>
          <span class="cr-popup-code-name">${code.name}</span>
          <span class="cr-popup-code-count">${code.tasks.length} task</span>
          ${isActive ? '<span class="cr-popup-active-tag">đang chọn</span>' : ''}
        </div>
        <div class="cr-popup-task-list">
    `;

    if (codeIdleTasks.length === 0) {
      popupHTML += `<div class="cr-popup-empty" style="padding:6px;font-size:10px">Không có task sẵn sàng</div>`;
    } else {
      codeIdleTasks.forEach(t => {
        const realIdx = code.tasks.indexOf(t);
        const isUsed = usages.length > 0;
        const firstDup = t.firstFrameId === imgId;
        const lastDup = t.lastFrameId === imgId;
        const i2vDup = t.sourceImgId === imgId;
        
        const disFirst = (isUsed && !firstDup) ? 'disabled style="opacity:0.3;cursor:not-allowed"' : '';
        const disLast = (isUsed && !lastDup) ? 'disabled style="opacity:0.3;cursor:not-allowed"' : '';
        const disI2v = (isUsed && !i2vDup) ? 'disabled style="opacity:0.3;cursor:not-allowed"' : '';

        const hasFirst = t.firstFrame ? `<span class="cr-popup-filled ${firstDup ? 'dup' : ''}">? ${t.firstFrame}</span>` : '';
        const hasLast = t.lastFrame ? `<span class="cr-popup-filled ${lastDup ? 'dup' : ''}">? ${t.lastFrame}</span>` : '';
        const hasI2V = t.sourceImg ? `<span class="cr-popup-filled ${i2vDup ? 'dup' : ''}">? ${t.sourceImg}</span>` : '';

        popupHTML += `
          <div class="cr-popup-task-row ${firstDup || lastDup || i2vDup ? 'has-dup' : ''}">
            <div class="cr-popup-task-info">
              <span class="cr-popup-task-num">#${realIdx + 1}</span>
              <span class="cr-popup-task-mode">${t.mode === 'i2v' ? 'Ảnh→Video' : 'Khung Đầu-Cuối'}</span>
            </div>
            <div class="cr-popup-task-btns">
              ${t.mode === 'i2v' ? `
                <button class="cr-popup-btn ${t.sourceImg ? 'filled' : ''} ${i2vDup ? 'dup' : ''}" style="${t.sourceImg ? 'background:rgba(217,122,43,.1);border-color:rgba(217,122,43,.3);color:var(--brand);' : ''}" ${disI2v} onclick="event.stopPropagation();popupAssign('${imgId}',${realIdx},'i2v',${codeIdx})">
                  <i class="fa-solid fa-wand-magic-sparkles"></i> I2V
                  ${hasI2V}
                </button>
              ` : `
                <button class="cr-popup-btn cr-popup-btn-first ${t.firstFrame ? 'filled' : ''} ${firstDup ? 'dup' : ''}" ${disFirst} onclick="event.stopPropagation();popupAssign('${imgId}',${realIdx},'first',${codeIdx})">
                  <i class="fa-solid fa-play"></i> Dau
                  ${hasFirst}
                </button>
                <button class="cr-popup-btn cr-popup-btn-last ${t.lastFrame ? 'filled' : ''} ${lastDup ? 'dup' : ''}" ${disLast} onclick="event.stopPropagation();popupAssign('${imgId}',${realIdx},'last',${codeIdx})">
                  <i class="fa-solid fa-stop"></i> Cuối
                  ${hasLast}
                </button>
              `}
            </div>
          </div>
        `;
      });
    }

    popupHTML += `
        </div>
      </div>
    `;
  });

  const isUsed = usages.length > 0;
  const newBtnAttr = isUsed ? 'disabled style="opacity:0.3;cursor:not-allowed"' : '';
  popupHTML += `
      <div class="cr-popup-new-task-group">
        <span class="cr-popup-new-label"><i class="fa-solid fa-plus"></i> Tạo task mới và gán:</span>
        <div class="cr-popup-new-btns">
          <button class="cr-popup-btn" style="flex:1;justify-content:center" ${newBtnAttr} onclick="event.stopPropagation();popupNewTask('${imgId}','i2v')">
            <i class="fa-solid fa-wand-magic-sparkles"></i> I2V
          </button>
          <button class="cr-popup-btn" style="flex:1;justify-content:center" ${newBtnAttr} onclick="event.stopPropagation();popupNewTask('${imgId}','first')">
            <i class="fa-solid fa-play"></i> Dau
          </button>
          <button class="cr-popup-btn" style="flex:1;justify-content:center" ${newBtnAttr} onclick="event.stopPropagation();popupNewTask('${imgId}','last')">
            <i class="fa-solid fa-stop"></i> Cuối
          </button>
        </div>
      </div>

      <div class="cr-popup-edit-section">
        <div class="cr-popup-edit-header" onclick="document.getElementById('crPopupEditBody').classList.toggle('show')">
          <i class="fa-solid fa-wand-sparkles" style="color:var(--purple)"></i> Trnh Edit anh
          ${img.edited ? '<span class="cr-popup-edited-tag"><i class="fa-solid fa-check-circle"></i>  edit</span>' : ''}
          <i class="fa-solid fa-chevron-down" style="margin-left:auto;font-size:10px;color:var(--muted2)"></i>
        </div>
        <div class="cr-popup-edit-body ${img.edited ? 'show' : ''}" id="crPopupEditBody">
          ${img.edited ? `
          <div class="cr-popup-edit-status">
            <i class="fa-solid fa-circle-check" style="color:var(--green)"></i>
            <span>Ảnh đã được chỉnh sửa. Bạn có thể edit lại với cài đặt mới.</span>
          </div>` : ''}
          <div class="form-group" style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <label style="width:60px;margin:0">Group:</label>
            <select class="form-select" style="flex:1;font-size:11px">
              <option>All</option>
              <option ${img.edited ? 'selected' : ''}>Product</option>
              <option>Portrait</option>
              <option>Background</option>
            </select>
          </div>
          <div class="form-group" style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <label style="width:60px;margin:0">Preset:</label>
            <select class="form-select" style="flex:1;font-size:11px">
              <option ${!img.edited ? 'selected' : ''}>-- Select effect --</option>
              ${PRESETS.map((p, pi) => '<option ' + (img.edited && pi === 0 ? 'selected' : '') + '>' + p + '</option>').join('')}
            </select>
            <div style="width:24px;height:24px;background:#6FAF4F;border-radius:4px;flex-shrink:0" title="Color Pick"></div>
          </div>
          <div style="display:flex;gap:10px;margin-bottom:8px">
            <div class="form-group" style="display:flex;align-items:center;gap:10px;flex:1;margin:0">
              <label style="width:60px;margin:0">Model:</label>
              <select class="form-select" style="flex:1;font-size:11px">
                <option ${img.edited ? 'selected' : ''}>Nano Banana Pro</option>
                <option>GPT Image 1.5</option>
                <option>Flux Pro</option>
              </select>
            </div>
            <div class="form-group" style="display:flex;align-items:center;gap:10px;width:120px;margin:0">
              <label style="margin:0">Size:</label>
              <select class="form-select" style="flex:1;font-size:11px">
                <option ${img.edited ? 'selected' : ''}>1K (18 cr)</option>
                <option>2K (28 cr)</option>
                <option>4K (42 cr)</option>
              </select>
            </div>
          </div>
          <div class="form-group" style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <label style="width:60px;margin:0">Ratio:</label>
            <select class="form-select" style="flex:1;font-size:11px">
              <option ${img.edited ? 'selected' : ''}>Auto</option>
              <option>1:1</option>
              <option>3:4</option>
              <option>4:3</option>
              <option>9:16</option>
              <option>16:9</option>
            </select>
          </div>
          <div class="form-group" style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <label style="width:60px;margin:0">Strength:</label>
            <input type="range" min="0" max="100" value="${img.edited ? '75' : '50'}" style="flex:1;accent-color:var(--brand)">
            <span style="font-size:11px;color:var(--brand);min-width:30px;text-align:right">${img.edited ? '75' : '50'}%</span>
          </div>
          <div class="form-group" style="margin-bottom:12px">
            <label style="display:block;margin-bottom:4px">Prompt</label>
            <textarea class="form-textarea" style="height:60px;font-size:11px;width:100%" placeholder="Describe the effect to create...">${img.edited ? 'product on clean white background, studio lighting, high detail, professional photo' : ''}</textarea>
          </div>
          <button class="cr-btn cr-btn-primary" style="width:100%;padding:10px;font-size:13px;letter-spacing:1px" onclick="runSingleEdit('${img.id}')">
            ${img.edited ? '<i class="fa-solid fa-redo"></i> RE-EDIT IMAGE 18 cr' : 'EDIT IMAGE 18 cr'}
          </button>
        </div>
      </div>
  `;

  // Show current usages
  if (usages.length > 0) {
    popupHTML += `
      <div class="cr-popup-usages-header"><i class="fa-solid fa-link" style="color:var(--yellow)"></i> Đang được dùng tại:</div>
      <div class="cr-popup-usages">
        ${usages.map(u => `<span class="cr-popup-usage-chip">${u.combo} Task #${u.taskIdx+1}: ${u.role}</span>`).join('')}
      </div>
      <button class="cr-popup-unassign" onclick="event.stopPropagation();unassignImg('${imgId}');closeImgPopup()">
          <i class="fa-solid fa-undo"></i> Go khoi tat ca task
      </button>
    `;
  }

  popupHTML += `</div>
      <!-- RIGHT: Image Preview Panel -->
      <div class="cr-popup-preview">
        <div class="cr-popup-preview-label">
          <i class="fa-solid fa-eye"></i> Preview gốc
          <span class="cr-popup-preview-ratio">${imgRatio}</span>
        </div>
        <div class="cr-popup-preview-frame">
          <div class="cr-popup-preview-img" style="background:${previewGrad};padding-top:${aspectPct}%">
            ${img.previewUrl ? `<img class="cr-popup-preview-actual" src="${img.previewUrl}" alt="${img.name}">` : '<i class="fa-solid fa-image"></i>'}
            <span class="cr-popup-preview-name">${img.name}</span>
          </div>
        </div>
        <div class="cr-popup-preview-meta">
          <div class="cr-popup-preview-meta-row"><span>Tn:</span><span>${img.name}</span></div>
          <div class="cr-popup-preview-meta-row"><span>Th\u01B0 m\u1EE5c:</span><span>${img.folder}</span></div>
          <div class="cr-popup-preview-meta-row"><span>T? l?:</span><span>${imgRatio}</span></div>
          <div class="cr-popup-preview-meta-row"><span>Trạng thái:</span><span>${img.edited ? 'Đã chỉnh' : 'Ảnh gốc'}</span></div>
        </div>
      </div>
    </div></div>`;

  // Create popup container
  const container = document.createElement('div');
  container.id = 'imgPopupContainer';
  container.innerHTML = popupHTML;
  document.body.appendChild(container);

  // Position popup near the clicked element
  requestAnimationFrame(() => {
    const popup = document.getElementById('imgPopup');
    if (popup) {
      popup.classList.add('show');
    }
  });
}

function closeImgPopup() {
  const container = document.getElementById('imgPopupContainer');
  if (container) {
    const popup = container.querySelector('.cr-popup');
    if (popup) popup.classList.remove('show');
    setTimeout(() => container.remove(), 150);
  }
  activePopupImgId = null;
}

// Minimize popup -> mini card in Library
let minimizedEdits = [];
function minimizeImgPopup(imgId) {
  const img = DEMO_IMAGES.find(i => i.id === imgId);
  if (!img) return;
  closeImgPopup();

  // Add mini card to library
  const editId = 'edit_' + Date.now();
  minimizedEdits.push({ editId, imgId, imgName: img.name, status: 'editing', progress: 0 });

  renderLibrary();
  showToast(`Đã thu nhỏ "${img.name}" ở Library. Click để mở lại.`, 'info');
}

function reopenMinimizedEdit(editId) {
  const entry = minimizedEdits.find(e => e.editId === editId);
  if (!entry) return;
  minimizedEdits = minimizedEdits.filter(e => e.editId !== editId);
  renderLibrary();
  // Delay reopen to avoid document click handler closing it immediately
  _popupJustOpened = true;
  setTimeout(() => {
    const fakeEvt = { stopPropagation: () => {} };
    openImgPopup(fakeEvt, entry.imgId);
    setTimeout(() => { _popupJustOpened = false; }, 100);
  }, 200);
}

function removeMinimizedEdit(editId) {
  minimizedEdits = minimizedEdits.filter(e => e.editId !== editId);
  renderLibrary();
}

function popupAssign(imgId, taskIdx, role, codeIdx) {
  const img = DEMO_IMAGES.find(i => i.id === imgId);
  if (!img) return;
  const targetCodeIdx = codeIdx !== undefined ? codeIdx : activeComboIdx;
  const combo = taskCombos[targetCodeIdx];
  const task = combo.tasks[taskIdx];
  if (!task) return;

  // Duplicate check
  if (role === 'first' && task.firstFrameId === imgId) {
    showToast(`Ảnh này đã là Khung Đầu của task này rồi!`, 'warning');
    return;
  }
  if (role === 'last' && task.lastFrameId === imgId) {
    showToast(`Ảnh này đã là Khung Cuối của task này rồi!`, 'warning');
    return;
  }

  // If assigning first/last to an i2v task, auto-switch to flf mode
  if ((role === 'first' || role === 'last') && task.mode === 'i2v') {
    task.mode = 'flf';
    task.sourceImg = null; task.sourceImgId = null;
  }

  if (role === 'first') { task.firstFrame = img.name; task.firstFrameId = img.id; }
  if (role === 'last') { task.lastFrame = img.name; task.lastFrameId = img.id; }
  if (role === 'i2v') { task.sourceImg = img.name; task.sourceImgId = img.id; }

  closeImgPopup();
  renderSourceImages();
  renderActiveCombo();
  syncActiveComboTabMeta();
  updateStatusBar();
  recalcAllCosts();
  showToast(`Đã gán "${img.name}" ở ${combo.name} Task #${taskIdx+1} (${role === 'first' ? 'Khung Đầu' : role === 'last' ? 'Khung Cuối' : 'I2V'})`, 'success');
}

function popupNewTask(imgId, role) {
  const img = DEMO_IMAGES.find(i => i.id === imgId);
  if (!img) return;
  const combo = taskCombos[activeComboIdx];
  const newTask = createDefaultTask();
  if (role === 'i2v') {
    newTask.mode = 'i2v';
    newTask.sourceImg = img.name; newTask.sourceImgId = img.id;
  } else {
    newTask.mode = 'flf';
    if (role === 'first') { newTask.firstFrame = img.name; newTask.firstFrameId = img.id; }
    if (role === 'last') { newTask.lastFrame = img.name; newTask.lastFrameId = img.id; }
  }
  combo.tasks.push(newTask);

  closeImgPopup();
  renderSourceImages();
  renderActiveCombo();
  syncActiveComboTabMeta();
  updateStatusBar();
  recalcAllCosts();
  showToast(`Tạo Task mới + "${img.name}" ở Khung ${role === 'first' ? 'Đầu' : 'Cuối'}`, 'success');
}

// Close popup on outside click
let _popupJustOpened = false;
document.addEventListener('click', (e) => {
  if (_popupJustOpened) return; // Skip if popup was just opened programmatically
  if (activePopupImgId && !e.target.closest('.cr-popup') && !e.target.closest('.cr-grid-item') && !e.target.closest('.cr-lib-mini-card')) {
    closeImgPopup();
  }
});

function unassignImg(imgId) {
  // Remove this image from any task that references it
  taskCombos.forEach(c => c.tasks.forEach(t => {
    if (t.sourceImgId === imgId) { t.sourceImg = null; t.sourceImgId = null; }
    if (t.firstFrameId === imgId) { t.firstFrame = null; t.firstFrameId = null; }
    if (t.lastFrameId === imgId) { t.lastFrame = null; t.lastFrameId = null; }
  }));

  renderSourceImages();
  renderActiveCombo();
  syncActiveComboTabMeta();
  updateStatusBar();
  const img = DEMO_IMAGES.find(i => i.id === imgId);
  showToast(`"${img ? img.name : 'ảnh'}" đã gỡ khỏi tất cả task`, 'info');
}

function unmarkImage(imgId) {
  // No-op: images are shared now, unmark is handled by task removal
}

// ========== DRAG & DROP: Image Source -> Task Buttons ==========
function handleImgDragStart(e, imgId) {
  e.dataTransfer.setData('text/plain', imgId);
  e.dataTransfer.effectAllowed = 'copy';
  e.currentTarget.classList.add('dragging');
  // Highlight all drop targets
  document.querySelectorAll('.cr-drop-target').forEach(el => el.classList.add('cr-drop-ready'));
}

function handleImgDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  // Remove all highlights
  document.querySelectorAll('.cr-drop-target').forEach(el => {
    el.classList.remove('cr-drop-ready', 'cr-drop-hover');
  });
}

function handleSrcBtnDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  e.currentTarget.classList.add('cr-drop-hover');
}

function handleSrcBtnDragLeave(e) {
  e.currentTarget.classList.remove('cr-drop-hover');
}

function handleSrcBtnDrop(e, taskIdx, role) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('cr-drop-hover');
  document.querySelectorAll('.cr-drop-target').forEach(el => el.classList.remove('cr-drop-ready', 'cr-drop-hover'));

  const imgId = e.dataTransfer.getData('text/plain');
  if (!imgId) return;
  const img = DEMO_IMAGES.find(i => i.id === imgId);
  if (!img) return;

  const combo = taskCombos[activeComboIdx];
  const task = combo.tasks[taskIdx];
  if (!task) return;

  // If dropping first/last on i2v task, auto-switch to flf mode
  if ((role === 'first' || role === 'last') && task.mode === 'i2v') {
    task.mode = 'flf';
    task.sourceImg = null; task.sourceImgId = null;
  }

  // Assign
  if (role === 'i2v') { task.sourceImg = img.name; task.sourceImgId = img.id; }
  if (role === 'first') { task.firstFrame = img.name; task.firstFrameId = img.id; }
  if (role === 'last') { task.lastFrame = img.name; task.lastFrameId = img.id; }

  renderSourceImages();
  renderActiveCombo();
  syncActiveComboTabMeta();
  updateStatusBar();
  recalcAllCosts();

  const roleLabel = role === 'first' ? 'Khung Đầu' : role === 'last' ? 'Khung Cuối' : 'I2V';
  showToast(`?? "${img.name}" ? ${combo.name} Task #${taskIdx+1} (${roleLabel})`, 'success');
}

// ========== PICK SOURCE IMAGE POPUP ==========
function pickSourceForTask(taskIdx, role) {
  // Close any existing picker
  closeSourcePicker();

  const combo = taskCombos[activeComboIdx];
  const task = combo.tasks[taskIdx];
  if (!task) return;

  // Group images by folder
  const folders = {};
  DEMO_IMAGES.forEach(img => {
    if (!folders[img.folder]) folders[img.folder] = [];
    folders[img.folder].push(img);
  });

  const roleLabel = role === 'first' ? 'Khung Đầu' : role === 'last' ? 'Khung Cuối' : 'Ảnh I2V';
  const roleIcon = role === 'first' ? 'fa-play' : role === 'last' ? 'fa-stop' : 'fa-wand-magic-sparkles';
  const roleColor = role === 'first' ? 'var(--green)' : role === 'last' ? 'var(--red)' : 'var(--brand)';

  let gridHTML = '';
  const folderNames = Object.keys(folders);

  if (DEMO_IMAGES.length === 0) {
    gridHTML = '<div style="padding:30px;text-align:center;color:var(--muted2);font-size:12px"><i class="fa-solid fa-images" style="font-size:28px;margin-bottom:8px;display:block"></i>Ch\u01B0a c\u00F3 \u1EA3nh n\u00E0o.<br>H\u00E3y t\u1EA3i l\u00EAn \u1EA3nh \u1EDF panel Ngu\u1ED3n \u1EA3nh b\u00EAn tr\u00E1i.</div>';
  } else {
    folderNames.forEach(fname => {
      const imgs = folders[fname];
      const safeName = fname.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
      gridHTML += `<div class="cr-picker-folder-header"><i class="fa-solid fa-folder" style="color:var(--yellow)"></i> ${safeName} <span style="color:var(--muted);font-weight:400;font-size:10px">(${imgs.length})</span></div>`;
      gridHTML += '<div class="cr-picker-grid">';
      imgs.forEach(img => {
        const ch = img.id.charCodeAt(img.id.length-1) % 5;
        const grads = [
          'linear-gradient(135deg, rgba(217,122,43,.25), rgba(196,74,58,.18))',
          'linear-gradient(135deg, rgba(111,175,79,.25), rgba(74,158,232,.18))',
          'linear-gradient(135deg, rgba(74,158,232,.25), rgba(142,68,204,.18))',
          'linear-gradient(135deg, rgba(242,212,121,.25), rgba(217,122,43,.18))',
          'linear-gradient(135deg, rgba(196,74,58,.25), rgba(242,212,121,.18))'
        ];
        gridHTML += `
          <div class="cr-picker-item" onclick="pickerSelectImage('${img.id}',${taskIdx},'${role}')" title="${img.name}">
            <div class="cr-picker-thumb" style="background:${grads[ch]}">
              ${img.previewUrl ? `<img src="${img.previewUrl}" alt="${img.name}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:6px">` : '<i class="fa-solid fa-image" style="font-size:16px;color:var(--muted2)"></i>'}
            </div>
            <div class="cr-picker-name">${img.name}</div>
          </div>`;
      });
      gridHTML += '</div>';
    });
  }

  const popupHTML = `
    <div class="cr-popup-overlay" onclick="closeSourcePicker()"></div>
    <div class="cr-popup show" style="width:560px;max-height:75vh">
      <div class="cr-popup-header">
        <div class="cr-popup-img-info">
          <i class="fa-solid ${roleIcon}" style="color:${roleColor}"></i>
          <span class="cr-popup-title">Chon ${roleLabel}  Task #${taskIdx+1}</span>
        </div>
        <button class="cr-popup-close" onclick="closeSourcePicker()"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div style="padding:10px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
        <i class="fa-solid fa-magnifying-glass" style="color:var(--muted);font-size:11px"></i>
        <input type="text" class="form-input" id="pickerSearch" placeholder="Tm anh..." style="font-size:12px;padding:6px 10px;flex:1;border:none;background:var(--bg2)" oninput="filterPickerImages(this.value)">
      </div>
      <div class="cr-popup-body" id="pickerBody" style="overflow-y:auto;max-height:calc(75vh - 120px);padding:10px 14px">
        ${gridHTML}
      </div>
    </div>
  `;

  const container = document.createElement('div');
  container.id = 'sourcePickerContainer';
  container.innerHTML = popupHTML;
  document.body.appendChild(container);

  // Store for filtering
  window._pickerTaskIdx = taskIdx;
  window._pickerRole = role;

  // Auto-focus search
  setTimeout(() => {
    const search = document.getElementById('pickerSearch');
    if (search) search.focus();
  }, 100);
}

function closeSourcePicker() {
  const c = document.getElementById('sourcePickerContainer');
  if (c) c.remove();
}

function filterPickerImages(query) {
  const q = query.toLowerCase().trim();
  const items = document.querySelectorAll('#pickerBody .cr-picker-item');
  items.forEach(item => {
    const name = (item.getAttribute('title') || '').toLowerCase();
    item.style.display = !q || name.includes(q) ? '' : 'none';
  });
}

function pickerSelectImage(imgId, taskIdx, role) {
  const img = DEMO_IMAGES.find(i => i.id === imgId);
  if (!img) return;

  const combo = taskCombos[activeComboIdx];
  const task = combo.tasks[taskIdx];
  if (!task) return;

  // If picking first/last on i2v task, auto-switch to flf mode
  if ((role === 'first' || role === 'last') && task.mode === 'i2v') {
    task.mode = 'flf';
    task.sourceImg = null; task.sourceImgId = null;
  }

  // Assign
  if (role === 'i2v') { task.sourceImg = img.name; task.sourceImgId = img.id; }
  if (role === 'first') { task.firstFrame = img.name; task.firstFrameId = img.id; }
  if (role === 'last') { task.lastFrame = img.name; task.lastFrameId = img.id; }

  closeSourcePicker();
  renderSourceImages();
  renderActiveCombo();
  syncActiveComboTabMeta();
  updateStatusBar();
  recalcAllCosts();

  const roleLabel = role === 'first' ? 'Khung Đầu' : role === 'last' ? 'Khung Cuối' : 'I2V';
  showToast(`?? "${img.name}" ? ${combo.name} Task #${taskIdx+1} (${roleLabel})`, 'success');
}

// ========== BATCH EDIT ==========
function toggleBatchEdit() {
  batchEditVisible = !batchEditVisible;
  const sec = document.getElementById('batchEditSection');
  if (sec) sec.style.display = batchEditVisible ? 'block' : 'none';
}

function selectBatchPreset(el) {
  el.closest('.cr-preset-grid').querySelectorAll('.cr-preset-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

function runBatchEdit() {
  const folder = document.getElementById('batchFolder')?.value || 'all';
  let targets = DEMO_IMAGES.filter(i => !i.used && !i.edited);
  if (folder !== 'all') targets = targets.filter(i => i.folder === folder);

  if (targets.length === 0) {
    showToast('Không có ảnh nào cần edit', 'info');
    return;
  }

  showToast(`? Batch edit: ${targets.length} anh dang x? l...`, 'info');

  // Simulate batch edit
  let done = 0;
  const iv = setInterval(() => {
    if (done < targets.length) {
      targets[done].edited = true;
      targets[done].name = targets[done].name.replace('.jpg', '_edited.jpg').replace('.png', '_edited.png');
      done++;
      if (done % 3 === 0 || done === targets.length) {
        renderSourceImages();
      }
    }
    if (done >= targets.length) {
      clearInterval(iv);
      renderSourceImages();
      showToast(`Batch edit hoàn tất: ${targets.length} ảnh!`, 'success');
    }
  }, 300);
}

// ========== BULK SELECT & EDIT ==========
function toggleBulkSelectMode() {
  bulkSelectMode = !bulkSelectMode;
  if (!bulkSelectMode) selectedImageIds = [];
  renderSourceImages();
}

function toggleImageSelection(imgId) {
  const idx = selectedImageIds.indexOf(imgId);
  if (idx >= 0) selectedImageIds.splice(idx, 1);
  else selectedImageIds.push(imgId);
  renderSourceImages();
}

function selectAllInFolder(folderName) {
  const targetFolder = folderName !== undefined ? folderName : srcFilter;
  const items = DEMO_IMAGES.filter(i => targetFolder === '' ? (!i.folder || i.folder.trim() === '') : (i.folder === targetFolder));
  
  const newIds = items.map(i => i.id);
  newIds.forEach(id => {
    if (!selectedImageIds.includes(id)) selectedImageIds.push(id);
  });
  
  renderSourceImages();
}

function deselectAll() {
  selectedImageIds = [];
  renderSourceImages();
}

function openBulkEditPopup() {
  if (selectedImageIds.length === 0) { showToast('Ch\u01B0a ch\u1ECDn \u1EA3nh n\u00E0o', 'info'); return; }
  const selectedImgs = DEMO_IMAGES.filter(i => selectedImageIds.includes(i.id));
  const container = document.createElement('div');
  container.id = 'bulkEditPopupContainer';
  container.innerHTML = `
    <div class="cr-popup-overlay" onclick="closeBulkEditPopup()"></div>
    <div class="cr-popup cr-popup-wide show" style="width:560px">
      <div class="cr-popup-header">
        <div class="cr-popup-img-info">
          <i class="fa-solid fa-wand-sparkles" style="color:var(--purple)"></i>
          <span class="cr-popup-title">Edit Bulk  ${selectedImgs.length} anh</span>
        </div>
        <div class="cr-popup-header-actions">
          <button class="cr-popup-minimize" onclick="bulkMinimizeToLib()" title="Thu nhỏ ở Library">
            <i class="fa-solid fa-window-minimize"></i>
          </button>
          <button class="cr-popup-close" onclick="closeBulkEditPopup()"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </div>
      <div class="cr-popup-body" style="max-height:65vh;overflow-y:auto">
        <div class="cr-bulk-thumb-row">
          ${selectedImgs.map(img => {
            const ch = img.id.charCodeAt(img.id.length-1) % 5;
            const grads = ['rgba(217,122,43,.3)','rgba(111,175,79,.3)','rgba(74,158,232,.3)','rgba(242,212,121,.3)','rgba(196,74,58,.3)'];
            return `<div class="cr-bulk-thumb" style="background:${grads[ch]}" title="${img.name}">
              <i class="fa-solid fa-image" style="font-size:12px"></i>
              <span>${img.name.length > 10 ? img.name.slice(0,8)+'' : img.name}</span>
            </div>`;
          }).join('')}
        </div>
        <div style="padding:14px">
          <div class="form-group" style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <label style="width:60px;margin:0">Group:</label>
            <select class="form-select" style="flex:1;font-size:11px" id="bulkGroup">
              <option>All</option><option selected>Product</option><option>Portrait</option><option>Background</option>
            </select>
          </div>
          <div class="form-group" style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <label style="width:60px;margin:0">Preset:</label>
            <select class="form-select" style="flex:1;font-size:11px" id="bulkPreset">
              <option>-- Select effect --</option>
              ${PRESETS.map(p => '<option>' + p + '</option>').join('')}
            </select>
          </div>
          <div style="display:flex;gap:10px;margin-bottom:8px">
            <div class="form-group" style="display:flex;align-items:center;gap:10px;flex:1;margin:0">
              <label style="width:60px;margin:0">Model:</label>
              <select class="form-select" style="flex:1;font-size:11px" id="bulkModel">
                <option>Nano Banana Pro (18 cr)</option><option>GPT Image 1.5 (22 cr)</option><option>Flux Pro (28 cr)</option>
              </select>
            </div>
            <div class="form-group" style="display:flex;align-items:center;gap:10px;width:120px;margin:0">
              <label style="margin:0">Size:</label>
              <select class="form-select" style="flex:1;font-size:11px" id="bulkSize">
                <option>1K</option><option>2K</option><option>4K</option>
              </select>
            </div>
          </div>
          <div class="form-group" style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <label style="width:60px;margin:0">Ratio:</label>
            <select class="form-select" style="flex:1;font-size:11px" id="bulkRatio">
              <option selected>Auto</option><option>1:1</option><option>3:4</option><option>4:3</option><option>9:16</option><option>16:9</option>
            </select>
          </div>
          <div class="form-group" style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <label style="width:60px;margin:0">Strength:</label>
            <input type="range" min="0" max="100" value="50" style="flex:1;accent-color:var(--brand)" id="bulkStrength" oninput="document.getElementById('bulkStrVal').textContent=this.value+'%'">
            <span style="font-size:11px;color:var(--brand);min-width:30px;text-align:right" id="bulkStrVal">50%</span>
          </div>
          <div class="form-group" style="margin-bottom:12px">
            <label style="display:block;margin-bottom:4px">Prompt</label>
            <textarea class="form-textarea" style="height:60px;font-size:11px;width:100%" id="bulkPrompt" placeholder="Describe the effect to apply to all images..."></textarea>
          </div>
          <div class="cr-bulk-cost">
            <i class="fa-solid fa-coins" style="color:var(--yellow)"></i>
            <span>${selectedImgs.length} anh  18 cr = <strong style="color:var(--yellow)">${selectedImgs.length * 18}</strong> cr</span>
          </div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="cr-btn cr-btn-primary" style="flex:1;padding:10px;font-size:13px" onclick="applyBulkEdit()">
      <i class="fa-solid fa-bolt"></i> Ap dung tat ca (${selectedImgs.length} anh)
            </button>
            <button class="cr-btn cr-btn-ghost" style="padding:10px" onclick="bulkMinimizeToLib()" title="Thu nhỏ ở Library">
              <i class="fa-solid fa-arrow-right"></i> ? Lib
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(container);
}

function closeBulkEditPopup() {
  const c = document.getElementById('bulkEditPopupContainer');
  if (c) c.remove();
}

function applyBulkEdit() {
  const selectedImgs = DEMO_IMAGES.filter(i => selectedImageIds.includes(i.id));
  if (selectedImgs.length === 0) return;
  closeBulkEditPopup();
  showToast(`? Bulk edit: ${selectedImgs.length} anh dang x? l...`, 'info');

  let done = 0;
  const iv = setInterval(() => {
    if (done < selectedImgs.length) {
      selectedImgs[done].edited = true;
      if (!selectedImgs[done].name.includes('_edited')) {
        selectedImgs[done].name = selectedImgs[done].name.replace(/\.(jpg|png|webp)/i, '_edited.$1');
      }
      done++;
      if (done % 2 === 0 || done === selectedImgs.length) renderSourceImages();
    }
    if (done >= selectedImgs.length) {
      clearInterval(iv);
      renderSourceImages();
      showToast(`Bulk edit hoàn tất: ${selectedImgs.length} ảnh!`, 'success');
      // Add to library
      selectedImgs.forEach(img => {
        DEMO_LIBRARY.unshift({
          id: 'be_' + img.id + '_' + Date.now(),
          name: img.name,
          type: 'image',
          status: 'done',
          qcNote: '',
          cr: 18,
          staff: 'Bạn',
          time: '2s',
        });
      });
      renderLibrary();
      bulkSelectMode = false;
      selectedImageIds = [];
      renderSourceImages();
    }
  }, 250);
}

function sendBulkToLibrary() {
  const selectedImgs = DEMO_IMAGES.filter(i => selectedImageIds.includes(i.id));
  if (selectedImgs.length === 0) return;

  // Add each selected image as minimized edit card in library
  selectedImgs.forEach(img => {
    const editId = 'bulk_' + Date.now() + '_' + img.id;
    minimizedEdits.push({ editId, imgId: img.id, imgName: img.name, status: 'editing', progress: 0, isBulk: true });
  });

  renderLibrary();
  bulkSelectMode = false;
  selectedImageIds = [];
  renderSourceImages();

  // Open library if collapsed
  if (!libraryOpen) toggleLibrary();
  showToast(`\u0110\u00E3 thu nh\u1ECF ${selectedImgs.length} \u1EA3nh v\u00E0o Library. B\u1EA5m \u0111\u1EC3 m\u1EDF l\u1EA1i.`, 'info');
}

function bulkMinimizeToLib() {
  closeBulkEditPopup();
  sendBulkToLibrary();
}

// ========== RUN TASKS (with enforcement) ==========
async function _ensureUploadedImageUrl(imgId) {
  const img = DEMO_IMAGES.find(i => i.id === imgId);
  if (!img) throw new Error('Kh\u00F4ng t\u00ECm th\u1EA5y \u1EA3nh ngu\u1ED3n');
  if (img.sourceUrl) return img.sourceUrl;
  if (img.uploadedUrl) return img.uploadedUrl;
  if (img.url) return img.url;
  if (img._file) {
    const fd = new FormData();
    fd.append('file', img._file, img._file.name || img.name || 'image.png');
    const up = await API.uploadImage(fd);
    if (!up || !up.url) throw new Error('Upload \u1EA3nh th\u1EA5t b\u1EA1i');
    img.uploadedUrl = up.url;
    return up.url;
  }
  throw new Error('\u1EA2nh ch\u01B0a c\u00F3 file g\u1ED1c \u0111\u1EC3 upload');
}

function _upsertLibraryFromTask(task, combo, status, extra = {}) {
  const codeTag = combo ? (combo.codeTag || combo.name) : 'CODE';
  const existing = AppData.library.find(i => i.id === task.id || (task.taskId && i.taskId === task.taskId));
  const payload = {
    id: task.id,
    name: task.resultName || `${codeTag}_${task.duration || '5s'}.mp4`,
    type: 'video',
    status,
    codeTag,
    staffId: AppData.currentUser.id,
    qcById: null,
    qcNote: task.qcNote || '',
    credits: task.credits || 0,
    pct: Number(task.progress || 0),
    taskId: task.taskId || task.id,
    createdAt: new Date().toISOString(),
    executionTime: task.executionTime || '-',
    resultUrl: task.resultUrl || '',
    effectGroup: String(task.effectGroup || 'none').trim().toLowerCase() || 'none',
    effectGroupDetail: String(task.effectGroupCustom || '').trim(),
    ...extra,
  };
  if (existing) Object.assign(existing, payload);
  else AppData.library.unshift(payload);
}

function _findTaskOwnerCombo(task) {
  if (!task || !Array.isArray(taskCombos)) return null;
  return taskCombos.find((combo) => Array.isArray(combo?.tasks) && combo.tasks.includes(task)) || null;
}

async function _runTaskReal(task, comboRef = null) {
  const combo = comboRef || _findTaskOwnerCombo(task) || taskCombos[activeComboIdx];
  if (!task || !combo) return;
  if (task.__inflight) return;
  _archiveCurrentTaskRun(task);
  _resetTaskForRerun(task);
  task.__inflight = true;
  const tIdx = combo ? combo.tasks.indexOf(task) + 1 : 1;
  const codeTag = combo ? (combo.codeTag || combo.name) : 'CODE';
  const durationNum = parseInt(String(task.duration || '5').replace('s', ''), 10) || 5;
  const sessionId = String(getCreatorSessionId() || '').trim();

  task.progress = 0;
  task.failMsg = '';
  task.runStartedAt = new Date().toISOString();
  task.resultName = `${codeTag}_T${tIdx}_${task.duration}.mp4`;
  _applyTaskLifecycleState(task, 'submitting');
  _rerenderTaskByRef(task, combo);
  renderComboTabs();

  try {
    let image_url = '';
    let end_image_url = '';
    if (task.mode === 'i2v') {
      image_url = await _ensureUploadedImageUrl(task.sourceImgId);
    } else {
      image_url = await _ensureUploadedImageUrl(task.firstFrameId);
      end_image_url = await _ensureUploadedImageUrl(task.lastFrameId);
    }

    const req = {
      image_url,
      end_image_url: end_image_url || undefined,
      gen_mode: task.mode === 'flf' ? 'frames' : 'img2vid',
      prompt: task.prompt || '',
      camera_move_id: task.cameraMove && task.cameraMove !== '-- None --' ? task.cameraMove : undefined,
      duration: durationNum,
      aspect_ratio: getTaskRatioValue(task),
      provider: String(task.provider || AppData.providerSettings?.default_provider || 'provider1').trim().toLowerCase() || 'provider1',
      model_id: String(task.modelId || getDefaultModelId(String(task.provider || AppData.providerSettings?.default_provider || 'provider1').trim().toLowerCase() || 'provider1')).trim(),
      effect_group: String(task.effectGroup || 'none').trim().toLowerCase() || 'none',
      effect_group_detail: String(task.effectGroupCustom || '').trim(),
      session_id: sessionId,
      code_tag: String(combo?.codeTag || combo?.name || '').trim(),
    };

    const r = await API.createVideo(req);
    if (!r || !r.task_id) throw new Error('API kh\u00F4ng tr\u1EA3 task_id');
    task.taskId = r.task_id;
    _applyTaskLifecycleState(task, 'running', { progress: 0 });
    scheduleSaveCreatorDraftState(0);
    _upsertLibraryFromTask(task, combo, 'processing', { taskId: r.task_id, pct: Number(task.progress || 0) });
    pollTaskStatusByRef(task, combo, { silent: true });
    showToast(`\u0110\u00E3 g\u1EEDi task ${task.resultName}. H\u1EC7 th\u1ED1ng \u0111ang t\u1EF1 poll tr\u1EA1ng th\u00E1i.`, 'info');
  } catch (err) {
    const normalizedFailMsg = _normalizeTaskFailureMessage(err && err.message ? err.message : 'G\u1EEDi task th\u1EA5t b\u1EA1i');
    task.failMsg = normalizedFailMsg;
    if (String(task.taskId || '').trim() || normalizedFailMsg === 'Hết tiền') {
      _applyTaskLifecycleState(task, 'fail', { failMsg: normalizedFailMsg });
    } else {
      task.status = 'idle';
      task.progress = 0;
      task.__polling = false;
      task.runFinishedAt = new Date().toISOString();
    }
    scheduleSaveCreatorDraftState(0);
    if (String(task.taskId || '').trim()) {
      _upsertLibraryFromTask(task, combo, 'rejected', { qcNote: task.failMsg });
    }
    showToast(task.failMsg === 'Hết tiền' ? 'Hết tiền' : `Task th\u1EA5t b\u1EA1i: ${task.failMsg}`, 'error');
  } finally {
    task.__inflight = false;
    scheduleSaveCreatorDraftState(0);
  }

  _rerenderTaskByRef(task, combo);
  renderLibraryIfChanged();
}

async function runAllCombos() {
  const combo = taskCombos[activeComboIdx];
  if (!combo) return;
  if (combo.__batchRunning) {
    showToast('CODE n\u00E0y \u0111ang ch\u1EA1y batch, vui l\u00F2ng ch\u1EDD xong', 'warning');
    return;
  }
  const waiting = combo.tasks.filter(t => t.status === 'idle');
  if (!waiting.length) { showToast('Kh\u00F4ng c\u00F3 task n\u00E0o c\u1EA7n ch\u1EA1y', 'info'); return; }

  // Validate ALL tasks before running
  let hasError = false;
  waiting.forEach((t, i) => {
    const v = validateTaskBeforeRun(t, combo.name);
    if (!v.valid) {
      showToast(`Task #${combo.tasks.indexOf(t)+1}: ${v.errors.join(', ')}`, 'error');
      hasError = true;
    }
  });
  if (hasError) return;

  combo.__batchRunning = true;
  refreshActiveComboSurface();
  showToast(`G\u1EEDi ${waiting.length} task l\u00EAn backend...`, 'info');
  try {
    for (const t of waiting) {
      if (!combo.tasks.includes(t)) continue;
      await _runTaskReal(t, combo);
    }
  } finally {
    combo.__batchRunning = false;
    refreshActiveComboSurface();
  }
}

async function runSingleTask(idx) {
  const combo = taskCombos[activeComboIdx];
  if (!combo) return;
  if (combo.__batchRunning) {
    showToast('CODE n\u00E0y \u0111ang ch\u1EA1y batch, kh\u00F4ng th\u1EC3 ch\u1EA1y l\u1EBB', 'warning');
    return;
  }
  const task = combo.tasks[idx];
  if (!task || !_canStartTaskNow(task)) return;

  // Enforcement: validate before run
  const v = validateTaskBeforeRun(task, combo.name);
  if (!v.valid) {
    showToast(`Task #${idx+1}: ${v.errors.join(', ')}`, 'error');
    return;
  }

  showToast(`G\u1EEDi task #${idx+1} l\u00EAn backend...`, 'info');
  await _runTaskReal(task, combo);
}

async function pollTaskStatusByRef(task, comboRef = null, options = {}) {
  const silent = !!options?.silent;
  const combo = comboRef || _findTaskOwnerCombo(task) || taskCombos[activeComboIdx];
  if (!task || !combo || !task.taskId) {
    if (!silent) showToast('Task ch\u01B0a c\u00F3 task_id \u0111\u1EC3 poll', 'warning');
    return;
  }
  if (task.__polling) return;
  const beforeSignature = _getTaskRuntimeSignature(task);
  task.__polling = true;
  try {
    const r = await API.pollVideo(task.taskId);
    const state = String(r && r.state ? r.state : 'pending');
    const progress = Number(r && r.progress ? r.progress : 0) || 0;
    if (state === 'success') {
      _applyTaskLifecycleState(task, 'done', { progress: 100 });
      task.resultUrl = r.result_url || '';
      scheduleSaveCreatorDraftState(0);
      _upsertLibraryFromTask(task, combo, 'done', {
        resultUrl: task.resultUrl || '',
        executionTime: task.executionTime || '-',
        pct: 100,
      });
      syncTaskQCStatusByRef(task, combo, { silent: true }).catch(() => {});
      if (!silent) showToast(`Task ho\u00E0n t\u1EA5t: ${task.resultName}`, 'success');
    } else if (state === 'fail') {
      _applyTaskLifecycleState(task, 'fail', { failMsg: (r && r.fail_msg) || 'Task failed' });
      scheduleSaveCreatorDraftState(0);
      _upsertLibraryFromTask(task, combo, 'rejected', {
        qcNote: task.failMsg,
      });
      if (!silent) showToast(task.failMsg === 'Hết tiền' ? 'Hết tiền' : `Task th\u1EA5t b\u1EA1i: ${task.failMsg}`, 'error');
    } else {
      _applyTaskLifecycleState(task, 'running', { progress });
      scheduleSaveCreatorDraftState(0);
      _upsertLibraryFromTask(task, combo, 'processing', { pct: Number(task.progress || 0) });
      if (!silent) showToast(`Task \u0111ang x\u1EED l\u00FD: ${Math.round(task.progress)}%`, 'info');
    }
  } catch (err) {
    if (!silent) showToast(`Poll th\u1EA5t b\u1EA1i: ${err && err.message ? err.message : 'L\u1ED7i kh\u00F4ng x\u00E1c \u0111\u1ECBnh'}`, 'error');
  } finally {
    task.__polling = false;
  }
  const afterSignature = _getTaskRuntimeSignature(task);
  if (afterSignature !== beforeSignature) {
    _rerenderTaskByRef(task, combo);
    renderLibraryIfChanged();
  }
}

async function pollTaskStatus(idx, options = {}) {
  const combo = taskCombos[activeComboIdx];
  const task = combo?.tasks?.[idx];
  return pollTaskStatusByRef(task, combo, options);
}

// ========== QC (with enforcement + Telegram) ==========
async function sendTaskQC(idx) {
  const task = taskCombos[activeComboIdx].tasks[idx];
  if (!task || !task.resultName) return;

  // Enforcement: validate before QC
  const v = validateBeforeQC(task);
  if (!v.valid) {
      showToast(`${v.errors.join(', ')}`, 'error');
    return;
  }

  try {
    if (!task.taskId || !task.resultUrl) throw new Error('Thi\u1EBFu task_id ho\u1EB7c video_url');
    const res = await API.submitQC({
      task_id: task.taskId,
      video_url: task.resultUrl,
      cover_url: task.coverUrl || '',
      session_id: comboSessionId(taskCombos[activeComboIdx]) || '',
      code_tag: taskCombos[activeComboIdx]?.name || '',
      task_index: Number(idx || 0),
      prompt: task.prompt || '',
      effect_group: task.effectGroup || '',
      effect_group_detail: task.effectGroupDetail || '',
      provider: task.provider || '',
      model_id: task.modelId || '',
      gen_mode: task.mode || '',
      duration: task.duration || '',
      aspect_ratio: task.ratio || '',
      credit_used: Number(task.credits || 0),
      assigned_qc_user: task.assignedQcUser || '',
      assigned_qc_display: task.assignedQcDisplay || '',
      note: task.qcNote || '',
    });
    if (!res || !res.ok) throw new Error('Submit QC th\u1EA5t b\u1EA1i');
    task.qcStatus = 'pending_qc';
    const libItem = AppData.library.find(i => i.id === task.id || i.taskId === task.taskId);
    if (libItem) {
      libItem.status = 'pending_qc';
      libItem.qcStatus = 'pending_qc';
    }
    syncTaskQCStatusByRef(task, taskCombos[activeComboIdx], { silent: true }).catch(() => {});
    renderActiveCombo();
    renderLibraryIfChanged();
    showToast(`\u0110\u00E3 g\u1EEDi QC: ${task.resultName}. Telegram v\u00E0 web QC \u0111\u1EC1u nh\u1EADn.`, 'success');
  } catch (err) {
    showToast(`G\u1EEDi QC th\u1EA5t b\u1EA1i: ${err && err.message ? err.message : 'L\u1ED7i kh\u00F4ng x\u00E1c \u0111\u1ECBnh'}`, 'error');
  }
}

async function sendComboQC() {
  const combo = taskCombos[activeComboIdx];
  const done = combo.tasks.filter(t => canSendTaskQC(t));
  if (!done.length) { showToast('Kh\u00F4ng c\u00F3 video n\u00E0o c\u1EA7n g\u1EEDi QC', 'info'); return; }

  for (const t of done) {
    const taskIdx = combo.tasks.indexOf(t);
    if (taskIdx >= 0) {
      await sendTaskQC(taskIdx);
    }
  }
}

async function sendSingleQC(libId) {
  const item = DEMO_LIBRARY.find(i => i.id === libId);
  if (!item) return;
  try {
    if (!item.taskId || !item.resultUrl) throw new Error('Thi\u1EBFu task_id ho\u1EB7c video_url');
    const res = await API.submitQC({
      task_id: item.taskId,
      video_url: item.resultUrl,
      cover_url: item.coverUrl || '',
      session_id: item.sessionId || '',
      code_tag: item.codeTag || '',
      task_index: Number(item.taskIndex || 0),
      prompt: item.prompt || '',
      effect_group: item.effectGroup || '',
      effect_group_detail: item.effectGroupDetail || '',
      provider: item.provider || '',
      model_id: item.modelId || '',
      gen_mode: item.genMode || item.mode || '',
      duration: item.duration || '',
      aspect_ratio: item.ratio || item.aspectRatio || '',
      credit_used: Number(item.credits || 0),
      assigned_qc_user: item.assignedQcUser || '',
      assigned_qc_display: item.assignedQcDisplay || '',
      note: item.qcNote || '',
    });
    if (!res || !res.ok) throw new Error('Submit QC th\u1EA5t b\u1EA1i');
    item.status = 'pending_qc';
    item.qcStatus = 'pending_qc';
    renderLibraryIfChanged();
    showToast(`\u0110\u00E3 g\u1EEDi QC: ${item.name}`, 'success');
  } catch (err) {
    showToast(`G\u1EEDi QC th\u1EA5t b\u1EA1i: ${err && err.message ? err.message : 'L\u1ED7i kh\u00F4ng x\u00E1c \u0111\u1ECBnh'}`, 'error');
  }
}

async function sendAllPendingQC() {
  const items = DEMO_LIBRARY.filter(i => canSendLibraryQC(i));
  if (!items.length) { showToast('Kh\u00F4ng c\u00F3 item n\u00E0o c\u1EA7n g\u1EEDi QC', 'info'); return; }
  for (const i of items) {
    await sendSingleQC(i.id);
  }
}

function canSendTaskQC(t) {
  if (!t) return false;
  if (!_isFinalTaskState(t.status, t.qcStatus)) return false;
  if (String(t.status || '').trim().toLowerCase() === 'fail') return false;
  if (!t.taskId || !t.resultUrl) return false;
  const qc = String(t.qcStatus || '').trim().toLowerCase();
  return qc !== 'pending_qc' && qc !== 'approved' && qc !== 'rejected';
}

function getOnlineQCReviewers() {
  return getActiveSessions()
    .filter((row) => String(row.role || '').trim().toLowerCase() === 'qc_manager')
    .map((row) => ({
      username: String(row.username || row.staffId || '').trim(),
      display: String(row.displayName || row.display_name || row.username || '').trim(),
    }))
    .filter((row) => row.username)
    .filter((row, idx, arr) => arr.findIndex((x) => x.username === row.username) === idx);
}

function assignTaskQCDisplay(idx, selectEl) {
  const combo = taskCombos[activeComboIdx];
  const task = combo?.tasks?.[idx];
  if (!task || !selectEl) return;
  const option = selectEl.options && selectEl.selectedIndex >= 0 ? selectEl.options[selectEl.selectedIndex] : null;
  task.assignedQcUser = String(selectEl.value || '').trim();
  task.assignedQcDisplay = task.assignedQcUser ? String(option?.text || '').trim() : '';
  if (task.assignedQcUser === '__telegram__') task.assignedQcDisplay = 'Telegram/Admin';
  scheduleSaveCreatorDraftState(0);
}

function canSendLibraryQC(item) {
  if (!item) return false;
  const mediaType = String(item.type || item.media_type || 'video').toLowerCase();
  if (mediaType !== 'video') return false;
  if (!item.taskId || !item.resultUrl) return false;
  if (!_isFinalTaskState(item.status, item.qcStatus)) return false;
  const status = String(item.status || '').trim().toLowerCase();
  const qc = String(item.qcStatus || '').trim().toLowerCase();
  if (status === 'fail') return false;
  return qc !== 'pending_qc' && qc !== 'approved' && qc !== 'rejected';
}

function syncCreatorQCFromLibrary(options = {}) {
  const shouldRender = options?.render !== false;
  const usedPrimaryIds = new Set();
  let changed = false;
  for (const combo of taskCombos) {
    for (const t of combo.tasks) {
      if (!t) continue;
      if (_syncTaskStateFromLibrary(t, combo, usedPrimaryIds)) changed = true;
    }
  }
  if (changed) {
    scheduleSaveCreatorDraftState(0);
    if (shouldRender) {
      renderComboTabs();
      renderActiveCombo();
      renderLibraryIfChanged();
      updateStatusBar();
    }
  }
  return changed;
}

// ========== LIBRARY / OUTPUT PANEL ==========
function toggleLibrary() {
  libraryOpen = true;
}

function openLibraryItem(libId) {
  const item = DEMO_LIBRARY.find(i => i.id === libId);
  if (!item) return;

  const qcStaff = item.qcById ? getStaff(item.qcById) : null;
  const qcReviewer = item.qcReviewer || (qcStaff ? qcStaff.name : '-');
  const statusMap = {
    approved: { label: '\u0110\u00E3 duy\u1EC7t', cls: 'approved', icon: 'fa-check' },
    rejected: { label: 'T\u1EEB ch\u1ED1i', cls: 'rejected', icon: 'fa-xmark' },
    pending_qc: { label: 'Ch\u1EDD QC', cls: 'pending', icon: 'fa-clock' },
    processing: { label: '\u0110ang t\u1EA1o', cls: 'processing', icon: 'fa-spinner fa-spin' },
    done: { label: 'Ho\u00E0n t\u1EA5t', cls: 'done', icon: 'fa-check-double' },
  };
  const st = statusMap[item.status] || statusMap.done;
  const creditLabel = (typeof formatLibraryCredits === 'function') ? formatLibraryCredits(item.credits || item.cr || 0) : String(item.credits || item.cr || '-');
  const mediaHTML = item.type === 'video'
    ? (item.resultUrl
        ? `<div class="cr-lib-preview-stage video"><video src="${item.resultUrl}" controls autoplay playsinline preload="metadata" style="width:100%;height:100%;object-fit:contain;background:#111"></video></div>`
        : `<div class="cr-lib-preview-stage video"><div class="cr-lib-preview-video"><i class="fa-solid fa-circle-play"></i><span>Ch\u01B0a c\u00F3 video</span></div></div>`)
    : (item.resultUrl
        ? `<div class="cr-lib-preview-stage image"><img src="${item.resultUrl}" alt="${item.name}" style="width:100%;height:100%;object-fit:contain;background:#111"></div>`
        : `<div class="cr-lib-preview-stage image"><div class="cr-lib-preview-image"><i class="fa-solid fa-image"></i><span>${item.name}</span></div></div>`);

  const popupHTML = `
    <div class="cr-popup-overlay" onclick="closeLibraryItemPopup()"></div>
    <div class="cr-popup cr-popup-wide show" id="libItemPopup">
      <div class="cr-popup-header">
        <div class="cr-popup-img-info">
          <i class="fa-solid ${item.type === 'video' ? 'fa-film' : 'fa-image'}" style="color:var(--brand)"></i>
          <span class="cr-popup-title">${item.name}</span>
          <span class="cr-popup-ratio-tag">${item.type === 'video' ? 'Video Output' : 'Image Output'}</span>
        </div>
        <button class="cr-popup-close" onclick="closeLibraryItemPopup()"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="cr-popup-layout">
        <div class="cr-popup-body">${mediaHTML}</div>
        <div class="cr-popup-preview">
          <div class="cr-popup-preview-label">
            <i class="fa-solid fa-circle-info" style="color:var(--blue)"></i>
            <span>Chi ti\u1EBFt item</span>
          </div>
          <div class="cr-popup-preview-meta">
            <div class="cr-popup-preview-meta-row"><span>Tr\u1EA1ng th\u00E1i</span><span><span class="cr-qc-badge ${st.cls}"><i class="fa-solid ${st.icon}"></i> ${st.label}</span></span></div>
            <div class="cr-popup-preview-meta-row"><span>Code</span><span>${item.codeTag || '-'}</span></div>
            <div class="cr-popup-preview-meta-row"><span>Credit</span><span>${creditLabel}${creditLabel === '-' ? '' : ' cr'}</span></div>
            <div class="cr-popup-preview-meta-row"><span>Task ID</span><span>${item.taskId || '-'}</span></div>
            <div class="cr-popup-preview-meta-row"><span>T\u1EA1o l\u00FAc</span><span>${item.createdAt || '-'}</span></div>
            <div class="cr-popup-preview-meta-row"><span>Th\u1EDDi gian x\u1EED l\u00FD</span><span>${item.executionTime || item.time || '-'}</span></div>
            <div class="cr-popup-preview-meta-row"><span>QC b\u1EDFi</span><span>${qcReviewer}</span></div>
            <div class="cr-popup-preview-meta-row"><span>Ghi ch\u00FA QC</span><span>${item.qcNote || '-'}</span></div>
          </div>
        </div>
      </div>
    </div>
  `;

  const old = document.getElementById('libraryItemPopupContainer');
  if (old) old.remove();
  const container = document.createElement('div');
  container.id = 'libraryItemPopupContainer';
  container.innerHTML = popupHTML;
  document.body.appendChild(container);
  document.addEventListener('keydown', closeLibraryItemPopupOnEsc);
}

function closeLibraryItemPopupOnEsc(e) {
  if (e.key === 'Escape') closeLibraryItemPopup();
}

function closeLibraryItemPopup() {
  const container = document.getElementById('libraryItemPopupContainer');
  if (container) {
    container.remove();
    document.removeEventListener('keydown', closeLibraryItemPopupOnEsc);
  }
}

function renderLibrary() {
  const list = document.getElementById('libList');
  const summary = document.getElementById('libSummary');
  const badge = document.getElementById('libCountBadge');
  const topBadge = document.getElementById('libCountTop');
  if (!list) return;

  const filter = document.getElementById('libFilter')?.value || 'all';
  let items = DEMO_LIBRARY;
  if (filter !== 'all') {
    if (filter === 'video') items = items.filter(i => i.type === 'video');
    else if (filter === 'image') items = items.filter(i => i.type === 'image');
    else items = items.filter(i => i.status === filter);
  }

  const stConf = {
    approved: { icon:'fa-check', cls:'approved', label:'\u0110\u00E3 duy\u1EC7t', color:'var(--green)' },
    rejected: { icon:'fa-xmark', cls:'rejected', label:'T\u1EEB ch\u1ED1i', color:'var(--red)' },
    pending_qc: { icon:'fa-clock', cls:'pending', label:'Ch\u1EDD QC', color:'var(--yellow)' },
    processing: { icon:'fa-spinner fa-spin', cls:'processing', label:'\u0110ang t\u1EA1o', color:'var(--brand)' },
    done: { icon:'fa-check', cls:'done', label:'Ho\u00E0n t\u1EA5t', color:'var(--green)' },
  };

  // Render minimized edit cards at top
  let miniCardsHTML = '';
  if (minimizedEdits.length > 0) {
    miniCardsHTML = minimizedEdits.map(me => `
      <div class="cr-lib-mini-card" onclick="reopenMinimizedEdit('${me.editId}')">
        <div class="cr-lib-mini-icon"><i class="fa-solid fa-wand-sparkles"></i></div>
        <div class="cr-lib-mini-info">
          <div class="cr-lib-mini-name">${me.imgName}</div>
          <div class="cr-lib-mini-status"><i class="fa-solid fa-pen-to-square"></i> \u0110ang edit - Click \u0111\u1EC3 m\u1EDF l\u1EA1i</div>
        </div>
        <button class="cr-lib-mini-close" onclick="event.stopPropagation();removeMinimizedEdit('${me.editId}')" title="X\u00F3a">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `).join('');
  }

  list.innerHTML = miniCardsHTML + (items.map(item => {
    const st = stConf[item.status] || stConf.done;
    return `
      <div class="cr-lib-item ${item.status}" onclick="openLibraryItem('${item.id}')">
        <div class="cr-lib-thumb ${item.type === 'video' ? 'vid' : 'img'}">
          <i class="fa-solid ${item.type==='video'?'fa-film':'fa-image'}"></i>
        </div>
        <div class="cr-lib-info">
          <div class="cr-lib-name">${item.name}</div>
          <div class="cr-lib-meta">
            <span class="cr-qc-badge ${st.cls}"><i class="fa-solid ${st.icon}"></i> ${st.label}</span>
            <span style="color:var(--yellow);font-size:10px">${item.credits || item.cr || 0} cr</span>
            ${item.status === 'processing' ? `<span style="color:var(--brand);font-size:10px;font-weight:700">${Math.round(Number(item.pct || 0))}%</span>` : ''}
            <span style="color:var(--muted2);font-size:10px">${item.time || ''}</span>
          </div>
          ${item.status === 'rejected' && item.qcNote ? `<div class="cr-qc-reason"><i class="fa-solid fa-comment-dots"></i> ${item.qcNote}</div>` : ''}
          ${item.status === 'processing' ? `<div class="progress-bar" style="height:3px;margin-top:4px"><div class="progress-fill orange" style="width:${item.pct||0}%"></div></div>` : ''}
        </div>
        <div class="cr-lib-actions">
          ${(canSendLibraryQC(item)) ? `<button class="cr-icon-btn tg" onclick="event.stopPropagation();sendSingleQC('${item.id}')" title="QC"><i class="fab fa-telegram"></i></button>` : ''}
        </div>
      </div>
    `;
  }).join('') || '') || '<div style="padding:20px;text-align:center;color:var(--muted2);font-size:12px">Tr\u1ED1ng</div>';

  // Summary
  const total = DEMO_LIBRARY.length;
  const approved = DEMO_LIBRARY.filter(i => i.status === 'approved').length;
  const rejected = DEMO_LIBRARY.filter(i => i.status === 'rejected').length;
  const pending = DEMO_LIBRARY.filter(i => i.status === 'pending_qc').length;
  const proc = DEMO_LIBRARY.filter(i => i.status === 'processing').length;

  if (summary) summary.innerHTML = `
    <span>${total} m\u1EE5c</span>
    <span style="color:var(--green)">\u2713 ${approved}</span>
    <span style="color:var(--red)">\u2717 ${rejected}</span>
    <span style="color:var(--yellow)">\u25F7 ${pending}</span>
    <span style="color:var(--brand)">\u21BB ${proc}</span>
  `;
  if (badge) badge.textContent = total;
  if (topBadge) topBadge.textContent = total;
  creatorLastLibraryRenderSignature = _getLibraryRenderSignature();
}

// ========== COSTS & STATUS ==========
function recalcAllCosts() {
  let totalCredits = 0;
  let totalUsd = 0;
  taskCombos.forEach(c => c.tasks.forEach(t => {
    t.credits = calcTaskCost(t);
    const unit = String(getTaskModelMeta(t)?.unit || '').toLowerCase();
    if (unit === 'usd') totalUsd += Number(t.credits || 0);
    else totalCredits += Number(t.credits || 0);
  }));
  const el = document.getElementById('totalCost');
  if (el) {
    const parts = [];
    if (totalCredits > 0) parts.push(`${totalCredits.toLocaleString(undefined, { maximumFractionDigits: 2 })} cr`);
    if (totalUsd > 0) parts.push(`$${totalUsd.toFixed(2)}`);
    el.textContent = parts.length ? parts.join(' + ') : '0';
  }
}

function scheduleRecalcAllCosts(delay = 0) {
  if (recalcAllCostsTimer) clearTimeout(recalcAllCostsTimer);
  recalcAllCostsTimer = setTimeout(() => {
    recalcAllCostsTimer = 0;
    recalcAllCosts();
  }, Math.max(0, Number(delay || 0)));
}

function updateStatusBar() {
  const combo = taskCombos[activeComboIdx];
  if (!combo) return;
  const ts = combo.tasks;
  const total = ts.length;
  const done = ts.filter(t => t.status === 'done').length;
  const fail = ts.filter(t => t.status === 'fail').length;
  const running = ts.filter(t => t.status === 'running').length;
  const waiting = ts.filter(t => t.status === 'idle').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const update = (id, v) => { const e = document.getElementById(id); if (e) e.innerHTML = v; };
  update('statusProgress', `<i class="fa-solid fa-tasks"></i> ${done}/${total}`);
  update('statusSuccess', `<i class="fa-solid fa-check"></i> ${done}`);
  update('statusFail', `<i class="fa-solid fa-xmark"></i> ${fail}`);
  update('statusRunning', running > 0 ? `<i class="fa-solid fa-spinner fa-spin"></i> ${running}` : `<i class="fa-solid fa-spinner"></i> ${running}`);
  update('statusWaiting', `<i class="fa-solid fa-clock"></i> ${waiting}`);
  update('statusPct', `${pct}%`);
}

// ========== INJECT CSS ==========
function injectCreatorCSS() {
  if (document.getElementById('creatorCSS')) return;
  const s = document.createElement('style');
  s.id = 'creatorCSS';
  s.textContent = `
    /* ===== CR TOP BAR ===== */
    .cr-topbar { display:flex; align-items:center; justify-content:space-between; padding:8px 14px; background:var(--bg); border-bottom:1px solid var(--border); flex-shrink:0; gap:10px; }
    .cr-topbar-left { display:flex; align-items:center; gap:10px; }
    .cr-topbar-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .cr-model-badge { display:flex; flex-direction:column; gap:2px; }
    .cr-model-label { font-size:9px; font-weight:700; color:var(--brand); text-transform:uppercase; letter-spacing:.6px; }
    .cr-model-select { background:var(--card); border:1px solid var(--border); font-size:12px; padding:5px 8px; min-width:220px; }
    .cr-credit-pill { display:flex; align-items:center; gap:5px; padding:5px 12px; background:rgba(242,212,121,.08); border:1px solid rgba(242,212,121,.2); border-radius:16px; font-size:12px; font-weight:600; color:var(--yellow); white-space:nowrap; }
    .cr-toggle-wrap { display:flex; align-items:center; gap:5px; font-size:11px; color:var(--muted); cursor:pointer; white-space:nowrap; }
    .cr-toggle-wrap input { display:none; }
    .cr-toggle-track { width:26px;height:14px;background:var(--border);border-radius:7px;position:relative;transition:.2s;flex-shrink:0; }
    .cr-toggle-track::before { content:'';width:10px;height:10px;background:white;border-radius:50%;position:absolute;left:2px;top:2px;transition:.2s; }
    .cr-toggle-wrap input:checked + .cr-toggle-track { background:var(--brand); }
    .cr-toggle-wrap input:checked + .cr-toggle-track::before { transform:translateX(12px); }

    /* ===== SOURCE TOOLBAR & FOLDER GRID ===== */
    .cr-source-toolbar { display:flex; align-items:center; justify-content:space-between; padding:6px 10px; border-bottom:1px solid var(--border); gap:6px; }
    .cr-source-breadcrumb { display:flex; align-items:center; gap:4px; font-size:11px; flex:1; min-width:0; overflow:hidden; }
    .cr-bc-item { cursor:pointer; color:var(--muted); transition:.12s; white-space:nowrap; display:flex; align-items:center; gap:3px; font-weight:500; }
    .cr-bc-item:hover { color:var(--brand); }
    .cr-bc-item.active { color:var(--text); font-weight:700; cursor:default; }
    .cr-src-rename-panel { padding:10px; border-bottom:1px solid var(--border); background:var(--bg2); }
    .cr-folder-grid { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:8px; padding:2px; width:100%; box-sizing:border-box; overflow:hidden; }
    .cr-folder-card { display:flex; flex-direction:column; align-items:center; gap:3px; padding:10px 6px; border-radius:10px; border:1.5px solid var(--border); cursor:pointer; transition:.18s; text-align:center; user-select:none; position:relative; }
    .cr-delete-btn { position:absolute; top:6px; right:6px; width:20px; height:20px; border-radius:6px; border:1px solid rgba(196,74,58,.35); background:rgba(0,0,0,.45); color:var(--red); display:flex; align-items:center; justify-content:center; font-size:10px; cursor:pointer; z-index:4; opacity:.9; }
    .cr-delete-btn:hover { background:rgba(196,74,58,.18); border-color:var(--red); opacity:1; }
    .cr-folder-card:hover { border-color:var(--yellow); background:rgba(242,212,121,.05); transform:translateY(-1px); box-shadow:0 2px 10px rgba(242,212,121,.1); }
    .cr-folder-card-icon { width:38px; height:38px; border-radius:9px; background:rgba(242,212,121,.1); color:var(--yellow); display:flex; align-items:center; justify-content:center; font-size:17px; }
    .cr-folder-card-name { font-size:10px; font-weight:700; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
    .cr-folder-card-meta { font-size:9px; color:var(--muted); line-height:1.3; }

    .cr-badge-count { padding:2px 7px;background:var(--brand-dim);color:var(--brand);font-size:10px;font-weight:700;border-radius:10px; }

    /* ===== CR BUTTONS ===== */
    .cr-btn { display:inline-flex; align-items:center; gap:5px; padding:6px 12px; border-radius:6px; font-size:12px; font-family:inherit; cursor:pointer; border:none; transition:.15s; font-weight:600; white-space:nowrap; }
    .cr-btn-ghost { background:transparent; border:1px solid var(--border); color:var(--muted); }
    .cr-btn-ghost:hover { border-color:var(--brand); color:var(--text); }
    .cr-btn-primary { background:var(--brand); color:white; }
    .cr-btn-primary:hover { filter:brightness(1.1); }
    .cr-btn-run { background:var(--green); color:white; font-size:13px; padding:7px 16px; }
    .cr-btn-run:hover { filter:brightness(1.1); }
    .cr-icon-btn { width:26px;height:26px;border:1px solid var(--border);border-radius:5px;background:transparent;color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:11px;transition:.15s;flex-shrink:0; }
    .cr-icon-btn:hover { color:var(--text); border-color:var(--brand); }
    .cr-icon-btn.run { color:var(--green); border-color:rgba(95,184,95,.3); }
    .cr-icon-btn.run:hover { background:rgba(95,184,95,.15); }
    .cr-icon-btn.view { color:var(--blue); border-color:rgba(52,152,219,.3); }
    .cr-icon-btn.view:hover { background:rgba(52,152,219,.15); }
    .cr-icon-btn.tg { color:#2AABEE; border-color:rgba(42,171,238,.3); }
    .cr-icon-btn.tg:hover { background:rgba(42,171,238,.1); }
    .cr-icon-btn.del { color:var(--red); border-color:rgba(196,74,58,.2); }
    .cr-icon-btn.del:hover { background:rgba(196,74,58,.1); }
    .cr-icon-btn.dl { color:var(--green); border-color:rgba(95,184,95,.3); }
    .cr-icon-btn.dl:hover { background:rgba(95,184,95,.15); }
    .cr-qc-send-btn { display:inline-flex; align-items:center; gap:3px; padding:3px 8px; border-radius:5px; font-size:9px; font-family:inherit; font-weight:600; cursor:pointer; border:1px solid var(--brand); background:rgba(217,122,43,.1); color:var(--brand); transition:.15s; white-space:nowrap; }
    .cr-qc-send-btn:hover { background:var(--brand); color:white; }
    .cr-qc-send-btn i { font-size:8px; }
    .cr-qc-badge { display:inline-flex; align-items:center; gap:3px; padding:2px 7px; border-radius:5px; font-size:9px; font-weight:600; white-space:nowrap; }
    .cr-qc-badge.idle { color:var(--muted2); }
    .cr-qc-badge.pending { background:rgba(242,212,121,.12); color:var(--yellow); border:1px solid rgba(242,212,121,.25); }
    .cr-qc-badge.approved { background:rgba(95,184,95,.12); color:var(--green); border:1px solid rgba(95,184,95,.3); }
    .cr-qc-badge.rejected { background:rgba(196,74,58,.12); color:var(--red); border:1px solid rgba(196,74,58,.25); cursor:help; }

    /* ===== 3-PANEL WORKSPACE ===== */
    .cr-workspace { display:flex; flex:1; overflow:hidden; min-height:0; }
    .cr-panel { display:flex; flex-direction:column; overflow:hidden; }
    .cr-panel-left { width:420px; min-width:420px; max-width:420px; background:var(--bg); border-right:1px solid var(--border); flex-shrink:0; overflow:hidden; }
    .cr-panel-center { flex:1; min-width:0; min-height:0; background:var(--bg2); display:flex; flex-direction:column; overflow:hidden; }
    .cr-tasks-area { flex:1; min-height:0; display:flex; flex-direction:column; overflow:hidden; }
    .cr-panel-header { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; border-bottom:1px solid var(--border); flex-shrink:0; }
    .cr-panel-title { font-size:12px; font-weight:700; display:flex; align-items:center; gap:6px; }


    /* ===== SOURCE PANEL ===== */
    .cr-source-tabs { display:flex; border-bottom:1px solid var(--border); }
    .cr-stab { flex:1; padding:7px; background:none; border:none; border-bottom:2px solid transparent; color:var(--muted); font-size:11px; font-family:inherit; cursor:pointer; text-align:center; transition:.15s; }
    .cr-stab.active { color:var(--brand); border-bottom-color:var(--brand); font-weight:600; }
    .cr-stab:hover { color:var(--text); }
    .cr-source-body { flex:1; overflow-y:auto; overflow-x:hidden; display:flex; flex-direction:column; min-width:0; max-width:100%; width:100%; box-sizing:border-box; }
    .cr-upload-zone { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; padding:18px 12px; margin:8px; border:2px dashed var(--border2); border-radius:8px; cursor:pointer; transition:.15s; color:var(--muted); font-size:12px; }
    .cr-upload-zone:hover,.cr-upload-zone.drag { border-color:var(--brand); color:var(--brand); background:var(--brand-dim); }
    .cr-upload-zone i { font-size:22px; }
    .cr-upload-zone span { font-size:10px; color:var(--muted2); }
    .cr-src-info { display:flex; align-items:center; justify-content:space-between; padding:6px 12px; font-size:11px; font-weight:600; color:var(--text); border-bottom:1px solid var(--border); gap:6px; }
    .cr-img-grid { flex:1; overflow-y:auto; overflow-x:hidden; padding:0 4px; min-width:0; width:100%; max-width:100%; box-sizing:border-box; }

    /* Folder header for grid */
    .cr-folder-header-grid { display:flex; align-items:center; gap:6px; padding:6px 10px; background:rgba(242,212,121,.05); border-bottom:1px solid var(--border); font-size:11px; font-weight:600; color:var(--text); position:sticky; top:0; z-index:1; }
    .cr-folder-count { margin-left:auto; font-size:10px; font-weight:400; color:var(--muted); }

    /* Grid section */
    .cr-grid-section { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:6px; padding:8px 6px; width:100%; box-sizing:border-box; overflow:hidden; }

    /* Grid item card */
    .cr-grid-item { display:flex; flex-direction:column; align-items:center; gap:3px; cursor:default; transition:.18s; position:relative; padding:4px; border-radius:10px; min-width:0; max-width:100%; width:100%; overflow:hidden; box-sizing:border-box; }
    .cr-grid-item:hover { background:rgba(255,255,255,.03); }
    .cr-grid-item.assigned { }
    .cr-grid-item.edited .cr-grid-name { color:var(--purple); }
    .cr-grid-thumb { width:100%; max-width:100%; aspect-ratio:1; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:20px; color:var(--blue); position:relative; overflow:hidden; border:2px solid transparent; transition:.18s; cursor:pointer; box-sizing:border-box; }
    .cr-grid-thumb-img { position:absolute; inset:0; width:100%; height:100%; max-width:100%; max-height:100%; object-fit:cover; z-index:0; display:block; }
    .cr-grid-thumb i, .cr-grid-ext, .cr-grid-usage-badge, .cr-bulk-checkbox, .cr-grid-hover-hint, .cr-edit-dot { position:relative; z-index:1; }
    .cr-grid-item:hover .cr-grid-thumb { border-color:var(--brand); box-shadow:0 2px 12px rgba(217,122,43,.18); }
    .cr-grid-item.edited .cr-grid-thumb { border-color:var(--purple); }
    .cr-edit-dot { position:absolute;top:4px;right:4px;width:8px;height:8px;border-radius:50%;background:var(--purple);border:1.5px solid var(--bg);z-index:2; }
    .cr-grid-ext { position:absolute; bottom:4px; right:4px; font-size:8px; font-weight:700; color:rgba(255,255,255,.7); background:rgba(0,0,0,.5); padding:1px 5px; border-radius:3px; letter-spacing:.3px; text-transform:uppercase; }

    /* Grid usage badge */
    .cr-grid-usage-badge { position:absolute; top:4px; left:4px; font-size:9px; font-weight:700; color:white; background:var(--brand); min-width:16px; height:16px; border-radius:8px; display:flex; align-items:center; justify-content:center; padding:0 4px; z-index:2; box-shadow:0 1px 4px rgba(0,0,0,.3); }

    /* Grid hover hint */
    .cr-grid-hover-hint { position:absolute; inset:0; background:rgba(0,0,0,.5); display:flex; align-items:center; justify-content:center; border-radius:6px; opacity:0; transition:.2s; font-size:16px; color:white; }
    .cr-grid-item:hover .cr-grid-hover-hint { opacity:1; }

    /* Quick-assign buttons */
    .cr-grid-quick { display:flex; gap:3px; width:100%; }
    .cr-qk { flex:1; display:flex; align-items:center; justify-content:center; gap:3px; padding:4px 2px; border-radius:6px; font-size:10px; font-weight:600; font-family:inherit; cursor:pointer; border:1.5px solid; transition:.18s; white-space:nowrap; }
    .cr-qk-first { background:rgba(95,184,95,.06); border-color:rgba(95,184,95,.2); color:var(--green); }
    .cr-qk-first:hover { background:var(--green); color:white; border-color:var(--green); transform:scale(1.04); box-shadow:0 2px 8px rgba(95,184,95,.3); }
    .cr-qk-last { background:rgba(196,74,58,.06); border-color:rgba(196,74,58,.2); color:var(--red); }
    .cr-qk-last:hover { background:var(--red); color:white; border-color:var(--red); transform:scale(1.04); box-shadow:0 2px 8px rgba(196,74,58,.3); }
    .cr-qk i { font-size:8px; }

    /* Grid name */
    .cr-grid-name { font-size:10px; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%; color:var(--text); line-height:1.2; }

    .cr-grid-usage-list { display:flex; flex-wrap:wrap; gap:2px; justify-content:center; width:100%; }
    .cr-grid-usage-tag { font-size:7px; padding:1px 4px; border-radius:4px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; letter-spacing:.2px; }
    .cr-grid-usage-tag.first { background:rgba(95,184,95,.12); color:var(--green); border:1px solid rgba(95,184,95,.25); }
    .cr-grid-usage-tag.last { background:rgba(196,74,58,.12); color:var(--red); border:1px solid rgba(196,74,58,.25); }
    .cr-grid-usage-tag.i2v { background:rgba(74,158,232,.12); color:var(--blue); border:1px solid rgba(74,158,232,.25); }

    /* ===== IMAGE POPUP ===== */
    .cr-popup-overlay { position:fixed; inset:0; background:rgba(0,0,0,.35); z-index:999; }
    @keyframes crPopFade { from{opacity:0} to{opacity:1} }
    .cr-popup { position:fixed; top:50%; left:50%; transform:translate(-50%,-50%) scale(.92); background:var(--card); border:1px solid var(--border); border-radius:14px; box-shadow:0 12px 48px rgba(0,0,0,.5); z-index:1000; width:520px; max-height:80vh; display:flex; flex-direction:column; opacity:0; transition:transform .2s cubic-bezier(.34,1.56,.64,1), opacity .15s ease; }
    .cr-popup.show { opacity:1; transform:translate(-50%,-50%) scale(1); }
    .cr-popup-header { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid var(--border); flex-shrink:0; }
    .cr-popup-img-info { display:flex; align-items:center; gap:8px; font-size:14px; font-weight:700; color:var(--text); }
    .cr-popup-close { width:30px; height:30px; border:1px solid var(--border); border-radius:6px; background:none; color:var(--muted); cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:13px; transition:.15s; }
    .cr-popup-close:hover { border-color:var(--red); color:var(--red); background:rgba(196,74,58,.08); }
    .cr-popup-body { padding:14px 18px; overflow-y:auto; display:flex; flex-direction:column; gap:10px; }

    /* CODE section in popup */
    .cr-popup-code-section { border:1px solid var(--border); border-radius:10px; overflow:hidden; transition:.15s; }
    .cr-popup-code-section.active { border-color:var(--brand); box-shadow:0 0 0 1px rgba(217,122,43,.15); }
    .cr-popup-code-header { display:flex; align-items:center; gap:8px; padding:8px 12px; background:var(--bg2); cursor:pointer; transition:.15s; font-size:12px; font-weight:700; color:var(--text); }
    .cr-popup-code-header:hover { background:rgba(217,122,43,.05); }
    .cr-popup-code-name { font-size:13px; }
    .cr-popup-code-count { font-size:10px; color:var(--muted); font-weight:400; margin-left:auto; }
    .cr-popup-active-tag { font-size:9px; padding:1px 6px; border-radius:6px; background:var(--brand); color:white; font-weight:700; letter-spacing:.3px; }

    .cr-popup-task-list { display:flex; flex-direction:column; gap:4px; padding:6px 8px; }
    .cr-popup-task-row { display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:var(--bg); border:1px solid var(--border); border-radius:8px; gap:8px; transition:.15s; }
    .cr-popup-task-row:hover { border-color:var(--brand); background:rgba(217,122,43,.03); }
    .cr-popup-task-row.has-dup { border-color:rgba(242,212,121,.5); background:rgba(242,212,121,.05); }
    .cr-popup-task-info { display:flex; align-items:center; gap:6px; min-width:0; flex:1; }
    .cr-popup-task-num { font-size:12px; font-weight:700; color:var(--brand); min-width:24px; }
    .cr-popup-task-mode { font-size:11px; color:var(--muted); white-space:nowrap; }
    .cr-popup-filled { font-size:9px; color:var(--green); background:rgba(95,184,95,.1); padding:1px 5px; border-radius:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:90px; display:inline-block; }
    .cr-popup-filled.dup { color:var(--yellow); background:rgba(242,212,121,.15); border:1px solid rgba(242,212,121,.3); animation:crDupPulse 1.2s infinite; }
    @keyframes crDupPulse { 0%,100%{opacity:1} 50%{opacity:.5} }
    .cr-popup-task-btns { display:flex; gap:5px; flex-shrink:0; }
    .cr-popup-btn { display:flex; align-items:center; gap:4px; padding:6px 12px; border-radius:6px; font-size:11px; font-family:inherit; font-weight:600; cursor:pointer; border:1.5px solid; transition:.18s; white-space:nowrap; }
    .cr-popup-btn-first { background:rgba(95,184,95,.08); border-color:rgba(95,184,95,.25); color:var(--green); }
    .cr-popup-btn-first:hover { background:var(--green); color:white; border-color:var(--green); transform:translateY(-1px); box-shadow:0 2px 8px rgba(95,184,95,.25); }
    .cr-popup-btn-first.filled { background:rgba(95,184,95,.15); border-color:rgba(95,184,95,.4); }
    .cr-popup-btn.dup { opacity:.5; cursor:not-allowed; }
    .cr-popup-btn-last { background:rgba(196,74,58,.08); border-color:rgba(196,74,58,.25); color:var(--red); }
    .cr-popup-btn-last:hover { background:var(--red); color:white; border-color:var(--red); transform:translateY(-1px); box-shadow:0 2px 8px rgba(196,74,58,.25); }
    .cr-popup-btn-last.filled { background:rgba(196,74,58,.15); border-color:rgba(196,74,58,.4); }
    .cr-popup-new-task { width:100%; padding:8px; display:flex; align-items:center; justify-content:center; gap:6px; background:none; border:1.5px dashed var(--border2); border-radius:8px; color:var(--muted); font-size:11px; font-family:inherit; font-weight:600; cursor:pointer; transition:.18s; }
    .cr-popup-new-task:hover { border-color:var(--brand); color:var(--brand); background:var(--brand-dim); }
    .cr-popup-empty { text-align:center; padding:8px; color:var(--muted2); font-size:10px; line-height:1.5; }
    .cr-popup-add-btn { display:inline-flex; align-items:center; gap:4px; margin-top:6px; padding:5px 12px; background:var(--brand); color:white; border:none; border-radius:6px; font-size:11px; font-family:inherit; cursor:pointer; }
    .cr-popup-usages-header { font-size:11px; font-weight:600; color:var(--muted); display:flex; align-items:center; gap:5px; padding-top:8px; border-top:1px solid var(--border); }
    .cr-popup-usages { display:flex; flex-wrap:wrap; gap:4px; }
    .cr-popup-usage-chip { font-size:10px; padding:3px 8px; border-radius:8px; background:rgba(242,212,121,.1); border:1px solid rgba(242,212,121,.2); color:var(--yellow); font-weight:600; }
    .cr-popup-unassign { width:100%; padding:6px; display:flex; align-items:center; justify-content:center; gap:5px; background:rgba(196,74,58,.06); border:1px solid rgba(196,74,58,.15); border-radius:6px; color:var(--red); font-size:10px; font-family:inherit; cursor:pointer; transition:.15s; }
    .cr-popup-unassign:hover { background:rgba(196,74,58,.12); border-color:var(--red); }

    /* ===== BATCH EDIT ===== */
    .cr-batch-edit { background:var(--bg); border-top:1px solid var(--border); }
    .cr-batch-info { display:flex; align-items:flex-start; gap:6px; padding:8px; background:rgba(74,158,232,.06); border:1px solid rgba(74,158,232,.15); border-radius:6px; font-size:10px; color:var(--muted); margin-bottom:8px; line-height:1.4; }
    .cr-preset-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:4px; }
    .cr-preset-btn { padding:5px 4px; background:var(--bg2); border:1px solid var(--border); border-radius:5px; color:var(--muted); cursor:pointer; font-size:10px; font-family:inherit; transition:.12s; text-align:center; }
    .cr-preset-btn:hover { border-color:var(--brand); color:var(--text); }
    .cr-preset-btn.active { background:var(--brand-dim); border-color:var(--brand); color:var(--brand); font-weight:600; }
    .cr-batch-cost { display:flex; align-items:center; gap:5px; padding:6px 10px; background:rgba(242,212,121,.06); border:1px solid rgba(242,212,121,.15); border-radius:6px; font-size:11px; color:var(--text); }
    .cr-batch-cost i { color:var(--yellow); }
    .cr-batch-cost strong { color:var(--yellow); }

    /* ===== COMBO TABS ===== */
    .cr-combo-tabs { display:flex; align-items:center; gap:4px; padding:6px 12px; border-bottom:1px solid var(--border); background:var(--bg); overflow:hidden; flex-shrink:0; flex-wrap:wrap; }
    .cr-combo-tab { display:flex; align-items:center; gap:5px; padding:5px 12px; border-radius:6px; font-size:12px; color:var(--muted); cursor:pointer; border:1px solid transparent; transition:.15s; white-space:nowrap; }
    .cr-combo-tab:hover { background:var(--card); color:var(--text); }
    .cr-combo-tab.active { background:var(--brand-dim); border-color:var(--brand); color:var(--brand); font-weight:600; }
    .cr-combo-count { font-size:10px; background:var(--border); padding:1px 6px; border-radius:8px; }
    .cr-combo-tab.active .cr-combo-count { background:rgba(217,122,43,.25); }
    .cr-combo-close { width:16px;height:16px;border:none;background:none;color:var(--muted2);cursor:pointer;font-size:9px;display:flex;align-items:center;justify-content:center;border-radius:50%;transition:.12s; }
    .cr-combo-close:hover { background:var(--red); color:white; }
    .cr-combo-add { width:28px;height:28px;border:1px dashed var(--border2);border-radius:6px;background:none;color:var(--muted);cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;transition:.15s; }
    .cr-combo-add:hover { border-color:var(--brand); color:var(--brand); }

    /* ===== TASK TABLE ===== */
    .cr-tasks-header { display:flex; align-items:center; justify-content:space-between; padding:8px 14px; flex-shrink:0; gap:8px; }
    .cr-tasks-title { font-size:13px; font-weight:700; display:flex; align-items:center; gap:6px; }
    .cr-tasks-scroll { flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; padding:0 8px; }
    .cr-task-list { width:100%; min-width:0; --cr-task-grid-columns:64px 118px 146px 108px 144px 72px minmax(260px,1fr) 84px 92px; }
    .cr-task-list-head { display:grid; grid-template-columns:var(--cr-task-grid-columns); gap:8px; padding:6px 10px; position:sticky; top:0; z-index:2; background:var(--bg2); border-bottom:1px solid var(--border); color:var(--muted); font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.4px; }
    .cr-task-list-body { display:flex; flex-direction:column; }
    .cr-task-empty-state { padding:18px; text-align:center; color:var(--muted); }
    .cr-task-row-shell { display:flex; flex-direction:column; }
    .cr-task-row { display:block; }
    .cr-task-wrap-cell { padding:6px 6px 0 !important; overflow:visible !important; }
    .cr-task-row-fallback { margin:8px 6px; padding:12px 14px; border:1px solid rgba(224,85,85,.28); border-left:4px solid var(--red); border-radius:12px; background:rgba(224,85,85,.08); color:var(--red); font-size:12px; }
    .cr-upload-progress { position:absolute; left:50%; bottom:14px; transform:translateX(-50%); z-index:25; padding:8px 12px; border-radius:10px; border:1px solid var(--border); background:rgba(17,17,17,.94); color:var(--text); font-size:11px; box-shadow:0 10px 24px rgba(0,0,0,.28); }
    .cr-task-block { display:flex; flex-direction:column; gap:8px; width:100%; padding:12px 14px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.12); border-left:4px solid rgba(74,158,232,.65); border-radius:12px; transition:border-color .12s ease, box-shadow .12s ease, background .12s ease; }
    .cr-task-block.is-alt { background:rgba(217,122,43,.1); border-color:rgba(217,122,43,.28); border-left-color:rgba(217,122,43,.95); }
    .cr-task-block:hover { border-color:rgba(217,122,43,.4); border-left-color:var(--brand); box-shadow:0 4px 14px rgba(0,0,0,.18); }
    .cr-task-line { display:flex; align-items:center; gap:8px; min-width:0; flex-wrap:nowrap; }
    .cr-task-line-top { display:grid; grid-template-columns:var(--cr-task-grid-columns); align-items:start; }
    .cr-task-line-bottom { padding-left:0; border-top:1px solid rgba(58,58,60,.45); padding-top:8px; justify-content:flex-start; }
    .cr-task-grid-bottom { display:flex; width:100%; max-width:100%; gap:10px; align-items:flex-end; flex-wrap:wrap; }
    .cr-task-metric { display:flex; flex-direction:column; gap:4px; min-width:0; }
    .cr-task-metric.is-hidden { display:none; }
    .cr-task-metric-label { font-size:10px; color:var(--muted); font-weight:700; line-height:1.1; white-space:nowrap; }
    .cr-task-metric-control { min-width:0; }
    .cr-bottom-col5 { width:150px; }
    .cr-bottom-col6 { width:150px; }
    .cr-bottom-col7 { width:76px; }
    .cr-bottom-col8 { width:76px; }
    .cr-bottom-col9 { width:84px; }
    .cr-bottom-col10 { width:44px; }
    .cr-bottom-col11 { width:160px; }
    .cr-task-chip { display:flex; align-items:center; gap:6px; min-width:0; width:100%; }
    .cr-task-chip-index { justify-content:flex-start; gap:10px; }
    .cr-task-chip-num { min-width:26px; justify-content:flex-start; font-weight:700; color:var(--muted); display:flex; align-items:center; gap:4px; }
    .cr-task-chip-source { min-width:0; max-width:none; }
    .cr-task-chip-provider { min-width:0; max-width:none; }
    .cr-task-chip-model { min-width:0; max-width:none; }
    .cr-task-chip-cost { min-width:0; justify-content:flex-start; }
    .cr-task-chip-prompt { min-width:0; }
    .cr-task-chip-qc { min-width:0; justify-content:flex-start; }
    .cr-task-chip-actions { min-width:0; justify-content:flex-end; }
    .cr-task-chip-motion { min-width:220px; max-width:280px; }
    .cr-task-label-inline { font-size:10px; color:var(--muted); font-weight:700; text-transform:uppercase; letter-spacing:.3px; }
    .cr-row-num { font-size:12px; font-weight:700; color:var(--muted); text-align:center; white-space:nowrap; }
    .cr-dot { display:inline-block; width:6px;height:6px;border-radius:50%;margin-right:3px;vertical-align:middle; }
    .cr-dot.running { background:var(--brand); animation:crpulse 1s infinite; }
    .cr-dot.done { background:var(--green); }
    .cr-dot.fail { background:var(--red); }
    @keyframes crpulse { 0%,100%{opacity:1}50%{opacity:.3} }
    .cr-cell-select { width:100%; max-width:100%; min-width:0; padding:4px 5px; background:var(--card); border:1px solid var(--border); border-radius:4px; color:var(--text); font-size:11px; font-family:inherit; }
    .cr-cell-input { width:100%; padding:5px 7px; background:var(--card); border:1px solid var(--border); border-radius:4px; color:var(--text); font-size:11px; font-family:inherit; }
    .cr-cell-input:focus,.cr-cell-select:focus { outline:none; border-color:var(--brand); }
    .cr-src-btn { padding:4px 6px; background:var(--card); border:1px solid var(--border); border-radius:4px; color:var(--muted); cursor:pointer; font-size:10px; font-family:inherit; transition:.12s; display:flex; align-items:center; gap:3px; width:100%; overflow:hidden; }
    .cr-src-btn:hover { border-color:var(--brand); color:var(--brand); }
    .cr-src-btn.filled { border-color:rgba(95,184,95,.3); color:var(--green); }
    .cr-src-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:80px; }
    .cr-flf-btns { display:flex; gap:4px; }
    .cr-src-btn.mini { width:auto; min-width:44px; min-height:32px; flex:1; justify-content:center; padding:6px 10px; font-size:11px; font-weight:700; }
    .cr-row-actions { display:flex; gap:3px; align-items:center; justify-content:flex-start; flex-wrap:nowrap; }
    .cr-progress-row { padding:0 6px; }
    .cr-qc-note-row { padding:2px 10px 0 10px; }
    .cr-task-gap-row { height:10px !important; }
    .cr-qc-reason { font-size:10px; color:var(--red); font-style:italic; display:flex; align-items:center; gap:4px; padding:2px 0; }

    /* ===== QC BADGES ===== */
    .cr-qc-badge { display:inline-flex; align-items:center; gap:3px; padding:2px 7px; border-radius:10px; font-size:10px; font-weight:600; }
    .cr-qc-badge.idle { color:var(--muted2); }
    .cr-qc-badge.pending { background:rgba(242,212,121,.12); color:var(--yellow); }
    .cr-qc-badge.approved { background:rgba(95,184,95,.12); color:var(--green); }
    .cr-qc-badge.rejected { background:rgba(224,85,85,.12); color:var(--red); cursor:help; }
    .cr-qc-badge.processing { background:var(--brand-dim); color:var(--brand); }
    .cr-qc-badge.done { background:rgba(95,184,95,.08); color:var(--green); }

    /* ===== STATUS BAR ===== */
    .cr-status-bar { display:flex; align-items:center; gap:14px; padding:6px 14px; border-top:1px solid var(--border); background:var(--bg); font-size:11px; color:var(--muted); flex-shrink:0; }
    .cr-pct { font-weight:700; color:var(--brand); font-size:12px; }

    /* ===== LIBRARY PANEL ===== */
    .cr-lib-body { flex:1; overflow-y:auto; display:flex; flex-direction:column; }
    .cr-lib-filters { display:flex; gap:6px; padding:8px 10px; border-bottom:1px solid var(--border); }
    .cr-lib-list { flex:1; overflow-y:auto; }
    .cr-lib-item { display:flex; align-items:flex-start; gap:8px; padding:8px 10px; border-bottom:1px solid rgba(58,58,60,.4); transition:.12s; cursor:pointer; }
    .cr-lib-item:hover { background:rgba(255,255,255,.02); }
    .cr-lib-item.rejected { border-left:3px solid var(--red); }
    .cr-lib-item.approved { border-left:3px solid var(--green); }
    .cr-lib-item.pending_qc { border-left:3px solid var(--yellow); }
    .cr-lib-thumb { width:32px;height:32px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0; }
    .cr-lib-thumb.vid { background:rgba(217,122,43,.12); color:var(--brand); }
    .cr-lib-thumb.img { background:rgba(74,158,232,.12); color:var(--blue); }
    .cr-lib-info { flex:1; min-width:0; }
    .cr-lib-name { font-size:11px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .cr-lib-meta { display:flex; align-items:center; gap:6px; margin-top:3px; flex-wrap:wrap; }
    .cr-lib-actions { display:flex; flex-direction:column; gap:3px; flex-shrink:0; }
    .cr-lib-summary { display:flex; align-items:center; gap:10px; padding:6px 10px; border-top:1px solid var(--border); font-size:11px; font-weight:600; color:var(--muted); flex-shrink:0; background:var(--bg); }

    /* ===== AI CHAT FAB BUBBLE ===== */
    .ai-fab { position:fixed; bottom:24px; right:24px; width:52px; height:52px; border-radius:50%; background:linear-gradient(135deg, #D97A2B, #C44A3A); color:white; display:flex; align-items:center; justify-content:center; font-size:20px; cursor:pointer; z-index:201; box-shadow:0 4px 20px rgba(217,122,43,.4); transition:.25s; }
    .ai-fab:hover { transform:scale(1.1); box-shadow:0 6px 28px rgba(217,122,43,.55); }
    .ai-fab.hidden { transform:scale(0); opacity:0; pointer-events:none; }
    .ai-fab-pulse { position:absolute; inset:-4px; border-radius:50%; border:2px solid rgba(217,122,43,.5); animation:aiFabPulse 2s infinite; }
    @keyframes aiFabPulse { 0%{transform:scale(1);opacity:1} 100%{transform:scale(1.5);opacity:0} }

    /* Enlarged chat panel */
    .ai-chat-panel { position:fixed; bottom:20px; right:20px; width:600px; max-height:90vh; background:var(--card); border:1px solid var(--border); border-radius:14px; box-shadow:0 8px 40px rgba(0,0,0,.5); z-index:202; transition:transform .25s cubic-bezier(.34,1.56,.64,1), opacity .15s; transform-origin:bottom right; display:flex; flex-direction:column; }
    .ai-chat-panel.collapsed { transform:scale(0); opacity:0; pointer-events:none; }
    .ai-chat-header { display:flex; align-items:center; justify-content:space-between; padding:12px 16px; font-size:14px; font-weight:600; border-bottom:1px solid var(--border); flex-shrink:0; }
    .ai-chat-body { padding:14px; overflow-y:auto; max-height:calc(90vh - 60px); }

    .ai-upload-btn { width:34px; height:34px; border-radius:8px; border:1px solid var(--border); background:var(--bg2); color:var(--muted); cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:14px; transition:.15s; flex-shrink:0; }
    .ai-upload-btn:hover { border-color:var(--brand); color:var(--brand); background:var(--brand-dim); }
    .ai-chat-attachment { display:flex; align-items:center; gap:10px; padding:8px 10px; margin-bottom:8px; border:1px solid rgba(217,122,43,.24); background:rgba(217,122,43,.07); border-radius:10px; }
    .ai-chat-attachment-thumb { width:42px; height:42px; border-radius:8px; overflow:hidden; flex-shrink:0; background:var(--bg2); display:flex; align-items:center; justify-content:center; }
    .ai-chat-attachment-thumb img { width:100%; height:100%; object-fit:cover; display:block; }
    .ai-chat-attachment-meta { min-width:0; flex:1; display:flex; flex-direction:column; gap:2px; }
    .ai-chat-attachment-title { font-size:11px; font-weight:700; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .ai-chat-attachment-sub { font-size:10px; color:var(--muted); }
    .ai-chat-attachment-clear { width:28px; height:28px; border-radius:8px; border:1px solid var(--border); background:var(--bg2); color:var(--muted); display:flex; align-items:center; justify-content:center; cursor:pointer; transition:.15s; flex-shrink:0; }
    .ai-chat-attachment-clear:hover { border-color:var(--red); color:var(--red); background:rgba(196,74,58,.08); }
    .ai-chat-img-thumb { width:60px; height:60px; border-radius:8px; overflow:hidden; margin-bottom:4px; }
    .ai-chat-img-thumb img { width:100%; height:100%; object-fit:cover; display:block; }
    .ai-prompt-suggestion { background:rgba(217,122,43,.08); border:1px solid rgba(217,122,43,.2); border-radius:6px; padding:6px 8px; font-size:11px; color:var(--brand); cursor:pointer; transition:.15s; line-height:1.4; margin-bottom:4px; }
    .ai-prompt-suggestion:hover { background:rgba(217,122,43,.15); border-color:var(--brand); }
    .chat-bubble { padding:8px 12px; border-radius:10px; font-size:12px; line-height:1.5; max-width:90%; }
    .chat-bubble.ai { background:var(--bg2); border:1px solid var(--border); color:var(--text); align-self:flex-start; }
    .chat-bubble.user { background:rgba(217,122,43,.12); border:1px solid rgba(217,122,43,.2); color:var(--text); align-self:flex-end; }



    /* ===== POPUP WIDE LAYOUT (2-column) ===== */
    .cr-popup.cr-popup-wide { width:900px; max-width:92vw; }
    .cr-popup-layout { display:flex; flex:1; overflow:hidden; min-height:0; }
    .cr-popup-layout > .cr-popup-body { flex:1; min-width:0; overflow-y:auto; }
    .cr-popup-header-actions { display:flex; align-items:center; gap:6px; }
    .cr-popup-ratio-tag { font-size:10px; background:rgba(74,158,232,.1); color:var(--blue); padding:2px 8px; border-radius:6px; font-weight:600; }
    .cr-popup-minimize { width:30px; height:30px; border:1px solid var(--border); border-radius:6px; background:none; color:var(--muted); cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:11px; transition:.15s; }
    .cr-popup-minimize:hover { border-color:var(--brand); color:var(--brand); background:var(--brand-dim); }

    /* ===== POPUP PREVIEW PANEL (right column) ===== */
    .cr-popup-preview { width:340px; min-width:340px; border-left:1px solid var(--border); background:var(--bg2); display:flex; flex-direction:column; overflow-y:auto; }
    .cr-popup-preview-label { display:flex; align-items:center; gap:6px; padding:10px 14px; font-size:12px; font-weight:700; color:var(--text); border-bottom:1px solid var(--border); flex-shrink:0; }
    .cr-popup-preview-ratio { margin-left:auto; font-size:10px; background:rgba(111,175,79,.12); color:var(--green); padding:2px 7px; border-radius:6px; font-weight:600; }
    .cr-popup-preview-frame { flex:1; display:flex; align-items:center; justify-content:center; padding:16px; }
    .cr-popup-preview-img { width:100%; position:relative; border-radius:10px; overflow:hidden; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; border:2px solid var(--border); }
    .cr-popup-preview-actual { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; background:#111; }
    .cr-popup-preview-img i { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); font-size:36px; color:rgba(255,255,255,.3); }
    .cr-popup-preview-name { position:absolute; bottom:10px; left:50%; transform:translateX(-50%); font-size:10px; color:rgba(255,255,255,.6); background:rgba(0,0,0,.45); padding:2px 10px; border-radius:4px; white-space:nowrap; }
    .cr-popup-preview-meta { padding:10px 14px; border-top:1px solid var(--border); flex-shrink:0; }
    .cr-popup-preview-meta-row { display:flex; justify-content:space-between; padding:4px 0; font-size:11px; border-bottom:1px solid rgba(58,58,60,.3); }
    .cr-popup-preview-meta-row:last-child { border-bottom:none; }
    .cr-popup-preview-meta-row span:first-child { color:var(--muted); font-weight:600; }
    .cr-popup-preview-meta-row span:last-child { color:var(--text); }

    /* ===== LIBRARY MINI CARDS (minimized edits) ===== */
    .cr-lib-mini-card { display:flex; align-items:center; gap:8px; padding:8px 10px; border-bottom:1px solid var(--border); cursor:pointer; transition:.15s; background:rgba(142,68,204,.04); border-left:3px solid var(--purple,#9B6EE0); }
    .cr-lib-mini-card:hover { background:rgba(142,68,204,.08); }
    .cr-lib-mini-icon { width:28px; height:28px; border-radius:6px; background:rgba(142,68,204,.15); color:#9B6EE0; display:flex; align-items:center; justify-content:center; font-size:12px; flex-shrink:0; animation:crpulse 1.5s infinite; }
    .cr-lib-mini-info { flex:1; min-width:0; }
    .cr-lib-mini-name { font-size:11px; font-weight:600; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .cr-lib-mini-status { font-size:9px; color:#9B6EE0; margin-top:1px; display:flex; align-items:center; gap:4px; }
    .cr-lib-mini-close { width:20px; height:20px; border:none; background:none; color:var(--muted2); cursor:pointer; font-size:10px; display:flex; align-items:center; justify-content:center; border-radius:50%; transition:.12s; flex-shrink:0; }
    .cr-lib-mini-close:hover { background:var(--red); color:white; }
    .cr-lib-preview-stage { min-height:420px; border:1px solid var(--border); border-radius:12px; overflow:hidden; background:var(--bg2); display:flex; align-items:center; justify-content:center; }
    .cr-lib-preview-stage.video { background:linear-gradient(135deg, rgba(217,122,43,.14), rgba(0,0,0,.1)); }
    .cr-lib-preview-stage.image { background:linear-gradient(135deg, rgba(74,158,232,.14), rgba(0,0,0,.08)); }
    .cr-lib-preview-video, .cr-lib-preview-image { width:100%; min-height:420px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; color:var(--text); }
    .cr-lib-preview-video i, .cr-lib-preview-image i { font-size:64px; color:rgba(255,255,255,.22); }
    .cr-lib-preview-video span, .cr-lib-preview-image span { font-size:14px; font-weight:700; color:var(--text); }

    /* ===== POPUP EDIT SECTION ===== */
    .cr-popup-edit-section { border:1px solid var(--border); border-radius:10px; overflow:hidden; }
    .cr-popup-edit-header { display:flex; align-items:center; gap:8px; padding:8px 12px; background:var(--bg2); cursor:pointer; transition:.15s; font-size:12px; font-weight:700; color:var(--text); }
    .cr-popup-edit-header:hover { background:rgba(142,68,204,.06); }
    .cr-popup-edit-body { display:none; padding:10px 12px; }
    .cr-popup-edit-body.show { display:block; }
    .cr-popup-edited-tag { font-size:9px; padding:2px 8px; border-radius:6px; background:rgba(95,184,95,.12); color:var(--green); font-weight:600; display:inline-flex; align-items:center; gap:4px; }
    .cr-popup-edit-status { display:flex; align-items:center; gap:8px; padding:8px 10px; margin-bottom:10px; background:rgba(95,184,95,.06); border:1px solid rgba(95,184,95,.15); border-radius:8px; font-size:11px; color:var(--text); line-height:1.4; }

    .cr-cell-input { width:100%; height:28px; background:var(--bg2); border:1px solid var(--border); border-radius:4px; padding:0 8px; font-size:11px; color:var(--text); transition:.15s; }
    .cr-cell-textarea { width:100%; max-width:100%; min-width:0; height:28px; min-height:28px; background:var(--bg2); border:1px solid var(--border); border-radius:4px; padding:4px 8px; font-size:11px; color:var(--text); transition:.15s; resize:none; overflow:hidden; line-height:1.4; box-sizing:border-box; word-break:break-word; }
    .cr-cell-textarea-wide { min-height:38px; height:38px; width:100%; }
    .cr-cell-input:focus, .cr-cell-textarea:focus { border-color:var(--brand); background:var(--bg); outline:none; }

    .cr-qc-mode select { background:var(--card); border:1px solid var(--border); color:var(--muted); border-radius:4px; }

    /* ===== DRAG & DROP STYLES ===== */
    .cr-grid-item[draggable="true"] { cursor:grab; }
    .cr-grid-item[draggable="true"]:active { cursor:grabbing; }
    .cr-grid-item.dragging { opacity:.5; transform:scale(.95); }
    .cr-drop-target.cr-drop-ready { border-color:var(--brand) !important; box-shadow:0 0 0 2px rgba(217,122,43,.2); animation:crDropPulse 1s infinite; }
    .cr-drop-target.cr-drop-hover { border-color:var(--green) !important; background:rgba(95,184,95,.15) !important; box-shadow:0 0 0 3px rgba(95,184,95,.3); transform:scale(1.05); }
    @keyframes crDropPulse { 0%,100%{box-shadow:0 0 0 2px rgba(217,122,43,.15)} 50%{box-shadow:0 0 0 4px rgba(217,122,43,.3)} }

    /* ===== IMAGE PICKER POPUP ===== */
    .cr-picker-folder-header { font-size:12px; font-weight:700; color:var(--text); display:flex; align-items:center; gap:6px; padding:8px 0 4px; border-bottom:1px solid var(--border); margin-bottom:6px; margin-top:8px; }
    .cr-picker-folder-header:first-child { margin-top:0; }
    .cr-picker-grid { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:8px; margin-bottom:10px; }
    .cr-picker-item { display:flex; flex-direction:column; align-items:center; gap:4px; padding:6px; border-radius:8px; cursor:pointer; transition:.18s; border:1.5px solid transparent; }
    .cr-picker-item:hover { background:rgba(217,122,43,.06); border-color:var(--brand); transform:translateY(-2px); box-shadow:0 3px 12px rgba(0,0,0,.2); }
    .cr-picker-thumb { width:100%; aspect-ratio:1; border-radius:6px; display:flex; align-items:center; justify-content:center; position:relative; overflow:hidden; background:var(--bg2); }
    .cr-picker-name { font-size:9px; color:var(--text); text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; line-height:1.2; }

    @media (max-width: 1536px) {
      .cr-panel-left { width:360px; min-width:360px; max-width:360px; }
      .ai-chat-panel { width:min(520px, calc(100vw - 40px)); }
    }

    @media (max-width: 1280px) {
      .cr-topbar { flex-wrap:wrap; align-items:flex-start; }
      .cr-topbar-left, .cr-topbar-actions { width:100%; }
      .cr-workspace { flex-direction:column; overflow:auto; }
      .cr-panel-left, .cr-panel-center { width:100%; min-width:0; max-width:none; border-left:none; border-right:none; }
      .cr-panel-left { max-height:42vh; border-bottom:1px solid var(--border); }
      .cr-panel-center { min-height:46vh; }
      .cr-picker-grid { grid-template-columns:repeat(3, minmax(0,1fr)); }
      .ai-chat-panel { width:min(460px, calc(100vw - 32px)); right:16px; bottom:16px; }
      .cr-popup.cr-popup-wide { width:min(1100px, calc(100vw - 32px)); }
      .cr-popup-layout { flex-direction:column; }
      .cr-popup-preview { width:100%; min-width:0; border-left:none; border-top:1px solid var(--border); max-height:40vh; }
      .cr-task-line { flex-wrap:wrap; }
      .cr-task-line-top { display:flex; }
      .cr-task-line-bottom { padding-left:0; }
      .cr-task-grid-bottom { grid-template-columns:1fr 1fr; }
      .cr-bottom-col5,.cr-bottom-col6,.cr-bottom-col7,.cr-bottom-col8,.cr-bottom-col9,.cr-bottom-col10,.cr-bottom-col11,.cr-bottom-col12 { grid-column:auto; }
      .cr-task-chip-prompt { min-width:260px; }
      .cr-task-chip-motion { min-width:220px; }
    }

    @media (max-width: 768px) {
      .cr-topbar { padding:8px 10px; }
      .cr-topbar-actions { gap:6px; }
      .cr-model-badge { width:100%; }
      .cr-model-select { width:100%; }
      .cr-panel-header { padding:10px 12px; }
      .cr-source-toolbar, .cr-lib-filters, .cr-combo-tabs, .cr-tasks-header, .cr-status-bar { flex-wrap:wrap; }
      .cr-task-list { width:100%; min-width:0; }
      .cr-tasks-scroll, .cr-lib-list, .cr-source-body { -webkit-overflow-scrolling:touch; }
      .cr-picker-grid { grid-template-columns:repeat(2, minmax(0,1fr)); }
      .ai-chat-panel { width:calc(100vw - 24px); right:12px; bottom:12px; max-height:80vh; }
      .cr-popup { width:calc(100vw - 20px); max-width:calc(100vw - 20px); max-height:84vh; }
      .cr-popup.show { transform:translate(-50%,-50%) scale(1); }
      .cr-popup-body { padding:12px; }
      .cr-task-line { flex-wrap:wrap; gap:6px; }
      .cr-task-line-top { display:flex; }
      .cr-task-chip-source, .cr-task-chip-provider, .cr-task-chip-model, .cr-task-chip-motion, .cr-task-chip-prompt { min-width:100%; max-width:none; }
      .cr-task-chip-actions { min-width:100%; justify-content:flex-start; }
      .cr-task-line-bottom { padding-left:0; }
      .cr-task-grid-bottom { grid-template-columns:1fr; }
      .cr-bottom-col5,.cr-bottom-col6,.cr-bottom-col7,.cr-bottom-col8,.cr-bottom-col9,.cr-bottom-col10,.cr-bottom-col11,.cr-bottom-col12 { grid-column:auto; }
    }

    @media (max-width: 576px) {
      .cr-upload-zone { padding:16px 12px; }
      .cr-btn, .cr-btn-primary, .cr-btn-ghost, .cr-btn-run { font-size:11px; padding:7px 10px; }
      .cr-picker-grid { grid-template-columns:repeat(2, minmax(0,1fr)); gap:6px; }
      .cr-task-list { width:100%; min-width:0; }
      .cr-lib-summary { flex-wrap:wrap; }
      .cr-status-bar { gap:8px; padding:6px 10px; }
      .ai-fab { width:46px; height:46px; right:14px; bottom:14px; }
    }
  `;

  document.head.appendChild(s);
}

// ========== TASK DETAIL POPUP ==========
function openTaskDetailPopup(idx, event, preserveContainer) {
  // Prevent popup if clicking interactive elements
  if (!preserveContainer && event && event.target && event.target.closest && event.target.closest('select, input, textarea, button, .cr-icon-btn, .cr-src-btn, .cr-cell-textarea')) return;

  const combo = taskCombos[activeComboIdx];
  if (!combo) return;
  const t = combo.tasks[idx];
  if (!t) return;

  // Find source images
  let srcImgUrl = '', srcImgName = '';
  let firstImgUrl = '', firstImgName = '';
  let lastImgUrl = '', lastImgName = '';

  if (t.sourceImgId) {
    const img = DEMO_IMAGES.find(i => i.id === t.sourceImgId);
    srcImgUrl = img?.previewUrl || '';
    srcImgName = img?.name || t.sourceImg || '';
  }
  if (t.firstFrameId) {
    const img = DEMO_IMAGES.find(i => i.id === t.firstFrameId);
    firstImgUrl = img?.previewUrl || '';
    firstImgName = img?.name || t.firstFrame || '';
  }
  if (t.lastFrameId) {
    const img = DEMO_IMAGES.find(i => i.id === t.lastFrameId);
    lastImgUrl = img?.previewUrl || '';
    lastImgName = img?.name || t.lastFrame || '';
  }

  // Status badge
  const statusMap = {
    idle: { label: 'Ch&#7901; ch&#7841;y', cls: 'idle', icon: 'fa-clock' },
    running: { label: `&#272;ang ch&#7841;y (${Math.round(t.progress||0)}%)`, cls: 'processing', icon: 'fa-spinner fa-spin' },
    done: { label: 'Ho&#224;n t&#7845;t', cls: 'approved', icon: 'fa-check' },
    fail: { label: 'Th&#7845;t b&#7841;i', cls: 'rejected', icon: 'fa-xmark' },
  };
  const st = statusMap[t.status] || statusMap.idle;

  // QC badge
  const qcMap = {
    pending_qc: { label: 'Ch&#7901; QC', cls: 'pending', icon: 'fa-clock' },
    approved: { label: '&#272;&#227; duy&#7879;t', cls: 'approved', icon: 'fa-check-double' },
    rejected: { label: 'T&#7915; ch&#7889;i', cls: 'rejected', icon: 'fa-xmark' },
  };
  const qc = t.qcStatus ? (qcMap[t.qcStatus] || { label: '', cls: 'idle', icon: '' }) : { label: 'Ch&#432;a g&#7917;i', cls: 'idle', icon: '' };
  const qcReason = String(t.qcNote || '').trim();
  const qcReviewer = String(t.qcReviewer || '').trim();
  const canStartTask = _canStartTaskNow(t);
  const isRerun = _taskHasRunHistory(t);
  const runHistoryHtml = _renderTaskRunHistory(t);

  // Frame thumbnails
  let framesHtml = '';
  if (t.mode === 'i2v') {
    framesHtml = `
      <div style="display:flex;gap:12px;margin-bottom:12px;width:100%">
        <div style="flex:1;text-align:center;min-width:0">
          <div style="font-size:10px;font-weight:700;color:var(--muted);margin-bottom:6px">NGU&#7890;N I2V</div>
          <div style="width:100%;aspect-ratio:${getTaskAspectRatioCss(t)};border-radius:10px;overflow:hidden;border:2px solid ${srcImgUrl?'var(--green)':'var(--border)'};background:#111;display:flex;align-items:center;justify-content:center">
            ${srcImgUrl ? `<img src="${srcImgUrl}" style="width:100%;height:100%;object-fit:cover">` : '<i class="fa-solid fa-image" style="font-size:32px;color:var(--muted2)"></i>'}
          </div>
          <div style="font-size:10px;color:var(--muted);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%" title="${srcImgName||''}">${srcImgName || 'Ch&#432;a ch&#7885;n'}</div>
        </div>
      </div>`;
  } else {
    framesHtml = `
      <div style="display:flex;gap:12px;margin-bottom:12px;width:100%">
        <div style="flex:1;text-align:center;min-width:0">
          <div style="font-size:10px;font-weight:700;color:var(--green);margin-bottom:6px"><i class="fa-solid fa-play"></i> KHUNG &#272;&#7846;U</div>
          <div style="width:100%;aspect-ratio:${getTaskAspectRatioCss(t)};border-radius:10px;overflow:hidden;border:2px solid ${firstImgUrl?'var(--green)':'var(--border)'};background:#111;display:flex;align-items:center;justify-content:center">
            ${firstImgUrl ? `<img src="${firstImgUrl}" style="width:100%;height:100%;object-fit:cover">` : '<i class="fa-solid fa-image" style="font-size:32px;color:var(--muted2)"></i>'}
          </div>
          <div style="font-size:10px;color:var(--muted);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%" title="${firstImgName||''}">${firstImgName || 'Ch&#432;a ch&#7885;n'}</div>
        </div>
        <div style="display:flex;align-items:center;padding:0 4px;min-width:0"><i class="fa-solid fa-arrow-right" style="color:var(--brand);font-size:16px"></i></div>
        <div style="flex:1;text-align:center;min-width:0">
          <div style="font-size:10px;font-weight:700;color:var(--red);margin-bottom:6px"><i class="fa-solid fa-stop"></i> KHUNG CU&#7888;I</div>
          <div style="width:100%;aspect-ratio:${getTaskAspectRatioCss(t)};border-radius:10px;overflow:hidden;border:2px solid ${lastImgUrl?'var(--red)':'var(--border)'};background:#111;display:flex;align-items:center;justify-content:center">
            ${lastImgUrl ? `<img src="${lastImgUrl}" style="width:100%;height:100%;object-fit:cover">` : '<i class="fa-solid fa-image" style="font-size:32px;color:var(--muted2)"></i>'}
          </div>
          <div style="font-size:10px;color:var(--muted);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%" title="${lastImgName||''}">${lastImgName || 'Ch&#432;a ch&#7885;n'}</div>
        </div>
      </div>`;
  }

  const cameraMoveList = Array.isArray(CAMERA_MOVES) && CAMERA_MOVES.length ? CAMERA_MOVES : ['-- None --'];
  const camOpts = cameraMoveList.map(c => `<option ${t.cameraMove===c?'selected':''}>${c}</option>`).join('');
  const effectOpts = VIDEO_EFFECT_GROUPS.map((row) => `<option value="${String(row.id || '').replace(/"/g, '&quot;')}" ${String(t.effectGroup || 'none') === String(row.id || '') ? 'selected' : ''}>${row.label}</option>`).join('');
  const popupCustomEffectInput = String(t.effectGroup || 'none') === 'custom'
    ? `<input class="cr-cell-input" style="font-size:11px;font-weight:600" placeholder="Nh\u1eadp hi\u1ec7u \u1ee9ng t\u00f9y ch\u1ecdn..." value="${String(t.effectGroupCustom || '').replace(/"/g, '&quot;')}" oninput="updateTask(${idx},'effectGroupCustom',this.value)">`
    : '';
  const providerRows = getProviderCatalogRows();
  const selectedProvider = String(t.provider || getDefaultProviderId()).trim().toLowerCase() || 'provider1';
  const selectedProviderRow = getProviderRow(selectedProvider);
  const providerOpts = providerRows.map((row) => `<option value="${String(row.id || '').replace(/"/g, '&quot;')}" ${String(row.id || '') === selectedProvider ? 'selected' : ''}>${String(row.name || row.id || '')}</option>`).join('');
  const modelRows = Array.isArray(selectedProviderRow?.models) ? selectedProviderRow.models : [];
  const selectedModelId = String(t.modelId || getDefaultModelId(selectedProvider)).trim();
  const mediaProfile = applyTaskMediaProfile(t);
  const modelOpts = modelRows.map((row) => `<option value="${String(row.id || '').replace(/"/g, '&quot;')}" ${String(row.id || '') === selectedModelId ? 'selected' : ''}>${String(row.label || row.id || '')}</option>`).join('');
  const providerPopupControl = canChangeTaskProvider()
    ? `<select class="cr-cell-select" style="font-size:11px;font-weight:600" onchange="updateTask(${idx},'provider',this.value)">${providerOpts}</select>`
    : `<div style="font-size:11px;font-weight:600;color:var(--text);padding:3px 0">${String(selectedProviderRow?.name || selectedProvider || '-')}</div>`;
  const popupResolutionControl = mediaProfile.resolutionOptions.length > 1
    ? `<select class="cr-cell-select" style="font-size:11px;font-weight:600" onchange="updateTask(${idx},'resolution',this.value)">${mediaProfile.resolutionOptions.map((value) => `<option value="${String(value).replace(/"/g, '&quot;')}" ${mediaProfile.resolution === value ? 'selected' : ''}>${value}</option>`).join('')}</select>`
    : `<div data-task-resolution="${t.id}" style="font-size:11px;font-weight:600;color:var(--text);padding:3px 0">${mediaProfile.resolutionDisplay}</div>`;
  const popupFpsControl = mediaProfile.fpsOptions.length > 1
    ? `<select class="cr-cell-select" style="font-size:11px;font-weight:600" onchange="updateTask(${idx},'fps',this.value)">${mediaProfile.fpsOptions.map((value) => `<option value="${String(value).replace(/"/g, '&quot;')}" ${mediaProfile.fps === value ? 'selected' : ''}>${value}</option>`).join('')}</select>`
    : `<div data-task-fps="${t.id}" style="font-size:11px;font-weight:600;color:var(--text);padding:3px 0">${mediaProfile.fpsDisplay}</div>`;

  const popupHtml = `
    <div class="cr-popup-overlay" onclick="closeTaskDetailPopup()"></div>
    <div class="cr-popup show" style="width:96vw;max-width:1400px;overflow:hidden">
      <div class="cr-popup-header" style="border-bottom:1px solid var(--border);padding:8px 14px">
        <div style="display:flex;align-items:center;gap:8px">
          <i class="fa-solid fa-layer-group" style="color:var(--brand)"></i>
          <span class="cr-popup-title">${combo.name}  Task #${idx + 1}</span>
          <span class="cr-qc-badge ${st.cls}"><i class="fa-solid ${st.icon}"></i> ${st.label}</span>
        </div>
        <button class="cr-popup-close" onclick="closeTaskDetailPopup()"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="cr-popup-body" style="padding:12px;display:flex !important;flex-direction:row !important;gap:14px;align-items:flex-start;flex-wrap:nowrap !important">

        <!-- COL 1: Thumbnails -->
        <div style="flex:0 0 220px;min-width:180px">
        ${framesHtml}
        </div>

        <!-- COL 2: Settings Grid (EDITABLE) -->
        <div style="flex:0 0 220px;display:grid;grid-template-columns:1fr 1fr;gap:6px">
          <div style="background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px 8px;grid-column:1 / -1">
            <div style="font-size:8px;font-weight:700;color:var(--muted);margin-bottom:2px">SERVER</div>
            ${providerPopupControl}
          </div>
          <div style="background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px 8px;grid-column:1 / -1">
            <div style="font-size:8px;font-weight:700;color:var(--muted);margin-bottom:2px">MODEL</div>
            <select class="cr-cell-select" style="font-size:11px;font-weight:600" onchange="updateTask(${idx},'modelId',this.value)">${modelOpts}</select>
          </div>
          <div style="background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px 8px">
            <div style="font-size:8px;font-weight:700;color:var(--muted);margin-bottom:2px">CH&#7870; &#272;&#7896;</div>
            <select class="cr-cell-select" style="font-size:11px;font-weight:600" onchange="updateTask(${idx},'mode',this.value)">
              <option value="i2v" ${t.mode==='i2v'?'selected':''}>&#7842;nh &rarr; Video</option>
              <option value="flf" ${t.mode==='flf'?'selected':''}>Khung &#273;&#7847;u-cu&#7889;i</option>
            </select>
          </div>
          <div style="background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px 8px">
      <div style="font-size:8px;font-weight:700;color:var(--muted);margin-bottom:2px">TH&#7900;I GIAN</div>
            <select class="cr-cell-select" style="font-size:11px;font-weight:600" onchange="updateTask(${idx},'duration',this.value)">
              <option value="5s" ${t.duration==='5s'?'selected':''}>5s</option>
              <option value="10s" ${t.duration==='10s'?'selected':''}>10s</option>
            </select>
          </div>
          <div style="background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px 8px">
            <div style="font-size:8px;font-weight:700;color:var(--muted);margin-bottom:2px">T&#7926; L&#7878;</div>
            <select class="cr-cell-select" style="font-size:11px;font-weight:600" onchange="updateTask(${idx},'ratio',this.value)">
              <option value="9:16" ${t.ratio==='9:16'?'selected':''}>9:16</option>
              <option value="16:9" ${t.ratio==='16:9'?'selected':''}>16:9</option>
              <option value="1:1" ${t.ratio==='1:1'?'selected':''}>1:1</option>
              <option value="original" ${t.ratio==='original'?'selected':''}>Theo t&#7927; l&#7879; &#7843;nh g&#7889;c</option>
            </select>
          </div>
          <div style="background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px 8px">
            <div style="font-size:8px;font-weight:700;color:var(--muted);margin-bottom:2px">&#272;&#7896; PH&#194;N GI&#7842;I</div>
            ${popupResolutionControl}
          </div>
          <div style="background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px 8px">
            <div style="font-size:8px;font-weight:700;color:var(--muted);margin-bottom:2px">FPS</div>
            ${popupFpsControl}
          </div>
          <div style="background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px 8px">
            <div style="font-size:8px;font-weight:700;color:var(--muted);margin-bottom:2px">CREDITS</div>
            <div data-task-cost="${t.id}" style="font-size:11px;font-weight:600;color:var(--brand);padding:3px 0">${getTaskCostLabel(t)}</div>
          </div>
          <div style="background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px 8px;grid-column:1 / -1">
            <div style="font-size:8px;font-weight:700;color:var(--muted);margin-bottom:2px">NH\u00d3M HI\u1ec6U \u1ee8NG</div>
            <select class="cr-cell-select" style="font-size:11px;font-weight:600" onchange="updateTask(${idx},'effectGroup',this.value)">${effectOpts}</select>
          </div>
          ${popupCustomEffectInput ? `
          <div style="background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px 8px;grid-column:1 / -1">
            <div style="font-size:8px;font-weight:700;color:var(--muted);margin-bottom:2px">M\u00d4 T\u1ea2 T\u00d9Y CH\u1eccN</div>
            ${popupCustomEffectInput}
          </div>` : ''}
        </div>

        <!-- COL 3: Camera + Prompt + QC -->
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:8px">
          <div>
            <div style="font-size:9px;font-weight:700;color:var(--muted);margin-bottom:3px"><i class="fa-solid fa-video" style="color:var(--purple,#9B6EE0)"></i> CHUY&#7874;N &#272;&#7896;NG</div>
            <select class="cr-cell-select" style="font-size:11px;font-weight:600;padding:5px 10px" onchange="updateTask(${idx},'cameraMove',this.value);autoCameraPrompt(${idx},this.value)">
              ${camOpts}
            </select>
          </div>
          <div>
            <div style="font-size:9px;font-weight:700;color:var(--muted);margin-bottom:3px"><i class="fa-solid fa-pen-nib" style="color:var(--brand)"></i> PROMPT CHUY&#7874;N &#272;&#7896;NG</div>
            <textarea class="form-textarea" id="taskDetailPrompt" style="width:100%;min-height:50px;max-height:150px;font-size:10px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;color:var(--text);resize:none;overflow-y:auto;box-sizing:border-box;line-height:1.4" oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px';updateTask(${idx},'prompt',this.value)">${t.prompt || ''}</textarea>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
              <button class="cr-btn cr-btn-ghost" style="font-size:9px;padding:3px 8px" onclick="const v=document.getElementById('taskDetailPrompt').value;updateTask(${idx},'prompt',v);showToast('\u0110\u00E3 l\u01B0u prompt','success')">
                <i class="fa-solid fa-save"></i> L&#432;u
              </button>
              <span style="font-size:8px;color:var(--muted)">T&#7921; &#273;&#7897;ng m&#7903; r&#7897;ng</span>
            </div>
          </div>
          <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;min-height:96px">
            <div style="font-size:9px;font-weight:700;color:var(--muted);margin-bottom:6px"><i class="fa-solid fa-shield-check" style="color:var(--yellow)"></i> QC</div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px">
              <span class="cr-qc-badge ${qc.cls}"><i class="fa-solid ${qc.icon}"></i> ${qc.label}</span>
              ${qcReviewer ? `<span style="font-size:10px;color:var(--muted)">Reviewer: ${qcReviewer}</span>` : ''}
            </div>
            <div style="font-size:10px;color:var(--text);line-height:1.5">
              ${qcReason ? `Lý do/Ghi chú: ${qcReason}` : 'Chưa có cập nhật QC'}
            </div>
          </div>
          ${runHistoryHtml}
        </div>

        <!-- COL 4: Action Buttons -->
        <div style="flex:0 0 auto;display:flex;flex-direction:column;gap:6px;min-width:100px">
          ${canStartTask ? `<button class="cr-btn cr-btn-run" style="font-size:11px;white-space:nowrap" onclick="closeTaskDetailPopup();runSingleTask(${idx})"><i class="fa-solid ${isRerun ? 'fa-rotate-right' : 'fa-play'}"></i> ${isRerun ? 'Re-run' : 'Ch&#7841;y'}</button>` : ''}
          ${t.status === 'running' ? `<button class="cr-btn cr-btn-ghost" style="font-size:11px;white-space:nowrap" onclick="closeTaskDetailPopup();pollTaskStatus(${idx})"><i class="fa-solid fa-rotate-right"></i> C&#7853;p nh&#7853;t</button>` : ''}
          ${t.status === 'done' ? `<button class="cr-btn cr-btn-primary" style="font-size:11px;white-space:nowrap" onclick="closeTaskDetailPopup();previewTaskVideo(${idx})"><i class="fa-solid fa-eye"></i> Xem</button>` : ''}
          ${canSendTaskQC(t) ? `<button class="cr-btn cr-btn-ghost" style="font-size:11px;white-space:nowrap" onclick="closeTaskDetailPopup();sendTaskQC(${idx})"><i class="fab fa-telegram"></i> QC</button>` : ''}
        </div>

      </div>
    </div>
  `;

  let container = document.getElementById('taskDetailPopupContainer');
  const existed = !!container;
  if (!container) {
    container = document.createElement('div');
    container.id = 'taskDetailPopupContainer';
  }
  if (container._escHandler) document.removeEventListener('keydown', container._escHandler);
  container.innerHTML = popupHtml;
  if (!existed) document.body.appendChild(container);

  const escHandler = (e) => { if (e.key === 'Escape') closeTaskDetailPopup(); };
  container._escHandler = escHandler;
  document.addEventListener('keydown', escHandler);

  // Initial auto-expand
  setTimeout(() => {
    const ta = document.getElementById('taskDetailPrompt');
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    }
  }, 100);
}

function closeTaskDetailPopup() {
  const container = document.getElementById('taskDetailPopupContainer');
  if (container) {
    if (container._escHandler) document.removeEventListener('keydown', container._escHandler);
    container.remove();
  }
}

function refreshTaskDetailPopup(idx) {
  const container = document.getElementById('taskDetailPopupContainer');
  if (!container) return;
  openTaskDetailPopup(idx, null, true);
}

// ========== VIDEO PREVIEW ==========
function previewTaskVideo(idx) {
  const t = taskCombos[activeComboIdx].tasks[idx];
  if (!t || t.status !== 'done') return;
  if (!t.resultUrl) {
    showToast('Task ch\u01B0a c\u00F3 resultUrl. H\u00E3y poll tr\u1EA1ng th\u00E1i tr\u01B0\u1EDBc.', 'warning');
    return;
  }

  const overlayHtml = `
    <div class="cr-popup-overlay" id="vidPopupOverlay" onclick="closeVideoPopup()"></div>
    <div class="cr-popup show" id="vidPopup" style="width:700px; padding:0; overflow:hidden; background:#000;">
      <div style="position:relative; width:100%; padding-top:56.25%;">
        <video controls autoplay loop style="position:absolute; top:0; left:0; width:100%; height:100%; object-fit:contain;">
          <source src="${t.resultUrl}" type="video/mp4">
        </video>
        <button onclick="closeVideoPopup()" style="position:absolute; top:10px; right:10px; background:rgba(0,0,0,0.5); color:#fff; border:none; width:30px; height:30px; border-radius:50%; cursor:pointer; font-size:14px; display:flex; align-items:center; justify-content:center; transition:0.2s; z-index:100;">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <div style="padding:10px 15px; color:#fff; font-size:12px; font-weight:600; background:#111; display:flex; justify-content:space-between; align-items:center;">
        <span>${taskCombos[activeComboIdx].name} - Task #${idx + 1}</span>
        ${t.qcStatus === 'approved' ? `<button class="cr-btn cr-btn-primary" onclick="downloadTask(${idx})"><i class="fa-solid fa-download"></i> T&#7843;i v&#7873;</button>` : ''}
      </div>
    </div>
  `;
  const container = document.createElement('div');
  container.id = 'videoPopupContainer';
  container.innerHTML = overlayHtml;
  document.body.appendChild(container);

  // Close on ESC
  document.addEventListener('keydown', closeVideoPopupOnEsc);
}

function closeVideoPopupOnEsc(e) {
  if (e.key === 'Escape') closeVideoPopup();
}

function closeVideoPopup() {
  const container = document.getElementById('videoPopupContainer');
  if (container) {
    container.remove();
    document.removeEventListener('keydown', closeVideoPopupOnEsc);
  }
}

window.syncCreatorQCFromLibrary = syncCreatorQCFromLibrary;

function __buildFallbackTaskRowHtml(taskIndex, message) {
  const safeIndex = Number.isFinite(taskIndex) ? taskIndex : 0;
  const safeMessage = String(message || 'render_error').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div class="cr-task-row-shell" data-task-idx="${safeIndex}"><div class="cr-task-row-fallback">L&#7895;i render task #${safeIndex + 1}: ${safeMessage}</div></div>`;
}

function addTaskRow() {
  try {
    const ctx = getActiveComboContext();
    const combo = ctx && ctx.combo ? ctx.combo : null;
    if (!combo) {
      showToast('Ph\u1EA3i t\u1EA1o CODE tr\u01B0\u1EDBc', 'error');
      return;
    }
    if (!Array.isArray(combo.tasks)) combo.tasks = [];

    const newTask = createDefaultTask();
    combo.tasks.push(newTask);
    const newIdx = combo.tasks.length - 1;
    scheduleSaveCreatorDraftState(0);

    let rowRendered = false;
    const body = document.getElementById('taskTableBody');
    if (body) {
      try {
        const emptyStateRow = body.querySelector('.cr-task-empty-state');
        if (emptyStateRow) body.innerHTML = '';
        const rowHtml = renderTaskRow(newTask, newIdx);
        body.insertAdjacentHTML('beforeend', rowHtml);
        rowRendered = true;
      } catch (renderErr) {
        body.insertAdjacentHTML('beforeend', __buildFallbackTaskRowHtml(newIdx, renderErr && renderErr.message ? renderErr.message : 'render_error'));
        rowRendered = true;
      }
    }

    if (!rowRendered) {
      try { renderActiveCombo(); } catch (_) {}
    }
    try { syncActiveComboTabMeta(); } catch (_) {}
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'Kh\u00F4ng x\u00E1c \u0111\u1ECBnh';
    showToast(`L\u1ED7i addTaskRow: ${msg}`, 'error');
    try { console.error('addTaskRow failed', err); } catch (_) {}
  }
}

function __addTaskRowSafe() {
  return addTaskRow();
}

window.addTaskRow = addTaskRow;
window.__addTaskRowSafe = __addTaskRowSafe;
window.openTaskDetailPopup = openTaskDetailPopup;
window.closeTaskDetailPopup = closeTaskDetailPopup;
window.renderLibraryIfChanged = renderLibraryIfChanged;

