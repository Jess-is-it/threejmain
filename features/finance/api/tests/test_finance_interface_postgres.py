"""Phase 6 chart/export evidence reconciliation against private PostgreSQL fixtures."""
import os
import unittest
from datetime import date
import test_finance_postgres as foundation
import test_finance_interface as interface
import test_finance_reports as reports
import test_finance_income as income
import test_finance_payables as payables
from finance.reporting import ReportingService
from finance.storage import PostgresRepository

@unittest.skipUnless(foundation.psycopg and os.getenv('FINANCE_TEST_DATABASE_URL'),'Requires authorized Finance test DSN')
class InterfacePostgresTests(interface.InterfaceSupportTests):
    def setUp(self):
        foundation.FinancePostgresTests.setUp(self)
        self.service=ReportingService(self.store,today=lambda:date(2026,10,12))
        self.f=income.IncomeTests();self.f.store=self.store;self.f.service=self.service;self.f.make_accounts()
        self.e=payables.PayablesTests();self.e.store=self.store;self.e.service=self.service
        self.fixture=reports.ReportsTests();self.fixture.store=self.store;self.fixture.service=self.service
        self.fixture.f=self.f;self.fixture.e=self.e;self.fixture.repository_class=PostgresRepository

if __name__=='__main__':unittest.main()
