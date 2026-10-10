# Dashboard Module Context

## Purpose And Ownership

Read-only main ISP operations summary. Extracted from app-shell into
`features/dashboard/`; follows Customer Profiling's folder/metadata pattern and
Logs' configured API router pattern. Separate from Tech Portal's technician
Dashboard. No module-local business CRUD or persistence.

## Entry Points

- Route: `/dashboard`; root `/` remains a shell alias.
- Frontend: `web/DashboardPage.jsx`, default export `DashboardPage({ data })`.
- Styles: `web/dashboard.css`, scoped to `.dashboard-page`.
- Python package: `api/dashboard`; exports `configure_dashboard` and `router`.
- API: authenticated `GET /api/dashboard`, no redirect or trailing slash needed.

## API Contract And Data Sources

Top-level keys remain `summary`, `modules`, `module_counts`, `alerts`.
Summary keys remain `modules`, `customers`, `open_tickets`, `monthly_revenue`,
`inventory_alerts`. Monthly revenue is Billing's monthly recurring revenue,
not a new collection/payment calculation. Customer count comes from Customer
Profiling; open tickets from Ticketing; low stock from Inventory. Registered
metrics include Service, Collector, POS, Customer Service Management, Network
Settings, Account Access Management, Process Flow, Tech Portal, System Settings,
and Logs. Dashboard owns no copies of these records.

`configure_dashboard(current_admin, seed_module_data, sync_module_metrics,
modules, customer_metrics)` receives shell callbacks and the existing module
list. Seeding precedes metric refresh exactly as before. Shared `/api/modules`
uses the same registry and refresh functions. Dashboard is not added to that
business registry, preserving displayed counts and its response contract.

## Shared Shell Boundary

App-shell owns navigation, permissions/portal selection, authenticated summary
loading and refresh, sessions, branding, header resources, registry composition,
and metric callback wiring. It imports the page and router; it no longer owns
the Dashboard JSX, specific CSS, or summary endpoint implementation.
API Dockerfile includes `features/dashboard/api/dashboard`; Vite and web Docker
already support the full `features/` tree. Shared status-card badge styling stays
in app-shell because Customer Profiling, CSM, POS, and Network Settings use it too.

## Research And Future Functions

Official UISP documentation separates CRM customer/service identity from
network device/topology management and exposes Dashboard as a CRM integration
surface. Source links and a full connection map are in `README.md`.
Applied boundary: Dashboard summarizes authoritative source modules, with no
provisioning, payment, stock, or ticket writes. Future work may introduce
role-scoped summaries, source drill-downs, reporting periods, metric freshness,
partial-failure states, exports, and audited widget configuration, after explicit
contract and product decisions.

## Access And Risks

- Shared authentication remains required. Existing collector navigation gates
  Dashboard through `dashboard.view`; technician access remains Tech Portal.
- The existing summary endpoint checks authentication only, not
  `dashboard.view`. No access policy changes are bundled with extraction.
- UI defaults missing summary values to zero; shell handles request failures.
  Source exceptions still propagate. Static Operational Notes remain unchanged.
- Financial, network, and stock metric correctness remains source-owned.
- No new database tables, migrations, dependencies, audit mutations, polling,
  environment variables, or production changes.

## Focused Verification

`api/tests/test_dashboard_api.py` checks the complete preserved response,
seeding/refresh order, missing optional metrics, shared registry changes,
unauthorized requests, and unconfigured module behavior using injected fixtures.
Shared integration checks should also cover the web build, API package in Docker,
one `/api/dashboard` route, existing portal permission tests, and staging health.

Verified on 2026-10-10: five Dashboard API tests, four portal navigation tests,
and the existing Dashboard permission test passed. Staging Docker API/web builds
and health checks passed. Playwright at 1440x1000 and 390x844 confirmed the same
18 summary/module cards, card text and geometry as before extraction, no page
horizontal overflow, and no browser errors. Summary, alert, and module-id
contracts matched the pre-deployment response. Root alias works; unauthenticated
requests return 401. Docker endpoint owner is `dashboard.router`, registered
once at `/api/dashboard`. Host Graphify was refreshed.
