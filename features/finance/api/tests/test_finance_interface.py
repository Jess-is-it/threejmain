"""Phase 6 interface support: evidence bridges, chart series and authorized outputs."""
import csv
import io
import unittest
from datetime import date
from decimal import Decimal
from fastapi import HTTPException

import test_finance_reports as reports
import test_finance_income as income
from finance.permissions import Actor, PERMISSIONS
from finance.report_exports import report_csv, safe_cell
from finance.schemas import TransferCreate


class InterfaceSupportTests(unittest.TestCase):
    def setUp(self):
        self.fixture=reports.ReportsTests();self.fixture.setUp()
        self.service=self.fixture.service;self.f=self.fixture.f;self.e=self.fixture.e

    def test_subscriber_membership_and_rate_records_reconcile_to_every_summary(self):
        self.fixture.sync(self.fixture.lifecycle())
        r=self.service.subscriber_report(income.RECORDER,'2026-01',date(2026,1,31))
        active=lambda rows:[row for row in rows if row['status'] in ('ACTIVE','PENDING_DISCONNECTION')]
        for boundary in ('opening','closing'):
            rows=active(r[boundary+'Lines'])
            self.assertEqual(len(rows),r['metrics'][boundary+'ActiveLines']['value'])
            self.assertEqual(len({row['customerId'] for row in rows}),r['metrics'][boundary+'ActiveCustomers']['value'])
        self.assertEqual(sum(Decimal(row['monthlyRecurringRate']) for row in r['monthlyRateRows']),Decimal(r['metrics']['monthlyRecurringRevenue']['value']))
        self.assertEqual(sum(event['projection']['newCustomer'] for event in r['events']),r['metrics']['newSubscriberCustomers']['value'])
        self.assertEqual(sum(event['kind']=='ACTIVATION' for event in r['events']),r['metrics']['newActivations']['value'])

    def test_series_uses_real_calendar_windows_preserves_null_profit_and_enforces_grants(self):
        r=self.service.monthly_series(income.RECORDER,'profit-and-loss','2026-03',date(2026,3,12),3)
        self.assertEqual([row['month'] for row in r['reports']],['2026-01','2026-02','2026-03'])
        self.assertEqual([row['report']['period']['endDate'] for row in r['reports']],['2026-01-31','2026-02-28','2026-03-12'])
        self.assertTrue(all(row['report']['metrics']['netProfit']['value'] is None for row in r['reports']))
        self.f.expect(403,lambda:self.service.monthly_series(Actor('denied',frozenset()),'subscribers','2026-03'))
        self.f.expect(400,lambda:self.service.monthly_series(income.RECORDER,'cash-flow','1900-01',months=2))

    def test_account_chart_movements_include_internal_transfers_without_increasing_combined_cash(self):
        self.f.opening(self.f.cash,'100.00')
        self.service.transfer(income.RECORDER,TransferCreate(fromAccountId=self.f.cash['id'],toAccountId=self.f.wallet['id'],amount='30.00',effectiveDate='2026-01-03',sourceReference=self.f.key(),reason='Company internal transfer',method='GCASH_TRANSFER',referenceNumber='Wallet transfer'),self.f.key())
        r=self.fixture.report('cash-flow')
        self.assertEqual(r['controlledCash']['netCashFlow'],'0.00')
        self.assertEqual(sum(Decimal(row['amount']) for row in r['accountTransactions']),Decimal('0.00'))
        for account in r['accounts']:
            self.assertEqual(sum((Decimal(row['amount']) for row in r['accountTransactions'] if row['accountId']==account['accountId']),Decimal('0')),Decimal(account['netMovement']))
        self.assertTrue(r['eliminatedInternalJournalIds'])

    def test_total_expenses_matches_posted_direct_and_operating_cost_lines(self):
        self.e.posted(self.e.draft(amount='30.00'))
        self.e.posted(self.e.draft(amount='20.01',classification='DIRECT_COST'))
        self.e.posted(self.e.draft(amount='90.00',classification='ASSET'))
        r=self.fixture.report('profit-and-loss')
        self.assertEqual(r['metrics']['totalExpenses']['value'],'50.01')
        self.assertEqual(r['metrics']['totalExpenses']['status'],'PROVISIONAL')
        self.assertIsNone(r['metrics']['netProfit']['value'])

    def test_csv_preserves_exact_values_statuses_context_and_formula_safety(self):
        r={'status':'PROVISIONAL','period':{'startDate':'2026-01-01','endDate':'2026-01-31'},'basis':'FINANCE_POSTED_LEDGER','timeZone':'Asia/Manila',
           'metrics':{'netProfit':{'value':None,'recordedValue':'10.00','status':'UNAVAILABLE'}},
           'rows':[{'payeeName':' =HYPERLINK("bad")','amount':'9999999999999999.99','refundAmount':'-10.01'}]}
        text=report_csv(r);rows=list(csv.DictReader(io.StringIO(text.lstrip('\ufeff'))))
        evidence=next(row for row in rows if row['section']=='rows')
        self.assertTrue(evidence['payeeName'].startswith("'"));self.assertEqual(evidence['amount'],'9999999999999999.99');self.assertEqual(evidence['refundAmount'],'-10.01')
        metric=next(row for row in rows if row['field']=='netProfit')
        self.assertEqual(metric['value'],'');self.assertEqual(metric['status'],'UNAVAILABLE')
        for text in ('\t=bad','\n=bad',' +bad','@bad','-bad'):self.assertTrue(safe_cell(text).startswith("'"))
        self.assertEqual(safe_cell('2026-01-31'),'2026-01-31')

    def test_full_transaction_outputs_do_not_truncate_at_the_screen_page(self):
        self.f.opening(self.f.cash,'100.00')
        r=self.service.presentation_report(income.RECORDER,'transactions','2026-01',date(2026,1,31))
        self.assertEqual(len(r['items']),r['totalRows'])
        output=report_csv(r)
        self.assertIn('journal lines',output);self.assertIn('100.00',output)
        self.f.expect(403,lambda:self.service.presentation_report(Actor('scope',frozenset(PERMISSIONS),account_ids=frozenset()),'transactions','2026-01'))


class InterfaceHttpTests(unittest.TestCase):
    def setUp(self):self.f=reports.ReportsHttpTests();self.f.setUp()
    def tearDown(self):self.f.tearDown()
    def test_print_and_series_routes_apply_report_and_output_grants(self):
        root='/api/finance/reports/'
        self.assertEqual(self.f.call('GET',root+'monthly-series?kind=cash-flow&month=2026-01&months=2')[0],200)
        self.assertEqual(self.f.call('GET',root+'subscribers/print?month=2026-01')[0],200)
        self.assertEqual(self.f.call('GET',root+'transactions?month=2026-01&allRecords=true')[0],200)
        restricted=Actor('read-only',frozenset(PERMISSIONS)-{'finance.reports.export','finance.reports.print'})
        self.f.module._actor_provider=lambda token:restricted
        self.assertEqual(self.f.call('GET',root+'cash-flow/print?month=2026-01')[0],403)
        self.assertEqual(self.f.call('GET',root+'cash-flow/csv?month=2026-01')[0],403)
        self.assertEqual(self.f.call('GET',root+'cash-flow?month=2026-01')[0],200)
        self.f.module._actor_provider=lambda token:Actor('output-only',frozenset({'finance.reports.export','finance.reports.print'}))
        self.assertEqual(self.f.call('GET',root+'subscribers/print?month=2026-01')[0],403)

    def test_csv_response_has_current_authority_attribution_and_private_download_headers(self):
        status,headers,body=self.f.call('GET','/api/finance/reports/profit-and-loss/csv?month=2026-01&asOf=2026-01-31')
        self.assertEqual(status,200);self.assertEqual(headers[b'cache-control'],b'no-store')
        self.assertEqual(headers[b'x-content-type-options'],b'nosniff')
        self.assertIn(b'attachment',headers[b'content-disposition'])
        rows=list(csv.DictReader(io.StringIO(body.decode('utf-8-sig'))))
        self.assertEqual(next(r['value'] for r in rows if r.get('field')=='requestedBy'),income.RECORDER.username)
        self.assertEqual(next(r['value'] for r in rows if r.get('field')=='netProfit'),'')
        self.assertEqual(next(r['status'] for r in rows if r.get('field')=='netProfit'),'UNAVAILABLE')
