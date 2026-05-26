# Customer Profiling Module Context

## Purpose

Customer Profiling manages customer records, account identity, service addresses, contacts, account lifecycle, and bulk upload workflow.

## Current Status

- Status from `module.json`: `functional-shell`
- App-shell route target: `/customer-profiling`
- API prefix: `/api/customer-profiling`
- Frontend entry: `customer-profiling/web/CustomerProfilingPage.jsx`
- API entry: `customer-profiling/api/customer_profiling/router.py`

## Current CRUD Scope

- Customer overview KPIs
- Customer list with status tabs, responsive header search, sortable headers, per-user/per-status configurable visible columns covering customer detail fields, large rectangular badge-style action buttons, icon-only header controls, and collapsible filters
- Create, update, view, and soft archive customer profiles
- New customer modal is staged with Profile, Contact, Location, and Review steps; Contact shows stacked Primary Contact and Secondary Contact relative panels plus a form-population progress bar
- Customer profiles include optional birth date capture and review.
- New customer drafts are temporary browser-local records saved in `localStorage` and can be resumed or deleted from the Customer Drafts side panel
- Customer service location selection backed by System Settings -> Location Management
- The create/edit Location stage uses Customer Location wording, a searchable saved-location picker, and one merged location/address panel for record, landmark, province, city, barangay, and address lines.
- Customer gender field (`MALE` / `FEMALE`) used by System Settings avatar selection.
- Customer table and detail drawer show System Settings customer emotion avatars through `CustomerEmotionAvatar`.
- Customer detail drawer hides avatar mood labels, uses a larger avatar image, places account/status/type badges beside the customer name, and uses compact Customers-table-style Basic Info and Location tabs; contact fields and Secondary Contacts live under Basic Info.
- Customer detail view uses a desktop split side panel sized to about 25% of the workspace on larger screens and switches to a modal dialog on mobile widths.
- Customer Profiling overrides the app-shell desktop content container only when this module is active, using 100px left/right page gutters so the workspace sits closer to the left navigation while preserving responsive smaller gutters.
- Business customer profiles include a required `businessName` field on final save, and customer details show a compact coordinates map preview that opens Google Maps when clicked.
- Secondary contacts
- Bulk upload CSV modal with template download, preview validation, duplicate checks, and guarded import

## Integration Notes

- Keep Customer Profiling-specific pages, API routers, services, fixtures, and styles inside `customer-profiling/`.
- Other modules may read Customer Profiling contracts for customer lookup prerequisites.
- Customer Profiling reads `/api/system-settings/locations` in the frontend and uses System Settings' internal `ensure_location_record` helper in the API to create or link minimal location records during customer create/update.
- Customer Profiling reads `/api/system-settings/avatars` in the frontend to resolve configured male/female customer avatars and emotion score display. Baseline mood is currently driven by customer lifecycle status.
- Province, city, barangay, and coordinates are optional on customer saves so incomplete locations can be finished later in System Settings -> Location Management.
- Service Catalog/Order owns service assignment CRUD. Customer Profiling does not display or manage Service Orders.
- Integration Codex should read this file before changing Customer Profiling app-shell wiring.
- Only stable cross-project facts should be copied into the main `Project_Context.md`.

## Follow-Up Notes

- Replace in-memory state with shared PostgreSQL persistence before production.
- Document final customer lookup contracts for Billing, Customer Service Management, Ticketing, and Point of Sale.
