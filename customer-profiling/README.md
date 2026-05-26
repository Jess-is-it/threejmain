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
- Secondary contact fields
- Bulk upload CSV modal with template download, client-side preview validation, duplicate checks, and guarded import

Current shell API route prefix:

```text
/api/customer-profiling
```

The current implementation is an in-memory FastAPI shell so the workflow is visible and testable while the durable PostgreSQL models are added.
