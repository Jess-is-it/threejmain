# Logs

Logs owns the operator-facing audit log viewer for app-shell and module activity.

## Scope

- Read-only audit log table
- Refresh action
- Shared app-shell audit events and module audit events

## Module Layout

```text
logs/
  api/logs/__init__.py
  api/logs/router.py
  web/LogsPage.jsx
  web/logs.css
  README.md
  module.json
  PROJECT_MODULE_CONTEXT.md
```

## API

- Prefix: `/api/logs`
- Compatibility endpoint retained:
  - `/api/audit-logs`

## Integration Notes

The app-shell configures this module with shared auth and the shared in-memory audit log store.
