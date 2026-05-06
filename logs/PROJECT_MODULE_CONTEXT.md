# Logs Module Context

## Purpose

Logs displays shared audit events for app-shell and business module activity.

## Current Status

- Status: `functional-shell`
- App-shell route: `/logs`
- API prefix: `/api/logs`
- Frontend entry: `logs/web/LogsPage.jsx`
- API entry: `logs/api/logs/router.py`

## Current Scope

- Read-only audit log table.
- Refresh button.
- Compatibility API route for `/api/audit-logs`.

## Integration Notes

- App-shell imports `LogsPage`.
- App-shell calls `configure_logs(current_admin, audit_logs)`.
- Durable log persistence is deferred; logs are in-memory in the first shell.
