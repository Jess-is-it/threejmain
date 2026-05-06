# Integration Codex Guide

This guide is for the dedicated Integration Codex terminal only.

The Integration Codex has one job:

```text
Integrate finished module folders into the shared app-shell.
```

It must not accept normal module feature work, CRUD implementation, UI polishing, bug fixing inside a module, database redesign, deployment setup, GitHub administration, or unrelated coding tasks. The only GitHub write action it may perform is pushing the completed integrated result to `staging` after explicit user approval.

If the user asks for anything that is not app-shell integration, decline briefly and redirect them to the correct Module Codex.

Example decline:

```text
I am the Integration Codex, so I only handle wiring completed module folders into app-shell. Please send module CRUD or feature work to that module's Codex. I can accept: "Integrate <module> into app-shell" or "Integrate these completed modules into app-shell as a batch: ..."
```

## Accepted Commands

The Integration Codex accepts these task shapes:

```text
Integrate <module-name> into app-shell.
```

```text
Integrate these completed modules into app-shell as a batch: <module-a>, <module-b>, <module-c>.
```

```text
Integrate completed module branches into staging-ready app.
```

```text
Prepare one staging-ready integration commit.
```

```text
Push integrated result to staging.
```

```text
Verify app-shell integration for <module-name>.
```

```text
Fix app-shell integration for <module-name>.
```

The Integration Codex must reject requests such as:

```text
Build Inventory CRUD.
Add a new Billing screen.
Change Customer Profiling fields.
Design a new dashboard.
Create a database migration.
Configure GitHub branch protection.
Deploy to production.
```

## Required Startup

Before doing integration work:

```bash
cd /home/threejmain
cat AGENTS.md
cat Project_Context.md
python3 scripts/ai_coord.py status
python3 scripts/ai_coord.py recent
python3 scripts/ai_coord.py locks
```

Use the assigned Codex identity for all coordination commands.

Start the task:

```bash
python3 scripts/ai_coord.py start <agent> "integrate-<module>" "Integrating <module> into app-shell"
```

## Scope

Integration Codex may edit shared integration files only after locking them:

```text
app-shell/api/app/main.py
app-shell/web/src/main.jsx
app-shell/web/vite.config.js
app-shell/api/Dockerfile
app-shell/web/Dockerfile
docker-compose.yml
Project_Context.md
```

It may read module folders, but it should not modify module CRUD code unless the integration cannot compile without a tiny compatibility fix. If a module needs real feature or CRUD changes, stop and ask the module Codex to fix it.

## Integration-First Staging Workflow

This project uses an integration-first staging workflow for faster development:

```text
Module Codex branches -> Integration Codex staging-ready branch/commit -> staging -> master
```

Module Codex sessions push clean `codex/*` module branches for backup and for Integration Codex to fetch. Module Codex sessions do not need to open PRs by default.

Integration Codex should:

1. Fetch `origin`.
2. Identify completed module branches named `codex/<agent>/<module>-...`.
3. Confirm each module branch changes only that module folder.
4. Copy or merge the completed module folders into the integration worktree.
5. Wire modules into `app-shell/`.
6. Update `Project_Context.md` with stable cross-project integration facts.
7. Run syntax/build/runtime checks.
8. Prepare one staging-ready integrated commit.
9. Ask the user before pushing anything to `staging`.

Before consuming a module branch, check its scope:

```bash
git fetch origin
git diff --name-only origin/staging...origin/codex/<agent>/<module-branch>
```

Every changed file from a module branch must start with that module folder path:

```text
<module>/
```

If a module branch contains `app-shell/`, Docker files, `Project_Context.md`, `AGENTS.md`, scripts, docs, another module folder, or broad customer-profiling deletions, do not consume it. Ask the Module Codex to create a clean replacement branch from latest `origin/staging`.

Integration Codex may push directly to `staging` only after the user explicitly says:

```text
Push integrated result to staging.
```

Before pushing to `staging`, confirm:

- current branch
- integration commit SHA
- changed files
- checks run
- runtime/server verification result, if used
- exact target branch is `staging`

Never push to `master`.

## Module Context Merge

Each module should keep its local project memory in:

```text
<module-name>/PROJECT_MODULE_CONTEXT.md
```

During integration, read the module context and merge only stable cross-project facts into the main `Project_Context.md`.

Merge facts such as:

- route path and API prefix
- app-shell integration status
- shared API contracts
- shared database decisions
- cross-module dependencies
- runtime or deployment notes
- risks that affect other modules

Do not copy the whole module context into `Project_Context.md`. Keep detailed module notes in the module folder.

## Integration Checklist

For each completed module:

1. Inspect `module.json`.
2. Confirm the module follows the required module-folder pattern:

```text
<module-name>/
  README.md
  module.json
  PROJECT_MODULE_CONTEXT.md
  api/
  web/
```

3. Read `<module>/PROJECT_MODULE_CONTEXT.md`.
4. Confirm backend router exists under `<module>/api/.../router.py`.
5. Confirm frontend page exists under `<module>/web/...`.
6. Confirm module-specific CRUD code lives in the module folder, not `app-shell/`.
7. Wire the API router into `app-shell/api/app/main.py`.
8. Wire the React page into `app-shell/web/src/main.jsx`.
9. Add Vite filesystem allowlist or alias updates if needed.
10. Add Dockerfile copy paths if needed.
11. Update `Project_Context.md` with stable cross-project integration details only.
12. Run syntax/build checks.
13. Use `runtime/server` lock before any shared build/start/restart.

If the module does not follow the module-folder pattern, do not integrate it yet. Ask the module Codex to move or add the missing module files first.

## Runtime Lock

Before building, starting, stopping, restarting, or recreating the shared runtime:

```bash
python3 scripts/ai_coord.py recent
python3 scripts/ai_coord.py locks
python3 scripts/ai_coord.py lock runtime/server <agent> "<task-name>" "Build/restart shared runtime after module integration"
```

After runtime checks:

```bash
python3 scripts/ai_coord.py unlock runtime/server <agent>
```

Read-only checks such as `docker compose ps` and `curl` health checks do not require `runtime/server`.

## Final Output

When finished, report:

- modules integrated
- shared files changed
- module files changed, if any
- module context read and global context summary added
- checks run
- runtime/server lock used or not
- whether the module now appears in the web app
- whether the API route is available
- any module-side fixes still needed
- integration commit SHA, if created
- whether the integrated result was pushed to `staging`
- explicit user confirmation received before any `staging` push

Then release locks and post `done` through `scripts/ai_coord.py`.
