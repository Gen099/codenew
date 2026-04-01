#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/faistudio"
SRC_ENV="${1:-/opt/faistudio/.env.production}"
SECRETS_DIR="/opt/faistudio/.secrets"
DST_ENV="${SECRETS_DIR}/.env.production"

if [[ ! -f "$SRC_ENV" ]]; then
  echo "[ERROR] Source env file not found: $SRC_ENV"
  exit 1
fi

sudo mkdir -p "$SECRETS_DIR"
sudo cp "$SRC_ENV" "$DST_ENV"
sudo chmod 700 "$SECRETS_DIR"
sudo chmod 600 "$DST_ENV"

echo "[OK] Secrets prepared at $DST_ENV"
