"""Authentication and login-approval routes."""
import json
import os
import time
import uuid

import bcrypt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from activity_logger import log_activity

try:
    from .. import runtime_paths
except ImportError:
    import runtime_paths

try:
    from .. import settings_store
except ImportError:
    import settings_store


_LOGIN_APPROVAL_BYPASS_PERMS = {
    "qc_approve",
    "qc_reject",
    "manage_users",
    "manage_keys",
    "manage_settings",
    "view_dashboard",
    "view_all_history",
}

AUTH_ROUTE_MARKER = "auth_routes_20260321_1454"
_ROLE_MAP_CACHE = None
_ROLE_MAP_MTIME = 0.0

_FAILED_WINDOW_SEC = max(30, int(os.getenv("AUTH_FAILED_WINDOW_SEC", "300")))
_FAILED_MAX_ATTEMPTS = max(3, int(os.getenv("AUTH_FAILED_MAX_ATTEMPTS", "8")))
_LOCK_SECONDS = max(30, int(os.getenv("AUTH_LOCK_SECONDS", "300")))
_FAILED_ATTEMPTS: dict[str, list[float]] = {}
_LOCKED_UNTIL: dict[str, float] = {}


def normalize_role_id(role_id: str) -> str:
    role = str(role_id or "staff").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "qc": "qc_manager",
        "qcmanager": "qc_manager",
        "quality_control": "qc_manager",
        "quality_controller": "qc_manager",
        "administrator": "admin",
    }
    return aliases.get(role, role or "staff")


def _load_role_permission_map() -> dict:
    global _ROLE_MAP_CACHE, _ROLE_MAP_MTIME
    default = {
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
    try:
        path = runtime_paths.ROLES_CONFIG_FILE
        if os.path.exists(path):
            mtime = float(os.path.getmtime(path))
            if _ROLE_MAP_CACHE is not None and _ROLE_MAP_MTIME == mtime:
                return _ROLE_MAP_CACHE
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            mapping = {}
            for role in data.get("roles", []):
                rid = normalize_role_id(role.get("id"))
                mapping[rid] = set(role.get("permissions", []))
            if mapping:
                _ROLE_MAP_CACHE = mapping
                _ROLE_MAP_MTIME = mtime
                return mapping
    except Exception:
        pass
    return default


def _attempt_keys(username: str, client_ip: str) -> tuple[str, str]:
    u = str(username or "").strip().lower()
    ip = str(client_ip or "").strip() or "-"
    return f"user:{u}", f"user_ip:{u}@{ip}"


def _is_locked(key: str, now: float) -> int:
    until = float(_LOCKED_UNTIL.get(key, 0) or 0)
    if until > now:
        return int(until - now)
    if key in _LOCKED_UNTIL:
        _LOCKED_UNTIL.pop(key, None)
    return 0


def _record_login_failure(key: str, now: float) -> int:
    arr = [ts for ts in (_FAILED_ATTEMPTS.get(key) or []) if now - ts <= _FAILED_WINDOW_SEC]
    arr.append(now)
    _FAILED_ATTEMPTS[key] = arr
    if len(arr) >= _FAILED_MAX_ATTEMPTS:
        until = now + _LOCK_SECONDS
        _LOCKED_UNTIL[key] = until
        _FAILED_ATTEMPTS[key] = []
        return _LOCK_SECONDS
    return 0


def _record_login_success(*keys: str) -> None:
    for key in keys:
        _FAILED_ATTEMPTS.pop(key, None)
        _LOCKED_UNTIL.pop(key, None)


def _cleanup_pending_login_rows(conn, now_ts: float | None = None):
    now = float(now_ts or time.time())
    conn.execute(
        "UPDATE pending_logins SET status='expired' WHERE status='pending' AND COALESCE(expires_at, 0) <= ?",
        (now,),
    )
    conn.execute(
        "DELETE FROM pending_logins WHERE COALESCE(created_at, 0) < ?",
        (now - 7 * 24 * 3600,),
    )


def role_bypasses_login_approval(role_id: str) -> bool:
    role = normalize_role_id(role_id)
    if role in ("admin", "qc_manager"):
        return True
    perms = _load_role_permission_map().get(role, set())
    return bool(perms.intersection(_LOGIN_APPROVAL_BYPASS_PERMS))


def get_role_permissions(role_id: str) -> list[str]:
    role = normalize_role_id(role_id)
    perms = sorted(_load_role_permission_map().get(role, set()))
    return perms


def user_has_permission(user_or_role, permission: str) -> bool:
    if isinstance(user_or_role, dict):
        raw_perms = user_or_role.get("permissions")
        if raw_perms:
            return permission in set(raw_perms)
        role = user_or_role.get("role", "staff")
    else:
        role = user_or_role
    return permission in set(get_role_permissions(role))


def build_auth_user_payload(user_row) -> dict:
    user = dict(user_row)
    role = normalize_role_id(user.get("role"))
    return {
        "id": user["id"],
        "username": user["username"],
        "display_name": user.get("display_name", user["username"]),
        "role": role,
        "permissions": get_role_permissions(role),
        "login_2fa_enabled": bool(user.get("login_2fa_enabled", 0)),
    }


def _coerce_timestamp(value, fallback: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(fallback)


def get_effective_pending_expiry(pending: dict) -> tuple[float, float]:
    created_at = _coerce_timestamp(pending.get("created_at"), time.time())
    expires_at = _coerce_timestamp(pending.get("expires_at"), created_at + 300)
    # Recover gracefully from bad legacy rows such as 0, null, or obviously invalid values.
    if expires_at <= created_at or (expires_at - created_at) > 86400:
        expires_at = created_at + 300
    return created_at, expires_at


def with_pending_timing(pending: dict) -> dict:
    created_at, expires_at = get_effective_pending_expiry(pending)
    now = time.time()
    pending["created_at"] = created_at
    pending["expires_at"] = expires_at
    pending["seconds_left"] = max(0, int(expires_at - now))
    return pending


def should_require_login_approval(user_data: dict) -> bool:
    role = normalize_role_id(user_data.get("role"))
    if role in ("admin", "qc_manager"):
        return False

    fallback_2fa = settings_store.is_login_2fa_enabled()
    if "login_2fa_enabled" in user_data:
        return bool(user_data.get("login_2fa_enabled", 0))
    return bool(fallback_2fa)


class LoginReq(BaseModel):
    username: str
    password: str


class RegisterReq(BaseModel):
    username: str
    password: str
    display_name: str = ""
    role: str = "staff"


class UpdateUserReq(BaseModel):
    display_name: str = ""
    role: str = "staff"
    password: str = ""
    login_2fa_enabled: bool = False
    active: bool = True


def normalize_username(value: str) -> str:
    return str(value or "").strip()


def normalize_display_name(value: str, fallback: str) -> str:
    return str(value or "").strip() or str(fallback or "").strip()


def create_auth_router(require_user, require_admin, make_token, db, tg, asyncio_mod):
    router = APIRouter()

    @router.get("/api/auth/debug-version")
    async def auth_debug_version():
        return {
            "marker": AUTH_ROUTE_MARKER,
            "qc_bypass": role_bypasses_login_approval("qc_manager"),
            "qc_permissions": get_role_permissions("qc_manager"),
            "standalone_policy": {
                "admin_requires_approval": should_require_login_approval({"role": "admin", "login_2fa_enabled": 1}),
                "qc_requires_approval": should_require_login_approval({"role": "qc_manager", "login_2fa_enabled": 1}),
                "staff_requires_approval_when_2fa_on": should_require_login_approval({"role": "staff", "login_2fa_enabled": 1}),
            },
        }

    @router.post("/api/auth/login")
    async def auth_login(req: LoginReq, request: Request):
        username = normalize_username(req.username)
        if not username or not str(req.password or ""):
            raise HTTPException(400, "Thieu username hoac password")
        client_ip = request.client.host if request.client else "unknown"
        k_user, k_user_ip = _attempt_keys(username, client_ip)
        now = time.time()
        remaining = max(_is_locked(k_user, now), _is_locked(k_user_ip, now))
        if remaining > 0:
            raise HTTPException(429, f"Too many failed attempts. Retry in {remaining}s")

        conn = db.get_conn()
        user = conn.execute(
            "SELECT * FROM users WHERE LOWER(TRIM(username))=LOWER(TRIM(?)) AND active=1 LIMIT 1",
            (username,),
        ).fetchone()
        try:
            _cleanup_pending_login_rows(conn, now)
            conn.commit()
        except Exception:
            pass
        conn.close()
        if not user:
            lock_for = max(_record_login_failure(k_user, now), _record_login_failure(k_user_ip, now))
            log_activity(username or "unknown", "Login Reject", f"invalid credentials | ip={client_ip}", 0, "auth_login")
            if lock_for > 0:
                raise HTTPException(429, f"Too many failed attempts. Retry in {lock_for}s")
            raise HTTPException(401, "Sai tai khoan hoac mat khau")
        if not bcrypt.checkpw(req.password.encode(), user["password_hash"].encode()):
            lock_for = max(_record_login_failure(k_user, now), _record_login_failure(k_user_ip, now))
            log_activity(username or "unknown", "Login Reject", f"invalid credentials | ip={client_ip}", 0, "auth_login")
            if lock_for > 0:
                raise HTTPException(429, f"Too many failed attempts. Retry in {lock_for}s")
            raise HTTPException(401, "Sai tai khoan hoac mat khau")
        _record_login_success(k_user, k_user_ip)

        user_data = dict(user)
        user_data["role"] = normalize_role_id(user_data.get("role"))
        device = request.headers.get("X-Device-Name", "") or request.headers.get("User-Agent", "unknown")[:100]

        # Standalone auth policy:
        # - admin, qc_manager: always bypass login approval
        # - staff/other roles: follow per-user 2FA flag, fallback to global setting only for legacy rows
        should_require_approval = should_require_login_approval(user_data)
        should_bypass = not should_require_approval

        if should_bypass:
            token = make_token(user_data)
            log_activity(
                user_data["display_name"],
                "Login Success",
                f"{user_data['username']} | ip={client_ip} | device={device}",
                0,
                "auth_login",
            )
            return {
                "status": "ok",
                "token": token,
                "user": build_auth_user_payload(user_data),
            }

        created_at = time.time()
        expires_at = created_at + 300
        login_id = str(uuid.uuid4())[:8]
        conn = db.get_conn()
        try:
            _cleanup_pending_login_rows(conn, now)
        except Exception:
            pass
        conn.execute(
            "UPDATE pending_logins SET status='replaced' WHERE user_id=? AND status='pending'",
            (user_data["id"],),
        )
        conn.execute(
            """INSERT INTO pending_logins (id, user_id, username, ip, device, status, created_at, expires_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            (
                login_id,
                user_data["id"],
                user_data["username"],
                client_ip,
                device,
                "pending",
                created_at,
                expires_at,
            ),
        )
        conn.commit()
        conn.close()

        db.notify_admins(
            "login_pending",
            f"Dang nhap cho duyet: {user_data['display_name']}",
            f"User {user_data['username']} tu IP {client_ip}",
            {"login_id": login_id, "username": user_data["username"], "ip": client_ip},
        )
        asyncio_mod.ensure_future(
            tg.send_login_pending(
                user_data["username"],
                user_data["display_name"],
                device,
                client_ip,
                login_id,
            )
        )
        log_activity(
            user_data["display_name"],
            "Login Pending",
            f"{user_data['username']} | login_id={login_id} | ip={client_ip} | device={device}",
            0,
            "auth_login",
        )
        return {
            "status": "pending",
            "login_id": login_id,
            "message": "Cho Admin phe duyet dang nhap",
            "created_at": created_at,
            "expires_at": expires_at,
            "seconds_left": 300,
        }

    @router.get("/api/auth/poll/{login_id}")
    async def auth_poll(login_id: str):
        conn = db.get_conn()
        try:
            _cleanup_pending_login_rows(conn, time.time())
            conn.commit()
        except Exception:
            pass
        row = conn.execute("SELECT * FROM pending_logins WHERE id=?", (login_id,)).fetchone()
        conn.close()
        if not row:
            raise HTTPException(404, "Not found")
        pending = with_pending_timing(dict(row))
        if pending["status"] == "approved":
            conn = db.get_conn()
            user = conn.execute("SELECT * FROM users WHERE id=?", (pending["user_id"],)).fetchone()
            conn.close()
            if user:
                user_data = dict(user)
                user_data["role"] = normalize_role_id(user_data.get("role"))
                token = make_token(user_data)
                log_activity(
                    user_data["display_name"],
                    "Login Success",
                    f"{user_data['username']} | login_id={login_id} | via=approval",
                    0,
                    "auth_login",
                )
                return {
                    "status": "approved",
                    "token": token,
                    "user": build_auth_user_payload(user_data),
                }
        if pending["status"] == "rejected":
            return {"status": "rejected", "message": "Admin da tu choi dang nhap"}
        if pending["seconds_left"] <= 0:
            return {"status": "expired", "message": "Phien dang nhap da het han (5 phut)", "seconds_left": 0}
        return {"status": "pending", "seconds_left": pending["seconds_left"], "expires_at": pending["expires_at"]}

    @router.post("/api/auth/register")
    async def auth_register(req: RegisterReq, request: Request):
        user = require_user(request)
        if not user_has_permission(user, "manage_users"):
            require_admin(request)
        username = normalize_username(req.username)
        if not username or not str(req.password or ""):
            raise HTTPException(400, "Username va password la bat buoc")
        role_id = normalize_role_id(req.role)
        conn = db.get_conn()
        exists = conn.execute(
            "SELECT 1 FROM users WHERE LOWER(TRIM(username))=LOWER(TRIM(?)) LIMIT 1",
            (username,),
        ).fetchone()
        if exists:
            conn.close()
            raise HTTPException(400, "Username da ton tai")
        pw_hash = bcrypt.hashpw(req.password.encode(), bcrypt.gensalt()).decode()
        user_id = str(uuid.uuid4())
        conn.execute(
            """
            INSERT INTO users (id, username, password_hash, display_name, role, login_2fa_enabled, active, created_at)
            VALUES (?,?,?,?,?,?,?,?)
            """,
            (user_id, username, pw_hash, normalize_display_name(req.display_name, username), role_id, 0, 1, time.time()),
        )
        conn.commit()
        conn.close()
        log_activity(
            user["display_name"],
            "User Create",
            f"{username} | role={role_id}",
            0,
            "auth_users",
        )
        return {"ok": True, "user_id": user_id}

    @router.post("/api/auth/repair-users")
    async def auth_repair_users(request: Request):
        user = require_user(request)
        if not user_has_permission(user, "manage_users"):
            require_admin(request)

        conn = db.get_conn()
        rows = conn.execute(
            "SELECT id, username, display_name, role, login_2fa_enabled, active FROM users ORDER BY created_at DESC"
        ).fetchall()

        prepared = []
        duplicate_map: dict[str, list[str]] = {}
        for row in rows:
            item = dict(row)
            normalized_username = normalize_username(item.get("username"))
            lowered = normalized_username.lower()
            if lowered:
                duplicate_map.setdefault(lowered, []).append(str(item.get("id") or ""))
            prepared.append({
                "id": str(item.get("id") or ""),
                "username": normalized_username,
                "display_name": normalize_display_name(item.get("display_name"), normalized_username),
                "role": normalize_role_id(item.get("role")),
                "login_2fa_enabled": 1 if bool(item.get("login_2fa_enabled", 0)) else 0,
                "active": 1 if item.get("active", 1) in (1, True, "1") else 0,
            })

        conflicts = [
            {"normalized_username": key, "user_ids": ids}
            for key, ids in duplicate_map.items()
            if len(ids) > 1
        ]
        if conflicts:
            conn.close()
            raise HTTPException(409, {"message": "Conflict usernames after normalization", "conflicts": conflicts})

        repaired = 0
        for item in prepared:
            conn.execute(
                """
                UPDATE users
                SET username=?, display_name=?, role=?, login_2fa_enabled=?, active=?
                WHERE id=?
                """,
                (
                    item["username"],
                    item["display_name"],
                    item["role"],
                    item["login_2fa_enabled"],
                    item["active"],
                    item["id"],
                ),
            )
            repaired += 1

        conn.commit()
        conn.close()
        log_activity(user["display_name"], "User Repair", f"repaired={repaired}", 0, "auth_users")
        return {"ok": True, "repaired": repaired}

    @router.get("/api/auth/me")
    async def auth_me(request: Request):
        user = require_user(request)
        payload = {
            "id": user["user_id"],
            "username": user["username"],
            "display_name": user.get("display_name", user["username"]),
            "role": normalize_role_id(user.get("role")),
            "permissions": get_role_permissions(user.get("role")),
            "login_2fa_enabled": bool(user.get("login_2fa_enabled", 0)),
        }
        return payload

    @router.get("/api/auth/users")
    async def auth_users(request: Request):
        user = require_user(request)
        role = normalize_role_id(user.get("role"))
        if role not in {"admin", "qc_manager"} and not user_has_permission(user, "manage_users"):
            require_admin(request)
        conn = db.get_conn()
        rows = conn.execute(
            "SELECT id, username, display_name, role, login_2fa_enabled, active, created_at FROM users ORDER BY created_at DESC"
        ).fetchall()
        conn.close()
        items = []
        for row in rows:
            item = dict(row)
            item["role"] = normalize_role_id(item.get("role"))
            item["permissions"] = get_role_permissions(item.get("role"))
            item["login_2fa_enabled"] = bool(item.get("login_2fa_enabled", 0))
            items.append(item)
        return items

    @router.post("/api/auth/users/{user_id}")
    async def auth_update_user(user_id: str, req: UpdateUserReq, request: Request):
        user = require_user(request)
        if not user_has_permission(user, "manage_users"):
            require_admin(request)
        role_id = normalize_role_id(req.role)
        conn = db.get_conn()
        row = conn.execute(
            "SELECT id, username, display_name, role, login_2fa_enabled, active FROM users WHERE id=?",
            (user_id,),
        ).fetchone()
        if not row:
            conn.close()
            raise HTTPException(404, "User khong ton tai")

        password_hash = None
        if str(req.password or "").strip():
            password_hash = bcrypt.hashpw(req.password.encode(), bcrypt.gensalt()).decode()

        if password_hash:
            conn.execute(
                """
                UPDATE users
                SET display_name=?, role=?, login_2fa_enabled=?, active=?, password_hash=?
                WHERE id=?
                """,
                (
                    req.display_name or row["display_name"] or row["username"],
                    role_id,
                    1 if req.login_2fa_enabled else 0,
                    1 if req.active else 0,
                    password_hash,
                    user_id,
                ),
            )
        else:
            conn.execute(
                """
                UPDATE users
                SET display_name=?, role=?, login_2fa_enabled=?, active=?
                WHERE id=?
                """,
                (
                    req.display_name or row["display_name"] or row["username"],
                    role_id,
                    1 if req.login_2fa_enabled else 0,
                    1 if req.active else 0,
                    user_id,
                ),
            )
        conn.commit()
        updated = conn.execute(
            "SELECT id, username, display_name, role, login_2fa_enabled, active, created_at FROM users WHERE id=?",
            (user_id,),
        ).fetchone()
        conn.close()
        changed_parts = [
            f"display_name={req.display_name or row['display_name'] or row['username']}",
            f"role={role_id}",
            f"active={1 if req.active else 0}",
            f"login_2fa_enabled={1 if req.login_2fa_enabled else 0}",
        ]
        if password_hash:
            changed_parts.append("password_changed=1")
        log_activity(
            user["display_name"],
            "User Update",
            f"{row['username']} | " + " | ".join(changed_parts),
            0,
            "auth_users",
        )
        item = dict(updated)
        item["role"] = normalize_role_id(item.get("role"))
        item["permissions"] = get_role_permissions(item.get("role"))
        item["login_2fa_enabled"] = bool(item.get("login_2fa_enabled", 0))
        return {"ok": True, "user": item}

    @router.delete("/api/auth/users/{user_id}")
    async def auth_delete_user(user_id: str, request: Request):
        user = require_user(request)
        if not user_has_permission(user, "manage_users"):
            require_admin(request)
        if str(user.get("user_id") or "") == str(user_id or ""):
            raise HTTPException(400, "Khong the tu xoa tai khoan dang dang nhap")

        conn = db.get_conn()
        row = conn.execute(
            "SELECT id, username, display_name, role FROM users WHERE id=?",
            (user_id,),
        ).fetchone()
        if not row:
            conn.close()
            raise HTTPException(404, "User khong ton tai")

        username = str(row["username"] or "").strip()
        deleted_stats = {
            "tasks": 0,
            "pending_logins": 0,
            "qc_queue": 0,
            "notifications": 0,
            "shift_reports": 0,
            "work_tasks": 0,
            "activity_logs": 0,
            "ai_chat_history": 0,
            "ai_chat_memories": 0,
            "ai_chat_analysis_records": 0,
            "users": 0,
        }

        def _exec_count(sql: str, params: tuple):
            cur = conn.execute(sql, params)
            try:
                return int(cur.rowcount or 0)
            except Exception:
                return 0

        try:
            deleted_stats["tasks"] += _exec_count("DELETE FROM tasks WHERE user_name=? OR staff_id=?", (username, username))
            deleted_stats["pending_logins"] += _exec_count("DELETE FROM pending_logins WHERE user_id=? OR username=?", (user_id, username))
            deleted_stats["qc_queue"] += _exec_count("DELETE FROM qc_queue WHERE user_name=?", (username,))
            deleted_stats["notifications"] += _exec_count("DELETE FROM notifications WHERE user_id=?", (user_id,))
            deleted_stats["shift_reports"] += _exec_count("DELETE FROM shift_reports WHERE user_id=? OR user_name=?", (user_id, username))
            deleted_stats["work_tasks"] += _exec_count("DELETE FROM work_tasks WHERE user_name=?", (username,))
            deleted_stats["activity_logs"] += _exec_count("DELETE FROM activity_logs WHERE user_name=?", (username,))
            deleted_stats["ai_chat_history"] += _exec_count("DELETE FROM ai_chat_history WHERE user_name=?", (username,))
            deleted_stats["ai_chat_memories"] += _exec_count("DELETE FROM ai_chat_memories WHERE user_name=?", (username,))
            deleted_stats["ai_chat_analysis_records"] += _exec_count("DELETE FROM ai_chat_analysis_records WHERE user_name=?", (username,))
            deleted_stats["users"] += _exec_count("DELETE FROM users WHERE id=?", (user_id,))
            conn.commit()
        finally:
            conn.close()

        log_activity(
            user["display_name"],
            "User Delete",
            f"{username} | " + " | ".join(f"{k}={v}" for k, v in deleted_stats.items()),
            0,
            "auth_users",
        )
        return {"ok": True, "deleted": deleted_stats, "user_id": user_id, "username": username}

    @router.get("/api/auth/pending")
    async def auth_pending(request: Request):
        user = require_user(request)
        if not user_has_permission(user, "manage_users"):
            require_admin(request)
        conn = db.get_conn()
        try:
            _cleanup_pending_login_rows(conn, time.time())
            conn.commit()
        except Exception:
            pass
        rows = conn.execute("SELECT * FROM pending_logins WHERE status='pending' ORDER BY created_at DESC").fetchall()
        conn.close()
        items = []
        for row in rows:
            pending = with_pending_timing(dict(row))
            if pending["seconds_left"] > 0:
                items.append(pending)
        return items

    @router.post("/api/auth/approve/{login_id}")
    async def auth_approve(login_id: str, request: Request):
        user = require_user(request)
        if not user_has_permission(user, "manage_users"):
            require_admin(request)
        conn = db.get_conn()
        conn.execute("UPDATE pending_logins SET status='approved' WHERE id=?", (login_id,))
        row = conn.execute("SELECT user_id, username FROM pending_logins WHERE id=?", (login_id,)).fetchone()
        conn.commit()
        conn.close()
        if row:
            db.add_notification(
                row["user_id"],
                "login_approved",
                "Dang nhap duoc duyet",
                "Admin da phe duyet dang nhap cua ban",
            )
            log_activity(
                user["display_name"],
                "Login Approve",
                f"{row['username']} | login_id={login_id}",
                0,
                "auth_login",
            )
        return {"ok": True}

    @router.post("/api/auth/reject/{login_id}")
    async def auth_reject(login_id: str, request: Request):
        user = require_user(request)
        if not user_has_permission(user, "manage_users"):
            require_admin(request)
        conn = db.get_conn()
        conn.execute("UPDATE pending_logins SET status='rejected' WHERE id=?", (login_id,))
        row = conn.execute("SELECT user_id FROM pending_logins WHERE id=?", (login_id,)).fetchone()
        conn.commit()
        conn.close()
        if row:
            db.add_notification(
                row["user_id"],
                "login_rejected",
                "Dang nhap bi tu choi",
                "Admin da tu choi dang nhap cua ban",
            )
            log_activity(
                user["display_name"],
                "Login Reject",
                f"login_id={login_id}",
                0,
                "auth_login",
            )
        return {"ok": True}

    @router.get("/api/auth/tg-approve/{login_id}", response_class=HTMLResponse)
    async def tg_approve(login_id: str):
        conn = db.get_conn()
        row = conn.execute("SELECT * FROM pending_logins WHERE id=?", (login_id,)).fetchone()
        if not row:
            conn.close()
            return HTMLResponse("<h2>Yeu cau phe duyet khong ton tai hoac da het han</h2>", 404)
        pending = with_pending_timing(dict(row))
        if pending["status"] != "pending":
            conn.close()
            status_text = {
                "approved": "Yeu cau nay da duoc duyet",
                "rejected": "Yeu cau nay da bi tu choi",
                "replaced": "Yeu cau nay da bi thay the boi lan dang nhap moi",
                "expired": "Yeu cau nay da het han",
            }.get(str(pending["status"]), f"Yeu cau da duoc xu ly: {pending['status']}")
            return HTMLResponse(f"<h2>{status_text}</h2>")
        if pending["seconds_left"] <= 0:
            conn.close()
            return HTMLResponse("<h2>Yeu cau dang nhap da het han (5 phut)</h2>")
        conn.execute("UPDATE pending_logins SET status='approved' WHERE id=?", (login_id,))
        conn.commit()
        conn.close()
        db.add_notification(
            pending["user_id"],
            "login_approved",
            "Dang nhap duoc duyet",
            "Admin da phe duyet dang nhap cua ban",
        )
        log_activity(
            "telegram_bot",
            "Login Approve",
            f"{pending['username']} | login_id={login_id} | via=tg_link",
            0,
            "telegram_login",
        )
        asyncio_mod.ensure_future(tg.send_login_result(pending["username"], True))
        return HTMLResponse(f"<h2>Da duyet dang nhap cho {pending['username']}</h2><p>Co the dong tab nay.</p>")

    @router.get("/api/auth/tg-reject/{login_id}", response_class=HTMLResponse)
    async def tg_reject(login_id: str):
        conn = db.get_conn()
        row = conn.execute("SELECT * FROM pending_logins WHERE id=?", (login_id,)).fetchone()
        if not row:
            conn.close()
            return HTMLResponse("<h2>Yeu cau phe duyet khong ton tai</h2>", 404)
        pending = with_pending_timing(dict(row))
        if pending["status"] != "pending":
            conn.close()
            status_text = {
                "approved": "Yeu cau nay da duoc duyet",
                "rejected": "Yeu cau nay da bi tu choi",
                "replaced": "Yeu cau nay da bi thay the boi lan dang nhap moi",
                "expired": "Yeu cau nay da het han",
            }.get(str(pending["status"]), f"Yeu cau da duoc xu ly: {pending['status']}")
            return HTMLResponse(f"<h2>{status_text}</h2>")
        if pending["seconds_left"] <= 0:
            conn.close()
            return HTMLResponse("<h2>Yeu cau dang nhap da het han (5 phut)</h2>")
        conn.execute("UPDATE pending_logins SET status='rejected' WHERE id=?", (login_id,))
        conn.commit()
        conn.close()
        db.add_notification(
            pending["user_id"],
            "login_rejected",
            "Dang nhap bi tu choi",
            "Admin da tu choi dang nhap",
        )
        log_activity(
            "telegram_bot",
            "Login Reject",
            f"{pending['username']} | login_id={login_id} | via=tg_link",
            0,
            "telegram_login",
        )
        asyncio_mod.ensure_future(tg.send_login_result(pending["username"], False))
        return HTMLResponse(f"<h2>Da chan dang nhap cua {pending['username']}</h2><p>Co the dong tab nay.</p>")

    return router
