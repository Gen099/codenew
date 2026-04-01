import { expect, test, Page } from '@playwright/test';

const base = process.env.UAT_BASE_URL || 'https://activists-defend-has-creatures.trycloudflare.com/#';
const ADMIN_USER = process.env.UAT_ADMIN_USER || '';
const ADMIN_PASS = process.env.UAT_ADMIN_PASS || '';
const QC_USER = process.env.UAT_QC_USER || '';
const QC_PASS = process.env.UAT_QC_PASS || '';
const STAFF_USER = process.env.UAT_STAFF_USER || '';
const STAFF_PASS = process.env.UAT_STAFF_PASS || '';

async function login(page: Page, username: string, password: string) {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.fill('#loginUsername', username);
  await page.fill('#loginPassword', password);
  await page.click('#loginBtn');
  await page.waitForTimeout(1200);
}

async function loginByApiToken(page: Page, username: string, password: string) {
  const apiBase = base.replace(/\/#?$/, '');
  const res = await page.request.post(`${apiBase}/api/auth/login`, { data: { username, password } });
  let json: any = await res.json();

  if (!json?.token && String(json?.status || '').toLowerCase() === 'pending' && json?.login_id) {
    const adminRes = await page.request.post(`${apiBase}/api/auth/login`, {
      data: { username: ADMIN_USER, password: ADMIN_PASS }
    });
    const adminJson: any = await adminRes.json();
    if (!adminJson?.token) {
      throw new Error(`Không thể auto-approve vì admin không lấy được token: ${JSON.stringify(adminJson)}`);
    }

    await page.request.post(`${apiBase}/api/auth/approve/${json.login_id}`, {
      headers: { Authorization: `Bearer ${adminJson.token}` },
      data: {}
    });

    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(800);
      const poll = await page.request.get(`${apiBase}/api/auth/poll/${json.login_id}`);
      const pollJson: any = await poll.json();
      if (pollJson?.token) {
        json = pollJson;
        break;
      }
    }
  }

  if (!json?.token) {
    throw new Error(`API login không trả token cho user=${username}: ${JSON.stringify(json)}`);
  }
  const userObj = json?.user || { username };
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('fa_token', token);
    localStorage.setItem('fa_user', JSON.stringify(user));
  }, { token: String(json.token), user: userObj });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
}

async function ensureLoggedIn(page: Page, role: 'admin' | 'qc' | 'staff') {
  await expect(page.locator('aside .nav-item')).toHaveCount(7, { timeout: 20_000 });
  try {
    await page.click('[data-screen="dashboard"]', { timeout: 8_000 });
  } catch {
    throw new Error(`Login ${role} chưa usable: không bấm được Dashboard sau login.`);
  }
  await page.waitForTimeout(700);
}

async function openScreen(page: Page, screenId: string) {
  await page.click(`[data-screen="${screenId}"]`);
  await page.waitForTimeout(900);
}

async function assertMainTitleContains(page: Page, keyword: string) {
  const text = await page.locator('main, #mainContent').innerText();
  expect(text.toLowerCase()).toContain(keyword.toLowerCase());
}

async function logout(page: Page) {
  const logoutBtn = page.locator('button:has-text("Logout"), .sidebar-footer button:has-text("Logout")').first();
  if (await logoutBtn.count()) {
    await logoutBtn.click();
    await page.waitForTimeout(1000);
  }
}

test.describe('UAT full role flow - detailed', () => {
  test.beforeAll(() => {
    const missing = [
      ['UAT_ADMIN_USER', ADMIN_USER],
      ['UAT_ADMIN_PASS', ADMIN_PASS],
      ['UAT_QC_USER', QC_USER],
      ['UAT_QC_PASS', QC_PASS],
      ['UAT_STAFF_USER', STAFF_USER],
      ['UAT_STAFF_PASS', STAFF_PASS]
    ].filter(([, v]) => !v);
    if (missing.length) {
      throw new Error(`Missing env: ${missing.map(([k]) => k).join(', ')}`);
    }
  });

  test('Staff - dashboard, creator, add row, library, credits', async ({ page }) => {
    await loginByApiToken(page, STAFF_USER, STAFF_PASS);
    await ensureLoggedIn(page, 'staff');

    await openScreen(page, 'dashboard');
    await assertMainTitleContains(page, 'Dashboard');

    await openScreen(page, 'creator');
    await assertMainTitleContains(page, 'Nguồn Ảnh');

    const addRowBtn = page.locator('button:has-text("Thêm Dòng")').first();
    await expect(addRowBtn).toBeVisible();
    const beforeRows = await page.locator('#taskTableBody tr.cr-task-row').count();
    await addRowBtn.click();
    await page.waitForTimeout(800);
    const afterRows = await page.locator('#taskTableBody tr.cr-task-row').count();
    expect(afterRows).toBe(beforeRows + 1);

    await expect(page.locator('main, #mainContent')).toContainText('Chi phí');
    await expect(page.locator('main, #mainContent')).toContainText('Chế độ');

    await openScreen(page, 'library');
    await assertMainTitleContains(page, 'Thư viện sản phẩm');

    await openScreen(page, 'credits');
    await assertMainTitleContains(page, 'Credit & Budget');
    await expect(page.locator('main, #mainContent')).toContainText('Lịch sử tiêu thụ / nạp thêm');

    await logout(page);
  });

  test('QC - dashboard online, queue, preview block', async ({ page }) => {
    await loginByApiToken(page, QC_USER, QC_PASS);
    await ensureLoggedIn(page, 'qc');

    await openScreen(page, 'qc');
    await assertMainTitleContains(page, 'QC Manager Dashboard');
    await expect(page.locator('main, #mainContent')).toContainText('Nhân sự đang online');
    await expect(page.locator('main, #mainContent')).toContainText('CODE đang làm');
    await expect(page.locator('main, #mainContent')).toContainText('Queue chờ duyệt');
    await expect(page.locator('main, #mainContent')).toContainText('Preview');

    await openScreen(page, 'dashboard');
    await assertMainTitleContains(page, 'Dashboard');

    await logout(page);
  });

  test('Admin - full navigation and settings/credits detail', async ({ page }) => {
    await loginByApiToken(page, ADMIN_USER, ADMIN_PASS);
    await ensureLoggedIn(page, 'admin');

    await openScreen(page, 'dashboard');
    await assertMainTitleContains(page, 'Dashboard');

    await openScreen(page, 'creator');
    await assertMainTitleContains(page, 'Nguồn Ảnh');

    await openScreen(page, 'qc');
    await assertMainTitleContains(page, 'QC Manager Dashboard');

    await openScreen(page, 'hr');
    await expect(page.locator('main, #mainContent')).toContainText('HR & KPI');

    await openScreen(page, 'library');
    await assertMainTitleContains(page, 'Thư viện sản phẩm');

    await openScreen(page, 'credits');
    await assertMainTitleContains(page, 'Credit & Budget');
    await expect(page.locator('main, #mainContent')).toContainText('Lịch sử tiêu thụ / nạp thêm');

    await openScreen(page, 'settings');
    await assertMainTitleContains(page, 'Settings & Configuration');
    await expect(page.locator('main, #mainContent')).toContainText('Telegram Bot');
    await expect(page.locator('main, #mainContent')).toContainText('API Keys');
    await expect(page.locator('main, #mainContent')).toContainText('Roles & Permissions');

    await logout(page);
  });
});
