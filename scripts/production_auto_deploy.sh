#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  printf '[%s] %s\n' "$(date -Is)" "$*"
}

SOURCE_REPO="${THREEJMAIN_SOURCE_REPO:-/home/threejmain}"
STATE_DIR="${THREEJMAIN_PROD_STATE_DIR:-/var/lib/threejmain-production}"
REMOTE="${THREEJMAIN_PROD_REMOTE:-origin}"
BRANCH="${THREEJMAIN_PROD_BRANCH:-master}"
POLL_SECONDS="${THREEJMAIN_PROD_POLL_SECONDS:-60}"
DEPLOY_SCRIPT="${THREEJMAIN_PROD_DEPLOY_SCRIPT:-$SOURCE_REPO/scripts/production_deploy.sh}"
MODE="${1:-watch}"

mkdir -p "$STATE_DIR"

check_once() {
  git -C "$SOURCE_REPO" fetch --quiet --prune "$REMOTE" "+refs/heads/$BRANCH:refs/remotes/$REMOTE/$BRANCH"

  local target_commit
  local deployed_commit
  local previous_commit
  target_commit="$(git -C "$SOURCE_REPO" rev-parse "$REMOTE/$BRANCH^{commit}")"
  deployed_commit="$(cat "$STATE_DIR/deployed-master" 2>/dev/null || true)"

  if [[ "$target_commit" == "$deployed_commit" ]]; then
    log "No production change for $REMOTE/$BRANCH at ${target_commit:0:7}"
    return 0
  fi

  previous_commit="${deployed_commit:-none}"
  log "Detected $REMOTE/$BRANCH change: ${previous_commit:0:7} -> ${target_commit:0:7}"
  "$DEPLOY_SCRIPT"
}

case "$MODE" in
  --once|once)
    check_once
    ;;
  watch|"")
    log "Watching $REMOTE/$BRANCH every ${POLL_SECONDS}s for production deploys"
    while true; do
      check_once || log "Deploy check failed; will retry"
      sleep "$POLL_SECONDS"
    done
    ;;
  *)
    printf 'Usage: %s [watch|--once]\n' "$0" >&2
    exit 2
    ;;
esac
