# Billing

Billing owns ISP subscriptions, invoice generation, adjustments, customer balances, billing cycles, and the accounting ledger for invoice payments.

Billing persists module records to the shared PostgreSQL database through the `billing_records` JSONB table when `DATABASE_URL` is configured. Financial posting operations use a cross-worker PostgreSQL transaction lock, native invoice/receipt sequences, database uniqueness constraints, and durable `billing_posting_events`. It falls back to in-memory state only when PostgreSQL is not configured.

- Frontend page/styles: `features/billing/web/`
- API router/state: `features/billing/api/billing/`
- API prefix: `/api/billing`

Current scope:

- Customer-linked subscriptions using Customer Profiling customer IDs
- Service-to-billing bridge that reads active Service Accounts, Service Orders, and Service Catalog plans from the Service module
- Service Account installation fee decision workflow before monthly subscription billing starts. Billing can charge a one-time installation invoice, record a promo/approved waiver, or record that no installation fee is required. The charge form defaults `Standard Installation Fee` and `Amount to Bill Customer` to PHP 1,500 when Service has no configured install fee, and both values are editable.
- Service Account selection and table-level `Start Billing` action to populate customer, plan, service reference, catalog snapshot, billing mode, billing start date, and catalog list price after the installation fee decision is resolved
- First-cycle prepaid proration for Service Account billing. When a prepaid Service Account starts mid-month, Billing automatically creates the first invoice for the activation/start date through the calendar month end, rounds the prorated amount up to the next whole peso, issues it due immediately, and moves the next invoice date to the first day of the next full month.
- First-cycle postpaid proration for Service Account billing. When a postpaid Service Account starts mid-month, Billing automatically creates the first invoice for the activation/start date through the calendar month end, charges only active days rounded up to the next whole peso, and moves the next invoice date to the first day of the next full month.
- Billing-owned searchable Promotions catalog for promo setup, date windows, discount type, payment condition, priority, billing-mode/customer/plan targeting, and audit-friendly promo codes. Promo Code is optional; Billing auto-generates an internal code when it is left blank. Monthly-service `EARLY_BIRD` promotions can be selected as prepaid or postpaid subscription qualifications, monthly-service `ANY_PAYMENT` promotions can be selected during payment when eligible, and installation-fee promos can calculate discounted or waived installation fee decisions.
- Early-bird discount handling for prepaid and postpaid subscriptions qualified for a selected promotion. Full monthly invoices keep the regular monthly amount but expose the promo-owned discounted payable amount within the eligible payment window; a qualifying payment posts a linked `PAYMENT_PROMOTION` credit adjustment.
- Catalog-controlled subscription pricing for Service-linked subscriptions, with explicit price override amount and reason when the billable price differs from Service Catalog
- Manual/legacy subscription entry for cases that do not yet have a Service Account
- Monthly prepaid and postpaid subscription modes
- Installation fee decision records with one-time invoice creation for charged fees
- Invoice creation, draft editing, immutable posting, voiding, line items, due dates, status derivation, service references, and duplicate-safe monthly subscription invoice generation
- Payment API ledger for invoice-level and customer-level payments. `POST /api/billing/payments` requires an `Idempotency-Key` header and accepts an optional `promotionId`; Billing validates eligibility at payment time and atomically posts the payment, linked promo adjustment, invoice state, and durable event. Customer-facing invoice payment posting is handled in Point of Sale -> Invoice Payments.
- Immutable posted adjustments with idempotent creation and reversal/void handling for invoice credits and debits
- Customer balance summary with outstanding, credit, overdue, open invoice counts, and Monthly Aging text that combines unpaid monthly invoice periods with expected-but-uninvoiced service periods
- Customer avatar behavior using System Settings `CustomerEmotionAvatar`; overdue balances and open invoices can push the visible mood toward warning or angry.

Financial posting integrity controls:

- PostgreSQL is reloaded as the source of truth at each read snapshot and before each mutation.
- Billing mutations serialize across API workers with a transaction-scoped advisory lock and commit all affected records and posting events together.
- Native PostgreSQL sequences issue non-reusable `INV-YYYYMM-######` and `OR-YYYYMM-######` numbers.
- Database indexes enforce unique document numbers, idempotency keys per record type, and one invoice per subscription billing-cycle start.
- Manual invoice, payment, and adjustment creation requires `Idempotency-Key`; a matching retry replays the original record and a mismatched retry returns HTTP 409.
- Posted invoices, payments, and adjustments cannot be edited. Recurring invoice corrections use credit/debit adjustments, installation invoices are reversed through their fee decision, and direct invoice void is limited to manual invoices. Payment/adjustment reversals and voided manual invoices remain visible with actor, timestamp, and reason metadata.
- Focused tests live in `features/billing/api/tests/test_financial_integrity.py` and run with `python3 -m unittest discover -s features/billing/api/tests -p 'test_*.py' -v`.

Demo Billing seed records are disabled by default. Set `BILLING_SEED_DEMO=true` only for disposable demo environments.
