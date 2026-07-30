# Collector

Collector is the mobile field-payment and office-remittance portal for 3J Computer and Internet. Collectors use Android phones to view active customer accounts and their Billing balances, open the saved location, accept cash or personal GCash payments, send an SMS confirmation, and print or reprint an 80 mm thermal receipt. Finance separately verifies the physical cash and the transfer from the collector's GCash account to the company GCash account.

## Implemented Product Rules

- Billing remains the financial ledger. A successful field collection immediately posts one immutable, idempotent Billing payment with `collectionChannel=COLLECTOR`.
- The customer invoice balance changes immediately after collection. Finance confirmation settles collector custody; it does not delay or duplicate the customer payment.
- There are no permanent customer assignments. Every authorized collector sees the same collectible worklist.
- Tapping `Collect` automatically reserves that customer for 15 minutes while the payment form is open. There is no separate claim step. Closing the form releases the customer; the short expiry protects against abandoned browser sessions.
- The worklist search filters immediately while the collector types; no Search button or network round trip is required. A location dropdown groups the loaded customer pool by saved barangay, city, and province (falling back to the saved address), and both filters can be combined or cleared together.
- The collector enters one `Amount received`; there is no invoice or allocation choice. The system automatically applies it to the oldest invoice first and carries any remainder to the next invoice. A partial amount leaves the oldest invoice `PARTIALLY_PAID`.
- The payment modal keeps every open bill visible even while `Amount received` is blank or being edited. To keep the mobile task simple, each row shows only the billing month, net amount due, a short automatic-discount note when applicable, and one plain allocation state; invoice numbers, plan names, due dates, and technical allocation totals are intentionally hidden.
- A single `Use full amount` shortcut restores the current net amount due. Posting remains disabled until a positive valid amount is entered.
- Billing adds an authoritative daily promotion quote to every collectible invoice. Collector shows the regular balance, automatic savings, and discounted amount due without exposing a promotion selector. If the amount received can fully pay an invoice's discounted payable, Collector attaches Billing's ordered promotion IDs; a smaller partial payment is applied without granting the full-payoff promotion.
- When the amount received exceeds the discounted total due, a confirmation popup shows the excess and asks whether to store it as advance account credit or return it to the customer. Returned excess is excluded from the posted payment and collector custody.
- Every applied promotion carries Billing's quote date and fingerprint. Collector and Billing both revalidate the invoice balance and promotion immediately before posting and reject a stale or manipulated quote with a refresh instruction.
- Billing owns the immutable advance-credit ledger. A receipt may settle all current invoices with automatic promotion credits and store the remaining funds as advance. Available credit is applied FIFO to the customer's next generated monthly invoice with a separate audit record; an advance receipt already used by an invoice cannot be voided.
- Cash and GCash both use the same `Amount received` field. GCash additionally requires only the customer's transaction reference.
- A successful payment automatically attempts an A2P confirmation SMS to the customer's saved or entered SMS number using sender ID `3J BILL`. The concise message thanks the customer by first name and shows either the remaining customer balance or a fully-paid confirmation; it does not include the receipt number or advance-credit details. SMS failure is recorded but never rolls back the Billing payment.
- The official receipt number comes from Billing. The receipt snapshots the regular balance, promotion name/discount, actual payment, and remaining balance. Every print request is audited; later copies keep the same receipt number and are marked `REPRINT`.
- A collector remits all selected held receipts as separate expected cash and GCash totals. GCash batches require the transfer reference to company GCash.
- Finance records the physical cash count and company GCash receipt. Exact batches close as settled; shortages or overages remain a variance unless Finance explicitly accepts them with a note.
- Cash and GCash variances are evaluated independently, so an overage in one cannot hide a shortage in the other.

## Routes

App-shell route:

```text
/collector
```

Collector login:

```text
/collector
```

API prefix:

```text
/api/collector
```

Endpoints:

- `GET /health`, `/meta`, `/readiness`, `/overview`
- `GET /customers`
- `POST /customers/{customer_id}/claim`
- `DELETE /claims/{claim_id}`
- `GET/POST /collections`
- `GET /collections/{collection_id}`
- `POST /collections/{collection_id}/print-events`
- `GET/POST /remittances`
- `GET /finance/overview`
- `POST /remittances/{remittance_id}/confirm`

`POST /collections` requires an `Idempotency-Key` header.

## Mobile Workflow

1. Open `/collector` on the Android phone and sign in with an issued Collector account.
2. Search the shared active-customer worklist by customer, account, invoice, or address.
3. Tap `Collect`; the portal silently reserves the customer while the payment form is open.
4. Review the always-visible open-invoice ledger, regular balance, automatic promo savings, and amount due today. Enter the amount received or use the full-amount shortcut; the ledger previews the oldest-first allocation without hiding invoices while the amount is blank.
5. If enough is received to fully pay an invoice at its discounted payable, its Billing-qualified promotion is applied automatically. Partial payments do not consume the promotion.
6. If the amount is greater than the discounted total due, choose `Apply excess as advance` or `Return excess to customer` in the confirmation popup.
7. For GCash, record the unique customer transaction reference.
8. Post the payment. Billing revalidates the quote, issues the receipt, posts promotion credits separately, updates invoice balances, and records any chosen advance credit.
9. The system attempts the customer SMS with the remaining customer balance or fully-paid confirmation.
10. Print the receipt through the Android browser's print flow and paired Bluetooth thermal-print service.
11. Reopen Receipts at any time to print the same receipt again. A reprint never posts another payment or sends another SMS.
12. At the office, submit held cash and transfer held GCash to the company account.
13. Finance counts/verifies both channels and closes or records a variance for the batch.

The receipt uses the existing browser `window.print()` pattern, an 80 mm page target, and escaped server data. Android must have a printer-vendor or ESC/POS print service capable of receiving browser print jobs; direct Bluetooth socket access is intentionally not performed by the web page.

## Persistence And Integration

Operational records use the shared PostgreSQL database:

```text
collector_records
  reservation (`claim` internally)
  collection
  remittance
```

The table has durable unique controls for collection idempotency keys and posted GCash references. Collector stores Billing payment/receipt links plus custody and print history, not a second invoice or payment ledger.

Provider contracts:

- Customer Profiling supplies identity, contact, address, and coordinates.
- Billing supplies active accounts, collectible aging, versioned automatic-promotion quotes, account credit, canonical payment posting, and automatic future-invoice credit application.
- System Settings supplies authentication, permissions, and A2P SMS.
- Logs receives reservation, payment, SMS, print, remittance, settlement, and variance audit events.

## Roles And Permissions

- `collector`: customer worklist, automatic payment-entry reservations, payment collection, receipts, and remittance submission.
- `collection_supervisor`: collector actions plus Finance review and confirmation.
- `finance_officer`: receipt visibility, remittance review, Finance confirmation, and variance handling.
- `owner`, `admin`, `system_admin`: full Collector access.

Permission codes:

```text
collector.portal.view
collector.payment.collect
collector.remittance.submit
collector.finance.view
collector.finance.confirm
```

## Research And Controls

The implementation follows the enterprise boundary that payment channels originate a transaction while the billing/payment component owns the official ledger:

- [TM Forum Payment Management API TMF676](https://www.tmforum.org/open-digital-architecture/open-apis/payment-management-api-TMF676/v4.0)
- [Oracle Communications BRM payment allocation](https://docs.oracle.com/en/industries/communications/billing-revenue/15.0/payments/allocating-payments1.html)
- [Oracle Communications BRM Collections](https://docs.oracle.com/en/industries/communications/billing-revenue/15.2/billing-care-help/collections1.html)
- [Microsoft Field Service mobile](https://learn.microsoft.com/en-us/dynamics365/field-service/mobile/overview)
- [PCI Security Standards](https://www.pcisecuritystandards.org/standards/)
- [Philippine BIR Revenue Regulation 7-2024](https://bir-cdn.bir.gov.ph/BIR/pdf/RR%20No.%207-%202024.pdf)
- [Philippine National Privacy Commission principles](https://privacy.gov.ph/gpa-resolution-on-achieving-global-data-protection-standards-principles-to-ensure-high-levels-of-data-protection-and-privacy-worldwide/)

Collector does not store card numbers, PINs, CVVs, or magnetic-stripe data. Promotion discounts are Billing credits and never enter Collector custody or Finance remittance totals. Advance credit cannot coexist with unpaid current invoices: every current invoice must first be settled by its actual payment plus any Billing-posted promotion credit. GPS evidence, offline payment queues, promises-to-pay, permanent collection runs, reversal synchronization, and advanced reports remain deferred.

## Tests

```bash
python3 -m unittest features/collector/api/tests/test_collector_workflow.py -v
```

The workflow suite covers reservation collision, server-enforced oldest-first allocation, automatic promotion forwarding, stale-quote rejection, partial-payment promo protection, promoted payoff plus advance, returned excess/change, Billing posting and replay, SMS, receipt reprinting, GCash duplicate prevention, remittance settlement, and channel-specific variance handling.
