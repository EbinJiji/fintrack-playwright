const { test, expect } = require('@playwright/test');
const { api, uid, gotoAndSettle, createTransactionUI, STATE_EXISTING, STATE_NEW } = require('./helpers');

// Two real signed-in sessions side by side: the existing account (A) and the dedicated new account (B).
// Every probe targets records created by these tests, never pre-existing user data.
test.describe('Account data isolation', () => {
  let ctxA, ctxB, A, B;
  test.beforeEach(async ({ browser }) => {
    ctxA = await browser.newContext({ storageState: STATE_EXISTING, viewport: { width: 720, height: 800 } });
    ctxB = await browser.newContext({ storageState: STATE_NEW, viewport: { width: 720, height: 800 } });
    A = await ctxA.newPage(); B = await ctxB.newPage();
    await gotoAndSettle(A, '/dashboard'); await gotoAndSettle(B, '/dashboard');
    const [meA, meB] = [(await api(A, 'GET', '/api/auth/me')).body, (await api(B, 'GET', '/api/auth/me')).body];
    expect(meA.id).not.toBe(meB.id);
  });
  test.afterEach(async () => { await ctxA?.close(); await ctxB?.close(); });

  test('ISO-01 a transaction created by B is invisible to A (UI, search, API list)', async () => {
    const desc = uid('iso');
    const id = await createTransactionUI(B, { amount: '11.11', description: desc });
    try {
      await expect(B.getByText(desc).filter({ visible: true }).first()).toBeVisible();
      await gotoAndSettle(A, `/transactions?q=${desc}`);
      await expect(A.getByText('No matching transactions.').filter({ visible: true })).toBeVisible();
      const listA = (await api(A, 'GET', '/api/transactions')).body.data;
      expect(listA.map(t => t.transaction_uuid)).not.toContain(id);
      await gotoAndSettle(A, '/dashboard');
      await expect(A.locator('main')).not.toContainText(desc);
    } finally {
      await api(B, 'DELETE', `/api/transactions/${id}`);
    }
  });

  test('ISO-02 A cannot read, edit or delete B\'s transaction by id', async () => {
    const desc = uid('isoid');
    const id = await createTransactionUI(B, { amount: '22.22', description: desc });
    try {
      const read = await api(A, 'GET', `/api/transactions/${id}`);
      const edit = await api(A, 'PUT', `/api/transactions/${id}`, { amount: 1, date: '2026-01-01', description: 'PW_TEST_hijacked', type: 'income', category_id: 1, currency: 'USD', version: 1, internal_transfer: false });
      const del = await api(A, 'DELETE', `/api/transactions/${id}`);
      test.info().annotations.push({ type: 'observation', description: `A on B's txn: GET ${read.status}, PUT ${edit.status}, DELETE ${del.status}` });
      for (const [op, r] of [['GET', read], ['PUT', edit], ['DELETE', del]]) {
        expect([403, 404, 405, 422], `${op} on another user's transaction`).toContain(r.status);
      }
      const [still] = (await api(B, 'GET', `/api/transactions?q=${desc}`)).body.data;
      expect(still, 'B\'s record survives').toMatchObject({ description: desc, amount: '22.22' });
    } finally {
      await api(B, 'DELETE', `/api/transactions/${id}`);
    }
  });

  test('ISO-03 B cannot attach A\'s category to its own transaction', async () => {
    const label = uid('isocat');
    const catA = (await api(A, 'POST', '/api/categories', { label, icon: 'pets', color: '#3b82f6' })).body.data;
    let leaked = null;
    try {
      const r = await api(B, 'POST', '/api/transactions', { amount: 1, date: new Date().toLocaleDateString('en-CA'), description: uid('isox'), type: 'expense', category_id: catA.category_id, currency: 'USD', internal_transfer: false });
      if (r.status < 300) leaked = r.body.data.transaction_uuid;
      test.info().annotations.push({ type: 'observation', description: `B POST txn with A's category_id -> ${r.status}` });
      expect(r.status, 'foreign category must be rejected').toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
    } finally {
      if (leaked) await api(B, 'DELETE', `/api/transactions/${leaked}`);
      await api(A, 'DELETE', `/api/categories/${catA.category_uuid}`);
    }
  });

  test('ISO-04 B cannot rename or delete A\'s category; A\'s categories are not listed for B', async () => {
    const label = uid('isocat2');
    const catA = (await api(A, 'POST', '/api/categories', { label, icon: 'pets', color: '#3b82f6' })).body.data;
    try {
      const listB = (await api(B, 'GET', '/api/categories')).body.data.map(c => c.label);
      expect(listB).not.toContain(label);
      await gotoAndSettle(B, '/categories');
      await expect(B.getByRole('heading', { name: label })).toHaveCount(0);
      const put = await api(B, 'PUT', `/api/categories/${catA.category_uuid}`, { label: 'PW_TEST_hijacked', icon: 'pets', color: '#000000' });
      const del = await api(B, 'DELETE', `/api/categories/${catA.category_uuid}`);
      test.info().annotations.push({ type: 'observation', description: `B on A's category: PUT ${put.status}, DELETE ${del.status}` });
      expect([403, 404, 405]).toContain(put.status);
      expect([403, 404, 405]).toContain(del.status);
      const still = (await api(A, 'GET', '/api/categories')).body.data.find(c => c.category_uuid === catA.category_uuid);
      expect(still?.label).toBe(label);
    } finally {
      await api(A, 'DELETE', `/api/categories/${catA.category_uuid}`);
    }
  });

  test('ISO-05 B\'s recurring schedule is invisible to A and cannot be stopped/deleted by A', async () => {
    const desc = uid('isorec');
    const catB = (await api(B, 'GET', '/api/categories')).body.data.find(c => c.label === 'Housing');
    const start = new Date(Date.now() + 5 * 864e5).toLocaleDateString('en-CA');
    const rec = await api(B, 'POST', '/api/recurring', { currency: 'USD', amount: 5, description: desc, type: 'expense', category_id: catB.category_id, frequency: 'monthly', timezone: 'UTC', start_date: start, end_date: null });
    expect(rec.status).toBe(201);
    const uuid = rec.body.data.uuid;
    try {
      expect((await api(A, 'GET', '/api/recurring')).body.data.map(s => s.uuid)).not.toContain(uuid);
      await gotoAndSettle(A, '/recurring');
      await expect(A.locator('main')).not.toContainText(desc);
      const del = await api(A, 'DELETE', `/api/recurring/${uuid}`);
      test.info().annotations.push({ type: 'observation', description: `A DELETE on B's schedule -> ${del.status}` });
      expect([403, 404, 405]).toContain(del.status);
      expect((await api(B, 'GET', '/api/recurring')).body.data.find(s => s.uuid === uuid)?.is_active).toBe(true);
    } finally {
      await api(B, 'DELETE', `/api/recurring/${uuid}`);
    }
  });

  test('ISO-06 dashboards and reports are computed per account', async () => {
    const desc = uid('isodash');
    const beforeA = (await api(A, 'GET', '/api/analytics/dashboard')).body.data.summary;
    const id = await createTransactionUI(B, { amount: '77.77', description: desc });
    try {
      const afterA = (await api(A, 'GET', '/api/analytics/dashboard')).body.data.summary;
      expect(afterA.monthly_expenses).toEqual(beforeA.monthly_expenses);
      expect(afterA.total_balance).toEqual(beforeA.total_balance);
      const reportB = (await api(B, 'GET', '/api/analytics/reports')).body.data.top_transactions.data.map(t => t.description);
      const reportA = (await api(A, 'GET', '/api/analytics/reports')).body.data.top_transactions.data.map(t => t.description);
      expect(reportB).toContain(desc);
      expect(reportA).not.toContain(desc);
    } finally {
      await api(B, 'DELETE', `/api/transactions/${id}`);
    }
  });
});
