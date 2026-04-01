#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/faistudio"
SECRETS_FILE="/opt/faistudio/.secrets/.env.production"
COMPOSE_FILE="docker-compose.production.yml"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-180}"
HEALTH_POLL_SEC="${HEALTH_POLL_SEC:-5}"

cd "$APP_DIR"

if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "[ERROR] Missing secrets file: $SECRETS_FILE"
  exit 1
fi

echo "[1/5] Validate secrets"
grep -q '^SECRET_KEY=' "$SECRETS_FILE"
grep -q '^POSTGRES_PASSWORD=' "$SECRETS_FILE"
grep -q '^DATABASE_URL=' "$SECRETS_FILE"
grep -q '^TELEGRAM_BOT_TOKEN=' "$SECRETS_FILE"
grep -q '^CORS_ORIGINS=' "$SECRETS_FILE"

secret_key="$(grep '^SECRET_KEY=' "$SECRETS_FILE" | head -n1 | cut -d'=' -f2-)"
if [[ ${#secret_key} -lt 32 ]]; then
  echo "[ERROR] SECRET_KEY must be at least 32 chars"
  exit 1
fi
if [[ "$secret_key" == "videotool-secret" || "$secret_key" == "CHANGE_THIS_TO_STRONG_RANDOM_SECRET" ]]; then
  echo "[ERROR] SECRET_KEY is placeholder/weak"
  exit 1
fi

db_pass="$(grep '^POSTGRES_PASSWORD=' "$SECRETS_FILE" | head -n1 | cut -d'=' -f2-)"
db_url="$(grep '^DATABASE_URL=' "$SECRETS_FILE" | head -n1 | cut -d'=' -f2-)"
if [[ -z "$db_pass" || -z "$db_url" ]]; then
  echo "[ERROR] Missing DB credentials"
  exit 1
fi
if [[ "$db_pass" == *"@"* && "$db_url" != *"%40"* ]]; then
  echo "[ERROR] DATABASE_URL likely invalid: password contains '@' but URL has no '%40' encoding"
  exit 1
fi

echo "[1.1/5] Validate compose"
ENV_FILE_PATH="$SECRETS_FILE" docker compose -f "$COMPOSE_FILE" config >/dev/null

echo "[1.2/5] Sync frontend runtime files"
bash "$APP_DIR/scripts/sync_frontend_runtime.sh" "$APP_DIR"

echo "[1.3/7] Run predeploy guard"
bash "$APP_DIR/scripts/predeploy_guard.sh" "$APP_DIR"

echo "[1.4/7] Run phase3 smoke"
bash "$APP_DIR/scripts/smoke_phase3.sh" "$APP_DIR"

echo "[1.5/7] Verify phase status"
bash "$APP_DIR/scripts/phase_status.sh" "$APP_DIR"

echo "[2/7] Deploy stack"
ENV_FILE_PATH="$SECRETS_FILE" docker compose -f "$COMPOSE_FILE" up -d --build --force-recreate

echo "[3/7] Wait health (timeout ${HEALTH_TIMEOUT_SEC}s)"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SEC ))
while true; do
  api_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' faistudio-api 2>/dev/null || true)"
  pg_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' faistudio-postgres 2>/dev/null || true)"
  if [[ "$api_status" == "healthy" && "$pg_status" == "healthy" ]]; then
    break
  fi
  if [[ $(date +%s) -ge $deadline ]]; then
    echo "[ERROR] Health timeout. api=$api_status postgres=$pg_status"
    ENV_FILE_PATH="$SECRETS_FILE" docker compose -f "$COMPOSE_FILE" ps
    ENV_FILE_PATH="$SECRETS_FILE" docker compose -f "$COMPOSE_FILE" logs --tail=120 api
    exit 1
  fi
  sleep "$HEALTH_POLL_SEC"
done

public_port="$(grep '^PUBLIC_HTTP_PORT=' "$SECRETS_FILE" | head -n1 | cut -d'=' -f2-)"
if [[ -z "$public_port" ]]; then
  public_port="8080"
fi
if ! curl -fsS "http://127.0.0.1:${public_port}/health" >/dev/null; then
  echo "[ERROR] Nginx /health check failed on port ${public_port}"
  ENV_FILE_PATH="$SECRETS_FILE" docker compose -f "$COMPOSE_FILE" logs --tail=120 nginx
  exit 1
fi
ENV_FILE_PATH="$SECRETS_FILE" docker compose -f "$COMPOSE_FILE" ps

echo "[4/7] Tail api logs"
ENV_FILE_PATH="$SECRETS_FILE" docker compose -f "$COMPOSE_FILE" logs --tail=80 api

echo "[5/7] Frontend version pointers"
docker exec faistudio-nginx sh -lc "grep -n 'js/screens.js?v=' /usr/share/nginx/html/index.html || true"
docker exec faistudio-nginx sh -lc "grep -n 'js/creator.js?v=' /usr/share/nginx/html/index.html || true"

echo "[6/7] Compose status"
ENV_FILE_PATH="$SECRETS_FILE" docker compose -f "$COMPOSE_FILE" ps

echo "[7/7] Done"
echo "[DONE] Deploy completed"
