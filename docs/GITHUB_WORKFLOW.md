# GitHub Workflow

This repository uses an integration-first branch model with temporary Codex task branches.

## Branch Model

`master` = production only

`staging` = integration/testing branch

`codex/<agent>/<task-name>` = temporary Codex task branches

## Rules

- Codex must not push directly to `master`.
- Codex must not push directly to `staging` unless the user explicitly approves.
- Codex works on one branch per task.
- Codex task branches are temporary.
- Module Codex branches are pushed for backup and for Integration Codex to fetch.
- Module Codex branches do not need individual PRs by default.
- Integration Codex collects completed module branches, wires `app-shell`, runs checks, and prepares one staging-ready integrated result.
- Integration Codex may push the integrated result directly to `staging` only after explicit user approval.
- GitHub Codex is primarily for the later `staging` -> `master` release PR.
- Individual module PRs into `staging` are optional and should be used only when the user explicitly requests PR review.
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

## Worktree Example

```bash
cd /home/threejmain
git fetch origin
git worktree add -b codex/codex-3/login-feature /home/worktrees/threejmain-codex-3-login-feature origin/staging
```

Or use the helper:

```bash
./scripts/create_codex_worktree.sh codex-3 login-feature
```

## Checkpoint Backup Example

```bash
git status --short
git add .
git commit -m "wip(codex-3): checkpoint login feature"
git push -u origin codex/codex-3/login-feature
```

Or use the helper from a `codex/*` branch:

```bash
./scripts/codex_checkpoint.sh "wip(codex-3): checkpoint login feature"
```

## Fast Integration Flow

Default fast flow:

```text
Module Codex branches -> Integration Codex staging-ready result -> staging -> master
```

Module Codex:

```bash
git fetch origin
git checkout -b codex/codex-3/billing-module-only origin/staging
# edit only billing/
git diff --name-only origin/staging...HEAD
git push -u origin codex/codex-3/billing-module-only
```

Integration Codex:

```text
Integrate completed module branches into staging-ready app.
Prepare one staging-ready integration commit.
```

After Integration Codex reports checks passed, the user may explicitly approve:

```text
Push integrated result to staging.
```

GitHub Codex handles production release later:

```text
staging -> master
```

## Optional Pull Request Flow

Use individual module PRs only when the user explicitly asks for PR review.

Optional module PR:

```text
codex/<agent>/<task-name> -> staging
```

If GitHub CLI is installed and authenticated:

```bash
gh pr create --base staging --head codex/codex-3/login-feature --title "Login feature" --body "Adds login feature."
```

Production release PR:

```bash
gh pr create --base master --head staging --title "Promote staging to master" --body "Promotes staging to master."
```
