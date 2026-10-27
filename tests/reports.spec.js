const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { api, uid, money, gotoAndSettle, createTransactionUI } = require('./helpers');

const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const reportsResp = (page) => page.waitForResponse(r => r.url().includes('/api/analytics/reports') && r.status() === 200);
const kpiValue = async (page, label) => {
  const text = await page.locator('main').innerText();
  const m = text.match(new RegExp(label + '\\s*\\n+\\s*([-+]?\\$[\\d,]+\\.\\d{2})'));
  return m ? Number(m[1].replace(/[^0-9.-]/g, '')) : NaN;
};

test.describe('Reports & analytics', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndSettle(page, '/reports');
    await expect(page.getByRole('heading', { name: 'Expense Analysis Report', level: 1 })).toBeVisible();
  });

  test('REP-01 page shows KPIs and sections', async ({ page }) => {
    for (const t of ['Top Category', 'Savings Rate', 'Total Expenses', 'Average Daily Spend']) await expect(page.getByText(new RegExp('^' + t + '$', 'i')).first()).toBeVisible();
    for (const h of ['Monthly Spending Breakdown', 'Category Weight', 'Top Transactions This Period']) await expect(page.getByRole('heading', { name: h })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
  });

  test('REP-02 default range is the last 30 days', async ({ page }) => {
    const end = new Date(); const start = new Date(); start.setDate(end.getDate() - 29);
    await expect(page.getByText(`Visualizing your financial health from ${fmt(start)} to ${fmt(end)}.`)).toBeVisible();
  });

  test('REP-03 range presets update the period text', async ({ page }) => {
    const subtitle = page.getByText(/Visualizing your financial health from/);
    const end = new Date(); const start30 = new Date(); start30.setDate(end.getDate() - 29);
    const initial = await subtitle.innerText();

    const resp = reportsResp(page);
    await page.getByRole('button', { name: 'Last 3 Months', exact: true }).click();
    const range = (await (await resp).json()).data.range;
    await expect(subtitle).toContainText(`from ${fmt(new Date(range.start_date + 'T00:00:00'))} to ${fmt(new Date(range.end_date + 'T00:00:00'))}`);
    await expect(subtitle).not.toHaveText(initial);

    await page.getByRole('button', { name: 'Year-to-Date', exact: true }).click();
    await expect(subtitle).toContainText(`from ${fmt(new Date(end.getFullYear(), 0, 1))} to ${fmt(end)}`);

    // Returning to a range already loaded may be served from cache; only the visible result matters.
    await page.getByRole('button', { name: 'Last 30 Days', exact: true }).click();
    await expect(subtitle).toContainText(`from ${fmt(start30)} to ${fmt(end)}`);
  });

  test('REP-04 custom range applies chosen dates', async ({ page }) => {
    await page.getByRole('button', { name: 'Custom Range', exact: true }).click();
    const dates = page.locator('main input[type=date]');
    await expect(dates.first()).toBeVisible();
    const y = new Date().getFullYear();
    const resp = reportsResp(page);
    await dates.nth(0).fill(`${y}-02-01`);
    await dates.nth(1).fill(`${y}-02-28`);
    const apply = page.getByRole('button', { name: /apply/i });
    if (await apply.count()) await apply.click();
    await resp;
    await expect(page.getByText(/Visualizing your financial health/)).toContainText(`from Feb 1, ${y} to Feb 28, ${y}`);
  });

  test('REP-05 custom range with end before start is not accepted silently', async ({ page }) => {
    await page.getByRole('button', { name: 'Custom Range', exact: true }).click();
    const dates = page.locator('main input[type=date]');
    const y = new Date().getFullYear();
    const statuses = [];
    page.on('response', r => { if (r.url().includes('/api/analytics/reports')) statuses.push(r.status()); });
    await dates.nth(0).fill(`${y}-03-31`);
    await dates.nth(1).fill(`${y}-03-01`);
    const apply = page.getByRole('button', { name: /apply/i });
    if (await apply.count()) await apply.click();
    await page.waitForTimeout(2500);
    const subtitle = await page.getByText(/Visualizing your financial health/).innerText();
    test.info().annotations.push({ type: 'observation', description: `inverted range -> statuses ${JSON.stringify(statuses)}; subtitle "${subtitle}"` });
    expect(statuses.every(s => s < 500), 'no server error').toBe(true);
    expect(subtitle, 'inverted range must not be displayed as valid').not.toContain(`from Mar 31, ${y} to Mar 1, ${y}`);
  });

  test('REP-06 category filter re-queries for the chosen category', async ({ page }) => {
    const select = page.getByRole('combobox', { name: 'Category' });
    const resp = page.waitForResponse(r => r.url().includes('/api/analytics/reports') && /category/.test(r.url()));
    await select.selectOption({ label: 'Groceries' });
    expect((await resp).status()).toBe(200);
    await expect(select.locator('option:checked')).toHaveText('Groceries');
  });

  test('REP-07 UI KPIs match API and the expense total matches the transactions ledger', async ({ page }) => {
    const { body } = await api(page, 'GET', '/api/analytics/reports');
    const k = body.data.kpis;
    expect(await kpiValue(page, 'TOTAL EXPENSES')).toBeCloseTo(Number(k.total_expenses), 2);
    // Ledger cross-check for the same window (USD, non-transfer expenses).
    const tx = (await api(page, 'GET', '/api/transactions')).body.data;
    const { start_date, end_date } = body.data.range;
    const sum = tx.filter(t => t.type === 'expense' && (t.currency || 'USD') === body.data.currency && !t.internal_transfer)
      .filter(t => t.date.slice(0, 10) >= start_date && t.date.slice(0, 10) <= end_date)
      .reduce((s, t) => s + Number(t.amount), 0);
    expect(Number(k.total_expenses)).toBeCloseTo(sum, 2);
  });

  test('REP-08 a new expense is reflected in totals, top category and top transactions', async ({ page }) => {
    const before = Number((await api(page, 'GET', '/api/analytics/reports')).body.data.kpis.total_expenses);
    const desc = uid('rep');
    const id = await createTransactionUI(page, { amount: '33.33', description: desc, category: 'Entertainment' });
    try {
      await gotoAndSettle(page, '/reports');
      await expect.poll(() => kpiValue(page, 'TOTAL EXPENSES')).toBeCloseTo(before + 33.33, 2);
      await expect(page.locator('main')).toContainText(desc);
      await expect(page.locator('main')).toContainText(money(33.33));
      await expect(page.locator('main')).toContainText('Entertainment');
    } finally {
      await api(page, 'DELETE', `/api/transactions/${id}`);
    }
  });

  test('REP-09 Export CSV downloads a CSV file with a header row', async ({ page }) => {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const d = await download;
    expect(d.suggestedFilename()).toMatch(/\.csv$/i);
    const file = test.info().outputPath(d.suggestedFilename());
    await d.saveAs(file);
    const first = fs.readFileSync(file, 'utf8').split(/\r?\n/)[0];
    test.info().annotations.push({ type: 'observation', description: `CSV ${d.suggestedFilename()} header: ${first.slice(0, 120)}` });
    expect(first.split(',').length).toBeGreaterThan(2);
  });

  test('REP-10 Manage Categories and View All links navigate', async ({ page }) => {
    await page.getByRole('button', { name: 'Manage Categories' }).click();
    await expect(page).toHaveURL(/\/categories/);
    await gotoAndSettle(page, '/reports');
    await page.getByRole('button', { name: 'View All' }).click();
    await expect(page).toHaveURL(/\/transactions/);
  });
});
