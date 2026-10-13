-- User-authorized direct starting balances; existing evidence and posted entries stay immutable.
-- Shared registration already consumes Finance MIGRATIONS. No automatic data backfill.
DO $$
DECLARE constraint_name text;
BEGIN
    FOR constraint_name IN SELECT conname FROM pg_constraint
      WHERE conrelid='finance_opening_balances'::regclass AND contype='c'
        AND pg_get_constraintdef(oid) LIKE '%journal_id IS NULL%approved_by IS NOT NULL%'
    LOOP
        EXECUTE format('ALTER TABLE finance_opening_balances DROP CONSTRAINT %I',constraint_name);
    END LOOP;
END $$;
ALTER TABLE finance_opening_balances ADD CONSTRAINT finance_opening_post_authority CHECK (
    journal_id IS NULL OR approved_by IS NOT NULL OR COALESCE(
        data->>'postingPolicy'='AUTHORIZED_ACCOUNT_MANAGER_DECLARATION'
        AND data->>'evidenceType'='OPERATOR_DECLARATION'
        AND data->>'status'='POSTED' AND data->>'approvedBy' IS NULL, false)
);

CREATE OR REPLACE FUNCTION finance_guard_opening() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Opening evidence cannot be deleted' USING ERRCODE='23514'; END IF;
    IF (NEW.id,NEW.account_id,NEW.effective_date,NEW.amount,NEW.created_by) IS DISTINCT FROM
       (OLD.id,OLD.account_id,OLD.effective_date,OLD.amount,OLD.created_by) OR OLD.journal_id IS NOT NULL OR
       (OLD.approved_by IS NOT NULL AND NEW.approved_by IS DISTINCT FROM OLD.approved_by) OR
       (NEW.data - ARRAY['status','approvedBy','approvedAt','approvalReason','journalId','postingPolicy']) IS DISTINCT FROM
       (OLD.data - ARRAY['status','approvedBy','approvedAt','approvalReason','journalId','postingPolicy']) THEN
        RAISE EXCEPTION 'Opening evidence/approval is immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.data->>'postingPolicy' IS DISTINCT FROM OLD.data->>'postingPolicy'
       AND NEW.journal_id IS NULL THEN
        RAISE EXCEPTION 'Posting policy is assigned only with the journal' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION finance_validate_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eid text; e finance_journal_entries%ROWTYPE; line_count integer; total_debit numeric; total_credit numeric;
BEGIN
    IF TG_TABLE_NAME='finance_journal_entries' THEN eid:=NEW.id; ELSE eid:=NEW.entry_id; END IF;
    SELECT * INTO e FROM finance_journal_entries WHERE id=eid;
    SELECT count(*), sum(debit), sum(credit) INTO line_count,total_debit,total_credit
      FROM finance_journal_lines WHERE entry_id=eid;
    IF NOT e.sealed OR line_count < 2 OR total_debit IS DISTINCT FROM total_credit THEN
        RAISE EXCEPTION 'Journal must be sealed with at least two balanced lines' USING ERRCODE='23514';
    END IF;
    IF e.effective_date > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date OR
       (SELECT count(DISTINCT account_id) FROM finance_journal_lines WHERE entry_id=eid) < 2 THEN
        RAISE EXCEPTION 'Journal date/accounts are invalid' USING ERRCODE='23514';
    END IF;
    IF e.kind='OPENING' AND (line_count<>2 OR
       (SELECT count(*) FROM finance_journal_lines WHERE entry_id=eid AND account_id='finance-opening-equity')<>1 OR
       NOT EXISTS (
        SELECT 1 FROM finance_opening_balances o JOIN finance_journal_lines l
        ON l.entry_id=eid AND l.account_id=o.account_id JOIN finance_accounts a ON a.id=o.account_id
        WHERE o.journal_id=eid AND (
            (o.approved_by IS NOT NULL AND o.approved_by<>o.created_by) OR
            (o.approved_by IS NULL AND o.data->>'evidenceType'='OPERATOR_DECLARATION'
             AND o.data->>'postingPolicy'='AUTHORIZED_ACCOUNT_MANAGER_DECLARATION'
             AND o.data->>'status'='POSTED' AND o.data->>'createdBy'=o.created_by
             AND e.source_namespace='finance.opening' AND e.source_reference=o.id
             AND e.metadata->>'openingId'=o.id AND e.metadata->>'declaredBy'=o.created_by
             AND e.metadata->>'postingPolicy'='AUTHORIZED_ACCOUNT_MANAGER_DECLARATION'
             AND e.metadata->>'evidenceType'='OPERATOR_DECLARATION'
             AND e.metadata->>'approvedBy' IS NULL AND e.metadata->>'cashFlowExcluded'='true'
             AND e.metadata->>'incomeEffect'='0.00' AND e.metadata->>'expenseEffect'='0.00')
          )
          AND o.effective_date=e.effective_date AND a.kind<>'GENERAL_LEDGER'
          AND (CASE WHEN a.gl_type='LIABILITY' THEN l.credit-l.debit ELSE l.debit-l.credit END)=o.amount
    )) THEN RAISE EXCEPTION 'Opening requires attributed declaration or independent approval and opening-equity control' USING ERRCODE='23514'; END IF;
    IF e.kind='OPENING' AND EXISTS (
        SELECT o.account_id FROM finance_opening_balances o
        WHERE o.journal_id IS NOT NULL AND NOT EXISTS
          (SELECT 1 FROM finance_journal_entries r WHERE r.reversal_of_id=o.journal_id)
        GROUP BY o.account_id HAVING count(*)>1
    ) THEN RAISE EXCEPTION 'Only one unreversed opening per account' USING ERRCODE='23514'; END IF;
    IF e.kind='TRANSFER' AND (line_count <> 2 OR
        (SELECT count(DISTINCT account_id) FROM finance_journal_lines WHERE entry_id=eid) <> 2 OR
        EXISTS (SELECT 1 FROM finance_journal_lines l JOIN finance_accounts a ON a.id=l.account_id
                WHERE l.entry_id=eid AND a.kind='GENERAL_LEDGER')) THEN
        RAISE EXCEPTION 'Transfers only move funds between distinct financial accounts' USING ERRCODE='23514';
    END IF;
    IF e.kind='REVERSAL' THEN
        IF EXISTS (SELECT 1 FROM finance_journal_entries WHERE id=e.reversal_of_id AND
                   (kind='REVERSAL' OR effective_date>e.effective_date)) OR
           EXISTS (
             SELECT account_id FROM finance_journal_lines
             WHERE entry_id IN (eid,e.reversal_of_id) GROUP BY account_id
             HAVING sum(debit-credit) <> 0
           ) THEN
            RAISE EXCEPTION 'Reversal must offset the original, with a valid effective date' USING ERRCODE='23514';
        END IF;
    END IF;
    -- Daily balances protect both current funds and every backdated day.
    IF EXISTS (
        SELECT 1 FROM (
            SELECT a.id, sum(sum(l.debit-l.credit) * CASE WHEN a.gl_type='LIABILITY' THEN -1 ELSE 1 END)
                     OVER (PARTITION BY a.id ORDER BY j.effective_date) AS balance
            FROM finance_journal_lines l JOIN finance_journal_entries j ON j.id=l.entry_id
                 JOIN finance_accounts a ON a.id=l.account_id
            WHERE a.kind <> 'GENERAL_LEDGER' AND a.id IN
                  (SELECT account_id FROM finance_journal_lines WHERE entry_id=eid)
            GROUP BY a.id, a.gl_type, j.effective_date
        ) b WHERE b.balance < 0
    ) THEN RAISE EXCEPTION 'Posting would create negative funds or overpaid card liability' USING ERRCODE='23514'; END IF;
    RETURN NULL;
END $$;
