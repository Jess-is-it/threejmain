# Finance Management

Finance Management owns ISP financial accounts, accounting, expenses/payables,
source-linked income, cash flow, financial reports and subscriber analytics.

## Current status

Phases 1–7 are implemented and integrated on shared staging (`integrated`). Named
accounts, independently approved openings, immediate internal transfers,
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
Five module-owned PostgreSQL migrations are registered/applied to the shared
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

Live staging route: `/finance`, with six workspace deep links under one parent.
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
