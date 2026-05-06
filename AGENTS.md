# Multi-Codex Coordination Rules

This project may have multiple Codex sessions working at the same time.

Each Codex can work full-stack, but every Codex must coordinate with the others before editing files.

The coordination script is:

```bash
python3 scripts/ai_coord.py
```

Do not manually edit files inside:

```bash
.ai_coord/
```

---

# Core Workflow

Every Codex session must follow this order:

1. Register and get an identity.
2. Check recent updates.
3. Check current file locks.
4. Start or continue a task.
5. Before editing a file, check recent updates again.
6. Check current locks again.
7. Check out the file.
8. Edit only after successful checkout.
9. Post progress updates after meaningful changes.
10. Check files back in when done.
11. Post a final done update.

Never edit a file before checking recent updates.

Never edit a file before checking it out.

Never edit a file locked by another Codex.

---

# Project Context Rules

The file `Project_Context.md` is the long-term shared memory for this project.

Every Codex session must read `Project_Context.md` before starting work.

Every Codex session must keep `Project_Context.md` updated when important lasting project information changes.

`Project_Context.md` should include:

- Current tech stack
- Project structure
- Important commands
- Features completed or in progress
- Important frontend pages/components
- Important backend routes/services
- API contracts
- Database/model notes
- Environment variable names and purpose
- Deployment notes
- Important architectural/product decisions
- Known issues and risks
- Recent important changes that future Codex sessions should know

Do not use `Project_Context.md` as a noisy activity log.

Module-specific details should live in that module's local context file:

```text
<module-name>/PROJECT_MODULE_CONTEXT.md
```

Module Codex sessions should update their own `PROJECT_MODULE_CONTEXT.md` for module-local facts such as CRUD scope, API routes, frontend components, local data model notes, placeholders, test notes, and module-specific risks.

Module Codex sessions should not edit the main `Project_Context.md` for ordinary module progress. This keeps concurrent module work from waiting on one shared file.

Only update the main `Project_Context.md` when the change affects the whole project, such as:

- shared architecture
- app-shell behavior
- shared API contracts
- shared database decisions
- runtime ports
- deployment workflow
- cross-module dependencies
- integration status after a module is wired into `app-shell/`

The Integration Codex is responsible for reading completed module `PROJECT_MODULE_CONTEXT.md` files and merging stable, cross-project summaries into the main `Project_Context.md` during integration.

Use the coordination script for normal progress updates:

```bash
python3 scripts/ai_coord.py update <agent> "<task-name>" "<what changed>" --files <changed files>
```

---

# Module Folder Pattern Rules

This project uses a modular monolith. Business module work must live in that module's root-level folder first.

Use `customer-profiling/` as the reference pattern for module layout and ownership.

When creating a new business module, create a root-level folder using a lowercase kebab-case module name:

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

Examples:

```text
billing/
inventory/
point-of-sale/
account-admin/
customer-service-management/
ticketing/
```

Module Codex sessions should implement module CRUD inside their own module folder only.

Module Codex sessions must not place module-specific CRUD pages, API routers, services, or styles directly inside `app-shell/`.

Module Codex sessions must not edit `app-shell/` for navigation, route registration, Docker copy paths, Vite allowlists, or shared deployment wiring unless the user explicitly assigns that Codex an integration task.

The dedicated Integration Codex owns wiring completed module folders into `app-shell/`.

New module APIs should expose a FastAPI `APIRouter` under:

```text
<module-name>/api/<python_package>/router.py
```

Use this API prefix format unless the user specifies otherwise:

```text
/api/<module-name>
```

New module frontend code should live under:

```text
<module-name>/web/
```

For first-phase CRUD shells, in-memory module state is acceptable unless the user explicitly asks for database persistence. Durable tables should use the shared project database later, not a separate database, unless the user explicitly approves.

Each module folder must include:

- `README.md` describing module purpose, routes, CRUD scope, and integration notes
- `module.json` describing module id, display name, route path, API prefix, and entry points
- `PROJECT_MODULE_CONTEXT.md` describing module-local context for other Codex sessions

If a requested module does not yet have a folder, create the folder using this pattern before adding code.

---

# Codex Identity Rules

Every new Codex terminal must register before doing any work.

Register with:

```bash
python3 scripts/ai_coord.py register "<short description of this Codex session>"
```

The script will assign an incremental identity such as:

```text
codex-1
codex-2
codex-3
codex-4
```

Each identity is permanent.

Previously used identities must not be reused by new Codex sessions, even if the previous Codex session is retired or closed.

Before starting work, check registered agents:

```bash
python3 scripts/ai_coord.py agents
```

A Codex must use its assigned identity for all commands.

Example:

```bash
python3 scripts/ai_coord.py start codex-1 "login-feature" "Starting login feature"
```

Do not invent an identity manually.

Do not reuse another Codex identity.

Do not use a retired identity.

When a Codex terminal is permanently finished, retire it:

```bash
python3 scripts/ai_coord.py retire codex-1
```

---

# Required Startup Flow

When a Codex session begins, it must first read:

```bash
AGENTS.md
Project_Context.md
```

```bash
python3 scripts/ai_coord.py register "<short description of this Codex session>"
```

Then check current project coordination status:

```bash
python3 scripts/ai_coord.py status
```

Then announce the task:

```bash
python3 scripts/ai_coord.py start <agent> "<task-name>" "<what you are about to do>"
```

Example:

```bash
python3 scripts/ai_coord.py start codex-1 "login-feature" "Starting full-stack login feature"
```

---

# Before Editing or Checking Out Any File

Before attempting to lock/check out a file, always check recent updates first:

```bash
python3 scripts/ai_coord.py recent
```

Then check current locks:

```bash
python3 scripts/ai_coord.py locks
```

Then attempt checkout:

```bash
python3 scripts/ai_coord.py lock <file-path> <agent> "<task-name>" "<why you need this file>"
```

Example:

```bash
python3 scripts/ai_coord.py lock frontend/src/pages/Login.jsx codex-1 "login-feature" "Edit login page UI"
```

If the script says the file is locked by another Codex, do not edit that file.

---

# Adaptive Task Prioritization

If a needed file is locked by another Codex:

1. Read the recent updates and lock information.
2. Reassess the current task.
3. Decide whether another file can be safely worked on first.
4. If yes, prioritize unlocked files first.
5. Post an update that the original file is currently blocked.
6. Continue working on available files.
7. Return to the locked file later.
8. Before trying again, check recent updates and locks again.
9. Once the file becomes available, check it out before editing.

If all other work is complete and the only remaining work depends on a locked file, wait for it:

```bash
python3 scripts/ai_coord.py wait-lock <file-path> <agent> "<task-name>" "<why you are waiting for this file>"
```

Example:

```bash
python3 scripts/ai_coord.py wait-lock frontend/src/pages/Login.jsx codex-1 "login-feature" "Waiting to finish login page"
```

Never bypass the lock system.

Never manually edit a locked file.

---

# Server Runtime Lock Rules

The shared server/runtime must be treated like a shared file.

Before building, starting, stopping, restarting, recreating, or otherwise changing the shared web/API/database runtime, Codex must wait its turn by locking:

```text
runtime/server
```

This applies to commands such as:

```bash
docker compose up
docker compose up -d
docker compose up -d --build
docker compose build
docker compose restart
docker compose stop
docker compose down
npm run build
npm run dev
uvicorn ...
vite ...
```

It also applies to any command that binds or frees shared project ports, especially:

```text
8180/tcp
8100/tcp
5432/tcp
```

Before running a runtime-changing command, use this order:

```bash
python3 scripts/ai_coord.py recent
python3 scripts/ai_coord.py locks
python3 scripts/ai_coord.py lock runtime/server <agent> "<task-name>" "<why you need to build/start/restart the server>"
```

Example:

```bash
python3 scripts/ai_coord.py lock runtime/server codex-1 "billing-ui" "Rebuild shared Docker runtime to verify billing UI"
docker compose up -d --build
python3 scripts/ai_coord.py update codex-1 "billing-ui" "Rebuilt shared Docker runtime and verified web/API startup" --files runtime/server
python3 scripts/ai_coord.py unlock runtime/server codex-1
```

If another Codex holds `runtime/server`, do not build, start, stop, or restart the shared runtime. Work on unlocked code first, or wait:

```bash
python3 scripts/ai_coord.py wait-lock runtime/server <agent> "<task-name>" "<why you are waiting for the server runtime>"
```

Read-only runtime checks do not require the runtime lock. Examples:

```bash
docker compose ps
curl http://127.0.0.1:8100/health
curl http://127.0.0.1:8180/
```

Release `runtime/server` as soon as the build/start/restart operation and immediate verification are complete. Do not keep the runtime lock while doing normal coding.

---

# During Work

After meaningful progress, notify the other Codex sessions:

```bash
python3 scripts/ai_coord.py update <agent> "<task-name>" "<what changed>" --files <changed files>
```

Example:

```bash
python3 scripts/ai_coord.py update codex-1 "login-feature" "Updated login page UI" --files frontend/src/pages/Login.jsx
```

Post updates when:

- You start editing a new area.
- You finish a major file.
- You discover a dependency.
- You are blocked by another locked file.
- You change something another Codex may depend on.
- You change frontend/backend contracts.
- You change shared logic.
- You change configuration or package files.

---

# Checking Files Back In

When done with a file, check it back in:

```bash
python3 scripts/ai_coord.py unlock <file-path> <agent>
```

Example:

```bash
python3 scripts/ai_coord.py unlock frontend/src/pages/Login.jsx codex-1
```

If all files for the task should be checked in:

```bash
python3 scripts/ai_coord.py unlock-task <agent> "<task-name>"
```

Example:

```bash
python3 scripts/ai_coord.py unlock-task codex-1 "login-feature"
```

---

# Finishing a Task

Before releasing files, post a final progress update:

```bash
python3 scripts/ai_coord.py update <agent> "<task-name>" "Task complete; preparing to release locks" --files <changed files>
```

Then check in all files for the task:

```bash
python3 scripts/ai_coord.py unlock-task <agent> "<task-name>"
```

Then notify everyone that the task is done:

```bash
python3 scripts/ai_coord.py done <agent> "<task-name>" "<final summary, tests run, risks, and changed files>" --files <changed files>
```

Example:

```bash
python3 scripts/ai_coord.py done codex-1 "login-feature" "Finished login feature. Updated login UI and auth route. Tests still need review." --files frontend/src/pages/Login.jsx backend/routes/auth.js
```

A Codex must not silently stop after finishing a task.

It must notify the other Codex sessions using the `done` command.

---

# Required Command Order Before File Edits

Correct order:

```text
Check recent updates
↓
Check current locks
↓
Decide priority
↓
Try to lock/check out file
↓
Edit only if checkout succeeds
↓
Post update after meaningful progress
```

Incorrect order:

```text
Try to lock file
↓
Edit file
↓
Check updates later
```

Do not follow the incorrect order.

---

# Full Example Workflow

Example for `codex-1`:

```bash
python3 scripts/ai_coord.py status

python3 scripts/ai_coord.py start codex-1 "login-feature" "Starting full-stack login feature"

python3 scripts/ai_coord.py recent
python3 scripts/ai_coord.py locks
python3 scripts/ai_coord.py lock frontend/src/pages/Login.jsx codex-1 "login-feature" "Edit login page UI"

python3 scripts/ai_coord.py update codex-1 "login-feature" "Updated login page UI" --files frontend/src/pages/Login.jsx

python3 scripts/ai_coord.py recent
python3 scripts/ai_coord.py locks
python3 scripts/ai_coord.py lock backend/routes/auth.js codex-1 "login-feature" "Edit auth route"

python3 scripts/ai_coord.py update codex-1 "login-feature" "Updated auth route" --files backend/routes/auth.js

python3 scripts/ai_coord.py update codex-1 "login-feature" "Task complete; preparing to release locks" --files frontend/src/pages/Login.jsx backend/routes/auth.js

python3 scripts/ai_coord.py unlock-task codex-1 "login-feature"

python3 scripts/ai_coord.py done codex-1 "login-feature" "Finished login feature. Updated login UI and auth route. Tests need review." --files frontend/src/pages/Login.jsx backend/routes/auth.js
```

---

# High-Risk Files

Be extra careful with these files.

Always check recent updates and locks before touching them.

Prefer posting an update before and after changing them.

High-risk files include:

```text
package.json
package-lock.json
pnpm-lock.yaml
yarn.lock
.env
.env.local
.env.production
docker-compose.yml
Dockerfile
nginx configs
database migrations
shared types
shared components
auth/session files
deployment scripts
CI/CD files
```

If another Codex recently changed one of these files, inspect the update carefully before editing.

---

# Git Rules

Before starting work, check Git status:

```bash
git status --short
```

Before finishing work, check Git status again:

```bash
git status --short
```

Use Git to verify changed files:

```bash
git diff --name-only
```

Do not overwrite another Codex’s work.

Do not run destructive Git commands unless explicitly instructed by the user.

Do not run:

```bash
git reset --hard
git clean -fd
git checkout -- .
git push --force
```

unless the user explicitly approves.

---

# GitHub Branch Workflow

This repo uses:

- `master` for production
- `staging` for integration/testing
- `codex/<agent>/<task-name>` for individual Codex task branches

Codex sessions must not commit directly to `master`.

Codex sessions must not push directly to `master`.

Codex sessions must not push directly to `staging` unless the user explicitly approves.

Each Codex must work on its own feature/task branch created from `origin/staging`.

Branch naming format:

```text
codex/<agent>/<task-name>
```

Examples:

- codex/codex-1/login-feature
- codex/codex-2/dashboard-polish
- codex/codex-3/admin-user-table

Before starting work, Codex must verify the current branch:

```bash
git branch --show-current
```

The branch must not be `master` or `staging`.

Before committing, Codex must run:

```bash
git status --short
git diff --name-only
```

Codex may create checkpoint commits on its own Codex branch.

Codex may push its own Codex branch to GitHub for backup and for Integration Codex to fetch.

Example:

```bash
git push -u origin codex/codex-1/login-feature
```

Codex must not force push unless the user explicitly approves.

Default fast-development flow:

```text
Module Codex branches -> Integration Codex staging-ready branch/commit -> staging -> master
```

Module Codex sessions do not need to open PRs by default.

Module Codex sessions should push their own `codex/*` branch for backup and for Integration Codex to fetch.

Integration Codex owns collecting completed module outputs, wiring `app-shell/`, running checks, and preparing one staging-ready integrated result.

Integration Codex may push the integrated result directly to `staging` only after the user explicitly confirms that exact action.

GitHub Codex is primarily for the later `staging` -> `master` release flow.

Individual module PRs into `staging` are optional and should be used only if the user explicitly wants PR review for module branches.

Production releases should be merged from `staging` into `master` through a Pull Request.

Codex must update `Project_Context.md` when important lasting project information changes.

Codex must not commit secrets, `.env` files, credentials, API keys, database passwords, or tokens.

---

# Module Branch Output Rules

For fast development, module Codex branches must be clean module-only branches for Integration Codex to consume.

Before creating or updating a module branch, the Module Codex must start from the latest `origin/staging`:

```bash
git fetch origin
git checkout -b codex/<agent>/<module>-module-only origin/staging
```

The branch purpose is:

```text
codex/<agent>/<module>-module-only -> source branch for Integration Codex
```

The branch must contain only that module folder:

```text
<module>/
```

Allowed examples:

```text
billing/api/billing/router.py
billing/web/BillingPage.jsx
billing/web/billing.css
billing/README.md
billing/module.json
billing/PROJECT_MODULE_CONTEXT.md
```

Forbidden in module-only branches:

```text
app-shell/
docker-compose.yml
Dockerfile
Project_Context.md
AGENTS.md
scripts/
docs/
customer-profiling broad cleanup/deletions
files from another module
```

Before pushing the branch, run a scope check against `origin/staging`:

```bash
git fetch origin
git diff --name-only origin/staging...HEAD
```

Every changed file must start with the module folder path:

```text
<module>/
```

If the diff contains files outside the module folder, do not push as complete. Create a clean replacement branch from `origin/staging` and copy only the module folder changes.

Do not stack module branches on older broad migration branches or another module branch. A clean module branch must be independently consumable by Integration Codex against `origin/staging`.

When reporting completion, include:

- branch name
- commit SHA
- exact `git diff --name-only origin/staging...HEAD` output
- checks run
- confirmation that only `<module>/` files changed

Only open a module PR if the user explicitly requests PR review. Otherwise, push the clean `codex/*` branch and tell Integration Codex the branch name.

---

# Safety Rules

Do not run destructive commands without explicit user approval.

This includes:

```bash
rm -rf
database reset
database drop
production migration
force push
deleting environment files
overwriting config files
```

Do not edit production secrets.

Do not expose secret values in updates.

Do not manually edit `.ai_coord/` files.

Use the coordination script only.

---

# Final Principle

Each Codex can work full-stack, but must behave like a cooperative teammate.

Every Codex must:

- Register its own identity.
- Check updates before editing.
- Check locks before editing.
- Check out files before editing.
- Reprioritize work if a needed file is locked.
- Work on available files while waiting.
- Wait only when all remaining work depends on locked files.
- Lock `runtime/server` before build/start/restart operations that affect the shared server runtime.
- Post updates during work.
- Notify others when done.
- Check files back in after finishing.
