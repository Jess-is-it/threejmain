-- Module-local Phase 3 definition, ordered after the immutable Phase 2 migration.
CREATE TABLE finance_payees (
 id text PRIMARY KEY, code text UNIQUE NOT NULL, data jsonb NOT NULL,
 CHECK (code=upper(code)), CHECK (data->>'id'=id AND data->>'code'=code)
);
CREATE TABLE finance_categories (
 id text PRIMARY KEY, code text UNIQUE NOT NULL,
 classification text NOT NULL CHECK (classification IN ('OPERATING_EXPENSE','DIRECT_COST','INVENTORY_PURCHASE','ASSET')),
 account_id text NOT NULL REFERENCES finance_accounts(id) ON DELETE RESTRICT, data jsonb NOT NULL,
 CHECK (code=upper(code)),
 CHECK (data->>'id'=id AND data->>'code'=code AND data->>'classification'=classification AND data->>'accountId'=account_id)
);
CREATE TABLE finance_payables (
 id text PRIMARY KEY, number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 payee_id text NOT NULL REFERENCES finance_payees(id) ON DELETE RESTRICT,
 category_id text NOT NULL REFERENCES finance_categories(id) ON DELETE RESTRICT,
 document_reference text NOT NULL CHECK (length(trim(document_reference)) BETWEEN 1 AND 160 AND document_reference=upper(document_reference)),
 amount numeric(18,2) NOT NULL CHECK (amount>0), expense_date date NOT NULL,
 approval_status text NOT NULL CHECK (approval_status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED')),
 posting_status text NOT NULL CHECK (posting_status IN ('UNPOSTED','POSTED','REVERSED')),
 version integer NOT NULL CHECK (version>0), data jsonb NOT NULL,
 UNIQUE (payee_id,document_reference),
 CHECK (data->>'id'=id AND data->>'payeeId'=payee_id AND data->>'categoryId'=category_id
        AND data->>'documentReference'=document_reference AND (data->>'amount')::numeric=amount
        AND (data->>'expenseDate')::date=expense_date AND (data->>'version')::integer=version
        AND data->>'approvalStatus'=approval_status AND data->>'postingStatus'=posting_status),
 CHECK (approval_status<>'APPROVED' OR (data->>'approvedBy' IS NOT NULL
        AND data->>'approvedBy'<>data->>'createdBy' AND data->>'approvedBy'<>data->>'editedBy'
        AND (data->>'approvedVersion')::integer<=version)),
 CHECK (posting_status='UNPOSTED' OR approval_status='APPROVED')
);
CREATE INDEX finance_payables_status_idx ON finance_payables(posting_status,approval_status,expense_date);
CREATE TABLE finance_payments (
 id text PRIMARY KEY, payable_id text NOT NULL REFERENCES finance_payables(id) ON DELETE RESTRICT,
 account_id text NOT NULL REFERENCES finance_accounts(id) ON DELETE RESTRICT,
 amount numeric(18,2) NOT NULL CHECK (amount>0), effective_date date NOT NULL,
 source_reference text UNIQUE NOT NULL, journal_id text UNIQUE NOT NULL REFERENCES finance_journal_entries(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL, data jsonb NOT NULL,
 CHECK (data->>'id'=id AND data->>'payableId'=payable_id AND data->>'accountId'=account_id
        AND (data->>'amount')::numeric=amount AND (data->>'effectiveDate')::date=effective_date
        AND data->>'sourceReference'=source_reference AND data->>'journalId'=journal_id)
);
CREATE INDEX finance_payments_payable_idx ON finance_payments(payable_id,effective_date);
CREATE TABLE finance_approval_events (
 id text PRIMARY KEY, payable_id text NOT NULL REFERENCES finance_payables(id) ON DELETE RESTRICT,
 version integer NOT NULL, action text NOT NULL CHECK (action IN ('SUBMIT','APPROVE','REJECT','REOPEN')),
 actor text NOT NULL CHECK (length(trim(actor))>0), created_at timestamptz NOT NULL, data jsonb NOT NULL,
 UNIQUE (payable_id,version,action)
);
CREATE TABLE finance_attachments (
 id text PRIMARY KEY, payable_id text NOT NULL REFERENCES finance_payables(id) ON DELETE RESTRICT,
 content_type text NOT NULL CHECK (content_type IN ('application/pdf','image/png','image/jpeg')),
 content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
 content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 2097152),
 active boolean NOT NULL, created_at timestamptz NOT NULL, data jsonb NOT NULL,
 CHECK (encode(sha256(content),'hex')=content_hash),
 CHECK (data->>'id'=id AND data->>'payableId'=payable_id AND data->>'contentType'=content_type
        AND data->>'sha256'=content_hash AND (data->>'size')::integer=octet_length(content)
        AND (data->>'active')::boolean=active)
);
CREATE INDEX finance_attachments_payable_idx ON finance_attachments(payable_id);

-- Extend system-control protection without changing the Phase 2 migration checksum.
CREATE OR REPLACE FUNCTION finance_guard_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('threejmain.finance.ledger'));
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Archive accounts; preserve history' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.code,NEW.kind,NEW.gl_type) IS DISTINCT FROM (OLD.id,OLD.code,OLD.kind,OLD.gl_type) THEN
  RAISE EXCEPTION 'Account identity/classification is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.id IN ('finance-opening-equity','finance-payable-control') THEN
  RAISE EXCEPTION 'System control account is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.active AND NOT NEW.active AND EXISTS (
  SELECT 1 FROM finance_journal_lines WHERE account_id=OLD.id HAVING COALESCE(sum(debit-credit),0)<>0
 ) THEN RAISE EXCEPTION 'Cannot archive a nonzero account' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION finance_guard_expense_master() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('threejmain.finance.ledger'));
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Archive master records; retain evidence' USING ERRCODE='23514'; END IF;
 IF NEW.id<>OLD.id OR NEW.code<>OLD.code OR
    (NEW.data - ARRAY['name','notes','active','version','updatedBy','updatedAt','changeReason']) IS DISTINCT FROM
    (OLD.data - ARRAY['name','notes','active','version','updatedBy','updatedAt','changeReason']) THEN
  RAISE EXCEPTION 'Master identity and recognition classification are immutable' USING ERRCODE='23514'; END IF;
 IF (NEW.data->>'version')::integer<>(OLD.data->>'version')::integer+1 THEN
  RAISE EXCEPTION 'Master version must advance' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='finance_categories' THEN
  IF (NEW.classification,NEW.account_id) IS DISTINCT FROM (OLD.classification,OLD.account_id) THEN
   RAISE EXCEPTION 'Category accounting mapping is immutable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER finance_payee_guard BEFORE UPDATE OR DELETE ON finance_payees FOR EACH ROW EXECUTE FUNCTION finance_guard_expense_master();
CREATE TRIGGER finance_category_guard BEFORE UPDATE OR DELETE ON finance_categories FOR EACH ROW EXECUTE FUNCTION finance_guard_expense_master();

CREATE FUNCTION finance_guard_payable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE workflow text[] := ARRAY['number','version','updatedBy','updatedAt','approvalStatus','postingStatus',
 'approvedBy','approvedAt','approvedVersion','approvalReason','approvalEvidence','rejectionReason',
 'postingJournalId','reversalJournalId','postedBy','postedAt','reversedBy','reversedAt','reversalReason'];
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('threejmain.finance.ledger'));
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Expense evidence cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.version<>1 OR NEW.approval_status<>'DRAFT' OR NEW.posting_status<>'UNPOSTED' THEN
   RAISE EXCEPTION 'Expenses begin as version-one unposted drafts' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.id<>OLD.id OR NEW.number<>OLD.number OR NEW.version<>OLD.version+1 OR
    NEW.data->>'createdBy' IS DISTINCT FROM OLD.data->>'createdBy' OR
    NEW.data->>'createdAt' IS DISTINCT FROM OLD.data->>'createdAt' THEN
  RAISE EXCEPTION 'Expense identity/creator is immutable; version must advance' USING ERRCODE='23514'; END IF;
 IF OLD.posting_status<>'UNPOSTED' THEN
  IF NOT (OLD.posting_status='POSTED' AND NEW.posting_status='REVERSED') OR
     (NEW.data - ARRAY['version','updatedBy','updatedAt','postingStatus','reversalJournalId','reversedBy','reversedAt','reversalReason']) IS DISTINCT FROM
     (OLD.data - ARRAY['version','updatedBy','updatedAt','postingStatus','reversalJournalId','reversedBy','reversedAt','reversalReason']) THEN
   RAISE EXCEPTION 'Posted expense is immutable; use linked reversal' USING ERRCODE='23514'; END IF;
 END IF;
 IF OLD.approval_status IN ('SUBMITTED','APPROVED') AND NEW.approval_status<>'DRAFT' AND
    (NEW.data-workflow) IS DISTINCT FROM (OLD.data-workflow) THEN
  RAISE EXCEPTION 'Submitted/approved financial details and evidence are frozen' USING ERRCODE='23514'; END IF;
 IF (OLD.approval_status,NEW.approval_status) NOT IN
    (('DRAFT','DRAFT'),('DRAFT','SUBMITTED'),('SUBMITTED','APPROVED'),('SUBMITTED','REJECTED'),
     ('SUBMITTED','DRAFT'),('APPROVED','DRAFT'),('APPROVED','APPROVED'),('REJECTED','DRAFT')) THEN
  RAISE EXCEPTION 'Invalid expense approval transition' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER finance_payable_guard BEFORE INSERT OR UPDATE OR DELETE ON finance_payables
FOR EACH ROW EXECUTE FUNCTION finance_guard_payable();
CREATE TRIGGER finance_payment_guard BEFORE UPDATE OR DELETE ON finance_payments FOR EACH ROW EXECUTE FUNCTION finance_immutable_event();
CREATE TRIGGER finance_approval_guard BEFORE UPDATE OR DELETE ON finance_approval_events FOR EACH ROW EXECUTE FUNCTION finance_immutable_event();

CREATE FUNCTION finance_guard_attachment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d finance_payables%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('threejmain.finance.ledger'));
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retain evidence bytes; retire references instead' USING ERRCODE='23514'; END IF;
 SELECT * INTO d FROM finance_payables WHERE id=NEW.payable_id;
 IF d.posting_status<>'UNPOSTED' OR d.approval_status NOT IN ('DRAFT','REJECTED') THEN
  RAISE EXCEPTION 'Supporting evidence is frozen after submission' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND ((NEW.id,NEW.payable_id,NEW.content_type,NEW.content_hash,NEW.content,NEW.created_at) IS DISTINCT FROM
      (OLD.id,OLD.payable_id,OLD.content_type,OLD.content_hash,OLD.content,OLD.created_at) OR
      NOT OLD.active OR NEW.active OR
      (NEW.data-ARRAY['active','retiredBy','retiredAt','retirementReason']) IS DISTINCT FROM
      (OLD.data-ARRAY['active','retiredBy','retiredAt','retirementReason'])) THEN
  RAISE EXCEPTION 'Evidence is immutable; only an attributed retirement is allowed' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND (SELECT count(*) FROM finance_attachments WHERE payable_id=NEW.payable_id)>=10 THEN
  RAISE EXCEPTION 'Ten retained attachment versions per document' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER finance_attachment_guard BEFORE INSERT OR UPDATE OR DELETE ON finance_attachments
FOR EACH ROW EXECUTE FUNCTION finance_guard_attachment();

CREATE FUNCTION finance_validate_payable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid text; d finance_payables%ROWTYPE; e finance_journal_entries%ROWTYPE;
        p finance_payments%ROWTYPE; recognition finance_journal_entries%ROWTYPE; effect text; count_lines integer;
BEGIN
 IF TG_TABLE_NAME='finance_payables' THEN pid:=NEW.id;
 ELSIF TG_TABLE_NAME='finance_payments' THEN pid:=NEW.payable_id;
 ELSE
  IF TG_TABLE_NAME='finance_journal_entries' THEN SELECT * INTO e FROM finance_journal_entries WHERE id=NEW.id;
  ELSE SELECT * INTO e FROM finance_journal_entries WHERE id=NEW.entry_id; END IF;
  pid:=e.metadata->>'payableId'; effect:=e.metadata->>'effect';
  IF pid IS NULL AND EXISTS (SELECT 1 FROM finance_journal_lines WHERE entry_id=e.id AND account_id='finance-payable-control') THEN
   RAISE EXCEPTION 'Payable control requires a linked payable workflow' USING ERRCODE='23514'; END IF;
  IF pid IS NULL THEN RETURN NULL; END IF;
 END IF;
 SELECT * INTO d FROM finance_payables WHERE id=pid;
 IF d.id IS NULL THEN RAISE EXCEPTION 'Payable financial effect has no document' USING ERRCODE='23514'; END IF;
 IF d.posting_status='UNPOSTED' THEN
  IF d.data->>'postingJournalId' IS NOT NULL OR EXISTS (SELECT 1 FROM finance_journal_entries WHERE metadata->>'payableId'=pid) THEN
   RAISE EXCEPTION 'Unposted expense cannot have financial effects' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO recognition FROM finance_journal_entries WHERE id=d.data->>'postingJournalId';
  IF recognition.id IS NULL OR recognition.metadata->>'effect'<>'PAYABLE_RECOGNITION' OR
     recognition.metadata->>'payableId'<>pid OR recognition.source_namespace<>'finance.payable' OR recognition.source_reference<>pid OR
     recognition.metadata->>'approvedVersion' IS DISTINCT FROM d.data->>'approvedVersion' OR
     NOT EXISTS (SELECT 1 FROM finance_approval_events a WHERE a.payable_id=pid AND a.action='APPROVE'
                  AND a.version=(d.data->>'approvedVersion')::integer AND a.actor=d.data->>'approvedBy') THEN
   RAISE EXCEPTION 'Recognition requires linked independently approved version evidence' USING ERRCODE='23514'; END IF;
 END IF;
 IF e.id IS NOT NULL THEN
  SELECT count(*) INTO count_lines FROM finance_journal_lines WHERE entry_id=e.id;
  IF e.kind='REVERSAL' THEN
   IF NOT EXISTS (SELECT 1 FROM finance_journal_entries o WHERE o.id=e.reversal_of_id
                   AND o.metadata->>'payableId'=pid AND o.metadata->>'effect'=effect) THEN
    RAISE EXCEPTION 'Expense reversal must retain the original source link' USING ERRCODE='23514'; END IF;
   IF effect='PAYABLE_RECOGNITION' AND d.data->>'reversalJournalId' IS DISTINCT FROM e.id THEN
    RAISE EXCEPTION 'Recognition reversal must update its linked document' USING ERRCODE='23514'; END IF;
  ELSIF effect='PAYABLE_RECOGNITION' THEN
   IF e.id IS DISTINCT FROM d.data->>'postingJournalId' OR e.effective_date<>d.expense_date OR count_lines<>2 OR
      e.metadata->>'classification' IS DISTINCT FROM d.data->'categorySnapshot'->>'classification' OR
      NOT EXISTS (SELECT 1 FROM finance_journal_lines WHERE entry_id=e.id AND account_id='finance-payable-control' AND credit=d.amount AND debit=0) OR
      NOT EXISTS (SELECT 1 FROM finance_journal_lines l JOIN finance_accounts a ON a.id=l.account_id
          JOIN finance_categories c ON c.id=d.category_id
          WHERE l.entry_id=e.id AND l.account_id=c.account_id AND l.account_id=d.data->'categorySnapshot'->>'accountId'
            AND c.classification=d.data->'categorySnapshot'->>'classification' AND a.kind='GENERAL_LEDGER'
            AND a.gl_type=CASE WHEN c.classification IN ('OPERATING_EXPENSE','DIRECT_COST') THEN 'EXPENSE' ELSE 'ASSET' END
            AND l.debit=d.amount AND l.credit=0) THEN
    RAISE EXCEPTION 'Recognition must debit classified cost/asset and credit payable once' USING ERRCODE='23514'; END IF;
  ELSIF effect='PAYABLE_PAYMENT' THEN
   SELECT * INTO p FROM finance_payments WHERE journal_id=e.id;
   IF p.id IS NULL OR p.payable_id<>pid OR p.id IS DISTINCT FROM e.metadata->>'paymentId' OR
      p.effective_date<>e.effective_date OR e.effective_date<d.expense_date OR count_lines<>2 OR
      e.source_namespace<>'finance.payable-payment' OR e.source_reference<>p.source_reference OR
      NOT EXISTS (SELECT 1 FROM finance_journal_lines WHERE entry_id=e.id AND account_id='finance-payable-control' AND debit=p.amount AND credit=0) OR
      NOT EXISTS (SELECT 1 FROM finance_journal_lines l JOIN finance_accounts a ON a.id=l.account_id
                   WHERE l.entry_id=e.id AND l.account_id=p.account_id AND a.kind<>'GENERAL_LEDGER' AND l.credit=p.amount AND l.debit=0) THEN
    RAISE EXCEPTION 'Payment must settle a posted payable without another expense' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'Unknown payable financial effect' USING ERRCODE='23514'; END IF;
 END IF;
 IF d.posting_status='REVERSED' AND (NOT EXISTS (
      SELECT 1 FROM finance_journal_entries r WHERE r.id=d.data->>'reversalJournalId' AND r.reversal_of_id=d.data->>'postingJournalId') OR
      EXISTS (SELECT 1 FROM finance_payments settlement WHERE settlement.payable_id=pid AND NOT EXISTS
              (SELECT 1 FROM finance_journal_entries r WHERE r.reversal_of_id=settlement.journal_id))) THEN
  RAISE EXCEPTION 'Reverse all settlements before recognition' USING ERRCODE='23514'; END IF;
 IF EXISTS (SELECT 1 FROM (
  SELECT sum(sum(l.credit-l.debit)) OVER (ORDER BY j.effective_date) AS outstanding
  FROM finance_journal_entries j JOIN finance_journal_lines l ON l.entry_id=j.id
  WHERE j.metadata->>'payableId'=pid AND l.account_id='finance-payable-control' GROUP BY j.effective_date
 ) balances WHERE outstanding<0) THEN
  RAISE EXCEPTION 'Payable cannot be over-settled on any historical day' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER finance_payables_valid AFTER INSERT OR UPDATE ON finance_payables DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION finance_validate_payable();
CREATE CONSTRAINT TRIGGER finance_payments_valid AFTER INSERT ON finance_payments DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION finance_validate_payable();
CREATE CONSTRAINT TRIGGER finance_expense_entries_valid AFTER INSERT OR UPDATE ON finance_journal_entries DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION finance_validate_payable();
CREATE CONSTRAINT TRIGGER finance_expense_lines_valid AFTER INSERT ON finance_journal_lines DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION finance_validate_payable();

-- Chart/category configuration, not sample transactions or balances.
INSERT INTO finance_accounts(id,code,kind,gl_type,version,data)
SELECT id,code,'GENERAL_LEDGER',gl_type,1,
 jsonb_build_object('name',name,'custodian','','notes','','createdBy','migration','updatedBy','migration',
                    'createdAt',CURRENT_TIMESTAMP,'updatedAt',CURRENT_TIMESTAMP,'archivedAt',NULL)
FROM (VALUES ('finance-payable-control','PAYABLE_CONTROL','Supplier and employee payables control','LIABILITY'),
 ('finance-opex-ledger','OPERATING_EXPENSES','Operating expenses','EXPENSE'),
 ('finance-direct-ledger','DIRECT_SERVICE_COST','Direct service costs','EXPENSE'),
 ('finance-inventory-ledger','INVENTORY_PURCHASES','Inventory purchases awaiting valued issue','ASSET'),
 ('finance-fixed-assets-ledger','FIXED_ASSET_PURCHASES','Fixed asset purchases awaiting asset schedule','ASSET')) AS chart(id,code,name,gl_type);
INSERT INTO finance_categories(id,code,classification,account_id,data)
SELECT id,code,classification,account_id,
 jsonb_build_object('id',id,'code',code,'name',name,'classification',classification,'accountId',account_id,
                    'notes','','version',1,'active',true,'createdBy','migration','updatedBy','migration',
                    'createdAt',CURRENT_TIMESTAMP,'updatedAt',CURRENT_TIMESTAMP)
FROM (VALUES
 ('finance-category-opex-office','OPEX_OFFICE','Office rent, utilities and supplies','OPERATING_EXPENSE','finance-opex-ledger'),
 ('finance-category-opex-admin','OPEX_ADMIN','Software, professional services and permits','OPERATING_EXPENSE','finance-opex-ledger'),
 ('finance-category-direct-bandwidth','DIRECT_BANDWIDTH','Upstream bandwidth and network transit','DIRECT_COST','finance-direct-ledger'),
 ('finance-category-direct-power','DIRECT_NETWORK_POWER','Network-site electricity','DIRECT_COST','finance-direct-ledger'),
 ('finance-category-direct-field','DIRECT_FIELD_TRANSPORT','Evidenced field-job transport','DIRECT_COST','finance-direct-ledger'),
 ('finance-category-stock','INVENTORY_PURCHASE','Stock for sale or installation','INVENTORY_PURCHASE','finance-inventory-ledger'),
 ('finance-category-network-asset','CAPEX_NETWORK','Network equipment and construction','ASSET','finance-fixed-assets-ledger'),
 ('finance-category-office-asset','CAPEX_OFFICE','Office equipment and vehicles','ASSET','finance-fixed-assets-ledger')
) AS categories(id,code,name,classification,account_id);
