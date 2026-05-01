# Architecture

## URL and Port Policy
- Module API is mounted under `API_BASE_PATH=/api/customer-profiling`.
- Versioned business endpoints are under `/api/customer-profiling/v1`.
- Health and docs stay non-versioned:
  - `/api/customer-profiling/health`
  - `/api/customer-profiling/docs`
  - `/api/customer-profiling/docs-json`
- Web is mounted under `WEB_BASE_PATH=/customer-profiling`.
- In production, reverse proxy should route path prefixes to this module.

## Module Registry Concept
- This module never hardcodes downstream module URLs.
- `MAIN_BASE_URL` is used to call:
  - `GET /api/main-system/v1/modules/registry`
- A module-registry client stub with TTL cache is included in `api/src/module-registry/`.

## Data Ownership
- Customer Profiling owns:
  - `customers`
  - `customer_services`
  - `audit_logs`
- No direct DB access from other modules.
- Integration is API-only.

## Cross-Cutting Standards
- Correlation ID propagation via `X-Correlation-Id`
- Structured request logging
- JWT guard scaffold (SSO-ready)
- RBAC permission skeleton
- Audit logs for mutation paths
