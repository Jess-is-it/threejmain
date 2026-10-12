# Finance Management reporting and subscriber analytics

Phase 5 implemented 2026-10-12 inside Finance. This guide defines the executable
report API contract. The assigned scope combines financial reports and subscriber
analytics; the older roadmap's separate subscriber phase no longer describes the
delivered API scope. Shared providers, app-shell, Access registry, application
migrations remain integration work. Phase 6 report UI and output support are
now delivered locally; see PHASE6_INTERFACE.md. No operational receipts,
invoices, Service Accounts or Inventory quantities are created by reports.

## Delivery and routes

Default `configure_finance` now selects `ReportingService`, extending
`IncomeService` and `PayablesService`. Existing account/payable/income APIs remain.
New files: `api/finance/reporting.py`, `report_schemas.py`, `report_storage.py`,
`report_adapters.py`, migration `2026101204_finance_reports.sql` and two report
test files. Four migration definitions/nineteen tables are required; older SQL
files remain unchanged. No application/public schema migration was run.

All GET reports require `month=YYYY-MM` (supported years 1900 onward); optional
`asOf=YYYY-MM-DD` defaults to today's **Asia/Manila** date. Future dates/months
and cutoffs before the selected month start are rejected. Monetary aggregates
are exact Decimal strings. Percentages round half up to two decimals. Stored
line amounts are never converted to float or rounded to fit a source mismatch.

Routes relative to `/api/finance`:

| Route | Output and options |
| --- | --- |
| GET `/reports/cash-flow` | Account openings/adjustments/movements/closings, controlled-cash classifications, eliminated internal legs, card debt and personal-GCash due. |
| GET `/reports/profit-and-loss` | Earned revenue, contra-revenue, direct costs, gross/operating/pretax/net profit, margins and underlying GL effects. |
| GET `/reports/expenses` | `basis=RECOGNIZED` or `SETTLED`; `groupBy=category`, `payee`, `account`, `location` or `project`. |
| GET `/reports/receivables` | Billing-authoritative as-of rows when certified; Finance itemized Billing/POS AR, aging and control variances. |
| GET `/reports/payables` | As-of itemized unpaid obligations, aging, contributing journals and payable-control tie. |
| GET `/reports/reconciliation` | Effective-period exceptions with **current** review states, counts and as-of variance clearing. |
| GET `/reports/collections` | Receipt-month canonical Billing/POS retained collections, refunds, net collections and unique receipt customers. |
| GET `/reports/transactions` | Full immutable journal drill-down; optional `accountId`, `offset` and `limit` 1–500 (Phase 6 adds authorized `allRecords=true`). Totals cover all matching rows, not the page. |
| GET `/reports/subscribers` | Separate customer/line census and growth, lifecycle events, MRR, Billing receipt-month payer count and bill-month settlement. |
| GET `/reports/billing-settlement` | Authoritative selected-month monthly-service invoice cohort, full/partial/unpaid customers and cash/credit/outstanding ties. |
| GET `/reports/comparison` | `kind=cash-flow`, `profit-and-loss`, `expenses`, `payables`, `receivables`, `collections` or `subscribers`; expense basis/group apply to both windows. |
| POST `/reports/evidence/{kind}/sync` | Certified provider projection; body only `{month, asOf?}`, stable Idempotency-Key required. No browser-supplied lines/events/certification flags. |

Each report includes period/asOf, basis, PHP currency, Asia/Manila timezone,
policy `finance-management-v1`, generatedAt, knowledge boundary, source watermarks
and ledger fingerprint. `asOf` limits effective financial dates, not what the
system knew on that historical day: current posted evidence includes later
attributed backdates/reversals. Immutable published/closed-period revisions and
historical knowledge-time queries are not implemented. Exceptions explicitly
report current review status rather than pretending to reconstruct old reviews.
AR/AP use all-period obligations through asOf; their envelope ends at that date,
even when the selected invoice/receipt month is earlier.

## Access and durable evidence

Three new grants:

- `finance.reports.financial.view`: aggregate financial reports and comparisons.
  Requires unrestricted account/document scope plus accounts.view, journals.view,
  expenses.view/view_all and income.view/view_all. This prevents an aggregate or
  transaction drill-down from exposing documents the caller cannot otherwise read.
- `finance.reports.subscribers.view`: company-wide Service census/lifecycle/rates
  and Billing cohort/payer analytics; unrestricted account/document scope required.
  Subscriber receipt detail contains Billing records only, excluding unrelated
  POS register collections. No customer contact fields are copied.
- `finance.reports.evidence.sync`: provider synchronization, also requiring the
  appropriate financial/subscriber report read authority. Providers enforce their
  source-owner permissions independently using the trusted actor username.

No role name implies a grant. Same-key replay rechecks current permissions/scope
before returning retained evidence. Provider absence returns 503; invalid proof,
incomplete coverage, wrong month/date, wrong owner/kind or provider failure never
stores a snapshot. Provider fetch runs outside the Finance lock; validated inserts,
idempotency evidence and audit commit together under the existing writer lock.
Coverage certificates compare the ledger again after fetch to reject stale writes.

`finance_report_snapshots` is an append-only certified read projection. Identity
is kind + snapshotId; the exact payload fingerprint cannot change. PostgreSQL
rejects update/delete and mismatched normalized/JSON identities. Same evidence
under a new operation key links the original snapshot. There is no deletion,
automatic retention expiry, public-file storage or second receipt ledger.
Shared backup/restore must include this table and retained source references.
External evidence remains under its source's access and retention policy.

## Financial formulas and completeness

Account balances use sealed journal lines, natural debit/credit sides and **all**
accounts, including archived accounts. Opening is the balance through the day
before the window; closing is through its end. Cards are credit-normal liabilities
and personal collector GCash is due from collector, both excluded from controlled
cash. Controlled cash includes physical collector cash, company cash/petty cash,
company GCash and banks.

`opening + openingAdjustments + netMovement = closing`. Opening entries inside
the selected window are shown as openingAdjustments, excluded from current cash
flow/profit. This explains a first report beginning before its opening date without
inventing a receipt. The consolidated bridge uses the same equation and reports
its computed reconciliationVariance.

Controlled flow is the sum of eligible debit−credit legs per journal. Both sides
of an eligible internal transfer cancel; remittance adds no receipt/income.
Personal-GCash realization is company cash when actual company funds arrive.
Physical-cash shortages affecting controlled cash stay UNCLASSIFIED until resolved;
variance clearing is not silently expensed. Card funding/principal settlement,
loan/owner inflows and interest paid are financing; asset purchases investing;
inventory purchases and ordinary supplier/tax/collection payments operating.
Card-funded purchases have zero controlled cash at purchase. Unclassified cash
movements remain visible and block a complete cash-flow classification.

P&L uses revenue/contra-revenue/expense **journal lines**, not receipt or invoice
amounts. Delivered POS price is earned; line/sale discounts reduce it once; tax
liability is excluded. Approved manual OTHER_INCOME is nonoperating income, while
loans/owner funding remain balance-sheet funding. Billing invoice intake remains
deferred consideration until a separately reviewed delivered-service recognition
workflow posts earned entries. Payment/advance application does not recognize it.

`earnedRevenue = earnedGrossRevenue − contraRevenue`.
`grossProfit = earnedRevenue − directCosts`.
`operatingProfit = grossProfit − operatingExpenses`.
`pretax = operatingProfit + nonoperatingIncome − nonoperatingExpense − financingExpense`.
`netProfit = pretax − incomeTax`.
Margins divide by positive earned revenue; nonpositive denominators are N/A.
Immutable category codes FINANCE_INTEREST and INCOME_TAX classify those costs below
operating profit. Direct/OPEX classification comes from the retained category;
unclassified GL expense/revenue remains visible and blocks complete profit.

Recognized expense grouping includes posted expense GL lines and their dated
reversals. Unattributed journals appear as UNASSIGNED, with actual account/journal
IDs. Inventory/assets stay outside expense totals. SETTLED groups posted expense
payable payments/reversals by actual funding account and provides cashPaidTotal
separately: card settlement is included in settled value but not controlled cash.
Recognition account and settlement account are different dimensions/bases.

AP is the dated sum of each payable's credit−debit control effects; a document
currently reversed can still be owed on an earlier asOf. Partial settlement and
payment reversal are included on their actual dates. Aging buckets are CURRENT,
1_30, 31_60, 61_90, 90_PLUS (91+ days) and UNKNOWN. Missing due dates never imply
CURRENT. Billing AR uses source-owned as-of evidence when present, with Finance
control variance disclosed; absent evidence retains itemized baseline/effect
projection as provisional. POS AR remains separately projected and requires
its own certification for a complete combined receivables report.

Completeness:

- COMPLETE is limited to the stated evidence scope. Transaction totals and
  current recorded exceptions can be complete for the Finance ledger scope.
- Known component totals are PROVISIONAL until coverage is certified. Missing
  components are not made zero. Gross/operating/pretax/net profit values are null
  when their required predecessor/cost/accrual coverage is missing; recordedValue
  exposes the explicitly incomplete arithmetic subtotal separately.
- A financial-coverage provider certifies an exact start/end, policy and ledger
  fingerprint, with flags for cashFlow, collections, registerReceivables, payables,
  earnedRevenue, directCosts, operatingExpenses, nonoperating and incomeTax.
  Optional reviewed account classifications must match GL types; fixed POS price/
  discount classifications cannot change. Missing flags default false.
- A later posting/backdate/account edit or exception change invalidates that
  fingerprint. Unclassified P&L lines or unresolved exceptions still block complete
  profit despite flags. Coverage is never inferred from a source checkpoint's
  opaque completeThrough marker, an empty table or a configured provider.

Certification requires real delivery/recognition, valued consumption/COGS,
depreciation, supplier/accrual completeness, financing and tax evidence. This phase
does not create recognition schedules, substitute current Inventory unitCost,
automate depreciation/taxes or repair missing financial history. Those journal
workflows/source policies remain explicit dependencies, as designed in Phase 1.

## Subscriber definitions and historical evidence

SubscriberLine stores stable Service Account/customer IDs, dated status,
everActive, migratedExisting, Billing billability/normalized monthly recurring
rate and rate evidence. ACTIVE and PENDING_DISCONNECTION are in the connected
set. Pending installation, suspended/reconnection, disconnected/terminated/
cancelled are outside it. Archived/current Customer Profile status does not
replace Service history.

The subscriber provider supplies a dated baseline, historical ever-active
customer membership, completeThrough and immutable ordered effective lifecycle/
ownership/rate effects. Before-state must match the replayed line/customer.
Sequences/effective dates are monotonic and IDs unique. Service owns lifecycle/
ownership; Billing owns RATE effects. Rate/billability changes cannot hide in
a lifecycle or ownership event. Snapshots cannot rewrite an existing baseline
or event, or omit retained effects from overlapping coverage. Source history
repairs need a reviewed correction contract, not edited snapshots.

Opening/closing active **lines** count IDs; active **customers** count distinct
owners of the connected set. An additional line is not a new customer. First
ACTIVATION needs proved first entry; REACTIVATION needs prior active evidence.
MIGRATION_BASELINE requires explicit existing-subscriber attribution and enters
as a disclosed baseline adjustment, never new activation. First customer acquisition
counts only a first activation for a never-active customer; ownership movement
changes customer membership without inventing a new line activation.

`closingLines = openingLines + newActivations + reactivations − activeExits + migrationBaselineAdjustment`.
`closingCustomers = openingCustomers + customerEntries − customerExits`.
Both expose reconciliation variances. Suspension/disconnection/termination **event**
counts are distinct from active exits: terminating an already disconnected line
does not exit the active base twice. Repeated real suspensions/reentries count
events; pending disconnection stays active. `netGrowth = closing − opening`;
`growthPercentage = 100 * netGrowth / opening`, opening zero is N/A.

MRR is closing Billing-normalized recurring rate over certified billable lines;
billability is independent of Service status. It is neither cash nor earned
revenue. Missing historical rates/coverage make MRR null. A closing census can
support closing counts while opening counts/transitions/growth remain unavailable.
No matching dated baseline/coverage means UNAVAILABLE history, not zero growth.

## Receipt month versus selected bill-month settlement

Receipt-month reporting sums retained canonical Billing receipts and distinct
POS register receipts once, excluding legacy references, remittances, promotions,
credit applications, loans and owner funding. Full actual refunds remain separately
dated outflows; duplicate-no-funds corrections remove the one original receipt,
including alias references. Subscriber customersWhoPaidDuringMonth uses Billing
customer receipts only. Missing coverage is labeled; missing payer evidence is
null with recordedValue zero rather than a definitive zero customer count.

Bill-month settlement delegates Billing's MONTHLY_SERVICE_INVOICES cohort at the
requested asOf. Group each customer once across all that month's invoices:
FULL if outstanding is zero, PARTIAL if cash/credit settlement exists with balance,
otherwise UNPAID. `netBilled = cashCollected + accountCreditsApplied + outstanding`.
Rebates are an overlapping breakdown and are not deducted again. Cash collection
rate and full-customer settlement rate have separate denominators; zero bases
return null/NOT_APPLICABLE. January bills paid in February settle January's cohort
but remain February receipt-month collections.

`BillingReportAdapter.settlement` maps the actual Billing report's billedAmount,
billingMonth/asOfDate and source totals. It rejects filtered/paginated partial
cohorts, verifies row sums/status/invoice counts, requires stable invoice/Service
IDs supplied from the same authoritative snapshot, and strips customer contacts.
Invoice/account numbers are display labels, never substituted for stable IDs.

## Comparisons, providers and integration handoff

Completed selected months compare complete calendar months. A partial month
compares equal elapsed days; both windows cap to the shorter month's length
(March 30 versus February 28 compares March 1–28 with February 1–28). The primary
report still covers its requested period; comparison returns both actual windows.
Basis/group/scope must match. Changed completeness prevents numeric comparison.
`percentageChange = 100 * (current − prior) / abs(prior)`; prior zero is N/A.
Unsupported history stays unavailable in comparisons.

Integration configures four explicit report providers:

```python
configure_finance(current_actor, store=PostgresStore(),
    source_providers=reviewed_phase4_providers,
    report_providers={
        'subscribers': certified_service_and_billing_history,
        'billing-settlement': certified_billing_cohort,
        'billing-receivables': certified_billing_asof_invoices,
        'financial-coverage': reviewed_financial_coverage,
    })
```

Each implements fetch(ReportFeedRequest) -> a typed ReportEvidence model/dict.
Request includes kind, month, start_date/end_date, as_of, trusted actor_username
and current ledger_fingerprint. Types are defined in report_schemas.py. Providers
must certify the complete source scope, enforce current source permissions and
use a coherent snapshot, not reconstruct history from latest state/date fields.

Service needs a certified census and append-only effective lifecycle/ownership
export; imported cutover/activation fallback dates cannot be reused as real first
activation. Billing needs dated monthly-normalized billability/rate changes,
unfiltered full cohort rows with stable invoice/line IDs and complete as-of AR.
Its existing collection report supplies arithmetic but paginated rows are not
a certified whole-cohort feed. Finance's provider must consume all rows in one
consistent source snapshot; do not reconcile top-level totals against one page.
No source-owner code/provider was changed or wired here.

Integration registers/copies the fourth local migration, seeds reviewed grants,
injects current actors/providers, includes report snapshots in backups, and
verifies browser/API behavior and source control variances on shared staging.
Phase 6 now supplies all six web workspaces, Overview, charts and authorized
output; see PHASE6_INTERFACE.md for the current integration handoff. No runtime build/restart or production operation was performed.

Tests from repository root:

```bash
PYTHONPATH=features/finance/api python3 -m unittest discover -s features/finance/api/tests -p test_finance_reports.py
# Opt-in authorized test DSN; never log it:
PYTHONPATH=features/finance/api python3 -m unittest discover -s features/finance/api/tests -p '*postgres.py'
```

Tests reconcile cash/account bridges, expense groups, AR/AP controls, profit GL
components, subscriber line/customer transitions and Billing cohort equations.
They cover temporal reversals, advances, canonical duplicates, card/asset flows,
funding, interest/tax, unclassified costs, exception acknowledgment, unavailable
history/rates, migration exclusions, short-month comparisons, authorization,
immutable evidence, stale certification and rollback. PostgreSQL fixtures create
only private generated namespaces; ordinary fixtures roll back. Existing real
independent-worker financial/source tests retain their guarded exact-schema
cleanup. No real receipts, SMS, application/public DDL or production data change.

Verified 2026-10-12: 92 local Python tests (24 foundation, 21 payables, 25 income,
22 reporting/adapter/API), 97 executed PostgreSQL tests (100 discovered; three
inherited fixture skips) and 14 unchanged client tests pass. After final report
changes, all 22 PostgreSQL report cases were rerun and passed. Eight unchanged
frontend static transforms, Python syntax, JSON metadata, documentation links
and module-file whitespace checks pass. These are the historical Phase 5 results.
Phase 6 adds intercepted-fixture browser/UI verification; live providers and
application migration-runner/backup wiring remain integration gates.

## Phase 6 presentation extensions

The current interface/API export contract is [PHASE6_INTERFACE.md](PHASE6_INTERFACE.md).
It adds authorized CSV/print, consistent monthly series, membership/rate evidence
rows, per-account transfer movement, dated named drill-down and totalExpenses.
The Phase 5 ownership, coverage, money, timezone and provider rules remain in force.
