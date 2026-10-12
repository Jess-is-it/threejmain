"""Closing/reopening preserves publications and enforces independent review."""
import asyncio
import importlib
import unittest
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date
from unittest.mock import patch

from fastapi import FastAPI,HTTPException
from pydantic import ValidationError
import test_finance_reports as reports
import test_finance_income as income
from finance.permissions import Actor
from finance.periods import CHECKS,FLAGS,PeriodPrepare,PeriodAction
from finance.schemas import Reversal,TransferCreate

A=income.RECORDER;B=income.REVIEWER

class PeriodTests(unittest.TestCase):
    def setUp(self):
        self.r=reports.ReportsTests();self.r.setUp();self.s=self.r.service
        self.s.period_provider=lambda start,end:{'ready':True,'lastSequence':42,'cursors':{'billing':'42'}}

    def ready(self):
        self.r.finance_data();self.r.sync(self.r.lifecycle())
        self.r.sync({'kind':'billing-receivables','snapshotId':self.r.key(),'asOf':'2026-01-31','complete':True,
                     'certifiedBy':'billing-owner','evidenceReference':'Authoritative source tie','rows':[]})
        self.r.sync(self.r.certificate(**dict.fromkeys(FLAGS,True)))

    def prepare(self,key=None,actor=A):
        return self.s.prepare_period(actor,'2026-01',PeriodPrepare(reason='Reconciled completed month',evidenceReference='Private fixture reconciliation bundle',checklist=dict.fromkeys(CHECKS,True)),key or self.r.key())

    def action(self,record,operation='CLOSE',actor=B,key=None):
        return self.s.transition_period(actor,'2026-01',PeriodAction(version=record['version'],reason='Independent review or correction approval',evidenceReference='Retained reconciliation evidence'),key or self.r.key(),operation)

    def reject(self,status,fn):self.r.f.expect(status,fn)

    def test_completed_month_checklist_coverage_and_source_watermarks_are_required(self):
        self.reject(409,self.prepare)
        self.ready();self.s.period_provider=lambda *args:{'ready':False,'reason':'Pending source retry'}
        self.reject(409,self.prepare)
        self.s.period_provider=None;self.reject(503,self.prepare)
        with self.assertRaises(ValidationError):PeriodPrepare(reason='Reviewed all checks',evidenceReference='Evidence',checklist={'cashCounts':'true'})
        payload=PeriodPrepare(reason='Month reviewed',evidenceReference='Evidence',checklist=dict.fromkeys(CHECKS,True))
        self.reject(409,lambda:self.s.prepare_period(A,'2026-10',payload,self.r.key()))

    def test_complete_zero_revenue_month_closes_with_not_applicable_margins(self):
        self.r.sync({'kind':'billing-receivables','snapshotId':self.r.key(),'asOf':'2026-01-31','complete':True,'certifiedBy':'billing-owner','evidenceReference':'Certified empty as-of cohort','rows':[]})
        self.r.sync(self.r.certificate(**dict.fromkeys(FLAGS,True)))
        closed=self.action(self.prepare())
        profit=self.s.financial_report(A,'profit-and-loss','2026-01',date(2026,1,31))
        self.assertEqual(closed['status'],'CLOSED');self.assertEqual(profit['metrics']['netProfit']['value'],'0.00')
        self.assertEqual(profit['metrics']['grossMarginPercentage']['status'],'NOT_APPLICABLE')

    def test_independent_close_locks_journals_reversals_and_preserves_duplicate_recovery(self):
        self.ready();key=self.r.key();prepared=self.prepare(key)
        self.assertTrue(self.prepare(key)['idempotentReplay'])
        self.reject(403,lambda:self.action(prepared,actor=A))
        with self.s.store.read() as repo:entry=repo.entries()[0]
        self.reject(409,lambda:self.s.reverse(A,entry['id'],Reversal(effectiveDate='2026-01-31',reason='Correction to locked January'),self.r.key()))
        close_key=self.r.key();closed=self.action(prepared,key=close_key)
        self.assertEqual(closed['status'],'CLOSED');self.assertTrue(self.action(prepared,key=close_key)['idempotentReplay'])
        self.reject(409,lambda:self.prepare())
        self.reject(409,lambda:self.s.transfer(A,TransferCreate(fromAccountId=self.r.f.cash['id'],toAccountId=self.r.f.wallet['id'],amount='1.00',sourceReference=self.r.key(),effectiveDate='2026-01-31',reason='Blocked backdated transfer',method='OTHER',referenceNumber='Transfer evidence'),self.r.key()))
        self.assertEqual(self.s.financial_report(A,'cash-flow','2026-01',date(2026,1,31))['publicationVersion'],2)

    def test_frozen_reports_exports_and_publication_history_survive_reopening(self):
        self.ready();closed=self.action(self.prepare())
        first=self.s.financial_report(A,'cash-flow','2026-01',date(2026,1,31))
        with self.s.store.read() as repo:changed=deepcopy(repo.report_snapshots('subscribers')[-1]['evidence'])
        changed['snapshotId']=self.r.key();changed['events'].append({'eventId':self.r.key(),'sequence':10,'effectiveDate':'2026-01-31','source':'billing','kind':'RATE','beforeStatus':'ACTIVE','beforeCustomerId':'four','line':reports.line('f','four',rate='999.00'),'evidenceReference':'Certified Billing rate change'});self.r.sync(changed)
        self.assertEqual(self.s.subscriber_report(A,'2026-01',date(2026,1,31))['metrics']['monthlyRecurringRevenue']['value'],'570.00')
        self.assertEqual(self.s.presentation_report(A,'subscribers','2026-01',date(2026,1,31))['publicationVersion'],2)
        export=self.s.presentation_report(A,'transactions','2026-01',date(2026,1,31));self.assertEqual(len(export['items']),export['totalRows'])
        opened=self.action(closed,'REOPEN');self.assertEqual(opened['status'],'OPEN')
        with self.s.store.read() as repo:entry=next(e for e in repo.entries() if e['kind']=='TRANSFER')
        self.s.reverse(A,entry['id'],Reversal(effectiveDate='2026-01-31',reason='Audited correction after reopening'),self.r.key())
        self.r.sync(self.r.certificate(**dict.fromkeys(FLAGS,True)))
        reclosed=self.action(self.prepare());self.assertEqual(reclosed['version'],5)
        history=self.s.period_detail(A,'2026-01')['history']
        self.assertEqual([e['operation'] for e in history],['PREPARE','CLOSE','REOPEN','PREPARE','CLOSE'])
        self.assertEqual(history[1]['record']['reports']['cash-flow']['controlledCash'],first['controlledCash'])
        self.assertEqual(self.s.financial_report(A,'cash-flow','2026-01',date(2026,1,31))['publicationVersion'],5)

    def test_changed_source_boundary_or_ledger_requires_reprepare(self):
        self.ready();prepared=self.prepare();self.s.period_provider=lambda *args:{'ready':True,'lastSequence':43,'cursors':{'billing':'43'}}
        self.reject(409,lambda:self.action(prepared))
        self.action(prepared,'REOPEN');self.r.sync(self.r.certificate(**dict.fromkeys(FLAGS,True)))
        prepared=self.prepare();account=self.r.f.account('BANK')
        self.reject(409,lambda:self.action(prepared))

    def test_authorization_and_scope_rechecked_on_idempotent_retry(self):
        self.ready();key=self.r.key();self.prepare(key)
        revoked=Actor(A.username,frozenset({'finance.view'}))
        self.reject(403,lambda:self.prepare(key,revoked))
        scoped=Actor(A.username,A.permissions,account_ids=frozenset())
        self.reject(403,lambda:self.s.list_periods(scoped))
        self.reject(403,lambda:self.s.period_detail(revoked,'2026-01'))
        auditor=Actor('auditor',frozenset(p for p in A.permissions if p.endswith('.view') or p.endswith('.view_all')))
        self.assertEqual(len(self.s.list_periods(auditor)),1);self.reject(403,lambda:self.prepare(actor=auditor))

    def test_period_and_publication_roll_back_with_audit_failure(self):
        self.ready()
        with self.s.store.read() as repo:kind=type(repo)
        with patch.object(kind,'audit',side_effect=RuntimeError('Audit persistence failed')):
            with self.assertRaises(RuntimeError):self.prepare()
        self.assertEqual(self.s.list_periods(A),[])

    def test_api_close_permissions_missing_idempotency_and_read_access(self):
        import test_finance_payables as expenses
        api=importlib.import_module('finance.router');prior=(api.service,api._actor_provider)
        self.addCleanup(lambda:setattr(api,'service',prior[0]));self.addCleanup(lambda:setattr(api,'_actor_provider',prior[1]))
        api.configure_finance(lambda _:A,store=self.s.store,period_provider=self.s.period_provider)
        app=FastAPI();app.include_router(api.router)
        self.assertEqual(asyncio.run(expenses.raw_request(app,'GET','/api/finance/periods',None,{}))[0],200)
        response=asyncio.run(expenses.raw_request(app,'POST','/api/finance/periods/2026-01/prepare',{'reason':'Completed financial review','evidenceReference':'Evidence bundle','checklist':dict.fromkeys(CHECKS,True)},{}))
        self.assertEqual(response[0],400)
        api.configure_finance(lambda _:Actor('denied',frozenset({'finance.view'})),store=self.s.store)
        self.assertEqual(asyncio.run(expenses.raw_request(app,'GET','/api/finance/periods',None,{}))[0],403)

    def test_full_money_workflow_alias_remittance_refund_card_repayment_and_partial_payables_tie(self):
        direct,operating,asset,*_=self.r.finance_data();f=self.r.f
        self.r.e.payment(direct,f.cash,amount='20.00',day='2026-01-09')
        with self.s.store.read() as repo:card=next(a for a in repo.accounts() if a['kind']=='CREDIT_CARD')
        self.s.transfer(A,TransferCreate(fromAccountId=f.cash['id'],toAccountId=card['id'],amount='20.00',sourceReference=f.key(),effectiveDate='2026-01-10',reason='Repay card liability once',method='CARD_SETTLEMENT',referenceNumber='Card statement'),f.key())
        f.mapping(income.HELD,f.held)
        invoice=f.invoice(record='second-invoice');receipt=f.receipt(record='held-receipt',invoice='second-invoice',amount='120.00',advance='20.00',identity=income.HELD)
        f.sync('billing',[invoice,receipt]);before=self.r.report('collections')['grossCollections']
        for source in ('point-of-sale','collector'):
            f.sync(source,[f.event(source,'alias-'+source,'BILLING_RECEIPT_LINK',billingPaymentId='held-receipt',customerId='customer',amount='120.00')])
        remit=f.event('collector','remit','COLLECTOR_REMITTANCE',leg='CASH',expectedAmount='120.00',actualAmount='120.00',receipts=[{'billingPaymentId':'held-receipt','amount':'120.00'}],fromSettlement=income.HELD,toSettlement=income.DESK,movementEvidence='Counted office receipt',confirmedBy='collector-finance')
        f.sync('collector',[remit]);self.assertEqual(self.r.report('collections')['grossCollections'],before)
        f.sync('billing',[f.reverse(receipt,'REFUND',day='2026-01-11',refundSettlement=income.DESK)])
        cash=self.r.report('cash-flow');self.assertEqual(cash['controlledCash']['closing'],'1142.00');self.assertEqual(cash['controlledCash']['reconciliationVariance'],'0.00')
        self.assertEqual(cash['cardLiabilities'],'0.00');self.assertEqual(f.balance(f.held['id']),'0.00')
        self.assertEqual(self.r.report('payables')['total'],'0.00');self.assertEqual(self.r.report('expenses')['total'],'50.00')
        self.assertEqual(self.r.report('collections')['refunds'],'120.00');self.assertEqual(f.balance(income.CREDIT),'20.00')
        self.assertEqual(self.r.report('transactions')['totalDebits'],self.r.report('transactions')['totalCredits'])

if __name__=='__main__':unittest.main()
