"""
Provider 1 — wraps existing kie_client.py functions into VideoProvider interface.
"""
import json
import logging
import re
from typing import Optional
from provider_base import VideoProvider
import kie_client as kie

logger = logging.getLogger(__name__)

# Model strings confirmed from KIE docs
IMG_MODEL = "kling/v2-5-turbo-image-to-video-pro"
TXT_MODEL = "kling/v2-5-turbo-text-to-video-pro"

# Credit costs per duration (in KIE credit points)
CREDIT_COSTS = {"5": 42, "10": 84}


def _to_percent_int(value):
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


def _extract_progress_deep(data):
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


class KIEProvider(VideoProvider):
    """KIE.ai video provider — Provider 1."""

    @property
    def provider_id(self) -> str:
        return "provider1"

    @property
    def display_name(self) -> str:
        return "Server 1"

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
    ) -> str:
        model = IMG_MODEL if image_url else TXT_MODEL
        cost = CREDIT_COSTS.get(str(duration), 42)

        input_payload = {
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "duration": str(duration),
            "aspect_ratio": aspect_ratio,
            "cfg_scale": cfg_scale,
        }
        if image_url:
            input_payload["image_url"] = image_url
        if end_image_url:
            input_payload["image_tail_url"] = end_image_url

        task_id = await kie.create_task(model, input_payload, cost=cost)
        logger.info("KIE create_video: task_id=%s, model=%s, cost=%d", task_id, model, cost)
        return task_id

    async def query_video(self, task_id: str) -> dict:
        data = await kie.query_task(task_id)
        raw = data.get("data", data) if isinstance(data, dict) else data

        # Normalize KIE status (KIE uses "succeed" not "success", also int codes)
        kie_status = raw.get("status") or raw.get("taskStatus") or raw.get("state")
        if isinstance(kie_status, str):
            kie_status = kie_status.lower()
        if kie_status in ("succeed", "completed", "success", 2):
            status = "success"
        elif kie_status in ("failed", "fail", 3):
            status = "fail"
        else:
            status = "pending"
        progress = _extract_progress_deep(raw)
        if progress is None:
            progress = 0
        progress = max(0, min(100, progress))

        # Extract video URL from multiple possible formats
        video_url = raw.get("resultUrl") or raw.get("result_url") or ""
        if not video_url:
            result_urls = raw.get("resultUrls") or raw.get("result_urls") or []
            if isinstance(result_urls, list):
                for url in result_urls:
                    if isinstance(url, str) and url.strip():
                        video_url = url.strip()
                        break
        if not video_url:
            result_json = raw.get("resultJson") or raw.get("result_json") or ""
            if isinstance(result_json, str) and result_json.strip():
                try:
                    parsed = json.loads(result_json)
                    if isinstance(parsed, dict):
                        nested_urls = parsed.get("resultUrls") or parsed.get("result_urls") or []
                        if isinstance(nested_urls, list):
                            for url in nested_urls:
                                if isinstance(url, str) and url.strip():
                                    video_url = url.strip()
                                    break
                        if not video_url:
                            nested_direct = parsed.get("video_url") or parsed.get("result_url") or parsed.get("url") or ""
                            if isinstance(nested_direct, str) and nested_direct.strip():
                                video_url = nested_direct.strip()
                except Exception:
                    pass
        if not video_url:
            output = raw.get("output", {})
            if isinstance(output, dict):
                video_url = output.get("video_url", "")
                if not video_url:
                    works = output.get("works") or []
                    for w in works:
                        v = w.get("video", {})
                        video_url = v.get("resource", {}).get("video_url", "") if isinstance(v.get("resource"), dict) else ""
                        if not video_url:
                            video_url = v.get("url", "") or v.get("resource", "")
                            if isinstance(video_url, dict):
                                video_url = ""
                        if video_url:
                            break

        cover_url = raw.get("coverUrl") or raw.get("cover_url") or ""
        error = raw.get("failReason") or raw.get("failMsg") or raw.get("message") if status == "fail" else None

        return {
            "status": status,
            "progress": progress,
            "video_url": video_url,
            "cover_url": cover_url,
            "error": error,
            "raw": data,
        }

    async def get_credits(self) -> dict:
        await kie.refresh_key_credits(force=True)
        keys = await kie.get_all_keys_info()
        total = sum(k["credits"] for k in keys)
        return {
            "total": total,
            "keys": keys,
            "unit": "credits",
        }

    async def upload_file(self, file_bytes: bytes, filename: str, content_type: str = "image/png") -> str:
        return await kie.upload_file(file_bytes, filename, content_type)

    def get_credit_cost(self, duration: int = 5, mode: str = "std") -> float:
        return CREDIT_COSTS.get(str(duration), 42)

    def list_models(self) -> list[dict]:
        return [
            {
                "id": "kling25_turbo_pro",
                "label": "Kling 2.5 Turbo Pro",
                "version": "2.5",
                "mode": "turbo_pro",
                "input_types": ["text_to_video", "image_to_video"],
                "text_model": TXT_MODEL,
                "image_model": IMG_MODEL,
                "cost_5s": 42,
                "cost_10s": 84,
                "unit": "credits",
                "default_resolution": "1080p",
                "resolution_options": ["1080p"],
                "resolution_display": "1080p",
                "default_fps": "24",
                "fps_options": ["24"],
                "fps_display": "24",
            },
        ]
