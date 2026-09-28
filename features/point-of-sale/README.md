# Point of Sale

Point of Sale owns counter checkout, receipts, payment capture, user-attributed sales history, and retail sales reports.

The working shell exposes this module at `/point-of-sale`. Register checkout automatically attributes each sale to the logged-in user account. POS-owned fallback items, register sessions, register sales, and register payments are durable in the shared PostgreSQL `pos_records` table when `POINT_OF_SALE_STORAGE=postgres` or `DATABASE_URL` is configured; Billing invoice payments remain stored in Billing.

Current scope:

- Register checkout screen with a sellable Inventory menu, cart, customer/walk-in selection, discount/tax, and payment capture
- Invoice Payments workspace for customer Billing invoice settlement, with a customer-grouped payable queue, selectable open invoices, automatic Billing-eligible discounts, payment capture, and Billing ledger posting
- Office Stock tab for non-sales check-out/check-in of active stock-tracked Inventory items through Inventory `ISSUE` and `RETURN` movements
- Sellable catalog data from Inventory items marked `sellableInPos`, shown inside the Register checkout menu instead of a separate Catalog tab
- Sales dashboard/history with today's sales metrics, low-stock KPI side panel, and separated history tabs for Register receipts, Invoice Payment receipts, and Office Stock movements. Invoice Payment receipts open as branded official receipt sheets with invoice-period particulars, remaining-balance period detail, a sheet-style PDF download, and 80 mm print output. Each history view has local search, filter, show-entries, and pagination controls.
- Payment capture during Register checkout with cash, GCash, card, bank transfer, check, and other methods; each posted payment records a server `postedAt` timestamp and payment state is shown in Sales history
- Dashboard metrics for today's sales, transaction count, active sellable items, and low stock

Integration notes:

- Inventory is the canonical item master and append-only stock ledger. POS reads sellable items from Inventory and posts stock movements when sales are completed or voided. When both modules use PostgreSQL, POS passes its active database connection to Inventory so the sale, payments, stock balance, and movement entries commit or roll back together.
- Completed sale line items are immutable. Stock or item corrections use a void and replacement sale, preserving both the financial record and Inventory movement history.
- Billing owns invoices, promotion qualification, stacking, discounts, rebates, and the payment ledger. POS owns customer-facing invoice payment intake and posts Billing payment records with `collectionChannel=POS`, selected invoice allocations, and allocation-level `promotionIds` bundles returned by Billing. Invoice payment dates are capped at the current business day in POS and revalidated by Billing before posting.
- `GET /api/point-of-sale/readiness` reports whether POS register storage is using PostgreSQL and lists active POS record counts.
- ISP internal inventory stays outside POS checkout: office stock check-out/check-in is posted as Inventory movements, while technician custody and customer-assigned CPE should use Inventory assignments as that workflow matures.
- Customer Profiling can provide optional customer lookup when wired through the shared shell; walk-in sales do not require it.
- Invoice payment settlement is currently integrated with Billing; POS retail register sales remain separate from the Billing ledger.

Current API prefix: `/api/point-of-sale`.

See `PROJECT_MODULE_CONTEXT.md` for local routes, CRUD scope, dependencies, risks, and integration notes.
