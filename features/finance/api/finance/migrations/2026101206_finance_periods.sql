CREATE TABLE finance_periods (
  month text PRIMARY KEY CHECK(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status text NOT NULL CHECK(status IN ('OPEN','CLOSING','CLOSED')),
  version integer NOT NULL CHECK(version>0), data jsonb NOT NULL,
  CHECK(data->>'month'=month AND data->>'status'=status AND (data->>'version')::integer=version)
  ,CHECK(coalesce(length(data->>'preparedBy'),0)>0)
  ,CHECK(status<>'CLOSED' OR coalesce(length(data->>'closedBy'),0)>0)
);
CREATE TABLE finance_period_events (
  id text PRIMARY KEY, month text NOT NULL REFERENCES finance_periods(month),
  version integer NOT NULL, data jsonb NOT NULL, UNIQUE(month,version),
  CHECK(data->>'month'=month AND (data->>'version')::integer=version),
  CHECK(length(data->>'actor')>0 AND data->>'operation' IN ('PREPARE','CLOSE','REOPEN'))
);
ALTER TABLE finance_periods ADD CONSTRAINT finance_period_revision
  FOREIGN KEY(month,version) REFERENCES finance_period_events(month,version) DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION finance_period_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('threejmain.finance.ledger'));
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Period history cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'CLOSING' OR NEW.version<>1 THEN RAISE EXCEPTION 'Prepare a period before closing' USING ERRCODE='23514'; END IF;
  ELSE
    IF NEW.month<>OLD.month OR NEW.version<>OLD.version+1 OR NOT (
      (OLD.status='OPEN' AND NEW.status='CLOSING') OR
      (OLD.status='CLOSING' AND NEW.status IN ('CLOSED','OPEN')) OR
      (OLD.status='CLOSED' AND NEW.status='OPEN')) THEN
      RAISE EXCEPTION 'Invalid financial period transition' USING ERRCODE='23514';
    END IF;
    IF NEW.status='CLOSED' AND (NEW.data->>'closedBy'=OLD.data->>'preparedBy' OR
      (NEW.data-'version'-'status'-'closedBy'-'updatedAt'-'actionReason'-'actionEvidenceReference') IS DISTINCT FROM
      (OLD.data-'version'-'status'-'closedBy'-'updatedAt'-'actionReason'-'actionEvidenceReference')) THEN
      RAISE EXCEPTION 'Close requires independent review of unchanged prepared evidence' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finance_period_state_guard BEFORE INSERT OR UPDATE OR DELETE ON finance_periods
FOR EACH ROW EXECUTE FUNCTION finance_period_state_guard();
CREATE TRIGGER finance_period_event_immutable BEFORE UPDATE OR DELETE ON finance_period_events
FOR EACH ROW EXECUTE FUNCTION finance_immutable_event();

CREATE FUNCTION finance_period_journal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('threejmain.finance.ledger'));
  IF EXISTS(SELECT 1 FROM finance_periods WHERE month=to_char(NEW.effective_date,'YYYY-MM') AND status IN ('CLOSING','CLOSED')) THEN
    RAISE EXCEPTION 'Reopen the financial period before posting a new journal or reversal' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finance_period_journal_guard BEFORE INSERT ON finance_journal_entries
FOR EACH ROW EXECUTE FUNCTION finance_period_journal_guard();
