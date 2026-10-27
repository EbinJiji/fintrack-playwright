require('dotenv').config({ quiet: true });
const { defineConfig } = require('@playwright/test');

// Specs that run once per account (existing user and new user) so results are reported separately.
const MODULE_SPECS = [
  'dashboard.spec.js',
  'transactions.spec.js',
  'recurring.spec.js',
  'categories.spec.js',
  'reports.spec.js',
  'settings.spec.js',
  'family.spec.js',
  'payments.spec.js',
  'notifications.spec.js',
  'navigation.spec.js',
];

module.exports = defineConfig({
  testDir: './tests',
  timeout: 90000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1, // one visible browser at a time so the run can be watched
  retries: 0,
  globalTeardown: require.resolve('./tests/global-teardown.js'),

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],

  use: {
    baseURL: 'https://dev.fintrack.nestofar.in',
    browserName: 'chromium',
    headless: false,
    viewport: { width: 1440, height: 900 },
    launchOptions: { slowMo: Number(process.env.SLOWMO || 150) },
    actionTimeout: 15000,
    navigationTimeout: 30000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'setup',
      testDir: '.',
      testMatch: /auth\.setup\.js/,
    },
    {
      name: 'public',
      testMatch: ['auth.spec.js', 'registration.spec.js', 'api.spec.js'],
      dependencies: ['setup'],
    },
    {
      name: 'existing-user',
      testMatch: MODULE_SPECS,
      dependencies: ['setup'],
      use: { storageState: 'auth-state.json' },
    },
    {
      name: 'new-user',
      testMatch: MODULE_SPECS,
      dependencies: ['setup'],
      use: { storageState: 'auth-state-newuser.json' },
    },
    {
      name: 'cross-account',
      testMatch: ['isolation.spec.js'],
      dependencies: ['setup'],
    },
  ],
});
