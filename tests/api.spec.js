const { test, expect } = require('@playwright/test');

// Read-only checks that the API refuses anonymous access. No tokens are used here.
const ENDPOINTS = ['/api/auth/me', '/api/transactions', '/api/categories', '/api/recurring',
  '/api/analytics/dashboard', '/api/analytics/reports', '/api/notifications', '/api/bootstrap', '/api/payment-drafts'];

test('API-01 every data endpoint returns 401 without a token', async ({ request }) => {
  const results = {};
  for (const ep of ENDPOINTS) {
    const r = await request.get(ep, { headers: { Accept: 'application/json' } });
    results[ep] = r.status();
  }
  expect(results).toEqual(Object.fromEntries(ENDPOINTS.map(e => [e, 401])));
});

test('API-02 forged bearer token is rejected', async ({ request }) => {
  const r = await request.get('/api/transactions', { headers: { Accept: 'application/json', Authorization: 'Bearer 1|forged-token' } });
  expect(r.status()).toBe(401);
});

test('API-03 login API rejects bad credentials with 4xx and no token', async ({ request }) => {
  const r = await request.post('/api/auth/login', { data: { email: `pw.nobody.${Date.now()}@example.com`, password: 'Wrong-Pass-1' }, headers: { Accept: 'application/json' } });
  expect(r.status()).toBeGreaterThanOrEqual(400);
  expect(r.status()).toBeLessThan(500);
  const body = await r.json();
  expect(body.token).toBeUndefined();
});
