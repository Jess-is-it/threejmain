# Billing

Billing owns ISP subscriptions, invoice generation, adjustments, customer balances, billing cycles, and the accounting ledger for invoice payments.

The first working module shell is in-memory and designed for the modular monolith. This branch keeps Billing self-contained; Integration Codex should wire it into `app-shell` later.

- Frontend page/styles: `features/billing/web/`
- API router/state: `features/billing/api/billing/`
- API prefix: `/api/billing`

Current scope:

- Customer-linked subscriptions using Customer Profiling customer IDs
- Service-to-billing bridge that reads active Service Accounts, Service Orders, and Service Catalog plans from the Service module
- Service Account selection and table-level `Start Billing` action to populate customer, plan, service reference, catalog snapshot, billing mode, billing start date, and catalog list price
- Catalog-controlled subscription pricing for Service-linked subscriptions, with explicit price override amount and reason when the billable price differs from Service Catalog
- Manual/legacy subscription entry for cases that do not yet have a Service Account
- Monthly prepaid and postpaid subscription modes
- Invoice CRUD with line items, due dates, status derivation, service references, and monthly subscription invoice generation
- Payment API ledger for invoice-level and customer-level payments. Customer-facing invoice payment posting is handled in Point of Sale -> Invoice Payments.
- Adjustment CRUD/voiding for invoice credits and debits
- Customer balance summary with outstanding, credit, overdue, and open invoice counts
- Customer avatar behavior using System Settings `CustomerEmotionAvatar`; overdue balances and open invoices can push the visible mood toward warning or angry.

Durable PostgreSQL tables should replace the in-memory lists before production use.
