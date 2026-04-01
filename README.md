# VideoTool – AI Video/Image Production Platform

> Prototype web app for small team video/image production management with dark mode UI.

## 🎯 Project Goals
- Replace desktop-only PyQt6 app with lightweight browser-based SPA
- Support multi-user workflows (Staff, QC Manager, Admin)
- Batch-first production pipeline for AI video creation

## ✅ Completed Features

### 1. Creator Workspace (Main Screen)
**3-Panel Layout: Image Source | Task Combos | Output/Library**

- **Left Panel – Image Source:**
  - Upload images/folders via drag-drop or file picker
  - Images grouped by folder with used/unused tracking
  - Tabs: All / Unused / Used with real-time counts
  - Assign images to tasks as I2V source, First Frame, or Last Frame
  - Used images marked with role tag (I2V / 1st / Last) to prevent duplication
  - One-click unassign to free images

- **Batch Edit (collapsible section):**
  - Apply same preset/effect to all images in a folder
  - 6 presets: Product Pro, Cinematic, Artwork, Clean BG, Social, E-commerce
  - Custom prompt applied to all, model & resolution selector
  - Cost preview before running
  - Simulated batch edit with progress

- **Center Panel – Task Combo Table:**
  - Multiple Task Combos (tabs), create/rename/delete
  - Each combo = independent production pipeline
  - Task table with columns: #, Mode, Source/Frame, Duration, Ratio, Camera Move, Prompt, QC Status, Actions
  - **Video modes:** Image-to-Video (I2V) or First-Last Frame (FLF) per task row
  - Camera move presets: Pan, Zoom, Orbit, Tilt, Push, Dolly
  - Run individual tasks or "Run All"
  - Progress bars with percentage during rendering
  - QC status badges: idle, Chờ QC, Pass, Reject (with reason)
  - QC mode selector per combo: "QC từng video" or "QC gộp 1 lần"
  - Status bar: total/success/fail/running/waiting with percentage

- **Right Panel – Output & Library (collapsible):**
  - All output items (videos, edited images)
  - Filter by: type (video/image), status (approved/rejected/pending/processing)
  - Status badges with color-coded borders
  - Reject reasons displayed inline
  - Send to QC via Telegram button
  - Summary bar with counts
  - Toggle collapse/expand with persistent state

- **QC Integration:**
  - Send individual videos or batch to Telegram for QC
  - Simulated QC response: Approve/Reject with random reason
  - Reject reasons displayed inline on task rows and library items
  - Auto-send QC when combo QC mode = "individual"

- **AI Chat (floating panel):**
  - AI Assistant for prompt suggestions and workflow tips
  - 5 contextual AI responses

### 2. Admin Dashboard
- 4 KPI cards: Videos created, Images processed, QC Pass Rate, Credits
- 7-day bar chart (Chart.js) for video/image output
- Doughnut chart for credit allocation by category
- Top 5 staff leaderboard with progress bars
- QC Queue Status summary
- Budget alert warning with projected depletion date

### 3. QC Manager Screen
- 4 stat cards: Waiting, Approved today, Rejected, Pass Rate
- Queue list with 6 items (selectable)
- Preview panel with product info
- Approve/Reject actions with comment field
- Telegram send button

### 4. HR & KPI Management (4 tabs)
- **Staff:** Employee table with KPI bars, credits, QC pass rates, online status
- **KPI:** Target vs actual progress bars, radar chart for 3 staff
- **Budget:** Monthly budget stats, recharge history, alert settings with toggles
- **Evaluation:** Monthly grades (A/B+/A+/B-) with comments

### 5. Library Screen
- 8 media cards in grid layout
- Filter by Code, Type, Status
- Thumbnails with status badges and credit costs

### 6. Settings Screen
- Telegram Bot configuration
- API Keys management (KIE.AI, PiAPI)
- Roles & Permissions matrix
- Auto Report toggles

### 7. Global Features
- **Role Switcher:** Admin / QC Manager / Staff
- **Code/Workspace Chips:** Switch between projects
- **Notification Panel:** 3 demo notifications
- **Credit Display:** P1 credits + P2 budget in sidebar
- **Telegram Login Modal** (simulated)
- **Toast Notifications** for all actions
- **Collapsible Sidebar**
- **Dark Mode** throughout

## 📁 File Structure
```
index.html          – Main HTML shell, sidebar, modals
css/style.css       – Global dark theme styles
js/screens.js       – Dashboard, QC, HR, Library, Settings screens
js/creator.js       – Creator Workspace (Task Combo engine)
js/app.js           – Navigation, roles, charts, toasts, shared logic
docs/               – Original system documentation
analysis.html       – Legacy system analysis report
```

## 🔗 Entry Points
| Path | Description |
|------|-------------|
| `index.html` | Main application (all screens) |
| `analysis.html` | Legacy system analysis |

## 🏗️ Architecture
- **Frontend-only** static SPA (no backend required for prototype)
- **Chart.js 4.4** for data visualization
- **Font Awesome 6.4** for icons
- **Inter** font family via Google Fonts
- Pure vanilla JavaScript – no framework dependency
- CSS custom properties for theming

## 🚀 Recommended Next Steps
1. **Connect to real FastAPI backend** with JWT auth
2. **WebSocket** for real-time task progress (replace polling simulation)
3. **File upload** to S3/cloud storage
4. **Real Telegram Bot** integration for QC workflow
5. **Database** (PostgreSQL) for persistent data
6. **User auth** with Telegram-verified login
7. **Credit management** API integration (KIE.AI, PiAPI)
8. **Video preview** in output library (actual video playback)
9. **Export** functionality for reports
10. **Mobile responsive** improvements

## ⚠️ Known Limitations
- All data is demo/simulated (no persistence)
- QC responses are randomized simulations
- Video rendering is progress bar animation only
- Password fields show DOM warnings (cosmetic, no impact)

## Production Deploy (VM/VPS)
Run from `/opt/faistudio`:

```bash
chmod +x /opt/faistudio/prepare-secrets.sh /opt/faistudio/deploy-vm.sh
/opt/faistudio/prepare-secrets.sh /opt/faistudio/.env.production
/opt/faistudio/deploy-vm.sh
/opt/faistudio/smoke-test.sh
```

Checks after deploy:

```bash
cd /opt/faistudio
ENV_FILE_PATH=/opt/faistudio/.secrets/.env.production docker compose -f docker-compose.production.yml ps
ENV_FILE_PATH=/opt/faistudio/.secrets/.env.production docker compose -f docker-compose.production.yml logs --tail=120 api
```

### Strict Deploy Flow (anti-regression)

`deploy-vm.sh` now enforces:
1. Sync runtime files from root source into `frontend/` (the actual nginx-mounted path).
2. Run predeploy guard to block known regressions:
   - duplicate/missing `addTaskRow` contract in Creator
   - broken dropdown text regressions
   - root/frontend file mismatch
   - JS syntax check (when `node` exists)

Manual run:
```bash
cd /opt/faistudio
bash scripts/sync_frontend_runtime.sh /opt/faistudio
bash scripts/predeploy_guard.sh /opt/faistudio
ENV_FILE_PATH=/opt/faistudio/.secrets/.env.production bash deploy-vm.sh
```
