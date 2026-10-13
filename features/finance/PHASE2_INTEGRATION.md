# Finance Management Phase 2 foundation

Current starting-balance intake (2026-10-13): Add account optionally accepts a dated
starting amount in one atomic save. Later amount/date-only entry also remains
available. Manual reason/evidence reference is optional; system attribution and
explicit operator-declaration provenance are retained. Simplified operator declarations apply immediately for authorized account managers
with both accounts.manage and opening-balances.post. Creation, balanced journal and
audit are one transaction; approvedBy stays null. REFERENCE evidence retains
independent review. Finance migration 2026101303_finance_declared_starting_balances
is now part of MIGRATIONS and must be applied before updated posting. See README.md and PROJECT_MODULE_CONTEXT.md for the
current request/permission contract; this historical phase guide is superseded
for starting-balance form requirements. Earlier SQL files are unchanged; the additive migration preserves evidence immutability.

Current report handoff: [PHASE5_REPORTING.md](PHASE5_REPORTING.md). Phase 5 now
selects `ReportingService` and adds explicit report providers. Four ordered
migrations/nineteen tables are required. This earlier-phase guide retains its
historical contracts; no old SQL file or source-owner record was changed.

Current Phase 4 handoff: [PHASE4_INCOME_COLLECTIONS.md](PHASE4_INCOME_COLLECTIONS.md)
extends this historical contract. `configure_finance` now selects `IncomeService`
and accepts explicitly injected certified source providers. Three ordered local
migrations/eighteen tables and three enabled workspaces are required. Generic
manual fund inflows cannot bypass independent income/funding approval. Earlier
phase migration files remain unchanged; shared wiring is still pending.

Implemented 2026-10-12 inside `features/finance/`. This records the Phase 2 foundation
contract; the broader [implementation specification](IMPLEMENTATION_SPEC.md)
and [source contracts](SOURCE_CONTRACTS.md) describe later phases. No app-shell
route, permission seed, shared migration registration, or source feed was added.
The shared application does not expose Finance yet.

Phase 3 extends this foundation. Use [PHASE3_EXPENSES_PAYABLES.md](PHASE3_EXPENSES_PAYABLES.md)
for the current expense contract, grants and migration handoff: `configure_finance`
now selects `PayablesService`, `Actor` adds optional `expense_ids`, both ordered
migrations and all twelve tables are required, and Expenses & Payables is enabled
alongside Accounts & Transfers. New linked payable entries use protected payable
control and their dedicated reversal workflow. Actual separate-connection
PostgreSQL concurrency tests now cover the races deferred by the historical
rollback-only foundation fixtures below. Phase 2 SQL remains unchanged.

## Delivered structure

| File | Responsibility |
| --- | --- |
| `api/finance/schemas.py` | Strict request models and exact PHP decimal validation. |
| `api/finance/permissions.py` | Trusted actor, explicit grants, account scope, opening approval limit. |
| `api/finance/ledger.py` | Account lifecycle, opening approval/posting, transfers, journals, reversals, activity. |
| `api/finance/storage.py` | PostgreSQL repositories and atomic transactions; readiness fails closed. |
| `api/finance/memory.py` | Explicit isolated test repository; never selected automatically. |
| `api/finance/router.py` | Exported authorized `/api/finance` APIRouter. |
| `api/finance/migrations.py`, `api/finance/migrations/2026101201_finance_foundation.sql` | Shared-runner-compatible definitions, without registration or execution. |
| `web/FinancePage.jsx`, `web/finance.css` | Module-owned account, opening, transfer and journal views/forms. |
| `web/financeApi.mjs` | Shared-token client with persisted, frozen same-key retries. |
| `api/tests/`, `web/tests/` | Accounting, authorization, transactional database and retry checks. |

At Phase 2 completion only Accounts & Transfers was enabled. Overview,
Expenses & Payables, Income & Collections, Financial Reports and Subscriber
Growth awaited their phases; Phase 3 now enables Expenses & Payables. There are no sample balances or
simulated reports. Generic accounting journals are an explicitly authorized
foundation tool; they do not implement expense approval, payable settlement or
source receipt ingestion.

## Account catalog and money semantics

An account is a named financial holding or obligation with a unique permanent
code and ID. A payment method is the rail or means of a movement, never the
account identity. For example, two company GCash wallets remain separate named
accounts even though both use `GCASH_TRANSFER`.

| Kind | Accounting class / normal balance | Controlled cash |
| --- | --- | --- |
| `CASH`, `PETTY_CASH`, `COMPANY_GCASH`, `BANK` | ASSET / debit | Yes |
| `COLLECTOR_CASH` | ASSET / debit; named custodian required | Yes: company physical cash in custody |
| `COLLECTOR_GCASH` | ASSET / debit; named custodian required | No: personal-wallet amount due from collector |
| `CREDIT_CARD` | LIABILITY / credit; balance is the amount owed | No |
| `GENERAL_LEDGER` | Explicit ASSET, LIABILITY, EQUITY, REVENUE, CONTRA_REVENUE or EXPENSE | No; cannot be a transfer endpoint |

Liability, equity and revenue accounts have credit-normal balances. Other
classes have debit-normal balances. General-ledger accounts provide the balanced
counterparts needed for corrections and future recognition. The immutable
`finance-opening-equity` control is nonspendable and cannot be edited/archived.
Scoped users do not receive its aggregate balance in the account list; scoped
opening journals can contain their own counterpart line.

New accounts start at zero. Name, custodian and notes can be edited with the
current positive `version`; code, kind, currency and accounting class are
immutable. Journal lines retain the name/classification snapshot at posting.
Archival requires a zero current balance, preserves accounts and every journal,
and prevents new postings. Restore is explicit and audited, including before a
reversal involving an archived account. Codes cannot be reused after archival.
No account-delete API exists, and PostgreSQL rejects account deletion.

Amounts are decimal strings (or integers) at the request boundary, `Decimal` in
Python and `NUMERIC(18,2)` per database line. Binary floats, NaN/infinity,
fractional cents and out-of-range values are rejected. Responses serialize money
as fixed two-decimal strings. The client displays amounts without converting to
JavaScript Number. Effective dates follow Asia/Manila; attribution timestamps
are UTC. Future postings are rejected. PHP is the only supported currency.

Financial accounts cannot have negative end-of-day natural balances on any
affected historical date. This also prevents card overpayment. Backdating is
checked against every subsequent affected day, rather than only today's balance.
Overdrafts and card overpayment assets require a later reviewed model. Activity
orders by effective date then journal number; an intra-day intermediate running
balance can differ from the validated daily balance when a same-day entry was
posted later. This foundation does not claim intraday bank settlement ordering.

## Workflows and posting invariants

Opening requests follow `DRAFT -> APPROVED -> POSTED`. Creation records creator,
amount, date, reason and supporting evidence reference. Approval records a
different authenticated approver, timestamp and reason, and enforces that
actor's optional approval limit. Even `*` permission cannot bypass self-approval.
Posting uses debit financial asset / credit opening equity, or debit opening
equity / credit card liability. An account has at most one unreversed opening,
dated no later than its existing activity. A zero start needs no opening entry.

Opening evidence is retained after reversal; its displayed reversal state is
derived from the linked journal. A replacement opening requires reversing the
original on its original effective date. A later-dated reversal requires a
reviewed journal correction instead, preventing fabricated earlier history.
Evidence cannot be edited or deleted; an incorrect draft can be retained and a
new request created. Draft cancellation/rejection is future workflow work.
Openings and their reversals carry `cashFlowExcluded=true`; they create no
current-period revenue or profit. This phase produces activity/balances, not a
cash-flow or profit report.

Transfers post an immediately settled entry: debit destination / credit source.
They require distinct active financial accounts, a positive amount, movement
date, stable document reference, reason and method. Except `CASH_HANDOVER`, the
method also requires supporting transfer reference evidence. Neither line can
use income/expense/general-ledger accounts; metadata records zero income and
expense effect. A collector remittance moves the custody asset to company cash
or wallet and does not create another receipt. No automatic Collector adapter
is enabled.

`CARD_FUNDING` credits a card liability and debits the asset receiving funds;
`CARD_SETTLEMENT` credits an asset and debits the card liability being repaid.
Other methods cannot use card accounts, and card-to-card transfers are rejected.
A purchase journal debits the relevant expense/asset and credits the card;
subsequent principal repayment creates no expense. Fees/interest require a
separate journal with the appropriate expense counterpart. Transfer initiation,
funds in transit, bank matching and delayed settlement are later-phase work;
only record a transfer after its movement has actually settled.

Every posted journal has at least two lines across two distinct accounts, with
one positive debit OR credit on each line and exact equal totals. The service
assembles an entry and seals it in one transaction. PostgreSQL deferred
constraint triggers refuse unsealed, empty, unbalanced or invalid entries at
commit. Headers and lines cannot be changed/deleted after posting; extra lines
cannot be added to sealed entries. Posting, operation replay evidence, account
or opening state changes, and audit evidence commit or roll back together.

Corrections create a distinct `REVERSAL` with actor, time, reason and
`reversalOfId`. The original entry remains unchanged. Reversal offsets the
original accounts exactly, cannot predate it, and is unique per original.
Reversals cannot themselves be reversed; post a reviewed replacement. Reversal
does not bypass funds/card limits or archival rules. Transfer list responses
derive `reversedByEntryId`; account activity includes both financial effects.

Every mutation requires a stable `Idempotency-Key` of 1–160 characters.
`finance_operations` stores the scope/key, canonical payload hash and original
result transactionally. Exact retry returns the original result plus
`idempotentReplay=true`; changed payload under the same scope/key returns 409.
Journal source `(sourceNamespace, sourceReference)` is independently unique:
`finance.manual`, `finance.transfer`, `finance.opening`, `finance.reversal`.
Reusing a source reference with a different payload returns 409 even with a new
request key. These namespaces do not impersonate Billing/POS source events.
Replay still checks current grants and account scope. A database advisory
writer lock serializes Finance writes; reads acquire its shared form for a
coherent multi-query view. Account archival and raw journal assembly take the
same writer lock in database guards.

## API and authorization integration contract

The module exports `router`, `configure_finance`, `Actor`, `FinanceService` and
`PostgresStore`. The router returns 503 until a shared authenticated actor
provider is injected. Later integration must call
`configure_finance(current_actor)` and include `router`; importing never runs
migrations. `current_actor(authorization)` must validate the shared bearer
session and resolve a current server-side `Actor(username, permissions,
account_ids, approval_limit)`. Do not accept identity/grants/scopes from request
JSON. Invalid/expired auth should raise 401. `account_ids=None` means unrestricted
account scope; an empty set grants none. `approval_limit=None` means no amount
limit for an explicitly authorized approver. Scope/master-data access must be
reviewed before granting it. Account creation requires unscoped master-data
permission.

| Grant | Enforced operations |
| --- | --- |
| `finance.view` | Metadata/readiness and page entry |
| `finance.accounts.view` | Scoped account list, activity and opening requests |
| `finance.accounts.manage` | Create/edit/archive/restore account master data |
| `finance.opening-balances.post` | Create opening request; post independently approved opening |
| `finance.opening-balances.approve` | Independent opening approval within account/amount scope |
| `finance.transfers.view`, `finance.transfers.post` | Scoped transfer list; post transfer |
| `finance.journals.view`, `finance.journals.post`, `finance.journals.reverse` | Scoped journal evidence; manual journal; attributed reversal |

No role name confers a grant and none were seeded in shared Access. Transfer
reversal requires `finance.journals.reverse`. Full journal/transfer views require
scope over every non-control line; account activity exposes only that account's
lines. The UI also needs the relevant view grants for its forms and history.
Existing `collector.finance.*` permissions remain separate.

All routes below are relative to `/api/finance` and implemented locally:

| Method / route | Payload / behavior |
| --- | --- |
| GET `/meta`, `/readiness` | Current phase, identity/grants, account kinds; storage/schema readiness. |
| GET `/accounts?asOf=YYYY-MM-DD` | Includes archived accounts within scope, with natural balance. |
| POST `/accounts` | `code,name,kind,glType?` and optional custodian/notes. |
| PATCH `/accounts/{id}` | `version` and changed name/custodian/notes only. |
| POST `/accounts/{id}/archive`, `/restore` | `version,reason`. |
| GET `/accounts/{id}/activity?asOf=YYYY-MM-DD` | Opening-through-cutoff debit/credit/running balance and attribution. |
| GET/POST `/opening-balances` | List or create with `accountId,effectiveDate,amount,reason,evidenceReference`. |
| POST `/opening-balances/{id}/approve` | `reason`. |
| POST `/opening-balances/{id}/post` | No JSON body; independently approved request. |
| GET `/journals`, `/journals/{id}` | Posted immutable headers/lines. |
| POST `/journals` | `effectiveDate,sourceReference,reason,lines[{accountId,debit,credit,memo?}]`. |
| PATCH/DELETE `/journals/{id}` | Always 405 after authorization; use reversal. |
| POST `/journals/{id}/reverse` | `effectiveDate,reason`. |
| GET/POST `/transfers` | List or create with `fromAccountId,toAccountId,effectiveDate,amount,sourceReference,reason,method,referenceNumber?`. |

The browser uses the shared `threejmain_token`, same-origin requests unless an
`apiBase` is supplied, and server-provided grants. It freezes the entire write
payload and request key in user-specific localStorage **before** sending. Network
uncertainty, 5xx and expired auth retain the request for exact retry after reload;
definitive rejection clears it for correction. An unresolved request blocks new
writes in that client. Unavailable browser storage prevents financial writes.
Treat persisted payloads as sensitive shared-device data; this contains reason/
evidence references, not attached receipt files. Cross-tab exclusion and browser
interaction/accessibility testing remain integration review items.

## Shared PostgreSQL migration handoff — later phase

The default store uses the shared `DATABASE_URL` and existing `psycopg`; missing
driver, DSN, database or Finance tables yields 503, never memory fallback or
automatic schema creation. `realDataReady` reports storage availability only,
not verified opening coverage or source/report completeness. Explicit test
memory reports `realDataReady=false`. No separate database/environment is used.

Migration export `finance.migrations.MIGRATIONS` contains the runner-compatible
`id`, `description`, `statements` structure. ID is
`2026101201_finance_foundation`. Its SQL creates six relational tables:
`finance_accounts`, `finance_journal_entries`, `finance_journal_lines`,
`finance_opening_balances`, `finance_operations`, `finance_audit_events`; journal
numbers use a PostgreSQL identity sequence. Amounts, source uniqueness, approval
identity and foreign keys are normalized; account presentation/state evidence,
line snapshots, metadata and replay results use JSONB. No source-module FKs or
business sample rows are introduced. The only seed is opening-equity control.

Integration Codex must separately lock and update the shared runner
`app-shell/api/app/db_migrations.py` to append the exported definitions once,
after establishing the Finance package import/copy paths. The existing runner
checks statement checksums in `schema_migrations`; keep this reviewed SQL stable
once applied and use new IDs for later changes. Do not run raw SQL separately,
create a second migration ledger, or call the runner from a Finance request.
Shared Docker packaging must copy the entire API package including its SQL file;
adding only `router.py` is insufficient. Add these tables, functions/triggers,
identity sequence state and shared migration records to backup/restore coverage.

Then register the explicit Access grants, inject shared auth/scopes, mount the
page/router at the metadata paths, and bridge module audit evidence to shared
Logs without making audit delivery a second uncoordinated financial write.
Source integration remains a later phase. Shared migration/runtime deployment
requires its own coordination locks and reviewed integration task. This phase
does not edit any of those shared files or apply its migration to public schema.

## Verification and remaining gates

From repository root, without ports or runtime changes:

```bash
PYTHONPATH=features/finance/api python3 -m unittest discover -s features/finance/api/tests -p test_finance_foundation.py
node --test features/finance/web/tests/financeApi.test.mjs
```

Opt-in PostgreSQL tests require `psycopg` and `FINANCE_TEST_DATABASE_URL` pointing
to an authorized test database. Supply it without logging credentials, then run:

```bash
PYTHONPATH=features/finance/api python3 -m unittest discover -s features/finance/api/tests -p test_finance_postgres.py
```

Each PostgreSQL case creates an isolated schema inside an outer transaction,
uses nested savepoints and rolls back all DDL/data. It never commits/applies
shared migrations or drops shared tables. Verification on 2026-10-12: 24 local
Python tests, 26 executed PostgreSQL tests and 5 browser-client tests passed;
one independent-worker PostgreSQL concurrency case is skipped because those
workers cannot see the rollback-only schema. Memory concurrency tests cover
competing outflows and duplicate retries. JSX/JS/CSS static transforms pass.

Before shared release, run independent-connection/process posting, replay and
archive races in a provisioned isolated durable test database; verify shared
runner checksums/readiness, permission revocation and scoped actors; review the
page with the staging shell, keyboard/focus behavior and shared API URL. Source
feeds, period closure, reconciliation, pagination/large-ledger query optimization,
expense categories/payables, recognized revenue/costing, cash-flow/profit reports
and subscriber histories remain later phases. No production deployment or
live visual verification is claimed for this module-local delivery.
