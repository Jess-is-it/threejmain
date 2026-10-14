# Finance Management

## Direct expense recording

Expense payment/charge references are optional for cash, e-Wallet, bank and card
purchases, including later expense payment confirmation. Any entered reference is
retained; stable internal source IDs, receipt/evidence controls, attribution and
idempotency remain required. Saving a draft or recording Pay later/Installments
can exceed cash available; actual Paid now posting cannot make the funding account
negative. Card charges increase debt rather than consume company cash. Ordinary
transfer and card-bill repayment reference policies are unchanged.

Authorized Finance users and owners can **Save & record** their own business
expenses without independent approval. Roles exposes `finance.expenses.record-direct`
(Record own expenses directly), with create/post dependencies. Immediate paid/card
purchases also require `finance.expenses.pay`. Unchanged built-in Finance Officers
receive the new grant through existing module registration; custom roles and
read-only management/auditor roles retain their existing grants.

Employee reimbursements, staff-created/edited submissions, and amounts above the
role's optional Finance approval limit require independent approval. A blank limit
is unrestricted for authorized own business recording; it never waives reimbursement
review. The existing Roles limit field also caps direct recording, with exact cents.
An employee payee forces reimbursement review even when the checkbox is omitted.

Creation, attachment evidence, direct authorization audit, expense recognition,
and declared paid/card settlement commit atomically. Pay later and installments
remain unpaid. Recognition and payment use separate balanced journals; payment and
card repayment do not create another expense. `NOT_REQUIRED` identifies approval
that was not required, with an actual recorder and policy snapshot, never a made-up
approver. Posted evidence remains immutable; linked attributed reversals correct it.
Drafts can still be saved; an authorized creator can Record expense on an own draft.
No old drafts/submissions/payments are automatically posted.

`2026101304_finance_direct_expense_recording` is an additive module migration loaded
by the existing shared migration registry. POST `/api/finance/expenses` accepts
`recordImmediately`; POST `/api/finance/payables/{id}/record-direct` takes the current
version. Direct recording and submission are mutually exclusive. Existing saved
intake requests preserve their fingerprint when new options are absent/false.

Expense create/edit forms support **+ Add category** beside Category without losing
the expense draft or selected receipt. Access uses existing `finance.expenses.manage`
and `finance.accounts.view` role grants. The new category defaults to Operating expense,
requires a matching recognition ledger account, and is selected automatically after
saving. Cancel returns to the draft. The category API retains server-side permission,
account scope, audit and idempotency controls; no automatic role grants are added.

Workspace navigation uses the existing shared Finance Management sidebar and seven
deep links. The page shows the current workspace title without repeating sidebar
choices as tabs. Useful local account, income and report views remain available.
Expenses default to the transaction list; Payees and Categories are under Manage,
with Back to expenses and permission-controlled creation/editing actions.

Finance Management owns ISP financial accounts, accounting, expenses/payables,
source-linked income, cash flow, financial reports and subscriber analytics.

## Notifications

Finance action messages appear as dismissible popups. Success clears after six
seconds unless hovered or focused; errors remain until dismissed. Form validation
stays inside the form dialog. Unconfirmed requests have a persistent recovery
popup and keep further posting blocked until the saved request is confirmed.
Popups are excluded from printable reports. Host-only checks:
`FINANCE_PLAYWRIGHT_MODULE=<playwright index.mjs> PLAYWRIGHT_BROWSERS_PATH=<browsers> node features/finance/web/tests/financeNotifications.browser.mjs`.

## Simple accounts and transfers

The company electronic-wallet account type displays as **e-Wallet** in account
forms, lists, details and named-account selections. Existing COMPANY_GCASH API and
stored values remain compatible; account names identify the particular wallet.

Accounts & Transfers opens one compact account-name/type and balance list, with separate Company funds and Credit cards totals. Collector custody
is tracked under Income & Collections → Pending remittances. Summary cards open their supporting account
rows. Balances reflect posted Finance evidence in PHP as of the Manila business
date. Collector holdings are outside this list; card debt is shown separately from
company funds. Search stays visible; extra filters and archived-account visibility
are under Filters. Pay credit card and Transfer history are under Manage alongside
the existing accounting setup actions. Bill details stay in their dedicated view.
Click an account name to review its balance, transaction history and account
settings. Cash history uses Money in / Money out; cards use Charges / Repayments.
Starting balances establish a baseline and are not shown as ordinary movements.
Debit/credit evidence and attribution remain available under Accounting details.

**Add account** asks for name and type, generates a permanent internal code, and
keeps optional notes/person responsible under More details. Collector accounts
require a responsible person. Enter an optional starting balance and balance date
in this same form; blank/zero starts empty, and a card amount is debt owed.
The account and positive starting-balance request save together in one transaction.
No manual supporting reference/reason is required. Finance records the operator,
date and declaration provenance automatically. Authorized account managers with finance.accounts.manage and
finance.opening-balances.post apply the declared starting balance immediately,
in the same transaction. The immutable journal and audit record the operator;
no independent reviewer is fabricated. Starting balances can also be set later from
account details using amount/date only. Uncertain creation confirms the same saved
request, including its starting balance, without another account or setup dialog.

`POST /api/finance/accounts` optionally accepts `startingBalance: {amount,
effectiveDate}` and returns the attributed posted opening with the account.
A positive starting balance also requires `finance.opening-balances.post`.
`POST /api/finance/opening-balances` requires accountId/amount/effectiveDate;
legacy reason/evidenceReference remain optional API inputs. Missing references are
explicitly operator declarations. Accounts, openings, balanced journals, audits and idempotency results
commit or roll back together. Operator declarations are posted immediately for
account managers; nonmanager and historical REFERENCE requests retain review.
An older operator declaration can be applied through its existing /post endpoint.
Accounts and details show any unapplied amount with a Review starting balance link;
these amounts are excluded from posted balances until applied. No editable master
balance is introduced.

Apply Finance migration 2026101303_finance_declared_starting_balances through the
existing shared migration runner before updated posting. It is registered in
Finance MIGRATIONS; no shared wiring or grant seed change is required. The database
accepts either attributed declarations or independent review, retains immutable
opening evidence and journal checks, and performs no automatic financial backfill.
Direct postings retain approvedBy=null and postingPolicy
AUTHORIZED_ACCOUNT_MANAGER_DECLARATION. Starting balances offset equity and add
no income, expense or cash-flow movement. Reviewed source cutover remains separate.

**Transfer money** asks for source, destination, amount, date and purpose, suggests
the payment method, and requires a real supporting reference for noncash movement.
The generated posting reference stays internal. A preview identifies the two
accounts; same-account and card-to-card choices are excluded. Transfer history
shows the direction and amount with accounting detail available on demand.
**Pay credit card** opens issuer bills, filtered to the current card when launched
from its details. Latest bill remaining/next due are visible alongside card debt.
Bill repayment and linking an already-recorded transfer preserve their existing
allocation, installment, reversal and duplicate-recovery workflows.

Authorized **Manage** tools hold Accounting accounts, Collector custody, Starting balances and
Journal entries/Post journal. Existing API permissions and account scopes,
attributed starting-balance posting, immutable evidence, zero-balance archival and period rules
remain authoritative. Existing permissions and shared routes remain in place; simplified declarations
now apply immediately for authorized account managers.

## Pending collector remittances

Income & Collections shows a pending-remittance summary and supporting custody
accounts. Select **Pending remittances** to review each responsible collector,
cash/personal GCash leg, posted balance and transaction evidence. Positive balances
make up the pending total; negative balances require reconciliation and do not
reduce another collector’s outstanding amount. Settled accounts are available
through Include settled custody accounts. Dates, permitted scope, posted-record
basis and provisional setup status remain explicit.

Collector owns confirmation and discrepancy handling. **Open Collector** links to
its existing workspace for roles with collector.finance.view. Finance balance and
activity access require finance.accounts.view alongside income workspace access;
missing access shows no amount. Source cutover/mapping gaps can leave this view
incomplete: these are posted Finance custody balances, not a replacement Collector
remittance ledger. Confirmed source remittance moves funds into the company account
without creating another customer receipt or income posting.

Collector types are absent from the everyday account list, its summaries and Add
account. Authorized custody creation/edit/archive remains under Manage → Collector
custody; openings, journal evidence, mappings, transfers and reports retain the
underlying accounts. No financial records or accounting definitions are changed.

## Simple expense workflow

Expenses & Payables uses **Add expense → Submit → Approve → Record payment**.
Routine fields stay visible; extra references are under More details. Pay later
and installment expenses require a payee; Paid now and Charged to credit card may omit
the payee and retain “Payee not specified” in their evidence and reports.
The two immediate-payment choices show separate cash/GCash/bank and credit-card
account selectors, dates and references. Supplier installments are also supported.
**Accounts & Transfers → Pay credit card** tracks issuer due dates, agreed
installments, repayments and existing-transfer allocation without another expense.
Approval records the reviewed cost atomically; payment is separately authorized.
[SIMPLE_EXPENSES.md](SIMPLE_EXPENSES.md) documents permissions, APIs and limits.

## Activity transaction history

`/finance/activity` is the seventh workspace under Finance Management. It shows
posted money in, money out and transfers automatically from the existing journal,
with date/account/type/search filters, server pagination and supporting-record
details. A transfer or remittance appears once; Billing receipt aliases do not
produce additional rows. Card purchases/credits and opening balances have
separate labels; loan proceeds and owner funding remain distinct from revenue.
Unpaid recognition and pending approvals do not create money movement rows.
Corrections preserve the original and link both records. Expense payments open
their exact payable; source/manual income evidence is available in the detail.

Read-only APIs: `GET /api/finance/activity` and `GET /api/finance/activity/{id}`.
Both require `finance.view`, `finance.accounts.view`, `finance.journals.view`,
plus existing linked expense/source permissions and account/document scopes.
No new ledger, permission grant, migration or financial posting was introduced.

## Current status

Phases 1–7 are implemented and integrated on shared staging (`integrated`). Named
accounts, attributed declared/reviewed openings, immediate internal transfers,
immutable balanced journals, reversals and activity are implemented locally.
Classified expense intake, independent approval/rejection, recognition,
partial settlement, linked reversals and private supporting attachments are
implemented on that foundation. Phase 4 adds Finance-owned certified Billing/POS/
Collector/Service adapters, canonical receipt deduplication, source journals,
reviewed settlement-account mappings, classified manual inflows, cutover
baselines and reconciliation exceptions. Phase 5 adds financial reporting APIs,
monthly comparisons, journal drill-down, certified durable subscriber lifecycle/
rate snapshots and authoritative Billing cohort/as-of report projections.
Phase 6 completes all six React workspaces under one Finance Management parent,
interactive evidence-linked charts, searchable/paginated records and authorized
CSV/print reports. The page/components and FastAPI router are exported. See
[PHASE6_INTERFACE.md](PHASE6_INTERFACE.md) for the current UI/API integration guide.
Nine module-owned PostgreSQL migrations (28 tables) are registered through the shared
database. Shared auth/Access, audit, metrics and Billing/POS/Collector/Service
feeds plus Customer Profiling/Inventory references are wired. Business setup
requires reviewed account openings and an independent cutover; no historical
receipts were imported as new cash. [PHASE7_INTEGRATION.md](PHASE7_INTEGRATION.md)
is the current integration guide and supersedes earlier pending handoffs.

```text
features/finance/
  README.md
  module.json
  PROJECT_MODULE_CONTEXT.md
  IMPLEMENTATION_SPEC.md
  SOURCE_CONTRACTS.md
  IMPLEMENTATION_PLAN.md
  PHASE2_INTEGRATION.md
  PHASE3_EXPENSES_PAYABLES.md
  PHASE4_INCOME_COLLECTIONS.md
  HISTORICAL_IMPORT_PLAN.md
  PHASE5_REPORTING.md
  PHASE6_INTERFACE.md
  PHASE7_INTEGRATION.md
  api/finance/
    __init__.py
    router.py
    schemas.py
    permissions.py
    ledger.py
    storage.py
    memory.py                   explicit test-only storage
    expense_schemas.py
    payables.py
    payable_storage.py
    income.py
    income_schemas.py
    income_controls.py
    income_storage.py
    source_adapters.py
    reporting.py
    report_schemas.py
    report_storage.py
    report_adapters.py
    report_exports.py
    migrations.py
    access.py
    integration.py
    migrations/2026101201_finance_foundation.sql
    migrations/2026101202_finance_payables.sql
    migrations/2026101203_finance_income.sql
    migrations/2026101204_finance_reports.sql
    migrations/2026101205_finance_integration.sql
  api/tests/
  web/
    index.mjs                   parent/page/component exports
    FinanceReports.jsx          overview, financial and subscriber workspaces
    FinanceCharts.jsx           interactive SVG with evidence links
    FinanceRecords.jsx          search/filter/pagination and statuses
    reportClient.mjs            exact chart geometry and evidence selection
    FinancePage.jsx
    ExpensesPayables.jsx
    IncomeCollections.jsx
    incomeClient.mjs
    FinanceDialog.jsx
    finance.css
    financeApi.mjs
    expenseEvidence.mjs
    tests/
```

Live staging route: `/finance`, with seven workspace deep links under one parent.
Live API prefix: `/api/finance`. Production is not deployed.

## Implementation specification

- [PHASE7_INTEGRATION.md](PHASE7_INTEGRATION.md): current shared wiring, Access,
  durable source capture/recovery, reviewed cutover, historical boundaries,
  database backup/restore policy and staging verification.

- [IMPLEMENTATION_SPEC.md](IMPLEMENTATION_SPEC.md): six workspaces, ownership,
  relational models, workflows/states, permissions, report formulas, accounting
  treatment, recommended ISP categories and data-completeness gates.
- [SOURCE_CONTRACTS.md](SOURCE_CONTRACTS.md): source-verified Billing, POS,
  Collector, Service, Customer Profiling and Inventory contracts; explicitly
  proposed feeds/adapters and source-owner integration requirements.
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md): remaining phases, proposed
  module-local structure/API families, dependencies and acceptance criteria.
- [PHASE2_INTEGRATION.md](PHASE2_INTEGRATION.md): delivered account/journal
  semantics, exact API/permissions, migration-runner handoff, verification and
  current limitations. Use this for Phase 2 executable contracts.
- [PHASE3_EXPENSES_PAYABLES.md](PHASE3_EXPENSES_PAYABLES.md): current expense/
  payable APIs, independent approval, classified accrual, settlement/reversal,
  secure evidence/retention, new grants and ordered migration handoff.
- [PHASE4_INCOME_COLLECTIONS.md](PHASE4_INCOME_COLLECTIONS.md): current income/
  source APIs, accounting effects, approval/scope controls, settlement identities,
  source reversal rules, durable inbox and exact certified-provider handoff.
- [HISTORICAL_IMPORT_PLAN.md](HISTORICAL_IMPORT_PLAN.md): reviewed opening-versus-
  forward boundary, itemized obligations/custody, snapshot certification and
  integration verification that prevents duplicate opening/imported money.
- [PHASE5_REPORTING.md](PHASE5_REPORTING.md): current reporting APIs, exact
  formulas, dated lifecycle/MRR evidence, receipt-month versus bill-month
  settlement, comparison windows, completeness and report-provider handoff.

These documents govern current and remaining implementation; the research
summary below records the original rationale.
Billing/POS/Collector keep source ownership; Finance consumes attributed
accounting effects rather than creating another customer receipt ledger.

## Research summary and proposed scope

Enterprise expense systems separate submission, approval, accounting posting,
and payment/reimbursement. They reconcile bank transactions to source documents
and treat internal transfers as movements between accounts. For this ISP, those
principles must extend to collector custody, company GCash, monthly subscriber
invoices, POS receipts, installation charges, and network equipment purchases.

Cash flow and profit need separate reports: receipt date, service period,
expense recognition, and payment date can differ. Subscription reporting also
needs dated activation/lifecycle events, rather than counting newly entered
customer profiles as new subscribers.

Proposed workspaces:

- Overview: revenue, costs, profit, funds available, receivables, and
  comparable monthly performance with drill-down to source records.
- Accounts & Transfers: named cash/GCash/bank accounts, collector custody,
  credit-card liabilities, opening balances, transfers, and reconciliation.
- Expenses & Payables: categories, suppliers/payees, supporting receipts,
  purpose, expense/due/payment dates, optional location/project, approval,
  partial payments, and payment account.
- Income & Collections: source-linked Billing receipts, POS register payments,
  installation collections, and separately classified other income/funding.
- Financial Reports: cash flow, profit and loss, account activity, ranked
  expense categories, period comparisons, and exports.
- Subscriber Growth: distinct customers and service lines, new activations,
  reactivations, suspensions, terminations, net growth, and monthly bill settlement.

Proposed states: expense approval `DRAFT -> SUBMITTED -> APPROVED` or `REJECTED`;
posting tracked separately; payable settlement `UNPAID -> PARTIALLY_PAID -> PAID`.
Posted corrections use attributed reversals rather than deletion. Transfers
need pending/posted/reconciled distinctions where settlement is delayed.

Proposed shared roles: Finance Officer for recording/posting permitted transactions
and reconciliation; authorized approver for expense approval; owner/management
for aggregate reporting; read-only auditor for evidence and history. Use shared
System Settings Access permissions, with server-side enforcement and a defined
self-approval policy. Finance enforces explicit grants, account/document scopes,
independent opening/expense approval and approver limits locally; shared Access
grants are not seeded yet. Creators and financial/evidence editors cannot approve
their own expenses, including with wildcard grants.

## Feature connections and ownership

| Existing module | Planned Finance connection |
| --- | --- |
| Billing | Canonical subscriber invoices, receipts, allocations, promotions, rebates, customer credit, and current receivables. Reuse existing collection/cohort reports. |
| Point of Sale | Register sales/payments; invoice receipts remain Billing-owned even when collected by POS. |
| Collector | Held cash/personal-GCash, remittance, discrepancies, and custody reversals; remittance must not become a second receipt. |
| Customer Profiling | Canonical customer identity/location; resolve current contacts instead of copying operational mobiles. |
| Service | Service Account identities, activation/lifecycle evidence, plans, and installation references; distinguish imported existing lines. |
| Inventory | Stock/asset classification and cost evidence for goods sold or consumed; movements alone are not expense payments. |
| Account Access Management | Optional operational access context; access sync events do not independently define subscriber growth or revenue. |
| Customer Service Management / Ticketing | Optional request, outage, or job references for expense attribution; Billing remains owner of financial rebates. |
| System Settings / Logs | Shared authentication, permissions, business settings, timezone policy, and audit hooks. |
| Dashboard / Process Flow | Future reviewed summary metrics and documented finance workflows, integrated by the Integration Codex. |

Finance should own its account catalog, expense/payable records, transfers,
reconciliation, and an accounting journal referencing immutable source records.
The foundation uses the project's shared PostgreSQL database after integration;
do not create a separate database or another customer receipt ledger.

## Reporting rules and operational edge cases

- Distinguish payment method from the named account that holds funds.
- Internal transfers and collector remittances are not additional income.
- Credit-card purchases create liabilities; paying the card does not repeat
  the underlying expense. Owner funding and loan principal are not sales.
- Separate equipment/assets, stocked inventory, direct costs, and operating
  expenses; define recognition, costing, depreciation, interest, and tax policy
  before presenting a complete net-profit figure.
- Report cash received during a month separately from that month's invoice
  cohort settlement. Advances, credits, discounts, refunds, voids, and partial
  payments must remain identifiable and reconciled to their source records.
- Imported legacy payment evidence is reference-only and excluded from new cash.
- Count unique customers separately from active service lines. Migration-entry
  dates are not new activation dates; suspensions and terminations are separate.
- Store lifecycle history/snapshots for reliable historical growth. Label
  unavailable history rather than reconstructing it from current status alone.
- Compare completed months or equivalent month-to-date windows; use one
  documented business timezone, initially Billing's Asia/Manila policy.
- Opening balances require attribution and an effective date. Posted entries
  need idempotent source references, audit evidence, and period-close controls.
- Label provisional/incomplete reports; charts must link to the underlying rows.

## Integration boundaries and next step

This module delivery does not change existing modules, app-shell navigation/
router, shared permissions, Docker configuration, deployment, or shared runtime.
Integration Codex must register the prepared migration, trusted actor provider,
explicit grants, certified source providers and page/router later, following
PHASE6_INTERFACE.md and PHASE5_REPORTING.md. All four ordered migrations and nineteen tables are
required. Missing sync providers fail closed; reports label unsupported history/
coverage. No live receipt or report provider is wired.

Phase 1 now defines account/category models, recognition rules, proposed source
posting contracts, history/costing gaps and phased delivery gates. Next work
follows the user's next phase instructions. Phase 5 delivers the requested reporting and
subscriber APIs; automatic recognition/costing/depreciation, period
closure and shared integration remain separate dependencies.
Phases 2–6 are complete locally for their assigned scopes.
Source-owner feeds and unresolved accounting policies remain explicit
dependencies before authoritative reporting. Bank
feeds, payroll processing, forecasts, and tax filing are separate future work.

## Verification

From repository root:

```bash
PYTHONPATH=features/finance/api python3 -m unittest discover -s features/finance/api/tests -p test_finance_foundation.py
PYTHONPATH=features/finance/api python3 -m unittest discover -s features/finance/api/tests -p test_finance_payables.py
PYTHONPATH=features/finance/api python3 -m unittest discover -s features/finance/api/tests -p test_finance_income.py
PYTHONPATH=features/finance/api python3 -m unittest discover -s features/finance/api/tests -p test_finance_reports.py
node --test features/finance/web/tests/*.test.mjs
```

The Phase 5/6 guides cover opt-in PostgreSQL tests, including actual separate-
connection races in private temporary fixture schemas. Rollback-only fixtures
and dedicated race fixtures leave application schema/data unchanged; race
namespaces are removed after verification. Phase 6 adds eleven intercepted-fixture Chromium workflow groups on existing
staging, with no shared runtime rebuild, application financial writes or live
Finance shell integration.

## Research references

- [Odoo expense workflow](https://www.odoo.com/documentation/18.0/applications/finance/expenses.html)
- [Odoo approved expense posting](https://www.odoo.com/documentation/18.0/applications/finance/expenses/post_expenses.html)
- [Odoo internal transfers](https://www.odoo.com/documentation/18.0/applications/finance/accounting/bank/internal_transfers.html)
- [Business.gov.au cash flow guidance](https://business.gov.au/guide/guide-to-managing-cash-flow)
- [Xero income statement guidance](https://www.xero.com/uk/guides/income-statement/)
- [ChartMogul subscription metrics](https://dev.chartmogul.com/reference/metrics/all/)

Research reviewed 2026-10-12. These sources inform the proposed design; they
do not imply an integration with those products or local tax compliance.
Primary accounting references and freshly verified source findings are recorded
in SOURCE_CONTRACTS.md; profit/cash/recognition choices are management policies
with release gates, not statutory reporting claims.

Phase 6 verification: 100 local Python, 103 executed PostgreSQL tests (three
historical fixture skips), 21 Node tests and eleven Chromium workflow groups.
CSV/print permissions, exact chart/record bridges, creator review restrictions,
partial-payment requests and responsive layout are covered. See the Phase 6 guide
for commands, fixture boundaries, exports and remaining live integration gates.


### Reconciliation and readiness

Phase 8 verification and operating instructions: [PHASE8_READINESS.md](PHASE8_READINESS.md). Completed-month reconciliation, independent closing, authorized reopening, database posting locks and immutable report publications are implemented. The shared runner now registers six module-owned migrations, including `READINESS_MIGRATIONS`. Staging is integrated and tested; forward accounting still requires reviewed real account openings and source cutover, and complete profit/period closure requires the missing trusted recognition/cost/tax evidence. No production deploy was performed.
