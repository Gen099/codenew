"""Shared runtime paths for the VideoTool project."""
import os

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BACKEND_DIR)
DATA_DIR = os.path.join(ROOT_DIR, "data")
LOG_DIR = os.path.join(ROOT_DIR, "logs")
LEGACY_DIR = os.path.join(ROOT_DIR, "legacy")

ENV_FILE = os.path.join(ROOT_DIR, ".env")

API_KEYS_FILE = os.path.join(DATA_DIR, "api_keys.json")
BILLING_HISTORY_FILE = os.path.join(DATA_DIR, "billing_history.json")
ACTIVITY_LOGS_FILE = os.path.join(DATA_DIR, "activity_logs.json")
USER_PASSWORDS_FILE = os.path.join(DATA_DIR, "user_passwords.json")
LOCAL_SQLITE_FILE = os.path.join(DATA_DIR, "data.db")
SYSTEM_SETTINGS_FILE = os.path.join(DATA_DIR, "system_settings.json")

ROLES_CONFIG_FILE = os.path.join(BACKEND_DIR, "roles_config.json")
CAMERA_MOVES_FILE = os.path.join(BACKEND_DIR, "camera_moves.json")

LEGACY_FRONTEND_DIR = os.path.join(LEGACY_DIR, "frontend")


def ensure_runtime_dirs() -> None:
    """Create runtime directories if they do not exist yet."""
    for path in (DATA_DIR, LOG_DIR, LEGACY_DIR):
        os.makedirs(path, exist_ok=True)
