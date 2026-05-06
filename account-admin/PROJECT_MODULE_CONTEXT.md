# Account Admin Module Context

This is the module-local source of truth for Account Admin. Keep ordinary module progress here instead of editing the root `Project_Context.md`.

## Module Folder

```text
account-admin/
  api/account_admin/__init__.py
  api/account_admin/router.py
  web/AccountAdminPage.jsx
  web/accountAdmin.css
  README.md
  module.json
  PROJECT_MODULE_CONTEXT.md
```

## Current Scope

The first Account Admin shell is intentionally limited to basic account CRUD:

- Create admin/staff accounts
- List and search accounts
- Edit account profile fields and password
- Track `ACTIVE` and `INACTIVE` states
- Activate and deactivate accounts
- Soft archive accounts

Roles, permissions, permission groups, access policies, password reset flows, and session administration are not part of this phase.

## API

FastAPI package: `account-admin/api/account_admin`

API prefix: `/api/account-admin`

Routes:

- `GET /api/account-admin/meta`
- `GET /api/account-admin/overview`
- `GET /api/account-admin/accounts`
- `GET /api/account-admin/accounts/{account_id}`
- `POST /api/account-admin/accounts`
- `PATCH /api/account-admin/accounts/{account_id}`
- `POST /api/account-admin/accounts/{account_id}/activate`
- `POST /api/account-admin/accounts/{account_id}/deactivate`
- `DELETE /api/account-admin/accounts/{account_id}`

The router exposes `configure_account_admin(current_admin, audit_logger)` so the integration layer can attach shared auth and audit behavior when app-shell wiring is added.

## Frontend

Frontend entry: `account-admin/web/AccountAdminPage.jsx`

Styles: `account-admin/web/accountAdmin.css`

The page follows the customer-profiling module style: module-owned React page, module-owned CSS, local request helper using the shared `/api` proxy, Tabler cards, tabs, filters, and tables.

## Dependencies

Current module prerequisites:

- Shared shell auth dependency injected through `configure_account_admin`
- Optional shared audit logger injected through `configure_account_admin`

No business-module prerequisites are required for the basic CRUD phase. Future role and permission work may need shared auth/session contracts from app-shell.

## Integration Notes

This module is not wired into app-shell in this branch. Integration Codex should:

- Add `account-admin/api` to the app-shell API import path
- Import and include `account_admin.router`
- Call `configure_account_admin(current_admin, add_audit)`
- Add `AccountAdminPage.jsx` to app-shell routing/navigation
- Add Docker/Vite module copy or allowlist entries if the integration branch requires container/dev-server support

## Risks

- Data is in-memory and resets on process restart.
- Password values are plain in-memory fields for the first CRUD shell; production needs hashing and storage controls.
- Deactivating the currently authenticated account is blocked, but broader session invalidation is deferred.
- Roles and permissions are intentionally absent, so all accounts are equivalent until a later phase.
