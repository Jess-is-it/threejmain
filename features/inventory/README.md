# Inventory

Inventory owns the physical stock and custody foundation for routers, ONUs/CPEs, cables, installation materials, consumables, tools, office supplies, and POS-sellable items. The module is exposed at `/inventory` with API routes under `/api/inventory`.

## Implemented Functions

- Item master CRUD with SKU, category, tracking type, unit, supplier, cost, POS price, barcode, reorder point, serial list, status, and default stock location.
- PostgreSQL persistence when `DATABASE_URL` is configured. The module uses relational `inventory_items`, `inventory_locations`, `inventory_stock_balances`, `inventory_stock_movements`, and `inventory_assignments` tables.
- Warehouse/location CRUD for warehouses, stockrooms, bins, vehicles, transit, customer, damaged/quarantine, and virtual locations.
- Per-item/per-location balances with database non-negative constraints and monotonic balance versions.
- Append-only movement ledger for receipts, issues, adjustments, transfers, and returns. Posted rows cannot be updated or deleted at either the API or PostgreSQL trigger layer.
- Reversal posting through `POST /api/inventory/movements/{movement_id}/reverse`; the original movement always remains visible.
- Required `Idempotency-Key` headers and request fingerprints for manual movements and reversals. Matching retries replay the original result; conflicting key reuse returns HTTP 409.
- PostgreSQL advisory transaction locking and row-level balance locking to prevent lost updates or negative stock during concurrent posting.
- Asset assignment CRUD for customers, technicians, offices, internal custody, service links, and ticket links.
- Overview metrics for active items, low/out-of-stock lines, assignments, and stock value.
- Readiness reporting through `GET /api/inventory/readiness`.

## POS Contract

Inventory is the canonical sellable-item catalog and stock ledger for Point of Sale.

- `sellableInPos=true` exposes an active item to POS.
- `NON_STOCK` services can be sold without movements.
- Stock-tracked sales post `ISSUE` entries; voids post `RETURN` entries.
- POS supplies deterministic Inventory idempotency keys and passes its active PostgreSQL connection into Inventory. The sale, payments, stock balances, and movement rows therefore commit or roll back together.
- Posted POS sale lines are immutable. Corrections use a void and replacement sale so financial and stock ledgers remain traceable.

## Movement Location Rules

- `RECEIVE` and `RETURN`: destination required; quantity is added there.
- `ISSUE`: source required; quantity is removed there.
- `TRANSFER`: different source and destination required; both balances change atomically.
- `ADJUST`: exactly one source or destination; source means adjustment-out and destination means adjustment-in.

## Current Boundaries

- Individual serials are still configured on the item record. A normalized per-serial asset lifecycle is a later enterprise phase.
- Reservations, procurement, cycle counts, RMA/repair, and advanced costing are not part of this foundation.
- `customerId`, `serviceId`, and `ticketId` remain string integration fields until their dedicated workflows are connected.
- Without `DATABASE_URL`, the module retains a development-only in-memory fallback. `/api/inventory/readiness` reports that mode as not real-data ready.
