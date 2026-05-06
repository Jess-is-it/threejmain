# Customer Profiling Module Context

## Purpose

Customer Profiling manages customer records, account identity, service addresses, contacts, account lifecycle, bulk upload workflow, and read-only Service Order references.

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
- Customer service location selection backed by System Settings -> Location Management
- Secondary contacts and read-only Service Order references from the Service module
- Bulk upload template workflow surface

## Integration Notes

- Keep Customer Profiling-specific pages, API routers, services, fixtures, and styles inside `customer-profiling/`.
- Other modules may read Customer Profiling contracts for customer lookup prerequisites.
- Customer Profiling reads `/api/system-settings/locations` in the frontend and uses System Settings' internal `ensure_location_record` helper in the API to create or link minimal location records during customer create/update.
- Province, city, barangay, and coordinates are optional on customer saves so incomplete locations can be finished later in System Settings -> Location Management.
- Service Catalog/Order owns service assignment CRUD. Customer Profiling displays `/api/service/orders?customerId=...` results for the selected customer.
- Integration Codex should read this file before changing Customer Profiling app-shell wiring.
- Only stable cross-project facts should be copied into the main `Project_Context.md`.

## Follow-Up Notes

- Replace in-memory state with shared PostgreSQL persistence before production.
- Document final customer lookup contracts for Billing, Customer Service Management, Ticketing, and Point of Sale.
