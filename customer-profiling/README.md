# THREE3J Customer Profiling System

Standalone module for customer identity, profile details, and service assignments for THREE3J ISP.

## Version
- `0.1.4`

## Stack
- Backend: NestJS + Prisma + PostgreSQL
- Frontend: React + TypeScript + Vite + Tailwind + shadcn/ui + TanStack Query/Table
- Runtime: Docker Compose (`api`, `web`, `postgres`)

## Base Paths
- Web base path: `/customer-profiling`
- API base path: `/api/customer-profiling`
- API versioned base: `/api/customer-profiling/v1`

## Local URLs
- UI: `http://localhost:5173/customer-profiling/`
- API Base: `http://localhost:3000/api/customer-profiling/v1`
- Swagger: `http://localhost:3000/api/customer-profiling/docs`
- OpenAPI JSON: `http://localhost:3000/api/customer-profiling/docs-json`
- Health: `http://localhost:3000/api/customer-profiling/health`

## Quick Start
1. Copy env file:
```bash
cp .env.example .env
```
2. Run all services:
```bash
docker compose up -d --build
```

## Environment Variables
See `.env.example`.

Important values:
- `WEB_BASE_PATH`
- `API_BASE_PATH`
- `MAIN_BASE_URL`
- `DATABASE_URL`
- `MODULE_VERSION`

## Repository Layout
- `api/` NestJS service with Prisma
- `web/` React UI shell integrated from TailwindAdmin template
- `docker-compose.yml` local stack
- `AI_PROMPT.md` prompt summary for AI workflows
- `CHANGELOG.md` semantic version history
