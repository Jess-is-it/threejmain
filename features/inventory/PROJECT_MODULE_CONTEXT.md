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
- POS sellable-item fields on inventory items
- POS catalog helper functions and sale movement posting helpers for module-to-module integration
- Overview metrics for total items, active items, low stock, out-of-stock lines, assigned assets, and stock value
- Low-stock and active-assignment summary data

The current implementation is in-memory and module-local, but the shared shell can import Inventory helpers so Point of Sale can use Inventory as the canonical item source.

## API Contract

FastAPI router:

- Python package: `features/inventory/api/inventory`
- Router export: `router`
- Configuration export: `configure_inventory`
- Metrics export: `inventory_metrics`
- Seed export: `seed_inventory_data`
- POS helper exports: `list_pos_catalog_items`, `get_pos_catalog_item`, `validate_pos_sale_inventory`, `record_pos_sale_movements`
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
- `salePrice`
- `taxable`
- `sellableInPos`
- `barcode`
- `status`
- `serialNumbers`
- `notes`

Stock movements include:

- `itemId`
- `type`
- `quantity`
- `serialNumber`
- `fromLocation`
- `toLocation`
- `referenceType`
- `referenceId`
- `notes`

Asset assignments include:

- `itemId`
- `serialNumber`
- `quantity`
- `assigneeType`
- `assignedToName`
- `customerId`
- `serviceId`
- `ticketId`
- `location`
- `status`
- `assignedDate`
- `dueDate`
- `returnedDate`
- `notes`

Supported item categories include ISP sale items, customer equipment, and internal-use assets: `ROUTER`, `ONU_CPE`, `CABLE`, `INSTALLATION_MATERIAL`, `CONSUMABLE`, `TOOL`, `OFFICE_SUPPLY`, `SERVICE`, and `OTHER`.

Tracking types:

- `STOCK`: quantity-tracked consumables or bulk materials.
- `SERIALIZED`: individually tracked assets such as routers, ONUs/CPE, and technician tools.
- `NON_STOCK`: non-inventory services or fees, such as installation charges.

Assignment assignee types:

- `CUSTOMER`
- `TECHNICIAN`
- `OFFICE`
- `INTERNAL`
- `OTHER`

## POS Integration Contract

Inventory is the canonical source for sellable POS items.

- Set `sellableInPos=true` on an item to expose it to POS checkout.
- POS uses `salePrice` as `unitPrice`.
- Stock-tracked POS items use `availableQuantity`, which subtracts active assignments from on-hand stock.
- Serialized POS items require one unit per sale line with a valid, unassigned serial number. POS movements store the serial number so duplicate sale attempts can be blocked until the serial is returned.
- `NON_STOCK` items can be sold in POS without inventory movements.
- Completed POS sales should call `record_pos_sale_movements(..., reverse=False)` to create `ISSUE` movements.
- Voids/reversals should call `record_pos_sale_movements(..., reverse=True)` to create `RETURN` movements.
- POS-created movements use `referenceType` values `POS_SALE` and `POS_VOID`.

## ISP Business Model Notes

- Customer-sold hardware and materials are POS-sellable Inventory items.
- Customer premises equipment that remains company-owned should be assigned through Inventory assignments and later linked to Customer/Service/Ticketing, not treated as a POS sale by default.
- Technician tools and office equipment should use `assigneeType=TECHNICIAN`, `OFFICE`, or `INTERNAL` with due/return tracking.
- Office consumables can remain stock-tracked but not POS-sellable unless the business explicitly sells them over the counter.

## Frontend Contract

React page:

- File: `features/inventory/web/InventoryPage.jsx`
- Styles: `features/inventory/web/inventory.css`
- Export: default `InventoryPage`

The page expects an authenticated shared shell with bearer token stored as `threejmain_token`, matching the current customer-profiling and billing page pattern.

Tabs:

- Overview
- Items: table-first layout; item create/edit opens in a modal from the table header `New item` action or row edit action
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
- `referenceType` and `referenceId`: POS receipts, billing, purchasing, ticketing, or manual document references

No direct calls to Customer Profiling, Billing, Ticketing, Account Admin, or Customer Service Management are made in this module version. POS may import Inventory helper functions in-process.

## Risks And Known Limits

- Data is in-memory only and resets on API restart.
- No PostgreSQL schema or migrations exist yet.
- No dedicated permission model exists yet beyond the shared admin dependency that Integration Codex should inject.
- Serialized item enforcement is basic. It validates configured serial numbers but does not yet maintain per-serial lifecycle history.
- Movement edits and deletes reverse/reapply stock deltas, but there is no immutable inventory ledger yet.
- Assignment return currently soft-deletes the assignment record and marks it returned; production may need a persistent visible return history.
- POS movement posting is not database-transactional yet.

## Integration Notes

Integration Codex should:

- Add `features/inventory/api` to API import paths.
- Import `configure_inventory`, `inventory_metrics`, `router`, and `seed_inventory_data`.
- Keep Inventory loaded before Point of Sale when POS should import the Inventory helper functions.
- Configure and include the router in app-shell.
- Import `InventoryPage.jsx` in the shell frontend and render it for `/inventory`.
- Add `inventory` to Docker copy paths and Vite filesystem allowlist if the shared shell still requires explicit module paths.
- Use `inventory_metrics()` for dashboard and module card counts.

Do not move Inventory-specific CRUD logic into `app-shell`.
