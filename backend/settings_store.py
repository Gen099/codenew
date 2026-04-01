"""Runtime system settings shared by backend and local admin tools."""
import json
import os

try:
    from . import runtime_paths
except ImportError:
    import runtime_paths


DEFAULT_SETTINGS = {
    "login_2fa_enabled": True,
    "telegram_outbound_blocked": False,
    "chat_send_shortcut": "enter",
    "default_video_provider": "provider1",
    "default_video_models": {
        "provider1": "kling25_turbo_pro",
        "provider2": "kling25_turbo",
    },
    "kie_credit_package": "usd50_10000",
    "telegram_bot_token": "",
    "telegram_chat_id": "",
    "telegram_admin_id": "",
    "telegram_qc_topic_id": "",
    "shift_templates": {
        "morning": {"label": "Ca sáng", "start": "08:30", "end": "17:00"},
        "afternoon": {"label": "Ca chiều", "start": "13:00", "end": "21:30"},
        "evening": {"label": "Ca tối", "start": "17:30", "end": "01:00"},
    },
}


def _normalize_settings(data: dict | None) -> dict:
    merged = dict(DEFAULT_SETTINGS)
    merged.update(dict(data or {}))
    merged["login_2fa_enabled"] = bool(merged.get("login_2fa_enabled", True))
    merged["telegram_outbound_blocked"] = bool(merged.get("telegram_outbound_blocked", False))
    shortcut = str(merged.get("chat_send_shortcut") or "enter").strip().lower()
    if shortcut not in {"enter", "shift_enter"}:
        shortcut = "enter"
    merged["chat_send_shortcut"] = shortcut
    default_provider = str(merged.get("default_video_provider") or "provider1").strip().lower()
    if default_provider not in {"provider1", "provider2"}:
        default_provider = "provider1"
    merged["default_video_provider"] = default_provider
    raw_models = merged.get("default_video_models") if isinstance(merged.get("default_video_models"), dict) else {}
    merged["default_video_models"] = {
        "provider1": str(raw_models.get("provider1") or DEFAULT_SETTINGS["default_video_models"]["provider1"]).strip() or DEFAULT_SETTINGS["default_video_models"]["provider1"],
        "provider2": str(raw_models.get("provider2") or DEFAULT_SETTINGS["default_video_models"]["provider2"]).strip() or DEFAULT_SETTINGS["default_video_models"]["provider2"],
    }
    kie_package = str(merged.get("kie_credit_package") or DEFAULT_SETTINGS["kie_credit_package"]).strip().lower()
    if kie_package not in {"usd5_1000", "usd50_10000", "usd500_105000", "usd1250_275000"}:
        kie_package = DEFAULT_SETTINGS["kie_credit_package"]
    merged["kie_credit_package"] = kie_package
    merged["telegram_bot_token"] = str(merged.get("telegram_bot_token") or "").strip()
    merged["telegram_chat_id"] = str(merged.get("telegram_chat_id") or "").strip()
    merged["telegram_admin_id"] = str(merged.get("telegram_admin_id") or "").strip()
    merged["telegram_qc_topic_id"] = str(merged.get("telegram_qc_topic_id") or "").strip()
    raw_templates = merged.get("shift_templates") or {}
    default_templates = dict(DEFAULT_SETTINGS["shift_templates"])
    normalized_templates = {}
    for key, fallback in default_templates.items():
        row = raw_templates.get(key) if isinstance(raw_templates, dict) else None
        row = row if isinstance(row, dict) else {}
        start = str(row.get("start") or fallback["start"]).strip()
        end = str(row.get("end") or fallback["end"]).strip()
        label = str(row.get("label") or fallback["label"]).strip() or fallback["label"]
        normalized_templates[key] = {"label": label, "start": start, "end": end}
    merged["shift_templates"] = normalized_templates
    return merged


def load_settings() -> dict:
    runtime_paths.ensure_runtime_dirs()
    path = runtime_paths.SYSTEM_SETTINGS_FILE
    if not os.path.exists(path):
        return dict(DEFAULT_SETTINGS)
    try:
        with open(path, "r", encoding="utf-8") as f:
            return _normalize_settings(json.load(f))
    except Exception:
        return dict(DEFAULT_SETTINGS)


def save_settings(data: dict | None) -> dict:
    runtime_paths.ensure_runtime_dirs()
    settings = _normalize_settings(data)
    with open(runtime_paths.SYSTEM_SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2, ensure_ascii=False)
    return settings


def update_settings(patch: dict | None) -> dict:
    current = load_settings()
    current.update(dict(patch or {}))
    return save_settings(current)


def is_login_2fa_enabled() -> bool:
    return bool(load_settings().get("login_2fa_enabled", True))


def is_telegram_outbound_blocked() -> bool:
    return bool(load_settings().get("telegram_outbound_blocked", False))


def get_chat_send_shortcut() -> str:
    value = str(load_settings().get("chat_send_shortcut") or "enter").strip().lower()
    return value if value in {"enter", "shift_enter"} else "enter"


def get_default_video_provider() -> str:
    value = str(load_settings().get("default_video_provider") or "provider1").strip().lower()
    return value if value in {"provider1", "provider2"} else "provider1"


def get_default_video_models() -> dict:
    value = load_settings().get("default_video_models")
    return value if isinstance(value, dict) else dict(DEFAULT_SETTINGS["default_video_models"])
