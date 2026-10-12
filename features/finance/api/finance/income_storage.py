"""Finance-only durable documents, immutable source inbox/results and exceptions."""
from fastapi import HTTPException

try:
    from psycopg.types.json import Jsonb
except ImportError:
    Jsonb = None


class IncomePostgresRepository:
    def income_documents(self, kind=None):
        sql='SELECT data FROM finance_income_documents'
        args=()
        if kind is not None:sql+=' WHERE kind=%s';args=(kind,)
        return [r['data'] for r in self.query(sql+' ORDER BY id',args)]

    def income_document(self, record_id):
        row=self.query('SELECT data FROM finance_income_documents WHERE id=%s',(record_id,),one=True)
        if not row:raise HTTPException(404,'Income document, mapping or cutover plan not found')
        return row['data']

    def save_income_document(self, r):
        if self.query('SELECT id FROM finance_income_documents WHERE id=%s',(r['id'],),one=True):
            self.execute('UPDATE finance_income_documents SET version=%s,status=%s,data=%s WHERE id=%s',
                         (r['version'],r['status'],Jsonb(r),r['id']))
        else:
            self.execute('''INSERT INTO finance_income_documents(id,kind,version,status,data)
                VALUES (%s,%s,%s,%s,%s)''',(r['id'],r['documentKind'],r['version'],r['status'],Jsonb(r)))

    def source_events(self):
        return [r['data'] for r in self.query('SELECT data FROM finance_source_events ORDER BY received_at,id')]

    def source_event(self, record_id):
        row=self.query('SELECT data FROM finance_source_events WHERE id=%s',(record_id,),one=True)
        if not row:raise HTTPException(404,'Source event not found')
        return row['data']

    def insert_source_event(self,r):
        self.execute('''INSERT INTO finance_source_events(id,source,event_id,fingerprint,effective_date,received_at,data)
            VALUES (%s,%s,%s,%s,%s,%s,%s)''',(r['id'],r['source'],r['eventId'],r['fingerprint'],r['effectiveDate'],r['receivedAt'],Jsonb(r)))

    def source_result(self, record_id):
        row=self.query('SELECT data FROM finance_source_results WHERE id=%s',(record_id,),one=True)
        return row['data'] if row else None

    def source_results(self):
        return [r['data'] for r in self.query('SELECT data FROM finance_source_results ORDER BY id')]

    def insert_source_result(self,r):
        self.execute('''INSERT INTO finance_source_results(id,journal_id,data) VALUES (%s,%s,%s)''',
                     (r['id'],r.get('journalId'),Jsonb(r)))

    def source_claim(self,key):
        row=self.query('SELECT event_id FROM finance_source_claims WHERE claim_key=%s',(key,),one=True)
        return row['event_id'] if row else None

    def insert_source_claim(self,key,event_id):
        self.execute('INSERT INTO finance_source_claims(claim_key,event_id) VALUES (%s,%s)',(key,event_id))

    def checkpoint(self,source):
        row=self.query('SELECT data FROM finance_source_checkpoints WHERE source=%s',(source,),one=True)
        return row['data'] if row else None

    def save_checkpoint(self,r):
        self.execute('''INSERT INTO finance_source_checkpoints(source,version,data) VALUES (%s,%s,%s)
            ON CONFLICT(source) DO UPDATE SET version=EXCLUDED.version,data=EXCLUDED.data''',
                     (r['source'],r['version'],Jsonb(r)))

    def reconciliation_exceptions(self):
        return [r['data'] for r in self.query('SELECT data FROM finance_reconciliation_exceptions ORDER BY id')]

    def save_reconciliation_exception(self,r):
        self.execute('''INSERT INTO finance_reconciliation_exceptions(id,event_id,version,status,data)
            VALUES (%s,%s,%s,%s,%s) ON CONFLICT(id) DO UPDATE SET version=EXCLUDED.version,
            status=EXCLUDED.status,data=EXCLUDED.data''',
                     (r['id'],r['eventId'],r['version'],r['status'],Jsonb(r)))
