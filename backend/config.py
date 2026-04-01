"""Shared backend configuration and static helper functions."""
import json
import os

try:
    from . import runtime_paths
except ImportError:
    import runtime_paths


SECRET_KEY = os.getenv("SECRET_KEY", "videotool-secret")
PUBLIC_URL = os.getenv("PUBLIC_URL", "").rstrip("/")
BASE_DIR = runtime_paths.BACKEND_DIR

FRONTEND_DIR = os.path.join(runtime_paths.ROOT_DIR, "frontend")
if not os.path.exists(FRONTEND_DIR):
    FRONTEND_DIR = runtime_paths.LEGACY_FRONTEND_DIR

MODEL = {
    "id": "kling",
    "name": "Kling",
    "tiers": {
        "kling25": {
            "label": "Kling 2.5 Turbo Pro",
            "img_model": "kling/v2-5-turbo-image-to-video-pro",
            "txt_model": "kling/v2-5-turbo-text-to-video-pro",
            "credits": {"5": 42, "10": 84},
        },
    },
    "default_tier": "kling25",
    "durations": [5, 10],
}

CAMERA_FILE = runtime_paths.CAMERA_MOVES_FILE


def get_tier(quality: str = "kling25") -> dict:
    return MODEL["tiers"].get(quality, MODEL["tiers"][MODEL["default_tier"]])


def get_credit(duration: int, quality: str = "kling25") -> int:
    tier = get_tier(quality)
    return tier["credits"].get(str(duration), tier["credits"]["5"])


def load_cameras() -> list:
    try:
        with open(CAMERA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def find_camera(cam_id: str) -> str:
    for camera in load_cameras():
        if camera["id"] == cam_id:
            return camera.get("prompt", "")
    return ""
