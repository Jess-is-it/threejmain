"""Opt-in PostgreSQL tests. Every schema and row is rolled back, never deployed.

Set FINANCE_TEST_DATABASE_URL only to an authorized test database. This suite
does not run the shared runner, commit schema changes, bind ports or drop tables.
"""
import os
import unittest
from uuid import uuid4
from unittest.mock import patch

import test_finance_foundation as foundation
from finance.ledger import FinanceService
from finance.migrations import READINESS_MIGRATIONS, MIGRATIONS
from finance.storage import PostgresStore, PostgresRepository, psycopg
from finance.schemas import Reversal


@unittest.skipUnless(psycopg and os.getenv('FINANCE_TEST_DATABASE_URL'), 'Requires explicit Finance PostgreSQL test DSN')
class FinancePostgresTests(foundation.FinanceFoundationTests):
    def setUp(self):
        from psycopg import sql
        from datetime import date
        self.conn=psycopg.connect(os.environ['FINANCE_TEST_DATABASE_URL'],autocommit=False)
        self.addCleanup(self.conn.close)
        self.addCleanup(self.conn.rollback)
        schema=f'finance_test_{uuid4().hex}'
        self.conn.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
        self.conn.execute(sql.SQL('SET LOCAL search_path TO {}').format(sql.Identifier(schema)))
        for migration in [*MIGRATIONS,*READINESS_MIGRATIONS]:
            for statement in migration['statements']:self.conn.execute(statement)
        self.store=PostgresStore(connection=self.conn)
        self.service=FinanceService(self.store,today=lambda:date(2026,10,12))

    def test_atomic_rollback_includes_journal_operation_and_audit(self):
        a=self.account();b=self.account('SECOND');self.opening(a)
        before=self.conn.execute('SELECT count(*) FROM finance_audit_events').fetchone()[0]
        with patch.object(PostgresRepository,'save_operation',side_effect=RuntimeError('failed posting evidence')):
            with self.assertRaises(RuntimeError):self.transfer(a,b)
        self.assertEqual(self.balance(a),'1000.00');self.assertEqual(self.balance(b),'0.00')
        self.assertEqual(self.conn.execute('SELECT count(*) FROM finance_audit_events').fetchone()[0],before)
        self.assertEqual(self.conn.execute("SELECT count(*) FROM finance_operations WHERE scope='transfer.post'").fetchone()[0],0)

    @unittest.skip('Rollback-only schema is invisible to independent workers; concurrent service invariants run in isolated memory')
    def test_simultaneous_outflows_and_retry_prevent_overpayment(self):pass

    def rejected_sql(self,statement,args=()):
        with self.assertRaises(psycopg.Error):
            with self.conn.transaction():self.conn.execute(statement,args)

    def test_database_rejects_header_line_mutation_and_additional_lines(self):
        a=self.account();e=self.opening(a)
        self.rejected_sql('UPDATE finance_journal_entries SET reason=%s WHERE id=%s',('Changed history',e['id']))
        self.rejected_sql('DELETE FROM finance_journal_entries WHERE id=%s',(e['id'],))
        self.rejected_sql('UPDATE finance_journal_lines SET debit=999 WHERE entry_id=%s',(e['id'],))
        self.rejected_sql('DELETE FROM finance_journal_lines WHERE entry_id=%s',(e['id'],))
        self.rejected_sql('''INSERT INTO finance_journal_lines(entry_id,line_number,account_id,debit,account_snapshot)
                             VALUES (%s,3,%s,1,'{}')''',(e['id'],a['id']))
        self.assertEqual(self.balance(a),'1000.00')

    def test_database_rejects_unbalanced_empty_unsealed_and_bad_transfer(self):
        a=self.account();b=self.account('BANK','BANK')
        for scenario in ('unbalanced','empty','unsealed','bad-transfer'):
            with self.assertRaises(psycopg.Error):
                with self.conn.transaction():
                    eid=str(uuid4());kind='TRANSFER' if scenario=='bad-transfer' else 'JOURNAL'
                    self.conn.execute('''INSERT INTO finance_journal_entries
                        (id,kind,effective_date,source_namespace,source_reference,fingerprint,posted_at,posted_by,reason)
                        VALUES (%s,%s,'2026-01-01','test',%s,'hash',now(),'test','Bad journal')''',(eid,kind,eid))
                    if scenario!='empty':
                        self.conn.execute('''INSERT INTO finance_journal_lines(entry_id,line_number,account_id,debit,account_snapshot)
                            VALUES (%s,1,%s,1,'{}')''',(eid,a['id']))
                        self.conn.execute('''INSERT INTO finance_journal_lines(entry_id,line_number,account_id,credit,account_snapshot)
                            VALUES (%s,2,%s,%s,'{}')''',(eid,'finance-opening-equity','0.99' if scenario=='unbalanced' else '1.00'))
                    if scenario!='unsealed':self.conn.execute('UPDATE finance_journal_entries SET sealed=true WHERE id=%s',(eid,))
                    self.conn.execute('SET CONSTRAINTS finance_entries_valid,finance_lines_valid IMMEDIATE')

    def test_database_protects_account_identity_deletion_and_opening_evidence(self):
        a=self.account();self.opening(a)
        self.rejected_sql('DELETE FROM finance_accounts WHERE id=%s',(a['id'],))
        self.rejected_sql("UPDATE finance_accounts SET kind='BANK' WHERE id=%s",(a['id'],))
        self.rejected_sql('UPDATE finance_accounts SET active=false WHERE id=%s',(a['id'],))
        self.rejected_sql('UPDATE finance_opening_balances SET amount=1 WHERE account_id=%s',(a['id'],))
        self.rejected_sql('DELETE FROM finance_audit_events')
        self.rejected_sql('DELETE FROM finance_operations')

    def test_database_reversal_unique_reference_and_balances(self):
        a=self.account();e=self.opening(a)
        reverse=self.service.reverse(foundation.CREATOR,e['id'],Reversal(effectiveDate='2026-01-02',reason='Correct cutover count'),'reverse')
        self.assertEqual(self.balance(a),'0.00')
        self.assertEqual(reverse['reversalOfId'],e['id'])
        # Same financial source cannot be recorded under a second ID.
        self.rejected_sql('''INSERT INTO finance_journal_entries
           (id,kind,effective_date,source_namespace,source_reference,fingerprint,posted_at,posted_by,reason)
           VALUES (%s,'JOURNAL','2026-01-01','finance.opening',%s,'hash',now(),'test','Duplicate source')''',
           (str(uuid4()),e['sourceReference']))

    def test_database_rejects_negative_funds_even_without_service_validation(self):
        a=self.account();original=self.opening(a,'10.00')
        with self.assertRaises(psycopg.Error):
            with self.conn.transaction():
                forged={**original,'id':str(uuid4()),'kind':'JOURNAL','sourceNamespace':'test','sourceReference':'overspend','metadata':{},
                        'lines':[{'accountId':a['id'],'debit':'0.00','credit':'10.01','memo':'','accountSnapshot':{}},
                                 {'accountId':'finance-opening-equity','debit':'10.01','credit':'0.00','memo':'','accountSnapshot':{}}]}
                PostgresRepository(self.conn).insert_entry(forged)
                self.conn.execute('SET CONSTRAINTS finance_entries_valid,finance_lines_valid IMMEDIATE')
        self.assertEqual(self.balance(a),'10.00')


if __name__=='__main__':unittest.main()
