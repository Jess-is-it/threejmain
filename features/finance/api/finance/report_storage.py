"""Immutable certified report snapshots in the shared database after integration."""
from .income_storage import Jsonb


class ReportPostgresRepository:
    def report_snapshots(self, kind=None):
        if kind is None:rows=self.query('SELECT data FROM finance_report_snapshots ORDER BY received_at,id')
        else:rows=self.query('SELECT data FROM finance_report_snapshots WHERE kind=%s ORDER BY received_at,id',(kind,))
        return [r['data'] for r in rows]

    def insert_report_snapshot(self,r):
        self.execute('''INSERT INTO finance_report_snapshots(id,kind,snapshot_id,fingerprint,received_at,data)
           VALUES (%s,%s,%s,%s,%s,%s)''',(r['id'],r['kind'],r['snapshotId'],r['fingerprint'],r['receivedAt'],Jsonb(r)))
