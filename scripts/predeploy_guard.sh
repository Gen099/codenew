#!/usr/bin/env bash
set -euo pipefail

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

require_file "$INDEX"
require_file "$CREATOR"
require_file "$SCREENS"
require_file "$APPJS"
require_file "$DATAJS"
require_file "$APIJS"

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
assert_contains "$SCREENS" "isSameStaffRef(row.staffId || row.username || '', qcStaffFilter)"
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

# 4) root and frontend must match for runtime-served files
assert_same_file "$APP_DIR/index.html" "$APP_DIR/frontend/index.html"
assert_same_file "$APP_DIR/js/api.js" "$APP_DIR/frontend/js/api.js"
assert_same_file "$APP_DIR/js/app.js" "$APP_DIR/frontend/js/app.js"
assert_same_file "$APP_DIR/js/data.js" "$APP_DIR/frontend/js/data.js"
assert_same_file "$APP_DIR/js/screens.js" "$APP_DIR/frontend/js/screens.js"
assert_same_file "$APP_DIR/js/creator.js" "$APP_DIR/frontend/js/creator.js"

# 5) JS syntax check (if node available)
if command -v node >/dev/null 2>&1; then
  node --check "$CREATOR" >/dev/null
  node --check "$SCREENS" >/dev/null
  node --check "$APPJS" >/dev/null
  node --check "$DATAJS" >/dev/null
  node --check "$APIJS" >/dev/null
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
