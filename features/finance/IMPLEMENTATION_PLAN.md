# Finance Management implementation and remaining integration plan

The user-assigned Phases 1–7 are complete for their respective scopes.
Shared staging integration is documented in PHASE7_INTEGRATION.md. Business
opening/cutover review remains an explicit operational gate.
The Phase 6 interface handoff is [PHASE6_INTERFACE.md](PHASE6_INTERFACE.md);
[PHASE5_REPORTING.md](PHASE5_REPORTING.md) defines the source/report evidence
contracts and financial completeness boundaries. This plan records the remaining
work; it does not authorize shared integration or a production release.

Finance owns its implementation inside `features/finance/`. Source owners retain
Billing receipts/invoices, POS register transactions, Collector custody/remittance,
Service lifecycle and Inventory quantity/cost evidence. The Integration Codex owns
shared page/router/navigation, Access, migration runner and runtime registration.

## Delivered scope and structure

| Phase | Delivered locally | Current guide |
| --- | --- | --- |
| 1 | Finance Management display name, six workspaces, ownership/models/workflows/permissions/formulas, ISP expense classifications, integration and history/costing boundaries. | IMPLEMENTATION_SPEC.md and SOURCE_CONTRACTS.md |
| 2 | Named accounts, attributed independent openings, balanced immutable journal, funds-only transfers/cards, reversals, PostgreSQL definitions and invariants. | PHASE2_INTEGRATION.md |
| 3 | Payee/category/expense intake, separate approval/posting/settlement, secure retained attachments, partial payment/reversal, SQL guards and actual worker races. | PHASE3_EXPENSES_PAYABLES.md |
| 4 | Finance-owned certified source adapters, canonical receipt deduplication, settlement mappings, classified manual income/funding, exceptions and safe itemized cutover. | PHASE4_INCOME_COLLECTIONS.md and HISTORICAL_IMPORT_PLAN.md |
| 5 | Financial/subscriber APIs, exact report bridges, dated growth/MRR and Billing cohorts, comparisons and durable immutable certified evidence. | PHASE5_REPORTING.md |
| 6 | Six React workspaces, interactive charts/record links, searches/filters/pagination/details, authorized full-report CSV/print and integration exports. | PHASE6_INTERFACE.md |
| 7 | Shared navigation/deep links/auth/Access/audit/metrics, five registered migrations, atomic source capture and retry providers, source controls and staging verification. | PHASE7_INTEGRATION.md |

```text
features/finance/
  README.md, module.json, PROJECT_MODULE_CONTEXT.md
  IMPLEMENTATION_SPEC.md, SOURCE_CONTRACTS.md, IMPLEMENTATION_PLAN.md
  PHASE2_INTEGRATION.md, PHASE3_EXPENSES_PAYABLES.md
  PHASE4_INCOME_COLLECTIONS.md, HISTORICAL_IMPORT_PLAN.md
  PHASE5_REPORTING.md, PHASE6_INTERFACE.md
  api/finance/
    router.py, permissions.py, schemas.py
    ledger.py, storage.py, memory.py
    payables.py, expense_schemas.py, payable_storage.py
    income.py, income_schemas.py, income_controls.py, income_storage.py
    source_adapters.py
    reporting.py, report_schemas.py, report_storage.py
    report_adapters.py, report_exports.py
    migrations.py, migrations/       five ordered definitions; twenty-four tables
  api/tests/                         local/API/adapter and private PostgreSQL
  web/
    index.mjs, FinancePage.jsx       single Finance Management parent
    ExpensesPayables.jsx, IncomeCollections.jsx
    FinanceReports.jsx              Overview/financial/subscriber compositions
    FinanceCharts.jsx, FinanceRecords.jsx, FinanceDialog.jsx
    financeApi.mjs, expenseEvidence.mjs, incomeClient.mjs, reportClient.mjs
    finance.css, tests/             exact client tests and intercepted browser harness
```

The default FastAPI service is ReportingService, extending IncomeService,
PayablesService and the accounting foundation. The module exports one APIRouter
at `/api/finance` and one parent page intended for `/finance`; there are no separate
workspace apps or login systems. Current metadata is `integrated` with
`integrated=true`. Five module-owned definitions are applied on shared staging.

## Phase 7 integration checklist (delivered; retained for verification)

The user assigned Phase 7 integration on 2026-10-12. Lock each affected shared path
and source module before editing; lock runtime/server for shared build/restart.
Use shared staging on 8280/8200, never the disabled local production 8180/8100.

1. Register the page and router in app-shell, add one Finance Management parent
   navigation item, preserve common gutters and existing session/token behavior.
   Review deep links, lazy loading, Vite/Docker module source access and source
   detail links. Workspace selection preserves six workspace deep links.
2. Inject the trusted current Actor and seed/review Finance grants in shared Access.
   Keep account/document scopes and approval limits, enforce creator/editor review
   restrictions, and verify revoked permissions for replays, downloads and reports.
   Add `finance.reports.export` and `finance.reports.print` with report read authority.
3. Register all five migration definitions with shared runner/checksum behavior.
   Verify no unexpected migrations or DDL occur on startup. Test backup/restore of
   all twenty-four tables, private evidence bytes, idempotency keys and sealed history.
4. Connect the four source-owner-authorized operational providers and the four
   report-evidence providers. Review original/correction/tombstone contracts,
   complete cohorts, dated lifecycle/ownership/billability/rates, cursor CAS,
   source authorization and current contacts without duplicating subscriber receipts.
5. Prepare/review attributed openings and itemized controls through C−1, independently
   certify the cutover C, then ingest only forward economic events. Older originals
   remain reference evidence unless a separately approved import establishes another
   boundary. Reconcile holdings, AR/AP, credits, custody and source fingerprints.
6. Verify actual authenticated workflows on staging: empty/denied/error/provisional
   states, device layouts/keyboard focus, partial payments, duplicate requests,
   independent approvals, reversible corrections, account archival, receipt dedup,
   collector remittance, source retries, print/export and comparable report windows.
   Retain meaningful unit/PostgreSQL/browser regressions and audit attribution.
7. Review centralized audit/download attribution and retention/backup policies.
   Record exactly which source windows and workspaces are complete. Update root
   Project_Context.md only with stable shared integration facts after wiring.

Acceptance: one integrated parent, durable restart/restore, no duplicate receipts
or openings, matching source/ledger/report totals, scopes enforced on every API
and output, independent reviews, proper source evidence/cutoff, provisional/null
figures where prerequisites are missing, and coordinated staging verification.
Production publishing requires an explicit user release instruction.

## Recognition, costing and historical-data dependencies

These are separate accounting/source work, not facts supplied by the interface:

- Delivered-service recognition schedules, advance/prepayment recognition and
  authoritative promotion/rebate treatment need Billing/Service delivery evidence.
  A subscription invoice or payment alone does not earn revenue.
- Inventory needs valued issue/consumption cost layers and direct-cost policy;
  today's editable unitCost cannot supply historic COGS. Assets need reviewed useful
  lives/depreciation/accruals. Interest, financing and tax coverage require evidence.
- Service needs dated append-only lifecycle/ownership history and certified
  baselines; Billing needs effective billability/rate history and full as-of cohorts.
  Imported current-state dates are not new activation history. Unsupported periods
  remain unavailable; closing-only evidence cannot invent opening/growth figures.
- Review period-close/publication revisions and knowledge-time reporting separately.
  Current asOf reports use effective dates with currently known posted evidence.
- Define treatment of unresolved collector variance, partial/pre-cutover refund
  entitlement, gateway settlements and any broader accounting policies before
  certifying complete net profit or expanded source contracts.

The shipped API/UI enforces these distinctions and labels known components
provisional and dependent profit/history measures unavailable. Source owners must
supply evidence; do not edit operational receipts or seed invented history to make
a financial report reconcile.

## Scale and future product boundaries

Current repositories load full history; complete journal responses and CSV/print
are suitable for the present implementation but need measured server pagination,
search, volume limits/streaming and snapshot strategy for large histories. Preserve
company-wide report scopes and exact global totals when optimizing these reads.

Bank feeds, payroll processing, forecasts, tax filing, multi-line/taxed/prepaid
expense expansion, inventory quantity synchronization, controlled evidence purge/
holds and period closure remain future product work requiring assignment.

## Verification record

Phase 6: 100 local Python tests, 103 executed PostgreSQL cases (106 discovered,
three inherited fixture skips), 21 Node tests and eleven Chromium workflow groups.
PostgreSQL uses guarded private fixture namespaces, not application/public DDL.
Browser checks run against the existing staging origin with intercepted real
in-memory Finance API fixtures; they reject their one partial-payment POST and
perform no application financial write. They are not live provider integration.
Source/CSS transforms and an isolated module bundle pass. Existing shared working-
tree changes are preserved; no shared build/restart, root context edit or release.
The phase guides retain earlier delivery/verification and provider-contract details.
