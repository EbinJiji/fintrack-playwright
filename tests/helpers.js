const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { expect } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
const NEW_USER_ENV = path.join(ROOT, '.env.newuser');
const STATE_EXISTING = path.join(ROOT, 'auth-state.json');
const STATE_NEW = path.join(ROOT, 'auth-state-newuser.json');
const TEST_PREFIX = 'PW_TEST_';

const PROTECTED_ROUTES = [
  '/dashboard', '/transactions', '/recurring', '/categories', '/reports',
  '/settings', '/family', '/payments', '/notifications',
];

const SIDEBAR = [
  { name: 'Dashboard', path: '/dashboard', heading: /Good (morning|afternoon|evening)/ },
  { name: 'Transactions', path: '/transactions', heading: 'Transactions' },
  { name: 'Recurring', path: '/recurring', heading: 'Recurring payments' },
  { name: 'Categories', path: '/categories', heading: 'Manage Categories' },
  { name: 'Reports', path: '/reports', heading: 'Expense Analysis Report' },
  { name: 'Settings', path: '/settings', heading: 'User Settings & Profile' },
];

function existingUser() {
  const { FINTRACK_EMAIL: email, FINTRACK_PASSWORD: password } = process.env;
  if (!email || !password) throw new Error('FINTRACK_EMAIL / FINTRACK_PASSWORD missing from .env (must sit beside package.json)');
  return { email, password };
}

function newUser() {
  if (!fs.existsSync(NEW_USER_ENV)) return null;
  const env = dotenv.parse(fs.readFileSync(NEW_USER_ENV));
  return { email: env.NEW_USER_EMAIL, password: env.NEW_USER_PASSWORD, name: env.NEW_USER_NAME };
}

/** Unique, traceable test id, e.g. PW_TEST_ex_m1abc2_x7 */
function uid(tag = '') {
  const rnd = Math.random().toString(36).slice(2, 5);
  return `${TEST_PREFIX}${tag ? tag + '_' : ''}${Date.now().toString(36)}${rnd}`;
}

/** Which account a module test is running as, derived from the Playwright project. */
function accountOf(testInfo) {
  return testInfo.project.name === 'new-user' ? 'new' : 'existing';
}

async function login(page, { email, password }) {
  await page.goto('/');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL('**/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
}

/**
 * Calls the app's own API from inside the page using the session token the app stored.
 * The token never leaves the browser context and is never returned or logged.
 */
async function api(page, method, url, body) {
  return page.evaluate(async ({ method, url, body }) => {
    const token = localStorage.getItem('fintrack_token');
    const r = await fetch(url, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await r.json(); } catch { /* empty body */ }
    return { status: r.status, body: json };
  }, { method, url, body });
}

const money = (n, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);

/** Parses "$1,234.56", "-$100.00", "+$42.50" into a number. */
const parseMoney = (s) => {
  const neg = /^\s*-/.test(s);
  const v = Number(s.replace(/[^0-9.]/g, ''));
  return neg ? -v : v;
};

/** Value text shown under a KPI label, e.g. kpi(page, 'Total Balance'). */
async function kpi(page, label) {
  const text = await page.locator('main').innerText();
  const m = text.match(new RegExp(label + '\\s*\\n+\\s*([-+]?[^\\s\\d]?[\\d,]+\\.\\d{2})'));
  if (!m) throw new Error(`KPI "${label}" not found on page`);
  return parseMoney(m[1]);
}

async function gotoAndSettle(page, url) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

/** Opens Add Transaction and fills the form; does not submit. */
async function fillTransaction(page, { amount, description, category = 'Groceries', type = 'Expense', date }) {
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: /Transaction/ })).toBeVisible();
  if (amount !== undefined) await dialog.locator('#transaction-amount').fill(String(amount));
  if (description !== undefined) await dialog.locator('#transaction-description').fill(description);
  if (date !== undefined) await dialog.locator('#transaction-date').fill(date);
  if (category) await dialog.locator('#transaction-category').selectOption({ label: category });
  await dialog.getByRole('button', { name: type, exact: true }).click();
  return dialog;
}

async function createTransactionUI(page, data) {
  await gotoAndSettle(page, '/transactions');
  await page.getByRole('button', { name: 'Add Transaction' }).click();
  const dialog = await fillTransaction(page, data);
  const created = page.waitForResponse(r => r.url().endsWith('/api/transactions') && r.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Save Transaction' }).click();
  const resp = await created;
  expect(resp.status(), 'create transaction API status').toBe(201);
  await expect(dialog).toBeHidden();
  const json = await resp.json();
  return json.data.transaction_uuid;
}

/** Deletes every record whose name starts with PW_TEST_ for the logged-in account. Returns failures. */
async function sweepTestData(page) {
  const failures = [];
  const tx = await api(page, 'GET', `/api/transactions?q=${TEST_PREFIX}&per_page=100`);
  for (const t of tx.body?.data || []) {
    if (!t.description?.startsWith(TEST_PREFIX)) continue;
    const r = await api(page, 'DELETE', `/api/transactions/${t.transaction_uuid}`);
    if (r.status >= 300) failures.push(`transaction ${t.description}: ${r.status}`);
  }
  const rec = await api(page, 'GET', '/api/recurring');
  for (const s of rec.body?.data || []) {
    if (!s.description?.startsWith(TEST_PREFIX)) continue;
    const r = await api(page, 'DELETE', `/api/recurring/${s.uuid}`);
    if (r.status >= 300) failures.push(`recurring ${s.description}: ${r.status}`);
  }
  const cats = await api(page, 'GET', '/api/categories');
  for (const c of cats.body?.data || []) {
    if (!c.label?.startsWith(TEST_PREFIX)) continue;
    const r = await api(page, 'DELETE', `/api/categories/${c.category_uuid}`);
    if (r.status >= 300) failures.push(`category ${c.label}: ${r.status}`);
  }
  return failures;
}

// Disposable accounts created by REG-10 are tracked in a gitignored file until deleted.
const DISPOSABLE_FILE = path.join(ROOT, '.env.disposable.json');
const readDisposable = () => (fs.existsSync(DISPOSABLE_FILE) ? JSON.parse(fs.readFileSync(DISPOSABLE_FILE, 'utf8')) : []);
const rememberDisposable = (user) => fs.writeFileSync(DISPOSABLE_FILE, JSON.stringify([...readDisposable(), user]));
const forgetDisposable = (email) => {
  const left = readDisposable().filter(u => u.email !== email);
  if (left.length) fs.writeFileSync(DISPOSABLE_FILE, JSON.stringify(left)); else if (fs.existsSync(DISPOSABLE_FILE)) fs.unlinkSync(DISPOSABLE_FILE);
};

/** Collects console errors and failed (>=500 or network-failed) requests for a page. */
function watchErrors(page) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('response', r => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().split('?')[0]}`); });
  page.on('requestfailed', r => {
    const f = r.failure()?.errorText || '';
    if (!/ERR_ABORTED/.test(f)) errors.push(`requestfailed: ${r.url().split('?')[0]} ${f}`);
  });
  return errors;
}

module.exports = {
  ROOT, NEW_USER_ENV, STATE_EXISTING, STATE_NEW, TEST_PREFIX, PROTECTED_ROUTES, SIDEBAR,
  existingUser, newUser, uid, accountOf, login, api, money, parseMoney, kpi, gotoAndSettle,
  fillTransaction, createTransactionUI, sweepTestData, watchErrors,
  readDisposable, rememberDisposable, forgetDisposable,
};
