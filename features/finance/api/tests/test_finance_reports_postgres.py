"""Rollback-only private PostgreSQL evidence/report invariants."""
import os
import unittest
from datetime import date

import test_finance_income as income
import test_finance_payables as expenses
import test_finance_postgres as foundation_pg
import test_finance_reports as reports_tests
from finance.reporting import ReportingService
from finance.storage import PostgresRepository


psycopg=foundation_pg.psycopg

@unittest.skipUnless(psycopg and os.getenv('FINANCE_TEST_DATABASE_URL'),'Requires authorized Finance test DSN')
class ReportsPostgresTests(reports_tests.ReportsTests):
    def setUp(self):
        foundation_pg.FinancePostgresTests.setUp(self)
        self.service=ReportingService(self.store,today=lambda:date(2026,10,12))
        self.f=income.IncomeTests();self.f.store=self.store;self.f.service=self.service;self.f.make_accounts()
        self.e=expenses.PayablesTests();self.e.store=self.store;self.e.service=self.service
        self.repository_class=PostgresRepository

    def test_certified_report_snapshot_cannot_be_changed_or_deleted_in_sql(self):
        r=self.sync(self.lifecycle())
        for query in ('DELETE FROM finance_report_snapshots WHERE id=%s',
                "UPDATE finance_report_snapshots SET data=jsonb_set(data,'{evidence,ratesComplete}','false') WHERE id=%s"):
            with self.assertRaises(psycopg.Error):
                with self.conn.transaction():self.conn.execute(query,(r['id'],))
        self.assertEqual(self.service.subscriber_report(income.RECORDER,'2026-01',date(2026,1,31))['metrics']['monthlyRecurringRevenue']['value'],'570.00')

    def test_sql_rejects_identity_and_evidence_owner_mismatch(self):
        with self.assertRaises(psycopg.Error):
            with self.conn.transaction():
                self.conn.execute("""INSERT INTO finance_report_snapshots(id,kind,snapshot_id,fingerprint,received_at,data)
                    VALUES ('bad','subscribers','snap',%s,now(),'{}')""",('0'*64,))
        with self.store.read() as repo:self.assertEqual(repo.report_snapshots(),[])


if __name__=='__main__':unittest.main()
