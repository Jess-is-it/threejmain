# Tech Portal Dashboard Context

## Purpose

Dashboard is the technician landing workspace inside Tech Portal. It should show assigned work, urgent jobs, today routing context, technician status, and quick links into ticket execution.

## Current Status

- Status: `planned-shell`
- Parent feature: `features/techportal`
- Planned route: `/techportal`
- API scope: future `/api/techportal/dashboard`
- Current implementation: documentation-only feature folder.

## Planned Scope

- Assigned tickets for the signed-in technician.
- Urgent, overdue, and due-today work counters.
- Installation, repair, relocation, reconnection, and equipment replacement queues.
- Technician availability/status shortcuts.
- Route or map summary using shared System Settings map provider configuration later.
- Recent notifications, reminders, and safety prompts.

## Dependencies

- Ticketing for assigned ticket records.
- Service for Service Account and Service Order context.
- Customer Profiling for customer identity and service address.
- Network Settings for serviceability and network-path context.
- Logs for recent technician activity.

## Boundaries

- Dashboard should not own ticket records or Service Account records.
- Dashboard actions should route to ticket/work-session flows rather than editing admin data directly.
- Technician visibility must be scoped to assigned work or approved team queues.
