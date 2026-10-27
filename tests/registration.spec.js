const crypto = require('crypto');
const { test, expect } = require('@playwright/test');
const { existingUser, api, rememberDisposable, forgetDisposable } = require('./helpers');

const fill = async (page, { name, email, password, confirm }) => {
  if (name !== undefined) await page.locator('#name').fill(name);
  if (email !== undefined) await page.locator('#email').fill(email);
  if (password !== undefined) await page.locator('#password').fill(password);
  if (confirm !== undefined) await page.locator('#confirmPassword').fill(confirm);
};
const submit = page => page.getByRole('button', { name: 'Create Account' }).click();

test.describe('Registration form', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Join for free' }).click();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByRole('heading', { name: 'Create Account' })).toBeVisible();
  });

  test('REG-01 shows all required fields', async ({ page }) => {
    for (const label of ['Full Name', 'Email address', 'Password', 'Confirm Password']) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/');
  });

  test('REG-02 empty submit shows required-field messages and sends nothing', async ({ page }) => {
    let calls = 0;
    page.on('request', r => { if (r.url().endsWith('/api/auth/register')) calls++; });
    await submit(page);
    const form = page.locator('form');
    await expect(form).toContainText('Name must be at least 2 characters');
    await expect(form).toContainText('Enter a valid email address');
    await expect(form).toContainText('Password must be at least 8 characters');
    expect(calls).toBe(0);
  });

  test('REG-03 invalid email is rejected', async ({ page }) => {
    await fill(page, { name: 'PW Test', email: 'not-an-email', password: 'Passw0rd!x', confirm: 'Passw0rd!x' });
    await submit(page);
    await expect(page.locator('form')).toContainText('Enter a valid email address');
    await expect(page).toHaveURL(/register/);
  });

  test('REG-04 password shorter than 8 characters is rejected', async ({ page }) => {
    await fill(page, { name: 'PW Test', email: 'pw.valid@example.com', password: 'short', confirm: 'short' });
    await submit(page);
    await expect(page.locator('form')).toContainText('Password must be at least 8 characters');
  });

  test('REG-05 password confirmation mismatch is rejected', async ({ page }) => {
    await fill(page, { name: 'PW Test', email: 'pw.valid@example.com', password: 'Passw0rd!x1', confirm: 'Passw0rd!x2' });
    await submit(page);
    await expect(page.locator('form')).toContainText('Passwords do not match');
    await expect(page).toHaveURL(/register/);
  });

  test('REG-06 one-character name is rejected', async ({ page }) => {
    await fill(page, { name: 'P', email: 'pw.valid@example.com', password: 'Passw0rd!x', confirm: 'Passw0rd!x' });
    await submit(page);
    await expect(page.locator('form')).toContainText('Name must be at least 2 characters');
  });

  test('REG-07 both password fields are masked and independently toggleable', async ({ page }) => {
    await fill(page, { password: 'Passw0rd!x', confirm: 'Passw0rd!x' });
    await expect(page.locator('#password')).toHaveAttribute('type', 'password');
    await expect(page.locator('#confirmPassword')).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Toggle password', exact: true }).click();
    await expect(page.locator('#password')).toHaveAttribute('type', 'text');
    await expect(page.locator('#confirmPassword')).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Toggle confirm password' }).click();
    await expect(page.locator('#confirmPassword')).toHaveAttribute('type', 'text');
  });

  test('REG-08 duplicate registration with an existing email is refused (single request)', async ({ page }) => {
    await fill(page, { name: 'PW Dup', email: existingUser().email, password: 'Passw0rd!Dup1', confirm: 'Passw0rd!Dup1' });
    const resp = page.waitForResponse(r => r.url().endsWith('/api/auth/register'));
    await submit(page);
    expect((await resp).status()).toBe(422);
    await expect(page.locator('form')).toContainText('The email has already been taken.');
    await expect(page).toHaveURL(/register/);
  });

  test('REG-09 duplicate check is case-insensitive', async ({ page }) => {
    await fill(page, { name: 'PW Dup', email: existingUser().email.toUpperCase(), password: 'Passw0rd!Dup1', confirm: 'Passw0rd!Dup1' });
    const resp = page.waitForResponse(r => r.url().endsWith('/api/auth/register'));
    await submit(page);
    const r = await resp;
    if (r.status() === 201) {
      // Clean up the accidental account immediately, then fail with evidence.
      await api(page, 'DELETE', '/api/settings/account', { password: 'Passw0rd!Dup1' }).catch(() => {});
    }
    expect(r.status(), 'upper-cased existing email must not create a second account').toBe(422);
  });
});

test.describe('New account lifecycle (fresh disposable account)', () => {
  test('REG-10 register via UI -> empty dashboard -> logout -> login -> delete account', async ({ page }) => {
    const [local, domain] = existingUser().email.split('@');
    const id = Date.now().toString(36);
    const user = {
      name: `PW Reg ${id}`,
      email: `${local}+pwreg.${id}@${domain}`,
      password: 'Pw!' + crypto.randomBytes(9).toString('base64url') + '9a',
    };
    test.info().annotations.push({ type: 'account', description: `disposable ${user.email.replace(local, local[0] + '***')}` });
    rememberDisposable(user); // saved before registering so teardown can delete it if this test fails

    await page.goto('/register');
    await fill(page, { name: user.name, email: user.email, password: user.password, confirm: user.password });
    const reg = page.waitForResponse(r => r.url().endsWith('/api/auth/register'));
    await submit(page);
    expect((await reg).status()).toBe(201);

    // No email verification step is presented: the user lands on the dashboard directly.
    await page.waitForURL('**/dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('PW');
    await expect(page.getByText('No transactions recorded yet.')).toBeVisible();
    await expect(page.getByText('No expense categories yet for this period.')).toBeVisible();
    const me = await api(page, 'GET', '/api/auth/me');
    expect(me.body.email).toBe(user.email);
    test.info().annotations.push({ type: 'observation', description: `email_verified_at=${me.body.email_verified_at} (no verification required to use the app)` });

    await page.getByRole('button', { name: 'Logout' }).first().click();
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
    await page.locator('#email').fill(user.email);
    await page.locator('#password').fill(user.password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForURL('**/dashboard');

    // Cleanup: remove the disposable account through Settings > App & Security.
    await page.goto('/settings?section=app');
    await page.getByRole('button', { name: 'Delete Account' }).click();
    const confirmBtn = page.getByRole('button', { name: 'Confirm Delete' });
    await expect(confirmBtn).toBeDisabled();
    await page.getByRole('textbox', { name: 'Password to confirm account deletion' }).fill(user.password);
    await expect(confirmBtn).toBeEnabled();
    const del = page.waitForResponse(r => r.url().includes('/api/') && r.request().method() === 'DELETE');
    await confirmBtn.click();
    const delResp = await del;
    test.info().annotations.push({ type: 'delete-endpoint', description: `${delResp.status()} DELETE ${new URL(delResp.url()).pathname}` });
    expect(delResp.status()).toBeLessThan(300);
    forgetDisposable(user.email);
    await expect(page.getByRole('heading', { name: /Welcome Back|Create Account/ })).toBeVisible();

    // The deleted account can no longer sign in.
    await page.goto('/');
    await page.locator('#email').fill(user.email);
    await page.locator('#password').fill(user.password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.locator('form')).toContainText(/invalid|incorrect|credentials|deleted|do not match/i);
  });
});
