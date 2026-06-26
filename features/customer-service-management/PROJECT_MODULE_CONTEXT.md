# Customer Service Management Module Context

This file is the module-local source of truth for Customer Service Management. Keep ordinary module progress here instead of the main `Project_Context.md`.

## Module Purpose

Customer Service Management owns care workflows around customer communication and service desk handling:

- Service requests from customers
- Omni-channel inbox conversations
- Interaction logs for calls, messages, walk-ins, email, field notes, and internal notes
- Follow-ups and callbacks
- Channel settings for Facebook now, with Telegram and WhatsApp placeholders
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
- `GET /api/customer-service-management/channel-settings`
- `PATCH /api/customer-service-management/channel-settings/facebook`
- `POST /api/customer-service-management/channel-settings/facebook/check`
- `GET /api/customer-service-management/omni-channel/inbox`
- `GET /api/customer-service-management/omni-channel/inbox/{thread_id}`
- `PATCH /api/customer-service-management/omni-channel/inbox/{thread_id}`
- `POST /api/customer-service-management/omni-channel/inbox/{thread_id}/read`
- `POST /api/customer-service-management/omni-channel/inbox/{thread_id}/reply`
- `GET /api/customer-service-management/channels/facebook/webhook`
- `POST /api/customer-service-management/channels/facebook/webhook`

## CRUD Scope

Current in-memory CRUD covers:

- Service requests: customer, channel, category, priority, status, subject, description, assignee, due date, resolution, tags
- Interactions: linked request, customer, type, direction, timestamp, summary, details, outcome, agent
- Follow-ups: linked request, customer, type, status, due timestamp, assignee, notes, completion timestamp
- Omni-channel inbox: thread list/detail, status updates, mark read, and local threaded replies
- Channel settings: Facebook setup values with masked Page access token responses; Telegram/WhatsApp placeholders only

The API exposes `customer_service_metrics()` and `seed_customer_service_data()` for future app-shell integration.

## Facebook Integration Scope

Facebook is the first implemented omni-channel connector.

Implemented now:

- Messenger webhook verification using Meta's `hub.mode`, `hub.verify_token`, and `hub.challenge` request.
- Messenger webhook POST ingest for `messaging` events with text messages or postback payload/title.
- Facebook PSID-based inbox thread creation.
- Threaded inbound/outbound messages stored in memory.
- Reply endpoint that attempts Messenger Send API delivery when a Page access token is configured; otherwise the reply is stored locally with `LOCAL_ONLY` delivery status.
- Settings screen values for Page name, Page ID, Meta App ID, verify token, Page access token, Graph API version, and notes.

Meta setup values expected from the operator:

- Callback URL: deployment origin plus `/api/customer-service-management/channels/facebook/webhook`
- Verify token: value configured in the CSM Facebook settings tab
- Webhook fields: `messages`, `messaging_postbacks`
- Page access token with Messenger permissions for live outbound replies

Telegram and WhatsApp are visible as planned channels only. They do not have webhook handlers, send APIs, or settings persistence yet.

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
- Inbox
- Service Requests
- Interactions
- Follow-ups
- Settings

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
- System Settings/Deployment: Facebook requires an externally reachable HTTPS webhook URL for production app review

## Risks And Gaps

- Data is in memory and resets on process restart.
- No database schema or migrations exist yet.
- Facebook settings and access tokens are in memory only; durable encrypted secret storage is required before production use.
- Facebook webhook POST currently trusts Meta delivery and does not verify `X-Hub-Signature-256` with an app secret.
- Facebook outbound replies depend on Meta Page access token validity, `pages_messaging` approval, and Messenger's response-window policies.
- Customer snapshots can become stale until durable cross-module references are implemented.
- No server-side pagination yet for request, interaction, or follow-up lists.
- Assignees are free-text placeholders.
- SLA policy is basic: current metrics treat due today or overdue open requests as risk.
- No app-shell wiring in this branch; integration Codex must import the router/page and add Docker/Vite copy rules later.

## Integration Notes

Integration Codex should:

- Add `features/customer-service-management/api` to the app-shell API import path.
- Call `configure_customer_service_management(...)` with admin/audit/customer provider hooks.
- Include `router` from `customer_service_management`.
- Seed data with `seed_customer_service_data()` during startup or metrics refresh.
- Add module metrics from `customer_service_metrics()` to the shell module registry.
- Import `CustomerServiceManagementPage.jsx` in the app-shell web entry when routing is handled.
- Add module copy/allowlist entries to Docker/Vite only in the integration branch.
- Ensure the deployed public HTTPS base URL routes `/api/customer-service-management/channels/facebook/webhook` to this module for Meta webhook verification.
- Add durable settings/secret persistence and webhook signature verification before production Facebook launch.
