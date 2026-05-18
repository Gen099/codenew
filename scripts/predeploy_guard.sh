#!/usr/bin/env bash
set -euo pipefail
trap 'rc=$?; echo "[GUARD][TRACE] ${BASH_SOURCE[0]}:${LINENO} :: ${BASH_COMMAND} (exit=${rc})"; exit "${rc}"' ERR

APP_DIR="${1:-/opt/faistudio}"

die() {
  echo "[GUARD][ERROR] $1"
  exit 1
}

require_file() {
  local f="$1"
  [[ -f "$f" ]] || die "Missing file: $f"
}

assert_contains() {
  local f="$1"
  local text="$2"
  grep -Fq "$text" "$f" || die "Missing expected text in $(basename "$f"): $text"
}

assert_not_contains() {
  local f="$1"
  local text="$2"
  if grep -Fq "$text" "$f"; then
    die "Found forbidden text in $(basename "$f"): $text"
  fi
}

assert_regex() {
  local f="$1"
  local pattern="$2"
  grep -Eq "$pattern" "$f" || die "Missing expected pattern in $(basename "$f"): $pattern"
}

assert_same_file() {
  local a="$1"
  local b="$2"
  cmp -s "$a" "$b" || die "File mismatch: $a != $b (run scripts/sync_frontend_runtime.sh)"
}

INDEX="$APP_DIR/frontend/index.html"
CREATOR="$APP_DIR/frontend/js/creator.js"
SCREENS="$APP_DIR/frontend/js/screens.js"
APPJS="$APP_DIR/frontend/js/app.js"
DATAJS="$APP_DIR/frontend/js/data.js"
APIJS="$APP_DIR/frontend/js/api.js"
MONITORJS="$APP_DIR/frontend/js/monitor.js"
KIEPY="$APP_DIR/backend/provider_kie.py"
VIDEOPY="$APP_DIR/backend/routes/video_routes.py"
SYSTEMPY="$APP_DIR/backend/routes/system_routes.py"
MAINPY="$APP_DIR/backend/main.py"
AUTHPY="$APP_DIR/backend/routes/auth_routes.py"
INPUTASSETSPY="$APP_DIR/backend/routes/input_assets_routes.py"

require_file "$INDEX"
require_file "$CREATOR"
require_file "$SCREENS"
require_file "$APPJS"
require_file "$DATAJS"
require_file "$APIJS"
require_file "$MONITORJS"
require_file "$KIEPY"
require_file "$VIDEOPY"
require_file "$SYSTEMPY"
require_file "$MAINPY"
require_file "$AUTHPY"
require_file "$INPUTASSETSPY"

# 0) legacy runtime assets must not exist in source-of-truth
forbidden_legacy=(
  "$APP_DIR/js/creator.v36.js"
  "$APP_DIR/js/creator.v37.js"
  "$APP_DIR/frontend/js/creator.v36.js"
  "$APP_DIR/frontend/js/creator.v37.js"
)
for legacy in "${forbidden_legacy[@]}"; do
  [[ ! -f "$legacy" ]] || die "Legacy runtime file must be removed: $legacy"
done

# 1) runtime assets must include cache-busting query
grep -Eq 'js/screens\.js\?v=' "$INDEX" || die "index.html missing screens.js version query"
grep -Eq 'js/creator\.js\?v=' "$INDEX" || die "index.html missing creator.js version query"
assert_not_contains "$INDEX" "creator.v36.js"
assert_not_contains "$INDEX" "creator.v37.js"

# 2) critical Creator contract
count_addtaskrow="$(grep -Ec '^function addTaskRow\(' "$CREATOR" || true)"
[[ "$count_addtaskrow" == "1" ]] || die "creator.js must have exactly 1 function addTaskRow(), found: $count_addtaskrow"
count_safe="$(grep -Ec '^function __addTaskRowSafe\(' "$CREATOR" || true)"
[[ "$count_safe" == "1" ]] || die "creator.js must have exactly 1 function __addTaskRowSafe(), found: $count_safe"
assert_contains "$CREATOR" "window.addTaskRow = addTaskRow;"
assert_contains "$CREATOR" "window.__addTaskRowSafe = __addTaskRowSafe;"
count_media_profile="$(grep -Ec '^function getTaskMediaProfile\(' "$CREATOR" || true)"
[[ "$count_media_profile" == "1" ]] || die "creator.js must have exactly 1 function getTaskMediaProfile(), found: $count_media_profile"
count_apply_media_profile="$(grep -Ec '^function applyTaskMediaProfile\(' "$CREATOR" || true)"
[[ "$count_apply_media_profile" == "1" ]] || die "creator.js must have exactly 1 function applyTaskMediaProfile(), found: $count_apply_media_profile"

# 3) UI regression checks (encoding-safe patterns)
assert_contains "$SCREENS" "updateStaffFilters('role', this.value)"
assert_contains "$SCREENS" "updateStaffFilters('status', this.value)"
assert_contains "$SCREENS" "setLibraryFilter('code', this.value)"
assert_contains "$SCREENS" "setLibraryFilter('status', this.value)"
assert_contains "$SCREENS" "const scopeUser = String(getScopeUsername() || '').trim();"
assert_contains "$APPJS" "const scopedUsername = String(getScopeUsername() || '').trim();"
assert_contains "$APPJS" "const currentUsername = String(getScopeUsername() || '').toLowerCase();"
assert_contains "$APPJS" "const viewProfile = (typeof getViewProfile === 'function') ? getViewProfile() : (AppData.currentUser || {});"
assert_contains "$SCREENS" "const viewProfile = (typeof getViewProfile === 'function') ? getViewProfile() : (AppData.currentUser || {});"
assert_contains "$DATAJS" "function isSameStaffRef(a, b) {"
assert_contains "$SCREENS" "isSameStaffRef(item.staffId, dashboardFilters.user)"
assert_contains "$SCREENS" "isSameStaffRef(row.staffId || row.username || '', qcFilters.staffId)"
assert_not_contains "$SCREENS" "scopeUser = String(AppData.currentUser?.username || '').trim();"
assert_not_contains "$APPJS" "scopedUsername = String(AppData.currentUser?.username || '').trim();"
assert_not_contains "$APPJS" "currentUsername = String(AppData.currentUser?.username || '').toLowerCase();"
assert_regex "$SCREENS" 'option value="">[^<]*role</option>'
assert_regex "$SCREENS" 'option value="">[^<]*status</option>'
assert_regex "$SCREENS" 'option value="">[^<]*Code</option>'
assert_not_contains "$SCREENS" "c? role"
assert_not_contains "$SCREENS" "c? status"
assert_not_contains "$SCREENS" "c? Code"
assert_not_contains "$SCREENS" "T?t c?"
assert_not_contains "$APPJS" "await API.cleanupLibraryNoResult(cleanupScope);"
assert_contains "$APPJS" "const [usersRes, libraryRes, historyRes, systemStatusRes, shiftConfigRes, activeWorkTaskRes, currentShiftSummaryRes, workTasksRes, providerSettingsRes, providerCatalogRes, shiftReportsRes, qcQueueRes] = await Promise.all(["
assert_contains "$APIJS" "async parseResponse(res) {"
assert_contains "$APIJS" "return this.post('/api/video/batch', { items: tasks });"
assert_not_contains "$APIJS" "return this.post('/api/video/batch', { tasks });"
assert_not_contains "$MAINPY" "_ROLE_PERMISSIONS = {"
assert_not_contains "$MAINPY" "_ROLE_ALIASES = {"
assert_contains "$MAINPY" "from routes.auth_routes import ("
assert_contains "$MAINPY" "build_auth_user_payload,"
assert_contains "$MAINPY" "normalize_role_id,"
assert_contains "$MAINPY" "user_has_permission,"
assert_contains "$CREATOR" "const hasDraftState = loadCreatorDraftState();"
assert_not_contains "$CREATOR" "if (!hasDraftState) _hydrateCreatorCombosFromRuntimeData();"
assert_contains "$CREATOR" "autoPollRunningTasks();"
assert_contains "$CREATOR" "if (field === 'prompt') {"
assert_contains "$CREATOR" "scheduleSaveCreatorDraftState(180);"
assert_contains "$CREATOR" "fd.append('file_name', newName);"
assert_contains "$CREATOR" "fd.append('width', String(Number(dims.width || 0)));"
assert_contains "$CREATOR" "fd.append('height', String(Number(dims.height || 0)));"
assert_contains "$INPUTASSETSPY" "def _extract_image_dimensions(content: bytes, mime_type: str = \"\") -> tuple[int, int]:"
assert_not_contains "$INPUTASSETSPY" "\"width\": 0,"
assert_not_contains "$INPUTASSETSPY" "\"height\": 0,"
assert_contains "$KIEPY" "def _extract_media_url_deep(data, preferred_keys):"
assert_contains "$KIEPY" "if kie_status in (\"succeed\", \"completed\", \"complete\", \"success\", \"done\", \"finished\", 2):"
assert_contains "$KIEPY" "elif kie_status in (\"failed\", \"fail\", \"error\", \"cancelled\", \"canceled\", 3):"
assert_contains "$VIDEOPY" "def _normalize_legacy_video_state(status_code, result_url: str = \"\", fail_msg: str = \"\") -> str:"
assert_contains "$VIDEOPY" "def _parse_legacy_video_payload(payload: dict) -> dict:"
assert_contains "$VIDEOPY" "parsed = _parse_legacy_video_payload(payload)"
assert_contains "$SYSTEMPY" "ACTIVE_RUNTIME_STATUSES = (\"pending\", \"processing\", \"running\", \"queued\")"
assert_contains "$SYSTEMPY" "lower(COALESCE(status,'')) IN ("
assert_contains "$SYSTEMPY" "current_active_tasks = max(int(base.get(\"active_tasks\") or 0), active_task_count[username])"
assert_contains "$CREATOR" "<div class=\"cr-task-list\">"
assert_contains "$CREATOR" "<div class=\"cr-task-list-head\">"
assert_contains "$CREATOR" "body.querySelector('.cr-task-empty-state')"
assert_contains "$CREATOR" ".cr-task-row-shell[data-task-idx="
assert_contains "$CREATOR" ".cr-task-list-head { display:grid;"
assert_not_contains "$CREATOR" ".cr-task-table {"
assert_contains "$APIJS" "async getProviderCredits(providerId, { audit = false } = {}) {"
assert_contains "$SCREENS" "status.textContent ="
assert_contains "$SCREENS" "P1:"
assert_contains "$APP_DIR/backend/routes/provider_routes.py" "IN ('key_management', 'credits_refresh')"
assert_contains "$APP_DIR/backend/routes/provider_routes.py" "\"P1 credits refresh\""
assert_contains "$APP_DIR/backend/database.py" "def _seed_users_enabled() -> bool:"
assert_contains "$APP_DIR/backend/database.py" "def _bootstrap_admin_password() -> str:"
assert_contains "$APP_DIR/backend/database.py" "Production bootstrap user requires APP_BOOTSTRAP_ADMIN_PASSWORD with a non-weak value when APP_SEED_USERS=true"
assert_not_contains "$APP_DIR/backend/database.py" "(\"admin\", \"admin123\", \"Admin\", \"admin\")"
assert_contains "$APPJS" "function resetClientAuthState() {"
assert_contains "$APPJS" "AppData.authSession = { userId: '', username: '', role: '', permissions: [] };"
assert_contains "$APPJS" "AppData.viewContext = { userId: '', username: '', mode: 'self' };"

# 4) root and frontend must match for runtime-served files
assert_same_file "$APP_DIR/index.html" "$APP_DIR/frontend/index.html"
assert_same_file "$APP_DIR/js/api.js" "$APP_DIR/frontend/js/api.js"
assert_same_file "$APP_DIR/js/app.js" "$APP_DIR/frontend/js/app.js"
assert_same_file "$APP_DIR/js/data.js" "$APP_DIR/frontend/js/data.js"
assert_same_file "$APP_DIR/js/monitor.js" "$APP_DIR/frontend/js/monitor.js"
assert_same_file "$APP_DIR/js/screens.js" "$APP_DIR/frontend/js/screens.js"
assert_same_file "$APP_DIR/js/creator.js" "$APP_DIR/frontend/js/creator.js"

# 5) JS syntax check (if node available)
if command -v node >/dev/null 2>&1; then
  node --check "$CREATOR" >/dev/null
  node --check "$SCREENS" >/dev/null
  node --check "$APPJS" >/dev/null
  node --check "$DATAJS" >/dev/null
  node --check "$APIJS" >/dev/null
  node --check "$MONITORJS" >/dev/null
else
  echo "[GUARD][WARN] node not found, skipped syntax checks"
fi

# 6) mojibake check
if [[ -x "$APP_DIR/scripts/check_mojibake.sh" ]]; then
  bash "$APP_DIR/scripts/check_mojibake.sh" "$APP_DIR"
else
  echo "[GUARD][WARN] check_mojibake.sh not executable, skipped"
fi

# 7) phase smoke checks
if [[ -x "$APP_DIR/scripts/smoke_phase3.sh" ]]; then
  bash "$APP_DIR/scripts/smoke_phase3.sh" "$APP_DIR"
else
  echo "[GUARD][WARN] smoke_phase3.sh not executable, skipped"
fi

echo "[GUARD][OK] Predeploy guard passed"
