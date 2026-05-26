#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_NAME="${THREEJMAIN_PROD_UNIT_NAME:-threejmain-production-auto-deploy.service}"
UNIT_SOURCE="${THREEJMAIN_PROD_UNIT_SOURCE:-$REPO_ROOT/deploy/systemd/$UNIT_NAME}"
UNIT_TARGET="${THREEJMAIN_PROD_UNIT_TARGET:-/etc/systemd/system/$UNIT_NAME}"

if [[ ! -f "$UNIT_SOURCE" ]]; then
  printf 'Unit template not found: %s\n' "$UNIT_SOURCE" >&2
  exit 1
fi

install -m 0644 "$UNIT_SOURCE" "$UNIT_TARGET"
systemctl daemon-reload
systemctl enable "$UNIT_NAME"
systemctl restart "$UNIT_NAME"
systemctl --no-pager --full status "$UNIT_NAME"
