"""Input assets routes (source images persisted per user/session/code)."""
from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel

from .auth_routes import user_has_permission


class InputAssetUpdateReq(BaseModel):
    session_id: str = ""
    code_tag: str = ""
    folder_name: str = ""
    file_name: str = ""
    mime_type: str = ""
    source_url: str = ""
    width: int = 0
    height: int = 0
    edited: bool = False
    derived_from_asset_id: str = ""


def _can_access_asset(user: dict, owner_username: str) -> bool:
    if user_has_permission(user, "view_all_history"):
        return True
    return str(owner_username or "").strip() == str(user.get("username") or "").strip()


def create_input_assets_router(require_user, db, kie):
    router = APIRouter()

    @router.get("/api/input-assets")
    async def list_input_assets(
        request: Request,
        user_name: str = Query(default=""),
        session_id: str = Query(default=""),
        code_tag: str = Query(default=""),
        limit: int = Query(default=300, ge=1, le=2000),
    ):
        user = require_user(request)
        owner = str(user_name or "").strip()
        if owner and not user_has_permission(user, "view_all_history") and owner != str(user.get("username") or "").strip():
            raise HTTPException(403, "Not allowed")
        if not owner and not user_has_permission(user, "view_all_history"):
            owner = str(user.get("username") or "").strip()
        return db.list_input_assets(owner, str(session_id or "").strip(), str(code_tag or "").strip(), int(limit))

    @router.post("/api/input-assets/upload")
    async def upload_input_asset(
        request: Request,
        file: UploadFile = File(...),
        session_id: str = Form(default=""),
        code_tag: str = Form(default=""),
        folder_name: str = Form(default=""),
    ):
        user = require_user(request)
        content = await file.read()
        if not content:
            raise HTTPException(400, "Empty file")
        if len(content) > 20 * 1024 * 1024:
            raise HTTPException(400, "File too large (max 20MB)")
        mime = file.content_type or "application/octet-stream"
        try:
            source_url = await kie.upload_file(content, file.filename or "asset.bin", mime)
        except Exception as exc:
            raise HTTPException(502, f"Upload source failed: {exc}")
        aid = db.create_input_asset(
            {
                "user_id": user.get("user_id") or "",
                "user_name": user.get("username") or "",
                "user_display": user.get("display_name") or user.get("username") or "",
                "session_id": str(session_id or "").strip(),
                "code_tag": str(code_tag or "").strip(),
                "folder_name": str(folder_name or "").strip(),
                "file_name": str(file.filename or "").strip() or "asset",
                "mime_type": mime,
                "source_url": source_url,
                "width": 0,
                "height": 0,
                "edited": False,
                "derived_from_asset_id": "",
            }
        )
        row = db.get_input_asset(aid) or {}
        return {"ok": True, "asset": row}

    @router.patch("/api/input-assets/{asset_id}")
    async def patch_input_asset(asset_id: str, req: InputAssetUpdateReq, request: Request):
        user = require_user(request)
        current = db.get_input_asset(asset_id)
        if not current:
            raise HTTPException(404, "Asset not found")
        if not _can_access_asset(user, current.get("user_name") or ""):
            raise HTTPException(403, "Not allowed")
        db.update_input_asset(
            asset_id,
            {
                "session_id": req.session_id,
                "code_tag": req.code_tag,
                "folder_name": req.folder_name,
                "file_name": req.file_name,
                "mime_type": req.mime_type,
                "source_url": req.source_url,
                "width": req.width,
                "height": req.height,
                "edited": req.edited,
                "derived_from_asset_id": req.derived_from_asset_id,
            },
        )
        return {"ok": True, "asset": db.get_input_asset(asset_id)}

    @router.delete("/api/input-assets/{asset_id}")
    async def remove_input_asset(asset_id: str, request: Request):
        user = require_user(request)
        current = db.get_input_asset(asset_id)
        if not current:
            return {"ok": True}
        if not _can_access_asset(user, current.get("user_name") or ""):
            raise HTTPException(403, "Not allowed")
        db.delete_input_asset(asset_id)
        return {"ok": True}

    return router
