# FinTrack Playwright Tests

End-to-end tests for the FinTrack personal finance app (dev environment), written with Playwright Test in JavaScript and run in headed Chromium.

The suite covers login and sessions, registration, dashboard, transactions, recurring payments, categories, reports, settings, family sharing, Pay & record (validation only), notifications, navigation and responsive layouts. Every module test runs for two accounts, an existing user and a freshly registered user, and a separate project checks that neither account can see or change the other's data.

## Latest results

243 tests executed: 235 passed, 4 failed (2 defects, each reproduced on both accounts), 4 skipped by design.
See [`FinTrack-QA-Test-Report.pdf`](FinTrack-QA-Test-Report.pdf) and [`test-report.md`](test-report.md).

## Setup

```bash
npm install
npx playwright install chromium
```

Create a `.env` file beside `package.json`:

```
FINTRACK_EMAIL=your-test-account@example.com
FINTRACK_PASSWORD=your-test-password
```

On the first run, the setup project registers a dedicated test account and stores its credentials in `.env.newuser`. Both files are gitignored.

## Running

| Command | What it runs |
|---|---|
| `npx playwright test` | Everything |
| `npm run test:existing` | Module tests as the existing user |
| `npm run test:new` | Module tests as the new user |
| `npx playwright test --project=public` | Login, registration and API access tests |
| `npx playwright test --project=cross-account` | Data isolation between the two accounts |
| `npm run report` | Open the HTML report |

Test records are prefixed `PW_TEST_` and removed after each test. A global teardown sweeps any leftovers in both accounts.
