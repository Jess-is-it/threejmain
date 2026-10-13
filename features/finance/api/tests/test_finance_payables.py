"""Meaningful expense/subledger, approval, evidence and concurrency invariants."""
import asyncio
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal
import importlib
import json
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from pydantic import ValidationError

import test_finance_foundation as foundation
from finance.expense_schemas import (AttachmentUpload, CategoryCreate, ExpenseAction, ExpensePost,
                                    MasterEdit, PayableCreate, PayableEdit, PayablePayment, PayeeCreate)
from finance.ledger import normal_balance
from finance.memory import MemoryStore, MemoryRepository, PAYABLE_CONTROL_ID
from finance.payables import PayablesService, MAX_ATTACHMENT_BYTES
from finance.permissions import Actor, PERMISSIONS
from finance.schemas import AccountCreate, Approval, JournalCreate, OpeningCreate, Reversal

CREATOR=Actor('expense-recorder',frozenset(PERMISSIONS))
APPROVER=Actor('expense-approver',frozenset(PERMISSIONS))
DAY='2026-01-01'


class PayablesTests(unittest.TestCase):
    def setUp(self):
        self.store=MemoryStore()
        self.service=PayablesService(self.store,today=lambda:date(2026,10,12))

    def key(self):return uuid4().hex

    def expect(self,status,action):
        with self.assertRaises(HTTPException) as exc:action()
        self.assertEqual(exc.exception.status_code,status,exc.exception.detail)

    def account(self,kind='CASH',gl=None):
        return self.service.create_account(CREATOR,AccountCreate(code=self.key()[:12],name='Named account',kind=kind,glType=gl),self.key())

    def category(self,classification='OPERATING_EXPENSE'):
        account=self.account('GENERAL_LEDGER','EXPENSE' if classification in ('OPERATING_EXPENSE','DIRECT_COST') else 'ASSET')
        return self.service.create_master(CREATOR,'category',CategoryCreate(code=self.key()[:12],name='Reviewed category',
                   classification=classification,accountId=account['id']),self.key())

    def draft(self,amount='100.00',classification='OPERATING_EXPENSE',**changes):
        payee=self.service.create_master(CREATOR,'payee',PayeeCreate(code=self.key()[:12],name='Supplier'),self.key())
        category=self.category(classification)
        payload={'payeeId':payee['id'],'categoryId':category['id'],'documentReference':self.key(),
                 'documentDate':DAY,'expenseDate':DAY,'dueDate':'2026-01-31','amount':amount,
                 'purpose':'ISP business expenditure','evidenceReference':'Supplier invoice',**changes}
        return self.service.create_payable(CREATOR,PayableCreate(**payload),self.key())

    def action(self,r,action,actor=CREATOR,reason='Reviewed business document',key=None):
        return self.service.expense_action(actor,r['id'],action,ExpenseAction(version=r['version'],reason=reason),key or self.key())

    def approved(self,r=None):
        r=r or self.draft()
        return self.action(self.action(r,'submit'),'approve',APPROVER)

    def posted(self,r=None):
        r=self.approved(r)
        return self.service.post_payable(CREATOR,r['id'],ExpensePost(version=r['version']),self.key())

    def funds(self,amount='1000.00'):
        a=self.account()
        opening=self.service.create_opening(CREATOR,OpeningCreate(accountId=a['id'],effectiveDate=DAY,
                    amount=amount,reason='Counted opening funds',evidenceReference='Count sheet'),self.key())
        self.service.approve_opening(APPROVER,opening['id'],Approval(reason='Verified count'),self.key())
        self.service.post_opening(CREATOR,opening['id'],self.key())
        return a

    def payment(self,r,a,amount='30.00',reference=None,key=None,day='2026-01-02',method='CASH'):
        return self.service.pay(CREATOR,r['id'],PayablePayment(accountId=a['id'],effectiveDate=day,amount=amount,
                     sourceReference=reference or self.key(),reason='Supplier settlement',method=method,
                     referenceNumber='' if method=='CASH' else 'Bank or card evidence'),key or self.key())

    def details(self,r):return self.service.payable_detail(CREATOR,r['id'])

    def balance(self,account_id):
        with self.store.read() as repo:return format(normal_balance(repo.account(account_id),repo.entries()),'.2f')

    def upload(self,r,key=None,content=b'%PDF-1.7\nSupporting document',filename='invoice.pdf'):
        return self.service.attach(CREATOR,r['id'],AttachmentUpload(version=r['version'],filename=filename,
                    contentType='application/pdf',contentBase64=base64.b64encode(content).decode()),key or self.key())

    def test_approval_posting_and_settlement_are_independent(self):
        r=self.draft();self.assertEqual((r['approvalStatus'],r['postingStatus'],r['settlementStatus']),('DRAFT','UNPOSTED','UNPAID'))
        self.expect(409,lambda:self.service.post_payable(CREATOR,r['id'],ExpensePost(version=r['version']),self.key()))
        approved=self.approved(r)
        self.assertEqual(approved['postingStatus'],'UNPOSTED');self.assertEqual(approved['outstandingAmount'],'0.00')
        posted=self.service.post_payable(CREATOR,r['id'],ExpensePost(version=approved['version']),self.key())
        self.assertEqual(posted['outstandingAmount'],'100.00');self.assertEqual(posted['settlementStatus'],'UNPAID')
        self.assertEqual(self.balance(PAYABLE_CONTROL_ID),'100.00')

    def test_partial_payments_do_not_repeat_expense_and_overpayment_is_rejected(self):
        r=self.posted();a=self.funds()
        self.payment(r,a,'30.17');self.payment(r,a,'10.03')
        d=self.details(r);self.assertEqual((d['paidAmount'],d['outstandingAmount'],d['settlementStatus']),('40.20','59.80','PARTIALLY_PAID'))
        self.assertEqual(self.balance(r['categorySnapshot']['accountId']),'100.00')
        self.expect(409,lambda:self.payment(r,a,'59.81'))
        self.payment(r,a,'59.80');self.assertEqual(self.details(r)['settlementStatus'],'PAID')
        self.assertEqual(self.balance(PAYABLE_CONTROL_ID),'0.00');self.assertEqual(self.balance(a['id']),'900.00')

    def test_retries_and_source_references_prevent_duplicate_payments(self):
        r=self.posted();a=self.funds()
        first=self.payment(r,a,reference='same-settlement',key='same-key')
        self.assertEqual(self.payment(r,a,reference='same-settlement',key='same-key')['id'],first['id'])
        replay=self.payment(r,a,reference='same-settlement',key='another-key')
        self.assertEqual(replay['id'],first['id']);self.assertTrue(replay['idempotentReplay'])
        self.expect(409,lambda:self.payment(r,a,'31.00',reference='same-settlement',key='same-key'))
        self.expect(409,lambda:self.payment(r,a,'31.00',reference='same-settlement',key='changed-key'))
        self.assertEqual(self.details(r)['paidAmount'],'30.00');self.assertEqual(len(self.details(r)['payments']),1)

    def test_duplicate_supplier_document_and_changed_create_key_are_rejected(self):
        r=self.draft();p=PayableCreate(**{k:r[k] for k in PayableCreate.model_fields})
        self.expect(409,lambda:self.service.create_payable(CREATOR,p,self.key()))
        q=p.model_copy(update={'documentReference':'Unique invoice'})
        created=self.service.create_payable(CREATOR,q,'create-again')
        replay=self.service.create_payable(CREATOR,q,'create-again')
        self.assertEqual(created['id'],replay['id'])
        self.expect(409,lambda:self.service.create_payable(CREATOR,q.model_copy(update={'amount':Decimal('101.00')}),'create-again'))

    def test_creator_editor_and_wildcard_cannot_self_approve(self):
        r=self.action(self.draft(),'submit')
        self.expect(403,lambda:self.action(r,'approve',CREATOR))
        self.expect(403,lambda:self.action(r,'approve',Actor(CREATOR.username,frozenset({'*'}))))
        r=self.action(r,'reopen')
        fields={k:r[k] for k in PayableCreate.model_fields}
        edited=self.service.edit_payable(APPROVER,r['id'],PayableEdit(version=r['version'],**fields),self.key())
        submitted=self.action(edited,'submit',APPROVER)
        self.expect(403,lambda:self.action(submitted,'approve',APPROVER))
        self.expect(403,lambda:self.action(submitted,'approve',CREATOR))
        reviewer=Actor('independent-reviewer',frozenset(PERMISSIONS))
        self.assertEqual(self.action(submitted,'approve',reviewer)['approvedBy'],reviewer.username)

    def test_rejection_reason_history_and_approval_invalidation(self):
        r=self.action(self.draft(),'submit')
        rejected=self.action(r,'reject',APPROVER,reason='Missing business justification')
        self.assertEqual(rejected['rejectionReason'],'Missing business justification')
        fields={k:rejected[k] for k in PayableCreate.model_fields};fields['amount']='110.00'
        revised=self.service.edit_payable(CREATOR,r['id'],PayableEdit(version=rejected['version'],**fields),self.key())
        approved=self.approved(revised)
        self.expect(409,lambda:self.service.edit_payable(CREATOR,r['id'],PayableEdit(version=approved['version'],**fields),self.key()))
        reopened=self.action(approved,'reopen',reason='Amount needs correction')
        self.assertIsNone(reopened['approvedBy']);self.assertIsNone(reopened['approvedVersion'])
        self.assertEqual([e['action'] for e in self.details(r)['approvalHistory']],['SUBMIT','REJECT','SUBMIT','APPROVE','REOPEN'])

    def test_unauthorized_scoped_and_limited_approval_actions_fail(self):
        r=self.action(self.draft(),'submit')
        limited=Actor('limited',frozenset(PERMISSIONS),approval_limit=Decimal('99.99'))
        self.expect(403,lambda:self.action(r,'approve',limited))
        viewer=Actor(CREATOR.username,frozenset({'finance.expenses.view'}))
        self.expect(403,lambda:self.action(r,'approve',viewer))
        other=Actor('other-recorder',frozenset({'finance.expenses.view','finance.expenses.create'}))
        self.assertEqual(self.service.list_payables(other),[])
        self.expect(403,lambda:self.service.payable_detail(other,r['id']))
        restricted=Actor(APPROVER.username,frozenset(PERMISSIONS),expense_ids=frozenset())
        approved=self.action(r,'approve',APPROVER,key='approval-replay')
        self.expect(403,lambda:self.service.expense_action(restricted,r['id'],'approve',ExpenseAction(version=r['version'],reason='Reviewed business document'),'approval-replay'))
        self.expect(403,lambda:self.service.post_payable(viewer,r['id'],ExpensePost(version=approved['version']),self.key()))
        posted=self.service.post_payable(CREATOR,r['id'],ExpensePost(version=approved['version']),self.key())
        self.expect(403,lambda:self.service.reverse_payable(viewer,r['id'],Reversal(effectiveDate='2026-01-02',reason='Denied reversal'),self.key()))
        self.expect(403,lambda:self.service.create_master(viewer,'payee',PayeeCreate(code='DENIED',name='Denied payee'),self.key()))
        self.expect(403,lambda:self.service.pay(viewer,r['id'],PayablePayment(accountId=self.funds()['id'],amount='1.00',effectiveDate=DAY,
                                      method='CASH',sourceReference='denied',reason='Denied settlement'),self.key()))

    def test_inventory_and_assets_are_not_operating_expenses(self):
        for classification in ('OPERATING_EXPENSE','DIRECT_COST','INVENTORY_PURCHASE','ASSET'):
            r=self.posted(self.draft(classification=classification))
            j=self.service.entry(CREATOR,r['postingJournalId'])
            expected='EXPENSE' if classification in ('OPERATING_EXPENSE','DIRECT_COST') else 'ASSET'
            self.assertEqual(j['lines'][0]['accountSnapshot']['glType'],expected)
            self.assertEqual(j['metadata']['classification'],classification)

    def test_category_mappings_and_archived_catalog_preserve_evidence(self):
        cash=self.account()
        self.expect(400,lambda:self.service.create_master(CREATOR,'category',CategoryCreate(code='INVALID',name='Invalid',
                        classification='OPERATING_EXPENSE',accountId=cash['id']),self.key()))
        r=self.posted();old=r['payeeSnapshot']
        edited=self.service.edit_master(CREATOR,'payee',old['id'],MasterEdit(version=old['version'],name='Renamed supplier',
                         notes='',active=False,reason='Supplier retired'),self.key())
        self.assertFalse(edited['active']);self.assertEqual(self.details(r)['payeeSnapshot']['name'],'Supplier')
        self.expect(409,lambda:self.service.create_master(CREATOR,'payee',PayeeCreate(code=old['code'],name='Replacement'),self.key()))

    def test_credit_card_payment_creates_liability_and_no_second_expense(self):
        r=self.posted();card=self.account('CREDIT_CARD')
        p=self.payment(r,card,'100.00',method='CREDIT_CARD')
        self.assertEqual(self.balance(card['id']),'100.00');self.assertEqual(self.details(r)['settlementStatus'],'PAID')
        self.assertEqual(self.balance(r['categorySnapshot']['accountId']),'100.00')
        self.assertTrue(self.service.entry(CREATOR,p['journalId'])['metadata']['noncash'])
        self.service.reverse_payment(CREATOR,p['id'],Reversal(effectiveDate='2026-01-03',reason='Card authorization reversed'),self.key())
        self.assertEqual(self.balance(card['id']),'0.00');self.assertEqual(self.details(r)['outstandingAmount'],'100.00')

    def test_linked_reversal_preserves_original_and_reopens_settlement(self):
        r=self.posted();a=self.funds();p=self.payment(r,a,'100.00')
        original=self.service.entry(CREATOR,r['postingJournalId'])
        self.expect(409,lambda:self.service.reverse_payable(CREATOR,r['id'],Reversal(effectiveDate='2026-01-04',reason='Correct bill'),self.key()))
        reversal=self.service.reverse_payment(CREATOR,p['id'],Reversal(effectiveDate='2026-01-03',reason='Supplier refunded'), 'payment-reversal')
        self.assertEqual(self.details(r)['settlementStatus'],'UNPAID');self.assertEqual(self.balance(a['id']),'1000.00')
        again=self.service.reverse_payment(CREATOR,p['id'],Reversal(effectiveDate='2026-01-03',reason='Supplier refunded'),'payment-reversal')
        self.assertEqual(reversal['reversalJournalId'],again['reversalJournalId'])
        self.expect(409,lambda:self.service.reverse_payable(CREATOR,r['id'],Reversal(effectiveDate='2026-01-02',reason='Bad historical void'),self.key()))
        reversed_bill=self.service.reverse_payable(CREATOR,r['id'],Reversal(effectiveDate='2026-01-04',reason='Incorrect supplier bill'),self.key())
        self.assertEqual((reversed_bill['approvalStatus'],reversed_bill['postingStatus']),('APPROVED','REVERSED'))
        self.assertEqual(self.balance(PAYABLE_CONTROL_ID),'0.00');self.assertEqual(self.balance(r['categorySnapshot']['accountId']),'0.00')
        self.assertEqual(original,self.service.entry(CREATOR,r['postingJournalId']))
        self.expect(409,lambda:self.payment(r,a,'1.00'))

    def test_generic_journal_and_reversal_cannot_bypass_payable_workflow(self):
        r=self.posted();a=self.funds();p=self.payment(r,a)
        for entry_id in (r['postingJournalId'],p['journalId']):
            self.expect(409,lambda:self.service.reverse(CREATOR,entry_id,Reversal(effectiveDate='2026-01-04',reason='Bypass workflow'),self.key()))
        self.expect(409,lambda:self.service.post_journal(CREATOR,JournalCreate(effectiveDate=DAY,sourceReference='bypass',reason='Bypass payable',
                    lines=[{'accountId':PAYABLE_CONTROL_ID,'debit':'1.00'},{'accountId':a['id'],'credit':'1.00'}]),self.key()))
        ledger_viewer=Actor('ledger-viewer',frozenset({'finance.journals.view'}))
        self.assertFalse(any(e['metadata'].get('payableId')==r['id'] for e in self.service.entries(ledger_viewer)))
        self.expect(403,lambda:self.service.entry(ledger_viewer,r['postingJournalId']))

    def test_replay_checks_current_document_account_scope(self):
        r=self.draft();attachment=self.upload(r,key='scope-upload')
        updated=self.details(r);new_category=self.category('DIRECT_COST')
        fields={k:updated[k] for k in PayableCreate.model_fields};fields['categoryId']=new_category['id']
        self.service.edit_payable(CREATOR,r['id'],PayableEdit(version=updated['version'],**fields),self.key())
        old_scope=Actor(CREATOR.username,frozenset(PERMISSIONS),account_ids=frozenset({r['categorySnapshot']['accountId']}))
        self.expect(403,lambda:self.service.attach(old_scope,r['id'],AttachmentUpload(version=r['version'],filename=attachment['filename'],
                     contentType='application/pdf',contentBase64=base64.b64encode(b'%PDF-1.7\nSupporting document').decode()),'scope-upload'))

    def test_stale_versions_unrecognized_payments_and_dates_are_rejected(self):
        r=self.draft();a=self.funds()
        self.expect(409,lambda:self.payment(r,a))
        submitted=self.action(r,'submit')
        self.expect(409,lambda:self.action(r,'approve',APPROVER))
        future=self.approved(self.draft(expenseDate='2026-10-13',dueDate='2026-10-31'))
        self.expect(400,lambda:self.service.post_payable(CREATOR,future['id'],ExpensePost(version=future['version']),self.key()))
        posted=self.posted()
        self.expect(400,lambda:self.payment(posted,a,day='2025-12-31'))
        self.expect(400,lambda:self.payment(posted,a,day='2026-10-13'))
        self.expect(400,lambda:self.payment(posted,a,method='CREDIT_CARD'))

    def test_evidence_requires_attachment_reference_or_authorized_exception(self):
        r=self.draft(evidenceReference='')
        creator=Actor(CREATOR.username,frozenset(set(PERMISSIONS)-{'finance.expenses.evidence.override'}))
        self.expect(403,lambda:self.action(r,'submit',creator))
        self.expect(400,lambda:self.action(r,'submit',CREATOR))
        attachment=self.upload(r)
        refreshed=self.details(r)
        submitted=self.action(refreshed,'submit',creator)
        self.assertEqual(submitted['approvalEvidence'][0]['sha256'],attachment['sha256'])
        exception=self.draft(evidenceReference='',evidenceExceptionReason='Receipt lost, supplier verified')
        submitted_exception=self.action(exception,'submit')
        reviewer=Actor(APPROVER.username,frozenset(set(PERMISSIONS)-{'finance.expenses.evidence.override'}))
        self.expect(403,lambda:self.action(submitted_exception,'approve',reviewer))

    def test_secure_attachment_scopes_retries_freeze_and_retained_bytes(self):
        r=self.draft(evidenceReference='');first=self.upload(r,key='upload-key')
        self.assertEqual(self.upload(r,key='upload-key')['id'],first['id'])
        revoked_editor=Actor(CREATOR.username,frozenset(set(PERMISSIONS)-{'finance.expenses.create'}))
        self.expect(403,lambda:self.service.attach(revoked_editor,r['id'],AttachmentUpload(
            version=r['version'],filename='invoice.pdf',contentType='application/pdf',
            contentBase64=base64.b64encode(b'%PDF-1.7\nSupporting document').decode()),'upload-key'))
        self.expect(409,lambda:self.upload(r,key='upload-key',content=b'%PDF-1.7\nChanged evidence'))
        outsider=Actor('outsider',frozenset({'finance.expenses.view','finance.attachments.view'}))
        self.expect(403,lambda:self.service.download_attachment(outsider,r['id'],first['id']))
        no_attachment_grant=Actor(CREATOR.username,frozenset({'finance.expenses.view'}))
        self.expect(403,lambda:self.service.download_attachment(no_attachment_grant,r['id'],first['id']))
        refreshed=self.details(r)
        retirement=ExpenseAction(version=refreshed['version'],reason='Superseded image')
        retired=self.service.retire_attachment(CREATOR,r['id'],first['id'],retirement,'retire-key')
        self.assertFalse(retired['active'])
        self.expect(403,lambda:self.service.retire_attachment(revoked_editor,r['id'],first['id'],retirement,'retire-key'))
        metadata,content=self.service.download_attachment(CREATOR,r['id'],first['id'])
        self.assertEqual(content,b'%PDF-1.7\nSupporting document');self.assertFalse(metadata['active'])
        next_attachment=self.upload(self.details(r))
        submitted=self.action(self.details(r),'submit')
        self.expect(409,lambda:self.upload(submitted))
        self.expect(409,lambda:self.service.retire_attachment(CREATOR,r['id'],next_attachment['id'],ExpenseAction(version=submitted['version'],reason='Frozen evidence'),self.key()))
        with self.store.read() as repo:
            op=repo.operation('attachment.upload','upload-key')
            self.assertNotIn('contentBase64',json.dumps(op))

    def test_invalid_files_and_cross_document_download_are_rejected(self):
        r=self.draft()
        self.expect(400,lambda:self.upload(r,filename='../invoice.pdf'))
        self.expect(400,lambda:self.upload(r,content=b'<script>not a PDF</script>'))
        with self.assertRaises(ValidationError):self.upload(r,content=b'%PDF-'+b'x'*MAX_ATTACHMENT_BYTES)
        attachment=self.upload(r);other=self.draft()
        self.expect(404,lambda:self.service.download_attachment(CREATOR,other['id'],attachment['id']))

    def test_post_and_payment_failures_roll_back_document_journal_audit_and_replay(self):
        r=self.approved()
        with self.store.read() as repo:count=len(repo.entries())
        with patch.object(MemoryRepository,'save_operation',side_effect=RuntimeError('evidence failure')):
            with self.assertRaises(RuntimeError):self.service.post_payable(CREATOR,r['id'],ExpensePost(version=r['version']),'failed-post')
        self.assertEqual(self.details(r)['postingStatus'],'UNPOSTED')
        with self.store.read() as repo:
            self.assertEqual(len(repo.entries()),count);self.assertIsNone(repo.operation('payable.post','failed-post'))
        r=self.service.post_payable(CREATOR,r['id'],ExpensePost(version=r['version']),self.key());a=self.funds()
        with patch.object(MemoryRepository,'insert_payment',side_effect=RuntimeError('settlement failure')):
            with self.assertRaises(RuntimeError):self.payment(r,a,key='failed-pay')
        self.assertEqual(self.details(r)['paidAmount'],'0.00');self.assertEqual(self.balance(a['id']),'1000.00')

    def test_concurrent_posting_and_payments_are_atomic_and_idempotent(self):
        r=self.approved();a=self.funds()
        with ThreadPoolExecutor(max_workers=4) as pool:
            posted=list(pool.map(lambda _:self.service.post_payable(CREATOR,r['id'],ExpensePost(version=r['version']),self.key()),range(4)))
        self.assertEqual(len({p['postingJournalId'] for p in posted}),1);r=posted[0]
        def competing(i):
            try:return self.payment(r,a,'60.00',reference=f'worker-{i}')
            except HTTPException as exc:return exc.status_code
        with ThreadPoolExecutor(max_workers=2) as pool:outcomes=list(pool.map(competing,range(2)))
        self.assertEqual(sum(isinstance(o,dict) for o in outcomes),1);self.assertIn(409,outcomes)
        with ThreadPoolExecutor(max_workers=2) as pool:
            retry=list(pool.map(lambda _:self.payment(r,a,'10.00',reference='concurrent-retry',key='concurrent-retry-key'),range(2)))
        self.assertEqual(retry[0]['id'],retry[1]['id']);self.assertEqual(self.details(r)['paidAmount'],'70.00')
        self.assertEqual(self.balance(r['categorySnapshot']['accountId']),'100.00')


async def raw_request(app,method,path,body=None,headers=None):
    events=[];sent=False
    async def receive():
        nonlocal sent
        if sent:return {'type':'http.disconnect'}
        sent=True
        return {'type':'http.request','body':json.dumps(body).encode() if body is not None else b'','more_body':False}
    async def send(event):events.append(event)
    await app({'type':'http','asgi':{'version':'3.0'},'http_version':'1.1','method':method,'scheme':'http',
               'path':path,'raw_path':path.encode(),'query_string':b'',
               'headers':[(k.lower().encode(),v.encode()) for k,v in (headers or {}).items()],
               'server':('test',80),'client':('test',1)},receive,send)
    start=next(e for e in events if e['type']=='http.response.start')
    return start['status'],dict(start['headers']),b''.join(e.get('body',b'') for e in events if e['type']=='http.response.body')


class ExpenseApiTests(unittest.TestCase):
    def setUp(self):
        self.module=importlib.import_module('finance.router');self.old=(self.module._actor_provider,self.module.service)
        self.fixture=PayablesTests();self.fixture.setUp()
        self.module.configure_finance(lambda token:CREATOR if token=='Bearer recorder' else APPROVER,store=self.fixture.store)
        self.app=FastAPI();self.app.include_router(self.module.router)

    def tearDown(self):self.module._actor_provider,self.module.service=self.old

    def request(self,method,path,body=None,token='recorder'):
        return asyncio.run(raw_request(self.app,method,path,body,{'Authorization':f'Bearer {token}','Idempotency-Key':uuid4().hex}))

    def test_api_attachment_limits_headers_and_no_byte_disclosure(self):
        r=self.fixture.draft();path=f"/api/finance/payables/{r['id']}/attachments"
        body={'version':r['version'],'filename':'invoice.pdf','contentType':'application/pdf',
              'contentBase64':base64.b64encode(b'%PDF-1.7\nEvidence').decode()}
        status,_,response=self.request('POST',path,body);self.assertEqual(status,201)
        record=json.loads(response);self.assertNotIn('contentBase64',record)
        status,headers,response=self.request('GET',f"{path}/{record['id']}/download")
        self.assertEqual(status,200);self.assertEqual(response,b'%PDF-1.7\nEvidence')
        self.assertEqual(headers[b'content-type'],b'application/octet-stream')
        self.assertIn(b'attachment;',headers[b'content-disposition']);self.assertEqual(headers[b'x-content-type-options'],b'nosniff')
        self.assertIn(b'no-store',headers[b'cache-control'])
        body['contentBase64']='x'*2_800_001
        self.assertEqual(self.request('POST',path,body)[0],413)

    def test_api_creator_denied_approval_and_decimal_validation(self):
        r=self.fixture.action(self.fixture.draft(),'submit')
        path=f"/api/finance/payables/{r['id']}/approve"
        self.assertEqual(self.request('POST',path,{'version':r['version'],'reason':'Self approval'})[0],403)
        self.assertEqual(self.request('POST',path,{'version':r['version'],'reason':'Independent approval'},token='approver')[0],200)
        body={k:r[k] for k in PayableCreate.model_fields};body['amount']=0.1;body['documentReference']='Float request'
        self.assertEqual(self.request('POST','/api/finance/payables',body)[0],422)

    def test_category_creation_requires_role_grant_and_matching_scoped_ledger(self):
        account=self.fixture.account('GENERAL_LEDGER','EXPENSE')
        asset=self.fixture.account('GENERAL_LEDGER','ASSET')
        actors={
            'recorder':Actor('expense-recorder',frozenset({'finance.expenses.view','finance.expenses.create','finance.accounts.view'})),
            'manager':Actor('category-manager',frozenset({'finance.expenses.view','finance.expenses.manage','finance.accounts.view'}),account_ids=frozenset({account['id'],asset['id']})),
            'outside':Actor('scoped-manager',frozenset({'finance.expenses.manage'}),account_ids=frozenset()),
        }
        self.module.configure_finance(lambda token:actors[token.removeprefix('Bearer ')],store=self.fixture.store)
        body={'code':'INLINE-FUEL','name':'Vehicle Fuel','classification':'OPERATING_EXPENSE','accountId':account['id'],'notes':''}
        self.assertEqual(self.request('POST','/api/finance/categories',body)[0],403)
        self.assertEqual(self.request('POST','/api/finance/categories',body,token='outside')[0],403)
        status,_,response=self.request('POST','/api/finance/categories',body,token='manager')
        self.assertEqual(status,201)
        category=json.loads(response)
        self.assertEqual(category['createdBy'],'category-manager');self.assertEqual(category['accountId'],account['id'])
        self.assertEqual(self.request('POST','/api/finance/categories',body,token='manager')[0],409)
        self.assertEqual(self.request('POST','/api/finance/categories',{**body,'code':'WRONG-LEDGER','accountId':asset['id']},token='manager')[0],400)
        self.assertEqual(self.request('POST','/api/finance/categories',{**body,'code':'ASSET-CATEGORY','classification':'ASSET','accountId':asset['id']},token='manager')[0],201)


if __name__=='__main__':unittest.main()
