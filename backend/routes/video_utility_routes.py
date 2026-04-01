"""Lower-risk video utility routes split out from the main video flow."""

from datetime import datetime

from fastapi import APIRouter, HTTPException, Request


def create_video_utility_router(require_user, db, kie, logger, load_cameras, get_credit, providers=None):
    router = APIRouter()

    @router.get("/api/video/camera-moves")
    async def video_camera_moves():
        return load_cameras()

    @router.get("/api/video/active-tasks")
    async def video_active_tasks(request: Request):
        user = require_user(request)
        if user["role"] == "admin":
            return db.get_active_tasks()
        return db.get_active_tasks(user["username"])

    @router.post("/api/video/stop/{task_id}")
    async def video_stop(task_id: str, request: Request):
        user = require_user(request)
        conn = db.get_conn()
        row = conn.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        if not row:
            conn.close()
            raise HTTPException(404, "Task not found")
        task = dict(row)
        if user["role"] != "admin" and task["user_name"] != user["username"]:
            conn.close()
            raise HTTPException(403, "Not your task")
        current_status = str(task.get("status") or "").strip().lower()
        if current_status in {"success", "fail", "failed", "cancelled"}:
            conn.close()
            return {
                "ok": True,
                "provider": str(task.get("provider") or "provider1"),
                "upstream_cancel": "already_finished",
                "status": current_status,
                "message": "Task da o trang thai ket thuc",
            }
        provider_id = str(task.get("provider") or "provider1")
        if provider_id == "provider1":
            conn.close()
            raise HTTPException(
                409,
                "Server 1 khong co endpoint cancel upstream trong integration hien tai. Khong danh dau huy gia.",
            )
        upstream_cancel = "not_supported"
        if providers and provider_id == "provider2":
            try:
                p = providers.get_provider(provider_id)
                if p and hasattr(p, "cancel_task"):
                    await p.cancel_task(task_id)
                    upstream_cancel = "ok"
            except Exception as exc:
                conn.close()
                logger.warning("Upstream cancel failed task=%s provider=%s: %s", task_id, provider_id, exc)
                raise HTTPException(409, f"Cancel upstream that bai: {exc}")
        conn.execute(
            "UPDATE tasks SET status='cancelled', completed_at=? WHERE task_id=?",
            (datetime.now().isoformat(), task_id),
        )
        conn.commit()
        conn.close()
        logger.info(
            "Task %s cancelled by %s | provider=%s | upstream=%s",
            task_id,
            user["username"],
            provider_id,
            upstream_cancel,
        )
        return {
            "ok": True,
            "provider": provider_id,
            "upstream_cancel": upstream_cancel,
            "status": "cancelled",
            "message": "Task da duoc cancel tren upstream",
        }

    return router
