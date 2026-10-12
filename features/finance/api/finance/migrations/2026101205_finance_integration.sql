-- Atomic source-owned change evidence. It is an outbox, never another receipt ledger.
CREATE TABLE finance_integration_state (
  id boolean PRIMARY KEY DEFAULT true CHECK(id),
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  baseline_date date NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'Asia/Manila')::date,
  last_sequence bigint NOT NULL DEFAULT 0
);
INSERT INTO finance_integration_state(id) VALUES(true);
CREATE TABLE finance_source_changes (
  sequence bigint PRIMARY KEY,
  source text NOT NULL,
  record_type text NOT NULL,
  record_id text NOT NULL,
  operation text NOT NULL CHECK(operation IN ('BASELINE','INSERT','UPDATE','DELETE')),
  occurred_at timestamptz NOT NULL,
  before_data jsonb,
  after_data jsonb,
  transaction_id text NOT NULL,
  actor text NOT NULL
);
CREATE INDEX finance_change_owner_record ON finance_source_changes(source,record_type,record_id,sequence);
CREATE TABLE finance_source_delivery (
  source text PRIMARY KEY,
  checked_at timestamptz NOT NULL,
  status text NOT NULL,
  sequence bigint,
  message text NOT NULL DEFAULT ''
);
CREATE TABLE finance_source_resolutions (
  sequence bigint PRIMARY KEY REFERENCES finance_source_changes(sequence),
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  authorized_by text NOT NULL,
  data jsonb NOT NULL
);
CREATE TABLE finance_shared_audit_delivery (
  event_id text PRIMARY KEY REFERENCES finance_audit_events(id),
  delivered_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION finance_without_contacts(value jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result jsonb; pair record;
BEGIN
  IF jsonb_typeof(value)='object' THEN
    result='{}'::jsonb;
    FOR pair IN SELECT * FROM jsonb_each(value) LOOP
      IF lower(pair.key) NOT IN ('customer','serviceaccount','contact','contactnumber','customercontactnumber',
           'mobile','mobilenumber','email','phone','smsdestination','password','passwordhash') THEN
        result=result || jsonb_build_object(pair.key,finance_without_contacts(pair.value));
      END IF;
    END LOOP;
    RETURN result;
  ELSIF jsonb_typeof(value)='array' THEN
    SELECT coalesce(jsonb_agg(finance_without_contacts(element)),'[]'::jsonb) INTO result FROM jsonb_array_elements(value) element;
    RETURN result;
  END IF;
  RETURN value;
END $$;

CREATE FUNCTION finance_capture_source_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous jsonb; current_data jsonb; row_id text; row_type text; seq bigint; actor_name text;
BEGIN
  IF TG_OP <> 'INSERT' THEN previous=finance_without_contacts(to_jsonb(OLD)->'data'); END IF;
  IF TG_OP <> 'DELETE' THEN current_data=finance_without_contacts(to_jsonb(NEW)->'data'); END IF;
  IF TG_OP='UPDATE' AND previous IS NOT DISTINCT FROM current_data THEN RETURN NEW; END IF;
  row_id=coalesce(to_jsonb(NEW)->>'record_id',to_jsonb(OLD)->>'record_id',to_jsonb(NEW)->>'id',to_jsonb(OLD)->>'id');
  row_type=coalesce(to_jsonb(NEW)->>'record_type',to_jsonb(OLD)->>'record_type',TG_ARGV[1]);
  actor_name=coalesce(current_data->>'updatedByUsername',current_data->>'voidedByUsername',current_data->>'postedByUsername',
       current_data->>'receivedByUsername',current_data->>'cashierUsername',current_data->>'createdByUsername',
       current_data->>'updatedBy',current_data->>'createdBy','source-database');
  -- A transactional counter serializes commit visibility. A sequence/identity alone
  -- could let a slower transaction commit behind a cursor already delivered.
  UPDATE finance_integration_state SET last_sequence=last_sequence+1 WHERE id RETURNING last_sequence INTO seq;
  INSERT INTO finance_source_changes VALUES(seq,TG_ARGV[0],row_type,row_id,TG_OP,clock_timestamp(),previous,current_data,txid_current()::text,actor_name);
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- Snapshot under the runner transaction's table locks, before installing triggers.
DO $$
DECLARE spec text[]; item record; seq bigint;
BEGIN
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
     ['billing_records','billing'],['pos_records','point-of-sale'],
     ['collector_records','collector'],['service_records','service']]
  LOOP
    EXECUTE format('LOCK TABLE %I IN SHARE ROW EXCLUSIVE MODE',spec[1]);
    FOR item IN EXECUTE format('SELECT record_type,record_id,data FROM %I ORDER BY record_type,record_id',spec[1]) LOOP
      UPDATE finance_integration_state SET last_sequence=last_sequence+1 WHERE id RETURNING last_sequence INTO seq;
      INSERT INTO finance_source_changes VALUES(seq,spec[2],item.record_type,item.record_id,'BASELINE',clock_timestamp(),NULL,
        finance_without_contacts(item.data),txid_current()::text,'integration-baseline');
    END LOOP;
    EXECUTE format('CREATE TRIGGER finance_change_capture AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION finance_capture_source_change(%L,%L)',spec[1],spec[2],'');
  END LOOP;
END $$;

CREATE TRIGGER finance_source_change_immutable BEFORE UPDATE OR DELETE ON finance_source_changes
FOR EACH ROW EXECUTE FUNCTION finance_immutable_event();
CREATE TRIGGER finance_source_resolution_immutable BEFORE UPDATE OR DELETE ON finance_source_resolutions
FOR EACH ROW EXECUTE FUNCTION finance_immutable_event();
