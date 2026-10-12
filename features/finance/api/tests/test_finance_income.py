"""Canonical income effects, cutover, custody and independent approval invariants."""
import asyncio
import importlib
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal
from pathlib import Path
from threading import Barrier
from unittest.mock import patch
from uuid import uuid4

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI, HTTPException
from pydantic import ValidationError

from finance.income import IncomeService, stable_id
from finance.income_controls import AR, CREDIT, DEFERRED, POS_AR, POS_REVENUE, POS_DISCOUNT, TAX, VARIANCE
from finance.income_schemas import (SourceEvent,SourceBatch,MappingCreate,ManualIncomeCreate,CutoverCreate,
                                    ReviewAction,SyncRequest)
from finance.ledger import normal_balance
from finance.memory import MemoryStore,MemoryRepository
from finance.permissions import Actor,PERMISSIONS
from finance.schemas import AccountCreate,Approval,OpeningCreate,Reversal,JournalCreate
from finance.source_adapters import BillingAdapter,PosAdapter,CollectorAdapter,ServiceAdapter

RECORDER=Actor('recorder',frozenset(PERMISSIONS))
REVIEWER=Actor('reviewer',frozenset(PERMISSIONS))
DAY='2026-01-02'
PROOF={'eventId':'event','recordVersion':1,'operationId':'source-op','occurredAt':'2026-01-02T02:00:00Z','effectiveDate':DAY}
DESK={'channel':'POS','operator':'cashier-a','method':'CASH','institution':'register-a'}
HELD={'channel':'COLLECTOR','operator':'collector-a','method':'CASH','institution':'custody-a'}
PERSONAL={**HELD,'method':'GCASH','institution':'personal-wallet-a'}
COMPANY={'channel':'COMPANY','operator':'office-a','method':'GCASH','institution':'company-wallet-a'}
OFFICE={**COMPANY,'method':'CASH','institution':'office-drawer'}


class Feed:
    def __init__(self,events,overrides=None,barrier=None):
        self.events=events;self.overrides=overrides or {};self.barrier=barrier;self.calls=0

    def fetch(self,request):
        self.calls+=1
        if self.barrier:self.barrier.wait(timeout=5)
        return {'source':request.source,'snapshotId':request.snapshot_id,'cursor':request.cursor,
                'nextCursor':f"page-{uuid4().hex}",'completeThrough':'certified-sequence',
                'coverageStart':DAY,'events':self.events,**self.overrides}


class IncomeTests(unittest.TestCase):
    def setUp(self):
        self.store=MemoryStore();self.service=IncomeService(self.store,today=lambda:date(2026,10,12))
        self.make_accounts()

    def make_accounts(self):
        self.cash=self.account('CASH');self.wallet=self.account('COMPANY_GCASH')
        self.held=self.account('COLLECTOR_CASH',custodian='collector-a')
        self.personal=self.account('COLLECTOR_GCASH',custodian='collector-a')

    def key(self):return uuid4().hex

    def account(self,kind='CASH',**fields):
        return self.service.create_account(RECORDER,AccountCreate(code='A'+self.key()[:10],name=kind,kind=kind,**fields),self.key())

    def expect(self,status,call):
        with self.assertRaises(HTTPException) as caught:call()
        self.assertEqual(caught.exception.status_code,status,caught.exception.detail)

    def balance(self,account_id):
        with self.store.read() as repo:return format(normal_balance(repo.account(account_id),repo.entries()),'.2f')

    def review(self,r,action='approve',actor=REVIEWER,key=None):
        return self.service.review_document(actor,r['id'],action,ReviewAction(version=r['version'],reason='Independently reviewed evidence'),key or self.key())

    def opening(self,account,amount):
        r=self.service.create_opening(RECORDER,OpeningCreate(accountId=account['id'],amount=amount,effectiveDate='2026-01-01',reason='Certified counted opening',evidenceReference='Opening statement'),self.key())
        self.service.approve_opening(REVIEWER,r['id'],Approval(reason='Verified opening statement'),self.key())
        return self.service.post_opening(RECORDER,r['id'],self.key())

    def cutover(self,**changes):
        with self.store.read() as repo:
            funds=[{'accountId':a['id'],'balance':format(normal_balance(a,repo.entries()),'.2f')} for a in repo.accounts() if a['active'] and a['kind']!='GENERAL_LEDGER']
        payload=CutoverCreate(startDate=DAY,snapshots={s:'snapshot-'+s for s in ('billing','point-of-sale','collector','service')},
                              funds=funds,evidenceReference='Reviewed cutover bundle',reason='Opening balances cover through January 1',**changes)
        r=self.service.create_cutover(RECORDER,payload,self.key());r=self.review(r)
        return self.service.activate_cutover(RECORDER,r['id'],ReviewAction(version=r['version'],reason='Activate certified boundary'),self.key())

    def mapping(self,identity=DESK,account=None):
        r=self.service.create_mapping(RECORDER,MappingCreate(settlement=identity,accountId=(account or self.cash)['id'],
                    validFrom='2026-01-01',evidenceReference='Reviewed named account mapping',reason='Source settlement mapping'),self.key())
        return self.review(r)

    def event(self,source,record,kind,**effect):
        return SourceEvent.model_validate({**PROOF,'eventId':self.key(),'source':source,'recordId':record,
                                           'effect':{'kind':kind,**effect}}).model_dump(mode='json')

    def invoice(self,record='invoice',amount='100.00',customer='customer',**extra):
        return self.event('billing',record,'BILLING_INVOICE',customerId=customer,amount=amount,invoiceType='SERVICE',**extra)

    def receipt(self,record='receipt',invoice='invoice',amount='100.00',advance='0.00',identity=DESK,customer='customer'):
        allocations=[] if invoice is None else [{'invoiceId':invoice,'amount':format(Decimal(amount)-Decimal(advance),'.2f')}]
        return self.event('billing',record,'BILLING_RECEIPT',customerId=customer,amount=amount,allocations=allocations,
                     advanceAmount=advance,settlement=identity,referenceNumber='' if identity['method']=='CASH' else 'Transfer evidence')

    def feed(self,source,events,**kwargs):
        feed=Feed(events,**kwargs);self.service.providers[source]=feed;return feed

    def sync(self,source,events=None,key=None):
        if events is not None:self.feed(source,events)
        return self.service.sync(RECORDER,source,SyncRequest(),key or self.key())

    def result(self,event):
        with self.store.read() as repo:return repo.source_result(stable_id(event['source'],event['eventId']))

    def reverse(self,target,disposition='NONCASH_CORRECTION',day=DAY,**extra):
        e=self.event(target['source'],self.key(),'SOURCE_REVERSAL',targetSource=target['source'],targetEventId=target['eventId'],
                    disposition=disposition,evidenceReference='Source correction evidence',authorizedBy='source-reviewer',reason='Authorized source correction',**extra)
        e['effectiveDate']=day;return e

    def test_triple_billing_pos_collector_visibility_counts_one_receipt(self):
        self.cutover();self.mapping();i=self.invoice();r=self.receipt()
        self.assertTrue(self.sync('billing',[r,i])['checkpointAdvanced'])
        p=self.event('point-of-sale','pos-confirmation','BILLING_RECEIPT_LINK',billingPaymentId='receipt',customerId='customer',amount='100.00')
        c=self.event('collector','collection-link','BILLING_RECEIPT_LINK',billingPaymentId='receipt',customerId='customer',amount='100.00')
        self.sync('point-of-sale',[p]);self.sync('collector',[c])
        self.assertEqual(self.balance(self.cash['id']),'100.00');self.assertEqual(self.balance(AR),'0.00')
        self.assertEqual(self.balance(DEFERRED),'100.00');self.assertEqual(self.result(p)['status'],'LINKED')
        with self.store.read() as repo:
            self.assertEqual(sum(Decimal(r['collectionAmount']) for r in repo.source_results()),Decimal('100.00'))
            self.assertEqual(len(repo.entries()),2)

    def test_advance_rebate_and_promotion_are_non_cash_and_do_not_repeat_income(self):
        self.cutover();self.mapping();i=self.invoice();r=self.receipt(amount='110.00',advance='30.00')
        credit=self.event('billing','promotion','BILLING_CREDIT',customerId='customer',invoiceId='invoice',amount='10.00',
                          destination='INVOICE',classification='PAYMENT_PROMOTION',recognitionBasis='DEFERRED')
        applied=self.event('billing','apply-advance','BILLING_CREDIT_APPLIED',customerId='customer',invoiceId='invoice',creditKind='ADVANCE',sourceCreditId='receipt',amount='10.00')
        self.sync('billing',[applied,credit,r,i])
        self.assertEqual(self.balance(self.cash['id']),'110.00');self.assertEqual(self.balance(CREDIT),'20.00')
        self.assertEqual(self.balance(AR),'0.00');self.assertEqual(self.balance(DEFERRED),'90.00')
        rebate=self.event('billing','customer-rebate','BILLING_CREDIT',customerId='customer',invoiceId='invoice',amount='15.00',destination='CUSTOMER_CREDIT',classification='SERVICE_REBATE',recognitionBasis='DEFERRED')
        self.sync('billing',[rebate]);self.assertEqual(self.balance(CREDIT),'35.00');self.assertEqual(self.balance(DEFERRED),'75.00')

    def test_pos_delivery_receipt_discount_and_tax_are_separate(self):
        self.cutover();self.mapping()
        sale=self.event('point-of-sale','sale','POS_SALE',grossAmount='120.00',discountAmount='20.00',taxAmount='12.00',delivered=True,deliveryEvidence='Retained delivery slip')
        pay=self.event('point-of-sale','pos-receipt','POS_RECEIPT',saleId='sale',amount='112.00',settlement=DESK)
        self.sync('point-of-sale',[pay,sale])
        self.assertEqual(self.balance(self.cash['id']),'112.00');self.assertEqual(self.balance(POS_AR),'0.00')
        self.assertEqual(self.balance(POS_REVENUE),'120.00');self.assertEqual(self.balance(POS_DISCOUNT),'20.00');self.assertEqual(self.balance(TAX),'12.00')
        self.assertEqual(self.result(sale)['collectionAmount'],'0.00')
        refund=self.reverse(pay,'REFUND',refundSettlement=DESK)
        undo_sale=self.reverse(sale)
        self.assertTrue(self.sync('point-of-sale',[undo_sale,refund])['checkpointAdvanced'])
        self.assertEqual(self.balance(self.cash['id']),'0.00')
        self.assertEqual(self.balance(POS_REVENUE),'0.00')
        self.assertEqual(self.balance(POS_DISCOUNT),'0.00')
        with self.store.read() as repo:
            self.assertEqual(repo.entry(self.result(undo_sale)['journalId'])['metadata']['incomeEffect'],'-100.00')

    def test_collector_personal_wallet_realization_and_cash_variance_are_not_income(self):
        self.cutover();self.mapping(PERSONAL,self.personal);self.mapping(COMPANY,self.wallet)
        i=self.invoice();r=self.receipt(identity=PERSONAL);self.sync('billing',[i,r])
        self.assertEqual(self.balance(self.wallet['id']),'0.00');self.assertEqual(self.balance(self.personal['id']),'100.00')
        remit=self.event('collector','remit','COLLECTOR_REMITTANCE',leg='GCASH',expectedAmount='100.00',actualAmount='90.00',
                  receipts=[{'billingPaymentId':'receipt','amount':'100.00'}],fromSettlement=PERSONAL,toSettlement=COMPANY,movementEvidence='Verified company transfer',confirmedBy='source-finance')
        self.sync('collector',[remit]);self.assertEqual(self.balance(self.wallet['id']),'90.00');self.assertEqual(self.balance(self.personal['id']),'0.00')
        self.assertEqual(self.balance(VARIANCE),'10.00');self.assertEqual(self.result(remit)['collectionAmount'],'0.00')
        exception=self.service.exceptions(RECORDER)[0]
        ack=self.service.acknowledge_exception(RECORDER,exception['id'],ReviewAction(version=1,reason='Investigating shortage'),self.key())
        self.assertEqual(ack['status'],'ACKNOWLEDGED');self.assertEqual(self.balance(VARIANCE),'10.00')
        repeat={**remit,'eventId':self.key(),'recordId':'second-remit'}
        self.assertFalse(self.sync('collector',[repeat])['checkpointAdvanced'])
        self.assertIn('DUPLICATE_REMITTANCE',{e['code'] for e in self.service.exceptions(RECORDER)})

    def test_missing_mapping_dependency_and_future_posts_hold_cursor_and_retry_safely(self):
        self.cutover();i=self.invoice();r=self.receipt();self.sync('billing',[i,r])
        self.assertEqual(self.balance(AR),'100.00');self.assertIsNone(self.result(r))
        with self.store.read() as repo:self.assertIsNone(repo.checkpoint('billing'))
        self.mapping();self.assertTrue(self.sync('billing')['checkpointAdvanced'])
        self.assertEqual(self.balance(self.cash['id']),'100.00')
        self.assertTrue(all(e['status']=='RESOLVED' for e in self.service.exceptions(RECORDER)))
        missing=self.receipt(record='missing-receipt',invoice='missing-invoice')
        self.assertFalse(self.sync('billing',[missing])['checkpointAdvanced'])
        future=self.invoice(record='future');future['effectiveDate']='2026-10-13'
        self.assertFalse(self.sync('billing',[future])['checkpointAdvanced']);self.assertIsNone(self.result(future))

    def test_event_and_economic_duplicates_replay_and_changed_evidence_is_blocked(self):
        self.cutover();self.mapping();i=self.invoice();r=self.receipt();feed=self.feed('billing',[i,r])
        first=self.sync('billing',key='sync-key');self.assertEqual(self.sync('billing',key='sync-key')['id'],first['id']);self.assertEqual(feed.calls,1)
        duplicate={**r,'eventId':self.key(),'recordVersion':2};self.sync('billing',[duplicate])
        self.assertEqual(self.result(duplicate)['status'],'LINKED');self.assertEqual(self.balance(self.cash['id']),'100.00')
        changed={**r,'effect':{**r['effect'],'referenceNumber':'Altered old evidence'}}
        self.assertFalse(self.sync('billing',[changed])['checkpointAdvanced'])
        revised={**changed,'eventId':self.key(),'recordVersion':3};self.sync('billing',[revised])
        self.assertIsNone(self.result(revised));self.assertEqual(self.balance(self.cash['id']),'100.00')

    def test_subledger_customer_and_credit_limits_reject_cross_customer_overpayment(self):
        self.cutover();self.mapping();i=self.invoice();self.sync('billing',[i])
        over=self.receipt(amount='101.00');self.sync('billing',[over]);self.assertIsNone(self.result(over))
        wrong=self.receipt(record='wrong',customer='other');self.sync('billing',[wrong]);self.assertIsNone(self.result(wrong))
        rebate=self.event('billing','too-large-rebate','BILLING_CREDIT',customerId='customer',invoiceId='invoice',amount='101.00',destination='CUSTOMER_CREDIT',classification='SERVICE_REBATE',recognitionBasis='DEFERRED')
        self.sync('billing',[rebate]);self.assertIsNone(self.result(rebate));self.assertEqual(self.balance(CREDIT),'0.00')

    def test_actual_refund_after_remittance_uses_company_account_and_actual_date(self):
        self.cutover();self.mapping(PERSONAL,self.personal);self.mapping(COMPANY,self.wallet)
        i=self.invoice();r=self.receipt(identity=PERSONAL);self.sync('billing',[i,r])
        remit=self.event('collector','remit','COLLECTOR_REMITTANCE',leg='GCASH',expectedAmount='100.00',actualAmount='100.00',receipts=[{'billingPaymentId':'receipt','amount':'100.00'}],fromSettlement=PERSONAL,toSettlement=COMPANY,movementEvidence='Actual company transfer',confirmedBy='source-finance')
        self.sync('collector',[remit]);refund=self.reverse(r,'REFUND',day='2026-01-03',refundSettlement=COMPANY)
        self.sync('billing',[refund]);self.assertEqual(self.balance(self.wallet['id']),'0.00');self.assertEqual(self.balance(AR),'100.00')
        self.assertEqual(self.result(refund)['refundAmount'],'100.00');self.assertEqual(self.result(r)['collectionAmount'],'100.00')
        self.assertEqual(self.result(refund)['effectiveDate'],'2026-01-03')
        again=self.reverse(r,'REFUND',day='2026-01-04',refundSettlement=COMPANY)
        self.sync('billing',[again]);self.assertIsNone(self.result(again))

    def test_credit_consumption_requires_dependency_reversal_before_receipt_refund(self):
        self.cutover();self.mapping();i=self.invoice();r=self.receipt(invoice=None,amount='100.00',advance='100.00')
        applied=self.event('billing','credit-application','BILLING_CREDIT_APPLIED',customerId='customer',invoiceId='invoice',creditKind='ADVANCE',sourceCreditId='receipt',amount='100.00')
        self.sync('billing',[i,r,applied]);refund=self.reverse(r,'REFUND',refundSettlement=DESK)
        self.sync('billing',[refund]);self.assertIsNone(self.result(refund))
        undo=self.reverse(applied);self.sync('billing',[refund,undo])
        self.assertIsNotNone(self.result(refund));self.assertEqual(self.balance(self.cash['id']),'0.00');self.assertEqual(self.balance(CREDIT),'0.00')

    def test_duplicate_no_funds_cancels_original_day_and_generic_reverse_is_blocked(self):
        self.cutover();self.mapping();i=self.invoice();r=self.receipt();self.sync('billing',[i,r])
        entry=self.result(r)['journalId']
        self.expect(409,lambda:self.service.reverse(RECORDER,entry,Reversal(effectiveDate=DAY,reason='Generic bypass'),self.key()))
        wrong=self.reverse(r,'DUPLICATE_NO_FUNDS',day='2026-01-03');self.sync('billing',[wrong]);self.assertIsNone(self.result(wrong))
        alias={**r,'eventId':self.key(),'recordVersion':2}
        self.sync('billing',[alias])
        correction=self.reverse(alias,'DUPLICATE_NO_FUNDS');self.sync('billing',[correction])
        self.assertEqual(self.balance(self.cash['id']),'0.00');self.assertEqual(self.result(correction)['collectionAmount'],'-100.00')
        duplicate_reversal=self.reverse(r,'DUPLICATE_NO_FUNDS')
        self.sync('billing',[duplicate_reversal]);self.assertIsNone(self.result(duplicate_reversal))

    def test_reference_migration_and_installation_do_not_create_money(self):
        self.cutover();i=self.invoice(serviceOrderId='installation-order');i['effect']['invoiceType']='INSTALLATION'
        reference=self.event('billing','legacy-evidence','REFERENCE_ONLY',reference='Legacy document',reason='Excluded historical reference')
        install=self.event('service','installation-order','SERVICE_INSTALLATION',reference='Job completion',reason='Installation reference',customerId='customer',billingInvoiceId='invoice',serviceOrderId='installation-order')
        self.sync('billing',[i,reference]);self.sync('service',[install])
        self.assertEqual(self.result(reference)['collectionAmount'],'0.00');self.assertIsNone(self.result(install)['journalId'])
        self.assertEqual(self.balance(DEFERRED),'100.00')
        earned=self.event('billing','earned-rebate','BILLING_CREDIT',customerId='customer',invoiceId='invoice',amount='10.00',destination='INVOICE',classification='SERVICE_REBATE',recognitionBasis='EARNED')
        self.sync('billing',[earned]);self.assertIsNone(self.result(earned))

    def test_cutover_excludes_history_and_itemized_legacy_debt_remains_collectible(self):
        self.opening(self.cash,'100.00')
        self.cutover(receivables=[{'owner':'billing','recordId':'old-invoice','customerId':'customer','amount':'50.00','deferredAmount':'0.00'}])
        self.mapping();historic=self.receipt(record='historic',invoice=None,amount='100.00',advance='100.00');historic['effectiveDate']='2026-01-01'
        self.sync('billing',[historic]);self.assertEqual(self.balance(self.cash['id']),'100.00');self.assertEqual(self.result(historic)['status'],'PRE_CUTOVER_EVIDENCE')
        self.sync('billing',[self.receipt(record='legacy-collection',invoice='old-invoice',amount='50.00')])
        self.assertEqual(self.balance(self.cash['id']),'150.00');self.assertEqual(self.balance(AR),'0.00')
        self.assertEqual(self.balance(DEFERRED),'0.00')
        late=self.service.create_opening(RECORDER,OpeningCreate(accountId=self.cash['id'],amount='100.00',effectiveDate=DAY,reason='Duplicate baseline',evidenceReference='Same statement'),self.key())
        late=self.service.approve_opening(REVIEWER,late['id'],Approval(reason='Approved incorrect second opening'),self.key())
        self.expect(409,lambda:self.service.post_opening(RECORDER,late['id'],self.key()))

    def test_baseline_custody_can_remit_without_reimporting_historic_receipt_cash(self):
        self.opening(self.personal,'100.00')
        self.cutover(custody=[{'billingPaymentId':'old-receipt','customerId':'customer','accountId':self.personal['id'],'leg':'GCASH','amount':'100.00'}])
        self.mapping(PERSONAL,self.personal);self.mapping(COMPANY,self.wallet)
        remit=self.event('collector','opening-remit','COLLECTOR_REMITTANCE',leg='GCASH',expectedAmount='100.00',actualAmount='100.00',receipts=[{'billingPaymentId':'old-receipt','amount':'100.00'}],fromSettlement=PERSONAL,toSettlement=COMPANY,movementEvidence='Certified forward transfer',confirmedBy='source-finance')
        self.assertTrue(self.sync('collector',[remit])['checkpointAdvanced'])
        self.assertEqual(self.balance(self.personal['id']),'0.00');self.assertEqual(self.balance(self.wallet['id']),'100.00')
        self.assertEqual(self.result(remit)['collectionAmount'],'0.00')

    def test_cutover_stale_certification_incomplete_custody_and_self_review_fail(self):
        self.opening(self.personal,'10.00')
        self.expect(409,lambda:self.cutover())
        with self.store.read() as repo:funds=[{'accountId':a['id'],'balance':self.balance(a['id'])} for a in repo.accounts() if a['kind']!='GENERAL_LEDGER']
        p=CutoverCreate(startDate=DAY,snapshots={s:s for s in ('billing','point-of-sale','collector','service')},funds=funds,
                        custody=[{'billingPaymentId':'old','customerId':'customer','accountId':self.personal['id'],'leg':'GCASH','amount':'10.00'}],evidenceReference='Cutover bundle',reason='Cutover evidence')
        r=self.service.create_cutover(RECORDER,p,self.key())
        self.expect(403,lambda:self.review(r,actor=Actor('recorder',frozenset({'*'}))))
        self.account('BANK')
        self.expect(409,lambda:self.review(r))

    def manual(self,classification='OTHER_INCOME',amount='50.00'):
        gl={'OTHER_INCOME':'REVENUE','LOAN_PROCEEDS':'LIABILITY','OWNER_FUNDING':'EQUITY','OWNER_LOAN':'LIABILITY'}[classification]
        counter=self.account('GENERAL_LEDGER',glType=gl)
        return self.service.create_manual(RECORDER,ManualIncomeCreate(classification=classification,documentReference=self.key(),payerName='Evidence payer',effectiveDate=DAY,amount=amount,accountId=self.cash['id'],counterpartAccountId=counter['id'],purpose='Reviewed non-subscriber inflow',evidenceReference='Signed supporting document'),self.key())

    def test_other_income_and_financing_require_evidence_independent_approval_and_correct_gl(self):
        for classification in ('OTHER_INCOME','LOAN_PROCEEDS','OWNER_FUNDING','OWNER_LOAN'):
            r=self.manual(classification);submitted=self.review(r,'submit',RECORDER)
            self.expect(403,lambda:self.review(submitted,actor=Actor('recorder',frozenset({'*'}))))
            limited=Actor('reviewer',frozenset(PERMISSIONS),approval_limit=Decimal('49.00'))
            self.expect(403,lambda:self.review(submitted,actor=limited))
            approved=self.review(submitted)
            posted=self.service.post_manual(RECORDER,r['id'],ReviewAction(version=approved['version'],reason='Post reviewed income'),'post-'+r['id'])
            self.assertEqual(self.service.post_manual(RECORDER,r['id'],ReviewAction(version=approved['version'],reason='Post reviewed income'),'post-'+r['id'])['journalId'],posted['journalId'])
            with self.store.read() as repo:
                j=repo.entry(posted['journalId'])
                self.assertEqual(j['metadata']['incomeEffect'],'50.00' if classification=='OTHER_INCOME' else '0.00')
            reversed_r=self.service.reverse_manual(RECORDER,r['id'],Reversal(effectiveDate=DAY,reason='Attributed inflow correction'),self.key())
            self.assertEqual(reversed_r['status'],'REVERSED')
            with self.store.read() as repo:
                self.assertEqual(repo.entry(reversed_r['reversalJournalId'])['metadata']['incomeEffect'],
                                 '-50.00' if classification=='OTHER_INCOME' else '0.00')
        self.assertEqual(self.balance(self.cash['id']),'0.00')

    def test_source_and_manual_unauthorized_actions_and_scoped_replays_fail(self):
        denied=Actor('denied',frozenset())
        self.expect(403,lambda:self.service.sync(denied,'billing',SyncRequest(),self.key()))
        self.expect(503,lambda:self.sync('billing'))
        r=self.manual();self.expect(403,lambda:self.service.document(Actor('outsider',frozenset({'finance.income.view'})),r['id']))
        r=self.review(r,'submit',RECORDER);r=self.review(r)
        posted=self.service.post_manual(RECORDER,r['id'],ReviewAction(version=r['version'],reason='Post exact document'),'scope-key')
        scoped_actor=Actor('recorder',frozenset(PERMISSIONS),account_ids=frozenset())
        self.expect(403,lambda:self.service.post_manual(scoped_actor,r['id'],ReviewAction(version=r['version'],reason='Post exact document'),'scope-key'))
        no_income=Actor('audit',frozenset({'finance.journals.view'}))
        self.expect(403,lambda:self.service.entry(no_income,posted['journalId']))
        self.expect(409,lambda:self.service.post_journal(RECORDER,JournalCreate(effectiveDate=DAY,sourceReference='bypass',reason='Try manual source control',lines=[{'accountId':AR,'debit':'1.00'},{'accountId':DEFERRED,'credit':'1.00'}]),self.key()))
        self.expect(409,lambda:self.service.post_journal(RECORDER,JournalCreate(effectiveDate=DAY,sourceReference='income-bypass',reason='Try bypassing inflow approval',lines=[{'accountId':self.cash['id'],'debit':'1.00'},{'accountId':r['counterpartAccountId'],'credit':'1.00'}]),self.key()))

    def test_mapping_approval_overlap_custodian_and_account_types_are_enforced(self):
        r=self.service.create_mapping(RECORDER,MappingCreate(settlement=DESK,accountId=self.cash['id'],validFrom=DAY,evidenceReference='Map evidence',reason='Map reviewed'),self.key())
        self.expect(403,lambda:self.review(r,actor=RECORDER));self.review(r)
        self.expect(409,lambda:self.mapping())
        self.expect(400,lambda:self.mapping(PERSONAL,self.cash))
        self.expect(400,lambda:self.mapping({**PERSONAL,'operator':'another-collector'},self.personal))

    def test_provider_invalid_snapshot_cursor_coverage_and_failure_do_not_save_or_advance(self):
        self.cutover()
        for override in ({'snapshotId':'different'},{'cursor':'wrong'},{'coverageStart':'2026-02-01'},{'contractVersion':2}):
            self.feed('billing',[],overrides=override)
            self.expect(502 if 'contractVersion' in override else 409,lambda:self.sync('billing'))
        self.service.providers['billing']=type('Broken',(),{'fetch':lambda _self,_r:(_ for _ in ()).throw(RuntimeError('Source unavailable'))})()
        self.expect(503,lambda:self.sync('billing'))
        with self.store.read() as repo:self.assertIsNone(repo.checkpoint('billing'));self.assertEqual(repo.source_events(),[])

    def test_failed_operation_rolls_back_source_inbox_journals_claims_and_cursor(self):
        self.cutover();self.mapping();i=self.invoice();r=self.receipt();self.feed('billing',[i,r])
        with patch.object(MemoryRepository,'save_operation',side_effect=RuntimeError('Simulated final evidence failure')):
            with self.assertRaises(RuntimeError):self.sync('billing',key='failed-final')
        with self.store.read() as repo:
            self.assertEqual(repo.source_events(),[]);self.assertEqual(repo.entries(),[]);self.assertIsNone(repo.checkpoint('billing'))
        self.assertTrue(self.sync('billing')['checkpointAdvanced'])

    def test_concurrent_sync_same_key_posts_once_and_cursor_compare_rejects_stale_worker(self):
        self.cutover();self.mapping();events=[self.invoice(),self.receipt()]
        self.feed('billing',events,barrier=Barrier(2))
        with ThreadPoolExecutor(max_workers=2) as pool:outcomes=list(pool.map(lambda _:self.sync('billing',key='parallel-key'),range(2)))
        self.assertEqual(outcomes[0]['id'],outcomes[1]['id']);self.assertEqual(self.balance(self.cash['id']),'100.00')
        self.feed('billing',[],barrier=Barrier(2))
        def attempt(_):
            try:return self.sync('billing')
            except HTTPException as exc:return exc.status_code
        with ThreadPoolExecutor(max_workers=2) as pool:outcomes=list(pool.map(attempt,range(2)))
        self.assertEqual(sum(isinstance(o,dict) for o in outcomes),1);self.assertIn(409,outcomes)


class AdapterTests(unittest.TestCase):
    def test_authoritative_retained_amount_phone_free_allocations_and_canonical_links(self):
        row={'id':'receipt','status':'POSTED','customerId':'customer','amount':80.10,'invoiceId':'invoice',
             'tenderedAmount':100,'returnedAmount':19.90,'mobile':'private-mobile'}
        e=BillingAdapter.receipt(row,PROOF,settlement=DESK)
        self.assertEqual(e.effect.amount,Decimal('80.10'));self.assertNotIn('private-mobile',e.model_dump_json())
        for adapter in (PosAdapter.invoice_collection,CollectorAdapter.collection):
            linked=adapter({**row,'billingPaymentId':'receipt'},PROOF)
            self.assertEqual(linked.effect.kind,'BILLING_RECEIPT_LINK')
        with self.assertRaises(ValueError):BillingAdapter.receipt({**row,'amount':0.30000000000000004},PROOF,settlement=DESK)

    def test_original_invoice_and_delivered_sale_do_not_use_adjusted_balance_or_tender(self):
        invoice=BillingAdapter.invoice({'id':'invoice','status':'UNPAID','customerId':'customer','lineItems':[{'amount':100}],
                     'netBilledAmount':90,'paidAmount':20,'balance':70},PROOF,invoice_type='SERVICE')
        self.assertEqual(invoice.effect.amount,Decimal('100.00'))
        sale=PosAdapter.sale({'id':'sale','status':'COMPLETED','lineItems':[{'amount':120}],'discountAmount':20,'taxAmount':12},PROOF,delivery_evidence='Delivery slip')
        self.assertEqual(sale.effect.grossAmount,Decimal('120.00'))
        line_discount=PosAdapter.sale({'id':'sale-2','status':'COMPLETED','lineItems':[{'amount':110,'discountAmount':10}],'discountAmount':20,'taxAmount':12},PROOF,delivery_evidence='Delivery slip')
        self.assertEqual(line_discount.effect.grossAmount,Decimal('120.00'));self.assertEqual(line_discount.effect.discountAmount,Decimal('30.00'))
        promotion=BillingAdapter.adjustment({'id':'promo','status':'POSTED','customerId':'customer','invoiceId':'invoice','type':'CREDIT','amount':10,'adjustmentSource':'PAYMENT_PROMOTION'},PROOF,recognition_basis='DEFERRED')
        self.assertEqual(promotion.effect.classification,'PAYMENT_PROMOTION')
        with self.assertRaises(ValueError):PosAdapter.sale({'id':'sale','status':'VOID'},PROOF,delivery_evidence='Void')

    def test_reference_migration_and_service_refs_are_only_evidence(self):
        e=BillingAdapter.migration_evidence({'id':'legacy','status':'REFERENCE_ONLY','excludedFromCashReports':True,'amount':10000},PROOF)
        self.assertEqual(e.effect.kind,'REFERENCE_ONLY');self.assertNotIn('amount',e.effect.model_dump())
        service=ServiceAdapter.installation({'id':'job','customerId':'customer','serviceAccountId':'line'},PROOF,billing_invoice_id='invoice',evidence_reference='Job completion')
        self.assertEqual(service.effect.serviceOrderId,'job')
        with self.assertRaises(ValidationError):SourceEvent.model_validate({**PROOF,'source':'collector','recordId':'wrong','effect':{'kind':'BILLING_INVOICE','customerId':'customer','amount':'10.00','invoiceType':'SERVICE'}})


class IncomeApiTests(unittest.TestCase):
    def setUp(self):
        from test_finance_payables import raw_request
        self.raw_request=raw_request;self.module=importlib.import_module('finance.router')
        self.old=(self.module._actor_provider,self.module.service)
        self.fixture=IncomeTests();self.fixture.setUp()
        self.module.configure_finance(lambda token:RECORDER if token=='Bearer recorder' else Actor('denied',frozenset()),store=self.fixture.store)
        self.app=FastAPI();self.app.include_router(self.module.router)

    def tearDown(self):self.module._actor_provider,self.module.service=self.old

    def request(self,method,path,body=None,token='recorder'):
        return asyncio.run(self.raw_request(self.app,method,path,body,{'Authorization':f'Bearer {token}','Idempotency-Key':uuid4().hex}))

    def test_http_source_post_requires_provider_and_never_accepts_client_events(self):
        self.assertEqual(self.request('POST','/api/finance/sources/billing/sync',{'limit':100},token='denied')[0],403)
        self.assertEqual(self.request('POST','/api/finance/sources/billing/sync',{'limit':100})[0],503)
        self.assertEqual(self.request('POST','/api/finance/sources/billing/sync',{'events':[]})[0],422)
        self.assertEqual(self.request('POST','/api/finance/sources/arbitrary/sync',{'limit':100})[0],422)

    def test_http_income_permissions_and_float_rejection(self):
        r=self.fixture.manual()
        self.assertEqual(self.request('GET','/api/finance/income',token='denied')[0],403)
        self.assertEqual(self.request('POST',f"/api/finance/income/{r['id']}/submit",{'version':r['version'],'reason':'Submit evidence'})[0],200)
        p={k:r[k] for k in ManualIncomeCreate.model_fields};p['amount']=0.1
        self.assertEqual(self.request('POST','/api/finance/income',p)[0],422)


if __name__=='__main__':unittest.main()
