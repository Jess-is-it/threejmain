# Tech Portal

Tech Portal is the technician-only web portal for field technicians, installers, and repair crews. It is accessible as a dedicated technician workspace at:

```text
http://192.168.50.70:8280/techportal
```

This folder lives at `features/techportal/`. The app-shell now imports the Tech Portal page, includes the Tech Portal API router, registers `/techportal`, and uses System Settings -> Access users for technician login.

## Research Baseline

Enterprise field-service and telecom operations usually keep technician portals separate from admin back-office workflows. The technician experience should focus on field execution, low-friction mobile/tablet use, guided work completion, evidence capture, and role-limited access.

Research references used for this plan:

- [Microsoft Dynamics 365 Field Service mobile app](https://learn.microsoft.com/en-us/dynamics365/field-service/mobile/get-work-done-mobile-app): daily scheduled work orders, map/navigation, customer details, service tasks, products used, notes, attachments, and time tracking.
- [Dynamics 365 Field Service mobile overview](https://learn.microsoft.com/en-us/dynamics365/field-service/mobile/overview): offline capability for frontline workers to continue viewing and updating job details without connectivity.
- [Salesforce Field Service mobile knowledge articles](https://help.salesforce.com/s/articleView?id=service.mfs_knowledge.htm&type=5): knowledge articles attached to work orders, work order line items, and work types for field instructions.
- [ServiceNow Field Service Management mobile experience](https://www.servicenow.com/docs/r/yokohama/field-service-management/mobile-experience-fsm.html): technician task handling, accept/reject, execution, map, status updates, and work completion.
- [TM Forum Trouble Ticket Management API TMF621](https://www.tmforum.org/open-digital-architecture/open-apis/trouble-ticket-management-api-TMF621/v4.0): standardized trouble-ticket tracking for issues created by customers or systems.
- [MDN Progressive Web Apps](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps): installable/offline-capable web app patterns for intermittent connectivity.
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html): session handling and access-control considerations for authenticated portals.

## Product Direction

Tech Portal is not a second admin shell. It should be a technician workspace connected to the existing ISP management system.

Primary design goals:

- Technician-only access with limited permissions.
- Mobile/tablet-first layout that also works on desktop.
- Fast daily work queue for assigned tickets and installations.
- Context-rich ticket details without exposing full admin CRUD.
- Evidence capture: notes, photos, materials used, checklist results, customer confirmation, and timestamps.
- Network-aware installation workflow connected to Network Settings.
- Audit-friendly actions that write back to Ticketing, Logs, Service, Inventory, and Network Settings.
- Future offline/PWA readiness for field areas with weak signal.

## Planned URL And Runtime

Preferred staging URL:

```text
http://192.168.50.70:8280/techportal
```

Important runtime note:

- `8280` is already documented as the staging web port.
- Tech Portal should initially be a route under the staging web runtime, not a separate preview server.
- Do not start a separate techportal dev server or bind a new port unless the user explicitly approves a runtime architecture change.
- The shared app-shell currently serves `/techportal` under the existing staging web runtime.

## Folder Layout

```text
features/techportal/
  README.md
  module.json
  PROJECT_MODULE_CONTEXT.md
  api/
    techportal/
      __init__.py
      router.py
  web/
    TechPortalPage.jsx
    techPortal.css
  common/
    README.md
  features/
    dashboard/
      README.md
      module.json
      PROJECT_MODULE_CONTEXT.md
    ticketing/
      README.md
      module.json
      PROJECT_MODULE_CONTEXT.md
    logs/
      README.md
      module.json
      PROJECT_MODULE_CONTEXT.md
    system-settings/
      README.md
      module.json
      PROJECT_MODULE_CONTEXT.md
```

## Initial Feature Areas

### Dashboard

Current status: implemented as the KPI-only Tech Portal landing screen.

Technician home screen for:

- Assigned ticket count.
- Urgent ticket count.
- Due-today ticket count.
- Overdue ticket count.
- In-progress ticket count.
- Completed-today ticket count.

Current API:

- `GET /api/techportal/dashboard`
- Reads Ticketing-derived counters through an app-shell provider hook.
- Does not render ticket lists or ticket detail UI.

### Ticketing

Current status: first functional workflow at `/techportal/ticketing`.

Technician-facing ticket workspace for:

- Assigned ticket list.
- Kanban-style field-stage board, following the admin Ticketing stage-board pattern.
- Search, due-date, status, priority, and work-type filters.
- Ticket detail with customer, service, and placeholder network context.
- Accept/start/on-site/hold/complete status flow.
- Installation and repair checklist.
- Customer and service address details.
- Service Account and Service Order references.
- Network path context from Network Settings.
- Notes, photos, attachments, and customer-visible/internal updates.
- Materials used from Inventory.
- Follow-up request creation.

Current API:

- `GET /api/techportal/tickets`
- `GET /api/techportal/tickets/{ticket_id}`
- `POST /api/techportal/tickets/{ticket_id}/status`
- `POST /api/techportal/tickets/{ticket_id}/notes`

The current implementation writes ticket status and internal notes back to the shared in-memory Ticketing records. The page is intentionally mobile-first: filters stack on small screens, Kanban columns are horizontally swipeable, and ticket details open in a full-screen drawer on phones. Evidence uploads, material usage, checklist persistence, Network Settings lookups, and technician-scoped Logs remain future work.

### Logs

Technician-scoped activity history for:

- Own ticket actions.
- Status changes.
- Notes and evidence uploads.
- Inventory/material usage.
- Network provisioning actions requested or completed.
- Login/session activity.

This should read from the shared Logs module later, but expose only technician-relevant records.

### System Settings

Technician portal settings for:

- Technician profile.
- Password/session preferences.
- Device/app preferences.
- Notification preferences.
- Offline sync status in a future PWA phase.
- Basic help/knowledge links.

This is not the full admin System Settings module. It should expose only technician-safe preferences.

## Enterprise/ISP Workflow Plan

### 1. Installation Work

1. Customer Profiling owns the customer identity and address.
2. Service creates a Service Account and Service Order.
3. Service creates a linked Ticketing ticket.
4. Dispatcher/admin assigns the ticket to a technician.
5. Technician opens `/techportal` and sees the assigned installation ticket.
6. Technician reviews customer details, service address, requested plan, and checklist.
7. Technician records field work: arrival, installed ONU/CPE, NAP box, splitter/port, photos, signal readings, and materials.
8. Tech Portal sends completion data to Ticketing and Network Settings.
9. Network Settings creates or updates network attachment/provisioning context, including PPPoE workflow when ready.
10. Service Account can move toward active once provisioning and installation completion pass.

### 2. Repair/Trouble Work

1. Ticketing assigns a repair ticket to the technician.
2. Tech Portal shows customer, service account, network path, recent outages/events, and previous notes.
3. Technician records diagnosis, actions taken, photos, test readings, and material usage.
4. Ticketing receives status/notes and the final resolution.
5. Logs records technician activity.
6. Customer Service Management can use the result for customer follow-up.

### 3. PPPoE And Network Actions

Tech Portal should not directly expose raw MikroTik admin controls. It should request structured network actions:

- create PPPoE account for installation
- validate PPPoE login/session
- disable/re-enable PPPoE access for suspension/reconnection workflows
- update profile for plan changes
- update network attachment after relocation or equipment replacement

Network Settings owns the actual network source-of-truth and future device adapter execution.

## Planned Data Contracts

Tech Portal should reference existing records instead of owning them:

- `technicianId`
- `ticketId`
- `ticketNumber`
- `customerId`
- `serviceAccountId`
- `serviceOrderId`
- `networkAttachmentId`
- `napBoxId`
- `onuId`
- `inventoryItemIds`
- `workSessionId`
- `evidenceIds`
- `activityLogIds`

Planned technician work-session fields:

- status: `ASSIGNED`, `ACCEPTED`, `EN_ROUTE`, `ON_SITE`, `IN_PROGRESS`, `ON_HOLD`, `COMPLETED`, `CANCELLED`
- acceptedAt
- enRouteAt
- arrivedAt
- startedAt
- completedAt
- holdReason
- location snapshot when allowed
- checklist completion
- notes and attachments

## Cross-Module Connections

| Module | Connection |
| --- | --- |
| Ticketing | Primary work source. Tech Portal should list assigned tickets and write status, notes, evidence, and completion details back to Ticketing. |
| Customer Profiling | Read customer identity, contact, service address, location, and avatar context. |
| Service | Read Service Account, Service Order, catalog plan, workflow state, and service reference. Installation completion should help activate service workflow later. |
| Network Settings | Read network path, OLT/PON/NAP/ONU context, serviceability, and PPPoE account/provisioning status. Network actions should be requested through Network Settings. |
| Inventory | Record materials, ONU/CPE, routers, cables, and tools used on a ticket. |
| Logs | Store technician activity, status changes, notes, evidence actions, and network provisioning requests. |
| System Settings | Shared branding, map providers, notifications, access/session settings, and portal-safe technician preferences. |
| Account Admin | Future technician identity, role, team, skill, and permission source if Account Admin becomes customer-account admin plus staff assignment later. |
| Billing | Read-only context for payment/suspension warnings; technicians should not edit billing records. |
| Customer Service Management | Receives post-work follow-up context and customer communication history. |

## Security And Access Boundaries

- Tech Portal is technician-only.
- Technicians should see only tickets assigned to them, assigned to their team, or explicitly released to a technician queue.
- No full admin CRUD should be exposed in Tech Portal.
- Do not expose raw router, OLT, SNMP, MikroTik, or PPPoE credentials.
- Technician uploads and notes must be actor-linked and auditable.
- Location tracking should be explicit, purpose-limited, and configurable.
- Portal sessions should follow shared authentication/session rules and future role enforcement from System Settings -> Access.
- Offline caches, if added later, must avoid storing secrets and should expire sensitive ticket/customer data.

## First Implementation Milestones

1. Create this folder and planning docs.
2. Integration Codex wires `/techportal` route under staging web at `8280` when requested.
3. Add technician-only auth gate using shared access/session model. Done for first-pass login/navigation.
4. Add Dashboard KPI summary from Ticketing. Done as KPI-only `/techportal`.
5. Add Ticketing feature with assigned ticket list and detail view. Done as separate `/techportal/ticketing` Kanban workflow.
6. Add technician status transitions and ticket notes. Done for internal notes and core field statuses.
7. Add checklist/evidence upload model.
8. Add Network Settings context panel for NAP/ONU/PPPoE/serviceability data.
9. Add Inventory material usage capture.
10. Add Logs view filtered to technician activity.
11. Add portal-safe System Settings profile/preferences.
12. Add offline/PWA support after the online workflow is stable.

## Current Status

- Folder created: `features/techportal/`
- Status: `functional-dashboard-ticketing`
- App-shell route `/techportal` is wired.
- App-shell route `/techportal/ticketing` is wired for technician Ticketing.
- API router `/api/techportal` is wired.
- Current Tech Portal APIs include dashboard plus ticket queue/detail/status/note endpoints.
- System Settings -> Access seeds Tech Portal permissions, a built-in `technician` role, and the temporary test user `tech` / `tech12345`.
- Shared login is intentionally prefilled with `tech` / `tech12345` for quick testing; remove this before production use.
- Technician-role sessions are limited in the app-shell UI to Tech Portal, View Profile, and Change Password, but full cross-module backend permission enforcement is still future work.
