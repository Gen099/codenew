"""Work-task routes."""
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from activity_logger import log_activity
from .auth_routes import user_has_permission


class WorkTaskCreateReq(BaseModel):
    title: str
    description: str = ""


class WorkTaskCloseReq(BaseModel):
    notes: str = ""


def create_work_tasks_router(require_user, db, tg, asyncio_mod):
    router = APIRouter()

    @router.post("/api/work-tasks/create")
    async def work_task_create(req: WorkTaskCreateReq, request: Request):
        user = require_user(request)
        wid = db.create_work_task(
            {
                "title": req.title,
                "description": req.description,
                "user_name": user["username"],
                "user_display": user["display_name"],
            }
        )
        log_activity(
            user["display_name"],
            "Task Start",
            f"[{req.title}] {req.description or '-'}",
            0,
            "work_task",
        )
        asyncio_mod.ensure_future(
            tg.send_work_task_started(user["display_name"], req.title, req.description)
        )
        return {"ok": True, "work_task_id": wid}

    @router.post("/api/work-tasks/close/{wid}")
    async def work_task_close(wid: str, req: WorkTaskCloseReq, request: Request):
        user = require_user(request)
        current = db.get_active_work_task(user["username"])
        stats = db.close_work_task(wid, req.notes)
        title = (current or {}).get("title") or wid
        log_activity(
            user["display_name"],
            "Task Close",
            f"[{title}] videos={stats.get('video_count', 0)} | notes={req.notes or '-'}",
            float(stats.get("credits_used", 0) or 0),
            "work_task",
        )
        asyncio_mod.ensure_future(
            tg.send_work_task_closed(
                user["display_name"],
                title,
                int(stats.get("video_count", 0) or 0),
                float(stats.get("credits_used", 0) or 0),
                req.notes,
            )
        )
        return {"ok": True, **stats}

    @router.get("/api/work-tasks")
    async def work_task_list(request: Request, user_name: str = Query(default=""), status: str = Query(default="")):
        user = require_user(request)
        requested_user = str(user_name or "").strip()
        requested_status = str(status or "").strip() or None
        if user_has_permission(user, "view_all_history"):
            return db.get_work_tasks(requested_user or None, requested_status)
        if requested_user and requested_user != user["username"]:
            raise HTTPException(403, "Not allowed")
        return db.get_work_tasks(user["username"], requested_status)

    @router.get("/api/work-tasks/active")
    async def work_task_active(request: Request, user_name: str = Query(default="")):
        user = require_user(request)
        requested_user = str(user_name or "").strip()
        if requested_user and requested_user != user["username"] and not user_has_permission(user, "view_all_history"):
            raise HTTPException(403, "Not allowed")
        wt = db.get_active_work_task(requested_user or user["username"])
        return wt or {}

    @router.get("/api/work-tasks/{user_name}/stats")
    async def work_task_stats(user_name: str, request: Request):
        user = require_user(request)
        if not user_has_permission(user, "view_all_history") and user_name != user["username"]:
            from fastapi import HTTPException

            raise HTTPException(403, "Not allowed")
        return db.get_user_task_stats(user_name)

    return router
