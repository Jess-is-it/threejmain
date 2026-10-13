"""Accounting invariants; no shared shell, server, or database mutations."""
import asyncio
import importlib
import json
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from pydantic import ValidationError

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from finance.ledger import FinanceService
from finance.memory import MemoryStore, MemoryRepository
from finance.permissions import Actor, PERMISSIONS
from finance.schemas import (AccountAction, AccountCreate, AccountEdit, Approval,
                             JournalCreate, OpeningCreate, Reversal, TransferCreate)

CREATOR=Actor('finance-one',frozenset(PERMISSIONS))
APPROVER=Actor('finance-two',frozenset(PERMISSIONS))
DAY='2026-01-01'


class FinanceFoundationTests(unittest.TestCase):
    def setUp(self):
        self.store=MemoryStore()
        self.service=FinanceService(self.store,today=lambda:date(2026,10,12))

    def account(self,code='CASH1',kind='CASH',**kwargs):
        return self.service.create_account(CREATOR,AccountCreate(code=code,name=f'Named {code}',kind=kind,**kwargs),f'account-{code}')

    def opening(self,account,amount='1000.00',day=DAY):
        r=self.service.create_opening(CREATOR,OpeningCreate(accountId=account['id'],amount=amount,effectiveDate=day,
              reason='Verified cutover balance',evidenceReference='count-sheet-1'),f'opening-{account["id"]}-{amount}')
        self.service.approve_opening(APPROVER,r['id'],Approval(reason='Checked supporting count'),f'approve-{r["id"]}')
        return self.service.post_opening(CREATOR,r['id'],f'post-{r["id"]}')

    def transfer(self,a,b,amount='100.00',reference='transfer-1',day='2026-01-02',method='CASH_HANDOVER'):
        p=TransferCreate(fromAccountId=a['id'],toAccountId=b['id'],amount=amount,effectiveDate=day,
                         sourceReference=reference,reason='Office fund movement',method=method,
                         referenceNumber='' if method=='CASH_HANDOVER' else 'bank-evidence')
        return self.service.transfer(CREATOR,p,reference)

    def balance(self,a):
        return self.service.activity(CREATOR,a['id'])['balance']

    def assert_http(self,status,call):
        with self.assertRaises(HTTPException) as caught:call()
        self.assertEqual(caught.exception.status_code,status,caught.exception.detail)

    def test_named_account_types_and_payment_methods_are_separate(self):
        for i,kind in enumerate(('CASH','PETTY_CASH','COMPANY_GCASH','BANK','COLLECTOR_CASH','COLLECTOR_GCASH','CREDIT_CARD')):
            a=self.account(f'A{i}',kind,custodian='Collector Sam' if kind.startswith('COLLECTOR') else '')
            self.assertEqual(a['normalSide'],'CREDIT' if kind=='CREDIT_CARD' else 'DEBIT')
            self.assertEqual(a['controlledCash'],kind not in ('CREDIT_CARD','COLLECTOR_GCASH'))
            self.assertEqual(a['currency'],'PHP')
        self.assert_http(400,lambda:self.account('MISMATCH','CREDIT_CARD',glType='ASSET'))
        self.assert_http(400,lambda:self.account('NOOWNER','COLLECTOR_CASH'))

    def test_duplicate_code_archived_or_active_and_immutable_kind(self):
        a=self.account('CaseCode')
        self.assertEqual(a['code'],'CASECODE')
        self.assert_http(409,lambda:self.account('casecode'))
        self.service.edit_account(CREATOR,a['id'],AccountAction(version=1,reason='Closed empty drawer'),'archive',active=False)
        self.assert_http(409,lambda:self.account('CASECODE'))
        with self.assertRaises(ValidationError):AccountEdit(version=1,kind='BANK')

    def test_creation_replay_and_changed_payload_conflict(self):
        a=self.account()
        replay=self.account()
        self.assertEqual(a['id'],replay['id']);self.assertTrue(replay['idempotentReplay'])
        self.assert_http(409,lambda:self.service.create_account(CREATOR,AccountCreate(code='CASH1',name='Different',kind='CASH'),'account-CASH1'))

    def test_edit_version_and_original_journal_account_snapshot(self):
        a=self.account();e=self.opening(a)
        edited=self.service.edit_account(CREATOR,a['id'],AccountEdit(version=1,name='Renamed drawer'),'edit')
        self.assertEqual(edited['version'],2)
        self.assert_http(409,lambda:self.service.edit_account(CREATOR,a['id'],AccountEdit(version=1,name='Stale'),'edit-stale'))
        self.assertEqual(self.service.entry(CREATOR,e['id'])['lines'][0]['accountSnapshot']['name'],a['name'])

    def test_account_and_starting_balance_saved_together_without_manual_evidence(self):
        for kind, code, amount in [('BANK','INITIAL_BANK','201.15'), ('CREDIT_CARD','INITIAL_CARD','300.22')]:
            payload=AccountCreate(code=code,name=code,kind=kind,startingBalance={'amount':amount,'effectiveDate':DAY})
            account=self.service.create_account(CREATOR,payload,code)
            opening=account['startingBalance']
            self.assertEqual(opening['status'],'DRAFT')
            self.assertEqual(opening['createdBy'],CREATOR.username)
            self.assertEqual(opening['accountId'],account['id'])
            self.assertEqual(opening['evidenceType'],'OPERATOR_DECLARATION')
            self.assertEqual(opening['declarationSource'],'ACCOUNT_CREATE')
            self.assertEqual(self.balance(account),'0.00')
            self.assert_http(409,lambda:self.service.post_opening(CREATOR,opening['id'],code+'-unapproved'))
            self.assert_http(403,lambda:self.service.approve_opening(CREATOR,opening['id'],Approval(reason='Own review'),code+'-self'))
            replay=self.service.create_account(CREATOR,payload,code)
            self.assertTrue(replay['idempotentReplay'])
            self.assertEqual(replay['startingBalance']['id'],opening['id'])
            self.assertEqual(len([o for o in self.service.list_openings(CREATOR) if o['accountId']==account['id']]),1)
            self.service.approve_opening(APPROVER,opening['id'],Approval(reason='Reviewed declared amount'),code+'-approve')
            entry=self.service.post_opening(CREATOR,opening['id'],code+'-post')
            self.assertEqual(self.balance(account),amount)
            self.assertEqual(entry['metadata']['evidenceType'],'OPERATOR_DECLARATION')
            self.assertTrue(entry['metadata']['cashFlowExcluded'])
            self.assertEqual(entry['lines'][0]['credit' if kind=='CREDIT_CARD' else 'debit'],amount)
            self.assert_http(409,lambda:self.service.create_account(CREATOR,payload.model_copy(update={'name':'Changed'}),code))

    def test_simplified_standalone_starting_balance_preserves_explicit_legacy_evidence(self):
        account=self.account()
        opening=self.service.create_opening(CREATOR,OpeningCreate(accountId=account['id'],amount='1.21',effectiveDate=DAY),'simple-opening')
        self.assertEqual(opening['createdBy'],CREATOR.username)
        self.assertEqual(opening['evidenceType'],'OPERATOR_DECLARATION')
        self.assertEqual(opening['declarationSource'],'STARTING_BALANCE_FORM')
        self.assertIn('no supporting reference',opening['evidenceReference'])
        legacy=self.service.create_opening(CREATOR,OpeningCreate(accountId=account['id'],amount='2.21',effectiveDate=DAY,reason='Counted original',evidenceReference='Historical count sheet'),'legacy-opening')
        self.assertEqual(legacy['reason'],'Counted original')
        self.assertEqual(legacy['evidenceReference'],'Historical count sheet')
        self.assertEqual(legacy['evidenceType'],'REFERENCE')

    def test_starting_balance_permission_rechecked_on_create_and_replay(self):
        manager=Actor('account-manager',frozenset({'finance.accounts.manage'}))
        payload=AccountCreate(code='RESTRICTED_OPENING',name='Bank',kind='BANK',startingBalance={'amount':'1.00','effectiveDate':DAY})
        self.assert_http(403,lambda:self.service.create_account(manager,payload,'restricted-opening'))
        self.assertFalse(any(a['code']==payload.code for a in self.service.list_accounts(CREATOR)))
        self.service.create_account(CREATOR,payload,'restricted-opening')
        self.assert_http(403,lambda:self.service.create_account(manager,payload,'restricted-opening'))
        empty=self.service.create_account(manager,AccountCreate(code='EMPTY_MANAGER',name='Empty',kind='CASH'),'empty-manager')
        self.assertNotIn('startingBalance',empty)
        scoped_actor=Actor('scoped',frozenset(PERMISSIONS),account_ids=frozenset())
        self.assert_http(403,lambda:self.service.create_account(scoped_actor,payload,'scoped-opening'))

    def test_account_opening_rollback_on_failed_save(self):
        payload=AccountCreate(code='ATOMIC_OPENING',name='Atomic cash',kind='CASH',startingBalance={'amount':'12.34','effectiveDate':DAY})
        with self.store.read() as repo:repository_type=type(repo)
        for method in ('save_opening','audit','save_operation'):
            with self.subTest(failed=method):
                with patch.object(repository_type,method,side_effect=RuntimeError('Opening storage failed')):
                    with self.assertRaises(RuntimeError):self.service.create_account(CREATOR,payload,'atomic-opening')
                self.assertFalse(any(a['code']==payload.code for a in self.service.list_accounts(CREATOR)))
                self.assertEqual(self.service.list_openings(CREATOR),[])
                with self.store.read() as repo:self.assertIsNone(repo.operation('account.create','atomic-opening'))
        saved=self.service.create_account(CREATOR,payload,'atomic-opening')
        self.assertEqual(saved['startingBalance']['amount'],'12.34')

    def test_inline_zero_future_and_invalid_starting_balances(self):
        empty=self.service.create_account(CREATOR,AccountCreate(code='ZERO_OPEN',name='Empty cash',kind='CASH',startingBalance={'amount':'0.00','effectiveDate':DAY}),'zero-opening')
        self.assertNotIn('startingBalance',empty)
        self.assertEqual(self.service.list_openings(CREATOR),[])
        self.assert_http(400,lambda:self.service.create_account(CREATOR,AccountCreate(code='FUTURE_OPEN',name='Future',kind='BANK',startingBalance={'amount':'1.00','effectiveDate':'2027-01-01'}),'future-opening'))
        self.assert_http(400,lambda:self.service.create_account(CREATOR,AccountCreate(code='LEDGER_OPEN',name='Ledger',kind='GENERAL_LEDGER',glType='ASSET',startingBalance={'amount':'1.00','effectiveDate':DAY}),'ledger-opening'))
        for amount in ('-1.00','0.001',0.1):
            with self.assertRaises(ValidationError):AccountCreate(code='BAD',name='Bad',kind='CASH',startingBalance={'amount':amount,'effectiveDate':DAY})

    def test_concurrent_account_setup_retries_produce_one_account_and_opening(self):
        # An inherited PostgreSQL fixture uses one rollback connection; run workers in isolated memory.
        service=FinanceService(MemoryStore(),today=lambda:date(2026,10,12))
        payload=AccountCreate(code='CONCURRENT_OPEN',name='Concurrent cash',kind='CASH',startingBalance={'amount':'12.34','effectiveDate':DAY})
        with ThreadPoolExecutor(max_workers=4) as executor:
            results=list(executor.map(lambda _:service.create_account(CREATOR,payload,'concurrent-opening'),range(8)))
        self.assertEqual(len({r['id'] for r in results}),1)
        self.assertEqual(len({r['startingBalance']['id'] for r in results}),1)
        self.assertEqual(len(service.list_openings(CREATOR)),1)

    def test_opening_independent_approval_attribution_and_limits(self):
        a=self.account()
        r=self.service.create_opening(CREATOR,OpeningCreate(accountId=a['id'],effectiveDate=DAY,amount='17.21',reason='Counted cash',evidenceReference='sheet'), 'draft')
        self.assert_http(409,lambda:self.service.post_opening(CREATOR,r['id'],'no-approval'))
        self.assert_http(403,lambda:self.service.approve_opening(CREATOR,r['id'],Approval(reason='Self approve'),'self'))
        limited=Actor('limited',frozenset(PERMISSIONS),approval_limit=Decimal('10.00'))
        self.assert_http(403,lambda:self.service.approve_opening(limited,r['id'],Approval(reason='Checked cash'),'limit'))
        approved=self.service.approve_opening(APPROVER,r['id'],Approval(reason='Checked count'),'approve')
        self.assertEqual(approved['approvedBy'],APPROVER.username)
        e=self.service.post_opening(CREATOR,r['id'],'post')
        self.assertEqual(e['postedBy'],CREATOR.username);self.assertEqual(e['metadata']['approvedBy'],APPROVER.username)
        self.assertTrue(e['metadata']['cashFlowExcluded']);self.assertEqual(self.balance(a),'17.21')
        replay=self.service.post_opening(CREATOR,r['id'],'another-post-key')
        self.assertEqual(e['id'],replay['id'])
        self.assert_http(409,lambda:self.opening(a,'1.00'))

    def test_balanced_openings_for_assets_and_card_liabilities(self):
        cash=self.account();card=self.account('CARD','CREDIT_CARD')
        a=self.opening(cash,'201.15');b=self.opening(card,'300.22')
        self.assertEqual(a['lines'][0]['debit'],'201.15')
        self.assertEqual(b['lines'][0]['credit'],'300.22')
        for e in (a,b):self.assertEqual(sum(Decimal(l['debit']) for l in e['lines']),sum(Decimal(l['credit']) for l in e['lines']))
        self.assertEqual(self.balance(card),'300.22')

    def test_exact_decimal_balances_and_transfer_no_profit(self):
        a=self.account();b=self.account('BANK','BANK');self.opening(a,'0.30')
        e=self.transfer(a,b,'0.10')
        self.assertEqual(self.balance(a),'0.20');self.assertEqual(self.balance(b),'0.10')
        self.assertEqual(e['metadata']['incomeEffect'],'0.00');self.assertEqual(e['metadata']['expenseEffect'],'0.00')
        self.assertEqual({l['accountSnapshot']['glType'] for l in e['lines']},{'ASSET'})

    def test_transfer_source_replay_is_independent_of_request_key(self):
        a=self.account();b=self.account('SECOND');self.opening(a)
        e=self.transfer(a,b)
        p=TransferCreate(fromAccountId=a['id'],toAccountId=b['id'],amount='100.00',effectiveDate='2026-01-02',sourceReference='transfer-1',reason='Office fund movement',method='CASH_HANDOVER')
        replay=self.service.transfer(CREATOR,p,'new-network-key')
        self.assertEqual(replay['id'],e['id']);self.assertTrue(replay['idempotentReplay'])
        self.assertEqual(self.balance(b),'100.00')
        self.assert_http(409,lambda:self.service.transfer(CREATOR,p.model_copy(update={'amount':Decimal('101.00')}),'third-key'))

    def test_overspend_same_account_nonfunding_and_missing_reference(self):
        a=self.account();b=self.account('BANK','BANK');self.opening(a,'10.00')
        self.assert_http(409,lambda:self.transfer(a,b,'10.01'))
        self.assert_http(400,lambda:self.transfer(a,a,'1.00'))
        income=self.account('REV','GENERAL_LEDGER',glType='REVENUE')
        self.assert_http(400,lambda:self.transfer(a,income,'1.00'))
        p=TransferCreate(fromAccountId=a['id'],toAccountId=b['id'],amount='1.00',effectiveDate=DAY,sourceReference='none',reason='Transfer funds',method='BANK_TRANSFER')
        self.assert_http(400,lambda:self.service.transfer(CREATOR,p,'none'))

    def test_card_funding_and_settlement_do_not_treat_credit_as_cash(self):
        bank=self.account('BANK','BANK');card=self.account('CARD','CREDIT_CARD')
        self.opening(bank,'100.00');self.opening(card,'30.00')
        self.transfer(card,bank,'20.00',reference='draw',method='CARD_FUNDING')
        self.assertEqual(self.balance(bank),'120.00');self.assertEqual(self.balance(card),'50.00')
        self.transfer(bank,card,'40.00',reference='repay',method='CARD_SETTLEMENT')
        self.assertEqual(self.balance(bank),'80.00');self.assertEqual(self.balance(card),'10.00')
        self.assert_http(409,lambda:self.transfer(bank,card,'10.01',reference='overpay',method='CARD_SETTLEMENT'))
        self.assert_http(400,lambda:self.transfer(bank,card,'1.00',reference='bad-method'))

    def test_archival_retains_activity_and_blocks_new_postings_until_restore(self):
        a=self.account();b=self.account('SECOND');original=self.opening(a,'10.00');self.transfer(a,b,'10.00')
        self.assert_http(409,lambda:self.service.edit_account(CREATOR,b['id'],AccountAction(version=1,reason='Still funded'),'archive-funded',active=False))
        archived=self.service.edit_account(CREATOR,a['id'],AccountAction(version=1,reason='Drawer closed'),'archive-empty',active=False)
        self.assertFalse(archived['active']);self.assertEqual(len(self.service.activity(CREATOR,a['id'])['items']),2)
        self.assertEqual(self.service.entry(CREATOR,original['id'])['postedBy'],CREATOR.username)
        self.assert_http(409,lambda:self.transfer(b,a,'1.00',reference='archived'))
        self.service.edit_account(CREATOR,a['id'],AccountAction(version=2,reason='Drawer reopened'),'restore',active=True)
        self.transfer(b,a,'1.00',reference='restored');self.assertEqual(self.balance(a),'1.00')

    def test_journal_balancing_and_single_side_rules(self):
        a=self.account();equity='finance-opening-equity'
        for lines in [
            [{'accountId':a['id'],'debit':'1.00'},{'accountId':equity,'credit':'0.99'}],
            [{'accountId':a['id'],'debit':'1.00','credit':'1.00'},{'accountId':equity,'credit':'1.00'}],
            [{'accountId':a['id'],'debit':'1.00'},{'accountId':a['id'],'credit':'1.00'}],
            [{'accountId':a['id']},{'accountId':equity,'credit':'1.00'}],
        ]:
            p=JournalCreate(effectiveDate=DAY,sourceReference='bad',reason='Bad entry attempt',lines=lines)
            self.assert_http(400,lambda:self.service.post_journal(CREATOR,p,'bad'))
        self.assertEqual(self.service.entries(CREATOR),[])

    def test_journal_source_reference_conflict_and_currency_precision(self):
        a=self.service.create_account(CREATOR,AccountCreate(code='LEGACY_ASSET',name='Legacy asset',kind='GENERAL_LEDGER',glType='ASSET'),'legacy-asset')
        p=JournalCreate(effectiveDate=DAY,sourceReference='legacy-asset-equity',reason='Reviewed noncash correction',lines=[{'accountId':a['id'],'debit':'11.21'},{'accountId':'finance-opening-equity','credit':'11.21'}])
        first=self.service.post_journal(CREATOR,p,'j1');replay=self.service.post_journal(CREATOR,p,'j2')
        self.assertEqual(first['id'],replay['id'])
        for invalid in ('NaN','Infinity','0.001',True,0.1,'10000000000000000.00'):
            with self.assertRaises(ValidationError):OpeningCreate(accountId=a['id'],effectiveDate=DAY,amount=invalid,reason='Verified count',evidenceReference='sheet')

    def test_reversal_is_append_only_attributed_and_replayable(self):
        a=self.account();b=self.account('SECOND');self.opening(a)
        e=self.transfer(a,b,'100.00')
        before=self.service.entry(CREATOR,e['id'])
        p=Reversal(effectiveDate='2026-01-03',reason='Incorrect destination drawer')
        reverse=self.service.reverse(APPROVER,e['id'],p,'reverse')
        self.assertEqual(reverse['reversalOfId'],e['id']);self.assertEqual(reverse['postedBy'],APPROVER.username)
        self.assertEqual(self.service.entry(CREATOR,e['id']),before)
        self.assertEqual(self.balance(a),'1000.00');self.assertEqual(self.balance(b),'0.00')
        self.assertTrue(self.service.reverse(APPROVER,e['id'],p,'retry-new')['idempotentReplay'])
        self.assert_http(409,lambda:self.service.reverse(APPROVER,e['id'],Reversal(effectiveDate='2026-01-03',reason='Different explanation'),'different'))
        self.assert_http(409,lambda:self.service.reverse(APPROVER,reverse['id'],p,'reverse-reversal'))

    def test_reversal_cannot_spend_funds_already_used_or_precede_original(self):
        a=self.account();b=self.account('SECOND');c=self.account('THIRD');self.opening(a,'20.00')
        e=self.transfer(a,b,'20.00');self.transfer(b,c,'20.00',reference='spent')
        self.assert_http(409,lambda:self.service.reverse(CREATOR,e['id'],Reversal(effectiveDate='2026-01-03',reason='Cannot erase spent funds'),'reverse'))
        self.assert_http(400,lambda:self.service.reverse(CREATOR,e['id'],Reversal(effectiveDate=DAY,reason='Too early reversal'),'early'))

    def test_backdated_posting_protects_intermediate_historical_balances(self):
        a=self.account();b=self.account('SECOND');self.opening(a,'100.00')
        self.transfer(a,b,'100.00',reference='out',day='2026-01-02')
        self.transfer(b,a,'100.00',reference='return',day='2026-01-04')
        self.assert_http(409,lambda:self.transfer(a,b,'10.00',reference='backdated',day='2026-01-03'))
        self.assertEqual(self.balance(a),'100.00')

    def test_opening_correction_cannot_fabricate_earlier_history(self):
        a=self.account();e=self.opening(a,'100.00')
        self.service.reverse(CREATOR,e['id'],Reversal(effectiveDate='2026-01-02',reason='Correct later count'),'reverse-opening')
        self.assert_http(409,lambda:self.opening(a,'101.00'))

    def test_opening_same_date_replacement_and_as_of_activity(self):
        a=self.account();b=self.account('SECOND');e=self.opening(a,'100.00')
        self.service.reverse(CREATOR,e['id'],Reversal(effectiveDate=DAY,reason='Correct original count'),'reverse-opening')
        self.opening(a,'101.00');self.transfer(a,b,'1.00')
        self.assertEqual(self.service.activity(CREATOR,a['id'],DAY)['balance'],'101.00')
        self.assertEqual(self.balance(a),'100.00')

    def test_atomic_rollback_includes_journal_operation_and_audit(self):
        a=self.account();b=self.account('SECOND');self.opening(a)
        before=len(self.store._state['audits'])
        entries=len(self.service.entries(CREATOR))
        with patch.object(MemoryRepository,'save_operation',side_effect=RuntimeError('commit evidence failed')):
            with self.assertRaises(RuntimeError):self.transfer(a,b)
        self.assertEqual(self.balance(a),'1000.00');self.assertEqual(self.balance(b),'0.00')
        self.assertEqual(len(self.service.entries(CREATOR)),entries);self.assertEqual(len(self.store._state['audits']),before)
        self.assertNotIn(('transfer.post','transfer-1'),self.store._state['operations'])

    def test_simultaneous_outflows_and_retry_prevent_overpayment(self):
        a=self.account();b=self.account('SECOND');self.opening(a,'10.00')
        def submit(i):
            try:return self.transfer(a,b,'6.00',reference=f'race-{i}')['id']
            except HTTPException as exc:return exc.status_code
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(submit,range(2)))
        self.assertEqual(results.count(409),1);self.assertEqual(self.balance(a),'4.00')
        with ThreadPoolExecutor(max_workers=2) as pool:
            same=list(pool.map(lambda _:self.transfer(a,b,'1.00',reference='same-retry')['id'],range(2)))
        self.assertEqual(same[0],same[1]);self.assertEqual(self.balance(b),'7.00')

    def test_permissions_account_scopes_and_idempotent_replay_are_enforced(self):
        a=self.account();b=self.account('SECOND');self.opening(a)
        no_grant=Actor('viewer',frozenset({'finance.accounts.view'}))
        self.assert_http(403,lambda:self.service.create_account(no_grant,AccountCreate(code='DENIED',name='Denied',kind='BANK'),'denied'))
        scoped_actor=Actor('scoped',frozenset(PERMISSIONS),account_ids=frozenset({a['id']}))
        # Shared opening-equity totals would disclose other accounts' balances.
        self.assertEqual([row['id'] for row in self.service.list_accounts(scoped_actor)],[a['id']])
        self.assert_http(403,lambda:self.service.activity(scoped_actor,b['id']))
        p=TransferCreate(fromAccountId=a['id'],toAccountId=b['id'],amount='1.00',effectiveDate=DAY,sourceReference='scope',reason='Unallowed destination',method='CASH_HANDOVER')
        self.assert_http(403,lambda:self.service.transfer(scoped_actor,p,'scope'))
        draft=self.service.create_opening(CREATOR,OpeningCreate(accountId=b['id'],amount='1.00',effectiveDate=DAY,reason='Account count',evidenceReference='count'),'scope-draft')
        self.assertFalse(next(r['reversed'] for r in self.service.list_openings(CREATOR) if r['id']==draft['id']))
        self.service.approve_opening(APPROVER,draft['id'],Approval(reason='Approved count'),'scope-approval')
        self.assert_http(403,lambda:self.service.approve_opening(scoped_actor,draft['id'],Approval(reason='Approved count'),'scope-approval'))

    def test_missing_key_and_future_date_are_rejected_without_mutation(self):
        a=self.account();b=self.account('SECOND');self.opening(a)
        self.assert_http(400,lambda:self.service.edit_account(CREATOR,a['id'],AccountEdit(version=1,name='Missing key'),None))
        self.assert_http(400,lambda:self.transfer(a,b,'1.00',reference='future',day='2026-10-13'))
        self.assertEqual(self.balance(a),'1000.00')


async def asgi_request(app,method,path,body=None,headers=None):
    events=[]; sent=False
    async def receive():
        nonlocal sent
        if not sent:
            sent=True
            return {'type':'http.request','body':json.dumps(body).encode() if body is not None else b'', 'more_body':False}
        return {'type':'http.disconnect'}
    async def send(event):events.append(event)
    scope={'type':'http','asgi':{'version':'3.0'},'http_version':'1.1','method':method,'scheme':'http',
           'path':path,'raw_path':path.encode(),'query_string':b'', 'root_path':'',
           'server':('test',80),'client':('test',1),
           'headers':[(k.lower().encode(),v.encode()) for k,v in {'Content-Type':'application/json',**(headers or {})}.items()]}
    await app(scope,receive,send)
    status=next(e['status'] for e in events if e['type']=='http.response.start')
    payload=b''.join(e.get('body',b'') for e in events if e['type']=='http.response.body')
    return status,json.loads(payload) if payload else None


class FinanceApiTests(unittest.TestCase):
    def setUp(self):
        self.module=importlib.import_module('finance.router')
        self.old=(self.module._actor_provider,self.module.service)
        self.module.configure_finance(lambda token: CREATOR if token=='Bearer finance' else Actor('',frozenset()),store=MemoryStore())
        self.app=FastAPI();self.app.include_router(self.module.router)

    def tearDown(self):self.module._actor_provider,self.module.service=self.old

    def request(self,method,path,body=None,auth=True,key='request-key'):
        headers={'Authorization':'Bearer finance'} if auth else {}
        if key:headers['Idempotency-Key']=key
        return asyncio.run(asgi_request(self.app,method,path,body,headers))

    def test_auth_default_denial_and_explicit_memory_readiness(self):
        self.assertEqual(self.request('GET','/api/finance/accounts',auth=False)[0],401)
        status,p=self.request('GET','/api/finance/readiness');self.assertEqual(status,200)
        self.assertFalse(p['realDataReady'])
        self.module._actor_provider=None
        self.assertEqual(self.request('GET','/api/finance/accounts')[0],503)

    def test_api_account_with_starting_balance_and_simple_later_opening(self):
        payload={'code':'INLINE_API','name':'Cash desk','kind':'CASH','startingBalance':{'amount':'25.21','effectiveDate':DAY}}
        status,account=self.request('POST','/api/finance/accounts',payload,key='inline-api')
        self.assertEqual(status,201)
        opening=account['startingBalance']
        self.assertEqual(opening['amount'],'25.21')
        self.assertEqual(opening['createdBy'],CREATOR.username)
        status,replay=self.request('POST','/api/finance/accounts',payload,key='inline-api')
        self.assertEqual(status,201)
        self.assertTrue(replay['idempotentReplay'])
        self.assertEqual(replay['startingBalance']['id'],opening['id'])
        status,empty=self.request('POST','/api/finance/accounts',{'code':'LATER_API','name':'Later bank','kind':'BANK'},key='later-api')
        self.assertEqual(status,201)
        status,later=self.request('POST','/api/finance/opening-balances',{'accountId':empty['id'],'amount':'1.23','effectiveDate':DAY},key='simple-later-api')
        self.assertEqual(status,201)
        self.assertEqual(later['evidenceType'],'OPERATOR_DECLARATION')
        self.assertEqual(later['status'],'DRAFT')

    def test_api_money_strings_validation_and_immutable_routes(self):
        status,a=self.request('POST','/api/finance/accounts',{'code':'DESK','name':'Cash desk','kind':'CASH'})
        self.assertEqual(status,201)
        status,rows=self.request('GET','/api/finance/accounts');self.assertEqual(status,200)
        self.assertEqual(next(r['balance'] for r in rows if r['id']==a['id']),'0.00')
        self.assertEqual(self.request('POST','/api/finance/opening-balances',{'accountId':a['id'],'effectiveDate':DAY,'amount':0.1,'reason':'Counted cash','evidenceReference':'sheet'},key='bad-float')[0],422)
        self.assertEqual(self.request('PATCH','/api/finance/journals/fake',{})[0],405)
        self.assertEqual(self.request('DELETE','/api/finance/journals/fake')[0],405)
        self.assertEqual(self.request('POST','/api/finance/accounts',{'code':'MISSING','name':'Missing key','kind':'BANK'},key=None)[0],400)


if __name__=='__main__':unittest.main()
