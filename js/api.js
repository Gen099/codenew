// ===== F-Aistudio API CLIENT =====
// Central API communication layer — auto-attaches JWT token
// Updated: 2026-03-26 — paths aligned with backend routes

const API = {
  // Base URL — empty = same origin (proxied by Nginx)
  BASE: '',

  // ---- Token Management ----
  getToken() {
    const sessionToken = sessionStorage.getItem('fa_token') || '';
    if (sessionToken) return sessionToken;
    const legacyToken = localStorage.getItem('fa_token') || '';
    if (legacyToken) {
      sessionStorage.setItem('fa_token', legacyToken);
      localStorage.removeItem('fa_token');
    }
    return legacyToken;
  },
  setToken(token) {
    const value = String(token || '');
    sessionStorage.setItem('fa_token', value);
    localStorage.removeItem('fa_token');
  },
  clearToken() {
    sessionStorage.removeItem('fa_token');
    sessionStorage.removeItem('fa_user');
    localStorage.removeItem('fa_token');
    localStorage.removeItem('fa_user');
  },
  getUser() {
    try {
      const sessionUser = sessionStorage.getItem('fa_user');
      if (sessionUser) return JSON.parse(sessionUser || 'null');
      const legacyUser = localStorage.getItem('fa_user');
      if (legacyUser) {
        sessionStorage.setItem('fa_user', legacyUser);
        localStorage.removeItem('fa_user');
      }
      return JSON.parse(legacyUser || 'null');
    } catch {
      return null;
    }
  },
  setUser(user) {
    const value = JSON.stringify(user);
    sessionStorage.setItem('fa_user', value);
    localStorage.removeItem('fa_user');
  },

  // ---- Core Fetch ----
  async fetch(path, opts = {}) {
    const url = this.BASE + path;
    const headers = opts.headers || {};
    const token = this.getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    opts.headers = headers;
    const res = await fetch(url, opts);
    if (res.status === 401) {
      this.clearToken();
      if (typeof showLoginScreen === 'function') showLoginScreen();
      throw new Error('Unauthorized');
    }
    return res;
  },

  async get(path) {
    const res = await this.fetch(path);
    return res.json();
  },

  async post(path, body) {
    const res = await this.fetch(path, { method: 'POST', body });
    return res.json();
  },

  async put(path, body) {
    const res = await this.fetch(path, { method: 'PUT', body });
    return res.json();
  },

  async del(path) {
    const res = await this.fetch(path, { method: 'DELETE' });
    return res.json();
  },

  // ========== AUTH ==========
  async login(username, password) {
    const res = await this.fetch('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    });
    return res.json();
  },

  async getMe() {
    return this.get('/api/auth/me');
  },

  async pollLogin(loginId) {
    return this.get('/api/auth/poll/' + loginId);
  },

  async getUsers() {
    return this.get('/api/auth/users');
  },

  async registerUser(data) {
    return this.post('/api/auth/register', data);
  },

  async repairUsers() {
    return this.post('/api/auth/repair-users', {});
  },

  async updateUser(id, data) {
    return this.post('/api/auth/users/' + id, data);
  },

  async deleteUser(id) {
    return this.del('/api/auth/users/' + id);
  },

  async getPendingLogins() {
    return this.get('/api/auth/pending');
  },

  async approveLogin(loginId) {
    return this.post('/api/auth/approve/' + loginId, {});
  },

  async rejectLogin(loginId) {
    return this.post('/api/auth/reject/' + loginId, {});
  },

  // ========== VIDEO ==========
  // Upload image to KIE CDN → returns { url }
  async uploadImage(formData) {
    const res = await this.fetch('/api/video/upload', {
      method: 'POST',
      body: formData, // FormData — no JSON stringify
    });
    return res.json();
  },

  // Create single video task
  async createVideo(data) {
    return this.post('/api/video/create', data);
  },

  // Poll video task status (replaces old getVideoStatus)
  async pollVideo(taskId) {
    return this.get('/api/video/poll/' + taskId);
  },

  // Create batch of video tasks
  async batchVideo(tasks) {
    return this.post('/api/video/batch', { tasks });
  },

  // Poll batch status
  async getBatchStatus(batchId) {
    return this.get('/api/video/batch-status/' + batchId);
  },

  // Download batch as ZIP
  downloadBatchZip(batchId) {
    window.open(this.BASE + '/api/video/download-zip/' + batchId);
  },

  // Get camera moves list
  async getCameraMoves() {
    return this.get('/api/video/camera-moves');
  },

  // Get active tasks
  async getActiveTasks() {
    return this.get('/api/video/active-tasks');
  },

  // Stop a running task
  async stopTask(taskId) {
    return this.post('/api/video/stop/' + taskId, {});
  },

  // Recover stuck task
  async recoverTask(data) {
    return this.post('/api/video/recover', data);
  },

  // ========== IMAGE (Presets) ==========
  async getPresets() {
    return this.get('/api/image/presets');
  },

  // ========== QC ==========
  // Submit video for QC review
  async submitQC(data) {
    return this.post('/api/qc/submit', data);
  },

  async getQCQueue() {
    return this.get('/api/qc/queue');
  },

  async approveQC(id, note) {
    return this.post('/api/qc/approve/' + id, { note: note || '' });
  },

  async rejectQC(id, reason) {
    return this.post('/api/qc/reject/' + id, { reason: reason || '' });
  },

  async getQCStatus(taskId) {
    return this.get('/api/qc/status/' + taskId);
  },

  // ========== CREDITS ==========
  async getCreditBalance() {
    return this.get('/api/credits/balance');
  },

  async getCreditDetails() {
    return this.get('/api/credits/details');
  },

  async getCreditKeys() {
    return this.get('/api/credits/keys');
  },

  async replaceCreditKeys(keys, activeIndex = 0) {
    return this.post('/api/credits/keys/replace', { keys, active_index: activeIndex });
  },

  async refreshCredits() {
    return this.get('/api/credits/refresh');
  },

  // ========== PROVIDERS ==========
  async getProviders() {
    return this.get('/api/providers');
  },

  async getProviderCredits(providerId) {
    return this.get('/api/providers/' + providerId + '/credits');
  },

  async getKeyStatus() {
    return this.get('/api/providers/runtime-keys/status');
  },

  async getProvider2Keys() {
    return this.get('/api/providers/provider2/keys');
  },

  async setProvider2Key(key) {
    return this.post('/api/providers/provider2/keys/set', { key });
  },

  async getProviderSettings() {
    return this.get('/api/providers/settings');
  },

  async saveProviderSettings(payload) {
    if (typeof payload === 'string') payload = { default_provider: payload };
    return this.post('/api/providers/settings', payload || {});
  },

  async getProviderCatalog() {
    return this.get('/api/providers/catalog');
  },

  // ========== CHAT AI ==========
  // SSE streaming chat
  streamChat(messages, model, onChunk, onDone, onError) {
    const token = this.getToken();
    const url = this.BASE + '/api/chat/agent';
    const body = JSON.stringify({
      messages,
      model: model || 'gemini-2.5-flash',
      stream: true,
    });

    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
        'Accept': 'text/event-stream',
      },
      body,
    }).then(res => {
      if (!res.ok) { onError && onError('HTTP ' + res.status); return; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      function pump() {
        reader.read().then(({ done, value }) => {
          if (done) { onDone && onDone(buffer); return; }
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          // Parse SSE lines
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') { onDone && onDone(buffer); return; }
              onChunk && onChunk(data);
            }
          }
          pump();
        }).catch(err => { onError && onError(err.message); });
      }
      pump();
    }).catch(err => { onError && onError(err.message); });
  },

  // Upload image for AI analysis
  async chatAnalyze(formData) {
    const res = await this.fetch('/api/chat/analyze', {
      method: 'POST',
      body: formData, // FormData with image file
    });
    return res.json();
  },

  async chatAgent(messages, model = 'gemini-2.5-flash') {
    const res = await this.fetch('/api/chat/agent', {
      method: 'POST',
      body: {
        messages,
        model,
        stream: false,
      },
    });
    return res.json();
  },

  // Get available chat models
  async getChatModels() {
    return this.get('/api/chat/models');
  },

  // Get chat history
  async getChatHistory(sessionKey) {
    return this.get('/api/chat/history?session_key=' + encodeURIComponent(sessionKey));
  },

  async saveChatHistory(sessionKey, messages, options = {}) {
    return this.post('/api/chat/history', {
      session_key: sessionKey,
      work_task_id: String(options.work_task_id || ''),
      chat_model: String(options.chat_model || 'gemini-2.5-flash'),
      chat_skill: String(options.chat_skill || ''),
      system_prompt: String(options.system_prompt || ''),
      messages: Array.isArray(messages) ? messages : [],
    });
  },

  async deleteChatHistory(sessionKey) {
    const res = await this.fetch('/api/chat/history?session_key=' + encodeURIComponent(sessionKey), {
      method: 'DELETE',
    });
    return res.json();
  },

  // ========== REPORTS ==========
  async submitShiftReport(data) {
    return this.post('/api/reports/shift', data);
  },

  async getShiftReports() {
    return this.get('/api/reports/shifts');
  },

  async getMyStats() {
    return this.get('/api/reports/my-stats');
  },

  // ========== LIBRARY ==========
  async getLibrary() {
    if (!this.getToken()) return [];
    return this.get('/api/library');
  },

  // ========== INPUT ASSETS ==========
  async getInputAssets({ userName = '', sessionId = '', codeTag = '', limit = 300 } = {}) {
    const params = new URLSearchParams();
    if (userName) params.set('user_name', userName);
    if (sessionId) params.set('session_id', sessionId);
    if (codeTag) params.set('code_tag', codeTag);
    if (Number.isFinite(Number(limit))) params.set('limit', String(limit));
    const query = params.toString();
    return this.get('/api/input-assets' + (query ? ('?' + query) : ''));
  },

  async uploadInputAsset(formData) {
    const res = await this.fetch('/api/input-assets/upload', {
      method: 'POST',
      body: formData,
    });
    return res.json();
  },

  async patchInputAsset(assetId, data) {
    const res = await this.fetch('/api/input-assets/' + encodeURIComponent(assetId), {
      method: 'PATCH',
      body: data || {},
    });
    return res.json();
  },

  async deleteInputAsset(assetId) {
    const res = await this.fetch('/api/input-assets/' + encodeURIComponent(assetId), {
      method: 'DELETE',
    });
    return res.json();
  },

  async recoverStuckMedia() {
    if (!this.getToken()) return { ok: false, skipped: true, reason: 'no_token' };
    return this.post('/api/video/recover-stuck', {});
  },

  async getDailySummary() {
    return this.get('/api/reports/daily-summary');
  },

  // ========== WORK TASKS ==========
  async getWorkTasks(userName = '', status = '') {
    const params = new URLSearchParams();
    if (userName) params.set('user_name', userName);
    if (status) params.set('status', status);
    const query = params.toString();
    return this.get('/api/work-tasks' + (query ? ('?' + query) : ''));
  },

  async createWorkTask(data) {
    return this.post('/api/work-tasks/create', data);
  },

  async getActiveWorkTasks(userName = '') {
    const query = userName ? ('?user_name=' + encodeURIComponent(userName)) : '';
    return this.get('/api/work-tasks/active' + query);
  },

  async closeWorkTask(id, data) {
    return this.post('/api/work-tasks/close/' + id, data || {});
  },

  async getCurrentShiftSummary(userName = '') {
    const query = userName ? ('?user_name=' + encodeURIComponent(userName)) : '';
    return this.get('/api/reports/shift-current' + query);
  },

  // ========== NOTIFICATIONS ==========
  async getNotifications() {
    return this.get('/api/notifications');
  },

  async markNotifRead(id) {
    return this.post('/api/notifications/read/' + id, {});
  },

  async markAllNotifRead() {
    return this.post('/api/notifications/read-all', {});
  },

  // ========== SYSTEM ==========
  async getSystemStatus() {
    return this.get('/api/system/status');
  },

  async getShiftConfig() {
    return this.get('/api/system/shift-config');
  },

  async saveShiftConfig(data) {
    return this.post('/api/admin/settings/shift-config', data);
  },

  async heartbeat(data = {}) {
    if (!this.getToken()) return { ok: false, skipped: true, reason: 'no_token' };
    return this.post('/api/system/heartbeat', data || {});
  },

  async getTelegramConfig() {
    return this.get('/api/admin/settings/telegram-config');
  },

  async saveTelegramConfig(data) {
    return this.post('/api/admin/settings/telegram-config', data);
  },

  async testTelegram(message) {
    return this.post('/api/admin/settings/telegram-test', { message });
  },
};
