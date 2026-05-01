# Deployment

## Docker Compose
This repository includes `docker-compose.yml` with:
- `postgres`
- `api`
- `web`

Start:
```bash
docker compose up -d --build
```

## Reverse Proxy Assumptions
External gateway should route:
- `/customer-profiling` -> `web` service
- `/api/customer-profiling` -> `api` service

The module itself already supports base paths through env vars:
- `WEB_BASE_PATH`
- `API_BASE_PATH`

## Production Notes
- Replace default DB credentials.
- Provide real JWT validation implementation in `JwtAuthGuard`.
- Connect to live module registry using `MAIN_BASE_URL`.
