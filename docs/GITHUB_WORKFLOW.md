# GitHub Workflow

This repository now uses a shared staging workflow for faster multi-Codex development.

## Branch Model

`master` = production only

`staging` = shared integration/testing branch

Normal Codex development happens in:

```text
/home/threejmain
```

The shared test server is:

```text
http://192.168.50.70:8180/
```

## Rules

- Codex must not push directly to `master`.
- Codex may commit and push directly to `staging` after coordination locks, status/diff checks, staging only owned locked files, and appropriate verification.
- Normal module work does not use per-Codex worktrees, per-Codex preview servers, or per-module PRs.
- All Codex sessions coordinate with `scripts/ai_coord.py` file/folder locks.
- Use `runtime/server` before rebuilding or restarting the shared server.
- Module folders remain the ownership boundary.
- Cross-module features must lock every affected module folder and shared file.
- Module Codex sessions may commit completed module work directly on `staging`.
- Integration Codex owns shared app-shell integration and shared runtime verification.
- GitHub Codex owns status checks and `staging` -> `master` production PR flow.
- Do not force push unless the user explicitly approves.
- Do not commit secrets, `.env` files, credentials, API keys, database passwords, or tokens.

## Create `staging`

If `staging` does not exist yet:

```bash
git checkout master
git pull origin master
git checkout -b staging
git push -u origin staging
```

If `staging` already exists:

```bash
git fetch origin
git checkout staging
git pull origin staging
```

## Normal Shared Development Flow

Module Codex:

```text
Read AGENTS.md and Project_Context.md.
Check recent updates and locks.
Lock the module folder or files needed.
Edit only locked paths.
Post updates.
Ask for shared server restart only when needed.
Unlock when done.
Commit owned locked files on staging when the task is complete.
Push staging with a normal non-force push.
```

Integration Codex:

```text
Wire shared app-shell changes.
Run checks.
Restart/rebuild the shared server with runtime/server lock.
Verify http://192.168.50.70:8180/.
Prepare a staging commit if requested.
Push staging with a normal non-force push.
```

GitHub Codex:

```text
Check staging status.
Create staging -> master PR when requested.
Merge staging -> master PR when requested and safe.
```

## Shared Server Commands

Before changing runtime:

```bash
python3 scripts/ai_coord.py recent
python3 scripts/ai_coord.py locks
python3 scripts/ai_coord.py lock runtime/server <agent> "<task-name>" "<why restart/build is needed>"
```

After restart/build and checks:

```bash
python3 scripts/ai_coord.py unlock runtime/server <agent>
```

## Production Release PR

Production release PR:

```bash
gh pr create --base master --head staging --title "Promote staging to master" --body "Promotes staging to master."
```

Production release flow:

```text
staging -> master
```
