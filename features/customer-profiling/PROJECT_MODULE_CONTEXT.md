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
- Customer lifecycle status is system-owned in the UI: the create/edit customer modal no longer exposes manual Status selection, new customer creates start as `PENDING`, and Service Account lifecycle sync promotes/demotes status from Service (`ACTIVE`, `SUSPENDED`, `PENDING`, `INACTIVE`).
- New customer and bulk upload drafts are temporary browser-local records saved in `localStorage`; the Customer Drafts side panel uses click-to-select draft cards with check indicators, a Bulk Upload badge for upload drafts, Resume actions, Delete Selected, and Delete All with confirmation
- Customer service location selection backed by System Settings -> Location Management
- The create/edit Location stage uses Customer Location wording, a searchable saved-location picker, and one merged location/address panel for record, landmark, province, city, barangay, and address lines.
- The Location stage coordinate controls show Capture Coordinates only after a saved Customer Location is selected and show a Clear action whenever longitude/latitude values are present.
- Customer gender field (`MALE` / `FEMALE`) used by System Settings avatar selection.
- Customer table and detail drawer show System Settings customer emotion avatars through `CustomerEmotionAvatar`.
- Customer 360 is now the canonical customer detail experience. Opening a customer from the list, or opening `/customer-profiling?customerId=<customer id>`, hides the list and renders a full Customer Profiling-owned detail workspace with a compact customer header and responsive tabs.
- Customer 360 tabs are Overview, Subscriptions, Billing, Payments, Tickets, Equipment, and Activity. The interface displays Customer Profiling identity/contact/address data while reading live Service, Billing, POS, Ticketing, Inventory, and Logs data by stable ids; it does not persist copies of records owned by those modules.
- Customer Profiling overrides the app-shell desktop content container only when this module is active, using 100px left/right page gutters so the workspace sits closer to the left navigation while preserving responsive smaller gutters.
- Business customer profiles include a required `businessName` field on final save, and customer details show a compact coordinates map preview that opens Google Maps when clicked.
- Customer coordinate capture and detail preview maps use System Settings -> Maps provider settings through `features/system-settings/web/mapProviders.js`. The capture modal has a compact provider selector, honors the selected provider's max zoom, and creates provider sessions when a session-based provider such as Google Map Tiles is selected. Google Maps open-link and Street View remain external helpers.
- Customer table action badges include Check Serviceability, which navigates to `/network-settings/serviceability-check?customerId=<customer id>` so Network Settings opens the selected customer in its serviceability split view.
- Secondary contacts
- Bulk upload CSV workflow with a CSV-intake-only modal, inline collapsible icon guide above and outside the drag-and-drop area, drag-and-drop CSV upload, template download, and an Assess Import action that opens the full-page Review All Customers workspace. The page stages are Upload CSV, Review All Customers, and Upload Customers; Review/Upload now live outside the modal. The workflow includes preview validation, duplicate checks, KPI summaries, barangay/city location counts with an ALL filter and clickable location chips, required Barangay validation, footer Previous/Next controls, a close warning that can discard or save the upload into Customer Drafts with a Bulk Upload indicator, single-line per-customer fix rows with table-style icon edit/collapse buttons that expand the editable form, highlighted invalid fields, duplicate auto-delete while retaining the first entry, and a searchable/sortable final upload review grouped by barangay/city without per-row selection checkboxes. The bulk template/import flow excludes account number, customer type, business name, status, and recommender fields; account number/status are system-managed and business/referral details can be set after upload.
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
- Service Account lifecycle is the source for Customer Profiling customer status after profile creation. Customers with active service accounts become `ACTIVE`; suspended/reconnection-pending accounts can mark the customer `SUSPENDED`; pending installation stays `PENDING`; disconnected/terminated/cancelled-only accounts mark the customer `INACTIVE`.
- Customer 360 read dependencies currently used by the frontend:
  - `GET /api/service/accounts?customerId={customerId}`
  - `GET /api/service/orders?customerId={customerId}`
  - `GET /api/billing/subscriptions?customerId={customerId}`
  - `GET /api/billing/customers/{customerId}/balance`
  - `GET /api/billing/invoices?customerId={customerId}`
  - `GET /api/billing/payments?customerId={customerId}`
  - `GET /api/billing/adjustments?customerId={customerId}`
  - `GET /api/point-of-sale/sales` filtered client-side by `customerId`
  - `GET /api/ticketing/tickets?customerId={customerId}`
  - `GET /api/inventory/assignments` filtered client-side by `customerId`
  - `GET /api/logs` filtered client-side by `target_id`, `details.customerId`, or account number
- Integration Codex should read this file before changing Customer Profiling app-shell wiring.
- Only stable cross-project facts should be copied into the main `Project_Context.md`.

## Follow-Up Notes

- Stage 2 persistence is complete for customer profile records through shared PostgreSQL and the shared migration/versioning runner. Remaining production hardening: server-side customer draft persistence if needed, role/permission enforcement, backup/restore runbook, monitoring, and final cross-module lookup contracts.
- Remaining Customer 360 integration contracts for owning modules:
  - POS should add `GET /api/point-of-sale/sales?customerId={customerId}` and receipt view/download contracts when supported.
  - Inventory should add `GET /api/inventory/assignments?customerId={customerId}` so Customer 360 does not need to filter the full assignment list.
  - Billing should add payment receipt view/download endpoints when official receipt documents are supported outside Billing/POS.
  - Billing and Ticketing should support query-link contracts for opening invoice/subscription/ticket detail directly from Customer 360.
  - Customer Service Management does not currently expose a customer-filtered interaction contract for Customer 360; add it before care interactions are shown in Activity or a future Care tab.
