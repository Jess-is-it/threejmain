# Account Admin

Account Admin owns staff/admin users, account security, login controls, and audit-related administration.

The first working shell exposes this module at `/account-admin`.

## Current shell scope

- Create, edit, list, search, and soft archive admin accounts
- Track `ACTIVE` and `INACTIVE` account status
- Activate and deactivate accounts
- Keep roles and permissions out of scope for this first CRUD pass

The implementation is in-memory for the first working shell. Durable shared PostgreSQL tables should be added before production use.
