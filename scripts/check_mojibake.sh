#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/opt/faistudio}"

FILES=(
  "$APP_DIR/frontend/index.html"
  "$APP_DIR/frontend/js/app.js"
  "$APP_DIR/frontend/js/screens.js"
  "$APP_DIR/frontend/js/creator.js"
  "$APP_DIR/frontend/js/api.js"
  "$APP_DIR/frontend/js/data.js"
)

PATTERNS=(
  "�"
  "T\\?t c\\?"
  "T\\?i L\\?"
  "Ngu\\?n"
  "\\?nh"
  "ch\\?a c\\?"
  "H\\?y"
  "tr\\?ng th\\?i"
  "Khong xac dinh"
  "Loi addTaskRow"
  "Phai tao CODE truoc"
  "Tai v\\?"
  "Loi render"
  "\\?\\? g\\?i task"
  "B\\?m n\\?t"
  "du\\?c"
  "dang m\\?"
  "B\\?t d\\?u"
  "k\\?t th"
  "Th\\?i gian"
  "Chi ti\\?t"
  "Nh\\?n s\\?"
  "Ho\\?t d\\?ng"
  "L\\?u "
  "Ph\\?i g\\?i"
  "Quy d\\?i"
  "T\\?o task"
  "Th\\?m D\\?ng"
  "G\\?i QC"
  "Ch\\?y T\\?t C\\?"
)

hit=0
for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || continue
  # app.js intentionally contains mojibake tokens inside UI_MOJIBAKE_FIXES map
  # to normalize broken text at runtime. Exclude that block from scanning.
  scan_target="$f"
  tmp_file=""
  if [[ "$f" == *"/frontend/js/app.js" ]]; then
    tmp_file="$(mktemp)"
    awk '
      /const UI_MOJIBAKE_FIXES = \[/ { skip=1; next }
      skip && /\];/ { skip=0; next }
      !skip { print }
    ' "$f" > "$tmp_file"
    scan_target="$tmp_file"
  fi
  for p in "${PATTERNS[@]}"; do
    if grep -nE "$p" "$scan_target" >/dev/null 2>&1; then
      grep -nE "$p" "$scan_target" || true
      hit=1
    fi
  done
  if [[ -n "$tmp_file" && -f "$tmp_file" ]]; then
    rm -f "$tmp_file"
  fi
done

if [[ "$hit" -ne 0 ]]; then
  echo "[MOJIBAKE][ERROR] Found mojibake-like strings"
  exit 1
fi

echo "[MOJIBAKE][OK] No mojibake patterns found"
