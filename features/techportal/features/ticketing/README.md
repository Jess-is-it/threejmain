# Tech Portal Ticketing

Technician-facing ticket execution workspace at `/techportal/ticketing`.

## Current Scope

- Assigned ticket queue.
- Kanban-style field-stage board patterned after admin Ticketing.
- Search, due-date, status, priority, and work-type filters.
- Ticket detail view optimized for field work.
- Accept, en route, on site, start, hold, and complete status flow.
- Internal technician notes.
- Completion summary write-back.
- Customer and service address details.
- Service Account and Service Order context.
- Generated installation/repair/equipment checklists.
- Placeholder Network Settings context until linked records exist.
- Mobile-first layout with stacked filters, swipeable stage columns, and full-screen ticket detail drawer on phones.

## API

- `GET /api/techportal/tickets`
- `GET /api/techportal/tickets/{ticket_id}`
- `POST /api/techportal/tickets/{ticket_id}/status`
- `POST /api/techportal/tickets/{ticket_id}/notes`

## Future Scope

- Cancel/escalate status flow.
- Photos, attachments, signal readings, and completion evidence.
- Inventory materials used.
- Network Settings context for NAP, ONU, PPPoE, OLT/PON, and serviceability.
- Follow-up request/escalation notes.

## Data Sources

- Ticketing is the source of ticket records and ticket notes.
- Customer Profiling is the source of customer identity and address.
- Service is the source of Service Account and Service Order references.
- Network Settings is the source of network path and provisioning context.
- Inventory is the source of equipment/material assignment.
- Logs stores technician actions.
- App-shell passes Ticketing read/write provider hooks into Tech Portal.

## Boundaries

- Technicians should only see assigned/team tickets unless explicitly granted queue access.
- Technician actions should not expose full admin Ticketing CRUD.
- PPPoE/device actions should be structured requests to Network Settings, not raw router access.
- Current ticket state is in memory through Ticketing and resets on API restart.
