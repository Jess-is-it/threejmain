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
- Customer service location selection is backed by the reusable manual rows from System Settings -> Location Management.
- The create/edit Location stage uses Customer Location wording, a searchable saved-location picker, and one merged location/address panel for record, landmark, province, city, barangay, and address lines. Province, City/Municipality, and Barangay are dependent selects: province is limited to Cagayan/Isabela, Cagayan defaults to Enrile, and each city loads its PSGC barangays from `api/customer_profiling/cagayan_isabela_locations.json` (29/820 for Cagayan and 37/1,055 for Isabela).
- The Location stage coordinate controls show Capture Coordinates only after a saved Customer Location is selected and show a Clear action whenever longitude/latitude values are present.
- Customer gender field (`MALE` / `FEMALE`) used by System Settings avatar selection.
- Customer table and detail drawer show System Settings customer emotion avatars through `CustomerEmotionAvatar`.
- Customer 360 is now the canonical customer detail experience. Opening a customer from the list, or opening `/customer-profiling?customerId=<customer id>`, hides the list and renders a full Customer Profiling-owned detail workspace with a compact customer header and responsive tabs.
- Customer 360 tabs are Overview, Billing, Payments, Tickets, Equipment, and Activity. Overview shows the current Service Account with its matching Billing subscription, lists every internet line when a customer has multiple Service Accounts, and links to `/service/account?customerId=<id>` for Service-owned details. Old `?tab=subscriptions` links fall back to Overview. The interface displays Customer Profiling identity/contact/address data while reading live Service, Billing, POS, Ticketing, Inventory, and Logs data by stable ids; it does not persist copies of records owned by those modules.
- Onboarding is launched from the customer list as a large responsive modal instead of a Customer 360 tab. New customer save returns to the list and opens this modal; the customer list and KPI label `PENDING` records as Needs Onboarding.
- New-customer onboarding is a resumable seven-step wizard: Customer Profile, Serviceability, Plan & Installation, Installation Work, Activation Verification, Billing Setup, and Onboarding Complete. Previous/Next only navigate; `customer360ViewModel.js` derives completion, blockers, current step, permission failures, and legacy `Not Required` states from authoritative module records.
- Onboarding embeds owning-module actions without copying their records: create a Service `NEW_INSTALLATION` order and linked ticket, update the linked Ticketing record, create the Billing installation-fee decision, and create the recurring Billing subscription/first invoice.
- Customer Profiling owns two temporary manual workflow attestations stored in customer JSONB under `onboardingVerifications`: `serviceability` and `networkEquipment`. `PATCH /api/customer-profiling/customers/{customerId}/onboarding-verifications/{step}` records outcome, reference, notes, actor, and timestamp. `NETWORK_EQUIPMENT=VERIFIED` requires both network-access and equipment-assignment checks.
- Customer Profiling overrides the app-shell desktop content container only when this module is active, using 100px left/right page gutters so the workspace sits closer to the left navigation while preserving responsive smaller gutters.
- Business customer profiles include a required `businessName` field on final save, and customer details show a compact coordinates map preview that opens Google Maps when clicked.
- Customer coordinate capture and detail preview maps use System Settings -> Maps provider settings through `features/system-settings/web/mapProviders.js`. The capture modal has a compact provider selector, honors the selected provider's max zoom, and creates provider sessions when a session-based provider such as Google Map Tiles is selected. Google Maps open-link and Street View remain external helpers.
- Customer table action badges are View, Edit, and, for incomplete setup, Onboarding. The Onboarding action displays live `completed/7` progress by scoping existing Service, Billing, Ticketing, and Inventory records to each stable customer id, then disappears once all seven steps are complete. Check Serviceability and Archive are not table row actions.
- Secondary contacts
- Bulk upload CSV workflow with a CSV-intake-only modal, inline collapsible icon guide above and outside the drag-and-drop area, drag-and-drop CSV upload, template download, and an Assess Import action that opens the full-page Review All Customers workspace. The page stages are Upload CSV, Review All Customers, and Upload Customers; Review/Upload now live outside the modal. The workflow includes preview validation, duplicate checks, KPI summaries, barangay/city location counts with an ALL filter and clickable location chips, required Barangay validation, footer Previous/Next controls, a close warning that can discard or save the upload into Customer Drafts with a Bulk Upload indicator, single-line per-customer fix rows with table-style icon edit/collapse buttons that expand the editable form, highlighted invalid fields, duplicate auto-delete while retaining the first entry, and a searchable/sortable final upload review grouped by barangay/city without per-row selection checkboxes. The bulk template/import flow excludes account number, customer type, business name, status, and recommender fields; account number/status are system-managed and business/referral details can be set after upload.
- `/api/customer-profiling/readiness` reports whether Customer Profiling is using PostgreSQL storage and lists remaining production-hardening stages.

## Integration Notes

- Keep Customer Profiling-specific pages, API routers, services, fixtures, and styles inside `customer-profiling/`.
- Other modules may read Customer Profiling contracts for customer lookup prerequisites.
- Customer Profiling reads `/api/system-settings/locations` for reusable saved-location selection. During customer create/update, System Settings' internal `ensure_location_record` helper retains a selected manual location, reuses an exact address match, or creates a new persisted manual location before the customer is saved.
- API startup performs a once-per-process backfill of current non-archived customer addresses into the manual location catalog and saves each resolved `locationId`/`locationName` link on the customer record. Customers without location details remain unlinked until an address is supplied.
- Customer Profiling reads `/api/system-settings/avatars` in the frontend to resolve configured male/female customer avatars and emotion score display. Baseline mood is currently driven by customer lifecycle status.
- Customer Profiling reads `/api/system-settings/map-providers` in the frontend so the customer detail map preview and coordinate capture modal use the same shared tile providers as Network Settings.
- Customer Profiling links to Network Settings Serviceability Check by customer id only; Network Settings owns serviceability status calculation, NAP selection, and map display.
- Province, city, barangay, and coordinates are optional on customer saves so incomplete locations can be finished later in System Settings -> Location Management.
- Service Catalog/Order owns service assignment CRUD. Customer Profiling does not display or manage Service Orders.
- Service Account lifecycle is the source for Customer Profiling customer status after profile creation. Customers with active service accounts become `ACTIVE`; suspended/reconnection-pending accounts can mark the customer `SUSPENDED`; pending installation stays `PENDING`; disconnected/terminated/cancelled-only accounts mark the customer `INACTIVE`.
- Customer 360 read dependencies currently used by the frontend:
  - `GET /api/service/accounts?customerId={customerId}`
  - `GET /api/service/orders?customerId={customerId}`
  - `GET /api/service/catalog?status=ACTIVE`
  - `GET /api/billing/subscriptions?customerId={customerId}`
  - `GET /api/billing/installation-charges?customerId={customerId}`
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

## Existing Subscriber Migration

- Customer Profiling now exposes a separate `Import Existing Subscribers` workflow. The ordinary profile-only Bulk Upload is unchanged.
- Each Excel or CSV row represents one already-installed internet line. The template endpoint `GET /api/customer-profiling/customers/existing-subscriber-template` returns the external profile/address fields plus latitude/longitude, monthly rate, billing mode, service start/status, last-payment coverage, paid-through month, outstanding balance, balance-as-of date, semicolon-separated `qualifiedPromotionCodes`, and one `lastPaymentPromotionCode`. It excludes system-owned `locationId`/`locationName`, unavailable `planName`, and derived `billingDay`/`nextBillingDate`. The browser generates an uploadable `.xlsx` workbook with Instructions, a Column Guide covering purpose/required status/format/example for all 30 upload fields, an Active Promotions sheet, three sample rows, dependent Cagayan/Isabela Province, City/Municipality, and Barangay dropdowns, and a last-payment promotion dropdown; CSV upload remains supported.
- Preview and commit endpoints are `POST /api/customer-profiling/subscriber-migrations`, `GET /api/customer-profiling/subscriber-migrations/{batchId}`, `POST /api/customer-profiling/subscriber-migrations/{batchId}/commit`, and `GET /api/customer-profiling/subscriber-migrations/{batchId}/result`.
- Preview classifies possible profile duplicates, groups imported lines by `monthlyRate + billingMode` for Service Catalog mapping, groups imported promotion codes for one-time mapping to Billing's active automatic monthly-service catalog, derives the calendar-month billing schedule from billing mode/effective date/paid-through month, reconstructs unpaid months before that derived cycle, and flags balance variance or insufficient history for an opening-balance decision. A single active catalog match for the rate/mode is suggested automatically; multiple matches stay in review. Prepaid starts from the first day of the next month; postpaid starts from the first day of the effective-date month; a later paid-through month advances either mode to the following month.
- The assessment modal separates Plan mapping, Promotions, and Subscriber review. Promotion mappings distinguish future subscription qualification from a promotion that explains the legacy last-payment amount. Subscriber rows are collapsed by default and expose only identity, rate, status, and an attention marker; customer matching, legacy payment coverage, promotion reconciliation, balance resolution, warnings, and result identifiers appear when one row is opened.
- Paid-through coverage remains authoritative for the historical boundary. When a mapped promotion explains a discounted payment, preview reconciles against the discounted monthly amount. For example, PHP 800 reconciles one PHP 1,000 month under a PHP 200 Early Bird discount without creating a PHP 200 residual. Commit sends the future qualified promotion IDs and the historical payment-promotion evidence separately; reconstructed arrears stay promotion-free and future invoices use Billing's normal validation.
- PostgreSQL tables `subscriber_migration_batches` and `subscriber_migration_rows` keep batch state, row checkpoints, errors, results, and a line fingerprint. Completed rows replay safely and result CSV includes generated Customer/Service/Billing identifiers.
- After a reviewed import commits, the review modal closes and a result dialog plus persistent page notice show imported versus not-imported row counts. The result dialog lists row-level reasons for failed, invalid, skipped, duplicate, or pending lines, supports result CSV download, and can reopen the batch for review or retry.
- The result dialog now performs a read-only post-import reconciliation through batch-scoped Customer Profiling, Service, and Billing endpoints. `GET /api/customer-profiling/subscriber-migrations/{batchId}/current-customers` resolves current profile status for the imported customer IDs in one read. The report verifies linked Customer/Service/Billing IDs, current profile existence, service status, rates, billing mode, legacy payment evidence, imported invoices, duplicate cycles, and ledger totals; source balance variance stays visible for review. It reports historical source balance with its sheet as-of date separately from the live Billing balance, paid-through month, next open invoice due date, and next cycle, with Recheck and CSV download. A later auto-generated invoice may change the live balance without invalidating the source snapshot. Reconciliation failures are explicit rather than silently counted as verified.
- Customer 360 Overview labels Billing's `nextInvoiceDate` as the **next invoice cycle**, shows paid-through coverage and the next open invoice due date separately, and keeps the current amount due sourced from Billing's ledger.
- Commit generates Customer account numbers, links or updates an explicitly selected existing profile when requested, calls Service to create the installed Service Account without an installation order, and calls Billing for cutover. The server assigns the batch effective date on the first commit using `BILLING_TIMEZONE` (`Asia/Manila` by default); the operator does not select it, and retries keep the original date. Customer JSONB records `migration.existingSubscriber=true`; Customer 360 marks Plan & Installation and Installation Work `Not Required` when the migrated Service/Billing records exist.
- Customer 360 Payments reads `GET /api/billing/migration-payment-evidence?customerId={customerId}` and displays legacy payment evidence separately from current receipts.

## Follow-Up Notes

- Stage 2 persistence is complete for customer profile records through shared PostgreSQL and the shared migration/versioning runner. Remaining production hardening: server-side customer draft persistence if needed, role/permission enforcement, backup/restore runbook, monitoring, and final cross-module lookup contracts.
- Remaining Customer 360 integration contracts for owning modules:
  - POS should add `GET /api/point-of-sale/sales?customerId={customerId}` and receipt view/download contracts when supported.
  - Inventory should add `GET /api/inventory/assignments?customerId={customerId}` so Customer 360 does not need to filter the full assignment list.
  - Billing should add payment receipt view/download endpoints when official receipt documents are supported outside Billing/POS.
  - Billing and Ticketing should support query-link contracts for opening invoice/subscription/ticket detail directly from Customer 360.
  - Customer Service Management does not currently expose a customer-filtered interaction contract for Customer 360; add it before care interactions are shown in Activity or a future Care tab.
  - Network Settings must expose a persisted serviceability assessment keyed by `customerId` with disposition, assessor/timestamp, evidence, topology/NAP/port reference, and review status. Replace the manual Customer Profiling serviceability attestation when this exists.
  - Network/Account Access Management must expose service-account PPPoE/ONU provisioning readiness, and Inventory must expose customer/service-account equipment assignment. Replace manual network/equipment activation verification when both authoritative reads exist.
