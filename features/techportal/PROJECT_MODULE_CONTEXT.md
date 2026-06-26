# Tech Portal Module Context

## Purpose

Tech Portal is planned as a technician-only web portal for installers, repair technicians, and field crews. It should expose field-work views connected to the existing ISP management system without exposing the full admin shell.

The portal should eventually be available at:

```text
http://192.168.50.70:8280/techportal
```

## Current Status

- Status from `module.json`: `planned-shell`
- Planned web route: `/techportal`
- Planned API prefix: `/api/techportal`
- Frontend entry: `features/techportal/web/TechPortalPage.jsx`
- API entry: `features/techportal/api/techportal/router.py`
- The repository-level app-shell Docker/Vite setup now copies and allows `features/`, but this folder is not registered in app-shell routes, API startup, authentication, navigation, or runtime routing yet.
- Current implementation is a documentation-heavy skeleton with metadata endpoints only.

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

## Planned Feature Folders

### `features/techportal/features/dashboard`

Technician daily work summary and quick actions.

### `features/techportal/features/ticketing`

Technician-specific ticket queue, detail, status updates, field checklist, notes, attachments, and completion flow.

### `features/techportal/features/logs`

Technician-scoped activity log and audit history.

### `features/techportal/features/system-settings`

Portal-safe technician profile, password/session preferences, notification settings, device preferences, and offline sync status later.

## Planned API Endpoints

Current metadata-only endpoints:

- `GET /api/techportal/health`
- `GET /api/techportal/meta`
- `GET /api/techportal/plan`

Future endpoints should be added under:

- `/api/techportal/dashboard`
- `/api/techportal/tickets`
- `/api/techportal/tickets/{ticket_id}`
- `/api/techportal/tickets/{ticket_id}/status`
- `/api/techportal/tickets/{ticket_id}/notes`
- `/api/techportal/tickets/{ticket_id}/evidence`
- `/api/techportal/tickets/{ticket_id}/materials`
- `/api/techportal/work-sessions`
- `/api/techportal/logs`
- `/api/techportal/settings`

## Main Workflows

### Assigned Work

1. Technician logs into Tech Portal.
2. Dashboard shows assigned tickets, urgent work, due work, and today's route.
3. Technician opens a ticket and accepts it or starts work.
4. Status changes are written back to Ticketing and Logs.

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

## Integration Notes For Integration Codex

- Do not wire this portal until the user requests Tech Portal integration.
- Planned frontend import: `features/techportal/web/TechPortalPage.jsx`.
- Planned backend import: `features/techportal/api/techportal/router.py`.
- Planned API router export: `router`.
- Planned metrics export: `techportal_metrics`.
- Planned configure hook: `configure_techportal(current_admin, audit_logger)`.
- Planned route: `/techportal`.
- Planned API prefix: `/api/techportal`.
- Planned staging URL: `http://192.168.50.70:8280/techportal`.
- Treat `8280` as the existing staging web runtime, not a new per-Codex preview server.
- Integration still needs app-shell route, navigation, frontend import, API router registration, and auth/session decisions for `/techportal`.

## Known Risks And Boundaries

- Technician access control is not implemented yet.
- This folder does not start, build, or serve a separate app.
- The portal must not expose full admin controls, device credentials, or PPPoE secrets.
- Offline/PWA support is planned, but should be added only after online ticket workflow is stable.
- File/photo uploads need storage, retention, and privacy rules before production.
- Location tracking must be explicit and configurable.
- Portal settings are technician-safe preferences only, not the full System Settings admin module.

## Next Recommended Work

1. Confirm whether Tech Portal should be integrated into the existing app-shell build or served as a dedicated Vite entry behind the same staging web port.
2. Define technician auth/role rules with System Settings -> Access.
3. Build Dashboard and Ticketing read-only views from existing Ticketing records.
4. Add technician ticket status transitions and notes.
5. Add installation checklist/evidence/material capture.
