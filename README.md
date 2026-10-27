# FinTrack Playwright Tests

End-to-end tests for the FinTrack personal finance app (dev environment), written with Playwright Test in JavaScript and run in headed Chromium.

The suite covers login and sessions, registration, dashboard, transactions, recurring payments, categories, reports, settings, family sharing, Pay & record (validation only), notifications, navigation and responsive layouts. Every module test runs for two accounts, an existing user and a freshly registered user, and a separate project checks that neither account can see or change the other's data.

## Latest results

243 tests executed: 235 passed, 4 failed (2 defects, each reproduced on both accounts), 4 skipped by design.
See [`FinTrack-QA-Test-Report.pdf`](FinTrack-QA-Test-Report.pdf) and [`test-report.md`](test-report.md).

## Defects

| ID | Module | Title | Severity | Priority | Status |
|---|---|---|---|---|---|
| FT-001 | Transactions | Deleting a transaction runs immediately, with no confirmation | Medium | High | Confirmed on both accounts |
| FT-002 | Login | A signed-in user who opens the home URL sees the login form | Low | Low | Suspected (UX) |
| FT-003 | Notifications | "Manage alert preferences" opens the Profile tab, not Alerts | Low | Medium | Confirmed on both accounts |
| FT-004 | Family & sharing | "Create family" stays disabled without saying why | Low | Low | Confirmed (usability) |

### FT-001: Deleting a transaction runs immediately, with no confirmation

- **Test:** TXN-09 (fails on both accounts)
- **Steps:** open Transactions, then click the trash icon on any row.
- **Expected:** a confirmation step, as Categories and Recurring already have.
- **Actual:** `DELETE /api/transactions/{uuid}` is sent at once and the record is gone. There is no undo.
- **Environment:** Chromium, 1440×900. Reproducible every time.

### FT-002: A signed-in user who opens the home URL sees the login form

- **Test:** AUTH-09 (records the behavior; passes)
- **Steps:** sign in, then open `/`.
- **Expected:** redirect to `/dashboard`.
- **Actual:** the login form is shown. The session is still valid, and `/dashboard` works without signing in again.
- **Note:** there is no documented rule for this, so it is reported as a suspected UX issue.

### FT-003: "Manage alert preferences" opens the Profile tab, not Alerts

- **Test:** NOT-04 (fails on both accounts)
- **Steps:** open Notifications, then click "Manage alert preferences".
- **Expected:** `/settings?section=alerts`.
- **Actual:** the link's `href` is `/settings`, so it lands on the Profile tab.

### FT-004: "Create family" stays disabled without saying why

- **Test:** FAM-03 (records the behavior; passes)
- **Steps:** on an account whose currency is not yet confirmed, open Family, enter a name and tick the consent box.
- **Expected:** an inline hint naming the missing step.
- **Actual:** the button stays disabled with no message. It enables only after "Confirm your existing currency".

## Test cases

All test cases with their result in the latest run. Module tests run once per account (Existing / New). Login, registration, API and isolation tests use their own sessions, so they have one result. Skips are by design: tests that change account settings run only on the dedicated test account.

### Setup: authentication (2)

| ID | Test case | Result |
|---|---|---|
| SETUP | Authenticate existing user | Pass |
| SETUP | Authenticate new (dedicated test) user | Pass |

### Login, session and logout (22)

| ID | Test case | Result |
|---|---|---|
| AUTH-01 | Renders sign-in form with masked password | Pass |
| AUTH-02 | Password visibility toggle | Pass |
| AUTH-03 | Empty submit is blocked and stays on login | Pass |
| AUTH-04 | Invalid email format is rejected client-side | Pass |
| AUTH-05 | Wrong password shows an error and does not authenticate | Pass |
| AUTH-06 | Unknown email shows an error | Pass |
| AUTH-07 | Existing user logs in and sees own dashboard | Pass |
| AUTH-08 | Session persists across reload and new tab | Pass |
| AUTH-09 | Visiting the login page while signed in keeps the session valid | Pass |
| AUTH-10 | Logout clears session and blocks protected pages | Pass |
| AUTH-11 | Token is revoked server-side on logout | Pass |
| AUTH-12 | Expired/invalid session token redirects to login | Pass |
| AUTH-13 | /dashboard redirects anonymous users to login | Pass |
| AUTH-13 | /transactions redirects anonymous users to login | Pass |
| AUTH-13 | /recurring redirects anonymous users to login | Pass |
| AUTH-13 | /categories redirects anonymous users to login | Pass |
| AUTH-13 | /reports redirects anonymous users to login | Pass |
| AUTH-13 | /settings redirects anonymous users to login | Pass |
| AUTH-13 | /family redirects anonymous users to login | Pass |
| AUTH-13 | /payments redirects anonymous users to login | Pass |
| AUTH-13 | /notifications redirects anonymous users to login | Pass |
| AUTH-14 | Dedicated new user logs in, sees own identity, logs out | Pass |

### Registration (10)

| ID | Test case | Result |
|---|---|---|
| REG-01 | Shows all required fields | Pass |
| REG-02 | Empty submit shows required-field messages and sends nothing | Pass |
| REG-03 | Invalid email is rejected | Pass |
| REG-04 | Password shorter than 8 characters is rejected | Pass |
| REG-05 | Password confirmation mismatch is rejected | Pass |
| REG-06 | One-character name is rejected | Pass |
| REG-07 | Both password fields are masked and independently toggleable | Pass |
| REG-08 | Duplicate registration with an existing email is refused (single request) | Pass |
| REG-09 | Duplicate check is case-insensitive | Pass |
| REG-10 | Register via UI -&gt; empty dashboard -&gt; logout -&gt; login -&gt; delete account | Pass |

### API access control (3)

| ID | Test case | Result |
|---|---|---|
| API-01 | Every data endpoint returns 401 without a token | Pass |
| API-02 | Forged bearer token is rejected | Pass |
| API-03 | Login API rejects bad credentials with 4xx and no token | Pass |

### Dashboard (12)

| ID | Test case | Existing | New |
|---|---|---|---|
| DASH-01 | Loads all KPI cards and sections | Pass | Pass |
| DASH-02 | KPI values match the analytics API | Pass | Pass |
| DASH-03 | Total Balance is consistent with the Transactions page net savings | Pass | Pass |
| DASH-04 | Recent transactions reflect stored records (or empty state) | Pass | Pass |
| DASH-05 | New account shows empty states | Skip | Pass |
| DASH-06 | Spending period selector re-queries analytics | Pass | Pass |
| DASH-07 | Refresh button re-fetches financial data | Pass | Pass |
| DASH-08 | Header and card links navigate correctly | Pass | Pass |
| DASH-09 | Add Transaction opens the form and Cancel creates nothing | Pass | Pass |
| DASH-10 | Finance view selector offers Personal | Pass | Pass |
| DASH-11 | Display currency switch re-labels amounts and persists, then restores | Pass | Pass |
| DASH-12 | A new expense updates monthly expenses, balance and category chart | Pass | Pass |

### Transactions (17)

| ID | Test case | Existing | New |
|---|---|---|---|
| TXN-01 | List loads with summary, columns and pagination matching API | Pass | Pass |
| TXN-02 | Empty form submit is blocked by required-field validation | Pass | Pass |
| TXN-03 | Amount validation rejects zero (0) | Pass | Pass |
| TXN-03 | Amount validation rejects negative (-5) | Pass | Pass |
| TXN-03 | Amount validation rejects three decimals (1.234) | Pass | Pass |
| TXN-04 | Category and date are required | Pass | Pass |
| TXN-05 | Oversized amount is handled without a server error | Pass | Pass |
| TXN-06 | Create expense: appears in list, persists after refresh, stored correctly | Pass | Pass |
| TXN-07 | Create income updates Total Income and shows a positive amount | Pass | Pass |
| TXN-08 | Edit transaction updates description, amount, type and category | Pass | Pass |
| TXN-09 | Delete transaction removes it (records whether a confirmation is asked) | **Fail** | **Fail** |
| TXN-10 | Cancel and Escape discard the form without saving | Pass | Pass |
| TXN-11 | Double-clicking Save creates only one record | Pass | Pass |
| TXN-12 | Search: match, no match, and empty query | Pass | Pass |
| TXN-13 | Description is rendered as text, not HTML | Pass | Pass |
| TXN-14 | Back-dated and future-dated entries | Pass | Pass |
| TXN-15 | Sorting and column filters availability | Pass | Pass |

### Recurring payments (12)

| ID | Test case | Existing | New |
|---|---|---|---|
| REC-01 | Page loads with tabs and an accurate active-schedule count | Pass | Pass |
| REC-02 | Empty form is blocked by required-field validation | Pass | Pass |
| REC-03 | Amount and first-date validation | Pass | Pass |
| REC-04 | End date earlier than first date is rejected | Pass | Pass |
| REC-05 | Create weekly expense schedule: card, Active tab and stored data | Pass | Pass |
| REC-06 | Daily income schedule shows "/ day" | Pass | Pass |
| REC-06 | Monthly income schedule shows "/ month" | Pass | Pass |
| REC-06 | Yearly income schedule shows "/ year" | Pass | Pass |
| REC-07 | Edit schedule amount and frequency | Pass | Pass |
| REC-08 | Stop schedule moves it to Stopped & ended | Pass | Pass |
| REC-09 | Delete schedule removes it | Pass | Pass |
| REC-10 | Creating a future-dated schedule does not post a transaction yet | Pass | Pass |

### Categories (9)

| ID | Test case | Existing | New |
|---|---|---|---|
| CAT-01 | List shows starter categories matching the API | Pass | Pass |
| CAT-02 | Empty and whitespace-only names are rejected | Pass | Pass |
| CAT-03 | Duplicate name (exact and different case) is refused | Pass | Pass |
| CAT-04 | Overly long name is handled without a server error | Pass | Pass |
| CAT-05 | Create category with icon and colour; usable in transactions and reports | Pass | Pass |
| CAT-06 | Edit category name | Pass | Pass |
| CAT-07 | Delete asks for confirmation; Cancel keeps, Delete removes | Pass | Pass |
| CAT-08 | Deleting a category in use keeps its transactions and their label | Pass | Pass |
| CAT-09 | Icon search filters the icon list | Pass | Pass |

### Reports & analytics (10)

| ID | Test case | Existing | New |
|---|---|---|---|
| REP-01 | Page shows KPIs and sections | Pass | Pass |
| REP-02 | Default range is the last 30 days | Pass | Pass |
| REP-03 | Range presets update the period text | Pass | Pass |
| REP-04 | Custom range applies chosen dates | Pass | Pass |
| REP-05 | Custom range with end before start is not accepted silently | Pass | Pass |
| REP-06 | Category filter re-queries for the chosen category | Pass | Pass |
| REP-07 | UI KPIs match API and the expense total matches the transactions ledger | Pass | Pass |
| REP-08 | A new expense is reflected in totals, top category and top transactions | Pass | Pass |
| REP-09 | Export CSV downloads a CSV file with a header row | Pass | Pass |
| REP-10 | Manage Categories and View All links navigate | Pass | Pass |

### Settings (11)

| ID | Test case | Existing | New |
|---|---|---|---|
| SET-01 | Tabs switch sections and update the URL | Pass | Pass |
| SET-02 | Profile shows the signed-in user details | Pass | Pass |
| SET-03 | Cancel Changes discards unsaved edits | Pass | Pass |
| SET-04 | Empty name and invalid email are not saved | Pass | Pass |
| SET-05 | Profile name change persists after reload (then restored) | Skip | Pass |
| SET-06 | Alert preferences: toggles render; saving persists (new account) | Pass | Pass |
| SET-07 | Monthly budget amount validation | Pass | Pass |
| SET-08 | Monthly budget can be set (new account) | Skip | Pass |
| SET-09 | Data & Backup: import template downloads | Pass | Pass |
| SET-10 | Import rejects a non-CSV file (new account) | Skip | Pass |
| SET-11 | Account deletion requires the password (not executed) | Pass | Pass |

### Family & sharing (5)

| ID | Test case | Existing | New |
|---|---|---|---|
| FAM-01 | Page shows create/join options for a user without a family | Pass | Pass |
| FAM-02 | Create family requires a name | Pass | Pass |
| FAM-03 | Create family requires agreeing to the sharing terms | Pass | Pass |
| FAM-04 | Invitation code: empty and invalid codes are refused | Pass | Pass |
| FAM-05 | Back to overview returns to the dashboard | Pass | Pass |

### Pay & record (7)

| ID | Test case | Existing | New |
|---|---|---|---|
| PAY-01 | Shows the 3-step flow, QR options and the manual form | Pass | Pass |
| PAY-02 | Empty form is refused | Pass | Pass |
| PAY-03 | Malformed UPI ID is refused | Pass | Pass |
| PAY-04 | Amount 0 is refused | Pass | Pass |
| PAY-04 | Amount -5 is refused | Pass | Pass |
| PAY-05 | Awaiting-confirmation list matches stored drafts | Pass | Pass |
| PAY-06 | View activity navigates to recorded payments | Pass | Pass |

### Notifications (4)

| ID | Test case | Existing | New |
|---|---|---|---|
| NOT-01 | List matches the API (or shows the empty state) | Pass | Pass |
| NOT-02 | Pagination buttons reflect available pages | Pass | Pass |
| NOT-03 | Mark all as read clears the unread count | Pass | Pass |
| NOT-04 | Manage alert preferences opens Settings &gt; Alerts | **Fail** | **Fail** |

### Navigation & responsive (13)

| ID | Test case | Existing | New |
|---|---|---|---|
| NAV-01 | Every sidebar link opens the right page | Pass | Pass |
| NAV-02 | Browser back and forward | Pass | Pass |
| NAV-03 | Header search from any page goes to filtered transactions | Pass | Pass |
| NAV-04 | Empty header search shows the unfiltered list | Pass | Pass |
| NAV-05 | Skip-to-content link targets the main region | Pass | Pass |
| NAV-06 | Unknown route does not render a blank page | Pass | Pass |
| NAV-07 | No console errors or 5xx responses across all pages | Pass | Pass |
| NAV-08 | Visible form controls all have an accessible name | Pass | Pass |
| NAV-09 | Desktop 1440x900: no horizontal overflow, content visible | Pass | Pass |
| NAV-09 | Tablet 768x1024: no horizontal overflow, content visible | Pass | Pass |
| NAV-09 | Mobile 390x844: no horizontal overflow, content visible | Pass | Pass |
| NAV-10 | Mobile menu opens the navigation and navigates | Pass | Pass |
| NAV-11 | Mobile: Add Transaction dialog fits the screen | Pass | Pass |

### Cross-account data isolation (6)

| ID | Test case | Result |
|---|---|---|
| ISO-01 | A transaction created by B is invisible to A (UI, search, API list) | Pass |
| ISO-02 | A cannot read, edit or delete B's transaction by id | Pass |
| ISO-03 | B cannot attach A's category to its own transaction | Pass |
| ISO-04 | B cannot rename or delete A's category; A's categories are not listed for B | Pass |
| ISO-05 | B's recurring schedule is invisible to A and cannot be stopped/deleted by A | Pass |
| ISO-06 | Dashboards and reports are computed per account | Pass |

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
