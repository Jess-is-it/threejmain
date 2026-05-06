# Account Admin

Account Admin owns staff/admin users, account security, login controls, and audit-related administration.

This module follows the same module-folder pattern as Customer Profiling:

```text
account-admin/
  api/
    account_admin/
      __init__.py
      router.py
  web/
    AccountAdminPage.jsx
    accountAdmin.css
  README.md
  module.json
  PROJECT_MODULE_CONTEXT.md
```

## Current shell scope

- Create, edit, list, search, and soft archive admin accounts
- Track `ACTIVE` and `INACTIVE` account status
- Activate and deactivate accounts
- Keep roles and permissions out of scope for this first CRUD pass

Current module API prefix:

```text
/api/account-admin
```

The current implementation is an in-memory FastAPI shell. Integration into app-shell is intentionally left to the integration Codex.
