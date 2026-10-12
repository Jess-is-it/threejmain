"""Opt-in rollback-only PostgreSQL payable and evidence constraints."""
import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date
from threading import Barrier
from unittest.mock import patch
from uuid import uuid4

import test_finance_payables as expenses
from finance.expense_schemas import ExpensePost
from finance.migrations import READINESS_MIGRATIONS, MIGRATIONS
from finance.payables import PayablesService
from finance.storage import PostgresRepository, PostgresStore, psycopg
from fastapi import HTTPException


@unittest.skipUnless(psycopg and os.getenv('FINANCE_TEST_DATABASE_URL'), 'Requires authorized Finance test DSN')
class PayablesPostgresTests(expenses.PayablesTests):
    def setUp(self):
        from psycopg import sql
        self.conn=psycopg.connect(os.environ['FINANCE_TEST_DATABASE_URL'],autocommit=False)
        self.addCleanup(self.conn.close);self.addCleanup(self.conn.rollback)
        schema=f'finance_test_{uuid4().hex}'
        self.conn.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
        self.conn.execute(sql.SQL('SET LOCAL search_path TO {}').format(sql.Identifier(schema)))
        for migration in [*MIGRATIONS,*READINESS_MIGRATIONS]:
            for statement in migration['statements']:self.conn.execute(statement)
        self.store=PostgresStore(connection=self.conn)
        self.service=PayablesService(self.store,today=lambda:date(2026,10,12))

    def sql_rejected(self,statement,args=()):
        with self.assertRaises(psycopg.Error):
            with self.conn.transaction():
                self.conn.execute(statement,args)
                self.conn.execute('SET CONSTRAINTS ALL IMMEDIATE')

    @unittest.skip('Shared rollback-only schema cannot be seen by independent posting workers; memory races and real DB lock contention tested separately')
    def test_concurrent_posting_and_payments_are_atomic_and_idempotent(self):pass

    def test_post_and_payment_failures_roll_back_document_journal_audit_and_replay(self):
        r=self.approved()
        before=self.conn.execute('SELECT count(*) FROM finance_journal_entries').fetchone()[0]
        with patch.object(PostgresRepository,'save_operation',side_effect=RuntimeError('evidence failure')):
            with self.assertRaises(RuntimeError):self.service.post_payable(expenses.CREATOR,r['id'],ExpensePost(version=r['version']),'failed-post')
        self.assertEqual(self.details(r)['postingStatus'],'UNPOSTED')
        self.assertEqual(self.conn.execute('SELECT count(*) FROM finance_journal_entries').fetchone()[0],before)
        self.assertEqual(self.conn.execute("SELECT count(*) FROM finance_operations WHERE scope='payable.post'").fetchone()[0],0)
        r=self.service.post_payable(expenses.CREATOR,r['id'],ExpensePost(version=r['version']),self.key());a=self.funds()
        with patch.object(PostgresRepository,'insert_payment',side_effect=RuntimeError('settlement evidence failure')):
            with self.assertRaises(RuntimeError):self.payment(r,a,key='failed-pay')
        self.assertEqual(self.details(r)['paidAmount'],'0.00');self.assertEqual(self.balance(a['id']),'1000.00')

    def test_sql_cannot_change_posted_amounts_payments_approvals_or_control(self):
        r=self.posted();a=self.funds();p=self.payment(r,a)
        self.sql_rejected('UPDATE finance_payables SET amount=amount+1 WHERE id=%s',(r['id'],))
        self.sql_rejected("UPDATE finance_payables SET data=jsonb_set(data,'{purpose}','\"Changed purpose\"') WHERE id=%s",(r['id'],))
        self.sql_rejected('DELETE FROM finance_payables WHERE id=%s',(r['id'],))
        self.sql_rejected('UPDATE finance_payments SET amount=1 WHERE id=%s',(p['id'],))
        self.sql_rejected('DELETE FROM finance_approval_events WHERE payable_id=%s',(r['id'],))
        self.sql_rejected("UPDATE finance_accounts SET active=false WHERE id='finance-payable-control'")
        self.assertEqual(self.details(r)['paidAmount'],'30.00')

    def test_sql_cannot_mutate_or_delete_supporting_bytes(self):
        r=self.draft();attachment=self.upload(r)
        self.sql_rejected('DELETE FROM finance_attachments WHERE id=%s',(attachment['id'],))
        self.sql_rejected('UPDATE finance_attachments SET content=%s WHERE id=%s',(b'%PDF-changed',attachment['id']))
        r=self.action(self.details(r),'submit')
        self.sql_rejected("UPDATE finance_attachments SET active=false,data=jsonb_set(data,'{active}','false') WHERE id=%s",(attachment['id'],))
        self.assertEqual(self.service.download_attachment(expenses.CREATOR,r['id'],attachment['id'])[1],b'%PDF-1.7\nSupporting document')

    def test_sql_cannot_post_payable_control_without_approved_document(self):
        r=self.draft();a=self.funds()
        with self.assertRaises(psycopg.Error):
            with self.conn.transaction():
                eid=self.key()
                self.conn.execute('''INSERT INTO finance_journal_entries
                    (id,kind,effective_date,source_namespace,source_reference,fingerprint,posted_at,posted_by,reason)
                    VALUES (%s,'JOURNAL','2026-01-01','test',%s,'hash',now(),'test','Bypass payable')''',(eid,eid))
                self.conn.execute('''INSERT INTO finance_journal_lines(entry_id,line_number,account_id,debit,account_snapshot)
                    VALUES (%s,1,'finance-payable-control',1,'{}')''',(eid,))
                self.conn.execute('''INSERT INTO finance_journal_lines(entry_id,line_number,account_id,credit,account_snapshot)
                    VALUES (%s,2,%s,1,'{}')''',(eid,a['id']))
                self.conn.execute('UPDATE finance_journal_entries SET sealed=true WHERE id=%s',(eid,))
                self.conn.execute('SET CONSTRAINTS ALL IMMEDIATE')
        self.assertEqual(self.details(r)['postingStatus'],'UNPOSTED')

    def test_postgres_writer_lock_blocks_independent_worker_during_post(self):
        r=self.posted()
        # The borrowed outer transaction holds the real database writer lock.
        with psycopg.connect(os.environ['FINANCE_TEST_DATABASE_URL'],autocommit=True) as worker:
            with worker.transaction():
                acquired=worker.execute("SELECT pg_try_advisory_xact_lock(hashtext('threejmain.finance.ledger'))").fetchone()[0]
                self.assertFalse(acquired)
        self.assertEqual(self.details(r)['outstandingAmount'],'100.00')

    def test_sql_cannot_over_settle_even_without_service_checks(self):
        r=self.posted();a=self.funds()
        with self.assertRaises(psycopg.Error):
            with self.conn.transaction():
                payment_id=self.key();journal_id=self.key();repo=PostgresRepository(self.conn)
                journal={'id':journal_id,'kind':'JOURNAL','effectiveDate':expenses.DAY,'sourceNamespace':'finance.payable-payment',
                         'sourceReference':payment_id,'fingerprint':'hash','postedAt':'2026-10-12T00:00:00+00:00',
                         'postedBy':expenses.CREATOR.username,'reason':'Excess settlement','reversalOfId':None,
                         'metadata':{'effect':'PAYABLE_PAYMENT','payableId':r['id'],'paymentId':payment_id},
                         'lines':[{'accountId':'finance-payable-control','debit':'100.01','credit':'0.00','memo':'','accountSnapshot':{}},
                                  {'accountId':a['id'],'debit':'0.00','credit':'100.01','memo':'','accountSnapshot':{}}]}
                repo.insert_entry(journal)
                repo.insert_payment({'id':payment_id,'payableId':r['id'],'accountId':a['id'],'amount':'100.01',
                                     'effectiveDate':expenses.DAY,'sourceReference':payment_id,'journalId':journal_id,
                                     'createdAt':'2026-10-12T00:00:00+00:00'})
                self.conn.execute('SET CONSTRAINTS ALL IMMEDIATE')
        self.assertEqual(self.details(r)['paidAmount'],'0.00');self.assertEqual(self.balance(a['id']),'1000.00')


@unittest.skipUnless(psycopg and os.getenv('FINANCE_TEST_DATABASE_URL'), 'Requires authorized Finance test DSN')
class PostgresConcurrentPayablesTests(unittest.TestCase):
    """Visible fixtures exist only in a generated private test schema.

    Unlike rollback-only cases, these briefly commit test fixtures to let real
    worker connections observe each other's writes. Cleanup drops only this
    suite's own generated schema, never public/application tables or a database.
    """
    def setUp(self):
        from psycopg import sql
        self.schema=f'finance_phase3_race_{uuid4().hex}'
        self.conn=psycopg.connect(os.environ['FINANCE_TEST_DATABASE_URL'],autocommit=True)
        self.addCleanup(self.conn.close)
        self.conn.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(self.schema)))
        self.addCleanup(self.cleanup_schema)
        self.conn.execute(sql.SQL('SET search_path TO {}').format(sql.Identifier(self.schema)))
        with self.conn.transaction():
            for migration in [*MIGRATIONS,*READINESS_MIGRATIONS]:
                for statement in migration['statements']:self.conn.execute(statement)
        schema=self.schema
        class WorkerStore(PostgresStore):
            @contextmanager
            def _connection(inner):
                with psycopg.connect(os.environ['FINANCE_TEST_DATABASE_URL'],autocommit=True) as connection:
                    connection.execute(sql.SQL('SET search_path TO {}').format(sql.Identifier(schema)))
                    yield connection
        self.fixture=expenses.PayablesTests()
        self.fixture.store=WorkerStore()
        self.fixture.service=PayablesService(self.fixture.store,today=lambda:date(2026,10,12))

    def cleanup_schema(self):
        from psycopg import sql
        # The only destructible object is the exact UUID namespace we just created.
        if not self.schema.startswith('finance_phase3_race_') or len(self.schema)!=52:
            raise RuntimeError('Refusing cleanup of a non-test namespace')
        self.conn.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(self.schema)))
        self.assertIsNone(self.conn.execute('SELECT to_regnamespace(%s)',(self.schema,)).fetchone()[0])

    def race(self, actions):
        gate=Barrier(len(actions))
        def run(action):
            gate.wait(timeout=10)
            try:return action()
            except HTTPException as exc:return exc.status_code
        with ThreadPoolExecutor(max_workers=len(actions)) as pool:return list(pool.map(run,actions))

    def test_independent_posting_workers_and_competing_partial_payments(self):
        f=self.fixture;r=f.approved();a=f.funds()
        results=self.race([lambda:f.service.post_payable(expenses.CREATOR,r['id'],ExpensePost(version=r['version']),f.key()),
                           lambda:f.service.post_payable(expenses.APPROVER,r['id'],ExpensePost(version=r['version']),f.key())])
        self.assertEqual(len({result['postingJournalId'] for result in results}),1)
        r=results[0]
        competing=self.race([lambda:f.payment(r,a,'60.00',reference='worker-one'),lambda:f.payment(r,a,'60.00',reference='worker-two')])
        self.assertEqual(sum(isinstance(outcome,dict) for outcome in competing),1);self.assertIn(409,competing)
        retries=self.race([lambda:f.payment(r,a,'10.00',reference='shared-source',key='shared-key'),
                           lambda:f.payment(r,a,'10.00',reference='shared-source',key='shared-key')])
        self.assertEqual(retries[0]['id'],retries[1]['id'])
        self.assertEqual(f.details(r)['paidAmount'],'70.00');self.assertEqual(f.balance(a['id']),'930.00')
        self.assertEqual(f.balance(r['categorySnapshot']['accountId']),'100.00')
        self.assertEqual(self.conn.execute("SELECT count(*) FROM finance_journal_entries WHERE source_namespace='finance.payable'").fetchone()[0],1)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM finance_payments').fetchone()[0],2)

    def test_independent_payment_and_archive_workers_preserve_history(self):
        from finance.schemas import AccountAction
        f=self.fixture;r=f.posted();a=f.funds('100.00')
        outcomes=self.race([lambda:f.payment(r,a,'100.00'),lambda:f.service.edit_account(expenses.CREATOR,a['id'],
                           AccountAction(version=a['version'],reason='Close empty drawer'),f.key(),active=False)])
        self.assertTrue(isinstance(outcomes[0],dict))
        self.assertTrue(isinstance(outcomes[1],dict) or outcomes[1]==409)
        self.assertEqual(f.details(r)['settlementStatus'],'PAID');self.assertEqual(f.balance(a['id']),'0.00')
        self.assertEqual(len(f.service.activity(expenses.CREATOR,a['id'])['items']),2)

    def test_independent_transfer_outflows_and_same_key_retry(self):
        from finance.schemas import TransferCreate
        f=self.fixture;a=f.funds('10.00');b=f.account('BANK')
        def transfer(reference,amount,key):
            return f.service.transfer(expenses.CREATOR,TransferCreate(fromAccountId=a['id'],toAccountId=b['id'],
                         effectiveDate=expenses.DAY,amount=amount,sourceReference=reference,reason='Internal drawer settlement',
                         method='CASH_HANDOVER'),key)
        outcomes=self.race([lambda:transfer('outflow-one','6.00',f.key()),lambda:transfer('outflow-two','6.00',f.key())])
        self.assertEqual(sum(isinstance(o,dict) for o in outcomes),1);self.assertIn(409,outcomes)
        retries=self.race([lambda:transfer('same-source','1.00','same-key'),lambda:transfer('same-source','1.00','same-key')])
        self.assertEqual(retries[0]['id'],retries[1]['id'])
        self.assertEqual(f.balance(a['id']),'3.00');self.assertEqual(f.balance(b['id']),'7.00')


if __name__=='__main__':unittest.main()
