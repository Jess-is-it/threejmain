# Finance Management — Income & Collections

Current report handoff: [PHASE5_REPORTING.md](PHASE5_REPORTING.md). Phase 5 now
selects `ReportingService` and adds explicit report providers. Four ordered
migrations/nineteen tables are required. This earlier-phase guide retains its
historical contracts; no old SQL file or source-owner record was changed.

Phase 4 implemented 2026-10-12, module-local. The default router now uses
`IncomeService`, extending Expenses & Payables and the accounting foundation.
Accounts & Transfers, Expenses & Payables and Income & Collections are enabled.
App-shell, shared Access grants, source-owned feeds and application migration
registration remain integration work. No customer receipts are created here.

## Ownership and delivered structure

Billing owns subscriber invoices, receipts, allocations, promotions, rebates
and credit applications. POS owns register sales/payments; its invoice-payment
desk posts Billing receipts. Collector owns custody/confirmation/dispositions.
Service owns installation references. Finance stores certified source evidence,
immutable accounting mappings and journals; there is no Finance subscriber
receipt POST/PATCH/DELETE, collection desk or operational subscriber balance API.

| File | Responsibility |
| --- | --- |
| `api/finance/income_schemas.py` | Certified typed financial effects, settlement identities, income and cutover requests. |
| `api/finance/source_adapters.py` | Phone-free Billing/POS/Collector/Service record projections and provider protocol. |
| `api/finance/income.py` | Independent reviews, classified posting, source deduplication/reversal, cutover and exceptions. |
| `api/finance/income_storage.py` | Shared PostgreSQL repositories for inbox/results/claims/checkpoints and reviewed documents. |
| `api/finance/income_controls.py` | Nonspendable AR, deferred, customer-credit, POS, tax and discrepancy controls. |
| `api/finance/migrations/2026101203_finance_income.sql` | Six durable tables, version/immutability guards and deferred accounting checks. |
| `web/IncomeCollections.jsx`, `web/incomeClient.mjs` | Source evidence, manual inflow, mapping, reconciliation and cutover review; exact cents. |
| `api/tests/test_finance_income*.py`, `web/tests/incomeClient.test.mjs` | Invariant, permission/API, PostgreSQL and persistent-retry coverage. |

`MIGRATIONS` exports 2026101201_finance_foundation,
2026101202_finance_payables and 2026101203_finance_income in order. Previous SQL
definitions are unchanged. Readiness requires all eighteen Finance tables; no
automatic DDL, memory fallback, new DSN, new driver or application dependency.

## Accounting effects and classification

Money is exact PHP Decimal/NUMERIC(18,2); all API monetary values are strings.
Source dates are certified effective dates in Asia/Manila, attribution is UTC.
Source floats in current JSON are converted through decimal text and must
already have whole cents; adapters do not round binary artifacts or infer dates.
Future financial posting and historically negative holdings/obligations/credits
are rejected. Missing quantities/cost layers are not invented.

| Certified effect | Posting and boundary |
| --- | --- |
| Billing invoice | Dr Billing AR, Cr deferred service consideration. Use original charge lines, never current adjusted net balance. Issue creates no earned service income; Phase 5 supplies recognition. |
| Billing retained receipt | Dr explicitly mapped actual funds/custody asset, Cr Billing AR for each allocation and Cr customer-credit liability for retained advances. Allocations + advance must equal retained amount. Tender/change are excluded. |
| POS/Collector Billing receipt link | Match Billing payment ID, customer and retained amount. Link to the canonical original; no journal or collection amount. Missing/mismatched Billing evidence becomes an exception. |
| Billing invoice credit/promotion/rebate, deferred basis | Dr deferred consideration, Cr AR. Credit to a customer's reusable rebate balance credits customer-credit liability instead of AR. Classify PAYMENT_PROMOTION/SERVICE_REBATE once; do not subtract receipt promotions again. |
| Billing debit adjustment | Dr AR, Cr deferred consideration for source-certified invoice consideration. Unattributed/customer-credit debit corrections remain exceptions. |
| Advance/rebate credit application | Dr original customer-credit liability, Cr invoice AR. Consume original receipt/rebate credit ID with customer and dated balance checks; no cash or new revenue/rebate expense. |
| Earned/unknown-basis Billing rebate | RECOGNITION_REQUIRED exception. Phase 5 must attribute earned/deferred reductions to the supported service obligation; no guessed profit posting. |
| POS delivered register sale | Dr POS AR for net sale + tax; Dr discounts; Cr delivered POS revenue before line/sale discounts; Cr sales-tax liability. Source line discounts are restored to gross and included once in contra-revenue. Delivery evidence required; historic COGS/gross margin remain unavailable. |
| POS retained register payment | Dr mapped POS holding, Cr its sale AR. Payment and delivery are distinct events; retained amount, not tender, is collected once. |
| Collector remittance | Dr actual company receiving account, Cr linked held-cash/personal-GCash custody account. No income or additional collection. A personal-wallet realization changes controlled cash timing. |
| Remittance shortage/surplus | Difference between expected linked receipts and actual movement posts to nonspendable discrepancy clearing, with UNCLASSIFIED_VARIANCE exception. Never automatically classify a shortage as expense or surplus as income. Cash/GCash are separate legs. |
| Reference-only migration, pre-cutover evidence, fee decision, Service installation reference | Retain evidence/references, no monetary journal or collection. A waiver before a charge creates no fictional income. Legacy opening debt needs the reviewed itemized baseline, not a new invoice-income posting. |
| Manual other income | Dr actual asset holding, Cr reviewed non-control revenue GL. Required payer/purpose/date/document/evidence and independent approval. No subscriber/payment IDs or subscriber receipt creation. |
| Loan proceeds / owner loan | Dr actual holding, Cr reviewed loan liability; zero income, financing classification. |
| Owner contribution | Dr actual holding, Cr reviewed owner-equity GL; zero income, financing classification. |

The income workspace is a source-effects view, not cash-flow/earned-profit
reporting. `complete=false` is deliberate until Phase 5 reconciles recognition,
coverage and costing. Billing's as-of receivables/collection-performance reports
remain authoritative operational reports; Finance does not rebuild their cohort,
promotion, credit or allocation arithmetic. Integration can link/delegate to
those existing authorized read functions, keeping their own permissions/filters.

## Approval, evidence, permissions and audit

Manual documents are immutable intake: DRAFT -> SUBMITTED -> APPROVED or REJECTED;
approved documents separately become POSTED, then optionally REVERSED. There is
no editable posted entry. Prepare a new reviewed document with a distinct
reference to correct rejected/incorrect intake. Original evidence and decisions
remain. Named account mappings and cutover plans start DRAFT and require an
independent reviewer before APPROVED. Mappings can be RETIRED; cutover activation
is permanent in this phase. No creator self-approval/rejection, even with `*`.
Manual approval limits and current account scopes apply.

Generic journal posting cannot bypass manual income/funding/opening approval
by debiting a financial asset and crediting revenue/liability/equity. Use the
reviewed income/opening workflow or explicit card funding. Generic journal
reversal cannot alter source effects, cutover or manual-income entries; dedicated
source-owned or manual-income correction is required. Noncash foundation journal
corrections remain explicitly authorized through the existing grant.

Required evidence references are opaque references to organization-controlled
documents, not fetched/previewed URLs. This phase adds no manual-income upload
store. Existing secure Finance expense attachments retain their Phase 3 access
and retention boundary. Source evidence uses strict whitelisted fields without
registered mobile mirrors. Database/audit/backups remain private financial
evidence. Do not log provider credentials, bearer tokens or upload bodies.

| New grant | Purpose |
| --- | --- |
| finance.income.view | Own manual income and permitted account mapping/cutover views. |
| finance.income.view_all | Other users' income and source/reconciliation evidence; still constrained by account scope. |
| finance.income.create | Create/submit manual other income or classified funding. |
| finance.income.approve | Independent approval/rejection, optional amount limit. |
| finance.income.post / finance.income.reverse | Separate immutable posting / attributed manual reversal. |
| finance.settlement-mappings.manage / .approve | Prepare/retire maps / independently review. |
| finance.cutover.manage / .approve | Prepare/activate / independently certify cutover. |
| finance.sources.sync | Read approved provider pages and project source financial effects. Requires unrestricted account and expense-ID scope. |
| finance.reconciliation.acknowledge | Attributed acknowledgement; needs income view/view_all and exception account scope. |

`Actor` remains server-injected. No grant/username/source event/account mapping
is accepted as trusted authority from a browser. Full source journal/evidence
reads require income view/view_all and every involved account, including source
controls except opening equity. Unmapped/reference-only evidence with no proven
account scope is visible only to unrestricted reviewers. Own manual-document
access checks receiving/counterpart accounts. General account activity still
allows that permitted account's movements/reasons, independently of full source
or document access. New grants are not seeded in shared Access yet.

Creation, independent decisions, posting, reversal, mapping retirement, exception
creation/acknowledgement and sync are attributed and transactional. Posted source
events/results/claims are append-only; approved documents retain original review
decisions and fingerprints. Current scopes are checked on successful request
replay. Evidence hashes are not a replacement for source-owner authorization.

## Settlement mapping

`Settlement` is `(channel, operator, method, institution)`, not method alone.
Channels are POS/OFFICE/COLLECTOR/COMPANY; operator is the stable source username,
institution is the actual register/bank/wallet identity. Require an independently
approved effective range and the exact named account. Approved ranges cannot
overlap. Retiring a map affects new postings; saved journal/results retain the
original map IDs and account snapshots, and retries do not re-map old money.

POS/office/company CASH maps to cash/petty cash; GCASH to company GCash; bank
transfer to bank. Collector CASH maps to collector cash, GCASH to due-from-
personal-wallet custody; its account custodian must match the certified operator.
Gateway receipts remain unmapped until a reviewed gateway/fee/settlement contract
exists. A customer's card receipt is never a company credit-card liability.
Noncash receipts need their actual source reference.

Remittance legs verify every canonical receipt's retained amount, original
custody account, status and receipt date, or its certified opening-custody row.
Each `(Billing payment ID, leg)` can be remitted once. Destination must be a
company holding, distinct from source custody. A CLOSED source batch and a note
alone do not prove actual funds date/account; the provider must supply movement
evidence and actual effective date. Collector's source confirmation/permissions
remain in Collector; Finance never calls it implicitly or bypasses its guards.

## Immutable ingestion, reconciliation and reversal

Source inbox identity is `(source,eventId)`. Same immutable ID/hash is replay;
changed evidence is IMMUTABLE_SOURCE_CHANGED and holds the checkpoint. A second
event ID for the same unchanged financial record/effect links the first posting;
changed financial evidence requires retained source-owned correction and new
replacement identity. Source document/effect, canonical receipt, original credit
and custody/reversal claims enforce distinct uniqueness rules.

Sync fetches outside the Finance ledger transaction and compares the opaque
cursor again under the shared PostgreSQL writer lock. It never calls source
providers while holding Finance's lock. In one transaction it saves inbox rows,
successful mappings/journals/claims, exceptions/audit and, only when every page
event is finalized, the next checkpoint. A failed financial effect rolls back
its savepoint; other valid page effects can be retained without advancing past
the failure. Dependency-aware passes resolve out-of-order page references.
Retries after new mappings/dependencies use a new sync action; retrying an
uncertain HTTP action first confirms its saved exact result/key. Independent
workers serialize accounting and reject stale fetched cursors.

An open exception can become ACKNOWLEDGED with reason; acknowledgement does not
post, discard or financially resolve it. Missing mapping/dependency exceptions
become RESOLVED only after a successful mapped effect. Clearing variance remains
unclassified until a separately assigned reviewed loss/receivable/surplus
workflow exists; there is no arbitrary 'mark financially resolved' button.

Only the original source owner can supply SOURCE_REVERSAL. It carries original
event ID, source authorization/evidence/reason and explicit funds disposition:

- NONCASH_CORRECTION offsets the original invoice/sale/credit journal with a
  linked immutable reversal. Linked receipts/credit use must be corrected first
  whenever the original obligation/credit would otherwise become negative.
- DUPLICATE_NO_FUNDS for a receipt cancels on the original day, preserving the
  original and recording negative collection effect. It cannot apply to a
  remitted custody receipt or invent a later cash refund.
- REFUND for a receipt posts actual money out on the certified refund date and
  account, reverses original AR/advance counterparts and links the original
  source/journal. This can use company funds after collector remittance, rather
  than incorrectly debiting already cleared personal custody. Original gross
  receipt and separate refund remain visible. One full correction/refund per
  original; no partial refund entitlement is inferred.

Void status/review timestamp alone is insufficient. Full refund must preserve
dependency/credit balances and actual account funds. Pre-cutover receipts that
did not post a Finance journal cannot be reversed as newly imported money;
opening refund entitlement/source-control ties require the integration plan's
separate reviewed contract. Partial refunds, sales-return entitlement versus
receipt-void entitlement, gateway net settlements, earned rebates, recognition,
costing and variance financial disposition are explicit follow-ups.

## Provider hook and API contract

Integration injects source-owned providers:

```python
configure_finance(current_actor, store=PostgresStore(), source_providers={
    'billing': billing_provider,
    'point-of-sale': pos_provider,
    'collector': collector_provider,
    'service': service_provider,
})
```

Each implements `fetch(FeedRequest) -> SourceBatch`. Request fields are source,
snapshot_id, opaque cursor, bounded limit and actor_username. Providers must
apply source-owner authorization, use a source-owned consistent snapshot/feed,
and return strictly typed phone-free effects with stable event/operation/record
IDs, record versions, timezone-bearing occurredAt and actual effectiveDate.
Batch contract version 1 has source, snapshotId, cursor, nextCursor,
completeThrough, coverageStart and at most 500 events. The page cannot mix owners
or repeat event IDs; nonempty pages must advance. Snapshot/coverage/cursor/page
limit must match the active certified cutover. Invalid versions, missing proof
or provider failures reject without recording events or advancing checkpoints.

There are no default live providers. Missing hooks fail with 503 and the UI says
awaiting integration. Do not synthesize event IDs from timestamps or poll visible
GET lists. Source audit rows are not assumed to be full effect/outbox payloads.
Providers may call Finance adapters after supplying the certified proof; current
row status must be original posting evidence, not silently converted from VOID.
Separate source-owner effects carry later void/refund/tombstone evidence.

All mutations require Idempotency-Key. Routes relative to `/api/finance`:

| Routes | Contract |
| --- | --- |
| GET/POST `/income`; GET `/income/{id}` | Own/permitted manual documents; typed classified intake, no subscriber fields. |
| POST `/income/{id}/submit`, `/approve`, `/reject` | version/reason; immutable intake, independent review. |
| POST `/income/{id}/post`, `/reverse` | version for posting; effectiveDate/reason for reversal. |
| GET/POST `/settlement-mappings`; POST `/{id}/approve`, `/reject`, `/retire` | Typed settlement/account/date/evidence intake and attributed version/reason actions. |
| GET/POST `/cutover-plans`; POST `/{id}/approve`, `/reject`, `/activate` | Certified itemized boundary and independent version/reason review. |
| GET `/sources`; GET `/sources/events/{id}` | Permission-scoped source projection/original certified evidence, provider readiness and limited checkpoints. |
| POST `/sources/{source}/sync` | Only `{limit:100}`; client cannot submit source events or receive a collection ledger. |
| GET `/reconciliation-exceptions`; POST `/{id}/acknowledge` | Scoped exceptions; version/reason acknowledgement with no financial reclassification. |

## Integration requirements and verification

See [HISTORICAL_IMPORT_PLAN.md](HISTORICAL_IMPORT_PLAN.md) for the execution gate.
Billing needs immutable original charge/receipt/allocation/credit effect export
including legacy baselines and separate void/refund dispositions. POS needs
retained original COMPLETED sale/POSTED receipt plus correction/tombstone export,
delivery proof and actual settlement identity. Collector needs immutable
canonical links and confirmed per-leg actual movement/variance evidence, not
only current custody status or receivedAt. Service needs installation reference
export; future recognition uses separately certified delivery/period policies.
No other module or shared provider was edited in this phase.

Integration Codex registers three ordered migrations, copies the full package/
SQL files, seeds reviewed grants, injects current authenticated actors/providers,
wires the exported page/router, and includes six new tables/control seeds and
private evidence/history in backup/restore coverage. Preserve asynchronous
source posting: Billing/POS/Collector receipt availability must not depend on a
Finance outage. Any in-source-transaction Finance journal posting needs a
separate shared lock-order review. No new runtime ports or restart were used.

From repository root:

```bash
PYTHONPATH=features/finance/api python3 -m unittest discover -s features/finance/api/tests -p test_finance_foundation.py
PYTHONPATH=features/finance/api python3 -m unittest discover -s features/finance/api/tests -p test_finance_payables.py
PYTHONPATH=features/finance/api python3 -m unittest discover -s features/finance/api/tests -p test_finance_income.py
node --test features/finance/web/tests/*.test.mjs
# Only with an authorized test DSN and existing psycopg:
PYTHONPATH=features/finance/api python3 -m unittest discover -s features/finance/api/tests -p '*postgres.py'
```

PostgreSQL tests normally roll back private schemas. Dedicated concurrency tests
briefly commit only generated private finance_phase3_race_/finance_phase4_race_
fixtures for independent workers, drop only their exact fixture namespace and
verify absence. Application/public schema and data remain untouched. Source
provider tests use controlled certified fixtures; no real customer receipt,
remittance, refund, SMS or production action is performed. Live shared-browser,
source-provider authorization, delivery completeness, retention/quota and full
operational-versus-control reconciliation await integration.

Verified 2026-10-12: 70 local Python tests, 75 executed PostgreSQL tests
(78 discovered; three inherited fixture skips) and 14 Node tests pass. Eight
static JSX/JS/CSS transforms, Python syntax, JSON metadata, local documentation
links and whitespace checks pass. PostgreSQL includes actual independent-worker
posting/payment/account-archive and same-key/stale-cursor source-sync races.
Alias-targeted reversals, POS line/sale discounts and negated income reversal
metadata are included. No live shell/browser, source hook, shared-schema migration,
runtime rebuild or production verification was claimed.
