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
- Storage: in-memory lists for first CRUD shell

Local routes:

- `GET /api/point-of-sale/meta`
- `GET /api/point-of-sale/overview`
- `GET /api/point-of-sale/customers`
- `GET /api/point-of-sale/items`
- `POST /api/point-of-sale/items`
- `PATCH /api/point-of-sale/items/{item_id}`
- `DELETE /api/point-of-sale/items/{item_id}`
- `GET /api/point-of-sale/sessions`
- `POST /api/point-of-sale/sessions`
- `PATCH /api/point-of-sale/sessions/{session_id}`
- `POST /api/point-of-sale/sessions/{session_id}/close`
- `DELETE /api/point-of-sale/sessions/{session_id}`
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

- Item catalog: SKU, name, category, unit price, stock on hand, reorder point, taxable flag, status, notes, soft archive
- Cashier sessions: session number, cashier, register, opening float, opened date, closing cash, expected cash, variance, status, close/cancel flow
- Sales: sale number, receipt number, session, optional customer, walk-in support, sale date, line items, discount, tax, payment status, void flow
- Payments: payment number, sale link, amount, method, payment date, reference, status, notes, void flow

## Dependencies

- Customer Profiling: optional lookup provider for named customers. Walk-in sales must remain valid without a customer.
- Inventory: future source of durable item catalog, stock movements, reorder alerts, and assignment links. Current POS stock is local and temporary.
- Billing: future handoff for invoice settlement or billing-related receipt posting. Current POS payments are local only.
- Account Admin: future source of cashier/staff identity and permissions. Current session cashier is a free-text field.

## Integration Notes

- Integration Codex should import `point_of_sale.router` into the shared API shell and call `configure_point_of_sale(...)`.
- Integration Codex should import `web/PointOfSalePage.jsx` into the shared React shell and add the `/point-of-sale` route/navigation.
- Dockerfiles, Vite allowlists, app-shell route wiring, and shared dashboard metrics are integration responsibilities, not module-local responsibilities.
- Keep the module API free of direct imports from `app-shell`.

## Risks

- Data is not durable; all POS data resets when the API process restarts.
- Local stock decrement/restore is only a placeholder and can diverge from future Inventory records.
- Payment records do not integrate with Billing, cash drawer hardware, receipt printing, or external gateways yet.
- Customer lookup is optional and depends on integration wiring.
- No role-based cashier permission checks are enforced in the module yet.
