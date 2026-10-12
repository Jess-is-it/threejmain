-- Definitions only. Shared integration registers/applies this after 1201/1202.
CREATE TABLE finance_income_documents (
 id text PRIMARY KEY,
 kind text NOT NULL CHECK (kind IN ('MANUAL_INCOME','MAPPING','CUTOVER')),
 version integer NOT NULL CHECK (version>0),
 status text NOT NULL CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','POSTED','REVERSED','ACTIVE','RETIRED')),
 data jsonb NOT NULL,
 CHECK (data->>'id'=id AND data->>'documentKind'=kind AND (data->>'version')::integer=version AND data->>'status'=status),
 CHECK (length(trim(data->>'createdBy'))>0 AND data->>'evidenceReference'<>''),
 CHECK (status NOT IN ('APPROVED','POSTED','REVERSED','ACTIVE','RETIRED') OR
        (data->>'approvedBy' IS NOT NULL AND data->>'approvedBy'<>data->>'createdBy'))
);
CREATE UNIQUE INDEX finance_one_active_cutover ON finance_income_documents(kind) WHERE kind='CUTOVER' AND status='ACTIVE';
CREATE UNIQUE INDEX finance_manual_document_reference ON finance_income_documents(upper(data->>'documentReference')) WHERE kind='MANUAL_INCOME';

CREATE TABLE finance_source_events (
 id text PRIMARY KEY, source text NOT NULL CHECK (source IN ('billing','point-of-sale','collector','service')),
 event_id text NOT NULL, fingerprint text NOT NULL CHECK (length(fingerprint)=64),
 effective_date date NOT NULL, received_at timestamptz NOT NULL, data jsonb NOT NULL,
 UNIQUE(source,event_id),
 CHECK (data->>'id'=id AND data->>'source'=source AND data->>'eventId'=event_id AND
        data->>'fingerprint'=fingerprint AND (data->>'effectiveDate')::date=effective_date)
);
CREATE TABLE finance_source_results (
 id text PRIMARY KEY REFERENCES finance_source_events(id) ON DELETE RESTRICT,
 journal_id text UNIQUE REFERENCES finance_journal_entries(id) ON DELETE RESTRICT,
 data jsonb NOT NULL,
 CHECK (data->>'id'=id AND (data->>'journalId') IS NOT DISTINCT FROM journal_id),
 CHECK ((data->>'status'='POSTED') = (journal_id IS NOT NULL))
);
CREATE TABLE finance_source_claims (
 claim_key text PRIMARY KEY,
 event_id text NOT NULL REFERENCES finance_source_events(id) ON DELETE RESTRICT
);
CREATE TABLE finance_source_checkpoints (
 source text PRIMARY KEY CHECK (source IN ('billing','point-of-sale','collector','service')),
 version integer NOT NULL CHECK (version>0), data jsonb NOT NULL,
 CHECK (data->>'source'=source AND (data->>'version')::integer=version)
);
CREATE TABLE finance_reconciliation_exceptions (
 id text PRIMARY KEY, event_id text NOT NULL REFERENCES finance_source_events(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK (version>0), status text NOT NULL CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
 data jsonb NOT NULL,
 CHECK (data->>'id'=id AND data->>'eventId'=event_id AND data->>'status'=status AND (data->>'version')::integer=version)
);

CREATE FUNCTION finance_guard_income_document() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fields text[];
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('threejmain.finance.ledger'));
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Income/mapping/cutover evidence cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.version<>1 OR NEW.status<>'DRAFT' THEN RAISE EXCEPTION 'Income documents start as version 1 drafts' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF (NEW.id,NEW.kind) IS DISTINCT FROM (OLD.id,OLD.kind) OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'Income document identity/version is immutable' USING ERRCODE='23514'; END IF;
 fields:=ARRAY['classification','documentReference','payerName','effectiveDate','amount','accountId','counterpartAccountId','purpose',
   'settlement','validFrom','validThrough','startDate','throughDate','snapshots','funds','receivables','credits','custody',
   'deferredAmount','baselineFingerprint','evidenceReference','reason','createdBy','createdAt'];
 IF EXISTS (SELECT 1 FROM unnest(fields) f WHERE (NEW.data->f) IS DISTINCT FROM (OLD.data->f)) THEN
  RAISE EXCEPTION 'Financial intake and evidence are immutable; prepare a new reviewed document' USING ERRCODE='23514'; END IF;
 IF OLD.data?'decisions' AND (jsonb_array_length(NEW.data->'decisions')<jsonb_array_length(OLD.data->'decisions') OR
    EXISTS (SELECT 1 FROM jsonb_array_elements(OLD.data->'decisions') WITH ORDINALITY prior(value,n)
            WHERE prior.value IS DISTINCT FROM (NEW.data->'decisions'->(prior.n::integer-1)))) THEN
  RAISE EXCEPTION 'Earlier income review decisions cannot change' USING ERRCODE='23514'; END IF;
 IF OLD.status IN ('APPROVED','POSTED','REVERSED','ACTIVE','RETIRED') AND
    (NEW.data->>'approvedBy',NEW.data->>'approvedAt',NEW.data->>'approvalReason') IS DISTINCT FROM
    (OLD.data->>'approvedBy',OLD.data->>'approvedAt',OLD.data->>'approvalReason') THEN
  RAISE EXCEPTION 'Independent approval evidence is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.kind='MAPPING' AND NEW.status='APPROVED' THEN
  IF EXISTS (SELECT 1 FROM finance_income_documents other WHERE other.kind='MAPPING' AND other.status='APPROVED' AND other.id<>NEW.id AND
      other.data->'settlement'=NEW.data->'settlement' AND
      greatest((other.data->>'validFrom')::date,(NEW.data->>'validFrom')::date)<=
      least(coalesce((other.data->>'validThrough')::date,'9999-12-31'::date),coalesce((NEW.data->>'validThrough')::date,'9999-12-31'::date))) THEN
   RAISE EXCEPTION 'Approved settlement mappings cannot overlap' USING ERRCODE='23514'; END IF;
 END IF;
 IF NOT ((OLD.kind='MANUAL_INCOME' AND (OLD.status,NEW.status) IN
    (('DRAFT','SUBMITTED'),('SUBMITTED','APPROVED'),('SUBMITTED','REJECTED'),('APPROVED','POSTED'),('POSTED','REVERSED')))
    OR (OLD.kind='MAPPING' AND (OLD.status,NEW.status) IN (('DRAFT','APPROVED'),('DRAFT','REJECTED'),('APPROVED','RETIRED')))
    OR (OLD.kind='CUTOVER' AND (OLD.status,NEW.status) IN (('DRAFT','APPROVED'),('DRAFT','REJECTED'),('APPROVED','ACTIVE')))) THEN
  RAISE EXCEPTION 'Invalid income review/posting transition' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER finance_income_document_guard BEFORE INSERT OR UPDATE OR DELETE ON finance_income_documents
FOR EACH ROW EXECUTE FUNCTION finance_guard_income_document();

CREATE TRIGGER finance_source_event_guard BEFORE UPDATE OR DELETE ON finance_source_events FOR EACH ROW EXECUTE FUNCTION finance_immutable_event();
CREATE TRIGGER finance_source_result_guard BEFORE UPDATE OR DELETE ON finance_source_results FOR EACH ROW EXECUTE FUNCTION finance_immutable_event();
CREATE TRIGGER finance_source_claim_guard BEFORE UPDATE OR DELETE ON finance_source_claims FOR EACH ROW EXECUTE FUNCTION finance_immutable_event();

CREATE FUNCTION finance_guard_income_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('threejmain.finance.ledger'));
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Checkpoint/exception evidence cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Projection version must advance once' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='finance_source_checkpoints' THEN
  IF TG_OP='UPDATE' AND
    (NEW.source,NEW.data->>'snapshotId',NEW.data->>'planId') IS DISTINCT FROM (OLD.source,OLD.data->>'snapshotId',OLD.data->>'planId') THEN
   RAISE EXCEPTION 'Checkpoint owner/snapshot/cutover cannot change' USING ERRCODE='23514'; END IF;
 ELSE
  IF TG_OP='UPDATE' AND
   ((NEW.id,NEW.event_id) IS DISTINCT FROM (OLD.id,OLD.event_id) OR OLD.status='RESOLVED' OR
    (NEW.data-ARRAY['version','status','acknowledgedBy','acknowledgedAt','acknowledgementReason','resolvedBy','resolvedAt','resolutionJournalId']) IS DISTINCT FROM
    (OLD.data-ARRAY['version','status','acknowledgedBy','acknowledgedAt','acknowledgementReason','resolvedBy','resolvedAt','resolutionJournalId'])) THEN
   RAISE EXCEPTION 'Exception evidence is immutable; only attributed acknowledgement/resolution is allowed' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER finance_checkpoint_guard BEFORE INSERT OR UPDATE OR DELETE ON finance_source_checkpoints FOR EACH ROW EXECUTE FUNCTION finance_guard_income_projection();
CREATE TRIGGER finance_reconciliation_guard BEFORE INSERT OR UPDATE OR DELETE ON finance_reconciliation_exceptions FOR EACH ROW EXECUTE FUNCTION finance_guard_income_projection();

CREATE OR REPLACE FUNCTION finance_guard_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('threejmain.finance.ledger'));
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Archive accounts; preserve history' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.code,NEW.kind,NEW.gl_type) IS DISTINCT FROM (OLD.id,OLD.code,OLD.kind,OLD.gl_type) THEN
  RAISE EXCEPTION 'Account identity/classification is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.id IN ('finance-opening-equity','finance-payable-control','finance-billing-ar','finance-deferred-service',
      'finance-customer-credit','finance-pos-ar','finance-pos-revenue','finance-pos-discount','finance-sales-tax','finance-custody-variance') THEN
  RAISE EXCEPTION 'System control account is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.active AND NOT NEW.active AND EXISTS (SELECT 1 FROM finance_journal_lines WHERE account_id=OLD.id HAVING COALESCE(sum(debit-credit),0)<>0) THEN
  RAISE EXCEPTION 'Cannot archive a nonzero account' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION finance_validate_income() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eid text; e finance_journal_entries%ROWTYPE; d jsonb; result_row jsonb; expected jsonb; actual jsonb;
        plan jsonb; source_id text;
BEGIN
 IF TG_TABLE_NAME='finance_income_documents' THEN
  SELECT data INTO d FROM finance_income_documents WHERE id=NEW.id;
  IF d->>'status' NOT IN ('ACTIVE','POSTED','REVERSED') THEN RETURN NULL; END IF;
  eid:=d->>'journalId';
 ELSIF TG_TABLE_NAME='finance_source_results' THEN eid:=NEW.journal_id;
 ELSIF TG_TABLE_NAME='finance_journal_lines' THEN eid:=NEW.entry_id;
 ELSE eid:=NEW.id; END IF;
 IF eid IS NOT NULL THEN
  SELECT * INTO e FROM finance_journal_entries WHERE id=eid;
  IF e.source_namespace='finance.manual' AND
     EXISTS (SELECT 1 FROM finance_journal_lines l JOIN finance_accounts a ON a.id=l.account_id WHERE l.entry_id=e.id AND a.kind NOT IN ('GENERAL_LEDGER','CREDIT_CARD') AND l.debit>0) AND
     EXISTS (SELECT 1 FROM finance_journal_lines l JOIN finance_accounts a ON a.id=l.account_id WHERE l.entry_id=e.id AND a.gl_type IN ('REVENUE','LIABILITY','EQUITY') AND l.credit>0) THEN
   RAISE EXCEPTION 'Manual fund inflow requires reviewed income/funding or opening workflow' USING ERRCODE='23514'; END IF;
  source_id:=e.metadata->>'incomeSourceId';
  IF source_id IS NOT NULL THEN
   SELECT data INTO result_row FROM finance_source_results WHERE id=source_id AND journal_id=e.id;
   IF result_row IS NULL THEN RAISE EXCEPTION 'Source journal needs its immutable inbox/result mapping' USING ERRCODE='23514'; END IF;
   expected:=result_row->'journalLines';
   IF result_row->>'status'<>'POSTED' OR (result_row->>'effectiveDate')::date<>e.effective_date THEN
    RAISE EXCEPTION 'Source result/date does not match journal' USING ERRCODE='23514'; END IF;
  ELSIF e.metadata->>'manualIncomeId' IS NOT NULL OR e.metadata->>'cutoverId' IS NOT NULL THEN
   SELECT data INTO d FROM finance_income_documents WHERE id=COALESCE(e.metadata->>'manualIncomeId',e.metadata->>'cutoverId');
   IF d IS NULL OR d->>'approvedBy'=d->>'createdBy' OR d->>'approvedBy' IS NULL OR d->>'status' NOT IN ('POSTED','REVERSED','ACTIVE') THEN
    RAISE EXCEPTION 'Income/opening journal requires independently reviewed document' USING ERRCODE='23514'; END IF;
   IF e.id=d->>'reversalJournalId' THEN expected:=d->'reversalLines';
   ELSIF e.id=d->>'journalId' THEN expected:=d->'journalLines';
   ELSE RAISE EXCEPTION 'Income document has another journal link' USING ERRCODE='23514'; END IF;
   IF d->>'documentKind'='MANUAL_INCOME' AND e.kind<>'REVERSAL' AND
      (e.effective_date<>(d->>'effectiveDate')::date OR
       NOT EXISTS (SELECT 1 FROM finance_journal_lines WHERE entry_id=e.id AND account_id=d->>'accountId' AND debit=(d->>'amount')::numeric AND credit=0) OR
       NOT EXISTS (SELECT 1 FROM finance_journal_lines WHERE entry_id=e.id AND account_id=d->>'counterpartAccountId' AND credit=(d->>'amount')::numeric AND debit=0)) THEN
    RAISE EXCEPTION 'Reviewed manual income amount/date/accounts do not match' USING ERRCODE='23514'; END IF;
   IF d->>'documentKind'='MANUAL_INCOME' AND
     (NOT EXISTS (SELECT 1 FROM finance_accounts WHERE id=d->>'accountId' AND kind NOT IN ('GENERAL_LEDGER','CREDIT_CARD') AND gl_type='ASSET') OR
      NOT EXISTS (SELECT 1 FROM finance_accounts WHERE id=d->>'counterpartAccountId' AND kind='GENERAL_LEDGER' AND
       gl_type=CASE d->>'classification' WHEN 'OTHER_INCOME' THEN 'REVENUE' WHEN 'OWNER_FUNDING' THEN 'EQUITY' WHEN 'LOAN_PROCEEDS' THEN 'LIABILITY' WHEN 'OWNER_LOAN' THEN 'LIABILITY' END
       AND id NOT IN ('finance-opening-equity','finance-payable-control','finance-billing-ar','finance-deferred-service','finance-customer-credit',
          'finance-pos-ar','finance-pos-revenue','finance-pos-discount','finance-sales-tax','finance-custody-variance'))) THEN
    RAISE EXCEPTION 'Manual inflow classification/accounts violate the reviewed financial model' USING ERRCODE='23514'; END IF;
  ELSIF EXISTS (SELECT 1 FROM finance_journal_lines WHERE entry_id=e.id AND account_id IN
      ('finance-billing-ar','finance-deferred-service','finance-customer-credit','finance-pos-ar','finance-pos-revenue','finance-pos-discount','finance-sales-tax','finance-custody-variance')) THEN
   RAISE EXCEPTION 'Source controls require a linked source or cutover journal' USING ERRCODE='23514';
  END IF;
  IF expected IS NOT NULL THEN
   SELECT jsonb_agg(jsonb_build_object('accountId',account_id,'debit',debit,'credit',credit) ORDER BY account_id) INTO actual FROM finance_journal_lines WHERE entry_id=e.id;
   SELECT jsonb_agg(jsonb_build_object('accountId',x->>'accountId','debit',(x->>'debit')::numeric,'credit',(x->>'credit')::numeric) ORDER BY x->>'accountId') INTO expected FROM jsonb_array_elements(expected) x;
   IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Mapped financial effects differ from sealed journal' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 SELECT data INTO plan FROM finance_income_documents WHERE kind='CUTOVER' AND status='ACTIVE';
 IF plan IS NOT NULL THEN
  IF eid IS NOT NULL AND e.metadata->>'cutoverId' IS DISTINCT FROM plan->>'id' AND e.effective_date<(plan->>'startDate')::date THEN
   RAISE EXCEPTION 'Posting overlaps certified cutover opening/history' USING ERRCODE='23514'; END IF;
  IF eid IS NOT NULL AND e.source_namespace='finance.opening' AND EXISTS (
      SELECT 1 FROM finance_journal_lines l JOIN jsonb_array_elements(plan->'funds') f ON f->>'accountId'=l.account_id WHERE l.entry_id=e.id) THEN
   RAISE EXCEPTION 'Certified account cannot receive another opening' USING ERRCODE='23514'; END IF;
  IF EXISTS (
   WITH effects AS (
    SELECT 'ar:'||(b->>'owner')||':'||(b->>'recordId') AS key,(plan->>'throughDate')::date AS day,(b->>'amount')::numeric AS amount FROM jsonb_array_elements(plan->'receivables') b
    UNION ALL SELECT 'deferred:billing:'||(b->>'recordId'),(plan->>'throughDate')::date,(b->>'deferredAmount')::numeric FROM jsonb_array_elements(plan->'receivables') b WHERE b->>'owner'='billing'
    UNION ALL SELECT 'credit:'||(b->>'kind')||':'||(b->>'recordId'),(plan->>'throughDate')::date,(b->>'amount')::numeric FROM jsonb_array_elements(plan->'credits') b
    UNION ALL SELECT x->>'key',(r.data->>'effectiveDate')::date,(x->>'amount')::numeric FROM finance_source_results r CROSS JOIN LATERAL jsonb_array_elements(r.data->'obligationEffects') x
   ), daily AS (SELECT key,day,sum(amount) AS amount FROM effects GROUP BY key,day),
   balances AS (SELECT sum(amount) OVER (PARTITION BY key ORDER BY day) AS balance FROM daily)
   SELECT 1 FROM balances WHERE balance<0
  ) THEN RAISE EXCEPTION 'Source obligation or original credit is over-settled historically' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER finance_income_entries_valid AFTER INSERT OR UPDATE ON finance_journal_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_validate_income();
CREATE CONSTRAINT TRIGGER finance_income_lines_valid AFTER INSERT ON finance_journal_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_validate_income();
CREATE CONSTRAINT TRIGGER finance_source_results_valid AFTER INSERT ON finance_source_results DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_validate_income();
CREATE CONSTRAINT TRIGGER finance_income_documents_valid AFTER INSERT OR UPDATE ON finance_income_documents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_validate_income();

INSERT INTO finance_accounts(id,code,kind,gl_type,active,version,data)
SELECT a.id,a.code,'GENERAL_LEDGER',a.gl_type,true,1,
 jsonb_build_object('name',a.name,'custodian','','notes','Source-owned Finance control; no manual posting',
 'createdBy','migration','updatedBy','migration','createdAt','2026-10-12T00:00:00Z','updatedAt','2026-10-12T00:00:00Z','archivedAt',NULL)
FROM (VALUES
 ('finance-billing-ar','BILLING_AR','Billing receivable control','ASSET'),
 ('finance-deferred-service','DEFERRED_SERVICE','Deferred service consideration','LIABILITY'),
 ('finance-customer-credit','CUSTOMER_CREDIT','Customer advance and rebate credit control','LIABILITY'),
 ('finance-pos-ar','POS_AR','Register sale receivable control','ASSET'),
 ('finance-pos-revenue','POS_REVENUE','Delivered register sale revenue','REVENUE'),
 ('finance-pos-discount','POS_DISCOUNT','Register sale discounts','CONTRA_REVENUE'),
 ('finance-sales-tax','SALES_TAX','Sales tax collected liability','LIABILITY'),
 ('finance-custody-variance','CUSTODY_VARIANCE','Unclassified collector discrepancy clearing','ASSET')
) a(id,code,name,gl_type);
