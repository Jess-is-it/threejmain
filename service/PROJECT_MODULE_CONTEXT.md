# Service Module Context

## Purpose

Service manages the ISP service catalog and service orders. The catalog answers what internet services the ISP offers. Service orders answer what service a customer is trying to avail and provide the canonical service reference for other modules.

## Current Status

- Status from `module.json`: `functional-shell`
- App-shell routes: `/service/catalog`, `/service/order`
- API prefix: `/api/service`
- Frontend entry: `service/web/ServicePage.jsx`
- API entry: `service/api/service/router.py`

## Current CRUD Scope

- Service Catalog speed plan CRUD with service type, target segment, speeds, monthly rate, install fee, billing mode, status, contract months, and equipment profile.
- Service Order CRUD with customer lookup, selected catalog item, dates, status, priority, service reference, install address, and notes.
- Service Order cancellation uses soft-delete style state with `CANCELLED`.

## Backend Notes

- Router package: `service/api/service`
- In-memory lists: `service_catalog`, `service_orders`
- Configuration hook: `configure_service(current_admin, audit_logger, customer_resolver, customer_searcher, customer_seed)`
- Metrics hook: `service_metrics()`
- Seed hook: `seed_service_data()`

## Integration Notes

- Customer Profiling is the customer identity source. Service calls customer provider hooks from `app-shell/api/app/main.py`.
- Customer Profiling should not create service assignments. It can display Service-owned orders for selected customers through `/api/service/orders?customerId=...`.
- Billing subscriptions can use a Service Order to populate customer, plan, service reference, and rate.
- Ticketing can use a Service Order to tag the affected service reference on a ticket.
- Inventory and installation/field-job flows should use Service Order references when those workflows are expanded.

## Risks And Follow-Up Work

- Current records are in memory and reset on API restart.
- Durable PostgreSQL persistence and migrations are required before production.
- Role/permission boundaries for catalog management versus order intake still need enforcement.
- Service Order lifecycle should later drive installation scheduling, inventory assignment, and billing activation events.
