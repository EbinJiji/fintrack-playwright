const { test, expect } = require('@playwright/test');
const { SIDEBAR, PROTECTED_ROUTES, gotoAndSettle, watchErrors } = require('./helpers');

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

test.describe('Navigation', () => {
  test('NAV-01 every sidebar link opens the right page', async ({ page }) => {
    await gotoAndSettle(page, '/dashboard');
    for (const item of SIDEBAR) {
      await page.getByRole('link', { name: item.name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(item.path + '(\\?|$)'));
      await expect(page.getByRole('heading', { name: item.heading, level: 1 }).first()).toBeVisible();
    }
  });

  test('NAV-02 browser back and forward', async ({ page }) => {
    await gotoAndSettle(page, '/dashboard');
    await page.getByRole('link', { name: 'Transactions', exact: true }).click();
    await expect(page).toHaveURL(/\/transactions/);
    await page.getByRole('link', { name: 'Reports', exact: true }).click();
    await expect(page).toHaveURL(/\/reports/);
    await page.goBack();
    await expect(page).toHaveURL(/\/transactions/);
    await expect(page.getByRole('heading', { name: 'Transactions', level: 1 })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goForward();
    await expect(page).toHaveURL(/\/transactions/);
  });

  test('NAV-03 header search from any page goes to filtered transactions', async ({ page }) => {
    await gotoAndSettle(page, '/reports');
    await page.getByRole('searchbox', { name: 'Search' }).fill('zz-nothing-matches');
    await page.getByRole('button', { name: 'Search transactions' }).click();
    await expect(page).toHaveURL(/\/transactions\?q=zz-nothing-matches/);
    await expect(page.getByText('No matching transactions.').filter({ visible: true })).toBeVisible();
  });

  test('NAV-04 empty header search shows the unfiltered list', async ({ page }) => {
    await gotoAndSettle(page, '/categories');
    await page.getByRole('searchbox', { name: 'Search' }).fill('');
    await page.getByRole('button', { name: 'Search transactions' }).click();
    await expect(page).toHaveURL(/\/transactions/);
    await expect(page.getByText('No matching transactions.').filter({ visible: true })).toHaveCount(0);
  });

  test('NAV-05 skip-to-content link targets the main region', async ({ page }) => {
    await gotoAndSettle(page, '/dashboard');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(page.locator('#main-content')).toHaveCount(1);
  });

  test('NAV-06 unknown route does not render a blank page', async ({ page }) => {
    await page.goto('/pw-test-route-does-not-exist');
    await page.waitForLoadState('networkidle');
    const text = (await page.locator('body').innerText()).trim();
    test.info().annotations.push({ type: 'observation', description: `unknown route -> ${new URL(page.url()).pathname}, "${text.slice(0, 80).replace(/\n/g, ' ')}"` });
    expect(text.length).toBeGreaterThan(20);
  });

  test('NAV-07 no console errors or 5xx responses across all pages', async ({ page }) => {
    const errors = watchErrors(page);
    for (const route of PROTECTED_ROUTES) {
      await gotoAndSettle(page, route);
      await page.waitForTimeout(500);
    }
    test.info().annotations.push({ type: 'observation', description: errors.length ? errors.join(' || ') : 'none' });
    expect(errors).toEqual([]);
  });

  test('NAV-08 visible form controls all have an accessible name', async ({ page }) => {
    const unlabeled = [];
    for (const route of PROTECTED_ROUTES) {
      await gotoAndSettle(page, route);
      const found = await page.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]), select, textarea, button')]
        .filter(e => e.getBoundingClientRect().width > 0)
        .filter(e => {
          const byLabel = e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`);
          const named = e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || e.closest('label') || byLabel || e.title
            || (e.tagName === 'BUTTON' && e.innerText.trim());
          return !named;
        })
        .map(e => `${e.tagName.toLowerCase()}[type=${e.type}]${e.placeholder ? ' ph="' + e.placeholder + '"' : ''}`));
      for (const f of found) unlabeled.push(`${route}: ${f}`);
    }
    test.info().annotations.push({ type: 'observation', description: unlabeled.join(' | ') || 'none' });
    expect(unlabeled, 'controls without accessible names').toEqual([]);
  });
});

test.describe('Responsive layout', () => {
  for (const vp of VIEWPORTS) {
    test(`NAV-09 ${vp.name} ${vp.width}x${vp.height}: no horizontal overflow, content visible`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const overflow = [];
      for (const route of PROTECTED_ROUTES) {
        await gotoAndSettle(page, route);
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
        if (scroll > client + 1) {
          const culprits = await page.evaluate((w) => [...document.querySelectorAll('main *')]
            .filter(e => e.getBoundingClientRect().right > w + 1)
            .slice(0, 3).map(e => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}`), client);
          overflow.push(`${route}: ${scroll}>${client} (${culprits.join(', ')})`);
        }
      }
      await page.screenshot({ path: test.info().outputPath(`dashboard-${vp.name}.png`) });
      test.info().annotations.push({ type: 'observation', description: overflow.join(' | ') || 'no overflow' });
      expect(overflow).toEqual([]);
    });
  }

  test('NAV-10 mobile menu opens the navigation and navigates', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoAndSettle(page, '/dashboard');
    const reports = page.getByRole('link', { name: 'Reports', exact: true });
    const toggle = page.getByRole('button', { name: 'Toggle Menu' });
    if (!(await reports.isVisible())) {
      await expect(toggle).toBeVisible();
      await toggle.click();
    }
    await expect(reports).toBeVisible();
    await reports.click();
    await expect(page).toHaveURL(/\/reports/);
    await expect(page.getByRole('heading', { name: /^(Reports|Expense Analysis Report)$/, level: 1 })).toBeVisible();
  });

  test('NAV-11 mobile: Add Transaction dialog fits the screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoAndSettle(page, '/transactions');
    await page.getByRole('button', { name: 'Add Transaction' }).click();
    const box = await page.getByRole('dialog').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(391);
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Save Transaction' })).toBeInViewport({ ratio: 0.1 }).catch(async () => {
      await page.getByRole('dialog').getByRole('button', { name: 'Save Transaction' }).scrollIntoViewIfNeeded();
      await expect(page.getByRole('dialog').getByRole('button', { name: 'Save Transaction' })).toBeInViewport();
    });
  });
});
