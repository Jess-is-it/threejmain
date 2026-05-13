# Point of Sale Module Context

This is the module-local source of truth for Point of Sale implementation details. Keep ordinary POS progress here when it affects future POS work. Do not use the main `Project_Context.md` for routine module updates.

## Module Layout

```text
point-of-sale/
  api/point_of_sale/__init__.py
  api/point_of_sale/router.py
  web/PointOfSalePage.jsx
  web/pointOfSale.css
  README.md
  module.json
  PROJECT_MODULE_CONTEXT.md
```

## API

FastAPI router:

- Package: `point_of_sale`
- Router file: `api/point_of_sale/router.py`
- Prefix: `/api/point-of-sale`
- Storage: in-memory lists for sales and payments. Sellable items come from the Inventory module when available. A hidden system-managed register record may be created per logged-in POS user to preserve backend compatibility, but sessions are not a user-facing workflow.

Local routes:

- `GET /api/point-of-sale/meta`
- `GET /api/point-of-sale/overview`
- `GET /api/point-of-sale/customers`
- `GET /api/point-of-sale/items` reads active Inventory items marked `sellableInPos`
- `POST /api/point-of-sale/items` legacy fallback only; returns `405` when Inventory is connected
- `PATCH /api/point-of-sale/items/{item_id}` legacy fallback only; returns `405` when Inventory is connected
- `DELETE /api/point-of-sale/items/{item_id}` legacy fallback only; returns `405` when Inventory is connected
- `GET /api/point-of-sale/sessions` legacy/internal compatibility route
- `POST /api/point-of-sale/sessions` legacy/internal compatibility route
- `PATCH /api/point-of-sale/sessions/{session_id}` legacy/internal compatibility route
- `POST /api/point-of-sale/sessions/{session_id}/close` legacy/internal compatibility route
- `DELETE /api/point-of-sale/sessions/{session_id}` legacy/internal compatibility route
- `GET /api/point-of-sale/sales`
- `POST /api/point-of-sale/sales`
- `PATCH /api/point-of-sale/sales/{sale_id}`
- `DELETE /api/point-of-sale/sales/{sale_id}`
- `GET /api/point-of-sale/payments`
- `POST /api/point-of-sale/payments`
- `PATCH /api/point-of-sale/payments/{payment_id}`
- `DELETE /api/point-of-sale/payments/{payment_id}`

## CRUD Scope

Current in-memory CRUD scope:

- Sellable catalog: read-only in POS, sourced from Inventory item master by `sellableInPos`, status, sale price, barcode, tracking type, and available stock
- POS operator attribution: sales store the logged-in account username/display name; the frontend no longer asks users to open or choose a cashier session.
- Sales: sale number, receipt number, logged-in POS user, optional customer, walk-in support, sale date, line items, discount, tax, payment status, void flow, Inventory movement posting
- Payments: backend sale-payment records created during checkout; no standalone frontend workspace

## Dependencies

- Customer Profiling: optional lookup provider for named customers. Walk-in sales must remain valid without a customer.
- Inventory: canonical item master and stock ledger. POS reads sellable catalog items from Inventory and posts `ISSUE` movements on checkout, `RETURN` movements on sale void/reversal.
- Billing: future handoff for invoice settlement or billing-related receipt posting. Current POS payments are local only.
- Account Admin/shared auth: current source of POS operator identity. Sale records store the authenticated account username/display name.

## Frontend

- `Register` is the primary POS checkout screen. It shows the sellable Inventory catalog as a checkout menu, a cart, walk-in/customer selection, discount/tax fields, payment method/reference, and complete-checkout action.
- `Catalog` is a read-only POS view of Inventory sellable items. Item creation and maintenance happen in Inventory.
- `Sales` combines the old overview dashboard metrics with posted-receipt history, refresh, and void actions. The Low Stock KPI opens a right-side panel with low-stock items instead of rendering a persistent table in the Sales page.
- There is no standalone `Payments` tab. Payment capture belongs in `Register`; payment status/balance belongs in `Sales`.
- There is no standalone `Sessions` tab. Register checkout is attributed to the logged-in account automatically.

## ISP Business Model Notes

- Inventory must support both revenue items and internal assets. Examples: customer-sold routers/cable/service fees, customer-assigned CPE, office supplies, and technician-borrowed tools.
- POS should only sell items explicitly marked `sellableInPos`. Technician borrow/return and office/internal assignment should stay in Inventory assignments, not POS sales.
- Serialized items sold in POS require one line per unit with a serial number, validated by Inventory.
- Customer equipment installs should eventually link Inventory assignments to Customer Profiling, Service, and Ticketing records. Current IDs remain placeholders.
- Non-stock service charges, such as installation fees, may appear in POS without decrementing inventory.

## Integration Notes

- Integration Codex should import `point_of_sale.router` into the shared API shell and call `configure_point_of_sale(...)`.
- API shell must load `inventory/api` before `point-of-sale/api` if POS should use Inventory helpers in-process.
- Integration Codex should import `web/PointOfSalePage.jsx` into the shared React shell and add the `/point-of-sale` route/navigation.
- Dockerfiles, Vite allowlists, app-shell route wiring, and shared dashboard metrics are integration responsibilities, not module-local responsibilities.
- Keep the module API free of direct imports from `app-shell`.

## Risks

- Data is not durable; all POS data resets when the API process restarts.
- Inventory movement posting is still in-memory and not transactional across modules. A database-backed ledger is needed before production.
- Payment records do not integrate with Billing, cash drawer hardware, receipt printing, or external gateways yet.
- Customer lookup is optional and depends on integration wiring.
- No role-based POS permission checks are enforced in the module yet.
