# Billing Module Context

## Purpose

Billing manages ISP monthly subscriptions, invoices, payments, adjustments, balances, billing cycles, and collection workflow surfaces.

## Module Layout

```text
billing/
  api/billing/__init__.py
  api/billing/router.py
  web/BillingPage.jsx
  web/billing.css
  README.md
  module.json
  PROJECT_MODULE_CONTEXT.md
```

## Current Status

- Status from `module.json`: `functional-shell`
- API prefix: `/api/billing`
- Frontend entry point: `billing/web/BillingPage.jsx`
- Stylesheet: `billing/web/billing.css`
- Storage: in-memory lists for the first working shell
- Persistence target: shared PostgreSQL tables in a later production-ready pass
- Frontend create/edit/post flows open in modals from each table card action; the tab tables no longer reserve a persistent side-panel form.
- The Billing page includes a Service To Billing bridge that reads active Service Accounts, Service Orders, and Service Catalog plans from `/api/service/*` endpoints.
- The Subscriptions tab shows recurring Service Accounts ready for billing with a table-level `Start Billing` button that pre-fills the subscription modal from Service Account/catalog data.

## CRUD Scope

- Subscriptions: create, list, update, soft delete/cancel, and generate monthly invoice
- Subscriptions can store `serviceAccountId`, `serviceAccountNumber`, `serviceOrderId`, `serviceId`, `catalogId`, catalog labels, list price, effective price, and pricing source from the Service module. A Service Account can only be linked to one non-cancelled Billing subscription.
- Service-linked subscriptions treat Service Catalog as the owner of plan name, billing mode, and list monthly rate. Billing stores the catalog snapshot and uses that price unless an explicit price override amount and reason are supplied.
- Manual/legacy subscriptions with no Service Account remain editable for plan name and monthly rate.
- Editing an existing subscription keeps the customer and Service Account target fixed in the modal. Service Account selection is only shown when creating a new subscription.
- Invoices: create, list, update, void, derive status from due date/payments/adjustments
- Invoices generated or created from subscriptions carry service account, service order, catalog, pricing source, and service reference fields for traceability back to Service.
- Payments: create, list, update, void; supports invoice-level and customer-level payments
- Adjustments: create, list, update, void; supports invoice credits and debits
- Balances: customer balance summaries with invoiced total, paid total, outstanding balance, credit, overdue total, and open invoice count
- Customer-facing Billing tables display System Settings customer emotion avatars. Balance and invoice context can move the displayed mood toward warning or angry when balances are overdue or invoices remain open.

## Billing Rules In Current Shell

- Supports `PREPAID` and `POSTPAID` monthly subscriptions.
- Prepaid generated invoices are due at the start of the service cycle.
- Postpaid generated invoices are due after the cycle using the subscription `dueDays` value.
- Invoice totals are calculated from line items plus posted debit adjustments minus posted credit adjustments.
- Invoice paid/balance values are calculated from posted payments.
- Voided invoices, payments, and adjustments are retained in memory but excluded from active totals.

## API Routes

- `GET /api/billing/meta`
- `GET /api/billing/customers`
- `GET /api/billing/overview`
- `GET /api/billing/subscriptions`
- `POST /api/billing/subscriptions`
- `PATCH /api/billing/subscriptions/{subscription_id}`
- `DELETE /api/billing/subscriptions/{subscription_id}`
- `POST /api/billing/subscriptions/{subscription_id}/generate-invoice`
- `GET /api/billing/invoices`
- `POST /api/billing/invoices`
- `PATCH /api/billing/invoices/{invoice_id}`
- `DELETE /api/billing/invoices/{invoice_id}`
- `GET /api/billing/payments`
- `POST /api/billing/payments`
- `PATCH /api/billing/payments/{payment_id}`
- `DELETE /api/billing/payments/{payment_id}`
- `GET /api/billing/adjustments`
- `POST /api/billing/adjustments`
- `PATCH /api/billing/adjustments/{adjustment_id}`
- `DELETE /api/billing/adjustments/{adjustment_id}`
- `GET /api/billing/balances`
- `GET /api/billing/customers/{customer_id}/balance`

## Dependencies

- Customer Profiling is the source of customer identity. Billing stores `customerId` and snapshots display fields for in-memory records.
- Billing customer snapshots include `gender` from Customer Profiling so male/female avatar slots resolve correctly.
- Service is the source of service account, catalog, and order identity. Billing reads `GET /api/service/accounts?activeOnly=true`, `GET /api/service/orders?activeOnly=true`, and `GET /api/service/catalog?status=ACTIVE`.
- Billing subscription creation selects a Service Account to populate customer, plan name, service reference, catalog fields, monthly list price, billing start date, due-days default, and billing mode.
- Integration must provide Billing with:
  - authenticated admin dependency
  - audit logger
  - customer resolver by ID
  - customer search/list function
  - optional customer seed function for local demo data

## Integration Notes

- This module intentionally does not wire itself into `app-shell`.
- Integration Codex should import `router`, `configure_billing`, `billing_metrics`, and `seed_billing_data` from `billing/api/billing`.
- The FastAPI router already uses `APIRouter(prefix="/api/billing", tags=["billing"])`.
- The React page expects the shell auth token in `localStorage.threejmain_token`, matching the current customer-profiling page pattern.
- The frontend should be routed by the shell to `/billing` when Integration Codex wires modules together.
- The Service module must expose active service accounts with `catalog`, `customer`, `serviceReference`, and activation/billing dates for best Billing prefill quality. Completed service orders are still kept as optional traceability events.

## Risks And Follow-Ups

- In-memory storage resets on API restart and is not safe for production.
- Customer snapshots can become stale if Customer Profiling data changes after Billing records are created.
- Invoice numbering is list-length based and should be replaced with durable sequence-backed numbering.
- Payment allocation is simple and does not yet support overpayment allocation across multiple invoices.
- No tax, discounts, late fees, dunning notices, statement generation, or payment gateway integration yet.
- PostgreSQL schema, migration, and data-access layer are required before production use.
- There is no persisted foreign-key enforcement yet between Billing subscriptions and Service Accounts because current Billing storage is in-memory.
