const { test, expect } = require('@playwright/test');
const { api, gotoAndSettle } = require('./helpers');

test.describe('Notifications', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndSettle(page, '/dashboard');
    await page.getByRole('link', { name: 'Notifications' }).click();
    await expect(page).toHaveURL(/\/notifications/);
    await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
  });

  test('NOT-01 list matches the API (or shows the empty state)', async ({ page }) => {
    const { body } = await api(page, 'GET', '/api/notifications');
    const n = body.notifications;
    if (n.total === 0) await expect(page.getByText('You are all caught up.', { exact: false })).toBeVisible();
    await expect(page.getByText(`Page ${n.current_page} of ${n.last_page}`)).toBeVisible();
    for (const item of n.data.slice(0, 3)) {
      const title = item.data?.title || item.title;
      if (title) await expect(page.locator('main')).toContainText(title);
    }
  });

  test('NOT-02 pagination buttons reflect available pages', async ({ page }) => {
    const { body } = await api(page, 'GET', '/api/notifications');
    await expect(page.getByRole('button', { name: 'Previous notifications' })).toBeDisabled();
    if (body.notifications.last_page <= 1) await expect(page.getByRole('button', { name: 'Next notifications' })).toBeDisabled();
  });

  test('NOT-03 Mark all as read clears the unread count', async ({ page }) => {
    const before = (await api(page, 'GET', '/api/notifications')).body.unread_count;
    if (before === 0) {
      await expect(page.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
      test.info().annotations.push({ type: 'observation', description: 'nothing unread: button correctly disabled' });
      return;
    }
    await page.getByRole('button', { name: 'Mark all as read' }).click();
    await expect.poll(async () => (await api(page, 'GET', '/api/notifications')).body.unread_count).toBe(0);
    test.info().annotations.push({ type: 'observation', description: `unread before=${before}` });
  });

  test('NOT-04 Manage alert preferences opens Settings > Alerts', async ({ page }) => {
    await page.getByRole('link', { name: 'Manage alert preferences' }).or(page.getByRole('button', { name: 'Manage alert preferences' })).first().click();
    await expect(page).toHaveURL(/\/settings\?section=alerts/);
    await expect(page.getByRole('heading', { name: 'Preferences & Alerts' })).toBeVisible();
  });
});
