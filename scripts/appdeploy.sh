#!/usr/bin/env bash
set -euo pipefail
trap 'rc=$?; echo "[APPDEPLOY][ERROR] ${BASH_SOURCE[0]}:${LINENO} :: ${BASH_COMMAND} (exit=${rc})"; exit "${rc}"' ERR

APP_DIR="${APP_DIR:-/opt/faistudio}"
ENV_FILE_PATH="${ENV_FILE_PATH:-/opt/faistudio/.secrets/.env.production}"
DEPLOY_SCRIPT="${APP_DIR}/deploy-vm.sh"

if [[ ! -f "$DEPLOY_SCRIPT" ]]; then
  echo "[APPDEPLOY][ERROR] Missing deploy script: $DEPLOY_SCRIPT"
  exit 1
fi

exec bash "$DEPLOY_SCRIPT" "$@"
