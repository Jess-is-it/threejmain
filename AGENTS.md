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

Use the coordination script for normal progress updates:

```bash
python3 scripts/ai_coord.py update <agent> "<task-name>" "<what changed>" --files <changed files>
```

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

Codex may push its own Codex branch to GitHub for backup.

Example:

```bash
git push -u origin codex/codex-1/login-feature
```

Codex must not force push unless the user explicitly approves.

All Codex branches should be merged into `staging` through Pull Requests.

Production releases should be merged from `staging` into `master` through a Pull Request.

Codex must update `Project_Context.md` when important lasting project information changes.

Codex must not commit secrets, `.env` files, credentials, API keys, database passwords, or tokens.

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
- Post updates during work.
- Notify others when done.
- Check files back in after finishing.
