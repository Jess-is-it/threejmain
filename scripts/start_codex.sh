#!/usr/bin/env bash

set -euo pipefail

MAIN_REPO="${MAIN_REPO:-/home/threejmain}"
WORKTREES_DIR="${WORKTREES_DIR:-/home/worktrees}"
SHARED_COORD_DIR="${AI_COORD_STATE_DIR:-/home/threejmain/.ai_coord}"

SESSION_NOTE="${*:-new Codex session}"

cd "$MAIN_REPO"

if [ ! -f "scripts/ai_coord.py" ]; then
  echo "ERROR: scripts/ai_coord.py not found in $MAIN_REPO"
  exit 1
fi

export AI_COORD_STATE_DIR="$SHARED_COORD_DIR"

mkdir -p "$WORKTREES_DIR"
mkdir -p "$SHARED_COORD_DIR"

echo "Fetching latest GitHub refs..."
git fetch origin

if git show-ref --verify --quiet refs/remotes/origin/staging; then
  BASE_REF="origin/staging"
elif git show-ref --verify --quiet refs/heads/staging; then
  BASE_REF="staging"
else
  echo "ERROR: staging branch not found."
  echo
  echo "Create staging first:"
  echo "  git checkout master"
  echo "  git pull origin master"
  echo "  git checkout -b staging"
  echo "  git push -u origin staging"
  exit 1
fi

echo
echo "Registering new Codex session..."
REGISTER_OUTPUT="$(python3 scripts/ai_coord.py register "$SESSION_NOTE")"

echo "$REGISTER_OUTPUT"

AGENT="$(echo "$REGISTER_OUTPUT" | awk '/Agent:/ {print $2}' | tail -n 1)"

if [ -z "$AGENT" ]; then
  echo "ERROR: Could not detect assigned Codex identity."
  exit 1
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BRANCH="codex/${AGENT}/session-${TIMESTAMP}"
WORKTREE_PATH="${WORKTREES_DIR}/threejmain-${AGENT}-session-${TIMESTAMP}"

echo
echo "Assigned identity: $AGENT"
echo "Branch: $BRANCH"
echo "Worktree: $WORKTREE_PATH"
echo

if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "ERROR: Local branch already exists:"
  echo "$BRANCH"
  exit 1
fi

if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  echo "ERROR: Remote branch already exists:"
  echo "$BRANCH"
  exit 1
fi

if [ -e "$WORKTREE_PATH" ]; then
  echo "ERROR: Worktree path already exists:"
  echo "$WORKTREE_PATH"
  exit 1
fi

echo "Creating Codex worktree from $BASE_REF..."
git worktree add -b "$BRANCH" "$WORKTREE_PATH" "$BASE_REF"

cd "$WORKTREE_PATH"
export AI_COORD_STATE_DIR="$SHARED_COORD_DIR"

if [ ! -f "scripts/ai_coord.py" ]; then
  echo
  echo "WARNING: scripts/ai_coord.py was not found inside the worktree."
  echo "This usually means your workflow files are not committed to staging yet."
  echo
  echo "Commit these files to staging first:"
  echo "- AGENTS.md"
  echo "- Project_Context.md"
  echo "- scripts/ai_coord.py"
  echo "- scripts/start_codex.sh"
  echo "- .gitignore"
  echo
  exit 1
fi

echo
echo "Checking coordination status..."
python3 scripts/ai_coord.py status || true

cat > .codex_session_prompt.txt <<EOF
You are $AGENT.

Current branch:

$BRANCH

Before doing any work, read:

1. AGENTS.md
2. Project_Context.md

Follow AGENTS.md strictly.

Use $AGENT as your identity for all coordination commands.

Ask the user what task they want you to work on before making implementation changes.

After the user gives the task, create a short task name and use it consistently in coordination commands.

Before editing or checking out any file, always run:

python3 scripts/ai_coord.py recent
python3 scripts/ai_coord.py locks

Then check out the file before editing:

python3 scripts/ai_coord.py lock <file-path> $AGENT "<task-name>" "<why you need this file>"

If the file is locked by another Codex, do not edit it. Reassess the task and work on other unlocked files first.

Post updates during work:

python3 scripts/ai_coord.py update $AGENT "<task-name>" "<what changed>" --files <changed files>

When an important lasting project change is made, update Project_Context.md.

Before editing Project_Context.md, check it out first:

python3 scripts/ai_coord.py recent
python3 scripts/ai_coord.py locks
python3 scripts/ai_coord.py lock Project_Context.md $AGENT "<task-name>" "Update project context"

After updating Project_Context.md, notify others:

python3 scripts/ai_coord.py update $AGENT "<task-name>" "Updated Project_Context.md with important project context" --files Project_Context.md

Then check it back in:

python3 scripts/ai_coord.py unlock Project_Context.md $AGENT

When the task is finished:

1. Follow AGENTS.md finalization rules.
2. Commit only to this branch: $BRANCH
3. Push only this branch.
4. Create a PR to staging.
5. Do not merge the PR unless the user explicitly says so.
6. Do not push to master.
7. Do not push directly to staging.

Final target flow:

$BRANCH → staging → master
EOF

echo
echo "============================================================"
echo "COPY THIS INTO CODEX WHEN IT STARTS"
echo "============================================================"
echo
cat .codex_session_prompt.txt
echo
echo "============================================================"
echo

echo "Starting Codex in:"
pwd
echo

exec codex
