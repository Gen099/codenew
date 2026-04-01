#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/faistudio"
SECRETS_FILE="/opt/faistudio/.secrets/.env.production"

cd "$APP_DIR"

if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "[ERROR] Missing secrets file: $SECRETS_FILE"
  exit 1
fi

if [[ -z "${UAT_USER:-}" || -z "${UAT_PASS:-}" ]]; then
  echo "[ERROR] Set UAT_USER and UAT_PASS before running."
  echo "Example: UAT_USER=admin UAT_PASS='your-pass' /opt/faistudio/uat-production.sh"
  exit 1
fi

public_port="$(grep '^PUBLIC_HTTP_PORT=' "$SECRETS_FILE" | head -n1 | cut -d'=' -f2-)"
if [[ -z "$public_port" ]]; then
  public_port="8080"
fi
base="http://127.0.0.1:${public_port}"

echo "[1/6] /health"
curl -fsS "${base}/health" >/dev/null

echo "[2/6] login"
login_json="$(curl -fsS -X POST "${base}/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${UAT_USER}\",\"password\":\"${UAT_PASS}\"}")"

status="$(printf '%s' "$login_json" | sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
if [[ "$status" != "ok" ]]; then
  echo "[ERROR] Login not ok. Response: $login_json"
  exit 1
fi

token="$(printf '%s' "$login_json" | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
if [[ -z "$token" ]]; then
  echo "[ERROR] Missing token in login response: $login_json"
  exit 1
fi

auth_header="Authorization: Bearer ${token}"

echo "[3/6] /api/auth/me"
curl -fsS "${base}/api/auth/me" -H "$auth_header" >/dev/null

echo "[4/6] /api/system/status"
curl -fsS "${base}/api/system/status" -H "$auth_header" >/dev/null

echo "[5/6] /api/history"
curl -fsS "${base}/api/history?limit=5" -H "$auth_header" >/dev/null

echo "[6/6] /api/credits/balance"
curl -fsS "${base}/api/credits/balance" -H "$auth_header" >/dev/null

echo "[OK] UAT basic flow passed"
