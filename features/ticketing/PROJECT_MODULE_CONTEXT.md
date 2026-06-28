# Ticketing Module Context

Ticketing owns customer trouble tickets, basic issue intake, status-board queue management, notes, assignment placeholders, and resolution tracking.

## Module Layout

```text
ticketing/
  api/ticketing/__init__.py
  api/ticketing/router.py
  web/TicketingPage.jsx
  web/ticketing.css
  README.md
  module.json
  PROJECT_MODULE_CONTEXT.md
```

## API

FastAPI router package: `ticketing.api.ticketing`

Router prefix: `/api/ticketing`

Current routes:

- `GET /api/ticketing/meta`
- `GET /api/ticketing/customers?search=`
- `GET /api/ticketing/overview`
- `GET /api/ticketing/tickets`
- `GET /api/ticketing/tickets/{ticket_id}`
- `POST /api/ticketing/tickets`
- `PATCH /api/ticketing/tickets/{ticket_id}`
- `DELETE /api/ticketing/tickets/{ticket_id}`
- `POST /api/ticketing/tickets/{ticket_id}/notes`

The module exposes `configure_ticketing`, `create_ticket_from_service_order`, `seed_ticketing_data`, `ticketing_metrics`, `update_ticket_from_techportal`, and `add_ticket_note_from_techportal` for shared app-shell integration.

## CRUD Scope

The first pass is in-memory only and supports:

- Ticket create/list/detail/update/soft-delete
- Free-text search and filters for status, priority, category, customer, and assignee
- Ticket number generation
- Status, priority, category, source, due date, service reference, outage reference, assignment placeholder, and resolution fields
- Technician field status values for Tech Portal: `ASSIGNED`, `ACCEPTED`, `EN_ROUTE`, `ON_SITE`, `IN_PROGRESS`, `ON_HOLD`, and `COMPLETED`
- Service-created tickets store `sourceModule`, `sourceReference`, `serviceOrderId`, `serviceOrderNumber`, `serviceOrderType`, and service account reference fields.
- Internal and customer-visible notes
- Dashboard-ready module metrics for total tickets, open tickets, urgent tickets, field jobs, and SLA risks

## Frontend

- `features/ticketing/web/TicketingPage.jsx` renders a Kanban-style board where ticket status values are the column titles.
- Category filtering is displayed as tabs with per-category ticket counters instead of a category select field.
- Ticket cards are intentionally compact: status, ticket number, subject, customer label, priority marker, and notes/detail action only.
- Ticket cards and the detail drawer show System Settings customer emotion avatars. Ticket status and priority influence mood, with urgent/open tickets pushing toward angry/support and resolved tickets pushing toward resolved/happy.
- Priority is visually encoded on each card for `URGENT`, `HIGH`, `NORMAL`, and `LOW` so urgent/high work is immediately identifiable.
- Users can move tickets between statuses by dragging cards to another status column or by editing the ticket from the detail drawer.
- Ticket create/edit now uses a modal form instead of a persistent side panel, leaving the board as the primary working surface.
- Clicking a ticket card opens a right-side detail drawer with the full ticket record, edit/delete actions, description, resolution summary, and notes.
- Notes are displayed inside the right-side detail drawer where users can view existing notes and add new notes.
- The detail drawer displays linked Service Order and source module fields for tickets created from Service Orders.

## Dependencies

- Customer Profiling: optional integration provider for customer lookup and ticket customer snapshots.
- Ticketing customer snapshots include `gender` from Customer Profiling so male/female avatar slots resolve correctly.
- Account Admin: future dependency for real staff assignment; `assignedTo` is free text for now.
- Service: Service Order records are the source for selectable `serviceId` references in ticket create/edit. Service also calls `create_ticket_from_service_order` so every new Service Order automatically creates an operations ticket.
- Tech Portal: reads visible tickets through `visible_tickets` and writes technician field status/internal notes through `update_ticket_from_techportal` and `add_ticket_note_from_techportal`.
- Outage tracking: future source for `outageId`; currently a placeholder reference field.
- Inventory and dispatch workflows: future dependencies for field job equipment and technician scheduling.

## Integration Notes

- Do not run this module as a separate app.
- Integration should import the router from `ticketing.api.ticketing` and include it in the shared FastAPI app.
- Integration should import `TicketingPage` from `features/ticketing/web/TicketingPage.jsx` into the shared React shell.
- The router expects the integration layer to call `configure_ticketing(...)` with shared auth, audit logging, and optional customer providers.
- Tech Portal integration passes `visible_tickets`, `seed_ticketing_data`, `update_ticket_from_techportal`, and `add_ticket_note_from_techportal` into `configure_techportal(...)`.
- The module currently assumes the shared shell handles login/session and bearer token storage.

## Risks

- Data is in-memory and will reset on API restart.
- There are no durable PostgreSQL tables yet.
- There is no role-based assignment or staff validation yet.
- Tech Portal field status is stored on the in-memory ticket record as `fieldStatus`; durable work-session history is still future work.
- SLA logic is basic: any open ticket with a past due date counts as an SLA risk.
- Customer snapshots are copied into tickets for display and may become stale until durable relationships are implemented.
