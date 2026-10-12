# Finance Management source integration contracts

Current Phase 5 report contracts are in [PHASE5_REPORTING.md](PHASE5_REPORTING.md).
Finance now implements ledger/report projections and the whole-cohort Billing
report adapter. Certified live feeds, stable row identity hooks and dated
Service/Billing history remain source-owner integration work.

Reviewed 2026-10-12 from the shared working tree on `staging`, including existing
uncommitted module changes. This is a design-time snapshot, not a release
certificate. Phase 4 now implements Finance-owned adapters and typed posting
contracts in [PHASE4_INCOME_COLLECTIONS.md](PHASE4_INCOME_COLLECTIONS.md); the
source-owned feed hooks are still pending. The broader payload/feed designs
below remain proposals where they differ from that executable v1 contract.
[HISTORICAL_IMPORT_PLAN.md](HISTORICAL_IMPORT_PLAN.md) defines the certified
opening-versus-forward boundary. Graphify identified
module entry points; source code, not inferred edges or older context warnings,
determined the contracts below.

## 1. Reviewed evidence

Read each module's `PROJECT_MODULE_CONTEXT.md` and inspected these source files:

| Module | Source / inspected symbols |
| --- | --- |
| Billing | `../billing/api/billing/router.py`: `PaymentPayload`, `PaymentAllocationPayload`, `AdjustmentPayload`, `BillingRecordStore.queue_audit/_save_audits`, `monthly_collection_performance`, `receivables_aging_summary`, `collection_postings_as_of`, `list_payments`, `list_migration_payment_evidence`, `get_service_account_billing_summary`. |
| POS | `../point-of-sale/api/point_of_sale/router.py`: `SalePayload`, `PaymentPayload`, `sale_summary`, `sale_total_amount`, `create_sale`, `update_sale`, `delete_sale`, `list_payments`, `update_payment`, `delete_payment`; posted sale line normalization. |
| Collector | `../collector/api/collector/router.py`: collection/remittance payloads, `configure_collector`, `finance_overview`, `resolve_reversed_collection`, `confirm_remittance` and permission checks. |
| Service | `../service/api/service/router.py`: `ServiceAccountPayload`, `service_account_snapshot`, `migrate_existing_service_line`, `mark_account_status`, `apply_order_lifecycle_effects`, account/order list routes. |
| Customer Profiling | `../customer-profiling/api/customer_profiling/router.py`: `configure_customer_profiling`, customer lookup/list and subscriber migration routes; `current_contact.py` is the shared current-contact normalization/hydration boundary described by the updated contexts. |
| Inventory | `../inventory/api/inventory/router.py`: `ItemPayload`, `MovementPayload`, `item_summary`, `pos_item_snapshot`, movement list/create/reverse and POS helpers; module context specifies the shared relational storage/immutability contract. |

Current root context corroborates app-shell provider injection, shared durable
tables and `2026101001_customer_contact_ownership`. Shared Access's current
permission registry includes `collector.finance.view` and
`collector.finance.confirm`, not Finance Management's proposed permissions.

## 2. Current contracts by owner

### Billing: canonical customer finances

Current prefix `/api/billing`; shared `billing_records` JSONB and durable
`billing_posting_events`. Invoice/payment/adjustment financial writes are
transactional and idempotent; posted records are immutable and corrections
retain void attribution. Posting events contain operation ID, action/target,
actor, details and created time. These are durable audit events, **not** an
already published Finance outbox with guaranteed full financial payloads.

Read contracts:

- `GET /invoices` and `/invoices/{id}`: source invoice identity, customer,
  subscription/line references, invoice type, billing cycle/issue/due dates,
  line amounts, adjustments, posted cash/credit applications, balance/status.
- `GET /payments`: Billing payment ID/receiptNumber, amount, paymentDate,
  server postedAt, method/reference, collectionChannel and operator attribution,
  allocations, advanceAmount, tenderedAmount/returnedAmount, promotion evidence
  and void fields. Legacy single invoiceId shapes remain valid allocations.
- `GET /adjustments`: CREDIT/DEBIT, amount, source classification and invoice or
  customer-credit application mode. SERVICE_REBATE and PAYMENT_PROMOTION are
  noncash; the credit is not a second receipt.
- `GET /subscriptions`, `/installation-charges` and
  `/service-accounts/{serviceAccountId}/summary`: Billing-owned active terms,
  fee decisions, current line debt/schedule. Service's cached balance fields
  are not authoritative current financial balances.
- `GET /collection-performance?billingMonth=YYYY-MM&asOf=YYYY-MM-DD`: monthly
  service invoice cohort grouped by unique customer. Includes
  netBilledAmount, cashCollected, accountCreditsApplied, rebatesApplied,
  outstandingAmount, subscriberCollectionRate, cashCollectionRate,
  applicability flags, reconciliationVariance, receivables, rows and pagination.
  Top-level totals cover the cohort, not just the returned page. Reuse them.
- `GET /collections/worklist` and `/collections/accounts/{customerId}`:
  all-period as-of collectible accounts; selected-month cohort and operational
  arrears are separate scopes.
- `GET /migration-payment-evidence`: imported `REFERENCE_ONLY` records with
  `excludedFromCashReports=true`. Reconstructed historical invoice debt or a
  reviewed Legacy Opening Balance is collectible, but not new cutover revenue.

Current Billing arithmetic: invoice net billed = max(0, line subtotal + posted
debit adjustments - posted credit adjustments); paid/settled value includes actual
payment allocations plus credit applications. Cohort reconciliation:
`netBilledAmount - cashCollected - accountCreditsApplied - outstandingAmount`.
Direct invoice credits already reduce netBilledAmount. `rebatesApplied` overlaps
other credit breakdowns and must not be deducted again. Source cash means
receipt allocations, not necessarily company-wallet funds settlement.

Advance credit stays on original payment; separate FIFO credit_application rows
consume it. Customer-level rebate credit similarly consumes its original
adjustment; no new receipt. A source with consumed credit cannot currently be
voided. POS intake carries `collectionChannel=POS`, Collector intake
`collectionChannel=COLLECTOR`, but receipt owner stays Billing in both cases.
Promotions/whole-peso rebates remain Billing-calculated and revalidated.

**Finance consumption:** receive canonical receipt once; journal its AR/advance
split and named funds mapping, separately ingest noncash credit/recognition
effects. Delegate debt and bill-cohort reports to Billing. Never duplicate the
receipt through POS or Collector, or treat issue-time account summaries as new
charges. Need a source-owned immutable export/feed of financial effects,
including credit_application IDs and reversals, plus actual funds disposition
for voids. No dedicated general refund entitlement/payout contract was found;
do not invent a callable refund endpoint.

### POS: register business versus Billing invoice intake

Current prefix `/api/point-of-sale`; `pos_records` holds items/fallback sessions,
register sales and register payments. Invoice Payments UI reads/writes Billing
directly. Its SMS confirmation endpoint does not create another receipt.

- `GET /sales`: sale ID/number/receipt, optional customer (walk-ins valid),
  saleDate, lineItems, line item/serial references, subtotal, discountAmount,
  taxAmount, total, paidTotal, balance, paymentStatus, inventoryMovementIds and
  cashier attribution. Source total = sum net line amounts - sale discount + tax.
- `GET /payments`: payment ID/number, saleId, retained amount, method/reference,
  paymentDate, immutable initial postedAt, status and tender/change. Cash tender
  is not revenue/cash retained; use amount, not tenderedAmount.
- Register checkout POST /sales is durably idempotent. It shares its PostgreSQL
  transaction with Inventory for issued stock; sale line corrections require
  void plus replacement, not editing lineItems.
- Current PATCH /sales permits notes or reasoned void only; financial/date/
  customer/line edits are rejected. PATCH /payments rejects financial changes.
  Reasoned DELETE retains original sale/payment and void actor/reason/time,
  reverses stock idempotently and voids linked payments. Ordinary lists still
  omit soft-deleted sales; Finance must consume retained originals plus
  explicit correction/tombstone evidence. No certified Finance feed exists.
- Office Stock writes Inventory ISSUE/RETURN with referenceType=OFFICE_STOCK;
  these are not sales, receipts or payments.

**Finance consumption:** POS register sale is delivery/earned-price evidence;
register payment is receipt evidence. Do not sum both as income, or ingest POS
invoice-payment confirmation as a register payment. Link returned stock to the
original issue cost. Source discount, tax and void corrections need explicit
revision/financial effect events including deleted records; polling visible
lists would silently miss corrections. Missing historic cost snapshots prevents
historic POS gross margin even though sale prices/quantities exist.

Some older POS context risks still say stock integration is in-memory; current
source/root context and Inventory's newer contract confirm atomic durable POS
stock posting when PostgreSQL is configured. The outdated warning is not used
as the Finance design assumption. Current POS permissions are enforced and Billing/Inventory reads/delegated
writes use explicit POS-authorized boundaries. Full counted-drawer closing
and certified finance exports remain dependencies.

### Collector: custody and verification

Current prefix `/api/collector`; shared `collector_records`. Collection and
Billing payment/custody link commit together; source lock order is Collector
before Billing. New production collection posting requires that durable shared
transaction. SMS/reprint attempts occur separately and never create money.

- `GET /collections`: collection ID, billingPaymentId/receiptNumber,
  amount/method/date, allocation/advance/change evidence, collector identity,
  status, custodyStatus, remittance/settlement links. A list is a current view,
  not an immutable stream of historical custody changes.
- Collection custody: HELD -> SUBMITTED -> SETTLED, or UNDER_REVIEW -> SETTLED.
  Held Billing void coordinates POSTED/HELD -> VOID/VOID in the same transaction.
  Submitted/remitted receipts currently block Billing void.
- `GET /remittances`: `{items,total}`, scoped to actor permissions; submissions
  hold collectionIds, expected Cash/GCash totals, declared cash, GCash transfer
  amount/reference and company account label.
- `GET /finance/overview` requires `collector.finance.view`; it exposes open
  batches, collectionItems, listedCollectionTotal and pendingReversals. UI
  convenience totals/recent lists are not full accounting history.
- `POST /remittances/{id}/confirm` requires `collector.finance.confirm` and
  compares countedCash and confirmedGcashAmount independently to expected
  amounts. It stores cashVariance/gcashVariance/totalVariance, company reference,
  Finance actor, receivedAt/closedAt and notes; no new Billing receipt.
  Remittance is SUBMITTED -> CLOSED or VARIANCE -> CLOSED; linked item count,
  totals and Billing posting status are checked before settlement.
- `POST /finance/reversed-collections/{id}/resolve` records
  REFUNDED_TO_CUSTOMER, DUPLICATE_ENTRY_NO_FUNDS or OTHER_ACCOUNTED, reason,
  optional reference and reviewedAt/by. GCash refunds require a reference.
  This disposition does not include a separately verified actual refund date
  or a full refund journal contract; reviewedAt is not proof of funds timing.

**Finance consumption:** use Billing receipt as canonical collection; use
Collector only to identify held cash versus due-from-personal-GCash, verified
transfer and variance. Confirm through the existing source action/permissions.
Require future immutable custody/confirmation revisions and actual movement
date/evidence, plus variance classification. A resolved OTHER_ACCOUNTED label
is insufficient to guess a GL posting. Cash remittance is internal; personal
GCash realization is funds movement without new earned income. Do not reverse
a settled receipt through Finance to bypass Collector/Billing guards.

### Service: internet lines and lifecycle

Current prefix `/api/service`; shared `service_records`. `GET /accounts` returns
Service Account/customer/catalog IDs, serviceAccountNumber/reference, status,
activationDate, billing dates/terms, latest status-related dates and migration
metadata. `GET /orders` supplies order IDs/type/state, linked line and Ticket,
completion/ownership information. `GET /catalog` is current plan context.

Lifecycle includes PENDING_INSTALLATION, ACTIVE, SUSPENDED,
PENDING_DISCONNECTION, DISCONNECTED, PENDING_RECONNECTION, TERMINATED, CANCELLED.
`mark_account_status` stores latest suspension/reconnection/disconnection dates;
repeated cycles overwrite latest-date fields. `apply_order_lifecycle_effects`
also changes plan/address/owner. These are not a complete append-only effective
history of state, customer ownership and rate changes.

Migration creates an ACTIVE/SUSPENDED existing installed line directly without
fabricating a NEW_INSTALLATION order/ticket. `activationDate` can fall back to
cutover date when original start is absent; suspended imports use cutover for
suspensionDate. These dates cannot certify historical new growth/suspensions.
Line/customer status sync makes Customer Profiling status a derived summary.

**Finance consumption:** current snapshot supports distinct current lines and
customers. History/growth/recognition must request source-owned dated lifecycle
and ownership events plus certified baseline/history-quality fields. Historical
MRR needs Billing's effective rate terms as well; current catalog price alone
does not suffice. Operations state is not automatically a revenue policy.

### Customer Profiling: identity and migration evidence

Current prefix `/api/customer-profiling`; shared `customer_profiles`.
`GET /customers` and `/customers/{id}` supply stable ID/account number, current
identity/address/location and contacts. Customer 360 consumes source modules,
not a competing financial ledger. Reviewed subscriber-migration batch/result
routes connect imported profile IDs to Service lines, Billing obligations and
reference-only payment evidence.

Customer Profiling owns current primary/alternate mobile. Billing, Service,
POS and Collector strip copied operational mobiles at persistence boundaries
and hydrate responses through the current-contact resolver. Finance stores IDs
and necessary immutable financial document identity/address evidence, never
mobile mirrors. Resolve current contacts only when needed; no Finance SMS
workflow is introduced. SMS delivery destination remains source delivery history.

**Finance consumption:** use customerId and current authorized identity display;
request historical location/owner dimensions from the event snapshot if a report
claims historical attribution. Current province/location filters cannot silently
represent past ownership/location. Profile createdAt is not first subscription
activation. Imported profiles/lines are baseline additions rather than new growth.

### Inventory: physical stock and incomplete costing

Current prefix `/api/inventory`; relational inventory_items/locations/balances/
stock_movements/assignments. `GET /items`, `/balances`, `/movements`,
`/assignments` expose item/current quantity/location/custody. Movements are
RECEIVE, ISSUE, ADJUST, TRANSFER, RETURN with quantity, source/destination,
source reference, actor, idempotency/fingerprint and reversalOfId. Movement
UPDATE/DELETE return 405; reversal is another immutable entry with DB trigger
protection and transaction/row-lock balance controls.

Inventory POS helpers read sellable items, validate stock and post checkout
issues/void returns with the POS database connection. Item `unitCost` is an
editable current master value; `stockValue` uses current quantity * unitCost.
MovementPayload contains no unit cost, supplier invoice, landed-cost layer or
cost-flow allocation. POS normalized sale lines snapshot prices/quantities,
not a certified historical cost ledger. Procurement/advanced costing and
normalized serial/lot lifecycle remain future work.

**Finance consumption:** consume item/issue/return/source references for evidence,
but require Inventory-owned valued movement/receipt cost layers before COGS or
historic valuation. Finance owns accounting capitalization/depreciation, while
Inventory retains physical ownership/quantity/assignment. An assignment may
retain a company asset at a customer's premises; it is not automatically a sale
or expense. Office Stock use requires consumption/return purpose and valuation.

## 3. Proposed adapter boundary (not implemented)

Finance should define a `configure_finance(...)` boundary for authenticated
actor/permission checker, audit logger, customer resolver, source-feed readers,
Billing report provider, Service lifecycle snapshot/feed and Inventory valued
movement provider. Integration Codex supplies adapters from source-owned modules;
Finance never imports the shared shell or writes another module's internal lists.

Current APIs can support authorized reference lookups or a provisional current
view. They are not a guarantee of complete incremental accounting. Source teams
must provide a versioned snapshot and ordered durable change feed including
hidden/deleted records before accounting ingestion goes live. Finance may stage
unknown events and show exceptions, but cannot publish them as complete totals.

Proposed feed response:

```json
{
  "contractVersion": 1,
  "sourceModule": "billing",
  "snapshotId": "source-owned-snapshot",
  "coverageStart": "2026-10-01",
  "completeThrough": "opaque-durable-watermark",
  "nextCursor": "opaque-next-cursor-or-null",
  "events": [
    {
      "eventId": "source-owned-immutable-id",
      "recordType": "payment",
      "recordId": "billing-payment-id",
      "recordVersion": 1,
      "eventType": "PAYMENT_POSTED",
      "occurredAt": "2026-10-12T06:00:00Z",
      "effectiveDate": "2026-10-12",
      "canonicalReceiptOwner": "billing",
      "canonicalReceiptId": "billing-payment-id",
      "operationId": "source-operation-id",
      "reversesEventId": null,
      "payload": {
        "currency": "PHP",
        "amount": "1000.00",
        "customerId": "source-customer-id"
      }
    }
  ]
}
```

This envelope is a proposal, not the output of current GET /payments. Source
payload schemas additionally need complete allocation/credit/line references,
tax breakdown, method/channel, operator, actual funds evidence where relevant
and migration/history flags. Unsupported versions fail explicitly; do not
guess missing fields. Stable ordering uses an opaque source sequence/cursor,
not timestamps alone. Initial consistent snapshot includes source tombstones
and snapshot high-watermark; consume later events without a gap. A shared
snapshot across dependent modules or dependency-aware replay is needed for
Collector links that arrive before their Billing event.

Feeds must emit phone-free operational financial payloads; do not persist a
hydrated GET response containing current customer mobiles as immutable financial
evidence. Only explicitly identified historical source evidence (such as an
original import document or SMS delivery attempt) retains its evidence fields
under the existing contact-ownership contract and restricted access policy.

Uniqueness: source `(module,eventId)`; canonical receipt
`(owner,receiptId)`; journal effect `(canonical/source identity,effectKind,
recognitionPeriod,revision)` under a defined revision policy. Same identity and
same hash is replay; changed immutable-event payload is an integrity exception.
Corrections must carry a new event/reversal identity. Preserve raw evidence;
superseding mapping policy requires an explicit reverse/repost operation rather
than reposting the same event under another mapping version.

For money mapping use approved effective-dated mappings by source channel,
operator/custodian, method and institution reference. Method CASH or GCASH alone
does not identify an account. Unmapped events stay in funds clearing with an
exception; they cannot enter named-account balances as though mapping existed.
Collector personal-wallet and company-wallet identities must remain distinct.

Finance ingestion commits source evidence, balanced journal, audit and cursor
atomically; retry after restart is duplicate-safe. Failures do not advance
checkpoint over unprocessed events. Recognition uses unique per-period effects.
Source receipt posting should remain available independently of Finance outages:
prefer source-owned durable outbox + asynchronous Finance ingestion. Live
Finance journal posting inside existing payment transactions is not authorized
by this phase and requires a separately reviewed integration/lock-order design.

## 4. Required source effects and integration tickets

| Source owner | Proposed feed/evidence required | Finance effect / acceptance |
| --- | --- | --- |
| Billing | Invoice issued/corrected, payment posted/void with reason, credit created/applied/reversed, fee decisions, opening/migration flags, dated subscription terms. | AR/deferred/unbilled, receipt/advance, contra-revenue/customer liability, recognition; source balance reconciles to Finance control account. Cash disposition of void remains separate. |
| POS | Register sale delivery/revision/void including soft-deleted rows; payment posting/revision/void; explicit returned funds; stock issue/return references. | Revenue/receivable and receipt separately; corrections cannot disappear. Invoice-payment workspace never generates an additional Finance receipt. |
| Collector | Custody receipt link, submission/verification revisions, actual company transfer date/account evidence, refund date/amount/disposition, variance classification. | Held company cash or due-from-collector; one transfer/realization; independent variances. Changes neither Billing receipts nor source confirmation guards. |
| Service | Dated append-only activation/state/ownership events, baseline certified date, migration date quality, delivery/installation evidence. | Growth/ownership projection and recognition support; repeated suspensions/reconnections and imports reconcile without fabricated history. |
| Customer Profiling | Authorized customer resolver; reviewed migration profile/line map and historical identity/location evidence where available. | Stable identity and baseline attribution; no copied registered mobiles or new-customer counts from profile imports. |
| Inventory | Immutable valued receipt/issue/return and original cost references, landed-cost allocation, valuation method/version, company-retained asset classification. | Inventory/control/COGS/consumption/capitalization; original-cost returns, no current-cost history reconstruction. Physical stock remains source-owned. |
| Integration / System Settings / Logs | Finance route/router exports, permissions/role scopes, source adapters, shared migrations/backup coverage, audit/retry hooks and safe evidence storage. | Add shell integration only after implementation gates pass. No shared edit is included in Phase 1. |

Reconciliation must separately tie customer AR/credits to Billing, retained POS
receipts to POS, collector funds due to Collector, inventory quantity references
and valued accounting control to Inventory, and company funds to statements.
Never equate customer settlement with remittance settlement. Require exact-cent
ties or explicit attributed rounding exceptions, not silent tolerance balancing.

## 5. Research rationale and references

Existing scaffold research is retained in README.md. Fresh primary-source review
on 2026-10-12 supports these narrow design principles:

- [Odoo expense posting](https://www.odoo.com/documentation/18.0/applications/finance/expenses/post_expenses.html)
  separates approval from journal posting. Finance therefore separates approval,
  posting and settlement status rather than using one Paid workflow.
- [Odoo internal transfers](https://www.odoo.com/documentation/saas-18.2/applications/finance/accounting/bank/internal_transfers.html)
  supports transfer/clearing treatment between financial accounts. Finance uses
  separate transfer legs and treats remittance as a funds movement.
- [IFRS 15 summary](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-15-revenue-from-contracts-with-customers/)
  distinguishes consideration and fulfilled service obligations. Finance's
  proposed daily recognition schedule is a management policy derived from that
  principle, subject to ISP contract/delivery evidence; it is not specified by
  Billing's invoice timing.
- [IAS 2 summary](https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/)
  explains cost-based inventory and cost assignment. It supports requiring cost
  layers instead of reading today's item cost as historic COGS.
- [IAS 16 summary](https://www.ifrs.org/issued-standards/list-of-standards/ias-16-property-plant-and-equipment/)
  distinguishes qualifying long-lived assets and their costs. Finance's
  depreciation defaults need asset and useful-life evidence.
- [IAS 7 summary](https://www.ifrs.org/issued-standards/list-of-standards/ias-7-statement-of-cash-flows/)
  separates operating/investing/financing and noncash transactions. Finance's
  chosen management interest/card classifications require policy review before
  any statutory use.

These references guide product design, not an assertion that the ISP follows a
particular reporting framework or that this module prepares compliant tax filings.
