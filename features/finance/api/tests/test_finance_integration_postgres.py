"""Actual outbox rollback, immutable evidence and captured-provider integration."""
import os
import unittest
from contextlib import contextmanager
from datetime import date, timedelta
from uuid import uuid4

from finance.integration import IntegrationStore, CaptureProvider, SNAPSHOT
from finance.source_adapters import FeedRequest
from finance.migrations import READINESS_MIGRATIONS, MIGRATIONS, INTEGRATION_MIGRATIONS
from finance.storage import psycopg, dict_row, Jsonb
from fastapi import HTTPException
from finance.income import IncomeService
from finance.permissions import Actor, PERMISSIONS
from finance.schemas import AccountCreate
from finance.income_schemas import CutoverCreate, ReviewAction, MappingCreate, SyncRequest
from finance.storage import PostgresStore
from finance.integration import SourceResolution
from finance.ledger import normal_balance


@unittest.skipUnless(psycopg and os.getenv('FINANCE_TEST_DATABASE_URL'), 'Requires authorized private-schema PostgreSQL fixture')
class CapturePostgresTests(unittest.TestCase):
    def setUp(self):
        from psycopg import sql
        self.conn = psycopg.connect(os.environ['FINANCE_TEST_DATABASE_URL'],row_factory=dict_row)
        self.addCleanup(self.conn.close); self.addCleanup(self.conn.rollback)
        schema = 'finance_integration_test_'+uuid4().hex
        self.conn.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
        self.conn.execute(sql.SQL('SET LOCAL search_path TO {}').format(sql.Identifier(schema)))
        for table in ('billing_records','pos_records','collector_records','service_records'):
            self.conn.execute(sql.SQL('CREATE TABLE {}(record_type text,record_id text,data jsonb,PRIMARY KEY(record_type,record_id))').format(sql.Identifier(table)))
        self.conn.execute("INSERT INTO billing_records VALUES('payment','legacy',%s)", (Jsonb({'id':'legacy','status':'POSTED','amount':'999.00','customer':{'contactNumber':'private'}}),))
        for migration in [*MIGRATIONS,*INTEGRATION_MIGRATIONS,*READINESS_MIGRATIONS]:
            for statement in migration['statements']: self.conn.execute(statement)
        fixture_conn = self.conn
        class FixtureStore(IntegrationStore):
            @contextmanager
            def connection(self, **options):
                with fixture_conn.transaction(): yield fixture_conn
        self.store = FixtureStore()

    def insert(self, typ, rid, row, table='billing_records'):
        from psycopg import sql
        self.conn.execute(sql.SQL('INSERT INTO {} VALUES(%s,%s,%s)').format(sql.Identifier(table)), (typ,rid,Jsonb(row)))

    def test_initial_snapshot_excludes_contacts_and_is_never_new_cash(self):
        row = self.conn.execute('SELECT * FROM finance_source_changes').fetchone()
        self.assertNotIn('customer',row['after_data'])
        page = CaptureProvider('billing',lambda _:None,self.store).fetch(FeedRequest('billing',SNAPSHOT,'',100,'officer'))
        self.assertEqual(page.events,[])
        self.assertEqual(page.nextCursor,'c:1')

    def test_capture_and_source_rollback_together_and_sequence_is_not_lost(self):
        with self.assertRaises(RuntimeError):
            with self.conn.transaction():
                self.insert('invoice','i1',{'id':'i1','status':'ISSUED'})
                raise RuntimeError('source posting failed')
        self.assertEqual(self.conn.execute('SELECT count(*) AS count FROM billing_records').fetchone()['count'],1)
        self.assertEqual(self.conn.execute('SELECT last_sequence FROM finance_integration_state').fetchone()['last_sequence'],1)
        self.insert('invoice','i2',{'id':'i2','status':'ISSUED','customerId':'c1','issueDate':date.today().isoformat(),'lineItems':[{'amount':'100.00'}]})
        row = self.conn.execute('SELECT * FROM finance_source_changes WHERE sequence=2').fetchone()
        self.assertEqual(row['record_id'],'i2')
        page = CaptureProvider('billing',lambda _:None,self.store).fetch(FeedRequest('billing',SNAPSHOT,'c:1',100,'officer'))
        self.assertEqual(page.events[0].effect.amount,100)

    def test_identical_saves_emit_nothing_and_evidence_is_immutable(self):
        self.conn.execute("UPDATE billing_records SET data=data WHERE record_id='legacy'")
        self.assertEqual(self.conn.execute('SELECT count(*) AS count FROM finance_source_changes').fetchone()['count'],1)
        for statement in ('DELETE FROM finance_source_changes','UPDATE finance_source_changes SET actor=\'changed\''):
            with self.assertRaises(psycopg.Error):
                with self.conn.transaction(): self.conn.execute(statement)

    def test_invalid_company_settlement_holds_cursor_and_records_durable_error(self):
        self.insert('payment','r1',{'id':'r1','customerId':'c1','status':'POSTED','amount':'1.00','allocations':[], 'advanceAmount':'1.00','method':'GCASH','postedByUsername':'bill','paymentDate':date.today().isoformat()})
        with self.assertRaises(HTTPException):
            CaptureProvider('billing',lambda _:None,self.store).fetch(FeedRequest('billing',SNAPSHOT,'c:1',100,'officer'))
        row = self.conn.execute('SELECT * FROM finance_source_delivery').fetchone()
        self.assertEqual(row['status'],'BLOCKED_SOURCE_EVIDENCE')
        self.assertEqual(row['sequence'],2)
        self.assertEqual(self.conn.execute('SELECT count(*) AS count FROM finance_source_checkpoints').fetchone()['count'],0)
        payload = SourceResolution(effectiveDate=date.today(),evidenceReference='Named company wallet review',reason='Actual wallet evidence required')
        with self.assertRaises(HTTPException) as error:self.store.resolve('billing',2,payload,'bill')
        self.assertEqual(error.exception.status_code,422)
        self.assertEqual(self.conn.execute('SELECT count(*) AS count FROM finance_source_resolutions').fetchone()['count'],0)

    def test_source_authorization_is_checked_before_reading_capture(self):
        def deny(_): raise HTTPException(403,'source permission revoked')
        with self.assertRaises(HTTPException) as error:
            CaptureProvider('billing',deny,self.store).fetch(FeedRequest('billing',SNAPSHOT,'',100,'unauthorized'))
        self.assertEqual(error.exception.status_code,403)

    def test_reviewed_cutover_controls_include_advance_without_creating_cash(self):
        from copy import deepcopy
        self.conn.execute("DELETE FROM billing_records WHERE record_id='legacy'")
        baseline = self.conn.execute('SELECT baseline_date FROM finance_integration_state').fetchone()['baseline_date']
        self.insert('invoice','opening-invoice',{'id':'opening-invoice','customerId':'c1','status':'ISSUED','lineItems':[{'amount':'100.00'}]})
        self.insert('payment','advance',{'id':'advance','customerId':'c1','status':'POSTED','amount':'50.00','allocations':[],'advanceAmount':'50.00'})
        proof = self.store.cutover_evidence(baseline+timedelta(days=1))
        self.assertEqual(proof['receivables'][0]['amount'],'100.00')
        self.assertIsNone(proof['receivables'][0]['deferredAmount'])
        self.assertEqual(proof['credits'][0]['amount'],'50.00')
        self.assertFalse(proof['fundsImportedAgain'])
        self.store.validate_cutover(proof)
        wrong = deepcopy(proof);wrong['receivables'][0]['amount']='99.00'
        with self.assertRaises(HTTPException):self.store.validate_cutover(wrong)
        with self.assertRaises(HTTPException):self.store.cutover_evidence(baseline)
        self.assertEqual(self.conn.execute('SELECT count(*) AS count FROM finance_journal_entries').fetchone()['count'],0)

    def test_captured_postings_replay_and_attributed_void_reconcile_actual_ledger(self):
        recorder = Actor('officer',frozenset(PERMISSIONS)); reviewer = Actor('reviewer',frozenset(PERMISSIONS))
        # Synthetic completed prior day exists only in this rollback namespace.
        self.conn.execute("UPDATE finance_integration_state SET baseline_date=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date-1")
        start = self.conn.execute('SELECT baseline_date FROM finance_integration_state').fetchone()['baseline_date'] + timedelta(days=1)
        day = start
        service = IncomeService(PostgresStore(connection=self.conn),today=lambda:day)
        cash = service.create_account(recorder,AccountCreate(code='DESK',name='Office cash',kind='CASH'),uuid4().hex)
        plan = service.create_cutover(recorder,CutoverCreate(startDate=start,snapshots={s:SNAPSHOT for s in ('billing','point-of-sale','collector','service')},
            funds=[{'accountId':cash['id'],'balance':'0.00'}],reason='Reviewed empty forward baseline',evidenceReference='Private fixture certified baseline'),uuid4().hex)
        plan = service.review_document(reviewer,plan['id'],'approve',ReviewAction(version=plan['version'],reason='Independent source baseline review'),uuid4().hex)
        service.activate_cutover(recorder,plan['id'],ReviewAction(version=plan['version'],reason='Activate reviewed boundary'),uuid4().hex)
        settlement = {'channel':'OFFICE','operator':'bill','method':'CASH','institution':'office-cash:bill'}
        mapping = service.create_mapping(recorder,MappingCreate(settlement=settlement,accountId=cash['id'],validFrom=start,reason='Office counted drawer',evidenceReference='Named account review'),uuid4().hex)
        service.review_document(reviewer,mapping['id'],'approve',ReviewAction(version=mapping['version'],reason='Independent drawer mapping'),uuid4().hex)
        self.insert('invoice','i1',{'id':'i1','customerId':'c1','status':'ISSUED','issueDate':day.isoformat(),'lineItems':[{'amount':'100.00'}]})
        receipt = {'id':'r1','customerId':'c1','status':'POSTED','amount':'100.00','allocations':[{'invoiceId':'i1','amount':'100.00'}],
                   'advanceAmount':'0.00','method':'CASH','postedByUsername':'bill','paymentDate':day.isoformat()}
        self.insert('payment','r1',receipt)
        service.providers['billing'] = CaptureProvider('billing',lambda _:None,self.store)
        first = service.sync(recorder,'billing',SyncRequest(limit=100),'capture-sync-1')
        self.assertTrue(first['checkpointAdvanced'], self.conn.execute('SELECT data FROM finance_reconciliation_exceptions').fetchall()); self.assertEqual(first['blocked'],0)
        replay = service.sync(recorder,'billing',SyncRequest(limit=100),'capture-sync-1')
        self.assertTrue(replay['idempotentReplay'])
        with service.store.read() as repo:
            self.assertEqual(normal_balance(repo.account(cash['id']),repo.entries()),100)
            self.assertEqual(len(repo.entries()),2)
        self.conn.execute("UPDATE billing_records SET data=%s WHERE record_id='r1'",(Jsonb({**receipt,'status':'VOID','voidedAt':day.isoformat()+'T01:00:00Z','voidedByUsername':'bill','voidReason':'Mistaken duplicate'}),))
        with self.assertRaises(HTTPException): service.sync(recorder,'billing',SyncRequest(limit=100),'capture-void-unattested')
        sequence = self.conn.execute("SELECT sequence FROM finance_source_changes WHERE record_id='r1' ORDER BY sequence DESC LIMIT 1").fetchone()['sequence']
        data = {'effectiveDate':day.isoformat(),'evidenceReference':'Source reviewed duplicate/no funds', 'reason':'Mistaken duplicate never received funds', 'disposition':'DUPLICATE_NO_FUNDS'}
        self.store.resolve('billing',sequence,SourceResolution.model_validate(data),'bill')
        corrected = service.sync(recorder,'billing',SyncRequest(limit=100),'capture-void-attested')
        self.assertEqual(corrected['blocked'],0)
        with service.store.read() as repo:
            self.assertEqual(normal_balance(repo.account(cash['id']),repo.entries()),0)
            self.assertEqual(len(repo.entries()),3)
            self.assertEqual(repo.entries()[-1]['metadata']['disposition'],'DUPLICATE_NO_FUNDS')


if __name__ == '__main__': unittest.main()
