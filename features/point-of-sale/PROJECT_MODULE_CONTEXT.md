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
- `POST /api/point-of-sale/sales` requires a stable `Idempotency-Key` header for duplicate-safe register checkout. Matching duplicate submissions replay the existing sale with `idempotentReplay=true`; reused keys with different payloads are rejected.
- `PATCH /api/point-of-sale/sales/{sale_id}`
- `DELETE /api/point-of-sale/sales/{sale_id}`
- `GET /api/point-of-sale/payments`
- `POST /api/point-of-sale/payments`
- `PATCH /api/point-of-sale/payments/{payment_id}`
- `DELETE /api/point-of-sale/payments/{payment_id}`
- `POST /api/point-of-sale/invoice-payment-confirmations` sends a post-Billing-payment A2P SMS confirmation for POS invoice receipts. It uses the app-shell-provided System Settings A2P sender, logs the attempt through A2P Messaging, audits the POS action, and does not roll back or void the Billing receipt if SMS is skipped or fails.

Office Stock frontend tab uses Inventory routes directly:

- `GET /api/inventory/items?status=ACTIVE&search=...` for active stock-tracked office/internal items
- `GET /api/inventory/movements` for the Sales tab Office Stock movement history filtered in the POS UI to `referenceType=OFFICE_STOCK`
- `POST /api/inventory/movements` with `ISSUE` for check-out and `RETURN` for check-in, using `referenceType=OFFICE_STOCK`

Invoice Payments frontend tab uses Billing routes directly:

- `GET /api/billing/meta` for payment methods
- `GET /api/billing/invoices?search=...` for the payable invoice queue
- `GET /api/billing/invoices?customerId=...` when a customer row is selected, so the payment desk allocates against all payable invoices for that customer even if the queue search matched only one invoice
- `GET /api/billing/payments` for the Sales tab Invoice Payments history
- `POST /api/billing/payments` to post invoice payments with `collectionChannel=POS`, a stable `Idempotency-Key` header retained for the lifetime of the payment form, selected same-customer `allocations` rows, and allocation-level `promotionIds` bundles when Billing recommends one or more qualified invoice discounts
- `DELETE /api/billing/payments/{payment_id}` to void a billing receipt from POS

## CRUD Scope

Current in-memory CRUD scope:

- Sellable catalog: read-only in POS, sourced from Inventory item master by `sellableInPos`, status, sale price, barcode, tracking type, and available stock
- POS operator attribution: sales store the logged-in account username/display name; the frontend no longer asks users to open or choose a cashier session.
- Sales: sale number, receipt number, logged-in POS user, optional customer, walk-in support, sale date, line items, discount, tax, payment status, void flow, Inventory movement posting, and in-memory idempotency metadata for duplicate checkout protection
- Payments: backend sale-payment records created during checkout; no standalone frontend workspace. Register payments now store allocated `amount`, optional cash `tenderedAmount`, computed `changeAmount`, method, reference, status, and immutable server `postedAt` timestamp for the exact date/time the payment was posted. Non-cash POS payments require a reference number and allocated payment amount cannot exceed the remaining sale balance.
- Office Stock: frontend-only POS workspace for non-sales stock check-out/check-in. It creates Inventory movements, does not create POS sales, does not capture payments, and does not generate receipts.
- Invoice Payments: POS-owned customer invoice settlement workspace. It reads Billing invoices, groups payable invoices by customer, refreshes all payable invoices for the selected customer before posting, lets the cashier select one or more open invoices, and auto-applies each Billing-recommended promotion bundle. POS displays the combined discount/payable per invoice and submits Billing's ordered `promotionIds`; Billing revalidates the bundle and posts separate auditable credits. Cash over-tender is returned as change. Service rebates, waived fees, and other accounting credits remain Billing records before POS collects the balance.

## Dependencies

- Customer Profiling: optional lookup provider for named customers. Walk-in sales must remain valid without a customer.
- Inventory: canonical item master and stock ledger. POS reads sellable catalog items from Inventory and posts `ISSUE` movements on checkout, `RETURN` movements on sale void/reversal.
- Billing: canonical invoice, promotion, and billing-payment ledger. POS reads Billing invoices, asks Billing for eligible payment-time promotions, and posts Billing payment records for customer invoice settlement.
- Account Admin/shared auth: current source of POS operator identity. Sale records store the authenticated account username/display name.

## Frontend

- `Register` is the primary POS checkout screen. It shows the sellable Inventory catalog as a checkout menu, a cart, walk-in/customer selection, discount, payment method/reference, and complete-checkout action. Register no longer exposes a tax field.
- Register checkout intentionally ignores implicit Enter-key form submission; sales should post only when the operator clicks `Complete Checkout`.
- Register customer search performs a debounced Customer Profiling lookup while the operator types and shows selectable matching customer options under the search field.
- Register checkout requires the cashier to type a payment amount that covers the total due. The payment field is not auto-filled; attempting checkout without an amount shows a required-field warning, and cash payments show calculated change in the checkout summary. Cash checkout allocates only the sale total to the receipt payment while recording tendered cash and change; non-cash checkout must match the total exactly and include a reference number.
- Clicking `Complete Checkout` now shows a fixed, highly visible checkout-result popup for both successful posted receipts and validation/API failures.
- Clicking `Complete Checkout` uses a stable POS sale idempotency key, disables the checkout controls while posting, and shows a posting spinner to prevent accidental duplicate submissions.
- `Invoice Payments` is the customer billing payment desk. It has collection KPIs, a payable invoice queue grouped one row per customer, and a centered customer payment modal opened from `Take Payment` so the queue remains full-width.
- The customer-grouped Billing Invoice Queue shows one customer row with customer location, open invoice count, oldest due date, overdue count/amount, and total balance. Selecting `Take Payment` refreshes all invoices for that customer via Billing `customerId`, loads eligible invoice promotions for the selected payment date, defaults the customer's open invoices selected, and opens a compact modal titled by the customer's name with the location displayed beside it. POS trusts the Billing eligible-promotions response for the selected payment date and does not apply stale invoice-summary early-bird fields by itself. The modal intentionally removes redundant customer details, balance details, manual promo selectors, automatic-discount summary blocks, and verbose invoice cards. Its invoice list supports selecting one or more open invoices and shows only invoice number, billing-period coverage, current invoice total, a qualified discount badge when eligible, and amount to collect. Discount badges use readable promotion names/counts only; promo codes/IDs are not displayed to cashiers.
- Invoice payment posting disables the payment desk while the Billing payment request is in flight, keeps a stable Billing payment idempotency key per selected payment form, requires reference numbers for non-cash payments, and shows compact totals for selected invoice total, automatic discount, amount due, amount received, change/shortfall, and remaining account balance. The payment date control is capped at today, and Billing independently rejects a future `paymentDate` before quoting promotions or posting. Billing returns server `postedAt` on the posted receipt; POS displays that exact payment date/time in receipt details and invoice-payment history while preserving `paymentDate` as the date-only business/promo date. POS sends allocation-level `promotionIds` bundles for Billing-recommended qualified discounts, so a multi-invoice receipt can close each selected invoice at its combined discounted payable amount. Cash over-tender is returned as change in this modal; it is not stored as Billing advance credit from POS.
- After Billing confirms a POS invoice payment, the frontend calls POS `invoice-payment-confirmations` to attempt an A2P SMS to the customer's `contactNumber` using sender ID `3J BILL`. The SMS follows the Collector-style customer-facing wording: amount received, applied amount, remaining balance, and returned excess or advance credit, without exposing the receipt number in the SMS body. The visible checkout popup shows whether SMS was sent, skipped because no number exists, or failed due to A2P/provider configuration, but the printable/downloadable official receipt omits SMS notification details because it is customer-facing. SMS failure never reverses the posted Billing receipt.
- `Office Stock` mirrors the Register layout for internal stock movement. It lists active stock-tracked Inventory items, supports check-out/check-in cart lines, serialized item serial entry, person/team reference, location, notes, and posts Inventory `ISSUE`/`RETURN` movements.
- `Catalog` is a read-only POS view of Inventory sellable items. Item creation and maintenance happen in Inventory.
- `Sales` combines the old overview dashboard metrics with three separated history tabs: Register receipts, Invoice Payment receipts, and Office Stock movements. It also shows a Today Cashier Collections summary that combines POS register payment rows with Billing invoice payment receipts by cashier, split into cash/non-cash, register/invoice, receipts, and voids. Each history table has local search, filter, show-entries, and pagination controls. Invoice Payment receipts open as a customer-facing official receipt sheet branded as `3J COMPUTER AND INTERNET INSTALLATION SERVICES` with the Roma Norte address, invoice-period particulars, remaining-balance period detail, internal SMS notification details omitted from the printable/downloadable receipt, sheet-style PDF download matching the on-screen receipt structure, and 80 mm print output. Voiding still requires a typed reason before reversal. Register and Invoice Payment histories retain void actions; Office Stock is read-only history sourced from Inventory movements with `referenceType=OFFICE_STOCK`. The Low Stock KPI opens a right-side panel with low-stock items instead of rendering a persistent table in the Sales page.
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
- Register checkout idempotency is currently in-memory with POS sales. It prevents duplicate clicks within the running API process, but it must move to durable storage with POS sales before production-grade restart safety.
- POS invoice-payment SMS duplicate suppression is currently in-memory and keyed by Billing payment id/receipt number. A durable SMS outbox keyed by Billing payment id is needed before production-grade restart/retry safety.
- Inventory movement posting is still in-memory and not transactional across modules. A database-backed ledger is needed before production.
- Register payment records do not integrate with Billing, cash drawer hardware, receipt printing, or external gateways yet. Invoice Payments post into Billing's durable payment ledger when Billing PostgreSQL storage is enabled.
- The Today Cashier Collections summary uses currently exposed POS sales/payments and Billing payments. Full cashier end-of-day closing with counted cash, over/short variance, approvals, and durable cash drawer state is still future work.
- Customer lookup is optional and depends on integration wiring.
- No role-based POS permission checks are enforced in the module yet.
