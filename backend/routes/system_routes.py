"""System and admin announcement routes."""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
import aiohttp
import json

try:
    from .. import settings_store
except ImportError:
    import settings_store


class Login2FASettingsReq(BaseModel):
    enabled: bool


class TelegramOutboundSettingsReq(BaseModel):
    blocked: bool


class ChatSendShortcutReq(BaseModel):
    mode: str


class TelegramConfigReq(BaseModel):
    bot_token: str = ""
    chat_id: str
    admin_id: str = ""
    qc_topic_id: str = ""


class TelegramTestReq(BaseModel):
    message: str = "Telegram test from F-Aistudio"


class ShiftTemplateRow(BaseModel):
    label: str
    start: str
    end: str


class ShiftConfigReq(BaseModel):
    morning: ShiftTemplateRow
    afternoon: ShiftTemplateRow
    evening: ShiftTemplateRow


class HeartbeatReq(BaseModel):
    current_code: str = ""
    current_task: str = ""


def _mask_token(value: str) -> str:
    s = str(value or "").strip()
    if len(s) <= 10:
        return "*" * len(s)
    return s[:6] + "*" * max(0, len(s) - 10) + s[-4:]


def create_system_router(require_user, require_admin, db, active_sessions, admin_announcements):
    router = APIRouter()

    def require_qc_or_admin(request: Request):
        user = require_user(request)
        role = str(user.get("role") or "").strip().lower()
        if role not in {"admin", "qc_manager"}:
            raise HTTPException(403, "QC manager or admin only")
        return user

    @router.post("/api/system/heartbeat")
    async def system_heartbeat(request: Request):
        """Client heartbeat: keep session alive every 15 seconds."""
        user = require_user(request)
        import time
        payload = {}
        try:
            payload = await request.json()
        except Exception:
            payload = {}
        parsed_entries = []
        try:
            raw_entries = payload.get("current_entries")
            raw_csv = str(payload.get("current_entries_csv") or "").strip()
            if raw_csv:
                raw_entries = []
                for part in raw_csv.split("|"):
                    chunk = str(part or "").strip()
                    if not chunk:
                        continue
                    code, _, task = chunk.partition("::")
                    code = str(code or "").strip()
                    task = str(task or "").strip()
                    if code:
                        raw_entries.append({"code": code, "task": task})
            elif not isinstance(raw_entries, list):
                raw_entries = json.loads(str(payload.get("current_entries_json") or "[]"))
            parsed_entries = [
                {
                    "code": str(item.get("code") or "").strip(),
                    "task": str(item.get("task") or "").strip(),
                }
                for item in (raw_entries or [])
                if isinstance(item, dict) and str(item.get("code") or "").strip()
            ]
        except Exception:
            parsed_entries = []

        conn = db.get_conn()
        active = conn.execute(
            "SELECT COUNT(*) FROM tasks WHERE user_name=? AND status='pending'",
            (user["username"],),
        ).fetchone()[0]
        conn.close()

        previous_session = db.get_live_presence(user["username"]) or {}
        has_current_code = "current_code" in payload
        has_current_task = "current_task" in payload
        has_current_entries = ("current_entries" in payload) or ("current_entries_json" in payload) or ("current_entries_csv" in payload)
        now_ts = float(time.time())
        online_since = float(previous_session.get("online_since") or now_ts)
        shift_started_at = float(previous_session.get("shift_started_at") or 0)
        if not shift_started_at:
            try:
                shift_conn = db.get_conn()
                row = shift_conn.execute(
                    "SELECT created_at FROM work_tasks WHERE user_name=? AND status='active' ORDER BY created_at DESC LIMIT 1",
                    (user["username"],),
                ).fetchone()
                shift_conn.close()
                shift_started_at = float(row["created_at"] or 0) if row else 0
            except Exception:
                shift_started_at = 0
        announced_codes = set(
            str(item or "").strip()
            for item in (previous_session.get("announced_codes") or [])
            if str(item or "").strip()
        )
        current_code = str(payload.get("current_code") or "").strip() if has_current_code else str(previous_session.get("current_code") or "").strip()
        current_task = str(payload.get("current_task") or "").strip() if has_current_task else str(previous_session.get("current_task") or "").strip()
        current_entries = [
            item
            for item in (parsed_entries if has_current_entries else (previous_session.get("current_entries") or []))
            if isinstance(item, dict) and str(item.get("code") or "").strip()
        ]
        db.upsert_live_presence({
            "user_name": user["username"],
            "display_name": user["display_name"],
            "role": user["role"],
            "last_seen": now_ts,
            "online_since": online_since,
            "active_tasks": active,
            "current_code": current_code,
            "current_task": current_task,
            "current_entries": current_entries,
            "shift_started_at": shift_started_at,
            "announced_codes": sorted(announced_codes),
        })
        try:
            prev_codes = set(
                str(item.get("code") or "").strip()
                for item in (previous_session.get("current_entries") or [])
                if str(item.get("code") or "").strip()
            )
            new_codes = set(
                str(item.get("code") or "").strip()
                for item in current_entries
                if str(item.get("code") or "").strip()
            )
            added_codes = [code for code in new_codes if code and code not in prev_codes and code not in announced_codes]
            if added_codes and has_current_entries:
                notify_conn = db.get_conn()
                target_rows = notify_conn.execute(
                    "SELECT id, username, display_name, role FROM users WHERE active=1 AND role IN ('admin','qc_manager')"
                ).fetchall()
                sent_codes = []
                for code in added_codes:
                    notify_body = f"{user['display_name']} bắt đầu {code}"
                    duplicate_row = notify_conn.execute(
                        "SELECT id FROM notifications WHERE type='staff_code_started' AND created_at >= ? AND body = ? ORDER BY created_at DESC LIMIT 1",
                        (
                            float(time.time()) - 21600,
                            notify_body,
                        ),
                    ).fetchone()
                    if duplicate_row:
                        continue
                    for row in target_rows:
                        db.add_notification(
                            row["id"],
                            "staff_code_started",
                            "Staff bắt đầu CODE mới",
                            f"{user['display_name']} bắt đầu {code}",
                            {"username": user["username"], "code": code},
                        )
                    try:
                        from .. import telegram_bot as tg  # type: ignore
                    except ImportError:
                        import telegram_bot as tg  # type: ignore
                    await tg.send_work_task_started(user["display_name"], code, json.dumps({"notes": f"CODE moi: {code}"}))
                    sent_codes.append(code)
                notify_conn.close()
                db.upsert_live_presence({
                    "user_name": user["username"],
                    "display_name": user["display_name"],
                    "role": user["role"],
                    "last_seen": now_ts,
                    "online_since": online_since,
                    "active_tasks": active,
                    "current_code": current_code,
                    "current_task": current_task,
                    "current_entries": current_entries,
                    "shift_started_at": shift_started_at,
                    "announced_codes": sorted(announced_codes | set(sent_codes)),
                })
        except Exception:
            pass
        return {"ok": True, "announcements": admin_announcements}

    @router.get("/api/system/status")
    async def system_status(request: Request):
        """Return online staff and queue status."""
        require_user(request)
        import time

        now = time.time()
        presence_rows = db.list_live_presence(60)
        online = {}
        for row in presence_rows:
            username = str(row.get("user_name") or "").strip()
            if not username:
                continue
            online[username] = {
                "display_name": row.get("display_name") or username,
                "role": row.get("role") or "staff",
                "last_seen": float(row.get("last_seen") or now),
                "online_since": float(row.get("online_since") or row.get("last_seen") or now),
                "active_tasks": int(row.get("active_tasks") or 0),
                "current_task": row.get("current_task") or "",
                "current_code": row.get("current_code") or "",
                "current_entries": (
                    row.get("current_entries")
                    or (
                        [{"code": str(row.get("current_code") or "").strip(), "task": str(row.get("current_task") or "").strip()}]
                        if str(row.get("current_code") or "").strip()
                        else []
                    )
                ),
                "shift_started_at": float(row.get("shift_started_at") or 0),
            }

        conn = db.get_conn()
        pending_video = conn.execute(
            "SELECT COUNT(*) FROM tasks WHERE status='pending' AND gen_mode IN ('img2vid','frames','txt2vid')"
        ).fetchone()[0]
        pending_image = conn.execute(
            "SELECT COUNT(*) FROM tasks WHERE status='pending' AND gen_mode='image_edit'"
        ).fetchone()[0]
        active_work_rows = conn.execute(
            """
            SELECT
                wt.user_name,
                wt.user_display,
                wt.title,
                wt.created_at,
                COALESCE(
                    (
                        SELECT NULLIF(t.product_code, '')
                        FROM tasks t
                        WHERE t.work_task_id = wt.id
                        ORDER BY t.id DESC
                        LIMIT 1
                    ),
                    ''
                ) AS current_code
            FROM work_tasks wt
            WHERE wt.status='active'
            ORDER BY wt.created_at DESC
            """
        ).fetchall()
        user_rows = conn.execute(
            "SELECT username, display_name, role FROM users WHERE active=1"
        ).fetchall()
        conn.close()

        role_map = {
            str(row["username"]): {
                "display_name": row["display_name"] or row["username"],
                "role": row["role"] or "staff",
            }
            for row in user_rows
        }
        active_task_count = {}
        for row in active_work_rows:
            username = str(row["user_name"] or "").strip()
            if not username:
                continue
            active_task_count[username] = active_task_count.get(username, 0) + 1
            base = online.get(username, {})
            role_info = role_map.get(username, {})
            online[username] = {
                "display_name": base.get("display_name") or role_info.get("display_name") or row["user_display"] or username,
                "role": base.get("role") or role_info.get("role") or "staff",
                "last_seen": max(float(base.get("last_seen") or 0), float(row["created_at"] or 0), now),
                "online_since": float(row["created_at"] or base.get("online_since") or now),
                "active_tasks": active_task_count[username],
                "current_task": base.get("current_task") or row["title"] or "",
                "current_code": base.get("current_code") or row["current_code"] or "",
                "current_entries": (
                    base.get("current_entries")
                    or (
                        [{"code": str((base.get("current_code") or row["current_code"] or "")).strip(), "task": str(base.get("current_task") or row["title"] or "").strip()}]
                        if str((base.get("current_code") or row["current_code"] or "")).strip()
                        else []
                    )
                ),
                "shift_started_at": float(row["created_at"] or 0),
            }

        return {
            "online_staff": [
                {
                    "username": k,
                    "display_name": v["display_name"],
                    "role": v["role"],
                    "active_tasks": v["active_tasks"],
                    "last_seen": v["last_seen"],
                    "online_since": v.get("online_since") or v["last_seen"],
                    "current_task": v.get("current_task") or "",
                    "current_code": v.get("current_code") or "",
                    "current_entries": v.get("current_entries") or [],
                    "shift_started_at": v.get("shift_started_at") or 0,
                    "online_seconds": max(
                        0,
                        int(
                            now
                            - float(
                                (v.get("shift_started_at") or 0)
                                if str(v.get("role") or "").lower() == "staff" and float(v.get("shift_started_at") or 0) > 0
                                else (v.get("online_since") or v["last_seen"] or now)
                            )
                        ),
                    ),
                }
                for k, v in online.items()
            ],
            "online_count": len(online),
            "pending_video": pending_video,
            "pending_image": pending_image,
            "announcements": admin_announcements,
        }

    @router.get("/api/system/shift-config")
    async def system_get_shift_config(request: Request):
        require_user(request)
        settings = settings_store.load_settings()
        return dict(settings.get("shift_templates") or {})

    @router.get("/api/admin/settings/shift-config")
    async def admin_get_shift_config(request: Request):
        require_qc_or_admin(request)
        settings = settings_store.load_settings()
        return dict(settings.get("shift_templates") or {})

    @router.post("/api/admin/settings/shift-config")
    async def admin_set_shift_config(req: ShiftConfigReq, request: Request):
        require_qc_or_admin(request)

        def _clean(row: ShiftTemplateRow):
            return {
                "label": str(row.label or "").strip(),
                "start": str(row.start or "").strip(),
                "end": str(row.end or "").strip(),
            }

        templates = {
            "morning": _clean(req.morning),
            "afternoon": _clean(req.afternoon),
            "evening": _clean(req.evening),
        }
        for key, row in templates.items():
            if not row["label"] or not row["start"] or not row["end"]:
                raise HTTPException(400, f"shift template '{key}' is incomplete")
        settings = settings_store.update_settings({"shift_templates": templates})
        return {"ok": True, "shift_templates": dict(settings.get("shift_templates") or {})}

    @router.post("/api/admin/announce")
    async def admin_announce(request: Request):
        """Admin broadcast announcement to all online staff."""
        user = require_admin(request)
        body = await request.json()
        import time

        ann = {
            "message": body.get("message", ""),
            "maintenance_at": body.get("maintenance_at", ""),
            "created_by": user["display_name"],
            "timestamp": time.time(),
        }
        admin_announcements.append(ann)
        while len(admin_announcements) > 5:
            admin_announcements.pop(0)
        return {"ok": True}

    @router.get("/api/admin/settings")
    async def admin_get_settings(request: Request):
        require_admin(request)
        return settings_store.load_settings()

    @router.get("/api/admin/settings/login-2fa")
    async def admin_get_login_2fa(request: Request):
        require_admin(request)
        return {"enabled": settings_store.is_login_2fa_enabled()}

    @router.post("/api/admin/settings/login-2fa")
    async def admin_set_login_2fa(req: Login2FASettingsReq, request: Request):
        require_admin(request)
        settings = settings_store.update_settings({"login_2fa_enabled": bool(req.enabled)})
        return {"ok": True, "enabled": settings["login_2fa_enabled"]}

    @router.get("/api/admin/settings/telegram-outbound")
    async def admin_get_telegram_outbound(request: Request):
        require_admin(request)
        return {"blocked": settings_store.is_telegram_outbound_blocked()}

    @router.post("/api/admin/settings/telegram-outbound")
    async def admin_set_telegram_outbound(req: TelegramOutboundSettingsReq, request: Request):
        require_admin(request)
        settings = settings_store.update_settings({"telegram_outbound_blocked": bool(req.blocked)})
        return {"ok": True, "blocked": settings["telegram_outbound_blocked"]}

    @router.get("/api/admin/settings/chat-send-shortcut")
    async def admin_get_chat_send_shortcut(request: Request):
        require_admin(request)
        return {"mode": settings_store.get_chat_send_shortcut()}

    @router.post("/api/admin/settings/chat-send-shortcut")
    async def admin_set_chat_send_shortcut(req: ChatSendShortcutReq, request: Request):
        require_admin(request)
        mode = str(req.mode or "").strip().lower()
        if mode not in {"enter", "shift_enter"}:
            mode = "enter"
        settings = settings_store.update_settings({"chat_send_shortcut": mode})
        return {"ok": True, "mode": settings["chat_send_shortcut"]}

    @router.get("/api/system/settings/chat-send-shortcut")
    async def system_get_chat_send_shortcut(request: Request):
        require_user(request)
        return {"mode": settings_store.get_chat_send_shortcut()}

    # Backward/compat aliases to avoid 404 from mixed client builds
    @router.get("/api/admin/settings/telegram_outbound")
    async def admin_get_telegram_outbound_legacy(request: Request):
        require_admin(request)
        return {"blocked": settings_store.is_telegram_outbound_blocked()}

    @router.post("/api/admin/settings/telegram_outbound")
    async def admin_set_telegram_outbound_legacy(req: TelegramOutboundSettingsReq, request: Request):
        require_admin(request)
        settings = settings_store.update_settings({"telegram_outbound_blocked": bool(req.blocked)})
        return {"ok": True, "blocked": settings["telegram_outbound_blocked"]}

    @router.get("/api/system/telegram-outbound")
    async def system_get_telegram_outbound(request: Request):
        require_admin(request)
        return {"blocked": settings_store.is_telegram_outbound_blocked()}

    @router.post("/api/system/telegram-outbound")
    async def system_set_telegram_outbound(req: TelegramOutboundSettingsReq, request: Request):
        require_admin(request)
        settings = settings_store.update_settings({"telegram_outbound_blocked": bool(req.blocked)})
        return {"ok": True, "blocked": settings["telegram_outbound_blocked"]}

    @router.get("/api/admin/settings/telegram-config")
    async def admin_get_telegram_config(request: Request):
        require_admin(request)
        settings = settings_store.load_settings()
        token = str(settings.get("telegram_bot_token") or "")
        return {
            "bot_token_masked": _mask_token(token) if token else "",
            "chat_id": str(settings.get("telegram_chat_id") or ""),
            "admin_id": str(settings.get("telegram_admin_id") or ""),
            "qc_topic_id": str(settings.get("telegram_qc_topic_id") or ""),
            "has_token": bool(token),
        }

    @router.post("/api/admin/settings/telegram-config")
    async def admin_set_telegram_config(req: TelegramConfigReq, request: Request):
        require_admin(request)
        bot_token = str(req.bot_token or "").strip()
        chat_id = str(req.chat_id or "").strip()
        if not chat_id:
            raise HTTPException(400, "chat_id là bắt buộc")
        current = settings_store.load_settings()
        effective_token = bot_token or str(current.get("telegram_bot_token") or "").strip()
        if not effective_token:
            raise HTTPException(400, "bot_token là bắt buộc ở lần lưu đầu tiên")
        settings = settings_store.update_settings({
            "telegram_bot_token": effective_token,
            "telegram_chat_id": chat_id,
            "telegram_admin_id": str(req.admin_id or "").strip(),
            "telegram_qc_topic_id": str(req.qc_topic_id or "").strip(),
        })
        return {
            "ok": True,
            "bot_token_masked": _mask_token(settings.get("telegram_bot_token", "")),
            "chat_id": settings.get("telegram_chat_id", ""),
            "admin_id": settings.get("telegram_admin_id", ""),
            "qc_topic_id": settings.get("telegram_qc_topic_id", ""),
        }

    @router.post("/api/admin/settings/telegram-test")
    async def admin_test_telegram(req: TelegramTestReq, request: Request):
        require_admin(request)
        settings = settings_store.load_settings()
        token = str(settings.get("telegram_bot_token") or "").strip()
        chat_id = str(settings.get("telegram_chat_id") or "").strip()
        topic_id = str(settings.get("telegram_qc_topic_id") or "").strip()
        if not token or not chat_id:
            raise HTTPException(400, "Thiếu telegram_bot_token hoặc telegram_chat_id trong settings")
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = {"chat_id": chat_id, "text": str(req.message or "Telegram test from F-Aistudio")}
        if topic_id:
            try:
                payload["message_thread_id"] = int(topic_id)
            except Exception:
                pass
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as session:
                async with session.post(url, json=payload) as resp:
                    data = await resp.json()
                    if not data.get("ok"):
                        raise HTTPException(400, f"Telegram API lỗi: {data.get('description', 'unknown')}")
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(500, f"Telegram test lỗi: {exc}")
        return {"ok": True, "message": "Telegram test sent"}

    return router
