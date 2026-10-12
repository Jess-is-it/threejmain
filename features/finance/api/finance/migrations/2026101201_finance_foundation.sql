-- Module-local definition only: register with the shared runner in a later phase.
CREATE TABLE finance_accounts (
    id text PRIMARY KEY,
    code text NOT NULL UNIQUE CHECK (code = upper(code) AND code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
    kind text NOT NULL CHECK (kind IN ('CASH','PETTY_CASH','COMPANY_GCASH','BANK','COLLECTOR_CASH','COLLECTOR_GCASH','CREDIT_CARD','GENERAL_LEDGER')),
    gl_type text NOT NULL CHECK (gl_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','CONTRA_REVENUE','EXPENSE')),
    active boolean NOT NULL DEFAULT true,
    version integer NOT NULL CHECK (version >= 1),
    data jsonb NOT NULL,
    CHECK ((kind = 'CREDIT_CARD' AND gl_type = 'LIABILITY') OR kind = 'GENERAL_LEDGER' OR
           (kind NOT IN ('CREDIT_CARD','GENERAL_LEDGER') AND gl_type = 'ASSET'))
);

CREATE TABLE finance_journal_entries (
    id text PRIMARY KEY,
    number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    kind text NOT NULL CHECK (kind IN ('JOURNAL','OPENING','TRANSFER','REVERSAL')),
    effective_date date NOT NULL,
    source_namespace text NOT NULL,
    source_reference text NOT NULL CHECK (length(trim(source_reference)) BETWEEN 1 AND 160),
    fingerprint text NOT NULL,
    posted_at timestamptz NOT NULL,
    posted_by text NOT NULL CHECK (length(trim(posted_by)) > 0),
    reason text NOT NULL CHECK (length(trim(reason)) >= 3),
    currency text NOT NULL DEFAULT 'PHP' CHECK (currency = 'PHP'),
    reversal_of_id text UNIQUE REFERENCES finance_journal_entries(id) ON DELETE RESTRICT,
    metadata jsonb NOT NULL DEFAULT '{}',
    sealed boolean NOT NULL DEFAULT false,
    UNIQUE (source_namespace, source_reference),
    CHECK ((kind = 'REVERSAL') = (reversal_of_id IS NOT NULL))
);

CREATE TABLE finance_journal_lines (
    entry_id text NOT NULL REFERENCES finance_journal_entries(id) ON DELETE RESTRICT,
    line_number integer NOT NULL CHECK (line_number > 0),
    account_id text NOT NULL REFERENCES finance_accounts(id) ON DELETE RESTRICT,
    debit numeric(18,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit numeric(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
    memo text NOT NULL DEFAULT '',
    account_snapshot jsonb NOT NULL,
    PRIMARY KEY (entry_id, line_number),
    CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);
CREATE INDEX finance_lines_account_idx ON finance_journal_lines(account_id, entry_id);
CREATE INDEX finance_entries_effective_idx ON finance_journal_entries(effective_date, number);

CREATE TABLE finance_opening_balances (
    id text PRIMARY KEY,
    account_id text NOT NULL REFERENCES finance_accounts(id) ON DELETE RESTRICT,
    effective_date date NOT NULL,
    amount numeric(18,2) NOT NULL CHECK (amount > 0),
    created_by text NOT NULL,
    approved_by text,
    journal_id text UNIQUE REFERENCES finance_journal_entries(id) ON DELETE RESTRICT,
    data jsonb NOT NULL,
    CHECK (approved_by IS NULL OR approved_by <> created_by),
    CHECK (journal_id IS NULL OR approved_by IS NOT NULL)
);

CREATE TABLE finance_operations (
    scope text NOT NULL,
    idempotency_key text NOT NULL CHECK (length(trim(idempotency_key)) BETWEEN 1 AND 160),
    fingerprint text NOT NULL,
    result jsonb NOT NULL,
    PRIMARY KEY (scope, idempotency_key)
);
CREATE TABLE finance_audit_events (
    id text PRIMARY KEY,
    created_at timestamptz NOT NULL,
    actor text NOT NULL,
    action text NOT NULL,
    target_id text NOT NULL,
    data jsonb NOT NULL
);

-- A sealed header can never change. The only update during assembly is sealing.
CREATE FUNCTION finance_guard_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM pg_advisory_xact_lock(hashtext('threejmain.finance.ledger'));
        IF NEW.sealed THEN RAISE EXCEPTION 'Journal must be assembled before sealing' USING ERRCODE='23514'; END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND NOT OLD.sealed AND NEW.sealed AND
       (to_jsonb(NEW) - 'sealed') = (to_jsonb(OLD) - 'sealed') THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Posted journal entries are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER finance_entry_guard BEFORE INSERT OR UPDATE OR DELETE ON finance_journal_entries
FOR EACH ROW EXECUTE FUNCTION finance_guard_entry();

CREATE FUNCTION finance_guard_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_sealed boolean; account_active boolean;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Journal lines are immutable' USING ERRCODE='23514';
    END IF;
    SELECT sealed INTO parent_sealed FROM finance_journal_entries WHERE id=NEW.entry_id FOR UPDATE;
    IF parent_sealed THEN RAISE EXCEPTION 'Cannot add lines to a posted journal' USING ERRCODE='23514'; END IF;
    SELECT active INTO account_active FROM finance_accounts WHERE id=NEW.account_id FOR SHARE;
    IF NOT account_active THEN RAISE EXCEPTION 'Account is archived' USING ERRCODE='23514'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER finance_line_guard BEFORE INSERT OR UPDATE OR DELETE ON finance_journal_lines
FOR EACH ROW EXECUTE FUNCTION finance_guard_line();

CREATE FUNCTION finance_validate_entry() RETURNS trigger LANGUAGE plpgsql AS $$
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
        WHERE o.journal_id=eid AND o.approved_by IS NOT NULL AND o.approved_by<>o.created_by
          AND o.effective_date=e.effective_date AND a.kind<>'GENERAL_LEDGER'
          AND (CASE WHEN a.gl_type='LIABILITY' THEN l.credit-l.debit ELSE l.debit-l.credit END)=o.amount
    )) THEN RAISE EXCEPTION 'Opening requires independent approval and opening-equity control' USING ERRCODE='23514'; END IF;
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
CREATE CONSTRAINT TRIGGER finance_entries_valid AFTER INSERT OR UPDATE ON finance_journal_entries
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_validate_entry();
CREATE CONSTRAINT TRIGGER finance_lines_valid AFTER INSERT ON finance_journal_lines
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_validate_entry();

CREATE FUNCTION finance_guard_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('threejmain.finance.ledger'));
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Archive accounts; preserve history' USING ERRCODE='23514'; END IF;
    IF (NEW.id,NEW.code,NEW.kind,NEW.gl_type) IS DISTINCT FROM (OLD.id,OLD.code,OLD.kind,OLD.gl_type) THEN
        RAISE EXCEPTION 'Account identity/classification is immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.id='finance-opening-equity' THEN RAISE EXCEPTION 'System control account is immutable' USING ERRCODE='23514'; END IF;
    IF OLD.active AND NOT NEW.active AND EXISTS (
        SELECT 1 FROM finance_journal_lines WHERE account_id=OLD.id
        HAVING COALESCE(sum(debit-credit),0) <> 0
    ) THEN RAISE EXCEPTION 'Cannot archive a nonzero account' USING ERRCODE='23514'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER finance_account_guard BEFORE UPDATE OR DELETE ON finance_accounts
FOR EACH ROW EXECUTE FUNCTION finance_guard_account();

CREATE FUNCTION finance_guard_opening() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Opening evidence cannot be deleted' USING ERRCODE='23514'; END IF;
    IF (NEW.id,NEW.account_id,NEW.effective_date,NEW.amount,NEW.created_by) IS DISTINCT FROM
       (OLD.id,OLD.account_id,OLD.effective_date,OLD.amount,OLD.created_by) OR OLD.journal_id IS NOT NULL OR
       (OLD.approved_by IS NOT NULL AND NEW.approved_by IS DISTINCT FROM OLD.approved_by) OR
       (NEW.data - ARRAY['status','approvedBy','approvedAt','approvalReason','journalId']) IS DISTINCT FROM
       (OLD.data - ARRAY['status','approvedBy','approvedAt','approvalReason','journalId']) THEN
        RAISE EXCEPTION 'Opening evidence/approval is immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER finance_opening_guard BEFORE UPDATE OR DELETE ON finance_opening_balances
FOR EACH ROW EXECUTE FUNCTION finance_guard_opening();

CREATE FUNCTION finance_immutable_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Finance posting evidence is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER finance_operation_guard BEFORE UPDATE OR DELETE ON finance_operations
FOR EACH ROW EXECUTE FUNCTION finance_immutable_event();
CREATE TRIGGER finance_audit_guard BEFORE UPDATE OR DELETE ON finance_audit_events
FOR EACH ROW EXECUTE FUNCTION finance_immutable_event();

INSERT INTO finance_accounts(id,code,kind,gl_type,version,data) VALUES (
 'finance-opening-equity','OPENING_EQUITY','GENERAL_LEDGER','EQUITY',1,
 '{"name":"Opening balance equity control","custodian":"","notes":"","system":true,"createdBy":"migration","updatedBy":"migration","createdAt":"2026-10-12T00:00:00+00:00","updatedAt":"2026-10-12T00:00:00+00:00","archivedAt":null}'
);
