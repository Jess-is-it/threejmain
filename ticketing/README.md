# Ticketing

Ticketing owns trouble tickets, field dispatch, outage tracking, ticket notes, assignments, priorities, and resolution history.

The first working shell exposes this module at `/ticketing` with in-memory CRUD for customer trouble tickets.

Current API prefix: `/api/ticketing`.

Implemented in the first CRUD pass:

- Ticket create, list/search/filter, update, detail, and soft-delete workflows.
- Status, priority, category, source, due date, service ID, outage ID, and resolution fields.
- Customer lookup through Customer Profiling when available.
- Manual requestor/contact placeholders for tickets that are not linked to a customer yet.
- Free-text assignee placeholder until Account Admin staff/user records are available.
- Ticket notes with internal/customer-visible visibility.
- Dashboard metrics for open tickets, urgent tickets, field-job categories, and SLA risks.

Future integrations:

- Account Admin for staff assignment and ownership.
- Customer Profiling service assignments for `serviceId`.
- Outage tracking for `outageId`.
- Inventory/dispatch workflows for field jobs and assigned equipment.
