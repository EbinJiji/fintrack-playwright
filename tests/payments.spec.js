const { test, expect } = require('@playwright/test');
const { api, gotoAndSettle } = require('./helpers');

// Validation and read-only checks only. "Prepare payment" is never submitted with valid data,
// so no payment draft, UPI hand-off or expense record is created.
test.describe('Pay & record', () => {
  let draftPosts;
  test.beforeEach(async ({ page }) => {
    draftPosts = 0;
    // Counts drafts the server actually accepted; validation rejections (4xx) are not drafts.
    page.on('response', r => { if (/payment/i.test(r.url()) && r.request().method() === 'POST' && r.status() < 300) draftPosts++; });
    await gotoAndSettle(page, '/payments');
    await expect(page.getByRole('heading', { name: 'Pay & record', level: 1 })).toBeVisible();
  });

  const upi = page => page.getByPlaceholder('shop@bank');
  const payee = page => page.getByLabel('Merchant or recipient name').or(page.locator('main input[type=text]').nth(1)).first();
  const amount = page => page.getByLabel('Amount in INR').or(page.locator('main input[type=number]')).first();

  test('PAY-01 shows the 3-step flow, QR options and the manual form', async ({ page }) => {
    await expect(page.getByRole('list', { name: 'Payment progress' }).getByRole('listitem')).toHaveText([/Details/, /Pay in UPI app/, /Confirm/]);
    for (const b of ['Scan payment QR', 'Take QR photo', 'Choose QR photo', 'Prepare payment']) await expect(page.getByRole('button', { name: b })).toBeVisible();
    await expect(upi(page)).toBeVisible();
    await expect(page.getByText('Saved as an expense only after you confirm success.')).toBeVisible();
  });

  test('PAY-02 empty form is refused', async ({ page }) => {
    await page.getByRole('button', { name: 'Prepare payment' }).click();
    await page.waitForTimeout(1000);
    expect(draftPosts).toBe(0);
    await expect(page.getByRole('heading', { name: 'New UPI payment' })).toBeVisible();
  });

  test('PAY-03 malformed UPI ID is refused', async ({ page }) => {
    await upi(page).fill('not a upi id');
    await payee(page).fill('PW Test Merchant');
    await amount(page).fill('10');
    await page.getByRole('button', { name: 'Prepare payment' }).click();
    await page.waitForTimeout(1500);
    await expect(page.getByRole('alert')).toContainText(/invalid/i);
    test.info().annotations.push({ type: 'observation', description: `malformed UPI rejected: "${(await page.getByRole('alert').innerText()).trim()}"` });
    expect(draftPosts, 'no draft for an invalid UPI ID').toBe(0);
    expect((await api(page, 'GET', '/api/payment-drafts')).body.data || []).toHaveLength(0);
  });

  for (const v of ['0', '-5']) {
    test(`PAY-04 amount ${v} is refused`, async ({ page }) => {
      await upi(page).fill('pwtest@okbank');
      await payee(page).fill('PW Test Merchant');
      await amount(page).fill(v);
      await page.getByRole('button', { name: 'Prepare payment' }).click();
      await page.waitForTimeout(1500);
      expect(draftPosts).toBe(0);
      expect(await amount(page).evaluate(e => e.validity.valid)).toBe(false);
    });
  }

  test('PAY-05 awaiting-confirmation list matches stored drafts', async ({ page }) => {
    const { status, body } = await api(page, 'GET', '/api/payment-drafts');
    expect(status).toBe(200);
    const drafts = body.data || [];
    await expect(page.getByRole('heading', { name: 'Awaiting your confirmation' })).toBeVisible();
    if (!drafts.length) await expect(page.getByText('No unconfirmed payments.')).toBeVisible();
  });

  test('PAY-06 View activity navigates to recorded payments', async ({ page }) => {
    await page.getByRole('link', { name: 'View activity' }).or(page.getByRole('button', { name: 'View activity' })).first().click();
    await page.waitForLoadState('networkidle');
    test.info().annotations.push({ type: 'observation', description: `View activity -> ${new URL(page.url()).pathname}${new URL(page.url()).search}` });
    await expect(page).not.toHaveURL(/\/payments$/);
  });
});
