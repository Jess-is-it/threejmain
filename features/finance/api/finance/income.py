"""Source-owned money projected once into Finance; no subscriber receipt CRUD."""
from datetime import date, timedelta
from decimal import Decimal
from uuid import NAMESPACE_URL, uuid4, uuid5

from fastapi import HTTPException
from pydantic import ValidationError

from .income_controls import AR, CREDIT, DEFERRED, POS_AR, POS_REVENUE, POS_DISCOUNT, TAX, VARIANCE
from .income_schemas import SourceBatch
from .ledger import ZERO, fingerprint, normal_balance, now, scoped
from .memory import EQUITY_ID
from .payables import PayablesService
from .schemas import json_record
from .source_adapters import FeedRequest


def stable_id(source, event_id):
    return str(uuid5(NAMESPACE_URL, f'threejmain.finance/{source}/{event_id}'))


def lines_for(deltas):
    # debit-positive signed deltas, consolidated to one line per account.
    return [{'accountId':a,'debit':format(max(v,ZERO),'.2f'),'credit':format(max(-v,ZERO),'.2f')}
            for a,v in deltas.items() if v]


class SourceBlocked(Exception):
    def __init__(self, code, message):
        self.code=code;self.message=message


class IncomeService(PayablesService):
    def __init__(self, store, today=None, providers=None):
        super().__init__(store,today=today)
        self.providers=dict(providers or {})

    @staticmethod
    def _unscoped(actor):
        if actor.account_ids is not None or actor.expense_ids is not None:
            raise HTTPException(403,'Cutover and source synchronization require unrestricted Finance scope')

    @staticmethod
    def _income_access(actor,r):
        if r['documentKind']=='MANUAL_INCOME':
            if r['createdBy']!=actor.username and not ({'*','finance.income.view_all'} & actor.permissions):
                raise HTTPException(403,'Other users\' income needs finance.income.view_all')
            scoped(actor,r['accountId']);scoped(actor,r['counterpartAccountId'])
        elif r['documentKind']=='MAPPING':scoped(actor,r['accountId'])
        else:IncomeService._unscoped(actor)

    @staticmethod
    def _result_scope(actor,result,repo=None):
        PayablesService._result_scope(actor,result,repo=repo)
        if result.get('documentKind'):
            IncomeService._income_access(actor,result)
            if repo is not None:IncomeService._income_access(actor,repo.income_document(result['id']))
        if result.get('entity')=='SOURCE_SYNC':IncomeService._unscoped(actor)
        if result.get('entity')=='RECONCILIATION_EXCEPTION':
            IncomeService._exception_scope(actor,result)

    def _entry_scope(self,repo,actor,entry):
        super()._entry_scope(repo,actor,entry)
        if entry['metadata'].get('manualIncomeId'):
            actor.require('finance.income.view')
            self._income_access(actor,repo.income_document(entry['metadata']['manualIncomeId']))
        if entry['metadata'].get('incomeSourceId') or entry['metadata'].get('cutoverId'):
            actor.require('finance.income.view');actor.require('finance.income.view_all')
            for line in entry['lines']:
                if line['accountId']!=EQUITY_ID:actor.account(line['accountId'])

    @staticmethod
    def _new_document(actor,kind,p):
        return {**p,'id':str(uuid4()),'documentKind':kind,'entity':'INCOME_DOCUMENT',
                'status':'DRAFT','version':1,'createdBy':actor.username,'createdAt':now(),
                'updatedBy':actor.username,'updatedAt':now(),'approvedBy':None,'approvedAt':None,
                'journalId':None}

    def documents(self,actor,kind):
        actor.require('finance.income.view')
        with self.store.read() as repo:
            rows=[]
            for r in repo.income_documents(kind):
                try:self._income_access(actor,r)
                except HTTPException as exc:
                    if exc.status_code==403:continue
                    raise
                rows.append(r)
            return rows

    def document(self,actor,record_id):
        actor.require('finance.income.view')
        with self.store.read() as repo:
            r=repo.income_document(record_id);self._income_access(actor,r)
            return r

    @staticmethod
    def _mapping_account(repo,actor,settlement,account_id):
        scoped(actor,account_id);a=repo.account(account_id)
        method=settlement['method'];channel=settlement['channel']
        allowed={'CASH':{'CASH','PETTY_CASH'},'GCASH':{'COMPANY_GCASH'},'BANK_TRANSFER':{'BANK'},'GATEWAY':set()}
        if channel=='COLLECTOR':allowed={'CASH':{'COLLECTOR_CASH'},'GCASH':{'COLLECTOR_GCASH'},'BANK_TRANSFER':set(),'GATEWAY':set()}
        if a['kind'] not in allowed[method] or not a['active']:
            raise HTTPException(400,'Settlement identity requires a matching active funds/custody account; gateways need a later contract')
        if channel=='COLLECTOR' and a['custodian']!=settlement['operator']:
            raise HTTPException(400,'Collector account custodian must equal the certified collector username')
        return a

    def create_mapping(self,actor,payload,key):
        p=json_record(payload)
        def action(repo):
            self._mapping_account(repo,actor,p['settlement'],p['accountId'])
            r=self._new_document(actor,'MAPPING',p);repo.save_income_document(r);return r
        return self._mutate(actor,'finance.settlement-mappings.manage','income.mapping.create',key,p,action)

    def create_manual(self,actor,payload,key):
        p=json_record(payload)
        def action(repo):
            self._day(p['effectiveDate']);self._manual_accounts(repo,actor,p)
            if any(r['documentReference'].upper()==p['documentReference'].upper() for r in repo.income_documents('MANUAL_INCOME')):
                raise HTTPException(409,'Manual income document reference is already retained')
            r=self._new_document(actor,'MANUAL_INCOME',p);repo.save_income_document(r);return r
        return self._mutate(actor,'finance.income.create','income.manual.create',key,p,action)

    @staticmethod
    def _manual_accounts(repo,actor,r):
        for field in ('accountId','counterpartAccountId'):scoped(actor,r[field])
        fund=repo.account(r['accountId']);counterpart=repo.account(r['counterpartAccountId'])
        expected={'OTHER_INCOME':'REVENUE','LOAN_PROCEEDS':'LIABILITY','OWNER_LOAN':'LIABILITY','OWNER_FUNDING':'EQUITY'}[r['classification']]
        if fund['kind'] in ('GENERAL_LEDGER','CREDIT_CARD') or not fund['active']:
            raise HTTPException(400,'Manual inflow requires an active asset holding account')
        if counterpart['system'] or counterpart['kind']!='GENERAL_LEDGER' or counterpart['glType']!=expected or not counterpart['active']:
            raise HTTPException(400,'Classification needs an active non-control revenue, loan liability or owner-equity GL counterpart')

    def create_cutover(self,actor,payload,key):
        actor.require('finance.cutover.manage');self._unscoped(actor)
        p=json_record(payload)
        def action(repo):
            if any(r['status']=='ACTIVE' for r in repo.income_documents('CUTOVER')):
                raise HTTPException(409,'An active cutover is permanent; policy changes need a separately reviewed migration')
            self._day(p['startDate'])
            r=self._new_document(actor,'CUTOVER',p)
            r['throughDate']=(date.fromisoformat(p['startDate'])-timedelta(days=1)).isoformat()
            r['baselineFingerprint']=self._baseline(repo,r)
            repo.save_income_document(r);return r
        return self._mutate(actor,'finance.cutover.manage','income.cutover.create',key,p,action)

    @staticmethod
    def _baseline(repo,r):
        entries=repo.entries()
        if any(e['effectiveDate']>r['throughDate'] for e in entries):
            raise HTTPException(409,'Cutover must follow all existing Finance activity; later activity cannot also be an opening baseline')
        funds={a['id']:a for a in repo.accounts() if a['active'] and a['kind']!='GENERAL_LEDGER'}
        if set(funds)!={f['accountId'] for f in r['funds']}:
            raise HTTPException(409,'Cutover must certify every active financial account, including zero accounts and card liabilities')
        for fund in r['funds']:
            if normal_balance(funds[fund['accountId']],entries,r['throughDate'])!=Decimal(fund['balance']):
                raise HTTPException(409,'Certified opening funds do not match the Finance journal at the cutover boundary')
        for linked in r['custody']:
            a=funds.get(linked['accountId'])
            if not a or a['kind']!=('COLLECTOR_CASH' if linked['leg']=='CASH' else 'COLLECTOR_GCASH'):
                raise HTTPException(409,'Opening custody receipts need the correct certified collector holding account')
        for a in funds.values():
            if a['kind'] in ('COLLECTOR_CASH','COLLECTOR_GCASH'):
                total=sum((Decimal(c['amount']) for c in r['custody'] if c['accountId']==a['id']),ZERO)
                if total!=normal_balance(a,entries,r['throughDate']):
                    raise HTTPException(409,'Collector opening funds must tie exactly to itemized unremitted Billing receipts')
        if any(any(l['accountId'] in (AR,CREDIT,DEFERRED,POS_AR) for l in e['lines']) for e in entries):
            raise HTTPException(409,'Source controls already contain a baseline or imported activity')
        return fingerprint({'entries':[(e['id'],e['fingerprint']) for e in entries],
                            'accounts':[(a['id'],a['version']) for a in repo.accounts()]})

    def review_document(self,actor,record_id,action,payload,key):
        p=json_record(payload)
        with self.store.read() as repo:kind=repo.income_document(record_id)['documentKind']
        permission={'MANUAL_INCOME':'finance.income.approve','MAPPING':'finance.settlement-mappings.approve','CUTOVER':'finance.cutover.approve'}[kind]
        if action=='submit':permission='finance.income.create'
        if action=='retire':permission='finance.settlement-mappings.manage'
        def change(repo):
            r=repo.income_document(record_id);self._income_access(actor,r);self._version(r,p['version'])
            if action=='submit':
                if kind!='MANUAL_INCOME' or r['status']!='DRAFT':raise HTTPException(409,'Only a manual income draft can be submitted')
                status='SUBMITTED'
            elif action=='retire':
                if kind!='MAPPING' or r['status']!='APPROVED':raise HTTPException(409,'Only an approved settlement mapping can be retired')
                status='RETIRED'
            else:
                expected='SUBMITTED' if kind=='MANUAL_INCOME' else 'DRAFT'
                if r['status']!=expected:raise HTTPException(409,'Document is not available for independent review')
                if r['createdBy']==actor.username:raise HTTPException(403,'Income/mapping/cutover creator cannot approve or reject their own document')
                if action not in ('approve','reject'):raise HTTPException(400,'Unsupported review action')
                status='APPROVED' if action=='approve' else 'REJECTED'
                if action=='approve':
                    if kind=='MANUAL_INCOME':
                        self._manual_accounts(repo,actor,r)
                        if actor.approval_limit is not None and Decimal(r['amount'])>actor.approval_limit:
                            raise HTTPException(403,'Other-income amount exceeds approval limit')
                    if kind=='MAPPING':
                        self._mapping_account(repo,actor,r['settlement'],r['accountId'])
                        for other in repo.income_documents('MAPPING'):
                            if other['status']=='APPROVED' and other['settlement']==r['settlement'] and max(other['validFrom'],r['validFrom'])<=min(other.get('validThrough','9999-12-31'),r.get('validThrough','9999-12-31')):
                                raise HTTPException(409,'An approved settlement mapping already covers this identity/date range')
                    if kind=='CUTOVER' and self._baseline(repo,r)!=r['baselineFingerprint']:
                        raise HTTPException(409,'Opening evidence changed since this cutover was prepared')
                    r.update(approvedBy=actor.username,approvedAt=now(),approvalReason=p['reason'])
            self._bump(r,actor,status=status,decisionReason=p['reason'])
            r['decisions']=[*r.get('decisions',[]),{'action':action,'version':r['version'],'actor':actor.username,'at':now(),'reason':p['reason']}]
            repo.save_income_document(r);return r
        return self._mutate(actor,permission,f'income.{kind.lower()}.{action}',key,{'id':record_id,**p},change)

    @staticmethod
    def _plan(repo):
        plans=[r for r in repo.income_documents('CUTOVER') if r['status']=='ACTIVE']
        if not plans:raise HTTPException(409,'A reviewed cutover and itemized baseline are required before source ingestion')
        return plans[0]

    def activate_cutover(self,actor,record_id,payload,key):
        self._unscoped(actor);p=json_record(payload)
        def action(repo):
            r=repo.income_document(record_id);self._version(r,p['version'])
            if r['documentKind']!='CUTOVER' or r['status']!='APPROVED':raise HTTPException(409,'Cutover requires independent approval')
            if any(o['status']=='ACTIVE' for o in repo.income_documents('CUTOVER')):raise HTTPException(409,'Cutover is already active')
            if self._baseline(repo,r)!=r['baselineFingerprint']:raise HTTPException(409,'Opening evidence changed; prepare a new plan')
            delta={AR:ZERO,POS_AR:ZERO,CREDIT:ZERO,DEFERRED:-Decimal(r['deferredAmount'])}
            for b in r['receivables']:delta[AR if b['owner']=='billing' else POS_AR]+=Decimal(b['amount'])
            for b in r['credits']:delta[CREDIT]-=Decimal(b['amount'])
            delta[EQUITY_ID]=-sum(delta.values(),ZERO)
            lines=lines_for(delta);journal=None
            if lines:
                journal=self._post(repo,actor,'JOURNAL','finance.cutover',r['id'],
                    {'effectiveDate':r['throughDate'],'reason':r['reason'],'cutoverId':r['id']},lines,
                    {'cutoverId':r['id'],'cashFlowExcluded':True,'incomeEffect':'0.00'})
            self._bump(r,actor,status='ACTIVE',journalId=journal['id'] if journal else None,
                       journalLines=lines,activatedBy=actor.username,activatedAt=now())
            repo.save_income_document(r);return r
        return self._mutate(actor,'finance.cutover.manage','income.cutover.activate',key,{'id':record_id,**p},action)

    def _post(self,repo,actor,kind,namespace,reference,payload,lines,metadata=None,reversal_of=None):
        # Once sources are live, a new opening on certified holdings or a
        # backdated money journal would overlap the reviewed cutover baseline.
        plans=[r for r in repo.income_documents('CUTOVER') if r['status']=='ACTIVE']
        if plans and namespace!='finance.cutover':
            plan=plans[0]
            if payload['effectiveDate']<plan['startDate']:
                raise HTTPException(409,'Financial posting is before the active cutover; retain history as evidence')
            if namespace=='finance.opening' and any(l['accountId'] in {f['accountId'] for f in plan['funds']} for l in lines):
                raise HTTPException(409,'Certified cutover accounts cannot receive a second opening')
        return super()._post(repo,actor,kind,namespace,reference,payload,lines,metadata,reversal_of)

    def post_manual(self,actor,record_id,payload,key):
        p=json_record(payload)
        def action(repo):
            r=repo.income_document(record_id);self._income_access(actor,r)
            if r['documentKind']!='MANUAL_INCOME':raise HTTPException(400,'This is not an other-income document')
            if r['status']=='POSTED':return {**r,'idempotentReplay':True}
            self._version(r,p['version'])
            if r['status']!='APPROVED':raise HTTPException(409,'Independent approval is required before income posting')
            self._manual_accounts(repo,actor,r)
            lines=[{'accountId':r['accountId'],'debit':r['amount'],'credit':'0.00'},
                   {'accountId':r['counterpartAccountId'],'debit':'0.00','credit':r['amount']}]
            journal=self._post(repo,actor,'JOURNAL','finance.other-income',r['id'],
                    {**r,'reason':r['purpose']},lines,
                    {'manualIncomeId':r['id'],'classification':r['classification'],
                     'incomeEffect':r['amount'] if r['classification']=='OTHER_INCOME' else '0.00',
                     'cashFlowClass':'OPERATING' if r['classification']=='OTHER_INCOME' else 'FINANCING'})
            self._bump(r,actor,status='POSTED',journalId=journal['id'],journalLines=lines,postedBy=actor.username,postedAt=now())
            repo.save_income_document(r);return r
        return self._mutate(actor,'finance.income.post','income.manual.post',key,{'id':record_id,**p},action)

    def reverse_manual(self,actor,record_id,payload,key):
        p=json_record(payload)
        def action(repo):
            r=repo.income_document(record_id);self._income_access(actor,r)
            if r['documentKind']!='MANUAL_INCOME' or r['status'] not in ('POSTED','REVERSED'):
                raise HTTPException(409,'Only posted other-income can be reversed')
            j=self._reverse_in_repo(repo,actor,r['journalId'],p,income_workflow=True)
            if r['status']!='REVERSED':
                self._bump(r,actor,status='REVERSED',reversalJournalId=j['id'],reversalLines=[{k:l[k] for k in ('accountId','debit','credit')} for l in j['lines']],reversedBy=actor.username,reversalReason=p['reason'])
                repo.save_income_document(r)
            return r
        return self._mutate(actor,'finance.income.reverse','income.manual.reverse',key,{'id':record_id,**p},action)

    def _settlement(self,repo,actor,identity,day):
        matches=[r for r in repo.income_documents('MAPPING') if r['status']=='APPROVED' and r['settlement']==identity and r['validFrom']<=day<=r.get('validThrough','9999-12-31')]
        if len(matches)!=1:raise SourceBlocked('UNMAPPED_SETTLEMENT','No single independently approved settlement account covers this source identity/date')
        r=matches[0]
        self._mapping_account(repo,actor,identity,r['accountId'])
        return r

    @staticmethod
    def _effect_key(event):
        p=event['effect'];kind=p['kind']
        suffix=f":{p['leg']}" if kind=='COLLECTOR_REMITTANCE' else ''
        return f"effect:{event['source']}:{kind}:{event['recordId']}{suffix}"

    def _obligation(self,repo,plan,owner,record_id,customer_id=None):
        claim=repo.source_claim(f"obligation:{owner}:{record_id}")
        if claim:
            event=repo.source_event(claim);p=event['effect']
            identity=p.get('customerId','')
            if repo.source_claim(f'reversal:{claim}'):raise SourceBlocked('REVERSED_DEPENDENCY','The source obligation has been reversed')
        else:
            b=next((b for b in plan['receivables'] if b['owner']==owner and b['recordId']==record_id),None)
            if not b:raise SourceBlocked('WAITING_OBLIGATION','Referenced original obligation or certified itemized opening is missing')
            identity=b['customerId']
        if customer_id is not None and identity!=customer_id:raise SourceBlocked('CUSTOMER_MISMATCH','Source allocation/customer identity does not match the obligation')

    def _credit_origin(self,repo,plan,kind,record_id,customer_id):
        claim=repo.source_claim(f'credit:{kind}:{record_id}')
        if claim:
            p=repo.source_event(claim)['effect']
            if p['customerId']!=customer_id:raise SourceBlocked('CUSTOMER_MISMATCH','Original credit belongs to another customer')
            if repo.source_claim(f'reversal:{claim}'):raise SourceBlocked('REVERSED_DEPENDENCY','Original credit has been reversed')
        elif not any(b['kind']==kind and b['recordId']==record_id and b['customerId']==customer_id for b in plan['credits']):
            raise SourceBlocked('WAITING_CREDIT','Original advance/rebate credit or itemized opening is missing')

    @staticmethod
    def _source_history(repo,plan,candidate):
        # Validate each invoice/sale and original credit, never just aggregate AR.
        daily={}
        def add(key,day,amount):daily.setdefault(key,{})[day]=daily.setdefault(key,{}).get(day,ZERO)+Decimal(amount)
        for b in plan['receivables']:
            add(f"ar:{b['owner']}:{b['recordId']}",plan['throughDate'],b['amount'])
            if b['owner']=='billing':add(f"deferred:billing:{b['recordId']}",plan['throughDate'],b['deferredAmount'])
        for b in plan['credits']:add(f"credit:{b['kind']}:{b['recordId']}",plan['throughDate'],b['amount'])
        for r in [*repo.source_results(),candidate]:
            for e in r.get('obligationEffects',[]):add(e['key'],r['effectiveDate'],e['amount'])
        for changes in daily.values():
            balance=ZERO
            for day in sorted(changes):
                balance+=changes[day]
                if balance<ZERO:raise SourceBlocked('SUBLEDGER_OVERSETTLED','Posting would make an original obligation/credit negative on a historical date')

    def _exception(self,repo,actor,event,code,message,attempt_hash=None):
        exception_id=stable_id('exception',f"{event['id']}/{code}/{attempt_hash or ''}")
        prior=next((r for r in repo.reconciliation_exceptions() if r['id']==exception_id),None)
        if prior:return prior
        r={'id':exception_id,'eventId':event['id'],'source':event['source'],'code':code,'message':message,
           'entity':'RECONCILIATION_EXCEPTION','status':'OPEN','version':1,'createdBy':actor.username,'createdAt':now(),
           'attemptFingerprint':attempt_hash,'accountIds':[]}
        result=repo.source_result(event['id'])
        if result:r['accountIds']=result.get('accountIds',[])
        repo.save_reconciliation_exception(r)
        repo.audit({'id':str(uuid4()),'createdAt':now(),'actor':actor.username,'action':'income.source.exception','targetId':r['id'],'eventId':event['id'],'code':code})
        return r

    def _source_result(self,repo,actor,plan,event):
        p=event['effect'];kind=p['kind'];day=event['effectiveDate']
        r={'id':event['id'],'entity':'SOURCE_RESULT','source':event['source'],'eventId':event['eventId'],
           'recordId':event['recordId'],'effectKind':kind,'effectiveDate':day,'status':'EVIDENCE',
           'journalId':None,'journalLines':[],'accountIds':[],'obligationEffects':[],
           'collectionAmount':'0.00','refundAmount':'0.00','createdBy':actor.username,'createdAt':now()}
        if day<plan['startDate']:
            r['status']='PRE_CUTOVER_EVIDENCE'
            if kind in ('BILLING_RECEIPT','POS_RECEIPT'):
                repo.insert_source_claim(f"receipt:{event['source']}:{event['recordId']}",event['id'])
                custody=next((c for c in plan['custody'] if c['billingPaymentId']==event['recordId']),None) if kind=='BILLING_RECEIPT' else None
                if custody:
                    if custody['amount']!=p['amount'] or custody['customerId']!=p['customerId']:
                        raise SourceBlocked('CUSTODY_BASELINE_MISMATCH','Historic receipt differs from its certified opening custody')
                    r.update(fundAccountId=custody['accountId'],accountIds=[custody['accountId']])
            return r
        if kind in ('REFERENCE_ONLY','BILLING_FEE_DECISION','SERVICE_INSTALLATION','COLLECTOR_DISCREPANCY'):
            if kind=='SERVICE_INSTALLATION' and p['billingInvoiceId']:
                self._obligation(repo,plan,'billing',p['billingInvoiceId'],p['customerId'] or None)
            return r
        if kind=='BILLING_INVOICE' and p['invoiceType']=='LEGACY_OPENING':
            raise SourceBlocked('LEGACY_OBLIGATION_NOT_BASELINED','Legacy opening debt belongs in the certified itemized cutover, never new income')
        delta={};claims=[];metadata={'incomeSourceId':event['id'],'effect':kind,'sourceRecordId':event['recordId']}
        def leg(account,amount):delta[account]=delta.get(account,ZERO)+Decimal(amount)
        def obligation(key,amount):r['obligationEffects'].append({'key':key,'amount':format(Decimal(amount),'.2f')})
        def receipt(owner,receipt_id):
            source_id=repo.source_claim(f'receipt:{owner}:{receipt_id}')
            if not source_id:
                baseline=next((c for c in plan['custody'] if owner=='billing' and c['billingPaymentId']==receipt_id),None)
                if baseline:
                    return ({'id':stable_id('baseline-custody',receipt_id),'recordId':receipt_id,
                            'effectiveDate':plan['throughDate'],'effect':{'amount':baseline['amount'],'customerId':baseline['customerId']}},
                            {'fundAccountId':baseline['accountId'],'accountIds':[baseline['accountId']]})
                raise SourceBlocked('WAITING_RECEIPT','Canonical original receipt has not been mapped')
            return repo.source_event(source_id),repo.source_result(source_id)
        if kind=='BILLING_RECEIPT_LINK':
            original,result=receipt('billing',p['billingPaymentId']);op=original['effect']
            if op['amount']!=p['amount'] or op['customerId']!=p['customerId']:
                raise SourceBlocked('CANONICAL_RECEIPT_MISMATCH','POS/Collector link differs from its authoritative Billing receipt')
            return {**r,'status':'LINKED','canonicalSourceId':original['id'],'accountIds':result['accountIds']}
        if kind=='BILLING_INVOICE':
            leg(AR,p['amount']);leg(DEFERRED,-Decimal(p['amount']))
            obligation(f"ar:billing:{event['recordId']}",p['amount'])
            obligation(f"deferred:billing:{event['recordId']}",p['amount'])
            claims.append(f"obligation:billing:{event['recordId']}")
            metadata.update(serviceAccountId=p['serviceAccountId'],serviceOrderId=p['serviceOrderId'],incomeEffect='0.00')
        elif kind=='BILLING_RECEIPT':
            mapping=self._settlement(repo,actor,p['settlement'],day);leg(mapping['accountId'],p['amount'])
            for a in p['allocations']:
                self._obligation(repo,plan,'billing',a['invoiceId'],p['customerId'])
                leg(AR,-Decimal(a['amount']));obligation(f"ar:billing:{a['invoiceId']}",-Decimal(a['amount']))
            if Decimal(p['advanceAmount']):
                leg(CREDIT,-Decimal(p['advanceAmount']));obligation(f"credit:ADVANCE:{event['recordId']}",p['advanceAmount'])
                claims.append(f"credit:ADVANCE:{event['recordId']}")
            claims.append(f"receipt:billing:{event['recordId']}")
            r.update(collectionAmount=p['amount'],fundAccountId=mapping['accountId'],mappingIds=[mapping['id']])
            metadata.update(incomeEffect='0.00',customerId=p['customerId'],settlement=p['settlement'])
        elif kind in ('BILLING_CREDIT','BILLING_DEBIT'):
            self._obligation(repo,plan,'billing',p['invoiceId'],p['customerId'])
            if p['recognitionBasis']!='DEFERRED':raise SourceBlocked('RECOGNITION_REQUIRED','Earned/unknown rebate allocation needs the Phase 5 recognition contract; no guessed profit posting')
            if kind=='BILLING_DEBIT' and p['destination']!='INVOICE':raise SourceBlocked('UNSUPPORTED_EFFECT','Customer credit debits require an explicit source-owned correction')
            credit=Decimal(p['amount']) if kind=='BILLING_CREDIT' else -Decimal(p['amount'])
            leg(DEFERRED,credit)
            obligation(f"deferred:billing:{p['invoiceId']}",-credit)
            if p['destination']=='INVOICE':
                leg(AR,-credit);obligation(f"ar:billing:{p['invoiceId']}",-credit)
            else:
                leg(CREDIT,-credit);obligation(f"credit:REBATE:{event['recordId']}",credit)
                claims.append(f"credit:REBATE:{event['recordId']}")
            metadata.update(incomeEffect='0.00',classification=p['classification'])
        elif kind=='BILLING_CREDIT_APPLIED':
            self._obligation(repo,plan,'billing',p['invoiceId'],p['customerId'])
            self._credit_origin(repo,plan,p['creditKind'],p['sourceCreditId'],p['customerId'])
            leg(CREDIT,p['amount']);leg(AR,-Decimal(p['amount']))
            obligation(f"credit:{p['creditKind']}:{p['sourceCreditId']}",-Decimal(p['amount']))
            obligation(f"ar:billing:{p['invoiceId']}",-Decimal(p['amount']))
            metadata['incomeEffect']='0.00'
        elif kind=='POS_SALE':
            if not p['delivered']:raise SourceBlocked('DELIVERY_REQUIRED','Register price needs certified delivery evidence before recognition')
            gross=Decimal(p['grossAmount']);discount=Decimal(p['discountAmount']);tax=Decimal(p['taxAmount']);total=gross-discount+tax
            leg(POS_AR,total);leg(POS_REVENUE,-gross);leg(POS_DISCOUNT,discount);leg(TAX,-tax)
            obligation(f"ar:point-of-sale:{event['recordId']}",total)
            claims.append(f"obligation:point-of-sale:{event['recordId']}")
            metadata.update(deliveryEvidence=p['deliveryEvidence'],incomeEffect=format(gross-discount,'.2f'),costingStatus='UNAVAILABLE')
        elif kind=='POS_RECEIPT':
            self._obligation(repo,plan,'point-of-sale',p['saleId'])
            mapping=self._settlement(repo,actor,p['settlement'],day)
            if p['settlement']['channel']!='POS':raise SourceBlocked('SETTLEMENT_MISMATCH','Register receipt requires a POS settlement identity')
            leg(mapping['accountId'],p['amount']);leg(POS_AR,-Decimal(p['amount']))
            obligation(f"ar:point-of-sale:{p['saleId']}",-Decimal(p['amount']))
            claims.append(f"receipt:point-of-sale:{event['recordId']}")
            r.update(collectionAmount=p['amount'],fundAccountId=mapping['accountId'],mappingIds=[mapping['id']])
            metadata['incomeEffect']='0.00'
        elif kind=='COLLECTOR_REMITTANCE':
            from_map=self._settlement(repo,actor,p['fromSettlement'],day);to_map=self._settlement(repo,actor,p['toSettlement'],day)
            if p['fromSettlement']['channel']!='COLLECTOR' or p['fromSettlement']['method']!=p['leg'] or p['toSettlement']['channel']=='COLLECTOR' or from_map['accountId']==to_map['accountId']:
                raise SourceBlocked('CUSTODY_MISMATCH','Remittance leg must move certified collector custody to company funds')
            for linked in p['receipts']:
                original,result=receipt('billing',linked['billingPaymentId'])
                if repo.source_claim(f"reversal:{original['id']}") or result.get('fundAccountId')!=from_map['accountId'] or original['effect']['amount']!=linked['amount'] or original['effectiveDate']>day:
                    raise SourceBlocked('CUSTODY_MISMATCH','Linked canonical receipt amount, account, status or movement date differs from this custody leg')
                claim=f"custody:{linked['billingPaymentId']}:{p['leg']}"
                if repo.source_claim(claim):raise SourceBlocked('DUPLICATE_REMITTANCE','A canonical receipt is already in a posted remittance leg')
                claims.append(claim)
            expected=Decimal(p['expectedAmount']);actual=Decimal(p['actualAmount'])
            leg(from_map['accountId'],-expected);leg(to_map['accountId'],actual);leg(VARIANCE,expected-actual)
            r['mappingIds']=[from_map['id'],to_map['id']]
            r['varianceAmount']=format(actual-expected,'.2f')
            metadata.update(incomeEffect='0.00',expenseEffect='0.00',movementEvidence=p['movementEvidence'],leg=p['leg'])
        elif kind=='SOURCE_REVERSAL':
            original_id=stable_id(p['targetSource'],p['targetEventId']);original=repo.source_event(original_id);old=repo.source_result(original_id)
            while old and old['status']=='LINKED' and old.get('canonicalSourceId'):
                original_id=old['canonicalSourceId'];original=repo.source_event(original_id);old=repo.source_result(original_id)
            if not old or not old['journalId']:raise SourceBlocked('WAITING_REVERSAL','The original posted financial effect is missing')
            op=original['effect'];entry=repo.entry(old['journalId']);claim=f'reversal:{original_id}'
            if repo.source_claim(claim):raise SourceBlocked('DUPLICATE_REVERSAL','The original already has a source-owned reversal/refund')
            if original['source']!=event['source'] or op['kind']=='SOURCE_REVERSAL':raise SourceBlocked('INVALID_REVERSAL','Only the original source owner can correct a non-reversal effect')
            if day<original['effectiveDate']:raise SourceBlocked('INVALID_REVERSAL_DATE','Correction cannot precede original effective date')
            is_receipt=op['kind'] in ('BILLING_RECEIPT','POS_RECEIPT')
            if is_receipt and p['disposition']=='NONCASH_CORRECTION':raise SourceBlocked('FUNDS_DISPOSITION_REQUIRED','Receipt void requires actual refund or certified duplicate/no-funds disposition')
            if not is_receipt and p['disposition']!='NONCASH_CORRECTION':raise SourceBlocked('INVALID_DISPOSITION','Noncash obligation/credit correction must not claim a refund')
            if p['disposition']=='DUPLICATE_NO_FUNDS' and day!=original['effectiveDate']:
                raise SourceBlocked('INVALID_REVERSAL_DATE','Duplicate/no-funds correction must cancel on the original effective day')
            if p['disposition']=='DUPLICATE_NO_FUNDS' and any(repo.source_claim(f"custody:{original['recordId']}:{leg}") for leg in ('CASH','GCASH')):
                raise SourceBlocked('SETTLED_CUSTODY','A remitted receipt cannot be certified as having no funds')
            r['obligationEffects']=[{'key':e['key'],'amount':format(-Decimal(e['amount']),'.2f')} for e in old.get('obligationEffects',[])]
            r['correctsSourceId']=original_id;claims.append(claim)
            self._source_history(repo,plan,r)
            if p['disposition']=='REFUND':
                if p.get('refundSettlement') is None:raise SourceBlocked('REFUND_ACCOUNT_REQUIRED','Actual refund needs a certified account identity and movement date')
                mapping=self._settlement(repo,actor,p['refundSettlement'],day)
                for l in entry['lines']:
                    account=mapping['accountId'] if l['accountId']==old['fundAccountId'] else l['accountId']
                    leg(account,Decimal(l['credit'])-Decimal(l['debit']))
                r.update(refundAmount=old['collectionAmount'],mappingIds=[mapping['id']],fundAccountId=mapping['accountId'])
                metadata.update(sourceCorrectionOfEntryId=entry['id'],disposition=p['disposition'],incomeEffect='0.00')
            else:
                journal=self._reverse_in_repo(repo,actor,entry['id'],{'effectiveDate':day,'reason':p['reason']},income_workflow=True,
                          metadata_override={'incomeSourceId':event['id'],'correctsSourceId':original_id,'disposition':p['disposition']})
                r.update(status='POSTED',journalId=journal['id'],journalLines=[{k:l[k] for k in ('accountId','debit','credit')} for l in journal['lines']],accountIds=old['accountIds'])
                if is_receipt:r['collectionAmount']=format(-Decimal(old['collectionAmount']),'.2f')
                for c in claims:repo.insert_source_claim(c,event['id'])
                return r
        else:raise SourceBlocked('UNSUPPORTED_EFFECT','Source effect has no reviewed Finance posting rule')
        self._source_history(repo,plan,r)
        if kind in ('BILLING_RECEIPT','POS_RECEIPT') and p['settlement']['method']!='CASH' and not p['referenceNumber']:
            raise SourceBlocked('MOVEMENT_EVIDENCE_REQUIRED','Noncash receipt needs its authoritative movement reference')
        journal=self._post(repo,actor,'JOURNAL','finance.source',event['id'],
                          {'effectiveDate':day,'reason':f"{event['source']} {kind} {event['recordId']}",
                           'sourceFingerprint':event['fingerprint']},lines_for(delta),metadata)
        r.update(status='POSTED',journalId=journal['id'],journalLines=lines_for(delta),
                 accountIds=[l['accountId'] for l in journal['lines'] if l['accountId']!=EQUITY_ID])
        for c in claims:repo.insert_source_claim(c,event['id'])
        return r

    def sync(self,actor,source,payload,key):
        actor.require('finance.sources.sync');self._unscoped(actor)
        if not isinstance(key,str) or not 1<=len(key.strip())<=160:
            raise HTTPException(400,'A stable Idempotency-Key (1–160 characters) is required')
        key=key.strip()
        provider=self.providers.get(source)
        if provider is None:raise HTTPException(503,'Authoritative Finance source provider has not been integrated')
        p=json_record(payload)
        # Exact replay is checked before contacting the source. No timestamp polling.
        with self.store.read() as repo:
            prior=repo.operation(f'income.sync.{source}',key or '')
            if prior:
                if prior['fingerprint']!=fingerprint(p):raise HTTPException(409,'Idempotency-Key differs from its saved sync request')
                return {**prior['result'],'idempotentReplay':True}
            plan=self._plan(repo);checkpoint=repo.checkpoint(source)
            cursor=checkpoint['cursor'] if checkpoint else ''
        try:
            fetched=provider.fetch(FeedRequest(source,plan['snapshots'][source],cursor,p['limit'],actor.username))
            batch=json_record(SourceBatch.model_validate(fetched))
        except (ValueError,ValidationError,KeyError):
            raise HTTPException(502,'Source provider returned invalid or uncertified financial evidence; checkpoint unchanged') from None
        except HTTPException:raise
        except Exception:
            raise HTTPException(503,'Authoritative source provider is unavailable; checkpoint unchanged') from None
        if batch['source']!=source or batch['snapshotId']!=plan['snapshots'][source] or batch['cursor']!=cursor or batch['coverageStart']>plan['startDate'] or len(batch['events'])>p['limit']:
            raise HTTPException(409,'Source coverage, owner, snapshot, cursor or page limit does not match the approved cutover')
        def action(repo):
            current=repo.checkpoint(source)
            if (current['cursor'] if current else '')!=cursor:raise HTTPException(409,'Another worker advanced this source; refetch the current cursor')
            pending=[];integrity=False;completed=[]
            for data in batch['events']:
                record_id=stable_id(source,data['eventId']);digest=fingerprint(data)
                existing=next((e for e in repo.source_events() if e['id']==record_id),None)
                if existing and existing['fingerprint']!=digest:
                    self._exception(repo,actor,existing,'IMMUTABLE_SOURCE_CHANGED','An immutable source event ID now carries different evidence',digest)
                    integrity=True;continue
                event=existing or {**data,'id':record_id,'fingerprint':digest,'receivedAt':now(),'receivedBy':actor.username,'snapshotId':batch['snapshotId']}
                if not existing:repo.insert_source_event(event)
                if repo.source_result(record_id):completed.append(record_id)
                else:pending.append(event)
            # Dependency-aware replay also handles events arriving in reverse order
            # within a page. Failed financial posting savepoints leave no evidence.
            failures={}
            while pending:
                advanced=False;remaining=[]
                for event in pending:
                    try:
                        with repo.savepoint() as unit:
                            prior_claim=unit.source_claim(self._effect_key(event))
                            if prior_claim:
                                original=unit.source_event(prior_claim)
                                if fingerprint({'effect':original['effect'],'effectiveDate':original['effectiveDate']})!=fingerprint({'effect':event['effect'],'effectiveDate':event['effectiveDate']}):
                                    raise SourceBlocked('FINANCIAL_REVISION_REQUIRES_CORRECTION','Same source document/effect changed; require retained reversal plus a new replacement identity')
                                prior_result=unit.source_result(prior_claim)
                                result={'id':event['id'],'entity':'SOURCE_RESULT','source':source,'eventId':event['eventId'],
                                        'recordId':event['recordId'],'effectKind':event['effect']['kind'],'effectiveDate':event['effectiveDate'],
                                        'status':'LINKED','canonicalSourceId':prior_claim,'journalId':None,'journalLines':[],
                                        'accountIds':prior_result['accountIds'],'obligationEffects':[],
                                        'collectionAmount':'0.00','refundAmount':'0.00','createdBy':actor.username,'createdAt':now()}
                            else:
                                result=self._source_result(unit,actor,plan,event)
                                unit.insert_source_claim(self._effect_key(event),event['id'])
                            unit.insert_source_result(result)
                        completed.append(event['id']);advanced=True
                        if event['effect']['kind']=='COLLECTOR_DISCREPANCY' or Decimal(result.get('varianceAmount','0.00'))!=ZERO:
                            self._exception(repo,actor,event,'UNCLASSIFIED_VARIANCE','Discrepancy retained in clearing/evidence; source confirmation is not an approved loss or income classification')
                        for exception in repo.reconciliation_exceptions():
                            if exception['eventId']==event['id'] and exception['code']!='UNCLASSIFIED_VARIANCE' and exception['status']!='RESOLVED':
                                exception.update(status='RESOLVED',version=exception['version']+1,resolvedBy=actor.username,resolvedAt=now(),resolutionJournalId=result['journalId'])
                                repo.save_reconciliation_exception(exception)
                    except SourceBlocked as exc:
                        failures[event['id']]=(exc.code,exc.message);remaining.append(event)
                    except HTTPException as exc:
                        if exc.status_code in (400,404,409):failures[event['id']]=('POSTING_CONSTRAINT',str(exc.detail));remaining.append(event)
                        else:raise
                pending=remaining
                if not advanced:break
            for event in pending:
                code,message=failures[event['id']];self._exception(repo,actor,event,code,message)
            advanced=not pending and not integrity
            if advanced:
                repo.save_checkpoint({'source':source,'version':(current['version'] if current else 0)+1,
                     'planId':plan['id'],'snapshotId':batch['snapshotId'],'cursor':batch['nextCursor'],
                     'completeThrough':batch['completeThrough'],'updatedAt':now(),'updatedBy':actor.username})
            return {'id':str(uuid4()),'entity':'SOURCE_SYNC','source':source,'processed':len(completed),
                    'blocked':len(pending)+int(integrity),'checkpointAdvanced':advanced,
                    'cursor':batch['nextCursor'] if advanced else cursor,'complete':False}
        return self._mutate(actor,'finance.sources.sync',f'income.sync.{source}',key,p,action)

    def sources_view(self,actor):
        actor.require('finance.income.view');actor.require('finance.income.view_all')
        with self.store.read() as repo:
            rows=[]
            for e in repo.source_events():
                result=repo.source_result(e['id'])
                if actor.account_ids is not None and (not result or not result['accountIds'] or any(a not in actor.account_ids for a in result['accountIds'])):continue
                rows.append({'id':e['id'],'source':e['source'],'eventId':e['eventId'],'recordId':e['recordId'],
                    'kind':e['effect']['kind'],'effectiveDate':e['effectiveDate'],'result':result,
                    'status':result['status'] if result else 'BLOCKED'})
            return {'items':rows,'providers':{s:{'configured':s in self.providers,'checkpoint':repo.checkpoint(s) if actor.account_ids is None else None}
                    for s in ('billing','point-of-sale','collector','service')},
                    'complete':False,'basis':'SOURCE_EFFECTS_NOT_PROFIT_REPORT','cutoverActive':any(r['status']=='ACTIVE' for r in repo.income_documents('CUTOVER'))}

    def source_detail(self,actor,record_id):
        actor.require('finance.income.view');actor.require('finance.income.view_all')
        with self.store.read() as repo:
            event=repo.source_event(record_id);result=repo.source_result(record_id)
            if actor.account_ids is not None and (not result or not result['accountIds'] or any(a not in actor.account_ids for a in result['accountIds'])):
                raise HTTPException(403,'Source evidence is outside Finance account scope')
            return {'event':event,'result':result}

    def exceptions(self,actor):
        actor.require('finance.income.view');actor.require('finance.income.view_all')
        with self.store.read() as repo:
            return [r for r in repo.reconciliation_exceptions() if actor.account_ids is None or r['accountIds'] and all(a in actor.account_ids for a in r['accountIds'])]

    def acknowledge_exception(self,actor,record_id,payload,key):
        actor.require('finance.income.view');actor.require('finance.income.view_all')
        p=json_record(payload)
        def action(repo):
            r=next((r for r in repo.reconciliation_exceptions() if r['id']==record_id),None)
            if not r:raise HTTPException(404,'Reconciliation exception not found')
            self._exception_scope(actor,r)
            self._version(r,p['version'])
            if r['status']=='RESOLVED':raise HTTPException(409,'Resolved exceptions retain their resolution evidence')
            r.update(status='ACKNOWLEDGED',version=r['version']+1,acknowledgedBy=actor.username,
                     acknowledgedAt=now(),acknowledgementReason=p['reason'])
            repo.save_reconciliation_exception(r);return r
        return self._mutate(actor,'finance.reconciliation.acknowledge','income.exception.acknowledge',key,{'id':record_id,**p},action)

    @staticmethod
    def _exception_scope(actor,r):
        if actor.account_ids is not None and (not r['accountIds'] or any(a not in actor.account_ids for a in r['accountIds'])):
            raise HTTPException(403,'Exception is outside Finance account scope')
