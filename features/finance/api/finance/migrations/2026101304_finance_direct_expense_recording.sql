-- Direct own-business expense authorization, without inventing independent approval.
-- Old posted entries and approval events remain unchanged.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='finance_payables'::regclass AND contype='c'
  AND (pg_get_constraintdef(oid) LIKE '%approval_status = ANY%'
       OR pg_get_constraintdef(oid) LIKE '%posting_status%approval_status%')
 LOOP EXECUTE format('ALTER TABLE finance_payables DROP CONSTRAINT %I', c.conname); END LOOP;
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='finance_approval_events'::regclass AND contype='c'
  AND pg_get_constraintdef(oid) LIKE '%action = ANY%'
 LOOP EXECUTE format('ALTER TABLE finance_approval_events DROP CONSTRAINT %I', c.conname); END LOOP;
END $$;
ALTER TABLE finance_payables ADD CONSTRAINT finance_payable_approval_states CHECK
 (approval_status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','NOT_REQUIRED'));
ALTER TABLE finance_payables ADD CONSTRAINT finance_payable_posting_authorized CHECK
 (posting_status='UNPOSTED' OR approval_status IN ('APPROVED','NOT_REQUIRED'));
ALTER TABLE finance_payables ADD CONSTRAINT finance_payable_direct_authorized CHECK (
 approval_status<>'NOT_REQUIRED' OR COALESCE(
   posting_status IN ('POSTED','REVERSED')
   AND data->>'authorizationPolicy'='AUTHORIZED_OWN_BUSINESS_EXPENSE'
   AND data->>'authorizedBy'=data->>'createdBy' AND data->>'authorizedBy'=data->>'editedBy'
   AND data->>'authorizedAt' IS NOT NULL
   AND (data->>'authorizedVersion')::integer<=version
   AND data->>'approvedBy' IS NULL AND data->>'approvedVersion' IS NULL
   AND NOT COALESCE((data->>'isReimbursement')::boolean,false),false));
ALTER TABLE finance_approval_events ADD CONSTRAINT finance_expense_decision_actions CHECK
 (action IN ('SUBMIT','APPROVE','REJECT','REOPEN','DIRECT_RECORD'));

CREATE OR REPLACE FUNCTION finance_guard_payable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE workflow text[] := ARRAY['number','version','updatedBy','updatedAt','approvalStatus','postingStatus',
 'approvedBy','approvedAt','approvedVersion','approvalReason','approvalEvidence','rejectionReason',
 'postingJournalId','reversalJournalId','postedBy','postedAt','reversedBy','reversedAt','reversalReason',
 'authorizationPolicy','authorizedBy','authorizedAt','authorizedVersion','authorizationLimit'];
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
    (('DRAFT','DRAFT'),('DRAFT','NOT_REQUIRED'),('DRAFT','SUBMITTED'),('SUBMITTED','APPROVED'),('SUBMITTED','REJECTED'),
     ('SUBMITTED','DRAFT'),('APPROVED','DRAFT'),('APPROVED','APPROVED'),('REJECTED','DRAFT'),('NOT_REQUIRED','NOT_REQUIRED')) THEN
  RAISE EXCEPTION 'Invalid expense approval transition' USING ERRCODE='23514'; END IF;
 IF NEW.approval_status='NOT_REQUIRED' AND OLD.approval_status='DRAFT' AND
    (NEW.data-workflow) IS DISTINCT FROM (OLD.data-workflow) THEN
  RAISE EXCEPTION 'Direct recording freezes the existing draft financial evidence' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION finance_validate_payable() RETURNS trigger LANGUAGE plpgsql AS $$
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
     recognition.metadata->>'payableId'<>pid OR recognition.source_namespace<>'finance.payable' OR recognition.source_reference<>pid THEN
   RAISE EXCEPTION 'Recognition requires the linked payable source' USING ERRCODE='23514'; END IF;
  IF d.approval_status='NOT_REQUIRED' THEN
   IF NOT COALESCE(
      d.data->>'authorizationPolicy'='AUTHORIZED_OWN_BUSINESS_EXPENSE'
      AND d.data->>'authorizedBy'=d.data->>'createdBy'
      AND d.data->>'authorizedBy'=d.data->>'editedBy'
      AND d.data->>'authorizedBy'=recognition.posted_by
      AND d.data->>'authorizedBy'=d.data->>'postedBy'
      AND d.data->>'authorizedAt' IS NOT NULL
      AND d.data->>'approvedBy' IS NULL AND d.data->>'approvedVersion' IS NULL
      AND NOT COALESCE((d.data->>'isReimbursement')::boolean,false)
      AND d.data->'payeeSnapshot'->>'type'<>'EMPLOYEE'
      AND (d.data->>'authorizationLimit' IS NULL OR d.amount<=(d.data->>'authorizationLimit')::numeric)
      AND (recognition.metadata->'authorizationPolicy',recognition.metadata->'authorizedBy',
           recognition.metadata->'authorizedVersion',recognition.metadata->'authorizationLimit',recognition.metadata->'authorizedAt')
          IS NOT DISTINCT FROM
          (d.data->'authorizationPolicy',d.data->'authorizedBy',d.data->'authorizedVersion',d.data->'authorizationLimit',d.data->'authorizedAt')
      AND recognition.metadata->>'approvedVersion' IS NULL
      AND EXISTS (SELECT 1 FROM finance_approval_events a WHERE a.payable_id=pid AND a.action='DIRECT_RECORD'
          AND a.version=(d.data->>'authorizedVersion')::integer AND a.actor=d.data->>'authorizedBy'
          AND a.data->>'financialFingerprint' IS NOT NULL
          AND a.data->>'authorizationPolicy'='AUTHORIZED_OWN_BUSINESS_EXPENSE'), false)
      OR EXISTS (SELECT 1 FROM finance_payees employee WHERE employee.id=d.payee_id AND employee.data->>'type'='EMPLOYEE') THEN
    RAISE EXCEPTION 'Direct recognition requires attributed own-business authorization and immutable decision evidence' USING ERRCODE='23514'; END IF;
  ELSIF d.approval_status<>'APPROVED' OR
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
