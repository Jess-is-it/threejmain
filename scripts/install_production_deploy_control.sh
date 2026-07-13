#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_NAME="${THREEJMAIN_PROD_DEPLOY_CONTROL_UNIT_NAME:-threejmain-production-deploy-control.service}"
UNIT_SOURCE="${THREEJMAIN_PROD_DEPLOY_CONTROL_UNIT_SOURCE:-$REPO_ROOT/deploy/systemd/$UNIT_NAME}"
UNIT_TARGET="${THREEJMAIN_PROD_DEPLOY_CONTROL_UNIT_TARGET:-/etc/systemd/system/$UNIT_NAME}"
AUTO_UNIT="${THREEJMAIN_PROD_UNIT_NAME:-threejmain-production-auto-deploy.service}"

if [[ ! -f "$UNIT_SOURCE" ]]; then
  printf 'Unit template not found: %s\n' "$UNIT_SOURCE" >&2
  exit 1
fi

chmod +x "$REPO_ROOT/scripts/production_deploy_control_worker.sh"
install -m 0644 "$UNIT_SOURCE" "$UNIT_TARGET"
systemctl daemon-reload

if systemctl list-unit-files "$AUTO_UNIT" >/dev/null 2>&1; then
  systemctl disable --now "$AUTO_UNIT" >/dev/null 2>&1 || true
fi

systemctl enable "$UNIT_NAME"
systemctl restart "$UNIT_NAME"
systemctl --no-pager --full status "$UNIT_NAME"
