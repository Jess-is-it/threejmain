# Customer Profiling Module Context

## Purpose

Customer Profiling manages customer records, account identity, service addresses, contacts, account lifecycle, and bulk upload workflow.

## Current Status

- Status from `module.json`: `functional-shell`
- App-shell route target: `/customer-profiling`
- API prefix: `/api/customer-profiling`
- Frontend entry: `features/customer-profiling/web/CustomerProfilingPage.jsx`
- API entry: `features/customer-profiling/api/customer_profiling/router.py`
- Persistence stage: Stage 2 real-data storage uses shared PostgreSQL table `customer_profiles` through app startup migration `2026052601_customer_profiles` when `CUSTOMER_PROFILING_STORAGE=postgres` and `DATABASE_URL` are configured.

## Current CRUD Scope

- Customer overview KPIs
- Customer list with status tabs, responsive header search, sortable headers, per-user/per-status configurable visible columns covering customer detail fields, large rectangular badge-style action buttons, icon-only header controls, and collapsible filters
- Create, update, view, and soft archive customer profiles
- New customer modal is staged with Profile, Contact, Location, and Review steps; Contact shows stacked Primary Contact and Secondary Contact relative panels plus a form-population progress bar
- Customer profiles include optional birth date capture and review.
- Customer profiles can mark whether the customer was recommended by an existing customer; when enabled, the UI requires selecting the recommending Customer Profiling record and saves id/name/account snapshot fields.
- Customer lifecycle status is system-owned in the UI: the create/edit customer modal no longer exposes manual Status selection, and new customer creates start as `PENDING` for downstream module workflow automation.
- New customer drafts are temporary browser-local records saved in `localStorage` and can be resumed or deleted from the Customer Drafts side panel
- Customer service location selection backed by System Settings -> Location Management
- The create/edit Location stage uses Customer Location wording, a searchable saved-location picker, and one merged location/address panel for record, landmark, province, city, barangay, and address lines.
- The Location stage coordinate controls show Capture Coordinates only after a saved Customer Location is selected and show a Clear action whenever longitude/latitude values are present.
- Customer gender field (`MALE` / `FEMALE`) used by System Settings avatar selection.
- Customer table and detail drawer show System Settings customer emotion avatars through `CustomerEmotionAvatar`.
- Customer detail drawer hides avatar mood labels, uses a larger avatar image, places account/status/type badges beside the customer name, and uses compact Customers-table-style Basic Info and Location tabs; contact fields and Secondary Contacts live under Basic Info.
- Customer detail view uses a desktop split side panel sized to about 25% of the workspace on larger screens and switches to a modal dialog on mobile widths.
- Customer Profiling overrides the app-shell desktop content container only when this module is active, using 100px left/right page gutters so the workspace sits closer to the left navigation while preserving responsive smaller gutters.
- Business customer profiles include a required `businessName` field on final save, and customer details show a compact coordinates map preview that opens Google Maps when clicked.
- Customer coordinate capture and detail preview maps use System Settings -> Maps provider settings through `features/system-settings/web/mapProviders.js`. The capture modal has a compact provider selector, honors the selected provider's max zoom, and creates provider sessions when a session-based provider such as Google Map Tiles is selected. Google Maps open-link and Street View remain external helpers.
- Customer table action badges include Check Serviceability, which navigates to `/network-settings/serviceability-check?customerId=<customer id>` so Network Settings opens the selected customer in its serviceability split view.
- Secondary contacts
- Bulk upload CSV modal with template download, preview validation, duplicate checks, row-level barangay selection, and guarded import. The bulk template/import flow excludes account number, customer type, business name, status, and recommender fields; account number/status are system-managed and business/referral details can be set after upload.
- `/api/customer-profiling/readiness` reports whether Customer Profiling is using PostgreSQL storage and lists remaining production-hardening stages.

## Integration Notes

- Keep Customer Profiling-specific pages, API routers, services, fixtures, and styles inside `customer-profiling/`.
- Other modules may read Customer Profiling contracts for customer lookup prerequisites.
- Customer Profiling reads `/api/system-settings/locations` in the frontend and uses System Settings' internal `ensure_location_record` helper in the API to create or link minimal location records during customer create/update.
- Customer Profiling reads `/api/system-settings/avatars` in the frontend to resolve configured male/female customer avatars and emotion score display. Baseline mood is currently driven by customer lifecycle status.
- Customer Profiling reads `/api/system-settings/map-providers` in the frontend so the customer detail map preview and coordinate capture modal use the same shared tile providers as Network Settings.
- Customer Profiling links to Network Settings Serviceability Check by customer id only; Network Settings owns serviceability status calculation, NAP selection, and map display.
- Province, city, barangay, and coordinates are optional on customer saves so incomplete locations can be finished later in System Settings -> Location Management.
- Service Catalog/Order owns service assignment CRUD. Customer Profiling does not display or manage Service Orders.
- Integration Codex should read this file before changing Customer Profiling app-shell wiring.
- Only stable cross-project facts should be copied into the main `Project_Context.md`.

## Follow-Up Notes

- Stage 2 persistence is complete for customer profile records through shared PostgreSQL and the shared migration/versioning runner. Remaining production hardening: server-side customer draft persistence if needed, role/permission enforcement, backup/restore runbook, monitoring, and final cross-module lookup contracts.
- Document final customer lookup contracts for Billing, Customer Service Management, Ticketing, and Point of Sale.
