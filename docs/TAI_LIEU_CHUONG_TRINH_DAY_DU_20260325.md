# Tài Liệu Chương Trình VideoTool (Chi Tiết)

Cập nhật: 2026-03-25  
Phạm vi: mã nguồn hiện có tại `H:\F-Aistudio-v1.6\VideoTool`

---

## 1. Mục tiêu hệ thống

VideoTool là hệ thống desktop + backend để:
- Tạo video từ ảnh (single, batch, recover, stop task)
- Chỉnh sửa ảnh bằng AI
- Quản lý thư viện output
- Quản lý QC (submit/approve/reject)
- Quản lý work-task theo ca làm việc
- Theo dõi credit/provider
- Có AI Agent chat + analyze media trong ứng dụng

Hệ thống ưu tiên mode `standalone` (chạy nội bộ trên một máy), đồng thời có đường nâng cấp lên mô hình client-server.

---

## 2. Kiến trúc tổng thể

## 2.1 Thành phần chính
- GUI Desktop: `gui/app.py`, `gui/main_window.py`, `gui/login_window.py`
- Backend API: `backend/main.py` + `backend/routes/*.py`
- Dữ liệu runtime: `data/`, `logs/`, `.env`
- DB: SQLite local mặc định (`data/data.db`) hoặc PostgreSQL nếu có `DATABASE_URL`
- Tích hợp provider:
  - KIE (chat, image, video, credits)
  - PiAPI (provider2)
- Telegram bot cho approve login/QC/report

## 2.2 Luồng chạy chuẩn
1. Launcher staff mở backend FastAPI.
2. GUI kết nối backend qua HTTP.
3. Người dùng login theo role + cơ chế duyệt.
4. GUI gọi API để tạo task/video/image/chat.
5. Backend lưu task/history/memory vào DB + log activity.

---

## 3. Cấu trúc thư mục quan trọng

- `backend/`: API, DB, provider integration
- `backend/routes/`: toàn bộ route theo domain
- `gui/`: toàn bộ desktop UI
- `data/`: DB, key files, billing/activity snapshots
- `logs/`: backend/crash logs
- `scripts/`: đóng gói/chạy test/release scripts
- `tools/`: doctor/smoke scripts
- `docs/`: tài liệu kỹ thuật và vận hành

---

## 4. Runtime, cấu hình, môi trường

## 4.1 File cấu hình
- `.env` (runtime thực tế)
- `.env.example` (mẫu)
- `.env.production.example` (mẫu production)

## 4.2 Biến môi trường chính
- `SECRET_KEY`: ký token
- `LOG_LEVEL`: mức log backend
- `DATABASE_URL` hoặc `SUPABASE_DB_URL`: bật PostgreSQL
- `API_KEY`, `API_KEYS`, `KIE_API_KEY`, `KIE_API_KEYS`: key KIE
- `PIAPI_KEY`: key provider2
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, các topic id: tích hợp Telegram

## 4.3 Runtime paths
Được chuẩn hóa trong `backend/runtime_paths.py`:
- `.env`, DB local, api key file, billing history, activity logs, user passwords, role config, camera moves.

---

## 5. Cơ chế xác thực và phân quyền

## 5.1 Role
- `staff`
- `qc_manager`
- `admin`

## 5.2 Permission
Quyền hiệu lực được tổng hợp từ:
- `backend/main.py` (map role -> permission runtime)
- `backend/routes/auth_routes.py` (normalize role, user_has_permission)
- `backend/roles_config.json` (tham chiếu cấu hình)

## 5.3 Login flow
- Staff có thể bị đưa vào `pending_logins` và chờ duyệt.
- QC/Admin có thể bypass một số bước duyệt tùy permission.
- Token cache in-memory trong backend (`_tokens`) với re-check DB định kỳ.

---

## 6. Cơ sở dữ liệu

Khởi tạo trong `backend/database.py` (hàm `init_db()`).

## 6.1 Bảng cốt lõi
- `users`
- `tasks`
- `pending_logins`
- `qc_queue`
- `notifications`
- `shift_reports`
- `work_tasks`
- `presets`
- `activity_logs`
- `ai_chat_history`
- `ai_chat_memories`
- `ai_chat_analysis_records`

## 6.2 Chuẩn hóa tracking sản phẩm
Bảng `tasks` đã có các trường thống kê chuẩn:
- `product_code`
- `media_type`
- `staff_id`
- `session_id`

Các trường này là nền để dashboard/library không cần suy luận mơ hồ từ prompt/url.

---

## 7. Bản đồ API (theo mã nguồn route)

## 7.1 Auth
File: `backend/routes/auth_routes.py`
- `GET /api/auth/debug-version`
- `POST /api/auth/login`
- `GET /api/auth/poll/{login_id}`
- `POST /api/auth/register`
- `GET /api/auth/me`
- `GET /api/auth/users`
- `GET /api/auth/pending`
- `POST /api/auth/approve/{login_id}`
- `POST /api/auth/reject/{login_id}`
- `GET /api/auth/tg-approve/{login_id}`
- `GET /api/auth/tg-reject/{login_id}`

## 7.2 System/Settings
File: `backend/routes/system_routes.py`
- `POST /api/system/heartbeat`
- `GET /api/system/status`
- `POST /api/admin/announce`
- `GET /api/admin/settings`
- `GET/POST /api/admin/settings/login-2fa`
- `GET/POST /api/admin/settings/telegram-outbound`
- `GET/POST /api/admin/settings/chat-send-shortcut`
- `GET /api/system/settings/chat-send-shortcut`
- `GET/POST /api/admin/settings/telegram_outbound`
- `GET/POST /api/system/telegram-outbound`

## 7.3 Credits/Provider
Files: `credits_routes.py`, `provider_routes.py`
- Credits:
  - `GET /api/credits/balance`
  - `GET /api/credits/refresh`
  - `GET /api/credits/keys`
  - `POST /api/credits/keys/add`
  - `DELETE /api/credits/keys/{idx}`
  - `POST /api/credits/keys/set-active`
  - `GET /api/credits/stats`
- Providers:
  - `GET /api/providers`
  - `GET /api/providers/{provider_id}/credits`
  - `GET /api/providers/{provider_id}/models`
  - `POST /api/providers/provider2/keys/set`
  - `GET /api/providers/provider2/keys`
  - `GET /api/providers/runtime-keys/status`

## 7.4 Video
Files: `video_routes.py`, `video_utility_routes.py`
- `POST /api/video/upload`
- `POST /api/video/create`
- `GET /api/video/poll/{task_id}`
- `POST /api/video/recover`
- `POST /api/video/batch`
- `GET /api/video/batch-status/{batch_id}`
- `GET /api/video/download-zip/{batch_id}`
- `POST /api/video/recover-stuck`
- `GET /api/video/camera-moves`
- `GET /api/video/active-tasks`
- `POST /api/video/stop/{task_id}`

## 7.5 Image
Files: `image_routes.py`, `image_light_routes.py`
- `POST /api/image/edit`
- `POST /api/image/analyze`
- `GET /api/image/presets`
- `POST /api/image/presets/create`
- `GET /api/image/poll/{task_id}`
- `GET /api/image/tasks`
- `POST /api/image/recover`

## 7.6 History/Library
File: `history_routes.py`
- `GET /api/history`
- `GET /api/library`

## 7.7 QC
File: `qc_routes.py`
- `POST /api/qc/submit`
- `GET /api/qc/queue`
- `POST /api/qc/approve/{qc_id}`
- `POST /api/qc/reject/{qc_id}`
- `GET /api/qc/status/{task_id}`

## 7.8 Reports
File: `reports_routes.py`
- `POST /api/reports/shift`
- `GET /api/reports/shifts`
- `GET /api/reports/my-stats`
- `GET /api/reports/daily-summary`
- `GET /api/reports/weekly-summary`
- `GET /api/reports/monthly-summary`
- `POST /api/reports/batch-task-notify`
- `POST /api/reports/excel-analysis`

## 7.9 Notifications
File: `notifications_routes.py`
- `GET /api/notifications`
- `POST /api/notifications/read/{nid}`
- `POST /api/notifications/read-all`

## 7.10 Work tasks
File: `work_tasks_routes.py`
- `POST /api/work-tasks/create`
- `POST /api/work-tasks/close/{wid}`
- `GET /api/work-tasks`
- `GET /api/work-tasks/active`
- `GET /api/work-tasks/{user_name}/stats`

## 7.11 AI Agent
File: `chat_routes.py`
- `GET /api/chat/models`
- `GET /api/chat/history`
- `GET /api/chat/history-list`
- `POST /api/chat/history`
- `DELETE /api/chat/history`
- `GET /api/chat/memory`
- `POST /api/chat/memory`
- `POST /api/chat/memory/rebuild`
- `POST /api/chat/analysis-record`
- `POST /api/chat/agent`
- `POST /api/chat/analyze`

---

## 8. AI Agent: thiết kế hiện tại

## 8.1 Mô hình
- GUI AI tab nằm trong `gui/main_window.py`.
- Chat stream đi qua backend endpoint `/api/chat/agent` với `stream=true`.
- History/memory lưu DB:
  - `ai_chat_history`
  - `ai_chat_memories`
  - `ai_chat_analysis_records`

## 8.2 Model routing ở backend
File: `backend/kie_client.py`
- `gpt-5-4` -> `POST /codex/v1/responses` (KIE Responses API)
- `gemini-*` -> endpoint chat completion theo model id

## 8.3 Chuẩn payload GPT-5.4
- `system` -> `instructions`
- hội thoại còn lại -> `input` structured array (`input_text`, `input_image`)

## 8.4 Stream handling
Backend route chat:
- parse SSE event từ upstream
- map delta về format `choices[0].delta.content`
- map final `response.completed/response.done` về `choices[0].message.content` để GUI luôn có câu trả lời cuối

GUI:
- hiển thị bubble assistant streaming
- state text: thinking/typing
- chặn save/reload history gây ghi đè khi đang stream

---

## 9. Dashboard, thống kê và logic nghiệp vụ

## 9.1 Dashboard tháng và summary cards
Hướng hiện tại:
- tách chỉ số rõ:
  - Video tạo được
  - Ảnh tạo được
  - Video đã trừ
  - Ảnh đã trừ
- thống kê phải bám cùng một nguồn dữ liệu với library để tránh lệch số.

## 9.2 Cơ chế phân loại staff/session/product
Định hướng đã triển khai:
- gắn `product_code`, `media_type`, `staff_id`, `session_id` từ backend/DB.
- QC xem toàn bộ; staff xem theo scope user/session phù hợp quyền.

## 9.3 Recover và credit
Các ca cần tách bạch trong báo cáo:
- recover click count
- recover success/fail
- credit đã trừ theo kết quả provider trả về
- task fail nhưng đã trừ credit (provider-side charge) là tình huống hợp lệ cần phản ánh riêng

---

## 10. GUI: module và trách nhiệm

## 10.1 File chính
- `gui/app.py`: vòng đời app, event filter/debug
- `gui/login_window.py`: login/pending UI
- `gui/main_window.py`: toàn bộ workspace chính
- `gui/settings_dialog.py`: cấu hình runtime
- `gui/api_client.py`: HTTP client cho toàn bộ API
- `gui/theme.py`: palette/style constants

## 10.2 Các khu chức năng trong MainWindow
- Creator tabs: Video, Batch, Library, Image Editor, AI Agent, Hướng dẫn
- Output panel: card chạy task realtime
- History panel: lịch sử thao tác
- QC Manager layout + dashboard

---

## 11. Đóng gói và phát hành

## 11.1 Script đóng gói test
File: `scripts/package_test_release.ps1`
- tạo `dist/VideoTool_Test_<timestamp>/`
- copy runtime cần thiết (`.venv`, `backend`, `gui`, `data`, `logs`, ...)
- loại bỏ `__pycache__`, `backups`, `dist` lồng
- loại file tạm (`*.pyc`, `*.tmp`, `*.log`)
- sinh `README_TEST_NHANH.txt`
- nén zip `dist/VideoTool_Test_<timestamp>.zip`

## 11.2 Đầu ra gần nhất (đã tạo)
- thư mục: `dist/VideoTool_Test_20260324_205801`
- zip: `dist/VideoTool_Test_20260324_205801.zip`

## 11.3 Quickstart máy mới
Tham khảo thêm: `docs/STANDALONE_QUICKSTART.md`

---

## 12. Logging, quan sát và debug

## 12.1 Log files
- `logs/backend.log`
- `logs/crash.log`
- activity logs từ `activity_logger.py`

## 12.2 Nhóm lỗi thường gặp
- HTTP 402/403 từ provider
- stream SSE không về delta/final
- mismatch endpoint model/provider
- reload UI làm mất trạng thái task/chat
- sai encoding text tiếng Việt ở một số màn hình cũ

## 12.3 Chiến lược debug chuẩn
1. Kiểm tra route backend đang hit.
2. Đối chiếu payload gửi provider.
3. So event stream nhận được (`delta` vs `completed`).
4. So DB record có lưu đúng không.
5. So UI state machine có bị reload/overwrite không.

---

## 13. Checklist vận hành ngắn

Trước khi cho test team:
1. Start backend + GUI sạch.
2. Kiểm tra login theo 3 role.
3. Chạy 1 video create + poll + library.
4. Chạy 1 image edit + library.
5. Chạy AI chat stream và xác nhận có final message.
6. Kiểm tra dashboard số liệu khớp library.
7. Chạy đóng gói và test mở trên máy khác.

---

## 14. Rủi ro kỹ thuật còn tồn tại

- Chưa có endpoint cancel upstream rõ ràng cho chat stream ở provider KIE (mức hiện tại là stop phía client/backend stream reader).
- Khả năng lệch số liệu nếu chưa chuẩn hóa hoàn toàn nguồn dữ liệu dashboard/library theo cùng khóa nghiệp vụ.
- Một số tài liệu cũ bị lỗi encoding, cần chuẩn hóa UTF-8 toàn bộ để tránh sai nghĩa.

---

## 15. Danh mục tài liệu liên quan

- `docs/DOC_KY_THUAT.md`
- `docs/STANDALONE_QUICKSTART.md`
- `docs/standalone_execution_checklist.md`
- `docs/PRODUCTION_MULTI_USER_CHECKLIST.md`
- `docs/TOOL_FLOW_AUDIT.md`
- `HUONG_DAN_SU_DUNG.md`

---

## 16. Ghi chú cập nhật tài liệu này

Tài liệu này được tổng hợp trực tiếp từ:
- cấu trúc mã nguồn hiện tại,
- route map thực tế trong `backend/routes/*.py`,
- schema trong `backend/database.py`,
- runtime trong `backend/main.py`,
- script đóng gói trong `scripts/package_test_release.ps1`,
- các tài liệu vận hành có sẵn trong `docs/`.

Nếu thay đổi endpoint/schema/flow UI, cập nhật file này cùng phiên commit để giữ đồng bộ.
