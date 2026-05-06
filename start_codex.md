# start_codex.md

# Codex Startup Guide

This file is only a startup guide.

Do not use this file as the project source of truth.

Project-specific details are in:

```text
Project_Context.md
```

Coordination rules are in:

```text
AGENTS.md
```

Before doing any work, follow this startup flow.

---

## 1. Go to the main repository

```bash
cd /home/threejmain
```

---

## 2. Confirm required files exist

```bash
ls -la AGENTS.md Project_Context.md scripts/ai_coord.py
```

If any of these files are missing, stop and tell the user.

---

## 3. Read required files

Read these first:

```text
AGENTS.md
Project_Context.md
```

Use:

- `AGENTS.md` for coordination rules
- `Project_Context.md` for project details, current direction, stack, ports, modules, and workflow

Do not assume project details from memory or previous chats.

---

## 4. Fetch latest refs

```bash
git fetch origin
```

---

## 5. Register this Codex session

```bash
export AI_COORD_STATE_DIR=/home/threejmain/.ai_coord
python3 scripts/ai_coord.py register "new Codex session"
```

Use the returned identity for all coordination commands.

Example identity:

```text
codex-1
```

---

## 6. Create a worktree for the task

If the user has not provided a task yet, do not create a worktree yet.

First summarize what you read and ask the user what task to work on.

If the user already provided a task, create a short task name, then create a worktree from `origin/staging`.

Use this format:

```bash
AGENT="<assigned-agent>"
TASK="<short-task-name>"
BRANCH="codex/${AGENT}/${TASK}"
WORKTREE_PATH="/home/worktrees/threejmain-${AGENT}-${TASK}"

git worktree add -b "$BRANCH" "$WORKTREE_PATH" origin/staging
cd "$WORKTREE_PATH"
export AI_COORD_STATE_DIR=/home/threejmain/.ai_coord
```

If `origin/staging` is not available but local `staging` exists, use local `staging`.

Do not work directly on:

```text
master
staging
```

---

## 7. Re-read context inside the worktree

Inside the worktree, read again:

```text
AGENTS.md
Project_Context.md
```

Then check coordination status:

```bash
python3 scripts/ai_coord.py status
```

Follow `AGENTS.md` for all file locks, runtime locks, updates, unlocks, and task completion.

---

## 8. Understand the server/runtime lock

Before building, starting, stopping, restarting, recreating, or otherwise changing the shared server runtime, lock:

```text
runtime/server
```

Required order:

```bash
python3 scripts/ai_coord.py recent
python3 scripts/ai_coord.py locks
python3 scripts/ai_coord.py lock runtime/server <agent> "<task-name>" "<why this server operation is needed>"
```

Use this lock before commands such as:

```bash
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

If another Codex already holds `runtime/server`, wait your turn or continue with unlocked code work first.

Release the lock after the server operation and immediate health checks:

```bash
python3 scripts/ai_coord.py unlock runtime/server <agent>
```

Read-only checks such as `docker compose ps` and `curl` health checks do not need the runtime lock.

---

## 9. Use module preview when the user needs fast visual review

Module Codex sessions can run their own isolated preview app from the current worktree. This helps the user inspect that Codex branch immediately without waiting for Integration Codex to combine every module.

Use:

```bash
./scripts/start_module_preview.sh <agent> <module-name> "<task-name>"
```

Example:

```bash
./scripts/start_module_preview.sh codex-3 billing "billing-form-modals"
```

The helper uses unique ports based on the Codex identity:

```text
codex-3 -> API 8203, web 8303
codex-4 -> API 8204, web 8304
```

The helper locks `runtime/preview/<agent>` automatically. Do not use shared ports `8100`, `8180`, or `5432` for module previews.

This preview shows only that worktree/branch. Integration Codex is still responsible for combining selected module branches into the staging-ready app.

If this is a brand-new module that does not appear in app-shell navigation yet, do not edit `app-shell/` from the Module Codex. Ask Integration Codex to do the one-time app-shell wiring, then continue module-local previews from that integrated base.

---

## 10. Follow the module-folder pattern

If the task creates or changes a business module, implement the module inside its root-level module folder first.

Use `customer-profiling/` as the reference pattern:

```text
<module-name>/
  README.md
  module.json
  PROJECT_MODULE_CONTEXT.md
  api/
  web/
```

For module-local lasting notes, update:

```text
<module-name>/PROJECT_MODULE_CONTEXT.md
```

Do not update the main `Project_Context.md` for ordinary module progress. Update the main project context only for shared architecture, app-shell behavior, shared contracts, runtime ports, deployment workflow, cross-module dependencies, or integration status.

Module Codex sessions should not edit `app-shell/` for route registration, navigation, Docker copy paths, Vite allowlists, or shared deployment wiring unless the user explicitly assigns an integration task.

The Integration Codex wires completed module folders into `app-shell/` and merges stable module context summaries into the main `Project_Context.md`.

---

## 11. Keep Module Branches Clean

For module work, create the task branch from latest `origin/staging` and keep the branch module-only:

```bash
git fetch origin
git checkout -b codex/<agent>/<module>-module-only origin/staging
```

The branch is for backup and for Integration Codex to fetch. It must contain only files under:

```text
<module>/
```

Before pushing or reporting the branch as complete, run:

```bash
git fetch origin
git diff --name-only origin/staging...HEAD
```

Every changed file must start with `<module>/`.

Do not mark the branch complete if the diff includes:

```text
app-shell/
docker-compose.yml
Dockerfile
Project_Context.md
AGENTS.md
scripts/
docs/
another module folder
customer-profiling broad cleanup/deletions
```

If the branch is stacked on an old broad branch or contains shared files, create a clean replacement branch from `origin/staging` and copy only the module folder changes.

Module Codex sessions do not need to open PRs by default. Push the clean `codex/*` branch and report the branch name, commit SHA, checks, and scope result. Integration Codex will collect module branches, wire `app-shell/`, and prepare one staging-ready integrated result.

Only create a module PR if the user explicitly asks for PR review.

---

## 12. Summarize before coding

Before making implementation changes, summarize:

- assigned Codex identity
- branch/worktree created, if any
- current project status from `Project_Context.md`
- current active priority
- parked or excluded features
- likely files involved
- whether the task may need `runtime/server`
- risks or existing features that must not break

Then wait for the user's task if no task was already given.

---

## 12. Use checkpoint script for safe commits

When the task has changes ready to checkpoint, use:

```bash
scripts/codex_checkpoint.sh "<commit message>"
```

Only use this on a `codex/*` branch.

Do not commit secrets, `.env`, or `.ai_coord/`.

---

## 13. Final response expectation

When the task is done, report:

- agent identity
- branch name
- files changed
- summary of work
- tests/checks run
- Project_Context.md updated or not
- coordination status
- runtime/server lock used or not
- checkpoint commit, if created
- pushed branch status
- clean module branch scope result from `git diff --name-only origin/staging...HEAD`, if module work
- known limitations
- next recommended step
