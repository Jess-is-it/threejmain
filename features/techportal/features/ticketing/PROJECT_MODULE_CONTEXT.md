# Tech Portal Ticketing Context

## Purpose

Ticketing is the technician-facing ticket execution workspace inside Tech Portal. It should let field technicians accept, start, update, document, and complete assigned tickets without exposing the full admin Ticketing module.

## Current Status

- Status: `planned-shell`
- Parent feature: `features/techportal`
- Planned route: `/techportal/ticketing`
- API scope: future `/api/techportal/tickets`
- Current implementation: documentation-only feature folder.

## Planned Scope

- Assigned ticket queue.
- Ticket detail view optimized for mobile/tablet field work.
- Status flow: assigned, accepted, en route, on site, in progress, on hold, completed, cancelled/escalated.
- Customer and service address context.
- Service Account and Service Order references.
- Network Settings context for NAP, ONU, PPPoE, OLT/PON, and serviceability.
- Installation and repair checklists.
- Notes, photos, attachments, signal readings, and customer confirmation.
- Inventory materials and equipment used.
- Follow-up or escalation request notes.

## Dependencies

- Ticketing is the source of ticket records and ticket notes.
- Customer Profiling is the source of customer identity and service address.
- Service is the source of Service Account and Service Order references.
- Network Settings is the source of network path and provisioning context.
- Inventory is the source of equipment/material assignment.
- Logs stores technician actions.

## Boundaries

- Technicians should see assigned/team tickets only unless queue access is explicitly granted.
- This feature must not expose full admin Ticketing CRUD.
- PPPoE and device actions should be structured requests to Network Settings, not raw router access.
