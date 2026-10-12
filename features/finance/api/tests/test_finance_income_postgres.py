"""Opt-in PostgreSQL source/cutover invariants; application schema untouched."""
import os
import unittest
from datetime import date
from unittest.mock import patch
from uuid import uuid4

import test_finance_income as income
from finance.income import IncomeService
from finance.migrations import READINESS_MIGRATIONS, MIGRATIONS
from finance.storage import PostgresStore,PostgresRepository,psycopg
from finance.schemas import json_record


@unittest.skipUnless(psycopg and os.getenv('FINANCE_TEST_DATABASE_URL'),'Requires authorized Finance test DSN')
class IncomePostgresTests(income.IncomeTests):
    def setUp(self):
        from psycopg import sql
        self.conn=psycopg.connect(os.environ['FINANCE_TEST_DATABASE_URL'],autocommit=False)
        self.addCleanup(self.conn.close);self.addCleanup(self.conn.rollback)
        schema='finance_income_test_'+uuid4().hex
        self.conn.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
        self.conn.execute(sql.SQL('SET LOCAL search_path TO {}').format(sql.Identifier(schema)))
        for migration in [*MIGRATIONS,*READINESS_MIGRATIONS]:
            for statement in migration['statements']:self.conn.execute(statement)
        self.store=PostgresStore(connection=self.conn)
        self.service=IncomeService(self.store,today=lambda:date(2026,10,12))
        self.make_accounts()

    @unittest.skip('Rollback-only namespace is invisible to independent workers; dedicated committed private-fixture race below covers this')
    def test_concurrent_sync_same_key_posts_once_and_cursor_compare_rejects_stale_worker(self):pass

    def sql_rejected(self,statement,args=()):
        with self.assertRaises(psycopg.Error):
            with self.conn.transaction():
                self.conn.execute(statement,args)
                self.conn.execute('SET CONSTRAINTS ALL IMMEDIATE')

    def test_failed_operation_rolls_back_source_inbox_journals_claims_and_cursor(self):
        self.cutover();self.mapping();self.feed('billing',[self.invoice(),self.receipt()])
        with patch.object(PostgresRepository,'save_operation',side_effect=RuntimeError('Final evidence failure')):
            with self.assertRaises(RuntimeError):self.sync('billing',key='failed-final')
        with self.store.read() as repo:
            self.assertEqual(repo.source_events(),[]);self.assertEqual(repo.entries(),[]);self.assertIsNone(repo.checkpoint('billing'))
        self.assertTrue(self.sync('billing')['checkpointAdvanced'])

    def test_source_inbox_result_claims_and_active_cutover_are_immutable_in_sql(self):
        plan=self.cutover();self.mapping();i=self.invoice();r=self.receipt();self.sync('billing',[i,r])
        event_id=income.stable_id('billing',r['eventId'])
        self.sql_rejected('DELETE FROM finance_source_events WHERE id=%s',(event_id,))
        self.sql_rejected("UPDATE finance_source_results SET data=jsonb_set(data,'{collectionAmount}','\"999.00\"') WHERE id=%s",(event_id,))
        self.sql_rejected('DELETE FROM finance_source_claims WHERE event_id=%s',(event_id,))
        self.sql_rejected("UPDATE finance_income_documents SET data=jsonb_set(data,'{startDate}','\"2026-02-01\"'),version=version+1 WHERE id=%s",(plan['id'],))
        self.sql_rejected("UPDATE finance_source_checkpoints SET version=version+1,data=jsonb_set(data,'{snapshotId}','\"changed\"') WHERE source='billing'")

    def test_manual_income_intake_approval_and_source_control_cannot_be_bypassed_in_sql(self):
        r=self.manual();r=self.review(r,'submit',income.RECORDER);r=self.review(r)
        posted=self.service.post_manual(income.RECORDER,r['id'],income.ReviewAction(version=r['version'],reason='Post reviewed money'),self.key())
        self.sql_rejected("UPDATE finance_income_documents SET data=jsonb_set(data,'{amount}','\"500.00\"') WHERE id=%s",(r['id'],))
        self.sql_rejected('DELETE FROM finance_income_documents WHERE id=%s',(r['id'],))
        self.sql_rejected("UPDATE finance_accounts SET active=false WHERE id='finance-billing-ar'")
        from fastapi import HTTPException
        with self.assertRaises(HTTPException) as error:
            with self.conn.transaction():
                with self.store.transaction() as repo:
                    self.service._post(repo,income.RECORDER,'JOURNAL','test',self.key(),{'effectiveDate':income.DAY,'reason':'Bypass source control'},
                          [{'accountId':income.AR,'debit':'1.00','credit':'0.00'},{'accountId':income.DEFERRED,'credit':'1.00','debit':'0.00'}])
        self.assertEqual(error.exception.status_code,409)
        self.assertEqual(self.balance(self.cash['id']),'50.00');self.assertEqual(posted['status'],'POSTED')

    def test_deferred_result_constraints_leave_failed_source_post_as_exception_not_half_journal(self):
        self.cutover();self.mapping();i=self.invoice();self.sync('billing',[i])
        def corrupt_result(repo,r):
            altered={**r,'journalLines':[{**l,'debit':'999.00'} for l in r['journalLines']]}
            original(repo,altered)
        original=PostgresRepository.insert_source_result
        r=self.receipt()
        with patch.object(PostgresRepository,'insert_source_result',corrupt_result):
            result=self.sync('billing',[r])
        self.assertFalse(result['checkpointAdvanced']);self.assertIsNone(self.result(r))
        self.assertEqual(self.balance(self.cash['id']),'0.00');self.assertEqual(self.balance(income.AR),'100.00')


@unittest.skipUnless(psycopg and os.getenv('FINANCE_TEST_DATABASE_URL'),'Requires authorized Finance test DSN')
class IndependentIncomePostgresTests(unittest.TestCase):
    def test_independent_source_sync_workers_deduplicate_journal_and_compare_cursors(self):
        from concurrent.futures import ThreadPoolExecutor
        from contextlib import contextmanager
        from threading import Barrier
        from psycopg import sql
        from fastapi import HTTPException
        schema='finance_phase4_race_'+uuid4().hex
        conn=psycopg.connect(os.environ['FINANCE_TEST_DATABASE_URL'],autocommit=True)
        self.addCleanup(conn.close)
        def cleanup():
            if not schema.startswith('finance_phase4_race_') or len(schema)!=52:raise RuntimeError('Unexpected private test schema identity')
            conn.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(schema)))
            self.assertIsNone(conn.execute('SELECT to_regnamespace(%s)',(schema,)).fetchone()[0])
        self.addCleanup(cleanup)
        conn.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
        with conn.transaction():
            conn.execute(sql.SQL('SET LOCAL search_path TO {}').format(sql.Identifier(schema)))
            for migration in [*MIGRATIONS,*READINESS_MIGRATIONS]:
                for statement in migration['statements']:conn.execute(statement)
        class WorkerStore(PostgresStore):
            @contextmanager
            def _connection(self):
                with psycopg.connect(os.environ['FINANCE_TEST_DATABASE_URL'],autocommit=True) as worker:
                    worker.execute(sql.SQL('SET search_path TO {}').format(sql.Identifier(schema)))
                    yield worker
        fixture=income.IncomeTests();fixture.store=WorkerStore();fixture.service=IncomeService(fixture.store,today=lambda:date(2026,10,12))
        fixture.make_accounts();fixture.cutover();fixture.mapping();fixture.feed('billing',[fixture.invoice(),fixture.receipt()],barrier=Barrier(2))
        with ThreadPoolExecutor(max_workers=2) as pool:outcomes=list(pool.map(lambda _:fixture.sync('billing',key='parallel-source-key'),range(2)))
        self.assertEqual(outcomes[0]['id'],outcomes[1]['id']);self.assertEqual(fixture.balance(fixture.cash['id']),'100.00')
        with fixture.store.read() as repo:
            self.assertEqual(len(repo.entries()),2);self.assertEqual(len(repo.source_results()),2)
        fixture.feed('billing',[],barrier=Barrier(2))
        def attempt(_):
            try:return fixture.sync('billing')
            except HTTPException as exc:return exc.status_code
        with ThreadPoolExecutor(max_workers=2) as pool:outcomes=list(pool.map(attempt,range(2)))
        self.assertEqual(sum(isinstance(o,dict) for o in outcomes),1);self.assertIn(409,outcomes)
