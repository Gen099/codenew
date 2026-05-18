#!/usr/bin/env bash
set -euo pipefail
trap 'rc=$?; echo "[SYNC][TRACE] ${BASH_SOURCE[0]}:${LINENO} :: ${BASH_COMMAND} (exit=${rc})"; exit "${rc}"' ERR

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

copy_file_if_exists() {
  local src="$1"
  local dst="$2"
  if [[ ! -f "$src" ]]; then
    return 0
  fi
  install -m 644 "$src" "$dst"
}

copy_file "$APP_DIR/index.html" "$APP_DIR/frontend/index.html"
copy_file_if_exists "$APP_DIR/docs.html" "$APP_DIR/frontend/docs.html"
copy_file_if_exists "$APP_DIR/css/docs.css" "$APP_DIR/frontend/css/docs.css"
copy_file "$APP_DIR/js/api.js" "$APP_DIR/frontend/js/api.js"
copy_file "$APP_DIR/js/app.js" "$APP_DIR/frontend/js/app.js"
copy_file "$APP_DIR/js/data.js" "$APP_DIR/frontend/js/data.js"
copy_file_if_exists "$APP_DIR/js/docs.js" "$APP_DIR/frontend/js/docs.js"
copy_file_if_exists "$APP_DIR/js/monitor.js" "$APP_DIR/frontend/js/monitor.js"
copy_file "$APP_DIR/js/screens.js" "$APP_DIR/frontend/js/screens.js"
copy_file "$APP_DIR/js/creator.js" "$APP_DIR/frontend/js/creator.js"

if [[ -d "$APP_DIR/docs-content" ]]; then
  mkdir -p "$APP_DIR/frontend/docs-content"
  rsync -a --delete "$APP_DIR/docs-content"/ "$APP_DIR/frontend/docs-content"/
fi

echo "[OK] Synced runtime frontend files from root source"
