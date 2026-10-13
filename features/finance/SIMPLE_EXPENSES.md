# Simple expenses and credit-card bills

Implemented 2026-10-13 under Finance Management. Existing journal, scopes,
independent approvals and immutable correction rules remain authoritative.

## Daily workflow

1. **Add expense**: payee, category, amount, expense date (today), description,
   payment arrangement and receipt/invoice. Save draft or submit for approval.
2. **Review**: a different authorized approver approves or rejects. The new approval
   action records the exact reviewed cost and payable in one transaction.
3. **Record payment**: Finance confirms the actual account, amount, date and evidence.
   Later payments reduce the payable without recognizing the cost again.

**More details** holds supplier invoice number/document date, location, project,
inventory/asset and external evidence/exception references. A blank invoice number
gets an explicitly internal reference; actual supplier references retain duplicate
protection per payee. Category determines operating expense, direct cost, inventory
asset or fixed asset. Mixed lines, tax splits and annual prepayments need Finance review.

The list shows date, payee, category, amount, supplier paid, remaining and one
readable status: Draft, Needs approval, Ready to record (legacy approved unposted),
Awaiting payment, Partially paid, Paid, Rejected or Reversed. Unposted records show
pending approval/recording. Accounting/audit details remain inside expense detail.

## Payment arrangements

- **Pay later**: full purchase recognized once; due date and outstanding payable.
- **Installments**: two to 120 distinct ordered due dates with positive amounts
  totaling the full purchase. Monthly suggestions use exact cents, allocate the
  cent remainder to the last installment, and clamp month ends correctly. Users
  review/edit dates and amounts. Payments allocate earliest due first; reversals
  restore derived allocations. Terms freeze after submission. Reports allocate
  payments as of the selected report date, independently of today's settlement.
- **Already paid / charged to card**: retain the actual account, payment date and
  noncash reference as reviewed declarations. Declarations alone move no money.
  Finance confirms the payment after independent approval. The payment dialog starts
  with those details and the unpaid amount. Partially paid purchases use Pay later
  or Installments plus separate actual partial payments.

Arrangements describe when payment is due, methods describe the rail, and actual
named accounts identify funds or debt. The interface derives the normal method from
the account; the server independently validates account/method compatibility.

## Credit-card bills

**Accounts & Transfers → Card bills** separates supplier settlement from card debt.
A card charge settles the supplier and credits the card liability. An issuer statement
adds tracking evidence only. Repayment debits the liability and credits the funding
account, with zero income/expense effect. Interest, fees and taxes need separate
reviewed expense recognition. Paying a card never recognizes its purchases again.

Bills retain card account, unique reference, statement period, due date, full balance,
evidence reference, creator/date and optional agreed installments. They retain the
journal balance at capture and expose the current balance at the statement closing
date. Differences are labeled, never automatically posted. Current card debt includes
later charges/corrections; remaining bill balance includes allocated repayments only.

The latest bill supersedes earlier tracking bills without deleting evidence. Enter
the issuer's full carried balance on the next bill; never sum bills as new liabilities.
Older statements cannot be inserted behind the latest closing date. Correct the latest
unpaid bill with an attributed replacement, a new reference and the same account/closing
date. Reverse allocated repayments first. Every prior bill remains immutable.

**Link existing repayment** allocates an existing card-settlement transfer without
posting it again. It must match the card, be unreversed and dated on/after closing.
Each transfer can be allocated once. Repayment reversals restore allocations and retain
the original journal. Older movement corrections can change current reconciliation;
original statements are never rewritten.

## API and permissions

All mutations require a stable Idempotency-Key. Matching retries/source references
recover retained results; conflicts return 409. Replay checks current scopes again.

- `POST /api/finance/expenses`: atomic draft, optional attachment and optional
  `submitForApproval`; expenses.create plus attachments.upload for included files.
  Streaming is bounded to 2,850,000 bytes; files remain limited to 2 MiB with existing
  filename/type/signature checks. Validation never echoes bytes; audit/recovery
  records contain hashes/metadata, while private attachment storage contains bytes.
- `POST /api/finance/payables/{id}/approve-record`: expenses.approve, current version,
  reason, independent reviewer, approval limit, scopes and frozen evidence. Approval
  authorizes recognition of **only the exact reviewed expense**; no generic posting
  grant or supplier payment is implied. Failure rolls back approval and decision
  evidence. Original `/approve` and `/post` contracts remain separately available.
- Existing edit/submit/reject/reopen/payments/reversals/private downloads remain.
  Creator and last financial/evidence editor cannot approve or reject themselves,
  including owner. Actual payment still requires expenses.pay.
- `GET /api/finance/card-statements`: accounts.view + transfers.view; scoped card
  evidence and funding-account-filtered repayment details.
- `POST /card-statements` and `/{id}/correct`: accounts.manage and card scope;
  corrections require correctionReason. They create no journal.
- `POST /card-statements/{id}/repayments`: transfers.post and both account scopes;
  fromAccountId, effectiveDate, amount, sourceReference, referenceNumber, reason.
- `POST /card-statements/{id}/link-repayment`: transfers.post + transfers.view;
  journalId/reason, without a new journal.
- `POST /card-repayments/{id}/reverse`: journals.reverse and both account scopes,
  dated reason. Generic reversal of new statement-linked journals is blocked.

Supplier payable reports split remaining installments by due date, reconciling
exactly to control/journal balances. Suppliers paid by card leave supplier payables;
the card liability remains in accounting and the Card bills workspace.

## Storage and operations

EXPENSE_WORKFLOW_MIGRATIONS appends `2026101301_finance_expense_workflows` after
base, integration and readiness migrations. Shared main registers the extension.
Finance now has seven migrations and 28 tables. Never edit applied SQL/checksums.
The new finance_card_statements and finance_card_repayments tables hold immutable
evidence and relational account/journal identities. PostgreSQL verifies installment
terms, frozen records, repayment lines/mappings, uniqueness and historical settlement
bounds. Existing ledger writer locking serializes transactions; journal, subledger,
audit and request recovery commit together. No additional receipt ledger or job.

Expense attachment authentication, retirement and retention remain unchanged. Card
bills currently use evidence references; dedicated statement uploads, issuer feeds,
minimum-payment/interest calculations, recurring expenses and mixed-line/tax/prepayment
workflows remain outside this change. Opening/cutover and unavailable costing/history
limitations in PHASE8_READINESS.md remain prerequisites.

Deploy with scripts/staging_deploy.sh under runtime/server coordination, on 8280/8200.
A verified mode-0600 archive preceded the extension:
`/tmp/threejmain-staging-before-simple-expenses-20261013T025228Z.dump`, 751227 bytes,
SHA-256 a919f6c6117b2d2f26bd46f74285d99921367a4b7aeaa095958805db3fd69249.
Use the documented cold full-PostgreSQL restore boundary preserving migration
checksums/functions/triggers, journal, source outbox/cursors, audit and attachments.
No real payable, card bill, opening or journal was fabricated on staging during review.

Verification: test_finance_expense_workflows.py and its private PostgreSQL counterpart,
expenseForm.test.mjs and financeExpenses.browser.mjs. Cases cover atomic approval/payment
rollback, self-approval/limits/scopes, exact schedules/as-of aging, evidence, duplicate
requests, independent workers, card charges/repayments/reversals, existing-transfer
allocation and retained corrections. Deployed browser scenarios use actual isolated
service records and intercept financial writes.

Final verification: 349 staged API/wiring cases (343 passed, six documented fixture
skips), 26 passing Node checks, seven new expense/card browser groups plus nine
Activity, eleven existing interface and thirteen actual shared-staging groups.
No page errors or real financial writes. Seven applied migrations / 28 tables and
empty actual payable, card bill and journal tables were verified after deployment.
