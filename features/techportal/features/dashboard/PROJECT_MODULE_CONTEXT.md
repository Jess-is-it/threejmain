# Tech Portal Dashboard Context

## Purpose

Dashboard is the technician landing workspace inside Tech Portal. It is intentionally KPI-only; ticket queues, ticket details, and ticket actions belong in Tech Portal Ticketing.

## Current Status

- Status: `functional-dashboard`
- Parent feature: `features/techportal`
- Planned route: `/techportal`
- API scope: `/api/techportal/dashboard`
- Current implementation: functional KPI-only React dashboard under `features/techportal/web/TechPortalPage.jsx`, protected FastAPI dashboard endpoint under `features/techportal/api/techportal/router.py`, and app-shell route `/techportal`.

## Planned Scope

- Assigned count.
- Urgent count.
- Due-today count.
- Overdue count.
- In-progress count.
- Completed-today count.

## Dependencies

- Ticketing for assigned ticket records.
- Service for Service Account and Service Order context.
- Customer Profiling for customer identity and service address.
- Network Settings for serviceability and network-path context.
- Logs for recent technician activity.

## Boundaries

- Dashboard should not own ticket records or Service Account records.
- Dashboard should not render ticket lists, ticket details, or field-action workflows.
- Ticket work belongs on `/techportal/ticketing`.

## Test Account

- System Settings -> Access seeds a built-in `technician` role and active test user `tech`.
- Temporary test password: `tech12345`.
- The shared login form is intentionally prefilled with this account for quick testing; remove this before production use.
