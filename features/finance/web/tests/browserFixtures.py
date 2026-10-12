"""Temporary browser fixture responses produced by the real Finance API in memory.
No application database/runtime changes. Run with API + API tests on PYTHONPATH.
"""
import json
import sys
from datetime import date
from fastapi import FastAPI
import test_finance_reports as reports
import test_finance_income as income
import test_finance_payables as payables
from finance.permissions import Actor, PERMISSIONS
from finance.schemas import AccountCreate, TransferCreate


def fixtures():
    f=reports.ReportsHttpTests();f.setUp();s=f.fixture.service;x=f.fixture.f;e=f.fixture.e
    x.opening(x.cash,'1000.00')
    s.transfer(income.RECORDER,TransferCreate(fromAccountId=x.cash['id'],toAccountId=x.wallet['id'],amount='100.00',effectiveDate='2026-01-03',sourceReference=x.key(),reason='Move company cash to wallet',method='GCASH_TRANSFER',referenceNumber='Wallet evidence'),x.key())
    for index in range(26):s.create_account(income.RECORDER,AccountCreate(code=f'PETTY_{index:02d}',name=f'Petty cash office {index:02d}',kind='PETTY_CASH'),x.key())
    payable=e.posted(e.draft(amount='100.00'));e.payment(payable,x.cash,'30.00')
    e.posted(e.draft(amount='50.00',classification='DIRECT_COST'))
    e.action(e.draft(amount='75.00'),'submit')
    f.fixture.sync(f.fixture.lifecycle())
    settlement={'kind':'billing-settlement','snapshotId':x.key(),'month':'2026-01','asOf':'2026-01-31','complete':True,
      'rows':[{'customerId':'one','serviceAccountIds':['a'],'invoiceIds':['one-jan'],'netBilledAmount':'100.00','cashCollected':'80.00','accountCreditsApplied':'20.00','rebatesApplied':'10.00','outstandingAmount':'0.00'},
              {'customerId':'two','serviceAccountIds':['c'],'invoiceIds':['two-jan'],'netBilledAmount':'200.00','cashCollected':'50.00','accountCreditsApplied':'20.00','rebatesApplied':'0.00','outstandingAmount':'130.00'},
              {'customerId':'three','serviceAccountIds':['e'],'invoiceIds':['three-jan'],'netBilledAmount':'300.00','cashCollected':'0.00','accountCreditsApplied':'0.00','rebatesApplied':'0.00','outstandingAmount':'300.00'}],
      'certifiedBy':'billing-owner','evidenceReference':'Whole bill-month cohort and allocations'}
    f.fixture.sync(settlement)
    # The active browser actor owns the submitted expense, so self-review is hidden.
    f.module.service=s;f.module._actor_provider=lambda token:Actor(payables.CREATOR.username,frozenset(PERMISSIONS))
    data={}
    def get(path):
        status,headers,payload=f.call('GET','/api/finance/'+path)
        if status!=200:raise RuntimeError(f'Fixture {path}: {status}: {payload}')
        return json.loads(payload)
    for path in ('meta','accounts','opening-balances','journals','transfers','payables','payees','categories','income','settlement-mappings','cutover-plans','sources','reconciliation-exceptions','periods'):
        data[path]=get(path)
    for row in data['payables']:
        data['payables/'+row['id']]=get('payables/'+row['id']);data['payables/'+row['id']+'/attachments']=get('payables/'+row['id']+'/attachments')
    for row in data['accounts']:data['accounts/'+row['id']+'/activity']=get('accounts/'+row['id']+'/activity?asOf=2026-01-31')
    for row in data['journals']:data['journals/'+row['id']]=get('journals/'+row['id'])
    for kind in ('cash-flow','profit-and-loss','expenses','payables','receivables','reconciliation','collections','transactions','subscribers','billing-settlement'):
        data['reports/'+kind]=get('reports/'+kind+'?month=2026-01&asOf=2026-01-31&allRecords=true')
        data['reports/'+kind+'/print']=get('reports/'+kind+'/print?month=2026-01&asOf=2026-01-31')
        if kind not in ('reconciliation','transactions','billing-settlement'):data['comparison/'+kind]=get('reports/comparison?kind='+kind+'&month=2026-01&asOf=2026-01-31')
    for kind in ('profit-and-loss','subscribers'):data['series/'+kind]=get('reports/monthly-series?kind='+kind+'&month=2026-01&asOf=2026-01-31&months=6')
    f.tearDown();return data

if __name__=='__main__':
    with open(sys.argv[1],'w') as stream:json.dump(fixtures(),stream)
