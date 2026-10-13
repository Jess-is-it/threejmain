# Finance Management Module Context

## Compact setup guidance (2026-10-13)

Removed the long persistent setup alert from every Finance workspace. Pending setup
now shows only a collapsed “Finance setup is incomplete. Review setup” disclosure on
Overview, and only for users with account-management, opening-post/approve or
cutover-manage/approve grants (including wildcard). Expanding it explains starting
balances and source cutover with directions to the existing local views. Other pages
show no global setup notice. API setup/approval/cutover gates, source-specific controls
and provisional/unavailable report labels remain unchanged.

## Sidebar navigation and expense setup (2026-10-13)

The shared Finance sidebar is the workspace navigator. FinancePage no longer renders
the duplicate seven-workspace tab row. Its header shows Finance Management as a
pretitle and the selected workspace as the page title; local report/Activity duplicate
headings were removed. Existing deep links, initialWorkspace/onWorkspaceChange and
record drill-downs remain supported. Journal-to-payable navigation now also calls
onWorkspaceChange so the shared URL and sidebar selection match the displayed page.
Account/card-bill/opening/transfer/journal and income/report subviews remain available.

Expenses & Payables defaults to the expense list and Add expense action. Native
keyboard-accessible Manage disclosure opens Payees or Categories; selecting a view
closes the disclosure. Those views provide Back to expenses and existing authorized
create/edit/archive actions. Read access remains available to expense viewers; management
actions retain their existing grants and the API remains authoritative. No shared shell,
API, permission or database changes are needed for this refinement.

Existing browser checks now exercise shared sidebar navigation/deep links and the
parent workspace prop contract rather than relying on removed in-page tabs.
Shared staging rebuilt through scripts/staging_deploy.sh under runtime/server lock;
desktop and 390px mobile screenshots reviewed. All 42 browser workflow groups pass
(15 actual staging, 11 interface fixtures, nine Activity, seven expense/card), with
zero page errors or shared financial writes. Actual smoke coverage includes all seven
deep links, active sidebar selection, keyboard Manage access, mobile menu navigation,
setup forms, exports and print. Module context/README updated; root context unchanged.

## Simple expenses and credit-card bills (2026-10-13)

Current workflow and operations: SIMPLE_EXPENSES.md. Expenses & Payables now exposes
payee/category/amount/date/description/evidence and payment arrangement first; extra
references sit under More details. One list status covers review/settlement; technical
accounting and audit details remain accessible. Mobile expense records use stacked cards.
Pay later, supplier installment schedules and declared already-paid/card charges are
supported. Exact monthly suggestions preserve cents/month ends; payments allocate earliest
due first, with derived reversal recovery and as-of report aging tied to payable control.

POST /api/finance/expenses commits draft, optional private evidence and submission
atomically. Empty supplier invoice references receive explicitly internal references.
POST /payables/{id}/approve-record commits independent approval and only that reviewed
cost recognition together under expenses.approve; failures roll back both. This scoped
business action grants no generic posting authority and moves no funds. Creator/editor,
limits, frozen evidence, period locks and account/document scopes remain enforced.
Original separate approve/post contracts stay available; actual supplier settlement
still requires expenses.pay. Already-paid declarations are confirmed after approval.

Accounts & Transfers -> Card bills uses web/FinanceCards.jsx and api/finance/cards.py.
Issuer bills retain period/due/full balance/evidence and optional agreed installments;
current card debt and bill remaining are explicitly separate. Bills post no costs.
Repayment journals reduce liability/funds with zero expense/income effect. Linking an
existing card transfer allocates evidence without posting again. Same references/keys
recover safely. Reversals restore derived bill settlement; corrections retain immutable
replacement evidence. Latest issuer full balance carries old debt forward and supersedes
prior tracking bills; balances across bills are never summed as accounting liability.
Account scopes filter bills and individual funding-account details. See SIMPLE_EXPENSES.md
for all routes/grants and retained evidence/correction boundaries.

EXPENSE_WORKFLOW_MIGRATIONS appends 2026101301_finance_expense_workflows through shared
main registration: seven Finance migrations / 28 tables. New immutable card statements
and repayments have relational journal/account mappings and PostgreSQL constraints.
Previously applied migration bytes/checksums remain unchanged. No new source ledger,
role grant, app dependency, provider or recurring job. Statement uploads/issuer feeds,
minimum-payment or automatic interest calculations remain future work; card evidence
currently uses controlled references. Costing/history/cutover prerequisites remain.

Shared staging deployed with scripts/staging_deploy.sh on 8280/8200 under runtime lock,
after a verified protected archive (SIMPLE_EXPENSES.md). Public Finance journals,
payables and card bills remain empty; no production deploy. Browser fixtures come from
real isolated services and intercept all financial writes. Readiness remains conditional
on real named accounts, independently reviewed openings/cutover and trusted coverage.

Final verification: exact staged Finance plus shared Finance wiring archive ran 349
cases, 343 passed and six inherited/thread-fixture skips (343 Finance cases plus six
shared wiring checks). All 26 Node client checks pass. Deployed browser review passes
seven new expense/card groups, nine Activity regressions, eleven existing interface
groups and thirteen actual staging groups, with no page errors or shared financial
writes. Private PostgreSQL tests include real independent approval/payment workers,
immutable SQL guards, failed-write rollback, and existing-transfer allocation.


## Activity transaction history (2026-10-13)

Added the seventh workspace `Activity` at `/finance/activity`, under the shared
Finance Management parent and exported from `web/index.mjs`. Implementation:
`web/FinanceActivity.jsx`, `api/finance/activity.py`, read-only `/api/finance/activity`
and `/api/finance/activity/{entry_id}` routes. Existing six workspaces and financial
posting/provider ownership remain unchanged. No SQL migration or grant changes.

One row per immutable posted journal with net movement in a named financial
account; noncash accruals, unpaid recognition, source aliases and pending documents
are absent. Money in/out, transfers/remittances, card purchases/credits and opening
balances have readable labels. Loans, owner contributions, customer advances and
card funding are not relabeled as earned revenue. Duplicate/no-funds receipt
corrections have their own `CORRECTION` type and explicit no-money-moved label,
separate from actual refunds. Bank-to-card repayment is money
out; card-to-cash funding is money in; asset/custody transfers are internal.
Remittance shortage rows show received amount, and details retain sent/received
amounts plus the discrepancy journal. Personal Collector GCash remains a due-from
account, clearly distinguished from controlled company cash in detail.

GET list accepts inclusive `fromDate`, `throughDate` (defaults to current Manila
day), `accountId`, `type`, `search`, `offset`, `limit` (1–100). Stable date/journal
number descending order; exact PHP strings; archive retains historical account
snapshots and selectable archived accounts. Search covers descriptions, journal
numbers, references, counterparties, actors and historical account name/code.
Full ledger read/projection precedes server pagination, matching current journal
repository behavior; database query optimization remains future scale work.

Both routes require Finance view, account view and journal view; current inherited
entry scope also enforces every account, linked payable ownership/document scope,
and income/source grants. Inaccessible entries are omitted from counts, details
remain forbidden, and filters cannot broaden scope. No broad aggregate-report
grant or new role upgrade is required. Corrections and original rows remain linked;
opening rows are separate from current receipts. Details show supporting evidence
and an optional accounting table. Expense payment links select the exact payable;
source/manual links open Income & Collections while retaining exact evidence in
the Activity detail. Attachments remain behind the existing secure payable route.

Tests: `test_finance_activity.py` plus its private rollback PostgreSQL counterpart;
browser fixtures from the actual API in `web/tests/activityFixtures.py` and deployed
navigation checks in `web/tests/financeActivity.browser.mjs`. Full Finance suite:
266 cases, 263 pass, three inherited fixture skips; 21 existing Node client checks
pass. Activity backend adds 19 passing memory/PostgreSQL/HTTP cases. Browser checks
cover nine populated Activity workflow groups and thirteen live Finance staging
groups, with no page errors or financial writes. Mobile transaction cards expose
amounts and both accounts without horizontal table scrolling. No real financial records
were created by fixtures; forward source history still requires reviewed cutover.

## Purpose and current state

Finance Management is the ISP finance workspace for the Finance
Officer and owner/management. Created 2026-10-12 at the user's request to keep
the feature separate and organized. Phase 1 specification completed 2026-10-12.
Phases 1–7 completed on 2026-10-12 for their assigned scopes.
Status: `integrated` on shared staging; business opening/cutover review is pending.
PHASE7_INTEGRATION.md is the current guide and supersedes earlier pending
integration statements; phase-specific facts below retain their original scope.

Current scope: named financial accounts, versioned presentation edits,
archive/restore, independently approved opening balances, immediate internal
transfers, immutable balanced journals, attributed reversals, activity and
explicit grant/account-scope checks, durable classified payables, independent
approval, partial settlement/reversal and private supporting attachments.
Phase 4 adds certified Finance-owned source adapters/posting, independent
manual other-income/funding approvals, reviewed settlement mappings, itemized
cutover certification and reconciliation exceptions. React page and APIRouter
are exported. All six workspaces are enabled under one parent. Phase 6 adds
Overview, Financial Reports and Subscriber Growth screens, interactive evidence
charts, record search/filter/pagination, readable coverage states and authorized
CSV/print output. See PHASE6_INTERFACE.md for the current handoff.
Five Finance SQL definitions are registered/applied through the shared runner
(twenty-four tables). App-shell routes/navigation, shared Access/auth/audit,
metrics and authorized source/report/reference providers are wired. No source
financial posting runs before a reviewed active cutover.

## Layout and entry points

- Frontend: exported `web/FinancePage.jsx`, scoped `web/finance.css`, exact-money
  retry client `web/financeApi.mjs`, `web/ExpensesPayables.jsx`, accessible
  `web/FinanceDialog.jsx`, `web/expenseEvidence.mjs`, `web/IncomeCollections.jsx`,
  `web/incomeClient.mjs`, `web/index.mjs`, `web/FinanceReports.jsx`,
  `web/FinanceCharts.jsx`, `web/FinanceRecords.jsx`, `web/reportClient.mjs` and
  `web/tests/`.
- API package: `api/finance`; `router.py`, `schemas.py`, `permissions.py`,
  `ledger.py`, `storage.py`, `memory.py`, `payables.py`, `expense_schemas.py`,
  `payable_storage.py`, `income.py`, `income_schemas.py`, `income_controls.py`,
  `income_storage.py`, `source_adapters.py`, `reporting.py`, `report_schemas.py`,
  `report_storage.py`, `report_adapters.py`, `report_exports.py`, `migrations.py` plus `access.py`, `integration.py` and five ordered
  module-owned SQL definitions.
- Routes: `/finance` with workspace deep links and `/api/finance`, live on staging.
- `README.md` contains research references, workflow/state proposals, the
  feature connection matrix, reporting rules, and integration boundaries.
- `IMPLEMENTATION_SPEC.md` is the detailed design: six workspaces, relational
  model, workflow states, permission matrix, formulas, special accounting
  treatment, ISP categories and completeness/recognition policies.
- `SOURCE_CONTRACTS.md` separates verified current source contracts from proposed
  immutable feeds/adapters and documents each source owner's prerequisites.
- `IMPLEMENTATION_PLAN.md` records Phase 2–6 delivery and remaining recognition/integration work, internal
  files/API families, integration responsibilities and acceptance gates.
- `PHASE2_INTEGRATION.md` records the foundation contract. Current expense
  APIs, permissions, private evidence/retention, migration handoff and tests
  are in `PHASE3_EXPENSES_PAYABLES.md`; it takes precedence where Phase 2 changed.
- `module.json` displays Finance Management, references design/integration docs
  and migration exports, and records six labels/workspaces, workspace routes and `integrated=true`.

- `PHASE4_INCOME_COLLECTIONS.md` is the current API/provider/accounting handoff;
  `HISTORICAL_IMPORT_PLAN.md` is the certified import plan. Later phase guides
  take precedence where earlier-phase defaults/schema counts changed.

- `PHASE5_REPORTING.md` is the current reporting/permissions/provider guide.
  The default router service is ReportingService; earlier phase defaults/table
  counts below are historical. The Phase 5 schema had four migrations/nineteen tables; Phase 7 adds five tables.

## Phase 2 lasting implementation facts

- Kinds: CASH, PETTY_CASH, COMPANY_GCASH, BANK, COLLECTOR_CASH, COLLECTOR_GCASH,
  CREDIT_CARD, GENERAL_LEDGER. Financial accounts are assets except card
  liabilities; general-ledger accounts explicitly select their class.
  Collector kinds require a custodian. Personal collector GCash is due from
  collector, excluded from controlled cash. Payment methods never identify an
  actual account. Card balances are credit-normal amounts owed.
- Unique permanent account codes include archived rows. Code/kind/classification
  are immutable; editable name/custodian/notes require version. Zero-balance
  archive preserves all evidence, restore is explicit. Archived accounts cannot
  accept a new journal or reversal. No delete route/database deletion is allowed.
- PHP Decimal/string values and NUMERIC(18,2) lines; float/nonfinite/fractional
  cents rejected. Effective dates Asia/Manila; timestamps UTC; no future posts.
  Every affected historic daily financial-account balance must remain nonnegative;
  no overdrafts or card overpayments. General-ledger controls can have signed
  balances. Activity ordering is by date then journal number, not bank intraday
  settlement time.
- Opening DRAFT -> independently APPROVED -> POSTED, with creator/approver,
  optional approver amount limit, evidence/date/reason. Balanced counterpart is
  fixed opening-equity control, excluded from current cash flow and profit.
  One unreversed opening per account; correction uses a linked reversal and
  reviewed replacement. Later-date opening reversals need manual correction,
  not another historic opening. Zero accounts need no opening journal.
- Transfers settle immediately: debit destination / credit source; no income or
  expense lines. Card funding increases liability; card settlement reduces it.
  Noncash methods require evidence reference; fees/interest separate journals.
  Delayed/transit settlements and reconciliation are future work.
- Balanced journals need >=2 distinct accounts and exactly one positive side
  per line. Assembly/sealing, operation evidence, audit and state changes are
  transactional. Deferred DB constraints reject invalid committed entries.
  Sealed headers/lines and audit/idempotency events cannot be changed/deleted.
  Reversals retain the original, offset it, record actor/reason/date, are unique,
  cannot predate it, and cannot themselves be reversed.
- Required stable Idempotency-Key per mutation plus unique source namespace/ref
  with canonical payload hashes; exact retries replay, different payloads 409.
  Foundation namespaces finance.manual/transfer/opening/reversal. Scoped replay checks
  current permissions/account IDs; shared control aggregate hidden from scopes.
- PostgresStore defaults to shared DATABASE_URL, existing psycopg, no automatic
  DDL or memory fallback. Missing auth provider/driver/config/schema fails closed
  with 503. Explicit MemoryStore is test-only with realDataReady=false.
  Finance writer advisory lock serializes posting, replay and archival; read
  shared locks give coherent views. Current repository loads full journal history;
  pagination/SQL aggregation are later scale work.
- Local migrations.MIGRATIONS export matches shared runner structure; foundation ID
  2026101201_finance_foundation, six finance_* tables, immutable triggers,
  relational lines/approval/source keys and opening-equity control seed only.
  No customer/source tables or demo rows. Shared runner registration/copy paths,
  checksums, permissions/auth adapter, Logs and backup/identity-sequence coverage
  are explicitly deferred, detailed in PHASE2_INTEGRATION.md.
- configure_finance requires a trusted current Actor provider. Explicit local
  grants include finance.opening-balances.approve separately from .post. No
  implicit finance_officer/admin role bypass, source permission bypass or shared
  grant seed. All non-control lines must be in scope for full journal views.
- Foundation UI implements account/opening/transfer/journal forms and history.
  Frozen username-scoped localStorage payload/key
  persists uncertain writes for exact retry; denied storage prevents writes.
  No local login system or fake source/report data. Live shell/modal accessibility
  and multi-tab behavior remain integration verification.

## Phase 3 lasting implementation facts

- Payees/suppliers and expense categories have unique permanent codes, versioned
  edits and archival without deletion. Category classification/account mapping
  is immutable. The migration seeds eight ISP categories and four recognition
  GL accounts plus a fixed nonspendable `finance-payable-control` liability;
  these are configuration, not sample balances or transactions.
- Payables store supplier/document reference, document/expense/due dates, exact
  amount, purpose, optional location/project/item-or-asset references, immutable
  catalog snapshots and attributed creator/financial-editor/version. Supplier
  document references remain unique even after reversal. One amount/category
  per document; no invented tax, quantity or historical cost allocation.
- Approval DRAFT -> SUBMITTED -> APPROVED or REJECTED is independent of posting
  UNPOSTED/POSTED/REVERSED and derived settlement UNPAID/PARTIALLY_PAID/PAID.
  Submitted/approved financial fields and evidence are frozen until explicit
  unposted reopen; posted financial fields cannot change. Approval decisions
  retain actor/time/reason/version/evidence fingerprint; rejection needs a reason.
  Creator and last financial/evidence editor cannot approve or reject their
  own document, including wildcard actors. Approver amount limits apply.
- Submission/approval needs private evidence or an external evidence reference;
  absent evidence requires explicit finance.expenses.evidence.override and
  an attributed reason, including for the independent approver. Reopened
  documents require a new review. Approval never posts accounting automatically.
- Recognition debits OPERATING_EXPENSE or DIRECT_COST expense GL, or debits an
  INVENTORY_PURCHASE/ASSET asset GL, and credits payable control. Settlement
  debits that liability and credits the selected cash/custody/bank/wallet asset
  or credit-card liability. Paying an existing payable creates no second cost;
  card settlement moves vendor debt to card debt and is not controlled cash flow.
  Depreciation, stock issues/COGS, loan principal and advance allocation are later
  workflows, not implied by purchase or payment.
- Partial payments have stable source references and exact idempotent payloads.
  Same-key/same-source retries cannot pay twice; conflicting payloads return 409.
  Dates cannot precede recognition or be future. Funding account/method/reference,
  current funds and every affected daily payable balance are checked atomically.
  Finance's PostgreSQL advisory writer lock covers document versions, approval,
  recognition, payment, reversals, funds and account archival across workers.
- Reversal keeps original journal/payment/evidence immutable. Payment reversal
  reopens the amount owed; recognition reversal requires every payment reversed
  and cannot produce a historically negative payable. Generic journal posting
  cannot use payable control; generic reversal cannot bypass the payable workflow.
- Explicit finance.expenses.* and finance.attachments.* grants are enforced
  server-side. View allows own documents; view_all is required for others even
  with approval/post/payment grants. Actor.expense_ids optionally constrains
  document IDs, account_ids constrains recognition GL/funding accounts and
  approval_limit constrains approvals. Exact replays check current document/GL
  scope. Full linked journal reads check expense visibility; account activity
  still exposes that permitted account's movements/reasons under account-view
  permission. Shared Access does not yet seed these grants.
- Private attachments are bounded PDF/PNG/JPEG JSON uploads: 2 MiB decoded,
  2,800,000-byte streamed request maximum, ten retained versions per document.
  Extension/type/signature, safe filename and SHA-256 are checked; bytes remain
  private PostgreSQL BYTEA, never audit/replay JSON or public filesystem URLs.
  Authenticated downloads recheck document/account/attachment permissions,
  audit access and force no-store attachment disposition/nosniff/sandbox.
  Format checks do not sanitize untrusted files; there is no inline preview.
- Draft/rejected evidence retirement is attributed and preserves bytes/hash and
  previous approval evidence. There is no purge/delete/automatic expiry; formal
  retention/legal-hold and controlled backup/purge policy require separate work.
  Database backups must retain private BYTEA/TOAST, immutable history and sequence
  state. Browser pending uploads retain exact bytes per username; denied storage
  prevents sending and privacy/quota handling needs shared-device integration.
- Migration 2026101202_finance_payables adds six tables, guards, payable numbering,
  classified GL seeds and categories. Phase 2 SQL is unchanged. Both definitions
  are exported in order, not registered/applied to the application schema;
  readiness now requires all twelve tables. Direct SQL guards protect approval
  state/version, independent reviewer, classification, linked control postings,
  payment amounts/dates, immutable payments/decisions/evidence and daily balances.
- Expense/payee/category forms, review decisions, recognition, partial funding,
  linked reversals and authorized evidence downloads are module-local. Successful
  mutations refresh both workspaces. Client retries preserve immutable money/
  bytes/key across reload; HTTP staging uses cryptographic UUID fallback.
  UI grants aid navigation; authorization always remains on the server.

## Phase 4 lasting implementation facts

- Default router selects `IncomeService`, extending `PayablesService`.
  `configure_finance(current_actor, store=..., source_providers=...)` explicitly
  injects trusted certified providers; missing providers return 503. There is no
  default list polling, live source integration, subscriber receipt mutation
  or operational subscriber ledger. `FeedRequest`/`SourceBatch` v1 includes
  snapshot, cursor, coverage, effective dates, original identities/version and
  authoritative operation evidence. Client sync accepts only a bounded limit.
- Billing owns all subscriber receipts even when collected through POS/Collector.
  Those modules supply canonical links with zero collection effects. Billing
  invoices post AR/deferred consideration; retained receipts post named funds
  versus allocation AR/customer credit, never earned subscription revenue.
  Advance/rebate applications and deferred promotions are noncash. EARNED/UNKNOWN
  rebates require delivered-service recognition evidence; no invented profit allocation.
- Delivered POS register sales separate gross line price, line/sale discounts,
  tax and receivable; POS retained payments settle it once. Tender/change is not
  retained money. No historical COGS from current unitCost. Service installation
  references, fee decisions and migration references create no journal income.
- Collector Cash/GCash custody uses actual named, custodian-matched accounts.
  Remittance checks each canonical receipt once per leg, moves expected custody
  to actual company funds and parks any difference in signed variance clearing.
  It creates no new receipt/income/expense. Acknowledgment leaves classification
  unresolved; later variance disposition requires an explicitly assigned workflow.
- Twelve new grants are in `permissions.py`: income view/view_all/create/approve/
  post/reverse, source sync, settlement manage/approve, cutover manage/approve
  and reconciliation acknowledgment. Unrestricted account/document scope is
  required for certified sync/cutover. Source/evidence reads require view_all
  and every affected account (including controls); unknown scopes are hidden
  from scoped actors. Replays recheck current grants/scopes before returning.
- Manual inflows have immutable financial/evidence intake and DRAFT/SUBMITTED/
  APPROVED/REJECTED/POSTED/REVERSED history. Creator cannot approve/reject even
  with wildcard rights; income approver limits apply. OTHER_INCOME uses revenue;
  LOAN_PROCEEDS/OWNER_LOAN liabilities and OWNER_FUNDING equity are financing,
  not revenue. Mandatory external evidence references stay under the source's
  access/retention boundary; private Phase 3 attachments retain their own controls.
  Generic manual fund inflows and protected source controls cannot bypass these
  approval rules. Source/manual journals require their linked reversal paths.
- Effective-dated settlement identities are channel/operator/method/institution;
  reviewed mappings cannot overlap and retirement affects future dates only.
  Mapping is to a real named asset account, never payment method or card debt.
  GATEWAY requires a later settlement contract. Original results retain exact
  map IDs/account IDs; a later mapping never rewrites financial evidence.
- Append-only inbox/results/permanent claims and transactional checkpoints use
  per-source snapshot/cursor compare-and-set. Fetch happens outside the Finance
  writer lock; posting and audit are atomic. Savepoints isolate staged exceptions
  without half journals; dependency passes handle out-of-order events. A cursor
  advances only when its entire page is finalized. Conflicting fingerprints
  cannot be overwritten. Same-key uncertain retries replay; after correcting a
  blocking dependency a fresh sync key reprocesses the unchanged evidence.
- Economic duplicate versions link the original without money. Source reversal
  resolves such aliases to the one canonical effect. Full refund uses certified
  actual date/account, retains gross collections and separately records refund;
  remitted custody can refund from company funds. Duplicate-no-funds cancels
  original-day unremitted evidence. Credit consumption must reverse first.
  Partial refunds and pre-cutover refund entitlement/payout remain unsupported
  until source-owned contracts exist; VOID/review timestamps are not money dates.
- Cutover supports only OPENING_THEN_FORWARD: through C−1 reviewed financial
  holdings, itemized invoice/POS AR, original unused credits, deferred consideration
  and exact held receipt custody; four source snapshot certifications required.
  Independent approval/activation recheck journal/account fingerprints. It opens
  only obligation controls against equity, never funds again. All old events
  become evidence; forward financial posts cannot predate C or reopen certified
  funds. Fully paid deferred invoices may have zero AR. No historical import
  or application migration was executed; use HISTORICAL_IMPORT_PLAN.md.
- Migration 2026101203_finance_income adds six tables: income_documents,
  source_events, source_results, source_claims, source_checkpoints and
  reconciliation_exceptions (all finance_ prefixed), plus eight zero source GL
  controls. All three ordered definitions/eighteen tables are needed. Phase 2/3
  SQL files are unchanged. Deferred linked-entry, independent approval, immutable
  evidence, overlap, baseline/cursor and dated itemized obligations guards are
  tested directly. No shared runner registration/DDL, demo financial evidence
  or source-owner schema change was made.
- Income UI offers source evidence, classified manual income/funding, reviewed
  mappings, exceptions and human-readable cutover rows; provider/unavailable
  states remain explicit. It uses existing focus-safe dialogs, exact dates/cents
  and frozen username-scoped request keys. Full finance report completeness is
  always false for the source-effects view; it is not a profit report.

## Phase 5 lasting implementation facts

- ReportingService extends IncomeService; configure_finance also accepts explicit
  report_providers for subscribers, billing-settlement, billing-receivables and
  financial-coverage. No default live provider/current-list history inference.
  New GET /reports/{kind} APIs cover cash-flow, profit-and-loss, expenses,
  receivables/payables, reconciliation, collections and paginated transactions;
  subscribers, billing-settlement and matching-window comparison have explicit
  routes. POST /reports/evidence/{kind}/sync accepts only month/asOf, never records.
- Aggregate financial reports require reports.financial.view and existing full
  accounts/journals/expense/income read grants. Subscriber/Billing analytics uses
  reports.subscribers.view; source sync additionally reports.evidence.sync.
  Both require unrestricted account/document scope. Current authority is rechecked
  on replay. Subscriber receipt detail excludes POS register/private financial data.
- Exact Decimal/string sums, Asia/Manila month/effective dates, UTC generatedAt,
  documented policy version and current posted knowledge boundary. AR/AP are
  all-period asOf balances; cash/profit/expenses/receipts are selected-period flows.
  Opening entries inside a window are disclosed baseline adjustments; opening +
  adjustments + movement equals closing. Archived evidence remains included.
- Controlled cash excludes cards and personal-GCash due; internal eligible legs
  cancel. Remittance creates no income/receipt. Card principal/funding, loans,
  owner funds and interest cash are financing; capex investing, stock purchases
  operating. Unclassified cash movements remain visible. No invoice/payment
  shortcut to earned revenue; billed service remains deferred until supported
  recognition entries. Approved OTHER_INCOME is nonoperating income.
- P&L separates revenue/contra/direct/OPEX/financing/nonoperating/tax. Interest and
  tax category codes classify below operating profit; assets/inventory are not
  expense recognition. Unknown GL costs appear UNASSIGNED in expense grouping
  and unclassified in P&L. SETTLED uses payable payments/card funding, with actual
  cashPaidTotal separate. Historical AP/expense queries use dated journals even
  if a document is now reversed; partial settlements tie to payable control.
- Missing coverage labels recorded components provisional and dependent profit
  subtotals null/UNAVAILABLE, with recordedValue for incomplete arithmetic.
  Explicit independent source/Finance coverage certification binds exact window,
  policy and journal/account/exception fingerprint. Later evidence invalidates
  it; unclassified P&L or unresolved exceptions still block complete net profit.
  Opaque Phase 4 completeThrough markers are never treated as coverage dates.
  Recognition schedules, cost layers, depreciation/tax accrual automation and
  historical closed-report revisions remain outside the assigned API scope.
- Subscriber projections replay certified baseline and dated Service lifecycle/
  ownership/Billing rate effects; before-state, identity and overlapping history
  are validated, immutable snapshots retained. ACTIVE/PENDING_DISCONNECTION form
  the connected set; customers are distinct owners, lines distinct account IDs.
  Imports use a separate baseline adjustment, not new activation. Terminating
  already disconnected lines creates no extra active exit; repeated real reentry
  events remain distinct. Both line and customer bridges expose zero variance.
- MRR is certified closing billable-line monthly-normalized rates, independent
  of cash/earned revenue and active state. Missing dated coverage/rates returns
  null. A closing-only census can support closing counts but not historic growth.
  New subscribers, ownership changes and existing customer extra lines remain
  distinct. Billing receipt-month payer counts and selected bill-month full/
  partial/unpaid cohort settlement are separate, with credits noncash and rebate
  breakdowns not double-deducted. Missing payer evidence is null with recorded zero.
- BillingReportAdapter maps actual source billedAmount/month/asOf arithmetic,
  requires whole consistent cohort and stable invoice/line IDs, strips contacts,
  and checks all source totals/statuses. Current Billing pagination is not a full
  feed. Service still needs certified census/lifecycle/ownership history and
  Billing dated billability/rate exports; provider authorization remains source-owned.
- Comparisons use complete calendar months or equal elapsed MTD windows capped
  to the shorter month; same basis/group and compatible completeness required.
  Changes divide by absolute prior; zero prior is N/A. Missing history stays null.
  Transaction pagination totals cover the entire matching period/account row set.
- Migration 2026101204_finance_reports adds one immutable finance_report_snapshots
  table (four definitions/nineteen tables total); earlier SQL unchanged. New
  snapshots, operation evidence and audit commit atomically. Private test schemas
  verify rollback, identity guards and update/delete rejection. No application/
  public migrations, shared provider/shell wiring, runtime changes or production.


## Phase 6 interface and output decisions

- All six workspaces live under FinancePage, with exported index.mjs parent and
  reusable components. Shared Tabler styles/container-xl gutters; scoped styles,
  responsive grids/tables and wrapping controls. No app-shell/navigation edits.
- Existing forms preserve named accounts, independent review, immutable posting,
  source ownership, attachment security and frozen per-user retries. Account,
  expense/payee/category and income/source/mapping/exception/cutover lists now have
  search/status/date filters where meaningful and client pagination. Dialogs use
  unique headings/focus trapping and native fetch is bound for actual browsers.
- Overview/financial/subscriber summaries and all five requested charts open the
  supporting records; keyboard controls and accessible chart value tables work.
  Every chart carries its own dates/basis/coverage. Unavailable net profit stays
  null and is not plotted from recordedValue. Cash, earned revenue and MRR retain
  different meanings. Expense trends include all recorded expense classifications.
- Additional read-only API support: monthly-series (one repository snapshot,
  1–12 calendar/partial-final months), CSV and print for ten report kinds, optional
  transactions allRecords, exact opening/closing line and billable rate rows,
  event customer/line projection flags and internal per-account movement rows.
  P&L totalExpenses includes direct/OPEX/nonoperating/financing/tax/unclassified
  expense; assets/inventory excluded. Friendly expense/journal dates and sealed
  account/payee/category names support filters, drill-down, export and print.
- CSV/print separately require reports.export/reports.print plus appropriate
  report read grants and unrestricted account/document scope. Meta exposes only
  the unrestricted-scope boolean for UI gating. Server remains authoritative.
  CSV guards spreadsheet formulas, preserves Decimal strings/null/status/context;
  outputs have requestedBy, generatedAt, no-store/nosniff. All report rows export/
  print independently of screen-only search/status/date filters, explicitly labeled.
- Subscriber summary evidence uses actual membership/rates, deduplicates customers
  and separates migrated baselines from activations. Bill-month settlement remains
  independent of receipt-month payers. Source history/costing/recognition/tax
  completeness is unchanged; missing evidence remains provisional/unavailable.
- No new migration: still four definitions/nineteen required tables. No application
  DDL or financial writes in browser checks. Live source/provider/Access/runner/
  backup/navigation wiring and shared Logs/download audit are integration work.
  Current full-history repositories/full journal export need measured streaming/
  server search limits for large deployments; UI pagination alone does not scale DB.
- Phase 6 verification: 100 local Python, 103 executed PostgreSQL (106 discovered,
  three historical fixture skips), 21 Node, eleven fixture Chromium workflow groups,
  source/CSS transforms and isolated source bundle. Browser runs only on existing
  staging origin 8280 with Finance API interception, real in-memory API fixtures,
  one deliberately rejected partial-payment request, no application writes or page
  errors. All workspaces, keyboard records, output/print, approval restrictions,
  money/account forms, subscriber/cohort distinctions and 390px layout pass.
  This is not live Finance integration. No shared runtime build/restart, production,
  commit/push or root context edit. See PHASE6_INTERFACE.md for reproduction.

## Research and intended functions

Research combines existing shared/module contexts, Graphify architecture leads,
Odoo's expense approval/posting and transfer workflows, cash-flow/profit guidance,
and subscription metrics. The ISP-specific design must account for monthly
Billing, Collector custody/remittance, POS sales, installation charges, and
network inventory/assets.

Planned workspaces: Overview; Accounts & Transfers; Expenses & Payables;
Income & Collections; Financial Reports; Subscriber Growth. Expense approval,
posting, and payment status should be separate. Intended roles include Finance
Officer, authorized approver, owner/management, and read-only auditor, using
shared Access controls and attributed audit events.

## Ownership and future data contracts

Finance should own financial accounts/categories, expenses/payables, transfers,
reconciliation, and source-linked accounting journal entries in shared PostgreSQL.
The foundation implements relational account/journal entities, Decimal PHP,
opening approval/posting, idempotent financial postings and an injected actor
interface. Classified expenses and private evidence are implemented. Source-event
adapters are implemented locally; certified live feeds, recognition schedules
and period closure remain future work. Source-owner review and unresolved accounting policies are
release dependencies before authoritative financial reports.

Billing owns customer receipts, invoices, adjustments, promotions, credits, and
collection-case reporting. POS owns register sales/payments. Collector owns
custody/remittance. Finance must never recreate their receipts or count a POS
invoice collection and its Billing receipt twice. Remittance is a fund movement.

Customer Profiling owns customer identities/current mobiles; Service owns service
lines and activation/lifecycle evidence. Inventory supplies stock/asset and cost
context. Account Access Management supplies optional operational context, while
Ticketing/Customer Service Management may provide expense/job references.
System Settings supplies shared auth/configuration; Logs supplies audit hooks.
Dashboard/Process Flow connections are future integration work.

## Phase 1 lasting design decisions and source findings

- Separate customer collections, controlled cash flow, earned net revenue,
  gross profit, operating profit, pretax result and net profit. Loans/owner
  funding are financing, stock/asset purchases are assets until consumed or
  depreciated, and card principal/expense recognition are separate.
- Retained customer advances create liabilities; later credit applications
  create no cash. Billing promotions/rebates reduce consideration once; actual
  refunds need money-disposition evidence, not merely a source VOID status.
- Held physical collector cash is company cash; personal GCash is due from
  collector until actual company-wallet settlement. Show a collections-to-cash
  timing bridge; remittance never creates another receipt or earned revenue.
- Billing already has canonical as-of receivables and unique-customer monthly
  settlement reports. Reuse their totals/credit semantics. Durable
  billing_posting_events are audit evidence, not a ready Finance event feed.
- POS register sales and payments are distinct from its Billing invoice intake.
  Posted financial/date/customer fields are now immutable; reasoned voids retain
  original values but normal lists omit deleted rows. Historical accounting still
  needs certified originals/corrections/tombstones, not visible-list polling.
  Current PostgreSQL POS/Inventory stock posting is atomic despite an older
  stale POS context risk describing it as in-memory.
- Inventory has current editable unitCost and immutable quantity movements,
  but lacks valued cost layers/issue-time costing. Do not infer historical COGS
  from current unitCost or call an assignment a consumption automatically.
- Service stores current/latest lifecycle dates, not complete effective history.
  Imported activation may fall back to cutover; imported suspension dates can
  be cutover markers. Historical growth/churn/MRR require certified baselines
  plus source-owned lifecycle/ownership and Billing rate history.
- Initial timezone Asia/Manila and currency PHP. All reports carry basis,
  knowledge cutoff, coverage/watermarks, policy/version and per-metric
  COMPLETE/PROVISIONAL/UNAVAILABLE/NOT_APPLICABLE status. Missing values are null.
- Phase 7 seeds finance.* grants in shared Access;
  existing Collector Finance permissions remain separate. No opening creator
  self-approval, including for actors with wildcard grants.
- Future phase order: foundations/accounts/transfers; expenses/payables;
  source-linked income/custody; recognition/costing/reports; subscriber growth;
  integration verification/release readiness. Each needs user phase instructions.

## Reporting boundaries and risks

- Cash flow and earned profit are separate; loan funding, transfers, customer
  advances, credit-card liabilities, assets, and inventory require classification.
- Define direct costs, operating expenses, recognition, depreciation, interest,
  and tax treatment before labeling a complete report as net profit.
- Show receipts received in a month separately from settlement of that month's
  bills. Preserve source handling of voids, refunds, partial payments, promotion
  credits, advance applications, rebates, and reference-only legacy evidence.
- Report unique customers and service lines separately; migrated existing
  profiles are not new activations. Reliable past growth needs dated lifecycle
  events/snapshots; do not infer unavailable history from current state.
- Account opening balances, reconciliation, period closure, supporting evidence,
  shared timezone, and equal-window comparisons are required design decisions.
- Complete accounting-report coverage, bank feeds, payroll, tax filing, forecasts,
  controlled attachment purge/hold policy remain
  future work. Multi-line documents, taxes, advances/prepayments, credit notes,
  inventory costing/quantity synchronization and period closure are broader
  design work outside the assigned Phase 3 scope.

## Integration and verification

Integration Codex owns shared page/router wiring, migration registration,
auth/grant injection, Logs/backup and shared staging review. Foundation exports
and local migration definitions are ready for that separately assigned work.
This phase changes no shared behavior and requires no runtime rebuild.
Root `Project_Context.md` is intentionally unchanged for this module-local setup.

Phase 5 verification: 24 foundation + 21 expense/API + 25 income/adapter/API +
22 reporting/adapter/API Python tests, 97 executed PostgreSQL tests (100 discovered,
three inherited fixture skips) and 14 Node tests pass. Eight unchanged frontend
static transforms pass. Commands and private PostgreSQL fixture boundaries are
in PHASE5_REPORTING.md. Regressions cover
partial payments, duplicate requests, authorization, self-approval, rollback,
reversals, secure attachment access and direct SQL guards. Dedicated separate-
connection PostgreSQL tests cover duplicate recognition/settlement, competing
payments/transfers, payment/account-archival races, same-key source sync and
competing source-checkpoint workers. Their committed fixtures
use only private generated test namespaces, which are removed and checked absent;
ordinary database cases roll back their private schemas. No application/public
schema migration, live UI/shell verification, build/restart or production action
was performed. Existing shared working-tree changes belong to other sessions;
no commit/push. Integration must still review shared auth/grants and live browser
behavior. FINANCE_TEST_DATABASE_URL is the opt-in test DSN, never logged.

Host Graphify uses code-only extraction; semantic design docs remain outside its
indexing path. Consult module docs directly for design contracts. Refresh with
`graphify update .` after durable changes; source extraction warnings/zero-node
sources are leads, not proof that a documented feature is absent.
Generated Graphify artifacts remain ignored and no application dependency,
Git hook, service or runtime introspection is added.

## Phase 7 shared integration (2026-10-12)

- Current handoff: PHASE7_INTEGRATION.md. App-shell registers /finance and /api/finance; one parent contains six deep-linked workspaces. API Docker copies Finance; shared metrics include accounts, journals, payables and exceptions.
- Shared current-session Actor, explicit Access permissions/role scopes/approval limits and durable Finance audit with shared Logs mirror are active. Existing custom Finance Officer roles and Collector behavior are preserved; independent review is never bypassed by owner.
- Five module-owned migrations create twenty-four tables. Immutable, contact-redacted source capture commits atomically with Billing/POS/Collector/Service mutations. A transactional counter protects cursor visibility order; baseline rows are evidence only. Forward posting retries every thirty seconds after active reviewed cutover. Missing evidence/mappings/corrections visibly hold cursors.
- Owner providers live in each source module's finance_provider.py. Billing owns receipts/cohorts/AR; POS aliases canonical Billing invoice collections; Collector owns custody/movement evidence; Service/Billing captured changes supply lifecycle/rates. Customer Profiling/Inventory supply authorized minimal references; current unit cost never supplies historical COGS.
- GET integration/status, GET integration/cutover-preview, POST integration/recover are available with explicit grants/unrestricted scopes. Native Billing/POS/Collector recovery attestations require source edit/confirmation authority and reject inconsistent evidence before immutable storage.
- Source itemized AR/advance/rebate/custody controls must match at cutover creation/activation; core controls tie funds, deferred service obligations and named custody balances to approved openings. No historical receipts are posted as fresh money. First boundary follows the capture day; real holdings and independent approval are pending, not fabricated.
- Subscriber baseline freezes first completed captured Manila day (capture began 2026-10-12; baseline available 2026-10-13). First-day sync returns 409 with no snapshot. Earlier history and midmonth opening/growth remain unavailable; migration is not new activation. MRR follows dated Billing billability separately from active Service census.
- Live JSON full restore is guarded after capture; use a separately verified cold PostgreSQL archive restore preserving ledger, outbox, migrations/functions/sequences and attachments. Shared exports are repeatable-read snapshots. No retention purge introduced.
- Verification: full Finance suite 225 cases, 222 passed/3 inherited skips, including actual private PostgreSQL posting/rollback and source lifecycle/cutover controls; 6 shared auth/metrics tests and 5 Dashboard regressions; 25 Finance/portal client tests. Actual staging health/migrations, reports/references, Billing cohort/AR refresh, CSV/print verified. A protected pre-integration DB archive is recorded in PHASE7_INTEGRATION.md.
- Financial coverage is provisional: actual service delivery, valued inventory consumption, depreciation/financing/tax evidence and reviewed accounting setup remain prerequisites. No production deployment.

- Actual shared-origin browser harness: web/tests/financeIntegration.browser.mjs, requiring an existing protected staging token file and host Playwright path. Six deep links, canceled account/expense/income forms, cutover source-sync gate, CSV/print, unavailable history and 390px overflow pass with zero page errors/rejected Finance requests/financial writes. Shared Dashboard/module metrics now filter explicit Finance grants and suppress company counts for restricted scopes.


## Phase 8 — reconciliation and staging readiness (2026-10-12)

The end-to-end readiness review and operational instructions are in `PHASE8_READINESS.md`. All six workspaces are integrated in staging. Accounting setup is **not activated**: no invented company funds, cutover, source receipts or financial journals were created during review. Staging verification uses the existing shared `threejmain-staging` stack on 8280/8200 only; production remains untouched.

The review found and implemented the missing period controls. `/api/finance/periods` lists month states; `/{month}` returns current reconciliation and immutable revision history; `/{month}/prepare`, `/close`, `/reopen` require exact request keys, versions, explicit grants, whole-company financial/subscriber read scope and attributed reasons/evidence. Only completed Manila calendar months can be prepared. Preparing changes OPEN to CLOSING and blocks new dated journals/reversals through both the accounting service and PostgreSQL. Closing requires a different authorized reviewer, complete exact ledger coverage, tied AR/AP/trial/cash controls, no unresolved exceptions, and a reviewed full-month source cutover with consumed durable cursors. Changed evidence requires reopen/reprepare. Reopening preserves closed reports and revision evidence; corrections are new attributed journal entries. Full-month/month-end APIs, charts, CSV and print use the closed publication; later as-of settlement queries remain separately dated live reports. A superseding close creates another retained revision. Older publication bytes are available in authorized period detail history; the UI audit trail lists retained revisions but does not offer an older-version export selector.

`READINESS_MIGRATIONS` adds `2026101206_finance_periods` after the existing four base migrations and integration tail. Shared registration applies six checksum-checked migrations, 26 Finance tables. PostgreSQL immutable period events and posting guards are enforced independently of browser controls. Private rollback fixtures apply base+readiness; integration fixtures apply base+integration+readiness. Never edit applied SQL.

`finance.periods.view/prepare/close/reopen` are registered through shared Access. Stock Finance Officer can prepare; independent Finance Approver can close/reopen; management/auditor can inspect. Owner cannot self-close. Exact unchanged phase-7 built-in role grants are upgraded; customized and other roles remain intact. Period controls and checklist appear in Financial Reports. Native Billing/POS source attestations check their current edit grants independently of Finance authority.

Verified controlled fixture totals: opening funds 1,000.00; final controlled cash 1,142.00; card liability 0.00 after purchase/repayment; payables 0.00 after partial/final settlement; recognized direct/operating expenses 50.00; retained customer advance 20.00; actual subscriber refund 120.00. Canonical Billing aliases and Collector remittance do not add another collection or earned revenue; journal debits/credits and report bridges tie. Historical lifecycle fixtures reconcile multiple service lines per customer, migration baseline adjustments, reactivations, suspensions, disconnections, terminations, ownership changes, dated rates, and unavailable opening history.

Business readiness remains conditional on independently reviewed real opening balances/cutover, actual named settlement mappings, and trusted financial coverage providers. The current shared coverage provider intentionally cannot certify earned service delivery, dated inventory COGS, depreciation, financing or tax completeness. Live staging correctly rejects a historical close (409) with those missing dependencies and retains no period record. Earlier subscriber growth remains unavailable; the first complete capture-day census becomes available on 2026-10-13. The detailed test counts, backup boundaries, attachment retention and recovery procedure are recorded in the readiness handoff.
