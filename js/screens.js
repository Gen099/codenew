// ===== SCREEN BUILDERS FOR VIDEOTOOL PROTOTYPE =====
// Creator Workspace is in js/creator.js (buildCreator)
// All data comes from AppData in js/data.js

let dashboardViewMode = 'today';
let libraryFilters = { code: '', type: '', status: '', limit: 8 };
let qcStaffFilter = '';
let staffFilters = { query: '', role: '', status: '' };
let dashboardFilters = { period: 'today', user: '', group: '', month: '' };
let staffShiftSelectedDate = '';

function formatOnlineDuration(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours} gi\u1EDD ${minutes} ph\u00FAt`;
  return `${minutes} ph\u00FAt`;
}

// ---- DASHBOARD SCREEN ----
function buildDashboard() {
  const viewProfile = (typeof getViewProfile === 'function') ? getViewProfile() : (AppData.currentUser || {});
  if (String(AppData.currentUser?.role || '').toLowerCase() === 'staff') {
    return buildStaffDashboard();
  }
  const el = document.getElementById('dashboardContent');
  const now = new Date();
  const creditInfo = getCreditSummary();
  const scopedItems = filterDashboardItems(dashboardFilters);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);
  const filterBySince = (items, since) => items.filter((item) => item.createdAt && new Date(item.createdAt) >= since);
  const baseItems = (Array.isArray(AppData.library) ? AppData.library : []).filter((item) => {
    if (dashboardFilters.user && !isSameStaffRef(item.staffId, dashboardFilters.user)) return false;
    if (dashboardFilters.group && String(item.codeTag || '') !== String(dashboardFilters.group)) return false;
    if (dashboardFilters.month && !String(item.createdAt || '').startsWith(dashboardFilters.month)) return false;
    return true;
  });
  const monthKey = String(dashboardFilters.month || '').trim();
  const [selectedYear, selectedMonth] = monthKey && /^\d{4}-\d{2}$/.test(monthKey)
    ? monthKey.split('-').map((v) => Number(v))
    : [now.getFullYear(), now.getMonth() + 1];
  const monthStart = new Date(selectedYear, selectedMonth - 1, 1);
  const monthDays = new Date(selectedYear, selectedMonth, 0).getDate();
  const monthGrid = {
    year: selectedYear,
    month: selectedMonth - 1,
    daysInMonth: monthDays,
    metrics: [
      { key: 'videoCreated', label: 'Video t\u1EA1o', color: 'var(--brand)', data: Array(monthDays).fill(0) },
      { key: 'imageCreated', label: '\u1EA2nh t\u1EA1o', color: 'var(--blue)', data: Array(monthDays).fill(0) },
      { key: 'qcOk', label: 'QC OK', color: 'var(--green)', data: Array(monthDays).fill(0) },
      { key: 'qcReject', label: 'QC Reject', color: 'var(--red)', data: Array(monthDays).fill(0) },
      { key: 'credits', label: 'Credits', color: 'var(--yellow)', data: Array(monthDays).fill(0) },
    ],
  };
  baseItems.forEach((item) => {
    if (!item || !item.createdAt) return;
    const createdAt = new Date(item.createdAt);
    if (Number.isNaN(createdAt.getTime())) return;
    if (createdAt.getFullYear() !== selectedYear || (createdAt.getMonth() + 1) !== selectedMonth) return;
    const dayIndex = createdAt.getDate() - 1;
    if (dayIndex < 0 || dayIndex >= monthDays) return;
    const mediaType = String(item.type || item.mediaType || '').toLowerCase();
    const status = String(item.status || '').toLowerCase();
    if (mediaType === 'video') monthGrid.metrics[0].data[dayIndex] += 1;
    if (mediaType === 'image') monthGrid.metrics[1].data[dayIndex] += 1;
    if (status === 'approved') monthGrid.metrics[2].data[dayIndex] += 1;
    if (status === 'rejected') monthGrid.metrics[3].data[dayIndex] += 1;
    monthGrid.metrics[4].data[dayIndex] += Number(item.credits || 0);
  });
  const summaryStats = {
    today: calcDashboardStatsForItems(filterBySince(baseItems, todayStart)),
    week: calcDashboardStatsForItems(filterBySince(baseItems, weekStart)),
    month: calcDashboardStatsForItems(filterBySince(baseItems, monthStart)),
    all: calcDashboardStatsForItems(baseItems),
  };
  const scopedStats = calcDashboardStatsForItems(scopedItems);
  const sessions = getActiveSessions().filter((session) => !dashboardFilters.user || isSameStaffRef(session.staffId || session.username, dashboardFilters.user));
  const qcQueue = getQCQueue().filter((item) => {
    if (dashboardFilters.user && !isSameStaffRef(item.staffId, dashboardFilters.user)) return false;
    if (dashboardFilters.group && String(item.codeTag || '') !== String(dashboardFilters.group)) return false;
    if (dashboardFilters.month && !String(item.createdAt || '').startsWith(dashboardFilters.month)) return false;
    return true;
  });

  // Generate day columns
  const dayHeaders = Array.from({length: monthGrid.daysInMonth}, (_,i) => {
    const d = new Date(monthGrid.year, monthGrid.month, i+1);
    const wd = ['CN','T2','T3','T4','T5','T6','T7'][d.getDay()];
    return `<th class="db-day-th">${String(i+1).padStart(2,'0')}<br><span>${wd}</span></th>`;
  }).join('');

  // Build month grid rows from real data
  let monthRows = '';
  monthGrid.metrics.forEach((m) => {
    let total = 0;
    let cells = '';
    for (let d = 0; d < monthGrid.daysInMonth; d++) {
      const v = m.data[d] || 0;
      total += v;
      const isCurrentMonth = selectedYear === now.getFullYear() && selectedMonth === (now.getMonth() + 1);
      const isFuture = isCurrentMonth && (d + 1) > now.getDate();
      const highlight = v > 0 && !isFuture;
      cells += `<td class="db-day-td${highlight ? ' active' : ''}${isFuture ? ' future' : ''}" style="${highlight ? 'background:'+m.color+'22;color:'+m.color : ''}">${isFuture ? '' : v}</td>`;
    }
    monthRows += `
      <tr>
        <td class="db-metric-td" style="color:${m.color}">${m.label}</td>
        ${cells}
        <td class="db-total-td" style="color:${m.color};font-weight:700">${total}</td>
      </tr>`;
  });

  // Staff performance from AppData
  const staffKPI = getStaffKPIForItems(scopedItems);
  const codeKPI = getCodeKPIForItems(scopedItems);

  // Shift reports from AppData
  const shiftReport = (Array.isArray(AppData.shiftReports) ? AppData.shiftReports : []).filter((item) => {
    if (dashboardFilters.user && !isSameStaffRef(item.staffId, dashboardFilters.user)) return false;
    return true;
  });

  // Find latest shift for info bar
  const lastShift = shiftReport.length > 0 ? shiftReport[shiftReport.length - 1] : null;
  const lastStaff = lastShift ? getStaff(lastShift.staffId) : null;
  const avgCredit = scopedStats.media > 0 ? (scopedStats.credits / scopedStats.media).toFixed(1) : '0';
  const providerSummary = ['provider1', 'provider2'].map((providerId) => {
    const items = scopedItems.filter((item) => String(item.provider || 'provider1').trim().toLowerCase() === providerId);
    return {
      id: providerId,
      label: providerId === 'provider2' ? 'Server 2' : 'Server 1',
      costText: providerId === 'provider2'
        ? `$${items.reduce((sum, item) => sum + Number(item.credit_used || 0), 0).toFixed(2)}`
        : `${items.reduce((sum, item) => sum + Number(item.credit_used || item.credits || 0), 0)} cr`,
      tasks: items.length,
      models: Array.from(new Set(items.map((item) => String(item.model_label || item.model_id || '-')).filter(Boolean))).join(', ') || '-',
    };
  });

  // Helper to render period card
  function periodCard(title, color, period) {
    return `
      <div class="db-card-summary">
        <div class="db-card-title" style="border-left:3px solid ${color};">${title}</div>
        <div class="db-card-stats">
          <div>Media: ${period.media}</div>
          <div>T\u1EA1o \u0111\u01B0\u1EE3c: Video: <b>${period.videoCreated}</b> | \u1EA2nh: <b>${period.imageCreated}</b></div>
          <div>\u0110\u00E3 x\u1EED l\u00FD: Video: <b>${period.videoUsed}</b> | \u1EA2nh: <b>${period.imageUsed}</b></div>
          <div>Recover: <b>${period.recover}</b></div>
          <div>Credit: <b>${period.credits}</b></div>
          <div>QC OK: <b>${period.qcOk}</b> | Reject: <b>${period.qcReject}</b></div>
        </div>
      </div>`;
  }

  el.innerHTML = `
    <!-- TOOLBAR -->
    <div class="db-toolbar">
      <div class="db-toolbar-left">
        <select class="db-filter-btn" style="appearance:auto" onchange="setDashboardFilter('period', this.value)">
          <option value="today" ${dashboardFilters.period === 'today' ? 'selected' : ''}>H\u00F4m nay</option>
          <option value="week" ${dashboardFilters.period === 'week' ? 'selected' : ''}>Tu\u1EA7n n\u00E0y</option>
          <option value="month" ${dashboardFilters.period === 'month' ? 'selected' : ''}>Th\u00E1ng n\u00E0y</option>
          <option value="all" ${dashboardFilters.period === 'all' ? 'selected' : ''}>To\u00E0n th\u1EDDi gian</option>
        </select>
        <select class="db-filter-btn" style="appearance:auto" onchange="setDashboardFilter('user', this.value)">
          <option value="">T\u1EA5t c\u1EA3 user</option>
          ${AppData.staff.map((s) => `<option value="${String(s.id || '').replace(/"/g, '&quot;')}" ${dashboardFilters.user === String(s.id || '') ? 'selected' : ''}>${s.name}</option>`).join('')}
        </select>
        <select class="db-filter-btn" style="appearance:auto" onchange="setDashboardFilter('group', this.value)">
          <option value="">T\u1EA5t c\u1EA3 nh\u00F3m</option>
          ${Array.from(new Set((AppData.library || []).map((i) => String(i.codeTag || '').trim()).filter(Boolean))).sort().map((code) => `<option value="${code.replace(/"/g, '&quot;')}" ${dashboardFilters.group === code ? 'selected' : ''}>${code}</option>`).join('')}
        </select>
        <select class="db-filter-btn" style="appearance:auto" onchange="setDashboardFilter('month', this.value)">
          <option value="">Th\u00E1ng ${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}</option>
          ${Array.from(new Set((AppData.library || []).map((i) => String(i.createdAt || '').slice(0, 7)).filter(Boolean))).sort().reverse().map((monthKey) => `<option value="${monthKey}" ${dashboardFilters.month === monthKey ? 'selected' : ''}>Th\u00E1ng ${monthKey.slice(5,7)}/${monthKey.slice(0,4)}</option>`).join('')}
        </select>
        <button class="db-filter-btn" onclick="refreshDashboardView()"><i class="fa-solid fa-refresh"></i> L\u00E0m m\u1EDBi</button>
        <button class="db-filter-btn accent" onclick="exportDashboardCsv()"><i class="fa-solid fa-file-excel"></i> Xu\u1EA5t Excel</button>
      </div>
      <div class="db-toolbar-right">
        ${sessions.map(s => {
          const st = getStaff(s.staffId);
          return `<span class="db-online-dot green" title="${s.displayName || st.name || s.username || '-'}"></span>`;
        }).join('')}
        <div class="db-user-avatar">${viewProfile.avatar || '?'}</div>
      </div>
    </div>

    <!-- SUMMARY CARDS -->
    <div class="db-cards-row">
      ${periodCard('H\u00F4m nay', 'var(--green)', summaryStats.today)}
      ${periodCard('Tu\u1EA7n n\u00E0y', 'var(--blue)', summaryStats.week)}
      ${periodCard('Th\u00E1ng n\u00E0y', 'var(--brand)', summaryStats.month)}
      <div class="db-card-summary">
        <div class="db-card-title" style="border-left:3px solid var(--yellow);">Duy\u1EC7t s\u1EA3n ph\u1EA9m</div>
        <div class="db-card-stats">
          <div>Reject: <b>${scopedStats.qcReject}</b></div>
          <div>Ch\u1EDD duy\u1EC7t: <b>${qcQueue.length}</b></div>
        </div>
      </div>
      <div class="db-card-summary">
        <div class="db-card-title" style="border-left:3px solid var(--purple);">Credit Budget</div>
        <div class="db-card-stats">
          <div>\u0110\u00E3 d\u00F9ng: <b>${scopedStats.credits}</b> / ${creditInfo.budget} cr</div>
          <div>C\u00F2n: <b>${Math.max(creditInfo.budget - scopedStats.credits, 0)}</b> cr</div>
        </div>
      </div>
    </div>

    <!-- INFO BAR -->
    <div class="db-info-bar">
      <span>C\u1EADp nh\u1EADt: ${lastStaff ? lastStaff.name : 'N/A'} | Task: ${lastShift ? lastShift.tasks : 0} | Credit: ${lastShift ? lastShift.credits : 0} | L\u00FAc ${now.toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})} | TB credit/media: ${avgCredit} | Default: ${AppData.model.name} | P1: ${providerSummary[0].tasks} task / ${providerSummary[0].costText} | P2: ${providerSummary[1].tasks} task / ${providerSummary[1].costText}</span>
    </div>

    <div class="db-section">
      <div class="db-section-header">
        <span class="db-section-title"><i class="fa-solid fa-server" style="color:var(--yellow)"></i> Theo Server</span>
      </div>
      <table class="db-table">
        <thead><tr><th>Server</th><th>Tasks</th><th>Chi ph\u00ED</th><th>Model \u0111\u00E3 d\u00F9ng</th></tr></thead>
        <tbody>
          ${providerSummary.map((row) => `<tr><td><b>${row.label}</b></td><td>${row.tasks}</td><td style="color:var(--yellow)">${row.costText}</td><td style="max-width:420px;white-space:normal">${row.models}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>

    <!-- B?NG TH\u00C1NG -->
    <div class="db-section">
      <div class="db-section-header">
        <span class="db-section-title"><i class="fa-solid fa-calendar-days" style="color:var(--brand)"></i> B\u1EA3ng th\u00E1ng</span>
      </div>
      <div class="db-legend">
        <span>Ghi ch\u00FA:</span>
        ${monthGrid.metrics.map(m => `<span class="db-legend-item" style="color:${m.color}">\u00A6 ${m.label}</span>`).join('')}
      </div>
      <div class="db-month-table-wrap">
        <table class="db-month-table">
          <thead>
            <tr>
              <th class="db-metric-th">Ch\u1EDD s?</th>
              ${dayHeaders}
              <th class="db-total-th">T\u1ED5ng</th>
            </tr>
          </thead>
          <tbody>
            ${monthRows}
          </tbody>
        </table>
      </div>
    </div>

    <!-- BOTTOM GRID: 2 columns -->
    <div class="db-grid-2">
      <!-- S\u1EA3n l\u01B0\u1EE3ng theo nh\u00E2n s\u1EF1 -->
      <div class="db-section">
        <div class="db-section-header">
          <span class="db-section-title"><i class="fa-solid fa-users" style="color:var(--blue)"></i> S\u1EA3n l\u01B0\u1EE3ng theo nh\u00E2n s\u1EF1</span>
          <span class="db-badge-count">${staffKPI.length} nh\u00E2n s\u1EF1</span>
        </div>
        <table class="db-table">
          <thead><tr><th>Nh\u00E2n s\u1EF1</th><th>Media</th><th>Xong</th><th>Ch\u1EDD</th><th>L\u1ED7i</th><th>QC OK</th><th>QC Reject</th><th>Credit</th></tr></thead>
          <tbody>
            ${staffKPI.map((s,i) => `
              <tr>
                <td><b>${i+1}</b> ${s.name}</td>
                <td>${s.totalMedia}</td><td>${s.approved + s.done}</td><td>${s.pending}</td><td>${s.rejected}</td>
                <td>${s.approved}</td><td>${s.rejected}</td><td style="color:var(--yellow)">${s.creditsUsed}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- Phi\u00EAn \u0111ang m\u1EDF -->
      <div class="db-section">
        <div class="db-section-header">
          <span class="db-section-title"><i class="fa-solid fa-tower-broadcast" style="color:var(--green)"></i> Phi\u00EAn \u0111ang m\u1EDF</span>
          <span class="db-badge-count" style="background:var(--green)">${sessions.length} active</span>
        </div>
        <table class="db-table">
          <thead><tr><th>#</th><th>Nh\u00E2n s\u1EF1</th><th>CODE</th><th>Hi\u1EC7u \u1EE9ng</th><th>B\u1EAFt \u0111\u1EA7u</th><th>Tr\u1EA1ng th\u00E1i</th></tr></thead>
          <tbody>
            ${sessions.flatMap((s) => {
              const st = getStaff(s.staffId || s.username || '');
              const startStr = s.shift_started_at
                ? new Date(Number(s.shift_started_at) * 1000).toLocaleString('vi-VN')
                : (s.startTime ? new Date(s.startTime).toLocaleString('vi-VN', {month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'}) : '-');
              const entries = Array.isArray(s.current_entries) && s.current_entries.length > 0
                ? s.current_entries
                : [{ code: String(s.current_code || s.codeTag || '').trim(), task: String(s.current_task || s.effect || s.description || '').trim() }];
              return entries.map((entry, entryIdx) => `
              <tr>
                <td>${entryIdx === 0 ? s.id : ''}</td><td>${st.name}</td><td>${String(entry.code || s.current_code || s.codeTag || '').trim() || '-'}</td><td>${String(entry.task || s.current_task || s.effect || s.description || '').trim() || '-'}</td>
                <td style="font-size:11px">${startStr}</td>
                <td><span class="db-status-tag active">active</span></td>
              </tr>`);
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="db-grid-2">
      <!-- H\u00E0ng ch\u1EDD QC -->
      <div class="db-section">
        <div class="db-section-header">
          <span class="db-section-title"><i class="fa-solid fa-clock" style="color:var(--yellow)"></i> H\u00E0ng ch\u1EDD QC</span>
          <span class="db-badge-count" style="background:var(--yellow)">${qcQueue.length} m\u1EE5c</span>
        </div>
        <table class="db-table">
          <thead><tr><th>Nh\u00E2n s\u1EF1</th><th>CODE</th><th>T\u00EAn file</th><th>Credit</th><th>Tr\u1EA1ng th\u00E1i</th></tr></thead>
          <tbody>
            ${qcQueue.length === 0 ? '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:12px">Kh\u00F4ng c\u00F3 m\u1EE5c n\u00E0o</td></tr>' : qcQueue.map(q => {
              const st = getStaff(q.staffId);
              return `<tr><td>${st.name}</td><td>${q.codeTag}</td><td>${q.name}</td><td style="color:var(--yellow)">${q.credits} cr</td><td><span class="badge badge-yellow">Ch\u1EDD QC</span></td></tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      <!-- B\u00E1o c\u00E1o ca -->
      <div class="db-section">
        <div class="db-section-header">
          <span class="db-section-title"><i class="fa-solid fa-file-lines" style="color:var(--purple)"></i> B\u00E1o c\u00E1o ca</span>
          <span class="db-badge-count" style="background:var(--purple)">${shiftReport.length} b\u1EA3n ghi</span>
        </div>
        <table class="db-table">
          <thead><tr><th>#</th><th>Nh\u00E2n s\u1EF1</th><th>Tasks</th><th>Credit</th><th>Th\u1EDDi gian</th><th>Ghi ch\u00FA</th></tr></thead>
          <tbody>
            ${shiftReport.map((r,i) => {
              const st = getStaff(r.staffId);
              return `
              <tr>
                <td>${r.id}</td><td>${st.name}</td><td>${r.tasks}</td>
                <td style="color:var(--yellow)">${r.credits}</td>
                <td style="font-size:11px">${r.time}</td><td>${r.note || '-'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  const visibleItems = AppData.library.slice(0, 8);
  const cards = el.querySelectorAll('.media-card');
  cards.forEach((card, idx) => {
    const item = visibleItems[idx];
    if (!item) return;
    let actions = card.querySelector('.media-actions-inline');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'media-actions-inline';
      actions.style.display = 'flex';
      actions.style.gap = '6px';
      actions.style.marginTop = '6px';
      const info = card.querySelector('.media-info');
      if (info) info.appendChild(actions);
    }
    actions.innerHTML = '';
    if (item.resultUrl) {
      const btnView = document.createElement('button');
      btnView.className = 'btn-secondary btn-sm';
      btnView.style.fontSize = '10px';
      btnView.style.padding = '4px 8px';
      btnView.innerHTML = '<i class="fa-solid fa-eye"></i> Xem';
      btnView.onclick = (ev) => {
        ev.stopPropagation();
        previewMedia(item.name, item.id);
      };
      actions.appendChild(btnView);
    }
    const canSendQC = item.type === 'video' && !!item.taskId && !!item.resultUrl && item.status !== 'pending_qc' && item.status !== 'processing';
    if (canSendQC) {
      const btnQC = document.createElement('button');
      btnQC.className = 'btn-primary btn-sm';
      btnQC.style.fontSize = '10px';
      btnQC.style.padding = '4px 8px';
      btnQC.innerHTML = '<i class="fa-brands fa-telegram"></i> G\u1EEDi QC';
      btnQC.onclick = async (ev) => {
        ev.stopPropagation();
        await submitLibraryQCById(item.id);
      };
      actions.appendChild(btnQC);
    }
  });
}

function buildStaffDashboard() {
  const el = document.getElementById('dashboardContent');
  if (!el) return;
  const now = new Date();
  const selectedDate = staffShiftSelectedDate || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const templates = getShiftTemplates();
  const active = AppData.activeShift;
  const summary = AppData.activeShiftSummary?.summary || {};
  const workTasks = Array.isArray(AppData.activeShiftSummary?.work_tasks) ? AppData.activeShiftSummary.work_tasks : [];
  const [selectedYear, selectedMonth] = String(selectedDate).split('-').map((v) => Number(v));
  const year = selectedYear || now.getFullYear();
  const month = Number.isFinite(selectedMonth) ? selectedMonth - 1 : now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const monthLabel = `Th\u00E1ng ${String(month + 1).padStart(2, '0')}/${year}`;
  const monthOptions = Array.from({ length: 12 }, (_, idx) => {
    const dt = new Date(now.getFullYear(), now.getMonth() - idx, 1);
    const value = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    const label = `Th\u00E1ng ${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
    const isSelected = value === `${year}-${String(month + 1).padStart(2, '0')}`;
    return `<option value="${value}" ${isSelected ? 'selected' : ''}>${label}</option>`;
  }).join('');
  let cells = '';
  for (let i = 0; i < firstDay; i++) cells += '<div></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isSelected = dateKey === selectedDate;
    const isToday = dateKey === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const dayBorder = isSelected
      ? '1px solid #ffd8aa'
      : (isToday ? '1px solid #ffc178' : '1px solid #d7863f');
    const dayBackground = isSelected
      ? 'linear-gradient(155deg, rgba(255,204,143,.72) 0%, rgba(255,165,77,.52) 45%, rgba(93,45,14,.94) 100%)'
      : (isToday
        ? 'linear-gradient(155deg, rgba(255,191,118,.58) 0%, rgba(255,150,60,.40) 45%, rgba(82,39,12,.95) 100%)'
        : 'linear-gradient(155deg, rgba(255,172,92,.42) 0%, rgba(215,116,42,.28) 48%, rgba(64,32,15,.96) 100%)');
    const dayShadow = isSelected
      ? '0 0 0 1px rgba(255,214,162,.28) inset, 0 14px 26px rgba(0,0,0,.30)'
      : (isToday
        ? '0 0 0 1px rgba(255,193,122,.24) inset, 0 10px 20px rgba(0,0,0,.26)'
        : '0 8px 16px rgba(0,0,0,.20)');
    cells += `<button class="btn-ghost" onclick="selectStaffShiftDate('${dateKey}')" style="height:72px;border:${dayBorder};background:${dayBackground};box-shadow:${dayShadow};color:${isToday ? 'var(--green)' : 'var(--text)'};border-radius:12px;text-align:left;padding:10px">
      <div style="font-size:16px;font-weight:800">${String(day).padStart(2, '0')}</div>
      <div style="font-size:11px;color:var(--muted)">${dateKey}</div>
    </button>`;
  }
  el.innerHTML = `
    <div class="section-header">
      <div class="section-title"><i class="fa-solid fa-calendar-days"></i> Dashboard ca l\u00E0m vi\u1EC7c</div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <div class="card-title"><i class="fa-solid fa-calendar"></i> L\u1ECBch l\u00E0m vi\u1EC7c</div>
          <div style="display:flex;align-items:center;gap:8px">
            <select class="form-select" style="width:auto;font-size:12px" onchange="selectStaffShiftMonth(this.value)">
              ${monthOptions}
            </select>
            <span class="badge badge-blue">${monthLabel}</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px">
          ${['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'].map((d) => `<div style="font-size:12px;color:var(--muted);font-weight:700;text-align:center">${d}</div>`).join('')}
          ${cells}
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title"><i class="fa-solid fa-business-time"></i> ${active ? 'Ca \u0111ang m\u1EDF' : 'B\u1EAFt \u0111\u1EA7u ca'}</div>
          <span class="badge ${active ? 'badge-green' : 'badge-yellow'}">${active ? 'active' : 'ready'}</span>
        </div>
        ${active ? `
          <div style="display:flex;flex-direction:column;gap:10px">
            <div style="padding:12px;background:var(--bg2);border:1px solid var(--border);border-radius:10px">
              <div style="font-size:15px;font-weight:800">${active.shiftLabel || active.title || 'Ca l\u00E0m vi\u1EC7c'}</div>
              <div style="font-size:12px;color:var(--muted);margin-top:6px">Ng\u00E0y: ${active.shiftDate || '-'}</div>
              <div style="font-size:12px;color:var(--muted)">B\u1EAFt \u0111\u1EA7u: ${(() => { const dt = parseRuntimeDate(active.createdAt); return dt ? dt.toLocaleString('vi-VN') : '-'; })()}</div>
              <div style="font-size:12px;color:var(--muted)">Khung gi\u1EDD: ${active.plannedStart || '-'} - ${active.plannedEnd || '-'}</div>
            </div>
            <div class="grid-3" style="gap:12px">
              <div class="stat-card"><div class="stat-value">${Number(summary.work_task_count || 0)}</div><div class="stat-label">S\u1ED1 phi\u00EAn task</div></div>
              <div class="stat-card"><div class="stat-value">${Number(summary.total_tasks || 0)}</div><div class="stat-label">T\u1ED5ng task</div></div>
              <div class="stat-card"><div class="stat-value">${Number(summary.total_credits || 0)}</div><div class="stat-label">Credits ti\u00EAu th\u1EE5</div></div>
            </div>
            <div class="card" style="padding:0;border:none;background:transparent">
              <div class="table-wrapper">
                <table>
                  <thead><tr><th>#</th><th>Phi\u00EAn task</th><th>Video</th><th>Credits</th></tr></thead>
                  <tbody>
                    ${workTasks.length === 0
                      ? '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:14px">Ch\u01B0a c\u00F3 phi\u00EAn task</td></tr>'
                      : workTasks.map((row, idx) => `<tr><td>${idx + 1}</td><td>${row.title || '-'}</td><td>${Number(row.video_count || 0)}</td><td style="color:var(--yellow)">${Number(row.credits_used || 0)}</td></tr>`).join('')}
                  </tbody>
                </table>
              </div>
            </div>
            <div class="form-group">
              <label>Ghi ch\u00FA k\u1EBFt th\u00FAc</label>
              <textarea id="shiftCloseNote" class="form-textarea" placeholder="Nh\u1EADp ghi ch\u00FA k\u1EBFt ca..."></textarea>
            </div>
            <div class="form-group">
              <label>\u0110\u00E1nh gi\u00E1 ca</label>
              <select id="shiftCloseRating" class="form-select">
                <option value="T\u1ED1t">T\u1ED1t</option>
                <option value="Kh\u00E1">Kh\u00E1</option>
                <option value="C\u1EA7n c\u1EA3i thi\u1EC7n">C\u1EA7n c\u1EA3i thi\u1EC7n</option>
              </select>
            </div>
              <div style="display:flex;gap:10px;flex-wrap:wrap">
                <button class="btn-secondary" onclick="submitShiftReportOnly()"><i class="fa-solid fa-paper-plane"></i> G\u1EEDi b\u00E1o c\u00E1o</button>
                <button class="btn-danger" onclick="closeActiveShiftOnly()" title="${AppData.activeShiftReportSubmitted ? 'K\u1EBFt th\u00FAc ca' : 'Ph\u1EA3i g\u1EEDi b\u00E1o c\u00E1o tr\u01B0\u1EDBc khi k\u1EBFt th\u00FAc ca'}"><i class="fa-solid fa-stop"></i> K\u1EBFt th\u00FAc ca</button>
                <button class="btn-primary" onclick="openCreatorFromActiveShift()"><i class="fa-solid fa-arrow-right"></i> V\u00E0o Creator Workspace</button>
              </div>
              ${AppData.activeShiftReportSubmitted ? '' : '<div style="font-size:12px;color:var(--yellow);font-weight:600">Ph\u1EA3i g\u1EEDi b\u00E1o c\u00E1o tr\u01B0\u1EDBc khi nh\u1EA5n K\u1EBFt th\u00FAc ca</div>'}
            </div>
        ` : `
          <div style="display:flex;flex-direction:column;gap:12px">
            <div class="form-group">
              <label>Nh\u00E2n s\u1EF1</label>
              <input class="form-input" value="${viewProfile.name || '-'}" disabled>
            </div>
            <div class="form-group">
              <label>Ng\u00E0y l\u00E0m vi\u1EC7c</label>
              <input class="form-input" value="${selectedDate}" disabled>
            </div>
            <div class="form-group">
              <label>T\u00EAn ca</label>
              <select id="staffShiftTemplate" class="form-select">
                <option value="morning">${templates.morning.label} (${templates.morning.start} - ${templates.morning.end})</option>
                <option value="afternoon">${templates.afternoon.label} (${templates.afternoon.start} - ${templates.afternoon.end})</option>
                <option value="evening">${templates.evening.label} (${templates.evening.start} - ${templates.evening.end})</option>
              </select>
            </div>
            <div class="form-group">
              <label>Ghi ch\u00FA b\u1EAFt \u0111\u1EA7u</label>
              <textarea id="shiftStartNote" class="form-textarea" placeholder="Nh\u1EADp k\u1EBF ho\u1EA1ch ca l\u00E0m..."></textarea>
            </div>
            <button class="btn-primary" onclick="beginShiftForSelectedDate()"><i class="fa-solid fa-play"></i> B\u1EAFt \u0111\u1EA7u ca</button>
          </div>
        `}
      </div>
    </div>
  `;
}

function selectStaffShiftDate(dateKey) {
  staffShiftSelectedDate = String(dateKey || '').trim();
  buildDashboard();
}

function selectStaffShiftMonth(monthKey) {
  const key = String(monthKey || '').trim();
  if (!/^\d{4}-\d{2}$/.test(key)) return;
  staffShiftSelectedDate = `${key}-01`;
  buildDashboard();
}

async function beginShiftForSelectedDate() {
  if (AppData.activeShift) {
    showToast('\u0110ang c\u00F3 ca m\u1EDF', 'error');
    return;
  }
  const shiftKey = String(document.getElementById('staffShiftTemplate')?.value || '').trim();
  const note = String(document.getElementById('shiftStartNote')?.value || '').trim();
  const templates = getShiftTemplates();
  const row = templates[shiftKey];
  if (!row) {
    showToast('Thi\u1EBFu c\u1EA5u h\u00ECnh ca', 'error');
    return;
  }
  const shiftDate = staffShiftSelectedDate || new Date().toISOString().slice(0, 10);
  const payload = {
    title: `${row.label} - ${shiftDate}`,
    description: JSON.stringify({
      shift_key: shiftKey,
      shift_label: row.label,
      shift_date: shiftDate,
      planned_start: row.start,
      planned_end: row.end,
      notes: note,
    }),
  };
  try {
    await API.createWorkTask(payload);
    await loadDataFromAPI();
    buildDashboard();
    showToast('\u0110\u00E3 b\u1EAFt \u0111\u1EA7u ca', 'success');
  } catch (err) {
    showToast(err?.message || 'Kh\u00F4ng b\u1EAFt \u0111\u1EA7u \u0111\u01B0\u1EE3c ca', 'error');
  }
}

async function finishActiveShiftFlow() {
  if (currentScreen !== 'dashboard') {
    switchScreen('dashboard');
  }
  buildDashboard();
  setTimeout(() => {
    const target = document.getElementById('shiftCloseNote') || document.getElementById('shiftCloseRating');
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (typeof target.focus === 'function') target.focus();
    }
  }, 50);
}

async function submitShiftReportOnly() {
  if (!AppData.activeShift) {
    showToast('Kh\u00F4ng c\u00F3 ca \u0111ang m\u1EDF', 'error');
    return;
  }
  const note = String(document.getElementById('shiftCloseNote')?.value || '').trim();
  const rating = String(document.getElementById('shiftCloseRating')?.value || '').trim();
  const finalNote = rating ? `[${rating}] ${note}`.trim() : note;
  try {
    await API.submitShiftReport({ notes: finalNote });
    AppData.activeShiftReportSubmitted = true;
    buildDashboard();
    showToast('\u0110\u00E3 g\u1EEDi b\u00E1o c\u00E1o ca', 'success');
  } catch (err) {
    showToast(err?.message || 'Kh\u00F4ng g\u1EEDi \u0111\u01B0\u1EE3c b\u00E1o c\u00E1o ca', 'error');
  }
}

async function closeActiveShiftOnly() {
  if (!AppData.activeShift) {
    showToast('Kh\u00F4ng c\u00F3 ca \u0111ang m\u1EDF', 'error');
    return;
  }
  if (!AppData.activeShiftReportSubmitted) {
    showToast('Ph\u1EA3i g\u1EEDi b\u00E1o c\u00E1o tr\u01B0\u1EDBc khi k\u1EBFt th\u00FAc ca', 'error');
    return;
  }
  const note = String(document.getElementById('shiftCloseNote')?.value || '').trim();
  const rating = String(document.getElementById('shiftCloseRating')?.value || '').trim();
  const finalNote = rating ? `[${rating}] ${note}`.trim() : note;
  try {
    await API.closeWorkTask(AppData.activeShift.id, { notes: finalNote });
    if (typeof clearActiveShiftRuntime === 'function') clearActiveShiftRuntime();
    if (currentScreen !== 'dashboard') switchScreen('dashboard');
    buildDashboard();
    await loadDataFromAPI();
    buildDashboard();
    showToast('\u0110\u00E3 k\u1EBFt th\u00FAc ca', 'success');
  } catch (err) {
    showToast(err?.message || 'Kh\u00F4ng k\u1EBFt th\u00FAc \u0111\u01B0\u1EE3c ca', 'error');
  }
}

function openCreatorFromActiveShift() {
  switchScreen('creator');
}

function buildLeaderboard() {
  const staffKPI = getAllStaffKPI().sort((a, b) => b.kpiScore - a.kpiScore).slice(0, 5);
  return staffKPI.map((s, i) => `
    <div class="leaderboard-item">
      <div class="leaderboard-rank ${i < 3 ? 'rank-'+(i+1) : 'rank-other'}">${i+1}</div>
      <div class="role-avatar" style="background:${s.color};width:32px;height:32px;font-size:13px;flex-shrink:0">${s.avatar}</div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:600">${s.name}</div>
        <div class="progress-bar" style="margin-top:4px;height:4px">
          <div class="progress-fill orange" style="width:${s.kpiScore}%"></div>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:700;font-size:14px">${s.totalMedia}</div>
        <div style="font-size:11px;color:var(--green)">KPI: ${s.kpiScore}</div>
      </div>
    </div>
  `).join('');
}

// ---- QC MANAGER SCREEN ----
function buildQC() {
  const el = document.getElementById('qcContent');
  const queue = filterQCQueue({ staffId: qcStaffFilter });
  const allApproved = AppData.library.filter(i => i.status === 'approved');
  const allRejected = AppData.library.filter(i => i.status === 'rejected');
  const totalQC = allApproved.length + allRejected.length;
  const passRate = totalQC > 0 ? ((allApproved.length / totalQC) * 100).toFixed(1) : '100';
  const canConfigShift = ['admin', 'qc_manager'].includes(String(AppData.currentUser?.role || '').toLowerCase());
  const shiftConfigCard = canConfigShift ? buildQCShiftConfigCard() : '';
  const onlineStaff = getActiveSessions().filter((row) => {
    const role = String(row.role || '').toLowerCase();
    if (role !== 'staff') return false;
    if (qcStaffFilter && !isSameStaffRef(row.staffId || row.username || '', qcStaffFilter)) return false;
    return true;
  });

  // First item for preview
  const previewItem = queue.length > 0 ? queue[0] : null;
  const previewStaff = previewItem ? getStaff(previewItem.staffId) : null;

  el.innerHTML = `
    <div class="section-header">
      <div class="section-title"><i class="fa-solid fa-check-double"></i> QC Manager Dashboard</div>
      <div style="display:flex;gap:8px">
        <select class="form-select" style="width:auto;font-size:12px" onchange="setQCStaffFilter(this.value)">
          <option>T\u1EA5t c\u1EA3 Staff</option>
          ${AppData.staff.map(s => `<option value="${s.id}" ${String(qcStaffFilter) === String(s.id) ? 'selected' : ''}>${s.name}</option>`).join('')}
        </select>
        <button class="btn-secondary btn-sm"><i class="fab fa-telegram"></i> Nh\u1EADn Telegram Alert</button>
      </div>
    </div>
    <div class="grid-4" style="margin-bottom:20px">
      <div class="stat-card"><div class="stat-icon yellow"><i class="fa-solid fa-user-clock"></i></div><div class="stat-value">${onlineStaff.length}</div><div class="stat-label">Nh\u00E2n s\u1EF1 online</div></div>
      <div class="stat-card"><div class="stat-icon green"><i class="fa-solid fa-thumbs-up"></i></div><div class="stat-value">${allApproved.length}</div><div class="stat-label">Approved</div></div>
      <div class="stat-card"><div class="stat-icon red"><i class="fa-solid fa-thumbs-down"></i></div><div class="stat-value">${allRejected.length}</div><div class="stat-label">Rejected</div></div>
      <div class="stat-card"><div class="stat-icon blue"><i class="fa-solid fa-percent"></i></div><div class="stat-value">${passRate}%</div><div class="stat-label">Pass Rate</div></div>
    </div>
    <div class="card" style="margin-bottom:20px">
      <div class="card-header">
        <div class="card-title"><i class="fa-solid fa-signal"></i> Nh\u00E2n s\u1EF1 \u0111ang online</div>
        <span class="badge badge-green">${onlineStaff.length}</span>
      </div>
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Nh\u00E2n s\u1EF1</th><th>Role</th><th>CODE \u0111ang l\u00E0m</th><th>Task</th><th>B\u1EAFt \u0111\u1EA7u ca</th><th>Online</th><th>Ho\u1EA1t \u0111\u1ED9ng</th></tr></thead>
          <tbody>
            ${onlineStaff.length === 0
              ? '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:14px">0</td></tr>'
              : onlineStaff.flatMap((row) => {
                  const staff = getStaff(row.staffId || row.username || '');
                  const displayName = String(staff.name || row.display_name || row.username || '').trim() || 'Unknown';
                  const entries = Array.isArray(row.current_entries) && row.current_entries.length > 0
                    ? row.current_entries
                    : [{ code: String(row.codeTag || row.current_code || '').trim(), task: String(row.effect || row.current_task || row.description || row.title || '').trim() }];
                  const shiftStarted = row.shift_started_at ? new Date(Number(row.shift_started_at) * 1000).toLocaleString('vi-VN') : '-';
                  const onlineDuration = formatOnlineDuration(row.online_seconds || 0);
                  return entries.map((entry) => {
                    const codeLabel = String(entry.code || row.current_code || row.codeTag || '').trim() || '-';
                    const taskLabel = String(entry.task || row.current_task || row.effect || row.description || row.title || '').trim() || '-';
                    return `<tr>
                      <td>${displayName}</td>
                      <td><span class="badge badge-blue">${String(row.role || 'staff')}</span></td>
                      <td style="font-weight:700;color:var(--brand)">${codeLabel}</td>
                      <td>${taskLabel}</td>
                      <td style="font-size:11px">${shiftStarted}</td>
                      <td>${onlineDuration}</td>
                      <td><span class="badge badge-green">online</span></td>
                    </tr>`;
                  });
                }).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ${shiftConfigCard}
    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <div class="card-title"><i class="fa-solid fa-list"></i> Queue ch\u1EDD duy\u1EC7t (${queue.length})</div>
          <button class="btn-success btn-sm" onclick="approveAll()"><i class="fa-solid fa-check-double"></i> Approve All</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;max-height:420px;overflow-y:auto" id="qcQueue">
          ${queue.length === 0 ? '<div style="padding:20px;text-align:center;color:var(--muted)">Kh\u00F4ng c\u00F3 m\u1EE5c ch\u1EDD duy\u1EC7t</div>' : queue.map((item, idx) => {
            const st = getStaff(item.staffId);
            return `
            <div class="output-card" onclick="selectQCItem(this, '${item.name}')" style="${idx===0 ? 'border-color:var(--brand);background:var(--brand-dim);' : ''}cursor:pointer">
              <div class="output-thumb"><i class="fa-solid ${item.type==='video'?'fa-film':'fa-image'}" style="color:${item.type==='video'?'var(--brand)':'var(--blue)'}"></i></div>
              <div style="flex:1;min-width:0">
                <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.name}</div>
                <div style="font-size:11px;color:var(--muted);margin-top:2px">${st.name} \u00B7 ${item.codeTag}</div>
                <div style="margin-top:4px">
                  <span class="badge badge-yellow" style="font-size:10px"><i class="fa-solid fa-clock"></i> Ch\u1EDD duy\u1EC7t</span>
                  <span style="font-size:10px;color:var(--yellow);margin-left:6px">${item.credits} cr</span>
                </div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title"><i class="fa-solid fa-eye"></i> Preview</div>
          <span class="badge badge-orange" id="previewName">${previewItem ? previewItem.name : 'N/A'}</span>
        </div>
        <div style="width:100%;aspect-ratio:16/9;background:var(--bg2);border-radius:8px;display:flex;align-items:center;justify-content:center;margin-bottom:12px;border:1px solid var(--border)">
          <div style="text-align:center;color:var(--muted)">
            <i class="fa-solid fa-play-circle" style="font-size:48px;display:block;margin-bottom:8px;color:var(--brand)"></i>
            <div style="font-size:13px">${previewItem ? previewItem.name : 'Ch\u1EDDn item d? preview'}</div>
            <div style="font-size:11px;color:var(--muted2)">Model: ${AppData.model.name}</div>
          </div>
        </div>
        <div style="padding:12px;background:var(--bg2);border-radius:8px;margin-bottom:12px">
          <div style="font-size:12px;color:var(--muted);margin-bottom:6px">Th\u00F4ng tin s\u1EA3n ph\u1EA9m</div>
          ${previewItem ? [
            ['Staff', previewStaff ? previewStaff.name : 'N/A'],
            ['Model', AppData.model.name],
            ['Credits', previewItem.credits + ' cr'],
            ['CODE', previewItem.codeTag]
          ].map(r => `
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
              <span style="color:var(--muted)">${r[0]}</span><span${r[0]==='Credits'?' style="color:var(--yellow)"':''}>${r[1]}</span>
            </div>
          `).join('') : '<div style="color:var(--muted);font-size:12px">Kh\u00F4ng c\u00F3 item</div>'}
        </div>
        <div class="form-group">
          <label>Nh\u1EADn x\u00E9t QC (t\u00F9y ch\u1ECDn)</label>
          <textarea class="form-textarea" placeholder="G\u00F3p \u00FD v\u1EC1 ch\u1EA5t l\u01B0\u1EE3ng video..." style="height:60px" id="qcComment"></textarea>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn-success" style="flex:1" onclick="approveItem()"><i class="fa-solid fa-check"></i> Approve</button>
          <button class="btn-danger" style="flex:1" onclick="rejectItem()"><i class="fa-solid fa-xmark"></i> Reject</button>
          <button class="btn-ghost btn-sm" onclick="sendTelegramReview()"><i class="fab fa-telegram"></i></button>
        </div>
      </div>
    </div>
  `;

}

function buildQCShiftConfigCard() {
  const templates = getShiftTemplates();
  const rows = [
    ['morning', templates.morning],
    ['afternoon', templates.afternoon],
    ['evening', templates.evening],
  ];
  return `
    <div class="card" style="margin-bottom:20px">
      <div class="card-header">
        <div class="card-title"><i class="fa-solid fa-business-time"></i> C\u1EA5u h\u00ECnh ca</div>
        <button class="btn-primary btn-sm" onclick="saveShiftConfigFromQC()"><i class="fa-solid fa-save"></i> L\u01B0u c\u1EA5u h\u00ECnh ca</button>
      </div>
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Ca</th><th>T\u00EAn hi\u1EC3n th\u1ECB</th><th>B\u1EAFt \u0111\u1EA7u</th><th>K\u1EBFt th\u00FAc</th></tr></thead>
          <tbody>
            ${rows.map(([key, row]) => `
              <tr>
                <td style="font-weight:600">${key}</td>
                <td><input id="shift-${key}-label" class="form-input" value="${String(row.label || '').replace(/"/g, '&quot;')}" placeholder="T\u00EAn ca"></td>
                <td><input id="shift-${key}-start" class="form-input" value="${String(row.start || '').replace(/"/g, '&quot;')}" placeholder="08:30"></td>
                <td><input id="shift-${key}-end" class="form-input" value="${String(row.end || '').replace(/"/g, '&quot;')}" placeholder="17:00"></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div style="margin-top:10px;font-size:12px;color:var(--muted)">QC manager ho\u1EB7c admin ch\u1EC9nh th\u1EDDi gian ca t\u1EA1i \u0111\u00E2y. Dashboard staff s\u1EBD d\u00F9ng tr\u1EF1c ti\u1EBFp c\u1EA5u h\u00ECnh n\u00E0y.</div>
    </div>
  `;
}

async function saveShiftConfigFromQC() {
  const role = String(AppData.currentUser?.role || '').toLowerCase();
  if (!['admin', 'qc_manager'].includes(role)) {
    showToast('B\u1EA1n kh\u00F4ng c\u00F3 quy\u1EC1n ch\u1EC9nh c\u1EA5u h\u00ECnh ca', 'error');
    return;
  }
  const payload = {
    morning: {
      label: String(document.getElementById('shift-morning-label')?.value || '').trim(),
      start: String(document.getElementById('shift-morning-start')?.value || '').trim(),
      end: String(document.getElementById('shift-morning-end')?.value || '').trim(),
    },
    afternoon: {
      label: String(document.getElementById('shift-afternoon-label')?.value || '').trim(),
      start: String(document.getElementById('shift-afternoon-start')?.value || '').trim(),
      end: String(document.getElementById('shift-afternoon-end')?.value || '').trim(),
    },
    evening: {
      label: String(document.getElementById('shift-evening-label')?.value || '').trim(),
      start: String(document.getElementById('shift-evening-start')?.value || '').trim(),
      end: String(document.getElementById('shift-evening-end')?.value || '').trim(),
    },
  };
  if (Object.values(payload).some((row) => !row.label || !row.start || !row.end)) {
    showToast('Thi\u1EBFu th\u00F4ng tin c\u1EA5u h\u00ECnh ca', 'error');
    return;
  }
  try {
    const res = await API.saveShiftConfig(payload);
    AppData.shiftConfig = res?.shift_templates || payload;
    buildQC();
    showToast('\u0110\u00E3 l\u01B0u c\u1EA5u h\u00ECnh ca', 'success');
  } catch (err) {
    showToast(err?.message || 'Kh\u00F4ng l\u01B0u \u0111\u01B0\u1EE3c c\u1EA5u h\u00ECnh ca', 'error');
  }
}

// ---- HR & KPI SCREEN ----
function buildHR() {
  const el = document.getElementById('hrContent');
  el.innerHTML = `
    <div class="section-header">
      <div class="section-title"><i class="fa-solid fa-users"></i> HR & KPI Management</div>
      <button class="btn-primary btn-sm" onclick="addStaff()"><i class="fa-solid fa-user-plus"></i> Th\u00EAm nh\u00E2n vi\u00EAn</button>
    </div>
    <div class="tab-bar" id="hrTabBar">
      <button class="tab-btn ${currentHRTab === 'staff' ? 'active' : ''}" onclick="switchHRTab('staff', this)"><i class="fa-solid fa-users"></i> Nh\u00E2n vi\u00EAn</button>
      <button class="tab-btn ${currentHRTab === 'kpi' ? 'active' : ''}" onclick="switchHRTab('kpi', this)"><i class="fa-solid fa-chart-bar"></i> KPI</button>
      <button class="tab-btn ${currentHRTab === 'budget' ? 'active' : ''}" onclick="switchHRTab('budget', this)"><i class="fa-solid fa-coins"></i> Ng\u00E2n s\u00E1ch</button>
      <button class="tab-btn ${currentHRTab === 'eval' ? 'active' : ''}" onclick="switchHRTab('eval', this)"><i class="fa-solid fa-star"></i> \u0110\u00E1nh gi\u00E1</button>
    </div>
    <div id="hrTab-staff" style="display:${currentHRTab === 'staff' ? 'block' : 'none'}">${buildStaffSection()}</div>
    <div id="hrTab-kpi" style="display:${currentHRTab === 'kpi' ? 'block' : 'none'}">${buildKPITab()}</div>
    <div id="hrTab-budget" style="display:${currentHRTab === 'budget' ? 'block' : 'none'}">${buildBudgetTab()}</div>
    <div id="hrTab-eval" style="display:${currentHRTab === 'eval' ? 'block' : 'none'}">${buildEvalTab()}</div>
  `;
}

function setDashboardView(mode, btn) {
  dashboardViewMode = mode;
  document.querySelectorAll('.db-filter-btn').forEach((el) => el.classList.remove('active'));
  if (btn) btn.classList.add('active');
  buildDashboard();
}

function setDashboardFilter(field, value) {
  dashboardFilters[field] = String(value || '').trim();
  dashboardViewMode =
    field === 'period' ? dashboardFilters.period :
    field === 'group' && dashboardFilters.group ? 'groups' :
    field === 'user' && dashboardFilters.user ? 'users' :
    field === 'month' && dashboardFilters.month ? 'month' :
    dashboardFilters.period || 'today';
  buildDashboard();
}

function refreshDashboardView() {
  buildDashboard();
  if (typeof showToast === 'function') showToast('\u0110\u00E3 l\u00E0m m\u1EDBi Dashboard', 'success');
}

function resetDashboardLayout() {
  dashboardViewMode = 'today';
  buildDashboard();
  if (typeof showToast === 'function') showToast('\u0110\u00E3 reset layout Dashboard', 'success');
}

function exportDashboardCsv() {
  const scopedItems = filterDashboardItems(dashboardFilters);
  const rows = dashboardViewMode === 'groups'
    ? [
        ['code_tag', 'total_media', 'approved', 'pending', 'rejected', 'credits_used'],
        ...getCodeKPIForItems(scopedItems).map((g) => [g.codeTag, g.totalMedia, g.approved, g.pending, g.rejected, g.creditsUsed]),
      ]
    : [
        ['name', 'role', 'total_media', 'approved', 'pending', 'rejected', 'credits_used', 'qc_pass_rate'],
        ...getStaffKPIForItems(scopedItems).map((s) => [
          s.name,
          s.role,
          s.totalMedia,
          s.approved + s.done,
          s.pending,
          s.rejected,
          s.creditsUsed,
          s.qcPassRate,
        ]),
      ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dashboard-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function updateStaffFilters(field, value) {
  staffFilters[field] = String(value || '').trim();
  buildHR();
  const activeBtn = document.querySelector(`#hrTabBar .tab-btn[onclick*="'${currentHRTab}'"]`);
  if (activeBtn) switchHRTab(currentHRTab, activeBtn);
}

function buildStaffSection() {
  const staffKPI = filterStaffKPI(staffFilters);
  const online = staffKPI.filter(s => s.status === 'online').length;
  const avgKPI = staffKPI.length > 0 ? Math.round(staffKPI.reduce((s, k) => s + k.kpiScore, 0) / staffKPI.length) : 0;
  const totalCredits = getCreditSummary().used;
  const stColors = { online:'var(--green)', away:'var(--yellow)', offline:'var(--muted)' };
  const roleMap = { staff:'badge-blue', qc_manager:'badge-orange', admin:'badge-red' };
  const canManageUsers = !!(Array.isArray(AppData.currentUser?.permissions) && AppData.currentUser.permissions.includes('manage_users'));

  return `
    <div class="grid-4" style="margin-bottom:20px">
      <div class="stat-card"><div class="stat-icon blue"><i class="fa-solid fa-users"></i></div><div class="stat-value">${staffKPI.length}</div><div class="stat-label">T\u1ED5ng nh\u00E2n vi\u00EAn</div></div>
      <div class="stat-card"><div class="stat-icon green"><i class="fa-solid fa-circle-check"></i></div><div class="stat-value">${online}</div><div class="stat-label">\u0110ang active</div></div>
      <div class="stat-card"><div class="stat-icon orange"><i class="fa-solid fa-chart-line"></i></div><div class="stat-value">${avgKPI}%</div><div class="stat-label">KPI trung b\u00ECnh</div></div>
      <div class="stat-card"><div class="stat-icon yellow"><i class="fa-solid fa-coins"></i></div><div class="stat-value">${totalCredits.toLocaleString()} cr</div><div class="stat-label">Credit \u0111\u00E3 d\u00F9ng</div></div>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title"><i class="fa-solid fa-table"></i> Danh s\u00E1ch nh\u00E2n vi\u00EAn</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <input type="text" class="form-input" placeholder="T\u00ECm ki\u1EBFm..." style="width:180px;font-size:12px" value="${staffFilters.query || ''}" oninput="updateStaffFilters('query', this.value)">
          <select class="form-select" style="width:auto;font-size:12px" onchange="updateStaffFilters('role', this.value)">
            <option value="">T\u1EA5t c\u1EA3 role</option>
            <option value="staff" ${staffFilters.role === 'staff' ? 'selected' : ''}>staff</option>
            <option value="qc_manager" ${staffFilters.role === 'qc_manager' ? 'selected' : ''}>qc_manager</option>
            <option value="admin" ${staffFilters.role === 'admin' ? 'selected' : ''}>admin</option>
          </select>
          <select class="form-select" style="width:auto;font-size:12px" onchange="updateStaffFilters('status', this.value)">
            <option value="">T\u1EA5t c\u1EA3 status</option>
            <option value="online" ${staffFilters.status === 'online' ? 'selected' : ''}>online</option>
            <option value="away" ${staffFilters.status === 'away' ? 'selected' : ''}>away</option>
            <option value="offline" ${staffFilters.status === 'offline' ? 'selected' : ''}>offline</option>
          </select>
        </div>
      </div>
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Nh\u00E2n vi\u00EAn</th><th>Role</th><th>Media</th><th>KPI</th><th>Credits d\u00F9ng</th><th>QC Pass</th><th>Tr\u1EA1ng th\u00E1i</th><th>Action</th></tr></thead>
          <tbody>
            ${staffKPI.map((s,i) => `<tr>
              <td><div style="display:flex;align-items:center;gap:8px"><div class="role-avatar" style="background:${s.color};width:28px;height:28px;font-size:11px">${s.avatar}</div><span style="font-weight:500">${s.name}</span><div style="width:7px;height:7px;border-radius:50%;background:${stColors[s.status]}"></div></div></td>
              <td><span class="badge ${roleMap[s.role] || 'badge-blue'}">${s.role}</span></td>
              <td>${s.totalMedia}</td>
              <td><div style="display:flex;align-items:center;gap:8px"><div class="progress-bar" style="width:70px;height:5px"><div class="progress-fill ${s.kpiScore>=90?'green':s.kpiScore>=75?'orange':'red'}" style="width:${s.kpiScore}%"></div></div><span style="font-size:12px;font-weight:600;color:${s.kpiScore>=90?'var(--green)':s.kpiScore>=75?'var(--brand)':'var(--red)'}">${s.kpiScore}%</span></div></td>
              <td style="color:var(--yellow)">${s.creditsUsed} cr</td>
              <td><span style="color:${s.qcPassRate>=90?'var(--green)':s.qcPassRate>=80?'var(--brand)':'var(--red)'}">${s.qcPassRate}%</span></td>
              <td><span class="badge ${s.status==='online'?'badge-green':s.status==='away'?'badge-yellow':'badge-gray'}">${s.status}</span></td>
              <td><div style="display:flex;gap:4px"><button class="btn-ghost btn-sm" style="padding:4px 8px" onclick="viewStaff('${s.id}')"><i class="fa-solid fa-eye"></i></button><button class="btn-ghost btn-sm" style="padding:4px 8px" onclick="editStaff('${s.id}')"><i class="fa-solid fa-pen"></i></button>${canManageUsers ? `<button class="btn-ghost btn-sm" style="padding:4px 8px;color:var(--red)" onclick="deleteStaff('${s.id}')"><i class="fa-solid fa-trash"></i></button>` : ''}</div></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function buildKPITab() {
  const staffKPI = getAllStaffKPI();
  const totalVideos = staffKPI.reduce((s, k) => s + k.videoCount, 0);
  const totalImages = staffKPI.reduce((s, k) => s + k.imageCount, 0);
  const totalEdits = staffKPI.reduce((s, k) => s + k.editedCount, 0);
  const totalCredits = staffKPI.reduce((s, k) => s + k.creditsUsed, 0);
  const avgQC = staffKPI.length > 0 ? Math.round(staffKPI.reduce((s, k) => s + k.qcPassRate, 0) / staffKPI.length) : 0;

  return '<div class="grid-2" style="margin-bottom:16px">' +
      '<div class="card">' +
        '<div class="card-title" style="margin-bottom:14px"><i class="fa-solid fa-chart-column"></i> KPI t\u1ED5ng h\u1EE3p th\u1EF1c t\u1EBF</div>' +
        '<div class="grid-2" style="gap:12px">' +
          '<div class="stat-card"><div class="stat-value">' + totalVideos + '</div><div class="stat-label">Video \u0111\u00E3 t\u1EA1o</div></div>' +
          '<div class="stat-card"><div class="stat-value">' + totalImages + '</div><div class="stat-label">\u1EA2nh \u0111\u00E3 t\u1EA1o</div></div>' +
          '<div class="stat-card"><div class="stat-value">' + totalEdits + '</div><div class="stat-label">\u1EA2nh \u0111\u00E3 ch\u1EC9nh s\u1EEDa</div></div>' +
          '<div class="stat-card"><div class="stat-value">' + avgQC + '%</div><div class="stat-label">QC pass trung b\u00ECnh</div></div>' +
          '<div class="stat-card"><div class="stat-value">' + totalCredits.toLocaleString() + ' cr</div><div class="stat-label">Credits \u0111\u00E3 d\u00F9ng</div></div>' +
          '<div class="stat-card"><div class="stat-value">' + staffKPI.length + '</div><div class="stat-label">Nh\u00E2n s\u1EF1 c\u00F3 d\u1EEF li\u1EC7u</div></div>' +
        '</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-title" style="margin-bottom:14px"><i class="fa-solid fa-chart-line"></i> KPI c\u00E1 nh\u00E2n</div>' +
        '<canvas id="kpiChart" height="220"></canvas>' +
      '</div>' +
    '</div>' +
    '<div class="card">' +
      '<div class="card-title" style="margin-bottom:14px"><i class="fa-solid fa-table"></i> Chi ti\u1EBFt KPI</div>' +
      '<div class="table-wrapper"><table>' +
        '<thead><tr><th>Staff</th><th>Video</th><th>\u1EA2nh edit</th><th>QC Pass</th><th>Credits</th><th>\u0110i\u1EC3m KPI</th></tr></thead>' +
        '<tbody>' +
          staffKPI.map((s) => '<tr><td style="font-weight:500">' + s.name + '</td><td>' + s.videoCount + '</td><td>' + s.editedCount + '</td><td><span style="color:' + (s.qcPassRate >= 90 ? 'var(--green)' : 'var(--brand)') + '">' + s.qcPassRate + '%</span></td><td style="color:var(--yellow)">' + s.creditsUsed + ' cr</td><td><span class="badge ' + (s.kpiScore >= 90 ? 'badge-green' : s.kpiScore >= 80 ? 'badge-orange' : 'badge-red') + '">' + s.kpiScore + '/100</span></td></tr>').join('') +
        '</tbody>' +
      '</table></div>' +
    '</div>';
}

function buildBudgetTab() {
  const scopeUser = String(getScopeUsername() || '').trim();
  const historyRows = (Array.isArray(AppData.activityHistory) ? AppData.activityHistory : []).filter((row) => {
    if (scopeUser && String(row.user_name || '').trim() !== scopeUser) return false;
    const source = String(row.source || '').toLowerCase();
    const action = String(row.action || row.status || '').toLowerCase();
    const provider = String(row.provider || '').toLowerCase();
    return source === 'task' || Number(row.credit_used || 0) > 0 || action.includes('credit') || action.includes('budget') || provider.includes('credit');
  }).sort((a, b) => String(b.created_at || b.createdAt || '').localeCompare(String(a.created_at || a.createdAt || '')));
  const totalCreditUsed = historyRows.reduce((sum, row) => sum + Number(row.credit_used || 0), 0);
  const latestAt = historyRows.length > 0 ? String(historyRows[0].created_at || historyRows[0].createdAt || '') : '';

  return '<div class="grid-3" style="margin-bottom:20px">' +
      '<div class="stat-card"><div class="stat-icon yellow"><i class="fa-solid fa-wallet"></i></div><div class="stat-value">' + historyRows.length + '</div><div class="stat-label">B\u1EA3n ghi credit/budget</div></div>' +
      '<div class="stat-card"><div class="stat-icon orange"><i class="fa-solid fa-chart-pie"></i></div><div class="stat-value">' + totalCreditUsed.toLocaleString() + ' cr</div><div class="stat-label">Credits \u0111\u00E3 d\u00F9ng</div></div>' +
      '<div class="stat-card"><div class="stat-icon green"><i class="fa-solid fa-calendar-check"></i></div><div class="stat-value">' + (latestAt || '-') + '</div><div class="stat-label">C\u1EADp nh\u1EADt g\u1EA7n nh\u1EA5t</div></div>' +
    '</div>' +
    '<div class="card">' +
      '<div class="card-title" style="margin-bottom:14px"><i class="fa-solid fa-history"></i> L\u1ECBch s\u1EED credit / budget t\u1EEB server</div>' +
      '<div class="table-wrapper"><table>' +
        '<thead><tr><th>Th\u1EDDi gian</th><th>Ng\u01B0\u1EDDi d\u00F9ng</th><th>Action</th><th>Chi ti\u1EBFt</th><th>Credit</th><th>Provider</th></tr></thead>' +
        '<tbody>' +
          (historyRows.length === 0
            ? '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:14px">Ch\u01B0a c\u00F3 l\u1ECBch s\u1EED credit/budget t\u1EEB server</td></tr>'
            : historyRows.map((row) => '<tr><td>' + (row.created_at || row.createdAt || '-') + '</td><td>' + (row.user_display || row.user_name || row.staff_id || '-') + '</td><td>' + (row.action || row.status || '-') + '</td><td>' + (row.detail || row.details || row.note || row.message || row.prompt || '-') + '</td><td style="color:var(--yellow)">' + Number(row.credit_used || 0) + ' cr</td><td>' + (row.provider || '-') + '</td></tr>').join('')) +
        '</tbody>' +
      '</table></div>' +
    '</div>';
}

function buildEvalTab() {
  const staffKPI = getAllStaffKPI().sort((a, b) => b.kpiScore - a.kpiScore);

  function getGrade(score) {
    if (score >= 95) return 'A+';
    if (score >= 90) return 'A';
    if (score >= 85) return 'B+';
    if (score >= 80) return 'B';
    if (score >= 75) return 'B-';
    if (score >= 70) return 'C+';
    return 'C';
  }

  return '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-title" style="margin-bottom:14px"><i class="fa-solid fa-star"></i> \u0110\u00E1nh gi\u00E1 nh\u00E2n vi\u00EAn - Th\u00E1ng ' + String(new Date().getMonth() + 1).padStart(2, '0') + '/' + new Date().getFullYear() + '</div>' +
      '<div style="display:flex;flex-direction:column;gap:12px">' +
        staffKPI.map((s) => '<div style="padding:14px;background:var(--bg2);border-radius:8px;border:1px solid var(--border)">' +
            '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">' +
              '<div class="role-avatar" style="background:' + s.color + ';width:36px;height:36px;font-size:14px">' + s.avatar + '</div>' +
              '<div style="flex:1"><div style="font-weight:600">' + s.name + '</div><div style="font-size:11px;color:var(--muted)">' + s.videoCount + ' videos | ' + s.editedCount + ' edits | QC ' + s.qcPassRate + '% | ' + s.creditsUsed + ' cr</div></div>' +
              '<div style="text-align:center"><div style="font-size:24px;font-weight:800;color:' + (s.kpiScore >= 90 ? 'var(--green)' : s.kpiScore >= 80 ? 'var(--brand)' : 'var(--yellow)') + '">' + getGrade(s.kpiScore) + '</div><div style="font-size:11px;color:var(--muted)">' + s.kpiScore + '/100</div></div>' +
            '</div>' +
            '<div style="font-size:12px;color:var(--muted)">Video: ' + s.videoCount + ' | \u1EA2nh edit: ' + s.editedCount + ' | QC pass: ' + s.qcPassRate + '% | Credits: ' + s.creditsUsed + ' cr</div>' +
            '<div class="progress-bar" style="margin-top:8px"><div class="progress-fill ' + (s.kpiScore >= 90 ? 'green' : 'orange') + '" style="width:' + s.kpiScore + '%"></div></div>' +
          '</div>').join('') +
      '</div>' +
    '</div>';
}

async function buildCreditsScreen() {
  const el = document.getElementById('creditsContent');
  if (!el) return;
  const role = String(AppData.currentUser?.role || '').toLowerCase();
  const isAdmin = role === 'admin';
  let balanceP1 = 0;
  let balanceP2 = '-';
  let providerCatalog = { default_provider: 'provider1', default_models: { provider1: 'kling25_turbo_pro', provider2: 'kling25_turbo' }, kie_credit_package: 'usd50_10000', kie_credit_packages: [], providers: [] };
  let activeTasks = [];
  try {
    const [p1Res, p2Res, catalogRes, activeTasksRes] = await Promise.all([
      API.getCreditBalance(),
      API.getProviderCredits('provider2'),
      API.getProviderCatalog(),
      API.getActiveTasks(),
    ]);
    balanceP1 = Number(p1Res?.credits || 0);
    if (typeof p2Res?.total === 'number') balanceP2 = `$${Number(p2Res.total).toFixed(2)}`;
    else if (typeof p2Res?.total === 'string' && p2Res.total.trim()) balanceP2 = p2Res.total.trim();
    providerCatalog = catalogRes && Array.isArray(catalogRes.providers) ? catalogRes : providerCatalog;
    activeTasks = Array.isArray(activeTasksRes) ? activeTasksRes : [];
    AppData.providerCatalog = providerCatalog;
    AppData.providerSettings = {
      default_provider: String(providerCatalog.default_provider || AppData.providerSettings?.default_provider || 'provider1').trim().toLowerCase() || 'provider1',
      default_models: (providerCatalog && typeof providerCatalog.default_models === 'object' && providerCatalog.default_models) ? providerCatalog.default_models : (AppData.providerSettings?.default_models || { provider1: 'kling25_turbo_pro', provider2: 'kling25_turbo' }),
      kie_credit_package: String(providerCatalog.kie_credit_package || AppData.providerSettings?.kie_credit_package || 'usd50_10000').trim().toLowerCase() || 'usd50_10000',
      provider2_endpoint: String((providerCatalog.providers.find((p) => p.id === 'provider2')?.endpoints?.create_task) || AppData.providerSettings?.provider2_endpoint || 'https://api.piapi.ai/api/v1/task').trim() || 'https://api.piapi.ai/api/v1/task',
    };
  } catch (_) {}
  const scopeUser = String(getScopeUsername() || '').trim();
  const historyRows = (Array.isArray(AppData.activityHistory) ? AppData.activityHistory : []).filter((row) => {
    if (scopeUser && String(row.user_name || '').trim() !== scopeUser) return false;
    const source = String(row.source || '').toLowerCase();
    const action = String(row.action || row.status || '').toLowerCase();
    const provider = String(row.provider || '').toLowerCase();
    return source === 'task' || Number(row.credit_used || 0) > 0 || action.includes('credit') || action.includes('key') || action.includes('budget') || provider.includes('credit');
  }).sort((a, b) => String(b.created_at || b.createdAt || '').localeCompare(String(a.created_at || a.createdAt || '')));
  const providers = Array.isArray(providerCatalog.providers) ? providerCatalog.providers : [];
  const pricingRows = providers.flatMap((provider) => (Array.isArray(provider.models) ? provider.models : []).map((model) => ({ provider, model })));
  const scenarioCounts = [100, 500, 1000, 2000];
  const kiePackages = Array.isArray(providerCatalog.kie_credit_packages) ? providerCatalog.kie_credit_packages : [];
  const selectedKiePackageId = String(AppData.providerSettings?.kie_credit_package || providerCatalog.kie_credit_package || 'usd50_10000').trim().toLowerCase() || 'usd50_10000';
  const selectedKiePackage = kiePackages.find((pkg) => String(pkg.id || '').trim().toLowerCase() === selectedKiePackageId) || kiePackages[0] || null;

  function formatCostValue(value, unit) {
    const num = Number(value || 0);
    return String(unit || '').toLowerCase() === 'usd' ? `$${num.toFixed(2)}` : `${num.toLocaleString()} cr`;
  }
  function convertCreditsToUsd(value) {
    if (!selectedKiePackage) return '-';
    return `$${(Number(value || 0) * Number(selectedKiePackage.usd_per_credit || 0)).toFixed(2)}`;
  }
  function providerLabel(providerId) {
    if (providerId === 'provider2') return 'Server 2';
    if (providerId === 'provider1') return 'Server 1';
    return providerId || '-';
  }
  function stopSupportLabel(provider) {
    return provider?.supports_cancel ? 'C\u00F3' : 'Kh\u00F4ng';
  }

  el.innerHTML = `
    <div class="section-header">
      <div class="section-title"><i class="fa-solid fa-wallet"></i> Credit & Budget</div>
      <div style="display:flex;gap:8px">
        <button class="btn-secondary btn-sm" onclick="refreshSidebarCredits();loadDataFromAPI().then(()=>buildCreditsScreen())"><i class="fa-solid fa-refresh"></i> L\u00E0m m\u1EDBi</button>
      </div>
    </div>
    <div class="grid-3" style="margin-bottom:20px">
      <div class="stat-card"><div class="stat-icon yellow"><i class="fa-solid fa-coins"></i></div><div class="stat-value">${balanceP1.toLocaleString()}</div><div class="stat-label">P1 Credits hi\u1EC7n t\u1EA1i</div></div>
      <div class="stat-card"><div class="stat-icon blue"><i class="fa-brands fa-bitcoin"></i></div><div class="stat-value">${balanceP2}</div><div class="stat-label">P2 Budget hi\u1EC7n t\u1EA1i</div></div>
      <div class="stat-card"><div class="stat-icon orange"><i class="fa-solid fa-chart-line"></i></div><div class="stat-value">${historyRows.length}</div><div class="stat-label">L\u1ECBch s\u1EED credit/budget</div></div>
    </div>
    ${isAdmin ? `<div class="grid-2" style="margin-bottom:20px">
      <div class="card">
        <div class="card-title" style="margin-bottom:14px"><i class="fa-solid fa-server"></i> Default Video Server</div>
        <div class="form-group"><label>Server m\u1EB7c \u0111\u1ECBnh \u0111ang d\u00F9ng</label><select class="form-select" id="creditsDefaultProvider"><option value="provider1" ${AppData.providerSettings.default_provider === 'provider1' ? 'selected' : ''}>Server 1</option><option value="provider2" ${AppData.providerSettings.default_provider === 'provider2' ? 'selected' : ''}>Server 2</option></select></div>
        <div class="form-group"><label>Model m\u1EB7c \u0111\u1ECBnh Server 1</label><select class="form-select" id="creditsDefaultModelP1">${(providers.find((p) => p.id === 'provider1')?.models || []).map((model) => `<option value="${String(model.id || '').replace(/"/g, '&quot;')}" ${String(AppData.providerSettings?.default_models?.provider1 || '') === String(model.id || '') ? 'selected' : ''}>${model.label}</option>`).join('')}</select></div>
        <div class="form-group"><label>Model m\u1EB7c \u0111\u1ECBnh Server 2</label><select class="form-select" id="creditsDefaultModelP2">${(providers.find((p) => p.id === 'provider2')?.models || []).map((model) => `<option value="${String(model.id || '').replace(/"/g, '&quot;')}" ${String(AppData.providerSettings?.default_models?.provider2 || '') === String(model.id || '') ? 'selected' : ''}>${model.label}</option>`).join('')}</select></div>
        <div class="form-group"><label>G\u00F3i KIE d\u00F9ng \u0111\u1EC3 quy \u0111\u1ED5i credit -> USD</label><select class="form-select" id="creditsKiePackage">${kiePackages.map((pkg) => `<option value="${String(pkg.id || '').replace(/"/g, '&quot;')}" ${selectedKiePackageId === String(pkg.id || '').trim().toLowerCase() ? 'selected' : ''}>${pkg.label}</option>`).join('')}</select></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn-primary btn-sm" onclick="saveCreditsProviderDefault()"><i class="fa-solid fa-floppy-disk"></i> L\u01B0u c\u1EA5u h\u00ECnh m\u1EB7c \u0111\u1ECBnh</button></div>
        <div id="creditsProviderStatus" style="margin-top:10px;font-size:11px;color:var(--muted)">\u0110ang d\u00F9ng: ${providerLabel(AppData.providerSettings.default_provider)} | P1: ${AppData.providerSettings?.default_models?.provider1 || '-'} | P2: ${AppData.providerSettings?.default_models?.provider2 || '-'} | KIE package: ${selectedKiePackage?.label || '-'}</div>
      </div>
      <div class="card">
        <div class="card-title" style="margin-bottom:14px"><i class="fa-solid fa-link"></i> Schema Endpoint Th\u1EF1c T\u1EBF</div>
        <div class="table-wrapper"><table><thead><tr><th>Provider</th><th>Create Task</th><th>Get Task</th><th>Upload</th></tr></thead><tbody>${providers.map((provider) => `<tr><td>${providerLabel(provider.id)}</td><td style="font-size:11px;word-break:break-all">${provider.endpoints?.create_task || '-'}</td><td style="font-size:11px;word-break:break-all">${provider.endpoints?.get_task || '-'}</td><td style="font-size:11px;word-break:break-all">${provider.endpoints?.upload || '-'}</td></tr>`).join('')}</tbody></table></div>
      </div>
    </div>
    <div class="card" style="margin-bottom:20px">
      <div class="card-title" style="margin-bottom:14px"><i class="fa-solid fa-credit-card"></i> B\u1EA3ng G\u00F3i N\u1EA1p Credits KIE</div>
      <div class="table-wrapper"><table><thead><tr><th>G\u00F3i</th><th>USD</th><th>Credits</th><th>Bonus</th><th>USD / credit</th><th>Default</th></tr></thead><tbody>${kiePackages.map((pkg) => `<tr><td>${pkg.label}</td><td>$${Number(pkg.usd || 0).toFixed(2)}</td><td style="color:var(--yellow)">${Number(pkg.credits || 0).toLocaleString()}</td><td>${Number(pkg.bonus_pct || 0)}%</td><td>$${Number(pkg.usd_per_credit || 0).toFixed(6)}</td><td>${selectedKiePackageId === String(pkg.id || '').trim().toLowerCase() ? '<span class="badge badge-green">Default</span>' : ''}</td></tr>`).join('')}</tbody></table></div>
    </div>
    <div class="card" style="margin-bottom:20px">
      <div class="card-title" style="margin-bottom:14px"><i class="fa-solid fa-tags"></i> B\u1EA3ng Gi\u00E1 Provider / Model</div>
      <div class="table-wrapper"><table><thead><tr><th>Provider</th><th>Stop/Cancel</th><th>Model ID</th><th>Model</th><th>Version</th><th>Mode</th><th>Input</th><th>5 gi\u00E2y</th><th>10 gi\u00E2y</th><th>Quy \u0111\u1ED5i USD</th><th>\u0110\u01A1n v\u1ECB</th></tr></thead><tbody>${pricingRows.map(({ provider, model }) => `<tr><td>${providerLabel(provider.id)}</td><td><span class="badge ${provider.supports_cancel ? 'badge-green' : 'badge-red'}">${stopSupportLabel(provider)}</span></td><td><code>${model.id || '-'}</code></td><td>${model.label || '-'}</td><td>${model.version || '-'}</td><td>${model.mode || '-'}</td><td>${Array.isArray(model.input_types) ? model.input_types.join(', ') : '-'}</td><td style="color:var(--yellow)">${formatCostValue(model.cost_5s, model.unit)}</td><td style="color:var(--yellow)">${formatCostValue(model.cost_10s, model.unit)}</td><td>${String(model.unit || '').toLowerCase() === 'credits' ? `${convertCreditsToUsd(model.cost_5s)} / ${convertCreditsToUsd(model.cost_10s)}` : `${formatCostValue(model.cost_5s, 'usd')} / ${formatCostValue(model.cost_10s, 'usd')}`}</td><td>${model.unit || '-'}</td></tr>`).join('')}</tbody></table></div>
    </div>
    <div class="card" style="margin-bottom:20px">
      <div class="card-title" style="margin-bottom:14px"><i class="fa-solid fa-ban"></i> Kh\u1EA3 N\u0103ng Stop / Cancel Theo Provider</div>
      <div class="table-wrapper"><table><thead><tr><th>Provider</th><th>H\u1ED7 tr\u1EE3 cancel upstream</th><th>H\u00E0nh vi th\u1EF1c t\u1EBF</th></tr></thead><tbody>${providers.map((provider) => `<tr><td>${providerLabel(provider.id)}</td><td><span class="badge ${provider.supports_cancel ? 'badge-green' : 'badge-red'}">${provider.supports_cancel ? 'C\u00F3' : 'Kh\u00F4ng'}</span></td><td style="max-width:420px;white-space:normal">${provider.supports_cancel ? 'G\u1ECDi upstream cancel th\u1EADt, ch\u1EC9 khi upstream OK m\u1EDBi \u0111\u1ED5i tr\u1EA1ng th\u00E1i local sang cancelled.' : 'Kh\u00F4ng c\u00F3 endpoint cancel upstream trong integration hi\u1EC7n t\u1EA1i. H\u1EC7 th\u1ED1ng kh\u00F4ng \u0111\u00E1nh d\u1EA5u cancelled gi\u1EDD.'}</td></tr>`).join('')}</tbody></table></div>
    </div>
    <div class="card" style="margin-bottom:20px">
      <div class="card-title" style="margin-bottom:14px"><i class="fa-solid fa-list-check"></i> Task \u0110ang Ch\u1EA1y V\u00E0 Kh\u1EA3 N\u0103ng Stop</div>
      <div class="table-wrapper"><table><thead><tr><th>Task ID</th><th>User</th><th>Provider</th><th>Model</th><th>Chi ph\u00ED</th><th>Stop/Cancel</th><th>Thao t\u00E1c</th></tr></thead><tbody>${activeTasks.length === 0 ? '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:14px">Kh\u00F4ng c\u00F3 task \u0111ang ch\u1EA1y</td></tr>' : activeTasks.map((row) => { const provider = providers.find((p) => p.id === row.provider) || {}; const modelText = row.model_label || row.model_id || '-'; const costUnit = row.cost_unit || (String(row.provider || '').toLowerCase() === 'provider2' ? 'USD' : 'credits'); const costText = formatCostValue(row.credit_used, costUnit); const canStop = !!provider.supports_cancel; const stopHint = canStop ? 'D\u1EEBng task n\u00E0y tr\u00EAn upstream' : 'Server n\u00E0y kh\u00F4ng h\u1ED7 tr\u1EE3 cancel upstream trong integration hi\u1EC7n t\u1EA1i'; return `<tr><td><code>${row.task_id || '-'}</code></td><td>${row.user_display || row.user_name || '-'}</td><td>${providerLabel(row.provider || '-')}</td><td>${modelText}</td><td style="color:var(--yellow)">${costText}${String(costUnit).toLowerCase() === 'credits' ? ` (${convertCreditsToUsd(row.credit_used)})` : ''}</td><td><span class="badge ${canStop ? 'badge-green' : 'badge-red'}" title="${stopHint}">${canStop ? 'C\u00F3 th\u1EC3 stop' : 'Kh\u00F4ng h\u1ED7 tr\u1EE3'}</span></td><td>${canStop ? `<button class="btn-danger btn-sm" onclick="stopTaskFromCredits('${String(row.task_id || '').replace(/'/g, '&#39;')}')"><i class="fa-solid fa-stop"></i> Stop</button>` : `<span style="font-size:11px;color:var(--muted)" title="${stopHint}">Kh\u00F4ng h\u1ED7 tr\u1EE3</span>`}</td></tr>`; }).join('')}</tbody></table></div>
    </div>
    <div class="card" style="margin-bottom:20px">
      <div class="card-title" style="margin-bottom:14px"><i class="fa-solid fa-calculator"></i> \u01AF\u1EDBc T\u00EDnh 100 / 500 / 1000 / 2000 Video</div>
      <div class="table-wrapper"><table><thead><tr><th>Provider</th><th>Model</th><th>5 gi\u00E2y / video</th><th>10 gi\u00E2y / video</th>${scenarioCounts.map((count) => `<th>${count} video (5s)</th><th>${count} video (10s)</th>`).join('')}</tr></thead><tbody>${pricingRows.map(({ provider, model }) => `<tr><td>${providerLabel(provider.id)}</td><td>${model.label || model.id || '-'}</td><td>${formatCostValue(model.cost_5s, model.unit)}${String(model.unit || '').toLowerCase() === 'credits' ? ` (${convertCreditsToUsd(model.cost_5s)})` : ''}</td><td>${formatCostValue(model.cost_10s, model.unit)}${String(model.unit || '').toLowerCase() === 'credits' ? ` (${convertCreditsToUsd(model.cost_10s)})` : ''}</td>${scenarioCounts.map((count) => `<td style="color:var(--yellow)">${formatCostValue(Number(model.cost_5s || 0) * count, model.unit)}${String(model.unit || '').toLowerCase() === 'credits' ? ` (${convertCreditsToUsd(Number(model.cost_5s || 0) * count)})` : ''}</td><td style="color:var(--yellow)">${formatCostValue(Number(model.cost_10s || 0) * count, model.unit)}${String(model.unit || '').toLowerCase() === 'credits' ? ` (${convertCreditsToUsd(Number(model.cost_10s || 0) * count)})` : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    </div>
    ` : ''}
    <div class="card">
      <div class="card-title" style="margin-bottom:14px"><i class="fa-solid fa-history"></i> L\u1ECBch s\u1EED ti\u00EAu th\u1EE5 / n\u1EA1p th\u00EAm</div>
      <div class="table-wrapper"><table><thead><tr><th>Th\u1EDDi gian</th><th>Ng\u01B0\u1EDDi d\u00F9ng</th><th>Action</th><th>Chi ti\u1EBFt</th><th>Model</th><th>Chi ph\u00ED</th><th>Provider</th></tr></thead><tbody>${historyRows.length === 0 ? '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:14px">Ch\u01B0a c\u00F3 l\u1ECBch s\u1EED credit/budget t\u1EEB server</td></tr>' : historyRows.map((row) => `<tr><td style="font-size:11px">${row.created_at || row.createdAt || '-'}</td><td>${row.user_display || row.user_name || row.staff_id || '-'}</td><td>${row.action || row.status || '-'}</td><td style="max-width:360px;white-space:normal">${row.detail || row.details || row.note || row.prompt || row.message || '-'}</td><td>${row.model_label || row.model_id || '-'}</td><td style="color:var(--yellow)">${formatCostValue(row.credit_used, row.cost_unit || (String(row.provider || '').toLowerCase() === 'provider2' ? 'USD' : 'credits'))}${String(row.cost_unit || '').toLowerCase() === 'credits' ? ` (${convertCreditsToUsd(row.credit_used)})` : ''}</td><td>${providerLabel(row.provider || '-')}</td></tr>`).join('')}</tbody></table></div>
    </div>
  `;
}

async function saveCreditsProviderDefault() {
  const role = String(AppData.currentUser?.role || '').toLowerCase();
  if (role !== 'admin') {
    if (typeof showToast === 'function') showToast('Ch\u1EC9 Admin \u0111\u01B0\u1EE3c l\u01B0u c\u1EA5u h\u00ECnh provider/model', 'error');
    return;
  }
  const providerEl = document.getElementById('creditsDefaultProvider');
  const modelP1El = document.getElementById('creditsDefaultModelP1');
  const modelP2El = document.getElementById('creditsDefaultModelP2');
  const kiePackageEl = document.getElementById('creditsKiePackage');
  const statusEl = document.getElementById('creditsProviderStatus');
  if (!providerEl || !statusEl) return;
  try {
    const defaultProvider = String(providerEl.value || 'provider1').trim().toLowerCase() || 'provider1';
    const payload = {
      default_provider: defaultProvider,
      default_models: {
        provider1: String(modelP1El?.value || AppData.providerSettings?.default_models?.provider1 || 'kling25_turbo_pro').trim() || 'kling25_turbo_pro',
        provider2: String(modelP2El?.value || AppData.providerSettings?.default_models?.provider2 || 'kling25_turbo').trim() || 'kling25_turbo',
      },
      kie_credit_package: String(kiePackageEl?.value || AppData.providerSettings?.kie_credit_package || 'usd50_10000').trim().toLowerCase() || 'usd50_10000',
    };
    const res = await API.saveProviderSettings(payload);
    AppData.providerSettings = {
      default_provider: String(res?.default_provider || defaultProvider).trim().toLowerCase() || 'provider1',
      default_models: (res && typeof res.default_models === 'object' && res.default_models) ? res.default_models : payload.default_models,
      kie_credit_package: String(res?.kie_credit_package || payload.kie_credit_package).trim().toLowerCase() || payload.kie_credit_package,
      provider2_endpoint: String(res?.provider2_endpoint || AppData.providerSettings?.provider2_endpoint || 'https://api.piapi.ai/api/v1/task').trim() || 'https://api.piapi.ai/api/v1/task',
    };
    statusEl.textContent = `\u0110ang d\u00F9ng: ${AppData.providerSettings.default_provider === 'provider2' ? 'Server 2' : 'Server 1'} | P1: ${AppData.providerSettings.default_models.provider1} | P2: ${AppData.providerSettings.default_models.provider2}`;
    if (typeof showToast === 'function') showToast('L\u01B0u c\u1EA5u h\u00ECnh provider/model th\u00E0nh c\u00F4ng', 'success');
    await loadDataFromAPI();
    await buildCreditsScreen();
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message || 'L\u01B0u c\u1EA5u h\u00ECnh provider/model th\u1EA5t b\u1EA1i', 'error');
  }
}

async function stopTaskFromCredits(taskId) {
  const id = String(taskId || '').trim();
  if (!id) return;
  try {
    const res = await API.stopTask(id);
    if (!res || !res.ok) throw new Error('Stop task th\u1EA5t b\u1EA1i');
    if (typeof showToast === 'function') showToast(res.message || '\u0110\u00E3 stop task', 'success');
    await loadDataFromAPI();
    await buildCreditsScreen();
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message || 'Stop task th\u1EA5t b\u1EA1i', 'error');
  }
}

// ---- LIBRARY SCREEN ----
function buildLibrary() {
  const el = document.getElementById('libraryContent');
  if (!el) return;
  const codeOptions = Array.from(new Set((AppData.library || []).map((item) => String(item.codeTag || '').trim()).filter(Boolean))).sort();
  const filteredItems = filterLibraryItems(libraryFilters);
  const visibleItems = filteredItems.slice(0, libraryFilters.limit);

  el.innerHTML = `
    <div class="section-header">
      <div class="section-title"><i class="fa-solid fa-photo-film"></i> Th\u01B0 vi\u1EC7n s\u1EA3n ph\u1EA9m</div>
      <div style="display:flex;gap:8px">
        <select class="form-select" style="width:auto;font-size:12px" onchange="setLibraryFilter('code', this.value)">
          <option value="">T\u1EA5t c\u1EA3 Code</option>
          ${codeOptions.map(code => `<option value="${code}" ${libraryFilters.code === code ? 'selected' : ''}>${code}</option>`).join('')}
        </select>
        <select class="form-select" style="width:auto;font-size:12px" onchange="setLibraryFilter('type', this.value)"><option value="">T\u1EA5t c\u1EA3 lo\u1EA1i</option><option value="video" ${libraryFilters.type === 'video' ? 'selected' : ''}>Video</option><option value="image" ${libraryFilters.type === 'image' ? 'selected' : ''}>\u1EA2nh</option></select>
        <select class="form-select" style="width:auto;font-size:12px" onchange="setLibraryFilter('status', this.value)"><option value="">T\u1EA5t c\u1EA3 tr\u1EA1ng th\u00E1i</option><option value="approved" ${libraryFilters.status === 'approved' ? 'selected' : ''}>Approved</option><option value="pending_qc" ${libraryFilters.status === 'pending_qc' ? 'selected' : ''}>Pending</option><option value="rejected" ${libraryFilters.status === 'rejected' ? 'selected' : ''}>Rejected</option><option value="done" ${libraryFilters.status === 'done' ? 'selected' : ''}>Done</option><option value="processing" ${libraryFilters.status === 'processing' ? 'selected' : ''}>Processing</option></select>
      </div>
    </div>
    <div class="grid-4" style="margin-bottom:16px">
      ${visibleItems.map(item => {
        const st = getStaff(item.staffId);
        const creditLabel = formatLibraryCredits(item.credits);
        const mediaType = String(item.type || item.mediaType || '').toLowerCase();
        const canView = !!item.resultUrl;
        const canSendQC = mediaType === 'video' && !!item.taskId && !!item.resultUrl && item.status !== 'pending_qc' && item.status !== 'processing';
        const statusMeta = item.status === 'approved'
          ? { cls: 'badge-green', icon: 'fa-check', label: 'Approved' }
          : item.status === 'rejected'
            ? { cls: 'badge-red', icon: 'fa-xmark', label: 'Rejected' }
            : item.status === 'pending_qc'
              ? { cls: 'badge-yellow', icon: 'fa-clock', label: 'Pending QC' }
              : { cls: 'badge-blue', icon: 'fa-circle-info', label: item.status };
        const thumbHtml = mediaType === 'image'
          ? (item.resultUrl
              ? `<img src="${item.resultUrl}" alt="${item.name}" style="width:100%;height:100%;object-fit:cover;display:block">`
              : `<i class="fa-solid fa-image"></i>`)
          : (item.resultUrl
              ? `<video src="${item.resultUrl}" preload="metadata" muted playsinline style="width:100%;height:100%;object-fit:cover;display:block"></video>`
              : `<i class="fa-solid fa-film"></i>`);
        return `
        <div class="media-card">
          <div class="media-thumb" style="background:var(--bg2);aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;color:${mediaType==='video'?'var(--brand)':'var(--blue)'};font-size:36px;overflow:hidden">${thumbHtml}</div>
          <div class="media-info">
            <div class="media-name" style="font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.name}</div>
            <div style="display:flex;justify-content:space-between;align-items:center"><span class="badge ${statusMeta.cls}" style="font-size:10px;display:inline-flex;align-items:center;gap:4px"><i class="fa-solid ${statusMeta.icon}"></i><span>${statusMeta.label}</span></span><span style="font-size:10px;color:var(--yellow)">${creditLabel}${creditLabel === '-' ? '' : ' cr'}</span></div>
            <div style="font-size:10px;color:var(--muted);margin-top:2px">${st.name} - ${item.codeTag || '-'}</div>
            <div class="media-actions-inline" style="display:flex;gap:6px;margin-top:6px">
              ${canView ? `<button class="btn-secondary btn-sm" style="font-size:10px;padding:4px 8px" onclick="event.stopPropagation();previewMedia('${String(item.name).replace(/'/g, '&#39;')}','${String(item.id).replace(/'/g, '&#39;')}')"><i class="fa-solid fa-eye"></i> Xem</button>` : ''}
              ${canSendQC ? `<button class="btn-primary btn-sm" style="font-size:10px;padding:4px 8px" onclick="event.stopPropagation();submitLibraryQCById('${String(item.id).replace(/'/g, '&#39;')}')"><i class="fa-brands fa-telegram"></i> G\u1EEDi QC</button>` : ''}
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>
    <div style="display:flex;justify-content:center;margin-top:12px">${filteredItems.length > visibleItems.length ? `<button class="btn-secondary" onclick="loadMoreLibraryItems()"><i class="fa-solid fa-ellipsis"></i> T\u1EA3i th\u00EAm</button>` : ''}</div>
  `;
}

async function submitLibraryQCById(itemId) {
  const item = AppData.library.find(i => String(i.id) === String(itemId));
  if (!item) return;
  if (!item.taskId || !item.resultUrl) {
    showToast('Thi\u1EBFu task_id ho\u1EB7c result_url', 'error');
    return;
  }
  try {
    const res = await API.submitQC({
      task_id: item.taskId,
      video_url: item.resultUrl,
      note: item.qcNote || '',
    });
    if (!res || !res.ok) throw new Error('Submit QC th\u1EA5t b\u1EA1i');
    item.status = 'pending_qc';
    item.qcStatus = 'pending_qc';
    buildLibrary();
    showToast(`\u0110\u00E3 g\u1EEDi QC: ${item.name || item.taskId}`, 'success');
  } catch (err) {
    showToast(`G\u1EEDi QC th\u1EA5t b\u1EA1i: ${err && err.message ? err.message : 'L\u1ED7i kh\u00F4ng x\u00E1c \u0111\u1ECBnh'}`, 'error');
  }
}

function setQCStaffFilter(staffId) {
  qcStaffFilter = String(staffId || '').trim();
  buildQC();
}

function setLibraryFilter(field, value) {
  libraryFilters[field] = String(value || '').trim();
  libraryFilters.limit = 8;
  buildLibrary();
}

function loadMoreLibraryItems() {
  libraryFilters.limit += 8;
  buildLibrary();
}

// ---- SETTINGS SCREEN ----
function buildSettings() {
  const el = document.getElementById('settingsContent');
  const isAdmin = String(AppData.currentUser?.role || '').toLowerCase() === 'admin';
  el.innerHTML = `
    <div class="section-title" style="margin-bottom:20px"><i class="fa-solid fa-gear"></i> Settings & Configuration</div>
    <div class="grid-2">
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="card">
          <div class="card-title" style="margin-bottom:14px"><i class="fa-brands fa-telegram"></i> Telegram Bot</div>
          <div class="form-group"><label>Bot Token</label><input class="form-input" id="settingsTelegramToken" placeholder="123456:ABC..." type="password"></div>
          <div class="form-group"><label>Admin Chat ID</label><input class="form-input" id="settingsTelegramChatId" placeholder="-100xxxxxxxxxx"></div>
          <div class="form-group"><label>Telegram Admin ID</label><input class="form-input" id="settingsTelegramAdminId" placeholder="7263xxxxxx"></div>
          <div class="form-group"><label>QC Topic ID</label><input class="form-input" id="settingsTelegramQcTopicId" placeholder="219"></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn-primary btn-sm" onclick="testTelegramSettings()"><i class="fa-solid fa-check"></i> Test k\u1EBFt n\u1ED1i</button>
            <button class="btn-ghost btn-sm" onclick="saveTelegramSettings()">Luu</button>
          </div>
          <div id="settingsTelegramStatus" style="margin-top:10px;font-size:11px;color:var(--muted)">\u0110ang t\u1EA3i...</div>
        </div>
        <div class="card">
          <div class="card-title" style="margin-bottom:14px"><i class="fa-solid fa-key"></i> API Keys</div>
          <div class="form-group">
            <label>KIE.AI P1 Keys (m\u1ED7i d\u00F2ng 1 key)</label>
            <textarea class="form-textarea" id="settingsP1Keys" style="height:120px;font-size:11px" placeholder="d\u00E1n nhi?u key, m\u1ED7i d\u00F2ng 1 key"></textarea>
          </div>
          <div class="form-group">
            <label>Active key index</label>
            <input class="form-input" id="settingsP1ActiveIndex" type="number" min="0" value="0">
          </div>
          <div class="form-group">
            <label>PiAPI P2 Key</label>
            <input class="form-input" id="settingsP2Key" placeholder="pi_xxx" type="password">
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn-primary btn-sm" onclick="saveApiKeysSettings()"><i class="fa-solid fa-floppy-disk"></i> L\u01B0u keys</button>
            <button class="btn-secondary btn-sm" onclick="refreshApiKeysSettings()"><i class="fa-solid fa-rotate"></i> Refresh balances</button>
          </div>
          <div id="settingsKeysStatus" style="margin-top:10px;font-size:11px;color:var(--muted)">\u0110ang t\u1EA3i...</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        ${isAdmin ? `<div class="card">
          <div class="card-title" style="margin-bottom:14px"><i class="fa-solid fa-server"></i> Video Providers</div>
          <div class="form-group">
            <label>Default Server</label>
            <select class="form-select" id="settingsDefaultProvider">
              <option value="provider1">Server 1</option>
              <option value="provider2">Server 2</option>
            </select>
          </div>
          <div class="form-group">
            <label>Model m\u1EB7c \u0111\u1ECBnh Server 1</label>
            <select class="form-select" id="settingsDefaultModelP1"></select>
          </div>
          <div class="form-group">
            <label>Model m\u1EB7c \u0111\u1ECBnh Server 2</label>
            <select class="form-select" id="settingsDefaultModelP2"></select>
          </div>
          <div class="form-group">
            <label>G\u00F3i KIE quy \u0111\u1ED5i credit -> USD</label>
            <select class="form-select" id="settingsKieCreditPackage"></select>
          </div>
          <div class="form-group">
            <label>Endpoint Server 2</label>
            <input class="form-input" id="settingsProvider2Endpoint" readonly>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn-primary btn-sm" onclick="saveProviderDefaultSettings()"><i class="fa-solid fa-floppy-disk"></i> L\u01B0u Provider</button>
          </div>
          <div id="settingsProviderStatus" style="margin-top:10px;font-size:11px;color:var(--muted)">\u0110ang t\u1EA3i...</div>
        </div>` : ''}
        <div class="card">
          <div class="card-title" style="margin-bottom:14px"><i class="fa-solid fa-shield"></i> Roles & Permissions</div>
          <div class="table-wrapper"><table>
            <thead><tr><th>Role</th><th>Video</th><th>Image</th><th>QC</th><th>Admin</th></tr></thead>
            <tbody>
              <tr><td><span class="badge badge-blue">staff</span></td><td style="color:var(--green)"><i class="fa-solid fa-check"></i></td><td style="color:var(--green)"><i class="fa-solid fa-check"></i></td><td style="color:var(--red)"><i class="fa-solid fa-xmark"></i></td><td style="color:var(--red)"><i class="fa-solid fa-xmark"></i></td></tr>
              <tr><td><span class="badge badge-orange">qc_manager</span></td><td style="color:var(--green)"><i class="fa-solid fa-check"></i></td><td style="color:var(--green)"><i class="fa-solid fa-check"></i></td><td style="color:var(--green)"><i class="fa-solid fa-check"></i></td><td style="color:var(--red)"><i class="fa-solid fa-xmark"></i></td></tr>
              <tr><td><span class="badge badge-red">admin</span></td><td style="color:var(--green)"><i class="fa-solid fa-check"></i></td><td style="color:var(--green)"><i class="fa-solid fa-check"></i></td><td style="color:var(--green)"><i class="fa-solid fa-check"></i></td><td style="color:var(--green)"><i class="fa-solid fa-check"></i></td></tr>
            </tbody>
          </table></div>
        </div>
        <div class="card">
          <div class="card-title" style="margin-bottom:14px"><i class="fa-solid fa-robot"></i> Auto Report</div>
          ${[['B\u00E1o c\u00E1o h\u1EB1ng ng\u00E0y (18:00)',true],['B\u00E1o c\u00E1o tu\u1EA7n (th\u1EE9 6, 17:00)',true],['Alert credit 80%',true],['Alert QC failed > 3 items',false]].map(r => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
              <span style="font-size:13px">${r[0]}</span>
              <label class="toggle-switch"><input type="checkbox" ${r[1]?'checked':''}><span class="toggle-track"></span></label>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  loadTelegramSettings();
  loadApiKeysSettings();
  if (isAdmin) loadProviderSettings();
}

async function loadTelegramSettings() {
  const tokenEl = document.getElementById('settingsTelegramToken');
  const chatEl = document.getElementById('settingsTelegramChatId');
  const adminEl = document.getElementById('settingsTelegramAdminId');
  const topicEl = document.getElementById('settingsTelegramQcTopicId');
  const statusEl = document.getElementById('settingsTelegramStatus');
  if (!tokenEl || !chatEl || !adminEl || !topicEl || !statusEl) return;
  try {
    const cfg = await API.getTelegramConfig();
    tokenEl.value = '';
    tokenEl.placeholder = cfg?.bot_token_masked || 'Ch\u01B0a c\u1EA5u h\u00ECnh';
    chatEl.value = String(cfg?.chat_id || '');
    adminEl.value = String(cfg?.admin_id || '');
    topicEl.value = String(cfg?.qc_topic_id || '');
    statusEl.textContent = cfg?.has_token ? '\u0110\u00E3 c\u00F3 token tr\u00EAn server' : 'Ch\u01B0a c\u00F3 token tr\u00EAn server';
  } catch (err) {
    statusEl.textContent = 'Kh\u00F4ng t\u1EA3i \u0111\u01B0\u1EE3c Telegram settings';
    if (typeof showToast === 'function') showToast(err.message || 'Load Telegram settings th\u1EA5t b\u1EA1i', 'error');
  }
}

async function saveTelegramSettings() {
  const tokenEl = document.getElementById('settingsTelegramToken');
  const chatEl = document.getElementById('settingsTelegramChatId');
  const adminEl = document.getElementById('settingsTelegramAdminId');
  const topicEl = document.getElementById('settingsTelegramQcTopicId');
  const statusEl = document.getElementById('settingsTelegramStatus');
  if (!tokenEl || !chatEl || !adminEl || !topicEl || !statusEl) return;
  try {
    const token = String(tokenEl.value || '').trim();
    const chatId = String(chatEl.value || '').trim();
    if (!token && !tokenEl.placeholder) throw new Error('Thi\u1EBFu Bot Token');
    if (!chatId) throw new Error('Thi\u1EBFu Admin Chat ID');
    const payload = {
      bot_token: token || undefined,
      chat_id: chatId,
      admin_id: String(adminEl.value || '').trim(),
      qc_topic_id: String(topicEl.value || '').trim(),
    };
    if (!payload.bot_token) delete payload.bot_token;
    await API.saveTelegramConfig(payload);
    statusEl.textContent = '\u0110\u00E3 l\u01B0u Telegram settings';
    if (typeof showToast === 'function') showToast('L\u01B0u Telegram settings th\u00E0nh c\u00F4ng', 'success');
    await loadTelegramSettings();
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message || 'L\u01B0u Telegram settings th\u1EA5t b\u1EA1i', 'error');
  }
}

async function testTelegramSettings() {
  const statusEl = document.getElementById('settingsTelegramStatus');
  if (statusEl) statusEl.textContent = '\u0110ang test Telegram...';
  try {
    await saveTelegramSettings();
    await API.testTelegram('Telegram test from Settings');
    if (statusEl) statusEl.textContent = 'Telegram test OK';
    if (typeof showToast === 'function') showToast('Telegram test th\u00E0nh c\u00F4ng', 'success');
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Telegram test l\u1ED7i';
    if (typeof showToast === 'function') showToast(err.message || 'Telegram test th\u1EA5t b\u1EA1i', 'error');
  }
}

async function loadApiKeysSettings() {
  const p1 = document.getElementById('settingsP1Keys');
  const p2 = document.getElementById('settingsP2Key');
  const active = document.getElementById('settingsP1ActiveIndex');
  const status = document.getElementById('settingsKeysStatus');
  if (!p1 || !p2 || !active || !status) return;
  try {
    const [p1Res, p2Res] = await Promise.all([
      API.getCreditKeys(),
      API.getProvider2Keys(),
    ]);
    const p1Count = (p1Res?.keys || []).length;
    const activeIdx = Math.max(0, (p1Res?.keys || []).findIndex((k) => !!k.active));
    // Security-safe: never fill masked keys back into editable input.
    // Admin must paste full real key list when saving.
    p1.value = '';
    p1.placeholder = `\u0110ang c\u00F3 ${p1Count} key tr\u00EAn server. D\u00E1n FULL danh s\u00E1ch key m\u1EDBi, m\u1ED7i d\u00F2ng 1 key \u0111\u1EC3 replace.`;
    active.value = String(activeIdx);
    p2.value = '';
    const p2Masked = p2Res?.keys?.[0]?.masked || 'Not set';
    status.textContent = `P1: ${p1Count} key | P2: ${p2Masked}`;
  } catch (err) {
    status.textContent = 'Kh\u00F4ng t\u1EA3i \u0111\u01B0\u1EE3c key settings';
    if (typeof showToast === 'function') showToast(err.message || 'Load key settings th\u1EA5t b\u1EA1i', 'error');
  }
}

async function saveApiKeysSettings() {
  const p1 = document.getElementById('settingsP1Keys');
  const p2 = document.getElementById('settingsP2Key');
  const active = document.getElementById('settingsP1ActiveIndex');
  const status = document.getElementById('settingsKeysStatus');
  if (!p1 || !p2 || !active || !status) return;
  try {
    const p1Keys = String(p1.value || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const activeIndex = Number(active.value || 0);
    if (p1Keys.length) {
      await API.replaceCreditKeys(p1Keys, Number.isFinite(activeIndex) ? activeIndex : 0);
    }
    const p2Key = String(p2.value || '').trim();
    if (p2Key) {
      await API.setProvider2Key(p2Key);
    }
    if (!p1Keys.length && !p2Key) {
      throw new Error('Nh\u1EADp \u00EDt nh\u1EA5t 1 key Provider1 ho\u1EB7c Provider2');
    }
    status.textContent = `\u0110\u00E3 l\u01B0u${p1Keys.length ? ` ${p1Keys.length} key Provider1` : ''}${p2Key ? ' + Provider2' : ''}`;
    if (typeof showToast === 'function') showToast('L\u01B0u keys th\u00E0nh c\u00F4ng', 'success');
    await refreshSidebarCredits();
    await loadApiKeysSettings();
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message || 'L\u01B0u keys th\u1EA5t b\u1EA1i', 'error');
  }
}

async function refreshApiKeysSettings() {
  const status = document.getElementById('settingsKeysStatus');
  if (status) status.textContent = '\u0110ang refresh balances...';
  try {
    const res = await API.refreshCredits();
    const total = Number(res?.credits || 0);
    if (status) status.textContent = `Credits total: ${total.toFixed(2)}`;
    if (typeof showToast === 'function') showToast('Refresh balances xong', 'success');
    await refreshSidebarCredits();
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message || 'Refresh balances th\u1EA5t b\u1EA1i', 'error');
  }
}

async function refreshSidebarCredits() {
  try {
    const [p1Res, p2Res] = await Promise.all([
      API.getCreditBalance(),
      API.getProviderCredits('provider2'),
    ]);
    const p1 = Number(p1Res?.credits || 0);
    let p2 = 0;
    if (typeof p2Res?.credits === 'number') p2 = Number(p2Res.credits);
    else if (typeof p2Res?.balance === 'number') p2 = Number(p2Res.balance);
    const p1El = document.getElementById('creditP1');
    const p2El = document.getElementById('creditP2');
    if (p1El) p1El.textContent = `${p1.toLocaleString()} cr`;
    if (p2El) p2El.textContent = `$${p2.toFixed(2)}`;
  } catch (_) {}
}

async function loadProviderSettings() {
  const providerEl = document.getElementById('settingsDefaultProvider');
  const modelP1El = document.getElementById('settingsDefaultModelP1');
  const modelP2El = document.getElementById('settingsDefaultModelP2');
  const kiePackageEl = document.getElementById('settingsKieCreditPackage');
  const endpointEl = document.getElementById('settingsProvider2Endpoint');
  const statusEl = document.getElementById('settingsProviderStatus');
  if (!providerEl || !modelP1El || !modelP2El || !kiePackageEl || !endpointEl || !statusEl) return;
  try {
    const catalog = await API.getProviderCatalog();
    const defaultProvider = String(catalog?.default_provider || AppData.providerSettings?.default_provider || 'provider1').trim().toLowerCase() || 'provider1';
    const defaultModels = (catalog && typeof catalog.default_models === 'object' && catalog.default_models) ? catalog.default_models : (AppData.providerSettings?.default_models || { provider1: 'kling25_turbo_pro', provider2: 'kling25_turbo' });
    const kiePackage = String(catalog?.kie_credit_package || AppData.providerSettings?.kie_credit_package || 'usd50_10000').trim().toLowerCase() || 'usd50_10000';
    const providers = Array.isArray(catalog?.providers) ? catalog.providers : [];
    const kiePackages = Array.isArray(catalog?.kie_credit_packages) ? catalog.kie_credit_packages : [];
    const endpoint = String((providers.find((row) => row.id === 'provider2')?.endpoints?.create_task) || AppData.providerSettings?.provider2_endpoint || 'https://api.piapi.ai/api/v1/task').trim() || 'https://api.piapi.ai/api/v1/task';
    AppData.providerCatalog = catalog && Array.isArray(catalog.providers) ? catalog : (AppData.providerCatalog || {});
    AppData.providerSettings = {
      default_provider: defaultProvider,
      default_models: defaultModels,
      kie_credit_package: kiePackage,
      provider2_endpoint: endpoint,
    };
    providerEl.value = defaultProvider;
    modelP1El.innerHTML = (providers.find((row) => row.id === 'provider1')?.models || []).map((model) => `<option value="${String(model.id || '').replace(/"/g, '&quot;')}" ${String(defaultModels.provider1 || '') === String(model.id || '') ? 'selected' : ''}>${model.label}</option>`).join('');
    modelP2El.innerHTML = (providers.find((row) => row.id === 'provider2')?.models || []).map((model) => `<option value="${String(model.id || '').replace(/"/g, '&quot;')}" ${String(defaultModels.provider2 || '') === String(model.id || '') ? 'selected' : ''}>${model.label}</option>`).join('');
    kiePackageEl.innerHTML = kiePackages.map((pkg) => `<option value="${String(pkg.id || '').replace(/"/g, '&quot;')}" ${kiePackage === String(pkg.id || '').trim().toLowerCase() ? 'selected' : ''}>${pkg.label}</option>`).join('');
    endpointEl.value = endpoint;
    const defaultProviderRow = providers.find((row) => String(row.id || '') === defaultProvider);
    const defaultModelId = String(defaultModels?.[defaultProvider] || '').trim();
    const defaultModel = (defaultProviderRow?.models || []).find((row) => String(row.id || '') === defaultModelId);
    if (defaultModel) {
      AppData.model = {
        id: defaultModel.id,
        name: defaultModel.label,
        provider: defaultProvider,
        cr5: defaultModel.cost_5s,
        cr10: defaultModel.cost_10s,
        unit: String(defaultModel.unit || '').toLowerCase(),
      };
    }
    statusEl.textContent = `\u0110ang d\u00F9ng: ${defaultProvider === 'provider2' ? 'Server 2' : 'Server 1'} | P1: ${defaultModels.provider1 || '-'} | P2: ${defaultModels.provider2 || '-'} | KIE package: ${kiePackage}`;
  } catch (err) {
    statusEl.textContent = 'Kh\u00F4ng t\u1EA3i \u0111\u01B0\u1EE3c provider settings';
    if (typeof showToast === 'function') showToast(err.message || 'Load provider settings th\u1EA5t b\u1EA1i', 'error');
  }
}

async function saveProviderDefaultSettings() {
  if (String(AppData.currentUser?.role || '').toLowerCase() !== 'admin') {
    if (typeof showToast === 'function') showToast('Ch\u1EC9 Admin \u0111\u01B0\u1EE3c l\u01B0u provider settings', 'error');
    return;
  }
  const providerEl = document.getElementById('settingsDefaultProvider');
  const modelP1El = document.getElementById('settingsDefaultModelP1');
  const modelP2El = document.getElementById('settingsDefaultModelP2');
  const kiePackageEl = document.getElementById('settingsKieCreditPackage');
  const statusEl = document.getElementById('settingsProviderStatus');
  if (!providerEl || !modelP1El || !modelP2El || !kiePackageEl || !statusEl) return;
  try {
    const payload = {
      default_provider: String(providerEl.value || 'provider1').trim().toLowerCase() || 'provider1',
      default_models: {
        provider1: String(modelP1El.value || AppData.providerSettings?.default_models?.provider1 || 'kling25_turbo_pro').trim() || 'kling25_turbo_pro',
        provider2: String(modelP2El.value || AppData.providerSettings?.default_models?.provider2 || 'kling25_turbo').trim() || 'kling25_turbo',
      },
      kie_credit_package: String(kiePackageEl.value || AppData.providerSettings?.kie_credit_package || 'usd50_10000').trim().toLowerCase() || 'usd50_10000',
    };
    const res = await API.saveProviderSettings(payload);
    AppData.providerSettings = {
      default_provider: String(res?.default_provider || payload.default_provider).trim().toLowerCase() || 'provider1',
      default_models: (res && typeof res.default_models === 'object' && res.default_models) ? res.default_models : payload.default_models,
      kie_credit_package: String(res?.kie_credit_package || payload.kie_credit_package).trim().toLowerCase() || payload.kie_credit_package,
      provider2_endpoint: String(res?.provider2_endpoint || 'https://api.piapi.ai/api/v1/task').trim() || 'https://api.piapi.ai/api/v1/task',
    };
    const defaultProviderRow = Array.isArray(AppData.providerCatalog?.providers) ? AppData.providerCatalog.providers.find((row) => String(row.id || '') === String(AppData.providerSettings.default_provider || 'provider1')) : null;
    const defaultModelId = String(AppData.providerSettings?.default_models?.[AppData.providerSettings.default_provider] || '').trim();
    const defaultModel = (defaultProviderRow?.models || []).find((row) => String(row.id || '') === defaultModelId);
    if (defaultModel) {
      AppData.model = {
        id: defaultModel.id,
        name: defaultModel.label,
        provider: AppData.providerSettings.default_provider,
        cr5: defaultModel.cost_5s,
        cr10: defaultModel.cost_10s,
        unit: String(defaultModel.unit || '').toLowerCase(),
      };
    }
    statusEl.textContent = `\u0110\u00E3 l\u01B0u: ${AppData.providerSettings.default_provider === 'provider2' ? 'Server 2' : 'Server 1'} | P1: ${AppData.providerSettings.default_models.provider1} | P2: ${AppData.providerSettings.default_models.provider2} | KIE package: ${AppData.providerSettings.kie_credit_package}`;
    if (typeof showToast === 'function') showToast('L\u01B0u default provider th\u00E0nh c\u00F4ng', 'success');
    await loadDataFromAPI();
    if (typeof buildCreditsScreen === 'function') buildCreditsScreen();
    loadProviderSettings();
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message || 'L\u01B0u default provider th\u1EA5t b\u1EA1i', 'error');
  }
}








