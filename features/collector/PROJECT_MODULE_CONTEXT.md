# Collector Module Context

## Current Status

- Status: `functional-portal`
- Route: `/collector`
- API prefix: `/api/collector`
- Frontend: `features/collector/web/CollectorPage.jsx`
- API: `features/collector/api/collector/router.py`
- Persistence: shared PostgreSQL `collector_records`, with in-memory fallback only for tests/local environments without `DATABASE_URL`.
- Integration: app-shell navigation, role-restricted portal/login, Billing, Customer Profiling, System Settings A2P, Logs, migrations, and Docker copy path are wired.

## Implemented Scope

- Shared active-customer worklist with outstanding balance and account credit sourced from Billing
- Customer contact/address/coordinates sourced from Customer Profiling
- Instant client-side worklist search across customer, account, contact, address, service, and invoice fields
- Worklist location filter built from each customer's saved barangay/city/province, with saved-address fallback
- Worklist `Message` action beside Map and Collect for a confirmation-gated, fixed customer-unavailable A2P notice; the API reloads Billing, uses the current promotion-adjusted amount due, sends from `3J BILL` to the saved primary/alternate mobile, and writes success/failure audit context. Accepted sends show a dedicated completion popup rather than the page-level inline notice.
- Worklist `Log visit` action records No one home, Promised to pay, Asked for another visit, or Account/address issue directly in Billing's durable follow-up history. A promise requires amount/date and an issue requires a note. The form has no next-action date. Billing automatically records a linked Payment received visit after successful Collector payment posting, in the same transaction; the worklist displays the latest visit outcome/time.
- Field visit saves use an idempotency key, a read-only status lookup, same-key retry after uncertain network failures, and current-tab session recovery. SMS remains a separate, explicitly confirmed action.
- Page shell uses the shared app-shell `container-xl` width and left/right boundaries exactly like Billing; Collector must not add an inner centered max-width or mobile negative margins.
- The four overview metric cards were removed from the top of the mobile page to expose the customer worklist sooner. Receipts shows today's posted collection total (including already remitted receipts); Remit keeps expected held Cash/GCash totals and shows the open remittance count in My remittances. Keep the `/overview` custody payload because the checklist compares it with held receipts before submission.
- Silent 15-minute reservation when Collect is tapped, with conflict prevention and automatic release when the payment form closes
- One collector-entered `Amount received`, automatically allocated oldest invoice first and then across later invoices
- No invoice-selection or allocation-mode choice in the mobile UI
- Payment entry uses one unified, always-rendered open-bill list: clearing or editing `Amount received` never hides the billing month or net amount due
- Each bill row is intentionally minimal: billing month, amount due, optional full-payment savings, and one plain automatic-allocation state. Invoice numbers, plan names, due dates, per-row regular-balance columns, and duplicate technical totals stay out of the collector UI.
- A full-amount shortcut restores the current net due and posting is disabled for blank/non-positive amounts
- Billing-authoritative per-invoice promotion quotes with quote date/fingerprint, ordered promotion IDs, automatic discount, and discounted payable
- Worklist/payment modal show regular balance, automatic promo savings, and amount due today; collectors cannot select or override promotions
- Full discounted invoice payoff applies the quoted promotion automatically; smaller partial payments do not grant the full-payoff promotion
- Excess-over-total-due popup with either advance account credit or immediate return/change
- Advance credit requires all current invoices to be fully settled by actual payment plus Billing promotion credits; Billing automatically applies available credit FIFO to the next generated monthly invoice
- Personal GCash collection with optional customer-to-collector reference; a nonblank reference is checked for duplicates, and the collector confirms receipt in their wallet before posting
- Final mobile review before posting, showing customer/account, received funds, method/reference, application, savings, returned/advance amount, custody amount, and expected remaining balance
- Immediate idempotent Billing payment posting
- 20-second payment request timeout with read-only status lookup by idempotency key, same-key retry, and durable per-user pending-attempt recovery after a tab/browser restart. Posting is blocked if the browser cannot persist the attempt.
- Billing payment, Collector receipt/custody link, and Billing payment audit commit on one shared PostgreSQL transaction; payment SMS remains a separate post-commit attempt.
- Automatic A2P SMS attempt after every successful payment using sender ID `3J BILL`
- Billing-numbered 80 mm browser-print receipt
- Unlimited audited receipt reprints using the same receipt number
- Collector custody totals split by cash and GCash
- Remit checklist and My remittances are scoped to the logged-in username even when a supervisor/admin can see every receipt through Finance permissions; the submission API independently selects only that actor's held collections
- Mobile remittance checklist of each held receipt, grouped by Cash/GCash, with explicit receipt review, a `Mark all reviewed` shortcut enabled only after collector-entered channel amounts match expected totals, channel variance explanation, and personal-to-company GCash transfer reference. Positive held amounts start blank so a collector enters the actual count/transfer before bulk review; changing an amount to a mismatch after full review clears checks.
- Finance count/verification, channel-specific variance, accepted resolution note, and settlement
- Same-transaction reversal of held custody when the linked Billing payment is voided; submitted/under-review/settled custody blocks Billing void. Held reversals remain in Finance's review queue until a documented funds disposition is recorded; GCash refunds require a reference.
- Billing posting-status checks before remittance submission and Finance confirmation, including older unsynchronized receipts
- Role/permission enforcement and shared audit events

## Core Decisions

Billing is authoritative for invoice balances, payment allocation, payment status, and receipt numbers. Collector stores only operational reservation, receipt-link, custody, print-history, and remittance data.

Billing also owns field-visit events in its `collection_case` history. Collector displays the latest Billing projection and calls the role-scoped Billing field-visit API directly for no-payment outcomes. No visit record is stored in `collector_records`, and logging a field visit does not set or change Billing's next-action date.

Collector calculates and submits oldest-first `allocations` from the one amount received, and the API independently reconstructs the expected allocation before posting. For an invoice with a Billing quote, the promotion IDs are attached only when the remaining received funds can pay the full `discountedPayable`; otherwise the invoice receives an ordinary partial payment without the promotion. Amounts spanning invoices continue automatically.

When received money exceeds the aggregate discounted payable, the collector must choose whether the excess becomes `advanceAmount` or `returnedAmount`. A promoted payoff and advance may coexist in one receipt because the promotion is posted as a separate Billing credit; Collector custody still contains only actual received funds. Billing stores immutable advance value and separate future credit-application records.

Promotion choice, stacking, eligibility, discount math, and final revalidation belong only to Billing. Collector transports the ordered `promotionIds`, `promotionQuoteDate`, and `promotionQuoteFingerprint`. A stale date, changed balance, changed bundle, or manipulated allocation returns HTTP 409 and requires the collector to refresh before accepting payment.

Customer payment is posted immediately when the collector confirms collection. Finance confirmation changes `custodyStatus` from `SUBMITTED`/`UNDER_REVIEW` to `SETTLED`; it must not create a second Billing payment.

All collectors see all customers because the business has no fixed customer assignments. Tapping Collect silently creates a short internal reservation to prevent concurrent payment entry; the user never performs a separate claim step.

Personal GCash is treated as collector-held company money. The customer transaction reference is recorded at collection when available; the collector-to-company transfer reference remains required during remittance, and Finance records the company's receiving reference when confirming it.

## States

Internal reservation:

```text
CLAIMED -> RELEASED
CLAIMED -> EXPIRED
```

Collection:

```text
status = POSTED
custodyStatus = HELD -> SUBMITTED -> SETTLED
                               \-> UNDER_REVIEW -> SETTLED
POSTED / HELD -> VOID / VOID when the linked Billing payment is voided
```

Remittance:

```text
SUBMITTED -> CLOSED
SUBMITTED -> VARIANCE -> CLOSED
```

Posted Billing payments and receipt identifiers are immutable. Reprints append print events only.

## API Contracts

`GET /api/collector/customers` returns Billing account aging rows enriched with Customer Profiling contact/location and the current internal reservation. Account rows include `outstandingBalance`, `promotionDiscountTotal`, `payableToday`, and `paymentDate`; each open invoice includes an authoritative `promotionQuote` with version, fingerprint, ordered promotion IDs/names, discount, and discounted payable.

The account rows also include `lastFieldVisit` (`outcome`, `at`, `collectorName`) from Billing. `POST /api/billing/collections/accounts/{customer_id}/field-visits` accepts a stable `Idempotency-Key`, one structured outcome, optional note, and promise amount/date only for `PROMISED_TO_PAY`. `GET /api/billing/collections/accounts/{customer_id}/field-visits/by-idempotency-key/{key}` returns `RECORDED` or `UNCONFIRMED` for the original collector. Billing rejects manually submitted `PAYMENT_RECEIVED`; its payment posting path creates that visit with `paymentId` and `receiptNumber` automatically.

`POST /api/collector/customers/{customer_id}/unavailable-message` requires collection permission and a saved customer mobile number. It reloads the collectible account, refuses zero/stale balances, calculates the current promotion-adjusted amount due on the server, and submits the approved visit notice through System Settings A2P with purpose `COLLECTOR_CUSTOMER_UNAVAILABLE` and sender ID `3J BILL`. The response exposes only the masked destination plus safe message identifiers; both A2P delivery logging and Collector business audit context are retained.

`POST /api/collector/collections` requires:

- stable `Idempotency-Key`
- active automatic reservation owned by the posting collector
- customer, net posted amount, amount received, returned amount, payment method, automatic invoice allocations, and optional `advanceAmount`
- allocation-level Billing `promotionIds`, `promotionQuoteDate`, and `promotionQuoteFingerprint` whenever an automatic full-payoff promotion applies
- allocation total plus advance amount exactly equal to the collected amount
- exact server-reconstructed oldest-first allocation; clients cannot skip to a newer invoice
- all current invoices fully settled by payment plus promotion credit before any advance amount is accepted
- optional customer-to-collector GCash transaction reference; a supplied nonblank value must be unique among posted GCash collections

It returns the Collector collection record with the Billing payment id, official receipt number, allocation/promotion snapshot, amount received, returned amount, applied amount, promotion discount, advance amount, invoice balance before/after, account credit before/after, SMS status, custody status, and print history.

`GET /api/collector/collections/by-idempotency-key/{key}` checks an uncertain payment without creating another payment. It returns the Collector receipt when present, `UNCONFIRMED` when neither accessible Collector nor Billing payment exists, or `NEEDS_OFFICE` plus the Billing receipt number if an older Billing-only post exists for the original collector or Finance. Mobile retry reuses the exact frozen payload and idempotency key. The pending attempt is kept in per-user browser local storage until resolved or definitively rejected; old current-tab session attempts are migrated. A different attempt cannot replace a pending one on the same device.

`POST /api/collector/collections/{id}/print-events` appends `ORIGINAL` for the first print and `REPRINT` for later prints. It does not call Billing or A2P.

`POST /api/collector/remittances` submits held collections. The Collector checklist sends `collectionIds`, `reviewedAllHeld=true`, `expectedCash`, and `expectedGcash`; submission rejects a missing/new receipt or changed expected channel total with HTTP 409. A Cash or GCash difference requires a note. Legacy callers can still submit selected held IDs without `reviewedAllHeld`. `GET /api/collector/finance/overview` enriches every open/recent remittance with `collectionItems`, containing each linked customer name, account number, receipt number, method, and payment amount plus `listedCollectionTotal` for Finance review. The UI and confirmation API block settlement when the linked item count or total does not match the remittance summary. `POST /api/collector/remittances/{id}/confirm` records Finance count/verification and either closes or flags the batch.

`GET /api/collector/finance/overview` also returns `pendingReversals` and counts/amounts for voided held receipts awaiting funds review. `POST /api/collector/finance/reversed-collections/{id}/resolve` requires Finance confirmation permission and persists an attributed disposition, note, and optional reference; GCash refunds require a reference. It never reposts or changes the Billing payment.

## Persistence

Migration: `2026072801_collector_records`

Unique controls:

- `(record_type, idempotency_key)` for collections
- case-insensitive GCash reference for active posted GCash collections

The module uses a PostgreSQL advisory transaction lock and reloads shared records inside mutations before persisting JSONB snapshots. Collection posting borrows Billing's active PostgreSQL connection, takes the Collector lock before Billing's lock, saves Collector custody before the shared commit, and dispatches Collector audit events only after that commit succeeds.

## Roles

- `collector`: collect and submit remittance
- `collection_supervisor`: collect, supervise, confirm, and resolve variance
- `finance_officer`: Finance overview and confirmation
- admin/owner roles: full access

The restricted app shell redirects Collector/Finance roles to `/collector`. Admin users retain Collector in the main navigation.

## Receipt And Android Printing

Receipt HTML is generated from the persisted collection/Billing snapshot, escaped before insertion, and opens in a separate browser window. Each new collection freezes `outstandingInvoicesBefore` and `outstandingInvoicesAfter` with invoice identifiers, stored billing-cycle dates, regular/net amounts, promotion discount, and balance. The 80 mm receipt derives readable month/year labels from those stored billing cycles (never the receipt date), shows invoice numbers only as small references, lists all outstanding months before payment, every month affected with Paid/Partial status and exact application, promotional detail under the applicable month, and all remaining unpaid months and balances. Payment summary and cash/GCash details follow those billing-period sections.

The first print and every later reprint use the same clean customer-facing receipt format and Billing receipt number; no reprint-copy banner is printed. Reprints still append an internal audit event and never repost the payment or resend SMS.

## Known Boundaries And Risks

- Offline payment capture is not implemented. Collection posting needs network access so Billing can revalidate the balance.
- Quotes are intentionally day-bound. Leaving a payment form open across a Billing business-date boundary produces a refresh-required conflict rather than honoring a stale Early Bird quote.
- SMS depends on enabled and valid A2P Messaging settings; failures are retained on the collection and do not roll back the receipt.
- The customer-unavailable message is an explicit collector action with a preview/confirmation step. It is not free-form, does not reserve the account, and is rejected if the customer has no saved primary or alternate mobile number or no longer has an amount due.
- Collector explicitly passes `source="3J BILL"` to the shared System Settings A2P sender; it does not rely on the global default Sender ID.
- Collector SMS wording excludes the receipt number and labels `balanceAfter` as the customer's total `Remaining balance`, not as a single-invoice balance.
- The SMS starts `Thank you, <first name>! We received your payment of P<amount>.` It then shows the remaining balance when positive or `Your account is now fully paid.` whenever the balance is zero. Advance-credit details are intentionally excluded. Name fallback uses the first word of the customer display name and then `Customer`.
- Browser printing depends on the Android print-service/printer application and cannot guarantee the printer completed a physical print.
- New Collector payments commit Billing and Collector records together in the shared PostgreSQL database. Older Billing-only posts from before this change remain possible in existing data; the status lookup identifies them for office investigation without taking another payment.
- The integrated app refuses new Collector payment posting when shared PostgreSQL storage is unavailable or the atomic Billing transaction is not configured. In-memory posting remains available only to isolated module tests that supply their own fake Billing provider.
- Browser local storage persists pending payments across tabs and restarts on the same device, but clearing browser data or losing the device can still remove the local retry payload. Payment posting refuses to start when local storage is unavailable.
- An advance receipt that has already funded a future invoice cannot be voided until a controlled credit-application reversal workflow exists.
- Remittance reversal and custody correction for a receipt already submitted or settled remain future work. Billing rejects payment voids for those receipts with HTTP 409; Finance confirmation also rejects a linked Billing payment that is void or missing.
- GPS evidence, signatures, photos, promises-to-pay, permanent collection runs, and advanced reporting are deferred.

## Verification

Run:

```bash
python3 -m unittest features/collector/api/tests/test_collector_workflow.py -v
node --test features/collector/web/tests/receiptDocument.test.mjs
```

Covered: automatic-reservation collision, permission-controlled customer-unavailable A2P messaging with a server-calculated promotional balance, server-enforced oldest-first partial/multi-invoice allocation, automatic promo forwarding, stale/manipulated quote rejection, partial-payment promo protection, promoted payoff plus advance, returned excess/change, payment/SMS/idempotent replay, scoped payment-attempt status lookup, audited reprint, GCash validation/duplicate reference, Finance settlement, independent cash/GCash variance detection, and month-first receipt rendering for multi-month, promoted, and partial payments.
