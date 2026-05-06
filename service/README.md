# Service

Service owns the ISP-facing definition of offered internet services and the customer-facing order records for services a customer is trying to avail.

## Routes

- Web: `/service/catalog`
- Web: `/service/order`
- API prefix: `/api/service`

## Current CRUD Scope

- Service Catalog: create, update, list, and archive speed plans and service items.
- Service Order: create, update, list, and cancel customer service orders.
- Customer lookup: Service Order uses Customer Profiling as the source of customer identity.
- Cross-module references: Service Order IDs and service references are exposed for Billing subscriptions and Ticketing tickets.

## API Endpoints

- `GET /api/service/health`
- `GET /api/service/meta`
- `GET /api/service/customers`
- `GET /api/service/catalog/overview`
- `GET /api/service/catalog`
- `POST /api/service/catalog`
- `PATCH /api/service/catalog/{catalog_id}`
- `DELETE /api/service/catalog/{catalog_id}`
- `GET /api/service/orders/overview`
- `GET /api/service/orders`
- `POST /api/service/orders`
- `PATCH /api/service/orders/{order_id}`
- `DELETE /api/service/orders/{order_id}`

## Integration Notes

Customer Profiling no longer owns service assignment. It may display Service-owned orders for a selected customer, but creation and lifecycle changes belong here.

Billing can select a Service Order when creating a subscription. Ticketing can select a Service Order when creating a ticket. Inventory and installation workflows should use the same Service Order reference when they are expanded.

The current implementation is in-memory for the first working shell. Shared PostgreSQL persistence should replace the in-memory lists before production use.
