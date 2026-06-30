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
- Customer type and status tracking
- Customer gender tracking for System Settings male/female avatar selection
- Primary contact, alternate mobile, Facebook account/link, email, service address, and GPS fields
- Service location selector connected to System Settings -> Location Management, with manual customer locations added to Location Management when no saved record matches
- Customer table and detail drawer display System Settings emotion avatars using the reusable `CustomerEmotionAvatar` component
- Customer coordinate capture and detail map preview consume System Settings -> Maps provider settings, including Google Map Tiles session providers when configured, with Google Maps open-link and Street View retained as external helpers
- Customer table actions include Check Serviceability, which opens Network Settings -> Serviceability Check filtered to the selected customer
- Secondary contact fields
- Bulk upload CSV workflow with a CSV-intake-only modal, inline collapsible icon guide above and outside the drag-and-drop area, drag-and-drop CSV upload, template download, and an Assess Import action that opens the full-page Review All Customers workspace. The page stages are Upload CSV, Review All Customers, and Upload Customers; Review/Upload now live outside the modal. The workflow includes client-side preview validation, duplicate checks, KPI summaries, barangay/city location counts with an ALL filter and clickable location chips, required Barangay validation, footer Previous/Next controls, a close warning that can discard or save the upload into Customer Drafts with a Bulk Upload indicator, single-line per-customer fix rows with table-style icon edit/collapse buttons that expand the editable form, highlighted invalid fields, duplicate auto-delete while retaining the first entry, and a searchable/sortable final upload review grouped by barangay/city without per-row selection checkboxes. Bulk upload excludes system-managed/account setup fields such as account number, customer type, business name, status, and recommender fields; those are generated or edited inside the system after import.

Current shell API route prefix:

```text
/api/customer-profiling
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
