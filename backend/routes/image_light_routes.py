"""Lower-risk image routes split before the heavier edit/analyze flow."""
import json
import re
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from activity_logger import log_activity


def _pick_first_url(value):
    if isinstance(value, str) and value.strip():
        raw = value.strip()
        if raw[:1] in ("{", "["):
            try:
                return _pick_first_url(json.loads(raw))
            except Exception:
                pass
        return raw
    if isinstance(value, list):
        for item in value:
            found = _pick_first_url(item)
            if found:
                return found
        return ""
    if isinstance(value, dict):
        for key in ("url", "resource", "fileUrl", "imageUrl", "resultUrl", "resultUrls", "result_urls"):
            found = _pick_first_url(value.get(key))
            if found:
                return found
    return ""


def _extract_image_result_url(data: dict) -> str:
    data = dict(data or {})
    candidates = [
        data.get("resultUrls"),
        data.get("result_urls"),
        data.get("resultUrl"),
        data.get("url"),
        data.get("resource"),
        data.get("response"),
        data.get("resultJson"),
        data.get("result"),
        data.get("works"),
    ]
    for candidate in candidates:
        found = _pick_first_url(candidate)
        if found:
            return found
    return ""


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


class ImageRecoverReq(BaseModel):
    task_id: str


def create_image_light_router(require_user, db, kie, tg=None, asyncio_mod=None):
    router = APIRouter()

    @router.get("/api/image/presets")
    async def image_presets(request: Request, group: str = None):
        require_user(request)
        presets = db.get_presets(group)
        groups = db.get_preset_groups()
        return {"presets": presets, "groups": groups}

    @router.post("/api/image/presets/create")
    async def image_preset_create(request: Request):
        require_user(request)
        body = await request.json()
        conn = db.get_conn()
        conn.execute(
            "INSERT INTO presets (name, icon, effect_group, prompt_prefix, prompt_suffix, model, is_default) VALUES (?,?,?,?,?,?,?)",
            (
                body.get("name", "Custom"),
                body.get("icon", "art"),
                body.get("effect_group", "custom"),
                body.get("prompt_prefix", ""),
                body.get("prompt_suffix", ""),
                "nano-banana-pro",
                0,
            ),
        )
        conn.commit()
        conn.close()
        return {"ok": True}

    @router.get("/api/image/poll/{task_id}")
    async def image_poll(task_id: str, request: Request):
        require_user(request)
        task_row = db.get_task(task_id) or {}
        prev_status = str(task_row.get("status") or "")
        display_name = task_row.get("user_display") or task_row.get("user_name") or ""
        provider = task_row.get("provider") or "provider1"
        prompt = str(task_row.get("prompt") or "")[:120]
        age_seconds = None
        created_at = task_row.get("created_at")
        if created_at:
            try:
                age_seconds = max(0, int((datetime.now() - datetime.fromisoformat(str(created_at))).total_seconds()))
            except Exception:
                age_seconds = None

        result = await kie.query_task(task_id)
        code = result.get("code", 0)
        data = result.get("data", {})
        progress = _extract_progress_deep(data)
        if progress is None:
            progress = 0
        progress = max(0, min(100, progress))

        if code != 200:
            if age_seconds is not None and age_seconds >= 900:
                fail_msg = f"Image task timeout after {age_seconds}s (provider code {code})"
                db.update_task(task_id, status="fail", fail_msg=fail_msg, completed_at=datetime.now().isoformat())
                if prev_status != "fail":
                    log_activity(display_name, "Image Fail", f"{task_id[:10]} | {fail_msg}", 0, provider)
                    if tg and asyncio_mod:
                        asyncio_mod.ensure_future(tg.send_image_result(task_id, display_name, False, "", fail_msg))
                return {"status": "stalled", "task_id": task_id, "fail_msg": fail_msg, "age_seconds": age_seconds, "progress": progress}
            return {"status": "pending", "task_id": task_id, "provider_code": code, "age_seconds": age_seconds, "progress": progress}

        status_raw = data.get("status", data.get("state", ""))
        status_norm = status_raw.lower() if isinstance(status_raw, str) else status_raw
        result_url = _extract_image_result_url(data)

        if result_url and status_norm not in ("failed", "fail", 3):
            db.update_task(task_id, status="success", result_url=result_url, completed_at=datetime.now().isoformat())
            if prev_status != "success":
                log_activity(
                    display_name,
                    "Image Done",
                    f"{task_id[:10]} | {prompt}",
                    float(task_row.get("credit_used", 0) or 0),
                    provider,
                )
                if tg and asyncio_mod:
                    asyncio_mod.ensure_future(tg.send_image_result(task_id, display_name, True, result_url, ""))
            return {"status": "success", "task_id": task_id, "result_url": result_url, "raw_status": status_raw, "progress": 100}

        if status_norm in ("completed", "succeed", "success", 2):
            return {"status": "processing", "task_id": task_id, "raw_status": status_raw, "age_seconds": age_seconds, "progress": progress}

        if status_norm in ("failed", "fail", 3):
            fail_msg = data.get("failReason") or data.get("failMsg") or data.get("message") or "Unknown error"
            db.update_task(task_id, status="fail", fail_msg=fail_msg, completed_at=datetime.now().isoformat())
            if prev_status != "fail":
                log_activity(display_name, "Image Fail", f"{task_id[:10]} | {fail_msg}", 0, provider)
                if tg and asyncio_mod:
                    asyncio_mod.ensure_future(tg.send_image_result(task_id, display_name, False, "", fail_msg))
            return {"status": "fail", "task_id": task_id, "fail_msg": fail_msg, "raw_status": status_raw, "progress": 0}

        if age_seconds is not None and age_seconds >= 900:
            fail_msg = f"Image task stalled after {age_seconds}s (server status: {status_raw or 'pending'})"
            db.update_task(task_id, status="fail", fail_msg=fail_msg, completed_at=datetime.now().isoformat())
            if prev_status != "fail":
                log_activity(display_name, "Image Fail", f"{task_id[:10]} | {fail_msg}", 0, provider)
                if tg and asyncio_mod:
                    asyncio_mod.ensure_future(tg.send_image_result(task_id, display_name, False, "", fail_msg))
            return {
                "status": "stalled",
                "task_id": task_id,
                "fail_msg": fail_msg,
                "raw_status": status_raw,
                "age_seconds": age_seconds,
                "progress": progress,
            }

        status_out = "processing" if str(status_norm) in ("waiting", "queuing", "generating") else "pending"
        return {"status": status_out, "task_id": task_id, "raw_status": status_raw, "age_seconds": age_seconds, "progress": progress}
    @router.get("/api/image/tasks")
    async def image_tasks(request: Request):
        user = require_user(request)
        conn = db.get_conn()
        if user["role"] == "admin":
            rows = conn.execute("SELECT * FROM tasks WHERE gen_mode='image_edit' ORDER BY id DESC LIMIT 100").fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM tasks WHERE user_name=? AND gen_mode='image_edit' ORDER BY id DESC LIMIT 100",
                (user["username"],),
            ).fetchall()
        conn.close()
        return [dict(row) for row in rows]

    @router.post("/api/image/recover")
    async def image_recover(req: ImageRecoverReq, request: Request):
        user = require_user(request)
        task_id = (req.task_id or "").strip()
        if not task_id:
            raise HTTPException(400, "Missing task_id")
        task_row = db.get_task(task_id) or {}
        if not task_row:
            raise HTTPException(404, "Task not found in local database")

        result = await kie.query_task(task_id)
        code = result.get("code", 0)
        data = result.get("data", {})
        if code != 200:
            log_activity(
                user.get("display_name") or user.get("username") or "",
                "Image Recover",
                f"{task_id[:10]} | pending | provider_code={code}",
                0,
                "provider1",
            )
            return {
                "ok": True,
                "state": "pending",
                "task_id": task_id,
                "provider_code": code,
                "msg": "Task chua tra ket qua",
            }

        status_raw = data.get("status", data.get("state", ""))
        status_norm = status_raw.lower() if isinstance(status_raw, str) else status_raw
        result_url = _extract_image_result_url(data)

        if result_url and status_norm not in ("failed", "fail", 3):
            db.update_task(task_id, status="success", result_url=result_url, completed_at=datetime.now().isoformat())
            log_activity(
                user.get("display_name") or user.get("username") or "",
                "Image Recover",
                f"{task_id[:10]} | success",
                0,
                "provider1",
            )
            return {
                "ok": True,
                "state": "success",
                "task_id": task_id,
                "result_url": result_url,
                "msg": "Da khoi phuc media tu KIE",
            }
        if status_norm in ("failed", "fail", 3):
            fail_msg = data.get("failReason") or data.get("failMsg") or data.get("message") or "Unknown error"
            db.update_task(task_id, status="fail", fail_msg=fail_msg, completed_at=datetime.now().isoformat())
            log_activity(
                user.get("display_name") or user.get("username") or "",
                "Image Recover",
                f"{task_id[:10]} | fail | {fail_msg}",
                0,
                "provider1",
            )
            return {
                "ok": True,
                "state": "fail",
                "task_id": task_id,
                "fail_msg": fail_msg,
                "msg": "Task da that bai tren KIE",
            }
        log_activity(
            user.get("display_name") or user.get("username") or "",
            "Image Recover",
            f"{task_id[:10]} | pending | status={status_raw}",
            0,
            "provider1",
        )
        return {
            "ok": True,
            "state": "pending",
            "task_id": task_id,
            "raw_status": status_raw,
            "msg": "Task van dang xu ly tren KIE",
        }

    return router

