# Finance Management Phase 3: Expenses & Payables

Current report handoff: [PHASE5_REPORTING.md](PHASE5_REPORTING.md). Phase 5 now
selects `ReportingService` and adds explicit report providers. Four ordered
migrations/nineteen tables are required. This earlier-phase guide retains its
historical contracts; no old SQL file or source-owner record was changed.

Current Phase 4 handoff: [PHASE4_INCOME_COLLECTIONS.md](PHASE4_INCOME_COLLECTIONS.md)
extends this historical contract. `configure_finance` now selects `IncomeService`
and accepts explicitly injected certified source providers. Three ordered local
migrations/eighteen tables and three enabled workspaces are required. Generic
manual fund inflows cannot bypass independent income/funding approval. Earlier
phase migration files remain unchanged; shared wiring is still pending.

Implemented 2026-10-12 inside `features/finance/`. Builds on the
[accounting foundation](PHASE2_INTEGRATION.md) and enforces the
[Phase 1 approval policy](IMPLEMENTATION_SPEC.md#5-permissions-and-audit).
The module exports executable API/UI and ordered PostgreSQL definitions;
app-shell wiring, shared permission seeding and application-schema migration
registration/application remain separate integration work.

## Ownership, structure and durable data

Finance owns payees, categories, expense/payable documents, approval events,
settlements and supporting attachments. It does not edit Inventory stock,
Service jobs, Billing receipts or another module's physical asset ledger.
Optional location/project/item/asset fields are reference text, not verified
foreign keys or automatic stock movements.

New implementation files:

- `api/finance/expense_schemas.py`: strict input models, exact PHP amounts.
- `api/finance/payables.py`: `PayablesService`, extending the journal foundation.
- `api/finance/payable_storage.py`: relational PostgreSQL repository extension.
- `api/finance/migrations/2026101202_finance_payables.sql`: ordered Phase 3 DDL.
- `web/ExpensesPayables.jsx`: payable, payee and category views/forms.
- `web/FinanceDialog.jsx`: focus-managed modal with keyboard containment/Escape.
- `web/expenseEvidence.mjs`: bounded byte-preserving attachment preparation.
- `api/tests/test_finance_payables.py`, `test_finance_payables_postgres.py`,
  `web/tests/expenseEvidence.test.mjs`: workflow, security and race tests.

`router.py` now uses `PayablesService`; the actor/store injection contract is
preserved. Accounts & Transfers and Expenses & Payables are enabled locally.
The other four workspaces remain unavailable. No demo balances/reports exist.

Six new shared-PostgreSQL tables are defined: `finance_payees`,
`finance_categories`, `finance_payables`, `finance_payments`,
`finance_approval_events`, `finance_attachments`. IDs are permanent UUIDs;
payable numbers use a database identity sequence. Supplier document identity
is unique by payee and uppercase trimmed reference, including reversed records.
Normalized amounts/dates/states/versions, category mappings, payment account/
journal/source references and attachment hashes have database constraints.
JSONB retains document, catalog, approval and account-name snapshots. Monetary
values remain Decimal/NUMERIC(18,2), serialized as strings; no float arithmetic.

Payees support SUPPLIER, EMPLOYEE and OTHER business-payee types, names, codes
and notes. Categories map a permanent code/classification to an expense/asset GL
account. Master name/notes/active changes require optimistic version and reason;
identity/type/classification/mapping are immutable. Archival preserves records,
posted snapshots and historical attribution. Archived payees/categories cannot
be selected for new/revised/submitted expenses. Existing independently approved
documents retain their original mapping; posting still requires an active GL
account, and settlement requires an active funds account.

## Classification and recognition

| Classification | Recognition debit | Recognition credit | Payment effect |
| --- | --- | --- | --- |
| OPERATING_EXPENSE | Expense GL, recorded separately from direct service costs | Supplier/employee payable control | Dr payable, Cr selected funds/card account |
| DIRECT_COST | Expense GL, direct ISP service cost classification | Same control | Same; no second expense |
| INVENTORY_PURCHASE | Inventory asset GL | Same control | Same; no stock quantity/COGS posting |
| ASSET | Capital asset GL | Same control | Same; no immediate operating expense/depreciation |

Posting uses the approved amount and `expenseDate` as recognition date. It does
not move money. `documentDate` is the supplier document date; `dueDate` must not
precede it. Future-dated drafts/approvals are allowed; future recognition and
future payments are rejected. Payment cannot predate recognized liability:
supplier advances require a future explicit prepayment workflow.

The migration seeds chart configuration and eight recommended ISP categories:
office/admin OPEX; upstream bandwidth, network-site power and evidenced field
transport direct costs; stock purchases; network capital purchases; office/
vehicle assets. These contain no transaction/sample amounts. Users may create
additional mapped categories, such as dedicated maintenance or installation
costs, with explicit master-data permission. Dedicated expense GL destinations
and preserved category classification distinguish gross-profit direct costs
from operating expenses. Asset/inventory destinations remain debit-normal GL
assets, never usable as payment/transfer accounts.

Each document currently has one aggregate amount and one classification.
Mixed-category bills, recoverable-tax splits, quantity/cost lines, vendor credit
notes, multi-bill allocation, employee advances, amortization/depreciation and
valued Inventory issues are future extensions. Do not represent annual prepaid
services as fully consumed OPEX or report stock purchase payments as COGS.
Capitalization/tax/costing policy and source costing/history gates from Phase 1
still apply. This phase does not implement authoritative profit/cash-flow reports.

## Independent states and review policy

The 2026-10-13 direct-recording refinement supersedes universal expense approval
below for explicitly authorized own business expenses. See
[the current policy](README.md#direct-expense-recording). Independent review remains
mandatory for employee reimbursements, staff submissions and amounts above the
role Finance limit; no creator/editor can approve or reject their own submission.


Approval: `DRAFT -> SUBMITTED -> APPROVED` or `REJECTED`. Rejected documents can
be edited into a new-version draft. Explicit `reopen` returns any unposted
submitted/approved/rejected document to DRAFT, clears approval and records a
reason. Draft edits, evidence changes and reopening require a new review before
posting. Submitted/approved financial details and attachments are frozen until
reopening. Approval freezes amount, purpose, dates, payee/category and evidence
for the approved version; catalog edits do not silently rewrite snapshots.

Approval and rejection require `finance.expenses.approve`. The reviewer cannot
be the creator **or the last financial/evidence editor**, even with `*` grants.
No sole-owner override is implemented. This enforces Phase 1's no-self-approval
default and also prevents a reviewer editing another person's draft and then
approving their own revision. A reviewer must have explicit document visibility
and approval permission; approval additionally respects their optional amount
limit. Reasons, actor, timestamp, version, amount/limit, financial fingerprint
and evidence hashes are retained in append-only approval events. Rejection
requires a nonempty reason. Old decisions remain after reopening/review.

Submission requires an active payee/category and supporting evidence: uploaded
active attachment(s) or an external evidence reference. An exception requires
`finance.expenses.evidence.override` plus a meaningful exception reason. Both
submitter and approver need that grant when approving unsupported evidence.
An evidence exception never bypasses independent approval or amount/account
scopes. Posting permission cannot approve an expense implicitly.

Posting: `UNPOSTED -> POSTED -> REVERSED`. Posted financial fields/approved
evidence cannot be edited/deleted. There is no direct paid-state write.
Settlement derives from immutable posted payments minus linked reversals:
`UNPAID`, `PARTIALLY_PAID`, `PAID`. Overdue derives from due date and positive
recognized outstanding liability, separately from approval/posting states.
Unposted/reversed documents display zero current liability and UNPAID; use
posting state to distinguish them from a recognized unpaid bill.

## Payments, reversals and concurrency

A payment allocates a positive exact amount to one posted payable, with actual
date, named financial account, method, unique source reference, reason and
supporting noncash reference. It cannot exceed remaining liability, violate any
historical daily payable balance, or create negative funds. The server validates
method/account agreement: CASH for cash/petty/collector cash, GCASH for company
or personal collector-wallet due accounts, BANK_TRANSFER for bank, CREDIT_CARD
for card liability, OTHER for a supported asset account with reference.

Card payment debits the supplier payable and credits card liability; the bill
becomes settled and the amount becomes owed to the card company. Subsequent card
principal repayment in Accounts & Transfers reduces card liability, with no
second expense. Card payments are marked noncash. Personal collector GCash
clears funds due from that collector; it is not company-wallet cash flow. Actual
custody/source reconciliation remains a later source-owner integration.

Payments and audit evidence commit atomically with balanced journal entries.
Stable `Idempotency-Key` guards every mutation; changed payload under the same
key returns 409. The source namespaces `finance.payable` (document ID) and
`finance.payable-payment` (unique payment reference) independently prevent
duplicate recognition/settlement. Bank/wallet reference is supporting evidence,
separate from the unique accounting document reference. Exact financial-source
replay creates no second journal/payment/audit. Replays recheck current grants,
document ownership/IDs and current account scope, including after draft changes.

Recognition reversal requires reversing all linked active settlements first.
Payment reversal restores liability and offsets the funds/card movement; record
it only for a verified original error or actual refund. Reversal dates cannot
precede originals or make an intermediate daily payable balance negative.
Reversals retain the original actor/amount/source and append a new attributed
journal with reason/date; no reversal-of-reversal or second reversal is allowed.
Correction documents use a reviewed revision reference, retaining the original
supplier document and reversal evidence. A reversed document is never reposted.

Manual journals cannot use payable control. Generic journal reversals refuse
payable/payment sources: use their linked workflow so document and subledger
states remain coherent. The journal UI opens the linked payable for correction.
PostgreSQL guards also reject an unlinked control entry, cost/payment mismatch,
recognition without approved-version evidence, historical over-settlement,
paid-bill reversal without settlement reversals, and mutation/deletion of posted
documents, payment/approval events and attachment bytes.

All Finance writes take the database advisory writer lock, including direct
journal assembly guards. State/amount checks occur inside that transaction;
read-only snapshots take its shared lock. Competing approval/version changes
fail stale versions, competing postings produce one recognition entry, and
competing partial payments cannot each spend the same remaining liability.
Audit/replay/document/payment failures roll back the financial entry as well.

## Permissions and scope

The trusted shared-auth provider still resolves `Actor` server-side. No grant,
role, username or scope is accepted from request JSON. New local grants are not
seeded in shared Access:

| Grant | Scope |
| --- | --- |
| finance.expenses.view | Catalogs and own expense evidence; not automatic access to other users' documents. |
| finance.expenses.view_all | Explicit broader document visibility, still constrained by expense/account IDs. |
| finance.expenses.manage | Create/edit/archive payees and categories. |
| finance.expenses.create | Create/edit/reopen/submit permitted unposted expense documents. |
| finance.expenses.approve | Independent approve/reject; approval amount limit applies. |
| finance.expenses.post | Post classified independently approved recognition. |
| finance.expenses.pay | Allocate settlement from permitted funds/card account. |
| finance.expenses.reverse | Linked payment or recognition reversal; no manual-ledger bypass. |
| finance.expenses.evidence.override | Explicit evidence exception with reason; approver also requires it. |
| finance.attachments.view | Metadata/download in an otherwise visible expense document. |
| finance.attachments.upload | Upload/retire evidence; also needs expense creation/edit permission. |

`Actor.expense_ids=None` is unrestricted document-ID scope; an explicit set
limits documents even with view_all. Creating new documents requires
unrestricted expense-ID scope. `Actor.account_ids` must include the document's
recognition GL and any funding account being used; fixed control counterpart
lines are exempt. Aggregated control balances remain hidden from scoped account
lists. Approvers/managers reviewing others need explicit view_all; auditors can
receive view/view_all/attachment read and relevant account scope without writes.
Scoped payment detail lists only permitted funding-account rows. Full linked
journal reads additionally enforce expense visibility/IDs. Account activity
permission still allows that account's movements/reasons, independently of
access to full expense documents or attachments. Give these grants accordingly.

## Secure attachment access and retention

Attachments are private PostgreSQL BYTEA, with immutable filename/type/size/hash/
creator/time and document ID. No public directory, filesystem path, unauthenticated
URL, third-party URL fetching or inline browser preview is introduced. The server
accepts only PDF, PNG, JPEG, checks extension/type/signature agreement, validates
base64 strictly, caps decoded bytes at 2 MiB and caps incoming JSON while
streaming at 2,800,000 bytes before decoding. A document retains at most ten
attachment versions, including retired ones. PostgreSQL verifies SHA-256 against
stored bytes. Validation errors do not echo byte content.

Downloads recheck authentication, expense visibility/ID/account scope and
attachment-view permission. They verify the requested attachment belongs to the
requested payable, commit a successful-access audit before returning bytes, and
serve application/octet-stream with attachment disposition, nosniff, private
no-store caching and sandbox CSP. List APIs, successful audit records and replay
results contain metadata/hashes, never raw document bytes. Signature checks are
format screening, not antivirus/content sanitization; supporting files remain
untrusted downloads. No inline rendering or server-side document execution occurs.

Retirement only marks a draft/rejected document's evidence inactive, with actor,
reason/time and new document version. Bytes/hash and past approval evidence are
retained and remain downloadable to authorized reviewers. Submitted/approved/
posted evidence cannot be retired unless the unposted document is explicitly
reopened and independently reapproved. There is no delete/purge/automatic expiry
API. No statutory retention interval is invented: an organization-approved
retention/legal-hold policy, controlled purge procedure and backup treatment
must be assigned separately before implementing deletion. Backups currently
need the full table/BYTEA/TOAST data, immutable audit/approval records, journal
relations and identity sequence state. Protect database access/backups as private
financial evidence; application grants do not replace infrastructure controls.

The browser freezes upload bytes/metadata/version together with a stable request
key before sending, using the same per-user pending-request store as financial
writes. Storage failure prevents sending; a smaller file may be needed when
browser quota is insufficient. An uncertain upload/payment retains its exact
payload/key across reload; definitive size/type/permission/version rejection
allows correction. Successful confirmation reloads the selected payable.
Shared-device handling of browser pending evidence remains part of integration
policy; server audit/replay tables never store the base64 upload body.

## API contract

Routes are relative to `/api/finance`. Every POST/PATCH below requires the stable
Idempotency-Key header; dates are ISO and money is a decimal string.

| Method / route | Contract |
| --- | --- |
| GET/POST `/payees` | List catalogs; create code/name/type/notes. |
| PATCH `/payees/{id}` | version/name/notes/active/reason; no type/code edits or delete. |
| GET/POST `/categories` | List; create code/name/classification/accountId/notes. |
| PATCH `/categories/{id}` | version/name/notes/active/reason; no accounting-map edit/delete. |
| GET/POST `/payables` | Visible list; create payeeId/categoryId/documentReference/documentDate/expenseDate/dueDate/amount/purpose, optional reference/evidence fields. |
| GET/PATCH `/payables/{id}` | Detail/history/payments; replace allowed draft financial fields plus version. |
| POST `/payables/{id}/submit`, `/approve`, `/reject`, `/reopen` | version/reason, independently state-checked. |
| POST `/payables/{id}/post` | version; recognition only. |
| POST `/payables/{id}/payments` | accountId/effectiveDate/amount/sourceReference/method/referenceNumber/reason. |
| POST `/payments/{id}/reverse` | effectiveDate/reason. |
| POST `/payables/{id}/reverse` | effectiveDate/reason; no active settlements. |
| GET `/payables/{id}/attachments` | Metadata including retired evidence; no content bytes. |
| POST `/payables/{id}/attachments` | Bounded JSON: version/filename/contentType/contentBase64. |
| POST `/payables/{id}/attachments/{attachmentId}/retire` | version/reason; retain bytes and audit. |
| GET `/payables/{id}/attachments/{attachmentId}/download` | Authorized audited binary download; no Idempotency-Key needed. |

## Shared integration handoff and verification

`finance.migrations.MIGRATIONS` now exports both ordered definitions:
`2026101201_finance_foundation`, `2026101202_finance_payables`. Phase 2 SQL is
unchanged; Phase 3 extends guards with a new migration rather than altering an
applied checksum. Register both once with the shared runner during an assigned
integration task. Copy the entire package/SQL directory, seed reviewed Access
grants, inject authenticated actors with document/account/amount scopes, and
wire existing `/finance` and `/api/finance` exports. Readiness requires all
twelve tables, fails closed without PostgreSQL/both migrations, and reports
integrated/sourceFeedsIntegrated=false. There is no new DSN or driver dependency.

Include six new tables, payable identity sequence, private byte evidence and new
guards in backup/restore coverage. Shared Logs integration must preserve expense
visibility and attachment confidentiality. Do not dump private upload bodies to
access logs. Live staging review should verify shared permission revocation,
auth, pending-upload privacy, browser quota handling and keyboard/focus behavior.
No app-shell, source module, shared runner or runtime restart is included here.

From repository root:

```bash
PYTHONPATH=features/finance/api python3 -m unittest discover -s features/finance/api/tests -p test_finance_foundation.py
PYTHONPATH=features/finance/api python3 -m unittest discover -s features/finance/api/tests -p test_finance_payables.py
node --test features/finance/web/tests/*.test.mjs
```

Opt-in PostgreSQL tests use existing psycopg and `FINANCE_TEST_DATABASE_URL`
pointing only to an authorized test database, supplied without logging secrets:

```bash
PYTHONPATH=features/finance/api python3 -m unittest discover -s features/finance/api/tests -p '*postgres.py'
```

Most PostgreSQL tests create isolated schemas in an outer transaction and roll
back all DDL/data. Independent-worker race tests briefly commit fixtures inside
their own generated `finance_phase3_race_<uuid>` namespace, use separate worker
connections, then drop only that exact test namespace and verify its absence.
They never apply application/public schema migrations, touch application rows,
drop a database, or bind/restart servers. Two inherited concurrency cases are
skipped in rollback-only fixtures because other connections cannot see those
fixtures; three dedicated independent-connection race tests cover duplicate
recognition/settlement, overpayment, account archival and funds outflow/retry.

Verified 2026-10-12: 24 foundation and 21 expense/API Python tests pass locally;
52 PostgreSQL cases pass, including three actual independent-connection race
tests (54 discovered, two inherited rollback-fixture cases skipped as described
above); all 11 Node client/evidence tests pass. Six JSX/JS/CSS static transforms
pass. Database tests exercise both service workflows and direct SQL guards.
Live shared-shell/browser review awaits integration; no application schema
migrations or shared build/restart were performed for this phase.

Verification covers partial/exact settlement, duplicate source/request identity,
unauthorized/current-scope replay, no creator/editor self-approval, amount limits,
rejection/reapproval, distinct expense/asset classes, card liabilities, linked
reversal history/date guards, evidence confidentiality/freeze/retention, rollback
and direct-SQL immutable/overpayment/control guards. Static JSX/JS/CSS checks
and client byte-preserving upload/download/retry checks also run. Shared live
shell review and shared migration deployment remain future integration work.
