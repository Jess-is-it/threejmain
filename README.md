# threejmain ISP Management

`threejmain` is a modular ISP business management application for a small internet service provider.

The shared working shell lives in `app-shell/` and provides the common Tabler admin experience: side navigation, top header with page/system status, logs, system settings, system port registry, profile, and change password.

## Modules

- `features/customer-profiling`
- `features/billing`
- `features/point-of-sale`
- `features/inventory`
- `features/account-admin`
- `features/customer-service-management`
- `features/ticketing`
- `features/service`
- `features/process-flow`
- `features/network-settings`
- `features/system-settings`
- `features/logs`
- `features/techportal`

Each module owns its own folder under `features/`. New modules should follow the same folder pattern.

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

## Fresh Production Install / Update

On a fresh Ubuntu production server, run this one command:

```bash
curl -fsSL https://raw.githubusercontent.com/Jess-is-it/threejmain/master/scripts/production_bootstrap.sh | sudo bash
```

Use the same command later to update production from the latest `origin/master`. The first run prompts for the production owner username, email, contact number, and password; installs Docker; clones the repo into `/home/threejmain`; creates a fresh production `.env`; deploys the production Docker Compose stack; and installs the manual deploy control worker used by System Settings.

```text
Web: http://SERVER_IP:8180/
API: http://SERVER_IP:8100/
```

The owner login and generated database password are stored in `/home/threejmain/.env`. Later runs preserve this file and reuse the same production data volumes.

Production owners can also update or roll back from `System Settings -> Runtime -> Production Deployment`, which lists the latest 10 commits from `master`.

Read `Project_Context.md` before making project changes.
