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
  web/        module-owned React pages/styles
  api/        module-owned FastAPI routers
```

## Module Structure

Root-level business module folders:

- `customer-profiling`: customer records, account identity, service plans, contacts, addresses, lifecycle state, bulk upload workflow, and service assignments
- `billing`: invoices, subscriptions, payments, adjustments, balances, and billing cycles
- `point-of-sale`: counter sales, receipts, payment capture, cashier sessions, and sales reports
- `inventory`: routers, ONUs/CPEs, cables, installation materials, stock movement, and reorder alerts
- `account-admin`: admin users, roles, permissions, access, and account security
- `customer-service-management`: customer interactions, service requests, follow-ups, callbacks, and care workflows
- `ticketing`: trouble tickets, outage tracking, field jobs, dispatch, notes, and resolution history
- `system-settings`: branding, business profile, reusable locations, runtime paths, access reminders, and system port registry
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

- Customer overview KPIs and distribution tables
- Customer list with search and filters for type, status, province, city, and barangay
- Create/edit/view/soft archive customer profile workflows
- Primary contact, alternate mobile, Facebook account/link, email, service address, GPS, and secondary contact fields
- Service location records are connected to System Settings -> Location Management; customer create/update can link an existing location or create a minimal location record if no saved match exists
- Customer type/status values: `RESIDENTIAL`, `BUSINESS`, `ENTERPRISE`; `ACTIVE`, `INACTIVE`, `SUSPENDED`, `PENDING`
- Service assignment workflow with plan ID, service ID, start/end dates, and assignment status
- Bulk upload template workflow surface with the original required customer upload headers

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
| System Settings | `/system-settings` | `/api/system-settings` | `system-settings/web/SystemSettingsPage.jsx` | `system-settings/api/system_settings` |

Shared app-shell wiring now imports each module page in `app-shell/web/src/main.jsx`, includes each router in `app-shell/api/app/main.py`, injects shared auth/audit hooks, and exposes module metrics through `/api/modules` and `/api/dashboard`.

Customer-dependent modules receive Customer Profiling provider hooks from the app shell for customer lookup/search where supported. All integrated module data remains in memory and resets on API restart. Durable shared PostgreSQL persistence, migrations, role/permission enforcement, and production-grade cross-module relationships are still future work.

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

System Settings includes first-phase in-memory Location Management under `/api/system-settings/locations`, with Nominatim-compatible geocoder lookup configurable through `GEOCODER_SEARCH_URL`. Location Management preloads known Customer Profiling service-area barangays, supports `PATCH /api/system-settings/locations/{location_id}` for edits, and exposes an internal helper that Customer Profiling uses to create or link minimal locations during customer saves. Location records remain in memory until shared PostgreSQL persistence is added.

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

## GitHub Branch Workflow

- `master` is production only.
- `staging` is the integration/testing branch.
- `codex/<agent>/<task-name>` branches are temporary Codex task branches.
- Codex sessions must not commit directly to `master`.
- Codex sessions must not push directly to `master`.
- Codex sessions must not push directly to `staging` unless the user explicitly approves.
- Codex task branches should be created from `origin/staging`.
- Default fast-development flow is module branches -> Integration Codex staging-ready integration -> `staging` -> `master`.
- Module Codex sessions should push clean `codex/*` module branches for backup and for Integration Codex to fetch.
- Module Codex sessions do not need to open PRs by default.
- Clean module branches should be created from latest `origin/staging` and change only their module folder, such as `billing/` or `inventory/`.
- Clean module branches must not include `app-shell/`, Docker files, `Project_Context.md`, `AGENTS.md`, scripts, docs, another module folder, or broad customer-profiling deletions.
- Before reporting a module branch as complete, Module Codex must run `git diff --name-only origin/staging...HEAD` and confirm every changed path starts with the module folder.
- Do not stack module branches on old broad migration branches or another module branch.
- Integration Codex owns collecting completed module branch outputs, wiring `app-shell/`, running checks, and preparing one staging-ready integrated result.
- Integration Codex may push directly to `staging` only when the user explicitly confirms that exact action.
- Individual module PRs into `staging` are optional and should be used only when the user explicitly requests PR review.
- Production releases should merge `staging` into `master` by Pull Request.
- Codex sessions must not force push unless the user explicitly approves.

## Worktree Workflow

- Codex worktrees are created under `/home/worktrees/`.
- Each Codex task should use one isolated worktree and one `codex/<agent>/<task-name>` branch.
- Shared AI coordination state is stored at `/home/threejmain/.ai_coord`.
- Worktrees should export `AI_COORD_STATE_DIR=/home/threejmain/.ai_coord` so all Codex sessions share locks, agents, and activity.

## Integration Codex Workflow

- `integration_codex.md` is the operating guide for the dedicated Integration Codex terminal.
- Module Codex sessions should build CRUD inside their own module folders first.
- Module Codex sessions should keep module-local lasting context in `<module-name>/PROJECT_MODULE_CONTEXT.md`.
- Integration Codex owns fetching completed module branches, copying/merging module folder outputs, wiring completed modules into `app-shell`, Docker/Vite access, shared API/router imports, shared navigation/page imports, and integration notes.
- Integration Codex reads each module's `PROJECT_MODULE_CONTEXT.md` and merges only stable cross-project summaries into the main `Project_Context.md`.
- Integration Codex prepares one staging-ready integrated commit and may push it directly to `staging` only after explicit user approval.
- Integration Codex should decline unrelated work and only accept app-shell integration requests such as `Integrate inventory into app-shell` or `Integrate these completed modules into app-shell as a batch: inventory, ticketing`.
- Integration is needed because module-local code does not appear in the shared web app or shared API until `app-shell` imports and routes it.

## Important Scripts

- `scripts/ai_coord.py`: Codex identity, activity, and file lock coordination.
- `start_codex.md`: Codex startup guide. There is no shell startup script; use this Markdown guide instead.
- `scripts/create_codex_worktree.sh`: Creates a Codex worktree and task branch from `origin/staging`.
- `scripts/codex_checkpoint.sh`: Creates safe checkpoint commits and pushes only the current `codex/*` task branch.

## Documentation

- `docs/GITHUB_WORKFLOW.md`: Branch model, worktree examples, checkpoint examples, and PR flow.
- `docs/BRANCH_PROTECTION.md`: GitHub UI guidance for protecting `master` and `staging`.

## Safety Notes

- Do not commit secrets, `.env` files, credentials, API keys, database passwords, or tokens.
- Do not commit `.ai_coord/`; it is local runtime state for coordination.
- Do not run destructive Git commands unless the user explicitly approves.
