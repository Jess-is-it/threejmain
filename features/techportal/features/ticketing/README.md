# Tech Portal Ticketing

Technician-facing ticket execution workspace.

## Planned Scope

- Assigned ticket queue.
- Ticket detail view optimized for field work.
- Accept, en route, on site, start, hold, complete, and cancel/escalate status flow.
- Customer and service address details.
- Service Account and Service Order context.
- Network Settings context for NAP, ONU, PPPoE, OLT/PON, and serviceability.
- Installation and repair checklists.
- Notes, photos, attachments, signal readings, and completion evidence.
- Inventory materials used.
- Follow-up request/escalation notes.

## Data Sources

- Ticketing is the source of ticket records and ticket notes.
- Customer Profiling is the source of customer identity and address.
- Service is the source of Service Account and Service Order references.
- Network Settings is the source of network path and provisioning context.
- Inventory is the source of equipment/material assignment.
- Logs stores technician actions.

## Boundaries

- Technicians should only see assigned/team tickets unless explicitly granted queue access.
- Technician actions should not expose full admin Ticketing CRUD.
- PPPoE/device actions should be structured requests to Network Settings, not raw router access.
