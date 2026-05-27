#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GIT_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
GIT_SHORT="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
GIT_BRANCH="$(git -C "$REPO_ROOT" branch --show-current)"
GIT_DIRTY=""

if ! git -C "$REPO_ROOT" diff --quiet --ignore-submodules -- . || ! git -C "$REPO_ROOT" diff --cached --quiet --ignore-submodules -- .; then
  GIT_DIRTY="-dirty"
fi

export APP_ENV="${APP_ENV:-staging}"
export APP_BRANCH="${APP_BRANCH:-$GIT_BRANCH}"
export APP_COMMIT="${APP_COMMIT:-$GIT_COMMIT}"
export APP_VERSION="${APP_VERSION:-${APP_BRANCH}-${GIT_SHORT}${GIT_DIRTY}}"
export APP_BUILD_TIME="${APP_BUILD_TIME:-$(date -Is)}"
export WEB_PORT="${WEB_PORT:-8280}"
export API_PORT="${API_PORT:-8200}"
export CORS_ALLOW_ORIGINS="${CORS_ALLOW_ORIGINS:-http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT},http://192.168.50.70:${WEB_PORT}}"

COMPOSE_PROJECT="${THREEJMAIN_STAGING_COMPOSE_PROJECT:-threejmain-staging}"

log() {
  printf '[%s] %s\n' "$(date -Is)" "$*"
}

log "Deploying staging from $REPO_ROOT on ports web=$WEB_PORT api=$API_PORT version=$APP_VERSION"

docker compose --project-name "$COMPOSE_PROJECT" -f "$REPO_ROOT/docker-compose.yml" up -d --build

for attempt in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${API_PORT}/health" >/dev/null; then
    log "Staging API is healthy"
    break
  fi
  if [[ "$attempt" == 40 ]]; then
    log "ERROR: staging API health check failed"
    exit 1
  fi
  sleep 2
done

for attempt in $(seq 1 40); do
  if curl -fsSI "http://127.0.0.1:${WEB_PORT}/" >/dev/null; then
    log "Staging web is reachable"
    break
  fi
  if [[ "$attempt" == 40 ]]; then
    log "ERROR: staging web health check failed"
    exit 1
  fi
  sleep 2
done

log "Staging deploy complete"
log "Web: http://192.168.50.70:${WEB_PORT}/"
log "API: http://192.168.50.70:${API_PORT}/"
