# Customer Service Management Module Context

This file is the module-local source of truth for Customer Service Management. Keep ordinary module progress here instead of the main `Project_Context.md`.

## Module Purpose

Customer Service Management owns care workflows around customer communication and service desk handling:

- Service requests from customers
- Interaction logs for calls, messages, walk-ins, email, field notes, and internal notes
- Follow-ups and callbacks
- Basic SLA risk visibility

## Current Structure

```text
customer-service-management/
  api/customer_service_management/__init__.py
  api/customer_service_management/router.py
  web/CustomerServiceManagementPage.jsx
  web/customerServiceManagement.css
  README.md
  module.json
  PROJECT_MODULE_CONTEXT.md
```

## API

FastAPI router package: `customer_service_management`

Router prefix:

```text
/api/customer-service-management
```

Current endpoints:

- `GET /api/customer-service-management/meta`
- `GET /api/customer-service-management/customers`
- `GET /api/customer-service-management/overview`
- `GET /api/customer-service-management/service-requests`
- `POST /api/customer-service-management/service-requests`
- `PATCH /api/customer-service-management/service-requests/{request_id}`
- `DELETE /api/customer-service-management/service-requests/{request_id}`
- `GET /api/customer-service-management/service-requests/{request_id}/interactions`
- `GET /api/customer-service-management/interactions`
- `POST /api/customer-service-management/interactions`
- `PATCH /api/customer-service-management/interactions/{interaction_id}`
- `DELETE /api/customer-service-management/interactions/{interaction_id}`
- `GET /api/customer-service-management/follow-ups`
- `POST /api/customer-service-management/follow-ups`
- `PATCH /api/customer-service-management/follow-ups/{follow_up_id}`
- `DELETE /api/customer-service-management/follow-ups/{follow_up_id}`

## CRUD Scope

Current in-memory CRUD covers:

- Service requests: customer, channel, category, priority, status, subject, description, assignee, due date, resolution, tags
- Interactions: linked request, customer, type, direction, timestamp, summary, details, outcome, agent
- Follow-ups: linked request, customer, type, status, due timestamp, assignee, notes, completion timestamp

The API exposes `customer_service_metrics()` and `seed_customer_service_data()` for future app-shell integration.

## Frontend

React page:

```text
web/CustomerServiceManagementPage.jsx
```

Styles:

```text
web/customerServiceManagement.css
```

Current page tabs:

- Overview
- Service Requests
- Interactions
- Follow-ups

The page expects the module API to be mounted by the app shell later. It is not wired into `app-shell` in this module-only branch.

## Dependencies

Primary dependency:

- Customer Profiling: customer identity and lookup

The API accepts optional provider hooks:

- `customer_resolver`
- `customer_searcher`
- `customer_seed`

Until Customer Profiling is wired by the integration branch, the module uses placeholder customer records so basic CRUD can be tested independently.

Future integration dependencies:

- Ticketing: escalated service requests may become trouble tickets
- Billing: billing concern requests may link to invoices, subscriptions, or balances
- Inventory/field service: field-visit follow-ups may later reference assigned devices or materials
- Account Admin: assignee values are currently free text until staff/user records are connected

## Risks And Gaps

- Data is in memory and resets on process restart.
- No database schema or migrations exist yet.
- Customer snapshots can become stale until durable cross-module references are implemented.
- No server-side pagination yet for request, interaction, or follow-up lists.
- Assignees are free-text placeholders.
- SLA policy is basic: current metrics treat due today or overdue open requests as risk.
- No app-shell wiring in this branch; integration Codex must import the router/page and add Docker/Vite copy rules later.

## Integration Notes

Integration Codex should:

- Add `customer-service-management/api` to the app-shell API import path.
- Call `configure_customer_service_management(...)` with admin/audit/customer provider hooks.
- Include `router` from `customer_service_management`.
- Seed data with `seed_customer_service_data()` during startup or metrics refresh.
- Add module metrics from `customer_service_metrics()` to the shell module registry.
- Import `CustomerServiceManagementPage.jsx` in the app-shell web entry when routing is handled.
- Add module copy/allowlist entries to Docker/Vite only in the integration branch.
