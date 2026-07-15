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

Office Stock frontend tab uses Inventory routes directly:

- `GET /api/inventory/items?status=ACTIVE&search=...` for active stock-tracked office/internal items
- `GET /api/inventory/movements` for the Sales tab Office Stock movement history filtered in the POS UI to `referenceType=OFFICE_STOCK`
- `POST /api/inventory/movements` with `ISSUE` for check-out and `RETURN` for check-in, using `referenceType=OFFICE_STOCK`

Invoice Payments frontend tab uses Billing routes directly:

- `GET /api/billing/meta` for payment methods
- `GET /api/billing/invoices?search=...` for the payable invoice queue
- `GET /api/billing/invoices/{invoice_id}/eligible-promotions?paymentDate=YYYY-MM-DD` for Billing-approved payment-time promo choices and `recommendedPromotionId`
- `GET /api/billing/payments` for the Sales tab Invoice Payments history
- `POST /api/billing/payments` to post invoice payments with `collectionChannel=POS`, optional `promotionId`, and a stable `Idempotency-Key` header retained for the lifetime of the payment form
- `DELETE /api/billing/payments/{payment_id}` to void a billing receipt from POS

## CRUD Scope

Current in-memory CRUD scope:

- Sellable catalog: read-only in POS, sourced from Inventory item master by `sellableInPos`, status, sale price, barcode, tracking type, and available stock
- POS operator attribution: sales store the logged-in account username/display name; the frontend no longer asks users to open or choose a cashier session.
- Sales: sale number, receipt number, logged-in POS user, optional customer, walk-in support, sale date, line items, discount, tax, payment status, void flow, Inventory movement posting
- Payments: backend sale-payment records created during checkout; no standalone frontend workspace
- Office Stock: frontend-only POS workspace for non-sales stock check-out/check-in. It creates Inventory movements, does not create POS sales, does not capture payments, and does not generate receipts.
- Invoice Payments: POS-owned customer invoice settlement workspace. It reads Billing invoices, loads Billing-approved eligible promotions for the selected invoice/payment date, auto-selects Billing's recommended promo such as qualified Early Bird, posts Billing payment records with optional `promotionId` and a stable idempotency key, enforces invoice-balance payment limits in the UI, and keeps invoice payment activity separate from POS retail sales.

## Dependencies

- Customer Profiling: optional lookup provider for named customers. Walk-in sales must remain valid without a customer.
- Inventory: canonical item master and stock ledger. POS reads sellable catalog items from Inventory and posts `ISSUE` movements on checkout, `RETURN` movements on sale void/reversal.
- Billing: canonical invoice, promotion, and billing-payment ledger. POS reads Billing invoices, asks Billing for eligible payment-time promotions, and posts Billing payment records for customer invoice settlement.
- Account Admin/shared auth: current source of POS operator identity. Sale records store the authenticated account username/display name.

## Frontend

- `Register` is the primary POS checkout screen. It shows the sellable Inventory catalog as a checkout menu, a cart, walk-in/customer selection, discount, payment method/reference, and complete-checkout action. Register no longer exposes a tax field.
- Register checkout intentionally ignores implicit Enter-key form submission; sales should post only when the operator clicks `Complete Checkout`.
- Register customer search performs a debounced Customer Profiling lookup while the operator types and shows selectable matching customer options under the search field.
- Register checkout requires the cashier to type a payment amount that covers the total due. The payment field is not auto-filled; attempting checkout without an amount shows a required-field warning, and cash payments show calculated change in the checkout summary.
- Clicking `Complete Checkout` now shows a fixed, highly visible checkout-result popup for both successful posted receipts and validation/API failures.
- `Invoice Payments` is the customer billing payment desk. It has open invoice KPIs, a payable invoice queue that live-filters while typing, selected-invoice payment capture, and a payment-time promotion selector populated by Billing eligibility rules. When Billing returns `recommendedPromotionId`, POS auto-selects it and fills the discounted amount to collect. Invoice payment customer columns display first and last name only, without account-number prefixes. Receipt history is intentionally not duplicated here.
- `Office Stock` mirrors the Register layout for internal stock movement. It lists active stock-tracked Inventory items, supports check-out/check-in cart lines, serialized item serial entry, person/team reference, location, notes, and posts Inventory `ISSUE`/`RETURN` movements.
- `Catalog` is a read-only POS view of Inventory sellable items. Item creation and maintenance happen in Inventory.
- `Sales` combines the old overview dashboard metrics with three separated history tabs: Register receipts, Invoice Payment receipts, and Office Stock movements. Each history table has local search, filter, show-entries, and pagination controls. Register and Invoice Payment histories retain void actions; Office Stock is read-only history sourced from Inventory movements with `referenceType=OFFICE_STOCK`. The Low Stock KPI opens a right-side panel with low-stock items instead of rendering a persistent table in the Sales page.
- There is no standalone `Payments` tab. Payment capture belongs in `Register`; payment status/balance belongs in `Sales`.
- There is no standalone `Sessions` tab. Register checkout is attributed to the logged-in account automatically.

## ISP Business Model Notes

- Inventory must support both revenue items and internal assets. Examples: customer-sold routers/cable/service fees, customer-assigned CPE, office supplies, and technician-borrowed tools.
- POS should only sell items explicitly marked `sellableInPos`. The Office Stock tab is a non-sales convenience screen for office/internal stock movement. Technician borrow/return that needs custody tracking should still become Inventory assignments in a later step.
- Serialized items sold in POS require one line per unit with a serial number, validated by Inventory.
- Customer equipment installs should eventually link Inventory assignments to Customer Profiling, Service, and Ticketing records. Current IDs remain placeholders.
- Non-stock service charges, such as installation fees, may appear in POS without decrementing inventory.

## Integration Notes

- Integration Codex should import `point_of_sale.router` into the shared API shell and call `configure_point_of_sale(...)`.
- API shell must load `features/inventory/api` before `features/point-of-sale/api` if POS should use Inventory helpers in-process.
- Integration Codex should import `web/PointOfSalePage.jsx` into the shared React shell and add the `/point-of-sale` route/navigation.
- Dockerfiles, Vite allowlists, app-shell route wiring, and shared dashboard metrics are integration responsibilities, not module-local responsibilities.
- Keep the module API free of direct imports from `app-shell`.

## Risks

- Data is not durable; all POS data resets when the API process restarts.
- Inventory movement posting is still in-memory and not transactional across modules. A database-backed ledger is needed before production.
- Payment records do not integrate with Billing, cash drawer hardware, receipt printing, or external gateways yet.
- Customer lookup is optional and depends on integration wiring.
- No role-based POS permission checks are enforced in the module yet.
