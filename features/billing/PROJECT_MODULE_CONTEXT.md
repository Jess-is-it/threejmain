# Billing Module Context

## Purpose

Billing manages ISP monthly subscriptions, invoices, adjustments, balances, billing cycles, and collection-accounting records. Customer invoice payment intake is handled by Point of Sale.

## Module Layout

```text
billing/
  api/billing/__init__.py
  api/billing/router.py
  api/tests/test_financial_integrity.py
  web/BillingPage.jsx
  web/billing.css
  README.md
  module.json
  PROJECT_MODULE_CONTEXT.md
```

## Current Status

- Status from `module.json`: `functional-shell`
- API prefix: `/api/billing`
- Frontend entry point: `features/billing/web/BillingPage.jsx`
- Stylesheet: `features/billing/web/billing.css`
- Storage: shared PostgreSQL via the `billing_records` JSONB table when `BILLING_STORAGE=postgres` or `DATABASE_URL` is configured; falls back to in-memory only when PostgreSQL is not configured.
- Financial writes are transaction-safe across API workers. Each mutation acquires a PostgreSQL transaction advisory lock, reloads authoritative records, validates and mutates one coherent snapshot, and atomically commits all affected records plus durable `billing_posting_events`.
- Native PostgreSQL sequences produce invoice and receipt numbers. Database indexes enforce document-number uniqueness, idempotency-key uniqueness per record type, and one invoice per subscription billing-cycle start.
- `POST /api/billing/invoices`, `POST /api/billing/payments`, and `POST /api/billing/adjustments` require `Idempotency-Key`. Matching retries replay the original record; reusing a key for a different request returns HTTP 409. Subscription invoice generation accepts the header and is independently protected by the subscription-cycle uniqueness rule.
- Posted invoices, payments, and adjustments are immutable. Recurring invoice corrections use credit/debit adjustments, installation invoices are reversed through their fee decision, and direct invoice void is limited to manual invoices. Reversed records remain in the visible ledger with `voidedAt`, `voidedByUsername`, and `voidReason` rather than being soft-deleted.
- Demo billing seed data is disabled by default. Set `BILLING_SEED_DEMO=true` only in disposable demo environments.
- Frontend create/edit/post flows open in modals from each table card action; the tab tables no longer reserve a persistent side-panel form.
- Frontend success/error feedback uses a top-right popup toast with a manual close button and 5-second auto-dismiss; the Billing page should not render page-level inline alert banners for these notifications.
- The Billing page includes a Service To Billing bridge that reads active Service Accounts, Service Orders, and Service Catalog plans from `/api/service/*` endpoints.
- The Subscriptions tab shows recurring Service Accounts ready for billing. Service Account rows display the customer first/last name under the service account number, show `Resolve Fee` only while the installation fee decision is pending, and show only `Start Billing` after the fee is resolved.
- The Subscriptions tab has a local subscription search box and its `Service Accounts Ready For Billing` table should show only unbilled Service Accounts whose installation fee decision is already resolved.
- Billing displays unpaid monthly aging in Balances and Subscriptions. The unpaid-month count is based on open monthly service invoice periods only (`MONTHLY`, `FIRST_PRORATED`, `FIRST_FULL`); installation fees and manual invoices do not count as unpaid months.
- Billing displays unpaid monthly aging and missing invoice cycles together in a `Monthly Aging` column in Balances and Subscriptions. Unpaid months are open monthly service invoice periods; missing invoice cycles are active subscription cycles that should already have a monthly service invoice but do not have a non-void monthly invoice. Prepaid cycles become expected on the cycle start date; postpaid cycles become expected on the calendar month end.
- Billing owns promotion setup and rule enforcement through the searchable/filterable Promotions tab/API. Promo Code is optional on setup; Billing auto-generates an internal `PROMO-YYYYMM-####` code when left blank. Monthly-service promotions include a payment condition such as `ANY_PAYMENT` or `EARLY_BIRD`, plus priority for recommendation ordering. New promotion forms default to `ANY_PAYMENT` and list it first. POS can show and auto-select Billing-recommended eligible promotions at invoice payment time, but promo definition, targeting, and validation remain in Billing.

## CRUD Scope

- Subscriptions: create, list, update, soft delete/cancel, and generate monthly invoice
- Subscriptions can store `serviceAccountId`, `serviceAccountNumber`, `serviceOrderId`, `serviceId`, `catalogId`, catalog labels, list price, effective price, and pricing source from the Service module. A Service Account can only be linked to one non-cancelled Billing subscription.
- Service-linked subscriptions treat Service Catalog as the owner of plan name, billing mode, and list monthly rate. Billing stores the catalog snapshot and uses that price unless an explicit price override amount and reason are supplied.
- Installation Fees: record one-time new-installation charge decisions before monthly billing starts. Decisions can create a one-time installation invoice, record a promo/approved waiver, or record that no installation fee is required. Service Account monthly subscription creation is blocked until the installation fee decision is `INVOICED`, `WAIVED`, or `NO_FEE`. The decision modal labels the normal price as `Standard Installation Fee` and the invoiced value as `Amount to Bill Customer`; both default to PHP 1,500 when Service does not provide an install fee and remain editable.
- Service Account PREPAID subscription creation automatically creates the first prepaid invoice. If the service starts mid-month, the first invoice is `FIRST_PRORATED`, covers `startDate` through that calendar month end, is issued/due on `startDate`, charges `monthlyRate * activeDays / daysInMonth` rounded up to the next whole peso, and sets `nextInvoiceDate` to the first day of the next month for full prepaid billing.
- Service Account POSTPAID subscription creation automatically creates the first postpaid invoice. If the service starts mid-month, the first invoice is `FIRST_PRORATED`, covers `startDate` through that calendar month end, charges `monthlyRate * activeDays / daysInMonth` rounded up to the next whole peso, and sets `nextInvoiceDate` to the first day of the next month for full monthly billing.
- PREPAID and POSTPAID subscriptions can be marked qualified for a selected Early Bird promotion. The promotion, not the subscription, owns the discount amount and payment-window condition. Full monthly invoices carry the selected promo snapshot. For prepaid, payment must post before `billingCycleStart`; for postpaid, payment must post on or before the invoice `dueDate`. Billing recommends the matching promo during payment and posts the payment plus a linked `PAYMENT_PROMOTION` credit adjustment so the invoice becomes paid at the discounted amount.
- Promotions: create, list, search/filter, update, and archive Billing-owned promo rules. Promotions include optional code, name, scope (`MONTHLY_SERVICE`, `INSTALLATION_FEE`), discount type (`FIXED_AMOUNT`, `PERCENT`, `WAIVE`), payment condition (`EARLY_BIRD` or `ANY_PAYMENT` for monthly service), priority, date window, status, and optional billing-mode/customer/plan targeting. Billing auto-generates a code when the user leaves it blank. Active promotions can be offered at invoice payment time when they match the invoice, payment date, billing mode, customer, plan, and payment condition. Active monthly-service `EARLY_BIRD` promotions can be selected as prepaid or postpaid subscription qualifications, and active installation-fee promotions can calculate charged/waived installation fee decisions. Generated invoices and adjustments store promotion code/name snapshots for audit.
- Manual/legacy subscriptions with no Service Account remain editable for plan name and monthly rate.
- Editing an existing subscription keeps the customer and Service Account target fixed in the modal. Service Account selection is only shown when creating a new subscription.
- Invoices: create, list, update while `DRAFT`, controlled void, and derive status from due date/payments/adjustments. Issued/paid/overdue invoices are immutable. Direct void is limited to manual invoices; recurring corrections use adjustments, and installation invoice reversal belongs to the fee-decision workflow. Subscription cycle generation replays the existing invoice instead of creating a duplicate.
- Invoices generated or created from subscriptions carry service account, service order, catalog, pricing source, and service reference fields for traceability back to Service.
- Payments: API ledger only. `POST /api/billing/payments` with `Idempotency-Key` remains the canonical way to settle Billing invoices, but the Billing frontend no longer exposes a Payments tab. Posted receipts are immutable; customer invoice payment intake and receipt voiding belong in Point of Sale -> Invoice Payments.
- Adjustments: idempotent create, list, and void for invoice credits and debits. Posted and voided adjustments cannot be edited.
- Balances: customer balance summaries with invoiced total, paid total, outstanding balance, credit, overdue total, and open invoice count
- Balance summaries include `unpaidMonths`, `unpaidMonthlyInvoices`, `oldestUnpaidMonth`, `newestUnpaidMonth`, and `unpaidMonthlyBalance` for monthly service invoice aging.
- Balance and subscription summaries include month key arrays (`unpaidMonthKeys`, `missingBillingCycleKeys`) plus count/oldest/newest fields for compact Monthly Aging display such as `Unpaid 2 mo: Jul-Aug 2026` and `Missing 1 inv: Sep 2026`.
- Balance summaries prefer live Customer Profiling records, but fall back to the customer snapshot stored on Billing records so stale/missing Customer Profiling rows do not break Billing page loads.
- Customer-facing Billing tables display System Settings customer emotion avatars. Balance and invoice context can move the displayed mood toward warning or angry when balances are overdue or invoices remain open.

## Billing Rules In Current Shell

- Supports `PREPAID` and `POSTPAID` monthly subscriptions.
- Prepaid first-cycle Service Account invoices use actual-day proration rounded up to the next whole peso and are due immediately on the service start date. Example: a July 10, 2026 start bills July 10-31 as 22/31 of the monthly rate, then schedules the next full invoice for August 1-31.
- Prepaid generated monthly invoices are due at the start of the service cycle. Early-bird-qualified prepaid invoices expose the discounted payable amount until the day before the cycle starts.
- Postpaid generated monthly invoices issue at cycle end and are due at cycle end plus `dueDays`. Early-bird-qualified postpaid invoices expose the discounted payable amount through the invoice due date.
- Postpaid generated invoices use calendar-month cycles, issue at cycle end, and are due at cycle end plus the subscription `dueDays` value. Service Account postpaid starts default to `dueDays=0`, meaning due at month end.
- First-cycle Service Account postpaid invoices use actual-day proration rounded up to the next whole peso. Example: a July 9, 2026 start bills July 9-31 as 23/31 of the monthly rate, then schedules the next full invoice for August 1-31.
- Missing billing cycles are not counted as unpaid debt because no collectible invoice exists yet. They are shown as operational billing gaps so staff can run or repair invoice generation before collections work begins.
- Invoice totals are calculated from line items plus posted debit adjustments minus posted credit adjustments.
- Invoice paid/balance values are calculated from posted payments.
- Early-bird discounts are promotion-owned. Subscriptions only qualify for a selected monthly-service promotion whose payment condition is `EARLY_BIRD`; manual early-bird amounts are no longer created from the subscription form.
- Payment-time promotions are represented as posted credit adjustments with `adjustmentSource=PAYMENT_PROMOTION` linked to the payment receipt. `GET /api/billing/invoices/{invoice_id}/eligible-promotions` returns `recommendedPromotionId`; POS uses it to auto-select qualified Early Bird promos. `POST /api/billing/payments` may include `promotionId`; Billing revalidates eligibility and requires the payment amount to match the discounted payable amount, so the invoice closes through payment plus promo credit. Voiding that payment also voids the linked promo credit adjustment. Legacy `EARLY_BIRD_DISCOUNT` adjustments remain only as a fallback for old invoices without a promotion snapshot.
- Promo-backed early-bird discounts are revalidated when monthly invoices are generated. If the promotion is expired, paused, outside its date window, or no longer matches the subscription target, the future invoice does not carry the promo discount. Installation-fee promotions are validated when the fee decision is saved and snapshot to the fee decision/invoice.
- Voided invoices, payments, and adjustments remain persisted and visible for ledger history. Only `POSTED` payments and adjustments affect balances; `VOID` invoices are excluded from receivables.
- Installation fee decisions are persisted in PostgreSQL. `INVOICED` decisions create a one-time Billing invoice with an `Installation Fee` line item; `WAIVED` and `NO_FEE` decisions create no payable invoice but preserve the decision/reason for audit and reporting.
- Invoice payments posted from Point of Sale use Billing payment records with `collectionChannel=POS`, a stable `Idempotency-Key`, authenticated operator attribution, and transaction-safe invoice-balance validation.

## API Routes

- `GET /api/billing/meta`
- `GET /api/billing/readiness`
- `GET /api/billing/customers`
- `GET /api/billing/promotions`
- `POST /api/billing/promotions`
- `PATCH /api/billing/promotions/{promotion_id}`
- `DELETE /api/billing/promotions/{promotion_id}`
- `GET /api/billing/overview`
- `GET /api/billing/subscriptions`
- `POST /api/billing/subscriptions`
- `PATCH /api/billing/subscriptions/{subscription_id}`
- `DELETE /api/billing/subscriptions/{subscription_id}`
- `POST /api/billing/subscriptions/{subscription_id}/generate-invoice`
- `GET /api/billing/installation-charges`
- `POST /api/billing/installation-charges`
- `PATCH /api/billing/installation-charges/{charge_id}`
- `DELETE /api/billing/installation-charges/{charge_id}`
- `GET /api/billing/invoices`
- `POST /api/billing/invoices`
- `PATCH /api/billing/invoices/{invoice_id}`
- `DELETE /api/billing/invoices/{invoice_id}`
- `GET /api/billing/invoices/{invoice_id}/eligible-promotions?paymentDate=YYYY-MM-DD`
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

- Customer Profiling is the source of customer identity. Billing stores `customerId` and customer display snapshots in PostgreSQL billing records.
- Billing customer snapshots include `firstName`, `lastName`, and `gender` from Customer Profiling so Billing can display name-only customer labels and System Settings can resolve male/female avatar slots.
- Service is the source of service account, catalog, and order identity. Billing reads `GET /api/service/accounts?activeOnly=true`, `GET /api/service/orders?activeOnly=true`, and `GET /api/service/catalog?status=ACTIVE`.
- Billing subscription creation selects a Service Account to populate customer, plan name, service reference, catalog fields, monthly list price, billing start date, due-days default, and billing mode after the installation fee decision is resolved.
- Point of Sale owns the customer-facing invoice payment workspace. POS reads Billing invoices/payments and posts Billing payment records; Billing remains the accounting ledger and invoice owner.
- Integration must provide Billing with:
  - authenticated admin dependency
  - audit logger
  - customer resolver by ID
  - customer search/list function
  - optional customer seed function for local demo data

## Integration Notes

- This module intentionally does not wire itself into `app-shell`.
- Integration Codex should import `router`, `configure_billing`, `billing_metrics`, and `seed_billing_data` from `features/billing/api/billing`.
- The FastAPI router already uses `APIRouter(prefix="/api/billing", tags=["billing"])`.
- The React page expects the shell auth token in `localStorage.threejmain_token`, matching the current customer-profiling page pattern.
- The frontend should be routed by the shell to `/billing` when Integration Codex wires modules together.
- The Service module must expose active service accounts with `catalog`, `customer`, `serviceReference`, and activation/billing dates for best Billing prefill quality. Completed service orders are still kept as optional traceability events.

## Risks And Follow-Ups

- The compatibility store still persists record payloads as JSONB. Dedicated relational invoice-line, payment-allocation, and ledger-account tables remain the next scaling step.
- Customer snapshots can become stale if Customer Profiling data changes after Billing records are created.
- Payment allocation is simple and does not yet support overpayment allocation across multiple invoices.
- No tax, late fees, dunning notices, statement generation, or payment gateway integration yet.
- There is no persisted foreign-key enforcement yet between Billing subscriptions and Service Accounts because Service Account durability is still separate from Billing's JSONB record store.

## Verification

- Integrity tests: `python3 -m unittest discover -s features/billing/api/tests -p 'test_*.py' -v`
- The suite covers idempotent replay and key mismatch, concurrent overpayment prevention, duplicate subscription-cycle generation, posted-record immutability, reversal history, and in-memory rollback/audit suppression.
