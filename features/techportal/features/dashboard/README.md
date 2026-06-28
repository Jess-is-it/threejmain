# Tech Portal Dashboard

Technician KPI dashboard at `/techportal`.

## Current Scope

- Assigned ticket count.
- Urgent ticket count.
- Due-today ticket count.
- Overdue ticket count.
- In-progress ticket count.
- Completed-today ticket count.
- Temporary test login: `tech` / `tech12345`.

## Data Sources

- Ticketing for assigned tickets and priorities.
- Service for Service Account and Service Order context.
- Customer Profiling for customer name, contact, and service address.
- Network Settings for serviceability/network context.
- Logs for recent technician activity.

## API

- `GET /api/techportal/dashboard`
- Protected by shared app-shell auth.
- Technician users see KPI counters derived from tickets assigned to their username/full name; owner/admin users can see counters derived from all active Ticketing rows.

## Boundaries

- Dashboard should not edit admin records directly.
- Dashboard should not render ticket lists or ticket details. Ticket actions belong on `/techportal/ticketing`.
- Remove the prefilled test login before production use.
