# Finance Management shared integration

Phase 7 is integrated on the shared staging branch/server. This guide supersedes
the integration-pending statements in earlier phase handoffs. Production has not
been deployed. Accounting setup still needs real, independently reviewed funds
and source controls; integration does not authorize invented openings.

## Shared entry points and access

- App-shell imports the Finance APIRouter at `/api/finance` and module page at
  `/finance`. One Finance Management navigation group contains Overview,
  Accounts & Transfers (`/finance/accounts`), Expenses & Payables
  (`/finance/expenses`), Income & Collections (`/finance/income`), Financial
  Reports (`/finance/reports`), and Subscriber Growth (`/finance/subscribers`).
  Workspace selection preserves deep links. Existing Finance Officer Collector
  landing/access behavior remains intact.
- `finance.access.ACCESS_REGISTRATION` extends System Settings Access. Stock
  Finance Officer grants retain Collector authority and add Finance operational
  capabilities except independent approvals and evidence override. An existing
  customized Finance Officer role is not overwritten. Existing other roles keep
  their grants; owner receives the complete permission catalog.
- New independent `finance_approver`, read-only `finance_management` and
  `finance_auditor` roles have explicit Finance permissions. Owner still cannot
  approve an opening, expense, other income, mapping or cutover they created or
  edited. Role names confer no implicit Finance permission.
- Access role `financeScope` carries `accountIds`, `expenseIds` and string
  `approvalLimit`. Null means unrestricted; empty ID arrays allow no matching
  records. Whole-company reports and source sync reject restricted scopes.
  Roles UI exposes these controls; the server validates exact nonnegative cents.
- Every request resolves the current persisted account/role. Disabled/deleted
  users, removed roles and revoked grants affect existing tokens immediately.
  Finance grants do not grant native Billing/POS/Collector write access.
- Module metrics are filtered by current Finance grants/scopes in both shared
  Dashboard and module APIs, and count named accounts, posted journals, payables and open
  reconciliation exceptions. Finance audit events remain authoritative in
  PostgreSQL and are mirrored to bounded shared Logs by an attributed retry
  worker. A crash can repeat a display mirror, not a financial posting.

## Shared database and delivery guarantees

`app.db_migrations.register_module_migrations` registers module-owned definitions
before the shared startup runner. `MIGRATIONS` exports the four Phase 2–5
definitions; `INTEGRATION_MIGRATIONS` exports
`2026101205_finance_integration`. Five definitions create twenty-four Finance
tables in the existing shared PostgreSQL database. Startup reruns are checksum
checked and idempotent. Never change an applied definition; add a migration.

The integration migration takes source-table locks, captures the current records
as immutable `BASELINE` images, then installs database triggers on
`billing_records`, `pos_records`, `collector_records`, and `service_records`.
Source mutations and outbox writes commit or roll back together. Contact copies
and credential fields are stripped recursively from captured payloads. Service
retains its trusted actor identifier in the capture attribution field.

A transactional counter locked until commit prevents a slow transaction from
appearing behind an already-consumed cursor. Captured originals, corrections and
deletions are retained independently of visible operational lists. `BASELINE`
never creates cash or income. Fixed source snapshot ID: `finance-capture-v1`.

After an independently approved active cutover, the shared API starts a thirty
second recovery worker with a reserved server-owned, finite-grant actor. It
delivers through existing Finance transactional/idempotent posting and cursor
guards. Missing mappings, source evidence, unsupported corrections, or a source
record changed economically without a reversal hold the cursor and retain an
explicit durable error. Finance posting exceptions retain their underlying
source references. Restart retries the captured evidence; source-owned receipts
are never recreated. Manual recovery requires the caller's current Finance sync
authority, including unrestricted scopes.

## Providers and canonical ownership

| Owner | Registered provider and effect |
| --- | --- |
| Billing | `billing.finance_provider.BillingFinanceFeed`: invoices create AR/deferred service obligations; retained receipt allocations/advances create one collection; adjustments/credit applications and reference-only migration evidence remain separately classified. `BillingFinanceReport` certifies complete bill-month customer cohorts and dated AR from canonical Billing records. |
| POS | `point_of_sale.finance_provider.PosFinanceFeed`: completed register sale and payment remain separate. Invoice collection evidence references the canonical Billing receipt and carries no new cash. POS retained invoice confirmation records now include receipt ID, amount and payment date. |
| Collector | `collector.finance_provider.CollectorFinanceFeed`: collection references Billing custody; closed remittance requires actual movement date and origin/destination settlement identity for each CASH/GCASH leg. Remittance clears custody and reconciles variance without earning income again. |
| Service | `service.finance_provider.ServiceFinanceFeed`: completed installation is a reference to Service/Billing. `SubscriberFinanceReport` projects captured Service lifecycle/ownership and captured Billing billability/rates. |
| Customer Profiling | `FinanceCustomerReferences`: authorized minimal canonical identity/location lookup, without another profile/contact ledger. |
| Inventory | `FinanceInventoryReferences`: current item classifications/current unit costs; historical issued/consumed costing is explicitly unavailable. Editable current unit cost is never historical COGS. |

Cash-desk identities include channel and trusted operator. Collector personal
GCash remains due from collector. Company wallets/banks require an explicit
source-owned institution identity and independently approved Finance account
mapping; payment method alone never selects an account. Customer loans/owner
funding remain the existing separately approved Finance classification flows.

Source-owner attestation routes are POST
`/api/billing/finance/recovery/{sequence}`, `/api/point-of-sale/finance/recovery/{sequence}`
and `/api/collector/finance/recovery/{sequence}`. Billing/POS require their native
edit grants; Collector requires `collector.finance.confirm`. Inputs follow
`SourceResolution`: dated evidence/reason, actual settlement identities, refund
or duplicate/no-funds disposition where applicable, and optional invoice
attribution. Collector can supply per-leg `fromSettlements`, `toSettlements` and
`effectiveDates`. Incomplete/inconsistent projections are rejected before storing
an attestation. Accepted attestations are immutable and attributed; identical
retries return the original. Conflicting evidence requires a source correction
and accounting review, not editing an already posted Finance journal.

## Cutover and historical reconciliation

- GET `/api/finance/integration/status` shows capture day/watermark, source
  pending changes/cursors/errors and cutover state. Income & Collections displays
  these states. POST `/api/finance/integration/recover` retries using the caller's
  authority. Readiness and metadata distinguish integrated setup from active
  forward accounting.
- GET `/api/finance/integration/cutover-preview?startDate=YYYY-MM-DD` requires
  cutover management authority. It reconstructs original invoice/register AR,
  remaining advances/rebates, and retained unsettled Collector receipts through
  the prior recorded business day. Migration reference-only money is excluded.
  It provides exact source IDs and a fingerprint, and creates no journal.
- The preview deliberately leaves Billing deferred obligations and custody
  account mapping for review. Include paid Billing invoices where service remains
  unearned. Count actual named cash/wallet/bank/custody holdings, card liabilities
  and other opening controls; do not derive holdings from cumulative receipts.
- The boundary must follow the first recorded capture day. A preview for tomorrow
  is useful preparation; formal future-date cutovers cannot be activated early.
  Source AR/credits/custody are checked on creation and again at activation.
  Existing core controls tie the exact funds/account opening fingerprint,
  deferred obligations and receipt-custody amounts to approved postings through
  C−1. A different independent user must approve the cutover.
- Do not separately import transactions already represented by account openings.
  Baseline sources are evidence only; forward economic effects must be dated at
  or after C. A newly captured backdated pre-C transaction blocks for source and
  opening reconciliation. Pre-capture refunds/corrections and partial refunds
  need a separately reviewed entitlement contract; they cannot silently post.
- Follow `HISTORICAL_IMPORT_PLAN.md` for a separately authorized older import.
  Current-state source snapshots cannot certify a prior day's funds or invent
  missing historical events.

## Historical growth and incomplete reports

The subscriber baseline is the end of the **first completed captured Manila
day**, with subsequent dated captured lifecycle/rate changes. A capture begun at
noon is not yesterday's midnight census. A first-day sync returns definitive
409 without saving a snapshot; the UI explains availability tomorrow. Earlier
growth is unavailable. A midmonth baseline can certify closing counts/rates but
cannot invent that month's opening counts or growth. Imported existing lines are
baseline adjustments, never new activations. MRR follows Billing billability and
dated contractual rates separately from the Service active census.

Billing receipt-month totals remain separate from settlement of selected-month
bills. Certified full cohorts/AR can be refreshed in report pages. Complete
financial coverage remains false until actual sources certify service delivery,
valued inventory consumption, accrued expenses, depreciation, financing and tax.
Cash is not earned revenue; gross, operating and net profit retain their
provisional/unavailable indicators. No delivery/costing history was fabricated.

## Backup, retention and deployment

System Settings database export uses one repeatable-read snapshot. Live JSON
full restore is blocked after Finance capture because its TRUNCATE CASCADE path
could destroy immutable evidence and captured source history. Restore a complete
PostgreSQL archive during a planned cold maintenance window with workers stopped,
all sequences/functions/triggers intact, attachment bytes retained and restored
source checkpoints reconciled. Test that procedure on a separate disposable
restore target before applying it to staging/production. Finance evidence is
durable; no automatic attachment purge was introduced.

Staging uses `scripts/staging_deploy.sh`, Compose `threejmain-staging`, web 8280
and API 8200. Acquire `runtime/server` for builds/restarts and release after
health/migration verification. A protected pre-integration PostgreSQL archive was
created at `/tmp/threejmain-staging-before-finance-20261012T123842.dump`.
Production 8180/8100 on this host remains disabled.

## Verification

Meaningful private rollback-schema PostgreSQL tests cover source/outbox rollback,
immutable capture/redaction, invalid settlement holding the cursor, authorization,
exact cutover controls including advances, repeated posting, attributed voids and
ledger reconciliation. Dated source lifecycle/rate projections reconcile unique
customers, lines, migration adjustments, activation/reactivation and MRR into
Finance reports. Existing Finance accounting/payable/source/report concurrency,
idempotency, attachment, reversal and reconciliation suites remain required.

Shared ASGI tests use private Access settings and test-only ledger storage to
prove fresh role revocation, account/document scopes, exact approval limits,
unauthenticated failures and source-owner write authority. Native Billing/POS/
Collector/Service/System Settings regression suites and Finance/portal client
tests verify existing operational behavior. Staging verification includes health,
five applied migrations, authenticated report/reference APIs, Billing evidence
refresh, CSV/print, actual Finance navigation/deep links and responsive empty/
provisional/unavailable states. Business holdings and source cutover were not
invented for a browser test.

Reproducible actual-origin browser check (existing authorized session in a
protected temporary file; no interception or financial posting):

```bash
FINANCE_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
PLAYWRIGHT_BROWSERS_PATH=/path/to/browsers \
FINANCE_STAGING_TOKEN_FILE=/protected/session-file \
node features/finance/web/tests/financeIntegration.browser.mjs
```

The browser check verifies six deep links, canceled forms, disabled source sync
before cutover, CSV/print, unavailable history and mobile overflow. It records
zero page errors, rejected Finance requests or financial writes. Six shared
Finance auth/metrics tests and five existing Dashboard tests pass; metrics do
not expose company counts to restricted users or ungranted Finance roles.
