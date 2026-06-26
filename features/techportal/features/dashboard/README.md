# Tech Portal Dashboard

Technician dashboard for assigned field work.

## Planned Scope

- Today's assigned tickets.
- Urgent and overdue jobs.
- Installation, repair, relocation, reconnection, and equipment replacement counts.
- Technician status: available, en route, on site, in progress, on break, done.
- Route/map summary using shared System Settings map providers later.
- Quick links to Ticketing, Logs, and portal settings.

## Data Sources

- Ticketing for assigned tickets and priorities.
- Service for Service Account and Service Order context.
- Customer Profiling for customer name, contact, and service address.
- Network Settings for serviceability/network context.
- Logs for recent technician activity.

## Boundaries

- Dashboard should not edit admin records directly.
- Actions should route technicians into the correct ticket or work-session flow.
