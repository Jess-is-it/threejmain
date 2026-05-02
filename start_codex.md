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

Follow `AGENTS.md` for all file locks, updates, unlocks, and task completion.

---

## 8. Summarize before coding

Before making implementation changes, summarize:

- assigned Codex identity
- branch/worktree created, if any
- current project status from `Project_Context.md`
- current active priority
- parked or excluded features
- likely files involved
- risks or existing features that must not break

Then wait for the user’s task if no task was already given.

---

## 9. Use checkpoint script for safe commits

When the task has changes ready to checkpoint, use:

```bash
scripts/codex_checkpoint.sh "<commit message>"
```

Only use this on a `codex/*` branch.

Do not commit secrets, `.env`, or `.ai_coord/`.

---

## 10. Final response expectation

When the task is done, report:

- agent identity
- branch name
- files changed
- summary of work
- tests/checks run
- Project_Context.md updated or not
- coordination status
- checkpoint commit, if created
- PR/branch status
- known limitations
- next recommended step