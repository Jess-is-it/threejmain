"""Report reconciliation, dated evidence, complete windows and authorization."""
import asyncio
from copy import deepcopy
from datetime import date
from decimal import Decimal
import importlib
import unittest
from unittest.mock import patch

from fastapi import FastAPI, HTTPException

import test_finance_income as income
import test_finance_payables as expenses
from finance.memory import MemoryRepository
from finance.permissions import Actor, PERMISSIONS
from finance.reporting import ReportingService, month_window
from finance.report_schemas import ReportSync, POLICY
from finance.schemas import TransferCreate, Reversal, JournalCreate
from finance.income_schemas import ReviewAction
from finance.expense_schemas import CategoryCreate
from finance.report_adapters import BillingReportAdapter

A=income.RECORDER


class Provider:
    def __init__(self,evidence):self.evidence=evidence;self.calls=0
    def fetch(self,request):self.calls+=1;return deepcopy(self.evidence)


def line(line_id,customer,status='ACTIVE',ever=True,migrated=False,rate='100.00'):
    return {'serviceAccountId':line_id,'customerId':customer,'status':status,'everActive':ever,
            'migratedExisting':migrated,'billable':True,'monthlyRecurringRate':rate,
            'rateEvidence':'Dated Billing monthly rate' if rate is not None else ''}


class ReportsTests(unittest.TestCase):
    def setUp(self):
        self.f=income.IncomeTests();self.f.setUp();self.store=self.f.store
        self.service=ReportingService(self.store,today=lambda:date(2026,10,12));self.f.service=self.service
        self.e=expenses.PayablesTests();self.e.store=self.store;self.e.service=self.service
        self.repository_class=MemoryRepository

    def key(self):return self.f.key()

    def report(self,kind,month='2026-01',as_of=None,**options):
        return self.service.financial_report(A,kind,month,date.fromisoformat(as_of or '2026-01-31'),**options)

    def sync(self,evidence,month='2026-01',as_of='2026-01-31',key=None):
        kind=evidence['kind'];self.service.report_providers[kind]=Provider(evidence)
        return self.service.sync_report_evidence(A,kind,ReportSync(month=month,asOf=as_of),key or self.key())

    def lifecycle(self):
        baseline=[line('a','one',migrated=True),line('b','one'),line('c','two','SUSPENDED',rate='70.00')]
        proof={'kind':'subscribers','snapshotId':self.key(),'baselineDate':'2025-12-31','completeThrough':'2026-01-31',
               'historicalCustomerIds':['one','two'],'baseline':baseline,'events':[],
               'ratesComplete':True,'certifiedBy':'service-owner','evidenceReference':'Reviewed Service baseline and lifecycle'}
        states={r['serviceAccountId']:r for r in baseline}
        def event(day,kind,new):
            old=states.get(new['serviceAccountId'])
            proof['events'].append({'eventId':self.key(),'sequence':len(proof['events'])+1,'effectiveDate':day,
                'source':'billing' if kind=='RATE' else 'service','kind':kind,'beforeStatus':old['status'] if old else None,
                'beforeCustomerId':old['customerId'] if old else '', 'line':new,'evidenceReference':'Certified dated source transition'})
            states[new['serviceAccountId']]=new
        event('2026-01-02','ACTIVATION',line('d','one'))
        event('2026-01-03','MIGRATION_BASELINE',line('e','three',migrated=True))
        event('2026-01-04','ACTIVATION',line('f','four'))
        event('2026-01-05','REACTIVATION',line('c','two',rate='70.00'))
        event('2026-01-06','SUSPENSION',line('a','one','SUSPENDED',migrated=True))
        event('2026-01-07','DISCONNECTION',line('b','one','DISCONNECTED'))
        event('2026-01-08','TERMINATION',line('b','one','TERMINATED'))
        event('2026-01-09','OWNERSHIP',line('d','five'))
        return proof

    def finance_data(self):
        self.f.opening(self.f.cash,'1000.00');self.f.cutover();self.f.mapping()
        i=self.f.invoice();r=self.f.receipt(amount='120.00',advance='20.00');self.f.sync('billing',[i,r])
        sale=self.f.event('point-of-sale','sale','POS_SALE',grossAmount='120.00',discountAmount='20.00',taxAmount='12.00',delivered=True,deliveryEvidence='Certified delivered hardware')
        pay=self.f.event('point-of-sale','payment','POS_RECEIPT',saleId='sale',amount='112.00',settlement=income.DESK)
        self.f.sync('point-of-sale',[sale,pay])
        direct=self.e.posted(self.e.draft(amount='30.00',classification='DIRECT_COST',expenseDate='2026-01-03',locationReference='POP-A',projectReference='FIBER-A'))
        operating=self.e.posted(self.e.draft(amount='20.00',expenseDate='2026-01-04'))
        self.e.payment(direct,self.f.cash,amount='10.00',day='2026-01-05')
        card=self.f.account('CREDIT_CARD');self.e.payment(operating,card,amount='20.00',day='2026-01-05',method='CREDIT_CARD')
        asset=self.e.posted(self.e.draft(amount='40.00',classification='ASSET',expenseDate='2026-01-06'))
        self.e.payment(asset,self.f.cash,amount='40.00',day='2026-01-06')
        self.service.transfer(A,TransferCreate(fromAccountId=self.f.cash['id'],toAccountId=self.f.wallet['id'],amount='50.00',sourceReference=self.key(),effectiveDate='2026-01-07',reason='Named internal funds movement',method='OTHER',referenceNumber='Transfer evidence'),self.key())
        return direct,operating,asset,r,sale,pay

    def certificate(self,**flags):
        report=self.report('profit-and-loss')
        return {'kind':'financial-coverage','snapshotId':self.key(),'startDate':'2026-01-01','endDate':'2026-01-31',
                'policyVersion':POLICY,'ledgerFingerprint':report['ledgerFingerprint'],'evidenceReference':'Complete reviewed journal and source coverage',
                'certifiedBy':'independent-finance-owner',**flags}

    def test_cash_balances_internal_transfer_card_capex_and_journal_drilldown_tie(self):
        self.finance_data();report=self.report('cash-flow')
        cash=report['controlledCash']
        self.assertEqual(cash,{'opening':'0.00','openingAdjustments':'1000.00','netCashFlow':'182.00','closing':'1182.00','reconciliationVariance':'0.00'})
        self.assertEqual(report['flows']['OPERATING'],'222.00');self.assertEqual(report['flows']['INVESTING'],'-40.00')
        self.assertEqual(report['cardLiabilities'],'20.00');self.assertEqual(len(report['eliminatedInternalJournalIds']),1)
        self.assertEqual(sum(Decimal(r['amount']) for r in report['transactions']),Decimal(cash['netCashFlow']))
        drill=self.report('transactions',limit=1)
        self.assertEqual(len(drill['items']),1);self.assertGreater(drill['totalRows'],1)
        all_rows=self.report('transactions',limit=500)
        self.assertEqual(drill['totalDebits'],all_rows['totalDebits']);self.assertEqual(all_rows['totalDebits'],all_rows['totalCredits'])
        january_end=sum(Decimal(r['closingBalance']) for r in report['accounts'] if r['controlledCash'])
        feb=self.report('cash-flow',month='2026-02',as_of='2026-02-28')
        self.assertEqual(Decimal(feb['controlledCash']['opening']),january_end)

    def test_profit_components_no_cash_revenue_or_assets_and_missing_net_profit(self):
        self.finance_data();report=self.report('profit-and-loss');m=report['metrics']
        self.assertEqual(m['earnedRevenue']['value'],'100.00');self.assertEqual(m['directCosts']['value'],'30.00')
        self.assertEqual(m['operatingExpenses']['value'],'20.00');self.assertIsNone(m['netProfit']['value'])
        self.assertEqual(m['grossProfit']['recordedValue'],'70.00');self.assertEqual(m['operatingProfit']['recordedValue'],'50.00')
        self.assertEqual(report['deferredConsiderationAsOf'],'100.00')
        for classification,value in report['recordedClassTotals'].items():
            self.assertEqual(Decimal(value),sum((Decimal(r['amount']) for r in report['transactions'] if r['classification']==classification),Decimal('0.00')))

    def test_other_income_loans_and_owner_funding_have_separate_profit_and_cash_classes(self):
        for classification in ('OTHER_INCOME','LOAN_PROCEEDS','OWNER_FUNDING','OWNER_LOAN'):
            r=self.f.manual(classification);r=self.f.review(r,'submit',A);r=self.f.review(r)
            self.service.post_manual(A,r['id'],ReviewAction(version=r['version'],reason='Post independently reviewed funding'),self.key())
        profit=self.report('profit-and-loss');cash=self.report('cash-flow')
        self.assertEqual(profit['metrics']['earnedRevenue']['value'],'0.00')
        self.assertEqual(profit['metrics']['nonoperatingIncome']['value'],'50.00')
        self.assertEqual(cash['flows']['OPERATING'],'50.00');self.assertEqual(cash['flows']['FINANCING'],'150.00')

    def test_interest_and_tax_are_below_operating_profit_and_tax_absence_remains_unavailable(self):
        self.finance_data()
        for code,cost in (('FINANCE_INTEREST','5.00'),('INCOME_TAX','10.00')):
            account=self.e.account('GENERAL_LEDGER','EXPENSE')
            category=self.service.create_master(expenses.CREATOR,'category',CategoryCreate(code=code,name=code,classification='OPERATING_EXPENSE',accountId=account['id']),self.key())
            self.e.posted(self.e.draft(amount=cost,categoryId=category['id'],expenseDate='2026-01-08'))
        self.sync(self.certificate(earnedRevenue=True,directCosts=True,operatingExpenses=True,nonoperating=True))
        r=self.report('profit-and-loss')['metrics'];self.assertEqual(r['operatingProfit']['value'],'50.00')
        self.assertEqual(r['profitBeforeTax']['value'],'45.00');self.assertEqual(r['incomeTax']['value'],'10.00');self.assertIsNone(r['netProfit']['value'])
        self.sync(self.certificate(earnedRevenue=True,directCosts=True,operatingExpenses=True,nonoperating=True,incomeTax=True))
        self.assertEqual(self.report('profit-and-loss')['metrics']['netProfit']['value'],'35.00')

    def test_coverage_certificate_is_exact_and_invalidated_by_later_financial_evidence(self):
        self.finance_data();self.sync(self.certificate(earnedRevenue=True,directCosts=True,operatingExpenses=True,nonoperating=True,incomeTax=True,cashFlow=True,registerReceivables=True,payables=True,collections=True))
        report=self.report('profit-and-loss');self.assertEqual(report['metrics']['netProfit']['value'],'50.00');self.assertEqual(report['status'],'COMPLETE')
        self.assertEqual(self.report('cash-flow')['status'],'COMPLETE');self.assertEqual(self.report('payables')['status'],'COMPLETE')
        new=self.f.invoice(record='later-invoice');self.f.sync('billing',[new])
        self.assertIsNone(self.report('profit-and-loss')['metrics']['netProfit']['value'])
        stale=self.certificate(earnedRevenue=True);stale['ledgerFingerprint']='0'*64
        self.f.expect(502,lambda:self.sync(stale))

    def test_expense_all_dimensions_recognition_and_settlement_tie_without_capex(self):
        direct,operating,asset,*_=self.finance_data()
        for group in ('category','payee','account','location','project'):
            r=self.report('expenses',group_by=group)
            self.assertEqual(r['total'],'50.00');self.assertEqual(r['reconciliationVariance'],'0.00')
            self.assertEqual(sum(Decimal(g['amount']) for g in r['groups']),Decimal('50.00'))
            self.assertNotIn(asset['id'],{row['payableId'] for row in r['transactions']})
        settled=self.report('expenses',basis='SETTLED',group_by='account')
        self.assertEqual(settled['total'],'30.00');self.assertNotEqual(settled['total'],self.report('expenses')['total'])
        self.assertEqual(settled['cashPaidTotal'],'10.00')

    def test_uncategorized_expense_journal_is_visible_and_blocks_complete_profit(self):
        self.f.opening(self.f.cash,'100.00');expense=self.f.account('GENERAL_LEDGER',glType='EXPENSE')
        self.service.post_journal(A,JournalCreate(sourceReference=self.key(),effectiveDate='2026-01-05',reason='Attributed accounting correction',
            lines=[{'accountId':expense['id'],'debit':'10.00','credit':'0.00'},
                   {'accountId':self.f.cash['id'],'debit':'0.00','credit':'10.00'}]),self.key())
        r=self.report('expenses');self.assertEqual(r['total'],'10.00');self.assertEqual(r['groups'][0]['id'],'UNASSIGNED')
        self.assertEqual(self.report('profit-and-loss')['recordedClassTotals']['UNCLASSIFIED_EXPENSE'],'10.00')
        self.sync(self.certificate(earnedRevenue=True,directCosts=True,operatingExpenses=True,nonoperating=True,incomeTax=True))
        self.assertIsNone(self.report('profit-and-loss')['metrics']['netProfit']['value'])

    def test_reconciliation_exception_acknowledgment_keeps_variance_and_receipt_cash_bridge(self):
        self.f.cutover();self.f.mapping(income.PERSONAL,self.f.personal);self.f.mapping(income.COMPANY,self.f.wallet)
        self.f.sync('billing',[self.f.invoice(),self.f.receipt(identity=income.PERSONAL)])
        remit=self.f.event('collector','remit','COLLECTOR_REMITTANCE',leg='GCASH',expectedAmount='100.00',actualAmount='90.00',
            receipts=[{'billingPaymentId':'receipt','amount':'100.00'}],fromSettlement=income.PERSONAL,toSettlement=income.COMPANY,
            movementEvidence='Actual company-wallet settlement evidence',confirmedBy='source-finance')
        self.f.sync('collector',[remit]);r=self.report('reconciliation');self.assertEqual(r['counts']['OPEN'],1)
        self.assertEqual(r['varianceClearingAsOf'],'10.00')
        self.assertEqual(self.report('cash-flow')['controlledCash']['netCashFlow'],'90.00')
        self.assertEqual(self.report('collections')['grossCollections'],'100.00')
        exception=r['rows'][0]
        self.service.acknowledge_exception(A,exception['id'],ReviewAction(version=exception['version'],reason='Review pending; not an expense disposition'),self.key())
        r=self.report('reconciliation');self.assertEqual(r['counts']['ACKNOWLEDGED'],1);self.assertEqual(r['varianceClearingAsOf'],'10.00')
        self.sync(self.certificate(earnedRevenue=True,directCosts=True,operatingExpenses=True,nonoperating=True,incomeTax=True))
        self.assertIsNone(self.report('profit-and-loss')['metrics']['netProfit']['value'])

    def test_historical_payables_include_later_reversed_documents_and_partial_payments(self):
        r=self.e.posted(self.e.draft(amount='100.00'))
        funds=self.e.funds();p=self.e.payment(r,funds,amount='30.00',day='2026-01-02')
        self.service.reverse_payment(expenses.CREATOR,p['id'],Reversal(effectiveDate='2026-02-01',reason='Payment correction later'),self.key())
        self.service.reverse_payable(expenses.CREATOR,r['id'],Reversal(effectiveDate='2026-02-02',reason='Recognition corrected later'),self.key())
        january=self.report('payables');feb=self.report('payables',month='2026-02',as_of='2026-02-28')
        self.assertEqual(january['total'],'70.00');self.assertEqual(january['controlBalance'],'70.00');self.assertEqual(january['reconciliationVariance'],'0.00')
        self.assertEqual(feb['total'],'0.00');self.assertEqual(self.report('expenses')['total'],'100.00')
        self.assertEqual(self.report('expenses',month='2026-02',as_of='2026-02-28')['total'],'-100.00')

    def test_receivables_itemized_source_effects_equal_gl_and_billing_authoritative_snapshot(self):
        self.f.cutover();self.f.mapping();self.f.sync('billing',[self.f.invoice(),self.f.receipt(amount='40.00')])
        r=self.report('receivables');self.assertEqual(r['total'],'60.00');self.assertEqual(r['billingReconciliationVariance'],'0.00')
        self.assertEqual(r['rows'][0]['agingBucket'],'UNKNOWN')
        proof={'kind':'billing-receivables','snapshotId':self.key(),'asOf':'2026-01-31','complete':True,
               'certifiedBy':'billing-owner','evidenceReference':'Full authoritative as-of snapshot',
               'rows':[{'invoiceId':'invoice','customerId':'customer','dueDate':'2026-01-01','outstandingAmount':'60.00'}]}
        self.sync(proof);r=self.report('receivables');self.assertEqual(r['billingStatus'],'COMPLETE');self.assertEqual(r['rows'][0]['agingBucket'],'1_30')
        proof=deepcopy(proof);proof['snapshotId']=self.key();proof['rows'][0]['outstandingAmount']='65.00';self.sync(proof)
        r=self.report('receivables');self.assertEqual(r['billingReconciliationVariance'],'-5.00');self.assertEqual(r['status'],'PROVISIONAL')

    def test_canonical_receipt_month_advance_refund_and_alias_no_funds_do_not_repeat_payers(self):
        self.f.cutover();self.f.mapping();i=self.f.invoice();r=self.f.receipt(amount='120.00',advance='20.00');self.f.sync('billing',[i,r])
        link=self.f.event('point-of-sale','pos-invoice-link','BILLING_RECEIPT_LINK',billingPaymentId='receipt',customerId='customer',amount='120.00')
        self.f.sync('point-of-sale',[link]);january=self.report('collections')
        self.assertEqual(january['grossCollections'],'120.00');self.assertEqual(january['customersWhoPaid'],1)
        refund=self.f.reverse(r,'REFUND',day='2026-02-01',refundSettlement=income.DESK);self.f.sync('billing',[refund])
        self.assertEqual(self.report('collections')['grossCollections'],'120.00')
        feb=self.report('collections',month='2026-02',as_of='2026-02-28');self.assertEqual(feb['refunds'],'120.00');self.assertEqual(feb['customersWhoPaid'],0)

    def test_duplicate_correction_through_alias_excludes_false_payer(self):
        self.f.cutover();self.f.mapping();r=self.f.receipt();self.f.sync('billing',[self.f.invoice(),r])
        alias={**r,'eventId':self.key(),'recordVersion':2};self.f.sync('billing',[alias])
        self.f.sync('billing',[self.f.reverse(alias,'DUPLICATE_NO_FUNDS')]);report=self.report('collections')
        self.assertEqual(report['grossCollections'],'0.00');self.assertEqual(report['customersWhoPaid'],0)

    def test_subscriber_lines_customers_migration_transitions_and_mrr_reconcile(self):
        proof=self.lifecycle();self.sync(proof);r=self.service.subscriber_report(A,'2026-01',date(2026,1,31));m=r['metrics']
        expected={'openingActiveLines':2,'closingActiveLines':4,'openingActiveCustomers':1,'closingActiveCustomers':4,
                  'newActivations':2,'reactivations':1,'suspensions':1,'terminations':1,'disconnections':1,'activeExits':2,
                  'migrationBaselineAdjustment':1,'newSubscriberCustomers':1,'netLineGrowth':2,'netCustomerGrowth':3}
        for key,value in expected.items():self.assertEqual(m[key]['value'],value,key)
        self.assertEqual(m['monthlyRecurringRevenue']['value'],'570.00')
        self.assertEqual(m['lineGrowthPercentage']['value'],'100.00');self.assertEqual(m['customerGrowthPercentage']['value'],'300.00')
        self.assertEqual(r['lineReconciliationVariance'],0);self.assertEqual(r['customerReconciliationVariance'],0)
        self.assertEqual(r['receiptMonth']['customersWhoPaid'],0);self.assertEqual(r['billingPeriodSettlement']['status'],'UNAVAILABLE')

    def test_repeated_transitions_count_events_once_per_effect_and_pending_disconnect_remains_active(self):
        proof={'kind':'subscribers','snapshotId':self.key(),'baselineDate':'2025-12-31','completeThrough':'2026-01-31',
            'historicalCustomerIds':['one'],'baseline':[line('a','one')],'events':[],'ratesComplete':True,
            'certifiedBy':'service-owner','evidenceReference':'Verified repeated dated lifecycle history'}
        old=proof['baseline'][0]
        for index,(kind,status) in enumerate((('STATUS','PENDING_DISCONNECTION'),('SUSPENSION','SUSPENDED'),('REACTIVATION','ACTIVE'),('SUSPENSION','SUSPENDED'),('REACTIVATION','ACTIVE'))):
            new=line('a','one',status)
            proof['events'].append({'eventId':self.key(),'sequence':index+1,'effectiveDate':f'2026-01-{index+2:02d}',
                'source':'service','kind':kind,'beforeStatus':old['status'],'beforeCustomerId':'one','line':new,'evidenceReference':'Dated lifecycle effect'})
            old=new
        self.sync(proof);r=self.service.subscriber_report(A,'2026-01',date(2026,1,31))
        self.assertEqual(r['metrics']['newActivations']['value'],0);self.assertEqual(r['metrics']['reactivations']['value'],2)
        self.assertEqual(r['metrics']['suspensions']['value'],2);self.assertEqual(r['lineReconciliationVariance'],0)
        self.assertEqual(r['metrics']['netLineGrowth']['value'],0)

    def test_absent_history_current_snapshot_and_missing_rate_are_not_zero_growth(self):
        r=self.service.subscriber_report(A,'2026-01',date(2026,1,31))
        self.assertIsNone(r['metrics']['newActivations']['value']);self.assertEqual(r['status'],'UNAVAILABLE')
        self.assertIsNone(r['metrics']['customersWhoPaidDuringMonth']['value'])
        proof={'kind':'subscribers','snapshotId':self.key(),'baselineDate':'2026-01-31','completeThrough':'2026-01-31',
             'historicalCustomerIds':['one'],'baseline':[line('a','one',rate=None)],'events':[],'ratesComplete':False,
             'evidenceReference':'Certified closing census only','certifiedBy':'service-owner'}
        self.sync(proof);r=self.service.subscriber_report(A,'2026-01',date(2026,1,31))
        self.assertEqual(r['metrics']['closingActiveLines']['value'],1);self.assertIsNone(r['metrics']['openingActiveLines']['value'])
        self.assertIsNone(r['metrics']['monthlyRecurringRevenue']['value'])

    def test_lifecycle_before_state_migration_and_immutable_replays_reject_bad_evidence(self):
        proof=self.lifecycle();self.sync(proof,key='same-proof');provider=self.service.report_providers['subscribers']
        self.service.sync_report_evidence(A,'subscribers',ReportSync(month='2026-01',asOf='2026-01-31'),'same-proof')
        self.assertEqual(provider.calls,1)
        wrong=deepcopy(proof);wrong['snapshotId']=self.key();wrong['events'][0]['beforeStatus']='ACTIVE'
        self.f.expect(502,lambda:self.sync(wrong))
        wrong=deepcopy(proof);wrong['snapshotId']=self.key();wrong['events'][1]['kind']='ACTIVATION'
        self.f.expect(502,lambda:self.sync(wrong))
        changed=deepcopy(proof);changed['snapshotId']=self.key();changed['events'][0]['evidenceReference']='Altered immutable source evidence'
        self.f.expect(409,lambda:self.sync(changed))
        omitted=deepcopy(proof);omitted['snapshotId']=self.key();omitted['events'].pop()
        self.f.expect(409,lambda:self.sync(omitted))

    def test_billing_month_full_partial_unpaid_and_overlapping_rebates_tie_to_source(self):
        rows=[]
        for index,(cash,credit,due,rebate) in enumerate((('80.00','20.00','0.00','20.00'),('25.00','0.00','75.00','0.00'),('0.00','0.00','100.00','0.00'))):
            rows.append({'customerId':str(index),'serviceAccountIds':[f'l{index}'], 'invoiceIds':[f'i{index}'],
              'netBilledAmount':'100.00','cashCollected':cash,'accountCreditsApplied':credit,'rebatesApplied':rebate,'outstandingAmount':due})
        proof={'kind':'billing-settlement','snapshotId':self.key(),'month':'2026-01','asOf':'2026-02-28','complete':True,
            'certifiedBy':'billing-owner','evidenceReference':'Full January invoice cohort as of February end','rows':rows}
        self.sync(proof,as_of='2026-02-28');r=self.service.subscriber_report(A,'2026-01',date(2026,2,28))
        cohort=r['billingPeriodSettlement'];self.assertEqual((cohort['full'],cohort['partial'],cohort['unpaid']),(1,1,1))
        self.assertEqual(cohort['netBilledAmount'],'300.00');self.assertEqual(cohort['cashCollected'],'105.00');self.assertEqual(cohort['accountCreditsApplied'],'20.00')
        self.assertEqual(cohort['outstandingAmount'],'175.00');self.assertEqual(cohort['reconciliationVariance'],'0.00')
        self.assertEqual(r['receiptMonth']['grossCollections'],'0.00')
        bad=deepcopy(proof);bad['snapshotId']=self.key();bad['rows'][0]['outstandingAmount']='1.00'
        self.f.expect(502,lambda:self.sync(bad,as_of='2026-02-28'))

    def test_comparisons_cap_both_mtd_windows_and_zero_denominator_is_na(self):
        self.service.today=lambda:date(2026,3,30)
        r=self.service.comparison(A,'cash-flow','2026-03')
        self.assertEqual(r['comparisonMode'],'EQUIVALENT_MONTH_TO_DATE');self.assertEqual(r['equivalentDays'],28)
        self.assertEqual(r['current']['period']['endDate'],'2026-03-28');self.assertEqual(r['prior']['period']['endDate'],'2026-02-28')
        self.assertIsNone(r['changes']['netCashFlow']['percentageChange']);self.assertEqual(r['changes']['netCashFlow']['status'],'NOT_APPLICABLE')
        self.service.today=lambda:date(2026,10,12)
        r=self.service.comparison(A,'cash-flow','2026-03',date(2026,3,31))
        self.assertEqual(r['comparisonMode'],'COMPLETE_MONTHS');self.assertEqual(r['current']['period']['endDate'],'2026-03-31')
        self.e.posted(self.e.draft(amount='25.00'))
        r=self.service.comparison(A,'expenses','2026-01',date(2026,1,31),basis='RECOGNIZED',group_by='location')
        self.assertEqual(r['current']['total'],'25.00');self.assertEqual(r['prior']['total'],'0.00')
        self.assertEqual(r['changes']['total']['absoluteChange'],'25.00');self.assertIsNone(r['changes']['total']['percentageChange'])
        self.f.expect(400,lambda:month_window('2026-01',date(2026,10,13),date(2026,10,12)))

    def test_unauthorized_scoped_revoked_sync_and_missing_provider_fail_closed(self):
        self.f.expect(403,lambda:self.service.financial_report(Actor('denied',frozenset()),'transactions','2026-01'))
        limited=Actor('limited',frozenset(PERMISSIONS),account_ids=frozenset({self.f.cash['id']}))
        self.f.expect(403,lambda:self.service.financial_report(limited,'cash-flow','2026-01'))
        self.f.expect(503,lambda:self.service.sync_report_evidence(A,'subscribers',ReportSync(month='2026-01'),'missing'))
        proof=self.lifecycle();self.sync(proof,key='repeat')
        self.f.expect(403,lambda:self.service.sync_report_evidence(Actor(A.username,frozenset({'finance.reports.evidence.sync'})),'subscribers',ReportSync(month='2026-01',asOf='2026-01-31'),'repeat'))

    def test_snapshot_failure_rolls_back_evidence_operation_and_audit(self):
        proof=self.lifecycle();self.service.report_providers['subscribers']=Provider(proof)
        with patch.object(self.repository_class,'save_operation',side_effect=RuntimeError('Operation evidence failure')):
            with self.assertRaises(RuntimeError):self.service.sync_report_evidence(A,'subscribers',ReportSync(month='2026-01',asOf='2026-01-31'),'failed-snapshot')
        with self.store.read() as repo:self.assertEqual(repo.report_snapshots(),[]);self.assertIsNone(repo.operation('reports.evidence.sync','failed-snapshot'))


class ReportsHttpTests(unittest.TestCase):
    def setUp(self):
        self.module=importlib.import_module('finance.router');self.old=(self.module.service,self.module._actor_provider)
        self.fixture=ReportsTests();self.fixture.setUp()
        self.module.configure_finance(lambda token:A if token=='Bearer reports' else Actor('no-report',frozenset()),store=self.fixture.store)
        self.app=FastAPI();self.app.include_router(self.module.router)
    def tearDown(self):self.module.service,self.module._actor_provider=self.old
    def call(self,method,path,body=None,token='reports'):
        route,_,query=path.partition('?')
        async def app_with_query(scope,receive,send):
            await self.app({**scope,'query_string':query.encode()},receive,send)
        return asyncio.run(expenses.raw_request(app_with_query,method,route,body,{'Authorization':f'Bearer {token}','Idempotency-Key':'http-report-key'}))
    def test_http_report_routes_auth_period_and_provider_validation(self):
        root='/api/finance/reports/'
        self.assertEqual(self.call('GET',root+'cash-flow?month=2026-01')[0],200)
        self.assertEqual(self.call('GET',root+'subscribers?month=2026-01')[0],200)
        self.assertEqual(self.call('GET',root+'billing-settlement?month=2026-01')[0],200)
        self.assertEqual(self.call('GET',root+'comparison?kind=cash-flow&month=2026-01')[0],200)
        self.assertEqual(self.call('GET',root+'profit-and-loss?month=2026-01',token='denied')[0],403)
        self.assertEqual(self.call('GET',root+'transactions?month=2026-13')[0],422)
        self.assertEqual(self.call('GET',root+'transactions?month=2026-01&asOf=2099-01-01')[0],400)
        self.assertEqual(self.call('POST',root+'evidence/subscribers/sync',{'month':'2026-01','baseline':[]})[0],422)
        self.assertEqual(self.call('POST',root+'evidence/subscribers/sync',{'month':'2026-01'})[0],503)


class ReportAdapterTests(unittest.TestCase):
    def test_billing_original_cohort_phone_free_mapping_and_page_total_reconciliation(self):
        source={'scope':'MONTHLY_SERVICE_INVOICES','timeZone':'Asia/Manila','billingMonth':'2026-01','asOfDate':'2026-02-28',
            'selectedStatus':'ALL','search':'','billedSubscriberCount':1,'cohortInvoiceCount':2,'fullyPaidSubscriberCount':1,
            'partiallyPaidSubscriberCount':0,'unpaidSubscriberCount':0,'netBilledAmount':100.0,'cashCollected':80.0,
            'accountCreditsApplied':20.0,'rebatesApplied':20.0,'outstandingAmount':0.0,'pagination':{'totalRows':1},
            'rows':[{'customerId':'customer','customer':{'contactNumber':'private'},'billedAmount':100.0,
                     'cashCollected':80.0,'accountCreditsApplied':20.0,'rebatesApplied':20.0,'outstandingAmount':0.0}]}
        proof={'snapshotId':'snapshot','certifiedBy':'billing-owner','evidenceReference':'Certified whole source cohort','complete':True}
        options={'invoice_ids_by_customer':{'customer':['invoice-a','invoice-b']},'service_account_ids_by_customer':{'customer':['line-a']}}
        r=BillingReportAdapter.settlement(source,proof,**options)
        self.assertEqual(r.rows[0].netBilledAmount,Decimal('100.00'));self.assertNotIn('contactNumber',str(r.model_dump()))
        source['pagination']['totalRows']=2
        with self.assertRaises(ValueError):BillingReportAdapter.settlement(source,proof,**options)
        source['pagination']['totalRows']=1;source['cashCollected']=100.0
        with self.assertRaises(ValueError):BillingReportAdapter.settlement(source,proof,**options)


if __name__=='__main__':unittest.main()
