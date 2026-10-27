const { test, expect } = require('@playwright/test');
const { api, uid, gotoAndSettle } = require('./helpers');

const isoDaysFromNow = (d) => { const t = new Date(); t.setDate(t.getDate() + d); return t.toLocaleDateString('en-CA'); };
const schedule = (page, desc) => page.locator('main article, main li, main [class*=card]').filter({ hasText: desc }).last();
const findSchedule = async (page, desc) => (await api(page, 'GET', '/api/recurring')).body.data.find(s => s.description === desc);

async function openForm(page) {
  await gotoAndSettle(page, '/recurring');
  await page.getByRole('button', { name: 'New recurring payment' }).click();
  const form = page.getByRole('dialog');
  await expect(form.getByRole('heading', { name: 'New recurring payment' })).toBeVisible();
  return form;
}

async function fillSchedule(form, { desc, amount = '10', category = 'Housing', repeats = 'weekly', start, type }) {
  if (type) await form.getByRole('button', { name: type, exact: true }).click();
  if (desc !== undefined) await form.getByPlaceholder('e.g. Rent, salary or subscriptions').fill(desc);
  if (amount !== undefined) await form.getByPlaceholder('0.00').fill(String(amount));
  if (category) await form.getByLabel('Category').selectOption({ label: category });
  if (repeats) await form.getByLabel('Repeats').selectOption(repeats);
  if (start) await form.locator('input[type=date]').first().fill(start);
}

async function createSchedule(page, data) {
  const form = await openForm(page);
  await fillSchedule(form, data);
  const resp = page.waitForResponse(r => r.url().endsWith('/api/recurring') && r.request().method() === 'POST');
  await form.getByRole('button', { name: 'Save schedule' }).click();
  expect((await resp).status()).toBe(201);
  await expect(form).toBeHidden();
}

test.describe('Recurring payments', () => {
  const created = [];
  test.afterEach(async ({ page }) => {
    for (const desc of created.splice(0)) {
      const s = await findSchedule(page, desc).catch(() => null);
      if (s) await api(page, 'DELETE', `/api/recurring/${s.uuid}`);
    }
  });

  test('REC-01 page loads with tabs and an accurate active-schedule count', async ({ page }) => {
    await gotoAndSettle(page, '/recurring');
    await expect(page.getByRole('heading', { name: 'Recurring payments', level: 1 })).toBeVisible();
    for (const tab of ['All schedules', 'Active', 'Stopped & ended']) await expect(page.getByRole('button', { name: tab, exact: true })).toBeVisible();
    const active = (await api(page, 'GET', '/api/recurring')).body.data.filter(s => s.is_active).length;
    await expect(page.getByText(new RegExp(`^${active} active schedules?`))).toBeVisible();
    if (active === 0) await expect(page.getByRole('button', { name: 'Create a schedule' })).toBeVisible();
  });

  test('REC-02 empty form is blocked by required-field validation', async ({ page }) => {
    let posts = 0;
    page.on('request', r => { if (r.url().endsWith('/api/recurring') && r.method() === 'POST') posts++; });
    const form = await openForm(page);
    await form.getByRole('button', { name: 'Save schedule' }).click();
    expect(await form.getByPlaceholder('e.g. Rent, salary or subscriptions').evaluate(e => e.validity.valueMissing)).toBe(true);
    expect(await form.getByPlaceholder('0.00').evaluate(e => e.validity.valueMissing)).toBe(true);
    expect(await form.getByLabel('Category').evaluate(e => e.validity.valueMissing)).toBe(true);
    await expect(form).toBeVisible();
    expect(posts).toBe(0);
  });

  test('REC-03 amount and first-date validation', async ({ page }) => {
    let posts = 0;
    page.on('request', r => { if (r.url().endsWith('/api/recurring') && r.method() === 'POST') posts++; });
    const form = await openForm(page);
    await fillSchedule(form, { desc: uid('recval'), amount: '0' });
    await form.getByRole('button', { name: 'Save schedule' }).click();
    expect(await form.getByPlaceholder('0.00').evaluate(e => e.validity.rangeUnderflow)).toBe(true);
    await form.getByPlaceholder('0.00').fill('10');
    await form.locator('input[type=date]').first().fill(isoDaysFromNow(-3));
    await form.getByRole('button', { name: 'Save schedule' }).click();
    expect(await form.locator('input[type=date]').first().evaluate(e => e.validity.rangeUnderflow), 'past first date rejected').toBe(true);
    expect(posts).toBe(0);
  });

  test('REC-04 end date earlier than first date is rejected', async ({ page }) => {
    const desc = uid('recend'); created.push(desc);
    const form = await openForm(page);
    await fillSchedule(form, { desc, start: isoDaysFromNow(10) });
    await form.getByLabel('Set an end date').check();
    const end = form.locator('input[type=date]').nth(1);
    await expect(end).toBeVisible();
    await end.fill(isoDaysFromNow(5));
    const resp = page.waitForResponse(r => r.url().endsWith('/api/recurring') && r.request().method() === 'POST', { timeout: 6000 }).catch(() => null);
    await form.getByRole('button', { name: 'Save schedule' }).click();
    const r = await resp;
    const clientBlocked = await end.evaluate(e => !e.validity.valid).catch(() => false);
    test.info().annotations.push({ type: 'observation', description: r ? `server responded ${r.status()}` : `blocked client-side (${clientBlocked})` });
    expect(r ? r.status() : 422, 'end-before-start must not be saved').toBeGreaterThanOrEqual(400);
    expect(r ? r.status() : 422).toBeLessThan(500);
  });

  test('REC-05 create weekly expense schedule: card, Active tab and stored data', async ({ page }) => {
    const desc = uid('rec'); created.push(desc);
    const start = isoDaysFromNow(2);
    await createSchedule(page, { desc, amount: '10', category: 'Housing', repeats: 'weekly', start });
    const card = schedule(page, desc);
    await expect(card).toContainText('$10.00 / week');
    await expect(card).toContainText('Housing');
    await expect(card).toContainText('Active');
    await page.getByRole('button', { name: 'Active', exact: true }).click();
    await expect(page.getByText(desc)).toBeVisible();
    await page.reload();
    await expect(page.getByText(desc)).toBeVisible();
    const s = await findSchedule(page, desc);
    expect(s).toMatchObject({ amount: '10.00', frequency: 'weekly', type: 'expense', is_active: true, start_date: start, next_date: start });
  });

  for (const [freq, label] of [['daily', '/ day'], ['monthly', '/ month'], ['yearly', '/ year']]) {
    test(`REC-06 ${freq} income schedule shows "${label}"`, async ({ page }) => {
      const desc = uid('rec' + freq); created.push(desc);
      await createSchedule(page, { desc, amount: '250', category: 'Salary', repeats: freq, type: 'Income', start: isoDaysFromNow(3) });
      await expect(schedule(page, desc)).toContainText(`$250.00 ${label}`);
      expect((await findSchedule(page, desc)).type).toBe('income');
    });
  }

  test('REC-07 edit schedule amount and frequency', async ({ page }) => {
    const desc = uid('recedit'); created.push(desc);
    await createSchedule(page, { desc, start: isoDaysFromNow(2) });
    await page.getByRole('button', { name: `Edit ${desc}` }).click();
    const form = page.getByRole('dialog');
    await expect(form.getByPlaceholder('0.00')).toHaveValue(/^10(\.00)?$/);
    await fillSchedule(form, { amount: '15.5', repeats: 'monthly', category: null });
    const put = page.waitForResponse(r => /\/api\/recurring\/[\w-]+$/.test(r.url()) && ['PUT', 'PATCH'].includes(r.request().method()));
    await form.getByRole('button', { name: /Save/ }).click();
    expect((await put).status()).toBe(200);
    await expect(schedule(page, desc)).toContainText('$15.50 / month');
    expect(await findSchedule(page, desc)).toMatchObject({ amount: '15.50', frequency: 'monthly' });
  });

  test('REC-08 stop schedule moves it to Stopped & ended', async ({ page }) => {
    const desc = uid('recstop'); created.push(desc);
    await createSchedule(page, { desc, start: isoDaysFromNow(2) });
    await page.getByRole('button', { name: `Stop ${desc}` }).click();
    const confirm = page.locator('[role=dialog],[role=alertdialog]').last();
    if (await confirm.isVisible().catch(() => false)) {
      test.info().annotations.push({ type: 'observation', description: 'stop asks for confirmation' });
      await confirm.getByRole('button', { name: /stop|confirm/i }).last().click();
    }
    await expect.poll(async () => (await findSchedule(page, desc)).is_active).toBe(false);
    await page.getByRole('button', { name: 'Stopped & ended', exact: true }).click();
    await expect(page.getByText(desc)).toBeVisible();
    await page.getByRole('button', { name: 'Active', exact: true }).click();
    await expect(page.getByText(desc)).toHaveCount(0);
  });

  test('REC-09 delete schedule removes it', async ({ page }) => {
    const desc = uid('recdel'); created.push(desc);
    await createSchedule(page, { desc, start: isoDaysFromNow(2) });
    const del = page.waitForResponse(r => /\/api\/recurring\/[\w-]+$/.test(r.url()) && r.request().method() === 'DELETE', { timeout: 4000 }).catch(() => null);
    await page.getByRole('button', { name: `Delete ${desc}` }).click();
    let resp = await del;
    test.info().annotations.push({ type: 'observation', description: resp ? 'deleted with no confirmation' : 'confirmation shown before delete' });
    if (!resp) {
      const later = page.waitForResponse(r => /\/api\/recurring\/[\w-]+$/.test(r.url()) && r.request().method() === 'DELETE');
      await page.locator('[role=dialog],[role=alertdialog]').last().getByRole('button', { name: /delete|confirm/i }).last().click();
      resp = await later;
    }
    expect(resp.status()).toBeLessThan(300);
    await expect(page.getByText(desc)).toHaveCount(0);
    expect(await findSchedule(page, desc)).toBeUndefined();
  });

  test('REC-10 creating a future-dated schedule does not post a transaction yet', async ({ page }) => {
    const desc = uid('recnotx'); created.push(desc);
    await createSchedule(page, { desc, start: isoDaysFromNow(5) });
    const tx = await api(page, 'GET', `/api/transactions?q=${desc}`);
    expect(tx.body.data).toHaveLength(0);
  });
});
