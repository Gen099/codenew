"""
Provider 2 - PiAPI.ai Kling video generation.
Docs: https://piapi.ai/docs/kling-api/create-task
"""
import json
import logging
import os
import re
from typing import Optional

import aiohttp

from provider_base import VideoProvider

try:
    from . import runtime_paths
except ImportError:
    import runtime_paths

logger = logging.getLogger(__name__)

PIAPI_BASE = "https://api.piapi.ai"

# Credit costs (PiAPI uses USD-based credits)
# Kling 2.5: std=$0.20/5s, pro=$0.33/5s (10s = 2x)
PIAPI_MODELS = {
    "kling25_std": {
        "label": "Kling 2.5 Standard",
        "version": "2.5",
        "mode": "std",
        "api_model": "kling",
        "cost_5s": 0.20,
        "cost_10s": 0.40,
    },
    "kling25_pro": {
        "label": "Kling 2.5 Pro",
        "version": "2.5",
        "mode": "pro",
        "api_model": "kling",
        "cost_5s": 0.33,
        "cost_10s": 0.66,
    },
    "kling25_turbo": {
        "label": "Kling 2.5 Turbo",
        "version": "2.5-turbo",
        "mode": "pro",
        "api_model": "kling-turbo",
        "cost_5s": 0.28,
        "cost_10s": 0.56,
    },
}
DEFAULT_MODEL = "kling25_std"


def _to_percent_int(value) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(float(value))
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        m = re.search(r"(\d+(?:\.\d+)?)\s*%?", s)
        if not m:
            return None
        try:
            return int(float(m.group(1)))
        except Exception:
            return None
    return None


def _extract_progress_deep(data) -> Optional[int]:
    queue = [data]
    seen = set()
    keys_exact = ("progress", "percent", "status_percent", "percentage")
    keys_hint = ("progress", "percent")
    while queue:
        cur = queue.pop(0)
        sid = id(cur)
        if sid in seen:
            continue
        seen.add(sid)
        if isinstance(cur, dict):
            for k in keys_exact:
                if k in cur:
                    v = _to_percent_int(cur.get(k))
                    if v is not None:
                        return v
            for k, v in cur.items():
                lk = str(k).lower()
                if any(h in lk for h in keys_hint):
                    pv = _to_percent_int(v)
                    if pv is not None:
                        return pv
                if isinstance(v, (dict, list, tuple)):
                    queue.append(v)
        elif isinstance(cur, (list, tuple)):
            for item in cur:
                if isinstance(item, (dict, list, tuple)):
                    queue.append(item)
                else:
                    pv = _to_percent_int(item)
                    if pv is not None:
                        return pv
        else:
            pv = _to_percent_int(cur)
            if pv is not None:
                return pv
    return None


class PiAPIProvider(VideoProvider):
    """PiAPI.ai video provider - Provider 2."""

    def __init__(self):
        from dotenv import load_dotenv

        load_dotenv(runtime_paths.ENV_FILE, override=True)
        self._api_key = ""
        self._keys_file_mtime = 0.0
        self._env_mtime = 0.0
        self._session: Optional[aiohttp.ClientSession] = None
        self._load_api_key()
        if not self._api_key:
            logger.warning("PIAPI_KEY not set - Provider 2 disabled")
        else:
            logger.info("Provider 2 key loaded: ...%s", self._api_key[-6:])

    def _load_api_key(self):
        self._api_key = ""
        keys_file = runtime_paths.API_KEYS_FILE
        env_file = runtime_paths.ENV_FILE
        self._keys_file_mtime = os.path.getmtime(keys_file) if os.path.exists(keys_file) else 0.0
        self._env_mtime = os.path.getmtime(env_file) if os.path.exists(env_file) else 0.0

        try:
            if os.path.exists(keys_file):
                with open(keys_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                p2_keys = data.get("provider2", [])
                if p2_keys:
                    self._api_key = str(p2_keys[0]).strip()
        except Exception as e:
            logger.warning("Failed to read provider2 keys from api_keys.json: %s", e)

        if not self._api_key:
            self._api_key = os.getenv("PIAPI_KEY", "")

    def _reload_key_if_needed(self):
        keys_mtime = os.path.getmtime(runtime_paths.API_KEYS_FILE) if os.path.exists(runtime_paths.API_KEYS_FILE) else 0.0
        env_mtime = os.path.getmtime(runtime_paths.ENV_FILE) if os.path.exists(runtime_paths.ENV_FILE) else 0.0
        if keys_mtime > self._keys_file_mtime or env_mtime > self._env_mtime:
            from dotenv import load_dotenv

            load_dotenv(runtime_paths.ENV_FILE, override=True)
            self._load_api_key()

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    def _headers(self) -> dict:
        self._reload_key_if_needed()
        return {
            "x-api-key": self._api_key,
            "Content-Type": "application/json",
        }

    @property
    def provider_id(self) -> str:
        return "provider2"

    @property
    def display_name(self) -> str:
        return "Server 2"

    async def create_video(
        self,
        prompt: str,
        duration: int = 5,
        aspect_ratio: str = "16:9",
        image_url: Optional[str] = None,
        end_image_url: Optional[str] = None,
        negative_prompt: str = "",
        cfg_scale: float = 0.5,
        mode: str = "std",
        model_id: str = "",
    ) -> str:
        self._reload_key_if_needed()
        if not self._api_key:
            raise RuntimeError("Provider 2 API key not configured")

        s = await self._get_session()
        m = PIAPI_MODELS.get(model_id or DEFAULT_MODEL, PIAPI_MODELS[DEFAULT_MODEL])
        payload = {
            "model": m.get("api_model") or "kling",
            "task_type": "video_generation",
            "input": {
                "prompt": prompt,
                "negative_prompt": negative_prompt,
                "cfg_scale": cfg_scale,
                "duration": duration,
                "aspect_ratio": aspect_ratio,
                "mode": m["mode"],
                "version": m["version"],
            },
            "config": {
                "service_mode": "",
                "webhook_config": {"endpoint": "", "secret": ""},
            },
        }
        if image_url:
            payload["input"]["image_url"] = image_url
        if end_image_url:
            payload["input"]["tail_image_url"] = end_image_url

        async with s.post(
            f"{PIAPI_BASE}/api/v1/task",
            headers=self._headers(),
            json=payload,
        ) as resp:
            data = await resp.json()
            logger.info("PiAPI create_video: status=%d, data=%s", resp.status, data)
            if resp.status != 200 or data.get("code") != 200:
                error_msg = data.get("message", str(data))
                raise RuntimeError(f"Provider 2 error: {error_msg}")
            task_id = data["data"]["task_id"]
            logger.info("PiAPI task created: %s", task_id)
            return task_id

    async def query_video(self, task_id: str) -> dict:
        self._reload_key_if_needed()
        s = await self._get_session()
        async with s.get(
            f"{PIAPI_BASE}/api/v1/task/{task_id}",
            headers=self._headers(),
        ) as resp:
            data = await resp.json()

        task_data = data.get("data", {})
        piapi_status = str(task_data.get("status", "")).lower()
        if piapi_status in ("pending", "processing"):
            status = "pending"
        elif piapi_status == "completed":
            status = "success"
        elif piapi_status == "failed":
            status = "fail"
            error_data = task_data.get("error", {})
            logger.error("PiAPI task %s FAILED: error=%s", task_id, error_data)
            logger.error("PiAPI task %s raw output: %s", task_id, task_data.get("output"))
        else:
            status = "pending"

        logger.info("PiAPI poll %s: piapi_status=%s -> norm=%s", task_id, piapi_status, status)

        video_url = None
        cover_url = None
        progress = 0
        output = task_data.get("output", {})
        works = output.get("works", [])
        if works and isinstance(works, list):
            work = works[0]
            video_info = work.get("video", {})
            cover_info = work.get("cover", {})
            video_url = video_info.get("resource_without_watermark") or video_info.get("resource")
            cover_url = cover_info.get("resource_without_watermark") or cover_info.get("resource")
        if status == "success" and not video_url:
            # Some upstream "completed" states arrive before media URL is published.
            error_data = task_data.get("error", {}) or {}
            if error_data.get("message"):
                status = "fail"
            else:
                status = "pending"

        # PiAPI progress fields vary by model/version; normalize to 0..100.
        deep_progress = _extract_progress_deep(task_data)
        progress = int(deep_progress or 0)
        if status == "success":
            progress = 100
        elif status == "fail":
            progress = 0
        else:
            progress = max(0, min(99, progress))

        error = None
        error_data = task_data.get("error", {})
        if error_data and error_data.get("message"):
            error = error_data["message"]

        return {
            "status": status,
            "progress": progress,
            "video_url": video_url,
            "cover_url": cover_url,
            "error": error,
            "raw": data,
        }

    async def cancel_task(self, task_id: str) -> dict:
        self._reload_key_if_needed()
        if not self._api_key:
            raise RuntimeError("Provider 2 API key not configured")
        s = await self._get_session()
        async with s.delete(
            f"{PIAPI_BASE}/api/v1/task/{task_id}",
            headers=self._headers(),
        ) as resp:
            data = await resp.json()
            if resp.status != 200 or int(data.get("code") or 0) != 200:
                msg = data.get("message") or str(data)
                raise RuntimeError(f"Provider 2 cancel error: {msg}")
            logger.info("PiAPI task cancelled upstream: %s", task_id)
            return data

    async def get_credits(self) -> dict:
        """PiAPI: query /account/info for wallet balance."""
        self._reload_key_if_needed()
        if not self._api_key:
            return {"total": 0, "keys": [], "unit": "USD"}

        s = await self._get_session()
        try:
            async with s.get(
                f"{PIAPI_BASE}/account/info",
                headers=self._headers(),
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                data = await resp.json()
                logger.info("PiAPI get_credits: status=%d", resp.status)
                if resp.status == 200 and data.get("code") == 200:
                    account = data.get("data", {})
                    plan = account.get("plan", "unknown")
                    acc_type = account.get("type", "unknown")
                    balance_usd = round(float(account.get("equivalent_in_usd", 0) or 0), 5)
                    wallet = account.get("wallet", {})
                    point_used = wallet.get("point_used", 0) or 0
                    masked = f"...{self._api_key[-6:]}" if len(self._api_key) > 6 else "****"
                    return {
                        "total": balance_usd,
                        "keys": [
                            {
                                "index": 0,
                                "masked": masked,
                                "credits": balance_usd,
                                "active": True,
                                "plan": plan,
                                "type": acc_type,
                            }
                        ],
                        "unit": "USD",
                        "detail": {
                            "balance_usd": balance_usd,
                            "point_used": point_used,
                            "plan": plan,
                        },
                    }
                logger.warning("PiAPI get_credits non-200: %s", data)
        except Exception as e:
            logger.error("PiAPI get_credits error: %s", e)
        return {"total": 0, "keys": [], "unit": "USD"}

    async def upload_file(self, file_bytes: bytes, filename: str, content_type: str = "image/png") -> str:
        """PiAPI supports file-to-url conversion via their upload endpoint."""
        self._reload_key_if_needed()
        if not self._api_key:
            raise RuntimeError("Provider 2 API key not configured")

        s = await self._get_session()
        form = aiohttp.FormData()
        form.add_field("file", file_bytes, filename=filename, content_type=content_type)

        try:
            async with s.post(
                f"{PIAPI_BASE}/api/v1/file/upload",
                headers={"x-api-key": self._api_key},
                data=form,
            ) as resp:
                data = await resp.json()
                if resp.status == 200:
                    file_url = data.get("data", {}).get("url") or data.get("data", {}).get("file_url")
                    if file_url:
                        return file_url
        except Exception as e:
            logger.warning("PiAPI upload failed, falling back to KIE upload: %s", e)

        import kie_client as kie

        return await kie.upload_file(file_bytes, filename, content_type)

    def get_credit_cost(self, duration: int = 5, mode: str = "std", model_id: str = "") -> float:
        m = PIAPI_MODELS.get(model_id or DEFAULT_MODEL, PIAPI_MODELS[DEFAULT_MODEL])
        return m["cost_5s"] if duration <= 5 else m["cost_10s"]

    def list_models(self) -> list[dict]:
        return [
            {
                "id": mid,
                "label": m["label"],
                "version": m["version"],
                "mode": m["mode"],
                "input_types": ["text_to_video", "image_to_video"],
                "task_type": "video_generation",
                "model": m.get("api_model") or "kling",
                "cost_5s": m["cost_5s"],
                "cost_10s": m["cost_10s"],
                "unit": "USD",
                "default_resolution": "",
                "resolution_options": [],
                "resolution_display": "Theo model/API",
                "default_fps": "",
                "fps_options": [],
                "fps_display": "-",
            }
            for mid, m in PIAPI_MODELS.items()
        ]
