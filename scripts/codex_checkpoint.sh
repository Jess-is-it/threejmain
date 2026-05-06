#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 \"commit message\""
  exit 1
fi

COMMIT_MESSAGE="$1"
CURRENT_BRANCH="$(git branch --show-current)"

if [ -z "$CURRENT_BRANCH" ]; then
  echo "ERROR: detached HEAD. Checkpoints must run on a Codex task branch."
  exit 1
fi

case "$CURRENT_BRANCH" in
  master)
    echo "ERROR: refusing to checkpoint on master."
    exit 1
    ;;
  staging)
    echo "ERROR: refusing to checkpoint on staging."
    exit 1
    ;;
  codex/*)
    ;;
  *)
    echo "WARNING: refusing to checkpoint because this is not a codex/* branch: $CURRENT_BRANCH"
    exit 1
    ;;
esac

STATUS="$(git status --short)"

echo "Current branch: $CURRENT_BRANCH"
echo
echo "Git status:"
if [ -n "$STATUS" ]; then
  printf "%s\n" "$STATUS"
else
  echo "Working tree clean."
  echo "No changes to checkpoint."
  exit 0
fi

git add .

FORBIDDEN_STAGED="$(git diff --cached --name-only | grep -E '(^|/)\.env($|\.|/)|(^|/)\.ai_coord(/|$)' || true)"
if [ -n "$FORBIDDEN_STAGED" ]; then
  echo
  echo "ERROR: refusing to commit forbidden local state or environment files:"
  printf "%s\n" "$FORBIDDEN_STAGED"
  exit 1
fi

git commit -m "$COMMIT_MESSAGE"
git push -u origin "$CURRENT_BRANCH"

echo
echo "Checkpoint pushed to origin/$CURRENT_BRANCH."
echo "Reminder: create a Pull Request from $CURRENT_BRANCH into staging when the task is ready."
