"""QC workflow routes."""
import time
import uuid

from fastapi import APIRouter, Request
from pydantic import BaseModel


class QCSubmitReq(BaseModel):
    task_id: str
    video_url: str
    note: str = ""


class QCRejectReq(BaseModel):
    reason: str = ""


def create_qc_router(require_user, require_admin, require_qc_or_admin, db, tg, asyncio_mod):
    router = APIRouter()

    @router.post("/api/qc/submit")
    async def qc_submit(req: QCSubmitReq, request: Request):
        user = require_user(request)
        from activity_logger import log_activity
        qc_id = str(uuid.uuid4())[:12]
        conn = db.get_conn()
        task_row = conn.execute(
            "SELECT gen_mode, credit_used FROM tasks WHERE task_id=? LIMIT 1",
            (req.task_id,),
        ).fetchone()
        conn.execute(
            """INSERT INTO qc_queue (id, task_id, video_url, user_name, user_display, note, status, submitted_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            (
                qc_id,
                req.task_id,
                req.video_url,
                user["username"],
                user["display_name"],
                req.note,
                "pending",
                time.time(),
            ),
        )
        conn.commit()
        conn.close()

        db.notify_admins(
            "qc_new",
            "Video moi can duyet",
            f"{user['display_name']} gui video QC: {req.note or req.task_id}",
            {"qc_id": qc_id, "task_id": req.task_id},
        )
        task_gen_mode = ""
        task_credit = 0.0
        if task_row:
            try:
                task_gen_mode = str(task_row["gen_mode"] or "")
            except Exception:
                task_gen_mode = ""
            try:
                task_credit = float(task_row["credit_used"] or 0)
            except Exception:
                task_credit = 0.0

        asyncio_mod.ensure_future(
            tg.send_qc_notification(
                qc_id,
                req.task_id,
                req.video_url,
                user["display_name"],
                req.note,
                task_gen_mode,
                task_credit,
            )
        )
        log_activity(
            user["display_name"],
            "QC Submit",
            f"qc_id={qc_id} | task_id={req.task_id} | note={req.note or '-'}",
            0,
            "qc_submit",
        )
        return {"ok": True, "qc_id": qc_id}

    @router.get("/api/qc/queue")
    async def qc_queue(request: Request):
        require_qc_or_admin(request)
        conn = db.get_conn()
        rows = conn.execute("SELECT * FROM qc_queue ORDER BY submitted_at DESC LIMIT 50").fetchall()
        conn.close()
        return [dict(row) for row in rows]

    @router.post("/api/qc/approve/{qc_id}")
    async def qc_approve(qc_id: str, request: Request):
        admin = require_qc_or_admin(request)
        from activity_logger import log_activity
        conn = db.get_conn()
        conn.execute(
            "UPDATE qc_queue SET status='approved', reviewer=?, reviewed_at=? WHERE id=?",
            (admin["username"], time.time(), qc_id),
        )
        row = conn.execute("SELECT * FROM qc_queue WHERE id=?", (qc_id,)).fetchone()
        conn.commit()
        conn.close()
        if row:
            qc_row = dict(row)
            conn2 = db.get_conn()
            user_row = conn2.execute("SELECT id FROM users WHERE username=?", (qc_row["user_name"],)).fetchone()
            conn2.close()
            if user_row:
                db.add_notification(
                    user_row["id"],
                    "qc_approved",
                    "Video da duoc duyet",
                    f"Video {qc_row['task_id']} duoc {admin['display_name']} phe duyet",
                    {"qc_id": qc_id, "task_id": qc_row["task_id"]},
                )
            asyncio_mod.ensure_future(
                tg.send_qc_result(qc_row["task_id"], qc_row["user_display"], True, admin["display_name"])
            )
            log_activity(
                admin["display_name"],
                "QC Approve",
                f"qc_id={qc_id} | task_id={qc_row['task_id']}",
                0,
                "qc_approve",
            )
        return {"ok": True}

    @router.post("/api/qc/reject/{qc_id}")
    async def qc_reject(qc_id: str, req: QCRejectReq, request: Request):
        admin = require_qc_or_admin(request)
        from activity_logger import log_activity
        conn = db.get_conn()
        conn.execute(
            "UPDATE qc_queue SET status='rejected', reviewer=?, reject_reason=?, reviewed_at=? WHERE id=?",
            (admin["username"], req.reason, time.time(), qc_id),
        )
        row = conn.execute("SELECT * FROM qc_queue WHERE id=?", (qc_id,)).fetchone()
        conn.commit()
        conn.close()
        if row:
            qc_row = dict(row)
            conn2 = db.get_conn()
            user_row = conn2.execute("SELECT id FROM users WHERE username=?", (qc_row["user_name"],)).fetchone()
            conn2.close()
            if user_row:
                db.add_notification(
                    user_row["id"],
                    "qc_rejected",
                    "Video bi tu choi",
                    f"Video {qc_row['task_id']} bi reject: {req.reason}",
                    {"qc_id": qc_id, "task_id": qc_row["task_id"], "reason": req.reason},
                )
            asyncio_mod.ensure_future(
                tg.send_qc_result(
                    qc_row["task_id"],
                    qc_row["user_display"],
                    False,
                    admin["display_name"],
                    req.reason,
                )
            )
            log_activity(
                admin["display_name"],
                "QC Reject",
                f"qc_id={qc_id} | task_id={qc_row['task_id']} | reason={req.reason or '-'}",
                0,
                "qc_reject",
            )
        return {"ok": True}

    @router.get("/api/qc/status/{task_id}")
    async def qc_status(task_id: str, request: Request):
        require_user(request)
        conn = db.get_conn()
        row = conn.execute(
            "SELECT * FROM qc_queue WHERE task_id=? ORDER BY submitted_at DESC LIMIT 1",
            (task_id,),
        ).fetchone()
        conn.close()
        if not row:
            return {"status": "none"}
        return dict(row)

    return router
