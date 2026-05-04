# Point of Sale

Point of Sale owns counter sales, receipts, payment capture, cashier sessions, shift totals, and retail sales reports.

The first working shell exposes this module at `/point-of-sale` with an in-memory CRUD implementation.

Current scope:

- Item catalog CRUD with SKU, category, price, stock, reorder point, taxable flag, and status
- Cashier session CRUD with open/close workflow, opening float, expected cash, closing cash, and variance
- Sales CRUD with receipt numbers, line items, optional customer placeholder, discounts, tax, stock decrement, and voiding
- Payment CRUD with cash, GCash, card, bank transfer, check, and other methods
- Dashboard metrics for today's sales, transaction count, open shifts, active items, and low stock

Prerequisites and placeholders:

- Inventory is a future dependency for durable item/stock movement records. POS currently keeps local seed items and stock counts.
- Customer Profiling can provide optional customer lookup when wired through the shared shell; walk-in sales do not require it.
- Billing settlement and invoice handoff are intentionally deferred until the POS CRUD surface is stable.

Current API prefix: `/api/point-of-sale`.
