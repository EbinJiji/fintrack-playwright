const { test, expect } = require('@playwright/test');
const { api, kpi, money, uid, accountOf, gotoAndSettle, createTransactionUI } = require('./helpers');

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndSettle(page, '/dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
  });

  test('DASH-01 loads all KPI cards and sections', async ({ page }) => {
    for (const t of ['Total Balance', 'Monthly Income', 'Monthly Expenses']) {
      await expect(page.getByText(t, { exact: true })).toBeVisible();
    }
    for (const h of ['Spending Overview', 'Spending by Category', 'Recent Transactions']) {
      await expect(page.getByRole('heading', { name: h })).toBeVisible();
    }
    await expect(page.getByText(/Your financial snapshot for \w+ \d{4}/)).toBeVisible();
  });

  test('DASH-02 KPI values match the analytics API', async ({ page }) => {
    const { status, body } = await api(page, 'GET', '/api/analytics/dashboard');
    expect(status).toBe(200);
    const s = body.data.summary;
    expect(await kpi(page, 'Total Balance')).toBeCloseTo(Number(s.total_balance), 2);
    expect(await kpi(page, 'Monthly Income')).toBeCloseTo(Number(s.monthly_income), 2);
    expect(await kpi(page, 'Monthly Expenses')).toBeCloseTo(Number(s.monthly_expenses), 2);
  });

  test('DASH-03 Total Balance is consistent with the Transactions page net savings', async ({ page }) => {
    const balance = await kpi(page, 'Total Balance');
    await gotoAndSettle(page, '/transactions');
    const income = await kpi(page, 'Total Income');
    const expenses = await kpi(page, 'Total Expenses');
    const net = await kpi(page, 'Net Savings');
    expect(net).toBeCloseTo(income - expenses, 2);
    expect(balance).toBeCloseTo(net, 2);
  });

  test('DASH-04 recent transactions reflect stored records (or empty state)', async ({ page }) => {
    const { body } = await api(page, 'GET', '/api/transactions');
    const recent = page.locator('main').getByRole('table');
    if (!body.data.length) {
      await expect(page.getByText('No transactions recorded yet.')).toBeVisible();
      return;
    }
    const known = new Set(body.data.map(t => t.description));
    const rows = recent.locator('tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);
    for (const row of await rows.all()) {
      const desc = (await row.locator('td').first().innerText()).trim();
      expect(known, `recent row "${desc}" exists in API`).toContain(desc);
    }
  });

  test('DASH-05 new account shows empty states', async ({ page }) => {
    test.skip(accountOf(test.info()) !== 'new', 'empty-state check applies to the new account only');
    const { body } = await api(page, 'GET', '/api/transactions');
    test.skip(body.data.length > 0, 'new account currently has transactions');
    await expect(page.getByText('No transactions recorded yet.')).toBeVisible();
    await expect(page.getByText('No expense categories yet for this period.')).toBeVisible();
    expect(await kpi(page, 'Total Balance')).toBe(0);
  });

  test('DASH-06 spending period selector re-queries analytics', async ({ page }) => {
    const sel = page.getByLabel('Spending period');
    await expect(sel.locator('option')).toHaveText(['Last 6 Months', 'Last 3 Months', 'This Year']);
    const req = page.waitForResponse(r => r.url().includes('/api/analytics/dashboard') && r.url().includes('3'));
    await sel.selectOption({ label: 'Last 3 Months' });
    const r = await req;
    expect(r.status()).toBe(200);
    const months = (await r.json()).data.spending_overview.map(m => m.month);
    expect(months).toHaveLength(3);
    for (const m of months) await expect(page.locator('main').getByText(m, { exact: true }).first()).toBeVisible();
  });

  test('DASH-07 refresh button re-fetches financial data', async ({ page }) => {
    const req = page.waitForResponse(r => r.url().includes('/api/analytics/dashboard'));
    await page.getByRole('button', { name: 'Refresh financial data' }).click();
    expect((await req).status()).toBe(200);
  });

  test('DASH-08 header and card links navigate correctly', async ({ page }) => {
    const links = [
      [page.getByRole('link', { name: 'Manage family' }), /\/family$/, 'Family & sharing'],
      [page.getByRole('link', { name: 'Pay & record' }), /\/payments$/, 'Pay & record'],
      [page.getByRole('link', { name: 'Notifications' }), /\/notifications$/, 'Notifications'],
      [page.getByRole('link', { name: 'Your profile and settings' }), /\/settings/, 'User Settings & Profile'],
    ];
    for (const [link, url, heading] of links) {
      await gotoAndSettle(page, '/dashboard');
      await link.click();
      await expect(page).toHaveURL(url);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    }
    await gotoAndSettle(page, '/dashboard');
    await page.getByRole('button', { name: 'View All →' }).click();
    await expect(page).toHaveURL(/\/transactions/);
  });

  test('DASH-09 Add Transaction opens the form and Cancel creates nothing', async ({ page }) => {
    let posts = 0;
    page.on('request', r => { if (r.url().endsWith('/api/transactions') && r.method() === 'POST') posts++; });
    await page.getByRole('button', { name: 'Add Transaction' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'New Transaction' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(posts).toBe(0);
  });

  test('DASH-10 finance view selector offers Personal', async ({ page }) => {
    const view = page.getByLabel('Finance view');
    await expect(view).toHaveValue('personal');
    await expect(view.locator('option', { hasText: 'Personal' })).toHaveCount(1);
  });

  test('DASH-11 display currency switch re-labels amounts and persists, then restores', async ({ page }) => {
    const cur = page.getByLabel('Displayed currency');
    const original = await cur.inputValue();
    try {
      const usdBalance = await kpi(page, 'Total Balance');
      const req = page.waitForResponse(r => r.url().includes('/api/analytics/dashboard'));
      await cur.selectOption('EUR');
      const r = await req;
      expect(r.status()).toBe(200);
      await expect(page.locator('main')).toContainText('€');
      const eurBalance = (await r.json()).data.summary.total_balance;
      test.info().annotations.push({ type: 'observation', description: `Total Balance USD=${usdBalance} vs EUR view=${eurBalance}` });

      // The choice is kept while moving around the app...
      await page.getByRole('link', { name: 'Transactions', exact: true }).click();
      await expect(page.getByLabel('Displayed currency')).toHaveValue('EUR');
      await expect(page.locator('main')).toContainText('€');
      // ...record whether it survives a full reload (not asserted: no documented rule).
      await page.reload();
      await page.waitForLoadState('networkidle');
      const afterReload = await page.getByLabel('Displayed currency').inputValue();
      test.info().annotations.push({ type: 'observation', description: `display currency after full reload: ${afterReload}` });
    } finally {
      await page.getByLabel('Displayed currency').selectOption(original);
      await page.waitForLoadState('networkidle');
    }
    await expect(page.getByLabel('Displayed currency')).toHaveValue(original);
  });

  test('DASH-12 a new expense updates monthly expenses, balance and category chart', async ({ page }) => {
    const before = (await api(page, 'GET', '/api/analytics/dashboard')).body.data.summary;
    const desc = uid('dash');
    const amount = 12.34;
    const id = await createTransactionUI(page, { amount, description: desc, category: 'Travel', type: 'Expense' });
    try {
      await gotoAndSettle(page, '/dashboard');
      expect(await kpi(page, 'Monthly Expenses')).toBeCloseTo(Number(before.monthly_expenses) + amount, 2);
      expect(await kpi(page, 'Total Balance')).toBeCloseTo(Number(before.total_balance) - amount, 2);
      await expect(page.locator('main')).toContainText('Travel');
      await expect(page.locator('main').getByRole('table')).toContainText(desc);
      await expect(page.locator('main').getByRole('table')).toContainText(`-${money(amount)}`);
    } finally {
      await api(page, 'DELETE', `/api/transactions/${id}`);
    }
    await gotoAndSettle(page, '/dashboard');
    expect(await kpi(page, 'Monthly Expenses')).toBeCloseTo(Number(before.monthly_expenses), 2);
  });
});
