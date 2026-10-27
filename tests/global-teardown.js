const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');
const { sweepTestData, readDisposable, forgetDisposable, STATE_EXISTING, STATE_NEW, ROOT } = require('./helpers');

// Safety net: remove any PW_TEST_ records left behind by failed tests, in both accounts.
module.exports = async () => {
  const browser = await chromium.launch();
  const lines = [];
  for (const [account, state] of [['existing', STATE_EXISTING], ['new', STATE_NEW]]) {
    if (!fs.existsSync(state)) continue;
    const context = await browser.newContext({ storageState: state, baseURL: 'https://dev.fintrack.nestofar.in' });
    const page = await context.newPage();
    try {
      await page.goto('/dashboard');
      const failures = await sweepTestData(page);
      lines.push(`${account}: ${failures.length ? 'FAILED ' + failures.join('; ') : 'ok'}`);
    } catch (e) {
      lines.push(`${account}: ERROR ${e.message}`);
    }
    await context.close();
  }
  // Disposable registration accounts whose test failed before self-deletion.
  for (const user of readDisposable()) {
    const context = await browser.newContext({ baseURL: 'https://dev.fintrack.nestofar.in' });
    try {
      const login = await context.request.post('/api/auth/login', { data: { email: user.email, password: user.password }, headers: { Accept: 'application/json' } });
      if (login.status() !== 200) { lines.push(`disposable: login ${login.status()} (already deleted?)`); forgetDisposable(user.email); continue; }
      const { token } = await login.json();
      const del = await context.request.delete('/api/settings/account', { data: { password: user.password }, headers: { Accept: 'application/json', Authorization: 'Bearer ' + token } });
      lines.push(`disposable account delete: ${del.status()}`);
      if (del.status() < 300) forgetDisposable(user.email);
    } catch (e) {
      lines.push(`disposable: ERROR ${e.message}`);
    }
    await context.close();
  }
  await browser.close();
  fs.mkdirSync(path.join(ROOT, 'test-results'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'test-results', 'cleanup.log'), `${new Date().toISOString()}\n${lines.join('\n')}\n`);
  console.log('[teardown] test-data cleanup:', lines.join(' | '));
};
