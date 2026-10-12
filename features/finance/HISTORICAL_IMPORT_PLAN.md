# Historical income import and cutover plan

Current integration also requires the fourth reports migration and nineteen
Finance tables; see [PHASE5_REPORTING.md](PHASE5_REPORTING.md). The original
Phase 4 money boundary below remains unchanged.

This is the integration execution plan for Phase 4, not permission to apply
application migrations or import customer transactions now. Finance implements
only OPENING_THEN_FORWARD. Pre-cutover financial events and reference-only
migration records are retained as evidence with zero new journal/collection.

## Boundary and evidence

Choose first forward effective date **C**, Asia/Manila. Reviewed holdings and
itemized opening balances cover through **C−1** inclusive. Import financial
effects dated C or later only; knowledge/arrival time never changes that boundary.
A late-arriving old receipt remains historical evidence, not current cash.
Using UTC timestamps or import creation dates as money dates is unsafe.

Prepare source-owned consistent snapshot IDs for Billing, POS, Collector and
Service and their durable ordered feed/cursors. Each snapshot must certify
coverage from at least C, retained originals and all later reversals/tombstones.
Current visible lists, mutable display totals, latest status dates or audit
timestamps alone cannot certify a complete feed. Source owners must resolve
history quality and omitted/deleted records before activating imports.

The opening bundle includes:

- Every active named financial holding, including zero holdings and credit-card
  liabilities, tied to approved Finance openings/prior journal activity through
  C−1 and counted cash/bank/company-wallet/custody evidence. These funds are not
  posted again during source baseline activation.
- Each Billing invoice/POS sale ID and remaining AR, with customer identity for
  Billing. Include zero-AR invoices when they still carry deferred consideration.
  Itemize deferred service consideration; its sum must equal deferredAmount.
- Every original advance receipt/rebate adjustment ID, customer, credit kind and
  remaining unused credit. Consumed original amounts are not reusable openings.
- Each unremitted Billing receipt ID, retained amount, customer, collector asset
  account and CASH/GCASH leg. Sums must equal each collector account's opening
  funds exactly. This permits a forward remittance without importing old cash.
- Source-owned itemized legacy obligations, installation references and history
  quality. Obtain opening refund entitlement evidence separately where needed;
  Phase 4 cannot ingest or pay those entitlements until the source-control
  contract is defined. Actual prior money cannot be inferred from REFERENCE_ONLY
  migration evidence.

Plan creator captures immutable opening journal/account fingerprint and evidence
reference. A different authorized reviewer certifies the bundle; wildcard grants
do not bypass independence. All active financial accounts and dated balances must
match. Finance rejects activity already dated C or later, uncertified custody,
existing imported source controls or changed opening evidence. Prepare a new
draft if evidence changes before approval/activation.

Activation posts only itemized accounting-control openings: AR/POS AR,
customer-credit and deferred liabilities, balanced to opening equity on C−1.
No holding-account debit, receipt, revenue or expense is created. Money had
already entered the approved holding baseline. A zero control baseline needs no
journal. One ACTIVE plan is allowed and cannot be edited/replaced/deactivated
through the Phase 4 API.

## Dry run and integration sequence

1. Provision an authorized isolated test database and register all three Finance
   migration definitions there in order. Keep application/public data untouched
   while validating provider contracts and backup/restore coverage.
2. Freeze and export source snapshots with their high-watermarks. Review actual
   dates, immutable IDs, original allocation/advance splits, line/sale discounts,
   tax, credit origins, fund identity and void/refund dispositions. Strip current
   registered mobiles; do not treat source JSON floats as values to round.
3. Reconcile the itemized opening bundle to independent source statements and
   approved Finance holding balances. Explain every difference; no plug to
   revenue/expense. Confirm whether any existing posted Finance activity already
   represents those funds or obligations.
4. Create/independently approve/activate the cutover in the isolated test fixture.
   Independently approve effective-dated named settlement maps. Test every
   Billing/POS/Collector duplicate visibility and late historical event.
5. Replay the certified feeds from the snapshot cursors. Check original receipt
   uniqueness, invoice/credit daily balances and custody claims. Missing mapping,
   dependency or financial disposition must retain an exception and hold the
   checkpoint. Repeat crash/retry and separate-worker races.
6. Tie Finance AR/credits to Billing's authoritative as-of reports, POS payments
   to retained POS receipts, custody to Collector and controlled funds to actual
   statements. Compare like dates/scopes, not billed-month customer settlement
   against bank remittance. Explain open variance clearing separately.
7. Integration Codex completes assigned shared page/router/auth/grant/provider/
   migration/backup wiring. Stage and review actual source-provider permissions,
   current-role revocation, missing-provider behavior and browser recovery.
   User-authorized production rollout follows the normal shared release workflow.

## Duplicate prevention and stop conditions

After activation, source effects before C cannot post money. Cutover-certified
holdings cannot receive a second opening, and new backdated financial journals
cannot alter the certified pre-C boundary. Future newly created zero holdings
can receive a separately reviewed initial balance without rewriting the opening
bundle; map them only when their source institution identity is proved.

Canonical Billing payment claims count a POS invoice collection and its Billing
receipt once. Remittance/custody links do not add receipts. Stable source event,
financial effect, receipt, original credit, remittance-leg and reversal identities
prevent replay after restart. Changed immutable source evidence blocks the page;
never reset cursors, delete claims, relabel dates or clear browser pending state
to bypass an exception. Independent workers compare the fetched cursor again.

An uncertain sync action must first retry its exact saved key/payload. Once
confirmed, a corrected mapping/dependency retry is a new sync action. Reusing
the earlier successful request key intentionally returns the earlier result,
including its blocked-page outcome.

Stop rollout if source snapshot coverage is incomplete, omitted voids cannot be
reconstructed, original credit/customer allocation is missing, custody does not
tie, actual refund/transfer dates or accounts are unknown, or opening/source
totals differ without independently reviewed evidence. No Finance-owned customer
receipt should be invented to repair a source issue.

Full historical financial replay **instead of** openings would need a different
reviewed implementation: complete source histories, zero/independently validated
starting balances, original cost/recognition policy and a single authoritative
baseline. It is not an available Phase 4 mode and must never be mixed with the
current opening-then-forward mode for the same holdings/control period.

## Known historical and correction limits

Pre-C receipts with no Finance journal cannot be reversed as imported current
cash. A forward refund for old money needs source-certified refund entitlement
and opening liability/AR/advance/custody ties, plus actual movement evidence.
That dedicated opening-refund contract is a prerequisite for affected histories;
unsupported cases remain exceptions rather than a fabricated new receipt.

Phase 4 supports one full source-authorized receipt correction/refund per posted
original. Partial refunds, sales-return entitlement, net gateway settlements,
earned rebate attribution, deferred-to-earned schedules, historical cost layers
and final discrepancy loss/receivable/surplus classification require their
assigned later contracts. Current Inventory unitCost cannot supply historical
COGS; current Service activation/state dates cannot supply missing delivery
history. Reports must retain provisional/unavailable status until those ties
and policies exist.
