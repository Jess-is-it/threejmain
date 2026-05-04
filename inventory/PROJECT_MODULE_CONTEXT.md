# Inventory Module Context

This file is the module-local source of truth for the Inventory module. Use it for Inventory-specific implementation notes, contracts, risks, and integration handoff details. Do not use the root `Project_Context.md` for ordinary Inventory progress.

## Module Layout

```text
inventory/
  api/inventory/
    __init__.py
    router.py
  web/
    InventoryPage.jsx
    inventory.css
  README.md
  module.json
  PROJECT_MODULE_CONTEXT.md
```

## Current Scope

Inventory is a first-pass in-memory CRUD module for ISP stock and customer-assigned equipment.

Implemented surfaces:

- Inventory item CRUD
- Stock movement CRUD
- Asset assignment CRUD
- Overview metrics for total items, active items, low stock, out-of-stock lines, assigned assets, and stock value
- Low-stock and active-assignment summary data

The current implementation is intentionally module-local. It is not wired into `app-shell` in this branch.

## API Contract

FastAPI router:

- Python package: `inventory/api/inventory`
- Router export: `router`
- Configuration export: `configure_inventory`
- Metrics export: `inventory_metrics`
- Seed export: `seed_inventory_data`
- API prefix: `/api/inventory`

Routes:

- `GET /api/inventory/meta`
- `GET /api/inventory/overview`
- `GET /api/inventory/items`
- `POST /api/inventory/items`
- `PATCH /api/inventory/items/{item_id}`
- `DELETE /api/inventory/items/{item_id}`
- `GET /api/inventory/movements`
- `POST /api/inventory/movements`
- `PATCH /api/inventory/movements/{movement_id}`
- `DELETE /api/inventory/movements/{movement_id}`
- `GET /api/inventory/assignments`
- `POST /api/inventory/assignments`
- `PATCH /api/inventory/assignments/{assignment_id}`
- `DELETE /api/inventory/assignments/{assignment_id}`

The router expects Integration Codex to call:

```python
configure_inventory(current_admin, add_audit)
app.include_router(inventory_router)
```

## CRUD Data Model

Inventory items include:

- `sku`
- `name`
- `category`
- `trackingType`
- `unit`
- `quantityOnHand`
- `reorderPoint`
- `location`
- `supplier`
- `unitCost`
- `status`
- `serialNumbers`
- `notes`

Stock movements include:

- `itemId`
- `type`
- `quantity`
- `fromLocation`
- `toLocation`
- `referenceType`
- `referenceId`
- `notes`

Asset assignments include:

- `itemId`
- `serialNumber`
- `quantity`
- `assignedToName`
- `customerId`
- `serviceId`
- `ticketId`
- `location`
- `status`
- `assignedDate`
- `returnedDate`
- `notes`

## Frontend Contract

React page:

- File: `inventory/web/InventoryPage.jsx`
- Styles: `inventory/web/inventory.css`
- Export: default `InventoryPage`

The page expects an authenticated shared shell with bearer token stored as `threejmain_token`, matching the current customer-profiling and billing page pattern.

Tabs:

- Overview
- Items
- Movements
- Assignments

## Dependencies And Placeholders

Current hard dependencies:

- FastAPI
- Pydantic
- React
- Tabler CSS/classes
- `@tabler/icons-react`

Deferred integration placeholders:

- `customerId`: future Customer Profiling link
- `serviceId`: future customer service assignment link
- `ticketId`: future Ticketing/field job link
- `referenceType` and `referenceId`: future POS, billing, purchasing, ticketing, or manual document references

No direct calls to Customer Profiling, Billing, POS, Ticketing, Account Admin, or Customer Service Management are made in this module version.

## Risks And Known Limits

- Data is in-memory only and resets on API restart.
- No PostgreSQL schema or migrations exist yet.
- No dedicated permission model exists yet beyond the shared admin dependency that Integration Codex should inject.
- Serialized item enforcement is basic. It validates configured serial numbers but does not yet maintain per-serial lifecycle history.
- Movement edits and deletes reverse/reapply stock deltas, but there is no immutable inventory ledger yet.
- Assignment return currently soft-deletes the assignment record and marks it returned; production may need a persistent visible return history.

## Integration Notes

Integration Codex should:

- Add `inventory/api` to API import paths.
- Import `configure_inventory`, `inventory_metrics`, `router`, and `seed_inventory_data`.
- Configure and include the router in app-shell.
- Import `InventoryPage.jsx` in the shell frontend and render it for `/inventory`.
- Add `inventory` to Docker copy paths and Vite filesystem allowlist if the shared shell still requires explicit module paths.
- Use `inventory_metrics()` for dashboard and module card counts.

Do not move Inventory-specific CRUD logic into `app-shell`.
