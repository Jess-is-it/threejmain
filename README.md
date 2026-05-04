# threejmain ISP Management

`threejmain` is a modular ISP business management application for a small internet service provider.

The shared working shell lives in `app-shell/` and provides the common Tabler admin experience: side navigation, top header with page/system status, logs, system settings, system port registry, profile, and change password.

## Modules

- `customer-profiling`
- `billing`
- `point-of-sale`
- `inventory`
- `account-admin`
- `customer-service-management`
- `ticketing`

Each module owns its own root-level folder. New modules should follow the same folder pattern.

## Stack

- Frontend: React + Vite + Tabler
- Backend: FastAPI
- Database target: PostgreSQL
- Web/admin port: `8180`
- API port: `8100`

These ports intentionally avoid the existing `3JCentralPisowifi` ports such as `8080`, `1812`, `1813`, `11812`, and `11813`.

## Run With Docker Compose

```bash
docker compose up --build
```

Open:

```text
http://localhost:8180
```

Default local credentials:

```text
admin / admin123
```

Change the password before any real deployment.

Read `Project_Context.md` before making project changes.
