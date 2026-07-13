#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  printf '[%s] %s\n' "$(date -Is)" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

load_env_file() {
  local env_file="$1"
  local line
  local key
  local value

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue

    if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"
      value="${value#"${value%%[![:space:]]*}"}"
      value="${value%"${value##*[![:space:]]}"}"

      if (( ${#value} >= 2 )) && [[ "$value" == \"*\" && "$value" == *\" ]]; then
        value="${value:1:${#value}-2}"
      elif (( ${#value} >= 2 )) && [[ "$value" == \'*\' && "$value" == *\' ]]; then
        value="${value:1:${#value}-2}"
      fi

      export "$key=$value"
    fi
  done < "$env_file"
}

SOURCE_REPO="${THREEJMAIN_SOURCE_REPO:-/home/threejmain}"
PROD_DIR="${THREEJMAIN_PROD_DIR:-/home/threejmain-production}"
STATE_DIR="${THREEJMAIN_PROD_STATE_DIR:-/var/lib/threejmain-production}"
REMOTE="${THREEJMAIN_PROD_REMOTE:-origin}"
BRANCH="${THREEJMAIN_PROD_BRANCH:-master}"
TARGET_COMMIT_OVERRIDE="${THREEJMAIN_PROD_COMMIT:-}"
COMPOSE_PROJECT="${THREEJMAIN_PROD_COMPOSE_PROJECT:-threejmain-production}"
STOP_PROJECT="${THREEJMAIN_PROD_STOP_PROJECT:-threejmain}"
DEPLOY_LOCK="${THREEJMAIN_PROD_DEPLOY_LOCK:-/tmp/threejmain-production-deploy.lock}"
ENV_FILE="${THREEJMAIN_PROD_ENV_FILE:-$SOURCE_REPO/.env}"
COMPOSE_FILE="docker-compose.yml"

exec 9>"$DEPLOY_LOCK"
if ! flock -n 9; then
  fail "another production deploy is already running"
fi

[[ -e "$SOURCE_REPO/.git" ]] || fail "source repo not found at $SOURCE_REPO"

COMPOSE_ENV_ARGS=()
if [[ -f "$ENV_FILE" ]]; then
  log "Loading production environment from $ENV_FILE"
  load_env_file "$ENV_FILE"
  COMPOSE_ENV_ARGS=(--env-file "$ENV_FILE")
fi

log "Fetching $REMOTE/$BRANCH from $SOURCE_REPO"
git -C "$SOURCE_REPO" fetch --prune "$REMOTE" "+refs/heads/$BRANCH:refs/remotes/$REMOTE/$BRANCH"

if [[ -n "$TARGET_COMMIT_OVERRIDE" ]]; then
  [[ "$TARGET_COMMIT_OVERRIDE" =~ ^[0-9a-fA-F]{7,40}$ ]] || fail "THREEJMAIN_PROD_COMMIT must be a 7-40 character commit hash"
  TARGET_COMMIT="$(git -C "$SOURCE_REPO" rev-parse "$TARGET_COMMIT_OVERRIDE^{commit}")"
  if ! git -C "$SOURCE_REPO" merge-base --is-ancestor "$TARGET_COMMIT" "$REMOTE/$BRANCH"; then
    fail "target commit $TARGET_COMMIT is not in $REMOTE/$BRANCH history"
  fi
else
  TARGET_COMMIT="$(git -C "$SOURCE_REPO" rev-parse "$REMOTE/$BRANCH^{commit}")"
fi
SHORT_TARGET="$(git -C "$SOURCE_REPO" rev-parse --short "$TARGET_COMMIT")"

export APP_ENV="${APP_ENV:-production}"
export APP_BRANCH="${APP_BRANCH:-$BRANCH}"
export APP_COMMIT="${APP_COMMIT:-$TARGET_COMMIT}"
export APP_VERSION="${APP_VERSION:-${BRANCH}-${SHORT_TARGET}}"
export APP_BUILD_TIME="${APP_BUILD_TIME:-$(date -Is)}"

mkdir -p "$STATE_DIR"

if [[ ! -e "$PROD_DIR/.git" ]]; then
  if [[ -e "$PROD_DIR" ]] && [[ -n "$(find "$PROD_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
    fail "$PROD_DIR exists but is not a git checkout; move it before deploying"
  fi
  mkdir -p "$(dirname "$PROD_DIR")"
  log "Creating detached production checkout at $PROD_DIR"
  git -C "$SOURCE_REPO" worktree add --detach "$PROD_DIR" "$TARGET_COMMIT"
else
  log "Updating production checkout at $PROD_DIR to $SHORT_TARGET"
  git -C "$PROD_DIR" fetch --prune "$REMOTE" "+refs/heads/$BRANCH:refs/remotes/$REMOTE/$BRANCH"
  git -C "$PROD_DIR" checkout --detach "$TARGET_COMMIT"
fi

[[ -f "$PROD_DIR/$COMPOSE_FILE" ]] || fail "compose file missing at $PROD_DIR/$COMPOSE_FILE"

log "Building production Docker images for compose project $COMPOSE_PROJECT"
docker compose "${COMPOSE_ENV_ARGS[@]}" --project-name "$COMPOSE_PROJECT" -f "$PROD_DIR/$COMPOSE_FILE" build

if [[ -n "$STOP_PROJECT" && "$STOP_PROJECT" != "$COMPOSE_PROJECT" ]]; then
  log "Stopping conflicting compose project $STOP_PROJECT to free production ports"
  docker compose "${COMPOSE_ENV_ARGS[@]}" --project-name "$STOP_PROJECT" -f "$SOURCE_REPO/$COMPOSE_FILE" stop || true
fi

log "Starting production Docker stack from $SHORT_TARGET"
docker compose "${COMPOSE_ENV_ARGS[@]}" --project-name "$COMPOSE_PROJECT" -f "$PROD_DIR/$COMPOSE_FILE" up -d

wait_for_url() {
  local url="$1"
  local label="$2"
  local attempt

  for attempt in $(seq 1 40); do
    if curl -fsS "$url" >/dev/null; then
      log "$label is healthy"
      return 0
    fi
    sleep 2
  done

  return 1
}

wait_for_head() {
  local url="$1"
  local label="$2"
  local attempt

  for attempt in $(seq 1 40); do
    if curl -fsSI "$url" >/dev/null; then
      log "$label is reachable"
      return 0
    fi
    sleep 2
  done

  return 1
}

wait_for_url "http://127.0.0.1:${API_PORT:-8100}/health" "API" || fail "API health check failed"
wait_for_head "http://127.0.0.1:${WEB_PORT:-8180}/" "Web" || fail "web health check failed"

printf '%s\n' "$TARGET_COMMIT" > "$STATE_DIR/deployed-master"
printf '%s\n' "$REMOTE/$BRANCH" > "$STATE_DIR/deployed-ref"
date -Is > "$STATE_DIR/deployed-at"

log "Production deploy complete at $SHORT_TARGET"
