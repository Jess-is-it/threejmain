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
- `POST /api/billing/payments` accepts either the legacy single `invoiceId` receipt shape or an `allocations` array for one customer payment applied across multiple invoices, plus optional `advanceAmount`. Allocation rows may carry an ordered `promotionIds` bundle and optional `promotionQuoteDate`/`promotionQuoteFingerprint`; singular `promotionId` remains backward compatible. Billing validates each allocation, quote fingerprint, and combined promotion payable against the current invoice balance and requires allocation total plus advance total to equal the receipt amount. Advance is accepted only after every current invoice is fully settled by its allocation plus any validated promotion credit, so promoted payoff and excess advance may coexist on one receipt.
- Advance value remains on the immutable source payment, and customer rebate value remains on the immutable source adjustment. Separate `credit_application` records consume both types of available credit FIFO when a monthly invoice is generated; those rows contribute to invoice paid/balance status without creating a second cash receipt. A source payment or adjustment whose credit has been applied cannot be voided.
- Posted invoices, payments, and adjustments are immutable. Recurring invoice corrections use credit/debit adjustments, installation invoices are reversed through their fee decision, and direct invoice void is limited to manual invoices. Reversed records remain in the visible ledger with `voidedAt`, `voidedByUsername`, and `voidReason` rather than being soft-deleted.
- Demo billing seed data is disabled by default. Set `BILLING_SEED_DEMO=true` only in disposable demo environments.
- The API lifecycle starts a durable automatic biller by default. It polls every 300 seconds, uses `Asia/Manila` as the default business timezone, generates prepaid cycles seven days before cycle start, generates postpaid cycles at calendar-month close, records the actual generation business date as each invoice `issueDate`, and catches up overdue cycles in chronological order without creating due dates before issuance.
- Billing runs persist as `billing_run` records in the shared Billing store. A daily automatic run has one stable idempotency key, each invoice keeps the existing subscription/cycle key, and PostgreSQL advisory locking plus cycle uniqueness prevents duplicate invoices across workers.
- The Billing Runs tab shows the due-cycle preview, estimated value, scheduler state, manual run action, run history, and item-level created/replayed/failed outcomes.
- Every newly issued invoice stores a versioned `accountSummaryAtIssue` snapshot. It includes capture/as-of timestamps, prior open invoice references and balances, payment/credit/debit activity since the previous invoice, current invoice totals, and `totalAccountAmountDue`. The snapshot is written once after available account credit is applied and remains unchanged after later ledger activity. Legacy invoices without the field are returned and rendered normally without reconstructing historical data.
- Frontend create/edit/post flows open in modals from each table card action; the tab tables no longer reserve a persistent side-panel form.
- Frontend success/error feedback uses a top-right popup toast with a manual close button and 5-second auto-dismiss; the Billing page should not render page-level inline alert banners for these notifications.
- The Billing Overview is a Finance management dashboard controlled by one billing month and as-of date. Its scorecard uses the collection report for selected-month net billed, cash collected, and cash collection rate plus as-of all-open and overdue A/R, replacing the former mixed-time Active Subscriptions, Open Invoices, Overdue, MRR, Collections, and Outstanding cards.
- The Overview contains summary-only Monthly Collection Performance and a Billing Control Center. The control center shows scheduler state/last pass, due cycles, schedule exceptions, latest-run failures, posting reconciliation, and compact clickable counts for `Installation Fee Pending`, `Ready for Monthly Billing`, missing invoice cycles, and accounts requiring follow-up. No customer-level table or A/R aging panel remains on Overview; all-open and overdue A/R totals stay in the scorecard and Collections summary.
- Selecting either Billing setup count opens the Subscriptions tab with the matching Billing Setup Queue filter. Pending rows expose `Resolve Fee`; resolved but unbilled rows expose `Start Billing`. Service Account rows display the customer first/last name under the service account number.
- The Subscriptions tab owns the detailed Billing Setup Queue and the separate local subscription search box.
- Billing displays unpaid monthly aging in Balances and Subscriptions. The unpaid-month count is based on open monthly service invoice periods only (`MONTHLY`, `FIRST_PRORATED`, `FIRST_FULL`); installation fees and manual invoices do not count as unpaid months.
- Billing displays unpaid monthly aging and missing invoice cycles together in a `Monthly Aging` column in Balances and Subscriptions. Unpaid months are open monthly service invoice periods; missing invoice cycles are active subscription cycles that should already have a monthly service invoice but do not have a non-void monthly invoice. Prepaid cycles become expected on the cycle start date; postpaid cycles become expected on the calendar month end.
- `GET /api/billing/collection-performance` supports billing month, as-of date, status, search, and server-side pagination. Its monthly-service cohort excludes draft/void, installation, and manual invoices; groups multiple service invoices under one billed customer; and returns fully paid, partially paid, and unpaid counts plus subscriber settlement and cash collection rates. Cash includes only posted receipt allocations. Direct invoice credits, applied account credits, and rebates are disclosed separately and can settle a subscriber without increasing cash collection. Posting-date cutoffs prevent backdated receipts from rewriting prior as-of snapshots, and the response includes a reconciliation variance.
- The report also returns a separate `receivables` projection across every active open invoice as of the selected date: open and overdue amount, invoice/customer counts, oldest days overdue, and `Current`, `1-30`, `31-60`, `61-90`, and `90+` aging buckets. Each bucket includes amount, invoice count, and unique customer count.
- The dedicated Collections tab is operationally scoped to all active open receivables as of its own reporting date, not to the Overview's selected-month cohort. It defaults to `billingPeriod=ALL` and `ACTION_REQUIRED`, retaining prior-month arrears until closed. `ACTION_REQUIRED` is overdue-only: a customer enters follow-up when at least one remaining invoice has `dueDate < asOfDate`. Current partially paid invoices remain available through `PARTIALLY_PAID` and `ALL_OPEN` without triggering early collection. Staff can optionally filter by invoice billing period and `ALL_OPEN`, `ACTION_REQUIRED`, compatibility `OVERDUE`, `PARTIALLY_PAID`, or `UNPAID`; search and pagination are server-side. The UI omits the redundant Overdue button because it currently matches Needs Follow-up. Rows group invoices by customer, rank action-required/oldest overdue accounts first, and show open/overdue balance, invoice periods, and last payment.
- Collection account detail is loaded separately and exposes every in-scope open invoice with invoice ID/number, billing period, service reference, issue/due dates, days overdue, net billed value, cash/account-credit settlement, rebates, balance, and invoice View/PDF actions. The row and detail APIs reconstruct historical as-of balances from invoice, payment, adjustment, and credit-application posting dates.
- Billing collection follow-up SMS uses the Customer Profiling mobile number resolved server-side. App-shell injects System Settings `send_a2p_sms_message`; Billing sends editable messages with sender ID `3J BILL`, purpose `BILLING_COLLECTION_FOLLOW_UP`, and customer/account/as-of/balance/invoice request context. System Settings persists A2P success/failure logs and notifications; Billing records a success audit event. No destination override is accepted from the browser.
- Billing owns promotion setup and rule enforcement through the searchable/filterable Promotions tab/API. Promo Code is optional on setup; Billing auto-generates an internal `PROMO-YYYYMM-####` code when left blank. Promotion definitions are generic and no longer expose customer or plan targets. Monthly-service promotions include `ANY_PAYMENT` or `EARLY_BIRD`, priority, optional billing mode, and a stackable flag. New forms default to `ANY_PAYMENT` and list it first. Customer eligibility is assigned through a subscription's `qualifiedPromotionIds`.

## CRUD Scope

- Subscriptions: create, list, update, soft delete/cancel, and generate monthly invoice
- Billing Runs: preview due cycles, list/get durable runs, manually trigger an idempotent run, automatically run from the API lifecycle, catch up missed cycles, and retain item-level failures for operations review.
- Subscriptions can store `serviceAccountId`, `serviceAccountNumber`, `serviceOrderId`, `serviceId`, `catalogId`, catalog labels, list price, effective price, and pricing source from the Service module. A Service Account can only be linked to one non-cancelled Billing subscription.
- Service-linked subscriptions treat Service Catalog as the owner of plan name, billing mode, and list monthly rate. Billing stores the catalog snapshot and uses that price unless an explicit price override amount and reason are supplied.
- Installation Fees: record one-time new-installation charge decisions before monthly billing starts. Decisions can create a one-time installation invoice, record a promo/approved waiver, or record that no installation fee is required. Service Account monthly subscription creation is blocked until the installation fee decision is `INVOICED`, `WAIVED`, or `NO_FEE`. The decision modal labels the normal price as `Standard Installation Fee` and the invoiced value as `Amount to Bill Customer`; both default to PHP 1,500 when Service does not provide an install fee and remain editable.
- Service Account PREPAID subscription creation automatically creates the first prepaid invoice. If the service starts mid-month, the first invoice is `FIRST_PRORATED`, covers `startDate` through that calendar month end, uses the generation business date as `issueDate`, is due on the later of service start or issue date, charges `monthlyRate * activeDays / daysInMonth` rounded up to the next whole peso, and sets `nextInvoiceDate` to the first day of the next month for full prepaid billing.
- Service Account POSTPAID subscription creation automatically creates the first postpaid invoice. If the service starts mid-month, the first invoice is `FIRST_PRORATED`, covers `startDate` through that calendar month end, uses the generation business date as `issueDate`, is due from the later of period close or issue date plus `dueDays`, charges `monthlyRate * activeDays / daysInMonth` rounded up to the next whole peso, and sets `nextInvoiceDate` to the first day of the next month for full monthly billing.
- PREPAID and POSTPAID subscriptions store ordered `qualifiedPromotionIds` and immutable qualification snapshots. Staff can select several active monthly-service promotions, such as Early Bird plus loyalty, only when every selected promotion is marked stackable. Full monthly invoices snapshot all still-valid qualified rules. For Early Bird, prepaid payment must post before `billingCycleStart` and postpaid payment must post on or before the invoice due date.
- Promotions: create, list, search/filter, update, and archive generic Billing-owned rules. Rules include optional code, name, scope (`MONTHLY_SERVICE`, `INSTALLATION_FEE`), discount type (`FIXED_AMOUNT`, `PERCENT`, `WAIVE`), payment condition, priority, date window, status, optional billing mode, approval requirement, and stackable policy. Customer/plan targets are cleared by the API and are not shown in create/edit. Monthly payment eligibility comes only from the invoice's subscription-qualified promotion snapshot; unqualified global monthly promotions are not offered.
- Manual/legacy subscriptions with no Service Account remain editable for plan name and monthly rate.
- Editing an existing subscription keeps the customer and Service Account target fixed in the modal. Service Account selection is only shown when creating a new subscription.
- Invoices: create, list, update while `DRAFT`, controlled void, and derive status from due date/payments/adjustments. Issued/paid/overdue invoices are immutable. Direct void is limited to manual invoices; recurring corrections use adjustments, and installation invoice reversal belongs to the fee-decision workflow. Subscription cycle generation replays the existing invoice instead of creating a duplicate. The Invoices tab filters the loaded ledger instantly by customer name, account/contact details, invoice number, billing period, service references, billing mode, invoice type, or status; multi-word searches require every term to match.
- The Invoices ledger intentionally shows only customer, billing period, balance, and View/PDF actions. It paginates the loaded ledger at 20 rows by default with 10/20/50-row choices, range/page feedback, previous/next navigation, search reset, and page clamping after data changes. This is presentation-only so the existing `GET /api/billing/invoices` array contract remains compatible with Billing rebate and arrears calculations, POS, Collector, and Customer Profiling. View loads `GET /api/billing/invoices/{invoice_id}` and shows customer/service references, invoice dates/type/status, a concise Account Summary at Issue containing only `Total Account Amount Due`, Previous Unpaid Invoices, current Charges, posted and void financial activity, current-invoice totals, early-bird terms, notes, and void metadata. Detailed snapshot activity remains in the API contract but is not repeated in the document. Draft editing and eligible manual voiding remain available from the detail modal rather than adding columns to the ledger.
- Every manual and generated invoice uses `billingCycleStart` and `billingCycleEnd` as its authoritative coverage. Invoice summaries derive `billingPeriodMonth` (`YYYY-MM`) and `billingPeriodLabel` (for example, `July 2026`; cross-month manual coverage uses a month range). The compact Invoices ledger, invoice detail, and PDF statement use that billing-period projection.
- Monthly service charge descriptions end with the customer-facing billing period, for example `(August 2026)`, rather than an internal service ID. New monthly invoices persist the period label. For legacy posted monthly invoices whose description ends in `(serviceId)` or `- serviceId`, the API detail/PDF projection removes that suffix and adds the derived billing period without mutating the stored line item. Service identifiers remain available in structured service fields.
- `GET /api/billing/invoices/{invoice_id}/pdf` renders a dependency-free, paginated PDF from the same authoritative invoice detail projection and downloads it as `{invoiceNumber}.pdf`. Its first and continuation page headers identify `3J COMPUTER AND INTERNET INSTALLATION SERVICES` at `Zone 2, Roma Norte, Enrile, Cagayan 3501`. When an issue-time snapshot exists, the PDF presents one total account amount due, then previous unpaid invoices, then current charges. It also includes customer/account/contact/address, invoice and billing-period dates, service references, adjustment/payment activity, current-invoice totals, early-bird terms, notes, void metadata, page footers, and a statement-only disclaimer. It is not an official payment receipt or a tax-invoice compliance implementation.
- Invoices generated or created from subscriptions carry service account, service order, catalog, pricing source, and service reference fields for traceability back to Service.
- Payments: API ledger only. `POST /api/billing/payments` with `Idempotency-Key` remains the canonical way to settle Billing invoices, but the Billing frontend no longer exposes a Payments tab. A receipt can settle one invoice through `invoiceId`, multiple same-customer invoices through `allocations`, and store an excess amount through `advanceAmount`. Posted receipts store immutable server `postedAt` timestamps in addition to the date-only business `paymentDate`; Billing rejects a `paymentDate` after the current Asia/Manila business date before quoting promotions or posting a receipt. Posted receipts are immutable; customer invoice payment intake and receipt voiding belong in Point of Sale -> Invoice Payments.
- Collector integration uses `collector_aging_accounts(search)` for active customer accounts, current customer/invoice balances, authoritative daily promotion quotes, and available credit, and uses `post_collector_payment(payload, idempotency_key, actor)` for canonical payment posting. Account rows expose `outstandingBalance`, `promotionDiscountTotal`, `payableToday`, and `paymentDate`; open invoices expose a versioned `promotionQuote` containing the quote fingerprint, ordered recommended promotion IDs/names, discount, and discounted payable. Collector is server-enforced oldest-first, grants a quoted promotion only on full discounted invoice payoff, leaves smaller payments undiscounted, and can store excess after all discounted payoffs as advance. Billing updates allocated invoice balances immediately and owns promotion credits and future credit application before the separate Collector custody/remittance workflow.
- Adjustments: the frontend exposes a searchable multi-customer outage rebate flow requiring only outage start/end datetimes and selected active subscriber accounts. The preview API computes each subscription as `monthlyRate * affectedSeconds / actualCalendarMonthSeconds`, segmenting cross-month outages and summing multiple active plans per customer. It returns the full entitlement, the amount that can be applied to the newest outstanding service bill immediately, the amount that will remain as account credit, plan/rate inputs, eligibility reasons, customer totals, and a state fingerprint. Batch posting requires that fingerprint plus `Idempotency-Key`, revalidates every selected customer, rejects the whole batch on stale/ineligible/duplicate state, and atomically posts one immutable customer-level `CREDIT` with `adjustmentSource=SERVICE_REBATE` per customer. No open bill is required. A current bill consumes available credit immediately; otherwise the full amount remains available for the next generated monthly invoice. Posted records retain batch ID, outage window/timezone/duration, calculation method, plan snapshots, calculated amount, initial application/carry-forward amounts, and operator. Invoice summaries expose applied rebate value through `rebateTotal`, and invoice/adjustment tables show the rebate application and remaining credit. The invoice-specific API remains available for controlled debit/credit corrections and system-generated promotion adjustments. All posted and voided adjustments remain immutable.
- Balances: customer balance summaries with invoiced total, paid total, outstanding balance, credit, overdue total, and open invoice count
- Collection Performance: selected-month monthly-service cohort and unique billed-customer counts, as-of settlement reconstruction, cash/credit/rebate amount separation, reconciliation variance, all-open A/R aging, management summary, and a dedicated Collections-tab `ACTION_REQUIRED` worklist with status/search filtering, due context, and server pagination.
- Balance summaries include `unpaidMonths`, `unpaidMonthlyInvoices`, `oldestUnpaidMonth`, `newestUnpaidMonth`, and `unpaidMonthlyBalance` for monthly service invoice aging.
- Balance and subscription summaries include month key arrays (`unpaidMonthKeys`, `missingBillingCycleKeys`) plus count/oldest/newest fields for compact Monthly Aging display such as `Unpaid 2 mo: Jul-Aug 2026` and `Missing 1 inv: Sep 2026`.
- Balance summaries prefer live Customer Profiling records, but fall back to the customer snapshot stored on Billing records so stale/missing Customer Profiling rows do not break Billing page loads.
- Customer-facing Billing tables display System Settings customer emotion avatars. Balance and invoice context can move the displayed mood toward warning or angry when balances are overdue or invoices remain open.

## Billing Rules In Current Shell

- Supports `PREPAID` and `POSTPAID` monthly subscriptions.
- Full prepaid cycles become eligible for automatic generation `BILLING_PREPAID_LEAD_DAYS` before `nextInvoiceDate` (default 7). Their issue date is the actual generation business date and their due date is the later of cycle start or issue date, allowing the normal payment window before service begins while keeping catch-up invoices valid.
- Full postpaid cycles become eligible at the calendar-month end. Their issue date is the actual generation business date and their due date is the later of period close or issue date plus the subscription `dueDays`.
- A run processes each active subscription from its persisted `nextInvoiceDate` until no cycle is due. Successful cycles advance the schedule one month; a failed subscription does not roll back invoices posted for other subscriptions.
- The scheduler is controlled by `BILLING_AUTO_BILLER_ENABLED`, `BILLING_TIMEZONE`, `BILLING_PREPAID_LEAD_DAYS`, and `BILLING_SCHEDULER_INTERVAL_SECONDS`.
- Prepaid first-cycle Service Account invoices use actual-day proration rounded up to the next whole peso and are due immediately on the service start date. Example: a July 10, 2026 start bills July 10-31 as 22/31 of the monthly rate, then schedules the next full invoice for August 1-31.
- Prepaid generated monthly invoices are due at the start of the service cycle. Early-bird-qualified prepaid invoices expose the discounted payable amount until the day before the cycle starts.
- Postpaid generated monthly invoices use the generation business date as issue date and are due from the later of cycle end or issue date plus `dueDays`. Early-bird-qualified postpaid invoices expose the discounted payable amount through the invoice due date.
- New postpaid subscriptions default to `dueDays=7`; staff can explicitly choose `0` when the contractual term is due immediately. Existing subscription terms are preserved.
- First-cycle Service Account postpaid invoices use actual-day proration rounded up to the next whole peso. Example: a July 9, 2026 start bills July 9-31 as 23/31 of the monthly rate, then schedules the next full invoice for August 1-31.
- Missing billing cycles are not counted as unpaid debt because no collectible invoice exists yet. They are shown as operational billing gaps so staff can run or repair invoice generation before collections work begins.
- Billing uses separate open items for monthly receivables. An unpaid July invoice remains collectible as July when August is issued. August's issue-time account summary can display July plus August as the historical total account amount due, but July is never copied into August line items or included in August's invoice balance.
- Invoice totals are calculated from line items plus posted debit adjustments minus posted credit adjustments.
- Outage rebates create customer-level account credit rather than cash. Every selected customer requires an active priced subscription during the outage, but an open bill is optional. Billing applies credit to the current service bill when one exists, carries any remainder forward, prevents a second posted rebate for the same customer/window, and records authoritative calculation and application metadata in the adjustment ledger.
- Invoice paid/balance values are calculated from posted payment allocation rows plus posted advance and adjustment-credit application rows, with legacy single-invoice payments treated as a one-line allocation.
- Customer available credit equals unconsumed posted payment `advanceAmount` plus unconsumed customer-level credit adjustments. Credit is consumed FIFO through `credit_application` records when monthly invoices are issued and does not create another cash receipt when later applied.
- Promotion amounts and conditions are promotion-owned. The subscription stores qualification IDs/snapshots, while the legacy single `earlyBird*` fields are derived from the first qualified Early Bird rule for backward compatibility.
- Payment-time promotions are posted as separate credit adjustments with `adjustmentSource=PAYMENT_PROMOTION` linked to one receipt. `GET /api/billing/invoices/{invoice_id}/eligible-promotions` returns legacy `recommendedPromotionId` plus `recommendedPromotionIds`, `recommendedPromotionBundle`, and the versioned `promotionQuote`. Eligibility normally comes from the invoice's qualified-promotion snapshot; if an existing linked invoice has no snapshot, Billing falls back to that subscription's current qualified promotions before applying the payment-date checks. Bundles are ordered by priority and each discount is calculated against the remaining balance. `POST /api/billing/payments` accepts `promotionIds` plus optional quote date/fingerprint per allocation and validates the exact combined payable. The fingerprint covers payment date, current invoice balance, ordered promotion IDs, discount, and discounted payable; a mismatch returns HTTP 409 with a refresh instruction. Voiding the payment voids every linked promotion credit. Legacy singular fields and `EARLY_BIRD_DISCOUNT` remain supported for older records without invoice or subscription qualification.
- Qualified promotions are revalidated when full monthly invoices are generated and again at payment. Paused, archived, approval-required, billing-mode-mismatched, or unqualified rules are not offered. Early Bird is the payment-date-gated monthly rule: it is only offered when the selected payment date is still before the prepaid cycle start or through the postpaid due-date window. Qualified `ANY_PAYMENT` monthly promotions use the invoice billing period or issue date for promo-window validity, so changing the POS payment date later does not remove an otherwise valid less/loyalty-style discount. Installation-fee promotions remain selected and validated through the fee-decision workflow.
- Voided invoices, payments, and adjustments remain persisted and visible for ledger history. Only `POSTED` payments and adjustments affect balances; `VOID` invoices are excluded from receivables.
- Installation fee decisions are persisted in PostgreSQL. `INVOICED` decisions create a one-time Billing invoice with an `Installation Fee` line item; `WAIVED` and `NO_FEE` decisions create no payable invoice but preserve the decision/reason for audit and reporting.
- Invoice payments posted from Point of Sale use Billing payment records with `collectionChannel=POS`, a stable `Idempotency-Key`, authenticated operator attribution, server `postedAt` timestamping, transaction-safe invoice-balance validation, and allocation-level promotion IDs for Billing-recommended eligible invoice discounts. POS can post one selected-customer receipt with multiple selected invoice allocations; Billing owns the final allocation validation, promotion revalidation, linked credit adjustments, and receipt ledger.

## API Routes

- `GET /api/billing/meta`
- `GET /api/billing/readiness`
- `GET /api/billing/customers`
- `GET /api/billing/promotions`
- `POST /api/billing/promotions`
- `PATCH /api/billing/promotions/{promotion_id}`
- `DELETE /api/billing/promotions/{promotion_id}`
- `GET /api/billing/overview`
- `GET /api/billing/collection-performance?billingMonth=YYYY-MM&asOf=YYYY-MM-DD&status=ALL|ACTION_REQUIRED|FULLY_PAID|PARTIALLY_PAID|UNPAID&search=&page=1&pageSize=20`
- `GET /api/billing/collections/worklist?asOf=YYYY-MM-DD&billingPeriod=ALL|YYYY-MM&status=ALL_OPEN|ACTION_REQUIRED|OVERDUE|PARTIALLY_PAID|UNPAID&search=&page=1&pageSize=20`
- `GET /api/billing/collections/accounts/{customer_id}?asOf=YYYY-MM-DD&billingPeriod=ALL|YYYY-MM`
- `POST /api/billing/collections/accounts/{customer_id}/follow-up-sms`
- `GET /api/billing/billing-runs/preview?asOf=YYYY-MM-DD`
- `GET /api/billing/billing-runs`
- `POST /api/billing/billing-runs/run` with `Idempotency-Key`
- `GET /api/billing/billing-runs/{run_id}`
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
- `GET /api/billing/invoices/{invoice_id}`
- `GET /api/billing/invoices/{invoice_id}/pdf`
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
- `POST /api/billing/adjustments/outage-rebates/preview`
- `POST /api/billing/adjustments/outage-rebates`
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
- Collector owns the mobile field-payment, receipt-print, cash/GCash custody, and office-remittance workflow. It reads Billing aging through the app-shell provider contract and posts through Billing's existing transaction-safe, idempotent payment path. Finance confirmation in Collector settles custody only and never posts another Billing payment.
- Integration must provide Billing with:
  - authenticated admin dependency
  - audit logger
  - customer resolver by ID
  - customer search/list function
  - optional customer seed function for local demo data
  - System Settings A2P SMS sender for collection follow-up messages

## Integration Notes

- This module intentionally does not wire itself into `app-shell`.
- App-shell imports `start_billing_scheduler` and `stop_billing_scheduler` from Billing and binds them to FastAPI startup/shutdown after database migration and module seeding.
- The FastAPI router already uses `APIRouter(prefix="/api/billing", tags=["billing"])`.
- The React page expects the shell auth token in `localStorage.threejmain_token`, matching the current customer-profiling page pattern.
- The frontend should be routed by the shell to `/billing` when Integration Codex wires modules together.
- The Service module must expose active service accounts with `catalog`, `customer`, `serviceReference`, and activation/billing dates for best Billing prefill quality. Completed service orders are still kept as optional traceability events.

## Risks And Follow-Ups

- The compatibility store still persists record payloads as JSONB. Dedicated relational invoice-line, payment-allocation, and ledger-account tables remain the next scaling step.
- Customer snapshots can become stale if Customer Profiling data changes after Billing records are created.
- Payment allocation supports one receipt across multiple open invoices for one customer and multiple qualified, stackable promotions per invoice allocation. Customer-level advance and rebate credits are supported through separate credit applications; direct payment overages beyond explicit advance credit and cross-customer allocations are not supported.
- Billing payment voids do not yet notify Collector to reopen or remove linked custody. A Collector receipt should not be settled after its Billing payment is voided until reversal synchronization is implemented.
- No tax-invoice compliance, late fees, dunning notices, customer batch statements, or payment gateway integration yet. The downloadable invoice PDF is an individual billing statement and explicitly does not replace the separate payment receipt.
- There is no persisted foreign-key enforcement yet between Billing subscriptions and Service Accounts because Service Account durability is still separate from Billing's JSONB record store.

## Verification

- Integrity tests: `python3 -m unittest discover -s features/billing/api/tests -p 'test_*.py' -v`
- The suite covers idempotent replay and key mismatch, concurrent overpayment prevention, duplicate subscription-cycle generation, posted-record immutability, reversal history, multi-invoice payment allocation and void reversal, Collector promotion quote projection/fingerprint rejection, promoted payoff plus advance, customer-level rebate carry-forward and future-invoice application, monthly collection unique-customer cohorts and cash/credit separation, posting-date as-of cutoffs, immutable issue-time account summaries, prior unpaid invoice PDF/detail projection, in-memory rollback/audit suppression, prepaid lead dates, postpaid month close, catch-up runs, run retries, and per-subscription failure isolation.
