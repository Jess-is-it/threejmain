# Inventory

Inventory owns routers, ONUs/CPEs, cables, consumables, installation materials, stock movements, item assignment, and reorder alerts.

The first working shell exposes this module at `/inventory` with API routes under `/api/inventory`.

Current first-pass functionality:

- Inventory item CRUD with SKU, category, tracking type, unit, location, supplier, unit cost, reorder point, and serial number fields.
- Stock movement CRUD for receive, issue, adjust, transfer, and return records.
- Asset assignment CRUD for customer/service/ticket placeholders without hard dependencies on other modules.
- Overview metrics for item count, active items, low stock, out-of-stock lines, assigned assets, and stock value.

Current implementation notes:

- Data is in-memory for the first working shell. Durable PostgreSQL tables should be added before production use.
- `customerId`, `serviceId`, and `ticketId` are placeholder string fields until Customer Profiling, service assignment, and Ticketing integrations are wired.
- `referenceType` and `referenceId` on movements are placeholders for future links to POS receipts, purchase orders, billing, ticketing, or manual documents.
