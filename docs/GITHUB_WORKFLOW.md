# GitHub Workflow

This repository uses a protected branch model with temporary Codex task branches.

## Branch Model

`master` = production only

`staging` = integration/testing branch

`codex/<agent>/<task-name>` = temporary Codex task branches

## Rules

- Codex must not push directly to `master`.
- Codex must not push directly to `staging` unless the user explicitly approves.
- Codex works on one branch per task.
- Codex task branches are temporary.
- After a PR is merged into `staging`, delete the Codex task branch.
- Enable the GitHub setting to automatically delete head branches after PR merge.
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

## Pull Request Flow

Codex task branch -> `staging`

`staging` -> `master`

If GitHub CLI is installed and authenticated:

```bash
gh pr create --base staging --head codex/codex-3/login-feature --title "Login feature" --body "Adds login feature."
```
