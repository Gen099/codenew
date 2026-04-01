"""Credits and API-key routes."""
import os

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from activity_logger import log_activity
from .auth_routes import user_has_permission


class AddKeyReq(BaseModel):
    key: str


class SetActiveKeyReq(BaseModel):
    index: int


class ReplaceKeysReq(BaseModel):
    keys: list[str]
    active_index: int = 0


def create_credits_router(require_user, require_admin, kie):
    router = APIRouter()

    @router.get("/api/credits/balance")
    async def credits_balance(request: Request):
        require_user(request)
        if hasattr(kie, "force_reload_keys"):
            kie.force_reload_keys()
        await kie.refresh_key_credits()
        total = await kie.get_credits_total()
        return {"credits": total}

    @router.get("/api/credits/refresh")
    async def credits_refresh(request: Request):
        user = require_user(request)
        total_before = 0.0
        try:
            total_before = float(await kie.get_credits_total() or 0)
        except Exception:
            total_before = 0.0
        if hasattr(kie, "force_reload_keys"):
            kie.force_reload_keys()
        await kie.refresh_key_credits(force=True)
        keys = await kie.get_all_keys_info()
        total = sum(key["credits"] for key in keys)
        delta = float(total or 0) - float(total_before or 0)
        try:
            log_activity(
                user.get("display_name") or user.get("username") or "unknown",
                "Monitor Credit Check",
                f"Credits refresh | before={total_before:.2f} after={float(total):.2f} delta={delta:+.2f}",
                abs(delta),
                "credits_refresh",
            )
        except Exception:
            pass
        return {"credits": total, "keys": keys, "ok": True}

    @router.get("/api/credits/keys")
    async def credits_keys(request: Request):
        user = require_user(request)
        if user["role"] not in ("admin", "qc_manager", "staff"):
            raise HTTPException(403, "Not allowed")
        if hasattr(kie, "force_reload_keys"):
            kie.force_reload_keys()
        await kie.refresh_key_credits(force=True)
        keys = await kie.get_all_keys_info()
        return {"keys": keys, "total": sum(key["credits"] for key in keys)}

    @router.post("/api/credits/keys/add")
    async def credits_add_key(req: AddKeyReq, request: Request):
        user = require_user(request)
        if not user_has_permission(user, "manage_keys"):
            raise HTTPException(403, "Manage keys permission required")
        ok = kie.add_key(req.key)
        if not ok:
            raise HTTPException(400, "Key da ton tai hoac khong hop le")
        await kie.refresh_key_credits()
        return {"ok": True}

    @router.delete("/api/credits/keys/{idx}")
    async def credits_remove_key(idx: int, request: Request):
        user = require_user(request)
        if not user_has_permission(user, "manage_keys"):
            require_admin(request)
        ok = kie.remove_key(idx)
        if not ok:
            raise HTTPException(400, "Khong the xoa key nay")
        return {"ok": True}

    @router.post("/api/credits/keys/set-active")
    async def credits_set_active_key(req: SetActiveKeyReq, request: Request):
        user = require_user(request)
        if not user_has_permission(user, "manage_keys"):
            raise HTTPException(403, "Manage keys permission required")
        ok = kie.set_preferred_key(req.index)
        if not ok:
            raise HTTPException(400, "Key index khong hop le")
        keys = await kie.get_all_keys_info()
        return {"ok": True, "keys": keys}

    @router.post("/api/credits/keys/replace")
    async def credits_replace_keys(req: ReplaceKeysReq, request: Request):
        user = require_user(request)
        if not user_has_permission(user, "manage_keys"):
            raise HTTPException(403, "Manage keys permission required")

        normalized = []
        seen = set()
        for raw in req.keys or []:
            key = str(raw or "").strip()
            if not key:
                continue
            if key in seen:
                continue
            seen.add(key)
            normalized.append(key)
        if not normalized:
            raise HTTPException(400, "Danh sach key rong")

        if hasattr(kie, "force_reload_keys"):
            kie.force_reload_keys()
        current = list(getattr(kie, "_api_keys", []) or [])
        for idx in range(len(current) - 1, -1, -1):
            kie.remove_key(idx)
        for key in normalized:
            if not kie.add_key(key):
                raise HTTPException(400, "Khong the luu danh sach key")

        active_idx = int(req.active_index or 0)
        if active_idx < 0 or active_idx >= len(normalized):
            active_idx = 0
        kie.set_preferred_key(active_idx)
        await kie.refresh_key_credits(force=True)
        keys = await kie.get_all_keys_info()
        return {"ok": True, "keys": keys, "total": sum(key["credits"] for key in keys)}

    @router.get("/api/credits/stats")
    async def credits_stats(request: Request):
        require_user(request)
        if hasattr(kie, "force_reload_keys"):
            kie.force_reload_keys()
        await kie.refresh_key_credits()
        keys = await kie.get_all_keys_info()
        total = sum(key["credits"] for key in keys)
        low_threshold = float(os.getenv("CREDIT_WARN_THRESHOLD", "50"))
        warnings = [key for key in keys if key["credits"] < low_threshold and not key.get("exhausted")]
        return {
            "keys": keys,
            "total": total,
            "low_credit_keys": warnings,
            "warn_threshold": low_threshold,
        }

    @router.get("/api/credits/details")
    async def credits_details(request: Request):
        require_user(request)
        if hasattr(kie, "force_reload_keys"):
            kie.force_reload_keys()
        await kie.refresh_key_credits(force=True)
        keys = await kie.get_all_keys_info()
        total = sum(float(key.get("credits", 0) or 0) for key in keys)
        return {"keys": keys, "total": total}

    return router
