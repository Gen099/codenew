#!/usr/bin/env bash
set -euo pipefail

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

[[ -f "$CREATOR" && -f "$DATAJS" && -f "$APPJS" && -f "$SCREENS" ]] || fail "Missing one or more frontend runtime files"

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
check_contains "$SCREENS" "isSameStaffRef(row.staffId || row.username || '', qcStaffFilter)" || fail "Phase 2.1: QC filter not normalized"
ok "Phase 2.1 (staff id/username normalization)"

# Phase 3
if check_contains "$APP_DIR/scripts/predeploy_guard.sh" "smoke_phase3.sh"; then
  ok "Phase 3 (smoke wired in predeploy_guard)"
else
  fail "Phase 3: smoke_phase3.sh not wired in predeploy_guard.sh"
fi

echo "[PHASE][DONE] All target phases are present"

