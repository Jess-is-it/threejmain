"""Private rollback schemas exercise durable period/publication constraints."""
import os
import unittest
import test_finance_periods as periods
import test_finance_reports_postgres as reports_pg
from finance.storage import psycopg

@unittest.skipUnless(psycopg and os.getenv('FINANCE_TEST_DATABASE_URL'),'Requires authorized Finance test DSN')
class PeriodPostgresTests(periods.PeriodTests):
    def setUp(self):
        self.r=reports_pg.ReportsPostgresTests();self.r.setUp();self.addCleanup(self.r.doCleanups)
        self.s=self.r.service;self.s.period_provider=lambda start,end:{'ready':True,'lastSequence':42,'cursors':{'billing':'42'}}

    def test_database_rejects_locked_period_journal_and_history_mutation(self):
        self.ready();closed=self.action(self.prepare())
        for query,args in [
            ("INSERT INTO finance_journal_entries(id,kind,effective_date,source_namespace,source_reference,fingerprint,posted_at,posted_by,reason) VALUES('blocked','JOURNAL','2026-01-12','test','blocked','hash',now(),'sql','Bypass attempt')",()),
            ('DELETE FROM finance_period_events',()),
            ("UPDATE finance_period_events SET data='{}'",()),
            ('DELETE FROM finance_periods',()),
            ("UPDATE finance_periods SET status='OPEN' WHERE month='2026-01'",())]:
            with self.assertRaises(psycopg.Error):
                with self.r.conn.transaction():self.r.conn.execute(query,args)
        self.assertEqual(self.s.period_detail(periods.A,'2026-01')['current']['status'],'CLOSED')

if __name__=='__main__':unittest.main()

@unittest.skipUnless(psycopg and os.getenv('FINANCE_TEST_DATABASE_URL'),'Requires authorized Finance test DSN')
class IndependentPeriodWorkers(unittest.TestCase):
    def test_prepare_vs_posting_and_duplicate_close_serialize_in_postgres(self):
        import test_finance_payables_postgres as expenses_pg
        import test_finance_income as income
        from finance.reporting import ReportingService
        from finance.schemas import TransferCreate
        from finance.periods import CHECKS,FLAGS,PeriodPrepare,PeriodAction
        from datetime import date
        fixture=expenses_pg.PostgresConcurrentPayablesTests();fixture.setUp();self.addCleanup(fixture.doCleanups)
        r=periods.reports.ReportsTests();r.store=fixture.fixture.store;r.service=ReportingService(r.store,today=lambda:date(2026,10,12),period_provider=lambda *args:{'ready':True,'lastSequence':42})
        r.f=income.IncomeTests();r.f.store=r.store;r.f.service=r.service;r.f.make_accounts()
        r.e=fixture.fixture;r.e.service=r.service
        r.finance_data()
        r.sync({'kind':'billing-receivables','snapshotId':r.key(),'asOf':'2026-01-31','complete':True,'certifiedBy':'billing-owner','evidenceReference':'Authoritative tie','rows':[]})
        r.sync(r.certificate(**dict.fromkeys(FLAGS,True)))
        payload=PeriodPrepare(reason='Reviewed completed month',evidenceReference='Reconciliation bundle',checklist=dict.fromkeys(CHECKS,True))
        def prepare():return r.service.prepare_period(periods.A,'2026-01',payload,r.key())
        def transfer():return r.service.transfer(periods.A,TransferCreate(fromAccountId=r.f.cash['id'],toAccountId=r.f.wallet['id'],amount='1.00',sourceReference=r.key(),effectiveDate='2026-01-31',reason='Concurrent transfer',method='OTHER',referenceNumber='Evidence'),r.key())
        results=fixture.race([prepare,transfer])
        self.assertEqual(sum(isinstance(row,dict) for row in results),1);self.assertIn(409,results)
        with r.store.read() as repo:prepared=repo.period('2026-01')
        if not prepared:
            r.sync(r.certificate(**dict.fromkeys(FLAGS,True)));prepared=prepare()
        action=PeriodAction(version=prepared['version'],reason='Independent close review',evidenceReference='Signed evidence')
        results=fixture.race([lambda:r.service.transition_period(periods.B,'2026-01',action,'parallel-close','CLOSE')]*2)
        self.assertEqual([row['status'] for row in results],['CLOSED','CLOSED'])
        with r.store.read() as repo:self.assertEqual(len(repo.period_events('2026-01')),2)
