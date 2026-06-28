# Tech Portal Module Context

## Purpose

Tech Portal is a technician-only web portal for installers, repair technicians, and field crews. It exposes field-work views connected to the existing ISP management system without exposing the full admin shell.

The portal is available on staging at:

```text
http://192.168.50.70:8280/techportal
```

## Current Status

- Status from `module.json`: `functional-dashboard-ticketing`
- Web routes: `/techportal` for KPI dashboard, `/techportal/ticketing` for technician Ticketing
- API prefix: `/api/techportal`
- Frontend entries: `features/techportal/web/TechPortalPage.jsx` and `features/techportal/web/TechPortalTicketingPage.jsx`
- API entry: `features/techportal/api/techportal/router.py`
- App-shell imports the Tech Portal dashboard and Ticketing pages, includes the Tech Portal API router, lists both routes in navigation, and restricts technician-role sessions to the Tech Portal dashboard, Tech Portal Ticketing, and profile/password pages.
- System Settings -> Access now seeds Tech Portal permission codes, a built-in `technician` role, and a temporary test user `tech` / `tech12345`; app-shell login accepts Access users while keeping the legacy admin fallback.
- Current implementation includes a KPI-only Dashboard page plus a separate mobile-first Ticketing Kanban page with assigned ticket queue/detail views, ticket status updates, and internal technician notes. Logs, evidence/materials, and portal-safe Settings remain planned feature folders.

## Research Summary

Enterprise field-service portals and mobile apps usually include:

- assigned daily work queue
- map/location context
- customer and service details
- work-order/ticket status transitions
- guided service tasks/checklists
- notes, photos, attachments, and evidence capture
- parts/material usage
- time tracking
- knowledge articles or job instructions
- offline/PWA readiness for intermittent field connectivity
- technician-scoped access and audit logging

Tech Portal should follow this pattern but stay connected to this ISP system's current source modules: Ticketing, Customer Profiling, Service, Network Settings, Inventory, Logs, and System Settings.

## Folder Layout

```text
features/techportal/
  README.md
  module.json
  PROJECT_MODULE_CONTEXT.md
  api/techportal/
  web/
  common/
  features/dashboard/
    PROJECT_MODULE_CONTEXT.md
    module.json
  features/ticketing/
    PROJECT_MODULE_CONTEXT.md
    module.json
  features/logs/
    PROJECT_MODULE_CONTEXT.md
    module.json
  features/system-settings/
    PROJECT_MODULE_CONTEXT.md
    module.json
```

## Feature Folders

### `features/techportal/features/dashboard`

Technician KPI summary only.

### `features/techportal/features/ticketing`

Technician-specific ticket queue, detail, status updates, field checklist, notes, attachments, and completion flow. First pass is functional at `/techportal/ticketing` with a mobile-first Kanban field-stage board for queue/detail/status/notes; evidence, attachments, material usage, and durable work sessions remain future work.

### `features/techportal/features/logs`

Technician-scoped activity log and audit history.

### `features/techportal/features/system-settings`

Portal-safe technician profile, password/session preferences, notification settings, device preferences, and offline sync status later.

## API Endpoints

Current endpoints:

- `GET /api/techportal/health`
- `GET /api/techportal/meta`
- `GET /api/techportal/plan`
- `GET /api/techportal/dashboard`
- `GET /api/techportal/tickets`
- `GET /api/techportal/tickets/{ticket_id}`
- `POST /api/techportal/tickets/{ticket_id}/status`
- `POST /api/techportal/tickets/{ticket_id}/notes`

Future endpoints should be added under:

- `/api/techportal/tickets/{ticket_id}/evidence`
- `/api/techportal/tickets/{ticket_id}/materials`
- `/api/techportal/work-sessions`
- `/api/techportal/logs`
- `/api/techportal/settings`

## Main Workflows

### Assigned Work

1. Technician logs into Tech Portal.
2. Dashboard shows KPI counters only.
3. Technician opens Ticketing to see assigned tickets on a Kanban stage board.
4. Technician opens a ticket and accepts it or starts work.
5. Status changes are written back to Ticketing and Logs.

### Installation

1. Ticketing provides an installation ticket created from Service Order.
2. Tech Portal shows customer, Service Account/Service Order, service address, plan, and Network Settings context.
3. Technician records installation checklist, NAP/ONU/router context, signal readings, photos, notes, and materials used.
4. Network Settings receives network attachment/provisioning context for PPPoE workflow.
5. Ticketing and Logs receive completion evidence.

### Repair

1. Ticketing provides assigned repair ticket.
2. Tech Portal shows customer, service path, PPPoE/session context, recent network events, and prior notes.
3. Technician records diagnosis and resolution.
4. Ticketing receives status and notes; Customer Service Management can use the result for follow-up.

## Integration Dependencies

- Ticketing: assigned ticket source, status updates, notes, and field-work completion.
- Customer Profiling: customer identity, contact, service address, and location context.
- Service: Service Account, Service Order, catalog plan, and lifecycle state.
- Network Settings: serviceability, topology, NAP/ONU/PPPoE context, and future provisioning job requests.
- Inventory: materials, equipment, ONU/CPE/router assignment, and stock movement references.
- Logs: technician activity and audit trail.
- System Settings: branding, maps, notifications, access/session configuration, and portal-safe preferences.
- Account Admin: future technician/team/skill records if the module becomes staff assignment owner.
- Billing: read-only suspension/payment context.
- Customer Service Management: customer follow-up context.

## Integration Notes

- Frontend imports: `features/techportal/web/TechPortalPage.jsx` and `features/techportal/web/TechPortalTicketingPage.jsx`.
- Backend import: `features/techportal/api/techportal/router.py`.
- API router export: `router`.
- Metrics export: `techportal_metrics`.
- Configure hook: `configure_techportal(current_admin, audit_logger, ticket_provider, ticket_seed, ticket_status_updater, ticket_note_adder)`.
- Routes: `/techportal`, `/techportal/ticketing`.
- API prefix: `/api/techportal`.
- Staging URL: `http://192.168.50.70:8280/techportal`.
- Treat `8280` as the existing staging web runtime, not a new per-Codex preview server.
- Dashboard reads Ticketing-derived KPI metrics only. Ticketing reads assigned Ticketing rows through an app-shell provider hook.
- Ticket status and note actions call Ticketing provider hooks and mutate the shared in-memory Ticketing records.

## Known Risks And Boundaries

- Technician access control is first-pass only: app-shell login accepts System Settings -> Access users and hides admin navigation for the `technician` role, but per-endpoint permission enforcement across all admin modules is not complete yet.
- Ticketing data and Tech Portal field status are still in memory with the Ticketing module and reset on API restart.
- This folder does not start, build, or serve a separate app.
- The portal must not expose full admin controls, device credentials, or PPPoE secrets.
- Offline/PWA support is planned, but should be added only after online ticket workflow is stable.
- File/photo uploads need storage, retention, and privacy rules before production.
- Location tracking must be explicit and configurable.
- Portal settings are technician-safe preferences only, not the full System Settings admin module.

## Next Recommended Work

1. Add editable checklist completion, evidence upload, and material capture to ticket detail.
2. Add technician-scoped Logs view.
3. Add Network Settings context for NAP/ONU/PPPoE/serviceability records.
4. Persist Ticketing/Tech Portal field-work state in PostgreSQL.
5. Remove the temporary prefilled `tech` test credentials from the login form before production use.
