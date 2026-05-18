#!/usr/bin/env bash
set -euo pipefail
trap 'rc=$?; echo "[DEPLOY-RUNTIME][ERROR] ${BASH_SOURCE[0]}:${LINENO} :: ${BASH_COMMAND} (exit=${rc})"; exit "${rc}"' ERR

APP_DIR="${APP_DIR:-/opt/faistudio}"
SECRETS_FILE="${SECRETS_FILE:-/opt/faistudio/.secrets/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-/opt/faistudio/docker-compose.production.yml}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-180}"
HEALTH_POLL_SEC="${HEALTH_POLL_SEC:-5}"

log() {
  echo "[DEPLOY-RUNTIME] $1"
}

run_root() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

require_file() {
  local path="$1"
  [[ -f "$path" ]] || {
    echo "[DEPLOY-RUNTIME][ERROR] Missing file: $path"
    exit 1
  }
}

wait_for_health() {
  local deadline
  deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SEC ))
  while true; do
    local api_status pg_status
    api_status="$(run_root docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' faistudio-api 2>/dev/null || true)"
    pg_status="$(run_root docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' faistudio-postgres 2>/dev/null || true)"
    if [[ "$api_status" == "healthy" && "$pg_status" == "healthy" ]]; then
      log "Health OK: api=$api_status postgres=$pg_status"
      return 0
    fi
    if [[ $(date +%s) -ge $deadline ]]; then
      echo "[DEPLOY-RUNTIME][ERROR] Health timeout. api=$api_status postgres=$pg_status"
      run_root env ENV_FILE_PATH="$SECRETS_FILE" docker compose -f "$COMPOSE_FILE" ps || true
      run_root env ENV_FILE_PATH="$SECRETS_FILE" docker compose -f "$COMPOSE_FILE" logs --tail=120 api || true
      exit 1
    fi
    sleep "$HEALTH_POLL_SEC"
  done
}

main() {
  require_file "$SECRETS_FILE"
  require_file "$COMPOSE_FILE"
  require_file "$APP_DIR/scripts/sync_frontend_runtime.sh"
  require_file "$APP_DIR/scripts/predeploy_guard.sh"
  require_file "$APP_DIR/scripts/phase_status.sh"

  log "Validate docker compose config"
  run_root env ENV_FILE_PATH="$SECRETS_FILE" docker compose -f "$COMPOSE_FILE" config >/dev/null

  log "Sync runtime frontend files"
  bash "$APP_DIR/scripts/sync_frontend_runtime.sh" "$APP_DIR"

  log "Run predeploy guard"
  bash "$APP_DIR/scripts/predeploy_guard.sh" "$APP_DIR"

  log "Verify phase status"
  bash "$APP_DIR/scripts/phase_status.sh" "$APP_DIR"

  log "Build API image"
  run_root env ENV_FILE_PATH="$SECRETS_FILE" docker compose -f "$COMPOSE_FILE" build api

  log "Recreate API"
  run_root env ENV_FILE_PATH="$SECRETS_FILE" docker compose -f "$COMPOSE_FILE" up -d --force-recreate api

  log "Recreate Nginx"
  run_root env ENV_FILE_PATH="$SECRETS_FILE" docker compose -f "$COMPOSE_FILE" up -d --force-recreate nginx

  log "Wait service health"
  wait_for_health

  log "Compose status"
  run_root env ENV_FILE_PATH="$SECRETS_FILE" docker compose -f "$COMPOSE_FILE" ps

  log "Recent API logs"
  run_root env ENV_FILE_PATH="$SECRETS_FILE" docker compose -f "$COMPOSE_FILE" logs --tail=80 api || true

  log "Done"
  echo "[DONE] Runtime deploy completed"
}

main "$@"
