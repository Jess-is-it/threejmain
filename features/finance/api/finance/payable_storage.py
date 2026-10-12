"""Relational Finance payable/evidence repository extension."""
try:
    from psycopg.types.json import Jsonb
except ImportError:
    Jsonb = None

from fastapi import HTTPException


class PayablePostgresRepository:
    def masters(self, kind):
        table = 'finance_payees' if kind == 'payee' else 'finance_categories'
        return [r['data'] for r in self.query(f'SELECT data FROM {table} ORDER BY code')]

    def master(self, kind, record_id):
        record = next((r for r in self.masters(kind) if r['id'] == record_id), None)
        if record is None:
            raise HTTPException(404, 'Payee or category not found')
        return record

    def save_master(self, kind, record):
        table = 'finance_payees' if kind == 'payee' else 'finance_categories'
        if kind == 'payee':
            self.execute(f'''INSERT INTO {table}(id,code,data) VALUES (%s,%s,%s)
                         ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data''',
                         (record['id'], record['code'], Jsonb(record)))
        else:
            self.execute(f'''INSERT INTO {table}(id,code,classification,account_id,data) VALUES (%s,%s,%s,%s,%s)
                         ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data''',
                         (record['id'], record['code'], record['classification'], record['accountId'], Jsonb(record)))

    def payables(self):
        return [r['data'] for r in self.query("SELECT data || jsonb_build_object('number',number) AS data FROM finance_payables ORDER BY number")]

    def payable(self, record_id):
        row = self.query("SELECT data || jsonb_build_object('number',number) AS data FROM finance_payables WHERE id=%s", (record_id,), one=True)
        if not row:
            raise HTTPException(404, 'Expense/payable not found')
        return row['data']

    def save_payable(self, record):
        values=(record['payeeId'],record['categoryId'],record['documentReference'],record['amount'],
                record['expenseDate'],record['approvalStatus'],record['postingStatus'],record['version'],Jsonb(record))
        if 'number' in record:
            row=self.query('''UPDATE finance_payables SET payee_id=%s,category_id=%s,document_reference=%s,
                amount=%s,expense_date=%s,approval_status=%s,posting_status=%s,version=%s,data=%s
                WHERE id=%s RETURNING number''',(*values,record['id']),one=True)
        else:
            row=self.query('''INSERT INTO finance_payables
                (id,payee_id,category_id,document_reference,amount,expense_date,approval_status,posting_status,version,data)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING number''',(record['id'],*values),one=True)
        # The database sequence is evidence, not a user-editable field.
        record['number'] = row['number']
        return record

    def payments(self, payable_id):
        return [r['data'] for r in self.query('SELECT data FROM finance_payments WHERE payable_id=%s ORDER BY created_at,id', (payable_id,))]

    def payment(self, payment_id):
        row = self.query('SELECT data FROM finance_payments WHERE id=%s', (payment_id,), one=True)
        if not row:
            raise HTTPException(404, 'Payable payment not found')
        return row['data']

    def insert_payment(self, r):
        self.execute('''INSERT INTO finance_payments(id,payable_id,account_id,amount,effective_date,source_reference,journal_id,created_at,data)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
                     (r['id'],r['payableId'],r['accountId'],r['amount'],r['effectiveDate'],r['sourceReference'],r['journalId'],r['createdAt'],Jsonb(r)))

    def decision(self, record):
        self.execute('''INSERT INTO finance_approval_events(id,payable_id,version,action,actor,created_at,data)
                        VALUES (%s,%s,%s,%s,%s,%s,%s)''',
                     (record['id'],record['payableId'],record['version'],record['action'],record['actor'],record['createdAt'],Jsonb(record)))

    def decisions(self, payable_id):
        return [r['data'] for r in self.query('SELECT data FROM finance_approval_events WHERE payable_id=%s ORDER BY created_at,id',(payable_id,))]

    def attachments(self, payable_id):
        return [r['data'] for r in self.query('SELECT data FROM finance_attachments WHERE payable_id=%s ORDER BY created_at,id',(payable_id,))]

    def attachment(self, attachment_id):
        row = self.query('SELECT data,content FROM finance_attachments WHERE id=%s', (attachment_id,), one=True)
        if not row:
            raise HTTPException(404, 'Supporting attachment not found')
        return row['data'], bytes(row['content'])

    def save_attachment(self, record, content=None):
        if content is None:
            self.execute('UPDATE finance_attachments SET active=%s,data=%s WHERE id=%s', (record['active'],Jsonb(record),record['id']))
        else:
            self.execute('''INSERT INTO finance_attachments(id,payable_id,content_type,content_hash,content,active,created_at,data)
                            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)''',
                         (record['id'],record['payableId'],record['contentType'],record['sha256'],content,record['active'],record['createdAt'],Jsonb(record)))
