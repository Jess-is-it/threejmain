# Dashboard

Main ISP operations Dashboard, extracted from app-shell using the Customer
Profiling and Logs module conventions. This is the existing Dashboard, not the
separate technician Dashboard under `features/techportal/features/dashboard/`.

## Entry Points

- Page: `/dashboard` (the shell also resolves `/` to Dashboard).
- Frontend: `web/DashboardPage.jsx`; styles: `web/dashboard.css`.
- API: `GET /api/dashboard`, provided by `api/dashboard/router.py`.
- Metadata: `module.json`; shared module memory: `PROJECT_MODULE_CONTEXT.md`.

## Current Functions And Workflow

After shared login, app-shell loads the summary and passes it as `data` to
`DashboardPage`. The page shows Modules, Customers, Open Tickets, Inventory
Alerts, the Business Modules overview, and Operational Notes. API responses also
include monthly recurring revenue and all registered module metrics.

This module is read-only. It has no create/edit/delete actions, background jobs,
new tables, report exports, or private stores. Source modules retain ownership
of operational records. Navigation, login, session recovery, header resources,
and the shared module registry remain app-shell responsibilities.

`configure_dashboard(current_admin, seed_module_data, sync_module_metrics,
modules, customer_metrics)` injects those shared dependencies, matching the
existing module configuration pattern. The API refreshes the same source
metrics as before; it does not create a second copy of business data.

## Research And ISP Connections

Reviewed Ubiquiti's official [UISP Site & Device Management guide](https://help.uisp.com/hc/en-us/articles/22590965763991-UISP-Site-Device-Management),
which separates physical network objects from CRM customers and services, and
its [CRM plugin manifest](https://github.com/Ubiquiti-App/UCRM-plugins/blob/master/docs/manifest.md),
which identifies Dashboard as a distinct CRM integration surface.

Applied design decision: Dashboard is a read-only overview over owning modules.
It must distinguish customers, service lines, and network equipment instead of
treating those counts as interchangeable. The extraction preserves the current
screen and contracts; research-informed enhancements below are future scope.

| Source | Current Connection | Future Boundary |
| --- | --- | --- |
| Customer Profiling | Customer count | Customer lifecycle drill-down uses Customer Profiling records. |
| Billing | Monthly recurring revenue in API; registered metrics | Balances, invoices, payments, and collections remain Billing-owned. |
| Ticketing | Open ticket count | Dispatch, installation, outage, and SLA details remain Ticketing-owned. |
| Inventory | Low-stock count | Equipment custody and stock alerts use Inventory records. |
| Service | Registered metrics | Account, plan, and order states stay distinct from customer identity. |
| Collector / Point of Sale | Registered metrics | Collection custody and counter receipts must not be double-counted as revenue. |
| Network Settings / Account Access Management | Registered metrics | Device/PPPoE status and provisioning stay with their owning modules. |
| Customer Service Management | Registered metrics | Follow-up and service-request queues remain source-owned. |
| System Settings | Shared branding, access rules, registered metrics | Dashboard configuration would use shared access control. |
| Logs | Registered audit-event count | No business mutation occurs here; viewing does not add an audit event. |
| Process Flow / Tech Portal | Registered metrics | Technician job views remain separate from the main business Dashboard. |

Expected future enterprise requirements include role-scoped KPI visibility,
source drill-downs, clear metric definitions and reporting periods, data
freshness, partial-source failure states, and audited configuration changes.
These require a separate feature request and agreed source contracts.

## Access, States, And Known Limits

- API authentication is delegated to app-shell's `current_admin`.
- Existing collector navigation uses `dashboard.view`; technician navigation
  goes to Tech Portal. No role assignments or permissions changed here.
- Existing API authentication does not itself check `dashboard.view`; this
  extraction preserves that behavior. Separate API authorization work is needed
  before promising role-filtered or confidential financial KPIs.
- Missing summary values render as zero as before. Shared shell refresh handles
  loading and request failures; no independent polling is added.
- Optional absent Billing, Ticketing, or Inventory metrics default to zero in
  the API. Source errors still propagate; degraded-data UI is future scope.
- Operational Notes are the existing static notices, not live incident alerts.
- Dashboard is not inserted into the existing business module registry, so
  moving the code does not change module counts or `/api/modules` responses.

## Integration And Verification

App-shell imports `DashboardPage`, configures/includes the router, and adds the
Dashboard Python package to its local import paths. The API Dockerfile copies
the package. The existing Vite allowlist and web Dockerfile already include all
of `features/` and need no new entries. Global Tabler and shell layout styles
remain shared, including the status-card badge rule used by other modules;
Dashboard-specific selectors are scoped under `.dashboard-page`.

Focused API tests: `python3 -m unittest discover -s features/dashboard/api/tests`.
Run the web build and staging deployment only while holding `runtime/server`.
No database migration, production port changes, or new dependencies are needed.
