#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  printf '[%s] %s\n' "$(date -Is)" "$*"
}

SOURCE_REPO="${THREEJMAIN_SOURCE_REPO:-/home/threejmain}"
STATE_DIR="${THREEJMAIN_PROD_STATE_DIR:-/var/lib/threejmain-production}"
REMOTE="${THREEJMAIN_PROD_REMOTE:-origin}"
BRANCH="${THREEJMAIN_PROD_BRANCH:-master}"
COMPOSE_PROJECT="${THREEJMAIN_PROD_COMPOSE_PROJECT:-threejmain-production}"
DEPLOY_SCRIPT="${THREEJMAIN_PROD_DEPLOY_SCRIPT:-$SOURCE_REPO/scripts/production_deploy.sh}"
CONTROL_DIR="${THREEJMAIN_PROD_CONTROL_DIR:-}"
POLL_SECONDS="${THREEJMAIN_PROD_DEPLOY_CONTROL_POLL_SECONDS:-5}"
COMMIT_REFRESH_SECONDS="${THREEJMAIN_PROD_COMMIT_REFRESH_SECONDS:-60}"
MAX_COMMITS="${THREEJMAIN_PROD_COMMIT_LIMIT:-10}"

resolve_control_dir() {
  if [[ -n "$CONTROL_DIR" ]]; then
    printf '%s\n' "$CONTROL_DIR"
    return
  fi

  local volume_mount=""
  if command -v docker >/dev/null 2>&1; then
    volume_mount="$(docker volume inspect -f '{{ .Mountpoint }}' "${COMPOSE_PROJECT}_threejmain_api_data" 2>/dev/null || true)"
  fi

  if [[ -n "$volume_mount" ]]; then
    printf '%s/deploy-control\n' "$volume_mount"
  else
    printf '%s/deploy-control\n' "$STATE_DIR"
  fi
}

json_write_status() {
  local state="$1"
  local message="$2"
  local request_id="${3:-}"
  local target_commit="${4:-}"
  local log_path="${5:-}"
  local finished_at="${6:-}"
  local deployed_commit="${7:-}"
  local status_file="$8"
  local tmp
  tmp="$(mktemp "${status_file}.tmp.XXXXXX")"
  python3 - "$state" "$message" "$request_id" "$target_commit" "$log_path" "$finished_at" "$deployed_commit" > "$tmp" <<'PY'
import json
import sys
from datetime import datetime, timezone

state, message, request_id, target_commit, log_path, finished_at, deployed_commit = sys.argv[1:8]
payload = {
    "state": state,
    "message": message,
    "requestId": request_id,
    "targetCommit": target_commit,
    "targetShort": target_commit[:7] if target_commit else "",
    "logPath": log_path,
    "updatedAt": datetime.now(timezone.utc).isoformat(),
}
if finished_at:
    payload["finishedAt"] = finished_at
if deployed_commit:
    payload["deployedCommit"] = deployed_commit
    payload["deployedShort"] = deployed_commit[:7]
print(json.dumps(payload, indent=2))
PY
  mv "$tmp" "$status_file"
}

json_request_field() {
  local request_file="$1"
  local field="$2"
  python3 - "$request_file" "$field" <<'PY'
import json
import sys
from pathlib import Path

data = json.loads(Path(sys.argv[1]).read_text())
value = data.get(sys.argv[2], "")
print(value if value is not None else "")
PY
}

write_commits() {
  local control_dir="$1"
  local commits_file="$control_dir/commits.json"
  local tmp
  tmp="$(mktemp "${commits_file}.tmp.XXXXXX")"

  git -C "$SOURCE_REPO" fetch --quiet --prune "$REMOTE" "+refs/heads/$BRANCH:refs/remotes/$REMOTE/$BRANCH"
  local raw
  raw="$(mktemp "${commits_file}.raw.XXXXXX")"
  git -C "$SOURCE_REPO" log -n "$MAX_COMMITS" --date=iso-strict --pretty=format:'%H%x1f%h%x1f%cI%x1f%an%x1f%s' "$REMOTE/$BRANCH" > "$raw"
  python3 - "$REMOTE" "$BRANCH" "$raw" > "$tmp" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

remote, branch, raw_path = sys.argv[1:4]
commits = []
for line in Path(raw_path).read_text().splitlines():
    parts = line.rstrip("\n").split("\x1f", 4)
    if len(parts) != 5:
        continue
    commit, short, committed_at, author, subject = parts
    commits.append({
        "commit": commit,
        "short": short,
        "committedAt": committed_at,
        "author": author,
        "subject": subject,
    })

print(json.dumps({
    "remote": remote,
    "branch": branch,
    "updatedAt": datetime.now(timezone.utc).isoformat(),
    "commits": commits,
}, indent=2))
PY
  rm -f "$raw"
  mv "$tmp" "$commits_file"
}

handle_request() {
  local control_dir="$1"
  local request_file="$control_dir/request.json"
  local status_file="$control_dir/status.json"
  local history_dir="$control_dir/history"
  local logs_dir="$control_dir/logs"
  local request_id
  local target_commit
  local requested_by
  local log_file
  local archive_file
  local finished_at

  [[ -f "$request_file" ]] || return 0

  request_id="$(json_request_field "$request_file" "id" 2>/dev/null || true)"
  target_commit="$(json_request_field "$request_file" "targetCommit" 2>/dev/null || true)"
  requested_by="$(json_request_field "$request_file" "requestedBy" 2>/dev/null || true)"
  request_id="${request_id:-request-$(date +%s)}"
  log_file="$logs_dir/${request_id}.log"
  archive_file="$history_dir/${request_id}.json"

  if [[ ! "$target_commit" =~ ^[0-9a-fA-F]{7,40}$ ]]; then
    json_write_status "failed" "Invalid target commit in deploy request." "$request_id" "$target_commit" "$log_file" "$(date -Is)" "" "$status_file"
    mv "$request_file" "$archive_file"
    return 0
  fi

  write_commits "$control_dir" || true
  json_write_status "running" "Deploying selected production commit requested by ${requested_by:-unknown}." "$request_id" "$target_commit" "$log_file" "" "" "$status_file"
  log "Deploy request $request_id targeting $target_commit"

  if THREEJMAIN_PROD_COMMIT="$target_commit" "$DEPLOY_SCRIPT" > "$log_file" 2>&1; then
    local deployed_commit
    deployed_commit="$(cat "$STATE_DIR/deployed-master" 2>/dev/null || true)"
    finished_at="$(date -Is)"
    json_write_status "succeeded" "Production deploy completed." "$request_id" "$target_commit" "$log_file" "$finished_at" "$deployed_commit" "$status_file"
    log "Deploy request $request_id completed"
  else
    finished_at="$(date -Is)"
    json_write_status "failed" "Production deploy failed. Check the deploy log." "$request_id" "$target_commit" "$log_file" "$finished_at" "" "$status_file"
    log "Deploy request $request_id failed"
  fi

  mv "$request_file" "$archive_file"
  write_commits "$control_dir" || true
}

main() {
  [[ -e "$SOURCE_REPO/.git" ]] || { log "Source repo missing at $SOURCE_REPO"; exit 1; }
  [[ -x "$DEPLOY_SCRIPT" ]] || { log "Deploy script is not executable at $DEPLOY_SCRIPT"; exit 1; }

  local control_dir
  local status_file
  local last_commit_refresh=0
  control_dir="$(resolve_control_dir)"
  status_file="$control_dir/status.json"
  mkdir -p "$control_dir/history" "$control_dir/logs"

  log "Manual production deploy control worker using $control_dir"
  json_write_status "idle" "Manual deploy control worker is running." "" "" "" "" "$(cat "$STATE_DIR/deployed-master" 2>/dev/null || true)" "$status_file"

  while true; do
    local now
    now="$(date +%s)"
    if (( now - last_commit_refresh >= COMMIT_REFRESH_SECONDS )); then
      if write_commits "$control_dir"; then
        last_commit_refresh="$now"
      else
        log "Commit refresh failed"
      fi
    fi
    handle_request "$control_dir"
    sleep "$POLL_SECONDS"
  done
}

main "$@"
