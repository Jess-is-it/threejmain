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
- Page shell uses the shared app-shell `container-xl` width and left/right boundaries exactly like Billing; Collector must not add an inner centered max-width or mobile negative margins.
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
- Personal GCash collection with required unique transaction reference
- Immediate idempotent Billing payment posting
- Automatic A2P SMS attempt after every successful payment using sender ID `3J BILL`
- Billing-numbered 80 mm browser-print receipt
- Unlimited audited receipt reprints using the same receipt number
- Collector custody totals split by cash and GCash
- Remittance batch submission and personal-to-company GCash transfer reference
- Finance count/verification, channel-specific variance, accepted resolution note, and settlement
- Role/permission enforcement and shared audit events

## Core Decisions

Billing is authoritative for invoice balances, payment allocation, payment status, and receipt numbers. Collector stores only operational reservation, receipt-link, custody, print-history, and remittance data.

Collector calculates and submits oldest-first `allocations` from the one amount received, and the API independently reconstructs the expected allocation before posting. For an invoice with a Billing quote, the promotion IDs are attached only when the remaining received funds can pay the full `discountedPayable`; otherwise the invoice receives an ordinary partial payment without the promotion. Amounts spanning invoices continue automatically.

When received money exceeds the aggregate discounted payable, the collector must choose whether the excess becomes `advanceAmount` or `returnedAmount`. A promoted payoff and advance may coexist in one receipt because the promotion is posted as a separate Billing credit; Collector custody still contains only actual received funds. Billing stores immutable advance value and separate future credit-application records.

Promotion choice, stacking, eligibility, discount math, and final revalidation belong only to Billing. Collector transports the ordered `promotionIds`, `promotionQuoteDate`, and `promotionQuoteFingerprint`. A stale date, changed balance, changed bundle, or manipulated allocation returns HTTP 409 and requires the collector to refresh before accepting payment.

Customer payment is posted immediately when the collector confirms collection. Finance confirmation changes `custodyStatus` from `SUBMITTED`/`UNDER_REVIEW` to `SETTLED`; it must not create a second Billing payment.

All collectors see all customers because the business has no fixed customer assignments. Tapping Collect silently creates a short internal reservation to prevent concurrent payment entry; the user never performs a separate claim step.

Personal GCash is treated as collector-held company money. The customer transaction reference is recorded at collection; the collector-to-company reference and Finance's company receipt reference are recorded during remittance.

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
```

Remittance:

```text
SUBMITTED -> CLOSED
SUBMITTED -> VARIANCE -> CLOSED
```

Posted Billing payments and receipt identifiers are immutable. Reprints append print events only.

## API Contracts

`GET /api/collector/customers` returns Billing account aging rows enriched with Customer Profiling contact/location and the current internal reservation. Account rows include `outstandingBalance`, `promotionDiscountTotal`, `payableToday`, and `paymentDate`; each open invoice includes an authoritative `promotionQuote` with version, fingerprint, ordered promotion IDs/names, discount, and discounted payable.

`POST /api/collector/collections` requires:

- stable `Idempotency-Key`
- active automatic reservation owned by the posting collector
- customer, net posted amount, amount received, returned amount, payment method, automatic invoice allocations, and optional `advanceAmount`
- allocation-level Billing `promotionIds`, `promotionQuoteDate`, and `promotionQuoteFingerprint` whenever an automatic full-payoff promotion applies
- allocation total plus advance amount exactly equal to the collected amount
- exact server-reconstructed oldest-first allocation; clients cannot skip to a newer invoice
- all current invoices fully settled by payment plus promotion credit before any advance amount is accepted
- unique GCash transaction reference for GCash

It returns the Collector collection record with the Billing payment id, official receipt number, allocation/promotion snapshot, amount received, returned amount, applied amount, promotion discount, advance amount, invoice balance before/after, account credit before/after, SMS status, custody status, and print history.

`POST /api/collector/collections/{id}/print-events` appends `ORIGINAL` for the first print and `REPRINT` for later prints. It does not call Billing or A2P.

`POST /api/collector/remittances` submits held collections. `POST /api/collector/remittances/{id}/confirm` records Finance count/verification and either closes or flags the batch.

## Persistence

Migration: `2026072801_collector_records`

Unique controls:

- `(record_type, idempotency_key)` for collections
- case-insensitive GCash reference for active posted GCash collections

The module uses a PostgreSQL advisory transaction lock and reloads shared records inside mutations before persisting JSONB snapshots.

## Roles

- `collector`: collect and submit remittance
- `collection_supervisor`: collect, supervise, confirm, and resolve variance
- `finance_officer`: Finance overview and confirmation
- admin/owner roles: full access

The restricted app shell redirects Collector/Finance roles to `/collector`. Admin users retain Collector in the main navigation.

## Receipt And Android Printing

Receipt HTML is generated from the persisted collection/Billing snapshot, escaped before insertion, and opens in a separate browser window. It shows the regular balance, each applied promotion and discount, actual payment, advance when present, and remaining balance. It uses `window.print()` and an 80 mm print layout. The Android device needs a compatible Bluetooth printer print service/app.

The first print is original. Every later request reuses the Billing receipt number and adds a visible `REPRINT COPY N` marker plus an audit event. Reprinting never reposts the payment or resends SMS.

## Known Boundaries And Risks

- Offline payment capture is not implemented. Collection posting needs network access so Billing can revalidate the balance.
- Quotes are intentionally day-bound. Leaving a payment form open across a Billing business-date boundary produces a refresh-required conflict rather than honoring a stale Early Bird quote.
- SMS depends on enabled and valid A2P Messaging settings; failures are retained on the collection and do not roll back the receipt.
- Collector explicitly passes `source="3J BILL"` to the shared System Settings A2P sender; it does not rely on the global default Sender ID.
- Collector SMS wording excludes the receipt number and labels `balanceAfter` as the customer's total `Remaining balance`, not as a single-invoice balance.
- The SMS starts `Thank you, <first name>! We received your payment of P<amount>.` It then shows the remaining balance when positive or `Your account is now fully paid.` whenever the balance is zero. Advance-credit details are intentionally excluded. Name fallback uses the first word of the customer display name and then `Customer`.
- Browser printing depends on the Android print-service/printer application and cannot guarantee the printer completed a physical print.
- Billing and Collector use separate durable module transactions. Stable idempotency makes a failed Collector-link retry safe if Billing committed first, but cross-module distributed transactions are not available.
- An advance receipt that has already funded a future invoice cannot be voided until a controlled credit-application reversal workflow exists.
- Billing payment reversal synchronization into Collector custody is deferred. Finance must not settle a receipt that Billing has subsequently voided until that contract is added.
- GPS evidence, signatures, photos, promises-to-pay, permanent collection runs, and advanced reporting are deferred.

## Verification

Run:

```bash
python3 -m unittest features/collector/api/tests/test_collector_workflow.py -v
```

Covered: automatic-reservation collision, server-enforced oldest-first partial/multi-invoice allocation, automatic promo forwarding, stale/manipulated quote rejection, partial-payment promo protection, promoted payoff plus advance, returned excess/change, payment/SMS/idempotent replay, audited reprint, GCash validation/duplicate reference, Finance settlement, and independent cash/GCash variance detection.
