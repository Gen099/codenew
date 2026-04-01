"""Telegram Bot — sends notifications with InlineKeyboard callback buttons.
Uses long-polling to listen for callback_query (approve/reject clicks)
and message commands (/baocao_ngay etc.).
"""
import os, logging, asyncio, json
from datetime import datetime
from typing import Optional
import aiohttp
from dotenv import load_dotenv
from activity_logger import log_activity
try:
    from . import settings_store  # type: ignore
except ImportError:
    import settings_store  # type: ignore

load_dotenv()

logger = logging.getLogger(__name__)

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
ADMIN_ID = os.getenv("TELEGRAM_ADMIN_ID", "")

# Forum topic thread IDs (set in .env)
LOGIN_TOPIC_ID = os.getenv("TELEGRAM_LOGIN_TOPIC_ID", "")
QC_TOPIC_ID = os.getenv("TELEGRAM_QC_TOPIC_ID", "")
REPORT_TOPIC_ID = os.getenv("TELEGRAM_REPORT_TOPIC_ID", "")

_session: Optional[aiohttp.ClientSession] = None
_poll_task: Optional[asyncio.Task] = None
_callback_handler = None  # Set by backend main.py
_command_handler = None   # Called for /baocao_* commands
_poll_owner_has_lock: bool = False


def _poll_lock_path() -> str:
    return str(os.getenv("TELEGRAM_POLL_LOCK_FILE", "/tmp/faistudio_telegram_poll.lock")).strip() or "/tmp/faistudio_telegram_poll.lock"


def _is_pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _acquire_poll_owner_lock() -> bool:
    path = _poll_lock_path()
    pid = os.getpid()
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(str(pid))
        return True
    except FileExistsError:
        try:
            with open(path, "r", encoding="utf-8") as f:
                existing = int(str(f.read() or "0").strip() or "0")
        except Exception:
            existing = 0
        if existing and _is_pid_alive(existing):
            return False
        try:
            os.remove(path)
        except Exception:
            return False
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(str(pid))
            return True
        except Exception:
            return False


def _release_poll_owner_lock() -> None:
    path = _poll_lock_path()
    try:
        with open(path, "r", encoding="utf-8") as f:
            existing = int(str(f.read() or "0").strip() or "0")
    except Exception:
        existing = 0
    if existing and existing != os.getpid():
        return
    try:
        os.remove(path)
    except Exception:
        pass


async def _get_session():
    global _session
    if _session is None or _session.closed:
        _session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))
    return _session


def is_configured() -> bool:
    return bool(BOT_TOKEN and CHAT_ID)


def polling_enabled() -> bool:
    raw = os.getenv("TELEGRAM_POLLING_ENABLED", "").strip().lower()
    if raw:
        return raw in {"1", "true", "yes", "on"}
    mode = (os.getenv("VIDEOTOOL_MODE") or "standalone").strip().lower()
    return mode != "standalone"


def auto_reports_enabled() -> bool:
    raw = os.getenv("TELEGRAM_AUTO_REPORTS_ENABLED", "").strip().lower()
    if raw:
        return raw in {"1", "true", "yes", "on"}
    mode = (os.getenv("VIDEOTOOL_MODE") or "standalone").strip().lower()
    return mode != "standalone"


def _telegram_outbound_allowed(topic_id: str = "", text: str = "") -> bool:
    if settings_store.is_telegram_outbound_blocked():
        logger.info("Telegram outbound blocked by admin setting")
        log_activity(
            "telegram_bot",
            "Telegram Send",
            f"blocked_by_setting | topic={topic_id or '-'} | text={(text or '')[:120]}",
            0,
            "telegram",
        )
        return False
    return True


async def _send(text: str, topic_id: str = "", parse_mode="HTML",
                reply_markup: dict = None, chat_id_override: str = ""):
    """Send a message, optionally to a specific forum topic."""
    if not _telegram_outbound_allowed(topic_id, text):
        return None
    if not is_configured():
        logger.warning("Telegram not configured")
        return None
    s = await _get_session()
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    target_chat = chat_id_override or CHAT_ID
    payload = {"chat_id": target_chat, "text": text, "parse_mode": parse_mode,
               "disable_web_page_preview": True}
    if topic_id:
        payload["message_thread_id"] = int(topic_id)
    if reply_markup:
        payload["reply_markup"] = json.dumps(reply_markup)
    try:
        async with s.post(url, json=payload) as resp:
            data = await resp.json()
            if not data.get("ok"):
                logger.error("Telegram send failed: %s", data.get("description", data))
                log_activity(
                    "telegram_bot",
                    "Telegram Send",
                    f"send failed | topic={topic_id or '-'} | chat={target_chat} | {str(data.get('description', data))[:180]}",
                    0,
                    "telegram",
                )
                return None
            log_activity(
                "telegram_bot",
                "Telegram Send",
                f"send ok | topic={topic_id or '-'} | chat={target_chat} | {(text or '')[:180]}",
                0,
                "telegram",
            )
            return data.get("result")
    except Exception as e:
        logger.error("Telegram send error: %s", e)
        log_activity(
            "telegram_bot",
            "Telegram Send",
            f"send error | topic={topic_id or '-'} | chat={target_chat} | {str(e)[:180]}",
            0,
            "telegram",
        )
        return None


async def _send_media(
    media_kind: str,
    media_url: str,
    caption: str,
    topic_id: str = "",
    parse_mode: str = "HTML",
    reply_markup: dict = None,
    chat_id_override: str = "",
):
    """Send media directly so Telegram shows inline preview."""
    if not _telegram_outbound_allowed(topic_id, caption):
        return None
    if not is_configured():
        logger.warning("Telegram not configured")
        return None
    media_url = str(media_url or "").strip()
    if not media_url:
        return await _send(caption, topic_id=topic_id, parse_mode=parse_mode, reply_markup=reply_markup, chat_id_override=chat_id_override)
    media_kind = "photo" if str(media_kind).lower() == "photo" else "video"
    endpoint = "sendPhoto" if media_kind == "photo" else "sendVideo"
    media_field = "photo" if media_kind == "photo" else "video"
    s = await _get_session()
    target_chat = chat_id_override or CHAT_ID
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/{endpoint}"
    payload = {
        "chat_id": target_chat,
        media_field: media_url,
        "caption": caption or "",
        "parse_mode": parse_mode,
    }
    if topic_id:
        payload["message_thread_id"] = int(topic_id)
    if reply_markup:
        payload["reply_markup"] = json.dumps(reply_markup)
    try:
        async with s.post(url, json=payload) as resp:
            data = await resp.json()
            if not data.get("ok"):
                desc = str(data.get("description", data))
                logger.error("Telegram %s failed: %s", endpoint, desc)
                log_activity("telegram_bot", "Telegram Send", f"{endpoint} failed | {desc[:180]}", 0, "telegram")
                return await _send(caption, topic_id=topic_id, parse_mode=parse_mode, reply_markup=reply_markup, chat_id_override=chat_id_override)
            log_activity("telegram_bot", "Telegram Send", f"{endpoint} ok | topic={topic_id or '-'} | chat={target_chat}", 0, "telegram")
            return data.get("result")
    except Exception as e:
        logger.error("Telegram %s error: %s", endpoint, e)
        log_activity("telegram_bot", "Telegram Send", f"{endpoint} error | {str(e)[:180]}", 0, "telegram")
        return await _send(caption, topic_id=topic_id, parse_mode=parse_mode, reply_markup=reply_markup, chat_id_override=chat_id_override)


async def _answer_callback(callback_query_id: str, text: str = ""):
    """Answer a callback query to dismiss the loading indicator."""
    s = await _get_session()
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/answerCallbackQuery"
    payload = {"callback_query_id": callback_query_id}
    if text:
        payload["text"] = text
        payload["show_alert"] = True
    try:
        async with s.post(url, json=payload) as resp:
            await resp.json()
        log_activity(
            "telegram_bot",
            "Telegram Callback",
            f"answer callback | cb={callback_query_id[:12]} | {(text or 'no_text')[:180]}",
            0,
            "telegram",
        )
    except Exception as e:
        logger.error("answerCallbackQuery error: %s", e)
        log_activity(
            "telegram_bot",
            "Telegram Callback",
            f"answer callback error | cb={callback_query_id[:12]} | {str(e)[:180]}",
            0,
            "telegram",
        )


async def _edit_message_text(chat_id, message_id, text, parse_mode="HTML"):
    """Edit an existing message to remove buttons after action."""
    s = await _get_session()
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/editMessageText"
    payload = {"chat_id": chat_id, "message_id": message_id,
               "text": text, "parse_mode": parse_mode}
    try:
        async with s.post(url, json=payload) as resp:
            await resp.json()
        log_activity(
            "telegram_bot",
            "Telegram Edit",
            f"edit ok | chat={chat_id} | msg={message_id} | {(text or '')[:180]}",
            0,
            "telegram",
        )
    except Exception as e:
        logger.error("editMessageText error: %s", e)
        log_activity(
            "telegram_bot",
            "Telegram Edit",
            f"edit error | chat={chat_id} | msg={message_id} | {str(e)[:180]}",
            0,
            "telegram",
        )


# ── Callback + Command Polling ──────────────────────────

async def start_polling(callback_handler, command_handler=None):
    """Start long-polling for callback queries and bot commands in background."""
    global _poll_task, _callback_handler, _command_handler, _poll_owner_has_lock
    if not polling_enabled():
        logger.info("Telegram polling disabled by runtime policy")
        return
    if not _poll_owner_has_lock:
        _poll_owner_has_lock = _acquire_poll_owner_lock()
    if not _poll_owner_has_lock:
        logger.info("Telegram polling skipped on this worker (owner lock held by another process)")
        return
    _callback_handler = callback_handler
    _command_handler = command_handler
    if _poll_task and not _poll_task.done():
        return  # Already running
    _poll_task = asyncio.create_task(_poll_loop())
    logger.info("Telegram callback polling started")


async def stop_polling():
    global _poll_task, _session, _poll_owner_has_lock
    task = _poll_task
    _poll_task = None
    if task and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    if _session and not _session.closed:
        await _session.close()
    _session = None
    if _poll_owner_has_lock:
        _release_poll_owner_lock()
        _poll_owner_has_lock = False


async def _poll_loop():
    """Long-poll getUpdates for callback_query AND message commands."""
    if not is_configured():
        return
    offset = 0
    s = await _get_session()
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/getUpdates"
    while True:
        try:
            payload = {
                "offset": offset, "timeout": 30,
                "allowed_updates": ["callback_query", "message"]
            }
            async with s.post(url, json=payload,
                              timeout=aiohttp.ClientTimeout(total=45)) as resp:
                data = await resp.json()
            if data.get("ok"):
                for update in data.get("result", []):
                    offset = update["update_id"] + 1
                    # Handle inline button callbacks
                    cb = update.get("callback_query")
                    if cb and _callback_handler:
                        try:
                            await _callback_handler(cb)
                        except Exception as e:
                            logger.error("Callback handler error: %s", e)
                    # Handle text commands (/baocao_ngay etc.)
                    msg = update.get("message", {})
                    text = msg.get("text", "")
                    if text.startswith("/") and _command_handler:
                        try:
                            await _command_handler(msg, text.strip())
                        except Exception as e:
                            logger.error("Command handler error: %s", e)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error("Poll error: %s", e)
            await asyncio.sleep(5)


# ── Topic-routed senders ──────────────────────

async def send_message(text: str, parse_mode="HTML"):
    return await _send(text, parse_mode=parse_mode)

async def send_to_login_topic(text: str, reply_markup: dict = None, topic_id_override: str = "", chat_id_override: str = ""):
    topic_id = topic_id_override or LOGIN_TOPIC_ID
    return await _send(
        text,
        topic_id=topic_id,
        reply_markup=reply_markup,
        chat_id_override=chat_id_override,
    )

async def send_to_qc_topic(text: str, reply_markup: dict = None, chat_id_override: str = ""):
    return await _send(
        text,
        topic_id=QC_TOPIC_ID,
        reply_markup=reply_markup,
        chat_id_override=chat_id_override,
    )

async def send_to_report_topic(text: str):
    return await _send(text, topic_id=REPORT_TOPIC_ID)

async def reply_to_message(chat_id: str, text: str, parse_mode="HTML"):
    """Reply to a specific chat (used for bot command responses)."""
    return await _send(text, chat_id_override=str(chat_id), parse_mode=parse_mode)


# ── Convenience helpers ──────────────────────

async def send_login_pending(username: str, display_name: str,
                              device: str, ip: str, login_id: str):
    """Send login approval request with inline keyboard buttons."""
    text = (
        f"<b>[LOGIN CHO DUYET]</b>\n"
        f"<b>{display_name}</b> ({username})\n"
        f"Thiet bi: {device}\n"
        f"IP: {ip}"
    )
    keyboard = {
        "inline_keyboard": [[
            {"text": "Duyet dang nhap", "callback_data": f"login_approve:{login_id}"},
            {"text": "Chan", "callback_data": f"login_reject:{login_id}"}
        ]]
    }
    return await send_to_login_topic(text, reply_markup=keyboard)


async def send_login_result(
    username: str,
    approved: bool,
    admin_name: str = "Admin",
    topic_id_override: str = "",
    chat_id_override: str = "",
):
    if approved:
        return await send_to_login_topic(
            f"<b>[LOGIN DA DUYET]</b>\nUser: <b>{username}</b>\nReviewer: {admin_name}",
            topic_id_override=topic_id_override,
            chat_id_override=chat_id_override,
        )
    return await send_to_login_topic(
        f"<b>[LOGIN BI TU CHOI]</b>\nUser: <b>{username}</b>\nReviewer: {admin_name}",
        topic_id_override=topic_id_override,
        chat_id_override=chat_id_override,
    )


async def send_task_created(task_id: str, user: str, mode: str, duration: int):
    return await send_message(
        f"<b>Task moi</b>\n{user}\n<code>{task_id}</code>\n{mode} | {duration}s"
    )


async def send_qc_notification(
    qc_id: str,
    task_id: str,
    video_url: str,
    user: str,
    note: str = "",
    gen_mode: str = "",
    credit_used: float = 0.0,
):
    """Send QC request with inline approve/reject actions."""
    mode_text = (gen_mode or "").strip() or "-"
    caption = (
        "<b>[QC CHO DUYET]</b>\n"
        f"<b>Nhan su:</b> {user}\n"
        f"<b>Task ID:</b> <code>{task_id}</code>\n"
        f"<b>QC ID:</b> <code>{qc_id}</code>\n"
        f"<b>Loai tac vu:</b> {mode_text}\n"
        f"<b>Credit:</b> {float(credit_used or 0):.0f}\n"
        f"<b>Ghi chu:</b> {(note or '-').strip()[:220]}"
    )
    keyboard = {
        "inline_keyboard": [[
            {"text": "Duyet QC", "callback_data": f"qc_approve:{qc_id}"},
            {"text": "Reject QC", "callback_data": f"qc_reject:{qc_id}"},
        ]]
    }
    media_kind = "photo" if mode_text.strip().lower() == "image_edit" else "video"
    return await _send_media(media_kind, video_url, caption, topic_id=QC_TOPIC_ID, reply_markup=keyboard)

    text = (
        "<b>[QC CHỜ DUYỆT]</b>\n"
        f"<b>Nhân sự:</b> {user}\n"
        f"<b>Task ID:</b> <code>{task_id}</code>\n"
        f"<b>QC ID:</b> <code>{qc_id}</code>\n"
        f"<b>Loại tác vụ:</b> {mode_text}\n"
        f"<b>Credit:</b> {float(credit_used or 0):.0f}\n"
        f"<b>Ghi chú:</b> {(note or '-').strip()[:220]}\n"
        f"<b>Media:</b> <a href='{video_url}'>Mở video</a>"
    )
    keyboard = {
        "inline_keyboard": [[
            {"text": "Duyet QC", "callback_data": f"qc_approve:{qc_id}"},
            {"text": "Reject QC", "callback_data": f"qc_reject:{qc_id}"},
        ]]
    }
    return await send_to_qc_topic(text, reply_markup=keyboard)


async def send_qc_result(task_id: str, user: str, approved: bool,
                          reviewer: str, reason: str = ""):
    status = "ĐÃ DUYỆT" if approved else "TỪ CHỐI"
    text = (
        f"<b>[QC {status}]</b>\n"
        f"<b>Nhân sự:</b> {user}\n"
        f"<b>Task ID:</b> <code>{task_id}</code>\n"
        f"<b>Người duyệt:</b> {reviewer}"
    )
    if reason:
        text += f"\n<b>Lý do:</b> {reason}"
    return await send_to_qc_topic(text)


async def send_shift_report(user: str, total_tasks: int, total_credits: float,
                             notes: str = ""):
    text = (
        f"<b>[BAO CAO CA]</b>\n"
        f"Nhan su: <b>{user}</b>\n"
        f"So task: {total_tasks}\n"
        f"Credits: {total_credits:.0f}"
    )
    if notes:
        text += f"\nGhi chu: {notes}"
    return await send_to_report_topic(text)


async def send_work_task_started(user: str, title: str, description: str = ""):
    shift_key = ""
    shift_label = ""
    shift_date = ""
    planned_start = ""
    planned_end = ""
    notes = ""
    try:
        payload = json.loads(description or "{}")
        if isinstance(payload, dict):
            shift_key = str(payload.get("shift_key") or "").strip()
            shift_label = str(payload.get("shift_label") or "").strip()
            shift_date = str(payload.get("shift_date") or "").strip()
            planned_start = str(payload.get("planned_start") or "").strip()
            planned_end = str(payload.get("planned_end") or "").strip()
            notes = str(payload.get("notes") or "").strip()
    except Exception:
        pass
    text = f"<b>[TASK BAT DAU]</b>\nNhan su: <b>{user}</b>\nTask: {title}"
    if shift_label or shift_key:
        text += f"\nCa: {shift_label or shift_key}"
    if shift_date:
        text += f"\nNgay: {shift_date}"
    if planned_start or planned_end:
        text += f"\nKhung gio: {planned_start or '-'} - {planned_end or '-'}"
    if notes:
        text += f"\nGhi chu: {notes}"
    return await send_to_report_topic(text)


async def send_work_task_closed(user: str, title: str, video_count: int = 0, credits: float = 0, notes: str = ""):
    text = (
        f"<b>[TASK KET THUC]</b>\n"
        f"Nhan su: <b>{user}</b>\n"
        f"Task: {title}\n"
        f"Video xong: {int(video_count or 0)} | Credits: {float(credits or 0):.0f}"
    )
    if notes:
        text += f"\nGhi chu: {notes}"
    return await send_to_report_topic(text)


async def send_image_started(task_id: str, user: str, model: str, prompt: str = ""):
    text = f"<b>[ANH BAT DAU]</b>\nNhan su: <b>{user}</b>\nTask ID: <code>{task_id}</code>\nModel: {model}"
    if prompt:
        text += f"\nPrompt: {prompt[:180]}"
    return await send_to_report_topic(text)


async def send_image_result(task_id: str, user: str, success: bool, result_url: str = "", reason: str = ""):
    status = "ANH HOAN THANH" if success else "ANH THAT BAI"
    text = f"<b>[{status}]</b>\nNhan su: <b>{user}</b>\nTask ID: <code>{task_id}</code>"
    if reason:
        text += f"\nLy do: {reason[:180]}"
    if success and str(result_url or "").strip():
        return await _send_media("photo", result_url, text, topic_id=REPORT_TOPIC_ID)
    return await send_to_report_topic(text)

    if result_url:
        text += f"\nMedia: <a href='{result_url}'>Open image</a>"
    if reason:
        text += f"\nLy do: {reason[:180]}"
    return await send_to_report_topic(text)


async def send_ai_activity(user: str, action: str, model: str, content: str = ""):
    # Disabled by policy: AI chat/analyze activity is not sent to Telegram.
    return None


async def send_batch_started(user: str, batch_id: str, total: int, task_name: str = ""):
    text = f"<b>[BATCH BAT DAU]</b>\nNhan su: <b>{user}</b>\nBatch ID: <code>{batch_id}</code>\nSo row: {int(total or 0)}"
    if task_name:
        text += f"\nTen batch: {task_name}"
    return await send_to_report_topic(text)


async def send_batch_row_result(batch_id: str, task_id: str, user: str, success: bool, result_url: str = "", reason: str = ""):
    status = "BATCH ROW HOAN THANH" if success else "BATCH ROW THAT BAI"
    text = (
        f"<b>[{status}]</b>\n"
        f"Nhan su: <b>{user}</b>\n"
        f"Batch ID: <code>{batch_id}</code>\n"
        f"Task ID: <code>{task_id}</code>"
    )
    if reason:
        text += f"\nLy do: {reason[:180]}"
    if success and str(result_url or "").strip():
        return await _send_media("video", result_url, text, topic_id=REPORT_TOPIC_ID)
    return await send_to_report_topic(text)

    if result_url:
        text += f"\nMedia: <a href='{result_url}'>Open video</a>"
    if reason:
        text += f"\nLy do: {reason[:180]}"
    return await send_to_report_topic(text)


async def send_staff_shift_summary(summary: dict):
    work_task = dict(summary.get("work_task") or {})
    shift = dict(summary.get("shift") or {})
    work_tasks = list(summary.get("work_tasks") or [])
    data = dict(summary.get("summary") or {})
    tasks = list(summary.get("tasks") or [])

    user_display = (
        shift.get("user_display")
        or work_task.get("user_display")
        or work_task.get("user_name")
        or "Staff"
    )
    if work_task:
        title = work_task.get("title") or "Ca lam viec"
    else:
        title = f"{int(data.get('work_task_count', 0) or 0)} phien task"
    started_at = float(
        shift.get("start_at", 0)
        or work_task.get("created_at", 0)
        or 0
    )
    closed_at = float(
        shift.get("end_at", 0)
        or work_task.get("closed_at", 0)
        or 0
    )
    started_text = datetime.fromtimestamp(started_at).strftime("%H:%M %d/%m/%Y") if started_at else "-"
    closed_text = datetime.fromtimestamp(closed_at).strftime("%H:%M %d/%m/%Y") if closed_at else datetime.now().strftime("%H:%M %d/%m/%Y")

    lines = [
        "<b>[BAO CAO CA]</b>",
        f"<b>Staff:</b> {user_display}",
        f"<b>Ca:</b> {title}",
        f"<b>Bat dau:</b> {started_text}",
        f"<b>Ket thuc:</b> {closed_text}",
        "----------------------------",
        f"<b>So phien task:</b> {int(data.get('work_task_count', 0) or len(work_tasks) or 0)}",
        f"<b>So task:</b> {int(data.get('total_tasks', 0) or 0)}",
        f"<b>Video xong:</b> {int(data.get('video_count', 0) or 0)}",
        f"<b>Anh xong:</b> {int(data.get('image_count', 0) or 0)}",
        f"<b>Loi/Huy:</b> {int(data.get('fail_count', 0) or 0)}",
        f"<b>Dang cho:</b> {int(data.get('pending_count', 0) or 0)}",
        f"<b>Credits:</b> {float(data.get('total_credits', 0) or 0):.0f}",
    ]

    notes = (shift.get("notes") or work_task.get("notes") or "").strip()
    if notes:
        lines.extend(["", f"<b>Ghi chu:</b> {notes}"])

    if work_tasks and not work_task:
        lines.extend(["", "<b>Cac phien task:</b>"])
        for idx, wt in enumerate(work_tasks[:8], 1):
            title_text = (wt.get("title") or "").strip() or f"Task {idx}"
            credits = float(wt.get("credits_used", 0) or 0)
            videos = int(wt.get("video_count", 0) or 0)
            lines.append(f"{idx}. {title_text} | {videos} video | {credits:.0f} cr")
        remain_wt = len(work_tasks) - 8
        if remain_wt > 0:
            lines.append(f"... va {remain_wt} phien task khac")

    if tasks:
        lines.extend(["", "<b>Chi tiet:</b>"])
        for idx, task in enumerate(tasks[:12], 1):
            prompt = (task.get("prompt") or "").strip()
            if len(prompt) > 42:
                prompt = prompt[:42] + "..."
            status = str(task.get("status") or "?")
            credit = float(task.get("credit_used", 0) or 0)
            lines.append(f"{idx}. [{status}] {prompt or '-'} | {credit:.0f} cr")
        remain = len(tasks) - 12
        if remain > 0:
            lines.append(f"... va {remain} task khac")

    return await send_to_report_topic("\n".join(lines))


async def send_video_complete(task_id: str, user: str, video_url: str):
    caption = (
        f"<b>[VIDEO HOAN THANH]</b>\n"
        f"Nhan su: <b>{user}</b>\n"
        f"Task ID: <code>{task_id}</code>"
    )
    return await _send_media("video", video_url, caption, topic_id=REPORT_TOPIC_ID)


# ── Daily / Weekly / Monthly Digest Reports ──────────────────────────────────

def _format_digest(period_label: str, date_str: str, tasks: list, credits_info: dict) -> str:
    """
    Format a structured tagged digest report for a given period.
    tasks = list of dicts: {user_display, title, effect, difficulty, qty,
                            video_count, credits_used, started_at, closed_at}
    credits_info = {total_remaining, total_consumed, keys: [{masked, credits, consumed}]}
    """
    SEP = "─" * 28
    now_str = datetime.now().strftime("%d/%m/%Y %H:%M")

    # Build per-staff breakdown
    staff_map: dict = {}
    for t in tasks:
        name = t.get("user_display") or t.get("user_name") or "?"
        if name not in staff_map:
            staff_map[name] = {
                "tasks": 0, "videos": 0, "credits": 0.0,
                "effects": set(), "difficulties": set()
            }
        staff_map[name]["tasks"] += 1
        staff_map[name]["videos"] += t.get("video_count", 0)
        staff_map[name]["credits"] += t.get("credits_used", 0.0)
        if t.get("effect"):
            staff_map[name]["effects"].add(t["effect"])
        if t.get("difficulty"):
            staff_map[name]["difficulties"].add(t["difficulty"])

    total_tasks = len(tasks)
    total_videos = sum(t.get("video_count", 0) for t in tasks)
    total_credits = sum(t.get("credits_used", 0.0) for t in tasks)

    lines = [
        f"<b>[BAO CAO] {period_label}</b>",
        f"#ngay_{date_str.replace('/', '_')}",
        SEP,
    ]

    # Per-staff section
    for name, s in staff_map.items():
        eff_str = ", ".join(s["effects"]) if s["effects"] else "—"
        diff_str = ", ".join(s["difficulties"]) if s["difficulties"] else "—"
        lines += [
            f"<b>#nhansu</b>  | {name}",
            f"<b>#effect</b>  | {eff_str}",
            f"<b>#do_kho</b>  | {diff_str}",
            f"<b>#so_task</b> | {s['tasks']} task",
            f"<b>#video</b>   | {s['videos']} video",
            f"<b>#credits</b> | Tieu: {s['credits']:.0f} credits",
            "",
        ]

    lines += [SEP]

    # Credit summary by key
    if credits_info.get("keys"):
        lines.append("<b>#credits_keys</b>")
        for k in credits_info["keys"]:
            warn = " ⚠" if k.get("credits", 0) < 50 else ""
            lines.append(
                f"  {k['masked']} — Con: {k.get('credits', 0):.0f} | "
                f"Da dung: {k.get('consumed', 0):.0f}{warn}"
            )
        lines.append("")

    lines += [
        SEP,
        f"<b>TONG {period_label.upper()}</b>",
        f"  Tasks   : {total_tasks}",
        f"  Videos  : {total_videos}",
        f"  Credits : {total_credits:.0f} tieu thu",
        f"  Con lai : {credits_info.get('total_remaining', 0):.0f} credits",
        SEP,
        f"<i>Cap nhat: {now_str}</i>",
    ]
    return "\n".join(lines)


async def send_daily_report(tasks: list, credits_info: dict, date_str: str = ""):
    """Send formatted daily digest to report topic."""
    if not date_str:
        date_str = datetime.now().strftime("%d/%m/%Y")
    text = _format_digest("NGAY", date_str, tasks, credits_info)
    return await send_to_report_topic(text)


async def send_weekly_report(tasks: list, credits_info: dict, week_label: str = ""):
    """Send formatted weekly digest to report topic."""
    if not week_label:
        from datetime import timedelta
        today = datetime.now()
        monday = today - timedelta(days=today.weekday())
        week_label = monday.strftime("W%U_%m/%Y")
    text = _format_digest("TUAN", week_label, tasks, credits_info)
    return await send_to_report_topic(text)


async def send_monthly_report(tasks: list, credits_info: dict, month_label: str = ""):
    """Send formatted monthly digest to report topic."""
    if not month_label:
        month_label = datetime.now().strftime("%m/%Y")
    text = _format_digest("THANG", month_label, tasks, credits_info)
    return await send_to_report_topic(text)
