# Project Context

This file is the long-term shared project memory for all Codex sessions. Every new Codex session must read this file before starting work, and it should be updated whenever important lasting project information changes.

Do not use this file as a detailed activity log. Use the coordination script for activity updates:

```bash
python3 scripts/ai_coord.py update <agent> "<task-name>" "<what changed>" --files <changed files>
```

## Repository

- Project root: `/home/threejmain`
- GitHub remote: `git@github.com:Jess-is-it/threejmain.git`
- Default production branch: `master`
- Integration/testing branch: `staging`

## Product Direction

`threejmain` is a modular ISP business management application for a small internet service provider. The first working shell uses the UI style from `/home/threejpisowifi/services/admin` and adapts it for the new business management system.

## UI References

- `/home/threejmon` is a cloned copy of `https://github.com/Jess-is-it/threejmon.git` for UI reference only. Codex sessions may inspect it for layout, component, styling, page, and interaction ideas, but must not edit it or copy backend/configuration blindly into `threejmain`.
- `/home/threejpisowifi/services/admin` remains the original UI basis for the current shared shell style.

## Current Tech Stack

- Shared frontend shell: React + Vite + Tabler under `app-shell/web`
- Shared backend shell: FastAPI under `app-shell/api`
- Database target: one shared PostgreSQL database via Docker Compose
- Common shell features: side navigation, top header with page name and system metrics, profile, and change password

## Architecture Pattern

This repo uses a modular monolith for fastest AI-assisted development:

- `app-shell/` owns shared application code only: login/session, layout, navigation, runtime health, and Docker entry points.
- Each business module owns its module-specific frontend and API code inside its root-level module folder.
- Modules are loaded by the shared shell through imports/routers; they are not separate apps and should not run their own login/session system.
- The app uses one shared PostgreSQL database. Modules should use separate tables/schemas inside the shared database, not separate databases, unless the user explicitly approves a future split.
- New module code should be placed in that module folder first, then registered/imported by `app-shell`.

Current module code layout:

```text
app-shell/
  web/        shared React/Vite shell
  api/        shared FastAPI shell

customer-profiling/
  web/        Customer Profiling page/components/styles
  api/        Customer Profiling FastAPI router/service shell

billing/
point-of-sale/
inventory/
account-admin/
customer-service-management/
ticketing/
service/
  web/        module-owned React pages/styles
  api/        module-owned FastAPI routers
```

## Module Structure

Root-level business module folders:

- `customer-profiling`: customer records, account identity, contacts, addresses, lifecycle state, and bulk upload workflow
- `billing`: invoices, subscriptions, payments, adjustments, balances, and billing cycles
- `point-of-sale`: counter sales, receipts, payment capture, cashier sessions, and sales reports
- `inventory`: routers, ONUs/CPEs, cables, installation materials, stock movement, and reorder alerts
- `account-admin`: admin users, roles, permissions, access, and account security
- `customer-service-management`: customer interactions, service requests, follow-ups, callbacks, and care workflows
- `ticketing`: trouble tickets, outage tracking, field jobs, dispatch, notes, and resolution history
- `service`: ISP service catalog, speed plans, customer Service Orders, installation requirements, and canonical service references for Billing and Ticketing
- `system-settings`: branding, business profile, reusable locations, Avatar settings, OPENAI settings, runtime paths, access reminders, and system port registry
- `logs`: shared audit log viewer for app-shell and module activity

New business modules must get their own root-level folder and follow the module-folder pattern used by `customer-profiling/`.

Required module-folder skeleton:

```text
<module-name>/
  README.md
  module.json
  PROJECT_MODULE_CONTEXT.md
  api/
    <python_package>/
      __init__.py
      router.py
  web/
    <ModulePage>.jsx
    <moduleStyles>.css
```

Module folder rules:

- Use lowercase kebab-case folder names such as `billing`, `inventory`, and `customer-service-management`.
- Put module-specific CRUD pages, styles, API routers, services, fixtures, and helpers inside the module folder.
- Do not put module-specific CRUD implementation directly inside `app-shell/`.
- Put module-local context in `<module-name>/PROJECT_MODULE_CONTEXT.md`.
- Module Codex sessions should update their own module context instead of the main `Project_Context.md` for ordinary module progress.
- The main `Project_Context.md` should only receive cross-project facts such as shared architecture, app-shell behavior, shared API contracts, shared database decisions, runtime ports, deployment workflow, cross-module dependencies, and integration status.
- Use FastAPI `APIRouter` from `<module-name>/api/<python_package>/router.py`.
- Use API prefix `/api/<module-name>` unless the user explicitly chooses another prefix.
- Keep first-phase CRUD shells in-memory unless the user asks for database persistence.
- Use the shared PostgreSQL database for durable data later; do not create per-module databases unless the user explicitly approves.
- Let the Integration Codex wire completed modules into `app-shell/` in batches and merge stable module context summaries into this file.

Each `PROJECT_MODULE_CONTEXT.md` should include:

- module purpose and current CRUD scope
- frontend entry points and important components
- backend router/API prefix and endpoint summary
- module-local data structures, placeholders, and test data
- dependencies on other modules
- known issues, risks, and follow-up work
- integration notes for Integration Codex

## Customer Profiling Module

The previous standalone `customer-profiling` work has been restored into the modular monolith at `/customer-profiling` using the new React/Vite + FastAPI stack. Customer Profiling-specific code now lives in the module folder:

- Frontend page/styles: `customer-profiling/web/`
- API router/state: `customer-profiling/api/customer_profiling/`

The current module includes:

- Customer overview KPIs
- Customer list with status tabs and collapsible filters for type, province, city, and barangay
- Create/edit/view/soft archive customer profile workflows
- Primary contact, alternate mobile, Facebook account/link, email, service address, GPS, and secondary contact fields
- Service location records are connected to System Settings -> Location Management; customer create/update can link an existing location or create a minimal location record if no saved match exists
- Customer type/status values: `RESIDENTIAL`, `BUSINESS`, `ENTERPRISE`; `ACTIVE`, `INACTIVE`, `SUSPENDED`, `PENDING`
- Service Orders are owned by the Service module and are not displayed in Customer Profiling
- Bulk upload CSV modal with template download, preview validation, duplicate checks, guarded import, and required customer upload headers

Current API prefix: `/api/customer-profiling`. The implementation is in-memory for the first working shell; durable PostgreSQL tables in the shared database should be added before production use.

## Integrated Functional Module Shells

The Integration Codex wired these completed module folders into `app-shell` as functional in-memory shells:

| Module | Web route | API prefix | Frontend entry | API package |
| --- | --- | --- | --- | --- |
| Billing | `/billing` | `/api/billing` | `billing/web/BillingPage.jsx` | `billing/api/billing` |
| Point of Sale | `/point-of-sale` | `/api/point-of-sale` | `point-of-sale/web/PointOfSalePage.jsx` | `point-of-sale/api/point_of_sale` |
| Inventory | `/inventory` | `/api/inventory` | `inventory/web/InventoryPage.jsx` | `inventory/api/inventory` |
| Account Admin | `/account-admin` | `/api/account-admin` | `account-admin/web/AccountAdminPage.jsx` | `account-admin/api/account_admin` |
| Customer Service Management | `/customer-service-management` | `/api/customer-service-management` | `customer-service-management/web/CustomerServiceManagementPage.jsx` | `customer-service-management/api/customer_service_management` |
| Ticketing | `/ticketing` | `/api/ticketing` | `ticketing/web/TicketingPage.jsx` | `ticketing/api/ticketing` |
| Service Catalog | `/service/catalog` | `/api/service` | `service/web/ServicePage.jsx` | `service/api/service` |
| Service Order | `/service/order` | `/api/service` | `service/web/ServicePage.jsx` | `service/api/service` |
| System Settings | `/system-settings` | `/api/system-settings` | `system-settings/web/SystemSettingsPage.jsx` | `system-settings/api/system_settings` |
| Logs | `/logs` | `/api/logs` | `logs/web/LogsPage.jsx` | `logs/api/logs` |

Shared app-shell wiring now imports each module page in `app-shell/web/src/main.jsx`, includes each router in `app-shell/api/app/main.py`, injects shared auth/audit hooks, and exposes module metrics through `/api/modules` and `/api/dashboard`.

Customer-dependent modules receive Customer Profiling provider hooks from the app shell for customer lookup/search where supported. Most integrated module data remains in memory and resets on API restart. System Settings Location Management records, deleted preloaded-location markers, avatar images, avatar emotion settings, and OPENAI settings persist separately in the API data volume. Durable shared PostgreSQL persistence, migrations, role/permission enforcement, and production-grade cross-module relationships are still future work.

Service is now integrated as a functional in-memory module with separate app-shell pages for Service Catalog and Service Order. Create/edit workflows open in module-owned modals. Service owns catalog CRUD, Service Account records, Service Order CRUD, customer lookup, catalog list pricing, and canonical `serviceReference` values. Billing subscriptions use active Service Accounts as the billable target, keep Service Catalog plan/rate fields locked for linked subscriptions, and require an explicit override amount and reason when Billing charges a non-catalog monthly rate. Ticketing can select active Service Orders to populate ticket service references. Customer Profiling does not display or manage Service Orders.

`app-shell/web/vite.config.js`, `app-shell/api/Dockerfile`, and `app-shell/web/Dockerfile` include module allowlist/copy entries for the integrated module folders.

## Ports

- `8180/tcp`: threejmain web/admin entry point
- `8100/tcp`: threejmain FastAPI API
- `5432/tcp`: PostgreSQL container-only default
- Avoid using `3JCentralPisowifi` ports: `8080/tcp`, `80/tcp`, `1812/udp`, `1813/udp`, `11812/udp`, and `11813/udp`

The app exposes a System Settings -> Ports page backed by `/api/system/ports` so operators can view reserved and in-use ports.

System Settings now lives in the `system-settings/` module folder. Logs now lives in the `logs/` module folder. App-shell imports their pages and API routers while retaining compatibility endpoints:

- `system-settings/web/SystemSettingsPage.jsx`
- `system-settings/api/system_settings/router.py`
- `logs/web/LogsPage.jsx`
- `logs/api/logs/router.py`
- `/api/system/settings`
- `/api/system/ports`
- `/api/locations`
- `/api/audit-logs`

System Settings includes Location Management under `/api/system-settings/locations`, with Nominatim-compatible geocoder lookup configurable through `GEOCODER_SEARCH_URL`. Location Management preloads known Customer Profiling service-area barangays, supports `PATCH /api/system-settings/locations/{location_id}` for edits, and exposes an internal helper that Customer Profiling uses to create or link minimal locations during customer saves. Location records persist to the System Settings data file for restart safety until shared PostgreSQL persistence is added.

System Settings Location Management records, deleted preloaded-location markers, Avatar uploads, avatar emotion guide settings, and OPENAI settings persist to `SYSTEM_SETTINGS_DATA_PATH`, which Docker Compose sets to `/app/data/system_settings.json` in the `threejmain_api_data` named volume. This keeps reusable locations, uploaded avatar images, and AI integration configuration across API container restarts/rebuilds. OPENAI stores the selected model, optional organization/project ids, and server-side API key; API responses expose only masked key metadata to the frontend.

## Runtime Coordination

All Codex sessions share the same local runtime ports and Docker resources. Before any Codex builds, starts, stops, restarts, recreates, or otherwise changes the shared web/API/database runtime, it must lock:

```text
runtime/server
```

Use the coordination script:

```bash
python3 scripts/ai_coord.py recent
python3 scripts/ai_coord.py locks
python3 scripts/ai_coord.py lock runtime/server <agent> "<task-name>" "<why this server operation is needed>"
```

This applies to `docker compose up`, `docker compose up -d --build`, `docker compose build`, `docker compose restart`, `docker compose stop`, `docker compose down`, `npm run build`, `npm run dev`, `uvicorn`, `vite`, and any command that binds or frees shared project ports. If another Codex holds `runtime/server`, wait or work on unlocked files first.

Release `runtime/server` after the build/start/restart and immediate health checks are complete. Read-only checks like `docker compose ps` or `curl` health checks do not need the runtime lock.

## Shared Test Server Workflow

The project is back to one shared working tree and one shared test server for normal Codex development.

Normal Codex work happens in:

```text
/home/threejmain
```

All visual review should use:

```text
http://192.168.50.70:8180/
```

All API review should use:

```text
http://192.168.50.70:8100/
```

Module Codex sessions should not create per-Codex preview servers, per-Codex worktrees, or per-Codex task branches for normal work. They should coordinate through `scripts/ai_coord.py`, lock the module folders and shared files they need, and use `runtime/server` before restarting or rebuilding the shared server.

Cross-module work is allowed only after locking every affected module folder and any shared app-shell files. This is important for Service Order features that affect Service, Customer Profiling, Billing, Ticketing, and app-shell contracts.

## GitHub Branch Workflow

- `master` is production only.
- `staging` is the shared integration/testing branch.
- `/home/threejmain` is the normal shared development working tree.
- Codex sessions must not commit directly to `master`.
- Codex sessions must not push directly to `master`.
- Codex sessions may commit and push directly to `staging` after following coordination locks, checking status/diffs, staging only owned locked files, and running appropriate verification.
- Module Codex sessions may commit their own completed module work directly on `staging`.
- Before committing, stage only files/folders owned and locked by that Codex, then verify exactly what is staged.
- Integration Codex owns shared app-shell wiring, cross-module integration checks, and shared runtime verification when needed.
- GitHub Codex owns status checks and the later `staging` -> `master` production PR.
- Production releases should merge `staging` into `master` by Pull Request.
- Codex sessions must not force push unless the user explicitly approves.

## Shared Working Tree Workflow

- Shared AI coordination state is stored at `/home/threejmain/.ai_coord`.
- All normal Codex sessions should work from `/home/threejmain`.
- All Codex sessions should export `AI_COORD_STATE_DIR=/home/threejmain/.ai_coord` so locks, agents, and activity are shared.
- Use file/folder locks before editing. Use `runtime/server` before shared server rebuilds/restarts.

## Integration Codex Workflow

- `integration_codex.md` is the operating guide for the dedicated Integration Codex terminal.
- Module Codex sessions should build CRUD inside their own module folders first.
- Module Codex sessions should keep module-local lasting context in `<module-name>/PROJECT_MODULE_CONTEXT.md`.
- Integration Codex owns wiring completed module folders into `app-shell`, Docker/Vite access, shared API/router imports, shared navigation/page imports, and integration notes.
- Integration Codex reads each module's `PROJECT_MODULE_CONTEXT.md` and merges only stable cross-project summaries into the main `Project_Context.md`.
- Integration Codex may prepare shared staging commits and push coordinated integration changes directly to `staging`.
- Integration Codex should decline unrelated work and only accept app-shell integration requests such as `Integrate inventory into app-shell` or `Integrate these completed modules into app-shell as a batch: inventory, ticketing`.
- Integration is needed because module-local code does not appear in the shared web app or shared API until `app-shell` imports and routes it.

## Important Scripts

- `scripts/ai_coord.py`: Codex identity, activity, and file lock coordination.
- `start_codex.md`: Codex startup guide. There is no shell startup script; use this Markdown guide instead.

## Documentation

- `docs/GITHUB_WORKFLOW.md`: Shared staging workflow, shared server rules, and production PR flow.
- `docs/BRANCH_PROTECTION.md`: GitHub UI guidance for protecting `master` and `staging`.

## Safety Notes

- Do not commit secrets, `.env` files, credentials, API keys, database passwords, or tokens.
- Do not commit `.ai_coord/`; it is local runtime state for coordination.
- Do not run destructive Git commands unless the user explicitly approves.
