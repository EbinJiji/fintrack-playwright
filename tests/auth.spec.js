const { test, expect } = require('@playwright/test');
const { existingUser, newUser, login, api, PROTECTED_ROUTES } = require('./helpers');

test.describe('Login page', () => {
  test('AUTH-01 renders sign-in form with masked password', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
    await expect(page.getByLabel('Email address')).toHaveAttribute('type', 'email');
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
    await expect(page.getByRole('link', { name: 'Join for free' })).toHaveAttribute('href', '/register');
  });

  test('AUTH-02 password visibility toggle', async ({ page }) => {
    await page.goto('/');
    const pw = page.locator('#password');
    await pw.fill('SomeSecret1');
    await page.getByRole('button', { name: 'Toggle password' }).click();
    await expect(pw).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Toggle password' }).click();
    await expect(pw).toHaveAttribute('type', 'password');
  });

  test('AUTH-03 empty submit is blocked and stays on login', async ({ page }) => {
    await page.goto('/');
    let loginCalls = 0;
    page.on('request', r => { if (r.url().endsWith('/api/auth/login')) loginCalls++; });
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForTimeout(1000);
    const emailMsg = await page.locator('#email').evaluate(e => e.validationMessage);
    const visibleErrors = await page.locator('form').innerText();
    expect(emailMsg || visibleErrors).toMatch(/fill out|required|valid email|enter/i);
    expect(loginCalls).toBe(0);
    await expect(page).toHaveURL(/\/$/);
  });

  test('AUTH-04 invalid email format is rejected client-side', async ({ page }) => {
    await page.goto('/');
    await page.locator('#email').fill('not-an-email');
    await page.locator('#password').fill('whatever123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    const msg = await page.locator('#email').evaluate(e => e.validationMessage);
    const text = await page.locator('form').innerText();
    expect(msg + text).toMatch(/@|valid email/i);
    await expect(page).not.toHaveURL(/dashboard/);
  });

  test('AUTH-05 wrong password shows an error and does not authenticate', async ({ page }) => {
    await page.goto('/');
    await page.locator('#email').fill(existingUser().email);
    await page.locator('#password').fill('Definitely-Wrong-Pw-1');
    const resp = page.waitForResponse(r => r.url().endsWith('/api/auth/login'));
    await page.getByRole('button', { name: 'Sign In' }).click();
    const r = await resp;
    expect(r.status()).toBeGreaterThanOrEqual(400);
    await expect(page.locator('form')).toContainText(/invalid|incorrect|credentials|do not match/i);
    await expect(page).not.toHaveURL(/dashboard/);
    expect(await page.evaluate(() => localStorage.getItem('fintrack_token'))).toBeNull();
  });

  test('AUTH-06 unknown email shows an error', async ({ page }) => {
    await page.goto('/');
    await page.locator('#email').fill(`pw.unknown.${Date.now()}@example.com`);
    await page.locator('#password').fill('Some-Password-1');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.locator('form')).toContainText(/invalid|incorrect|credentials|not found|do not match/i);
    await expect(page).not.toHaveURL(/dashboard/);
  });
});

test.describe('Existing-user session', () => {
  test('AUTH-07 existing user logs in and sees own dashboard', async ({ page }) => {
    await login(page, existingUser());
    await expect(page.getByText('Total Balance', { exact: true })).toBeVisible();
    const me = await api(page, 'GET', '/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(existingUser().email);
  });

  test('AUTH-08 session persists across reload and new tab', async ({ page, context }) => {
    await login(page, existingUser());
    await page.reload();
    await expect(page).toHaveURL(/dashboard/);
    await expect(page.getByText('Total Balance', { exact: true })).toBeVisible();
    const tab = await context.newPage();
    await tab.goto('/transactions');
    await expect(tab.getByRole('heading', { name: 'Transactions', level: 1 })).toBeVisible();
    await tab.close();
  });

  test('AUTH-09 visiting the login page while signed in keeps the session valid', async ({ page }) => {
    await login(page, existingUser());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const redirected = /dashboard/.test(page.url());
    test.info().annotations.push({ type: 'observation', description: redirected
      ? 'Signed-in user visiting / is redirected to /dashboard'
      : 'Signed-in user visiting / is shown the login form again (no redirect) - see FT-002' });
    // The session itself must survive: the dashboard is still reachable without re-login.
    await page.goto('/dashboard');
    await expect(page.getByText('Total Balance', { exact: true })).toBeVisible();
  });

  test('AUTH-10 logout clears session and blocks protected pages', async ({ page }) => {
    await login(page, existingUser());
    const logout = page.waitForResponse(r => /\/api\/auth\/logout/.test(r.url())).catch(() => null);
    await page.getByRole('button', { name: 'Logout' }).first().click();
    await expect(page).toHaveURL(/\/$|\/login/);
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
    const lr = await logout;
    if (lr) expect(lr.status()).toBeLessThan(300);
    expect(await page.evaluate(() => localStorage.getItem('fintrack_token'))).toBeNull();

    await page.goto('/transactions');
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
    await page.goBack();
    await expect(page.getByText('Total Balance', { exact: true })).toHaveCount(0);
  });

  test('AUTH-11 token is revoked server-side on logout', async ({ page }) => {
    await login(page, existingUser());
    const token = await page.evaluate(() => localStorage.getItem('fintrack_token'));
    await page.getByRole('button', { name: 'Logout' }).first().click();
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
    // Replay the old token directly; it must no longer work.
    const status = await page.evaluate(async (t) =>
      (await fetch('/api/auth/me', { headers: { Accept: 'application/json', Authorization: 'Bearer ' + t } })).status, token);
    expect(status, 'old token after logout').toBe(401);
  });

  test('AUTH-12 expired/invalid session token redirects to login', async ({ page }) => {
    await login(page, existingUser());
    await page.evaluate(() => localStorage.setItem('fintrack_token', 'invalid-expired-token'));
    await page.goto('/transactions');
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible({ timeout: 20000 });
  });
});

test.describe('Protected routes (anonymous)', () => {
  for (const route of PROTECTED_ROUTES) {
    test(`AUTH-13 ${route} redirects anonymous users to login`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
      await expect(page.getByText('Total Balance', { exact: true })).toHaveCount(0);
    });
  }
});

test.describe('New-user session', () => {
  test('AUTH-14 dedicated new user logs in, sees own identity, logs out', async ({ page }) => {
    const user = newUser();
    test.skip(!user, 'No dedicated new-user account (.env.newuser) available');
    await login(page, user);
    await expect(page.getByRole('link', { name: 'Your profile and settings' })).toContainText(user.name);
    const me = await api(page, 'GET', '/api/auth/me');
    expect(me.body.email).toBe(user.email);
    await page.getByRole('button', { name: 'Logout' }).first().click();
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
  });
});
