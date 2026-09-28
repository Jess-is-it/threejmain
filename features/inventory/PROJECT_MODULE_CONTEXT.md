# Inventory Module Context

This is the module-local source of truth for Inventory implementation details, contracts, tests, and risks.

## Layout

```text
features/inventory/
  api/inventory/
    __init__.py
    router.py
    storage.py
  api/tests/test_inventory_foundation.py
  web/InventoryPage.jsx
  web/inventory.css
  README.md
  module.json
  PROJECT_MODULE_CONTEXT.md
```

## Current Scope

Inventory is a PostgreSQL-backed item, warehouse/location, balance, movement-ledger, and assignment module. It falls back to memory only when PostgreSQL is not configured; that fallback is for local development and is reported as not real-data ready.

Implemented:

- Item master CRUD and POS sellable-item fields.
- Relational warehouses/locations and per-item/per-location balances.
- Append-only receipt, issue, adjustment, transfer, and return movements.
- Reversals as new ledger entries; original ledger rows are never changed.
- Idempotent movement posting with payload fingerprints.
- PostgreSQL advisory locks, row locks, balance constraints, and shared-connection transaction participation.
- Asset assignments and overview metrics.
- POS catalog, stock validation, atomic sale issue, and void return helpers.

## PostgreSQL Schema

Migration `2026080302_inventory_foundation` in `app-shell/api/app/db_migrations.py` creates:

- `inventory_locations`: hierarchical warehouse, stockroom, bin, vehicle, transit, customer, damaged, and virtual locations.
- `inventory_items`: item master data and default location.
- `inventory_stock_balances`: `(item_id, location_id)` quantities with a non-negative check and incrementing version.
- `inventory_stock_movements`: append-only stock event ledger with source/destination, reference, actor, reversal link, idempotency key, and request fingerprint.
- `inventory_assignments`: customer/technician/office/internal custody records.

PostgreSQL trigger `trg_inventory_movements_immutable` rejects all `UPDATE` and `DELETE` operations against `inventory_stock_movements`. Corrections must post a reversal.

The migration seeds stable system locations:

- `MAIN` / `inventory-location-main`
- `TRANSIT` / `inventory-location-transit`
- `DAMAGED` / `inventory-location-damaged`

`INVENTORY_STORAGE=postgres` can explicitly select PostgreSQL. When it is not set, the module selects PostgreSQL automatically if `DATABASE_URL` exists.

## Transaction and Idempotency Contract

- Every Inventory write uses a PostgreSQL transaction and `pg_advisory_xact_lock('threejmain.inventory.stock-ledger')`.
- Affected item and balance rows are locked before quantities change.
- The database rejects negative balances.
- `POST /api/inventory/movements` and `POST /api/inventory/movements/{id}/reverse` require `Idempotency-Key`.
- Movement idempotency keys are globally unique. A same-key/same-fingerprint retry returns the original row with `idempotentReplay=true`; a same-key/different-fingerprint request returns HTTP 409.
- POS exposes its active PostgreSQL connection to Inventory helpers. POS records, sale payments, Inventory movement rows, and balance updates commit or roll back together.
- Posted POS sale line items are immutable; correction is void plus replacement sale.

## API

Prefix: `/api/inventory`

- `GET /meta`
- `GET /readiness`
- `GET /overview`
- `GET|POST /items`
- `PATCH|DELETE /items/{item_id}`
- `GET|POST /movements`
- `POST /movements/{movement_id}/reverse`
- `PATCH|DELETE /movements/{movement_id}` return HTTP 405 because the ledger is immutable.
- `GET|POST /locations`
- `PATCH|DELETE /locations/{location_id}`
- `GET /balances`
- `GET|POST /assignments`
- `PATCH|DELETE /assignments/{assignment_id}`

Movement rules:

- `RECEIVE`/`RETURN`: destination only, positive destination delta.
- `ISSUE`: source only, negative source delta.
- `TRANSFER`: different source and destination, atomic negative/positive deltas.
- `ADJUST`: exactly one source or destination; source is adjustment-out and destination is adjustment-in.

## Frontend

`InventoryPage.jsx` exposes:

- Overview
- Items
- Movements: create-only posting form and reversal actions; no edit/delete actions.
- Locations: create/edit/archive warehouse/location records and view item/quantity totals.
- Assignments

Movement and item forms use active Inventory locations. The movement form generates a fresh idempotency key for every operator posting or reversal.

## POS Integration

Exports from `inventory`:

- `list_pos_catalog_items`
- `get_pos_catalog_item`
- `validate_pos_sale_inventory`
- `record_pos_sale_movements`

These helpers accept an optional shared database connection. POS passes its current connection and a stable operation prefix so sale checkout and stock posting are atomic and duplicate-safe.

## Tests and Verification

- `api/tests/test_inventory_foundation.py` covers required idempotency, duplicate replay, immutable movement APIs, reversal balance restoration, location code uniqueness, and migration controls in memory/static mode.
- Production-path verification should also inspect the PostgreSQL tables and attempt a direct ledger update to confirm the database trigger rejects it.
- Run focused tests with `python3 -m unittest -v features.inventory.api.tests.test_inventory_foundation`.

## Remaining Limits

- Serial numbers are still item-level arrays; normalized serial/lot lifecycle is a later phase.
- Assignment returns preserve their durable database row but the default visible API omits returned soft-deleted rows.
- Procurement/replenishment, reservations/kitting, cycle counts, barcode workflows, RMA/repair, and advanced costing remain future phases.
- Inventory still uses shared admin authentication; dedicated inventory roles, approval limits, and segregation of duties remain future work.
