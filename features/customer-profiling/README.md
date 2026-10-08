# Customer Profiling

Customer Profiling owns ISP customer records, account identity, contact details, service addresses, account status, lifecycle notes, and bulk upload workflow.

The previous standalone React/Nest implementation has been folded into the modular monolith:

- Frontend: React + Vite + Tabler
- Backend: FastAPI
- Database target: shared PostgreSQL database

The shared shell exposes this module at `/customer-profiling`, but Customer Profiling-specific code is owned here:

```text
customer-profiling/
  web/
    CustomerProfilingPage.jsx
    customerProfiling.css
  api/
    customer_profiling/
      __init__.py
      router.py
```

Restored workflows from the previous standalone Customer Profiling module:

- Customer list with search, filter, sort-ready API shape, and pagination response metadata
- Customer overview KPIs for total, active, pending, suspended, Enrile count, municipalities, and barangays
- Customer create, edit, view, and soft archive actions
- Account number support with auto-generation when blank
- Customer type tracking and system-owned lifecycle status. New profiles start as `PENDING`; Service Account lifecycle syncs customer status to `ACTIVE`, `SUSPENDED`, `PENDING`, or `INACTIVE`.
- Customer gender tracking for System Settings male/female avatar selection
- Primary contact, alternate mobile, Facebook account/link, email, service address, and GPS fields
- Service location selector connected to System Settings -> Location Management, with manual customer locations added to Location Management when no saved record matches
- The create/edit Location stage uses dependent selects backed by a checked-in PSGC snapshot: Province is limited to Cagayan and Isabela, Cagayan defaults to Enrile, and City/Municipality controls the available Barangay values. The snapshot contains 29 Cagayan cities/municipalities with 820 barangays and 37 Isabela cities/municipalities with 1,055 barangays.
- Customer table and detail drawer display System Settings emotion avatars using the reusable `CustomerEmotionAvatar` component
- Customer 360 replaces the old compact detail drawer as the canonical customer inspection experience. Opening a customer from the list, or opening `/customer-profiling?customerId=<id>`, shows a full module-owned detail workspace with a compact identity header and tabs for Overview, Billing, Payments, Tickets, Equipment, and Activity.
- New customer creation returns to the customer list and opens the onboarding modal for the saved customer. The Pending list/KPI wording remains Needs Onboarding.
- Customer coordinate capture and detail map preview consume System Settings -> Maps provider settings, including Google Map Tiles session providers when configured, with Google Maps open-link and Street View retained as external helpers
- Customer table actions are View, Edit, and, while setup remains incomplete, Onboarding. The Onboarding icon includes live `completed/7` progress derived from existing Service, Billing, Ticketing, and Inventory records and is removed when all seven steps are complete; Check Serviceability and Archive are not row actions.
- Secondary contact fields
- Bulk upload CSV workflow with a CSV-intake-only modal, inline collapsible icon guide above and outside the drag-and-drop area, drag-and-drop CSV upload, template download, and an Assess Import action that opens the full-page Review All Customers workspace. The page stages are Upload CSV, Review All Customers, and Upload Customers; Review/Upload now live outside the modal. The workflow includes client-side preview validation, duplicate checks, KPI summaries, barangay/city location counts with an ALL filter and clickable location chips, required Barangay validation, footer Previous/Next controls, a close warning that can discard or save the upload into Customer Drafts with a Bulk Upload indicator, single-line per-customer fix rows with table-style icon edit/collapse buttons that expand the editable form, highlighted invalid fields, duplicate auto-delete while retaining the first entry, and a searchable/sortable final upload review grouped by barangay/city without per-row selection checkboxes. Bulk upload excludes system-managed/account setup fields such as account number, customer type, business name, status, and recommender fields; those are generated or edited inside the system after import.

Current shell API route prefix:

```text
/api/customer-profiling
```

## Customer 360

Customer Profiling owns the Customer 360 interface and customer identity fields only. It does not persist copies of records owned by other modules. The frontend reads current data from existing module APIs using stable identifiers such as `customerId`, `serviceAccountId`, `invoiceId`, and `paymentId`.

Customer 360 tabs:

- Overview: identity, account number, contact details, service/billing address, account status/standing, current Service Account and linked Billing subscription summary, current balance summary, and important customer/service/billing dates. Customers with multiple Service Accounts see every internet line here. The Service Account link opens that customer's details on `/service/account?customerId=<id>`.
- Billing: authoritative Billing balance, account credit, open/overdue invoices, recent invoices, rebates, credits, and adjustments.
- Payments: Billing payment history plus POS counter receipts filtered by customer id. Sensitive payment details are not displayed.
- Tickets: Ticketing open and historical tickets, including outage reference, category, status, assigned team/user, opened date, and resolution date.
- Equipment: Inventory asset assignments filtered to the customer, including serial number, item/model reference, status, assigned date, and service/ticket reference.
- Activity: read-only audit log events filtered by customer id/account number from Logs.

Read dependencies used by Customer 360:

```text
GET /api/customer-profiling/customers/{customerId}
GET /api/service/catalog?status=ACTIVE
GET /api/service/accounts?customerId={customerId}
GET /api/service/orders?customerId={customerId}
GET /api/billing/subscriptions?customerId={customerId}
GET /api/billing/installation-charges?customerId={customerId}
GET /api/billing/customers/{customerId}/balance
GET /api/billing/invoices?customerId={customerId}
GET /api/billing/payments?customerId={customerId}
GET /api/billing/adjustments?customerId={customerId}
GET /api/point-of-sale/sales
GET /api/ticketing/tickets?customerId={customerId}
GET /api/inventory/assignments
GET /api/logs
```

## New Customer Onboarding

The Onboarding action opens a large responsive workflow modal from the customer list. It is not a browser-only checklist: completion is derived from Customer Profiling, Service, Ticketing, Inventory, and Billing records. Previous and Next navigate between steps but never mark a step complete.

Step states are `Complete`, `Current`, `Waiting`, `Needs Attention`, `Blocked`, `Not Required`, `Not Started`, and `Permission Required`. Existing active subscriptions may satisfy legacy serviceability/activation gates as `Not Required`; new onboarding journeys must record the applicable verification before Billing actions become available.

Embedded actions retain owning-module authority:

- Customer Profile opens the existing Customer Profiling editor.
- Serviceability saves a Customer Profiling-owned manual disposition while a persisted Network Settings assessment contract is unavailable.
- Plan & Installation creates `POST /api/service/orders`; Service creates the linked Ticketing ticket.
- Installation Work updates the linked record through `PATCH /api/ticketing/tickets/{ticketId}`; Ticketing remains authoritative and synchronizes the Service Order lifecycle.
- Activation Verification records manual network-access and equipment checks only after an active Service Account exists.
- Billing Setup creates `POST /api/billing/installation-charges` and then `POST /api/billing/subscriptions`; Billing remains authoritative and generates the first invoice.

Customer Profiling persists only workflow attestations unavailable from owning modules:

```text
PATCH /api/customer-profiling/customers/{customerId}/onboarding-verifications/serviceability
PATCH /api/customer-profiling/customers/{customerId}/onboarding-verifications/network-equipment
```

Each attestation stores outcome, optional reference/notes, actor, and timestamp. A successful network/equipment verification requires both network access and equipment assignment checks. All other step status and references are read live from the owning modules and are not copied into Customer Profiling.

Remaining integration contracts:

- POS should expose a customer-filtered receipt/sales endpoint, such as `GET /api/point-of-sale/sales?customerId={customerId}`, plus receipt view/download when supported.
- Inventory should expose `GET /api/inventory/assignments?customerId={customerId}` instead of requiring Customer 360 to filter the full assignment list client-side.
- Billing should expose a payment receipt view/download endpoint if official receipt documents become downloadable outside Billing/POS.
- Billing should support a query-link contract for opening invoice/subscription detail directly from Customer 360, such as `/billing?tab=Invoices&invoiceId=<invoiceId>`.
- Ticketing should support a query-link contract for opening a specific ticket detail directly from Customer 360, such as `/ticketing?ticketId=<ticketId>`.
- Network Settings should expose a persisted customer serviceability assessment keyed by `customerId`, including outcome, NAP/port or topology reference, assessor, assessed timestamp, evidence, and review state. Once available, replace the Customer Profiling manual serviceability attestation with that authoritative read.
- Network/Account Access Management should expose customer/service-account provisioning readiness for PPPoE and ONU mapping. Inventory should expose authoritative customer/service-account equipment assignment. Once both are available, replace manual Activation Verification with derived reads.

## Importing Already-Installed Subscribers

Use **Import Existing Subscribers** for the initial cutover of live internet lines. Keep **Bulk Upload** for profile-only intake. Each migration Excel or CSV row is one installed line; multiple lines may link to one reviewed customer profile.

The downloadable `.xlsx` workbook includes Instructions, a Column Guide with every field's purpose/required status/format/example, an Active Promotions reference sheet, three sample rows, and dependent Province, City/Municipality, and Barangay dropdowns for Cagayan and Isabela. It omits system-owned `locationId` and `locationName`; the import sends address, latitude, and longitude to Location Management, which creates and links those values. It also omits `planName`. `monthlyRate` and `billingMode` form the imported plan reference, and review maps that rate to one current Service Catalog plan or a migration-only legacy plan. A single matching rate/mode is suggested automatically, while multiple matches require a choice. The importer accepts the workbook and retains CSV compatibility.

`lastPaymentAmount` never becomes a new receipt. When the amount is an exact multiple of `monthlyRate` and either `paymentCoverageFromMonth` or `lastPaidThroughMonth` is supplied, preview may infer the other boundary. Example: `2000 / 1000 = 2` months; if the paid-through month is `2026-07`, coverage is inferred as `2026-06` through `2026-07`.

Use `qualifiedPromotionCodes` for the Billing promotions the installed line should qualify for on future invoices; multiple codes are separated by semicolons. Use `lastPaymentPromotionCode` only to explain a promotion already applied to the imported last payment. Review maps imported codes to the current active Billing catalog or explicitly ignores them. If a PHP 1,000 line has a PHP 800 last payment and the mapped Early Bird rule gives PHP 200 off, the payment reconciles as one fully covered month and creates no PHP 200 residual. The historical payment remains reference evidence, historical arrears receive no imported promotion, and future invoices use Billing's normal promotion checks.

The file does not contain `billingDay` or `nextBillingDate`. Billing uses calendar-month rules. For a prepaid line, the base next cycle is the first day of the month after migration; for a postpaid line, it is the first day of the migration month so that month can be generated at month end. A later paid-through month moves the next cycle to the first day of the following month. Reconstructed unpaid months begin after the paid-through month and stop before that derived next cycle.

Rows with a supplied balance that differs from the month reconstruction require an explicit choice between monthly invoices and one audited opening balance. Rows can also be linked to a possible existing profile, skipped, retried, or resumed by batch ID. Successful import generates Customer and Service Account numbers, accepts historical installation as `Not Required`, and starts recurring Billing at the derived next billing date.

The assessment modal keeps review in three focused views: **Plan mapping**, **Promotions**, and **Subscriber review**. The Promotions view groups repeated imported codes and shows whether each code is used for future qualification, historical payment explanation, or both. Subscriber review starts with compact one-line records that show identity, rate, status, and any item requiring attention. Customer matching, legacy payment coverage, promotion reconciliation, balance resolution, warnings, and import results appear only when the operator opens that subscriber.

After **Import reviewed lines** returns, the review modal closes and a result dialog shows the imported and not-imported row counts. Failed, invalid, skipped, duplicate, or still-pending rows are counted as not imported, with row-level reasons shown in the dialog and the full result available as CSV. A persistent page notice lets the operator reopen the result after closing the dialog; partial batches can be reopened for review or retry.

The operator does not choose a billing cutover date. The server assigns one migration effective date to the batch when **Import reviewed lines** is first committed, using `BILLING_TIMEZONE` (`Asia/Manila` by default). Previewing or uploading the file does not finalize the date. Retries and resumed partial batches retain the original effective date.

```text
GET  /api/customer-profiling/customers/existing-subscriber-template
POST /api/customer-profiling/subscriber-migrations
GET  /api/customer-profiling/subscriber-migrations/{batchId}
POST /api/customer-profiling/subscriber-migrations/{batchId}/commit
GET  /api/customer-profiling/subscriber-migrations/{batchId}/result
```

## Real-Data Readiness

Customer Profiling Stage 2 persists customer records to the shared PostgreSQL database when these environment variables are active:

```text
CUSTOMER_PROFILING_STORAGE=postgres
DATABASE_URL=postgresql://...
```

The app-shell API startup migration runner creates and versions the `customer_profiles` table with migration `2026052601_customer_profiles`. Customer Profiling stores the full API payload in JSONB and maintains indexed columns for account number, status, type, location, contact number, and email. Demo seed customers are disabled by default; set `CUSTOMER_PROFILING_SEED_DEMO=true` only for disposable demo environments.

Readiness endpoint:

```text
GET /api/customer-profiling/readiness
```

Shared migration status endpoint:

```text
GET /api/system/database-migrations
```

Remaining production stages include role/permission enforcement, server-side draft storage if customer drafts must roam across devices, backup/restore runbooks, and final customer lookup contracts for dependent modules.

## Staging subscriber test-data reset

The Customer Profiling toolbar exposes **Reset test data** only when the API is running with both `APP_ENV=staging` and `APP_BRANCH=staging` and the signed-in user has the `owner` role. It is intended for repeat tests of Import Existing Subscribers. The API routes are:

```text
GET  /api/customer-profiling/staging-reset/availability
GET  /api/customer-profiling/staging-reset/preview
POST /api/customer-profiling/staging-reset
```

Preview lists the affected row counts, blockers, and a one-use token valid for five minutes. POST requires that token and the exact phrase `RESET STAGING SUBSCRIBERS`; the API rechecks the data before deletion. A full System Settings database/configuration backup plus related runtime records is written under `/app/data/subscriber-reset-backups/` before deletion. Override the directory with `STAGING_SUBSCRIBER_RESET_BACKUP_DIR` if needed. Backups contain sensitive settings and use mode `0600`; the API returns only the filename. Restore uses the System Settings full-backup workflow and should be reviewed before use.

The reset removes customer profiles, import batches/rows, Service accounts/orders and import-created legacy plans, non-promotion Billing records/posting events, Collector records, customer SMS logs, hotspot contact overrides/sync logs, and customer-linked in-memory Ticketing/Customer Service/Network records. It preserves reusable Service Catalog plans, Billing promotions, settings, access users, and locations. Customer-linked Inventory assignments or POS sales block the reset until stock and finance are reconciled. On successful reset, the browser clears Customer Profiling drafts stored on that device. External Pisowifi state is outside this local reset.
