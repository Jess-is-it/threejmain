# Billing

Billing owns ISP subscriptions, invoice generation, payment posting, adjustments, customer balances, billing cycles, and collection workflow surfaces.

The first working module shell is in-memory and designed for the modular monolith. This branch keeps Billing self-contained; Integration Codex should wire it into `app-shell` later.

- Frontend page/styles: `billing/web/`
- API router/state: `billing/api/billing/`
- API prefix: `/api/billing`

Current scope:

- Customer-linked subscriptions using Customer Profiling customer IDs
- Monthly prepaid and postpaid subscription modes
- Invoice CRUD with line items, due dates, status derivation, and monthly subscription invoice generation
- Payment CRUD/voiding for invoice-level and customer-level payments
- Adjustment CRUD/voiding for invoice credits and debits
- Customer balance summary with outstanding, credit, overdue, and open invoice counts

Durable PostgreSQL tables should replace the in-memory lists before production use.
