# Tech Portal Ticketing Context

## Purpose

Ticketing is the technician-facing ticket execution workspace inside Tech Portal. It should let field technicians accept, start, update, document, and complete assigned tickets without exposing the full admin Ticketing module.

## Current Status

- Status: `functional-ticketing-workflow`
- Parent feature: `features/techportal`
- Current route: `/techportal/ticketing`
- API scope: `/api/techportal/tickets`
- Current implementation: functional first pass for assigned queue, mobile-first Kanban stage board, filters, detail, field status updates, and internal notes.

## Current Scope

- Assigned ticket queue.
- Kanban-style field-stage board patterned after admin Ticketing.
- Search, due-date, status, priority, and work-type filters.
- Ticket detail view with customer, service, placeholder network context, notes, and generated checklist.
- Status flow: accepted, en route, on site, in progress, on hold, completed.
- Internal technician notes.
- Completion summary write-back when setting field status to completed.

## Future Scope

- Cancel/escalate flow.
- Editable checklist persistence.
- Customer and service address context.
- Service Account and Service Order references.
- Real Network Settings context for NAP, ONU, PPPoE, OLT/PON, and serviceability.
- Photos, attachments, signal readings, and customer confirmation.
- Inventory materials and equipment used.
- Follow-up or escalation request notes.

## API

- `GET /api/techportal/tickets`
- `GET /api/techportal/tickets/{ticket_id}`
- `POST /api/techportal/tickets/{ticket_id}/status`
- `POST /api/techportal/tickets/{ticket_id}/notes`

Ticket rows are scoped to the signed-in technician when the session role is `technician`; owner/admin sessions can see all active Ticketing rows through the portal.
Mobile is the priority layout: filters stack, stage columns are horizontally swipeable, and ticket detail uses a full-screen drawer on phones.

## Dependencies

- Ticketing is the source of ticket records and ticket notes.
- Customer Profiling is the source of customer identity and service address.
- Service is the source of Service Account and Service Order references.
- Network Settings is the source of network path and provisioning context.
- Inventory is the source of equipment/material assignment.
- Logs stores technician actions.
- App-shell config passes Ticketing provider hooks into Tech Portal for reads and mutations.

## Boundaries

- Technicians should see assigned/team tickets only unless queue access is explicitly granted.
- This feature must not expose full admin Ticketing CRUD.
- PPPoE and device actions should be structured requests to Network Settings, not raw router access.
- Ticketing and field status state are currently in memory and reset when the API restarts.
