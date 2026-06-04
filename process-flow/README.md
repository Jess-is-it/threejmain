# Process Flow

Process Flow explains how the ISP management system should be used across modules. It is an operator-facing reference page, not a transaction module.

## Purpose

The page shows vertical process topology diagrams for common ISP workflows such as customer onboarding, new installation, outstanding balance handling, plan changes, relocation, suspension/reconnection, disconnection, equipment replacement, add-on service, change ownership, and network provisioning.

## Routes

- Web: `/process-flow`
- API: `/api/process-flow`

## API

- `GET /api/process-flow/flows` returns process definitions with ordered stages and module ownership.
- `GET /api/process-flow/overview` returns counts for the shell dashboard/module registry.

## Integration Notes

Process Flow does not own business data. It references the modules that own each process step:

- Customer Profiling owns customer identity.
- Service owns Service Catalog, Service Account, and Service Order state.
- Ticketing owns operational work items.
- Billing owns balances, invoices, payments, and collection state.
- Inventory owns equipment and material assets.
- Network Settings owns access-network/provisioning reference data.

The frontend renders an interactive pan/zoom canvas with animated top-to-bottom connectors so users can understand the system sequence before entering transactions.
