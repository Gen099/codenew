"""Notification routes."""
from fastapi import APIRouter, Request


def create_notifications_router(require_user, db):
    router = APIRouter()

    @router.get("/api/notifications")
    async def notifications(request: Request):
        user = require_user(request)
        return db.get_notifications(user["user_id"])

    @router.post("/api/notifications/read/{nid}")
    async def notification_read(nid: str, request: Request):
        require_user(request)
        db.mark_notification_read(nid)
        return {"ok": True}

    @router.post("/api/notifications/read-all")
    async def notification_read_all(request: Request):
        user = require_user(request)
        conn = db.get_conn()
        conn.execute("UPDATE notifications SET read=1 WHERE user_id=?", (user["user_id"],))
        conn.commit()
        conn.close()
        return {"ok": True}

    return router

