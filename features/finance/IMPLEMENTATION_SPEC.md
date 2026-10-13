# Finance Management implementation specification

Phase 1 design, reviewed 2026-10-12. Phase 2 now implements the module-local
accounting foundation described in [PHASE2_INTEGRATION.md](PHASE2_INTEGRATION.md).
Phase 3 implements Expenses & Payables as detailed in
[PHASE3_EXPENSES_PAYABLES.md](PHASE3_EXPENSES_PAYABLES.md). Phase 4 implements
Income & Collections as detailed in [PHASE4_INCOME_COLLECTIONS.md](PHASE4_INCOME_COLLECTIONS.md),
with the safe boundary in [HISTORICAL_IMPORT_PLAN.md](HISTORICAL_IMPORT_PLAN.md). Phase 5
implements reporting/subscriber APIs under [PHASE5_REPORTING.md](PHASE5_REPORTING.md).
Missing recognition/costing/history remains explicitly unavailable or provisional. This document
specifies the complete intended behavior; later workspaces and
shared integrations remain pending. Source facts and proposed
contracts are separated in [SOURCE_CONTRACTS.md](SOURCE_CONTRACTS.md); delivery
order and acceptance criteria are in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## 1. Product boundary and decisions

Finance Management gives Finance Officers and management an attributed view of
money, obligations, earned results, and subscriber performance. Use `/finance`
and `/api/finance`, the shared React/Vite/Tabler shell, shared authentication,
and the existing PostgreSQL database. PHP is the initial reporting currency;
multi-currency, bank feeds, payroll calculation, statutory statements, tax
filing, and forecasting are outside the initial release.

Finance owns named financial accounts, accounting categories/policies, payees,
expenses/payables, vendor payments, transfers, reconciliations, accounting
journals, recognition schedules, period controls, and derived reports. It owns
neither customer receipts nor operational stock/lifecycle records. Billing
owns invoices, allocations, credits and customer debt; POS owns register sales
and register payments; Collector owns field custody/remittance; Service owns
lines and lifecycle; Customer Profiling owns identity/current contact; Inventory
owns items, quantities, assignments and physical movements.

First-release decisions:

- Maintain a balanced accrual journal plus a separately classified money ledger.
  A receipt, an invoice, and earned revenue are different events.
- A source event may produce multiple journal lines but has one canonical
  posting identity. POS invoice collections enter Finance through Billing once.
- Collectors' held physical company cash is a cash subaccount. Personal GCash
  custody is a due-from-collector asset, not spendable company wallet cash.
- Use Asia/Manila, consistent with Billing; store instants in UTC and explicit
  business dates. Separate effective date, source posting time, ingestion time,
  recognition period and actual funds-settlement date.
- Decimal amounts in PHP with two decimal places; API money as decimal strings,
  database `NUMERIC(18,2)`, calculations with Decimal. Carry source-rounded
  invoice/promotion/rebate amounts unchanged. Never recalculate Billing's
  whole-peso proration or rebate rules inside Finance.
- No hard deletion of posted records. Reverse with links, reason, actor and
  date; retain original evidence. Archive only unused/draft master records.
- Missing historical/costing evidence is missing data, never zero. Unclassified
  money goes to an exception/clearing account and blocks a complete profit report.

## 2. Six workspaces

| Workspace | User actions and contents | First usable result / gate |
| --- | --- | --- |
| Overview | Select period/as-of; see customer collections, controlled cash, collector funds due, receivables, payables due, earned revenue, profit ladder and exceptions; drill into source rows. | Show supported metrics independently; unavailable profit/history cards say why. No fabricated aggregate profit. |
| Accounts & Transfers | Manage cash drawers, petty cash, company wallets/banks, custody, clearing and liability accounts; opening balances; outgoing/incoming transfer legs; account activity; statement matching and variances. | An account must have a reviewed opening balance and complete movement coverage before its balance is authoritative. |
| Expenses & Payables | Draft/submit expenses or bills, attach/reference evidence, approve/reject, post, record partial vendor payments or reimbursements, review aging and reverse mistakes. | Approval, accounting posting, and actual payment remain separate. Capital/inventory purchases use this intake with asset classification. |
| Income & Collections | Read source-linked Billing/POS collections, allocation/advance/credit distinctions and Collector custody; classify non-customer income/funding; investigate unmatched receipts/refunds. | Customer actions link back to Billing/POS/Collector; Finance never recreates their receipts. |
| Financial Reports | Cash flow, earned-revenue schedule, profit and loss ladder, trial balance, account ledger, receivable/payable aging, expense ranking and equivalent-period comparisons; CSV exports. | Each report includes basis, coverage, completeness, formula version and source drill-down; missing inputs block dependent subtotals. |
| Subscriber Growth | Unique customers versus internet lines; first activations, reconnections, active-base bridge, suspensions, disconnections/terminations, MRR and bill-settlement cohorts. | Current snapshot is available first; historical transitions/MRR require certified history and dated rates. |

Use six tabs under one module entry, with deep links
`/finance?workspace=overview|accounts-and-transfers|expenses-and-payables|income-and-collections|financial-reports|subscriber-growth`.
FinancePage composes module-owned components; shared gutters, responsive tables,
filters, pending/loading/error states, accessible dialogs and authorized actions
follow existing shell conventions. Long approval/detail forms keep actions
visible. Confirm posting/reversal with an amount/account preview. Never default
a discrepant remittance to accepted, or display implementation details in user
flows. A graph/chart and its export must link to the same underlying rows.

## 3. Proposed durable model

Use relational `finance_*` tables in the shared database. Names below are design
targets; migrations are deferred to an authorized implementation/integration
phase. JSONB holds source evidence and policy snapshots, not the only accounting
constraints. Use UUID IDs, database-backed document sequences, UTC timestamps,
actor IDs/usernames, effective dates and optimistic `version` on editable rows.
Master data archive preserves referenced rows. External IDs remain references
to source-owned JSONB records; do not invent SQL foreign keys into JSON payloads.

| Entity / target table | Required fields and relationships |
| --- | --- |
| Account / `finance_accounts` | unique code, name, GL type `ASSET/LIABILITY/EQUITY/REVENUE/CONTRA_REVENUE/EXPENSE`, subtype, normal debit/credit side, PHP, custodian, optional masked institution/reference, active flag, controlled-cash eligibility, restrictions, report group, permitted negative balance policy. Financial instrument/drawer accounts link to GL leaves. |
| Policy/category / `finance_categories`, `finance_policy_versions` | code, label, GL mapping, direct-cost/operating/nonoperating/capital/inventory class, cash-flow class, default cost center, evidence requirement, allocation/recognition rule; immutable effective-dated policy versions. Separate spend purpose from accounting destination. |
| Payee / `finance_payees` | name, supplier/employee/owner/lender type, active flag, optional contact and masked payment instructions; duplicate identity checks. No customer mobile mirrors. |
| Expense/payable / `finance_payables`, `finance_payable_lines` | number, payee, supplier document number, document/recognition/due dates, currency, line quantity/cost/discount/tax, net/gross totals, category, optional location/project/Service Order/Ticket/item/asset references, evidence IDs, approval/posting states, version, approval history. Payable balance is derived from journaled settlements/credits. |
| Approval event / `finance_approval_events` | document/version, action, actor, timestamp, limit/policy snapshot, reason; append-only. Creator and approver identities kept separately. |
| Vendor settlement / `finance_payments`, `finance_payment_allocations` | payee, actual payment date, account, method/reference, amount, allocations to posted payables, idempotency key/fingerprint, journal ID, reversal link. One payment can settle several same-payee bills. Supplier prepayments use a separate asset until matched. |
| Transfer / `finance_transfers`, `finance_transfer_legs` | from/to accounts, principal, initiated/settled dates, references, fee as a separate line, state, transit account, actor, source remittance ID when applicable. Amounts reconcile across legs; source-linked remittances cannot also be manually recreated. |
| Journal / `finance_journal_entries`, `finance_journal_lines` | sequence, effective/posted times, source event ID, policy version, recognition period, status, reversal-of; debit/credit GL lines with optional customer/line/item/location/payee dimensions. At least two nonzero lines; each line exactly one debit or credit; debits equal credits per PHP entry. Append-only posted header/lines enforced in DB. |
| Source evidence / `finance_source_events`, `finance_source_links` | module/type/record ID/event ID/version, operation ID, effective/occurred/observed times, immutable raw payload/hash, canonical financial identity, mapping version, posting status, journal IDs, original/reversal references. One accounting effect per source identity and effect kind. |
| Reconciliation / `finance_reconciliations`, `finance_statement_lines`, `finance_matches` | account, period/opening/closing statements, deduplicated statement line reference/date/amount, matched journal IDs/amounts, reviewer, unresolved variance. Supports split/group matching without allocating a statement amount twice. |
| Recognition / `finance_recognition_schedules`, `finance_recognition_lines` | source invoice/line, obligation, net transaction price, service window/delivery evidence, earned period amount, remaining deferred/unbilled amount, policy/version, reversal links. Unique source-line-period-policy effect; superseding schedules reverse prior effects. |
| Asset/cost evidence / `finance_assets`, `finance_cost_allocations` | asset origin/item/serial reference, cost, in-service date, useful life, residual value, allocation/use, accumulated depreciation/impairment/disposal; cost allocation references an Inventory-owned valued issue or approved direct-cost accrual. No duplicate physical stock ledger. |
| Period/report / `finance_periods`, `finance_report_snapshots` | month, `OPEN/CLOSING/CLOSED`, closer and checklist, journal/source watermarks, policy version, completeness/coverage, immutable published totals/row references; reopen event and superseding snapshot. |
| Derived lifecycle projection / `finance_lifecycle_events` | source event ID, line ID, old/new customer owner and state, actual effective time, reason/order, migration/history quality. A read projection of Service-owned events; not a lifecycle editor. |

For every financial write require authentication, permission, Idempotency-Key,
canonical request fingerprint and atomic journal/document commit. A matching
retry replays; a mismatched key is HTTP 409. Invalid amounts/states return 400 or
422, unauthorized roles 403, stale versions/closed periods 409, unavailable
durable storage/provider 503. Balance validation and payment allocation occur
under transaction/row locks. Disallow over-settling a payable, over-refunding an
eligible source balance, and negative cash balances unless specifically approved
as a correction workflow. Liability accounts may legitimately grow credit balances.

No direct module-to-app-shell imports. Define injected providers in Finance;
Integration Codex later supplies them. PostgreSQL rollback leaves no posted
document, journal, checkpoint or successful audit. Durable accounting evidence
is committed with the write; shared Logs dispatch may retry after commit.

## 4. Workflows and independent states

### Expense approval, posting and settlement

Approval: `DRAFT -> SUBMITTED -> APPROVED` or `REJECTED`; authorized own business
recording uses `DRAFT -> NOT_REQUIRED` in the posting transaction. Reimbursements,
staff submissions and amounts above the role limit retain independent review.
Rejected documents may
return to DRAFT as a new version. Unposted drafts/submissions may be cancelled.
Posting: `UNPOSTED -> POSTED -> REVERSED`. Settlement is derived:
`UNPAID -> PARTIALLY_PAID -> PAID`; a reversed settlement may move it back.
Overdue is a date-derived flag, not another posting/approval state.

Draft needs payee, purpose and amount. Submission additionally needs category,
dates and evidence/reference or a reason for an allowed exception. Approval
freezes the approved document version. Any financial change invalidates approval.
Posting needs independent approval or explicit own-business direct-recording
authority, recognition classification, GL destination
and an open period. Post Dr expense/inventory/asset/prepayment as appropriate,
Cr payable. Actual payment posts Dr payable, Cr selected funds account. Paying
does not recognize the expense again. Employee-paid business expenditure credits
employee payable; reimbursement settles it. Employee advances remain receivables
until supported expenditure is approved; residual funds are returned separately.

Post and pay may be one UI action only when all gates pass and two distinct
accounting effects commit atomically. Partial settlement requires allocations.
Vendor credit notes reduce the original payable/cost with evidence. Reversing a
paid bill requires linked settlements to be reversed/reallocated through a
controlled workflow first; no negative payable shortcut. Future-dated drafts
may be entered; future cash payments are pending until funds actually move.

### Accounts, opening balances and transfers

Account: `ACTIVE -> ARCHIVED`; block new postings to archived accounts and
archive only after remaining balances/reconciliation obligations are resolved.
Opening balance is an approved balanced entry on a documented cutover date,
against reviewed equity/legacy control accounts. Customer legacy receivables,
advances, payables and assets need itemized subledger ties. No opening balance
counts as current income/expense or period cash flow.

Starting-balance entry refinement (2026-10-13): the amount/date may be entered when
creating the account and applied atomically with its balanced journal, or entered
later, by managers with accounts.manage and opening-balances.post. Manual supporting-reference/reason fields are omitted from the form.
An operator declaration and creation provenance are recorded automatically;
existing optional references remain retained. Direct declarations record operator
and poster attribution with approvedBy=null. Historical REFERENCE requests and
nonmanager declarations still require independent approval before applying. The simplified
form does not certify a cash count or replace source cutover reconciliation.

Transfer: `DRAFT -> PENDING -> IN_TRANSIT -> SETTLED`; DRAFT/PENDING may become
`CANCELLED` before any leg posts. A posted leg is corrected by reversal, not
cancellation. Reconciliation status `UNRECONCILED/PARTIAL/RECONCILED` is separate.
Immediate transfers post both legs together; delayed settlement posts through
transfer clearing on the actual leg dates. Fees post separately as expense.
Moving cash between eligible company cash accounts cancels in consolidated cash
flow, while account activity shows both legs.

Collector confirmation stays in Collector. Finance reads its result and posts
the verified movement once; calling Finance never creates another collection.
Cash/GCash variances are reviewed independently. An accepted note is not enough
to classify a shortage automatically as expense: choose collector receivable,
recoverable error, approved loss or explained surplus and attach evidence.
Until then use variance clearing and mark reports provisional. Settlement time
requires actual movement evidence, not merely a confirmation timestamp.

### Reconciliation, source ingestion and close

Reconciliation: `DRAFT -> IN_REVIEW -> RECONCILED`; reopening appends a reason
and new version. Unmatched statement lines, stale source coverage, duplicate
receipts and missing transfer legs remain exceptions. Matching itself never
creates income; bank fees/interest require explicit separate entries.

Source processing: `RECEIVED -> VALIDATED -> POSTED`, or `EXCEPTION` with reason.
Retries use the original identity; dependent missing events wait as exceptions.
Corrections arrive as additional revision/reversal events. A financial source
void does not prove money was refunded. Preserve the initial receipt and route
money disposition to a linked refund/duplicate/no-funds investigation.

Period: `OPEN -> CLOSING -> CLOSED`. Require complete feed checkpoints,
balanced trial balance, opening/subledger ties, bank/custody reconciliation,
classified variances, recognition schedules, costs/depreciation/accruals and
reviewed exceptions. Late entries in a closed period either post as an approved
current-period correction referencing the original period, or use an authorized
reopen; never silently rewrite published totals. Reopening preserves the old
report and publishes a superseding revision.

## 5. Permissions and attribution

These Finance permissions are proposed, not seeded. Reuse shared System Settings
Access and evaluate server-side on every API/provider call. A visible tab grants
no posting permission. Existing `finance_officer` role can receive explicit new
grants later; it does not automatically imply them. Existing
`collector.finance.view`/`collector.finance.confirm` remain required to read or
confirm Collector records. Finance grants cannot bypass source permissions.

| Proposed permission | Scope |
| --- | --- |
| `finance.view` | Module entry and authorized overview. |
| `finance.accounts.view`, `finance.accounts.manage` | Account activity; create/update permitted master data. |
| `finance.opening-balances.post`, `finance.opening-balances.approve` | Create/post openings; managers may apply operator declarations directly; independently approve reference/nonmanager requests within scope. Separate from ordinary account editing. |
| `finance.transfers.view`, `finance.transfers.post` | View; post permitted account movements. Reversal also requires `finance.journals.reverse`. |
| `finance.expenses.view`, `finance.expenses.create`, `finance.expenses.approve`, `finance.expenses.post`, `finance.expenses.pay` | Independent intake, approval, journal posting and settlement. Own drafts unless broader view scope is granted. |
| `finance.expenses.view_all`, `finance.expenses.manage`, `finance.expenses.reverse`, `finance.expenses.evidence.override` | Phase 3 explicit broader document visibility, payee/category catalog management, linked correction and attributed evidence exceptions; no self-approval bypass. |
| `finance.attachments.view`, `finance.attachments.upload` | Restricted evidence metadata/download or upload/retirement inside a visible permitted expense; upload also requires expense editing permission. |
| `finance.income.view`, `finance.income.post` | Source-linked collection view; approved other income/funding, never customer receipt creation. |
| `finance.reconcile` | Statement/custody matching and proposed variances; journal effects also need posting grants. |
| `finance.journals.view`, `finance.journals.post`, `finance.journals.reverse` | Attributed, constrained manual corrections/accruals; no source-ledger overrides. |
| `finance.reports.view`, `finance.reports.export`, `finance.growth.view` | Financial reports, exports and operational subscriber reports; source/customer detail separately scoped. |
| `finance.periods.close`, `finance.periods.reopen`, `finance.policies.manage` | Close/reopen and effective-dated policy maintenance. |

Recommended role grants: Finance Officer gets view, intake, authorized posting,
paying and reconciliation; approver gets expense review/approval within a stored
amount limit; owner/management gets overview/reports and explicit approval/close
grants; auditor gets view/export without mutation. Explicit
`finance.expenses.record-direct` authorizes own business expenses within the role
limit; create/post grants and a separate pay grant for actual settlement are required.
This records `NOT_REQUIRED` and an attributed policy/version decision, without
fabricating independent approval. Reimbursements and staff-created/edited expenses
always need an independent reviewer; creators/editors still cannot approve or reject
their own submissions. Amount
limits, account scopes and evidence exceptions are server-side policies, not UI
checks. There is no automatic grant to collectors, technicians or cashiers.

Audit all submissions, approvals, changes invalidating approval, postings,
payments, reversals, mapping changes, evidence access, variance resolutions,
exports and close/reopen actions. Include actor, time, document/version, source,
amount, effective date, reason, request/operation ID and permission/policy used.
Restrict sensitive payee/bank evidence; keep secrets out of response/log fields.

## 6. Accounting treatment and report ladder

These are internal management-report policies proposed for the first release.
Accounting/tax policy review is a release dependency, not a claim of statutory
compliance. Recognition follows delivered goods/services, not money received;
the design distinction is informed by [IFRS 15](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-15-revenue-from-contracts-with-customers/).
Inventory purchase/consumption and asset capitalization are separate using the
principles summarized by [IAS 2](https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/)
and [IAS 16](https://www.ifrs.org/issued-standards/list-of-standards/ias-16-property-plant-and-equipment/).

### Basis and formulas

All sums use posted effects as of the selected knowledge cutoff, effective in
the selected period, including attributed reversal events on their effective
dates. Default is latest-known restated management data for open periods;
published closed reports use their stored cutoff/version. Never infer historical
cash movement from today's POSTED-only list or erase a real receipt because it
later became VOID. Bill-cohort settlement uses Billing's own as-of semantics.

| Measure | Formula / definition |
| --- | --- |
| Customer collections | Sum canonical Billing payment receipts plus POS register payment receipts; separate real linked refunds. Amount retained, excluding returned change; include advances, exclude promotions/rebates/credit applications and legacy evidence. This collection measure includes personal-GCash custody and is not controlled-cash inflow. |
| Controlled cash flow | Actual eligible company cash-account inflows minus outflows, classified operating/investing/financing. Consolidate both sides of internal eligible-cash transfers; disclose opening plus net flow equals closing. No opening entries, credit purchases or depreciation in flow. |
| Earned gross revenue | Gross charges for delivered services/goods before separately reported contra-revenue, allocated to delivery in the period. Exclude tax collected for authorities, owner funding, loans and refundable deposits. Invoice issue date is not the recognition date. |
| Earned net revenue `R` | Earned gross revenue minus period-recognized discounts, service rebates and sales returns. Each reduction belongs to one source obligation/effect once. |
| Direct cost `D` | Recognized costs of delivering service/goods: upstream, dedicated network operation, valued consumed/sold stock, attributable delivery labor and network depreciation. No purchase-payments shortcut. |
| Gross profit | `R - D`; margin `100 * (R - D) / R` when R is positive. |
| Operating expense `O` | Recognized administrative/sales/support expense including office depreciation and operating impairment/bad-debt policy; excludes D, financing costs and income tax. |
| Operating profit | `R - D - O`; margin divided by R. No direct depreciation counted again in O. |
| Profit before income tax | Operating profit + classified nonoperating income - nonoperating expense - financing interest. Disposal gain/loss uses proceeds minus asset carrying amount, not full proceeds as revenue. |
| Net profit | Profit before income tax - recognized income-tax expense. Unavailable tax/accrual/cost data makes this subtotal unavailable; show the supported predecessor instead. |
| Available company funds | Reviewed balances of unrestricted company bank/wallet/cash accounts; separately disclose cash in collector custody, transfer transit, personal-GCash due, restricted deposits and card/loan/payable obligations. No invented credit-card cash. |
| Payables as of date | Posted bill obligations - posted vendor credits - posted payments + payment reversals; age from due date using current/1–30/31–60/61–90/90+ days. |
| Receivables and month settlement | Reuse Billing's canonical adjusted balances/cohort metrics. Settlement includes cash allocations and credit applications; cash collection is a separate numerator. Do not sum invoice issue-time account summaries, which include prior invoices. |

Profit margins with nonpositive revenue and rates with zero denominators are
not applicable, not infinity. Period change is `(current - prior)/abs(prior)`
when prior is nonzero; label the convention, show absolute change, and say N/A
when prior is zero. Compare complete calendar months or equal elapsed
month-to-date windows (short months cap both windows to the shorter duration).
Filters, basis and completeness must match between comparison windows.

The cash-flow report uses a direct management presentation of operating,
investing and financing movements; these categories and noncash disclosure follow
[IAS 7's summary](https://www.ifrs.org/issued-standards/list-of-standards/ias-7-statement-of-cash-flows/).
Initial management policy classifies borrowing/card financing principal and
interest paid as financing, ordinary transaction fees as operating, income-tax
cash as operating, asset purchases/disposals as investing. Statutory presentation
and any later policy changes require effective-dated review.

### Recognition and special transactions

| Transaction | Cash / funds treatment | Earned result / balance-sheet treatment |
| --- | --- | --- |
| Monthly prepaid invoice | No cash until receipt. | Dr AR, Cr deferred service revenue on invoice; earn daily over the supported inclusive service window. Future months remain deferred. |
| Monthly postpaid service | Cash later, independent of delivery. | Earn supported delivered service: Dr unbilled receivable, Cr revenue; invoice reclassifies unbilled to AR, with only the unearned portion deferred. Never recognize again on invoice/payment. |
| Receipt allocation | Cash or collector/gateway receivable increases; exclude change. | Cr AR for allocated amounts. Paying arrears is current cash and settlement of old revenue, not new earned revenue. |
| Customer advance | Retained amount is collection at receipt; controlled cash only when in an eligible account. | Cr customer advance liability. Future application Dr advance liability, Cr AR; recognition follows the service schedule, not application date. |
| Promotion / rebate / waived fee | Noncash credit; no receipt. | Reduce earned revenue or deferred consideration for the affected service obligation once; unused customer rebate credit is a liability. Credit consumption settles AR without a second expense/revenue reduction. A NO_FEE/WAIVED decision before a charge creates no fictional revenue or cash. Unknown service attribution blocks a complete P&L. |
| Refund / receipt void | Real refund is actual money out on actual date. Duplicate/no-funds entry correction has no flow. A void alone cannot determine which occurred. | Advance refund releases liability; refund settling an existing rebate credit releases that liability; genuine sales return reduces earned consideration and creates/settles refund payable. Prevent double contra-revenue. Source owner decides eligible entitlement; Finance records authorized funds disposition. |
| Collector cash | Company cash increases at customer handover; later office handover is internal. | Cr AR/advance against held-cash asset. Shortages remain due from collector/clearing until separately resolved. |
| Collector personal GCash | Collection is recognized operationally immediately; excluded from company-controlled cash until transferred. | Dr due from collector, Cr AR/advance. Company-wallet settlement Dr wallet, Cr due from collector. This is cash realization, not another receipt/revenue. Show the collection-to-controlled-cash timing bridge. |
| Transfer / remittance | Cash-to-cash legs cancel in consolidated cash flow; each account retains activity. | Asset-to-asset movement; fees separate. No additional customer payment. |
| Company credit-card purchase | No company cash out at purchase. | Dr expense/inventory/asset according to purpose, Cr card liability (or clear supplier payable). Card principal payment releases liability, never repeats expense; split interest/fees. Disclose financed purchases as noncash. |
| Customer card/gateway receipt | Only if supported by a reviewed source/gateway contract; no invented current card integration. | Dr gateway receivable then settlement to company cash, with separately evidenced fee. Avoid gross/net settlement double counting. |
| Loan funding / principal | Proceeds financing inflow; principal financing outflow. | Liability changes, neither revenue nor expense. Accrued interest is financing expense, repayment interest does not repeat it. |
| Owner contribution / withdrawal | Financing inflow/outflow. | Equity movement; owner loan is a separate liability. Personal expenditure is owner receivable/drawings, not business OPEX. |
| Asset/network construction | Payment investing outflow, including paid capitalized installation components. | Capitalize qualifying cost; expense routine repair. Depreciation begins at in-service date, assigned to direct network cost or office OPEX; disposal gain/loss separate. No complete net profit without the asset schedule. |
| Stock purchase / issue / assignment | Supplier payment is normally operating cash; equipment bought as fixed asset investing. Stock movement itself is noncash. | Purchase increases inventory; valued sold/consumed issues recognize COGS/direct cost/OPEX or construction-in-progress by purpose. Warehouse transfers/retained company equipment assignments do not automatically expense. Returned stock reverses the original cost once; impairment needs evidence. |
| Vendor prepayment / prepaid annual expense | Cash leaves on payment date. | Asset until goods/service received; allocate annual insurance/software across covered periods. Refund clears asset, not new revenue. |
| Legacy import | Prior payment evidence/opening entries are outside current cash flow. | Carry reviewed opening AR/advance/equity/deferred balances without new-system revenue. Historical arrears collected later produce new cash against opening AR. Missing historic recognition stays unavailable. |
| Sales/input tax | Cash may include gross tax; split it explicitly. | Output tax liability and recoverable input-tax asset where approved; irrecoverable purchase tax joins cost. Income-tax expense is separate. No tax rate/filing compliance implied by POS's tax field. |

Monthly service recognition defaults to straight daily allocation within the
validated service period. Allocate a rounded source net amount using actual
calendar days; carry higher precision internally and assign the residual cent
to the final day so lifetime recognition equals source consideration. Suspend/
terminate handling requires source terms and actual delivered-service evidence;
do not automatically stop revenue because an operational status changed if the
contract still bills. Installation may be distinct delivery revenue or part of
the ongoing obligation; hold its schedule pending policy/evidence when uncertain.
Other income uses approved event classes, never a catch-all for loans/capital.

Recommended initial asset method is straight-line: depreciable base = cost minus
approved residual value; full-month depreciation = base / useful-life months,
with actual-day proration for first/last partial months and a final residual-cent
adjustment. Do not depreciate below residual value. Useful lives, capitalization
threshold and impairment/disposal rules must be recorded before schedules post.
Loan interest uses the supported lender schedule/accrual evidence, not an
invented percentage of principal; income-tax expense likewise needs approved
accrual evidence rather than an assumed rate.

### Worked reporting checks (PHP)

- Receive 1,200 in December for January service: December collections/cash 1,200,
  December earned revenue 0, January earned revenue 1,200 over delivery days.
  January credit application adds no cash.
- Collect 800 and apply Billing's 200 promotion to a 1,000 delivered-service
  invoice: cash 800, net revenue 800, settlement 1,000. Do not call the promotion
  cash, or deduct it both as contra-revenue and operating expense.
- Post a 5,000 delivered upstream bill and pay 2,000: direct cost 5,000,
  operating cash out 2,000, remaining payable 3,000.
- Buy a 30,000 company asset on card: cash flow 0 at purchase; asset/card
  liability +30,000. Pay 10,000 principal plus 300 interest later: cash out
  10,300; only the recognized 300 interest affects profit; depreciation separate.
- Receive 50,000 loan and 20,000 owner capital: financing inflow 70,000,
  earned revenue 0. Repay principal without expense.
- Collect 1,000 into personal GCash in January, transfer to company GCash in
  February: January customer collections 1,000 and due-from-collector +1,000;
  February controlled-cash inflow 1,000, customer collections 0 for that transfer.
- A receipt voided later with an actual refund keeps original cash inflow and
  refund outflow on their dates. A duplicate entry with no second funds received
  uses a correction, with no fictional refund.

## 7. Recommended ISP categories and allocation rules

Categories describe purpose; accounting classification may differ by line.
Require cost center/site/project and supporting document where attribution
matters. Mixed bills split by measured use or an approved effective-dated driver;
allocated parts sum to the bill, and a cost appears once in the profit ladder.

| Category / suggested code | Default result class | Exceptions/evidence |
| --- | --- | --- |
| Upstream bandwidth, transit, peering / `DIRECT_UPSTREAM` | Direct cost | Supplier service dates, capacity/site allocation; prepayments amortized. |
| Leased backhaul, last-mile capacity, pole/site rent / `DIRECT_NETWORK_LEASE` | Direct cost | Recurring operational rental; long-term lease accounting requires reviewed policy. |
| POP/OLT/router power, network backup fuel / `DIRECT_NETWORK_POWER` | Direct cost | Meter/site attribution; office consumption OPEX. |
| Network monitoring licenses, field maintenance / `DIRECT_NETWORK_OPERATIONS` | Direct cost | Dedicated network usage; capital improvements are assets. |
| Installation/repair technician labor and subcontractors / `DIRECT_FIELD_LABOR` | Direct cost | Dated job/time evidence; construction labor capitalized when eligible, admin labor OPEX. Payroll calculation remains external. |
| Drop fiber, connectors, patch cords, consumables / `DIRECT_INSTALL_MATERIAL` | Direct cost at valued consumption | Inventory until issued for consumption; retained equipment/assets classified separately. |
| Hardware resold to customers / `COGS_EQUIPMENT` | COGS at delivered sale | Original valued issue/return; current selling price or item unitCost is not historic COGS. |
| Network asset depreciation / `DIRECT_NETWORK_DEPRECIATION` | Direct cost | Asset in-service, life, residual and location/use; no duplicate depreciation in OPEX. |
| Field fuel, vehicle usage, technician transport / `DIRECT_FIELD_TRANSPORT` | Direct cost for evidenced jobs | Sales/admin trips OPEX; vehicles assets, usage allocated. |
| Office rent, utilities, internet, supplies / `OPEX_OFFICE` | Operating expense | Warehouse/network-specific portions allocated; deposits/prepayments assets. |
| Administrative salaries, benefits, training / `OPEX_PEOPLE` | Operating expense | Approved payroll/accrual evidence; service delivery staff may be direct cost. |
| Marketing, referral incentives, sales commissions / `OPEX_SALES` | Operating expense | Customer invoice discount stays Billing contra-revenue; contract-acquisition capitalization requires separate policy. |
| Collection operations, SMS, processing fees / `OPEX_COLLECTIONS` | Operating expense | Transaction fee distinct from rebate, float and funds remitted. |
| Business software, legal/accounting, permits, insurance / `OPEX_ADMIN` | Operating expense | Service-period allocation; recoverable taxes separate. |
| Office asset depreciation, approved bad debt/impairment / `OPEX_DEPRECIATION_LOSS` | Operating expense | Bad debt is not automatic overdue write-off; Billing entitlement/adjustment remains source-owned. |
| Borrowing/card interest / `FINANCE_INTEREST` | Financing expense below operating profit | Principal is liability settlement; statement evidence needed. |
| Income tax / `INCOME_TAX` | Below pretax profit | Requires approved expense estimate/accrual; no statutory calculator. |
| Network build, equipment, office/vehicle assets / `CAPEX_*` | Asset / construction-in-progress | Not current expense; capitalization threshold/life policy required. |
| Stock for sale/installation / `INVENTORY_PURCHASE` | Inventory asset | Expense only after valued sale/consumption, not payment/warehouse transfer. |
| Loans, owner equity/drawings, deposits / `FUNDING_*` | Liability/equity/asset | Never revenue category; separate cash-flow classification. |

Direct costs can be fixed (capacity/rent/depreciation) or variable
(materials/per-job labor); retain a second dimension for that distinction.
Recommend weighted-average costing for interchangeable stock and specific
identification for uniquely traceable equipment once Inventory supports cost
layers. Finance consumes those costs; it does not maintain competing FIFO/stock
quantities. Manual reviewed cost evidence may support a clearly scoped report,
but cannot silently replace incomplete inventory valuation.

## 8. Subscriber and operational report definitions

Use stable Service Account ID as line unit and Customer Profiling ID as customer
unit. Current connected-base policy includes `ACTIVE` and
`PENDING_DISCONNECTION`; pending installation, suspended, pending reconnection,
disconnected, terminated and cancelled are separate counts. Pending disconnection
is separately disclosed. Billable status/rate remains Billing-owned, so active
line count is neither billed-customer count nor revenue.

- Closing active lines = opening active lines + first activations entering the
  active set + reconnections/reentries - suspensions leaving it - disconnections/
  terminations leaving it + reviewed baseline corrections. Count actual set
  transitions only: terminating an already disconnected line is not another
  active-base exit. Repeated transitions may appear in event counts; distinct
  line counts are a separate measure. A first activation does not become a
  reconnection, and pending-disconnection entry stays inside the active set.
- New customer subscriber = first evidenced service activation for that
  customer, not profile creation or another line. Reactivated customer = from
  zero active lines to one or more after a prior activation. Additional lines
  increase line counts without counting another customer. Ownership transfer
  changes the per-customer membership bridge, not global line activations.
- Closing unique subscribed customers = distinct owners of active-set lines at
  close; compute opening/closing customer membership directly. Do not derive
  customer counts by summing line transitions. Net growth is closing minus
  opening for the same unit and certified baseline; growth rate divides by
  opening when positive.
- Disconnection churn = distinct opening contracted lines whose contracted
  membership ends during the window / opening contracted lines. Contracted set
  includes active, pending-disconnection, suspended and pending-reconnection;
  first disconnection/termination ends membership once. Temporary suspension
  is not contract churn. Reconnection after disconnection is a win-back; disclose
  it separately. Unknown membership history makes churn unavailable.
- MRR = sum effective contracted recurring monthly consideration for the
  disclosed eligible billable-line population at a date. Use Billing's dated
  subscription rate/approved override and recurring discount terms, not catalog
  list prices or a hoped-for payment-time promotion. Exclude one-time install,
  equipment sales, taxes and advances. Historical MRR/expansion/contraction need
  dated rate history. ARPU = MRR / eligible distinct subscribed customers (and
  separately MRR/eligible lines), with zero base N/A. MRR is a run-rate, not cash
  or period earned revenue.
- Monthly bill settlement uses Billing's unique billed-customer cohort and
  `subscriberCollectionRate` definition, includes supported credit settlement,
  and separately presents cash allocation rate, credit amounts and missing
  billing-cycle warnings. Never call it an active-base growth rate.

Migrated existing lines enter a reviewed opening baseline and a separately
disclosed import-baseline movement, not new activations in the import month.
Imported activationDate may be a cutover fallback, and suspensionDate may be the
cutover date rather than actual suspension. Only explicit validated historical
evidence may support pre-cutover events. A current status, latest reconnection
date or Logs entry cannot reconstruct missing complete past lifecycle history.

## 9. Completeness and unavailable reports

Each response/export records period, asOf, basis, timezone, currency, formula/
policy version, source watermarks, coverageStart/End, completeness per metric,
exception IDs and generatedAt. Completeness values:
`COMPLETE/PROVISIONAL/UNAVAILABLE/NOT_APPLICABLE`. Unknown numbers are null with
reason codes, not zero; partial subtotals are labeled and never promoted to a
complete higher subtotal. Unsupported history is not plotted as a zero month.

| Report | Data available now | Missing dependency / required release behavior |
| --- | --- | --- |
| Billing receivables/month cohort settlement | Existing Billing reports with as-of logic, cash/credit and unique-customer distinctions. | Reuse canonical result; disclose Billing gaps and legacy boundaries. No new Finance access is wired yet. |
| Current receipt register | Billing receipts; POS current register payments; Collector links. | Stable source feeds including hidden voids/revisions, cash-account mapping and cutoff completeness before authoritative historical export. |
| Account balances / controlled cash flow | Customer collection methods and Collector custody/remittance facts. | Reviewed openings, named account mapping, all non-customer movements, actual GCash transfer/refund dates and bank evidence. Payment method alone is insufficient. |
| Earned revenue / deferred revenue | Invoice amounts/cycle dates; Service dates/current state. | Delivered-service/installation obligation policy, reliable coverage/adjustment allocation, historical cutover recognition and unbilled accrual evidence. Unsupported parts unavailable. |
| Gross profit / COGS / site margin | Inventory quantity ledger and editable current item unitCost. | Receipt/issue historical cost layers, landed cost, original return valuation, direct supplier/time/site allocation and network depreciation. Current quantity*unitCost is only a current indicative value. |
| Operating profit | Category proposal only; no Finance expense ledger yet. | Complete earned/direct costs plus approved operating accruals/prepayments/office depreciation/bad debt. Known costs alone yield a partial result. |
| Net profit | No complete asset, debt, expense or tax ledger. | All preceding dependencies plus financing/nonoperating and tax expense. Do not display a complete net-profit card until covered. |
| Payable aging / expense ranking | No Finance bill/payment records. | Implement accrual/payments and opening payables. Rank recognized expense separately from cash spend; capital/stock excluded from expense ranking. |
| Current subscriber snapshot | Service current line states and customer IDs. | Snapshot scope can be supported; archived/ownership/source coverage policy must be reviewed. |
| Historical growth/churn/MRR | Partial latest lifecycle dates and source snapshots. | Immutable lifecycle/ownership/rate events plus certified baseline/history coverage. Show unavailable windows; imports are not new growth. |

## 10. Policy gates and validation scenarios

Before authoritative accrual/profit release, record owner/finance policy for
installation recognition, service suspension obligations, direct/OPEX allocation,
capitalization threshold, asset life/residual/depreciation, valued-stock method,
tax treatment, opening balances, restricted cash, interest classification and
approval limits. Defaults above guide development; unresolved policies block
affected postings/reports rather than stopping unrelated receipt views.

Future tests must cover: exact replay/mismatched idempotency; simultaneous payable
payments; balanced immutable journals and reversals; denied self-approval/stale
document versions; closed-period backdates; prepaid/postpaid recognition without
duplicate revenue; promotion/rebate lifetime reduction once; advances without
new cash; true refund versus no-funds void; POS/Billing deduplication; Collector
personal-GCash timing/cash custody/variance; card purchase/principal/interest;
stock purchase/valued issue/return/asset assignment; imported AR without invented
cash/revenue/activation; line/customer/ownership transition reconciliation;
missing data/null results; source-page/report/export total equality; rollback
and restart-safe checkpoint/audit replay. Phase 1 changes no executable behavior.
