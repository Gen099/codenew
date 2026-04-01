// ---- STATE ----
let currentScreen = 'dashboard';
let currentRole = 'admin';
let notifOpen = false;
let codeCount = 3;
let currentHRTab = 'staff';
let _pendingPollTimer = null;
let _bgPollTimer = null;
let _activeShiftTimer = null;
let _lastRecoverStuckAt = 0;

// Role configs mapped from AppData.staff
function getRoleConfig(role) {
  if (role === 'admin') return { name: AppData.currentUser.name, tag: 'admin', avatar: 'A', color: '#D97A2B' };
  if (role === 'qc_manager') {
    const qm = AppData.staff.find(s => s.role === 'qc_manager');
    return { name: qm ? qm.name : 'QC Manager', tag: 'qc_manager', avatar: qm ? qm.avatar : 'Q', color: '#4A9EE8' };
  }
  const st = AppData.staff.find(s => s.role === 'staff');
  return { name: st ? st.name : 'Staff', tag: 'staff', avatar: st ? st.avatar : 'S', color: '#9B6EE0' };
}

function getAuthRole() {
  return String(AppData.authUser?.role || AppData.currentUser?.role || '').toLowerCase();
}

function canUseRoleSwitcher() {
  return ['admin', 'qc_manager'].includes(getAuthRole());
}

function parseRuntimeDate(value) {
  if (value === null || typeof value === 'undefined' || value === '') return null;
  if (typeof value === 'number') {
    const millis = value < 1000000000000 ? value * 1000 : value;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const raw = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const num = Number(raw);
    const millis = num < 1000000000000 ? num * 1000 : num;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function syncCurrentUserUI() {
  const viewProfile = (typeof getViewProfile === 'function') ? getViewProfile() : (AppData.currentUser || {});
  const roleAvatar = document.getElementById('roleAvatar');
  const roleName = document.getElementById('roleDisplayName');
  const roleTag = document.getElementById('roleTag');
  const headerAvatar = document.getElementById('headerAvatarText');
  if (roleAvatar) {
    roleAvatar.textContent = viewProfile.avatar || '?';
    roleAvatar.style.background = `linear-gradient(135deg, ${viewProfile.color || '#666'}, #9B6EE0)`;
  }
  if (roleName) roleName.textContent = viewProfile.name || viewProfile.username || '-';
  if (roleTag) {
    const tagText = AppData.viewingAsUserId
      ? `${viewProfile.role} • view`
      : String(viewProfile.role || '');
    roleTag.textContent = tagText;
  }
  if (headerAvatar) headerAvatar.textContent = viewProfile.avatar || '?';
}

function resetCreatorRuntimeState() {
  if (typeof taskCombos !== 'undefined') taskCombos = [];
  if (typeof activeComboIdx !== 'undefined') activeComboIdx = 0;
  if (typeof comboCounter !== 'undefined') comboCounter = 0;
  if (typeof libraryOpen !== 'undefined') libraryOpen = true;
  if (typeof batchEditVisible !== 'undefined') batchEditVisible = false;
  if (typeof selectedImageIds !== 'undefined') selectedImageIds = [];
  if (typeof bulkSelectMode !== 'undefined') bulkSelectMode = false;
  if (Array.isArray(AppData.images)) AppData.images.splice(0, AppData.images.length);
  if (Array.isArray(AppData.library)) AppData.library.splice(0, AppData.library.length);
}

// ---- AUTH FLOW ----
function showLoginScreen() {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) { overlay.style.display = 'flex'; overlay.classList.remove('hidden'); }
  document.getElementById('loginForm').style.display = '';
  document.getElementById('loginPending').style.display = 'none';
  document.getElementById('loginError').style.display = 'none';
}

function hideLoginScreen() {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) { overlay.classList.add('hidden'); setTimeout(() => overlay.style.display = 'none', 400); }
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const errEl = document.getElementById('loginError');
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!username || !password) return;
  btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang xử lý...';
  errEl.style.display = 'none';
  try {
    const data = await API.login(username, password);
    if (data.status === 'ok') {
      API.setToken(data.token);
      API.setUser(data.user);
      await onLoginSuccess(data.user);
    } else if (data.status === 'pending') {
      // 2FA flow - show pending section
      document.getElementById('loginForm').style.display = 'none';
      document.getElementById('loginPending').style.display = '';
      startPendingPoll(data.login_id, data.expires_at);
    } else {
      showLoginError(data.message || '\u0110\u0103ng nh\u1eadp th\u1ea5t b\u1ea1i');
    }
  } catch (err) {
    showLoginError(err && err.message ? err.message : '\u0110\u0103ng nh\u1eadp th\u1ea5t b\u1ea1i');
  }
  btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> \u0110\u0103ng nh\u1eadp';
}

function showLoginError(msg) {
  const el = document.getElementById('loginError');
  el.textContent = msg; el.style.display = '';
}

function startPendingPoll(loginId, expiresAt) {
  if (_pendingPollTimer) clearInterval(_pendingPollTimer);
  const timerEl = document.getElementById('pendingTimer');
  _pendingPollTimer = setInterval(async () => {
    const now = Date.now() / 1000;
    const left = Math.max(0, Math.floor(expiresAt - now));
    const m = Math.floor(left / 60); const s = left % 60;
    timerEl.textContent = `Còn lại: ${m}:${String(s).padStart(2, '0')}`;
    if (left <= 0) { cancelPending(); showLoginError('Phiên đăng nhập đã hết hạn (5 phút)'); return; }
    try {
      const data = await API.pollLogin(loginId);
      if (data.status === 'approved') {
        clearInterval(_pendingPollTimer); _pendingPollTimer = null;
        API.setToken(data.token); API.setUser(data.user);
        await onLoginSuccess(data.user);
      } else if (data.status === 'rejected') {
        cancelPending(); showLoginError('Admin đã từ chối đăng nhập');
      } else if (data.status === 'expired') {
        cancelPending(); showLoginError('Phiên đăng nhập đã hết hạn');
      }
    } catch (err) { /* keep polling */ }
  }, 3000);
}

function cancelPending() {
  if (_pendingPollTimer) { clearInterval(_pendingPollTimer); _pendingPollTimer = null; }
  document.getElementById('loginForm').style.display = '';
  document.getElementById('loginPending').style.display = 'none';
}

async function onLoginSuccess(user) {
  // Set current user in AppData
  AppData.currentUser = {
    id: user.id,
    username: user.username,
    name: user.display_name || user.username,
    role: user.role,
    avatar: (user.display_name || user.username).charAt(0).toUpperCase(),
    color: user.role === 'admin' ? '#D97A2B' : user.role === 'qc_manager' ? '#4A9EE8' : '#9B6EE0',
    permissions: user.permissions || [],
  };
  AppData.authUser = { ...AppData.currentUser };
  AppData.viewingAsUserId = '';
  AppData.authSession = {
    userId: String(user.id || ''),
    username: String(user.username || ''),
    role: String(user.role || ''),
    permissions: Array.isArray(user.permissions) ? user.permissions.slice() : [],
  };
  AppData.viewContext = {
    userId: String(user.id || ''),
    username: String(user.username || ''),
    mode: 'self',
  };
  currentRole = user.role;
  syncCurrentUserUI();
  // Load data and init screens
  await loadDataFromAPI();
  initAllScreens();
  if (typeof refreshSidebarCredits === 'function') {
    await refreshSidebarCredits();
  }
  await loadChatHistory();
  await loadNotifications();
  await refreshOnlinePresence();
  applyRoleAccessUI();
  initCharts();
  startBackgroundPolling();
  hideLoginScreen();
}

async function loadDataFromAPI() {
  // Use raw fetch (not API.fetch) to avoid auto-logout on 401/404
  const token = API.getToken();
  const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
  const strictProd = !!(window.AppData && AppData.seedEnabled === false);

  async function safeFetch(path) {
    try {
      const res = await fetch(API.BASE + path, { headers });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  try {
    const scopedUsername = String(getScopeUsername() || '').trim();
    const [users, library, history, systemStatus, shiftConfig, activeWorkTask, currentShiftSummary, workTasks, providerSettings, providerCatalog] = await Promise.all([
      safeFetch('/api/auth/users'),
      safeFetch('/api/library'),
      safeFetch('/api/history?limit=200'),
      safeFetch('/api/system/status'),
      safeFetch('/api/system/shift-config'),
      safeFetch('/api/work-tasks/active' + (scopedUsername ? ('?user_name=' + encodeURIComponent(scopedUsername)) : '')),
      safeFetch('/api/reports/shift-current' + (scopedUsername ? ('?user_name=' + encodeURIComponent(scopedUsername)) : '')),
      safeFetch('/api/work-tasks'),
      safeFetch('/api/providers/settings'),
      safeFetch('/api/providers/catalog'),
    ]);

    const onlineUsers = Array.isArray(systemStatus?.online_staff) ? systemStatus.online_staff : [];
    const onlineMap = new Map(onlineUsers.map((u) => [String(u.username || ''), u]));

    if (Array.isArray(users)) {
      const normalizedUsers = users.map(u => ({
        id: u.id, username: u.username, name: u.display_name || u.username, role: u.role || 'staff',
        avatar: (u.display_name || u.username).charAt(0).toUpperCase(),
        color: u.role === 'admin' ? '#D97A2B' : u.role === 'qc_manager' ? '#4A9EE8' : '#9B6EE0',
        status: onlineMap.has(String(u.username || '')) ? 'online' : (u.active ? 'away' : 'offline'),
        active: !!u.active,
        login2faEnabled: !!u.login_2fa_enabled,
        permissions: Array.isArray(u.permissions) ? u.permissions : [],
        createdAt: u.created_at || '',
      }));
      AppData.staff.splice(0, AppData.staff.length, ...normalizedUsers);
    } else if (strictProd) {
      AppData.staff.splice(0, AppData.staff.length);
    }
    if (Array.isArray(library)) {
      const normalizedLibrary = library.map(normalizeLibraryItem);
      AppData.library.splice(0, AppData.library.length, ...normalizedLibrary);
    } else if (strictProd) {
      AppData.library.splice(0, AppData.library.length);
    }
    if (Array.isArray(history)) {
      AppData.activityHistory.splice(0, AppData.activityHistory.length, ...history);
    } else if (strictProd) {
      AppData.activityHistory.splice(0, AppData.activityHistory.length);
    }
    if (Array.isArray(onlineUsers)) {
      const taskRows = Array.isArray(workTasks) ? workTasks : [];
      const normalizedSessions = onlineUsers.map((row, idx) => ({
        ...(taskRows.find((task) => String(task.user_name || '') === String(row.username || '') && String(task.status || '').toLowerCase() === 'active') || {}),
        id: idx + 1,
        staffId: row.username || '',
        username: row.username || '',
        displayName: row.display_name || row.username || '',
        role: row.role || 'staff',
        activeTasks: Number(row.active_tasks || 0),
        codeTag: row.current_code || '',
        effect: row.current_task || `${Number(row.active_tasks || 0)} task`,
        startTime: row.last_seen || '',
        display_name: row.display_name || row.username || '',
        current_task: row.current_task || '',
        current_code: row.current_code || '',
        current_entries: Array.isArray(row.current_entries) ? row.current_entries : [],
        shift_started_at: Number(row.shift_started_at || 0),
        online_seconds: Number(row.online_seconds || 0),
        last_seen: Number(row.last_seen || 0),
        online_since: Number(row.online_since || 0),
        status: 'active',
      }));
      AppData.sessions.splice(0, AppData.sessions.length, ...normalizedSessions);
    } else if (strictProd) {
      AppData.sessions.splice(0, AppData.sessions.length);
    }
    if (shiftConfig && typeof shiftConfig === 'object' && !Array.isArray(shiftConfig)) {
      AppData.shiftConfig = shiftConfig;
    } else if (strictProd) {
      AppData.shiftConfig = {};
    }
    AppData.providerSettings = {
      default_provider: String(providerSettings?.default_provider || 'provider1').trim().toLowerCase() || 'provider1',
      default_models: (providerSettings && typeof providerSettings.default_models === 'object' && providerSettings.default_models) ? providerSettings.default_models : { provider1: 'kling25_turbo_pro', provider2: 'kling25_turbo' },
      kie_credit_package: String(providerSettings?.kie_credit_package || 'usd50_10000').trim().toLowerCase() || 'usd50_10000',
      provider2_endpoint: String(providerSettings?.provider2_endpoint || 'https://api.piapi.ai/api/v1/task').trim() || 'https://api.piapi.ai/api/v1/task',
    };
    if (providerCatalog && Array.isArray(providerCatalog.providers)) {
      AppData.providerCatalog = providerCatalog;
      const defaultProviderRow = providerCatalog.providers.find((row) => String(row.id || '') === String(AppData.providerSettings.default_provider || 'provider1'));
      const defaultModelId = String(AppData.providerSettings?.default_models?.[AppData.providerSettings.default_provider] || '').trim();
      const defaultModelRow = Array.isArray(defaultProviderRow?.models) ? defaultProviderRow.models.find((row) => String(row.id || '') === defaultModelId) : null;
      if (defaultModelRow) {
        AppData.model = {
          id: String(defaultModelRow.id || ''),
          name: String(defaultModelRow.label || defaultModelRow.id || ''),
          provider: String(defaultProviderRow.id || ''),
          cr5: Number(defaultModelRow.cost_5s || 0),
          cr10: Number(defaultModelRow.cost_10s || 0),
          unit: String(defaultModelRow.unit || ''),
        };
      }
    }
    const taskRows = Array.isArray(workTasks) ? workTasks : [];
    const viewTask = String(AppData.viewingAsUserId || '').trim()
      ? taskRows.find((row) => String(row.status || '').toLowerCase() === 'active' && String(row.user_name || '') === scopedUsername)
      : activeWorkTask;
    if (viewTask && typeof viewTask === 'object' && Object.keys(viewTask).length > 0) {
      const meta = parseShiftDescription(viewTask.description || '') || {};
      AppData.activeShift = {
        id: viewTask.id,
        title: viewTask.title || '',
        createdAt: viewTask.created_at || '',
        shiftKey: meta.shift_key || '',
        shiftLabel: meta.shift_label || viewTask.title || '',
        shiftDate: meta.shift_date || '',
        plannedStart: meta.planned_start || '',
        plannedEnd: meta.planned_end || '',
        notes: meta.notes || '',
      };
      AppData.activeShiftReportSubmitted = false;
    } else if (strictProd) {
      AppData.activeShift = null;
      AppData.activeShiftReportSubmitted = false;
    }
    if (!String(AppData.viewingAsUserId || '').trim() && currentShiftSummary && typeof currentShiftSummary === 'object' && !Array.isArray(currentShiftSummary)) {
      AppData.activeShiftSummary = currentShiftSummary;
    } else if (String(AppData.viewingAsUserId || '').trim() && AppData.activeShift) {
      const viewedTasks = taskRows.filter((row) => String(row.user_name || '') === scopedUsername);
      const activeViewed = viewedTasks.filter((row) => String(row.status || '').toLowerCase() === 'active');
      AppData.activeShiftSummary = {
        work_tasks: activeViewed,
        summary: {
          work_task_count: activeViewed.length,
          total_tasks: activeViewed.reduce((sum, row) => sum + Number(row.video_count || 0), 0),
          total_credits: activeViewed.reduce((sum, row) => sum + Number(row.credits_used || 0), 0),
        },
      };
    } else if (strictProd) {
      AppData.activeShiftSummary = null;
      AppData.activeShiftReportSubmitted = false;
    }
    // In strict production mode, keep non-fetched business collections empty.
    if (strictProd) {
      AppData.images = Array.isArray(AppData.images) ? AppData.images : [];
      AppData.creditLog = Array.isArray(AppData.creditLog) ? AppData.creditLog : [];
      AppData.codes = Array.isArray(AppData.codes) ? AppData.codes : [];
    }
  } catch (err) {
    if (strictProd) {
      AppData.staff.splice(0, AppData.staff.length);
      AppData.library.splice(0, AppData.library.length);
      AppData.images = [];
      AppData.sessions = [];
      AppData.creditLog = [];
      AppData.activityHistory = [];
      AppData.codes = [];
      AppData.activeShift = null;
      AppData.activeShiftSummary = null;
      AppData.activeShiftReportSubmitted = false;
    }
    console.warn('[API] loadDataFromAPI failed:', err.message);
  }
  renderActiveShiftHeader();
}

function normalizeLibraryItem(t) {
  const mediaTypeRaw = String(t.media_type || t.task_type || 'video').toLowerCase();
  const type = mediaTypeRaw.includes('image') ? 'image' : mediaTypeRaw.includes('audio') ? 'audio' : 'video';
  const rawStatus = String(t.status || '').toLowerCase();
  const qcStatus = String(t.qc_status || '').toLowerCase();
  const qcNote = String(t.qc_note || '').trim();
  let status = rawStatus;
  if (rawStatus === 'success' || rawStatus === 'completed') status = 'done';
  if (rawStatus === 'pending') status = 'processing';
  if (qcStatus === 'pending' || qcStatus === 'pending_qc') status = 'pending_qc';
  if (qcStatus === 'approved') status = 'approved';
  if (qcStatus === 'rejected') status = 'rejected';
  const createdAt = t.created_at || t.completed_at || '';
  const fallbackName = t.result_url ? String(t.result_url).split('/').pop() : '';
  const name = t.output_filename || fallbackName || t.task_id || t.id || 'unknown';
  return {
    id: t.task_id || t.id,
    name,
    type,
    status,
    codeTag: t.product_code || '',
    staffId: t.staff_id || t.user_name || '',
    credits: Number(t.credit_used || 0),
    taskId: t.task_id || t.id,
    createdAt,
    resultUrl: t.result_url || '',
    sourceUrl: t.source_url || '',
    qcStatus: qcStatus || null,
    qcNote: qcNote || '',
  };
}

function formatLibraryCredits(value) {
  const credits = Number(value);
  if (!Number.isFinite(credits) || credits <= 0) return '-';
  return Number.isInteger(credits) ? String(credits) : credits.toFixed(2);
}

const UI_MOJIBAKE_FIXES = [
  ['M� H�NH', 'MO HINH'],
  ['Mï¿½ Hï¿½NH', 'MO HINH'],
  ['�', ''],
];

function normalizeMojibakeText(input) {
  let out = String(input ?? '');
  for (const [from, to] of UI_MOJIBAKE_FIXES) {
    if (!from) continue;
    out = out.split(from).join(to);
  }
  return out;
}

function normalizeMojibakeDom(root = document) {
  if (!root || typeof document === 'undefined') return;
  const textRoot = root.nodeType === 1 || root.nodeType === 9 ? root : document;
  const walker = document.createTreeWalker(textRoot, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const parentTag = String(node.parentNode?.tagName || '').toUpperCase();
    if (!['SCRIPT', 'STYLE', 'TEXTAREA'].includes(parentTag)) {
      const fixed = normalizeMojibakeText(node.nodeValue);
      if (fixed !== node.nodeValue) node.nodeValue = fixed;
    }
    node = walker.nextNode();
  }
  const elements = textRoot.querySelectorAll ? textRoot.querySelectorAll('[title],[placeholder],[aria-label]') : [];
  elements.forEach((el) => {
    ['title', 'placeholder', 'aria-label'].forEach((attr) => {
      const raw = el.getAttribute(attr);
      if (raw == null) return;
      const fixed = normalizeMojibakeText(raw);
      if (fixed !== raw) el.setAttribute(attr, fixed);
    });
  });
}

function isStrictStaffShiftLock() {
  return String(AppData.currentUser?.role || '').toLowerCase() === 'staff' && !String(AppData.viewingAsUserId || '').trim();
}

function logout() {
  if (isStrictStaffShiftLock() && AppData.activeShift) {
    showToast('Phải kết thúc ca trước khi đăng xuất', 'error');
    return;
  }
  API.clearToken();
  showLoginScreen();
}

// ---- INIT ----
document.addEventListener('DOMContentLoaded', async () => {
  const token = API.getToken();
  const savedUser = API.getUser();
  if (token && savedUser) {
    try {
      const me = await API.getMe();
      await onLoginSuccess(me);
      return;
    } catch (_) {
      API.clearToken();
    }
  }
  showLoginScreen();
});

window.addEventListener('beforeunload', (event) => {
  if (!isStrictStaffShiftLock() || !AppData.activeShift) return;
  event.preventDefault();
  event.returnValue = '';
});


function initAllScreens() {
  buildDashboard();
  buildCreator(); // defined in creator.js
  buildQC();
  buildHR();
  buildLibrary();
  buildCreditsScreen();
  buildSettings();
  normalizeMojibakeDom(document);
}

const ScreenPermissionMap = {
  dashboard: '',
  creator: 'create_video',
  qc: 'qc_approve',
  hr: 'manage_users',
  library: 'view_library',
  credits: '',
  settings: 'manage_settings',
};

function getScreenBlockReason(screenId) {
  if (screenId === 'creator' && String(AppData.currentUser?.role || '').toLowerCase() === 'staff' && !AppData.activeShift) {
    return 'Phải bắt đầu ca ở Dashboard trước khi vào Creator Workspace';
  }
  const perm = ScreenPermissionMap[screenId];
  if (perm && !(typeof hasPermission === 'function' ? hasPermission(perm) : false)) {
    return 'Bạn chưa có quyền truy cập màn hình này';
  }
  return '';
}

function canAccessScreen(screenId) {
  return !getScreenBlockReason(screenId);
}

function applyRoleAccessUI() {
  const roleModal = document.getElementById('roleModal');
  const headerAvatar = document.querySelector('.header-avatar');
  const canSwitch = canUseRoleSwitcher();
  if (roleModal && !canSwitch) roleModal.style.display = 'none';
  if (headerAvatar) {
    headerAvatar.style.display = canSwitch ? '' : 'none';
    headerAvatar.style.pointerEvents = canSwitch ? '' : 'none';
  }

  document.querySelectorAll('.nav-item').forEach((nav) => {
    const screenId = nav.getAttribute('data-screen');
    const allowed = canAccessScreen(screenId);
    nav.style.display = allowed ? '' : 'none';
    nav.classList.toggle('disabled', !allowed);
    nav.title = getScreenBlockReason(screenId) || '';
  });

  if (!canAccessScreen(currentScreen)) {
    const fallback = ['dashboard', 'library', 'credits', 'creator', 'qc', 'hr', 'settings'].find((screenId) => canAccessScreen(screenId));
    if (fallback) switchScreen(fallback);
  }
}

function renderActiveShiftHeader() {
  const el = document.getElementById('activeShiftHeader');
  if (!el) return;
  if (_activeShiftTimer) {
    clearTimeout(_activeShiftTimer);
    _activeShiftTimer = null;
  }
  if (String(AppData.currentUser?.role || '').toLowerCase() !== 'staff' || !AppData.activeShift) {
    el.innerHTML = '';
    return;
  }
  const startedAt = parseRuntimeDate(AppData.activeShift.createdAt);
  const validStarted = startedAt && !Number.isNaN(startedAt.getTime());
  const elapsedMs = validStarted ? Math.max(0, Date.now() - startedAt.getTime()) : 0;
  const totalMinutes = Math.floor(elapsedMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:8px 14px;border:1px solid rgba(85,190,120,.35);border-radius:10px;background:rgba(45,120,65,.14)">
      <div style="display:flex;align-items:center;gap:12px;min-width:0">
        <span style="font-size:13px;font-weight:800;color:#7CFF9A">CA ĐANG MỞ</span>
        <span style="font-size:13px;color:#EAF7EE;font-weight:700">${AppData.activeShift.shiftLabel || AppData.activeShift.title || 'Ca làm việc'}</span>
        <span style="font-size:12px;color:#9FDBAE">${validStarted ? startedAt.toLocaleString('vi-VN') : '-'}</span>
        <span style="font-size:12px;color:#7CFF9A;font-weight:700">${hours} giờ ${minutes} phút</span>
      </div>
      <button class="btn-danger btn-sm" onclick="finishActiveShiftFlow()"><i class="fa-solid fa-stop"></i> Kết thúc ca</button>
    </div>
  `;
  _activeShiftTimer = setTimeout(renderActiveShiftHeader, 30000);
}

// ---- NAVIGATION ----
function switchScreen(screenId, navEl) {
  const blockReason = getScreenBlockReason(screenId);
  if (blockReason) {
    showToast(blockReason, 'error');
    return;
  }
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById('screen-' + screenId);
  if (target) target.classList.add('active');
  currentScreen = screenId;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navLink = navEl || document.querySelector(`[data-screen="${screenId}"]`);
  if (navLink) navLink.classList.add('active');
  if (target) normalizeMojibakeDom(target);
}

// ---- SIDEBAR ----
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
}

// ---- CODE CHIPS ----
function switchCode(el, idx) {
  document.querySelectorAll('.code-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  showToast(`Switched to: ${el.textContent.trim()}`, 'info');
}

function addNewCode() {
  document.getElementById('codeModal').style.display = 'flex';
  setTimeout(() => document.getElementById('newCodeName').focus(), 100);
}

function createCode() {
  const name = document.getElementById('newCodeName').value.trim() || `Code ${codeCount + 1}`;
  codeCount++;
  const chips = document.getElementById('codeChips');
  const newBtn = document.querySelector('.btn-new-code');
  const chip = document.createElement('div');
  chip.className = 'code-chip';
  chip.setAttribute('data-code', codeCount);
  chip.innerHTML = `<i class="fa-solid fa-folder"></i> ${name}`;
  chip.onclick = function() { switchCode(this, codeCount); };
  chips.insertBefore(chip, newBtn);
  closeModal('codeModal');
  document.getElementById('newCodeName').value = '';
  showToast(`Code "${name}" đã được tạo`, 'success');
}

// ---- ROLES ----
function showRoleSwitcher() {
  if (!canUseRoleSwitcher()) {
    return;
  }
  const modal = document.getElementById('roleModal');
  const title = modal?.querySelector('h2');
  const options = modal?.querySelector('.role-options');
  if (title) title.textContent = 'Chuy\u1ec3n \u0111\u1ed5i t\u00e0i kho\u1ea3n xem';
  if (options) {
    const auth = AppData.authUser || AppData.currentUser;
    const authRole = String(auth.role || '').toLowerCase();
    const switchableUsers = (Array.isArray(AppData.staff) ? AppData.staff : [])
      .filter((s) => {
        const role = String(s.role || '').toLowerCase();
        if (authRole === 'admin') return role === 'staff' || role === 'qc_manager';
        if (authRole === 'qc_manager') return role === 'staff';
        return false;
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const currentViewId = String(AppData.viewingAsUserId || '');
    options.innerHTML =
      `<div class="role-option" onclick="switchViewToOwnAccount()">
        <i class="fa-solid fa-rotate-left"></i>
        <div>
          <strong>${currentViewId ? 'Tr\u1edf v\u1ec1 t\u00e0i kho\u1ea3n g\u1ed1c' : '\u0110ang d\u00f9ng t\u00e0i kho\u1ea3n g\u1ed1c'}</strong>
          <p>${String(auth.name || auth.username || '-')} (${String(auth.role || '-')})</p>
        </div>
      </div>` +
      switchableUsers.map((s) => `
        <div class="role-option" onclick="switchViewAsStaff('${String(s.id).replace(/'/g, "\\'")}')">
          <i class="fa-solid fa-user"></i>
          <div>
            <strong>${String(s.name || s.username || '-')}</strong>
            <p>${String(s.username || '-')} (${String(s.role || '-')}) ${currentViewId === String(s.id) ? '\u2022 \u0111ang xem' : ''}</p>
          </div>
        </div>
      `).join('');
  }
  modal.style.display = 'flex';
}

function setRole(role) {
  if (window.AppData && AppData.seedEnabled === false) {
    showToast('Role được cấp từ backend, không đổi trực tiếp trên UI', 'info');
    return;
  }
  currentRole = role;
  const cfg = getRoleConfig(role);
  // Sync with AppData
  AppData.currentUser.role = role;
  AppData.currentUser.name = cfg.name;
  AppData.currentUser.avatar = cfg.avatar;
  AppData.currentUser.color = cfg.color;

  document.getElementById('roleDisplayName').textContent = cfg.name;
  document.getElementById('roleTag').textContent = cfg.tag;
  document.getElementById('roleAvatar').textContent = cfg.avatar;
  document.getElementById('headerAvatarText').textContent = cfg.avatar;
  document.getElementById('roleAvatar').style.background = `linear-gradient(135deg, ${cfg.color}, #9B6EE0)`;
  closeModal('roleModal');
  showToast(`Switched to role: ${cfg.name}`, 'info');
  // Refresh screens that depend on role
  if (currentScreen === 'dashboard') buildDashboard();
  if (currentScreen === 'qc') buildQC();
}

async function switchViewToOwnAccount() {
  if (!AppData.authUser) return;
  resetCreatorRuntimeState();
  AppData.currentUser = { ...AppData.authUser };
  AppData.viewingAsUserId = '';
  AppData.viewContext = {
    userId: String(AppData.authSession?.userId || AppData.currentUser?.id || ''),
    username: String(AppData.authSession?.username || AppData.currentUser?.username || ''),
    mode: 'self',
  };
  currentRole = AppData.currentUser.role;
  syncCurrentUserUI();
  closeModal('roleModal');
  await loadDataFromAPI();
  applyRoleAccessUI();
  initAllScreens();
  renderActiveShiftHeader();
  if (!canAccessScreen(currentScreen)) {
    const fallback = ['dashboard', 'library', 'credits', 'creator', 'qc', 'hr', 'settings'].find((screenId) => canAccessScreen(screenId));
    if (fallback) switchScreen(fallback);
  }
  showToast('Đã trở về tài khoản gốc', 'success');
}

function clearActiveShiftRuntime() {
  AppData.activeShift = null;
  AppData.activeShiftSummary = null;
  AppData.activeShiftReportSubmitted = false;
  renderActiveShiftHeader();
}

async function switchViewAsStaff(staffId) {
  const staff = (Array.isArray(AppData.staff) ? AppData.staff : []).find((s) => String(s.id) === String(staffId));
  if (!staff) {
    showToast('Không tìm thấy staff', 'error');
    return;
  }
  resetCreatorRuntimeState();
  AppData.currentUser = {
    id: staff.id,
    username: staff.username,
    name: staff.name || staff.username,
    role: staff.role || 'staff',
    avatar: staff.avatar || 'S',
    color: staff.color || '#9B6EE0',
    permissions: Array.isArray(staff.permissions) ? staff.permissions : [],
  };
  AppData.viewingAsUserId = String(staff.id || '');
  AppData.viewContext = {
    userId: String(staff.id || ''),
    username: String(staff.username || ''),
    mode: 'impersonate',
  };
  currentRole = AppData.currentUser.role;
  syncCurrentUserUI();
  closeModal('roleModal');
  await loadDataFromAPI();
  applyRoleAccessUI();
  initAllScreens();
  renderActiveShiftHeader();
  const fallback = ['dashboard', 'library', 'credits', 'creator'].find((screenId) => canAccessScreen(screenId));
  if (fallback) switchScreen(fallback);
  showToast(`Đang xem với tài khoản ${staff.name || staff.username}`, 'info');
}

// ---- TELEGRAM ----
function showTelegramLogin() {
  document.getElementById('telegramModal').style.display = 'flex';
}

function approveTelegram() {
  const status = document.querySelector('.telegram-status');
  status.innerHTML = '<i class="fa-solid fa-check-circle" style="color:var(--green);font-size:18px"></i><span style="color:var(--green)">Đã phê duyệt thành công!</span>';
  setTimeout(() => closeModal('telegramModal'), 1500);
  showToast('\u0110\u0103ng nh\u1eadp th\u00e0nh c\u00f4ng qua Telegram', 'success');
}

// ---- MODALS ----
function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

// ---- NOTIFICATIONS ----
async function loadNotifications() {
  const listEl = document.getElementById('notifList');
  const badgeEl = document.getElementById('notifBadge');
  const header = document.querySelector('#notifPanel .notif-header');
  if (!listEl || !badgeEl) return;
  if (header && !header.querySelector('.notif-mark-all')) {
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '6px';
    actions.style.alignItems = 'center';
    actions.innerHTML =       '<button class="notif-mark-all" onclick="markAllNotificationsRead()" title="Mark all as read"><i class="fa-solid fa-check-double"></i></button>' +
      '<button onclick="toggleNotif()"><i class="fa-solid fa-xmark"></i></button>';
    const oldButtons = header.querySelectorAll('button');
    oldButtons.forEach((btn) => btn.remove());
    const titleEl = header.querySelector('span');
    if (titleEl) titleEl.textContent = 'Thông báo';
    header.appendChild(actions);
  }
  try {
    const items = await API.getNotifications();
    const notifications = Array.isArray(items) ? items : [];
    badgeEl.textContent = String(notifications.filter((n) => !n.read).length);
    if (notifications.length === 0) {
      listEl.innerHTML = '<div class="notif-item"><div class="notif-body"><div class="notif-title">Chưa có thông báo</div></div></div>';
      return;
    }
    listEl.innerHTML = notifications.map((item) => {
      const type = String(item.type || '').toLowerCase();
      const iconClass = type.includes('approve')
        ? 'qc'
        : type.includes('reject') || type.includes('fail')
          ? 'warn'
          : 'info';
      const icon = type.includes('approve')
        ? 'fa-check'
        : type.includes('reject') || type.includes('fail')
          ? 'fa-xmark'
          : 'fa-bell';
      const created = item.created_at || item.createdAt || '';
      return '<div class="notif-item ' + (item.read ? '' : 'unread') + '" data-id="' + item.id + '" onclick="' + (item.read ? '' : 'markNotificationRead(&quot;' + String(item.id).replace(/\"/g, '&quot;') + '&quot;)') + '">' +
          '<div class="notif-icon ' + iconClass + '"><i class="fa-solid ' + icon + '"></i></div>' +
          '<div class="notif-body">' +
            '<div class="notif-title">' + (item.title || 'Thông báo') + '</div>' +
            '<div class="notif-text">' + (item.body || '') + '</div>' +
            '<div class="notif-time">' + created + '</div>' +
          '</div>' +
          (item.read ? '' : '<button class="btn-ghost btn-sm notif-mark-read" onclick="event.stopPropagation();markNotificationRead(&quot;' + String(item.id).replace(/\"/g, '&quot;') + '&quot;)"><i class="fa-solid fa-check"></i></button>') +
        '</div>';
    }).join('');
  } catch (_) {
    badgeEl.textContent = '0';
    listEl.innerHTML = '<div class="notif-item"><div class="notif-body"><div class="notif-title">Không tải được thông báo</div></div></div>';
  }
}

async function markNotificationRead(id) {
  if (!id) return;
  try {
    await API.markNotifRead(id);
    await loadNotifications();
  } catch (_) {}
}

async function markAllNotificationsRead() {
  try {
    await API.markAllNotifRead();
    await loadNotifications();
  } catch (_) {}
}

async function refreshOnlinePresence() {
  const peerEl = document.getElementById('onlinePeerText');
  if (!peerEl) return;
  const token = (typeof API !== 'undefined' && API && typeof API.getToken === 'function') ? String(API.getToken() || '').trim() : '';
  if (!token) {
    peerEl.textContent = 'Online: chưa đăng nhập';
    return;
  }
  try {
    await API.heartbeat({});
    const status = await API.getSystemStatus();
    const onlineUsers = Array.isArray(status?.online_staff) ? status.online_staff : [];
    const currentUsername = String(getScopeUsername() || '').toLowerCase();
    const filtered = onlineUsers.filter((u) => String(u.username || '').toLowerCase() !== currentUsername);
    const onlineStaff = filtered.filter((u) => String(u.role || '') === 'staff');
    const onlineQC = filtered.filter((u) => String(u.role || '') === 'qc_manager');

    if (AppData.currentUser?.role === 'staff') {
      peerEl.textContent = onlineQC.length > 0
        ? `QC online: ${onlineQC.map((u) => u.display_name || u.username).join(', ')}`
        : 'QC online: 0';
      return;
    }
    if (AppData.currentUser?.role === 'qc_manager') {
      peerEl.textContent = onlineStaff.length > 0
        ? `Staff online: ${onlineStaff.map((u) => u.display_name || u.username).join(', ')}`
        : 'Staff online: 0';
      return;
    }
    peerEl.textContent = `Staff: ${onlineStaff.length} | QC: ${onlineQC.length}`;
  } catch (_) {
    peerEl.textContent = 'Online: không tải được';
  }
}

async function toggleNotif() {
  const panel = document.getElementById('notifPanel');
  notifOpen = !notifOpen;
  panel.style.display = notifOpen ? 'block' : 'none';
  if (notifOpen) {
    await loadNotifications();
  }
}

document.addEventListener('click', (e) => {
  const panel = document.getElementById('notifPanel');
  const btn = document.querySelector('.notif-btn');
  if (notifOpen && panel && btn && !panel.contains(e.target) && !btn.contains(e.target)) {
    notifOpen = false;
    panel.style.display = 'none';
  }
});

// ---- QC ACTIONS (with enforcement + Telegram) ----
let selectedQCItemId = null;

function selectQCItem(el, name) {
  document.querySelectorAll('#qcQueue .output-card').forEach(c => {
    c.style.borderColor = '';
    c.style.background = '';
  });
  el.style.borderColor = 'var(--brand)';
  el.style.background = 'var(--brand-dim)';
  const nameEl = document.getElementById('previewName');
  if (nameEl) nameEl.textContent = name;
  // Find item in AppData.library
  selectedQCItemId = AppData.library.find(i => i.name === name && i.status === 'pending_qc')?.id || null;
  showToast(`Preview: ${name}`, 'info');
}

function approveItem() {
  // Role gate: only qc_manager or admin can approve
  const gate = validateBeforeApprove();
  if (!gate.ok) return;

  const name = document.getElementById('previewName')?.textContent;
  const item = selectedQCItemId ? AppData.library.find(i => i.id === selectedQCItemId) : AppData.library.find(i => i.name === name && i.status === 'pending_qc');
  if (!item) { showToast('Không tìm thấy item để duyệt', 'error'); return; }

  item.status = 'approved';
  item.qcById = AppData.currentUser.id;
  item.qcNote = document.getElementById('qcComment')?.value || '';

  // Send Telegram notification
  sendTelegram(buildTelegramQCApproval(item, AppData.currentUser));
  checkCreditAlerts();

  showToast(`Approved: ${item.name}`, 'success');
  buildQC(); // Re-render QC screen
  selectedQCItemId = null;
}

function rejectItem() {
  const gate = validateBeforeApprove();
  if (!gate.ok) return;

  const name = document.getElementById('previewName')?.textContent;
  const comment = document.getElementById('qcComment')?.value || '';
  const item = selectedQCItemId ? AppData.library.find(i => i.id === selectedQCItemId) : AppData.library.find(i => i.name === name && i.status === 'pending_qc');
  if (!item) { showToast('Không tìm thấy item để từ chối', 'error'); return; }

  item.status = 'rejected';
  item.qcById = AppData.currentUser.id;
  item.qcNote = comment || 'Không đạt yêu cầu';

  // Send Telegram notification
  sendTelegram(buildTelegramQCRejection(item, AppData.currentUser, item.qcNote));

  showToast(`Rejected: ${item.name}${comment ? ' - ' + comment : ''}`, 'error');
  buildQC();
  selectedQCItemId = null;
}

function approveAll() {
  const gate = validateBeforeApprove();
  if (!gate.ok) return;

  const queue = getQCQueue();
  if (queue.length === 0) { showToast('Queue trống', 'info'); return; }
  queue.forEach(item => {
    item.status = 'approved';
    item.qcById = AppData.currentUser.id;
    sendTelegram(buildTelegramQCApproval(item, AppData.currentUser));
  });
  checkCreditAlerts();
  showToast(`Đã approve ${queue.length} items!`, 'success');
  buildQC();
}

function sendTelegramReview() {
  const name = document.getElementById('previewName')?.textContent;
  const item = AppData.library.find(i => i.name === name);
  if (item) {
    sendTelegram(buildTelegramQCRequest(item));
  }
  showToast('Đã gửi link review qua Telegram!', 'info');
}

function sendShiftReport() {
  const report = buildTelegramShiftReport(AppData.currentUser.id);
  sendTelegram(report);
  // Record shift
  const stats = getStaffStats(AppData.currentUser.id);
  AppData.shiftReports.push({
    id: AppData.shiftReports.length + 1,
    staffId: AppData.currentUser.id,
    tasks: stats.totalMedia,
    credits: stats.creditsUsed,
    time: new Date().toLocaleString('vi-VN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}),
    note: '',
  });
  showToast('Đã gửi báo cáo ca qua Telegram', 'success');
}

function sendDailyReport() {
  const gate = enforcePermission('canViewDashboard', 'Gửi báo cáo tổng hợp');
  if (!gate.ok) return;
  sendTelegram(buildTelegramDailySummary());
  showToast('Đã gửi báo cáo tổng hợp qua Telegram', 'success');
}

// ---- HR TABS ----
function switchHRTab(tab, el) {
  currentHRTab = tab;
  ['staff', 'kpi', 'budget', 'eval'].forEach(t => {
    const el2 = document.getElementById('hrTab-' + t);
    if (el2) el2.style.display = t === tab ? 'block' : 'none';
  });
  document.getElementById('hrTabBar').querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  if (tab === 'kpi') setTimeout(() => renderKPIChart(), 100);
}

function addStaff() {
  const old = document.getElementById('addStaffModal');
  if (old) old.remove();
  const modal = document.createElement('div');
  modal.id = 'addStaffModal';
  modal.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998" onclick="closeAddStaffModal()"></div>
    <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(92vw,440px);background:var(--bg);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 64px rgba(0,0,0,.35);z-index:9999">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border)">
        <div style="font-size:15px;font-weight:700"><i class="fa-solid fa-user-plus" style="color:var(--brand)"></i> Thêm nhân viên</div>
        <button class="btn-ghost btn-sm" onclick="closeAddStaffModal()"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div>
          <label class="form-label">Username</label>
          <input id="addStaffUsername" class="form-input" type="text" placeholder="nhanvien01">
        </div>
        <div>
          <label class="form-label">Tên hiển thị</label>
          <input id="addStaffDisplayName" class="form-input" type="text" placeholder="Nhân viên 01">
        </div>
        <div>
          <label class="form-label">Mật khẩu</label>
          <input id="addStaffPassword" class="form-input" type="password" placeholder="Nhập mật khẩu">
        </div>
        <div>
          <label class="form-label">Vai trò</label>
          <select id="addStaffRole" class="form-select">
            <option value="staff">staff</option>
            <option value="qc_manager">qc_manager</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <div id="addStaffError" style="display:none;color:var(--red);font-size:12px"></div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;padding:14px 16px;border-top:1px solid var(--border)">
        <button class="btn-secondary" onclick="closeAddStaffModal()">Hủy</button>
        <button class="btn-primary" id="addStaffSubmitBtn" onclick="submitAddStaff()"><i class="fa-solid fa-floppy-disk"></i> Tạo</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function closeAddStaffModal() {
  const modal = document.getElementById('addStaffModal');
  if (modal) modal.remove();
}

async function submitAddStaff() {
  const username = document.getElementById('addStaffUsername')?.value.trim();
  const displayName = document.getElementById('addStaffDisplayName')?.value.trim();
  const password = document.getElementById('addStaffPassword')?.value || '';
  const role = document.getElementById('addStaffRole')?.value || 'staff';
  const errEl = document.getElementById('addStaffError');
  const btn = document.getElementById('addStaffSubmitBtn');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

  if (!username || !password) {
    if (errEl) {
      errEl.textContent = 'Username và mật khẩu là bắt buộc';
      errEl.style.display = 'block';
    }
    return;
  }

  try {
    if (btn) btn.disabled = true;
    await API.registerUser({
      username,
      password,
      display_name: displayName || username,
      role,
    });
    await loadDataFromAPI();
    buildHR();
    showToast(`Đã tạo nhân viên: ${displayName || username}`, 'success');
    closeAddStaffModal();
  } catch (err) {
    if (errEl) {
      errEl.textContent = err && err.message ? err.message : 'Tạo nhân viên thất bại';
      errEl.style.display = 'block';
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function getStaffRecord(staffId) {
  return AppData.staff.find((s) => String(s.id) === String(staffId)) || null;
}

function closeStaffProfileModal() {
  const modal = document.getElementById('staffProfileModal');
  if (modal) modal.remove();
}

function openStaffProfileModal(staffId, editable) {
  const staff = getStaffRecord(staffId);
  if (!staff) {
    showToast('Không tìm thấy nhân viên', 'error');
    return;
  }
  const old = document.getElementById('staffProfileModal');
  if (old) old.remove();
  const disabled = editable ? '' : 'disabled';
  const canDelete = editable
    && Array.isArray(AppData.currentUser?.permissions)
    && AppData.currentUser.permissions.includes('manage_users')
    && String(AppData.currentUser?.id || '') !== String(staff.id || '');
  const modal = document.createElement('div');
  modal.id = 'staffProfileModal';
  modal.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998" onclick="closeStaffProfileModal()"></div>
    <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(92vw,520px);background:var(--bg);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 64px rgba(0,0,0,.35);z-index:9999">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border)">
        <div style="font-size:15px;font-weight:700"><i class="fa-solid fa-id-badge" style="color:var(--brand)"></i> ${editable ? 'Chỉnh sửa hồ sơ' : 'Hồ sơ nhân viên'}</div>
        <button class="btn-ghost btn-sm" onclick="closeStaffProfileModal()"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div style="padding:16px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div style="grid-column:1 / -1">
          <label class="form-label">Username</label>
          <input class="form-input" type="text" value="${staff.username || ''}" disabled>
        </div>
        <div style="grid-column:1 / -1">
          <label class="form-label">Tên hiển thị</label>
          <input id="staffProfileDisplayName" class="form-input" type="text" value="${staff.name || ''}" ${disabled}>
        </div>
        <div>
          <label class="form-label">Vai trò</label>
          <select id="staffProfileRole" class="form-select" ${disabled}>
            <option value="staff" ${staff.role === 'staff' ? 'selected' : ''}>staff</option>
            <option value="qc_manager" ${staff.role === 'qc_manager' ? 'selected' : ''}>qc_manager</option>
            <option value="admin" ${staff.role === 'admin' ? 'selected' : ''}>admin</option>
          </select>
        </div>
        <div>
          <label class="form-label">Trạng thái</label>
          <select id="staffProfileActive" class="form-select" ${disabled}>
            <option value="1" ${staff.active ? 'selected' : ''}>active</option>
            <option value="0" ${!staff.active ? 'selected' : ''}>inactive</option>
          </select>
        </div>
        <div>
          <label class="form-label">2FA Login</label>
          <select id="staffProfile2FA" class="form-select" ${disabled}>
            <option value="1" ${staff.login2faEnabled ? 'selected' : ''}>enabled</option>
            <option value="0" ${!staff.login2faEnabled ? 'selected' : ''}>disabled</option>
          </select>
        </div>
        <div>
          <label class="form-label">Tạo lúc</label>
          <input class="form-input" type="text" value="${staff.createdAt || '-'}" disabled>
        </div>
        ${editable ? `
        <div style="grid-column:1 / -1">
          <label class="form-label">Mật khẩu mới</label>
          <input id="staffProfilePassword" class="form-input" type="password" placeholder="Để trống nếu không đổi">
        </div>` : ''}
        <div id="staffProfileError" style="grid-column:1 / -1;display:none;color:var(--red);font-size:12px"></div>
      </div>
      <div style="display:flex;justify-content:space-between;gap:8px;padding:14px 16px;border-top:1px solid var(--border)">
        <div>${canDelete ? `<button class="btn-danger" id="staffProfileDeleteBtn" onclick="deleteStaff('${staff.id}', true)"><i class="fa-solid fa-trash"></i> Xóa nhân viên</button>` : ''}</div>
        <div style="display:flex;gap:8px">
        <button class="btn-secondary" onclick="closeStaffProfileModal()">Đóng</button>
        ${editable ? `<button class="btn-primary" id="staffProfileSaveBtn" onclick="submitStaffProfile('${staff.id}')"><i class="fa-solid fa-floppy-disk"></i> Lưu</button>` : ''}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function viewStaff(staffId) { openStaffProfileModal(staffId, false); }
function editStaff(staffId) { openStaffProfileModal(staffId, true); }

function editCurrentAdminProfile() {
  if (String(AppData.currentUser?.role || '') !== 'admin') return;
  if (!AppData.currentUser?.id) {
    showToast('Thiếu thông tin admin hiện tại', 'error');
    return;
  }
  openStaffProfileModal(AppData.currentUser.id, true);
}

async function submitStaffProfile(staffId) {
  const staff = getStaffRecord(staffId);
  if (!staff) return;
  const errEl = document.getElementById('staffProfileError');
  const btn = document.getElementById('staffProfileSaveBtn');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  try {
    if (btn) btn.disabled = true;
    await API.updateUser(staffId, {
      display_name: document.getElementById('staffProfileDisplayName')?.value.trim() || staff.name,
      role: document.getElementById('staffProfileRole')?.value || staff.role,
      active: document.getElementById('staffProfileActive')?.value === '1',
      login_2fa_enabled: document.getElementById('staffProfile2FA')?.value === '1',
      password: document.getElementById('staffProfilePassword')?.value || '',
    });
    await loadDataFromAPI();
    buildHR();
    showToast('Đã cập nhật hồ sơ nhân viên', 'success');
    closeStaffProfileModal();
  } catch (err) {
    if (errEl) {
      errEl.textContent = err && err.message ? err.message : 'Cập nhật hồ sơ thất bại';
      errEl.style.display = 'block';
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deleteStaff(staffId, fromModal = false) {
  const staff = getStaffRecord(staffId);
  if (!staff) {
    showToast('Không tìm thấy nhân viên', 'error');
    return;
  }
  if (String(AppData.currentUser?.id || '') === String(staff.id || '')) {
    showToast('Không thể tự xóa tài khoản đang đăng nhập', 'error');
    return;
  }
  const confirmed = window.confirm(`Xóa nhân viên "${staff.name || staff.username}"?\nToàn bộ dữ liệu liên quan của tài khoản này sẽ bị xóa.`);
  if (!confirmed) return;

  const saveBtn = document.getElementById('staffProfileSaveBtn');
  const deleteBtn = document.getElementById('staffProfileDeleteBtn');
  try {
    if (saveBtn) saveBtn.disabled = true;
    if (deleteBtn) deleteBtn.disabled = true;
    await API.deleteUser(staffId);
    await loadDataFromAPI();
    buildHR();
    if (fromModal) closeStaffProfileModal();
    showToast('Đã xóa nhân viên', 'success');
  } catch (err) {
    showToast(err && err.message ? err.message : 'Xóa nhân viên thất bại', 'error');
  } finally {
    if (saveBtn) saveBtn.disabled = false;
    if (deleteBtn) deleteBtn.disabled = false;
  }
}

// ---- LIBRARY ----
function previewMedia(name, id = null) {
  let item = null;
  if (id !== null && id !== undefined) {
    item = AppData.library.find(i => String(i.id) === String(id));
  }
  if (!item) {
    item = AppData.library.find(i => i.name === name);
  }
  if (!item) {
    showToast(`Không tìm thấy media: ${name}`, 'error');
    return;
  }
  if (!item.resultUrl) {
    showToast('Media chưa có result_url để xem', 'warning');
    return;
  }

  const oldModal = document.getElementById('libraryPreviewModal');
  if (oldModal) oldModal.remove();

  const mediaHtml = item.type === 'image'
    ? `<img src="${item.resultUrl}" alt="${item.name}" style="max-width:min(92vw,1200px);max-height:78vh;display:block;border-radius:12px;background:#111">`
    : `<video src="${item.resultUrl}" controls autoplay style="max-width:min(92vw,1200px);max-height:78vh;display:block;border-radius:12px;background:#111"></video>`;

  const modal = document.createElement('div');
  modal.id = 'libraryPreviewModal';
  modal.style.position = 'fixed';
  modal.style.inset = '0';
  modal.style.zIndex = '9999';
  modal.style.background = 'rgba(0,0,0,.76)';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.innerHTML = `
    <div style="position:absolute;inset:0" data-close="1"></div>
    <div style="position:relative;max-width:94vw;max-height:86vh;display:flex;flex-direction:column;gap:10px;align-items:flex-end">
      <button type="button" data-close="1" class="btn-secondary" style="min-width:auto;padding:8px 12px">
        <i class="fa-solid fa-xmark"></i>
      </button>
      <div style="padding:12px;background:var(--bg2);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 64px rgba(0,0,0,.45)">
        ${mediaHtml}
        <div style="margin-top:8px;font-size:12px;color:var(--muted)">${item.name}</div>
      </div>
    </div>
  `;
  modal.addEventListener('click', (ev) => {
    if (ev.target && ev.target.dataset && ev.target.dataset.close === '1') {
      modal.remove();
    }
  });
  document.body.appendChild(modal);
}

// ---- CHAT ----
function extractChatText(result) {
  if (!result || typeof result !== 'object') return '';
  const choices = Array.isArray(result.choices) ? result.choices : [];
  const first = choices[0] || {};
  const message = first.message || {};
  const content = message.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' ? String(part.text || '').trim() : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (typeof content === 'string') return content.trim();
  return String(result.data || '').trim();
}

const AI_CHAT_SESSION_KEY = 'main';
let aiChatMessages = [];

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getChatMessageText(message) {
  if (!message || typeof message !== 'object') return '';
  const content = message.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' ? String(part.text || '').trim() : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return String(content || '').trim();
}

function renderChatHistory() {
  const chatEl = document.getElementById('chatMessages');
  if (!chatEl) return;
  if (!Array.isArray(aiChatMessages) || aiChatMessages.length === 0) {
    chatEl.innerHTML = '<div class="chat-bubble ai">Xin chào. Tôi giúp bạn tạo prompt, phân tích ảnh, tư vấn quy trình.<br><small style="color:var(--muted)">Upload ảnh để tôi phân tích và gợi ý prompt.</small></div>';
    chatEl.scrollTop = chatEl.scrollHeight;
    return;
  }
  chatEl.innerHTML = aiChatMessages.map((message) => {
    const role = String(message.role || '').toLowerCase() === 'user' ? 'user' : 'ai';
    return `<div class="chat-bubble ${role}">${escapeHtml(getChatMessageText(message)).replace(/\n/g, '<br>')}</div>`;
  }).join('');
  chatEl.scrollTop = chatEl.scrollHeight;
}

async function sendChat() {
  const input = document.getElementById('chatInput');
  if (!input) return;
  const msg = input.value.trim();
  if (!msg) return;
  
  const chatEl = document.getElementById('chatMessages');
  if (!chatEl) return;
  aiChatMessages.push({ role: 'user', content: msg });
  renderChatHistory();
  input.value = '';
  input.disabled = true;
  await saveChatHistory();
  const loadingId = `ai-loading-${Date.now()}`;
  chatEl.innerHTML += `<div class="chat-bubble ai" id="${loadingId}"><i class="fa-solid fa-spinner fa-spin"></i> Đang hỏi Gemini 2.5 Flash...</div>`;
  chatEl.scrollTop = chatEl.scrollHeight;

  try {
    const result = await API.chatAgent([
      {
        role: 'user',
        content: [
          { type: 'text', text: msg },
        ],
      },
    ], 'gemini-2.5-flash');
    const resp = extractChatText(result) || 'Không có nội dung trả về từ AI.';
    aiChatMessages.push({ role: 'assistant', content: resp });
    renderChatHistory();
    await saveChatHistory();
  } catch (err) {
    const msgErr = err && err.message ? err.message : 'Gọi AI thất bại';
    const loadingEl = document.getElementById(loadingId);
    if (loadingEl) {
      loadingEl.outerHTML = `<div class="chat-bubble ai"><i class="fa-solid fa-triangle-exclamation" style="color:var(--red)"></i> ${msgErr}</div>`;
    } else {
      chatEl.innerHTML += `<div class="chat-bubble ai"><i class="fa-solid fa-triangle-exclamation" style="color:var(--red)"></i> ${msgErr}</div>`;
    }
  } finally {
    input.disabled = false;
    input.focus();
    chatEl.scrollTop = chatEl.scrollHeight;
  }
}

async function saveChatHistory() {
  try {
    await API.saveChatHistory(AI_CHAT_SESSION_KEY, aiChatMessages, { chat_model: 'gemini-2.5-flash' });
  } catch (_) {}
}

async function loadChatHistory() {
  try {
    const saved = await API.getChatHistory(AI_CHAT_SESSION_KEY);
    aiChatMessages = Array.isArray(saved?.messages) ? saved.messages : [];
  } catch (_) {
    aiChatMessages = [];
  }
  renderChatHistory();
}

async function clearChatHistory() {
  aiChatMessages = [];
  try {
    await API.deleteChatHistory(AI_CHAT_SESSION_KEY);
  } catch (_) {}
  renderChatHistory();
  showToast('Đã xóa lịch sử chat', 'info');
}

// ---- AI CHAT PANEL (FAB bubble) ----
let aiChatOpen = false;
function toggleAIChat() {
  aiChatOpen = !aiChatOpen;
  const panel = document.getElementById('aiChatPanel');
  const fab = document.getElementById('aiFab');
  if (panel) panel.classList.toggle('collapsed', !aiChatOpen);
  if (fab) fab.classList.toggle('hidden', aiChatOpen);
}

// ---- AI IMAGE UPLOAD ----
const aiImageAnalysis = [
  { desc: 'Sản phẩm trên nền trắng, ánh sáng studio', prompt: 'smooth camera orbit, product slowly rotating on white background, 4K cinematic lighting, clean and professional' },
  { desc: 'Sản phẩm mỹ phẩm, tone ấm', prompt: 'gentle zoom in, warm golden lighting, product floating with soft shadows, luxury beauty brand aesthetic, bokeh background' },
  { desc: 'Thiết bị công nghệ, nền tối', prompt: 'slow dolly in, tech product reveal, dark background with subtle blue accent lights, futuristic and sleek, 4K detail' },
  { desc: 'Thực phẩm, setup chụp ảnh', prompt: 'slow pan right, food photography style, natural light streaming in, steam rising, vibrant and appetizing colors' },
  { desc: 'Thời trang, phong cách tối giản', prompt: 'slow zoom out, minimalist fashion photography, clean lines, neutral tones, model-like presentation, editorial style' },
];

function handleAIImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';

  const chatEl = document.getElementById('chatMessages');
  if (!chatEl) return;

  // Read file as thumbnail
  const reader = new FileReader();
  reader.onload = function(e) {
    // Show user message with image thumbnail
    chatEl.innerHTML += `
      <div class="chat-bubble user">
        <div class="ai-chat-img-thumb">
          <img src="${e.target.result}" alt="${file.name}">
        </div>
        <span>Phân tích ảnh: ${file.name}</span>
      </div>`;
    chatEl.scrollTop = chatEl.scrollHeight;

    (async () => {
      try {
        const fd = new FormData();
        fd.append('file', file, file.name);
        const resp = await API.chatAnalyze(fd);
        const summary = String(resp?.summary || resp?.description || resp?.message || '').trim();
        const prompt = String(
          resp?.prompt ||
          resp?.suggested_prompt ||
          resp?.analysis?.prompt ||
          ''
        ).trim();
        chatEl.innerHTML += `
          <div class="chat-bubble ai">
            <div style="font-weight:600;margin-bottom:4px"><i class="fa-solid fa-magnifying-glass-chart" style="color:var(--brand)"></i> Phân tích ảnh</div>
            <div style="font-size:11px;margin-bottom:6px;color:var(--muted)"><strong>${file.name}</strong></div>
            <div style="font-size:11px;margin-bottom:6px"><strong>Nhận diện:</strong> ${summary || 'Không có summary từ API'}</div>
            <div style="font-size:11px;margin-bottom:4px"><strong>Prompt gợi ý:</strong></div>
            <div class="ai-prompt-suggestion" onclick="navigator.clipboard.writeText(this.textContent.trim());showToast('Đã copy prompt','success')">${prompt || 'Không có prompt gợi ý từ API'}</div>
          </div>`;
        aiChatMessages.push({ role: 'user', content: `Phân tích ảnh: ${file.name}` });
        aiChatMessages.push({ role: 'assistant', content: `Nhận diện: ${summary || 'Không có summary từ API'}\nPrompt gợi ý:\n${prompt || 'Không có prompt gợi ý từ API'}` });
      } catch (err) {
        chatEl.innerHTML += `
          <div class="chat-bubble ai">
            <div style="font-weight:600;margin-bottom:4px"><i class="fa-solid fa-triangle-exclamation" style="color:var(--red)"></i> Phân tích ảnh</div>
            <div style="font-size:11px">Lỗi gọi API /api/chat/analyze: ${err && err.message ? err.message : err}</div>
          </div>`;
      }
      chatEl.scrollTop = chatEl.scrollHeight;
      await saveChatHistory();
    })();
  };
  reader.readAsDataURL(file);
}

// ---- AI CHAT TABS & FOLDER BROWSER ----
let aiCurrentFolder = null; // null = root (show folders), string = inside folder

function switchAITab(tab, btn) {
  document.querySelectorAll('.ai-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.ai-tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  if (tab === 'chat') {
    document.getElementById('aiTabChat')?.classList.add('active');
  } else {
    document.getElementById('aiTabFolders')?.classList.add('active');
    renderAIFolderGrid();
  }
}

function renderAIFolderGrid() {
  const grid = document.getElementById('aiFolderGrid');
  if (!grid) return;

  // DEMO_IMAGES is from creator.js
  const DEMO_IMAGES = AppData.images; // Use unified data store
  if (!DEMO_IMAGES || DEMO_IMAGES.length === 0) { grid.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted2);font-size:11px">Chưa có ảnh</div>'; return; }

  if (aiCurrentFolder === null) {
    // Show folders
    const folders = {};
    DEMO_IMAGES.forEach(img => {
      if (!folders[img.folder]) folders[img.folder] = [];
      folders[img.folder].push(img);
    });
    const folderNames = Object.keys(folders);
    if (folderNames.length === 0) { grid.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted2);font-size:11px">Chưa có thư mục</div>'; return; }

    grid.innerHTML = folderNames.map(fname => {
      const count = folders[fname].length;
      const editedCount = folders[fname].filter(i => i.edited).length;
      return `
        <div class="ai-folder-card" ondblclick="aiFolderOpen('${fname.replace(/'/g, "\\'")}')">
          <div class="ai-folder-icon"><i class="fa-solid fa-folder"></i></div>
          <div class="ai-folder-name" title="${fname}">${fname}</div>
          <div class="ai-folder-meta">${count} ảnh${editedCount > 0 ? ' • ' + editedCount + ' edited' : ''}</div>
        </div>`;
    }).join('');
  } else {
    // Show images inside folder
    const imgs = DEMO_IMAGES.filter(i => i.folder === aiCurrentFolder);
    if (imgs.length === 0) { grid.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted2);font-size:11px">Thư mục trống</div>'; return; }

    const colorGrads = [
      'linear-gradient(135deg, rgba(217,122,43,.3), rgba(196,74,58,.2))',
      'linear-gradient(135deg, rgba(111,175,79,.3), rgba(74,158,232,.2))',
      'linear-gradient(135deg, rgba(74,158,232,.3), rgba(142,68,204,.2))',
      'linear-gradient(135deg, rgba(242,212,121,.3), rgba(217,122,43,.2))',
      'linear-gradient(135deg, rgba(196,74,58,.3), rgba(242,212,121,.2))'
    ];
    grid.innerHTML = imgs.map((img, idx) => {
      const grad = colorGrads[idx % colorGrads.length];
      return `
        <div class="ai-img-card ${img.edited ? 'edited' : ''}" ondblclick="aiAnalyzeImage('${img.id}')">
          <div class="ai-img-thumb" style="background:${grad}">
            <i class="fa-solid fa-image"></i>
            ${img.edited ? '<span class="ai-img-edit-dot"></span>' : ''}
          </div>
          <div class="ai-img-name" title="${img.name}">${img.name}</div>
        </div>`;
    }).join('');
  }

  // Update breadcrumb
  const bc = document.getElementById('aiFolderBreadcrumb');
  if (bc) {
    if (aiCurrentFolder === null) {
      bc.innerHTML = '<span class="ai-breadcrumb-item active"><i class="fa-solid fa-home"></i> Tất cả</span>';
    } else {
      bc.innerHTML = `<span class="ai-breadcrumb-item" onclick="aiFolderGoRoot()"><i class="fa-solid fa-home"></i> Tất cả</span>
        <i class="fa-solid fa-chevron-right" style="font-size:8px;color:var(--muted2)"></i>
        <span class="ai-breadcrumb-item active"><i class="fa-solid fa-folder-open" style="color:var(--yellow)"></i> ${aiCurrentFolder}</span>`;
    }
  }
}

function aiFolderOpen(folderName) {
  aiCurrentFolder = folderName;
  renderAIFolderGrid();
}

function aiFolderGoRoot() {
  aiCurrentFolder = null;
  renderAIFolderGrid();
}

function aiAnalyzeImage(imgId) {
  // Switch to chat tab and auto-analyze
  const img = AppData.images.find(i => i.id === imgId);
  if (!img) return;

  // Switch to chat tab
  document.querySelectorAll('.ai-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.ai-tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector('.ai-tab')?.classList.add('active');
  document.getElementById('aiTabChat')?.classList.add('active');

  const chatEl = document.getElementById('chatMessages');
  if (!chatEl) return;

  chatEl.innerHTML += `<div class="chat-bubble user"><i class="fa-solid fa-image" style="color:var(--blue)"></i> Phân tích: ${img.name}</div>`;
  chatEl.scrollTop = chatEl.scrollHeight;

  if (!img._file) {
    chatEl.innerHTML += `
      <div class="chat-bubble ai">
        <div style="font-weight:600;margin-bottom:4px"><i class="fa-solid fa-circle-info" style="color:var(--blue)"></i> Phân tích ảnh</div>
        <div style="font-size:11px">Ảnh này không còn file gốc trong phiên hiện tại, hãy upload lại để gọi API analyze.</div>
      </div>`;
    chatEl.scrollTop = chatEl.scrollHeight;
    return;
  }
  (async () => {
    try {
      const fd = new FormData();
      fd.append('file', img._file, img.name || img._file.name || 'image.png');
      const resp = await API.chatAnalyze(fd);
      const summary = String(resp?.summary || resp?.description || resp?.message || '').trim();
      const prompt = String(
        resp?.prompt ||
        resp?.suggested_prompt ||
        resp?.analysis?.prompt ||
        ''
      ).trim();
      chatEl.innerHTML += `
        <div class="chat-bubble ai">
          <div style="font-weight:600;margin-bottom:4px"><i class="fa-solid fa-magnifying-glass-chart" style="color:var(--brand)"></i> Phân tích: ${img.name}</div>
          <div style="font-size:11px;margin-bottom:6px"><strong>Nhận diện:</strong> ${summary || 'Không có summary từ API'}</div>
          <div style="font-size:11px;margin-bottom:4px"><strong>Prompt gợi ý:</strong></div>
          <div class="ai-prompt-suggestion" onclick="navigator.clipboard.writeText(this.textContent.trim());showToast('Đã copy prompt','success')">${prompt || 'Không có prompt gợi ý từ API'}</div>
        </div>`;
      aiChatMessages.push({ role: 'user', content: `Phân tích: ${img.name}` });
      aiChatMessages.push({ role: 'assistant', content: `Nhận diện: ${summary || 'Không có summary từ API'}\nPrompt gợi ý:\n${prompt || 'Không có prompt gợi ý từ API'}` });
      await saveChatHistory();
    } catch (err) {
      chatEl.innerHTML += `
        <div class="chat-bubble ai">
          <div style="font-weight:600;margin-bottom:4px"><i class="fa-solid fa-triangle-exclamation" style="color:var(--red)"></i> Phân tích ảnh</div>
          <div style="font-size:11px">Lỗi gọi API /api/chat/analyze: ${err && err.message ? err.message : err}</div>
        </div>`;
    }
    chatEl.scrollTop = chatEl.scrollHeight;
  })();
}

// ---- AI FOLDER RENAME ----
function showAIFolderRename() {
  const panel = document.getElementById('aiFolderRenamePanel');
  if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  previewAIFolderRename();
}

function previewAIFolderRename() {
  const rule = document.getElementById('aiFolderRenameRule')?.value || 'keep';
  const customInput = document.getElementById('aiFolderCustomPrefix');
  if (customInput) customInput.style.display = rule === 'custom' ? 'block' : 'none';

  const folders = [...new Set(AppData.images.map(i => i.folder))];
  const combo = (typeof taskCombos !== 'undefined') ? taskCombos[(typeof activeComboIdx !== 'undefined') ? activeComboIdx : 0] : null;
  const codeName = combo ? combo.name : '';
  const customPrefix = customInput?.value || codeName;

  const preview = document.getElementById('aiFolderRenamePreview');
  if (!preview) return;

  preview.innerHTML = folders.map((f, i) => {
    let newName;
    if (rule === 'keep') newName = f;
    else if (rule === 'code') newName = codeName + '_Folder' + (i + 1);
    else newName = customPrefix + '_Folder' + (i + 1);
    return `<span style="color:var(--muted2)">${f}</span> → <span style="color:var(--brand);font-weight:600">${newName}</span>`;
  }).join('<br>');
}

function applyAIFolderRename() {
  const rule = document.getElementById('aiFolderRenameRule')?.value || 'keep';
  if (rule === 'keep') { showToast('Giữ tên gốc - không thay đổi', 'info'); return; }

  const folders = [...new Set(AppData.images.map(i => i.folder))];
  const combo = (typeof taskCombos !== 'undefined') ? taskCombos[(typeof activeComboIdx !== 'undefined') ? activeComboIdx : 0] : null;
  const codeName = combo ? combo.name : '';
  const customPrefix = document.getElementById('aiFolderCustomPrefix')?.value || codeName;

  const renameMap = {};
  folders.forEach((f, i) => {
    if (rule === 'code') renameMap[f] = codeName + '_Folder' + (i + 1);
    else renameMap[f] = customPrefix + '_Folder' + (i + 1);
  });

  AppData.images.forEach(img => {
    if (renameMap[img.folder]) img.folder = renameMap[img.folder];
  });

  document.getElementById('aiFolderRenamePanel').style.display = 'none';
  aiCurrentFolder = null;
  renderAIFolderGrid();
  if (typeof renderSourceImages === 'function') renderSourceImages();
  showToast(`Đã đổi tên ${folders.length} thư mục theo quy tắc ${rule === 'code' ? codeName : customPrefix}`, 'success');
}

// ---- CHARTS ----
let outputChartInstance = null;
let creditChartInstance = null;
let kpiChartInstance = null;

function initCharts() {}

function renderOutputChart() {
  const ctx = document.getElementById('outputChart');
  if (!ctx) return;
  if (outputChartInstance) outputChartInstance.destroy();
  outputChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['T2 19/3','T3 20/3','T4 21/3','T5 22/3','T6 23/3','T7 24/3','CN 25/3'],
      datasets: [
        { label:'Video', data:[38,45,42,51,48,38,22], backgroundColor:'rgba(217,122,43,0.7)', borderColor:'#D97A2B', borderWidth:1, borderRadius:4 },
        { label:'Ảnh', data:[82,95,88,112,98,76,42], backgroundColor:'rgba(74,158,232,0.5)', borderColor:'#4A9EE8', borderWidth:1, borderRadius:4 }
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:true,
      plugins: { legend: { labels: { color:'#98989D', font:{size:11} } } },
      scales: {
        x: { ticks:{color:'#98989D',font:{size:10}}, grid:{color:'rgba(58,58,60,0.5)'} },
        y: { ticks:{color:'#98989D',font:{size:10}}, grid:{color:'rgba(58,58,60,0.5)'} }
      }
    }
  });
}

function renderCreditChart() {
  const ctx = document.getElementById('creditChart');
  if (!ctx) return;
  if (creditChartInstance) creditChartInstance.destroy();
  creditChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Video (Kling)','Image Edit','AI Chat','Khác'],
      datasets: [{ data:[44,24,16,17], backgroundColor:['#D97A2B','#4A9EE8','#9B6EE0','#6FAF4F'], borderColor:'#2C2C2E', borderWidth:3 }]
    },
    options: {
      responsive:true, maintainAspectRatio:true, cutout:'65%',
      plugins: { legend:{display:false}, tooltip:{ callbacks:{ label:(ctx)=>` ${ctx.label}: ${ctx.parsed}%` } } }
    }
  });
}

function renderKPIChart() {
  const ctx = document.getElementById('kpiChart');
  if (!ctx) return;
  if (kpiChartInstance) kpiChartInstance.destroy();
  const staffKPI = (typeof getAllStaffKPI === 'function' ? getAllStaffKPI() : []).filter(Boolean);
  if (staffKPI.length === 0) return;
  const maxVideos = Math.max(...staffKPI.map((s) => Number(s.videoCount || 0)), 0);
  const maxEdits = Math.max(...staffKPI.map((s) => Number(s.editedCount || 0)), 0);
  const scaleCount = (value, max) => max > 0 ? Math.round((Number(value || 0) / max) * 100) : 0;
  kpiChartInstance = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['Video', '\u1ea2nh edit', 'QC Pass', 'KPI'],
      datasets: staffKPI.slice(0, 6).map((s) => ({
        label: s.name,
        data: [
          scaleCount(s.videoCount, maxVideos),
          scaleCount(s.editedCount, maxEdits),
          Number(s.qcPassRate || 0),
          Number(s.kpiScore || 0)
        ],
        borderColor: s.color || '#D97A2B',
        backgroundColor: ((s.color || '#D97A2B') + '1A'),
        pointBackgroundColor: s.color || '#D97A2B'
      }))
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { labels: { color: '#98989D', font: { size: 10 }, boxWidth: 10 } } },
      scales: {
        r: {
          ticks: { color: '#98989D', font: { size: 9 }, stepSize: 20, backdropColor: 'transparent' },
          grid: { color: 'rgba(58,58,60,0.5)' },
          pointLabels: { color: '#98989D', font: { size: 10 } },
          min: 0, max: 100
        }
      }
    }
  });
}

// ---- BACKGROUND POLLING HOOK ----
// ---- BACKGROUND POLLING HOOK ----
function startBackgroundPolling() {
  if (_bgPollTimer) clearInterval(_bgPollTimer);
  _bgPollTimer = setInterval(async () => {
    const token = (typeof API !== 'undefined' && API && typeof API.getToken === 'function') ? String(API.getToken() || '').trim() : '';
    if (!token) return;
    try {
      await refreshOnlinePresence();
    } catch (_) {}
    try {
      // Recover stuck media only when needed to avoid noisy 500 spam and extra load.
      const nowTs = Date.now();
      const hasProcessing = (Array.isArray(AppData.library) ? AppData.library : []).some((item) => String(item.status || '').toLowerCase() === 'processing');
      const isCreatorOpen = currentScreen === 'creator';
      const canRecoverNow = (nowTs - _lastRecoverStuckAt) >= 60000;
      if ((isCreatorOpen || hasProcessing) && canRecoverNow) {
        _lastRecoverStuckAt = nowTs;
        await API.recoverStuckMedia();
      }
    } catch (_) {}
    try {
      const lib = await API.getLibrary();
      if (Array.isArray(lib)) {
        const normalizedLibrary = lib.map(normalizeLibraryItem);
        AppData.library.splice(0, AppData.library.length, ...normalizedLibrary);
        if (typeof window.syncCreatorQCFromLibrary === 'function') {
          window.syncCreatorQCFromLibrary();
        }
        if (currentScreen === 'library') buildLibrary();
        if (currentScreen === 'dashboard') buildDashboard();
        if (currentScreen === 'qc') buildQC();
        if (currentScreen === 'creator' && typeof window.renderLibrary === 'function') {
          window.renderLibrary();
          if (typeof window.renderActiveCombo === 'function') window.renderActiveCombo();
        }
      }
    } catch (_) {}
  }, 15000);
}

// ---- TOAST NOTIFICATIONS ----
function showToast(msg, type = 'info') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText = 'position:fixed;bottom:24px;right:24px;display:flex;flex-direction:column;gap:8px;z-index:9999;';
    document.body.appendChild(container);
  }

  const icons = { success:'fa-check-circle', error:'fa-xmark-circle', info:'fa-info-circle', warning:'fa-triangle-exclamation' };
  const colors = { success:'var(--green)', error:'var(--red)', info:'var(--blue)', warning:'var(--yellow)' };
  
  const toast = document.createElement('div');
  toast.style.cssText = `display:flex;align-items:center;gap:10px;padding:10px 16px;background:var(--card);border:1px solid var(--border);border-left:3px solid ${colors[type]};border-radius:8px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,0.4);min-width:260px;max-width:380px;animation:slideIn 0.25s ease;color:var(--text);`;
  toast.innerHTML = `<i class="fa-solid ${icons[type]}" style="color:${colors[type]};font-size:16px;flex-shrink:0"></i><span>${msg}</span>`;
  
  if (!document.getElementById('toastStyle')) {
    const style = document.createElement('style');
    style.id = 'toastStyle';
    style.textContent = `@keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}@keyframes fadeOut{from{opacity:1}to{opacity:0;transform:translateX(100%)}}`;
    document.head.appendChild(style);
  }
  
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
