const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { api, accountOf, gotoAndSettle } = require('./helpers');

const onlyNew = () => test.skip(accountOf(test.info()) !== 'new', 'writes preferences: run on the dedicated new account only');

test.describe('Settings', () => {
  test('SET-01 tabs switch sections and update the URL', async ({ page }) => {
    await gotoAndSettle(page, '/settings');
    await expect(page.getByRole('heading', { name: 'User Settings & Profile', level: 1 })).toBeVisible();
    for (const [tab, section, heading] of [
      ['Preferences & Alerts', 'alerts', 'Preferences & Alerts'],
      ['Data & Backup', 'data', 'Import data'],
      ['App & Security', 'app', 'Install FinTrack'],
      ['Profile', null, 'Personal Information'],
    ]) {
      await page.getByText(tab, { exact: true }).first().click();
      if (section) await expect(page).toHaveURL(new RegExp(`section=${section}`));
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
    }
  });

  test('SET-02 profile shows the signed-in user details', async ({ page }) => {
    await gotoAndSettle(page, '/settings');
    const me = (await api(page, 'GET', '/api/auth/me')).body;
    await expect(page.locator('#profile-name')).toHaveValue(me.name);
    await expect(page.locator('#profile-email')).toHaveValue(me.email);
    await expect(page.locator('#profile-currency')).toHaveValue(me.currency);
  });

  test('SET-03 Cancel Changes discards unsaved edits', async ({ page }) => {
    await gotoAndSettle(page, '/settings');
    const name = await page.locator('#profile-name').inputValue();
    let writes = 0;
    page.on('request', r => { if (r.url().includes('/api/') && ['PUT', 'PATCH', 'POST'].includes(r.method()) && !r.url().includes('broadcasting')) writes++; });
    await page.locator('#profile-name').fill('Temporary Name');
    await page.getByRole('button', { name: 'Cancel Changes' }).click();
    await expect(page.locator('#profile-name')).toHaveValue(name);
    expect(writes).toBe(0);
  });

  test('SET-04 empty name and invalid email are not saved', async ({ page }) => {
    await gotoAndSettle(page, '/settings');
    const me = (await api(page, 'GET', '/api/auth/me')).body;
    const statuses = [];
    page.on('response', r => { if (/\/api\/(settings|profile|user|auth\/me)/.test(r.url()) && r.request().method() !== 'GET') statuses.push(r.status()); });
    await page.locator('#profile-name').fill('');
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await page.waitForTimeout(1500);
    await page.locator('#profile-name').fill(me.name);
    await page.locator('#profile-email').fill('not-an-email');
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await page.waitForTimeout(1500);
    test.info().annotations.push({ type: 'observation', description: `profile write statuses: ${JSON.stringify(statuses)}` });
    expect(statuses.every(s => s >= 400 && s < 500), 'invalid profile must not save').toBe(true);
    const after = (await api(page, 'GET', '/api/auth/me')).body;
    expect(after).toMatchObject({ name: me.name, email: me.email });
    await page.getByRole('button', { name: 'Cancel Changes' }).click();
  });

  test('SET-05 profile name change persists after reload (then restored)', async ({ page }) => {
    onlyNew();
    await gotoAndSettle(page, '/settings');
    const original = await page.locator('#profile-name').inputValue();
    const temp = original + ' Edited';
    try {
      await page.locator('#profile-name').fill(temp);
      const resp = page.waitForResponse(r => r.url().includes('/api/') && ['PUT', 'PATCH', 'POST'].includes(r.request().method()) && !r.url().includes('broadcasting'));
      await page.getByRole('button', { name: 'Save Changes' }).click();
      expect((await resp).status()).toBeLessThan(300);
      await page.reload();
      await expect(page.locator('#profile-name')).toHaveValue(temp);
      await expect(page.getByRole('link', { name: 'Your profile and settings' })).toContainText(temp);
    } finally {
      await page.locator('#profile-name').fill(original);
      const resp = page.waitForResponse(r => r.url().includes('/api/') && ['PUT', 'PATCH', 'POST'].includes(r.request().method()) && !r.url().includes('broadcasting'));
      await page.getByRole('button', { name: 'Save Changes' }).click();
      await resp;
    }
    await page.reload();
    await expect(page.locator('#profile-name')).toHaveValue(original);
  });

  test('SET-06 alert preferences: toggles render; saving persists (new account)', async ({ page }) => {
    await gotoAndSettle(page, '/settings?section=alerts');
    const toggles = ['Monthly Expense Reports', 'Monthly Budget Alerts', 'Security Login Notifications', 'Send enabled alerts by email too'];
    for (const t of toggles) await expect(page.getByRole('checkbox', { name: new RegExp(t) })).toBeAttached();
    if (accountOf(test.info()) !== 'new') return;
    const box = page.getByRole('checkbox', { name: /Monthly Expense Reports/ });
    const before = await box.isChecked();
    try {
      await box.setChecked(!before, { force: true });
      const resp = page.waitForResponse(r => r.url().includes('/api/') && r.request().method() !== 'GET' && !r.url().includes('broadcasting'));
      await page.getByRole('button', { name: 'Save alert preferences' }).click();
      expect((await resp).status()).toBeLessThan(300);
      await page.reload();
      await expect(page.getByRole('checkbox', { name: /Monthly Expense Reports/ })).toBeChecked({ checked: !before });
    } finally {
      await page.getByRole('checkbox', { name: /Monthly Expense Reports/ }).setChecked(before, { force: true });
      const resp = page.waitForResponse(r => r.url().includes('/api/') && r.request().method() !== 'GET' && !r.url().includes('broadcasting'));
      await page.getByRole('button', { name: 'Save alert preferences' }).click();
      await resp;
    }
  });

  test('SET-07 monthly budget amount validation', async ({ page }) => {
    await gotoAndSettle(page, '/settings?section=alerts');
    let writes = 0;
    page.on('request', r => { if (/budget/i.test(r.url()) && r.method() !== 'GET') writes++; });
    const amount = page.getByLabel('Monthly budget amount');
    for (const v of ['', '0', '-10']) {
      await amount.fill(v);
      await page.getByRole('button', { name: 'Set monthly budget' }).click();
      expect(await amount.evaluate(e => e.validity.valid), `budget "${v}" invalid`).toBe(false);
    }
    expect(writes).toBe(0);
  });

  test('SET-08 monthly budget can be set (new account)', async ({ page }) => {
    onlyNew();
    await gotoAndSettle(page, '/settings?section=alerts');
    await page.getByLabel('Monthly budget amount').fill('500');
    const resp = page.waitForResponse(r => r.url().includes('/api/') && r.request().method() !== 'GET' && !r.url().includes('broadcasting'));
    await page.getByRole('button', { name: 'Set monthly budget' }).click();
    const r = await resp;
    expect(r.status()).toBeLessThan(300);
    await page.reload();
    await expect(page.locator('main')).toContainText(/500(\.00)?/);
  });

  test('SET-09 Data & Backup: import template downloads', async ({ page }) => {
    await gotoAndSettle(page, '/settings?section=data');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download template' }).click();
    const d = await download;
    const file = test.info().outputPath(d.suggestedFilename());
    await d.saveAs(file);
    const header = fs.readFileSync(file, 'utf8').split(/\r?\n/)[0];
    test.info().annotations.push({ type: 'observation', description: `template ${d.suggestedFilename()}: ${header.slice(0, 120)}` });
    expect(header.toLowerCase()).toMatch(/date|amount|description/);
    await expect(page.getByRole('button', { name: 'Connect Google Drive' })).toBeVisible();
  });

  test('SET-10 import rejects a non-CSV file (new account)', async ({ page }) => {
    onlyNew();
    await gotoAndSettle(page, '/settings?section=data');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose import file' }).click();
    const fc = await chooser;
    const statuses = [];
    page.on('response', r => { if (/import/i.test(r.url()) && r.request().method() === 'POST') statuses.push(r.status()); });
    await fc.setFiles({ name: 'PW_TEST_not_a_csv.txt', mimeType: 'text/plain', buffer: Buffer.from('this is not a transaction file') });
    await page.waitForTimeout(3000);
    const text = await page.locator('main').innerText();
    test.info().annotations.push({ type: 'observation', description: `import of .txt -> statuses ${JSON.stringify(statuses)}` });
    expect(statuses.every(s => s < 500)).toBe(true);
    expect(statuses.some(s => s >= 400) || /not supported|invalid|csv|xlsx|unsupported|failed|error/i.test(text)).toBe(true);
  });

  test('SET-11 account deletion requires the password (not executed)', async ({ page }) => {
    await gotoAndSettle(page, '/settings?section=app');
    await page.getByRole('button', { name: 'Delete Account' }).click();
    const confirm = page.getByRole('button', { name: 'Confirm Delete' });
    await expect(confirm).toBeDisabled();
    await expect(page.getByRole('textbox', { name: 'Password to confirm account deletion' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).last().click();
    await expect(confirm).toHaveCount(0);
  });
});
