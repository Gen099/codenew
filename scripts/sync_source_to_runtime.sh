#!/usr/bin/env bash
set -euo pipefail
trap 'rc=$?; echo "[SYNC-SOURCE][ERROR] ${BASH_SOURCE[0]}:${LINENO} :: ${BASH_COMMAND} (exit=${rc})"; exit "${rc}"' ERR

SOURCE_DIR="${1:-}"
APP_DIR="${2:-/opt/faistudio}"

if [[ -z "$SOURCE_DIR" ]]; then
  echo "[SYNC-SOURCE][ERROR] Usage: bash scripts/sync_source_to_runtime.sh <source_dir> [app_dir]"
  exit 1
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "[SYNC-SOURCE][ERROR] Source dir not found: $SOURCE_DIR"
  exit 1
fi

run_root() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

run_root mkdir -p "$APP_DIR"

run_root rsync -av --delete \
  --exclude '.git' \
  --exclude '.env' \
  --exclude '.env.production' \
  --exclude '.secrets' \
  --exclude 'node_modules' \
  --exclude 'test-results' \
  --exclude 'playwright-report' \
  "$SOURCE_DIR"/ "$APP_DIR"/

echo "[SYNC-SOURCE][OK] Synced source from $SOURCE_DIR to $APP_DIR"
