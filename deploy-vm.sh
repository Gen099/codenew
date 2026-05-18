#!/usr/bin/env bash
set -euo pipefail
trap 'rc=$?; echo "[DEPLOY][ERROR] ${BASH_SOURCE[0]}:${LINENO} :: ${BASH_COMMAND} (exit=${rc})"; exit "${rc}"' ERR

APP_DIR="${APP_DIR:-/opt/faistudio}"
SOURCE_DIR="${SOURCE_DIR:-}"
RUNTIME_SCRIPT="${APP_DIR}/scripts/deploy_runtime.sh"
SYNC_SCRIPT="${APP_DIR}/scripts/sync_source_to_runtime.sh"

if [[ ! -f "$RUNTIME_SCRIPT" ]]; then
  echo "[DEPLOY][ERROR] Missing runtime deploy script: $RUNTIME_SCRIPT"
  exit 1
fi

sync_from_source() {
  if [[ -z "$SOURCE_DIR" ]]; then
    return 0
  fi
  if [[ ! -d "$SOURCE_DIR" ]]; then
    echo "[DEPLOY][ERROR] SOURCE_DIR not found: $SOURCE_DIR"
    exit 1
  fi
  if [[ ! -f "$SYNC_SCRIPT" ]]; then
    echo "[DEPLOY][ERROR] Missing sync script: $SYNC_SCRIPT"
    exit 1
  fi
  echo "[DEPLOY] Sync source from $SOURCE_DIR"
  bash "$SYNC_SCRIPT" "$SOURCE_DIR" "$APP_DIR"
}

pull_runtime_repo() {
  if [[ -n "$SOURCE_DIR" ]]; then
    return 0
  fi
  if [[ ! -d "$APP_DIR/.git" ]]; then
    echo "[DEPLOY] Skip git pull: $APP_DIR is not a git repo"
    return 0
  fi
  if ! git -C "$APP_DIR" remote get-url origin >/dev/null 2>&1; then
    echo "[DEPLOY] Skip git pull: origin remote not configured"
    return 0
  fi
  echo "[DEPLOY] git pull --ff-only in $APP_DIR"
  git -C "$APP_DIR" pull --ff-only
}

sync_from_source
pull_runtime_repo

exec bash "$RUNTIME_SCRIPT" "$@"
