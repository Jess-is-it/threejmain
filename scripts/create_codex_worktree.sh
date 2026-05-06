#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: $0 <agent> <task-name>"
}

if [ "$#" -ne 2 ]; then
  usage
  exit 1
fi

AGENT_RAW="$1"
TASK_RAW="$2"

sanitize_name() {
  printf "%s" "$1" |
    tr "[:upper:]" "[:lower:]" |
    sed -E 's/[^a-z0-9._-]+/-/g; s/^-+//; s/-+$//; s/-+/-/g'
}

AGENT="$(sanitize_name "$AGENT_RAW")"
TASK_NAME="$(sanitize_name "$TASK_RAW")"

if [ -z "$AGENT" ] || [ -z "$TASK_NAME" ]; then
  echo "ERROR: agent and task-name must contain at least one safe branch character."
  exit 1
fi

CURRENT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$CURRENT_ROOT" ]; then
  echo "ERROR: this script must be run from inside a Git repository."
  exit 1
fi

COMMON_GIT_DIR="$(git -C "$CURRENT_ROOT" rev-parse --git-common-dir 2>/dev/null || true)"
if [ -z "$COMMON_GIT_DIR" ]; then
  echo "ERROR: unable to determine the Git common directory."
  exit 1
fi

if [[ "$COMMON_GIT_DIR" != /* ]]; then
  COMMON_GIT_DIR="$(cd "$CURRENT_ROOT" && cd "$COMMON_GIT_DIR" && pwd)"
fi

if [ "$(basename "$COMMON_GIT_DIR")" = ".git" ]; then
  MAIN_REPO_ROOT="$(dirname "$COMMON_GIT_DIR")"
else
  MAIN_REPO_ROOT="$CURRENT_ROOT"
fi

REPO_NAME="$(basename "$MAIN_REPO_ROOT")"
BRANCH="codex/$AGENT/$TASK_NAME"
WORKTREE_BASE="/home/worktrees"
WORKTREE_PATH="$WORKTREE_BASE/$REPO_NAME-$AGENT-$TASK_NAME"
STATE_DIR="/home/threejmain/.ai_coord"
TMUX_SESSION="$AGENT-$TASK_NAME"

echo "Main repo: $MAIN_REPO_ROOT"
echo "Branch:    $BRANCH"
echo "Worktree:  $WORKTREE_PATH"
echo

git -C "$MAIN_REPO_ROOT" fetch origin

if ! git -C "$MAIN_REPO_ROOT" show-ref --verify --quiet refs/remotes/origin/staging; then
  echo "ERROR: origin/staging does not exist. Create and push staging before creating Codex worktrees."
  exit 1
fi

if git -C "$MAIN_REPO_ROOT" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "ERROR: local branch already exists: $BRANCH"
  exit 1
fi

if [ -e "$WORKTREE_PATH" ]; then
  echo "ERROR: worktree path already exists: $WORKTREE_PATH"
  exit 1
fi

mkdir -p "$WORKTREE_BASE"

git -C "$MAIN_REPO_ROOT" worktree add -b "$BRANCH" "$WORKTREE_PATH" origin/staging

echo
echo "Worktree created."
echo
echo "Next commands:"
cat <<EOF
cd $WORKTREE_PATH
export AI_COORD_STATE_DIR=$STATE_DIR
tmux new -s $TMUX_SESSION -c $WORKTREE_PATH

# Inside tmux, read and follow the startup guide:
cat /home/threejmain/start_codex.md
EOF
