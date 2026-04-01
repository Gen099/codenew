"""Main video creation routes."""
import asyncio
import io
import json
import os
import uuid
import zipfile
from datetime import datetime
from typing import Optional

import requests

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from activity_logger import log_activity
from .image_light_routes import _extract_image_result_url


class VideoCreateReq(BaseModel):
    image_url: str
    end_image_url: Optional[str] = None
    gen_mode: str = "img2vid"
    prompt: str = ""
    negative_prompt: str = ""
    camera_move_id: Optional[str] = None
    duration: int = 5
    aspect_ratio: str = "16:9"
    quality: str = "kling25"
    provider: str = "provider1"
    model_id: str = ""
    work_task_id: Optional[str] = None


class BatchVideoItem(BaseModel):
    image_url: str
    end_image_url: Optional[str] = None
    gen_mode: str = "img2vid"
    prompt: str = ""
    camera_move_id: Optional[str] = None
    duration: int = 5
    aspect_ratio: str = "16:9"
    filename: str = ""


class BatchVideoReq(BaseModel):
    items: list[BatchVideoItem]
    provider: str = "provider1"
    model_id: str = ""
    negative_prompt: str = ""
    task_name: str = ""
    work_task_id: Optional[str] = None


class VideoRecoverReq(BaseModel):
    task_id: str


def _extract_video_result_url(payload: dict) -> str:
    payload = dict(payload or {})
    output = payload.get("output") or {}
    if isinstance(output, dict):
        direct = output.get("video_url") or output.get("url") or output.get("result_url") or ""
        if isinstance(direct, str) and direct.strip():
            return direct.strip()
        works = output.get("works") or []
        for work in works:
            if not isinstance(work, dict):
                continue
            video = work.get("video") or {}
            resource = video.get("resource") or {}
            if isinstance(resource, dict):
                url = resource.get("video_url") or resource.get("url") or ""
                if isinstance(url, str) and url.strip():
                    return url.strip()
    direct = payload.get("video_url") or payload.get("result_url") or ""
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    result_urls = payload.get("resultUrls") or payload.get("result_urls") or []
    if isinstance(result_urls, list):
        for url in result_urls:
            if isinstance(url, str) and url.strip():
                return url.strip()
    result_json = payload.get("resultJson") or payload.get("result_json") or ""
    if isinstance(result_json, str) and result_json.strip():
        try:
            parsed = json.loads(result_json)
            if isinstance(parsed, dict):
                nested_urls = parsed.get("resultUrls") or parsed.get("result_urls") or []
                if isinstance(nested_urls, list):
                    for url in nested_urls:
                        if isinstance(url, str) and url.strip():
                            return url.strip()
                nested_direct = parsed.get("video_url") or parsed.get("result_url") or parsed.get("url") or ""
                if isinstance(nested_direct, str) and nested_direct.strip():
                    return nested_direct.strip()
        except Exception:
            pass
    return ""


def _extract_video_cover_url(payload: dict) -> str:
    payload = dict(payload or {})
    output = payload.get("output") or {}
    if isinstance(output, dict):
        direct = output.get("coverUrl") or output.get("cover_url") or output.get("cover") or ""
        if isinstance(direct, str) and direct.strip():
            return direct.strip()
    direct = payload.get("coverUrl") or payload.get("cover_url") or payload.get("cover") or ""
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    return ""


def create_video_router(require_user, db, kie, tg, providers, logger, semaphore, find_camera):
    router = APIRouter()
    per_user_batch_limit = max(1, int(os.getenv("VIDEO_BATCH_PER_USER_CONCURRENCY", "2")))
    _user_batch_semaphores = {}

    def _get_user_batch_semaphore(username: str):
        key = str(username or "").strip().lower() or "unknown"
        sem = _user_batch_semaphores.get(key)
        if sem is None:
            sem = asyncio.Semaphore(per_user_batch_limit)
            _user_batch_semaphores[key] = sem
        return sem

    def _is_retryable_batch_error(exc: Exception) -> bool:
        txt = str(exc or "").lower()
        retry_keys = (
            "429",
            "rate limit",
            "too many requests",
            "busy",
            "overloaded",
            "queue full",
            "temporarily unavailable",
            "timeout",
            "timed out",
        )
        return any(k in txt for k in retry_keys)

    def _log_once(display_name: str, action: str, task_id: str, detail: str, credits: float = 0, provider: str = ""):
        conn = db.get_conn()
        try:
            action_prefix = action.strip()
            task_prefix = str(task_id or "")[:10]
            exists = conn.execute(
                "SELECT 1 FROM activity_logs WHERE user_name=? AND action=? AND detail LIKE ? LIMIT 1",
                (display_name, action_prefix, f"{task_prefix}%"),
            ).fetchone()
        finally:
            conn.close()
        if exists:
            return
        log_activity(display_name, action, detail, credits, provider)

    def _resolve_model_snapshot(provider, provider_id: str, model_id: str):
        models = provider.list_models() if provider and hasattr(provider, "list_models") else []
        selected_model_id = str(model_id or "").strip()
        selected = None
        if selected_model_id:
            selected = next((m for m in models if str(m.get("id") or "").strip() == selected_model_id), None)
        if selected is None and provider_id == "provider1":
            selected = next((m for m in models if str(m.get("id") or "").strip() == "kling25_turbo_pro"), None)
        if selected is None and models:
            selected = models[0]
        return {
            "model_id": str((selected or {}).get("id") or selected_model_id or "").strip(),
            "model_label": str((selected or {}).get("label") or "").strip(),
            "cost_unit": str((selected or {}).get("unit") or "").strip(),
        }

    @router.post("/api/video/upload")
    async def video_upload(file: UploadFile = File(...), request: Request = None):
        require_user(request)
        data = await file.read()
        max_bytes = 20 * 1024 * 1024
        if len(data) > max_bytes:
            raise HTTPException(400, f"File qua lon (max {max_bytes // (1024 * 1024)}MB)")
        try:
            url = await kie.upload_file(data, file.filename, file.content_type or "image/png")
        except Exception as exc:
            raise HTTPException(502, f"Upload anh that bai: {exc}")
        return {"url": url}

    @router.post("/api/video/create")
    async def video_create(req: VideoCreateReq, request: Request):
        user = require_user(request)

        parts = []
        if req.prompt:
            parts.append(req.prompt.strip())
        if req.camera_move_id:
            camera_prompt = find_camera(req.camera_move_id)
            if camera_prompt:
                parts.append(camera_prompt)
        full_prompt = ". ".join(parts) if parts else "cinematic video"

        requested_provider = str(req.provider or "").strip().lower()
        provider = providers.get_provider(requested_provider or providers.get_default_provider_id())
        if not provider:
            raise HTTPException(404, "Provider not found")
        provider_id = provider.provider_id
        model_id = req.model_id or ""
        model_snapshot = _resolve_model_snapshot(provider, provider_id, model_id)
        if hasattr(provider.get_credit_cost, "__code__") and "model_id" in provider.get_credit_cost.__code__.co_varnames:
            credit = provider.get_credit_cost(req.duration, model_id=model_id)
        else:
            credit = provider.get_credit_cost(req.duration)

        image_url = None
        end_image_url = None
        if req.gen_mode == "img2vid" and req.image_url:
            image_url = req.image_url
        elif req.gen_mode == "frames":
            image_url = req.image_url if req.image_url else None
            end_image_url = req.end_image_url

        create_kwargs = {
            "prompt": full_prompt,
            "duration": req.duration,
            "aspect_ratio": req.aspect_ratio,
            "image_url": image_url,
            "end_image_url": end_image_url,
            "negative_prompt": req.negative_prompt,
        }
        if model_id and hasattr(provider.create_video, "__code__") and "model_id" in provider.create_video.__code__.co_varnames:
            create_kwargs["model_id"] = model_id

        try:
            async with semaphore:
                task_id = await provider.create_video(**create_kwargs)
        except Exception as exc:
            logger.error("create_video failed (provider=%s): %s", provider_id, exc, exc_info=True)
            raise HTTPException(500, f"Tao task that bai: {exc}")

        db.save_task(
            task_id,
            {
                "user_name": user["username"],
                "user_display": user["display_name"],
                "status": "pending",
                "prompt": full_prompt,
                "gen_mode": req.gen_mode,
                "duration": req.duration,
                "aspect_ratio": req.aspect_ratio,
                "camera_move": req.camera_move_id or "",
                "credit_used": credit,
                "provider": provider_id,
                "model_id": model_snapshot["model_id"],
                "model_label": model_snapshot["model_label"],
                "cost_unit": model_snapshot["cost_unit"],
            },
        )

        linked_work_task_id = req.work_task_id or ""
        if not linked_work_task_id:
            active_wt = db.get_active_work_task(user["username"])
            linked_work_task_id = active_wt["id"] if active_wt else ""
        if linked_work_task_id:
            db.link_video_to_work_task(task_id, linked_work_task_id)

        _log_once(
            user["display_name"],
            "Video Start",
            task_id,
            f"{task_id[:10]} | {full_prompt[:120]}",
            float(credit or 0),
            provider_id,
        )

        # Unified Telegram flow: one event channel (report topic) to avoid duplicate messages.
        asyncio.ensure_future(
            tg.send_to_report_topic(
                f"<b>[VIDEO BAT DAU]</b>\nNhan su: <b>{user['display_name']}</b>\nTask ID: <code>{task_id}</code>\nPrompt: {full_prompt[:180]}"
            )
        )

        return {
            "task_id": task_id,
            "credit": credit,
            "prompt": full_prompt,
            "provider": provider_id,
            "work_task_id": linked_work_task_id or None,
        }

    @router.get("/api/video/poll/{task_id}")
    async def video_poll(task_id: str, request: Request):
        require_user(request)

        existing = db.get_task(task_id) or {}
        provider_id = db.get_task_provider(task_id)
        provider = providers.get_provider(provider_id) if provider_id else None

        if provider:
            result = await provider.query_video(task_id)
            state = result["status"]
            result_url = result.get("video_url") or ""
            cover_url = result.get("cover_url") or ""
            fail_msg = result.get("error") or ""
            if state not in ("success", "fail") and result_url:
                state = "success"
            if state == "success" and not result_url:
                # Upstream can mark completed before result_url is ready.
                state = "pending"
            try:
                progress = int(float(result.get("progress", 0) or 0))
            except Exception:
                progress = 0
            progress = 100 if state == "success" else (0 if state == "fail" else max(0, min(99, progress)))

            if state == "success" and result_url:
                db.update_task(task_id, status="success", result_url=result_url, completed_at=datetime.now().isoformat())
                if str(existing.get("status") or "") != "success":
                    _log_once(
                        existing.get("user_display") or existing.get("user_name") or "",
                        "Video Done",
                        task_id,
                        f"{task_id[:10]} | {str(existing.get('prompt') or '')[:120]}",
                        float(existing.get("credit_used", 0) or 0),
                        provider_id,
                    )
                    asyncio.ensure_future(
                        tg.send_video_complete(
                            task_id,
                            existing.get("user_display") or existing.get("user_name") or "",
                            result_url or "",
                        )
                    )
            elif state == "fail":
                db.update_task(task_id, status="fail", fail_msg=fail_msg, completed_at=datetime.now().isoformat())
                if str(existing.get("status") or "") != "fail":
                    _log_once(
                        existing.get("user_display") or existing.get("user_name") or "",
                        "Video Fail",
                        task_id,
                        f"{task_id[:10]} | {fail_msg or '-'}",
                        0,
                        provider_id,
                    )
                    asyncio.ensure_future(
                        tg.send_to_report_topic(
                            f"<b>[VIDEO THAT BAI]</b>\nNhan su: <b>{existing.get('user_display') or existing.get('user_name') or ''}</b>\nTask ID: <code>{task_id}</code>\nLy do: {fail_msg or '-'}"
                        )
                    )

            return {"state": state, "progress": progress, "result_url": result_url, "cover_url": cover_url, "fail_msg": fail_msg}

        data = await kie.query_task(task_id)
        payload = data.get("data", {})
        state = "pending"
        progress = 0
        result_url = ""
        cover_url = _extract_video_cover_url(payload)
        fail_msg = ""

        status_code = payload.get("status") or payload.get("taskStatus") or payload.get("state")
        result_url = _extract_video_result_url(payload)
        if status_code in ("succeed", "completed", "success", 2):
            state = "success"
            progress = 100
            db.update_task(task_id, status="success", result_url=result_url, completed_at=datetime.now().isoformat())
            if str(existing.get("status") or "") != "success":
                _log_once(
                    existing.get("user_display") or existing.get("user_name") or "",
                    "Video Done",
                    task_id,
                    f"{task_id[:10]} | {str(existing.get('prompt') or '')[:120]}",
                    float(existing.get("credit_used", 0) or 0),
                    provider_id,
                )
                asyncio.ensure_future(
                    tg.send_video_complete(
                        task_id,
                        existing.get("user_display") or existing.get("user_name") or "",
                        result_url or "",
                    )
                )
        elif status_code in ("failed", "fail", 3):
            state = "fail"
            fail_msg = payload.get("failMsg") or payload.get("message") or "Unknown error"
            db.update_task(task_id, status="fail", fail_msg=fail_msg, completed_at=datetime.now().isoformat())
            if str(existing.get("status") or "") != "fail":
                _log_once(
                    existing.get("user_display") or existing.get("user_name") or "",
                    "Video Fail",
                    task_id,
                    f"{task_id[:10]} | {fail_msg or '-'}",
                    0,
                    provider_id,
                )
                asyncio.ensure_future(
                    tg.send_to_report_topic(
                        f"<b>[VIDEO THAT BAI]</b>\nNhan su: <b>{existing.get('user_display') or existing.get('user_name') or ''}</b>\nTask ID: <code>{task_id}</code>\nLy do: {fail_msg or '-'}"
                    )
                )
        else:
            progress = payload.get("progress") or 0
            if result_url:
                state = "success"
                progress = 100
                db.update_task(task_id, status="success", result_url=result_url, completed_at=datetime.now().isoformat())
                if str(existing.get("status") or "") != "success":
                    _log_once(
                        existing.get("user_display") or existing.get("user_name") or "",
                        "Video Done",
                        task_id,
                        f"{task_id[:10]} | {str(existing.get('prompt') or '')[:120]}",
                        float(existing.get("credit_used", 0) or 0),
                        provider_id,
                    )
                    asyncio.ensure_future(
                        tg.send_video_complete(
                            task_id,
                            existing.get("user_display") or existing.get("user_name") or "",
                            result_url or "",
                        )
                    )

        return {"state": state, "progress": progress, "result_url": result_url, "cover_url": cover_url, "fail_msg": fail_msg}

    @router.post("/api/video/recover")
    async def video_recover(req: VideoRecoverReq, request: Request):
        user = require_user(request)
        task_id = (req.task_id or "").strip()
        if not task_id:
            raise HTTPException(400, "Missing task_id")
        row = db.get_task(task_id)
        if not row:
            # Allow backfilling tasks that exist upstream but were missing locally.
            data = await kie.query_task(task_id)
            payload = data.get("data", {})
            status_code = payload.get("status") or payload.get("taskStatus") or payload.get("state")
            result_url = _extract_video_result_url(payload)
            duration_raw = payload.get("duration") or 5
            try:
                duration_val = int(str(duration_raw))
            except Exception:
                duration_val = 5
            credit_raw = payload.get("creditUsed") if isinstance(payload, dict) else 0
            try:
                credit_used = float(credit_raw or 0)
            except Exception:
                credit_used = 0
            output_filename = str(payload.get("output_filename") or payload.get("outputFilename") or "")
            state = "pending"
            fail_msg = ""
            if status_code in ("succeed", "completed", "success", 2):
                state = "success"
            elif status_code in ("failed", "fail", 3):
                state = "fail"
                fail_msg = payload.get("failMsg") or payload.get("message") or "Unknown error"
            if result_url and state not in ("success", "fail"):
                state = "success"

            now_iso = datetime.now().isoformat()
            db.save_task(
                task_id,
                {
                    "batch_id": "",
                    "user_name": user.get("username", ""),
                    "user_display": user.get("display_name", user.get("username", "")),
                    "status": "success" if state == "success" else ("fail" if state == "fail" else "pending"),
                    "prompt": "",
                    "gen_mode": "img2vid",
                    "duration": duration_val,
                    "aspect_ratio": "9:16",
                    "camera_move": "",
                    "credit_used": credit_used,
                    "created_at": now_iso,
                    "completed_at": now_iso if state in ("success", "fail") else "",
                    "provider": "provider1",
                    "output_filename": output_filename,
                    "source_url": "",
                    "result_url": result_url or "",
                    "fail_msg": fail_msg,
                    "task_type": "video",
                    "media_type": "video",
                },
            )
            row = db.get_task(task_id)
            if not row:
                raise HTTPException(500, "Unable to persist recovered task")
        provider_id = row.get("provider") or ""
        provider = providers.get_provider(provider_id) if provider_id else None

        state = row.get("status") or "pending"
        result_url = row.get("result_url") or ""
        fail_msg = row.get("fail_msg") or ""

        if provider:
            result = await provider.query_video(task_id)
            state = result.get("status", state)
            result_url = result.get("video_url") or result_url
            fail_msg = result.get("error") or fail_msg
            server_credit = None
            try:
                raw = result.get("raw") or {}
                payload = raw.get("data", raw) if isinstance(raw, dict) else {}
                if isinstance(payload, dict):
                    fallback_url = _extract_video_result_url(payload)
                    if fallback_url:
                        result_url = fallback_url
                    credit_raw = payload.get("creditUsed")
                    if credit_raw is not None:
                        try:
                            server_credit = float(credit_raw)
                        except Exception:
                            server_credit = None
            except Exception:
                pass
            if state not in ("success", "fail") and result_url:
                state = "success"
        else:
            data = await kie.query_task(task_id)
            payload = data.get("data", {})
            status_code = payload.get("status") or payload.get("taskStatus") or payload.get("state")
            fallback_url = _extract_video_result_url(payload)
            server_credit = None
            credit_raw = payload.get("creditUsed")
            if credit_raw is not None:
                try:
                    server_credit = float(credit_raw)
                except Exception:
                    server_credit = None
            if status_code in ("succeed", "completed", "success", 2):
                state = "success"
                result_url = fallback_url
            elif status_code in ("failed", "fail", 3):
                state = "fail"
                fail_msg = payload.get("failMsg") or payload.get("message") or fail_msg or "Unknown error"
            else:
                if fallback_url:
                    state = "success"
                    result_url = fallback_url
                else:
                    state = "pending"

        if not result_url:
            result_url = row.get("result_url") or ""
        if state not in ("success", "fail") and result_url:
            state = "success"

        upstream_name = "PIAPI" if str(provider_id or "").strip().lower() == "provider2" else "KIE"
        if state == "success" and result_url:
            output_filename = str(row.get("output_filename") or "").strip()
            patch_data = {
                "status": "success",
                "result_url": result_url,
                "completed_at": datetime.now().isoformat(),
                "output_filename": output_filename,
            }
            if server_credit is not None:
                patch_data["credit_used"] = server_credit
            db.update_task(task_id, **patch_data)
            log_activity(
                user.get("display_name") or user.get("username") or "",
                "Video Recover",
                f"{task_id[:10]} | success",
                0,
                str(provider_id or ""),
            )
            return {
                "ok": True,
                "state": "success",
                "task_id": task_id,
                "result_url": result_url,
                "provider": str(provider_id or ""),
                "msg": f"Da khoi phuc media tu {upstream_name}",
            }
        if state == "fail":
            db.update_task(task_id, status="fail", fail_msg=fail_msg, completed_at=datetime.now().isoformat())
            log_activity(
                user.get("display_name") or user.get("username") or "",
                "Video Recover",
                f"{task_id[:10]} | fail | {fail_msg or '-'}",
                0,
                str(provider_id or ""),
            )
            return {
                "ok": True,
                "state": "fail",
                "task_id": task_id,
                "fail_msg": fail_msg,
                "provider": str(provider_id or ""),
                "msg": f"Task da that bai tren {upstream_name}",
            }
        log_activity(
            user.get("display_name") or user.get("username") or "",
            "Video Recover",
            f"{task_id[:10]} | pending",
            0,
            str(provider_id or ""),
        )
        return {
            "ok": True,
            "state": "pending",
            "task_id": task_id,
            "provider": str(provider_id or ""),
            "msg": f"Task van dang xu ly tren {upstream_name}",
        }

    @router.post("/api/video/batch")
    async def video_batch(req: BatchVideoReq, request: Request):
        user = require_user(request)
        if not req.items:
            raise HTTPException(400, "No batch items")

        requested_provider = str(req.provider or "").strip().lower()
        provider = providers.get_provider(requested_provider or providers.get_default_provider_id())
        if not provider:
            raise HTTPException(404, "Provider not found")
        provider_id = provider.provider_id
        model_id = req.model_id or ""
        model_snapshot = _resolve_model_snapshot(provider, provider_id, model_id)
        batch_id = f"VBATCH_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:6].upper()}"
        linked_work_task_id = req.work_task_id or ""
        active_wt = None
        if not linked_work_task_id:
            active_wt = db.get_active_work_task(user["username"])
            linked_work_task_id = active_wt["id"] if active_wt else ""
        user_sem = _get_user_batch_semaphore(user.get("username"))

        async def _process_one(item: BatchVideoItem, seq: int):
            parts = []
            if item.prompt:
                parts.append(item.prompt.strip())
            if item.camera_move_id:
                camera_prompt = find_camera(item.camera_move_id)
                if camera_prompt:
                    parts.append(camera_prompt)
            full_prompt = ". ".join(parts) if parts else "cinematic video"
            item_duration = item.duration or 5
            item_aspect = item.aspect_ratio or "16:9"
            if hasattr(provider.get_credit_cost, "__code__") and "model_id" in provider.get_credit_cost.__code__.co_varnames:
                credit = provider.get_credit_cost(item_duration, model_id=model_id)
            else:
                credit = provider.get_credit_cost(item_duration)
            create_kwargs = {
                "prompt": full_prompt,
                "duration": item_duration,
                "aspect_ratio": item_aspect,
                "image_url": item.image_url or None,
                "end_image_url": item.end_image_url or None,
                "negative_prompt": req.negative_prompt,
            }
            if model_id and hasattr(provider.create_video, "__code__") and "model_id" in provider.create_video.__code__.co_varnames:
                create_kwargs["model_id"] = model_id
            try:
                task_id = ""
                last_exc = None
                for attempt in range(1, 4):
                    try:
                        async with user_sem:
                            async with semaphore:
                                task_id = await provider.create_video(**create_kwargs)
                        break
                    except Exception as exc:
                        last_exc = exc
                        if attempt >= 3 or (not _is_retryable_batch_error(exc)):
                            raise
                        wait_s = min(8, 2 * attempt)
                        logger.warning(
                            "batch item throttled (%s/%s), retry %s in %ss: %s",
                            seq,
                            len(req.items),
                            attempt,
                            wait_s,
                            exc,
                        )
                        await asyncio.sleep(wait_s)
                if not task_id and last_exc:
                    raise last_exc
                filename = item.filename or f"batch_{seq:03d}.mp4"
                db.save_task(
                    task_id,
                    {
                        "batch_id": batch_id,
                        "user_name": user["username"],
                        "user_display": user["display_name"],
                        "status": "pending",
                        "prompt": full_prompt,
                        "gen_mode": item.gen_mode,
                        "duration": item_duration,
                        "aspect_ratio": item_aspect,
                        "camera_move": item.camera_move_id or "",
                        "credit_used": credit,
                        "provider": provider_id,
                        "model_id": model_snapshot["model_id"],
                        "model_label": model_snapshot["model_label"],
                        "cost_unit": model_snapshot["cost_unit"],
                        "output_filename": filename,
                        "source_url": item.image_url or "",
                        "task_type": "video",
                    },
                )
                if linked_work_task_id:
                    db.link_video_to_work_task(task_id, linked_work_task_id)
                _log_once(
                    user["display_name"],
                    "Video Start",
                    task_id,
                    f"{task_id[:10]} | {full_prompt[:120]}",
                    float(credit or 0),
                    provider_id,
                )
                return {
                    "seq": seq,
                    "task_id": task_id,
                    "status": "pending",
                    "filename": filename,
                    "prompt": full_prompt,
                }
            except Exception as exc:
                logger.error("batch item create failed (%s/%s): %s", seq, len(req.items), exc, exc_info=True)
                fail_task_id = f"{batch_id}_fail_{seq:03d}_{uuid.uuid4().hex[:6]}"
                item_duration = item.duration or 5
                item_aspect = item.aspect_ratio or "16:9"
                try:
                    db.save_task(
                        fail_task_id,
                        {
                            "batch_id": batch_id,
                            "user_name": user["username"],
                            "user_display": user["display_name"],
                            "status": "fail",
                            "prompt": item.prompt or "",
                            "gen_mode": item.gen_mode or "img2vid",
                            "duration": item_duration,
                            "aspect_ratio": item_aspect,
                            "camera_move": item.camera_move_id or "",
                            "credit_used": 0,
                            "provider": provider_id,
                            "model_id": model_snapshot["model_id"],
                            "model_label": model_snapshot["model_label"],
                            "cost_unit": model_snapshot["cost_unit"],
                            "output_filename": item.filename or f"batch_{seq:03d}.mp4",
                            "source_url": item.image_url or "",
                            "task_type": "video",
                        },
                    )
                    db.update_task(
                        fail_task_id,
                        status="fail",
                        fail_msg=str(exc),
                        completed_at=datetime.now().isoformat(),
                    )
                    if linked_work_task_id:
                        db.link_video_to_work_task(fail_task_id, linked_work_task_id)
                except Exception:
                    logger.warning("batch fail-row save failed (%s/%s)", seq, len(req.items), exc_info=True)
                return {
                    "seq": seq,
                    "task_id": fail_task_id,
                    "status": "fail",
                    "filename": item.filename or f"batch_{seq:03d}.mp4",
                    "prompt": item.prompt or "",
                    "fail_msg": str(exc),
                }

        tasks = [_process_one(item, i + 1) for i, item in enumerate(req.items)]
        results = await asyncio.gather(*tasks)
        asyncio.ensure_future(
            tg.send_batch_started(
                user["display_name"],
                batch_id,
                len(req.items),
                req.task_name or "",
            )
        )
        return {
            "batch_id": batch_id,
            "total": len(req.items),
            "completed": sum(1 for r in results if r.get("status") == "fail"),
            "tasks": results,
            "work_task_id": linked_work_task_id or None,
        }

    @router.get("/api/video/batch-status/{batch_id}")
    async def video_batch_status(batch_id: str, request: Request):
        require_user(request)
        rows = db.get_tasks_by_batch(batch_id)
        if not rows:
            raise HTTPException(404, "Batch not found")

        tasks = []
        completed = 0
        for row in rows:
            prev_status = str(row.get("status") or "")
            status = row.get("status", "pending")
            result_url = row.get("result_url", "")
            fail_msg = row.get("fail_msg", "")
            progress = 100 if status == "success" else (0 if status == "fail" else 0)

            if status not in ("success", "fail", "cancelled"):
                provider = providers.get_provider(row.get("provider"))
                if provider:
                    try:
                        result = await provider.query_video(row["task_id"])
                        status = result.get("status", status)
                        result_url = result.get("video_url") or result_url
                        fail_msg = result.get("error") or fail_msg
                        try:
                            progress = int(float(result.get("progress", progress) or 0))
                        except Exception:
                            progress = 0
                        if status not in ("success", "fail") and result_url:
                            status = "success"
                        progress = 100 if status == "success" else (0 if status == "fail" else max(0, min(99, progress)))
                        if status == "success":
                            db.update_task(
                                row["task_id"],
                                status="success",
                                result_url=result_url,
                                completed_at=datetime.now().isoformat(),
                            )
                            if prev_status != "success":
                                _log_once(
                                    row.get("user_display") or row.get("user_name") or "",
                                    "Video Done",
                                    row["task_id"],
                                    f"{str(row['task_id'])[:10]} | {str(row.get('prompt') or '')[:120]}",
                                    float(row.get("credit_used", 0) or 0),
                                    row.get("provider") or "",
                                )
                                asyncio.ensure_future(
                                    tg.send_batch_row_result(
                                        batch_id,
                                        row["task_id"],
                                        row.get("user_display") or row.get("user_name") or "",
                                        True,
                                        result_url,
                                        "",
                                    )
                                )
                        elif status == "fail":
                            db.update_task(
                                row["task_id"],
                                status="fail",
                                fail_msg=fail_msg,
                                completed_at=datetime.now().isoformat(),
                            )
                            if prev_status != "fail":
                                _log_once(
                                    row.get("user_display") or row.get("user_name") or "",
                                    "Video Fail",
                                    row["task_id"],
                                    f"{str(row['task_id'])[:10]} | {fail_msg or '-'}",
                                    0,
                                    row.get("provider") or "",
                                )
                                asyncio.ensure_future(
                                    tg.send_batch_row_result(
                                        batch_id,
                                        row["task_id"],
                                        row.get("user_display") or row.get("user_name") or "",
                                        False,
                                        "",
                                        fail_msg,
                                    )
                                )
                    except Exception as exc:
                        logger.warning("batch poll error for %s: %s", row["task_id"], exc)

            if status in ("success", "fail", "cancelled"):
                completed += 1
            tasks.append(
                {
                    "task_id": row["task_id"],
                    "status": status,
                    "progress": progress,
                    "result_url": result_url,
                    "fail_msg": fail_msg,
                    "prompt": row.get("prompt", ""),
                    "output_filename": row.get("output_filename", ""),
                }
            )

        return {
            "batch_id": batch_id,
            "total": len(tasks),
            "completed": completed,
            "tasks": tasks,
        }

    @router.get("/api/video/download-zip/{batch_id}")
    async def video_download_zip(batch_id: str, request: Request):
        require_user(request)
        rows = [row for row in db.get_tasks_by_batch(batch_id) if row.get("status") == "success" and row.get("result_url")]
        if not rows:
            raise HTTPException(404, "No completed videos found")

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for idx, row in enumerate(rows, 1):
                filename = row.get("output_filename") or f"batch_{idx:03d}.mp4"
                if not filename.lower().endswith(".mp4"):
                    filename = f"{os.path.splitext(filename)[0]}.mp4"
                try:
                    resp = requests.get(row["result_url"], timeout=60)
                    resp.raise_for_status()
                    zf.writestr(filename, resp.content)
                except Exception as exc:
                    logger.error("Failed to add %s to zip: %s", row["task_id"], exc)

        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename={batch_id}.zip"},
        )

    @router.post("/api/video/recover-stuck")
    async def recover_stuck_media(request: Request):
        user = require_user(request)
        # Recover scope:
        # - pending/processing tasks
        # - success tasks but missing result_url (data drift / previous write failure)
        conn = db.get_conn()
        try:
            if user.get("role") == "admin":
                rows = conn.execute(
                    """
                    SELECT * FROM tasks
                    WHERE status IN ('pending','processing')
                       OR (status='success' AND COALESCE(result_url,'')='')
                    ORDER BY id DESC
                    LIMIT 500
                    """
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT * FROM tasks
                    WHERE user_name=?
                      AND (
                            status IN ('pending','processing')
                         OR (status='success' AND COALESCE(result_url,'')='')
                      )
                    ORDER BY id DESC
                    LIMIT 500
                    """,
                    (user["username"],),
                ).fetchall()
        finally:
            conn.close()
        rows = [dict(r) for r in rows]
        recovered = []
        still_pending = []
        failed = []
        errors = []

        for row in rows:
            try:
                task_id = row.get("task_id") or ""
                if not task_id:
                    continue
                task_type = row.get("task_type") or "video"
                provider_id = row.get("provider") or ""
                if task_type in ("image", "image_edit") or str(row.get("gen_mode") or "").lower() == "image_edit":
                    result = await kie.query_task(task_id)
                    code = result.get("code", 0)
                    payload = result.get("data", {})
                    status_raw = payload.get("status", payload.get("state", ""))
                    status_norm = status_raw.lower() if isinstance(status_raw, str) else status_raw
                    result_url = _extract_image_result_url(payload)
                    if code == 200 and result_url and status_norm not in ("failed", "fail", 3):
                        db.update_task(task_id, status="success", result_url=result_url, completed_at=datetime.now().isoformat())
                        recovered.append({"task_id": task_id, "kind": "image", "result_url": result_url})
                    elif code == 200 and status_norm in ("failed", "fail", 3):
                        fail_msg = payload.get("failReason") or payload.get("message") or "Unknown error"
                        db.update_task(task_id, status="fail", fail_msg=fail_msg, completed_at=datetime.now().isoformat())
                        failed.append({"task_id": task_id, "kind": "image", "fail_msg": fail_msg})
                    else:
                        still_pending.append({"task_id": task_id, "kind": "image"})
                    continue

                provider = providers.get_provider(provider_id) if provider_id else None
                if provider:
                    result = await provider.query_video(task_id)
                    status = result.get("status", row.get("status") or "pending")
                    result_url = result.get("video_url") or ""
                    fail_msg = result.get("error") or ""
                else:
                    data = await kie.query_task(task_id)
                    payload = data.get("data", {})
                    status_code = payload.get("status") or payload.get("taskStatus")
                    status = "pending"
                    result_url = ""
                    fail_msg = ""
                    if status_code in ("succeed", "completed", 2):
                        status = "success"
                        result_url = _extract_video_result_url(payload)
                    elif status_code in ("failed", 3):
                        status = "fail"
                        fail_msg = payload.get("failMsg") or payload.get("message") or "Unknown error"

                if status == "success" and result_url:
                    db.update_task(task_id, status="success", result_url=result_url, completed_at=datetime.now().isoformat())
                    recovered.append({"task_id": task_id, "kind": "video", "result_url": result_url})
                elif status == "fail":
                    db.update_task(task_id, status="fail", fail_msg=fail_msg, completed_at=datetime.now().isoformat())
                    failed.append({"task_id": task_id, "kind": "video", "fail_msg": fail_msg})
                else:
                    still_pending.append({"task_id": task_id, "kind": "video"})
            except Exception as exc:
                logger.exception("recover_stuck_media failed for task_id=%s", row.get("task_id"))
                errors.append(
                    {
                        "task_id": row.get("task_id") or "",
                        "kind": row.get("task_type") or "video",
                        "error": str(exc),
                    }
                )
                continue

        return {
            "ok": True,
            "recovered": recovered,
            "failed": failed,
            "pending": still_pending,
            "errors": errors,
            "summary": {
                "recovered": len(recovered),
                "failed": len(failed),
                "pending": len(still_pending),
                "errors": len(errors),
            },
        }

    return router

