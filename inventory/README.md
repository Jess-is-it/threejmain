# Inventory

Inventory owns routers, ONUs/CPEs, cables, consumables, installation materials, stock movements, item assignment, and reorder alerts.

The first working shell exposes this module at `/inventory` with API routes under `/api/inventory`.

Current first-pass functionality:

- Inventory item CRUD with SKU, category, tracking type, unit, location, supplier, unit cost, sale price, barcode, POS-sellable flag, reorder point, and serial number fields.
- Stock movement CRUD for receive, issue, adjust, transfer, and return records, including optional serial numbers for serialized assets.
- Asset assignment CRUD for customer, technician, office, internal, service, and ticket placeholders without hard dependencies on other modules.
- Overview metrics for item count, active items, low stock, out-of-stock lines, assigned assets, and stock value.

Current implementation notes:

- Data is in-memory for the first working shell. Durable PostgreSQL tables should be added before production use.
- Inventory is the canonical item master for Point of Sale. POS reads items marked `sellableInPos` and posts stock movements for checkout and void flows.
- ISP internal assets such as technician tools and office equipment should be handled through assignments/returns, not POS checkout, unless explicitly marked sellable.
- `NON_STOCK` items support service fees such as installation charges and can be sold in POS without stock movement.
- `customerId`, `serviceId`, and `ticketId` are placeholder string fields until Customer Profiling, service assignment, and Ticketing integrations are wired.
- `referenceType` and `referenceId` on movements are placeholders for future links to POS receipts, purchase orders, billing, ticketing, or manual documents.
