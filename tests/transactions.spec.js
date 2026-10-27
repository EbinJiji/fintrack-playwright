const { test, expect } = require('@playwright/test');
const { api, kpi, money, uid, gotoAndSettle, fillTransaction, createTransactionUI } = require('./helpers');

const today = () => new Date().toLocaleDateString('en-CA'); // yyyy-mm-dd, local
const displayDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const row = (page, desc) => page.locator('tbody tr', { hasText: desc });
const findByDesc = async (page, desc) => (await api(page, 'GET', `/api/transactions?q=${encodeURIComponent(desc)}`)).body.data.filter(t => t.description === desc);

test.describe('Transactions', () => {
  const created = [];
  test.afterEach(async ({ page }) => {
    for (const desc of created.splice(0)) {
      for (const t of await findByDesc(page, desc).catch(() => [])) await api(page, 'DELETE', `/api/transactions/${t.transaction_uuid}`);
    }
  });

  test('TXN-01 list loads with summary, columns and pagination matching API', async ({ page }) => {
    await gotoAndSettle(page, '/transactions');
    await expect(page.getByRole('heading', { name: 'Transactions', level: 1 })).toBeVisible();
    for (const h of ['DATE', 'DESCRIPTION', 'CATEGORY', 'AMOUNT', 'ACTIONS']) {
      await expect(page.getByRole('columnheader', { name: h })).toBeVisible();
    }
    const { body } = await api(page, 'GET', '/api/transactions');
    const total = body.meta?.total ?? body.total ?? body.data.length;
    await expect(page.getByText(new RegExp(`Showing \\d+-\\d+ of ${total}$`))).toBeVisible();
    if (total === 0) await expect(page.getByText(/No (matching )?transactions/).filter({ visible: true })).toBeVisible();
  });

  test('TXN-02 empty form submit is blocked by required-field validation', async ({ page }) => {
    await gotoAndSettle(page, '/transactions');
    let posts = 0;
    page.on('request', r => { if (r.url().endsWith('/api/transactions') && r.method() === 'POST') posts++; });
    await page.getByRole('button', { name: 'Add Transaction' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Save Transaction' }).click();
    expect(await dialog.locator('#transaction-amount').evaluate(e => e.validationMessage)).not.toBe('');
    for (const id of ['#transaction-amount', '#transaction-description', '#transaction-category']) {
      expect(await dialog.locator(id).evaluate(e => e.validity.valid), `${id} invalid when empty`).toBe(false);
    }
    await expect(dialog).toBeVisible();
    expect(posts).toBe(0);
  });

  for (const [label, value] of [['zero', '0'], ['negative', '-5'], ['three decimals', '1.234']]) {
    test(`TXN-03 amount validation rejects ${label} (${value})`, async ({ page }) => {
      await gotoAndSettle(page, '/transactions');
      let posts = 0;
      page.on('request', r => { if (r.url().endsWith('/api/transactions') && r.method() === 'POST') posts++; });
      await page.getByRole('button', { name: 'Add Transaction' }).click();
      const dialog = await fillTransaction(page, { amount: value, description: uid('bad') });
      await dialog.getByRole('button', { name: 'Save Transaction' }).click();
      expect(await dialog.locator('#transaction-amount').evaluate(e => e.validationMessage)).not.toBe('');
      expect(posts).toBe(0);
    });
  }

  test('TXN-04 category and date are required', async ({ page }) => {
    await gotoAndSettle(page, '/transactions');
    await page.getByRole('button', { name: 'Add Transaction' }).click();
    const dialog = await fillTransaction(page, { amount: 5, description: uid('req'), category: null });
    await dialog.locator('#transaction-date').fill('');
    await dialog.getByRole('button', { name: 'Save Transaction' }).click();
    expect(await dialog.locator('#transaction-category').evaluate(e => e.validity.valueMissing)).toBe(true);
    expect(await dialog.locator('#transaction-date').evaluate(e => e.validity.valueMissing)).toBe(true);
    await expect(dialog).toBeVisible();
  });

  test('TXN-05 oversized amount is handled without a server error', async ({ page }) => {
    await gotoAndSettle(page, '/transactions');
    const desc = uid('big'); created.push(desc);
    const serverErrors = [];
    page.on('response', r => { if (r.url().includes('/api/transactions') && r.status() >= 500) serverErrors.push(r.status()); });
    await page.getByRole('button', { name: 'Add Transaction' }).click();
    const dialog = await fillTransaction(page, { amount: '999999999999999', description: desc });
    const resp = page.waitForResponse(r => r.url().endsWith('/api/transactions') && r.request().method() === 'POST', { timeout: 8000 }).catch(() => null);
    await dialog.getByRole('button', { name: 'Save Transaction' }).click();
    const r = await resp;
    test.info().annotations.push({ type: 'observation', description: r ? `server responded ${r.status()}` : 'blocked client-side' });
    expect(serverErrors, 'no 5xx for oversized amount').toEqual([]);
    if (r && r.status() === 422) await expect(dialog).toContainText(/amount|may not be greater|must not/i);
  });

  test('TXN-06 create expense: appears in list, persists after refresh, stored correctly', async ({ page }) => {
    const desc = uid('exp'); created.push(desc);
    await createTransactionUI(page, { amount: '42.50', description: desc, category: 'Groceries', type: 'Expense' });
    const r = row(page, desc);
    await expect(r).toContainText('Groceries');
    await expect(r).toContainText(`-${money(42.5)}`);
    await expect(r).toContainText(displayDate(today()));
    await page.reload();
    await expect(row(page, desc)).toContainText(`-${money(42.5)}`);
    const [stored] = await findByDesc(page, desc);
    expect(stored).toMatchObject({ type: 'expense', amount: '42.50', currency: 'USD' });
  });

  test('TXN-07 create income updates Total Income and shows a positive amount', async ({ page }) => {
    await gotoAndSettle(page, '/transactions');
    const incomeBefore = await kpi(page, 'Total Income');
    const desc = uid('inc'); created.push(desc);
    await createTransactionUI(page, { amount: '1000', description: desc, category: 'Salary', type: 'Income' });
    await expect(row(page, desc)).toContainText(`+${money(1000)}`);
    await expect.poll(() => kpi(page, 'Total Income')).toBeCloseTo(incomeBefore + 1000, 2);
  });

  test('TXN-08 edit transaction updates description, amount, type and category', async ({ page }) => {
    const desc = uid('edit'); const edited = desc + '_v2'; created.push(desc, edited);
    await createTransactionUI(page, { amount: '10', description: desc, category: 'Transport' });
    await page.getByRole('button', { name: `Edit ${desc}` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Edit Transaction' })).toBeVisible();
    await expect(dialog.locator('#transaction-amount')).toHaveValue('10');
    await fillTransaction(page, { amount: '25.75', description: edited, category: 'Shopping', type: 'Income' });
    const put = page.waitForResponse(r => /\/api\/transactions\/[\w-]+$/.test(r.url()) && r.request().method() === 'PUT');
    await dialog.getByRole('button', { name: 'Save Changes' }).click();
    expect((await put).status()).toBe(200);
    await expect(row(page, edited)).toContainText(`+${money(25.75)}`);
    await expect(row(page, edited)).toContainText('Shopping');
    await expect(row(page, desc).filter({ hasNotText: edited })).toHaveCount(0);
    const [stored] = await findByDesc(page, edited);
    expect(stored).toMatchObject({ type: 'income', amount: '25.75' });
  });

  test('TXN-09 delete transaction removes it (records whether a confirmation is asked)', async ({ page }) => {
    const desc = uid('del'); created.push(desc);
    const id = await createTransactionUI(page, { amount: '3', description: desc });
    const del = page.waitForResponse(r => r.url().endsWith(`/api/transactions/${id}`) && r.request().method() === 'DELETE', { timeout: 3000 }).catch(() => null);
    await page.getByRole('button', { name: `Delete ${desc}` }).click();
    let resp = await del;
    const confirmation = !resp;
    test.info().annotations.push({ type: 'observation', description: confirmation ? 'confirmation step shown before delete' : 'deleted immediately with no confirmation (FT-001)' });
    if (!resp) {
      const confirmDlg = page.locator('[role=dialog],[role=alertdialog]').last();
      const later = page.waitForResponse(r => r.url().endsWith(`/api/transactions/${id}`) && r.request().method() === 'DELETE');
      await confirmDlg.getByRole('button', { name: /delete|confirm/i }).last().click();
      resp = await later;
    }
    expect(resp.status()).toBe(200);
    await expect(row(page, desc)).toHaveCount(0);
    await page.reload();
    await expect(row(page, desc)).toHaveCount(0);
    expect(await findByDesc(page, desc)).toHaveLength(0);
    expect(confirmation, 'destructive delete should ask for confirmation (as Categories does)').toBe(true);
  });

  test('TXN-10 Cancel and Escape discard the form without saving', async ({ page }) => {
    await gotoAndSettle(page, '/transactions');
    let posts = 0;
    page.on('request', r => { if (r.url().endsWith('/api/transactions') && r.method() === 'POST') posts++; });
    for (const close of ['Cancel', 'Escape', 'Close modal']) {
      await page.getByRole('button', { name: 'Add Transaction' }).click();
      const dialog = await fillTransaction(page, { amount: 9, description: uid('cancel') });
      if (close === 'Escape') await page.keyboard.press('Escape');
      else await dialog.getByRole('button', { name: close }).click();
      await expect(dialog).toBeHidden();
    }
    expect(posts).toBe(0);
  });

  test('TXN-11 double-clicking Save creates only one record', async ({ page }) => {
    const desc = uid('dup'); created.push(desc);
    await gotoAndSettle(page, '/transactions');
    await page.getByRole('button', { name: 'Add Transaction' }).click();
    const dialog = await fillTransaction(page, { amount: '7.77', description: desc });
    await dialog.getByRole('button', { name: 'Save Transaction' }).dblclick();
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(2000);
    expect(await findByDesc(page, desc)).toHaveLength(1);
  });

  test('TXN-12 search: match, no match, and empty query', async ({ page }) => {
    const desc = uid('srch'); created.push(desc);
    await createTransactionUI(page, { amount: '4.20', description: desc });
    const search = page.getByRole('searchbox', { name: 'Search' });
    await search.fill(desc);
    await search.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/transactions\\?q=${desc}`));
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(row(page, desc)).toBeVisible();

    await search.fill('zz_no_such_txn_' + Date.now());
    await page.getByRole('button', { name: 'Search transactions' }).click();
    await expect(page.getByText('No matching transactions.').filter({ visible: true })).toBeVisible();
    await expect(page.getByText('Showing 0-0 of 0').filter({ visible: true })).toBeVisible();

    await search.fill('');
    await search.press('Enter');
    await expect(row(page, desc)).toBeVisible();
  });

  test('TXN-13 description is rendered as text, not HTML', async ({ page }) => {
    const desc = uid('xss') + '<img src=x onerror="window.__pwxss=1">'; created.push(desc);
    await createTransactionUI(page, { amount: '1', description: desc });
    await expect(page.locator('tbody tr', { hasText: '<img src=x' })).toBeVisible();
    expect(await page.evaluate(() => window.__pwxss)).toBeUndefined();
  });

  test('TXN-14 back-dated and future-dated entries', async ({ page }) => {
    const past = uid('past'); const future = uid('future'); created.push(past, future);
    await createTransactionUI(page, { amount: '2', description: past, date: '2025-01-15' });
    await expect(row(page, past)).toContainText('Jan 15, 2025');
    await gotoAndSettle(page, '/transactions');
    await page.getByRole('button', { name: 'Add Transaction' }).click();
    const nextYear = `${new Date().getFullYear() + 1}-01-15`;
    const dialog = await fillTransaction(page, { amount: '2', description: future, date: nextYear });
    const resp = page.waitForResponse(r => r.url().endsWith('/api/transactions') && r.request().method() === 'POST', { timeout: 8000 }).catch(() => null);
    await dialog.getByRole('button', { name: 'Save Transaction' }).click();
    const r = await resp;
    test.info().annotations.push({ type: 'observation', description: `future-dated transaction: ${r ? 'HTTP ' + r.status() : 'blocked client-side'}` });
    expect(r?.status() ?? 0).not.toBeGreaterThanOrEqual(500);
  });

  test('TXN-15 sorting and column filters availability', async ({ page }) => {
    await gotoAndSettle(page, '/transactions');
    const sortable = await page.locator('th[aria-sort], th button').count();
    const filters = await page.locator('main select, main [role=combobox]').count();
    test.info().annotations.push({ type: 'observation', description: `sortable headers=${sortable}, filter controls=${filters} (only free-text search is offered)` });
    // Rows are ordered newest first.
    const { body } = await api(page, 'GET', '/api/transactions');
    const dates = body.data.map(t => t.date.slice(0, 10));
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});
