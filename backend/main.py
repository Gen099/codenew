"""Video Creator Tool â€” FastAPI Backend (standalone)."""
import os, sys, uuid, time, asyncio, logging, json
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import jwt

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if os.path.normcase(BACKEND_DIR) not in {
    os.path.normcase(os.path.abspath(path))
    for path in sys.path
    if path
}:
    sys.path.insert(0, BACKEND_DIR)

try:
    import runtime_paths
except ImportError:
    from . import runtime_paths

load_dotenv(runtime_paths.ENV_FILE)
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

try:
    if os.path.exists(runtime_paths.API_KEYS_FILE):
        with open(runtime_paths.API_KEYS_FILE, "r", encoding="utf-8") as _f:
            _keys_data = json.load(_f)
        if (_keys_data.get("provider1") or _keys_data.get("keys") or []):
            for _env_name in ("API_KEY", "KIE_API_KEY", "API_KEYS", "KIE_API_KEYS"):
                os.environ.pop(_env_name, None)
except Exception:
    pass

import database as db
import config as app_config
import kie_client as kie
import telegram_bot as tg
import provider_registry as providers
from activity_logger import log_activity
import routes.auth_routes as auth_routes_module
import routes.reports_routes as reports_routes_module
from routes.notifications_routes import create_notifications_router
from routes.auth_routes import (
    create_auth_router,
    get_effective_pending_expiry,
    get_role_permissions,
    normalize_role_id,
    user_has_permission,
)
from routes.credits_routes import create_credits_router
from routes.chat_routes import create_chat_router
from routes.history_routes import create_history_router
from routes.image_light_routes import create_image_light_router
from routes.image_routes import create_image_router
from routes.input_assets_routes import create_input_assets_router
from routes.qc_routes import create_qc_router
from routes.provider_routes import create_provider_router
from routes.reports_routes import create_reports_router
from routes.system_routes import create_system_router
from routes.video_utility_routes import create_video_utility_router
from routes.video_routes import create_video_router
from routes.work_tasks_routes import create_work_tasks_router

SECRET_KEY = app_config.SECRET_KEY


def _validate_runtime_security() -> None:
    mode = (os.getenv("VIDEOTOOL_MODE") or "").strip().lower()
    # Enforce strong secret for server/production-like runtime.
    if mode in ("server", "production", "prod"):
        weak = (not SECRET_KEY) or len(SECRET_KEY) < 32 or SECRET_KEY in {
            "videotool-secret",
            "CHANGE_THIS_TO_STRONG_RANDOM_SECRET",
        }
        if weak:
            raise RuntimeError("Unsafe SECRET_KEY for production mode. Set a strong 32+ chars key.")


def _parse_cors_origins() -> list[str]:
    raw = (os.getenv("CORS_ORIGINS") or "").strip()
    if not raw:
        public_url = (os.getenv("PUBLIC_URL") or "").strip().rstrip("/")
        base = ["http://localhost:8080", "http://127.0.0.1:8080"]
        if public_url:
            return [public_url] + base
        return base
    origins = [x.strip() for x in raw.split(",") if x.strip()]
    return origins or ["http://localhost:8080", "http://127.0.0.1:8080"]

logger = logging.getLogger(__name__)
# Source marker: keep main.py touched so uvicorn reloads from the current workspace copy.

_ROLE_ALIASES = {
    "qc": "qc_manager",
    "qcmanager": "qc_manager",
    "quality_control": "qc_manager",
    "quality_controller": "qc_manager",
    "administrator": "admin",
}
_ROLE_PERMISSIONS = {
    "staff": {"create_video", "create_image", "view_own_history", "view_library"},
    "qc_manager": {
        "create_video",
        "create_image",
        "view_own_history",
        "view_library",
        "qc_approve",
        "qc_reject",
        "view_all_history",
        "view_dashboard",
    },
    "admin": {
        "create_video",
        "create_image",
        "view_own_history",
        "view_library",
        "qc_approve",
        "qc_reject",
        "view_all_history",
        "view_dashboard",
        "manage_users",
        "manage_keys",
        "manage_settings",
        "view_billing",
    },
}
_LOGIN_APPROVAL_BYPASS_PERMS = {
    "qc_approve",
    "qc_reject",
    "manage_users",
    "manage_keys",
    "manage_settings",
    "view_dashboard",
    "view_all_history",
}


def _normalize_role(role_id: str) -> str:
    role = str(role_id or "staff").strip().lower().replace("-", "_").replace(" ", "_")
    return _ROLE_ALIASES.get(role, role or "staff")


def _role_permissions(role_id: str) -> list[str]:
    return sorted(_ROLE_PERMISSIONS.get(_normalize_role(role_id), set()))


def _user_has_permission_local(user_data: dict | None, permission: str) -> bool:
    user = dict(user_data or {})
    perms = user.get("permissions") or _role_permissions(user.get("role"))
    return permission in set(str(p) for p in perms)


def _build_auth_user_payload_local(user_data: dict) -> dict:
    role = _normalize_role(user_data.get("role"))
    return {
        "id": user_data["id"],
        "username": user_data["username"],
        "display_name": user_data.get("display_name", user_data["username"]),
        "role": role,
        "permissions": _role_permissions(role),
        "login_2fa_enabled": bool(user_data.get("login_2fa_enabled", 0)),
    }

# â”€â”€â”€ Model Definitions â”€â”€â”€
def _get_tier(quality: str = "kling25") -> dict:
    return app_config.get_tier(quality)


def _get_credit(duration: int, quality: str = "kling25") -> int:
    return app_config.get_credit(duration, quality)


def _load_cameras() -> list:
    return app_config.load_cameras()


def _find_camera(cam_id: str) -> str:
    return app_config.find_camera(cam_id)


# â”€â”€â”€ Auth helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

_JWT_ALGO = "HS256"
_JWT_TTL_SECONDS = int(os.getenv("JWT_EXPIRE_SECONDS", "28800"))


def _jwt_decode(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[_JWT_ALGO])
        return payload if isinstance(payload, dict) else None
    except jwt.InvalidTokenError:
        return None

def _make_token(user: dict) -> str:
    role = _normalize_role(user.get("role", "staff"))
    now = int(time.time())
    payload = {
        "sub": user["id"],
        "username": user["username"],
        "role": role,
        "display_name": user.get("display_name", user["username"]),
        "iat": now,
        "exp": now + _JWT_TTL_SECONDS,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=_JWT_ALGO)


def _get_user(request: Request) -> Optional[dict]:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
        claims = _jwt_decode(token)
        if not claims:
            return None
        user_id = claims.get("sub")
        if not user_id:
            return None
        try:
            conn = db.get_conn()
            row = conn.execute(
                "SELECT id, username, display_name, role, login_2fa_enabled, active FROM users WHERE id=?",
                (user_id,),
            ).fetchone()
            conn.close()
            if not row or not row["active"]:
                return None
            role = _normalize_role(row.get("role"))
            return {
                "user_id": row["id"],
                "username": row["username"],
                "display_name": row.get("display_name", row["username"]),
                "role": role,
                "permissions": _role_permissions(role),
                "login_2fa_enabled": bool(row.get("login_2fa_enabled", 0)),
                "exp": int(claims.get("exp", 0)),
            }
        except Exception:
            return None
    return None


def revoke_user_tokens(username: str):
    """JWT stateless mode: no server-side token store."""
    return None


def _require_user(request: Request) -> dict:
    user = _get_user(request)
    if not user:
        raise HTTPException(401, "Unauthorized")
    return user


def _require_admin(request: Request) -> dict:
    user = _require_user(request)
    if _normalize_role(user["role"]) != "admin":
        raise HTTPException(403, "Admin only")
    return user


def _require_qc_or_admin(request: Request) -> dict:
    """Allow any role with QC permissions."""
    user = _require_user(request)
    if not (
        _user_has_permission_local(user, "qc_approve")
        or _user_has_permission_local(user, "qc_reject")
        or _normalize_role(user["role"]) == "admin"
    ):
        raise HTTPException(403, "QC Manager or Admin only")
    return user




# â”€â”€â”€ App â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    _validate_runtime_security()
    logger.info(
        "Route source lock: auth=%s | reports=%s",
        getattr(auth_routes_module, "__file__", "?"),
        getattr(reports_routes_module, "__file__", "?"),
    )
    db.init_db()
    # Fetch credits at startup - await so we see errors and credits are ready
    try:
        logger.info("Fetching API key credits from KIE...")
        await kie.refresh_key_credits(force=True)
        total = await kie.get_credits_total()
        logger.info("Credits loaded: %.2f total across %d key(s)", total, len(kie._api_keys))
    except Exception as e:
        logger.error("Credit fetch at startup failed: %s", e)
    # Start Telegram callback + command polling only when runtime explicitly allows it.
    logger.info(
        "Telegram runtime: configured=%s | polling=%s | auto_reports=%s | chat_id=%s | admin_id=%s | login_topic=%s | qc_topic=%s | report_topic=%s",
        tg.is_configured(),
        tg.polling_enabled(),
        tg.auto_reports_enabled(),
        os.getenv("TELEGRAM_CHAT_ID", "") or "-",
        os.getenv("TELEGRAM_ADMIN_ID", "") or "-",
        os.getenv("TELEGRAM_LOGIN_TOPIC_ID", "") or "-",
        os.getenv("TELEGRAM_QC_TOPIC_ID", "") or "-",
        os.getenv("TELEGRAM_REPORT_TOPIC_ID", "") or "-",
    )
    if tg.is_configured() and tg.polling_enabled():
        await tg.start_polling(_handle_tg_callback, _handle_tg_command)
        if tg.auto_reports_enabled():
            asyncio.ensure_future(_daily_report_scheduler())
        else:
            logger.info("Telegram auto reports disabled for this runtime")
    elif tg.is_configured():
        logger.info("Telegram configured but polling is disabled for this runtime")
    else:
        logger.warning("Telegram is not configured for this runtime")
    current_port = os.getenv("VIDEOTOOL_BACKEND_PORT") or os.getenv("BACKEND_PORT") or "8012"
    current_mode = (os.getenv("VIDEOTOOL_MODE") or "standalone").strip().lower()
    db_mode = "postgres" if (os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL")) else "sqlite"
    logger.info("Runtime mode: mode=%s | port=%s | db=%s", current_mode, current_port, db_mode)
    logger.info("Video Creator Tool ready at http://0.0.0.0:%s", current_port)
    yield
    await tg.stop_polling()
    logger.info("Shutting down")


async def _handle_tg_callback(cb: dict):
    """Handle Telegram InlineKeyboard callback queries."""
    cb_id = cb["id"]
    data = cb.get("data", "")
    msg = cb.get("message", {})
    chat_id = msg.get("chat", {}).get("id")
    msg_id = msg.get("message_id")
    topic_id = msg.get("message_thread_id")

    # Extract approver name from Telegram sender
    from_info = cb.get("from", {})
    tg_first = from_info.get("first_name", "")
    tg_last = from_info.get("last_name", "")
    tg_username = from_info.get("username", "")
    approver_name = f"{tg_first} {tg_last}".strip() or tg_username or "Admin"
    log_activity(
        approver_name,
        "Telegram Callback",
        f"received | data={data[:120]} | chat={chat_id or '-'} | msg={msg_id or '-'}",
        0,
        "telegram",
    )

    if data.startswith("login_approve:"):
        login_id = data.split(":", 1)[1]
        conn = db.get_conn()
        row = conn.execute("SELECT * FROM pending_logins WHERE id=?", (login_id,)).fetchone()
        if not row:
            await tg._answer_callback(cb_id, "Yeu cau phe duyet khong ton tai")
            conn.close(); return
        r = dict(row)
        if r["status"] != "pending":
            status_text = {
                "approved": "Yeu cau nay da duoc duyet",
                "rejected": "Yeu cau nay da bi tu choi",
                "replaced": "Yeu cau nay da bi thay the boi lan dang nhap moi",
                "expired": "Yeu cau nay da het han",
            }.get(str(r["status"]), f"Yeu cau da duoc xu ly: {r['status']}")
            await tg._answer_callback(cb_id, status_text)
            conn.close(); return
        _, expires_at = get_effective_pending_expiry(r)
        if time.time() > expires_at:
            await tg._answer_callback(cb_id, "Yeu cau dang nhap da het han (5 phut)")
            conn.close(); return
        conn.execute("UPDATE pending_logins SET status='approved' WHERE id=?", (login_id,))
        conn.commit(); conn.close()
        db.add_notification(r["user_id"], "login_approved",
                            "Dang nhap duoc duyet",
                            f"{approver_name} da phe duyet dang nhap")
        log_activity(
            approver_name,
            "Login Approve",
            f"{r['username']} | login_id={login_id}",
            0,
            "telegram_login",
        )
        await tg._answer_callback(cb_id, f"Da duyet {r['username']}")
        if chat_id and msg_id:
            await tg._edit_message_text(chat_id, msg_id,
                f"Da duyet login: <b>{r['username']}</b>\n"
                f"Nguoi duyet: <b>{approver_name}</b>", "HTML")

    elif data.startswith("login_reject:"):
        login_id = data.split(":", 1)[1]
        conn = db.get_conn()
        row = conn.execute("SELECT * FROM pending_logins WHERE id=?", (login_id,)).fetchone()
        if not row:
            await tg._answer_callback(cb_id, "Yeu cau phe duyet khong ton tai")
            conn.close(); return
        r = dict(row)
        if r["status"] != "pending":
            status_text = {
                "approved": "Yeu cau nay da duoc duyet",
                "rejected": "Yeu cau nay da bi tu choi",
                "replaced": "Yeu cau nay da bi thay the boi lan dang nhap moi",
                "expired": "Yeu cau nay da het han",
            }.get(str(r["status"]), f"Yeu cau da duoc xu ly: {r['status']}")
            await tg._answer_callback(cb_id, status_text)
            conn.close(); return
        _, expires_at = get_effective_pending_expiry(r)
        if time.time() > expires_at:
            await tg._answer_callback(cb_id, "Yeu cau dang nhap da het han (5 phut)")
            conn.close(); return
        conn.execute("UPDATE pending_logins SET status='rejected' WHERE id=?", (login_id,))
        conn.commit(); conn.close()
        db.add_notification(r["user_id"], "login_rejected",
                            "Dang nhap bi chan",
                            f"{approver_name} da tu choi dang nhap")
        log_activity(
            approver_name,
            "Login Reject",
            f"{r['username']} | login_id={login_id}",
            0,
            "telegram_login",
        )
        await tg._answer_callback(cb_id, f"Da chan {r['username']}")
        asyncio.ensure_future(
            tg.send_login_result(
                r["username"],
                False,
                approver_name,
                topic_id_override=str(topic_id or ""),
                chat_id_override=str(chat_id or ""),
            )
        )
        if chat_id and msg_id:
            await tg._edit_message_text(chat_id, msg_id,
                f"Da chan login: <b>{r['username']}</b>\n"
                f"Nguoi chan: <b>{approver_name}</b>", "HTML")
    elif data.startswith("qc_approve:"):
        qc_id = data.split(":", 1)[1]
        conn = db.get_conn()
        row = conn.execute("SELECT * FROM qc_queue WHERE id=?", (qc_id,)).fetchone()
        if not row:
            await tg._answer_callback(cb_id, "QC khong ton tai")
            conn.close(); return
        q = dict(row)
        if str(q.get("status") or "").lower() != "pending":
            await tg._answer_callback(cb_id, f"QC da xu ly: {q.get('status')}")
            conn.close(); return
        conn.execute(
            "UPDATE qc_queue SET status='approved', reviewer=?, reviewed_at=? WHERE id=?",
            (approver_name, time.time(), qc_id),
        )
        conn.commit()
        conn.close()
        conn2 = db.get_conn()
        user_row = conn2.execute("SELECT id FROM users WHERE username=?", (q.get("user_name"),)).fetchone()
        conn2.close()
        if user_row:
            db.add_notification(
                user_row["id"],
                "qc_approved",
                "Video da duoc duyet",
                f"Video {q.get('task_id')} duoc {approver_name} phe duyet (Telegram)",
                {"qc_id": qc_id, "task_id": q.get("task_id")},
            )
        log_activity(
            approver_name,
            "QC Approve",
            f"qc_id={qc_id} | task_id={q.get('task_id')} | via=telegram_callback",
            0,
            "qc_approve",
        )
        await tg._answer_callback(cb_id, f"Da duyet QC {qc_id}")
        asyncio.ensure_future(
            tg.send_qc_result(q.get("task_id") or "", q.get("user_display") or q.get("user_name") or "", True, approver_name)
        )
        if chat_id and msg_id:
            await tg._edit_message_text(
                chat_id,
                msg_id,
                f"<b>[QC DA DUYET]</b>\nTask ID: <code>{q.get('task_id') or '-'}</code>\nQC ID: <code>{qc_id}</code>\nReviewer: <b>{approver_name}</b>",
                "HTML",
            )
    elif data.startswith("qc_reject:"):
        qc_id = data.split(":", 1)[1]
        conn = db.get_conn()
        row = conn.execute("SELECT * FROM qc_queue WHERE id=?", (qc_id,)).fetchone()
        if not row:
            await tg._answer_callback(cb_id, "QC khong ton tai")
            conn.close(); return
        q = dict(row)
        if str(q.get("status") or "").lower() != "pending":
            await tg._answer_callback(cb_id, f"QC da xu ly: {q.get('status')}")
            conn.close(); return
        reject_reason = "Reject via Telegram"
        conn.execute(
            "UPDATE qc_queue SET status='rejected', reviewer=?, reject_reason=?, reviewed_at=? WHERE id=?",
            (approver_name, reject_reason, time.time(), qc_id),
        )
        conn.commit()
        conn.close()
        conn2 = db.get_conn()
        user_row = conn2.execute("SELECT id FROM users WHERE username=?", (q.get("user_name"),)).fetchone()
        conn2.close()
        if user_row:
            db.add_notification(
                user_row["id"],
                "qc_rejected",
                "Video bi tu choi",
                f"Video {q.get('task_id')} bi reject boi {approver_name} (Telegram)",
                {"qc_id": qc_id, "task_id": q.get("task_id"), "reason": reject_reason},
            )
        log_activity(
            approver_name,
            "QC Reject",
            f"qc_id={qc_id} | task_id={q.get('task_id')} | via=telegram_callback | reason={reject_reason}",
            0,
            "qc_reject",
        )
        await tg._answer_callback(cb_id, f"Da reject QC {qc_id}")
        asyncio.ensure_future(
            tg.send_qc_result(
                q.get("task_id") or "",
                q.get("user_display") or q.get("user_name") or "",
                False,
                approver_name,
                reject_reason,
            )
        )
        if chat_id and msg_id:
            await tg._edit_message_text(
                chat_id,
                msg_id,
                f"<b>[QC BI TU CHOI]</b>\nTask ID: <code>{q.get('task_id') or '-'}</code>\nQC ID: <code>{qc_id}</code>\nReviewer: <b>{approver_name}</b>",
                "HTML",
            )
    else:
        await tg._answer_callback(cb_id, "Unknown action")


app = FastAPI(title="Video Creator Tool", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def block_legacy_disabled_routes(request: Request, call_next):
    path = str(request.url.path or "")
    if path.startswith("/api/_legacy_disabled/"):
        return JSONResponse(status_code=404, content={"detail": "Not Found"})
    return await call_next(request)

# Global exception handler — prevent backend crash on unhandled errors
from fastapi.responses import JSONResponse as _JSONResponse

@app.exception_handler(Exception)
async def _global_route_exception_handler(request: Request, exc: Exception):
    err_id = str(uuid.uuid4())[:10]
    method = str(getattr(request, "method", "GET") or "GET")
    path = str(getattr(getattr(request, "url", None), "path", "") or "-")
    logger.error("Unhandled route error id=%s [%s %s]: %s", err_id, method, path, exc, exc_info=True)
    try:
        log_activity(
            "system",
            "API HTTP",
            f"rid={err_id} | {method} {path} | error={type(exc).__name__} | {str(exc)[:180]}",
            0,
            "api_http",
        )
    except Exception:
        pass
    return _JSONResponse(status_code=500, content={"detail": f"Internal server error ({err_id})"})

_AUDIT_SKIP_PREFIXES = (
    "/api/history",
    "/api/qc/queue",
    "/api/auth/poll/",
    "/api/credits/balance",
    "/api/credits/refresh",
    "/api/work-tasks",
    "/api/providers/runtime-keys/status",
    "/api/system/heartbeat",
    "/api/system/status",
    "/api/notifications",
)


@app.middleware("http")
async def audit_http_requests(request: Request, call_next):
    path = str(request.url.path or "")
    method = str(request.method or "GET").upper()
    should_log = method in {"POST", "PUT", "PATCH", "DELETE"} or path.startswith("/api/auth/tg-")
    if path.startswith(_AUDIT_SKIP_PREFIXES):
        should_log = False
    start = time.time()
    user = _get_user(request)
    actor = (user or {}).get("display_name") or (user or {}).get("username") or "anonymous"
    client_ip = getattr(getattr(request, "client", None), "host", "") or "-"
    request_id = str(uuid.uuid4())[:10]
    try:
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        if should_log:
            elapsed_ms = int((time.time() - start) * 1000)
            log_activity(
                actor,
                "API HTTP",
                f"rid={request_id} | {method} {path} | status={response.status_code} | {elapsed_ms}ms | ip={client_ip}",
                0,
                "api_http",
            )
        return response
    except Exception as exc:
        if should_log:
            elapsed_ms = int((time.time() - start) * 1000)
            log_activity(
                actor,
                "API HTTP",
                f"rid={request_id} | {method} {path} | error={type(exc).__name__} | {elapsed_ms}ms | ip={client_ip} | {str(exc)[:180]}",
                0,
                "api_http",
            )
        raise

_provider_concurrency = max(1, int(os.getenv("APP_PROVIDER_CONCURRENCY", "5")))
_sem = asyncio.Semaphore(_provider_concurrency)

# â”€â”€â”€ Online staff tracking â”€â”€â”€
_active_sessions: dict = {}  # username -> {display_name, role, last_seen, active_tasks}
_admin_announcements: list = []  # [{message, timestamp, maintenance_at}]


app.include_router(
    create_system_router(_require_user, _require_admin, db, _active_sessions, _admin_announcements)
)
app.include_router(create_auth_router(_require_user, _require_admin, _make_token, db, tg, asyncio))
app.include_router(create_provider_router(_require_user, providers))
app.include_router(create_credits_router(_require_user, _require_admin, kie))
app.include_router(create_history_router(_require_user, db))
app.include_router(create_chat_router(_require_user, db, kie, logger, tg, asyncio))
app.include_router(create_image_light_router(_require_user, db, kie, tg, asyncio))
app.include_router(create_image_router(_require_user, db, kie, logger, tg, asyncio))
app.include_router(create_input_assets_router(_require_user, db, kie))
app.include_router(create_notifications_router(_require_user, db))
app.include_router(create_qc_router(_require_user, _require_admin, _require_qc_or_admin, db, tg, asyncio))
app.include_router(create_video_router(_require_user, db, kie, tg, providers, logger, _sem, _find_camera))
app.include_router(create_video_utility_router(_require_user, db, kie, logger, _load_cameras, _get_credit, providers))
app.include_router(create_work_tasks_router(_require_user, db, tg, asyncio))

def _aggregate_report(start_ts: float, end_ts: float) -> list:
    """Aggregate closed work_tasks in the given UTC timestamp range."""
    conn = db.get_conn()
    rows = conn.execute(
        """SELECT wt.*, u.display_name as user_display
           FROM work_tasks wt
           LEFT JOIN users u ON u.username = wt.user_name
           WHERE wt.status='closed'
             AND wt.closed_at >= ? AND wt.closed_at <= ?
           ORDER BY wt.closed_at ASC""",
        (start_ts, end_ts)
    ).fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        # Parse description metadata (Effect: xxx | Do kho: xxx ...)
        desc = d.get("description", "")
        effect = ""
        difficulty = ""
        for part in desc.split(" | "):
            if part.startswith("Effect:"):
                effect = part[7:].strip()
            elif part.startswith("Do kho:") or part.startswith("\u0110\u1ed9 kh\u00f3:"):
                difficulty = part.split(":", 1)[1].strip()
        d["effect"] = effect
        d["difficulty"] = difficulty
        result.append(d)
    return result


async def _get_credits_info() -> dict:
    """Get current per-key credit info for report."""
    await kie.refresh_key_credits()
    keys = await kie.get_all_keys_info()
    total = sum(k["credits"] for k in keys)
    return {"total_remaining": total, "total_consumed": 0, "keys": keys}


async def _build_and_send_report(period: str):
    """Build and send a digest report for day / week / month."""
    import datetime as _dt
    now = _dt.datetime.now()
    if period == "day":
        start = _dt.datetime.combine(now.date(), _dt.time.min).timestamp()
        end   = _dt.datetime.combine(now.date(), _dt.time.max).timestamp()
        date_str = now.strftime("%d/%m/%Y")
    elif period == "week":
        monday = now - _dt.timedelta(days=now.weekday())
        start = _dt.datetime.combine(monday.date(), _dt.time.min).timestamp()
        end   = now.timestamp()
        date_str = f"T{now.strftime('%U')} - {now.strftime('%m/%Y')}"
    else:  # month
        first = now.replace(day=1)
        start = _dt.datetime.combine(first.date(), _dt.time.min).timestamp()
        end   = now.timestamp()
        date_str = now.strftime("%m/%Y")

    tasks = _aggregate_report(start, end)
    credits_info = await _get_credits_info()

    if period == "day":
        await tg.send_daily_report(tasks, credits_info, date_str)
    elif period == "week":
        await tg.send_weekly_report(tasks, credits_info, date_str)
    else:
        await tg.send_monthly_report(tasks, credits_info, date_str)


async def _daily_report_scheduler():
    """Background task: auto-sends daily report at 23:59 VN time every day."""
    import datetime as _dt
    while True:
        try:
            now = _dt.datetime.now()
            # Calculate seconds until 23:59:00 today
            target = now.replace(hour=23, minute=59, second=0, microsecond=0)
            if now >= target:
                # Already past 23:59 today - wait until tomorrow
                target += _dt.timedelta(days=1)
            wait_secs = (target - now).total_seconds()
            logger.info("Daily report scheduler: next send in %.0f seconds", wait_secs)
            await asyncio.sleep(wait_secs)
            await _build_and_send_report("day")
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error("Daily scheduler error: %s", e)
            await asyncio.sleep(60)  # retry after 1 min on error


async def _handle_tg_command(msg: dict, command: str):
    """Handle Telegram bot commands /baocao_ngay, /baocao_tuan, /baocao_thang."""
    chat_id = str(msg.get("chat", {}).get("id", ""))
    if not chat_id:
        return
    cmd = command.split("@")[0].lower()  # strip @botname suffix
    if cmd == "/baocao_ngay":
        await tg.reply_to_message(chat_id, "Dang tong hop bao cao ngay...")
        await _build_and_send_report("day")
    elif cmd == "/baocao_tuan":
        await tg.reply_to_message(chat_id, "Dang tong hop bao cao tuan...")
        await _build_and_send_report("week")
    elif cmd == "/baocao_thang":
        await tg.reply_to_message(chat_id, "Dang tong hop bao cao thang...")
        await _build_and_send_report("month")
    elif cmd == "/credits":
        keys = await kie.get_all_keys_info()
        lines = ["<b>Credits hien tai:</b>"]
        for k in keys:
            warn = " [CANH BAO]" if k["credits"] < 50 else ""
            lines.append(f"  {k['masked']} - {k['credits']:.0f} credits{warn}")
        lines.append(f"\nTong: {sum(k['credits'] for k in keys):.0f} credits")
        await tg.reply_to_message(chat_id, "\n".join(lines))


app.include_router(create_reports_router(_require_user, _require_admin, db, tg, asyncio, _aggregate_report, kie))


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("VIDEOTOOL_BACKEND_PORT") or os.getenv("BACKEND_PORT") or "8012")
    reload_enabled = (os.getenv("VIDEOTOOL_BACKEND_RELOAD") or os.getenv("BACKEND_RELOAD") or "1").strip().lower()
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=reload_enabled in ("1", "true", "yes", "on"))

