#!/usr/bin/env bash
set -euo pipefail
trap 'rc=$?; echo "[APPDEPLOY-INSTALL][ERROR] ${BASH_SOURCE[0]}:${LINENO} :: ${BASH_COMMAND} (exit=${rc})"; exit "${rc}"' ERR

APP_DIR="${APP_DIR:-/opt/faistudio}"
TARGET_BIN="${TARGET_BIN:-/usr/local/bin/appdeploy}"
SOURCE_SCRIPT="${APP_DIR}/scripts/appdeploy.sh"
PROFILE_FILES=("/root/.bashrc" "/root/.profile")

run_root() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

if [[ ! -f "$SOURCE_SCRIPT" ]]; then
  echo "[APPDEPLOY-INSTALL][ERROR] Missing source script: $SOURCE_SCRIPT"
  exit 1
fi

run_root install -m 755 "$SOURCE_SCRIPT" "$TARGET_BIN"

for profile in "${PROFILE_FILES[@]}"; do
  run_root touch "$profile"
  if ! run_root grep -Fq "alias appdeploy='$TARGET_BIN'" "$profile"; then
    run_root sh -c "printf '\nalias appdeploy='\''$TARGET_BIN'\''\n' >> '$profile'"
  fi
done

echo "[APPDEPLOY-INSTALL][OK] Installed $TARGET_BIN"
echo "[APPDEPLOY-INSTALL][OK] Alias added to /root/.bashrc and /root/.profile"
echo "[APPDEPLOY-INSTALL][OK] Re-login or run: source /root/.bashrc"
