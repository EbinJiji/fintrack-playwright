const { test, expect } = require('@playwright/test');
const { api, accountOf, gotoAndSettle } = require('./helpers');

// Only validation and read-only paths: no family is created and no invitation is sent.
const card = (page, heading) => page.locator('section, form, article, div').filter({ has: page.getByRole('heading', { name: heading, exact: true }) }).last();

test.describe('Family & sharing', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndSettle(page, '/family');
    await expect(page.getByRole('heading', { name: 'Family & sharing', level: 1 })).toBeVisible();
  });

  test('FAM-01 page shows create/join options for a user without a family', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Create your family' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Join a family' })).toBeVisible();
    await expect(page.getByPlaceholder('e.g. Our home')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create family' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preview invitation' })).toBeVisible();
  });

  test('FAM-02 create family requires a name', async ({ page }) => {
    let posts = 0;
    page.on('request', r => { if (/famil/i.test(r.url()) && r.method() === 'POST') posts++; });
    const name = page.getByRole('textbox', { name: 'Family name' });
    const btn = page.getByRole('button', { name: 'Create family' });
    await page.getByRole('checkbox', { name: /I agree to share/ }).check();
    await expect(name).toHaveValue('');
    // Disabled while prerequisites are missing; once enabled, the required field must block an empty submit.
    if (await btn.isEnabled()) {
      await btn.click();
      expect(await name.evaluate(e => e.validity.valueMissing)).toBe(true);
    }
    await page.waitForTimeout(800);
    expect(posts).toBe(0);
    // Whitespace-only passes browser validation; not submitted, since a server-side gap would create a real family.
    await name.fill('   ');
    test.info().annotations.push({ type: 'observation', description: `whitespace-only family name: browser-valid=${await name.evaluate(e => e.validity.valid)}, button enabled=${await btn.isEnabled()} (server-side check not exercised)` });
  });

  test('FAM-03 create family requires agreeing to the sharing terms', async ({ page }) => {
    let posts = 0;
    page.on('request', r => { if (/famil/i.test(r.url()) && r.method() === 'POST') posts++; });
    await page.getByRole('textbox', { name: 'Family name' }).fill('PW_TEST_family');
    await expect(page.getByRole('checkbox', { name: /I agree to share/ })).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Create family' })).toBeDisabled();
    await page.getByRole('checkbox', { name: /I agree to share/ }).check();
    const { body } = await api(page, 'GET', '/api/bootstrap');
    const createBtn = page.getByRole('button', { name: 'Create family' });
    if (!body.currency_confirmed) {
      // Name + consent alone leave the button disabled, with no on-screen reason (FT-004).
      await expect(createBtn).toBeDisabled();
      test.info().annotations.push({ type: 'observation', description: 'Create family disabled with name+consent while currency unconfirmed; no explanation shown' });
      if (accountOf(test.info()) !== 'new') return;
      // New account only (no history to label): confirm currency to test the prerequisite.
      await page.getByRole('checkbox', { name: /My existing history uses this one currency/ }).check();
      const confirmResp = page.waitForResponse(r => r.url().includes('/api/') && r.request().method() !== 'GET' && !r.url().includes('broadcasting'));
      await page.getByRole('button', { name: 'Confirm currency' }).click();
      expect((await confirmResp).status()).toBeLessThan(300);
      await page.getByRole('textbox', { name: 'Family name' }).fill('PW_TEST_family');
      await page.getByRole('checkbox', { name: /I agree to share/ }).check();
    }
    // With all prerequisites met the button enables (not clicked: no family is created).
    await expect(createBtn).toBeEnabled();
    expect(posts, 'no family created').toBe(0);
  });

  test('FAM-04 invitation code: empty and invalid codes are refused', async ({ page }) => {
    const code = page.getByRole('textbox', { name: 'Invitation code' });
    const btn = page.getByRole('button', { name: 'Preview invitation' });
    await expect(btn).toBeDisabled();
    const statuses = [];
    page.on('response', r => { if (/invit/i.test(r.url())) statuses.push(r.status()); });
    // Try plausible code shapes; the first one the form accepts is sent to the server.
    let tried = null;
    for (const candidate of ['PWTEST-INVALID-CODE-000', 'ABCD1234', 'abcdef0123456789abcdef0123456789', '00000000-0000-4000-8000-000000000000']) {
      await code.fill(candidate);
      if (await btn.isEnabled()) { tried = candidate; break; }
    }
    test.info().annotations.push({ type: 'observation', description: tried ? `code shape accepted by form: ${tried.length} chars` : 'no tried code shape enabled Preview' });
    if (tried) {
      await btn.click();
      await expect(page.locator('main')).toContainText(/invalid|not found|expired|could not|no invitation|check|unable/i);
      test.info().annotations.push({ type: 'observation', description: `invalid invite preview statuses ${JSON.stringify(statuses)}` });
      expect(statuses.every(s => s < 500)).toBe(true);
    }
  });

  test('FAM-05 Back to overview returns to the dashboard', async ({ page }) => {
    await page.getByRole('link', { name: 'Back to overview' }).or(page.getByRole('button', { name: 'Back to overview' })).first().click();
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
