#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/faistudio"
SECRETS_FILE="/opt/faistudio/.secrets/.env.production"
COMPOSE_FILE="docker-compose.production.yml"

cd "$APP_DIR"

if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "[ERROR] Missing secrets file: $SECRETS_FILE"
  exit 1
fi

public_port="$(grep '^PUBLIC_HTTP_PORT=' "$SECRETS_FILE" | head -n1 | cut -d'=' -f2-)"
if [[ -z "$public_port" ]]; then
  public_port="8080"
fi

echo "[1/5] Container status"
ENV_FILE_PATH="$SECRETS_FILE" docker compose -f "$COMPOSE_FILE" ps

echo "[2/5] API container health"
api_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' faistudio-api 2>/dev/null || true)"
if [[ "$api_health" != "healthy" ]]; then
  echo "[ERROR] API not healthy: $api_health"
  ENV_FILE_PATH="$SECRETS_FILE" docker compose -f "$COMPOSE_FILE" logs --tail=120 api
  exit 1
fi

echo "[3/5] Nginx /health"
curl -fsS "http://127.0.0.1:${public_port}/health" >/dev/null

echo "[4/5] API docs via nginx proxy"
curl -fsS "http://127.0.0.1:${public_port}/docs" >/dev/null

echo "[5/5] CORS preflight basic check"
origin="$(grep '^PUBLIC_URL=' "$SECRETS_FILE" | head -n1 | cut -d'=' -f2-)"
if [[ -z "$origin" ]]; then
  origin="http://localhost:${public_port}"
fi
curl -s -o /dev/null -D - -X OPTIONS "http://127.0.0.1:${public_port}/api/system/status" \
  -H "Origin: ${origin}" \
  -H "Access-Control-Request-Method: GET" | grep -qi "access-control-allow-origin" || {
  echo "[ERROR] Missing CORS allow-origin header"
  exit 1
}

echo "[OK] Smoke test passed"
