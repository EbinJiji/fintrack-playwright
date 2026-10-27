const fs = require('fs');
const crypto = require('crypto');
const { test: setup, expect } = require('@playwright/test');
const { existingUser, newUser, login, NEW_USER_ENV, STATE_EXISTING, STATE_NEW } = require('./tests/helpers');

setup('authenticate existing user', async ({ page }) => {
  const loginResp = page.waitForResponse(r => r.url().endsWith('/api/auth/login'));
  await login(page, existingUser());
  expect((await loginResp).status()).toBe(200);

  // A 200 is not proof of login: confirm the dashboard and the stored session.
  await expect(page.getByText('Total Balance', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => !!localStorage.getItem('fintrack_token'))).toBe(true);
  await page.context().storageState({ path: STATE_EXISTING });
});

setup('authenticate new (dedicated test) user', async ({ page }) => {
  let user = newUser();
  if (!user) {
    // First run only: register the dedicated account through the real UI and remember it.
    const [local, domain] = existingUser().email.split('@');
    const id = Date.now().toString(36);
    user = {
      email: `${local}+pwtest.${id}@${domain}`,
      password: 'Pw!' + crypto.randomBytes(9).toString('base64url') + '9a',
      name: `PW Test ${id}`,
    };
    await page.goto('/register');
    await page.locator('#name').fill(user.name);
    await page.locator('#email').fill(user.email);
    await page.locator('#password').fill(user.password);
    await page.locator('#confirmPassword').fill(user.password);
    const reg = page.waitForResponse(r => r.url().endsWith('/api/auth/register'));
    await page.getByRole('button', { name: 'Create Account' }).click();
    expect((await reg).status()).toBe(201);
    fs.writeFileSync(NEW_USER_ENV,
      `NEW_USER_EMAIL=${user.email}\nNEW_USER_PASSWORD=${user.password}\nNEW_USER_NAME=${user.name}\nNEW_USER_CREATED=${new Date().toISOString()}\n`);
    await page.waitForURL('**/dashboard');
  } else {
    await login(page, user);
  }
  await expect(page.getByText('Total Balance', { exact: true })).toBeVisible();
  await page.context().storageState({ path: STATE_NEW });
});
