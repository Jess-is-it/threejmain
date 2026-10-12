"""PostgreSQL repository. Schema is prepared by the shared runner, never here."""
import os
from contextlib import contextmanager

from fastapi import HTTPException
from .payable_storage import PayablePostgresRepository
from .income_storage import IncomePostgresRepository
from .report_storage import ReportPostgresRepository
from .memory import CONTROL_IDS

try:
    import psycopg
    from psycopg.rows import dict_row
    from psycopg.types.json import Jsonb
except ImportError:
    psycopg = dict_row = Jsonb = None


def account_record(row):
    gl_type = row['gl_type']
    return {
        **row['data'], 'id': row['id'], 'code': row['code'], 'kind': row['kind'],
        'glType': gl_type, 'normalSide': 'CREDIT' if gl_type in ('LIABILITY','EQUITY','REVENUE') else 'DEBIT',
        'active': row['active'], 'version': row['version'], 'currency': 'PHP',
        'controlledCash': row['kind'] in ('CASH','PETTY_CASH','COMPANY_GCASH','BANK','COLLECTOR_CASH'),
        'system': row['id'] in CONTROL_IDS,
    }


class PostgresRepository(PayablePostgresRepository, IncomePostgresRepository, ReportPostgresRepository):
    def __init__(self, connection):
        self.connection = connection

    @contextmanager
    def savepoint(self):
        try:
            with self.connection.transaction():
                yield self
                self.execute('SET CONSTRAINTS ALL IMMEDIATE')
                self.execute('SET CONSTRAINTS ALL DEFERRED')
        except (psycopg.errors.UniqueViolation,psycopg.errors.CheckViolation,psycopg.errors.ForeignKeyViolation):
            raise HTTPException(409,'Finance source effect violates an identity, balance or journal mapping constraint') from None

    def query(self, sql, args=(), one=False):
        with self.connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(sql, args)
            return cursor.fetchone() if one else cursor.fetchall()

    def execute(self, sql, args=()):
        with self.connection.cursor() as cursor:
            cursor.execute(sql, args)

    def accounts(self):
        return [account_record(r) for r in self.query('SELECT * FROM finance_accounts ORDER BY code')]

    def account(self, account_id):
        row = self.query('SELECT * FROM finance_accounts WHERE id=%s', (account_id,), one=True)
        if not row:
            raise HTTPException(404, 'Financial account not found')
        return account_record(row)

    def save_account(self, record):
        self.execute('''INSERT INTO finance_accounts(id,code,kind,gl_type,active,version,data)
          VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO UPDATE SET
          active=EXCLUDED.active, version=EXCLUDED.version, data=EXCLUDED.data''',
          (record['id'],record['code'],record['kind'],record['glType'],record['active'],record['version'],Jsonb(record)))

    def _entry(self, row):
        lines = self.query('SELECT * FROM finance_journal_lines WHERE entry_id=%s ORDER BY line_number', (row['id'],))
        return {
            'id': row['id'], 'number': row['number'], 'kind': row['kind'],
            'effectiveDate': row['effective_date'].isoformat(), 'postedAt': row['posted_at'].isoformat(),
            'postedBy': row['posted_by'], 'currency': row['currency'], 'reason': row['reason'],
            'sourceNamespace': row['source_namespace'], 'sourceReference': row['source_reference'],
            'fingerprint': row['fingerprint'], 'reversalOfId': row['reversal_of_id'],
            'metadata': row['metadata'], 'status': 'POSTED',
            'lines': [{'accountId': l['account_id'], 'debit': format(l['debit'],'.2f'),
                       'credit': format(l['credit'],'.2f'), 'memo': l['memo'],
                       'accountSnapshot': l['account_snapshot']} for l in lines],
        }

    def entries(self):
        return [self._entry(r) for r in self.query('SELECT * FROM finance_journal_entries WHERE sealed ORDER BY number')]

    def entry(self, entry_id):
        row = self.query('SELECT * FROM finance_journal_entries WHERE id=%s AND sealed', (entry_id,), one=True)
        if not row:
            raise HTTPException(404, 'Journal entry not found')
        return self._entry(row)

    def insert_entry(self, record):
        row = self.query('''INSERT INTO finance_journal_entries
          (id,kind,effective_date,source_namespace,source_reference,fingerprint,posted_at,posted_by,reason,reversal_of_id,metadata)
          VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING number''',
          (record['id'],record['kind'],record['effectiveDate'],record['sourceNamespace'],record['sourceReference'],
           record['fingerprint'],record['postedAt'],record['postedBy'],record['reason'],record['reversalOfId'],Jsonb(record['metadata'])), one=True)
        for i,line in enumerate(record['lines'],1):
            self.execute('''INSERT INTO finance_journal_lines
              (entry_id,line_number,account_id,debit,credit,memo,account_snapshot) VALUES (%s,%s,%s,%s,%s,%s,%s)''',
              (record['id'],i,line['accountId'],line['debit'],line['credit'],line['memo'],Jsonb(line['accountSnapshot'])))
        self.execute('UPDATE finance_journal_entries SET sealed=true WHERE id=%s', (record['id'],))
        return {**record, 'number': row['number']}

    def openings(self):
        return [r['data'] for r in self.query('SELECT data FROM finance_opening_balances ORDER BY id')]

    def opening(self, opening_id):
        row = self.query('SELECT data FROM finance_opening_balances WHERE id=%s', (opening_id,), one=True)
        if not row:
            raise HTTPException(404, 'Opening balance request not found')
        return row['data']

    def save_opening(self, record):
        self.execute('''INSERT INTO finance_opening_balances
          (id,account_id,effective_date,amount,created_by,approved_by,journal_id,data)
          VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO UPDATE SET
          approved_by=EXCLUDED.approved_by,journal_id=EXCLUDED.journal_id,data=EXCLUDED.data''',
          (record['id'],record['accountId'],record['effectiveDate'],record['amount'],record['createdBy'],
           record['approvedBy'],record['journalId'],Jsonb(record)))

    def operation(self, scope, key):
        return self.query('SELECT fingerprint,result FROM finance_operations WHERE scope=%s AND idempotency_key=%s', (scope,key), one=True)

    def save_operation(self, scope, key, fingerprint, result):
        self.execute('INSERT INTO finance_operations(scope,idempotency_key,fingerprint,result) VALUES (%s,%s,%s,%s)', (scope,key,fingerprint,Jsonb(result)))

    def audit(self, event):
        self.execute('INSERT INTO finance_audit_events(id,created_at,actor,action,target_id,data) VALUES (%s,%s,%s,%s,%s,%s)',
          (event['id'],event['createdAt'],event['actor'],event['action'],event['targetId'],Jsonb(event)))

    def periods(self):
        return [r['data'] for r in self.query('SELECT data FROM finance_periods ORDER BY month DESC')]

    def period(self, month):
        row=self.query('SELECT data FROM finance_periods WHERE month=%s',(month,),one=True)
        return row['data'] if row else None

    def save_period(self, record):
        if self.period(record['month']):
            self.execute('UPDATE finance_periods SET status=%s,version=%s,data=%s WHERE month=%s',
                         (record['status'],record['version'],Jsonb(record),record['month']))
        else:
            self.execute('INSERT INTO finance_periods(month,status,version,data) VALUES(%s,%s,%s,%s)',
                         (record['month'],record['status'],record['version'],Jsonb(record)))

    def period_event(self, event):
        self.execute('INSERT INTO finance_period_events(id,month,version,data) VALUES(%s,%s,%s,%s)',
                     (event['id'],event['month'],event['version'],Jsonb(event)))

    def period_events(self, month):
        return [r['data'] for r in self.query('SELECT data FROM finance_period_events WHERE month=%s ORDER BY version',(month,))]


class PostgresStore:
    mode = 'postgres'

    def __init__(self, database_url=None, connection=None):
        self.database_url = database_url if database_url is not None else os.getenv('DATABASE_URL','')
        # Supplied connection participates in the caller transaction using savepoints.
        self.connection = connection

    @contextmanager
    def _connection(self):
        if psycopg is None:
            raise HTTPException(503, 'Finance PostgreSQL driver is unavailable')
        if self.connection is not None:
            yield self.connection
            return
        if not self.database_url:
            raise HTTPException(503, 'Finance PostgreSQL storage is not configured')
        try:
            with psycopg.connect(self.database_url, autocommit=True) as conn:
                yield conn
        except psycopg.OperationalError:
            raise HTTPException(503, 'Finance PostgreSQL storage is unavailable') from None

    def _check_schema(self, repo):
        for table in ('finance_accounts','finance_journal_entries','finance_journal_lines','finance_opening_balances','finance_operations','finance_audit_events',
                      'finance_payees','finance_categories','finance_payables','finance_payments','finance_approval_events','finance_attachments',
                      'finance_income_documents','finance_source_events','finance_source_results','finance_source_claims',
                      'finance_source_checkpoints','finance_reconciliation_exceptions','finance_report_snapshots',
                      'finance_periods','finance_period_events'):
            if repo.query('SELECT to_regclass(%s) AS present', (table,), one=True)['present'] is None:
                raise HTTPException(503, 'Finance foundation/payables/income/report/period migrations have not been registered/applied')

    @contextmanager
    def transaction(self):
        try:
            with self._connection() as conn, conn.transaction():
                repo = PostgresRepository(conn)
                self._check_schema(repo)
                # One database-wide writer lock also protects archive/post races and replay.
                repo.execute("SELECT pg_advisory_xact_lock(hashtext('threejmain.finance.ledger'))")
                yield repo
                constraints='finance_entries_valid,finance_lines_valid,finance_payables_valid,finance_payments_valid,finance_expense_entries_valid,finance_expense_lines_valid,finance_income_entries_valid,finance_income_lines_valid,finance_source_results_valid,finance_income_documents_valid'
                repo.execute(f'SET CONSTRAINTS {constraints} IMMEDIATE')
                repo.execute(f'SET CONSTRAINTS {constraints} DEFERRED')
        except Exception as exc:
            if psycopg is not None and isinstance(exc, (psycopg.errors.UniqueViolation, psycopg.errors.CheckViolation, psycopg.errors.ForeignKeyViolation)):
                raise HTTPException(409, 'Finance posting violates an identity, balance or immutable-ledger constraint') from None
            raise

    @contextmanager
    def read(self):
        with self._connection() as conn, conn.transaction():
            repo = PostgresRepository(conn)
            # Shared lock gives one coherent snapshot across accounts/entries.
            repo.execute("SELECT pg_advisory_xact_lock_shared(hashtext('threejmain.finance.ledger'))")
            self._check_schema(repo)
            yield repo

    def readiness(self):
        try:
            with self.read():
                pass
            return {'mode': self.mode, 'ready': True, 'realDataReady': True}
        except HTTPException as exc:
            return {'mode': self.mode, 'ready': False, 'realDataReady': False, 'reason': exc.detail}
