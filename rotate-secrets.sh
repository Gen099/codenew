#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/faistudio"
SECRETS_FILE="/opt/faistudio/.secrets/.env.production"

cd "$APP_DIR"

if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "[ERROR] Missing secrets file: $SECRETS_FILE"
  exit 1
fi

gen_hex() { openssl rand -hex "$1"; }
gen_b64() { openssl rand -base64 "$1" | tr -d '\n' | tr '/+' '_-' | cut -c1-"$2"; }
urlenc() { printf '%s' "$1" | sed 's/@/%40/g'; }

new_secret_key="$(gen_b64 48 64)"
new_db_pass="$(gen_hex 16)"
new_api_key="$(gen_hex 16)"
new_piapi_key="$(gen_hex 32)"

db_user="$(grep '^POSTGRES_USER=' "$SECRETS_FILE" | head -n1 | cut -d'=' -f2-)"
db_name="$(grep '^POSTGRES_DB=' "$SECRETS_FILE" | head -n1 | cut -d'=' -f2-)"
if [[ -z "$db_user" ]]; then db_user="videotool"; fi
if [[ -z "$db_name" ]]; then db_name="videotool"; fi

db_url="postgresql://${db_user}:$(urlenc "$new_db_pass")@postgres:5432/${db_name}"

tmp_file="$(mktemp)"
cp "$SECRETS_FILE" "$tmp_file"

sed -i "s|^SECRET_KEY=.*|SECRET_KEY=${new_secret_key}|" "$tmp_file"
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${new_db_pass}|" "$tmp_file"
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=${db_url}|" "$tmp_file"
sed -i "s|^API_KEY=.*|API_KEY=${new_api_key}|" "$tmp_file"
sed -i "s|^API_KEYS=.*|API_KEYS=${new_api_key}|" "$tmp_file"
sed -i "s|^PIAPI_KEY=.*|PIAPI_KEY=${new_piapi_key}|" "$tmp_file"

if ! grep -q '^JWT_EXPIRE_SECONDS=' "$tmp_file"; then
  echo "JWT_EXPIRE_SECONDS=28800" >> "$tmp_file"
fi
if ! grep -q '^APP_SEED_USERS=' "$tmp_file"; then
  echo "APP_SEED_USERS=0" >> "$tmp_file"
fi
if ! grep -q '^APP_SEED_PRESETS=' "$tmp_file"; then
  echo "APP_SEED_PRESETS=0" >> "$tmp_file"
fi

mv "$tmp_file" "$SECRETS_FILE"
chmod 600 "$SECRETS_FILE"

echo "[OK] Secrets rotated in $SECRETS_FILE"
echo "[NOTE] Telegram bot token was NOT auto-rotated. Rotate manually in BotFather, then update TELEGRAM_BOT_TOKEN."
