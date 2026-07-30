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
ENV_FILE="${THREEJMAIN_PROD_ENV_FILE:-$SOURCE_REPO/.env}"
PROD_DIR="${THREEJMAIN_PROD_DIR:-/home/threejmain-production}"
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
  local percent="${9:-}"
  local current_step="${10:-}"
  local tmp
  tmp="$(mktemp "${status_file}.tmp.XXXXXX")"
  python3 - "$state" "$message" "$request_id" "$target_commit" "$log_path" "$finished_at" "$deployed_commit" "$percent" "$current_step" > "$tmp" <<'PY'
import json
import sys
from datetime import datetime, timezone

state, message, request_id, target_commit, log_path, finished_at, deployed_commit, percent, current_step = sys.argv[1:10]
payload = {
    "state": state,
    "message": message,
    "requestId": request_id,
    "targetCommit": target_commit,
    "targetShort": target_commit[:7] if target_commit else "",
    "logPath": log_path,
    "updatedAt": datetime.now(timezone.utc).isoformat(),
}
default_percent = {
    "idle": 0,
    "running": 45,
    "succeeded": 100,
    "failed": 100,
}.get(state, 0)
payload["percent"] = int(percent) if percent.isdigit() else default_percent
payload["currentStep"] = current_step or {
    "idle": "ready",
    "running": "deploying",
    "succeeded": "complete",
    "failed": "failed",
}.get(state, "ready")
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
  git -C "$SOURCE_REPO" log -n "$MAX_COMMITS" --date=iso-strict --pretty=format:'%H%x1f%h%x1f%cI%x1f%an%x1f%s%x1f%b%x1e' "$REMOTE/$BRANCH" > "$raw"
  python3 - "$REMOTE" "$BRANCH" "$raw" "$SOURCE_REPO" > "$tmp" <<'PY'
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

remote, branch, raw_path, source_repo = sys.argv[1:5]

MODULE_LABELS = {
    "account-access-management": "Account Access Management",
    "billing": "Billing",
    "customer-profiling": "Customer Profiling",
    "customer-service-management": "Customer Service Management",
    "inventory": "Inventory",
    "logs": "Logs",
    "network-settings": "Network Settings",
    "point-of-sale": "Point of Sale",
    "process-flow": "Process Flow",
    "service": "Service",
    "system-settings": "System Settings",
    "techportal": "Tech Portal",
    "ticketing": "Ticketing",
}


def changed_paths(commit):
    parent = subprocess.run(
        ["git", "-C", source_repo, "rev-parse", f"{commit}^"],
        capture_output=True,
        text=True,
        check=False,
    )
    if parent.returncode == 0:
        command = ["git", "-C", source_repo, "diff", "--name-only", parent.stdout.strip(), commit]
    else:
        command = ["git", "-C", source_repo, "show", "--format=", "--name-only", commit]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def sentence(text):
    cleaned = re.sub(r"^[*-]\s*", "", text.strip()).rstrip(".")
    if not cleaned:
        return ""
    return f"{cleaned}."


def readable_summary(subject, body, paths):
    summaries = []
    first = sentence(subject)
    if first:
        summaries.append(f"This update includes: {first}")

    for line in body.splitlines():
        cleaned = sentence(line)
        if not cleaned or cleaned.lower() == first.lower():
            continue
        if cleaned.lower().startswith(("co-authored-by:", "signed-off-by:")):
            continue
        if len(cleaned) <= 320:
            summaries.append(cleaned)
        if len(summaries) >= 3:
            break

    module_areas = {}
    shared_web = False
    shared_api = False
    deployment = False
    database = False
    for file_path in paths:
        normalized = file_path.replace("\\", "/")
        parts = normalized.split("/")
        if len(parts) >= 2 and parts[0] == "features" and parts[1] in MODULE_LABELS:
            area = module_areas.setdefault(parts[1], {"web": False, "api": False})
            area["web"] = area["web"] or "web" in parts[2:]
            area["api"] = area["api"] or "api" in parts[2:]
        shared_web = shared_web or normalized.startswith("app-shell/web/")
        shared_api = shared_api or normalized.startswith("app-shell/api/")
        deployment = deployment or normalized.startswith(("scripts/", "deploy/")) or "docker" in normalized.lower()
        database = database or "migration" in normalized.lower()

    for module_id, areas in list(module_areas.items())[:4]:
        label = MODULE_LABELS[module_id]
        if areas["web"] and areas["api"]:
            summaries.append(f"Improves the {label} screens, workflows, and supporting system behavior.")
        elif areas["web"]:
            summaries.append(f"Improves the {label} screens and user experience.")
        elif areas["api"]:
            summaries.append(f"Improves {label} workflows and data handling.")
        else:
            summaries.append(f"Updates {label} functionality.")
    if shared_web:
        summaries.append("Updates shared navigation, sign-in, dashboard, or application layout behavior.")
    if shared_api:
        summaries.append("Updates shared system behavior and module integrations.")
    if deployment:
        summaries.append("Improves system installation, update, or deployment operations.")
    if database:
        summaries.append("Updates stored-data support required by this release.")

    unique = []
    for item in summaries:
        if item and item not in unique:
            unique.append(item)
    return unique[:8]


commits = []
for record in Path(raw_path).read_text().split("\x1e"):
    record = record.strip("\r\n")
    if not record:
        continue
    parts = record.split("\x1f", 5)
    if len(parts) != 6:
        continue
    commit, short, committed_at, author, subject, body = parts
    paths = changed_paths(commit)
    commits.append({
        "commit": commit,
        "short": short,
        "committedAt": committed_at,
        "author": author,
        "subject": subject,
        "summary": readable_summary(subject, body, paths),
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

write_preflight() {
  local control_dir="$1"
  local request_id="${2:-}"
  local preflight_file="$control_dir/preflight.json"
  local tmp
  local result=0
  tmp="$(mktemp "${preflight_file}.tmp.XXXXXX")"
  python3 - "$SOURCE_REPO" "$REMOTE/$BRANCH" "$DEPLOY_SCRIPT" "$ENV_FILE" "$PROD_DIR" "$request_id" > "$tmp" <<'PY' || result=$?
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

source_repo, source_branch, deploy_script, env_file, prod_dir, request_id = sys.argv[1:7]
checks = []


def add_check(check_id, label, required, ok, success, failure):
    checks.append({
        "id": check_id,
        "label": label,
        "required": required,
        "ok": bool(ok),
        "message": success if ok else failure,
    })


repo_ok = (Path(source_repo) / ".git").exists()
add_check("source", "Production source", True, repo_ok, "Production source is available.", "Production source checkout is unavailable.")

git_ok = False
if repo_ok and shutil.which("git"):
    result = subprocess.run(
        ["git", "-C", source_repo, "rev-parse", "--verify", f"{source_branch}^{{commit}}"],
        capture_output=True,
        text=True,
        check=False,
    )
    git_ok = result.returncode == 0
add_check("release", "Release history", True, git_ok, "Production release history is available.", "Production release history cannot be read.")

docker_ok = False
if shutil.which("docker"):
    result = subprocess.run(["docker", "info"], capture_output=True, text=True, check=False, timeout=20)
    docker_ok = result.returncode == 0
add_check("docker", "Container service", True, docker_ok, "Container service is ready.", "Container service is unavailable.")

compose_ok = False
if shutil.which("docker"):
    result = subprocess.run(["docker", "compose", "version"], capture_output=True, text=True, check=False, timeout=20)
    compose_ok = result.returncode == 0
add_check("compose", "Application builder", True, compose_ok, "Application builder is ready.", "Application builder is unavailable.")

script_ok = Path(deploy_script).is_file() and os.access(deploy_script, os.X_OK)
add_check("updater", "System updater", True, script_ok, "System updater is ready.", "System updater is missing or cannot run.")

settings_ok = Path(env_file).is_file() and os.access(env_file, os.R_OK)
add_check("settings", "Production settings", True, settings_ok, "Production settings are available.", "Production settings are unavailable.")

storage_root = Path(prod_dir).parent
try:
    free_bytes = shutil.disk_usage(storage_root).free
except OSError:
    free_bytes = 0
storage_ok = free_bytes >= 2 * 1024 * 1024 * 1024
free_gb = free_bytes / (1024 * 1024 * 1024)
add_check(
    "storage",
    "Update storage",
    True,
    storage_ok,
    f"{free_gb:.1f} GB is available for the update.",
    f"Only {free_gb:.1f} GB is available; at least 2 GB is required.",
)

blocking = sum(1 for check in checks if check["required"] and not check["ok"])
payload = {
    "ok": blocking == 0,
    "blocking": blocking,
    "checkedAt": datetime.now(timezone.utc).isoformat(),
    "requestId": request_id,
    "checks": checks,
}
print(json.dumps(payload, indent=2))
raise SystemExit(0 if blocking == 0 else 1)
PY
  mv "$tmp" "$preflight_file"
  return "$result"
}

handle_preflight_request() {
  local control_dir="$1"
  local request_file="$control_dir/preflight-request.json"
  local request_id

  [[ -f "$request_file" ]] || return 0
  request_id="$(json_request_field "$request_file" "id" 2>/dev/null || true)"
  write_preflight "$control_dir" "$request_id" || true
  rm -f "$request_file"
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
  if ! write_preflight "$control_dir" "$request_id"; then
    json_write_status "failed" "Deployment preflight failed. Resolve the blocked checks before updating." "$request_id" "$target_commit" "$log_file" "$(date -Is)" "" "$status_file"
    mv "$request_file" "$archive_file"
    return 0
  fi
  json_write_status "running" "Preparing the selected production version." "$request_id" "$target_commit" "$log_file" "" "" "$status_file" "12" "preparing"
  log "Deploy request $request_id targeting $target_commit"

  THREEJMAIN_PROD_COMMIT="$target_commit" "$DEPLOY_SCRIPT" > "$log_file" 2>&1 &
  local deploy_pid=$!
  local deploy_exit=0
  local progress_percent=18
  local progress_step="checkout"
  local progress_message="Preparing the production checkout."

  while kill -0 "$deploy_pid" 2>/dev/null; do
    if grep -q "Building production Docker images" "$log_file" 2>/dev/null; then
      progress_percent=45
      progress_step="building"
      progress_message="Building the selected application version."
    fi
    if grep -q "Starting production Docker stack" "$log_file" 2>/dev/null; then
      progress_percent=75
      progress_step="starting"
      progress_message="Starting the updated production services."
    fi
    if grep -q "API is healthy" "$log_file" 2>/dev/null; then
      progress_percent=90
      progress_step="verifying"
      progress_message="Verifying production health and browser access."
    fi
    json_write_status "running" "$progress_message" "$request_id" "$target_commit" "$log_file" "" "" "$status_file" "$progress_percent" "$progress_step"
    sleep 2
  done

  wait "$deploy_pid" || deploy_exit=$?
  if (( deploy_exit == 0 )); then
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
  write_preflight "$control_dir" "" || true

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
    handle_preflight_request "$control_dir"
    handle_request "$control_dir"
    sleep "$POLL_SECONDS"
  done
}

main "$@"
