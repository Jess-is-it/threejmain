"""Source-captured lifecycle and rate evidence reconcile into actual reports."""
from contextlib import contextmanager
from copy import deepcopy
from datetime import date, datetime
from pathlib import Path
import sys
import unittest

from fastapi import HTTPException
from finance.integration import BUSINESS_ZONE
from finance.memory import MemoryStore
from finance.permissions import Actor, PERMISSIONS
from finance.reporting import ReportingService
from finance.report_schemas import ReportFeedRequest, ReportSync

sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'service'/'api'))
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'customer-profiling'/'api'))
from service.finance_provider import SubscriberFinanceReport


class CaptureFixture:
    def __init__(self,baseline='2026-01-31'):
        self.baseline=date.fromisoformat(baseline);self.changes=[];self.current=None

    def change(self,source,typ,rid,row,day='2026-02-02'):
        before=next((c['after_data'] for c in reversed(self.changes) if (c['source'],c['record_type'],c['record_id'])==(source,typ,rid)),None)
        self.changes.append({'source':source,'record_type':typ,'record_id':rid,'sequence':len(self.changes)+1,
            'operation':'BASELINE' if day=='2026-01-31' else 'UPDATE' if before else 'INSERT',
            'occurred_at':datetime.fromisoformat(day+'T12:00:00+08:00'),'before_data':deepcopy(before),'after_data':deepcopy(row)})

    @contextmanager
    def connection(self):yield self
    def execute(self,sql):self.current=sql;return self
    def fetchone(self):return {'baseline_date':self.baseline}
    def fetchall(self):return deepcopy(self.changes)


class LifecycleProviderTests(unittest.TestCase):
    def request(self,as_of='2026-02-28'):
        return ReportFeedRequest('subscribers','2026-02','2026-02-01','2026-02-28',as_of,'reviewer','')

    def test_dated_source_events_and_migration_reconcile_distinct_lines_customers_and_mrr(self):
        store=CaptureFixture()
        def account(rid,customer,status,day='2026-02-02',**other):
            row={'id':rid,'customerId':customer,'serviceStatus':status,**other}
            store.change('service','account',rid,row,day);return row
        def rate(rid,amount,day='2026-01-31'):
            store.change('billing','subscription','s-'+rid,{'id':'s-'+rid,'serviceAccountId':rid,'status':'ACTIVE','monthlyRate':amount},day)
        a=account('a','one','ACTIVE','2026-01-31',migration={'imported':True})
        b=account('b','two','SUSPENDED','2026-01-31',activationDate='2025-12-01')
        rate('a','100.00');rate('b','70.00')
        account('c','one','ACTIVE');rate('c','100.00','2026-02-02')
        account('d','two','ACTIVE',migration={'imported':True});rate('d','200.00','2026-02-02')
        account('b','two','ACTIVE','2026-02-03',activationDate='2025-12-01')
        account('a','one','SUSPENDED','2026-02-04',migration={'imported':True})
        rate('c','120.00','2026-02-05')
        provider=SubscriberFinanceReport(lambda _:None,store)
        evidence=provider.fetch(self.request())
        self.assertEqual(sum(e.kind=='ACTIVATION' for e in evidence.events),1)
        self.assertEqual(sum(e.kind=='MIGRATION_BASELINE' for e in evidence.events),1)
        self.assertEqual(sum(e.kind=='REACTIVATION' for e in evidence.events),1)
        service=ReportingService(MemoryStore(),today=lambda:date(2026,10,12))
        service.report_providers['subscribers']=provider
        actor=Actor('reviewer',frozenset(PERMISSIONS))
        service.sync_report_evidence(actor,'subscribers',ReportSync(month='2026-02',asOf='2026-02-28'),'dated-source-snapshot')
        report=service.subscriber_report(actor,'2026-02',date(2026,2,28))
        expected={'openingActiveLines':1,'closingActiveLines':3,'openingActiveCustomers':1,'closingActiveCustomers':2,
            'newActivations':1,'reactivations':1,'suspensions':1,'migrationBaselineAdjustment':1,'netLineGrowth':2}
        for name,value in expected.items():self.assertEqual(report['metrics'][name]['value'],value,name)
        # Billing still marks suspended a billable: MRR follows the contract,
        # while the active census follows Service status.
        self.assertEqual(report['metrics']['monthlyRecurringRevenue']['value'],'490.00')
        self.assertEqual(report['lineReconciliationVariance'],0)
        self.assertEqual(report['customerReconciliationVariance'],0)
        # An unrelated Service presentation edit must not invent a lifecycle event.
        previous=[e.eventId for e in evidence.events]
        store.change('service','account','a',{**a,'serviceStatus':'SUSPENDED','notes':'changed'},'2026-02-06')
        self.assertEqual([e.eventId for e in provider.fetch(self.request()).events],previous)

    def test_first_partial_capture_day_and_prebaseline_history_fail_without_snapshot(self):
        store=CaptureFixture(datetime.now(BUSINESS_ZONE).date().isoformat())
        with self.assertRaises(HTTPException) as error:SubscriberFinanceReport(lambda _:None,store).fetch(self.request())
        self.assertEqual(error.exception.status_code,409)
        store.baseline=date(2026,1,31)
        with self.assertRaises(HTTPException):SubscriberFinanceReport(lambda _:None,store).fetch(self.request('2026-01-30'))

    def test_multiple_active_billing_rates_cannot_certify_mrr(self):
        store=CaptureFixture()
        store.change('service','account','a',{'id':'a','customerId':'one','serviceStatus':'ACTIVE'},'2026-01-31')
        for rid in ('s1','s2'):
            store.change('billing','subscription',rid,{'id':rid,'serviceAccountId':'a','status':'ACTIVE','monthlyRate':'100.00'},'2026-01-31')
        with self.assertRaises(ValueError):SubscriberFinanceReport(lambda _:None,store).fetch(self.request())


if __name__=='__main__':unittest.main()
