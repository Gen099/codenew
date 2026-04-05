// ===== UNIFIED DATA STORE \u2013 F-Aistudio VideoTool =====
// Central state shared across ALL screens: Creator, Dashboard, HR, QC, Library
// All metadata is tagged for full traceability

const AppData = {

  // ---- FIXED CONFIG ----
  model: { id: 'kling25_turbo_pro', name: 'Kling 2.5 Turbo Pro', provider: 'provider1', cr5: 42, cr10: 84, unit: 'credits' },
  fixedResolution: '1080p',
  fixedFPS: '24',

  // ---- CURRENT USER (changes on role switch) ----
  currentUser: { id: 'staff_01', name: 'Admin', role: 'admin', avatar: 'A', color: '#D97A2B', permissions: [] },
  authUser: null,
  viewingAsUserId: '',
  authSession: { userId: '', username: '', role: '', permissions: [] },
  viewContext: { userId: '', username: '', mode: 'self' },

  // ---- STAFF REGISTRY ----
  staff: [],

  // ---- IMAGES (unified, tagged) ----
  images: [],

  // ---- LIBRARY / OUTPUT (tagged) ----
  library: [],
  qcQueue: [],
  systemStatus: { online_staff: [], online_count: 0, pending_video: 0, pending_image: 0, announcements: [] },

  // ---- SESSIONS ----
  sessions: [],

  // ---- CREDIT LOG ----
  creditLog: [],

  budget: { total: 10000, alertThresholds: [80, 90, 100] },

  // ---- SHIFT REPORTS ----
  shiftReports: [],

  // ---- SHIFT CONFIG ----
  shiftConfig: {},

  // ---- PROVIDER SETTINGS ----
  providerSettings: {
    default_provider: 'provider1',
    default_models: { provider1: 'kling25_turbo_pro', provider2: 'kling25_turbo' },
    kie_credit_package: 'usd50_10000',
    provider2_endpoint: 'https://api.piapi.ai/api/v1/task'
  },
  providerCatalog: { default_provider: 'provider1', default_models: { provider1: 'kling25_turbo_pro', provider2: 'kling25_turbo' }, kie_credit_package: 'usd50_10000', kie_credit_packages: [], providers: [] },

  // ---- ACTIVE SHIFT ----
  activeShift: null,
  activeShiftSummary: null,
  activeShiftReportSubmitted: false,

  // ---- ACTIVITY HISTORY ----
  activityHistory: [],

  // ---- CODE REGISTRY ----
  codes: [],

  // ---- PRESETS ----
  presets: ['\u2728 Product Pro','\uD83C\uDF05 Cinematic','\uD83C\uDFA8 Artwork','\uD83D\uDDBC\uFE0F Clean BG','\uD83D\uDCF1 Social','\uD83C\uDFEA E-commerce'],
  cameraMoves: ['-- None --','Pan Left','Pan Right','Zoom In','Zoom Out','Orbit Left','Orbit Right','Tilt Up','Tilt Down','Push In','Dolly Out'],
};

// Runtime seed mode:
// - seed=true: keep demo bootstrap data (for local demo/dev)
// - seed=false: start with empty business data and rely on manual/API operations
const __RUNTIME_SEED__ = (() => {
  try {
    if (typeof window !== 'undefined' && window.RUNTIME_CONFIG && typeof window.RUNTIME_CONFIG.seed !== 'undefined') {
      return !!window.RUNTIME_CONFIG.seed;
    }
  } catch {}
  return true;
})();

AppData.seedEnabled = __RUNTIME_SEED__;
if (!AppData.seedEnabled) {
  AppData.staff = [];
  AppData.images = [];
  AppData.library = [];
  AppData.qcQueue = [];
  AppData.sessions = [];
  AppData.creditLog = [];
  AppData.shiftReports = [];
  AppData.shiftConfig = {};
  AppData.activeShift = null;
  AppData.activeShiftSummary = null;
  AppData.activityHistory = [];
  AppData.codes = [];
}

// ===== HELPER FUNCTIONS =====

// Get staff by ID
function getStaff(id) {
  const key = String(id || '').trim();
  return AppData.staff.find(s => String(s.id || '') === key || String(s.username || '') === key) || { name: 'Unknown', avatar: '?', color: '#999', role: 'unknown', status: 'offline' };
}

// Get images by codeTag
function getImagesByCode(codeTag) {
  return AppData.images.filter(i => i.codeTag === codeTag);
}

// Get library items by codeTag
function getLibraryByCode(codeTag) {
  return AppData.library.filter(i => i.codeTag === codeTag);
}

// Get staff stats (for KPI, Dashboard, HR)
function getStaffStats(staffId) {
  return getStaffStatsFromItems(staffId, AppData.library, AppData.images);
}

function getStaffStatsFromItems(staffId, libraryItems = AppData.library, imageItems = AppData.images) {
  const lib = (Array.isArray(libraryItems) ? libraryItems : []).filter(i => i.staffId === staffId);
  const videos = lib.filter(i => i.type === 'video');
  const images = lib.filter(i => i.type === 'image');
  const approved = videos.filter(i => i.status === 'approved').length;
  const rejected = videos.filter(i => i.status === 'rejected').length;
  const pending = videos.filter(i => i.status === 'pending_qc').length;
  const done = videos.filter(i => i.status === 'done').length;
  const processing = videos.filter(i => i.status === 'processing').length;
  const totalQC = approved + rejected;
  const qcPassRate = totalQC > 0 ? Math.round((approved / totalQC) * 100) : 100;
  const creditsUsed = lib.reduce((sum, i) => sum + (i.credits || 0), 0);

  // Image edits by this staff
  const editedImages = (Array.isArray(imageItems) ? imageItems : []).filter(i => i.staffId === staffId && i.edited);

  return {
    videoCount: videos.length,
    imageCount: images.length,
    editedCount: editedImages.length,
    approved, rejected, pending, done, processing,
    qcPassRate,
    creditsUsed,
    totalMedia: videos.length + images.length,
    // KPI score: weighted formula
    kpiScore: Math.min(100, Math.round(
      (videos.length * 3) + (qcPassRate * 0.5) + (editedImages.length * 2) - (rejected * 5)
    )),
  };
}

// Get dashboard stats
function getDashboardStats() {
  return {
    today: getPeriodStats('today'),
    week: getPeriodStats('week'),
    month: getPeriodStats('month'),
    totalCreditsUsed: AppData.library.reduce((s, i) => s + (i.credits || 0), 0),
  };
}

function getDashboardItems(mode = 'all') {
  const now = new Date();
  const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  function filterByDate(items, since) {
    return items.filter(i => i.createdAt && new Date(i.createdAt) >= since);
  }

  if (mode === 'today') return filterByDate(AppData.library, todayStart);
  if (mode === 'week') return filterByDate(AppData.library, weekAgo);
  if (mode === 'month') return filterByDate(AppData.library, monthStart);
  return Array.isArray(AppData.library) ? AppData.library.slice() : [];
}

function calcDashboardStatsForItems(items) {
  const videos = items.filter(i => i.type === 'video');
  const images = items.filter(i => i.type === 'image');
  return {
    media: items.length,
    videoCreated: videos.length,
    imageCreated: images.length,
    videoUsed: videos.filter(i => i.status === 'approved').length,
    imageUsed: images.filter(i => i.status === 'done' || i.status === 'approved').length,
    recover: videos.filter(i => i.status === 'rejected').length,
    credits: items.reduce((s, i) => s + (i.credits || 0), 0),
    qcOk: videos.filter(i => i.status === 'approved').length,
    qcReject: videos.filter(i => i.status === 'rejected').length,
  };
}

function getPeriodStats(mode = 'all') {
  return calcDashboardStatsForItems(getDashboardItems(mode));
}

// Get QC queue (items pending QC)
function getQCQueue() {
  return (Array.isArray(AppData.qcQueue) ? AppData.qcQueue : [])
    .filter((item) => String(item.status || '').trim().toLowerCase() === 'pending')
    .sort((a, b) => Number(a.submittedAt || 0) - Number(b.submittedAt || 0));
}

// Get active sessions count
function getActiveSessions() {
  return AppData.sessions.filter(s => s.status === 'active');
}

// Credit summary
function getCreditSummary() {
  const used = AppData.library.reduce((s, i) => s + (i.credits || 0), 0);
  const editCredits = AppData.images.filter(i => i.edited).reduce((s, i) => s + (i.editCredits || 0), 0);
  const total = used + editCredits;
  const budget = AppData.budget.total;
  return {
    used: total,
    remaining: budget - total,
    budget,
    pct: Math.round((total / budget) * 100),
  };
}

// Get stats per day for month grid (Dashboard)
function getMonthGrid() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const grid = {
    daysInMonth,
    year, month,
    metrics: [
      { label: 'Media xong', color: 'var(--brand)', data: [] },
      { label: 'Video t\u1EA1o \u0111\u01B0\u1EE3c', color: 'var(--green)', data: [] },
      { label: '\u1EA2nh t\u1EA1o \u0111\u01B0\u1EE3c', color: 'var(--blue)', data: [] },
      { label: 'Video \u0111\u00E3 s\u1EED d\u1EE5ng', color: 'var(--purple)', data: [] },
      { label: '\u1EA2nh \u0111\u00E3 s\u1EED d\u1EE5ng', color: 'var(--yellow)', data: [] },
      { label: 'Credit ti\u00EAu th\u1EE5', color: 'var(--red)', data: [] },
    ],
  };

  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayItems = AppData.library.filter(i => i.createdAt && i.createdAt.startsWith(dayStr));
    const dayVids = dayItems.filter(i => i.type === 'video');
    const dayImgs = dayItems.filter(i => i.type === 'image');

    grid.metrics[0].data.push(dayItems.length);
    grid.metrics[1].data.push(dayVids.length);
    grid.metrics[2].data.push(dayImgs.length);
    grid.metrics[3].data.push(dayVids.filter(i => i.status === 'approved').length);
    grid.metrics[4].data.push(dayImgs.filter(i => i.status === 'done' || i.status === 'approved').length);
    grid.metrics[5].data.push(dayItems.reduce((s, i) => s + (i.credits || 0), 0));
  }

  return grid;
}

// Get all staff KPI for HR table
function getAllStaffKPI() {
  return AppData.staff.map(s => ({
    ...s,
    ...getStaffStats(s.id),
  }));
}

function getStaffKPIForItems(items) {
  return AppData.staff.map(s => ({
    ...s,
    ...getStaffStatsFromItems(s.id, items, AppData.images),
  }));
}

function getCodeKPIForItems(items) {
  const map = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const codeTag = String(item.codeTag || '-').trim() || '-';
    if (!map.has(codeTag)) {
      map.set(codeTag, { codeTag, totalMedia: 0, approved: 0, pending: 0, rejected: 0, creditsUsed: 0 });
    }
    const row = map.get(codeTag);
    row.totalMedia += 1;
    if (item.status === 'approved') row.approved += 1;
    if (item.status === 'pending_qc') row.pending += 1;
    if (item.status === 'rejected') row.rejected += 1;
    row.creditsUsed += Number(item.credits || 0);
  });
  return Array.from(map.values()).sort((a, b) => b.totalMedia - a.totalMedia || b.creditsUsed - a.creditsUsed);
}

function filterLibraryItems(filters = {}) {
  const code = String(filters.code || '').trim().toLowerCase();
  const type = String(filters.type || '').trim().toLowerCase();
  const status = String(filters.status || '').trim().toLowerCase();
  const effect = String(filters.effect || '').trim().toLowerCase();
  const viewUserId = getViewUserId();
  return (Array.isArray(AppData.library) ? AppData.library : []).filter((item) => {
    if (viewUserId && !isSameStaffRef(item.staffId, viewUserId)) return false;
    if (code && String(item.codeTag || '').trim().toLowerCase() !== code) return false;
    if (type && String(item.type || item.mediaType || '').trim().toLowerCase() !== type) return false;
    if (status && String(item.status || '').trim().toLowerCase() !== status) return false;
    if (effect && String(item.effectGroup || item.effect_group || '').trim().toLowerCase() !== effect) return false;
    return true;
  });
}

function filterDashboardItems(filters = {}) {
  let items = getDashboardItems(filters.period || 'all');
  const viewUserId = getViewUserId();
  const user = String(filters.user || '').trim().toLowerCase();
  const group = String(filters.group || '').trim().toLowerCase();
  const month = String(filters.month || '').trim();
  if (viewUserId) {
    items = items.filter((item) => isSameStaffRef(item.staffId, viewUserId));
  }
  if (user) {
    items = items.filter((item) => isSameStaffRef(item.staffId, user));
  }
  if (group) {
    items = items.filter((item) => String(item.codeTag || '').trim().toLowerCase() === group);
  }
  if (month) {
    items = items.filter((item) => String(item.createdAt || '').startsWith(month));
  }
  return items;
}

function filterStaffKPI(filters = {}) {
  const query = String(filters.query || '').trim().toLowerCase();
  const role = String(filters.role || '').trim().toLowerCase();
  const status = String(filters.status || '').trim().toLowerCase();
  return getAllStaffKPI().filter((row) => {
    const name = String(row.name || row.username || '').toLowerCase();
    const username = String(row.username || '').toLowerCase();
    if (query && !name.includes(query) && !username.includes(query)) return false;
    if (role && String(row.role || '').toLowerCase() !== role) return false;
    if (status && String(row.status || '').toLowerCase() !== status) return false;
    return true;
  });
}

function filterQCQueue(filters = {}) {
  const staffId = String(filters.staffId || '').trim();
  const date = String(filters.date || '').trim();
  const effect = String(filters.effect || '').trim().toLowerCase();
  const assigned = String(filters.assigned || '').trim();
  const status = String(filters.status || '').trim().toLowerCase();
  const viewUserId = getViewUserId();
  return getQCQueue().filter((item) => {
    if (viewUserId && !isSameStaffRef(item.staffId, viewUserId)) return false;
    if (staffId && !isSameStaffRef(item.staffId, staffId)) return false;
    if (date) {
      const submittedAt = Number(item.submittedAt || 0);
      if (!submittedAt) return false;
      const itemDate = new Date(submittedAt * 1000).toISOString().slice(0, 10);
      if (itemDate !== date) return false;
    }
    if (effect) {
      const effectValue = String(item.effectGroup || '').trim().toLowerCase();
      if (effectValue !== effect) return false;
    }
    if (assigned) {
      if (assigned === '__free__' && String(item.assignedQcUser || '').trim()) return false;
      if (assigned !== '__free__' && String(item.assignedQcUser || '').trim() !== assigned) return false;
    }
    if (status && String(item.status || '').trim().toLowerCase() !== status) return false;
    return true;
  });
}

function getShiftTemplates() {
  const raw = AppData.shiftConfig && typeof AppData.shiftConfig === 'object' ? AppData.shiftConfig : {};
  const fallback = {
    morning: { label: 'Ca s\u00E1ng', start: '08:30', end: '17:00' },
    afternoon: { label: 'Ca chi\u1EC1u', start: '13:00', end: '21:30' },
    evening: { label: 'Ca t\u1ED1i', start: '17:30', end: '01:00' },
  };
  return {
    morning: { ...fallback.morning, ...(raw.morning || {}) },
    afternoon: { ...fallback.afternoon, ...(raw.afternoon || {}) },
    evening: { ...fallback.evening, ...(raw.evening || {}) },
  };
}

function getScopeUsername() {
  const scoped = String(AppData.viewContext?.username || '').trim();
  if (scoped) return scoped;
  return String(AppData.currentUser?.username || '').trim();
}

function getViewProfile() {
  const scopedUsername = String(getScopeUsername() || '').trim();
  const scopedUserId = String(AppData.viewContext?.userId || '').trim();
  const byUsername = (Array.isArray(AppData.staff) ? AppData.staff : []).find((s) => String(s.username || '').trim() === scopedUsername);
  const byId = (Array.isArray(AppData.staff) ? AppData.staff : []).find((s) => String(s.id || '').trim() === scopedUserId);
  const picked = byUsername || byId || AppData.currentUser || {};
  const role = String(picked.role || AppData.currentUser?.role || '').toLowerCase();
  const color = picked.color || (role === 'admin' ? '#D97A2B' : role === 'qc_manager' ? '#4A9EE8' : '#9B6EE0');
  const username = String(picked.username || scopedUsername || AppData.currentUser?.username || '').trim();
  const name = String(picked.name || picked.display_name || picked.displayName || username || '-').trim();
  const avatar = String(picked.avatar || name.charAt(0) || '?').toUpperCase();
  return {
    id: String(picked.id || scopedUserId || AppData.currentUser?.id || '').trim(),
    username,
    name,
    role,
    avatar,
    color,
  };
}

function toStaffRefSet(value) {
  const raw = String(value || '').trim();
  const refs = new Set();
  if (!raw) return refs;
  refs.add(raw);
  const byId = (Array.isArray(AppData.staff) ? AppData.staff : []).find((s) => String(s.id || '').trim() === raw);
  const byUsername = (Array.isArray(AppData.staff) ? AppData.staff : []).find((s) => String(s.username || '').trim() === raw);
  if (byId) {
    refs.add(String(byId.id || '').trim());
    refs.add(String(byId.username || '').trim());
  }
  if (byUsername) {
    refs.add(String(byUsername.id || '').trim());
    refs.add(String(byUsername.username || '').trim());
  }
  return refs;
}

function isSameStaffRef(a, b) {
  const aRefs = toStaffRefSet(a);
  const bRefs = toStaffRefSet(b);
  if (aRefs.size === 0 || bRefs.size === 0) return false;
  for (const value of aRefs) {
    if (bRefs.has(value)) return true;
  }
  return false;
}

function parseShiftDescription(description) {
  if (!description) return null;
  try {
    const parsed = JSON.parse(description);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function getViewUserId() {
  const authRole = String(AppData.authSession?.role || AppData.authUser?.role || AppData.currentUser?.role || '').trim().toLowerCase();
  const mode = String(AppData.viewContext?.mode || '').trim().toLowerCase();
  if (mode === 'impersonate') return getScopeUsername();
  if (authRole === 'staff') return getScopeUsername();
  return '';
}

function isViewingAsAnotherUser() {
  if (String(AppData.viewContext?.mode || '').trim().toLowerCase() === 'impersonate') return true;
  return !!String(AppData.viewingAsUserId || '').trim();
}

// Get code stats
function getCodeStats() {
  return AppData.codes.map(c => {
    const imgs = getImagesByCode(c.tag);
    const libItems = getLibraryByCode(c.tag);
    return {
      ...c,
      imageCount: imgs.length,
      videoCount: libItems.filter(i => i.type === 'video').length,
      totalCredits: libItems.reduce((s, i) => s + (i.credits || 0), 0),
    };
  });
}

// ===============================================================
// ===== ENFORCEMENT SYSTEM \u2013 Role Gates & Metadata Validation ====
// ===============================================================

const PermissionAliasMap = {
  canUpload: ['create_image', 'create_video'],
  canEdit: ['create_image'],
  canCreateTask: ['create_video'],
  canRun: ['create_video'],
  canQC: ['qc_approve', 'qc_reject'],
  canApprove: ['qc_approve', 'qc_reject'],
  canManageStaff: ['manage_users'],
  canViewDashboard: ['view_dashboard'],
  canExport: ['view_billing'],
};

// Check if current user has a permission
function hasPermission(perm) {
  const sourceUser = AppData.currentUser || {};
  const userPerms = Array.isArray(sourceUser.permissions) ? sourceUser.permissions : [];
  if (!perm) return false;
  if (userPerms.includes(perm)) return true;
  const aliases = PermissionAliasMap[perm];
  if (!Array.isArray(aliases) || aliases.length === 0) return false;
  return aliases.some((p) => userPerms.includes(p));
}

// Enforce permission \u2014 returns {ok, message}
function enforcePermission(perm, actionLabel) {
  if (!hasPermission(perm)) {
    const msg = `\u26D4 B\u1EA1n kh\u00F4ng c\u00F3 quy\u1EC1n "${actionLabel}" v\u1EDBi role "${AppData.currentUser.role}". C\u1EA7n role cao h\u01A1n.`;
    showToast(msg, 'error');
    TelegramLog.push({ type:'permission_denied', user:AppData.currentUser.name, role:AppData.currentUser.role, action:actionLabel, time:new Date().toISOString() });
    return { ok:false, message:msg };
  }
  return { ok:true, message:'' };
}

// ---- METADATA VALIDATION (step dependency enforcement) ----

// Validate task before running
function validateTaskBeforeRun(task, comboName) {
  const errors = [];

  // Must have CODE tag
  if (!comboName || comboName.trim() === '') {
    errors.push('Ch\u01B0a \u0111\u1EB7t t\u00EAn CODE cho Task Combo');
  }

  // Must have source image assigned
  if (task.mode === 'i2v' && !task.sourceImgId) {
    errors.push('Ch\u01B0a g\u00E1n \u1EA3nh ngu\u1ED3n (I2V)');
  }
  if (task.mode === 'flf') {
    if (!task.firstFrameId) errors.push('Ch\u01B0a g\u00E1n Khung \u0110\u1EA7u (First Frame)');
    if (!task.lastFrameId) errors.push('Ch\u01B0a g\u00E1n Khung Cu\u1ED1i (Last Frame)');
  }

  // Must have prompt (optional but recommended)
  // if (!task.prompt || task.prompt.trim() === '') {
  //   errors.push('N\u00EAn nh\u1EADp prompt chuy\u1EC3n \u0111\u1ED9ng');
  // }

  // Credit check
  const creditInfo = getCreditSummary();
  if (creditInfo.remaining < task.credits) {
    errors.push(`Kh\u00F4ng \u0111\u1EE7 credit! C\u1EA7n ${task.credits} cr, c\u00F2n ${creditInfo.remaining} cr`);
  }

  return { valid: errors.length === 0, errors };
}

// Validate before sending to QC
function validateBeforeQC(task) {
  const errors = [];
  if (task.status !== 'done') errors.push('Task ch\u01B0a ho\u00E0n t\u1EA5t, kh\u00F4ng th\u1EC3 g\u1EEDi QC');
  if (!task.resultName) errors.push('Ch\u01B0a c\u00F3 file output');
  return { valid: errors.length === 0, errors };
}

// Validate before approving QC (role gate)
function validateBeforeApprove() {
  return enforcePermission('canApprove', 'Ph\u00EA duy\u1EC7t QC');
}

// ===============================================================
// ===== TELEGRAM WORKFLOW SYSTEM ================================
// ===============================================================

// Telegram configuration
const TelegramConfig = {
  botName: '@FaistudioBot',
  adminChatId: '@videotools_admin',
  qcGroupId: '-1001234567890',
  staffGroupId: '-1001234567891',
  enabled: true,
};

// Notification / Telegram log (in-memory)
let TelegramLog = [];

// ---- MESSAGE FORM BUILDERS ----

// Build QC review request message (sent to QC group)
function buildTelegramQCRequest(item) {
  const staff = getStaff(item.staffId);
  const code = AppData.codes.find(c => c.tag === item.codeTag);
  return {
    type: 'qc_request',
    to: TelegramConfig.qcGroupId,
    time: new Date().toISOString(),
    message: [
      `\uD83D\uDD0D *Y\u00CAU C\u1EA6U KI\u1EC2M DUY\u1EC6T*`,
      `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`,
      `\uD83D\uDCC1 File: \`${item.name}\``,
      `\uD83C\uDFF7\uFE0F CODE: ${item.codeTag}${code ? ' \u2014 ' + code.name : ''}`,
      `\uD83D\uDC64 Staff: ${staff.name}`,
      `\uD83D\uDCD0 Model: ${AppData.model.name}`,
      `\uD83C\uDFAC Lo\u1EA1i: ${item.type === 'video' ? 'Video' : '\u1EA2nh'}`,
      `\uD83D\uDCB0 Credit: ${item.credits} cr`,
      `\u23F1\uFE0F Th\u1EDDi gian t\u1EA1o: ${item.executionTime || '-'}`,
      `\uD83D\uDCC5 L\u00FAc: ${new Date(item.createdAt).toLocaleString('vi-VN')}`,
      `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`,
      `\u2B07\uFE0F T\u1EA3i file: [link]`,
      ``,
      `\u2705 /approve_${item.id} \u2014 Duy\u1EC7t`,
      `\u274C /reject_${item.id} [l\u00FD do] \u2014 T\u1EEB ch\u1ED1i`,
    ].join('\n'),
  };
}

// Build QC approval notification (sent to staff)
function buildTelegramQCApproval(item, qcStaff) {
  const staff = getStaff(item.staffId);
  return {
    type: 'qc_approved',
    to: TelegramConfig.staffGroupId,
    time: new Date().toISOString(),
    message: [
      `\u2705 *\u0110\u00C3 DUY\u1EC6T*`,
      `\uD83D\uDCC1 ${item.name}`,
      `\uD83C\uDFF7\uFE0F ${item.codeTag}`,
      `\uD83D\uDC64 Staff: ${staff.name}`,
      `\u2705 QC: ${qcStaff.name}`,
      `\uD83D\uDCC5 ${new Date().toLocaleString('vi-VN')}`,
    ].join('\n'),
  };
}

// Build QC rejection notification
function buildTelegramQCRejection(item, qcStaff, reason) {
  const staff = getStaff(item.staffId);
  return {
    type: 'qc_rejected',
    to: TelegramConfig.staffGroupId,
    time: new Date().toISOString(),
    message: [
      `\u274C *T\u1EEA CH\u1ED0I*`,
      `\uD83D\uDCC1 ${item.name}`,
      `\uD83C\uDFF7\uFE0F ${item.codeTag}`,
      `\uD83D\uDC64 Staff: ${staff.name}`,
      `\u274C QC: ${qcStaff.name}`,
      `\uD83D\uDCAC L\u00FD do: ${reason || 'Kh\u00F4ng \u0111\u1EA1t y\u00EAu c\u1EA7u'}`,
      `\uD83D\uDCC5 ${new Date().toLocaleString('vi-VN')}`,
      ``,
      `\u26A0\uFE0F Vui l\u00F2ng redo task n\u00E0y.`,
    ].join('\n'),
  };
}

// Build shift report message
function buildTelegramShiftReport(staffId) {
  const staff = getStaff(staffId);
  const stats = getStaffStats(staffId);
  const creditInfo = getCreditSummary();
  return {
    type: 'shift_report',
    to: TelegramConfig.adminChatId,
    time: new Date().toISOString(),
    message: [
      `\uD83D\uDCCB *B\u00C1O C\u00C1O CA*`,
      `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`,
      `\uD83D\uDC64 Nh\u00E2n vi\u00EAn: ${staff.name}`,
      `\uD83D\uDCC5 ${new Date().toLocaleString('vi-VN')}`,
      ``,
      `\uD83D\uDCCA *S\u1EA3n l\u01B0\u1EE3ng:*`,
      `   \uD83C\uDFAC Video: ${stats.videoCount}`,
      `   \uD83D\uDDBC\uFE0F \u1EA2nh edit: ${stats.editedCount}`,
      `   \uD83D\uDCE6 T\u1ED5ng media: ${stats.totalMedia}`,
      ``,
      `\u2705 *QC:*`,
      `   \u2713 Approved: ${stats.approved}`,
      `   \u2717 Rejected: ${stats.rejected}`,
      `   \u23F3 Ch\u1EDD: ${stats.pending}`,
      `   \uD83D\uDCC8 Pass rate: ${stats.qcPassRate}%`,
      ``,
      `\uD83D\uDCB0 *Credit:*`,
      `   \u0110\u00E3 d\u00F9ng: ${stats.creditsUsed} cr`,
      `   Budget c\u00F2n: ${creditInfo.remaining} cr (${100 - creditInfo.pct}%)`,
      `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`,
    ].join('\n'),
  };
}

// Build daily summary report
function buildTelegramDailySummary() {
  const stats = getDashboardStats();
  const creditInfo = getCreditSummary();
  const activeSessions = getActiveSessions();
  const qcQueue = getQCQueue();
  const allStaff = getAllStaffKPI();

  // TopStaff by KPI
  const topStaff = allStaff.sort((a, b) => b.kpiScore - a.kpiScore)[0];

  return {
    type: 'daily_summary',
    to: TelegramConfig.adminChatId,
    time: new Date().toISOString(),
    message: [
      `\uD83D\uDCCA *B\u00C1O C\u00C1O NG\u00C0Y \u2014 ${new Date().toLocaleDateString('vi-VN')}*`,
      `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`,
      ``,
      `\uD83D\uDCE6 *S\u1EA3n l\u01B0\u1EE3ng h\u00F4m nay:*`,
      `   Media: ${stats.today.media}`,
      `   Video: ${stats.today.videoCreated} | \u1EA2nh: ${stats.today.imageCreated}`,
      `   QC OK: ${stats.today.qcOk} | Reject: ${stats.today.qcReject}`,
      ``,
      `\uD83D\uDCE6 *Th\u00E1ng n\u00E0y:*`,
      `   Media: ${stats.month.media}`,
      `   Video: ${stats.month.videoCreated} | \u1EA2nh: ${stats.month.imageCreated}`,
      ``,
      `\uD83D\uDCB0 *Credit:*`,
      `   \u0110\u00E3 d\u00F9ng: ${creditInfo.used}/${creditInfo.budget} (${creditInfo.pct}%)`,
      `   C\u00F2n: ${creditInfo.remaining} cr`,
      ``,
      `\uD83D\uDC65 *Team:*`,
      `   Online: ${activeSessions.length}`,
      `   QC ch\u1EDD: ${qcQueue.length}`,
      `   Top: ${topStaff ? topStaff.name + ' (KPI: ' + topStaff.kpiScore + ')' : 'N/A'}`,
      ``,
      `\uD83C\uDFF7\uFE0F *Codes:*`,
      ...AppData.codes.map(c => {
        const s = getCodeStats().find(x => x.tag === c.tag);
        return `   ${c.tag}: ${s ? s.imageCount + ' \u1EA3nh, ' + s.videoCount + ' video, ' + s.totalCredits + ' cr' : '-'}`;
      }),
      `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`,
      `Model: ${AppData.model.name} | ${AppData.fixedResolution} | ${AppData.fixedFPS}fps`,
    ].join('\n'),
  };
}

// Build credit alert
function buildTelegramCreditAlert(pct) {
  const creditInfo = getCreditSummary();
  const level = pct >= 100 ? '\uD83D\uDD34 H\u1EBET BUDGET' : pct >= 90 ? '\uD83D\uDFE0 KH\u1EA8N C\u1EA4P' : '\uD83D\uDFE1 C\u1EA2NH B\u00C1O';
  return {
    type: 'credit_alert',
    to: TelegramConfig.adminChatId,
    time: new Date().toISOString(),
    message: [
      `${level} \u2014 Credit \u0111\u00E3 d\u00F9ng ${pct}%`,
      `\u0110\u00E3 d\u00F9ng: ${creditInfo.used}/${creditInfo.budget} cr`,
      `C\u00F2n: ${creditInfo.remaining} cr`,
      pct >= 100 ? '\u26D4 D\u1EEBng t\u1EA1o video cho \u0111\u1EBFn khi n\u1EA1p credits!' : '',
    ].filter(Boolean).join('\n'),
  };
}

function sendTelegram(msgObj) {
  if (!TelegramConfig.enabled) return;
  if (AppData.seedEnabled === false) return null;
  TelegramLog.push(msgObj);
  console.log(`[TELEGRAM \u2192 ${msgObj.to}]`, msgObj.type, msgObj.message.substring(0, 100) + '...');

  // Show in-app notification
  const typeLabels = {
    qc_request: '\uD83D\uDCE8 QC Request g\u1EEDi cho QC Manager',
    qc_approved: '\u2705 Th\u00F4ng b\u00E1o duy\u1EC7t g\u1EEDi cho Staff',
    qc_rejected: '\u274C Th\u00F4ng b\u00E1o t\u1EEB ch\u1ED1i g\u1EEDi cho Staff',
    shift_report: '\uD83D\uDCCB B\u00E1o c\u00E1o ca g\u1EEDi cho Admin',
    daily_summary: '\uD83D\uDCCA B\u00E1o c\u00E1o ng\u00E0y g\u1EEDi cho Admin',
    credit_alert: '\u26A0\uFE0F C\u1EA3nh b\u00E1o credit g\u1EEDi cho Admin',
    permission_denied: '\u26D4 C\u1EA3nh b\u00E1o quy\u1EC1n',
  };
  if (typeof showToast === 'function') {
    showToast(`\uD83D\uDCF2 Telegram: ${typeLabels[msgObj.type] || msgObj.type}`, 'info');
  }
  return msgObj;
}

// ---- AUTO CHECKS (called after key actions) ----
function checkCreditAlerts() {
  const creditInfo = getCreditSummary();
  AppData.budget.alertThresholds.forEach(th => {
    if (creditInfo.pct >= th) {
      // Only alert once per threshold per session
      const key = `credit_alert_${th}`;
      if (!AppData._alertsSent) AppData._alertsSent = {};
      if (!AppData._alertsSent[key]) {
        AppData._alertsSent[key] = true;
        sendTelegram(buildTelegramCreditAlert(creditInfo.pct));
      }
    }
  });
}

// ---- TELEGRAM LOG VIEWER (for notification panel) ----
function getTelegramLog(limit) {
  return TelegramLog.slice(-(limit || 20)).reverse();
}
