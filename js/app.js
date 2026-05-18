// ---- STATE ----
let currentScreen = 'dashboard';
let currentRole = 'admin';
let notifOpen = false;
let codeCount = 3;
let currentHRTab = 'staff';
let _pendingPollTimer = null;
let _registerPendingPollTimer = null;
let _recoverPendingPollTimer = null;
let _registerRetryTimer = null;
let _bgPollTimer = null;
let _smoothProgressTimer = null;
let _activeShiftTimer = null;
let _lastRecoverStuckAt = 0;
let _lastAuthGuardAt = 0;
let _lastSystemStatusSignature = '';
let _lastSessionCollectionSignature = '';
let _postLoginRefreshTimer = null;
const _processingDoneToastIds = new Set();
const APP_VERSION = String(window.__APP_VERSION__ || '').trim() || 'dev';
const FRONTEND_UPDATE_SEEN_KEY = 'frontendUpdateSeenVersion';
const POST_LOGIN_REFRESH_SEEN_KEY = 'postLoginRefreshSeenSignature';
const REGISTER_PENDING_STORAGE_KEY = 'registerPendingRequestId';
const REGISTER_PENDING_CREDENTIALS_KEY = 'registerPendingCredentials';
const RECOVER_PENDING_STORAGE_KEY = 'recoverPendingRequestId';
const RECOVER_PENDING_CREDENTIALS_KEY = 'recoverPendingCredentials';

function markFrontendUpdateSeen(version) {
  const value = String(version || '').trim();
  if (!value) return;
  try { localStorage.setItem(FRONTEND_UPDATE_SEEN_KEY, value); } catch (_) {}
}

function getFrontendUpdateSeen() {
  try { return String(localStorage.getItem(FRONTEND_UPDATE_SEEN_KEY) || '').trim(); } catch (_) { return ''; }
}

function showFrontendUpdatePopup(serverVersion) {
  const targetVersion = String(serverVersion || '').trim();
  if (!targetVersion || targetVersion === APP_VERSION) return;
  if (getFrontendUpdateSeen() === targetVersion) return;
  if (document.getElementById('frontendUpdateOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'frontendUpdateOverlay';
  overlay.innerHTML = `
    <style>
      .frontend-update-overlay{position:fixed;inset:0;background:rgba(0,0,0,.48);display:flex;align-items:center;justify-content:center;z-index:10070;padding:20px}
      .frontend-update-card{width:min(520px,calc(100vw - 32px));background:var(--card);border:1px solid rgba(217,122,43,.45);border-radius:18px;box-shadow:0 18px 64px rgba(0,0,0,.5);overflow:hidden}
      .frontend-update-head{padding:18px 20px;border-bottom:1px solid var(--border);background:rgba(217,122,43,.08)}
      .frontend-update-title{font-size:18px;font-weight:800;color:var(--text)}
      .frontend-update-body{padding:18px 20px;font-size:14px;line-height:1.7;color:var(--text)}
      .frontend-update-meta{padding:0 20px 14px;color:var(--muted);font-size:12px}
      .frontend-update-actions{display:flex;justify-content:flex-end;gap:10px;padding:0 20px 20px}
      .frontend-update-btn{height:40px;padding:0 16px;border-radius:10px;border:1px solid var(--border);background:var(--bg2);color:var(--text);font-size:13px;font-weight:700;cursor:pointer}
      .frontend-update-btn.primary{border-color:rgba(217,122,43,.45);background:rgba(217,122,43,.14);color:var(--brand)}
    </style>
    <div class="frontend-update-overlay">
      <div class="frontend-update-card" role="alertdialog" aria-modal="true" aria-live="assertive">
        <div class="frontend-update-head">
          <div class="frontend-update-title">Có bản cập nhật mới</div>
        </div>
        <div class="frontend-update-body">Hệ thống đã deploy giao diện mới. Trình duyệt này đang chạy bản cũ và cần tải lại để nhận đúng thay đổi.</div>
        <div class="frontend-update-meta">Client: <b>${escapeHtml(APP_VERSION)}</b> | Server: <b>${escapeHtml(targetVersion)}</b></div>
        <div class="frontend-update-actions">
          <button type="button" class="frontend-update-btn" id="frontendUpdateOkBtn">OK</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => {
    markFrontendUpdateSeen(targetVersion);
    const node = document.getElementById('frontendUpdateOverlay');
    if (node) node.remove();
  };
  const okBtn = document.getElementById('frontendUpdateOkBtn');
  if (okBtn) okBtn.addEventListener('click', close);
}

function getPostLoginRefreshNoticeConfig() {
  const systemValue = AppData.systemStatus?.post_login_refresh_notice;
  const directValue = AppData.postLoginRefreshNotice;
  const row = (systemValue && typeof systemValue === 'object')
    ? systemValue
    : ((directValue && typeof directValue === 'object') ? directValue : {});
  return {
    enabled: !!row.enabled,
    title: String(row.title || 'Hệ thống vừa cập nhật sửa lỗi').trim() || 'Hệ thống vừa cập nhật sửa lỗi',
    message: String(row.message || 'Bắt buộc làm mới trình duyệt để nhận bản sửa mới nhất. Hệ thống sẽ tự làm mới sau 10 giây.').trim() || 'Bắt buộc làm mới trình duyệt để nhận bản sửa mới nhất. Hệ thống sẽ tự làm mới sau 10 giây.',
    countdownSeconds: Math.max(3, Math.min(10, Number(row.countdown_seconds || 10) || 10)),
    roles: Array.isArray(row.roles) ? row.roles.map((item) => String(item || '').trim().toLowerCase()).filter((item) => ['admin', 'qc_manager', 'staff'].includes(item)) : ['admin', 'qc_manager', 'staff'],
  };
}

function canCurrentUserSeePostLoginRefreshNotice(notice) {
  const role = String(AppData.currentUser?.role || AppData.authUser?.role || '').trim().toLowerCase();
  const roles = Array.isArray(notice?.roles) ? notice.roles : [];
  if (!role) return false;
  if (!roles.length) return true;
  return roles.includes(role);
}

function getPostLoginRefreshSignature() {
  const notice = getPostLoginRefreshNoticeConfig();
  return JSON.stringify({
    frontendVersion: String(AppData.systemStatus?.frontend_version || APP_VERSION || 'dev'),
    enabled: !!notice.enabled,
    title: notice.title,
    message: notice.message,
    countdownSeconds: notice.countdownSeconds,
  });
}

function getPostLoginRefreshSeenSignature() {
  try { return String(sessionStorage.getItem(POST_LOGIN_REFRESH_SEEN_KEY) || '').trim(); } catch (_) { return ''; }
}

function markPostLoginRefreshSeen(signature) {
  const value = String(signature || '').trim();
  if (!value) return;
  try { sessionStorage.setItem(POST_LOGIN_REFRESH_SEEN_KEY, value); } catch (_) {}
}

function performForcedFrontendRefresh() {
  markPostLoginRefreshSeen(getPostLoginRefreshSignature());
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set('__fr', String(Date.now()));
  nextUrl.searchParams.set('__fv', String(AppData.systemStatus?.frontend_version || APP_VERSION || 'dev'));
  window.location.replace(nextUrl.toString());
}

function showPostLoginRefreshPopup() {
  const notice = getPostLoginRefreshNoticeConfig();
  if (!notice.enabled) return;
  if (!canCurrentUserSeePostLoginRefreshNotice(notice)) return;
  const signature = getPostLoginRefreshSignature();
  if (getPostLoginRefreshSeenSignature() === signature) return;
  markPostLoginRefreshSeen(signature);
  if (_postLoginRefreshTimer) {
    clearInterval(_postLoginRefreshTimer);
    _postLoginRefreshTimer = null;
  }
  const existing = document.getElementById('postLoginRefreshOverlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'postLoginRefreshOverlay';
  overlay.innerHTML = `
    <style>
      .post-login-refresh-overlay{position:fixed;inset:0;background:rgba(0,0,0,.58);display:flex;align-items:center;justify-content:center;z-index:10080;padding:20px}
      .post-login-refresh-card{width:min(560px,calc(100vw - 32px));background:var(--card);border:1px solid rgba(217,122,43,.45);border-radius:18px;box-shadow:0 18px 64px rgba(0,0,0,.5);overflow:hidden}
      .post-login-refresh-head{padding:18px 20px;border-bottom:1px solid var(--border);background:rgba(217,122,43,.08)}
      .post-login-refresh-title{font-size:18px;font-weight:800;color:var(--text)}
      .post-login-refresh-body{padding:18px 20px 8px;font-size:14px;line-height:1.7;color:var(--text)}
      .post-login-refresh-meta{padding:0 20px 14px;color:var(--muted);font-size:12px}
    </style>
    <div class="post-login-refresh-overlay">
      <div class="post-login-refresh-card" role="alertdialog" aria-modal="true" aria-live="assertive">
        <div class="post-login-refresh-head">
          <div class="post-login-refresh-title">${escapeHtml(notice.title)}</div>
        </div>
        <div class="post-login-refresh-body">${escapeHtml(notice.message)}</div>
        <div class="post-login-refresh-meta" id="postLoginRefreshCountdown">Tự động làm mới sau ${notice.countdownSeconds}s</div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const countdownEl = document.getElementById('postLoginRefreshCountdown');
  let remaining = notice.countdownSeconds;
  _postLoginRefreshTimer = setInterval(() => {
    remaining -= 1;
    if (countdownEl) countdownEl.textContent = remaining > 0 ? `Tự động làm mới sau ${remaining}s` : 'Đang làm mới...';
    if (remaining <= 0) {
      clearInterval(_postLoginRefreshTimer);
      _postLoginRefreshTimer = null;
      markPostLoginRefreshSeen(signature);
      performForcedFrontendRefresh();
    }
  }, 1000);
}

function handleFrontendVersionMismatch(systemStatus) {
  const serverVersion = String(systemStatus?.frontend_version || '').trim();
  if (!serverVersion || serverVersion === APP_VERSION) return;
  showFrontendUpdatePopup(serverVersion);
}

function _clearRegisterRetryCountdown() {
  if (_registerRetryTimer) {
    clearInterval(_registerRetryTimer);
    _registerRetryTimer = null;
  }
}

function _setRegisterButtonState(disabled, secondsLeft = 0) {
  const btn = document.getElementById('registerBtn');
  if (!btn) return;
  btn.disabled = !!disabled;
  if (disabled && Number(secondsLeft || 0) > 0) {
    btn.innerHTML = `<i class="fa-solid fa-clock"></i> Thử lại sau ${Math.max(0, Math.ceil(Number(secondsLeft) || 0))}s`;
    return;
  }
  btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Gửi yêu cầu đăng ký';
}

function _startRegisterRetryCountdown(seconds) {
  let remaining = Math.max(0, Math.ceil(Number(seconds || 0)));
  _clearRegisterRetryCountdown();
  _setRegisterButtonState(true, remaining);
  if (remaining <= 0) {
    _setRegisterButtonState(false, 0);
    return;
  }
  _registerRetryTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      _clearRegisterRetryCountdown();
      _setRegisterButtonState(false, 0);
      return;
    }
    _setRegisterButtonState(true, remaining);
  }, 1000);
}

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
  return getAuthRole() === 'admin';
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

function getSystemStatusSignature(status) {
  const data = status && typeof status === 'object' ? status : {};
  const onlineUsers = Array.isArray(data.online_staff) ? data.online_staff : [];
  return JSON.stringify({
    online_count: Number(data.online_count || onlineUsers.length || 0),
    pending_video: Number(data.pending_video || 0),
    pending_image: Number(data.pending_image || 0),
    announcements: Array.isArray(data.announcements) ? data.announcements.map((row) => String(row || '')) : [],
    shift_popup_templates: data.shift_popup_templates && typeof data.shift_popup_templates === 'object' ? data.shift_popup_templates : {},
    post_login_refresh_notice: data.post_login_refresh_notice && typeof data.post_login_refresh_notice === 'object' ? data.post_login_refresh_notice : {},
    online_staff: onlineUsers.map((row) => ({
      username: String(row?.username || '').trim(),
      display_name: String(row?.display_name || '').trim(),
      role: String(row?.role || '').trim(),
      active_tasks: Number(row?.active_tasks || 0),
      current_code: String(row?.current_code || '').trim(),
      current_task: String(row?.current_task || '').trim(),
      last_seen: Number(row?.last_seen || 0),
      online_since: Number(row?.online_since || 0),
      shift_started_at: Number(row?.shift_started_at || 0),
      online_seconds: Number(row?.online_seconds || 0),
    })),
  });
}

function getSessionCollectionSignature(rows) {
  const items = Array.isArray(rows) ? rows : [];
  return JSON.stringify(items.map((row) => ({
    username: String(row?.username || '').trim(),
    role: String(row?.role || '').trim(),
    activeTasks: Number(row?.activeTasks || 0),
    codeTag: String(row?.codeTag || '').trim(),
    effect: String(row?.effect || '').trim(),
    last_seen: Number(row?.last_seen || 0),
    online_since: Number(row?.online_since || 0),
    online_seconds: Number(row?.online_seconds || 0),
    device_name: String(row?.client_meta?.device_name || '').trim(),
    ip: String(row?.client_meta?.ip || '').trim(),
  })));
}

function normalizeOnlineSessions(onlineUsers = []) {
  return (Array.isArray(onlineUsers) ? onlineUsers : []).map((row, idx) => ({
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
    client_meta: (row.client_meta && typeof row.client_meta === 'object') ? { ...row.client_meta } : {},
    status: 'active',
  }));
}

function applySystemStatusSnapshot(status) {
  const nextStatus = status && typeof status === 'object' ? status : {};
  const nextSignature = getSystemStatusSignature(nextStatus);
  const systemChanged = nextSignature !== _lastSystemStatusSignature;
  if (systemChanged) {
    AppData.systemStatus = {
      online_staff: Array.isArray(nextStatus.online_staff) ? nextStatus.online_staff : [],
      online_count: Number(nextStatus.online_count || 0),
      pending_video: Number(nextStatus.pending_video || 0),
      pending_image: Number(nextStatus.pending_image || 0),
      announcements: Array.isArray(nextStatus.announcements) ? nextStatus.announcements.slice() : [],
      shift_popup_templates: (nextStatus.shift_popup_templates && typeof nextStatus.shift_popup_templates === 'object') ? { ...nextStatus.shift_popup_templates } : {},
      post_login_refresh_notice: (nextStatus.post_login_refresh_notice && typeof nextStatus.post_login_refresh_notice === 'object') ? { ...nextStatus.post_login_refresh_notice } : {},
    };
    AppData.shiftPopupTemplates = (nextStatus.shift_popup_templates && typeof nextStatus.shift_popup_templates === 'object') ? { ...nextStatus.shift_popup_templates } : {};
    AppData.postLoginRefreshNotice = (nextStatus.post_login_refresh_notice && typeof nextStatus.post_login_refresh_notice === 'object') ? { ...nextStatus.post_login_refresh_notice } : {};
    _lastSystemStatusSignature = nextSignature;
  }
  const normalizedSessions = normalizeOnlineSessions(nextStatus.online_staff || []);
  const nextSessionSignature = getSessionCollectionSignature(normalizedSessions);
  const sessionsChanged = nextSessionSignature !== _lastSessionCollectionSignature;
  if (sessionsChanged) {
    AppData.sessions.splice(0, AppData.sessions.length, ...normalizedSessions);
    _lastSessionCollectionSignature = nextSessionSignature;
  }
  return { systemChanged, sessionsChanged, onlineUsers: Array.isArray(nextStatus.online_staff) ? nextStatus.online_staff : [] };
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
  if (typeof creatorPresenceTimer !== 'undefined' && creatorPresenceTimer) {
    clearTimeout(creatorPresenceTimer);
    creatorPresenceTimer = 0;
  }
  if (typeof creatorRealtimePollTimer !== 'undefined' && creatorRealtimePollTimer) {
    clearInterval(creatorRealtimePollTimer);
    creatorRealtimePollTimer = 0;
  }
  if (typeof creatorDraftSaveTimer !== 'undefined' && creatorDraftSaveTimer) {
    clearTimeout(creatorDraftSaveTimer);
    creatorDraftSaveTimer = 0;
  }
  if (typeof recalcAllCostsTimer !== 'undefined' && recalcAllCostsTimer) {
    clearTimeout(recalcAllCostsTimer);
    recalcAllCostsTimer = 0;
  }
  if (typeof taskCombos !== 'undefined') taskCombos = [];
  if (typeof activeComboIdx !== 'undefined') activeComboIdx = 0;
  if (typeof comboCounter !== 'undefined') comboCounter = 0;
  if (typeof libraryOpen !== 'undefined') libraryOpen = true;
  if (typeof batchEditVisible !== 'undefined') batchEditVisible = false;
  if (typeof selectedImageIds !== 'undefined') selectedImageIds = [];
  if (typeof bulkSelectMode !== 'undefined') bulkSelectMode = false;
  if (typeof creatorBatchPollInFlight !== 'undefined') creatorBatchPollInFlight = false;
  if (typeof creatorLastLibraryRenderSignature !== 'undefined') creatorLastLibraryRenderSignature = '';
  if (Array.isArray(AppData.images)) AppData.images.splice(0, AppData.images.length);
  if (Array.isArray(AppData.library)) AppData.library.splice(0, AppData.library.length);
}

// ---- AUTH FLOW ----
function switchAuthTab(tab) {
  const mode = String(tab || 'login').trim().toLowerCase() === 'register' ? 'register' : 'login';
  const loginForm = document.getElementById('loginForm');
  const recoverForm = document.getElementById('recoverForm');
  const recoverPending = document.getElementById('recoverPending');
  const registerForm = document.getElementById('registerForm');
  const loginPending = document.getElementById('loginPending');
  const registerPending = document.getElementById('registerPending');
  const loginError = document.getElementById('loginError');
  const recoverError = document.getElementById('recoverError');
  const registerError = document.getElementById('registerError');
  const tabLogin = document.getElementById('authTabLogin');
  const tabRegister = document.getElementById('authTabRegister');
  if (_registerPendingPollTimer) { clearInterval(_registerPendingPollTimer); _registerPendingPollTimer = null; }
  if (_recoverPendingPollTimer) { clearInterval(_recoverPendingPollTimer); _recoverPendingPollTimer = null; }
  _clearRegisterRetryCountdown();
  if (loginPending) loginPending.style.display = 'none';
  if (recoverPending) recoverPending.style.display = 'none';
  if (registerPending) registerPending.style.display = 'none';
  if (loginError) loginError.style.display = 'none';
  if (recoverError) recoverError.style.display = 'none';
  if (registerError) registerError.style.display = 'none';
  if (loginForm) loginForm.style.display = mode === 'login' ? '' : 'none';
  if (recoverForm) recoverForm.style.display = 'none';
  if (registerForm) registerForm.style.display = mode === 'register' ? '' : 'none';
  if (tabLogin) tabLogin.style.opacity = mode === 'login' ? '1' : '.7';
  if (tabRegister) tabRegister.style.opacity = mode === 'register' ? '1' : '.7';
  _setRegisterButtonState(false, 0);
}

function showLoginScreen() {
  document.body.classList.remove('app-booting');
  const overlay = document.getElementById('loginOverlay');
  if (overlay) { overlay.style.display = 'flex'; overlay.classList.remove('hidden'); }
  switchAuthTab('login');
}

function showAuthBootScreen() {
  const overlay = document.getElementById('loginOverlay');
  const loginForm = document.getElementById('loginForm');
  const recoverForm = document.getElementById('recoverForm');
  const registerForm = document.getElementById('registerForm');
  const registerPending = document.getElementById('registerPending');
  const loginPending = document.getElementById('loginPending');
  const pendingText = document.querySelector('#loginPending .pending-text');
  const pendingTimer = document.getElementById('pendingTimer');
  const tabLogin = document.getElementById('authTabLogin');
  const tabRegister = document.getElementById('authTabRegister');
  const loginError = document.getElementById('loginError');
  const recoverError = document.getElementById('recoverError');
  const registerError = document.getElementById('registerError');
  if (overlay) { overlay.style.display = 'flex'; overlay.classList.remove('hidden'); }
  if (loginForm) loginForm.style.display = 'none';
  if (recoverForm) recoverForm.style.display = 'none';
  if (registerForm) registerForm.style.display = 'none';
  if (registerPending) registerPending.style.display = 'none';
  if (loginPending) loginPending.style.display = '';
  if (pendingText) pendingText.textContent = 'Đang khôi phục phiên đăng nhập...';
  if (pendingTimer) pendingTimer.textContent = 'Vui lòng chờ';
  if (loginError) loginError.style.display = 'none';
  if (recoverError) recoverError.style.display = 'none';
  if (registerError) registerError.style.display = 'none';
  if (tabLogin) tabLogin.style.opacity = '.7';
  if (tabRegister) tabRegister.style.opacity = '.7';
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

function showRegisterError(msg) {
  const el = document.getElementById('registerError');
  if (!el) return;
  el.textContent = msg;
  el.style.display = '';
}

function showRecoverError(msg) {
  const el = document.getElementById('recoverError');
  if (!el) return;
  el.textContent = msg;
  el.style.display = '';
}

function showRecoverForm() {
  const loginForm = document.getElementById('loginForm');
  const recoverForm = document.getElementById('recoverForm');
  const recoverPending = document.getElementById('recoverPending');
  const loginError = document.getElementById('loginError');
  const recoverError = document.getElementById('recoverError');
  if (loginError) loginError.style.display = 'none';
  if (recoverError) recoverError.style.display = 'none';
  if (recoverPending) recoverPending.style.display = 'none';
  if (loginForm) loginForm.style.display = 'none';
  if (recoverForm) recoverForm.style.display = '';
}
window.showRecoverForm = showRecoverForm;

function hideRecoverForm() {
  const loginForm = document.getElementById('loginForm');
  const recoverForm = document.getElementById('recoverForm');
  const recoverPending = document.getElementById('recoverPending');
  const recoverError = document.getElementById('recoverError');
  if (recoverError) recoverError.style.display = 'none';
  if (recoverForm) recoverForm.style.display = 'none';
  if (recoverPending) recoverPending.style.display = 'none';
  if (loginForm) loginForm.style.display = '';
}
window.hideRecoverForm = hideRecoverForm;

function _setRegisterPendingRequestId(requestId) {
  const value = String(requestId || '').trim();
  try {
    if (value) localStorage.setItem(REGISTER_PENDING_STORAGE_KEY, value);
    else localStorage.removeItem(REGISTER_PENDING_STORAGE_KEY);
  } catch (_) {}
}

function _getRegisterPendingRequestId() {
  try {
    return String(localStorage.getItem(REGISTER_PENDING_STORAGE_KEY) || '').trim();
  } catch (_) {
    return '';
  }
}

function _clearRegisterPendingState() {
  if (_registerPendingPollTimer) {
    clearInterval(_registerPendingPollTimer);
    _registerPendingPollTimer = null;
  }
  _setRegisterPendingRequestId('');
}

function _setRegisterPendingCredentials(data) {
  try {
    const payload = {
      username: String(data?.username || '').trim(),
      password: String(data?.password || ''),
    };
    if (!payload.username || !payload.password) {
      sessionStorage.removeItem(REGISTER_PENDING_CREDENTIALS_KEY);
      return;
    }
    sessionStorage.setItem(REGISTER_PENDING_CREDENTIALS_KEY, JSON.stringify(payload));
  } catch (_) {}
}

function _getRegisterPendingCredentials() {
  try {
    const raw = sessionStorage.getItem(REGISTER_PENDING_CREDENTIALS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      username: String(parsed?.username || '').trim(),
      password: String(parsed?.password || ''),
    };
  } catch (_) {
    return null;
  }
}

function _clearRegisterPendingCredentials() {
  try {
    sessionStorage.removeItem(REGISTER_PENDING_CREDENTIALS_KEY);
  } catch (_) {}
}

function _setRecoverPendingRequestId(requestId) {
  const value = String(requestId || '').trim();
  try {
    if (value) localStorage.setItem(RECOVER_PENDING_STORAGE_KEY, value);
    else localStorage.removeItem(RECOVER_PENDING_STORAGE_KEY);
  } catch (_) {}
}

function _getRecoverPendingRequestId() {
  try {
    return String(localStorage.getItem(RECOVER_PENDING_STORAGE_KEY) || '').trim();
  } catch (_) {
    return '';
  }
}

function _clearRecoverPendingState() {
  if (_recoverPendingPollTimer) {
    clearInterval(_recoverPendingPollTimer);
    _recoverPendingPollTimer = null;
  }
  _setRecoverPendingRequestId('');
}

function _setRecoverPendingCredentials(data) {
  try {
    const payload = {
      username: String(data?.username || '').trim(),
      password: String(data?.password || ''),
      employeeCode: String(data?.employeeCode || '').trim(),
    };
    if (!payload.username || !payload.password || !payload.employeeCode) {
      sessionStorage.removeItem(RECOVER_PENDING_CREDENTIALS_KEY);
      return;
    }
    sessionStorage.setItem(RECOVER_PENDING_CREDENTIALS_KEY, JSON.stringify(payload));
  } catch (_) {}
}

function _getRecoverPendingCredentials() {
  try {
    const raw = sessionStorage.getItem(RECOVER_PENDING_CREDENTIALS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      username: String(parsed?.username || '').trim(),
      password: String(parsed?.password || ''),
      employeeCode: String(parsed?.employeeCode || '').trim(),
    };
  } catch (_) {
    return null;
  }
}

function _clearRecoverPendingCredentials() {
  try {
    sessionStorage.removeItem(RECOVER_PENDING_CREDENTIALS_KEY);
  } catch (_) {}
}

function _fillRecoveredLoginCredentials() {
  const creds = _getRecoverPendingCredentials();
  if (!creds || !creds.username || !creds.password) return;
  const loginUsername = document.getElementById('loginUsername');
  const loginPassword = document.getElementById('loginPassword');
  if (loginUsername) loginUsername.value = creds.username;
  if (loginPassword) loginPassword.value = creds.password;
}

function _showRecoverPendingMessage(message) {
  const recoverPending = document.getElementById('recoverPending');
  const recoverPendingText = document.getElementById('recoverPendingText');
  const recoverForm = document.getElementById('recoverForm');
  const loginForm = document.getElementById('loginForm');
  const recoverError = document.getElementById('recoverError');
  const loginError = document.getElementById('loginError');
  if (recoverPendingText) recoverPendingText.textContent = message;
  if (recoverError) recoverError.style.display = 'none';
  if (loginError) loginError.style.display = 'none';
  if (loginForm) loginForm.style.display = 'none';
  if (recoverForm) recoverForm.style.display = 'none';
  if (recoverPending) recoverPending.style.display = '';
}

function _formatSecondsLeft(seconds) {
  const safe = Math.max(0, Number(seconds || 0));
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function _fillApprovedLoginCredentials() {
  const creds = _getRegisterPendingCredentials();
  if (!creds || !creds.username || !creds.password) return;
  const loginUsername = document.getElementById('loginUsername');
  const loginPassword = document.getElementById('loginPassword');
  if (loginUsername) loginUsername.value = creds.username;
  if (loginPassword) loginPassword.value = creds.password;
}

function _showRegisterPendingMessage(message) {
  const pendingText = document.getElementById('registerPendingText');
  if (pendingText) pendingText.textContent = message;
  const registerForm = document.getElementById('registerForm');
  const registerPending = document.getElementById('registerPending');
  const registerError = document.getElementById('registerError');
  if (registerError) registerError.style.display = 'none';
  if (registerForm) registerForm.style.display = 'none';
  if (registerPending) registerPending.style.display = '';
}

async function pollRegisterRequestStatus(requestId, options = {}) {
  const reqId = String(requestId || '').trim();
  if (!reqId) return;
  const silent = !!options.silent;
  try {
    const data = await API.getRegistrationRequestStatus(reqId);
    const status = String(data?.status || 'pending').trim().toLowerCase();
    if (status === 'approved') {
      _clearRegisterPendingState();
      switchAuthTab('login');
      _fillApprovedLoginCredentials();
      showLoginError(`Chào mừng ${String(data?.display_name || data?.username || '').trim() || 'bạn'}. Tài khoản đã được duyệt, có thể đăng nhập.`);
      return;
    }
    if (status === 'rejected') {
      _clearRegisterPendingState();
      switchAuthTab('register');
      const reason = String(data?.reject_reason || '').trim();
      const reviewer = String(data?.reviewer || '').trim();
      let msg = 'Yêu cầu đăng ký đã bị từ chối.';
      if (reason) msg += ` Lý do: ${reason}`;
      if (reviewer) msg += ` Reviewer: ${reviewer}`;
      showRegisterError(msg);
      _startRegisterRetryCountdown(5);
      return;
    }
    _showRegisterPendingMessage(`Chờ Admin phê duyệt qua Telegram. Mã yêu cầu: ${reqId}`);
  } catch (err) {
    if (!silent) {
      _showRegisterPendingMessage(`Chờ Admin phê duyệt qua Telegram. Mã yêu cầu: ${reqId}`);
    }
  }
}

function startRegisterPendingPoll(requestId) {
  const reqId = String(requestId || '').trim();
  if (!reqId) return;
  _clearRegisterPendingState();
  _setRegisterPendingRequestId(reqId);
  _showRegisterPendingMessage(`Chờ Admin phê duyệt qua Telegram. Mã yêu cầu: ${reqId}`);
  pollRegisterRequestStatus(reqId, { silent: true }).catch(() => {});
  _registerPendingPollTimer = setInterval(() => {
    pollRegisterRequestStatus(reqId, { silent: true }).catch(() => {});
  }, 3000);
}

async function pollRecoverRequestStatus(requestId, options = {}) {
  const reqId = String(requestId || '').trim();
  if (!reqId) return;
  const silent = !!options.silent;
  try {
    const data = await API.getPasswordResetRequestStatus(reqId);
    const status = String(data?.status || 'pending').trim().toLowerCase();
    if (status === 'approved') {
      _clearRecoverPendingState();
      switchAuthTab('login');
      _fillRecoveredLoginCredentials();
      _clearRecoverPendingCredentials();
      showLoginError(`Yêu cầu reset của ${String(data?.display_name || data?.username || '').trim() || 'bạn'} đã được duyệt. Thông tin đăng nhập mới đã được điền sẵn.`);
      return;
    }
    if (status === 'rejected') {
      _clearRecoverPendingState();
      showRecoverForm();
      const reason = String(data?.reject_reason || '').trim();
      const reviewer = String(data?.reviewer || '').trim();
      let msg = 'Yêu cầu reset mật khẩu đã bị từ chối.';
      if (reason) msg += ` Lý do: ${reason}`;
      if (reviewer) msg += ` Reviewer: ${reviewer}`;
      showRecoverError(msg);
      return;
    }
    if (status === 'expired') {
      _clearRecoverPendingState();
      _clearRecoverPendingCredentials();
      showRecoverForm();
      showRecoverError('Yêu cầu reset mật khẩu đã hết hạn. Hãy gửi yêu cầu mới.');
      return;
    }
    const secondsLeft = Math.max(0, Number(data?.seconds_left || 0));
    _showRecoverPendingMessage(`Chờ Admin phê duyệt reset qua Telegram. Mã yêu cầu: ${reqId}. Còn lại: ${_formatSecondsLeft(secondsLeft)}`);
  } catch (err) {
    if (!silent) {
      _showRecoverPendingMessage(`Chờ Admin phê duyệt reset qua Telegram. Mã yêu cầu: ${reqId}`);
    }
  }
}

function startRecoverPendingPoll(requestId) {
  const reqId = String(requestId || '').trim();
  if (!reqId) return;
  _clearRecoverPendingState();
  _setRecoverPendingRequestId(reqId);
  _showRecoverPendingMessage(`Chờ Admin phê duyệt reset qua Telegram. Mã yêu cầu: ${reqId}`);
  pollRecoverRequestStatus(reqId, { silent: true }).catch(() => {});
  _recoverPendingPollTimer = setInterval(() => {
    pollRecoverRequestStatus(reqId, { silent: true }).catch(() => {});
  }, 3000);
}

function resetClientAuthState() {
  try {
    if (_pendingPollTimer) { clearInterval(_pendingPollTimer); _pendingPollTimer = null; }
  } catch (_) {}
  try {
    if (_bgPollTimer) { clearInterval(_bgPollTimer); _bgPollTimer = null; }
  } catch (_) {}
  try {
    if (_smoothProgressTimer) { clearInterval(_smoothProgressTimer); _smoothProgressTimer = null; }
  } catch (_) {}
  try {
    if (_activeShiftTimer) { clearTimeout(_activeShiftTimer); _activeShiftTimer = null; }
  } catch (_) {}
  _clearRegisterPendingState();
  _clearRecoverPendingState();
  _clearRegisterPendingCredentials();
  _clearRecoverPendingCredentials();
  try { API.clearToken(); } catch (_) {}
  resetCreatorRuntimeState();
  AppData.authUser = null;
  AppData.viewingAsUserId = '';
  AppData.authSession = { userId: '', username: '', role: '', permissions: [] };
  AppData.viewContext = { userId: '', username: '', mode: 'self' };
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
  switchAuthTab('login');
}

async function handleRegisterRequest(e) {
  e.preventDefault();
  const btn = document.getElementById('registerBtn');
  const username = document.getElementById('registerUsername')?.value.trim();
  const displayName = document.getElementById('registerDisplayName')?.value.trim();
  const password = document.getElementById('registerPassword')?.value || '';
  const employeeCode = document.getElementById('registerEmployeeCode')?.value.trim() || '';
  const role = document.getElementById('registerRole')?.value || 'staff';
  const errEl = document.getElementById('registerError');
  if (errEl) errEl.style.display = 'none';
  if (!username || !password) {
    showRegisterError('Username và mật khẩu là bắt buộc');
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang gửi...';
  }
  try {
    const data = await API.requestRegistration({
      username,
      password,
      display_name: displayName || username,
      role,
      employee_code: employeeCode,
    });
    _setRegisterPendingCredentials({ username, password });
    startRegisterPendingPoll(String(data?.request_id || '').trim());
  } catch (err) {
    const retryAfter = Number(err?.payload?.detail?.retry_after_seconds || err?.payload?.retry_after_seconds || 0);
    showRegisterError(err && err.message ? err.message : 'Gửi yêu cầu đăng ký thất bại');
    if (retryAfter > 0) _startRegisterRetryCountdown(retryAfter);
  } finally {
    if (!_registerRetryTimer) _setRegisterButtonState(false, 0);
  }
}

async function handleRecoverByEmployeeCode(e) {
  e.preventDefault();
  const btn = document.getElementById('recoverBtn');
  const username = document.getElementById('recoverUsername')?.value.trim() || '';
  const employeeCode = document.getElementById('recoverEmployeeCode')?.value.trim() || '';
  const password = document.getElementById('recoverPassword')?.value || '';
  const confirmPassword = document.getElementById('recoverPasswordConfirm')?.value || '';
  const errEl = document.getElementById('recoverError');
  if (errEl) errEl.style.display = 'none';
  if (!username || !employeeCode || !password || !confirmPassword) {
    showRecoverError('Tài khoản, mã nhân viên, mật khẩu mới và xác nhận mật khẩu là bắt buộc');
    return;
  }
  if (password !== confirmPassword) {
    showRecoverError('Xác nhận mật khẩu mới không khớp');
    return;
  }
  if (password.length < 8) {
    showRecoverError('Mật khẩu mới phải từ 8 ký tự');
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang gửi yêu cầu...';
  }
  try {
    const data = await API.recoverByEmployeeCode({
      username,
      employee_code: employeeCode,
      password,
    });
    _setRecoverPendingCredentials({ username, password, employeeCode });
    startRecoverPendingPoll(String(data?.request_id || '').trim());
  } catch (err) {
    showRecoverError(err && err.message ? err.message : 'Khôi phục thông tin đăng nhập thất bại');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-key"></i> Gửi yêu cầu reset';
    }
  }
}

function restoreRegisterPendingState() {
  const requestId = _getRegisterPendingRequestId();
  if (!requestId) return;
  switchAuthTab('register');
  startRegisterPendingPoll(requestId);
}

function restoreRecoverPendingState() {
  const requestId = _getRecoverPendingRequestId();
  if (!requestId) return;
  startRecoverPendingPoll(requestId);
}

async function onLoginSuccess(user) {
  _clearRegisterPendingState();
  _clearRecoverPendingState();
  _clearRegisterPendingCredentials();
  _clearRecoverPendingCredentials();
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
  if (window.AppMonitor && typeof window.AppMonitor.setContext === 'function') {
    window.AppMonitor.setContext({
      currentUser: String(user.username || ''),
      currentRole: String(user.role || ''),
      currentScreen: String(currentScreen || 'dashboard'),
    });
    if (typeof window.AppMonitor.addEvent === 'function') window.AppMonitor.addEvent('login', `${String(user.username || '')}:${String(user.role || '')}`, 'info');
  }
  syncCurrentUserUI();
  // Load data and init screens. A screen init failure must not block login.
  await loadDataFromAPI();
  initAllScreens();
  try {
    if (typeof refreshSidebarCredits === 'function') {
      await refreshSidebarCredits();
    }
  } catch (err) {
    console.warn('[login] refreshSidebarCredits failed:', err && err.message ? err.message : err);
  }
  try {
    await loadNotifications();
  } catch (err) {
    console.warn('[login] loadNotifications failed:', err && err.message ? err.message : err);
  }
  try {
    await refreshOnlinePresence();
  } catch (err) {
    console.warn('[login] refreshOnlinePresence failed:', err && err.message ? err.message : err);
  }
  try {
    applyRoleAccessUI();
  } catch (err) {
    console.warn('[login] applyRoleAccessUI failed:', err && err.message ? err.message : err);
  }
  try {
    initCharts();
  } catch (err) {
    console.warn('[login] initCharts failed:', err && err.message ? err.message : err);
  }
  try {
    startBackgroundPolling();
  } catch (err) {
    console.warn('[login] startBackgroundPolling failed:', err && err.message ? err.message : err);
  }
  document.body.classList.remove('app-booting');
  hideLoginScreen();
  showPostLoginRefreshPopup();
}

let _lastSyncHealthToastSignature = '';

async function loadDataFromAPI() {
  // Use raw fetch (not API.fetch) to avoid auto-logout on 401/404
  const token = API.getToken();
  const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
  const strictProd = !!(window.AppData && AppData.seedEnabled === false);

  async function safeFetch(path) {
    try {
      const res = await fetch(API.BASE + path, { headers });
      const contentType = String(res.headers.get('content-type') || '').toLowerCase();
      let payload = null;
      try {
        payload = contentType.includes('application/json') ? await res.json() : await res.text();
      } catch (_) {
        payload = null;
      }
      if (!res.ok) {
        const detail = payload && typeof payload === 'object'
          ? String(payload.detail || payload.message || payload.error || '').trim()
          : String(payload || '').trim();
        return { ok: false, path, status: res.status, data: null, error: detail || `HTTP ${res.status}` };
      }
      return { ok: true, path, status: res.status, data: payload, error: '' };
    } catch (err) {
      return { ok: false, path, status: 0, data: null, error: String(err?.message || 'Network error').trim() || 'Network error' };
    }
  }

  try {
    const scopedUsername = String(getScopeUsername() || '').trim();
    const role = String(AppData.authUser?.role || AppData.currentUser?.role || '').trim().toLowerCase();
    const permissionSet = new Set(
      [
        ...(Array.isArray(AppData.authUser?.permissions) ? AppData.authUser.permissions : []),
        ...(Array.isArray(AppData.currentUser?.permissions) ? AppData.currentUser.permissions : []),
      ].map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
    );
    const optionalSyncKeys = new Set();
    const canManageUsers = role === 'admin' || role === 'qc_manager' || permissionSet.has('manage_users');
    const canViewDashboard = role === 'admin' || role === 'qc_manager' || permissionSet.has('view_dashboard');
    const canAccessQcQueue = role === 'admin' || permissionSet.has('qc_approve') || permissionSet.has('qc_reject');
    if (!canManageUsers) optionalSyncKeys.add('users');
    if (!canViewDashboard) optionalSyncKeys.add('shiftReports');
    if (!canAccessQcQueue) optionalSyncKeys.add('qcQueue');
    const [usersRes, libraryRes, historyRes, systemStatusRes, shiftConfigRes, activeWorkTaskRes, currentShiftSummaryRes, workTasksRes, providerSettingsRes, providerCatalogRes, shiftReportsRes, qcQueueRes] = await Promise.all([
      safeFetch('/api/auth/users'),
      safeFetch('/api/library'),
      safeFetch('/api/history?limit=5000'),
      safeFetch('/api/system/status'),
      safeFetch('/api/system/shift-config'),
      safeFetch('/api/work-tasks/active' + (scopedUsername ? ('?user_name=' + encodeURIComponent(scopedUsername)) : '')),
      safeFetch('/api/reports/shift-current' + (scopedUsername ? ('?user_name=' + encodeURIComponent(scopedUsername)) : '')),
      safeFetch('/api/work-tasks?limit=5000'),
      safeFetch('/api/providers/settings'),
      safeFetch('/api/providers/catalog'),
      safeFetch('/api/reports/shifts'),
      safeFetch('/api/qc/queue'),
    ]);

    const fetchMap = {
      users: usersRes,
      library: libraryRes,
      history: historyRes,
      system: systemStatusRes,
      shiftConfig: shiftConfigRes,
      activeWorkTask: activeWorkTaskRes,
      currentShiftSummary: currentShiftSummaryRes,
      workTasks: workTasksRes,
      providerSettings: providerSettingsRes,
      providerCatalog: providerCatalogRes,
      shiftReports: shiftReportsRes,
      qcQueue: qcQueueRes,
    };
    const syncErrors = Object.entries(fetchMap)
      .filter(([key, row]) => !row?.ok && !optionalSyncKeys.has(String(key || '').trim()))
      .map(([key, row]) => ({
        key,
        path: String(row?.path || '').trim(),
        status: Number(row?.status || 0) || 0,
        error: String(row?.error || '').trim(),
      }));
    AppData.syncHealth = {
      fetchedAt: new Date().toISOString(),
      hasErrors: syncErrors.length > 0,
      stale: Object.fromEntries(Object.entries(fetchMap).map(([key, row]) => [key, !row?.ok && !optionalSyncKeys.has(String(key || '').trim())])),
      errors: syncErrors,
    };
    const users = usersRes?.data;
    const library = libraryRes?.data;
    const history = historyRes?.data;
    const systemStatus = systemStatusRes?.data;
    const shiftConfig = shiftConfigRes?.data;
    const activeWorkTask = activeWorkTaskRes?.data;
    const currentShiftSummary = currentShiftSummaryRes?.data;
    const workTasks = workTasksRes?.data;
    const providerSettings = providerSettingsRes?.data;
    const providerCatalog = providerCatalogRes?.data;
    const shiftReports = shiftReportsRes?.data;
    const qcQueue = qcQueueRes?.data;

    handleFrontendVersionMismatch(systemStatus);

    const onlineUsers = Array.isArray(systemStatus?.online_staff) ? systemStatus.online_staff : [];
    const onlineMap = new Map(onlineUsers.map((u) => [String(u.username || ''), u]));

    if (Array.isArray(users)) {
      const normalizedUsers = users.map(u => ({
        id: u.id, username: u.username, name: u.display_name || u.username, role: u.role || 'staff',
        employeeCode: String(u.employee_code || '').trim(),
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
      const existingByTaskId = new Map((Array.isArray(AppData.library) ? AppData.library : []).map((item) => [String(item?.taskId || item?.id || '').trim(), item]));
      const normalizedLibrary = library.map(normalizeLibraryItem).filter(shouldKeepLibraryItem);
      normalizedLibrary.forEach((item) => {
        const key = String(item?.taskId || item?.id || '').trim();
        item.codeTag = getStableLibraryCodeTag(item, existingByTaskId.get(key));
      });
      AppData.library.splice(0, AppData.library.length, ...normalizedLibrary);
    } else if (strictProd) {
      AppData.library.splice(0, AppData.library.length);
    }
    if (Array.isArray(qcQueue)) {
      setQCQueueData(qcQueue);
    } else if (strictProd) {
      AppData.qcQueue.splice(0, AppData.qcQueue.length);
    }
    if (Array.isArray(history)) {
      AppData.activityHistory.splice(0, AppData.activityHistory.length, ...history);
    }
    if (Array.isArray(shiftReports)) {
      const normalizedShiftReports = shiftReports.map((row) => ({
        ...row,
        staffId: String(row.user_id || '').trim(),
        userName: String(row.user_name || '').trim(),
        userDisplay: String(row.user_display || '').trim(),
        submittedAt: row.submitted_at || row.submittedAt || '',
        totalTasks: Number(row.total_tasks || 0),
        totalCredits: Number(row.total_credits || 0),
        notes: String(row.notes || '').trim(),
      }));
      AppData.shiftReports.splice(0, AppData.shiftReports.length, ...normalizedShiftReports);
    } else if (strictProd) {
      AppData.shiftReports.splice(0, AppData.shiftReports.length);
    }
    if (Array.isArray(onlineUsers)) {
      applySystemStatusSnapshot({
        online_staff: onlineUsers,
        online_count: Number(systemStatus?.online_count || onlineUsers.length || 0),
        pending_video: Number(systemStatus?.pending_video || 0),
        pending_image: Number(systemStatus?.pending_image || 0),
        announcements: Array.isArray(systemStatus?.announcements) ? systemStatus.announcements : [],
      });
    } else if (strictProd) {
      AppData.sessions.splice(0, AppData.sessions.length);
    }
    if (shiftConfig && typeof shiftConfig === 'object' && !Array.isArray(shiftConfig)) {
      AppData.shiftConfig = shiftConfig;
    } else if (strictProd) {
      AppData.shiftConfig = {};
    }
    AppData.providerSettings = {
      default_provider: 'provider1',
      default_models: {
        provider1: String(providerSettings?.default_models?.provider1 || 'kling25_turbo_pro').trim() || 'kling25_turbo_pro',
      },
      kie_credit_package: String(providerSettings?.kie_credit_package || 'usd50_10000').trim().toLowerCase() || 'usd50_10000',
    };
    if (providerCatalog && Array.isArray(providerCatalog.providers)) {
      AppData.providerCatalog = {
        ...providerCatalog,
        default_provider: 'provider1',
        providers: providerCatalog.providers.filter((row) => String(row?.id || '').trim().toLowerCase() === 'provider1'),
      };
      const defaultProviderRow = AppData.providerCatalog.providers.find((row) => String(row.id || '') === 'provider1');
      const defaultModelId = String(AppData.providerSettings?.default_models?.provider1 || '').trim();
      const defaultModelRow = Array.isArray(defaultProviderRow?.models) ? defaultProviderRow.models.find((row) => String(row.id || '') === defaultModelId) : null;
      if (defaultModelRow) {
        AppData.model = {
          id: String(defaultModelRow.id || ''),
          name: String(defaultModelRow.label || defaultModelRow.id || ''),
          provider: 'provider1',
          cr5: Number(defaultModelRow.cost_5s || 0),
          cr10: Number(defaultModelRow.cost_10s || 0),
          unit: String(defaultModelRow.unit || ''),
        };
      }
    }
    const taskRows = Array.isArray(workTasks) ? workTasks : [];
    AppData.workTasks = taskRows.slice();
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
      AppData.workTasks = Array.isArray(AppData.workTasks) ? AppData.workTasks : [];
    }
    if (syncErrors.length && typeof showToast === 'function') {
      const summary = syncErrors.map((row) => row.key).join('|');
      if (summary !== _lastSyncHealthToastSignature) {
        _lastSyncHealthToastSignature = summary;
        showToast(`Đồng bộ chưa đầy đủ: ${syncErrors.map((row) => row.key).join(', ')}`, 'warning');
      }
    } else {
      _lastSyncHealthToastSignature = '';
    }
  } catch (err) {
    if (strictProd) {
      AppData.staff.splice(0, AppData.staff.length);
      AppData.library.splice(0, AppData.library.length);
      AppData.qcQueue.splice(0, AppData.qcQueue.length);
      AppData.images = [];
      AppData.sessions = [];
      AppData.creditLog = [];
      AppData.activityHistory = [];
      AppData.codes = [];
      AppData.workTasks = [];
      AppData.activeShift = null;
      AppData.activeShiftSummary = null;
      AppData.activeShiftReportSubmitted = false;
    }
    AppData.syncHealth = {
      fetchedAt: new Date().toISOString(),
      hasErrors: true,
      stale: {
        users: true,
        library: true,
        history: true,
        system: true,
        shiftConfig: true,
        activeWorkTask: true,
        currentShiftSummary: true,
        workTasks: true,
        providerSettings: true,
        providerCatalog: true,
        shiftReports: true,
        qcQueue: true,
      },
      errors: [{ key: 'loadDataFromAPI', path: 'bundle', status: 0, error: String(err?.message || '').trim() }],
    };
    console.warn('[API] loadDataFromAPI failed:', err.message);
  }
  renderSyncHealthStatus();
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
  if (rawStatus === 'pending' || rawStatus === 'running' || rawStatus === 'queued') status = 'processing';
  if (qcStatus === 'pending' || qcStatus === 'pending_qc') status = 'pending_qc';
  if (qcStatus === 'approved') status = 'approved';
  if (qcStatus === 'rejected') status = 'rejected';
  const createdAt = t.created_at || t.completed_at || '';
  const completedAt = t.completed_at || '';
  const bestResultUrl = String(t.local_result_url || t.result_url || '').trim();
  const bestCoverUrl = String(t.local_cover_url || t.cover_url || '').trim();
  const bestSourceUrl = String(t.local_source_url || t.source_url || '').trim();
  const bestEndSourceUrl = String(t.local_end_source_url || t.end_source_url || '').trim();
  const fallbackName = bestResultUrl ? String(bestResultUrl).split('/').pop() : '';
  const name = t.output_filename || fallbackName || t.task_id || t.id || 'unknown';
  const isFinalStatus = ['done', 'approved', 'rejected', 'pending_qc', 'fail', 'failed'].includes(status);
  const resultUrl = isFinalStatus ? bestResultUrl : '';
  const coverUrl = isFinalStatus ? bestCoverUrl : '';
  const rawPct = Number(t.progress || t.pct || 0) || 0;
  const pct = status === 'done' || status === 'approved' || status === 'rejected' || status === 'pending_qc'
    ? 100
    : Math.max(0, Math.min(99, rawPct));
  return {
    id: t.task_id || t.id,
    name,
    type,
    status,
    codeTag: (typeof getCanonicalCodeTag === 'function' ? getCanonicalCodeTag(t.product_code || '') : String(t.product_code || '').trim()),
    sessionId: t.session_id || '',
    staffId: t.staff_id || t.user_name || '',
    userName: String(t.user_name || '').trim(),
    userDisplay: String(t.user_display || '').trim(),
    credits: Number(t.credit_used || 0),
    pct,
    progress: pct,
    taskId: t.task_id || t.id,
    clientTaskId: String(t.client_task_id || t.clientTaskId || '').trim(),
    createdAt,
    completedAt,
    executionTime: isFinalStatus
      ? (String(t.execution_time || t.executionTime || '').trim() || formatLibraryExecutionTime(createdAt, completedAt))
      : '',
    resultUrl,
    coverUrl,
    sourceUrl: bestSourceUrl,
    endSourceUrl: bestEndSourceUrl,
    prompt: t.prompt || '',
    provider: t.provider || '',
    modelId: t.model_id || '',
    modelLabel: t.model_label || '',
    duration: t.duration || '',
    ratio: t.aspect_ratio || '',
    cameraMove: t.camera_move || '',
    effectGroup: String(t.effect_group || 'custom').trim().toLowerCase() || 'custom',
    effectGroupDetail: String(t.effect_group_detail || '').trim(),
    customerRequest: String(t.customer_request || t.customerRequest || '').trim(),
    internalNote: String(t.internal_note || t.internalNote || '').trim(),
    qcStatus: qcStatus || null,
    qcNote: qcNote || '',
    rejectReason: String(t.reject_reason || '').trim(),
    qcReviewer: String(t.qc_reviewer || '').trim(),
    qcReviewedAt: t.qc_reviewed_at || '',
  };
}

function formatLibraryExecutionTime(startValue, endValue = '') {
  const startRaw = String(startValue || '').trim();
  if (!startRaw) return '';
  const startMs = Date.parse(startRaw);
  if (!Number.isFinite(startMs)) return '';
  const endRaw = String(endValue || '').trim();
  if (!endRaw) return '';
  const endMs = endRaw ? Date.parse(endRaw) : Date.now();
  if (!Number.isFinite(endMs) || endMs < startMs) return '';
  const totalSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds} giây`;
  return `${minutes} phút ${seconds} giây`;
}

function getLibraryCollectionSignature(items) {
  const rows = Array.isArray(items) ? items : [];
  return JSON.stringify(rows.map((item) => ({
    id: String(item?.id || '').trim(),
    taskId: String(item?.taskId || '').trim(),
    status: String(item?.status || '').trim(),
    qcStatus: String(item?.qcStatus || '').trim(),
    qcNote: String(item?.qcNote || '').trim(),
    resultUrl: String(item?.resultUrl || '').trim(),
    pct: Math.round(Number(item?.pct || 0) || 0),
  })));
}

function resolveQCQueueCodeTag(row) {
  const direct = (typeof getCanonicalCodeTag === 'function'
    ? getCanonicalCodeTag(row?.code_tag || row?.codeTag || '')
    : String(row?.code_tag || row?.codeTag || '').trim());
  if (direct) return direct;
  const taskId = String(row?.task_id || row?.taskId || '').trim();
  const sessionId = String(row?.session_id || row?.sessionId || '').trim();
  const libraryRows = Array.isArray(AppData?.library) ? AppData.library : [];
  const matchedLibrary = libraryRows.find((item) => {
    const itemTaskId = String(item?.taskId || item?.id || '').trim();
    const itemSessionId = String(item?.sessionId || item?.session_id || '').trim();
    if (taskId && itemTaskId && itemTaskId === taskId) return true;
    if (sessionId && itemSessionId && itemSessionId === sessionId) return true;
    return false;
  }) || null;
  const libraryCode = (typeof getCanonicalCodeTag === 'function'
    ? getCanonicalCodeTag(matchedLibrary?.codeTag || matchedLibrary?.code_tag || '')
    : String(matchedLibrary?.codeTag || matchedLibrary?.code_tag || '').trim());
  if (libraryCode) return libraryCode;
  const historyRows = Array.isArray(AppData?.activityHistory) ? AppData.activityHistory : [];
  const matchedHistory = historyRows.find((item) => {
    const itemTaskId = String(item?.task_id || item?.taskId || '').trim();
    const itemSessionId = String(item?.session_id || item?.sessionId || '').trim();
    if (taskId && itemTaskId && itemTaskId === taskId) return true;
    if (sessionId && itemSessionId && itemSessionId === sessionId) return true;
    return false;
  }) || null;
  return (typeof getCanonicalCodeTag === 'function'
    ? getCanonicalCodeTag(matchedHistory?.code_tag || matchedHistory?.product_code || '')
    : String(matchedHistory?.code_tag || matchedHistory?.product_code || '').trim());
}

function normalizeQCQueueItem(row) {
  if (!row || typeof row !== 'object') return null;
  const submittedAtRaw = Number(row.submitted_at || row.submittedAt || 0);
  const submittedAt = Number.isFinite(submittedAtRaw) ? submittedAtRaw : 0;
  const taskId = String(row.task_id || row.taskId || '').trim();
  const videoUrl = String(row.video_url || row.videoUrl || '').trim();
  const codeTag = resolveQCQueueCodeTag(row);
  return {
    id: String(row.id || '').trim(),
    qcId: String(row.id || '').trim(),
    taskId,
    videoUrl,
    resultUrl: videoUrl,
    coverUrl: String(row.cover_url || row.coverUrl || '').trim(),
    userName: String(row.user_name || row.userName || '').trim(),
    userDisplay: String(row.user_display || row.userDisplay || '').trim(),
    staffId: String(row.user_name || row.userName || '').trim(),
    sessionId: String(row.session_id || row.sessionId || '').trim(),
    codeTag,
    taskIndex: Number(row.task_index || row.taskIndex || 0),
    prompt: String(row.prompt || '').trim(),
    effectGroup: String(row.effect_group || row.effectGroup || '').trim().toLowerCase(),
    effectGroupDetail: String(row.effect_group_detail || row.effectGroupDetail || '').trim(),
    customerRequest: String(row.customer_request || row.customerRequest || '').trim(),
    internalNote: String(row.internal_note || row.internalNote || '').trim(),
    provider: String(row.provider || '').trim().toLowerCase(),
    modelId: String(row.model_id || row.modelId || '').trim(),
    modelLabel: String(row.model_label || row.modelLabel || row.model_id || row.modelId || '').trim(),
    genMode: String(row.gen_mode || row.genMode || '').trim(),
    duration: String(row.duration || '').trim(),
    aspectRatio: String(row.aspect_ratio || row.aspectRatio || '').trim(),
    sourceUrl: String(row.source_url || row.sourceUrl || '').trim(),
    endSourceUrl: String(row.end_source_url || row.endSourceUrl || '').trim(),
    creditUsed: Number(row.credit_used || row.creditUsed || 0),
    note: String(row.note || '').trim(),
    status: String(row.status || 'pending').trim().toLowerCase() || 'pending',
    reviewer: String(row.reviewer || '').trim(),
    rejectReason: String(row.reject_reason || row.rejectReason || '').trim(),
    assignedQcUser: String(row.assigned_qc_user || row.assignedQcUser || '').trim(),
    assignedQcDisplay: String(row.assigned_qc_display || row.assignedQcDisplay || '').trim(),
    claimedBy: String(row.claimed_by || row.claimedBy || '').trim(),
    claimedDisplay: String(row.claimed_display || row.claimedDisplay || '').trim(),
    claimedAt: Number(row.claimed_at || row.claimedAt || 0),
    createdAt: String(row.created_at || row.createdAt || '').trim(),
    createdAtText: String(row.created_at || row.createdAt || '').trim()
      ? String(row.created_at || row.createdAt || '').trim()
      : '-',
    submittedAt,
    submittedAtText: submittedAt ? new Date(submittedAt * 1000).toLocaleString('vi-VN') : '-',
    reviewedAt: Number(row.reviewed_at || row.reviewedAt || 0),
    mediaType: 'video',
    type: 'video',
    name: codeTag || String(row.task_id || row.id || 'QC Item').trim(),
  };
}

function getStableLibraryCodeTag(nextItem, existingItem = null) {
  const nextRaw = typeof getCanonicalCodeTag === 'function'
    ? getCanonicalCodeTag(nextItem?.codeTag || nextItem?.product_code || '')
    : String(nextItem?.codeTag || nextItem?.product_code || '').trim();
  const nextReal = typeof getCanonicalCodeTag === 'function'
    ? getCanonicalCodeTag(nextRaw, { stripPlaceholder: true })
    : nextRaw;
  if (nextReal) return nextRaw;
  const existingRaw = typeof getCanonicalCodeTag === 'function'
    ? getCanonicalCodeTag(existingItem?.codeTag || existingItem?.product_code || '')
    : String(existingItem?.codeTag || existingItem?.product_code || '').trim();
  const existingReal = typeof getCanonicalCodeTag === 'function'
    ? getCanonicalCodeTag(existingRaw, { stripPlaceholder: true })
    : existingRaw;
  if (existingReal) return existingRaw;
  return nextRaw || existingRaw || '';
}

function setQCQueueData(rows) {
  const normalizedQCQueue = Array.isArray(rows) ? rows.map(normalizeQCQueueItem).filter(Boolean) : [];
  AppData.qcQueue.splice(0, AppData.qcQueue.length, ...normalizedQCQueue);
}

async function refreshQCQueue(options = {}) {
  const silent = !!options.silent;
  try {
    const rows = await API.getQCQueue();
    setQCQueueData(rows);
    if (currentScreen === 'qc') buildQC();
    return rows;
  } catch (err) {
    if (!silent && typeof showToast === 'function') showToast(err.message || 'Làm mới QC thất bại', 'error');
    throw err;
  }
}

function shouldKeepLibraryItem(item) {
  if (!item || typeof item !== 'object') return false;
  const type = String(item.type || '').toLowerCase();
  if (type !== 'video') return true;
  const status = String(item.status || '').trim().toLowerCase();
  if (['processing', 'running', 'pending', 'queued', 'pending_qc'].includes(status)) return true;
  return !!String(item.resultUrl || '').trim();
}

function canPreviewLibraryItem(item) {
  if (!item || typeof item !== 'object') return false;
  const resultUrl = String(item.resultUrl || '').trim();
  if (!resultUrl) return false;
  const type = String(item.type || item.mediaType || 'video').trim().toLowerCase();
  if (type === 'image') return true;
  const status = String(item.status || '').trim().toLowerCase();
  const qcStatus = String(item.qcStatus || '').trim().toLowerCase();
  return ['done', 'approved', 'rejected', 'fail', 'failed', 'pending_qc'].includes(status)
    || ['approved', 'rejected', 'pending_qc'].includes(qcStatus);
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
  resetClientAuthState();
  if (window.AppMonitor && typeof window.AppMonitor.addEvent === 'function') window.AppMonitor.addEvent('logout', 'manual', 'info');
  showLoginScreen();
}

// ---- INIT ----
document.addEventListener('DOMContentLoaded', async () => {
  if (window.AppMonitor && typeof window.AppMonitor.installWrappers === 'function') {
    window.AppMonitor.installWrappers();
  }
  const token = API.getToken();
  const savedUser = API.getUser();
  if (token && savedUser) {
    try {
      const me = await API.getMe();
      await onLoginSuccess(me);
      return;
    } catch (_) {
      resetClientAuthState();
    }
  }
  showLoginScreen();
  restoreRegisterPendingState();
  restoreRecoverPendingState();
});

window.__docsPortalOpenAt = 0;

window.addEventListener('beforeunload', (event) => {
  const docsPortalOpenAt = Number(window.__docsPortalOpenAt || 0);
  if (docsPortalOpenAt && (Date.now() - docsPortalOpenAt) < 1500) return;
  if (!isStrictStaffShiftLock() || !AppData.activeShift) return;
  event.preventDefault();
  event.returnValue = '';
});


function _setScreenInitError(containerId, title, err) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const msg = String(err && err.message ? err.message : err || 'Unknown error').trim() || 'Unknown error';
  el.innerHTML = `<div class="card"><div class="card-title">${title}</div><div style="color:var(--red);font-size:13px;white-space:normal">Khởi tạo màn hình thất bại: ${msg.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div></div>`;
}

function _safeInitScreen(label, containerId, builder) {
  try {
    builder();
  } catch (err) {
    console.warn(`[screen] ${label} init failed:`, err && err.message ? err.message : err);
    _setScreenInitError(containerId, label, err);
  }
}

function initAllScreens() {
  _safeInitScreen('Dashboard', 'dashboardContent', () => buildDashboard());
  _safeInitScreen('Creator Workspace', 'creatorContent', () => buildCreator()); // defined in creator.js
  if (canAccessScreen('qc')) _safeInitScreen('QC', 'qcContent', () => buildQC());
  else {
    const el = document.getElementById('qcContent');
    if (el) el.innerHTML = '<div class="card"><div class="card-title">Admin/QC only</div><div style="color:var(--muted);font-size:13px">Ban khong co quyen truy cap man hinh nay.</div></div>';
  }
  if (canAccessScreen('hr')) _safeInitScreen('HR', 'hrContent', () => buildHR());
  else {
    const el = document.getElementById('hrContent');
    if (el) el.innerHTML = '<div class="card"><div class="card-title">Admin only</div><div style="color:var(--muted);font-size:13px">Ban khong co quyen truy cap man hinh nay.</div></div>';
  }
  _safeInitScreen('Library', 'libraryContent', () => buildLibrary());
  _safeInitScreen('Preset Manager', 'presetManagerContent', () => buildPresetManager());
  _safeInitScreen('Credits', 'creditsContent', () => buildCreditsScreen());
  if (canAccessScreen('announce')) _safeInitScreen('Thông báo', 'announceContent', () => buildAnnouncementsScreen());
  else {
    const el = document.getElementById('announceContent');
    if (el) el.innerHTML = '<div class="card"><div class="card-title">Admin only</div><div style="color:var(--muted);font-size:13px">Ban khong co quyen truy cap man hinh nay.</div></div>';
  }
  if (canAccessScreen('settings')) _safeInitScreen('Settings', 'settingsContent', () => buildSettings());
  else {
    const el = document.getElementById('settingsContent');
    if (el) el.innerHTML = '<div class="card"><div class="card-title">Admin only</div><div style="color:var(--muted);font-size:13px">Ban khong co quyen truy cap man hinh nay.</div></div>';
  }
  try {
    normalizeMojibakeDom(document);
  } catch (err) {
    console.warn('[screen] normalizeMojibakeDom failed:', err && err.message ? err.message : err);
  }
  try {
    if (window.AppMonitor && typeof window.AppMonitor.installWrappers === 'function') {
      window.AppMonitor.installWrappers();
    }
  } catch (err) {
    console.warn('[screen] AppMonitor.installWrappers failed:', err && err.message ? err.message : err);
  }
}

const ScreenPermissionMap = {
  dashboard: '',
  creator: 'create_video',
  qc: 'qc_approve',
  hr: 'manage_users',
  library: 'view_library',
  presets: '',
  credits: '',
  announce: 'manage_settings',
  settings: 'manage_settings',
};

function getScreenBlockReason(screenId) {
  const role = String(AppData.currentUser?.role || '').toLowerCase();
  if (role === 'qc_manager' && !['dashboard', 'qc', 'presets'].includes(String(screenId || '').toLowerCase())) {
    return 'Role QC chỉ được truy cập Dashboard, QC và Preset Manager';
  }
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
  const role = String(AppData.currentUser?.role || '').toLowerCase();
  const canSwitch = canUseRoleSwitcher();
  if (roleModal && !canSwitch) roleModal.style.display = 'none';
  if (headerAvatar) {
    headerAvatar.style.display = canSwitch ? '' : 'none';
    headerAvatar.style.pointerEvents = canSwitch ? '' : 'none';
  }

  document.querySelectorAll('.nav-item').forEach((nav) => {
    if (nav.classList.contains('nav-item-external')) {
      nav.style.display = AppData.currentUser ? '' : 'none';
      nav.classList.remove('disabled');
      nav.title = '';
      return;
    }
    const screenId = nav.getAttribute('data-screen');
    const allowed = canAccessScreen(screenId);
    nav.style.display = allowed ? '' : 'none';
    nav.classList.toggle('disabled', !allowed);
    nav.title = getScreenBlockReason(screenId) || '';
    if (screenId === 'credits') {
      const label = nav.querySelector('span');
      if (label) label.textContent = role === 'staff' ? 'Histories' : 'Credits';
    }
  });

  const creditDisplay = document.querySelector('.credit-display');
  const creditRows = document.querySelectorAll('.credit-display .credit-row');
  const creditP1Label = creditRows[0]?.querySelector('.credit-label');
  if (creditDisplay) creditDisplay.style.display = role === 'qc_manager' ? 'none' : '';
  if (creditP1Label) creditP1Label.innerHTML = role === 'admin'
    ? '<i class="fa-solid fa-coins"></i> Server 1'
    : '<i class="fa-solid fa-coins"></i> Credits';

  if (!canAccessScreen(currentScreen)) {
    const fallback = ['dashboard', 'presets', 'library', 'credits', 'creator', 'qc', 'hr', 'settings'].find((screenId) => canAccessScreen(screenId));
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
  if (!['staff', 'qc_manager'].includes(String(AppData.currentUser?.role || '').toLowerCase()) || !AppData.activeShift) {
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
    <div style="display:flex;align-items:center;width:100%;padding:8px 14px;border:1px solid rgba(85,190,120,.35);border-radius:10px;background:rgba(45,120,65,.14)">
      <div style="display:flex;align-items:center;gap:12px;min-width:0">
        <span style="font-size:13px;font-weight:800;color:#7CFF9A">CA ĐANG MỞ</span>
        <span style="font-size:13px;color:#EAF7EE;font-weight:700">${AppData.activeShift.shiftLabel || AppData.activeShift.title || 'Ca làm việc'}</span>
        <span style="font-size:12px;color:#9FDBAE">${validStarted ? startedAt.toLocaleString('vi-VN') : '-'}</span>
        <span style="font-size:12px;color:#7CFF9A;font-weight:700">${hours} giờ ${minutes} phút</span>
      </div>
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
  if (window.AppMonitor && typeof window.AppMonitor.setContext === 'function') {
    window.AppMonitor.setContext({ currentScreen: String(screenId || '') });
    if (typeof window.AppMonitor.addEvent === 'function') window.AppMonitor.addEvent('switch_screen', String(screenId || ''), 'info');
  }
  if (!['settings', 'announce'].includes(String(screenId || '')) && typeof stopSettingsMonitorRefresh === 'function') {
    stopSettingsMonitorRefresh();
  }
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navLink = navEl || document.querySelector(`[data-screen="${screenId}"]`);
  if (navLink) navLink.classList.add('active');
  if (target) normalizeMojibakeDom(target);
  renderSyncHealthStatus();
  if (screenId === 'presets' && typeof buildPresetManager === 'function') {
    buildPresetManager();
    if (typeof loadPromptPresetManager === 'function') loadPromptPresetManager(true);
  }
}

// ---- SIDEBAR ----
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
}

function openDocsPortal(event, navEl) {
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
  if (event && typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
  try {
    window.__docsPortalOpenAt = Date.now();
    const token = (typeof API !== 'undefined' && API && typeof API.getToken === 'function') ? API.getToken() : '';
    const user = (typeof API !== 'undefined' && API && typeof API.getUser === 'function') ? API.getUser() : null;
    if (token) localStorage.setItem('fa_docs_portal_token', token);
    if (user) localStorage.setItem('fa_docs_portal_user', JSON.stringify(user));
    const targetUrl = new URL('/docs.html', window.location.origin);
    if (navEl) {
      navEl.blur();
    }
    const opened = window.open(targetUrl.toString(), '_blank', 'noopener');
    if (!opened) {
      window.alert('Trình duyệt đang chặn tab Tài liệu. Hãy cho phép popup cho website này.');
    }
  } catch (_) {
    window.alert('Không thể mở tab Tài liệu.');
  }
  return false;
}

function cacheDocsPortalContext() {
  try {
    const token = (typeof API !== 'undefined' && API && typeof API.getToken === 'function') ? API.getToken() : '';
    const user = (typeof API !== 'undefined' && API && typeof API.getUser === 'function') ? API.getUser() : null;
    if (token) localStorage.setItem('fa_docs_portal_token', token);
    if (user) localStorage.setItem('fa_docs_portal_user', JSON.stringify(user));
  } catch (_) {}
  return true;
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
      `<div class="role-option role-option-wide ${currentViewId ? '' : 'active'}" onclick="switchViewToOwnAccount()">
        <i class="fa-solid fa-rotate-left"></i>
        <div>
          <strong>${currentViewId ? 'Tr\u1edf v\u1ec1 t\u00e0i kho\u1ea3n g\u1ed1c' : '\u0110ang d\u00f9ng t\u00e0i kho\u1ea3n g\u1ed1c'}</strong>
          <p>${String(auth.name || auth.username || '-')} (${String(auth.role || '-')})</p>
        </div>
      </div>` +
      switchableUsers.map((s) => `
        <div class="role-option ${currentViewId === String(s.id) ? 'active' : ''}" onclick="switchViewAsStaff('${String(s.id).replace(/'/g, "\\'")}')">
          <i class="fa-solid fa-user"></i>
          <div>
            <strong>${String(s.name || s.username || '-')}</strong>
            <p>${String(s.username || '-')} (${String(s.role || '-')})</p>
            ${currentViewId === String(s.id) ? '<span class="role-option-state">\u0110ang xem</span>' : ''}
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
    const fallback = ['dashboard', 'presets', 'library', 'credits', 'creator', 'qc', 'hr', 'settings'].find((screenId) => canAccessScreen(screenId));
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
  const fallback = ['dashboard', 'presets', 'library', 'credits', 'creator'].find((screenId) => canAccessScreen(screenId));
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
let _lastUnreadNotificationCount = 0;
let _clientNotifications = [];
let _notificationPopupQueue = [];
let _activeNotificationPopupId = null;
let _notificationPopupHideTimer = null;
let _notificationPopupTickTimer = null;
const _queuedNotificationPopupIds = new Set();
const _seenNotificationToastIds = new Set();
const _handledPresetShareNotificationIds = new Set();
const NOTIFICATION_POPUP_SEEN_STORAGE_KEY = 'notification_popup_seen_ids';
const _seenNotificationPopupIds = (() => {
  try {
    const raw = window.sessionStorage ? sessionStorage.getItem(NOTIFICATION_POPUP_SEEN_STORAGE_KEY) : '[]';
    const parsed = JSON.parse(String(raw || '[]'));
    return new Set(Array.isArray(parsed) ? parsed.map((item) => String(item || '').trim()).filter(Boolean) : []);
  } catch (_) {
    return new Set();
  }
})();

function pushClientNotification(title, body, data = {}) {
  const taskId = String(data?.taskId || '').trim();
  const type = String(data?.type || 'info').trim().toLowerCase();
  const dedupeKey = `${type}:${taskId}:${String(title || '').trim()}`;
  if (_clientNotifications.some((item) => item.dedupeKey === dedupeKey && !item.read)) return;
  _clientNotifications.unshift({
    id: `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    title: String(title || 'Thông báo').trim() || 'Thông báo',
    body: String(body || '').trim(),
    data_json: JSON.stringify(data || {}),
    created_at: new Date().toISOString(),
    read: 0,
    dedupeKey,
  });
  _clientNotifications = _clientNotifications.slice(0, 50);
  const badgeEl = document.getElementById('notifBadge');
  const unreadCount = _clientNotifications.filter((item) => !item.read).length + Number(_lastUnreadNotificationCount || 0);
  if (badgeEl) badgeEl.textContent = String(unreadCount);
}

function parseNotificationData(item) {
  if (!item || typeof item !== 'object') return {};
  const direct = item.data;
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;
  try {
    const parsed = JSON.parse(String(item.data_json || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function getNotificationDisplayTime(value) {
  const date = parseRuntimeDate(value);
  return date ? date.toLocaleString('vi-VN') : String(value || '');
}

function normalizeNotificationItem(item) {
  const row = item && typeof item === 'object' ? { ...item } : {};
  row.id = String(row.id || '').trim();
  row.type = String(row.type || 'info').trim();
  row.title = String(row.title || 'Thông báo').trim() || 'Thông báo';
  row.body = String(row.body || '').trim();
  row.read = Number(row.read || 0) ? 1 : 0;
  row.data = parseNotificationData(row);
  row.createdLabel = getNotificationDisplayTime(row.created_at || row.createdAt || '');
  return row;
}

function renderSyncHealthStatus() {
  const el = document.getElementById('syncHealthText');
  if (!el) return;
  const health = (AppData && typeof AppData.syncHealth === 'object') ? AppData.syncHealth : null;
  const staleKeys = (health && health.stale && typeof health.stale === 'object')
    ? Object.entries(health.stale).filter(([, value]) => !!value).map(([key]) => String(key || '').trim()).filter(Boolean)
    : [];
  if (!health || !health.hasErrors || staleKeys.length === 0) {
    el.textContent = 'Đồng bộ ổn';
    el.style.color = 'var(--muted)';
    el.title = 'Dữ liệu đang đồng bộ bình thường';
    return;
  }
  el.textContent = `Đồng bộ lỗi: ${staleKeys.slice(0, 2).join(', ')}${staleKeys.length > 2 ? '...' : ''}`;
  el.style.color = '#f2c24f';
  el.title = (Array.isArray(health.errors) ? health.errors : [])
    .map((row) => `${String(row?.key || '-').trim()}: ${String(row?.error || row?.status || 'Unknown').trim()}`)
    .join(' | ');
}

async function handlePresetSharedNotifications(items) {
  const rows = (Array.isArray(items) ? items : []).map(normalizeNotificationItem);
  const hits = rows.filter((item) => {
    const id = String(item.id || '').trim();
    return id && !item.read && String(item.type || '').trim().toLowerCase() === 'preset_shared' && !_handledPresetShareNotificationIds.has(id);
  });
  if (!hits.length) return;
  let creatorReloadOk = typeof ensureCreatorPromptPresets !== 'function';
  let managerReloadOk = typeof loadPromptPresetManager !== 'function';
  try {
    if (typeof ensureCreatorPromptPresets === 'function') {
      await ensureCreatorPromptPresets(true);
      creatorReloadOk = true;
    }
  } catch (_) {}
  try {
    if (typeof loadPromptPresetManager === 'function') {
      await loadPromptPresetManager(true);
      managerReloadOk = true;
    }
  } catch (_) {}
  if (!creatorReloadOk || !managerReloadOk) return;
  hits.forEach((item) => _handledPresetShareNotificationIds.add(String(item.id || '').trim()));
  if (currentScreen === 'presets' && typeof buildPresetManager === 'function') buildPresetManager();
  showToast(hits.length === 1 ? 'Bạn vừa nhận 1 preset mới' : `Bạn vừa nhận ${hits.length} preset mới`, 'info');
}

function rememberSeenNotificationPopup(id) {
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return;
  _seenNotificationPopupIds.add(normalizedId);
  try {
    if (window.sessionStorage) {
      sessionStorage.setItem(
        NOTIFICATION_POPUP_SEEN_STORAGE_KEY,
        JSON.stringify(Array.from(_seenNotificationPopupIds).slice(-200)),
      );
    }
  } catch (_) {}
}

function markNotificationReadKeepalive(id) {
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return;
  try {
    const token = (typeof API !== 'undefined' && API && typeof API.getToken === 'function')
      ? String(API.getToken() || '').trim()
      : '';
    if (!token) return;
    fetch(`/api/notifications/read/${encodeURIComponent(normalizedId)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => {});
  } catch (_) {}
}

function getNotificationPopupSeconds(item) {
  const data = parseNotificationData(item);
  return Math.max(3, Math.min(10, Number(data.popup_seconds || data.duration_seconds || 3) || 3));
}

function isPopupNotificationItem(item) {
  const normalized = normalizeNotificationItem(item);
  const type = String(normalized.type || '').trim().toLowerCase();
  const data = normalized.data || {};
  return !normalized.read && Boolean(data.popup) && type === 'admin_broadcast';
}

function ensureNotificationPopupStyle() {
  if (document.getElementById('notificationPopupStyle')) return;
  const style = document.createElement('style');
  style.id = 'notificationPopupStyle';
  style.textContent = `
    .notice-popup-overlay{position:fixed;inset:0;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;z-index:10030;padding:20px}
    .notice-popup-card{width:min(520px,calc(100vw - 32px));background:var(--card);border:1px solid rgba(217,122,43,.45);border-radius:16px;box-shadow:0 16px 60px rgba(0,0,0,.5);overflow:hidden}
    .notice-popup-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid var(--border);background:rgba(217,122,43,.08)}
    .notice-popup-title{font-size:16px;font-weight:800;color:var(--text)}
    .notice-popup-count{min-width:42px;height:42px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:rgba(217,122,43,.15);color:var(--brand);font-size:18px;font-weight:900}
    .notice-popup-body{padding:18px;font-size:15px;line-height:1.6;color:var(--text);white-space:pre-wrap;word-break:break-word}
    .notice-popup-meta{display:flex;justify-content:space-between;gap:12px;padding:0 18px 14px;color:var(--muted);font-size:12px}
    .notice-popup-actions{display:flex;justify-content:flex-end;gap:10px;padding:0 18px 16px}
    .notice-popup-btn{height:38px;padding:0 16px;border-radius:10px;border:1px solid var(--border);background:var(--bg2);color:var(--text);font-size:13px;font-weight:700;cursor:pointer}
    .notice-popup-btn:hover{filter:brightness(1.08)}
    .notice-popup-btn.primary{border-color:rgba(217,122,43,.45);background:rgba(217,122,43,.14);color:var(--brand)}
    .notice-popup-progress{height:4px;background:rgba(255,255,255,.06)}
    .notice-popup-progress-bar{height:100%;width:100%;background:linear-gradient(90deg,var(--brand),#f2d479);transition:width .1s linear}
  `;
  document.head.appendChild(style);
}

function pumpNotificationPopupQueue() {
  if (_activeNotificationPopupId || !_notificationPopupQueue.length) return;
  const item = _notificationPopupQueue.shift();
  if (!item) return;
  const normalized = normalizeNotificationItem(item);
  const popupId = String(normalized.id || '').trim();
  if (!popupId) return;
  _activeNotificationPopupId = popupId;
  _queuedNotificationPopupIds.delete(popupId);
  ensureNotificationPopupStyle();

  const existing = document.getElementById('noticePopupOverlay');
  if (existing) existing.remove();

  const seconds = getNotificationPopupSeconds(normalized);
  const forceRefresh = !!normalized.data?.force_refresh;
  const overlay = document.createElement('div');
  overlay.id = 'noticePopupOverlay';
  overlay.className = 'notice-popup-overlay';
  overlay.innerHTML = `
    <div class="notice-popup-card" role="alertdialog" aria-live="assertive" aria-modal="true">
      <div class="notice-popup-head">
        <div>
          <div class="notice-popup-title">${escapeHtml(normalized.title || 'Thông báo hệ thống')}</div>
          <div style="margin-top:4px;font-size:12px;color:var(--muted)">${forceRefresh ? `Đếm ngược <span id="noticePopupSeconds">${seconds}</span> giây, popup sẽ tự làm mới` : `Đếm ngược <span id="noticePopupSeconds">${seconds}</span> giây, popup chỉ đóng khi bấm OK`}</div>
        </div>
        <div class="notice-popup-count" id="noticePopupCounter">${seconds}</div>
      </div>
      <div class="notice-popup-body">${escapeHtml(normalized.body || '')}</div>
      <div class="notice-popup-meta">
        <span>${escapeHtml(String(normalized.data?.created_by || 'Admin'))}</span>
        <span>${escapeHtml(normalized.createdLabel || '')}</span>
      </div>
      <div class="notice-popup-actions">
        ${forceRefresh ? '' : '<button type="button" class="notice-popup-btn" id="noticePopupOkBtn">OK</button>'}
      </div>
      <div class="notice-popup-progress"><div class="notice-popup-progress-bar" id="noticePopupProgress"></div></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const secondsEl = overlay.querySelector('#noticePopupSeconds');
  const counterEl = overlay.querySelector('#noticePopupCounter');
  const progressEl = overlay.querySelector('#noticePopupProgress');
  const okBtn = overlay.querySelector('#noticePopupOkBtn');
  const startedAt = Date.now();
  const totalMs = seconds * 1000;

  if (forceRefresh) {
    rememberSeenNotificationPopup(popupId);
    markNotificationReadKeepalive(popupId);
  }

  const clearPopupTimers = () => {
    if (_notificationPopupTickTimer) {
      clearInterval(_notificationPopupTickTimer);
      _notificationPopupTickTimer = null;
    }
    if (_notificationPopupHideTimer) {
      clearTimeout(_notificationPopupHideTimer);
      _notificationPopupHideTimer = null;
    }
  };

  const stopPopupTick = () => {
    if (_notificationPopupTickTimer) {
      clearInterval(_notificationPopupTickTimer);
      _notificationPopupTickTimer = null;
    }
  };

  const updatePopup = () => {
    const elapsed = Math.min(totalMs, Math.max(0, Date.now() - startedAt));
    const remainingMs = Math.max(0, totalMs - elapsed);
    const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    if (secondsEl) secondsEl.textContent = String(remainingSeconds);
    if (counterEl) counterEl.textContent = String(remainingSeconds);
    if (progressEl) progressEl.style.width = `${Math.max(0, 100 - ((elapsed / totalMs) * 100))}%`;
    if (elapsed >= totalMs) stopPopupTick();
  };

  const closePopup = () => {
    clearPopupTimers();
    rememberSeenNotificationPopup(popupId);
    markNotificationReadKeepalive(popupId);
    const node = document.getElementById('noticePopupOverlay');
    if (node) node.remove();
    _activeNotificationPopupId = null;
    window.setTimeout(() => {
      pumpNotificationPopupQueue();
    }, 120);
  };

  if (okBtn) okBtn.addEventListener('click', closePopup);

  updatePopup();
  _notificationPopupTickTimer = window.setInterval(updatePopup, 100);
  if (forceRefresh) {
    _notificationPopupHideTimer = window.setTimeout(() => {
      closePopup();
      performForcedFrontendRefresh();
    }, totalMs);
  }
}

function queueNotificationPopups(items) {
  (Array.isArray(items) ? items : []).forEach((item) => {
    const normalized = normalizeNotificationItem(item);
    const popupId = String(normalized.id || '').trim();
    if (!popupId || !isPopupNotificationItem(normalized)) return;
    if (_seenNotificationPopupIds.has(popupId) || _queuedNotificationPopupIds.has(popupId) || _activeNotificationPopupId === popupId) return;
    _queuedNotificationPopupIds.add(popupId);
    _notificationPopupQueue.push(normalized);
  });
  pumpNotificationPopupQueue();
}

async function loadNotifications() {
  const listEl = document.getElementById('notifList');
  const badgeEl = document.getElementById('notifBadge');
  const header = document.querySelector('#notifPanel .notif-header');
  if (!badgeEl) return;
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
    const serverNotifications = (Array.isArray(items) ? items : []).map(normalizeNotificationItem);
    await handlePresetSharedNotifications(serverNotifications);
    queueNotificationPopups(serverNotifications);
    const notifications = [..._clientNotifications, ...serverNotifications].map(normalizeNotificationItem);
    const unreadCount = notifications.filter((n) => !n.read).length;
    badgeEl.textContent = String(unreadCount);
    _lastUnreadNotificationCount = Number(serverNotifications.filter((n) => !n.read).length || 0);
    if (!listEl) return;
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
      const created = item.createdLabel || '';
      return '<div class="notif-item ' + (item.read ? '' : 'unread') + '" data-id="' + item.id + '" onclick="' + (item.read ? '' : 'markNotificationRead(&quot;' + String(item.id).replace(/\"/g, '&quot;') + '&quot;)') + '">' +
          '<div class="notif-icon ' + iconClass + '"><i class="fa-solid ' + icon + '"></i></div>' +
          '<div class="notif-body">' +
            '<div class="notif-title">' + escapeHtml(item.title || 'Thông báo') + '</div>' +
            '<div class="notif-text">' + escapeHtml(item.body || '') + '</div>' +
            '<div class="notif-time">' + escapeHtml(created) + '</div>' +
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
    const localItem = _clientNotifications.find((item) => String(item.id) === String(id));
    if (localItem) {
      localItem.read = 1;
      await loadNotifications();
      return;
    }
    await API.markNotifRead(id);
    await loadNotifications();
  } catch (_) {}
}

async function markAllNotificationsRead() {
  try {
    _clientNotifications.forEach((item) => { item.read = 1; });
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
    const applied = applySystemStatusSnapshot(status);
    const onlineUsers = Array.isArray(applied.onlineUsers) ? applied.onlineUsers : [];
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
    return applied;
  } catch (_) {
    peerEl.textContent = 'Online: không tải được';
  }
  return { systemChanged: false, sessionsChanged: false, onlineUsers: [] };
}

async function refreshNotificationBadge() {
  try {
    const badgeEl = document.getElementById('notifBadge');
    if (!badgeEl) return;
    if (notifOpen) {
      await loadNotifications();
      return;
    }
    const result = await API.getNotificationUnreadCount();
    const serverUnreadCount = Number(result?.count || 0) || 0;
    const unreadCount = serverUnreadCount + _clientNotifications.filter((item) => !item.read).length;
    badgeEl.textContent = String(unreadCount);
    if (serverUnreadCount > _lastUnreadNotificationCount) {
      const items = await API.getNotifications();
      const serverNotifications = (Array.isArray(items) ? items : []).map(normalizeNotificationItem);
      await handlePresetSharedNotifications(serverNotifications);
      queueNotificationPopups(serverNotifications);
      const hasNewUnreadToastable = serverNotifications.some((item) => {
        const id = String(item.id || '').trim();
        if (!id || item.read) return false;
        if (isPopupNotificationItem(item)) return false;
        if (_seenNotificationPopupIds.has(id) || _seenNotificationToastIds.has(id)) return false;
        _seenNotificationToastIds.add(id);
        return true;
      });
      if (hasNewUnreadToastable) showToast('Có thông báo mới', 'info');
    } else if (unreadCount > _lastUnreadNotificationCount) {
      const hasNewClientToastable = _clientNotifications.some((item) => {
        const normalized = normalizeNotificationItem(item);
        const id = String(normalized.id || '').trim();
        if (!id || normalized.read) return false;
        if (_seenNotificationPopupIds.has(id) || _seenNotificationToastIds.has(id)) return false;
        _seenNotificationToastIds.add(id);
        return true;
      });
      if (hasNewClientToastable) showToast('Có thông báo mới', 'info');
    }
    _lastUnreadNotificationCount = serverUnreadCount;
  } catch (_) {}
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
  selectedQCItemId = String(name || '').trim() || null;
  const item = selectedQCItemId ? AppData.qcQueue.find(i => i.id === selectedQCItemId) : null;
  const role = String(AppData.currentUser?.role || '').trim().toLowerCase();
  if (item && role === 'qc_manager' && !String(item.assignedQcUser || '').trim()) {
    API.claimQC(item.id)
      .then(async (res) => {
        if (!res || res.ok === false) {
          const status = String(res?.status || '').trim().toLowerCase();
          const message =
            status === 'claimed_other' ? `Task đang được QC khác giữ${res?.claimed_display ? `: ${res.claimed_display}` : ''}` :
            status === 'assigned_other' ? 'Task đang được giao cho QC khác' :
            status === 'telegram_only' ? 'Task này chỉ duyệt qua Telegram/Admin' :
            status === 'closed' ? 'Task này đã được xử lý' :
            'Nhận task QC thất bại';
          showToast(message, 'warning');
        }
        await loadDataFromAPI();
        buildQC();
      })
      .catch((err) => { showToast(err.message || 'Nhận task QC thất bại', 'error'); buildQC(); });
    return;
  }
  buildQC();
}

async function approveItem() {
  // Role gate: only qc_manager or admin can approve
  const gate = validateBeforeApprove();
  if (!gate.ok) return;

  const item = selectedQCItemId ? AppData.qcQueue.find(i => i.id === selectedQCItemId) : null;
  if (!item) { showToast('Không tìm thấy item để duyệt', 'error'); return; }
  try {
    await API.approveQC(item.id, document.getElementById('qcComment')?.value || '');
    if (window.AppMonitor && typeof window.AppMonitor.addEvent === 'function') window.AppMonitor.addEvent('qc_approve', String(item.codeTag || item.taskId || ''), 'info');
    await loadDataFromAPI();
    try {
      if (typeof renderLibraryIfChanged === 'function') renderLibraryIfChanged(true);
      if (typeof _hydrateCreatorCombosFromRuntimeData === 'function') _hydrateCreatorCombosFromRuntimeData();
      if (typeof syncCreatorQCFromLibrary === 'function') syncCreatorQCFromLibrary({ render: true });
    } catch (_) {}
  } catch (err) {
    showToast(err.message || 'Approve thất bại', 'error');
    return;
  }
  showToast(`Approved: ${item.codeTag || item.taskId}`, 'success');
  buildQC(); // Re-render QC screen
  selectedQCItemId = null;
}

async function rejectItem() {
  const gate = validateBeforeApprove();
  if (!gate.ok) return;

  const comment = document.getElementById('qcComment')?.value || '';
  const item = selectedQCItemId ? AppData.qcQueue.find(i => i.id === selectedQCItemId) : null;
  if (!item) { showToast('Không tìm thấy item để từ chối', 'error'); return; }
  try {
    await API.rejectQC(item.id, comment || 'Không đạt yêu cầu');
    if (window.AppMonitor && typeof window.AppMonitor.addEvent === 'function') window.AppMonitor.addEvent('qc_reject', String(item.codeTag || item.taskId || ''), 'warn');
    await loadDataFromAPI();
    try {
      if (typeof renderLibraryIfChanged === 'function') renderLibraryIfChanged(true);
      if (typeof _hydrateCreatorCombosFromRuntimeData === 'function') _hydrateCreatorCombosFromRuntimeData();
      if (typeof syncCreatorQCFromLibrary === 'function') syncCreatorQCFromLibrary({ render: true });
    } catch (_) {}
  } catch (err) {
    showToast(err.message || 'Reject thất bại', 'error');
    return;
  }
  showToast(`Rejected: ${item.codeTag || item.taskId}${comment ? ' - ' + comment : ''}`, 'error');
  buildQC();
  selectedQCItemId = null;
}

async function releaseQCClaim() {
  const item = selectedQCItemId ? AppData.qcQueue.find(i => i.id === selectedQCItemId) : null;
  if (!item) { showToast('Không tìm thấy item QC', 'error'); return; }
  try {
    await API.releaseQC(item.id);
    await loadDataFromAPI();
    try {
      if (typeof buildQC === 'function') buildQC();
      if (typeof renderLibraryIfChanged === 'function') renderLibraryIfChanged(true);
      if (typeof _hydrateCreatorCombosFromRuntimeData === 'function') _hydrateCreatorCombosFromRuntimeData();
      if (typeof syncCreatorQCFromLibrary === 'function') syncCreatorQCFromLibrary({ render: true });
    } catch (_) {}
    showToast('Đã nhả task QC', 'success');
  } catch (err) {
    showToast(err.message || 'Nhả task QC thất bại', 'error');
  }
}

async function approveAll() {
  const gate = validateBeforeApprove();
  if (!gate.ok) return;

  const queue = getQCQueue();
  if (queue.length === 0) { showToast('Queue trống', 'info'); return; }
  const role = String(AppData.currentUser?.role || '').trim().toLowerCase();
  const currentQcUsername = String(AppData.currentUser?.username || '').trim();
  let okCount = 0;
  let skipCount = 0;
  let failCount = 0;
  const failMessages = [];
  for (const item of queue) {
    try {
      if (role === 'qc_manager') {
        const assignedQcUser = String(item.assignedQcUser || '').trim();
        const claimedBy = String(item.claimedBy || '').trim();
        if (assignedQcUser && assignedQcUser !== currentQcUsername) {
          skipCount += 1;
          continue;
        }
        if (claimedBy && claimedBy !== currentQcUsername) {
          skipCount += 1;
          continue;
        }
        if (!claimedBy || claimedBy !== currentQcUsername) {
          const claimRes = await API.claimQC(item.id);
          if (!claimRes || claimRes.ok === false) {
            skipCount += 1;
            continue;
          }
        }
      }
      await API.approveQC(item.id, '');
      okCount += 1;
    } catch (err) {
      failCount += 1;
      const itemLabel = String(item.codeTag || item.taskId || item.id || '').trim() || 'unknown';
      failMessages.push(`${itemLabel}: ${String(err?.message || err || 'error')}`);
    }
  }
  await loadDataFromAPI();
  if (typeof buildQC === 'function') buildQC();
  try {
    if (typeof renderLibraryIfChanged === 'function') renderLibraryIfChanged(true);
    if (typeof _hydrateCreatorCombosFromRuntimeData === 'function') _hydrateCreatorCombosFromRuntimeData();
    if (typeof syncCreatorQCFromLibrary === 'function') syncCreatorQCFromLibrary({ render: true });
  } catch (_) {}
  checkCreditAlerts();
  if (okCount > 0 && failCount === 0 && skipCount === 0) {
    showToast(`Đã duyệt ${okCount} items`, 'success');
  } else if (okCount > 0) {
    showToast(`Đã duyệt ${okCount}, bỏ qua ${skipCount}, lỗi ${failCount}`, failCount > 0 ? 'warning' : 'success');
  } else if (skipCount > 0 && failCount === 0) {
    showToast(`Không duyệt được item nào. Bỏ qua ${skipCount} items`, 'warning');
  } else {
    showToast(`Duyệt tất cả thất bại: ${failMessages[0] || 'unknown error'}`, 'error');
  }
  buildQC();
  selectedQCItemId = null;
}

function sendTelegramReview() {
  const item = selectedQCItemId ? AppData.qcQueue.find(i => i.id === selectedQCItemId) : null;
  if (!item) {
    showToast('Không có item QC đang chọn', 'info');
    return;
  }
  showToast(`Item ${item.codeTag || item.taskId} đã được gửi Telegram từ lúc staff submit`, 'info');
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
          <label class="form-label">Mã nhân viên</label>
          <input id="addStaffEmployeeCode" class="form-input" type="text" placeholder="Nhập mã nhân viên">
        </div>
        <div>
          <label class="form-label">Mật khẩu</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input id="addStaffPassword" class="form-input" type="password" placeholder="Nhập mật khẩu">
            <button class="btn-ghost btn-sm" type="button" onclick="togglePasswordInput('addStaffPassword', this)"><i class="fa-solid fa-eye"></i></button>
          </div>
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
  const employeeCode = document.getElementById('addStaffEmployeeCode')?.value.trim() || '';
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
      employee_code: employeeCode,
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
        <div style="grid-column:1 / -1">
          <label class="form-label">Mã nhân viên</label>
          <input id="staffProfileEmployeeCode" class="form-input" type="text" value="${staff.employeeCode || ''}" ${disabled} placeholder="Nhập mã nhân viên">
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
          <div style="display:flex;gap:8px;align-items:center">
            <input id="staffProfilePassword" class="form-input" type="password" placeholder="Để trống nếu không đổi">
            <button class="btn-ghost btn-sm" type="button" onclick="togglePasswordInput('staffProfilePassword', this)"><i class="fa-solid fa-eye"></i></button>
          </div>
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

function togglePasswordInput(inputId, btnEl) {
  const input = document.getElementById(String(inputId || '').trim());
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  const icon = btnEl && typeof btnEl.querySelector === 'function' ? btnEl.querySelector('i') : null;
  if (icon) icon.className = input.type === 'password' ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
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
      employee_code: document.getElementById('staffProfileEmployeeCode')?.value.trim() || '',
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
    item = AppData.library.find(i => String(i.id || '') === String(id) || String(i.taskId || '') === String(id));
  }
  if (!item) {
    const candidates = AppData.library.filter(i => String(i.name || '') === String(name || ''));
    if (candidates.length > 1) {
      showToast('Tên media bị trùng, cần mở theo id/task cụ thể', 'warning');
      return;
    }
    item = candidates.length === 1 ? candidates[0] : null;
  }
  if (!item) {
    showToast(`Không tìm thấy media: ${name}`, 'error');
    return;
  }
  if (!canPreviewLibraryItem(item)) {
    showToast('Media chưa có video kết quả ổn định để xem', 'warning');
    return;
  }

  const oldModal = document.getElementById('libraryPreviewModal');
  if (oldModal) oldModal.remove();

  const qcApproved = String(item.qcStatus || item.status || '').trim().toLowerCase() === 'approved';
  const mediaHtml = item.type === 'image'
    ? `<img src="${item.resultUrl}" alt="${item.name}" style="max-width:min(92vw,1200px);max-height:78vh;display:block;border-radius:12px;background:#111">`
    : (qcApproved
      ? `<video src="${item.resultUrl}" controls controlsList="nodownload noplaybackrate noremoteplayback" disablepictureinpicture autoplay playsinline preload="metadata" oncontextmenu="return false;" style="max-width:min(92vw,1200px);max-height:78vh;display:block;border-radius:12px;background:#111"></video>`
      : `<video src="${item.resultUrl}" autoplay loop muted playsinline preload="metadata" oncontextmenu="return false;" style="max-width:min(92vw,1200px);max-height:78vh;display:block;border-radius:12px;background:#111"></video>`);

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
let aiChatAttachment = null;

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
    chatEl.innerHTML = '<div class="chat-bubble ai">Xin chào. Đây là Trợ lý prompt. Tôi giúp bạn tạo prompt, phân tích ảnh, tư vấn quy trình.<br><small style="color:var(--muted)">Chọn ảnh, nhập câu lệnh, rồi gửi cùng một lượt.</small></div>';
    chatEl.scrollTop = chatEl.scrollHeight;
    return;
  }
  chatEl.innerHTML = aiChatMessages.map((message) => {
    const role = String(message.role || '').toLowerCase() === 'user' ? 'user' : 'ai';
    return `<div class="chat-bubble ${role}">${escapeHtml(getChatMessageText(message)).replace(/\n/g, '<br>')}</div>`;
  }).join('');
  chatEl.scrollTop = chatEl.scrollHeight;
}

function _revokeChatAttachmentUrl() {
  try {
    const url = String(aiChatAttachment?.previewUrl || '').trim();
    if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
  } catch (_) {}
}

function renderChatAttachment() {
  const box = document.getElementById('chatPendingAttachment');
  if (!box) return;
  if (!aiChatAttachment || !aiChatAttachment.file) {
    box.innerHTML = '';
    box.style.display = 'none';
    return;
  }
  const fileName = escapeHtml(String(aiChatAttachment.name || aiChatAttachment.file.name || 'image').trim());
  const previewUrl = String(aiChatAttachment.previewUrl || '').trim();
  box.style.display = '';
  box.innerHTML = `
    <div class="ai-chat-attachment-thumb">
      ${previewUrl ? `<img src="${previewUrl}" alt="${fileName}">` : '<i class="fa-solid fa-image" style="color:var(--brand)"></i>'}
    </div>
    <div class="ai-chat-attachment-meta">
      <div class="ai-chat-attachment-title">${fileName}</div>
      <div class="ai-chat-attachment-sub">Ảnh sẽ được gửi kèm câu lệnh tiếp theo</div>
    </div>
    <button type="button" class="ai-chat-attachment-clear" onclick="clearChatAttachment()" title="Bỏ ảnh đính kèm">
      <i class="fa-solid fa-xmark"></i>
    </button>
  `;
}

function clearChatAttachment(options = {}) {
  const silent = !!options.silent;
  _revokeChatAttachmentUrl();
  aiChatAttachment = null;
  renderChatAttachment();
  if (!silent) showToast('Đã bỏ ảnh đính kèm', 'info');
}

function setChatAttachment(file, previewUrl = '', name = '') {
  if (!file) return;
  _revokeChatAttachmentUrl();
  aiChatAttachment = {
    file,
    previewUrl: String(previewUrl || '').trim(),
    name: String(name || file.name || 'image').trim() || 'image',
  };
  renderChatAttachment();
  const input = document.getElementById('chatInput');
  if (input) input.focus();
  showToast(`Đã gắn ảnh: ${aiChatAttachment.name}`, 'success');
}

function _buildAnalyzeResponseText(resp, fallbackName = '') {
  const analysis = String(resp?.analysis || resp?.summary || resp?.description || resp?.message || '').trim();
  const imagePrompts = Array.isArray(resp?.image_prompts) ? resp.image_prompts.filter(Boolean) : [];
  const videoPrompts = Array.isArray(resp?.video_prompts) ? resp.video_prompts.filter(Boolean) : [];
  const prompt = String(resp?.prompt || resp?.suggested_prompt || resp?.analysis?.prompt || '').trim();
  const chunks = [];
  if (analysis) chunks.push(`Nhận diện: ${analysis}`);
  if (prompt) chunks.push(`Prompt gợi ý:\n${prompt}`);
  if (imagePrompts.length) chunks.push(`Prompt ảnh:\n- ${imagePrompts.join('\n- ')}`);
  if (videoPrompts.length) chunks.push(`Prompt video:\n- ${videoPrompts.join('\n- ')}`);
  if (chunks.length) return chunks.join('\n\n');
  return `Đã phân tích ảnh${fallbackName ? `: ${fallbackName}` : ''}.`;
}

function _appendAnalyzeResponseBubble(resp, fileName = '') {
  const chatEl = document.getElementById('chatMessages');
  if (!chatEl) return;
  const analysis = String(resp?.analysis || resp?.summary || resp?.description || resp?.message || '').trim();
  const imagePrompts = Array.isArray(resp?.image_prompts) ? resp.image_prompts.filter(Boolean) : [];
  const videoPrompts = Array.isArray(resp?.video_prompts) ? resp.video_prompts.filter(Boolean) : [];
  const prompt = String(resp?.prompt || resp?.suggested_prompt || resp?.analysis?.prompt || '').trim();
  const fileLabel = escapeHtml(String(fileName || '').trim());
  const promptBlocks = [];
  if (prompt) {
    promptBlocks.push(`<div style="font-size:11px;margin-bottom:4px"><strong>Prompt gợi ý:</strong></div><div class="ai-prompt-suggestion" onclick="navigator.clipboard.writeText(this.textContent.trim());showToast('Đã copy prompt','success')">${escapeHtml(prompt)}</div>`);
  }
  if (imagePrompts.length) {
    promptBlocks.push(`<div style="font-size:11px;margin-bottom:4px"><strong>Prompt ảnh:</strong></div>${imagePrompts.map((item) => `<div class="ai-prompt-suggestion" onclick="navigator.clipboard.writeText(this.textContent.trim());showToast('Đã copy prompt','success')">${escapeHtml(String(item))}</div>`).join('')}`);
  }
  if (videoPrompts.length) {
    promptBlocks.push(`<div style="font-size:11px;margin-bottom:4px"><strong>Prompt video:</strong></div>${videoPrompts.map((item) => `<div class="ai-prompt-suggestion" onclick="navigator.clipboard.writeText(this.textContent.trim());showToast('Đã copy prompt','success')">${escapeHtml(String(item))}</div>`).join('')}`);
  }
  chatEl.innerHTML += `
    <div class="chat-bubble ai">
      <div style="font-weight:600;margin-bottom:4px"><i class="fa-solid fa-magnifying-glass-chart" style="color:var(--brand)"></i> Trợ lý prompt</div>
      ${fileLabel ? `<div style="font-size:11px;margin-bottom:6px;color:var(--muted)"><strong>${fileLabel}</strong></div>` : ''}
      <div style="font-size:11px;margin-bottom:6px"><strong>Nhận diện:</strong> ${escapeHtml(analysis || 'Không có summary từ API')}</div>
      ${promptBlocks.join('')}
    </div>`;
  chatEl.scrollTop = chatEl.scrollHeight;
}

async function sendChat() {
  return;
}

async function saveChatHistory() {
  try {
    await API.saveChatHistory(AI_CHAT_SESSION_KEY, aiChatMessages, { chat_model: 'gemini-2.5-flash' });
  } catch (_) {}
}

async function loadChatHistory() {
  aiChatMessages = [];
  return;
}

async function clearChatHistory() {
  aiChatMessages = [];
  return;
}

// ---- AI CHAT PANEL (FAB bubble) ----
let aiChatOpen = false;
function toggleAIChat() {
  return;
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
  return;
}

// ---- AI CHAT TABS & FOLDER BROWSER ----
let aiCurrentFolder = null; // null = root (show folders), string = inside folder

function switchAITab(tab, btn) {
  return;
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
  // Switch to chat tab and attach image
  const img = AppData.images.find(i => i.id === imgId);
  if (!img) return;

  // Switch to chat tab
  document.querySelectorAll('.ai-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.ai-tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector('.ai-tab')?.classList.add('active');
  document.getElementById('aiTabChat')?.classList.add('active');

  const chatEl = document.getElementById('chatMessages');
  if (!chatEl) return;

  if (!img._file) {
    chatEl.innerHTML += `
      <div class="chat-bubble ai">
        <div style="font-weight:600;margin-bottom:4px"><i class="fa-solid fa-circle-info" style="color:var(--blue)"></i> Trợ lý prompt</div>
        <div style="font-size:11px">Ảnh này không còn file gốc trong phiên hiện tại, hãy upload lại để gửi cùng câu lệnh.</div>
      </div>`;
    chatEl.scrollTop = chatEl.scrollHeight;
    return;
  }
  try {
    const previewUrl = URL.createObjectURL(img._file);
    setChatAttachment(img._file, previewUrl, img.name || img._file.name || 'image.png');
  } catch (_) {
    setChatAttachment(img._file, '', img.name || img._file.name || 'image.png');
  }
  const input = document.getElementById('chatInput');
  if (input) input.focus();
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
      labels: ['Video (Kling)','Image Edit','Trợ lý prompt','Khác'],
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

// ---- SMOOTH PROGRESS TIMER ----
// Increments pct for in-progress library items every second using an asymptotic formula
// so progress visually advances even when the provider API reports the same value for a while.
// Direct DOM updates (no full re-render) let the CSS transition animate each small step.
function startSmoothProgressTimer() {
  if (_smoothProgressTimer) clearInterval(_smoothProgressTimer);
  _smoothProgressTimer = setInterval(() => {
    try {
      const token = (typeof API !== 'undefined' && API && typeof API.getToken === 'function')
        ? String(API.getToken() || '').trim() : '';
      if (!token) return;
      const processing = (Array.isArray(AppData.library) ? AppData.library : [])
        .filter(item => String(item?.status || '').toLowerCase() === 'processing');
      if (!processing.length) return;
      processing.forEach(item => {
        const current = Number(item.pct || 0) || 0;
        if (current >= 95) return;
        // Asymptotic: fast early, slow near 95 — mirrors real generation timing
        const next = parseFloat(Math.min(95, current + (95 - current) * 0.02).toFixed(2));
        if (next <= current) return;
        item.pct = next;
        item.progress = next;
        // Update all matching progress bars directly — CSS transition animates the step
        document.querySelectorAll(`[data-lib-id="${item.id}"]`).forEach(el => {
          el.style.width = `${Math.max(2, next)}%`;
        });
      });
      // Also increment creator task rows (they track progress separately)
      if (typeof window._smoothCreatorTaskProgress === 'function') {
        window._smoothCreatorTaskProgress();
      }
    } catch (_) {}
  }, 1000);
}

// ---- BACKGROUND POLLING HOOK ----
// ---- BACKGROUND POLLING HOOK ----
function startBackgroundPolling() {
  if (_bgPollTimer) clearInterval(_bgPollTimer);
  startSmoothProgressTimer();
  _bgPollTimer = setInterval(async () => {
    const token = (typeof API !== 'undefined' && API && typeof API.getToken === 'function') ? String(API.getToken() || '').trim() : '';
    if (!token) return;
    try {
      const nowTs = Date.now();
      if ((nowTs - _lastAuthGuardAt) >= 10000) {
        _lastAuthGuardAt = nowTs;
        await API.getMe();
      }
    } catch (_) {
      return;
    }
    let shouldRebuildDashboard = false;
    try {
      const presenceUpdate = await refreshOnlinePresence();
      if (currentScreen === 'dashboard' && (presenceUpdate?.systemChanged || presenceUpdate?.sessionsChanged)) {
        shouldRebuildDashboard = true;
      }
    } catch (_) {}
    try {
      await refreshNotificationBadge();
    } catch (_) {}
    try {
      const processingRows = (Array.isArray(AppData.library) ? AppData.library : [])
        .filter((item) => String(item?.status || '').trim().toLowerCase() === 'processing')
        .map((item) => ({ taskId: String(item?.taskId || item?.id || '').trim(), ref: item }))
        .filter((row) => row.taskId)
        .slice(0, 30);
      if (processingRows.length && API && typeof API.pollVideoBatch === 'function') {
        const polled = await API.pollVideoBatch(processingRows.map((row) => row.taskId));
        const items = Array.isArray(polled?.items) ? polled.items : [];
        const byId = new Map(items.map((row) => [String(row?.task_id || '').trim(), row]));
        let changedProcessing = false;
        for (const row of processingRows) {
          const p = byId.get(row.taskId);
          if (!p) continue;
          const ref = row.ref;
          const state = String(p.state || '').trim().toLowerCase();
          const nextPct = Number(p.progress || 0) || 0;
          const nextResultUrl = String(p.result_url || '').trim();
          const nextCoverUrl = String(p.cover_url || '').trim();
          const nextCompletedAt = String(p.completed_at || p.completedAt || '').trim();
          if (state === 'success') {
            ref.status = 'done';
            ref.pct = 100;
            ref.resultUrl = nextResultUrl;
            ref.coverUrl = nextCoverUrl;
            ref.completedAt = nextCompletedAt || new Date().toISOString();
            ref.executionTime = formatLibraryExecutionTime(ref.createdAt, ref.completedAt) || ref.executionTime || '';
            changedProcessing = true;
            if (!_processingDoneToastIds.has(row.taskId) && typeof showToast === 'function') {
              _processingDoneToastIds.add(row.taskId);
              showToast(`Task hoàn tất: ${ref.name || row.taskId}`, 'success');
              pushClientNotification(
                'Video hoàn tất',
                `${ref.name || row.taskId} đã tạo xong`,
                { type: 'video_done', taskId: row.taskId, codeTag: ref.codeTag || '', resultUrl: nextResultUrl || '' }
              );
            }
          } else if (state === 'fail') {
            ref.status = 'rejected';
            ref.pct = 0;
            ref.completedAt = new Date().toISOString();
            ref.executionTime = formatLibraryExecutionTime(ref.createdAt, ref.completedAt) || ref.executionTime || '';
            changedProcessing = true;
          } else {
            const currentPct = Number(ref.pct || 0) || 0;
            ref.status = 'processing';
            ref.pct = Math.max(currentPct, nextPct > 0 ? nextPct : Math.min(95, currentPct + 3));
            ref.resultUrl = '';
            ref.coverUrl = '';
            ref.completedAt = '';
            ref.executionTime = '';
            changedProcessing = true;
          }
        }
        if (changedProcessing) {
          if (currentScreen === 'creator' && typeof window.syncCreatorQCFromLibrary === 'function') {
            window.syncCreatorQCFromLibrary();
          }
          if (currentScreen === 'creator' && typeof window.hydrateCreatorFromRuntime === 'function') {
            window.hydrateCreatorFromRuntime();
          }
          if (currentScreen === 'creator' && typeof window.renderLibraryIfChanged === 'function') {
            window.renderLibraryIfChanged(true);
          }
          if (currentScreen === 'library' && typeof scheduleLibraryRender === 'function') {
            scheduleLibraryRender({ delay: 180 });
          }
          if (currentScreen === 'dashboard') {
            shouldRebuildDashboard = true;
          }
        }
      }
    } catch (_) {}
    try {
      // Recover stuck media only when needed to avoid noisy 500 spam and extra load.
      const nowTs = Date.now();
      const hasProcessing = (Array.isArray(AppData.library) ? AppData.library : []).some((item) => String(item.status || '').toLowerCase() === 'processing');
      const hasRecoverableHistory = (Array.isArray(AppData.activityHistory) ? AppData.activityHistory : []).some((row) => {
        if (String(row?.source || '').trim().toLowerCase() !== 'task') return false;
        const status = String(row?.status || '').trim().toLowerCase();
        const resultUrl = String(row?.result_url || '').trim();
        return (
          status === 'pending' ||
          status === 'processing' ||
          ((status === 'success' || status === 'done' || status === 'fail' || status === 'failed' || status === 'rejected') && !resultUrl)
        );
      });
      const isCreatorOpen = currentScreen === 'creator';
      const canRecoverNow = (nowTs - _lastRecoverStuckAt) >= 60000;
      if ((isCreatorOpen || hasProcessing || hasRecoverableHistory) && canRecoverNow) {
        _lastRecoverStuckAt = nowTs;
        await API.recoverStuckMedia();
      }
    } catch (_) {}
    try {
      const hasProcessing = (Array.isArray(AppData.library) ? AppData.library : []).some((item) => {
        const status = String(item?.status || '').toLowerCase();
        return status === 'processing' || status === 'pending_qc';
      });
      const shouldRefreshLibrary = currentScreen === 'creator' || currentScreen === 'library' || currentScreen === 'dashboard' || hasProcessing;
        if (shouldRefreshLibrary) {
        const lib = await API.getLibrary();
        if (Array.isArray(lib)) {
          const normalizedLibrary = lib.map(normalizeLibraryItem).filter(shouldKeepLibraryItem);
          // Preserve locally-accumulated pct for in-progress items. A full refresh would
          // otherwise reset pct back to whatever the backend last persisted (e.g. 7%),
          // wiping synthetic increments and causing visible progress to jump backwards.
          const existingByTaskId = new Map(AppData.library.map(i => [String(i.taskId || i.id || ''), i]));
          normalizedLibrary.forEach(item => {
            const id = String(item.taskId || item.id || '');
            const existing = existingByTaskId.get(id);
            item.codeTag = getStableLibraryCodeTag(item, existing);
            if (
              existing &&
              String(existing.resultUrl || '').trim() &&
              ['done', 'approved', 'rejected', 'pending_qc'].includes(String(existing.status || '').toLowerCase()) &&
              ['processing', 'pending', 'running', 'queued'].includes(String(item.status || '').toLowerCase())
            ) {
              item.status = existing.status;
              item.qcStatus = existing.qcStatus || item.qcStatus || null;
              item.qcNote = existing.qcNote || item.qcNote || '';
              item.qcReviewer = existing.qcReviewer || item.qcReviewer || '';
              item.qcReviewedAt = existing.qcReviewedAt || item.qcReviewedAt || '';
              item.resultUrl = existing.resultUrl;
              item.coverUrl = existing.coverUrl || item.coverUrl || '';
              item.pct = 100;
              item.progress = 100;
              item.completedAt = existing.completedAt || item.completedAt || '';
              item.executionTime = existing.executionTime || item.executionTime || '';
              return;
            }
            if (existing && String(item.status || '').toLowerCase() === 'processing') {
              const keepPct = Math.max(Number(existing.pct || 0) || 0, Number(item.pct || 0) || 0);
              item.pct = keepPct;
              item.progress = keepPct;
            }
          });
          const beforeSignature = getLibraryCollectionSignature(AppData.library);
          const nextSignature = getLibraryCollectionSignature(normalizedLibrary);
          if (beforeSignature !== nextSignature) {
            AppData.library.splice(0, AppData.library.length, ...normalizedLibrary);
            if (typeof window.syncCreatorQCFromLibrary === 'function') {
              window.syncCreatorQCFromLibrary();
            }
            if (currentScreen === 'creator' && typeof window.hydrateCreatorFromRuntime === 'function') {
              window.hydrateCreatorFromRuntime();
            }
            if (currentScreen === 'library' && typeof scheduleLibraryRender === 'function') scheduleLibraryRender({ delay: 180 });
            if (currentScreen === 'dashboard') shouldRebuildDashboard = true;
            if (currentScreen === 'creator' && typeof window.renderLibraryIfChanged === 'function') {
              window.renderLibraryIfChanged(true);
            }
          }
        }
      }
    } catch (_) {}
    try {
      if (currentScreen === 'qc') {
        await refreshQCQueue({ silent: true });
      }
    } catch (_) {}
    if (currentScreen === 'dashboard' && shouldRebuildDashboard) {
      try {
        if (typeof isDashboardInteractionActive === 'function' && isDashboardInteractionActive()) {
          if (typeof dashboardRebuildPending !== 'undefined') dashboardRebuildPending = true;
        } else if (typeof flushPendingDashboardRebuild === 'function') {
          if (!flushPendingDashboardRebuild()) buildDashboard();
        } else {
          buildDashboard();
        }
      } catch (_) {}
    }
  }, 5000);
}

// ---- TOAST NOTIFICATIONS ----
function isCreditExhaustedUiMessage(message) {
  const text = String(message || '').trim().toLowerCase();
  if (!text) return false;
  return [
    'hết tiền',
    'het tien',
    'không đủ credit',
    'khong du credit',
    'không có key đơn lẻ đủ',
    'khong co key don le du',
    'key đơn lẻ',
    'key don le',
    'insufficient',
    'out of credit',
    'out of credits',
    'not enough credit',
    'credit exhausted',
    '402',
  ].some((token) => text.includes(token));
}

function showCreditExhaustedPopup() {
  const popupId = 'creditExhaustedPopup';
  const existing = document.getElementById(popupId);
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = popupId;
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.48);display:flex;align-items:center;justify-content:center;z-index:10040;padding:20px;';
  overlay.innerHTML = `
    <div style="width:min(460px,calc(100vw - 32px));background:var(--card);border:1px solid rgba(196,74,58,.45);border-radius:16px;box-shadow:0 16px 60px rgba(0,0,0,.5);overflow:hidden">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid var(--border);background:rgba(196,74,58,.10)">
        <div style="font-size:18px;font-weight:800;color:var(--red)">Hết tiền!</div>
        <button type="button" id="creditExhaustedPopupClose" style="width:34px;height:34px;border-radius:10px;border:1px solid var(--border);background:var(--bg2);color:var(--text);cursor:pointer"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div style="padding:20px 18px 10px;font-size:15px;line-height:1.6;color:var(--text);white-space:pre-wrap">Liên hệ QChi để nạp card!</div>
      <div style="display:flex;justify-content:flex-end;padding:0 18px 18px">
        <button type="button" id="creditExhaustedPopupOk" style="height:38px;padding:0 16px;border-radius:10px;border:1px solid rgba(196,74,58,.45);background:rgba(196,74,58,.14);color:var(--red);font-size:13px;font-weight:700;cursor:pointer">Đã hiểu</button>
      </div>
    </div>
  `;
  const close = () => overlay.remove();
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) close();
  });
  document.body.appendChild(overlay);
  document.getElementById('creditExhaustedPopupClose')?.addEventListener('click', close);
  document.getElementById('creditExhaustedPopupOk')?.addEventListener('click', close);
}

function showToast(msg, type = 'info') {
  if (isCreditExhaustedUiMessage(msg) && ['error', 'warning', 'info'].includes(String(type || '').trim().toLowerCase())) {
    showCreditExhaustedPopup();
    return;
  }
  if (window.AppMonitor && typeof window.AppMonitor.increment === 'function') {
    window.AppMonitor.increment(`toast_${String(type || 'info').trim().toLowerCase()}`);
  }
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
window.showCreditExhaustedPopup = showCreditExhaustedPopup;
