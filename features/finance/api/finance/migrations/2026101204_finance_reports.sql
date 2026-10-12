-- Certified read projections only; source-owner records and journal remain authoritative.
CREATE TABLE finance_report_snapshots (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('subscribers','billing-settlement','billing-receivables','financial-coverage')),
    snapshot_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
    received_at TIMESTAMPTZ NOT NULL,
    data JSONB NOT NULL,
    UNIQUE(kind,snapshot_id),
    CHECK (COALESCE((data->>'id'=id AND data->>'kind'=kind AND data->>'snapshotId'=snapshot_id
        AND data->>'fingerprint'=fingerprint AND jsonb_typeof(data->'evidence')='object'
        AND data->'evidence'->>'kind'=kind AND data->'evidence'->>'snapshotId'=snapshot_id
        AND length(data->>'receivedBy')>0),FALSE))
);
CREATE INDEX finance_report_snapshots_kind_time ON finance_report_snapshots(kind,received_at);
CREATE TRIGGER finance_report_snapshot_immutable BEFORE UPDATE OR DELETE ON finance_report_snapshots
    FOR EACH ROW EXECUTE FUNCTION finance_immutable_event();
