"""History and library routes."""
from fastapi import APIRouter, Query, Request

from activity_logger import event_label, normalize_event
from .auth_routes import user_has_permission


def create_history_router(require_user, db):
    router = APIRouter()

    @router.get("/api/history")
    async def history(request: Request, limit: int = Query(default=200, ge=1, le=5000)):
        user = require_user(request)
        conn = db.get_conn()
        if user_has_permission(user, "view_all_history"):
            activity_rows = conn.execute(
                "SELECT timestamp, user_name, action, detail, credits, provider FROM activity_logs ORDER BY timestamp DESC LIMIT ?",
                (int(limit),),
            ).fetchall()
            task_rows = conn.execute(
                """
                SELECT
                    task_id, user_name, user_display, prompt, credit_used, provider,
                    created_at, completed_at, status, gen_mode, task_type, output_filename,
                    model_id, model_label, cost_unit
                FROM tasks
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (int(limit),),
            ).fetchall()
        else:
            activity_rows = conn.execute(
                "SELECT timestamp, user_name, action, detail, credits, provider FROM activity_logs WHERE user_name=? ORDER BY timestamp DESC LIMIT ?",
                (user["username"], int(limit)),
            ).fetchall()
            task_rows = conn.execute(
                """
                SELECT
                    task_id, user_name, user_display, prompt, credit_used, provider,
                    created_at, completed_at, status, gen_mode, task_type, output_filename,
                    model_id, model_label, cost_unit
                FROM tasks
                WHERE user_name=?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (user["username"], int(limit)),
            ).fetchall()
        conn.close()

        result = []
        for row in activity_rows:
            item = dict(row)
            raw_action = item.get("action") or ""
            detail = item.get("detail") or ""
            normalized = normalize_event(raw_action, detail)
            display_action = event_label(raw_action, detail)
            result.append(
                {
                    "created_at": str(item.get("timestamp") or ""),
                    "timestamp": str(item.get("timestamp") or ""),
                    "user_name": item.get("user_name") or "",
                    "user_display": item.get("user_name") or "",
                    "credit_used": float(item.get("credits") or 0),
                    "prompt": detail,
                    "detail": detail,
                    "event_type": normalized,
                    "action_raw": raw_action,
                    "status": display_action,
                    "action": display_action,
                    "provider": item.get("provider") or "",
                    "source": "activity_log",
                }
            )
        for row in task_rows:
            item = dict(row)
            gen_mode = str(item.get("gen_mode") or "").strip().lower()
            task_type = str(item.get("task_type") or "").strip().lower()
            if task_type in {"image", "image_edit"} or gen_mode == "image_edit":
                action = "Ảnh tạo"
                event_type = "image_start"
            elif task_type in {"audio", "speech", "txt2audio"} or gen_mode in {"audio", "txt2audio", "speech"}:
                action = "Audio tạo"
                event_type = "task_start"
            else:
                action = "Video tạo"
                event_type = "video_start"
            prompt = str(item.get("prompt") or "").strip()
            task_id = str(item.get("task_id") or "").strip()
            filename = str(item.get("output_filename") or "").strip()
            detail = " | ".join(part for part in [task_id, filename or prompt] if part)
            result.append(
                {
                    "created_at": str(item.get("created_at") or ""),
                    "timestamp": str(item.get("created_at") or ""),
                    "completed_at": str(item.get("completed_at") or ""),
                    "user_name": item.get("user_name") or "",
                    "user_display": item.get("user_display") or item.get("user_name") or "",
                    "credit_used": float(item.get("credit_used") or 0),
                    "prompt": prompt,
                    "detail": detail,
                    "event_type": event_type,
                    "action_raw": action,
                    "status": str(item.get("status") or ""),
                    "action": action,
                    "provider": item.get("provider") or "",
                    "task_id": task_id,
                    "model_id": item.get("model_id") or "",
                    "model_label": item.get("model_label") or "",
                    "cost_unit": item.get("cost_unit") or "",
                    "source": "task",
                }
            )
        result.sort(key=lambda item: str(item.get("created_at") or item.get("timestamp") or ""), reverse=True)
        return result[: int(limit)]

    @router.get("/api/library")
    async def library(request: Request):
        user = require_user(request)
        conn = db.get_conn()
        # Schema-compatible SQL (works for both old DB without new columns and new DB with standard columns).
        cols = set()
        try:
            info_rows = conn.execute("PRAGMA table_info(tasks)").fetchall()
            cols = {str(r[1]) for r in info_rows}
        except Exception:
            cols = set()

        has_product_code = "product_code" in cols
        has_media_type = "media_type" in cols
        has_staff_id = "staff_id" in cols
        has_session_id = "session_id" in cols

        media_type_expr = (
            "COALESCE(NULLIF(t.media_type, ''), CASE "
            "WHEN lower(COALESCE(t.task_type, '')) IN ('image','image_edit') OR lower(COALESCE(t.gen_mode, ''))='image_edit' THEN 'image' "
            "WHEN lower(COALESCE(t.task_type, '')) IN ('audio','music','sound') OR lower(COALESCE(t.gen_mode, '')) IN ('audio','txt2audio','speech') THEN 'audio' "
            "ELSE 'video' END)"
            if has_media_type
            else "CASE "
                 "WHEN lower(COALESCE(t.task_type, '')) IN ('image','image_edit') OR lower(COALESCE(t.gen_mode, ''))='image_edit' THEN 'image' "
                 "WHEN lower(COALESCE(t.task_type, '')) IN ('audio','music','sound') OR lower(COALESCE(t.gen_mode, '')) IN ('audio','txt2audio','speech') THEN 'audio' "
                 "ELSE 'video' END"
        )
        product_code_expr = "COALESCE(NULLIF(t.product_code, ''), wt.title, '')" if has_product_code else "COALESCE(wt.title, '')"
        staff_id_expr = "COALESCE(NULLIF(t.staff_id, ''), t.user_name, wt.user_name, '')" if has_staff_id else "COALESCE(t.user_name, wt.user_name, '')"
        session_id_expr = "COALESCE(NULLIF(t.session_id, ''), t.work_task_id, '')" if has_session_id else "COALESCE(t.work_task_id, '')"

        where = """
            COALESCE(t.task_id, '') NOT LIKE 'bench_%%'
            AND COALESCE(t.user_name, '') NOT LIKE 'bench_%%'
            AND COALESCE(t.user_display, '') NOT LIKE 'Bench %%'
            AND (
                COALESCE(t.task_type, '') IN ('video','image','image_edit','audio')
                OR COALESCE(t.gen_mode, '') IN ('img2vid','frames','txt2vid','image_edit','audio','txt2audio','speech')
                OR COALESCE(t.result_url, '') <> ''
            )
        """
        select_sql = f"""
            SELECT
                t.*,
                {product_code_expr} AS product_code,
                {media_type_expr} AS media_type,
                {staff_id_expr} AS staff_id,
                {session_id_expr} AS session_id,
                (
                    SELECT q.status
                    FROM qc_queue q
                    WHERE q.task_id = t.task_id
                    ORDER BY q.submitted_at DESC
                    LIMIT 1
                ) AS qc_status,
                (
                    SELECT COALESCE(NULLIF(q.reject_reason, ''), NULLIF(q.note, ''))
                    FROM qc_queue q
                    WHERE q.task_id = t.task_id
                    ORDER BY q.submitted_at DESC
                    LIMIT 1
                ) AS qc_note,
                (
                    SELECT q.reviewer
                    FROM qc_queue q
                    WHERE q.task_id = t.task_id
                    ORDER BY q.submitted_at DESC
                    LIMIT 1
                ) AS qc_reviewer,
                (
                    SELECT q.submitted_at
                    FROM qc_queue q
                    WHERE q.task_id = t.task_id
                    ORDER BY q.submitted_at DESC
                    LIMIT 1
                ) AS qc_submitted_at,
                (
                    SELECT q.reviewed_at
                    FROM qc_queue q
                    WHERE q.task_id = t.task_id
                    ORDER BY q.submitted_at DESC
                    LIMIT 1
                ) AS qc_reviewed_at
            FROM tasks t
            LEFT JOIN work_tasks wt ON wt.id = t.work_task_id
            WHERE {where}
        """
        if user_has_permission(user, "view_all_history"):
            rows = conn.execute(f"{select_sql} ORDER BY t.id DESC LIMIT 200").fetchall()
        else:
            rows = conn.execute(
                f"{select_sql} AND t.user_name=? ORDER BY t.id DESC LIMIT 200",
                (user["username"],),
            ).fetchall()
        conn.close()
        return [dict(row) for row in rows]

    return router
