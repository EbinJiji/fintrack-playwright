const { test, expect } = require('@playwright/test');
const { api, uid, gotoAndSettle, createTransactionUI } = require('./helpers');

const STARTERS = ['Bills & Utilities', 'Entertainment', 'Food & Dining', 'Freelance & Business', 'Groceries',
  'Healthcare', 'Housing', 'Other', 'Salary', 'Shopping', 'Transport', 'Travel'];
const findCat = async (page, label) => (await api(page, 'GET', '/api/categories')).body.data.find(c => c.label === label);

async function openNew(page) {
  await gotoAndSettle(page, '/categories');
  await page.getByRole('button', { name: 'New Category' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Create New Category' })).toBeVisible();
  return dialog;
}

async function createCategory(page, name, { icon = 'pets', color = 'Select emerald color' } = {}) {
  const dialog = await openNew(page);
  await dialog.locator('#category-name').fill(name);
  await dialog.getByRole('button', { name: icon, exact: true }).click();
  await dialog.getByRole('button', { name: color }).click();
  const resp = page.waitForResponse(r => r.url().endsWith('/api/categories') && r.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Create Category' }).click();
  const r = await resp;
  expect(r.status()).toBe(201);
  await expect(dialog).toBeHidden();
  return (await r.json()).data;
}

test.describe('Categories', () => {
  const created = [];
  test.afterEach(async ({ page }) => {
    for (const label of created.splice(0)) {
      const c = await findCat(page, label).catch(() => null);
      if (c) await api(page, 'DELETE', `/api/categories/${c.category_uuid}`);
    }
  });

  test('CAT-01 list shows starter categories matching the API', async ({ page }) => {
    await gotoAndSettle(page, '/categories');
    await expect(page.getByRole('heading', { name: 'Manage Categories', level: 1 })).toBeVisible();
    const labels = (await api(page, 'GET', '/api/categories')).body.data.map(c => c.label);
    for (const l of labels) await expect(page.getByRole('heading', { name: l, exact: true })).toBeVisible();
    for (const s of STARTERS) expect(labels, 'starter category present').toContain(s);
  });

  test('CAT-02 empty and whitespace-only names are rejected', async ({ page }) => {
    let posts = 0;
    page.on('request', r => { if (r.url().endsWith('/api/categories') && r.method() === 'POST') posts++; });
    const dialog = await openNew(page);
    await dialog.getByRole('button', { name: 'Create Category' }).click();
    expect(await dialog.locator('#category-name').evaluate(e => e.validity.valueMissing)).toBe(true);
    expect(posts).toBe(0);

    await dialog.locator('#category-name').fill('    ');
    const resp = page.waitForResponse(r => r.url().endsWith('/api/categories') && r.request().method() === 'POST', { timeout: 5000 }).catch(() => null);
    await dialog.getByRole('button', { name: 'Create Category' }).click();
    const r = await resp;
    test.info().annotations.push({ type: 'observation', description: `whitespace name: ${r ? 'server ' + r.status() : 'blocked client-side'}` });
    if (r) expect(r.status()).toBe(422);
    await expect(dialog).toBeVisible();
  });

  test('CAT-03 duplicate name (exact and different case) is refused', async ({ page }) => {
    const dialog = await openNew(page);
    for (const name of ['Groceries', 'groceries']) {
      await dialog.locator('#category-name').fill(name);
      const resp = page.waitForResponse(r => r.url().endsWith('/api/categories') && r.request().method() === 'POST');
      await dialog.getByRole('button', { name: 'Create Category' }).click();
      const r = await resp;
      if (r.status() === 201) created.push(name);
      expect(r.status(), `duplicate "${name}"`).toBe(422);
      await expect(dialog).toContainText('You already have a category with this name.');
    }
  });

  test('CAT-04 overly long name is handled without a server error', async ({ page }) => {
    const name = uid('long') + 'x'.repeat(300);
    created.push(name);
    const dialog = await openNew(page);
    await dialog.locator('#category-name').fill(name);
    const resp = page.waitForResponse(r => r.url().endsWith('/api/categories') && r.request().method() === 'POST', { timeout: 6000 }).catch(() => null);
    await dialog.getByRole('button', { name: 'Create Category' }).click();
    const r = await resp;
    const typed = await dialog.locator('#category-name').inputValue().catch(() => '');
    test.info().annotations.push({ type: 'observation', description: `long name: maxlength kept ${typed.length} chars; ${r ? 'server ' + r.status() : 'no request'}` });
    expect(r ? r.status() : 0).toBeLessThan(500);
  });

  test('CAT-05 create category with icon and colour; usable in transactions and reports', async ({ page }) => {
    const name = uid('cat'); created.push(name);
    const data = await createCategory(page, name);
    expect(data).toMatchObject({ label: name, icon: 'pets' });
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();

    await gotoAndSettle(page, '/transactions');
    await page.getByRole('button', { name: 'Add Transaction' }).click();
    await expect(page.getByRole('dialog').locator('#transaction-category option', { hasText: name })).toHaveCount(1);
    await page.keyboard.press('Escape');
    await gotoAndSettle(page, '/reports');
    await expect(page.locator('main select option', { hasText: name })).toHaveCount(1);
  });

  test('CAT-06 edit category name', async ({ page }) => {
    const name = uid('catedit'); const renamed = name + '_v2'; created.push(name, renamed);
    await createCategory(page, name);
    await page.getByRole('button', { name: `Edit ${name}` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Edit Category' })).toBeVisible();
    await expect(dialog.locator('#category-name')).toHaveValue(name);
    await dialog.locator('#category-name').fill(renamed);
    const put = page.waitForResponse(r => /\/api\/categories\/[\w-]+$/.test(r.url()) && r.request().method() === 'PUT');
    await dialog.getByRole('button', { name: 'Save Changes' }).click();
    expect((await put).status()).toBe(200);
    await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
  });

  test('CAT-07 delete asks for confirmation; Cancel keeps, Delete removes', async ({ page }) => {
    const name = uid('catdel'); created.push(name);
    await createCategory(page, name);
    await page.getByRole('button', { name: `Delete ${name}` }).click();
    let confirm = page.getByRole('dialog');
    await expect(confirm).toContainText(`Delete ${name}?`);
    await expect(confirm).toContainText('Existing transactions and their bills will be kept');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();

    await page.getByRole('button', { name: `Delete ${name}` }).click();
    confirm = page.getByRole('dialog');
    const del = page.waitForResponse(r => /\/api\/categories\/[\w-]+$/.test(r.url()) && r.request().method() === 'DELETE');
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    expect((await del).status()).toBe(200);
    await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
    expect(await findCat(page, name)).toBeUndefined();
  });

  test('CAT-08 deleting a category in use keeps its transactions and their label', async ({ page }) => {
    const name = uid('catused'); const desc = uid('catusedtx'); created.push(name);
    await createCategory(page, name);
    const txId = await createTransactionUI(page, { amount: '6', description: desc, category: name });
    try {
      const c = await findCat(page, name);
      const r = await api(page, 'DELETE', `/api/categories/${c.category_uuid}`);
      expect(r.status).toBe(200);
      await gotoAndSettle(page, '/transactions');
      const row = page.locator('tbody tr', { hasText: desc });
      await expect(row).toBeVisible();
      await expect(row).toContainText(name);
    } finally {
      await api(page, 'DELETE', `/api/transactions/${txId}`);
    }
  });

  test('CAT-09 icon search filters the icon list', async ({ page }) => {
    const dialog = await openNew(page);
    await dialog.getByRole('searchbox', { name: 'Search icons' }).fill('coffee');
    await expect(dialog.getByRole('button', { name: 'coffee', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'pets', exact: true })).toHaveCount(0);
    await dialog.getByRole('searchbox', { name: 'Search icons' }).fill('zzzz-no-icon');
    await expect(dialog.getByRole('button', { name: 'coffee', exact: true })).toHaveCount(0);
  });
});
