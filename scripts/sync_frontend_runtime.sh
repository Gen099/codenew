#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/opt/faistudio}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "[ERROR] APP_DIR not found: $APP_DIR"
  exit 1
fi

copy_file() {
  local src="$1"
  local dst="$2"
  if [[ ! -f "$src" ]]; then
    echo "[ERROR] Missing source file: $src"
    exit 1
  fi
  install -m 644 "$src" "$dst"
}

copy_file "$APP_DIR/index.html" "$APP_DIR/frontend/index.html"
copy_file "$APP_DIR/js/api.js" "$APP_DIR/frontend/js/api.js"
copy_file "$APP_DIR/js/app.js" "$APP_DIR/frontend/js/app.js"
copy_file "$APP_DIR/js/data.js" "$APP_DIR/frontend/js/data.js"
copy_file "$APP_DIR/js/screens.js" "$APP_DIR/frontend/js/screens.js"
copy_file "$APP_DIR/js/creator.js" "$APP_DIR/frontend/js/creator.js"

echo "[OK] Synced runtime frontend files from root source"
