# Finance Management reconciliation and readiness

Review date: 2026-10-12. Shared branch: staging. Review host:
`http://192.168.50.70:8280/finance` (API port 8200). Production was not deployed.
The shared working tree contains other sessions' changes; only owned Finance
and approved integration hunks are committed by this session.

## Implemented and verified

The six workspaces cover named accounts and attributed openings, internal
transfers and credit-card liabilities, separately approved/recognized/settled
payables with private evidence, approved other income/funding, canonical source
posting/reversal/recovery, financial/subscriber reports, record drill-down,
spreadsheet-safe CSV and printable reports. Decimal PHP values and Manila
business dates remain authoritative. Posted journals, source evidence,
financial audit events and publication history are immutable.

The review implemented a missing readiness requirement: completed-month
reconciliation, closing and reopening. `finance.periods.view`, `.prepare`,
`.close`, `.reopen` are explicit Access grants. Whole-company financial and
subscriber read scope is required because a publication contains both sets of
supporting evidence. Stock Finance Officer prepares; independent Finance
Approver closes/reopens; management/auditor inspect; owner cannot self-close.
Exact unchanged built-in phase-7 roles gain the new capabilities; customized
roles keep their grants. Native Billing/POS attestation requires current native
edit permission; Finance grants alone do not authorize source changes.

Period APIs:

- `GET /api/finance/periods`: current states without report payloads.
- `GET /api/finance/periods/{YYYY-MM}`: current reconciliation and retained
  immutable revision records, including prior published reports.
- `POST /api/finance/periods/{YYYY-MM}/prepare`: reviewed checklist, reason,
  evidence reference and stable `Idempotency-Key`.
- `POST .../close` or `.../reopen`: current version, reason, evidence reference
  and stable request key. Stale versions conflict; matching retries recover
  the original result with current authorization rechecked.

Preparing OPEN -> CLOSING locks the month's new journals and reversals.
Independent closing CLOSING -> CLOSED requires unchanged reviewed evidence.
Reopening CLOSING/CLOSED -> OPEN retains the earlier publication, permitting
new attributed correction journals and a later superseding close. PostgreSQL
posting triggers and serialized accounting transactions enforce the lock even
for direct SQL attempts; immutable period events and versions enforce history.
`2026101206_finance_periods` is registered through `READINESS_MIGRATIONS`; six
module-owned definitions now create 26 Finance tables in shared PostgreSQL.
Applied migration bytes must never be edited.

Zero-revenue months may close with certified zero profit and not-applicable
percentage margins; unavailable accounting figures still block closure.

Closing requires all seven documented reconciliation checks, complete certified
cash/collection/AR/AP/revenue/direct-cost/operating/nonoperating/tax coverage,
zero trial/cash/subledger variance, no unresolved reconciliation exceptions,
and a reviewed cutover/capture baseline covering the whole month with consumed
source cursors. Acknowledging an exception does not resolve it. The source
watermark and ledger fingerprint must still match on close. A later source
correction targeting a locked month remains blocked with recoverable evidence;
reopen and reprepare, or use an appropriately authorized current-period
correction under the accounting policy. Never silently edit a closed journal.

Full calendar-month reports with as-of equal to month-end read the frozen
publication, including chart records, all journal rows, CSV and print. A later
as-of bill-settlement report is a distinct live reporting window. Reopened
months show current evidence; the previous closed publication remains in
period detail history. UI audit history lists retained revisions; selecting an
older revision for a separate CSV/print export is not implemented.

## Reconciliation evidence

| Controlled fixture | Verified result |
| --- | --- |
| Attributed opening cash | 1,000.00, independent review; opening adjustment, not current income |
| Canonical Billing receipt visible through Billing/POS/Collector | One financial receipt; aliases add no cash or revenue |
| Customer advance | 20.00 retained credit liability, separate from earned revenue |
| Collector custody/remittance | Custody clears on evidenced actual company receipt; no repeated collection/income |
| Direct/operating expense partial/final settlement | Recognized expenses total 50.00; payable balance 0.00; payments do not recognize expenses again |
| Credit-card purchase and repayment | Purchase increases liability; evidenced cash repayment clears debt to 0.00 without another expense |
| Asset purchase | Asset remains on balance sheet; cash movement classified separately from recognized expenses |
| Actual subscriber refund | 120.00 outflow, original receipt retained, credit/AR effects reversed once |
| Final controlled cash | 1,142.00; opening + net flow 142.00 equals closing; bridge variance 0.00 |
| Journal and drill-down | Exact summed debits equal credits; report balances agree with journal lines |
| Source retry/concurrency | Duplicate keys/source references produce one effect; out-of-order dependencies and unauthorized actions retain evidence and reject |

Financial report tests separately establish earned revenue, direct costs, gross
profit, operating profit, financing expenses, tax and net profit formulas;
transfers, loan proceeds and owner funding do not inflate profit. Missing
recognition or inventory costing does not become a fabricated zero net profit.

Historical subscriber fixtures start with 2 active lines/1 customer and end with
4 active lines/4 customers, reconciling 2 activations, 1 reactivation, 2 active
exits and 1 migration baseline adjustment. Migrated existing lines are excluded
from new activation/new customer counts. Ownership changes and multiple lines
per customer affect distinct customer counts separately. Dated billable rates,
missing opening history, suspensions, disconnections, terminations, full/partial/
unpaid bill-month settlement, and receipt-month customer counts are verified.
Later receipts settle their original bill cohort; receipt month remains separate.

Verification recorded:

- Finance API/service/PostgreSQL suites: **247 tests, 244 passed, 3 inherited
  skips**. Rollback fixtures leave public business rows unchanged. Independent
  PostgreSQL worker tests use isolated UUID test schemas and remove only those
  test schemas after checking real transaction races. Skipped inherited
  rollback-only concurrency cases are supplemented by real independent-worker
  payable, source-sync and period tests.
- Shared Finance auth/scope/module/reference/source authorization: **6 passed**.
  An exact staged-source archive, excluding other sessions' uncommitted edits,
  passed the combined **253-case suite: 250 passed, 3 inherited skips**.
- Browser-client Node suites: **21 passed**, including exact money, pending-key
  recovery, private attachment transfer, dates and unavailable chart figures.
- Real shared staging browser: **11 workflow groups passed**, zero page errors,
  rejected Finance requests or financial writes. Six deep links, canceled forms,
  source cutover gate, period read/checklist/current-month gate, CSV, print,
  unavailable history, desktop and 390px mobile were reviewed.
- Fixture browser: **11 workflow groups passed**, no application writes/browser
  errors; the intentional rejected payment fixture proves recovery behavior.
- Live historical preparation returned **409** for incomplete accounting coverage,
  created no period record; unauthenticated period access returned **401**.
- Shared deployment through `scripts/staging_deploy.sh` completed with the
  `runtime/server` lock. Six migration IDs, 26 tables, healthy web/API, no real
  financial journals and no active cutover were confirmed. Desktop financial
  reports/period checklist and mobile account screenshots were visually reviewed.

Reproduction: run API discovery with all module API directories available on
`PYTHONPATH`; set `FINANCE_TEST_DATABASE_URL` only for an authorized test database.
Use `python3 -m unittest discover -s features/finance/api/tests -p 'test_finance_*.py'`,
`node --test features/finance/web/tests/*.test.mjs`, and the browser harnesses in
`web/tests`. Browser harnesses use the existing staging origin and a protected
session file; never commit a session token or testing credentials. Staging build/
restart requires `runtime/server`; test suites do not start extra servers.

## Operational setup and recovery

1. Review `HISTORICAL_IMPORT_PLAN.md` and `PHASE7_INTEGRATION.md`. Choose cutover
   C covered by durable capture. Establish actual named company cash, petty
   cash, wallets, bank, collector custody and cards; methods are not accounts.
2. Independently approve actual C−1 balances and itemized AR/deferred obligations,
   unconsumed advances/credits, liabilities and collector custody. Reconcile
   source-owner controls. Baseline sources do not create new transactions. Do
   not import old receipts already represented in opening balances. Earlier
   historical detail requires a separately reviewed opening/import correction.
3. Map actual settlement channel/operator/method/institution identities and
   validity dates to named accounts. Independently approve maps/cutover; activate
   only after source-control checks pass. Finance UI shows setup pending until
   the approved boundary is active.
4. Monitor durable recovery every 30 seconds and `/integration/status`. Resolve
   missing named-account mappings and source-owner evidence at native Billing/
   POS/Collector recovery routes. Retry the frozen request/key or captured source
   page. Errors retain cursor/evidence. Do not clear saved browser attempts to
   bypass an uncertain collection. Cross-device/browser recovery needs office
   review because local pending state does not travel with the user.
5. After full financial coverage is available, refresh authoritative reports,
   reconcile bank/wallet statements, counted cash, custody, openings, AR/AP,
   recognition/valued costs, depreciation/accruals/financing/tax, then prepare and
   obtain independent close. Correction requests use authorized reopening with
   retained evidence and new journals, followed by fresh certification/close.
6. Preserve evidence and backups. Attachments are private PostgreSQL bytes with
   immutable hash/metadata, up to 2 MiB each and 10 per document. Upload/download
   require current document scope and permission. Downloads are attachments with
   private/no-store and nosniff headers. Retirement preserves evidence; no automatic
   purge exists. Retention/deletion schedules and malware scanning remain operational
   setup boundaries; protected report/evidence access is implemented.

A protected PostgreSQL custom archive was saved before period migration:
`/tmp/threejmain-staging-before-finance-periods-20261012.dump`, 741,385 bytes,
SHA-256 `01682877de827ace428ca831ef3142766d8ea6766cb12d2422d0ae52977db9ed`.
It is mode 0600, host-local and contains sensitive business evidence; it is not
in Git. Coordinate secure off-host backup/retention separately. Recovery requires
an explicitly authorized cold restore with workers stopped, retaining source
records, journal, private attachment bytes, outbox/cursors, sequences, triggers,
functions and migration checksums. Live JSON full restore stays blocked after
Finance capture; configuration restore remains a separate administration action.
No restore, database reset, production migration or production deployment was run.

## Remaining readiness boundaries

**Staging software verification passed; real accounting activation remains
conditional.** Staging has no independently reviewed real openings/cutover, so
source baseline images were never converted into fabricated receipts or income.
Trusted earned-service delivery recognition, historical inventory valuation/
COGS, depreciation, accruals, financing and tax completeness are unavailable.
The shared financial coverage provider deliberately leaves those flags false;
full profit figures and closing cannot be certified until those integrations and
reviewed evidence exist. Receipt/source-only figures are clearly provisional.
Current inventory unit cost is not historical COGS; current Service state is not
proof of earlier growth. Capture began 2026-10-12; the first completed captured
Manila-day lifecycle census is available on 2026-10-13. Earlier opening history
remains unavailable. Unsupported payment gateway/card settlement or economic
source edits without retained reversal are visible blockers, never guessed
postings. Management must supply/approve these operational prerequisites before
claiming complete historical accounts or unrestricted financial readiness.
