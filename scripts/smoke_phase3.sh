#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/opt/faistudio}"

die() {
  echo "[SMOKE][ERROR] $1"
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

assert_count() {
  local f="$1"
  local pattern="$2"
  local expected="$3"
  local found
  found="$(grep -Ec "$pattern" "$f" || true)"
  [[ "$found" == "$expected" ]] || die "Unexpected count in $(basename "$f") for /$pattern/: expected=$expected found=$found"
}

CREATOR="$APP_DIR/frontend/js/creator.js"
SCREENS="$APP_DIR/frontend/js/screens.js"
APPJS="$APP_DIR/frontend/js/app.js"
DATAJS="$APP_DIR/frontend/js/data.js"

require_file "$CREATOR"
require_file "$SCREENS"
require_file "$APPJS"
require_file "$DATAJS"

# 1) Add-row must not recurse, must have one primary handler binding
assert_contains "$CREATOR" "window.addTaskRow = addTaskRow;"
assert_not_contains "$CREATOR" "window.addTaskRow = __addTaskRowSafe;"
assert_count "$CREATOR" '^function addTaskRow\(' "1"
assert_count "$CREATOR" '^function __addTaskRowSafe\(' "1"

# 2) View scope contract across dashboard/qc/credits/library
assert_contains "$DATAJS" "function getScopeUsername() {"
assert_contains "$DATAJS" "function getViewProfile() {"
assert_contains "$DATAJS" "function isSameStaffRef(a, b) {"
assert_contains "$SCREENS" "const scopeUser = String(getScopeUsername() || '').trim();"
assert_contains "$SCREENS" "isSameStaffRef(item.staffId, dashboardFilters.user)"
assert_contains "$SCREENS" "isSameStaffRef(row.staffId || row.username || '', qcStaffFilter)"
assert_contains "$APPJS" "const scopedUsername = String(getScopeUsername() || '').trim();"
assert_contains "$APPJS" "const currentUsername = String(getScopeUsername() || '').toLowerCase();"
assert_contains "$APPJS" "const viewProfile = (typeof getViewProfile === 'function') ? getViewProfile() : (AppData.currentUser || {});"

# 3) Hard regressions forbidden
assert_not_contains "$SCREENS" "scopeUser = String(AppData.currentUser?.username || '').trim();"
assert_not_contains "$APPJS" "scopedUsername = String(AppData.currentUser?.username || '').trim();"
assert_not_contains "$APPJS" "currentUsername = String(AppData.currentUser?.username || '').toLowerCase();"

echo "[SMOKE][OK] Phase3 smoke passed"

