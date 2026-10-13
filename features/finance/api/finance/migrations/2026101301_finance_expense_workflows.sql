-- Append-only extension: earlier applied migrations retain their checksums.
CREATE TABLE finance_card_statements (
 id text PRIMARY KEY,
 account_id text NOT NULL REFERENCES finance_accounts(id),
 statement_reference text NOT NULL,
 period_end date NOT NULL,
 amount numeric(18,2) NOT NULL CHECK (amount>0),
 data jsonb NOT NULL,
 UNIQUE(account_id,statement_reference),
 CHECK (data->>'id'=id AND data->>'accountId'=account_id
        AND (data->>'statementBalance')::numeric=amount
        AND (data->>'periodEnd')::date=period_end)
);
CREATE TABLE finance_card_repayments (
 id text PRIMARY KEY,
 statement_id text NOT NULL REFERENCES finance_card_statements(id),
 journal_id text NOT NULL UNIQUE REFERENCES finance_journal_entries(id),
 from_account_id text NOT NULL REFERENCES finance_accounts(id),
 amount numeric(18,2) NOT NULL CHECK (amount>0),
 effective_date date NOT NULL,
 data jsonb NOT NULL,
 CHECK (data->>'id'=id AND data->>'cardStatementId'=statement_id
        AND data->>'journalId'=journal_id AND data->>'fromAccountId'=from_account_id
        AND (data->>'amount')::numeric=amount AND (data->>'effectiveDate')::date=effective_date)
);
CREATE TRIGGER finance_card_statement_immutable BEFORE UPDATE OR DELETE ON finance_card_statements
 FOR EACH ROW EXECUTE FUNCTION finance_immutable_event();
CREATE TRIGGER finance_card_repayment_immutable BEFORE UPDATE OR DELETE ON finance_card_repayments
 FOR EACH ROW EXECUTE FUNCTION finance_immutable_event();

CREATE FUNCTION finance_guard_card_statement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous finance_card_statements%ROWTYPE; row jsonb; total numeric:=0; last_day date;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('threejmain.finance.ledger'));
 IF NOT EXISTS (SELECT 1 FROM finance_accounts WHERE id=NEW.account_id AND kind='CREDIT_CARD' AND active)
    OR (NEW.data->>'periodStart')::date>NEW.period_end OR (NEW.data->>'dueDate')::date<NEW.period_end
    OR length(COALESCE(NEW.data->>'evidenceReference',''))=0 THEN
  RAISE EXCEPTION 'Card statement requires a named active card and valid dates/evidence' USING ERRCODE='23514'; END IF;
 SELECT * INTO previous FROM finance_card_statements WHERE account_id=NEW.account_id
  ORDER BY period_end DESC,data->>'createdAt' DESC,id DESC LIMIT 1;
 IF NEW.data->>'correctsStatementId' IS NOT NULL THEN
  IF previous.id IS NULL OR NEW.data->>'correctsStatementId'<>previous.id OR NEW.period_end<>previous.period_end
      OR length(COALESCE(NEW.data->>'correctionReason',''))<3 THEN
   RAISE EXCEPTION 'Card statement correction must replace latest retained evidence' USING ERRCODE='23514'; END IF;
 ELSIF previous.id IS NOT NULL AND NEW.period_end<=previous.period_end THEN
  RAISE EXCEPTION 'Card statements must advance their closing date' USING ERRCODE='23514'; END IF;
 IF jsonb_array_length(NEW.data->'installments')>0 THEN
  IF jsonb_array_length(NEW.data->'installments') NOT BETWEEN 2 AND 120 THEN
   RAISE EXCEPTION 'Invalid card installment count' USING ERRCODE='23514'; END IF;
  FOR row IN SELECT value FROM jsonb_array_elements(NEW.data->'installments') LOOP
   IF (row->>'amount')::numeric<=0 OR (row->>'amount')::numeric<>round((row->>'amount')::numeric,2)
      OR (last_day IS NOT NULL AND (row->>'dueDate')::date<=last_day)
      OR (row->>'dueDate')::date<(NEW.data->>'dueDate')::date THEN
    RAISE EXCEPTION 'Invalid card installment terms' USING ERRCODE='23514'; END IF;
   total:=total+(row->>'amount')::numeric;last_day:=(row->>'dueDate')::date;
  END LOOP;
  IF total<>NEW.amount OR NEW.data->'installments'->0->>'dueDate' IS DISTINCT FROM NEW.data->>'dueDate' THEN
   RAISE EXCEPTION 'Card installments must reconcile to statement amount and first due date' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER finance_card_statement_valid BEFORE INSERT ON finance_card_statements
 FOR EACH ROW EXECUTE FUNCTION finance_guard_card_statement();

CREATE FUNCTION finance_validate_card_effect() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e finance_journal_entries%ROWTYPE; p finance_card_repayments%ROWTYPE;
        s finance_card_statements%ROWTYPE; card_id text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('threejmain.finance.ledger'));
 IF TG_TABLE_NAME='finance_card_repayments' THEN SELECT * INTO e FROM finance_journal_entries WHERE id=NEW.journal_id;
 ELSE SELECT * INTO e FROM finance_journal_entries WHERE id=NEW.id; END IF;
 SELECT * INTO p FROM finance_card_repayments WHERE journal_id=COALESCE(e.reversal_of_id,e.id);
 IF p.id IS NULL AND e.metadata->>'cardStatementId' IS NULL AND e.source_namespace<>'finance.card-repayment' THEN RETURN NULL; END IF;
 SELECT * INTO s FROM finance_card_statements WHERE id=p.statement_id;
 IF s.id IS NULL OR p.id IS NULL OR p.statement_id<>s.id THEN
  RAISE EXCEPTION 'Card effect requires retained statement and repayment mapping' USING ERRCODE='23514'; END IF;
 card_id:=s.account_id;
 IF e.kind='REVERSAL' THEN
  IF e.reversal_of_id<>p.journal_id THEN
   RAISE EXCEPTION 'Card reversal must retain its original repayment link' USING ERRCODE='23514'; END IF;
 ELSE
  IF e.id<>p.journal_id OR e.kind<>'TRANSFER' OR e.source_namespace NOT IN ('finance.card-repayment','finance.transfer')
     OR e.metadata->>'method' IS DISTINCT FROM 'CARD_SETTLEMENT'
     OR (e.source_namespace='finance.card-repayment' AND
          (e.metadata->>'cardStatementId' IS DISTINCT FROM s.id OR e.metadata->>'cardRepaymentId' IS DISTINCT FROM p.id))
     OR e.source_reference IS DISTINCT FROM p.data->>'sourceReference'
     OR e.effective_date<>p.effective_date OR e.effective_date<s.period_end
     OR (SELECT count(*) FROM finance_journal_lines WHERE entry_id=e.id)<>2
     OR NOT EXISTS (SELECT 1 FROM finance_journal_lines l JOIN finance_accounts a ON a.id=l.account_id
         WHERE l.entry_id=e.id AND l.account_id=card_id AND a.kind='CREDIT_CARD' AND l.debit=p.amount AND l.credit=0)
     OR NOT EXISTS (SELECT 1 FROM finance_journal_lines l JOIN finance_accounts a ON a.id=l.account_id
         WHERE l.entry_id=e.id AND l.account_id=p.from_account_id AND a.kind NOT IN ('GENERAL_LEDGER','CREDIT_CARD')
           AND l.credit=p.amount AND l.debit=0) THEN
   RAISE EXCEPTION 'Card repayment must reduce liability and funding account without expense' USING ERRCODE='23514'; END IF;
 END IF;
 IF EXISTS (SELECT 1 FROM (
  SELECT sum(sum(l.debit-l.credit)) OVER (ORDER BY j.effective_date) AS settled
  FROM finance_journal_entries j JOIN finance_journal_lines l ON l.entry_id=j.id
   JOIN finance_card_repayments payment ON payment.journal_id=COALESCE(j.reversal_of_id,j.id)
  WHERE payment.statement_id=s.id AND l.account_id=card_id GROUP BY j.effective_date
 ) totals WHERE settled<0 OR settled>s.amount) THEN
  RAISE EXCEPTION 'Card statement settlement exceeds its historical balance' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER finance_card_entries_valid AFTER INSERT ON finance_journal_entries
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_validate_card_effect();
CREATE CONSTRAINT TRIGGER finance_card_payments_valid AFTER INSERT ON finance_card_repayments
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_validate_card_effect();

CREATE FUNCTION finance_validate_expense_plan() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE terms jsonb; row jsonb; total numeric:=0; previous date; day date; arrangement text;
BEGIN
 IF NEW.data->>'paymentArrangement' IS NULL THEN RETURN NEW; END IF; -- retained legacy documents
 arrangement:=NEW.data->>'paymentArrangement'; terms:=NEW.data->'installments';
 IF arrangement NOT IN ('PAY_LATER','INSTALLMENTS','ALREADY_PAID') OR jsonb_typeof(terms)<>'array' THEN
  RAISE EXCEPTION 'Invalid expense payment arrangement' USING ERRCODE='23514'; END IF;
 IF arrangement='INSTALLMENTS' THEN
  IF jsonb_array_length(terms)<2 OR jsonb_array_length(terms)>120 THEN
   RAISE EXCEPTION 'Expense plan requires two to 120 installments' USING ERRCODE='23514'; END IF;
  FOR row IN SELECT value FROM jsonb_array_elements(terms) LOOP
   day:=(row->>'dueDate')::date;
   IF (row->>'amount')::numeric<=0 OR (row->>'amount')::numeric<>round((row->>'amount')::numeric,2)
       OR day<NEW.expense_date OR day<(NEW.data->>'documentDate')::date OR (previous IS NOT NULL AND day<=previous) THEN
    RAISE EXCEPTION 'Invalid installment dates or amounts' USING ERRCODE='23514'; END IF;
   total:=total+(row->>'amount')::numeric;previous:=day;
  END LOOP;
  IF total<>NEW.amount OR NEW.data->>'dueDate' IS DISTINCT FROM terms->0->>'dueDate' THEN
   RAISE EXCEPTION 'Installments must reconcile to the expense amount and first due date' USING ERRCODE='23514'; END IF;
 ELSIF jsonb_array_length(terms)<>0 THEN
  RAISE EXCEPTION 'Installments require installment arrangement' USING ERRCODE='23514'; END IF;
 IF (arrangement='ALREADY_PAID') IS DISTINCT FROM (COALESCE(jsonb_typeof(NEW.data->'paidDetails'),'null')='object') THEN
  RAISE EXCEPTION 'Already-paid expense must retain intended payment evidence' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER finance_expense_plan_valid BEFORE INSERT OR UPDATE ON finance_payables
 FOR EACH ROW EXECUTE FUNCTION finance_validate_expense_plan();
