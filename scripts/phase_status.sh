#!/usr/bin/env bash
set -euo pipefail
trap 'rc=$?; echo "[PHASE][TRACE] ${BASH_SOURCE[0]}:${LINENO} :: ${BASH_COMMAND} (exit=${rc})"; exit "${rc}"' ERR

APP_DIR="${1:-/opt/faistudio}"

ok() { echo "[PHASE][OK] $1"; }
warn() { echo "[PHASE][WARN] $1"; }
fail() { echo "[PHASE][FAIL] $1"; exit 1; }

check_contains() {
  local f="$1"; local s="$2"
  grep -Fq "$s" "$f"
}

check_count_eq() {
  local f="$1"; local p="$2"; local n="$3"
  local c
  c="$(grep -Ec "$p" "$f" || true)"
  [[ "$c" == "$n" ]]
}

CREATOR="$APP_DIR/frontend/js/creator.js"
DATAJS="$APP_DIR/frontend/js/data.js"
APPJS="$APP_DIR/frontend/js/app.js"
SCREENS="$APP_DIR/frontend/js/screens.js"
MONITORJS="$APP_DIR/frontend/js/monitor.js"
INPUTASSETSPY="$APP_DIR/backend/routes/input_assets_routes.py"
KIEPY="$APP_DIR/backend/provider_kie.py"
VIDEOPY="$APP_DIR/backend/routes/video_routes.py"
SYSTEMPY="$APP_DIR/backend/routes/system_routes.py"
PROVIDER_ROUTES="$APP_DIR/backend/routes/provider_routes.py"
DATABASE_PY="$APP_DIR/backend/database.py"

[[ -f "$CREATOR" && -f "$DATAJS" && -f "$APPJS" && -f "$SCREENS" && -f "$MONITORJS" ]] || fail "Missing one or more frontend runtime files"

# Phase 1
check_count_eq "$CREATOR" '^function addTaskRow\(' "1" || fail "Phase 1: addTaskRow count mismatch"
check_count_eq "$CREATOR" '^function __addTaskRowSafe\(' "1" || fail "Phase 1: __addTaskRowSafe count mismatch"
check_contains "$CREATOR" "window.addTaskRow = addTaskRow;" || fail "Phase 1: missing addTaskRow binding"
check_contains "$CREATOR" "window.__addTaskRowSafe = __addTaskRowSafe;" || fail "Phase 1: missing __addTaskRowSafe binding"
ok "Phase 1 (Creator contracts)"

# Phase 2
check_contains "$DATAJS" "function getScopeUsername() {" || fail "Phase 2: missing getScopeUsername"
check_contains "$DATAJS" "function getViewProfile() {" || fail "Phase 2: missing getViewProfile"
check_contains "$APPJS" "const scopedUsername = String(getScopeUsername() || '').trim();" || fail "Phase 2: app scopedUsername not using getScopeUsername"
check_contains "$SCREENS" "const scopeUser = String(getScopeUsername() || '').trim();" || fail "Phase 2: screens scopeUser not using getScopeUsername"
ok "Phase 2 (viewContext scope)"

# Phase 2.1
check_contains "$DATAJS" "function isSameStaffRef(a, b) {" || fail "Phase 2.1: missing isSameStaffRef"
check_contains "$SCREENS" "isSameStaffRef(item.staffId, dashboardFilters.user)" || fail "Phase 2.1: dashboard filter not normalized"
check_contains "$SCREENS" "isSameStaffRef(row.staffId || row.username || '', qcFilters.staffId)" || fail "Phase 2.1: QC filter not normalized"
ok "Phase 2.1 (staff id/username normalization)"

# Phase 3
if check_contains "$APP_DIR/scripts/predeploy_guard.sh" "smoke_phase3.sh"; then
  ok "Phase 3 (smoke wired in predeploy_guard)"
else
  fail "Phase 3: smoke_phase3.sh not wired in predeploy_guard.sh"
fi

# Phase 4
check_contains "$CREATOR" "fd.append('file_name', newName);" || fail "Phase 4: missing upload file_name metadata"
check_contains "$CREATOR" "fd.append('width', String(Number(dims.width || 0)));" || fail "Phase 4: missing upload width metadata"
check_contains "$CREATOR" "fd.append('height', String(Number(dims.height || 0)));" || fail "Phase 4: missing upload height metadata"
check_contains "$INPUTASSETSPY" "def _extract_image_dimensions(content: bytes, mime_type: str = \"\") -> tuple[int, int]:" || fail "Phase 4: missing backend dimension extractor"
ok "Phase 4 (asset metadata and ratio)"

# Phase 5
check_contains "$KIEPY" "def _extract_media_url_deep(data, preferred_keys):" || fail "Phase 5: missing KIE media extractor"
check_contains "$VIDEOPY" "def _parse_legacy_video_payload(payload: dict) -> dict:" || fail "Phase 5: missing legacy video parser"
ok "Phase 5 (provider runtime parsing)"

# Phase 6
check_contains "$SYSTEMPY" "ACTIVE_RUNTIME_STATUSES = (\"pending\", \"processing\", \"running\", \"queued\")" || fail "Phase 6: missing runtime active statuses"
check_contains "$SYSTEMPY" "current_active_tasks = max(int(base.get(\"active_tasks\") or 0), active_task_count[username])" || fail "Phase 6: missing active task merge rule"
ok "Phase 6 (dashboard and presence runtime counts)"

# Phase 7
check_contains "$CREATOR" "<div class=\"cr-task-list\">" || fail "Phase 7: missing div task list"
check_contains "$CREATOR" ".cr-task-row-shell[data-task-idx=" || fail "Phase 7: missing row shell rerender"
ok "Phase 7 (creator div layout)"

# Phase 8
check_contains "$PROVIDER_ROUTES" "\"P1 credits refresh\"" || fail "Phase 8: missing provider1 credit audit log"
check_contains "$SCREENS" "P1:" || fail "Phase 8: missing provider1 key status"
ok "Phase 8 (provider1 key audit and credit refresh history)"

# Phase 9
check_contains "$DATABASE_PY" "def _seed_users_enabled() -> bool:" || fail "Phase 9: missing seed policy helper"
check_contains "$DATABASE_PY" "Production bootstrap user requires APP_BOOTSTRAP_ADMIN_PASSWORD with a non-weak value when APP_SEED_USERS=true" || fail "Phase 9: missing production bootstrap guard"
check_contains "$APPJS" "function resetClientAuthState() {" || fail "Phase 9: missing client auth reset"
ok "Phase 9 (bootstrap security and client auth cleanup)"

echo "[PHASE][DONE] All target phases are present"
