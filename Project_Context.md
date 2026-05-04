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
- Common shell features: side navigation, top header with page name and system metrics, logs, system settings, system port registry, profile, and change password

## Architecture Pattern

This repo uses a modular monolith for fastest AI-assisted development:

- `app-shell/` owns shared application code only: login/session, layout, navigation, system settings, logs, runtime health, and Docker entry points.
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
  web/        Billing page/components/styles
  api/        Billing FastAPI router/service shell

ticketing/
  web/        Ticketing page/components/styles
  api/        Ticketing FastAPI router/service shell
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

New business modules should get their own root-level folder with at least `README.md` and `module.json`.

## Customer Profiling Module

The previous standalone `customer-profiling` work has been restored into the modular monolith at `/customer-profiling` using the new React/Vite + FastAPI stack. Customer Profiling-specific code now lives in the module folder:

- Frontend page/styles: `customer-profiling/web/`
- API router/state: `customer-profiling/api/customer_profiling/`

The current module includes:

- Customer overview KPIs and distribution tables
- Customer list with search and filters for type, status, province, city, and barangay
- Create/edit/view/soft archive customer profile workflows
- Primary contact, alternate mobile, Facebook account/link, email, service address, GPS, and secondary contact fields
- Customer type/status values: `RESIDENTIAL`, `BUSINESS`, `ENTERPRISE`; `ACTIVE`, `INACTIVE`, `SUSPENDED`, `PENDING`
- Service assignment workflow with plan ID, service ID, start/end dates, and assignment status
- Bulk upload template workflow surface with the original required customer upload headers

Current API prefix: `/api/customer-profiling`. The implementation is in-memory for the first working shell; durable PostgreSQL tables in the shared database should be added before production use.

## Billing Module

Billing has a first working CRUD shell in `/billing` using the modular monolith stack:

- Frontend page/styles: `billing/web/`
- API router/state: `billing/api/billing/`
- Current API prefix: `/api/billing`

The current module includes:

- Customer lookup through Customer Profiling customer records
- Monthly ISP subscription CRUD with `PREPAID` and `POSTPAID` billing modes
- Subscription invoice generation for monthly internet service periods
- Invoice CRUD with line items, billing cycle dates, due dates, status derivation, and voiding
- Payment CRUD/voiding for invoice-level and customer-level payments
- Adjustment CRUD/voiding for invoice credits and debits
- Customer balance summaries with outstanding balance, credit, overdue total, and open invoice count
- Billing dashboard metrics for active subscriptions, open invoices, overdue invoices, collections, MRR, and outstanding balance

The implementation is in-memory for the first working shell; durable PostgreSQL tables in the shared database should be added before production use.

## Ticketing Module

Ticketing has a first working CRUD shell in `/ticketing` using the modular monolith stack:

- Frontend page/styles: `ticketing/web/`
- API router/state: `ticketing/api/ticketing/`
- Current API prefix: `/api/ticketing`

The current module includes:

- Ticket CRUD with ticket number, subject, description, status, priority, category, source, due date, and resolution fields
- Search/filter by free text, status, priority, and category
- Customer lookup through Customer Profiling when a customer record exists
- Manual requestor/contact placeholders for tickets that are not linked to Customer Profiling yet
- Free-text assignee placeholder until Account Admin staff/user records are available
- Service ID and outage ID placeholder fields for future service-assignment and outage integrations
- Ticket notes with internal/customer-visible visibility
- Ticketing dashboard metrics for open tickets, urgent tickets, field-job categories, and SLA risks

Prerequisites and integration notes:

- Customer Profiling is the dependency for durable customer/account linkage. Ticketing can already link to Customer Profiling records but still allows manual requestor fields.
- Account Admin is the dependency for real staff assignment and ownership. The first CRUD shell uses free-text `assignedTo`.
- Inventory, outage tracking, and dispatch workflows are future dependencies for field jobs. The first CRUD shell keeps `serviceId` and `outageId` as reference placeholders.

The implementation is in-memory for the first working shell; durable PostgreSQL tables in the shared database should be added before production use.

## Ports

- `8180/tcp`: threejmain web/admin entry point
- `8100/tcp`: threejmain FastAPI API
- `5432/tcp`: PostgreSQL container-only default
- Avoid using `3JCentralPisowifi` ports: `8080/tcp`, `80/tcp`, `1812/udp`, `1813/udp`, `11812/udp`, and `11813/udp`

The app exposes a System Settings -> Ports page backed by `/api/system/ports` so operators can view reserved and in-use ports.

## GitHub Branch Workflow

- `master` is production only.
- `staging` is the integration/testing branch.
- `codex/<agent>/<task-name>` branches are temporary Codex task branches.
- Codex sessions must not commit directly to `master`.
- Codex sessions must not push directly to `master`.
- Codex sessions must not push directly to `staging` unless the user explicitly approves.
- Codex task branches should be created from `origin/staging`.
- Codex task branches should be merged into `staging` by Pull Request.
- Production releases should merge `staging` into `master` by Pull Request.
- Codex sessions must not force push unless the user explicitly approves.

## Worktree Workflow

- Codex worktrees are created under `/home/worktrees/`.
- Each Codex task should use one isolated worktree and one `codex/<agent>/<task-name>` branch.
- Shared AI coordination state is stored at `/home/threejmain/.ai_coord`.
- Worktrees should export `AI_COORD_STATE_DIR=/home/threejmain/.ai_coord` so all Codex sessions share locks, agents, and activity.

## Important Scripts

- `scripts/ai_coord.py`: Codex identity, activity, and file lock coordination.
- `scripts/start_codex.sh`: Starts/registers a Codex session with shared coordination instructions.
- `scripts/create_codex_worktree.sh`: Creates a Codex worktree and task branch from `origin/staging`.
- `scripts/codex_checkpoint.sh`: Creates safe checkpoint commits and pushes only the current `codex/*` task branch.

## Documentation

- `docs/GITHUB_WORKFLOW.md`: Branch model, worktree examples, checkpoint examples, and PR flow.
- `docs/BRANCH_PROTECTION.md`: GitHub UI guidance for protecting `master` and `staging`.

## Safety Notes

- Do not commit secrets, `.env` files, credentials, API keys, database passwords, or tokens.
- Do not commit `.ai_coord/`; it is local runtime state for coordination.
- Do not run destructive Git commands unless the user explicitly approves.
