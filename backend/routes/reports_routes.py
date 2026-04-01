"""Shift-report routes."""
import datetime as dt

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel

from activity_logger import log_activity
import excel_analysis_service as excel_service
from .auth_routes import user_has_permission


class ShiftReportReq(BaseModel):
    notes: str = ""


class BatchNotifyReq(BaseModel):
    text: str = ""


def create_reports_router(require_user, require_admin, db, tg, asyncio_mod, aggregate_report, kie_module):
    router = APIRouter()

    def _runtime_snapshot():
        now = dt.datetime.now()
        day_start = dt.datetime.combine(now.date(), dt.time.min).timestamp()
        day_end = dt.datetime.combine(now.date(), dt.time.max).timestamp()
        monday = now - dt.timedelta(days=now.weekday())
        week_start = dt.datetime.combine(monday.date(), dt.time.min).timestamp()
        month_first = now.replace(day=1)
        month_start = dt.datetime.combine(month_first.date(), dt.time.min).timestamp()

        def _summary(start_ts: float, end_ts: float):
            tasks = aggregate_report(start_ts, end_ts)
            return {
                "tasks": tasks,
                "count": len(tasks),
                "total_videos": sum(task.get("video_count", 0) for task in tasks),
                "total_credits": sum(task.get("credits_used", 0.0) for task in tasks),
            }

        qc_rows = []
        try:
            conn = db.get_conn()
            qc_rows = [dict(r) for r in conn.execute(
                "SELECT * FROM qc_queue ORDER BY submitted_at DESC LIMIT 100"
            ).fetchall()]
            conn.close()
        except Exception:
            qc_rows = []

        return {
            "daily": _summary(day_start, day_end),
            "weekly": _summary(week_start, now.timestamp()),
            "monthly": _summary(month_start, now.timestamp()),
            "work_tasks": db.get_work_tasks(limit=200),
            "shifts": db.get_shift_reports(limit=100),
            "qc_queue": qc_rows,
        }

    @router.post("/api/reports/shift")
    async def submit_shift_report(req: ShiftReportReq, request: Request):
        user = require_user(request)
        summary = db.get_shift_report_summary(user["username"])
        stats = dict(summary.get("summary") or {})
        data = {
            "user_id": user["user_id"],
            "user_name": user["username"],
            "user_display": user["display_name"],
            "total_tasks": stats.get("total_tasks", 0),
            "total_credits": stats.get("total_credits", 0),
            "notes": req.notes,
        }
        db.save_shift_report(data)
        db.notify_admins(
            "shift_report",
            f"Bao cao ca - {user['display_name']}",
            f"Tasks: {stats.get('total_tasks', 0)} | Credits: {float(stats.get('total_credits', 0) or 0):.0f} | Phien: {int(stats.get('work_task_count', 0) or 0)}\n{req.notes}",
        )
        if user.get("role") == "staff":
            summary["shift"]["notes"] = req.notes
            asyncio_mod.ensure_future(tg.send_staff_shift_summary(summary))
        log_activity(user["display_name"], "Shift Report", req.notes, float(stats.get("total_credits", 0) or 0), "shift_report")
        return {"ok": True, **stats}

    @router.get("/api/reports/shifts")
    async def list_shift_reports(request: Request):
        user = require_user(request)
        if not user_has_permission(user, "view_dashboard"):
            require_admin(request)
        return db.get_shift_reports()

    @router.get("/api/reports/my-stats")
    async def my_stats(request: Request):
        user = require_user(request)
        summary = db.get_shift_report_summary(user["username"])
        return dict(summary.get("summary") or {})

    @router.get("/api/reports/shift-current")
    async def current_shift_summary(request: Request, user_name: str = Query(default="")):
        user = require_user(request)
        requested_user = str(user_name or "").strip()
        if requested_user and requested_user != user["username"] and not user_has_permission(user, "view_all_history"):
            raise HTTPException(403, "Not allowed")
        return db.get_shift_report_summary(requested_user or user["username"])

    @router.get("/api/reports/daily-summary")
    async def daily_summary(request: Request):
        user = require_user(request)
        if not user_has_permission(user, "view_dashboard"):
            require_admin(request)
        now = dt.datetime.now()
        start = dt.datetime.combine(now.date(), dt.time.min).timestamp()
        end = dt.datetime.combine(now.date(), dt.time.max).timestamp()
        tasks = aggregate_report(start, end)
        return {
            "tasks": tasks,
            "count": len(tasks),
            "total_videos": sum(task.get("video_count", 0) for task in tasks),
            "total_credits": sum(task.get("credits_used", 0.0) for task in tasks),
        }

    @router.get("/api/reports/weekly-summary")
    async def weekly_summary(request: Request):
        user = require_user(request)
        if not user_has_permission(user, "view_dashboard"):
            require_admin(request)
        now = dt.datetime.now()
        monday = now - dt.timedelta(days=now.weekday())
        start = dt.datetime.combine(monday.date(), dt.time.min).timestamp()
        end = now.timestamp()
        tasks = aggregate_report(start, end)
        return {
            "tasks": tasks,
            "count": len(tasks),
            "total_videos": sum(task.get("video_count", 0) for task in tasks),
            "total_credits": sum(task.get("credits_used", 0.0) for task in tasks),
        }

    @router.get("/api/reports/monthly-summary")
    async def monthly_summary(request: Request):
        user = require_user(request)
        if not user_has_permission(user, "view_dashboard"):
            require_admin(request)
        now = dt.datetime.now()
        first = now.replace(day=1)
        start = dt.datetime.combine(first.date(), dt.time.min).timestamp()
        end = now.timestamp()
        tasks = aggregate_report(start, end)
        return {
            "tasks": tasks,
            "count": len(tasks),
            "total_videos": sum(task.get("video_count", 0) for task in tasks),
            "total_credits": sum(task.get("credits_used", 0.0) for task in tasks),
        }

    @router.post("/api/reports/batch-task-notify")
    async def batch_task_notify(req: BatchNotifyReq, request: Request):
        require_user(request)
        if req.text and tg.is_configured():
            asyncio_mod.ensure_future(tg.send_to_report_topic(req.text))
        return {"ok": True}

    @router.post("/api/reports/excel-analysis")
    async def excel_analysis(
        request: Request,
        file: UploadFile = File(...),
        sheet_name: str = Form(""),
    ):
        user = require_user(request)
        if not user_has_permission(user, "view_dashboard"):
            require_admin(request)
        if not file or not file.filename:
            raise HTTPException(status_code=400, detail="Workbook file is required")
        file_name = str(file.filename)
        if not file_name.lower().endswith((".xlsx", ".xlsm", ".xltx", ".xltm")):
            raise HTTPException(status_code=400, detail="Only Excel workbook files are supported")
        payload = await file.read()
        if not payload:
            raise HTTPException(status_code=400, detail="Workbook is empty")
        analysis = await excel_service.analyze_workbook(
            payload,
            file_name,
            _runtime_snapshot(),
            kie_module,
            preferred_sheet=sheet_name or "",
        )
        log_activity(
            user["display_name"],
            "Excel Analysis",
            f"{file_name} | {analysis.get('active_sheet') or '-'}",
            0,
            "dashboard",
        )
        return {"ok": True, **analysis}

    return router
