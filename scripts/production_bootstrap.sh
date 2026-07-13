#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  printf '[%s] %s\n' "$(date -Is)" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    fail "run this installer as root, for example: curl -fsSL <url> | sudo bash"
  fi
}

random_hex() {
  local bytes="${1:-24}"
  od -An -tx1 -N "$bytes" /dev/urandom | tr -d ' \n'
}

trim_value() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

require_tty_for_prompt() {
  if [[ ! -r /dev/tty ]]; then
    fail "owner credential prompts require an interactive TTY; set THREEJMAIN_OWNER_USERNAME, THREEJMAIN_OWNER_EMAIL, THREEJMAIN_OWNER_CONTACT, and THREEJMAIN_OWNER_PASSWORD for non-interactive install"
  fi
}

quote_env_value() {
  local value="$1"
  if [[ "$value" == *"'"* || "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    fail "environment values cannot contain single quotes or newlines"
  fi
  printf "'%s'" "$value"
}

prompt_required_value() {
  local target_var="$1"
  local env_var="$2"
  local label="$3"
  local value="${!env_var:-}"

  while true; do
    if [[ -z "$value" ]]; then
      require_tty_for_prompt
      printf '%s: ' "$label" > /dev/tty
      IFS= read -r value < /dev/tty || fail "failed to read $label"
    fi

    value="$(trim_value "$value")"
    if [[ -n "$value" ]]; then
      printf -v "$target_var" '%s' "$value"
      return
    fi

    printf '%s is required.\n' "$label" > /dev/tty
  done
}

prompt_owner_password() {
  local target_var="$1"
  local value="${THREEJMAIN_OWNER_PASSWORD:-}"
  local confirm=""

  if [[ -n "$value" ]]; then
    if (( ${#value} < 8 )); then
      fail "THREEJMAIN_OWNER_PASSWORD must be at least 8 characters"
    fi
    printf -v "$target_var" '%s' "$value"
    return
  fi

  require_tty_for_prompt
  while true; do
    printf 'Owner password: ' > /dev/tty
    IFS= read -rs value < /dev/tty || fail "failed to read owner password"
    printf '\nConfirm owner password: ' > /dev/tty
    IFS= read -rs confirm < /dev/tty || fail "failed to read owner password confirmation"
    printf '\n' > /dev/tty

    if (( ${#value} < 8 )); then
      printf 'Owner password must be at least 8 characters.\n' > /dev/tty
      continue
    fi

    if [[ "$value" != "$confirm" ]]; then
      printf 'Owner passwords do not match.\n' > /dev/tty
      continue
    fi

    printf -v "$target_var" '%s' "$value"
    return
  done
}

detect_public_host() {
  local detected=""
  detected="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  printf '%s\n' "${THREEJMAIN_PUBLIC_HOST:-${detected:-localhost}}"
}

mark_git_safe_dir() {
  local path="$1"
  git config --global --add safe.directory "$path" >/dev/null 2>&1 || true
}

install_base_packages() {
  export DEBIAN_FRONTEND=noninteractive
  log "Installing base packages"
  apt-get update
  apt-get install -y ca-certificates curl git gnupg lsb-release
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Docker Engine and Compose plugin are already installed"
    systemctl enable --now docker
    return
  fi

  if [[ ! -r /etc/os-release ]]; then
    fail "cannot detect OS release; this installer expects Ubuntu"
  fi

  # shellcheck disable=SC1091
  . /etc/os-release
  if [[ "${ID:-}" != "ubuntu" ]]; then
    fail "unsupported OS '${ID:-unknown}'; this installer expects Ubuntu"
  fi

  local codename="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
  [[ -n "$codename" ]] || fail "cannot detect Ubuntu codename for Docker apt repository"

  log "Installing Docker Engine from Docker's official apt repository"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
    "$(dpkg --print-architecture)" "$codename" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
}

ensure_source_repo() {
  local repo_url="$1"
  local source_repo="$2"
  local branch="$3"

  if [[ ! -e "$source_repo/.git" ]]; then
    if [[ -e "$source_repo" && -n "$(find "$source_repo" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
      fail "$source_repo exists but is not a git checkout; move it before installing"
    fi

    log "Cloning $repo_url branch $branch into $source_repo"
    mkdir -p "$(dirname "$source_repo")"
    git clone --branch "$branch" "$repo_url" "$source_repo"
  else
    log "Updating existing source checkout at $source_repo"
    mark_git_safe_dir "$source_repo"

    local tracked_changes
    tracked_changes="$(git -C "$source_repo" status --porcelain --untracked-files=no)"
    if [[ -n "$tracked_changes" ]]; then
      fail "$source_repo has tracked local changes; commit or remove them before running the production updater"
    fi

    git -C "$source_repo" fetch --prune origin "+refs/heads/$branch:refs/remotes/origin/$branch"
    git -C "$source_repo" checkout "$branch" 2>/dev/null || git -C "$source_repo" checkout -b "$branch" "origin/$branch"
    git -C "$source_repo" merge --ff-only "origin/$branch"
  fi

  mark_git_safe_dir "$source_repo"
}

ensure_production_env() {
  local env_file="$1"
  local web_port="$2"
  local api_port="$3"

  if [[ -f "$env_file" ]]; then
    log "Keeping existing production environment file at $env_file"
    chmod 600 "$env_file" || true
    return
  fi

  local public_host
  local postgres_password
  local owner_username
  local owner_email
  local owner_contact
  local owner_password
  local system_name_env
  local owner_username_env
  local owner_email_env
  local owner_contact_env
  local owner_password_env
  public_host="$(detect_public_host)"
  postgres_password="$(random_hex 24)"

  log "Collecting production owner credentials"
  prompt_required_value owner_username THREEJMAIN_OWNER_USERNAME "Owner username"
  prompt_required_value owner_email THREEJMAIN_OWNER_EMAIL "Owner email"
  prompt_required_value owner_contact THREEJMAIN_OWNER_CONTACT "Owner contact number"
  prompt_owner_password owner_password

  if (( ${#owner_username} < 3 )); then
    fail "owner username must be at least 3 characters"
  fi

  system_name_env="$(quote_env_value "3J ISP Management")"
  owner_username_env="$(quote_env_value "$owner_username")"
  owner_email_env="$(quote_env_value "$owner_email")"
  owner_contact_env="$(quote_env_value "$owner_contact")"
  owner_password_env="$(quote_env_value "$owner_password")"

  log "Creating fresh production environment file at $env_file"
  mkdir -p "$(dirname "$env_file")"
  umask 077
  cat > "$env_file" <<EOF
APP_ENV=production
APP_SYSTEM_NAME=${system_name_env}

WEB_PORT=${web_port}
API_PORT=${api_port}
CORS_ALLOW_ORIGINS=http://localhost:${web_port},http://127.0.0.1:${web_port},http://${public_host}:${web_port}

POSTGRES_DB=threejmain
POSTGRES_USER=threejmain_prod
POSTGRES_PASSWORD=${postgres_password}
DATABASE_URL=postgresql://threejmain_prod:${postgres_password}@postgres:5432/threejmain

DEFAULT_ADMIN_USERNAME=${owner_username_env}
DEFAULT_ADMIN_PASSWORD=${owner_password_env}
DEFAULT_ADMIN_NAME=${owner_username_env}
DEFAULT_ADMIN_EMAIL=${owner_email_env}
DEFAULT_ADMIN_CONTACT=${owner_contact_env}

CUSTOMER_PROFILING_STORAGE=postgres
CUSTOMER_PROFILING_SEED_DEMO=false
BILLING_SEED_DEMO=false
EOF
  chmod 600 "$env_file"
}

run_production_deploy() {
  local source_repo="$1"
  local prod_dir="$2"
  local env_file="$3"
  local branch="$4"

  chmod +x "$source_repo/scripts/production_deploy.sh"
  mark_git_safe_dir "$prod_dir"

  log "Deploying production from origin/$branch"
  THREEJMAIN_SOURCE_REPO="$source_repo" \
    THREEJMAIN_PROD_DIR="$prod_dir" \
    THREEJMAIN_PROD_ENV_FILE="$env_file" \
    THREEJMAIN_PROD_BRANCH="$branch" \
    "$source_repo/scripts/production_deploy.sh"
}

maybe_install_autodeploy() {
  local source_repo="$1"

  if [[ "${THREEJMAIN_INSTALL_AUTODEPLOY:-0}" != "1" ]]; then
    return
  fi

  log "Installing production auto-deploy watcher"
  chmod +x "$source_repo/scripts/install_production_autodeploy.sh"
  "$source_repo/scripts/install_production_autodeploy.sh"
}

maybe_install_deploy_control() {
  local source_repo="$1"

  if [[ "${THREEJMAIN_INSTALL_DEPLOY_CONTROL:-1}" != "1" ]]; then
    return
  fi

  log "Installing manual production deploy control worker"
  chmod +x "$source_repo/scripts/install_production_deploy_control.sh"
  "$source_repo/scripts/install_production_deploy_control.sh"
}

main() {
  require_root

  local repo_url="${THREEJMAIN_REPO_URL:-https://github.com/Jess-is-it/threejmain.git}"
  local branch="${THREEJMAIN_PROD_BRANCH:-master}"
  local source_repo="${THREEJMAIN_SOURCE_REPO:-/home/threejmain}"
  local prod_dir="${THREEJMAIN_PROD_DIR:-/home/threejmain-production}"
  local env_file="${THREEJMAIN_PROD_ENV_FILE:-$source_repo/.env}"
  local web_port="${WEB_PORT:-8180}"
  local api_port="${API_PORT:-8100}"

  install_base_packages
  install_docker
  ensure_source_repo "$repo_url" "$source_repo" "$branch"
  ensure_production_env "$env_file" "$web_port" "$api_port"
  run_production_deploy "$source_repo" "$prod_dir" "$env_file" "$branch"
  maybe_install_deploy_control "$source_repo"
  maybe_install_autodeploy "$source_repo"

  log "Production install/update complete"
  log "Web: http://$(detect_public_host):${web_port}/"
  log "API: http://$(detect_public_host):${api_port}/"
  log "Production env file: $env_file"
  log "Owner credentials are stored in $env_file."
}

main "$@"
