# Finance Management interface and chart handoff

Phase 6 delivered locally on 2026-10-12. All six workspaces sit under the single
Finance Management page. This delivery adds no shared navigation, login system,
source integration, application migrations or runtime deployment.

## Page exports and mounting

```jsx
import { FinanceManagementPage } from '../../features/finance/web/index.mjs';
// Mount the page directly inside the shared page-body at /finance.
<FinanceManagementPage apiBase={existingApiBase} refreshShell={existingRefresh} />
```

Adjust the import relative to the integrating shell file. The default export of
`web/FinancePage.jsx` remains compatible. `web/index.mjs` also exports workspace
labels, report/expense/income components, record tables/statuses and SVG charts.
`FinanceReports` composes Overview (`mode="overview"`), Financial Reports
(`mode="financial"`) and Subscriber Growth (`mode="subscribers"`). It expects
an authenticated FinanceApi and server-derived meta; mount the parent in normal
use. Components do not create their own authentication or receipt ledgers.

The parent returns `finance-management container-xl` and uses the existing shared
page-body gutters. All screen styles are scoped to `.finance-management`; the
print-only body class is added for the authorized print action and removed
immediately afterward. Tabler cards, forms, badges, responsive tables, wrapping
workspace controls and mobile grids use the shared CSS variables. No chart or
application dependency/package file is added. Charts use interactive SVG plus
accessible value tables; Enter/Space and mouse selection open supporting records.

## Delivered workflows

| Workspace | Behavior |
| --- | --- |
| Overview | Controlled cash, cash movement, card debt, collector personal-GCash due, earned results, AR/AP, exceptions and supported subscriber summaries. Every metric opens its records or missing-evidence explanation. |
| Accounts & Transfers | Named account creation/edit/archive/restore, account activity, independent opening review/posting, immediate transfers, balanced journal posting and attributed corrections. Search, status/date filters and pagination retain the existing server rules. |
| Expenses & Payables | Supplier/category management, expense/evidence intake, independent approval/rejection, recognition, partial payments from named accounts, attachment access and reversal workflows. Approval, posting and settlement badges remain separate. |
| Income & Collections | Authoritative source evidence, reviewed other-income/loan/owner funding forms, effective settlement mappings, source exceptions and certified cutover review. Methods never stand in for named accounts. |
| Financial Reports | Cash flow/balances, the full profit ladder, expense recognition or settlement by category/payee/account/location/project, receivables/payables, exceptions, receipt-month collections, journal drill-down and matching month comparisons. |
| Subscriber Growth | Distinct active customer/line openings and closings, dated lifecycle changes, migration baseline adjustments, net growth/percentages, dated MRR, Billing receipt-month payer evidence and selected bill-month full/partial/unpaid settlement. |

Forms continue to use the frozen per-username body and Idempotency-Key client.
Uncertain requests must be confirmed before another write. Posted amounts remain
immutable; corrections use existing attributed reversal APIs. Creators and last
financial/evidence editors cannot self-approve expenses, including wildcard users.
Opening/manual-income/expense approval buttons respect the server-resolved amount
limit; rejection retains the independently permitted review policy.
Native browser fetch is bound to its global context; shared dialogs trap focus,
return focus, use unique headings and prevent submission in record/print views.

Filters operate on the full loaded record set, with 10/25/50/100-row pages.
Date filters appear where records have effective/document/due dates. Accounts and
other undated master/metric lists omit date controls. Financial read authority is
company-wide; scoped users retain their permitted operational views but cannot
access aggregate reports. Server checks remain authoritative after grant changes.

## Chart and calculation rules

- Monthly earned revenue, recorded expenses (including direct costs) and net
  profit come from the P&L API's exact measures. Missing profit is a gap labeled
  Unavailable; recorded incomplete arithmetic is never plotted as net profit.
- Highest expense groups use exact cents for sorting. The selected recognition/
  supplier-payment basis and category/payee/account/location/project grouping are
  shown. Selecting a bar opens only the contributing expense/payment rows.
- Cash flow by account uses controlled account net movements, excluding opening
  adjustments. Per-account internal transfer legs remain in drill-down; they
  cancel in consolidated cash flow. Card debt/personal-GCash due are separate.
- Subscriber trends open actual dated membership/event evidence. Customer counts
  deduplicate owners; line counts use service account IDs. Imported existing
  lines are baseline adjustments, not new activations. MRR uses closing billable
  rates, independently of active status, cash collection or delivered earnings.
- Monthly bill settlement bars select the full/partial/unpaid customer cohort for
  the selected bill month through asOf. Cash, credits, rebates and outstanding
  amounts remain separate. Receipt-month evidence is shown independently.

Charts show their own report dates, basis, timezone and coverage. Trend charts
state their calendar-month/final-MTD windows; the comparison table uses the API's
complete-month or equivalent-day MTD policy. Summary/report details expose
provisional and unavailable states and missing dependencies. Amounts display as
exact strings; only bounded normalized chart coordinates become Number values.
No frontend arithmetic invents revenue, cost layers, rates or lifecycle history.

## Additional module-local API support

The Phase 5 APIs and four migrations remain in place; no fifth migration is needed.

| Addition | Contract |
| --- | --- |
| GET `/reports/monthly-series` | `kind=profit-and-loss|cash-flow|subscribers`, month/asOf, months 1–12 (default 6). One repository read snapshot supplies all monthly reports. Past months end at calendar month-end; the last month stops at the cutoff. Years before 1900 are rejected. |
| GET `/reports/{kind}/csv` | Full selected report, metadata, exact measures and supporting rows. Requires `finance.reports.export` **and** the relevant financial/subscriber read authority and unrestricted scope. |
| GET `/reports/{kind}/print` | Full authorized JSON report for local print preview. Requires `finance.reports.print` plus the same read authority/scope. Returns no-store JSON, not untrusted HTML. |
| GET `/reports/transactions?allRecords=true` | Full matching immutable journals for local search/pagination. Default offset/limit behavior remains compatible; allRecords is a company-wide report read, never a permission shortcut. Optional accountId still applies. |
| Subscriber report fields | `openingLines`, `closingLines`, `monthlyRateRows` and per-event projection flags expose the exact membership/rates/customer-entry evidence used by summaries. Unavailable opening history returns no invented rows. |
| Cash report field | `accountTransactions` contains signed natural-side movements per actual account, including internal transfers, excluding openings. Combined controlled cash still eliminates internal movements. |
| P&L measure | `totalExpenses` sums posted direct, operating, nonoperating, financing, income-tax and unclassified expense components. Uncertified coverage is provisional; assets/inventory are excluded. It is distinct from a complete net-profit result. |
| Friendly drill-down fields | Profit/expense records include effective dates and sealed account names; expenses/payables also expose their document category/payee names. No customer contacts are copied. |
| Meta | Phase 6, the actor’s `approvalLimit` and `reportScopesUnrestricted` let the UI suppress unavailable aggregate actions. |

CSV and print support cash-flow, profit-and-loss, expenses, payables, receivables,
reconciliation, collections, transactions, subscribers and billing-settlement.
They include every record in the selected month/asOf/basis/group/account scope,
independent of screen search/status/date filters; the interface states this before
export. CSV has context, summary/metric and evidence sections; journals expand to
balanced lines and subscriber exports include rates/membership/receipt/cohort rows.
Strings capable of becoming spreadsheet formulas are escaped; validated numeric
strings retain exact values. Null is an empty CSV value with its coverage status,
never a fabricated zero. Output names are controlled and responses use no-store,
nosniff and authenticated downloads. `requestedBy` and generatedAt attribute the
output; shared centralized download audit/retention remains an integration concern.
Printed reports include all rows, the selected basis/status and recorded incomplete
components where applicable. Print CSS hides shell/page controls and repeats table
headers; test previews do not invoke a production printer or create public files.

## Integration responsibilities and limitations

Integration Codex must separately:

1. Register the module page/router, shared Vite/Docker source access and one parent
   navigation entry. Review desired deep links; workspace selection currently stays
   inside the page rather than introducing six shell routes.
2. Inject the trusted current Actor, seed/review all Finance grants (including
   export/print), and retain account/document scopes and independent approval.
3. Register/apply all four ordered migration definitions in the shared runner,
   with checksum handling, backups and restore verification of all nineteen tables.
4. Connect source-owner-authorized Billing/POS/Collector/Service providers and
   the four certified reporting providers. Honor the itemized cutover boundary.
5. Verify live authentication, source links, device/print behavior, reconciling
   records and permission changes on staging under shared runtime coordination.

Financial recognition/costing/depreciation/financing/tax coverage and historical
Service/Billing evidence remain the Phase 5 dependencies. The UI labels missing
facts; it does not repair source history or infer historical COGS from today's cost.
Provider-only evidence sync remains API-controlled; the UI cannot upload a census,
mark coverage complete or create subscriber receipts. Bank feeds, tax filing and
period closure are separate future work.

The current repository loads full financial history and certified snapshots.
Local table pagination and bounded chart month counts do not solve server-side
scale. All-record journal responses and complete CSV/print exports need measured
volume limits/streaming/server search before large deployments. Keep the current
full-scope permission and exact-total contracts when optimizing them. There are no
new runtime ports, app dependencies or source-module edits in this phase.

## Verification and reproducible browser checks

Module Python tests: 100 local business/API/adapter tests pass. PostgreSQL:
103 tests execute successfully (106 discovered, three historical fixture skips),
including actual independent-worker posting/source races and six interface report
reconciliation cases. Existing application/public tables are not migrated or
modified: database tests use guarded generated private schemas, roll back ordinary
fixtures and remove committed race namespaces. Twenty-one Node tests pass, including
exact cents/null chart geometry, download/retry behavior, scope predicates,
subscriber evidence selection and native browser fetch context.

Eleven Chromium workflow groups pass on the existing staging origin with
Finance-only intercepted fixtures generated by the real in-memory API. This is
component/interaction verification, **not live Finance integration**. The checks
cover all workspaces, account search/pagination/forms, chart keyboard/evidence
links, provisional profit, internal cash legs, CSV/print layout, creator review
restrictions, exact partial-payment request/account selection and definitive
rejection, loan classification, subscriber/customer migration distinctions,
partial bill settlement, subscriber-only grants and a 390px layout. The one
browser POST is deliberately rejected by the fixture handler; no application
financial write occurs. Chromium reports no page errors. Static source/CSS
transforms and an isolated source bundle use existing esbuild/React dependencies;
no shared shell build/restart or persistent navigation/source registration occurs.

Commands from repository root:

```bash
PYTHONPATH=features/finance/api python3 -m unittest discover -s features/finance/api/tests -p 'test_finance_*.py'
node --test features/finance/web/tests/*.test.mjs
# Existing Phase 5 guide documents opt-in PostgreSQL/private schema prerequisites.
# Use a temporary Playwright installation/cache, never add an app dependency.
PYTHONPATH=features/finance/api:features/finance/api/tests python3 features/finance/web/tests/browserFixtures.py /tmp/finance-ui-fixtures.json
FINANCE_UI_FIXTURES=/tmp/finance-ui-fixtures.json FINANCE_PLAYWRIGHT_MODULE=/path/to/temporary/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/path/to/temporary/browser-cache node features/finance/web/tests/financeInterface.browser.mjs
```

`FINANCE_STAGING_ORIGIN` defaults to `http://127.0.0.1:8280/`; it must identify the
existing shared staging runtime. Optional `FINANCE_UI_SCREENSHOT` saves a temporary
test artifact. No preview server is started. Browser fixture JSON and screenshots
are temporary and excluded from the module source/migrations.
