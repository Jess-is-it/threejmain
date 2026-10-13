"""The same movement and visibility contracts on private rollback PostgreSQL."""
import os
import unittest
import test_finance_activity as activity
import test_finance_reports_postgres as reports_pg
from finance.storage import psycopg


@unittest.skipUnless(psycopg and os.getenv('FINANCE_TEST_DATABASE_URL'), 'Requires authorized Finance test DSN')
class ActivityPostgresTests(activity.ActivityTests):
    def setUp(self):
        self.r = reports_pg.ReportsPostgresTests(); self.r.setUp(); self.addCleanup(self.r.doCleanups)
        self.s, self.f, self.e = self.r.service, self.r.f, self.r.e
