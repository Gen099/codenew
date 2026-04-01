"""Unified activity/event logger used by GUI, monitor and reports."""
import datetime
import os
import sys
from typing import Optional


EVENT_GROUPS = {
    "login": "Dang nhap",
    "logout": "Dang nhap",
    "login_approve": "Dang nhap",
    "login_reject": "Dang nhap",
    "task_start": "Task/Ca",
    "task_close": "Task/Ca",
    "shift_report": "Task/Ca",
    "video_start": "Video",
    "video_done": "Video",
    "video_fail": "Video",
    "video_stop": "Video",
    "video_recover": "Video",
    "image_start": "Image",
    "image_done": "Image",
    "image_fail": "Image",
    "image_recover": "Image",
    "image_analyze": "Image",
    "batch_source_load": "Batch",
    "batch_source_clear": "Batch",
    "batch_source_assign": "Batch",
    "batch_video_start": "Batch",
    "batch_video_done": "Batch",
    "batch_video_fail": "Batch",
    "batch_video_stop": "Batch",
    "batch_image_select": "Batch",
    "batch_image_item": "Batch",
    "batch_image_done": "Batch",
    "batch_image_fail": "Batch",
    "qc_submit": "QC",
    "qc_approve": "QC",
    "qc_reject": "QC",
    "ai_chat": "AI Agent",
    "ai_analyze": "AI Agent",
    "excel_analysis": "Bao cao",
    "excel_export": "Bao cao",
    "api_http": "He thong",
    "telegram_send": "He thong",
    "telegram_callback": "He thong",
    "telegram_edit": "He thong",
    "login_pending": "Dang nhap",
    "monitor_key_add": "Quan tri",
    "monitor_key_delete": "Quan tri",
    "monitor_credit_check": "Quan tri",
    "monitor_keys_save": "Quan tri",
    "monitor_keys_export": "Quan tri",
    "monitor_runtime_key_check": "Quan tri",
    "monitor_user_add": "Quan tri",
    "monitor_user_delete": "Quan tri",
    "monitor_user_role_change": "Quan tri",
    "monitor_user_password_reset": "Quan tri",
    "monitor_logs_export": "Quan tri",
    "monitor_logs_clear": "Quan tri",
    "monitor_logs_push": "Quan tri",
    "system": "He thong",
}


EVENT_LABELS = {
    "login": "Dang nhap",
    "logout": "Dang xuat",
    "login_approve": "Duyet dang nhap",
    "login_reject": "Tu choi dang nhap",
    "task_start": "Bat dau task",
    "task_close": "Ket thuc task",
    "shift_report": "Bao cao ca",
    "video_start": "Video bat dau",
    "video_done": "Video hoan thanh",
    "video_fail": "Video that bai",
    "video_stop": "Video dung",
    "video_recover": "Video recover",
    "image_start": "Anh bat dau",
    "image_done": "Anh hoan thanh",
    "image_fail": "Anh that bai",
    "image_recover": "Anh recover",
    "image_analyze": "Phan tich anh",
    "batch_source_load": "Batch tai nguon",
    "batch_source_clear": "Batch xoa nguon",
    "batch_source_assign": "Batch gan nguon",
    "batch_video_start": "Batch video bat dau",
    "batch_video_done": "Batch video hoan thanh",
    "batch_video_fail": "Batch video that bai",
    "batch_video_stop": "Batch video dung",
    "batch_image_select": "Batch anh chon nguon",
    "batch_image_item": "Batch anh item",
    "batch_image_done": "Batch anh hoan thanh",
    "batch_image_fail": "Batch anh that bai",
    "qc_submit": "Gui QC",
    "qc_approve": "Duyet QC",
    "qc_reject": "Tu choi QC",
    "ai_chat": "AI hội thoại",
    "ai_analyze": "AI phân tích",
    "excel_analysis": "Phân tích Excel",
    "excel_export": "Xuất Excel",
    "api_http": "API",
    "telegram_send": "Gửi Telegram",
    "telegram_callback": "Telegram phản hồi",
    "telegram_edit": "Sửa Telegram",
    "login_pending": "Cho duyet dang nhap",
    "monitor_key_add": "Thêm API key",
    "monitor_key_delete": "Xóa API key",
    "monitor_credit_check": "Kiểm tra số dư",
    "monitor_keys_save": "Lưu API key",
    "monitor_keys_export": "Xuất API key",
    "monitor_runtime_key_check": "Đối soát key runtime",
    "monitor_user_add": "Thêm người dùng",
    "monitor_user_delete": "Xóa người dùng",
    "monitor_user_role_change": "Đổi vai trò",
    "monitor_user_password_reset": "Đặt lại mật khẩu",
    "monitor_logs_export": "Xuất logs",
    "monitor_logs_clear": "Xóa logs",
    "monitor_logs_push": "Push logs",
    "system": "He thong",
}


def normalize_event(action: str, detail: str = "") -> str:
    text = f"{action or ''} {detail or ''}".strip().lower()
    # Order is strict: specific -> generic to avoid misclassification.
    if any(k in text for k in ("login pending", "cho admin phe duyet", "pending login")):
        return "login_pending"
    if any(k in text for k in ("login approve", "duyet dang nhap", "phe duyet dang nhap")):
        return "login_approve"
    if any(k in text for k in ("login reject", "chan dang nhap", "tu choi dang nhap")):
        return "login_reject"
    if any(k in text for k in ("logout", "dang xuat", "thoat app", "switch account", "chuyen tk")):
        return "logout"
    if any(k in text for k in ("shift report", "bao cao ca", "ket ca")):
        return "shift_report"
    if any(k in text for k in ("task close", "ket thuc task", "dong task")):
        return "task_close"
    if any(k in text for k in ("task start", "tao task", "work task")):
        return "task_start"
    if any(k in text for k in ("qc reject", "qc_reject", "tu choi qc", "reject qc")):
        return "qc_reject"
    if any(k in text for k in ("qc approve", "qc_approve", "duyet qc", "phe duyet qc", "approved qc")):
        return "qc_approve"
    if any(k in text for k in ("qc submit", "gui qc", "send qc")):
        return "qc_submit"
    if any(k in text for k in ("image analyze", "analyze image", "phan tich anh")):
        return "image_analyze"
    if any(k in text for k in ("batch source load",)):
        return "batch_source_load"
    if any(k in text for k in ("batch source clear",)):
        return "batch_source_clear"
    if any(k in text for k in ("batch source assign",)):
        return "batch_source_assign"
    if any(k in text for k in ("batch video start",)):
        return "batch_video_start"
    if any(k in text for k in ("batch video error", "batch video fail")):
        return "batch_video_fail"
    if any(k in text for k in ("batch video done", "batch row done")):
        return "batch_video_done"
    if any(k in text for k in ("batch stop", "batch video stop")):
        return "batch_video_stop"
    if any(k in text for k in ("batch image select",)):
        return "batch_image_select"
    if any(k in text for k in ("batch image item",)):
        return "batch_image_item"
    if any(k in text for k in ("batch image done", "batch image complete")):
        return "batch_image_done"
    if any(k in text for k in ("batch image error", "batch image fail")):
        return "batch_image_fail"
    if any(k in text for k in ("ai chat", "chat agent", "ai hội thoại")):
        return "ai_chat"
    if any(k in text for k in ("ai analyze", "chat analyze", "ai phân tích")):
        return "ai_analyze"
    if any(k in text for k in ("excel analysis", "phan tich workbook", "phan tich excel")):
        return "excel_analysis"
    if any(k in text for k in ("excel export", "xuat excel")):
        return "excel_export"
    if any(k in text for k in ("telegram callback", "callback telegram")):
        return "telegram_callback"
    if any(k in text for k in ("telegram send", "gui telegram", "send telegram")):
        return "telegram_send"
    if any(k in text for k in ("telegram edit", "edit telegram")):
        return "telegram_edit"
    if any(k in text for k in ("monitor key add",)):
        return "monitor_key_add"
    if any(k in text for k in ("monitor key delete",)):
        return "monitor_key_delete"
    if any(k in text for k in ("monitor credit check",)):
        return "monitor_credit_check"
    if any(k in text for k in ("monitor keys save",)):
        return "monitor_keys_save"
    if any(k in text for k in ("monitor keys export",)):
        return "monitor_keys_export"
    if any(k in text for k in ("monitor runtime key check",)):
        return "monitor_runtime_key_check"
    if any(k in text for k in ("monitor user add",)):
        return "monitor_user_add"
    if any(k in text for k in ("monitor user delete",)):
        return "monitor_user_delete"
    if any(k in text for k in ("monitor user role change",)):
        return "monitor_user_role_change"
    if any(k in text for k in ("monitor user password reset",)):
        return "monitor_user_password_reset"
    if any(k in text for k in ("monitor logs export",)):
        return "monitor_logs_export"
    if any(k in text for k in ("monitor logs clear",)):
        return "monitor_logs_clear"
    if any(k in text for k in ("monitor logs push",)):
        return "monitor_logs_push"
    if any(k in text for k in ("api http", "api request", "api response")):
        return "api_http"
    if any(k in text for k in ("anh that bai", "image fail", "batch img error", "image error")):
        return "image_fail"
    if any(k in text for k in ("anh hoan thanh", "image done", "batch image complete")):
        return "image_done"
    if any(k in text for k in ("image recover", "recover anh", "khoi phuc anh")):
        return "image_recover"
    if any(k in text for k in ("anh bat dau", "image edit", "batch image", "analyze image")):
        return "image_start"
    if any(k in text for k in ("video that bai", "video fail", "video error")):
        return "video_fail"
    if any(k in text for k in ("video dung", "video stop", "stop video")):
        return "video_stop"
    if any(k in text for k in ("video recover", "recover video", "khoi phuc video")):
        return "video_recover"
    if any(k in text for k in ("video done", "video complete", "video hoan thanh")):
        return "video_done"
    if any(k in text for k in ("video bat dau", "create video", "tao video", "img2vid", "frames", "batch video")):
        return "video_start"
    if any(k in text for k in ("login", "dang nhap")):
        return "login"
    return "system"


def event_group(action: str, detail: str = "") -> str:
    return EVENT_GROUPS.get(normalize_event(action, detail), "He thong")


def event_label(action: str, detail: str = "") -> str:
    event_type = normalize_event(action, detail)
    return EVENT_LABELS.get(event_type, action or "System")


def _database_modules():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    base_dir = os.path.dirname(script_dir)
    backend_dir = os.path.join(base_dir, "backend")
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)
    import runtime_paths  # type: ignore
    import database  # type: ignore
    return base_dir, runtime_paths, database


def log_event(
    user: str,
    event_type: str,
    detail: str = "",
    credits: float = 0,
    provider: str = "",
    raw_action: Optional[str] = None,
):
    base_dir, runtime_paths, database = _database_modules()
    runtime_paths.ensure_runtime_dirs()
    conn = database.get_conn()
    try:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS activity_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT,
                user_name TEXT,
                action TEXT,
                detail TEXT DEFAULT '',
                credits REAL DEFAULT 0,
                provider TEXT DEFAULT ''
            )"""
        )
        conn.commit()
    except Exception:
        pass

    action_text = EVENT_LABELS.get(event_type, raw_action or event_type or "System")
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn.execute(
        "INSERT INTO activity_logs (timestamp, user_name, action, detail, credits, provider) VALUES (?, ?, ?, ?, ?, ?)",
        (ts, user, action_text, detail, float(credits), provider or event_type),
    )
    conn.commit()
    conn.close()


def log_activity(user: str, action: str, detail: str = "", credits: float = 0, provider: str = ""):
    try:
        event_type = normalize_event(action, detail)
        log_event(user, event_type, detail, credits, provider, raw_action=action)
    except Exception as e:
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        log_dir = os.path.join(base_dir, "logs")
        os.makedirs(log_dir, exist_ok=True)
        fallback_path = os.path.join(log_dir, "activity_fallback.log")
        with open(fallback_path, "a", encoding="utf-8") as f:
            f.write(
                f"[{datetime.datetime.now():%Y-%m-%d %H:%M:%S}] "
                f"user={user} action={action} detail={detail!r} "
                f"credits={credits} provider={provider} error={e}\n"
            )
