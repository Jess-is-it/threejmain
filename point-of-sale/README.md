# Point of Sale

Point of Sale owns counter checkout, receipts, payment capture, user-attributed sales history, and retail sales reports.

The first working shell exposes this module at `/point-of-sale` with in-memory sale and payment records. Register checkout automatically attributes each sale to the logged-in user account.

Current scope:

- Register checkout screen with a sellable Inventory menu, cart, customer/walk-in selection, discount/tax, and payment capture
- Read-only sellable catalog from Inventory items marked `sellableInPos`
- Sales dashboard/history with today's sales metrics, low-stock KPI side panel, receipt numbers, logged-in POS user, optional customer placeholder, discounts, tax, Inventory stock movement posting, and voiding
- Payment capture during Register checkout with cash, GCash, card, bank transfer, check, and other methods; payment state is shown in Sales history
- Dashboard metrics for today's sales, transaction count, active sellable items, and low stock

Integration notes:

- Inventory is the canonical item master and stock ledger. POS reads sellable items from Inventory and posts stock movements when sales are completed or voided.
- ISP internal inventory stays outside POS checkout: technician-borrowed tools, office/internal supplies, and customer-assigned CPE are handled as Inventory assignments.
- Customer Profiling can provide optional customer lookup when wired through the shared shell; walk-in sales do not require it.
- Billing settlement and invoice handoff are intentionally deferred until the POS CRUD surface is stable.

Current API prefix: `/api/point-of-sale`.

See `PROJECT_MODULE_CONTEXT.md` for local routes, CRUD scope, dependencies, risks, and integration notes.
