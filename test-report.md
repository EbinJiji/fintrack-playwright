# FinTrack QA Test Report

- **Application:** https://dev.fintrack.nestofar.in (dev)
- **Date:** 2026-10-27
- **Tooling:** Playwright Test 1.64.1 · Node v24.15.0 · Chromium, headed · Windows 11
- **Viewports:** 1440×900 (default), 768×1024, 390×844, 720×800 (isolation)
- **Status:** **COMPLETE.** Every test executed. Results are taken from the merged Playwright report (`playwright-report/index.html`, `merged-results.json`).
- **Repository:** https://github.com/EbinJiji/fintrack-playwright (test code, this report and the PDF)

## 1. Summary

| Result | Count |
|---|---|
| Total tests | **243** |
| Passed | **235** |
| Failed | **4** (2 app defects, each reproduced on both accounts) |
| Skipped | **4** (by design: tests that change settings run on the dedicated test account only) |
| Blocked | 0 |
| Flaky | 0 |

How it was run: in 8 headed chunks merged into one report. A single 45-minute run had earlier been stopped by the system for low memory. Total execution time was about 47 minutes.

### By account and project

| Project | Passed | Failed | Skipped |
|---|---|---|---|
| **Existing user**: all modules | 94 | 2 | 4 |
| **New user**: all modules | 98 | 2 | 0 |
| **Public**: login, session, registration, API auth (+2 setup) | 37 | 0 | 0 |
| **Cross-account**: data isolation | 6 | 0 | 0 |

### By module (existing user / new user)

| Module | Existing (pass/fail/skip) | New (pass/fail/skip) |
|---|---|---|
| Dashboard | 11 / 0 / 1 | 12 / 0 / 0 |
| Transactions | 16 / **1** / 0 | 16 / **1** / 0 |
| Recurring | 12 / 0 / 0 | 12 / 0 / 0 |
| Categories | 9 / 0 / 0 | 9 / 0 / 0 |
| Reports & analytics | 10 / 0 / 0 | 10 / 0 / 0 |
| Settings | 8 / 0 / 3 | 11 / 0 / 0 |
| Family & sharing | 5 / 0 / 0 | 5 / 0 / 0 |
| Pay & record | 7 / 0 / 0 | 7 / 0 / 0 |
| Notifications | 3 / **1** / 0 | 3 / **1** / 0 |
| Navigation & responsive | 13 / 0 / 0 | 13 / 0 / 0 |

**Skipped on the existing account:**
- DASH-05: empty-state check, which applies only to a new account
- SET-05: profile rename
- SET-08: setting a budget
- SET-10: file import

Each of these ran and passed on the new account.

## 2. Accounts

| Account | Notes |
|---|---|
| Existing | From `.env`. Only `PW_TEST_*` records were created on it, and all were removed |
| New, dedicated | `e***+pwtest.mvqrrsxy@gmail.com`. Registered through the UI. Credentials are in gitignored `.env.newuser` |
| Disposable | REG-10 registers a fresh account each run, uses it, then deletes it through Settings › Delete Account |

**Registration:** works through the UI and needs **no email verification** (`email_verified_at` stays `null`), so it was not blocked. Validation covers:
- required fields
- invalid email
- password under 8 characters
- confirmation mismatch
- one-character name
- password masking
- duplicate email, including different letter case (refused with 422)

## 3. Defects

| ID | Module / test | Title | Severity | Priority | Status |
|---|---|---|---|---|---|
| **FT-001** | Transactions / TXN-09 | Deleting a transaction runs immediately with no confirmation | Medium | High | Confirmed on both accounts; reproducible every time |
| **FT-002** | Auth / AUTH-09 | A signed-in user who visits `/` sees the login form instead of being redirected | Low | Low | Suspected (UX); the session stays valid |
| **FT-003** | Notifications / NOT-04 | "Manage alert preferences" opens Settings › Profile, not Alerts | Low | Medium | Confirmed on both accounts |
| **FT-004** | Family / FAM-03 | Create family stays disabled, with no explanation, until currency is confirmed | Low | Low | Confirmed (usability) |

### FT-001: Transaction delete has no confirmation
- **Precondition:** signed in, with at least one transaction.
- **Steps:** open Transactions, then click the trash icon on a row.
- **Expected:** a confirmation step, consistent with Categories ("Please confirm" dialog) and Recurring.
- **Actual:** `DELETE /api/transactions/{uuid}` is sent at once and the record is gone. There is no undo.
- **Environment:** Chromium, 1440×900.
- **Evidence:** `evidence/FT-001-TXN-09-existing-user/` (screenshot, video, trace).
- **Retest:** failed on both accounts in the final run.

### FT-002: Login page shown to a signed-in user
- **Steps:** sign in, then open `/`.
- **Expected:** redirect to `/dashboard`.
- **Actual:** the login form is displayed. Going to `/dashboard` still works without signing in again.
- **Classification:** UX only; there is no documented rule.

### FT-003: Wrong target for "Manage alert preferences"
- **Steps:** open Notifications, then click "Manage alert preferences".
- **Expected:** `/settings?section=alerts`.
- **Actual:** the link's `href="/settings"` opens the Profile tab.
- **Evidence:** `evidence/notifications-Notification-0f59d-ences-opens-Settings-Alerts-*`.

### FT-004: Create family disabled without a reason
- **Steps:** on a new account, open Family, enter a name and tick consent.
- **Actual:** the button stays disabled, with no message. It becomes enabled only after "Confirm your existing currency" (verified on the dedicated account).
- **Expected:** an inline hint explaining the prerequisite.

## 4. Security and data isolation (all passed)

- **Logout:** the token is revoked server-side; replaying it returns 401.
- **Invalid or expired token:** redirects to login.
- **Protected routes:** all 9 redirect anonymous users.
- **API without a token:** all 9 data endpoints return 401. A forged token returns 401.
- **Cross-account access:** another account's records cannot be reached.
  - Transaction: GET 403, PUT 422, DELETE 403
  - Category: PUT 403, DELETE 403
  - Recurring schedule: DELETE 403
  - Using a foreign `category_id`: 422
- **Lists, search, dashboard and reports:** never showed the other account's data, and totals are computed per account.
- **Script injection:** an HTML/JS payload in a transaction description is rendered as plain text and never runs.
- **Note:** a PUT on a foreign transaction returns 422 (validation) rather than 403. No data leaked, but authorization appears to run after validation.

## 5. Data consistency (passed)

- Dashboard KPIs match `/api/analytics/dashboard`.
- Total Balance equals Net Savings on the Transactions page.
- After a new expense:
  - Monthly Expenses and Total Balance change by exactly the amount.
  - Category chart, recent list, reports total, top category and top transactions all update.
  - Everything returns to the original values after deletion.
- The Reports expense total matches the sum of ledger transactions in the date range.
- Records persist after a page refresh.
- Double-clicking Save creates exactly one record.
- Exports: the CSV report and the import template both download with the header `Date,Description,Category,Type,Amount,Currency`.

## 6. Observations (not defects)

- No success message appears after creating or editing a transaction.
- Future-dated transactions are accepted (HTTP 201).
- An oversized amount is rejected with 422, with no server error.
- The transactions list has free-text search only, with no sort or column filters.
- The display-currency switcher shows amounts by their recorded currency (USD history shows €0.00 in the EUR view) and resets to USD on a full reload. This matches the Settings text.
- A custom report range with the end before the start is rejected (422). The subtitle then shows generic text rather than an error message.
- An unknown route redirects to `/dashboard`.
- A malformed UPI ID is rejected server-side ("The recipient field format is invalid."). No draft is created.
- A whitespace-only family name passes browser validation and enables the button. The server-side check was not exercised, because submitting could create a real family.
- No console errors, no 5xx responses, no unlabeled form controls and no horizontal overflow at any of the 3 viewports, on any page.
- Recurring schedules take the browser timezone (`Asia/Calcutta`); the profile timezone is UTC.

## 7. Not tested, by design

- Real payments: "Prepare payment" was never submitted with valid data.
- Creating a family or sending invitations.
- Google Drive connect (external OAuth).
- Camera access and app install.
- Pagination with more than one page (neither account has enough records).

## 8. Environment fixes made

- `.env` was inside `test-results/`, which Playwright wipes on every run. It is now beside `package.json`.
- Hard-coded credentials were removed from `auth.setup.js`.
- The empty `auth-state.json` was regenerated.
- A `.gitignore` was added.
- No dependencies needed installing.

## 9. Housekeeping and disclosures

- **Test data:** all records use the `PW_TEST_` prefix and are cleaned up. Final teardown: existing `ok`, new `ok`. Disposable accounts: none left over in the final run.
- **Earlier orphan:** a development run left one disposable account (`…+pwreg.mvqs…@gmail.com`) that could not be deleted. The test has since been fixed.
- **Credential exposure:** the dedicated new account's password appeared in the Claude Code session output, from an early exploration script. It is in no project file. Rotate or delete that account if needed.
- **Dedicated account state changed by tests:** currency confirmed, monthly budget set to 500.

## 10. Artifacts

- **Source code:** https://github.com/EbinJiji/fintrack-playwright
- **HTML report:** `npx playwright show-report` (`playwright-report/`)
- **Merged JSON:** `merged-results.json`
- **Evidence for failures:** `evidence/` (screenshots, videos, traces)
- **Chunk blobs:** `all-blobs/`
- **Re-run:** `npx playwright test --project=<setup|public|existing-user|new-user|cross-account>`

## 11. Recommended next steps

1. Fix FT-001: add a confirmation (or undo) to transaction delete.
2. Fix FT-003: point the link to `/settings?section=alerts`.
3. Address FT-002 and FT-004, both small UX changes.
4. Add server-side trimming and validation for whitespace-only names, then extend FAM-02.
5. Seed more than one page of data to cover transactions pagination.
