# Customer Profiling Module Context

## Purpose

Customer Profiling manages customer records, account identity, addresses, contacts, account lifecycle, and the bulk upload workflow.

## Current Status

- Status from `module.json`: `functional-shell`
- App-shell route target: `/customer-profiling`
- API prefix: `/api/customer-profiling`
- Frontend entry: `customer-profiling/web/CustomerProfilingPage.jsx`
- API entry: `customer-profiling/api/customer_profiling/router.py`

## Current CRUD Scope

- Customer overview KPIs and distribution tables
- Customer list with search and filters
- Create, update, view, and soft archive customer profiles
- Secondary contacts
- Read-only Service Order references from the Service module for selected customers
- Bulk upload template workflow surface

## Integration Notes

- Keep Customer Profiling-specific pages, API routers, services, fixtures, and styles inside `customer-profiling/`.
- Other modules may read Customer Profiling contracts for customer lookup prerequisites.
- Customer Profiling no longer creates service assignments. Service Catalog and Service Order ownership lives in the `service/` module.
- Integration Codex should read this file before changing Customer Profiling app-shell wiring.
- Only stable cross-project facts should be copied into the main `Project_Context.md`.

## Follow-Up Notes

- Replace in-memory state with shared PostgreSQL persistence before production.
- Document final customer lookup contracts for Billing, Customer Service Management, Ticketing, and Point of Sale.
