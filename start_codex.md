# Codex Startup Guide

This file is only a startup guide. Use `AGENTS.md` for coordination rules and `Project_Context.md` for project details.

## 1. Use The Shared Main Repo

Normal Codex work now happens in one shared working tree:

```bash
cd /home/threejmain
export AI_COORD_STATE_DIR=/home/threejmain/.ai_coord
```

Do not create per-Codex worktrees, task branches, or preview servers unless the user explicitly asks for an isolated experiment.

## 2. Read Required Files

Read these before doing work:

```text
AGENTS.md
Project_Context.md
```

Use:

- `AGENTS.md` for lock, update, runtime, Git, and safety rules
- `Project_Context.md` for project structure, modules, ports, and current architecture

Do not assume project details from memory or previous chats.

## 3. Register Or Confirm Identity

If this Codex terminal has no identity yet:

```bash
python3 scripts/ai_coord.py register "new Codex session"
```

Use the assigned identity for all coordination commands.

If already registered, confirm agents and status:

```bash
python3 scripts/ai_coord.py agents
python3 scripts/ai_coord.py status
```

## 4. Check Current Coordination State

Before starting a task:

```bash
python3 scripts/ai_coord.py recent
python3 scripts/ai_coord.py locks
git status --short
git branch --show-current
```

The normal branch is `staging`. If this checkout is on another branch, switch to an up-to-date `staging` branch before committing or pushing unless the user explicitly requested an isolated experiment.

## 5. Start The Task

Announce the task:

```bash
python3 scripts/ai_coord.py start <agent> "<task-name>" "<what you are about to do>"
```

## 6. Lock Before Editing

Before editing any file or folder:

```bash
python3 scripts/ai_coord.py recent
python3 scripts/ai_coord.py locks
python3 scripts/ai_coord.py lock <file-or-folder> <agent> "<task-name>" "<why this is needed>"
```

Examples:

```bash
python3 scripts/ai_coord.py lock billing codex-3 "billing-service-order" "Update Billing to use Service Orders"
python3 scripts/ai_coord.py lock app-shell codex-9 "wire-service" "Update shared navigation and router imports"
```

Never edit a path locked by another Codex.

## 7. Use The Shared Test Server

All visual review uses the shared test server:

```text
http://192.168.50.70:8180/
```

All API review uses:

```text
http://192.168.50.70:8100/
```

Do not start per-Codex preview servers or use old per-Codex ports such as `8303`, `8311`, or `8314`.

Before building, starting, stopping, restarting, or recreating the shared runtime:

```bash
python3 scripts/ai_coord.py recent
python3 scripts/ai_coord.py locks
python3 scripts/ai_coord.py lock runtime/server <agent> "<task-name>" "<why this server operation is needed>"
```

Release the runtime lock right after the restart/build and basic checks:

```bash
python3 scripts/ai_coord.py unlock runtime/server <agent>
```

Read-only checks such as `docker compose ps` and `curl` do not require the runtime lock.

## 8. Follow The Module Folder Pattern

Module-specific work belongs inside the module folder first:

```text
<module-name>/
  README.md
  module.json
  PROJECT_MODULE_CONTEXT.md
  api/
  web/
```

Use `customer-profiling/` as the reference pattern.

For module-local lasting notes, update:

```text
<module-name>/PROJECT_MODULE_CONTEXT.md
```

Only update the main `Project_Context.md` for shared architecture, app-shell behavior, shared contracts, runtime ports, deployment workflow, cross-module dependencies, or integration status.

## 9. Cross-Module Work

If a task affects multiple modules, lock every affected module folder before editing.

If it affects shared routing, navigation, Docker, Vite, or shared API contracts, also lock the relevant `app-shell/`, Docker, docs, or context files.

## 10. Git And Commits

Module Codex sessions may commit completed work directly on `staging`.

Before committing:

```bash
git status --short
git diff --name-only
```

Stage only files/folders this Codex locked and changed. Verify exactly what is staged before committing.

Never push to `master`. Push to `staging` with a normal non-force push after coordination, verification, and committing only owned locked changes.

## 11. Final Response Expectation

When the task is done, report:

- agent identity
- files changed
- summary of work
- tests/checks run
- shared server restarted or not
- `runtime/server` lock used or not
- Project_Context.md updated or not
- coordination status
- known limitations
- next recommended step
