"""Expense approval, recognition and settlement are independent workflows."""
import base64
import binascii
import hashlib
import re
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException

from .expense_schemas import PayableCreate
from .ledger import FinanceService, ZERO, fingerprint, now, scoped
from .memory import PAYABLE_CONTROL_ID, CONTROL_IDS
from .schemas import json_record

MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024
MAX_ATTACHMENTS = 10
FINANCIAL_FIELDS = tuple(PayableCreate.model_fields)


def attachment_content(payload):
    filename = payload['filename']
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9 _().-]{0,119}', filename) or '..' in filename:
        raise HTTPException(400, 'Use a plain attachment filename without paths or control characters')
    try:
        content = base64.b64decode(payload['contentBase64'], validate=True)
    except (ValueError, binascii.Error):
        raise HTTPException(400, 'Attachment must contain valid base64 bytes') from None
    if not 1 <= len(content) <= MAX_ATTACHMENT_BYTES:
        raise HTTPException(400, 'Attachment must be at most 2 MiB')
    signatures = {'application/pdf': (b'%PDF-',('.pdf',)),
                  'image/png': (b'\x89PNG\r\n\x1a\n',('.png',)),
                  'image/jpeg': (b'\xff\xd8\xff',('.jpg','.jpeg'))}
    signature, extensions = signatures[payload['contentType']]
    if not content.startswith(signature) or not filename.lower().endswith(extensions):
        raise HTTPException(400, 'Attachment extension, declared type and file signature must agree')
    return content


class PayablesService(FinanceService):
    def _entry_scope(self, repo, actor, entry):
        super()._entry_scope(repo,actor,entry)
        if entry['metadata'].get('payableId'):
            actor.require('finance.expenses.view')
            self._access(actor,repo.payable(entry['metadata']['payableId']))

    @staticmethod
    def _result_scope(actor, result, repo=None):
        FinanceService._result_scope(actor,result,repo=repo)
        if result.get('entity') in ('PAYABLE','PAYMENT','ATTACHMENT'):
            actor.expense(result)
            category = result.get('categorySnapshot')
            if category:
                scoped(actor,category['accountId'])
            if repo is not None:
                record=repo.payable(result.get('payableId',result['id']))
                PayablesService._access(actor,record)

    @staticmethod
    def _access(actor, record):
        actor.expense(record)
        scoped(actor,record['categorySnapshot']['accountId'])
        if record.get('paidDetails'):scoped(actor,record['paidDetails']['accountId'])

    @staticmethod
    def _version(record, version):
        if record['version'] != version:
            raise HTTPException(409, 'Expense changed; refresh before taking this action')

    @staticmethod
    def _bump(record, actor, **changes):
        record.update(changes,version=record['version']+1,updatedBy=actor.username,updatedAt=now())

    @staticmethod
    def _financial(record):
        return {k:record[k] for k in FINANCIAL_FIELDS if k in record}

    def masters(self, actor, kind):
        actor.require('finance.expenses.view')
        with self.store.read() as repo:
            return [r for r in repo.masters(kind) if kind=='payee' or actor.account_ids is None or r['accountId'] in actor.account_ids]

    def create_master(self, actor, kind, payload, key):
        p=json_record(payload)
        def action(repo):
            if any(r['code']==p['code'].upper() for r in repo.masters(kind)):
                raise HTTPException(409, 'Code already exists, including archived records')
            if kind=='category':
                self._category_account(repo,actor,p)
            r={**p,'id':str(uuid4()),'code':p['code'].upper(),'version':1,'active':True,
               'createdBy':actor.username,'updatedBy':actor.username,'createdAt':now(),'updatedAt':now()}
            repo.save_master(kind,r)
            return r
        return self._mutate(actor,'finance.expenses.manage',f'{kind}.create',key,p,action)

    @staticmethod
    def _category_account(repo, actor, category):
        scoped(actor,category['accountId'])
        a=repo.account(category['accountId'])
        expected='EXPENSE' if category['classification'] in ('OPERATING_EXPENSE','DIRECT_COST') else 'ASSET'
        if a['kind']!='GENERAL_LEDGER' or a['glType']!=expected or a['system'] or not a['active']:
            raise HTTPException(400, 'Category requires an active non-control expense or asset GL account matching its classification')

    def edit_master(self, actor, kind, record_id, payload, key):
        p=json_record(payload)
        def action(repo):
            r=repo.master(kind,record_id)
            self._version(r,p['version'])
            if kind=='category':
                scoped(actor,r['accountId'])
            self._bump(r,actor,name=p['name'],notes=p['notes'],active=p['active'],changeReason=p['reason'])
            repo.save_master(kind,r)
            return r
        return self._mutate(actor,'finance.expenses.manage',f'{kind}.edit',key,{'id':record_id,**p},action)

    def _intake(self, repo, actor, p):
        if not p.get('payeeId') and p.get('paymentArrangement') != 'ALREADY_PAID':
            raise HTTPException(400, 'Payee is required for pay-later and installment expenses')
        payee=repo.master('payee',p['payeeId']) if p.get('payeeId') else {'id':None,'name':'Payee not specified','type':'UNSPECIFIED','active':True}
        category=repo.master('category',p['categoryId'])
        if not payee['active'] or not category['active']:
            raise HTTPException(409, 'New or edited expenses require active payee/category records')
        self._category_account(repo,actor,category)
        if p.get('paidDetails'):
            details=p['paidDetails'];scoped(actor,details['accountId'])
            self._payment_account(repo.account(details['accountId']),details)
            self._day(details['effectiveDate'])
        return {'payeeSnapshot':payee,'categorySnapshot':category}

    def _create_payable(self, repo, actor, p):
        if actor.expense_ids is not None:
            raise HTTPException(403, 'Creating expenses requires unrestricted expense-ID scope')
        p={**p,'documentReference':p['documentReference'].upper()}
        internal=not p['documentReference']
        if internal:p['documentReference']='EXP-'+uuid4().hex.upper()
        if any(r['payeeId']==p['payeeId'] and r['documentReference']==p['documentReference'] for r in repo.payables()):
            raise HTTPException(409, 'Supplier document already exists; use its retained record')
        r={**p,**self._intake(repo,actor,p),'id':str(uuid4()),'entity':'PAYABLE','currency':'PHP',
           'documentReferenceKind':'INTERNAL' if internal else 'SUPPLIER',
           'version':1,'approvalStatus':'DRAFT','postingStatus':'UNPOSTED','createdBy':actor.username,
           'editedBy':actor.username,'updatedBy':actor.username,'createdAt':now(),'updatedAt':now(),
           'approvedBy':None,'approvedAt':None,'approvedVersion':None,'approvalReason':None,
           'approvalEvidence':[],'rejectionReason':None,'postingJournalId':None,'reversalJournalId':None}
        repo.save_payable(r)
        return r

    def create_payable(self, actor, payload, key):
        p=payload.model_dump(mode='json')
        return self._mutate(actor,'finance.expenses.create','payable.create',key,p,
                            lambda repo:self._summary(repo,self._create_payable(repo,actor,p)))

    def expense_intake(self, actor, payload, key):
        """Draft + private evidence + optional submission in one durable transaction."""
        p=payload.model_dump(mode='json');upload=p.pop('attachment',None);submit=p.pop('submitForApproval')
        content=attachment_content(upload) if upload else None
        if upload:
            actor.require('finance.attachments.upload')
            if upload['version']!=1:raise HTTPException(400,'New expense attachment must use version one')
        evidence={k:upload[k] for k in ('filename','contentType')} if upload else None
        if evidence:evidence.update(sha256=hashlib.sha256(content).hexdigest(),size=len(content))
        def action(repo):
            r=self._create_payable(repo,actor,p)
            if evidence:
                a={**evidence,'payableId':r['id'],'version':1,'id':str(uuid4()),'entity':'ATTACHMENT',
                   'payableCreatedBy':actor.username,'active':True,'createdBy':actor.username,'createdAt':now()}
                repo.save_attachment(a,content)
            if submit:
                proof=self._evidence(repo,actor,r)
                self._bump(r,actor,approvalStatus='SUBMITTED',approvalEvidence=proof)
                repo.save_payable(r);self._decision(repo,actor,r,'SUBMIT','Submitted with expense entry')
            return self._summary(repo,r)
        return self._mutate(actor,'finance.expenses.create','expense.intake',key,
                            {**p,'attachment':evidence,'submitForApproval':submit},action)

    def edit_payable(self, actor, payable_id, payload, key):
        p=payload.model_dump(mode='json');p['documentReference']=p['documentReference'].upper()
        def action(repo):
            r=repo.payable(payable_id);self._access(actor,r);self._version(r,p['version'])
            if r['postingStatus']!='UNPOSTED' or r['approvalStatus'] not in ('DRAFT','REJECTED'):
                raise HTTPException(409, 'Only unposted drafts/rejections can be edited; reopen approved/submitted expenses first')
            reference_kind=r.get('documentReferenceKind','SUPPLIER')
            if not p['documentReference']:
                p['documentReference']=r['documentReference'] if reference_kind=='INTERNAL' else 'EXP-'+uuid4().hex.upper()
                reference_kind='INTERNAL'
            elif p['documentReference']!=r['documentReference']:
                reference_kind='SUPPLIER'
            if any(other['id']!=payable_id and other['payeeId']==p['payeeId'] and other['documentReference']==p['documentReference'] for other in repo.payables()):
                raise HTTPException(409, 'Supplier document already exists')
            self._bump(r,actor,**self._financial(p),**self._intake(repo,actor,p),documentReferenceKind=reference_kind,approvalStatus='DRAFT',editedBy=actor.username)
            repo.save_payable(r)
            return self._summary(repo,r)
        return self._mutate(actor,'finance.expenses.create','payable.edit',key,{'payableId':payable_id,**p},action)

    def _evidence(self, repo, actor, r):
        attachments=[a for a in repo.attachments(r['id']) if a['active']]
        if not attachments and not r['evidenceReference']:
            actor.require('finance.expenses.evidence.override')
            if len(r['evidenceExceptionReason'].strip())<3:
                raise HTTPException(400, 'Supporting evidence or an authorized exception reason is required')
        return [{'id':a['id'],'sha256':a['sha256'],'filename':a['filename']} for a in attachments]

    def _decision(self, repo, actor, r, action, reason):
        repo.decision({'id':str(uuid4()),'payableId':r['id'],'version':r['version'],'action':action,
                       'actor':actor.username,'createdAt':now(),'reason':reason,'amount':r['amount'],
                       'approvalLimit':str(actor.approval_limit) if actor.approval_limit is not None else None,
                       'selfApprovalPolicy':'NO_CREATOR_OR_FINANCIAL_EDITOR',
                       'financialFingerprint':fingerprint(self._financial(r)),
                       'evidence':r['approvalEvidence']})

    def expense_action(self, actor, payable_id, action, payload, key, *, recognize=False):
        p=json_record(payload)
        permission='finance.expenses.approve' if action in ('approve','reject') else 'finance.expenses.create'
        def change(repo):
            r=repo.payable(payable_id);self._access(actor,r);self._version(r,p['version'])
            if r['postingStatus']!='UNPOSTED':
                raise HTTPException(409, 'Posted expense approval is immutable; use reversal')
            state=r['approvalStatus']
            if action=='submit':
                if state!='DRAFT':raise HTTPException(409, 'Only a draft can be submitted')
                self._intake(repo,actor,r)
                evidence=self._evidence(repo,actor,r)
                self._bump(r,actor,approvalStatus='SUBMITTED',approvalEvidence=evidence)
            elif action in ('approve','reject'):
                if state!='SUBMITTED':raise HTTPException(409, 'Only a submitted expense can be reviewed')
                if actor.username in (r['createdBy'],r['editedBy']):
                    raise HTTPException(403, 'Expense creators and financial editors cannot approve or reject their own submission')
                if action=='approve':
                    if actor.approval_limit is not None and Decimal(r['amount'])>actor.approval_limit:
                        raise HTTPException(403, 'Expense exceeds your approval limit')
                    evidence=self._evidence(repo,actor,r)
                    self._bump(r,actor,approvalStatus='APPROVED',approvedBy=actor.username,
                               approvedAt=now(),approvedVersion=r['version']+1,approvalReason=p['reason'],
                               approvalEvidence=evidence,rejectionReason=None)
                else:
                    self._bump(r,actor,approvalStatus='REJECTED',rejectionReason=p['reason'])
            elif action=='reopen':
                if state not in ('REJECTED','SUBMITTED','APPROVED'):raise HTTPException(409, 'Expense is already a draft')
                self._bump(r,actor,approvalStatus='DRAFT',approvedBy=None,approvedAt=None,
                           approvedVersion=None,approvalReason=None,approvalEvidence=[])
            else:raise HTTPException(400, 'Unsupported expense action')
            repo.save_payable(r);self._decision(repo,actor,r,action.upper(),p['reason'])
            if recognize:
                # Approval authorizes recording this exact independently reviewed cost.
                # It never moves money; actual settlement requires expenses.pay.
                if action!='approve':raise HTTPException(400,'Recognition requires approval')
                self._recognize(repo,actor,r)
            return self._summary(repo,r)
        return self._mutate(actor,permission,f'payable.{action}'+('-record' if recognize else ''),key,{'payableId':payable_id,**p},change)

    def post_payable(self, actor, payable_id, payload, key):
        p=json_record(payload)
        def action(repo):
            r=repo.payable(payable_id);self._access(actor,r)
            if r['postingStatus']=='POSTED':return {**self._summary(repo,r),'idempotentReplay':True}
            self._version(r,p['version'])
            if r['postingStatus']!='UNPOSTED' or r['approvalStatus']!='APPROVED':
                raise HTTPException(409, 'Posting requires an independently approved, unposted expense')
            self._recognize(repo,actor,r)
            return self._summary(repo,r)
        return self._mutate(actor,'finance.expenses.post','payable.post',key,{'payableId':payable_id,**p},action)

    def _recognize(self, repo, actor, r):
        self._day(r['expenseDate'])
        category=r['categorySnapshot']
        self._category_account(repo,actor,category)
        posting={**self._financial(r),'effectiveDate':r['expenseDate'],'reason':r['purpose'],
                 'payableId':r['id'],'approvedVersion':r['approvedVersion'],'approvedBy':r['approvedBy']}
        j=self._post(repo,actor,'JOURNAL','finance.payable',r['id'],posting,
                     [{'accountId':category['accountId'],'debit':r['amount'],'credit':'0.00'},
                      {'accountId':PAYABLE_CONTROL_ID,'debit':'0.00','credit':r['amount']}],
                     {'effect':'PAYABLE_RECOGNITION','payableId':r['id'],
                      'approvedVersion':r['approvedVersion'],'classification':category['classification'],
                      'payeeId':r['payeeId'],'locationReference':r['locationReference'],
                      'projectReference':r['projectReference'],'itemAssetReference':r['itemAssetReference']})
        self._bump(r,actor,postingStatus='POSTED',postingJournalId=j['id'],postedBy=actor.username,postedAt=now())
        repo.save_payable(r)

    @staticmethod
    def _paid(repo, r):
        reversed_ids={e['reversalOfId'] for e in repo.entries() if e['reversalOfId']}
        return sum((Decimal(p['amount']) for p in repo.payments(r['id']) if p['journalId'] not in reversed_ids),ZERO)

    def _summary(self, repo, r):
        paid=self._paid(repo,r)
        due=Decimal(r['amount'])-paid if r['postingStatus']=='POSTED' else ZERO
        state='PAID' if r['postingStatus']=='POSTED' and due==ZERO else 'PARTIALLY_PAID' if paid>ZERO else 'UNPAID'
        from .expense_plans import settlement_plan
        plan=settlement_plan(r,paid,self.today().isoformat())
        return {**r,**plan,'paidAmount':format(paid,'.2f'),'outstandingAmount':format(due,'.2f'),
                'settlementStatus':state,'overdue':r['postingStatus']=='POSTED' and Decimal(plan['overdueAmount'])>ZERO}

    def list_payables(self, actor):
        actor.require('finance.expenses.view')
        with self.store.read() as repo:
            rows=[]
            for r in repo.payables():
                try:self._access(actor,r)
                except HTTPException as exc:
                    if exc.status_code==403:continue
                    raise
                rows.append(self._summary(repo,r))
            return rows

    def payable_detail(self, actor, payable_id):
        actor.require('finance.expenses.view')
        with self.store.read() as repo:
            r=repo.payable(payable_id);self._access(actor,r)
            reversed_by={e['reversalOfId']:e for e in repo.entries() if e['reversalOfId']}
            payments=[]
            for payment in repo.payments(payable_id):
                if actor.account_ids is not None and payment['accountId'] not in actor.account_ids:continue
                reversal=reversed_by.get(payment['journalId'])
                payments.append({**payment,'reversalJournalId':reversal['id'] if reversal else None,
                                 'reversedBy':reversal['postedBy'] if reversal else None,
                                 'reversalReason':reversal['reason'] if reversal else None})
            return {**self._summary(repo,r),'payments':payments,'approvalHistory':repo.decisions(payable_id)}

    def _history(self, repo, payable_id):
        # Payable control is credit-normal. Every dated balance must remain >=0.
        daily={}
        for e in repo.entries():
            if e['metadata'].get('payableId')!=payable_id:continue
            delta=sum((Decimal(l['credit'])-Decimal(l['debit']) for l in e['lines'] if l['accountId']==PAYABLE_CONTROL_ID),ZERO)
            daily[e['effectiveDate']]=daily.get(e['effectiveDate'],ZERO)+delta
        balance=ZERO
        for day in sorted(daily):
            balance+=daily[day]
            if balance<ZERO:raise HTTPException(409, 'Posting would over-settle the payable on a historical date')

    def pay(self, actor, payable_id, payload, key):
        p=json_record(payload);scoped(actor,p['accountId'])
        def action(repo):
            return self._apply_payment(repo,actor,payable_id,p)
        return self._mutate(actor,'finance.expenses.pay','payable.pay',key,{'payableId':payable_id,**p},action)

    @staticmethod
    def _payment_account(account, p):
        allowed={'CASH':{'CASH','PETTY_CASH','COLLECTOR_CASH'},'GCASH':{'COMPANY_GCASH','COLLECTOR_GCASH'},
                 'BANK_TRANSFER':{'BANK'},'CREDIT_CARD':{'CREDIT_CARD'},
                 'OTHER':{'CASH','PETTY_CASH','COLLECTOR_CASH','COMPANY_GCASH','COLLECTOR_GCASH','BANK'}}
        if account['kind'] not in allowed[p['method']]:raise HTTPException(400, 'Payment method does not match the selected financial account')
        if p['method']!='CASH' and not p['referenceNumber']:raise HTTPException(400, 'Noncash payments require supporting reference evidence')

    def _apply_payment(self, repo, actor, payable_id, p):
        r=repo.payable(payable_id);self._access(actor,r)
        prior=next((e for e in repo.entries() if e['sourceNamespace']=='finance.payable-payment' and e['sourceReference']==p['sourceReference']),None)
        posting={'payableId':payable_id,**p}
        if prior:
            if prior['fingerprint']!=fingerprint(posting):raise HTTPException(409, 'Payment reference already has different accounting evidence')
            return {**repo.payment(prior['metadata']['paymentId']),'idempotentReplay':True}
        if r['postingStatus']!='POSTED':raise HTTPException(409, 'Only a posted payable can be paid')
        self._day(p['effectiveDate'])
        if p['effectiveDate']<r['expenseDate']:raise HTTPException(400, 'Payment cannot predate recognized payable; use a later prepayment workflow')
        if Decimal(p['amount'])>Decimal(r['amount'])-self._paid(repo,r):raise HTTPException(409, 'Payment exceeds the remaining payable')
        account=repo.account(p['accountId'])
        self._payment_account(account,p)
        payment_id=str(uuid4())
        journal=self._post(repo,actor,'JOURNAL','finance.payable-payment',p['sourceReference'],posting,
                           [{'accountId':PAYABLE_CONTROL_ID,'debit':p['amount'],'credit':'0.00'},
                            {'accountId':account['id'],'debit':'0.00','credit':p['amount']}],
                           {'effect':'PAYABLE_PAYMENT','payableId':payable_id,'paymentId':payment_id,
                            'classification':r['categorySnapshot']['classification'],
                            'method':p['method'],'referenceNumber':p['referenceNumber'],'expenseEffect':'0.00',
                            'noncash':account['kind']=='CREDIT_CARD'})
        payment={**p,'id':payment_id,'entity':'PAYMENT','payableId':payable_id,'payableCreatedBy':r['createdBy'],
                 'journalId':journal['id'],'createdBy':actor.username,'createdAt':now(),
                 'accountSnapshot':{k:account[k] for k in ('id','code','name','kind')}}
        repo.insert_payment(payment);self._history(repo,payable_id)
        return payment

    def reverse_payment(self, actor, payment_id, payload, key):
        p=json_record(payload)
        def action(repo):
            payment=repo.payment(payment_id);r=repo.payable(payment['payableId']);self._access(actor,r)
            scoped(actor,payment['accountId'])
            if r['postingStatus']!='POSTED':raise HTTPException(409, 'Payment reversal requires its posted payable')
            journal=self._reverse_in_repo(repo,actor,payment['journalId'],p,payable_workflow=True)
            self._history(repo,r['id'])
            return {**payment,'reversalJournalId':journal['id'],'reversedBy':actor.username,
                    'reversalReason':p['reason'],'idempotentReplay':journal.get('idempotentReplay',False)}
        return self._mutate(actor,'finance.expenses.reverse','payable.payment.reverse',key,{'paymentId':payment_id,**p},action)

    def reverse_payable(self, actor, payable_id, payload, key):
        p=json_record(payload)
        def action(repo):
            r=repo.payable(payable_id);self._access(actor,r)
            if r['postingStatus']=='REVERSED':
                j=repo.entry(r['reversalJournalId'])
                if j['fingerprint']!=fingerprint({'entryId':r['postingJournalId'],**p}):raise HTTPException(409, 'Expense already has another reversal')
                return {**self._summary(repo,r),'idempotentReplay':True}
            if r['postingStatus']!='POSTED':raise HTTPException(409, 'Only a posted expense can be reversed')
            if self._paid(repo,r)!=ZERO:raise HTTPException(409, 'Reverse all linked settlements before reversing expense recognition')
            j=self._reverse_in_repo(repo,actor,r['postingJournalId'],p,payable_workflow=True)
            self._bump(r,actor,postingStatus='REVERSED',reversalJournalId=j['id'],reversedBy=actor.username,
                       reversalReason=p['reason'],reversedAt=now())
            repo.save_payable(r);self._history(repo,payable_id)
            return self._summary(repo,r)
        return self._mutate(actor,'finance.expenses.reverse','payable.reverse',key,{'payableId':payable_id,**p},action)

    def list_attachments(self, actor, payable_id):
        actor.require('finance.expenses.view');actor.require('finance.attachments.view')
        with self.store.read() as repo:
            self._access(actor,repo.payable(payable_id))
            return repo.attachments(payable_id)

    def attach(self, actor, payable_id, payload, key):
        actor.require('finance.expenses.create')
        p=json_record(payload);content=attachment_content(p)
        digest=hashlib.sha256(content).hexdigest()
        evidence={'payableId':payable_id,'version':p['version'],'filename':p['filename'],
                  'contentType':p['contentType'],'sha256':digest,'size':len(content)}
        def action(repo):
            r=repo.payable(payable_id);self._access(actor,r);self._version(r,p['version'])
            if r['approvalStatus'] not in ('DRAFT','REJECTED') or r['postingStatus']!='UNPOSTED':
                raise HTTPException(409, 'Attachments are frozen after submission; reopen the expense first')
            if len(repo.attachments(payable_id))>=MAX_ATTACHMENTS:raise HTTPException(409, 'Expense retention limit is ten attachment versions; start a reviewed replacement document')
            attachment={**evidence,'id':str(uuid4()),'entity':'ATTACHMENT','payableCreatedBy':r['createdBy'],
                        'active':True,'createdBy':actor.username,'createdAt':now()}
            repo.save_attachment(attachment,content)
            self._bump(r,actor,approvalStatus='DRAFT',editedBy=actor.username);repo.save_payable(r)
            return attachment
        # Byte content never appears in operation results, audit payloads or list APIs.
        return self._mutate(actor,'finance.attachments.upload','attachment.upload',key,evidence,action)

    def retire_attachment(self, actor, payable_id, attachment_id, payload, key):
        actor.require('finance.expenses.create')
        p=json_record(payload)
        def action(repo):
            r=repo.payable(payable_id);self._access(actor,r);self._version(r,p['version'])
            attachment,_=repo.attachment(attachment_id)
            if attachment['payableId']!=payable_id:raise HTTPException(404, 'Supporting attachment not found')
            if r['approvalStatus'] not in ('DRAFT','REJECTED') or r['postingStatus']!='UNPOSTED':
                raise HTTPException(409, 'Submitted evidence is frozen; reopen first')
            if not attachment['active']:raise HTTPException(409, 'Attachment is already retired')
            attachment.update(active=False,retiredBy=actor.username,retiredAt=now(),retirementReason=p['reason'])
            repo.save_attachment(attachment)
            self._bump(r,actor,approvalStatus='DRAFT',editedBy=actor.username);repo.save_payable(r)
            return attachment
        return self._mutate(actor,'finance.attachments.upload','attachment.retire',key,
                            {'payableId':payable_id,'attachmentId':attachment_id,**p},action)

    def download_attachment(self, actor, payable_id, attachment_id):
        actor.require('finance.expenses.view');actor.require('finance.attachments.view')
        with self.store.transaction() as repo:
            self._access(actor,repo.payable(payable_id))
            record,content=repo.attachment(attachment_id)
            if record['payableId']!=payable_id:raise HTTPException(404, 'Supporting attachment not found')
            repo.audit({'id':str(uuid4()),'createdAt':now(),'actor':actor.username,
                        'action':'attachment.download','targetId':attachment_id,
                        'payableId':payable_id,'sha256':record['sha256']})
            return record,content
