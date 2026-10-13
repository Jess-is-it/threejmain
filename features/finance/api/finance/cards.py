"""Immutable card bills and linked repayments. Statements never post costs."""
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException
from .expense_plans import settlement_plan
from .ledger import ZERO, fingerprint, normal_balance, now, scoped
from .schemas import json_record


def latest(repo, record):
    return max((r for r in repo.card_statements() if r['accountId']==record['accountId']),
               key=lambda r:(r['periodEnd'],r['createdAt'],r['id']))['id']==record['id']


def summary(service, repo, record):
    reversals={e['reversalOfId']:e for e in repo.entries() if e['reversalOfId']}
    repayments=[{**p,'reversalJournalId':reversals[p['journalId']]['id'] if p['journalId'] in reversals else None}
                for p in repo.card_repayments(record['id'])]
    paid=sum((Decimal(p['amount']) for p in repayments if not p['reversalJournalId']),ZERO)
    plan=settlement_plan({**record,'amount':record['statementBalance']},paid,service.today().isoformat())
    current_closing=normal_balance(repo.account(record['accountId']),repo.entries(),record['periodEnd'])
    return {**record,**plan,'paidAmount':format(paid,'.2f'),
            'currentLedgerBalanceAtStatement':format(current_closing,'.2f'),
            'statementVariance':format(Decimal(record['statementBalance'])-current_closing,'.2f'),
            'outstandingAmount':format(Decimal(record['statementBalance'])-paid,'.2f'),
            'status':'SUPERSEDED' if not latest(repo,record) else 'PAID' if paid==Decimal(record['statementBalance']) else 'PARTIALLY_PAID' if paid else 'UNPAID',
            'cardBalance':format(normal_balance(repo.account(record['accountId']),repo.entries()),'.2f'),
            'repayments':repayments}


def statements(service, actor):
    actor.require('finance.accounts.view');actor.require('finance.transfers.view')
    with service.store.read() as repo:
        result=[]
        for r in repo.card_statements():
            if actor.account_ids is not None and r['accountId'] not in actor.account_ids:continue
            row=summary(service,repo,r)
            row['repayments']=[p for p in row['repayments'] if actor.account_ids is None or p['fromAccountId'] in actor.account_ids]
            result.append(row)
        return result


def create(service, actor, payload, key, correcting=None):
    p=json_record(payload);scoped(actor,p['accountId'])
    def action(repo):
        account=repo.account(p['accountId'])
        if not account['active'] or account['kind']!='CREDIT_CARD':raise HTTPException(400,'Select an active named credit-card account')
        service._day(p['periodEnd'])
        prior=[r for r in repo.card_statements() if r['accountId']==account['id']]
        if any(r['statementReference'].upper()==p['statementReference'].upper() for r in prior):
            raise HTTPException(409,'This card statement is already retained')
        if correcting:
            original=repo.card_statement(correcting)
            if original['accountId']!=account['id'] or original['periodEnd']!=p['periodEnd'] or not latest(repo,original):
                raise HTTPException(409,'Correct only the latest statement, retaining its account and closing date')
            if Decimal(summary(service,repo,original)['paidAmount']):
                raise HTTPException(409,'Reverse allocated repayments before correcting the statement')
        elif prior and p['periodEnd']<=max(r['periodEnd'] for r in prior):
            raise HTTPException(409,'New statement must end after the latest retained statement')
        balance=normal_balance(account,repo.entries(),p['periodEnd'])
        r={**p,'id':str(uuid4()),'entity':'CARD_STATEMENT','correctsStatementId':correcting,'createdBy':actor.username,'createdAt':now(),
           'accountSnapshot':{k:account[k] for k in ('id','name','code','kind')},
           'ledgerBalanceAtStatement':format(balance,'.2f'),
           'statementVariance':format(Decimal(p['statementBalance'])-balance,'.2f')}
        repo.insert_card_statement(r)
        return r
    return service._mutate(actor,'finance.accounts.manage','card.statement.create',key,{'correctsStatementId':correcting,**p},action)


def repay(service, actor, statement_id, payload, key):
    p=json_record(payload);scoped(actor,p['fromAccountId'])
    def action(repo):
        r=repo.card_statement(statement_id);scoped(actor,r['accountId'])
        posting={'cardStatementId':statement_id,**p}
        prior=next((e for e in repo.entries() if e['sourceNamespace']=='finance.card-repayment' and e['sourceReference']==p['sourceReference']),None)
        if prior:
            if prior['fingerprint']!=fingerprint(posting):raise HTTPException(409,'Repayment reference already has different evidence')
            return {**repo.card_repayment(prior['metadata']['cardRepaymentId']),'idempotentReplay':True}
        if not latest(repo,r):raise HTTPException(409,'Use the latest card statement; previous statements are retained history')
        due=Decimal(summary(service,repo,r)['outstandingAmount'])
        if Decimal(p['amount'])>due:raise HTTPException(409,'Repayment exceeds the tracked statement balance')
        service._day(p['effectiveDate'])
        if p['effectiveDate']<r['periodEnd']:raise HTTPException(400,'Statement repayment cannot predate statement closing')
        source=repo.account(p['fromAccountId']);card=repo.account(r['accountId'])
        if source['kind'] in ('CREDIT_CARD','GENERAL_LEDGER'):raise HTTPException(400,'Repay the card from a named cash, bank or wallet account')
        payment_id=str(uuid4())
        journal=service._post(repo,actor,'TRANSFER','finance.card-repayment',p['sourceReference'],posting,
                            [{'accountId':card['id'],'debit':p['amount'],'credit':'0.00'},
                             {'accountId':source['id'],'debit':'0.00','credit':p['amount']}],
                            {**posting,'cardRepaymentId':payment_id,'method':'CARD_SETTLEMENT',
                             'fromAccountId':source['id'],'toAccountId':card['id'],'incomeEffect':'0.00','expenseEffect':'0.00'})
        result={**p,'id':payment_id,'entity':'CARD_REPAYMENT','accountId':card['id'],'cardStatementId':statement_id,
                'journalId':journal['id'],'createdBy':actor.username,'createdAt':now(),
                'fromAccountSnapshot':{k:source[k] for k in ('id','code','name','kind')}}
        repo.insert_card_repayment(result);repo.validate_cards()
        return result
    return service._mutate(actor,'finance.transfers.post','card.repay',key,{'cardStatementId':statement_id,**p},action)


def reverse(service, actor, repayment_id, payload, key):
    p=json_record(payload)
    def action(repo):
        repayment=repo.card_repayment(repayment_id)
        scoped(actor,repayment['accountId']);scoped(actor,repayment['fromAccountId'])
        journal=service._reverse_in_repo(repo,actor,repayment['journalId'],p,card_workflow=True)
        repo.validate_cards()
        return {**repayment,'reversalJournalId':journal['id']}
    return service._mutate(actor,'finance.journals.reverse','card.repay.reverse',key,{'repaymentId':repayment_id,**p},action)


def link(service, actor, statement_id, payload, key):
    """Allocate an existing card transfer without posting the money a second time."""
    actor.require('finance.transfers.view')
    p=json_record(payload)
    def action(repo):
        r=repo.card_statement(statement_id);scoped(actor,r['accountId'])
        e=repo.entry(p['journalId']);service._entry_scope(repo,actor,e)
        existing=next((payment for bill in repo.card_statements() for payment in repo.card_repayments(bill['id']) if payment['journalId']==e['id']),None)
        if existing:
            if existing['cardStatementId']!=statement_id or existing['reason']!=p['reason']:
                raise HTTPException(409,'Transfer already has another statement allocation')
            return {**existing,'idempotentReplay':True}
        if not latest(repo,r):raise HTTPException(409,'Allocate repayments to the latest card statement')
        if e['kind']!='TRANSFER' or e['sourceNamespace']!='finance.transfer' or e['metadata'].get('method')!='CARD_SETTLEMENT' or e['metadata'].get('toAccountId')!=r['accountId']:
            raise HTTPException(400,'Select an existing card-settlement transfer for this card')
        if any(j['reversalOfId']==e['id'] for j in repo.entries()):raise HTTPException(409,'A reversed transfer cannot be allocated')
        if e['effectiveDate']<r['periodEnd']:raise HTTPException(400,'Repayment cannot precede the statement closing date')
        value=Decimal(e['metadata']['amount'])
        if value>Decimal(summary(service,repo,r)['outstandingAmount']):raise HTTPException(409,'Transfer exceeds remaining statement balance')
        source=repo.account(e['metadata']['fromAccountId']);scoped(actor,source['id'])
        result={'id':str(uuid4()),'entity':'CARD_REPAYMENT','accountId':r['accountId'],'cardStatementId':statement_id,
                'journalId':e['id'],'fromAccountId':source['id'],'effectiveDate':e['effectiveDate'],'amount':format(value,'.2f'),
                'sourceReference':e['sourceReference'],'referenceNumber':e['metadata']['referenceNumber'],
                'reason':p['reason'],'linkedExistingTransfer':True,'createdBy':actor.username,'createdAt':now(),
                'fromAccountSnapshot':{k:source[k] for k in ('id','code','name','kind')}}
        repo.insert_card_repayment(result);repo.validate_cards()
        return result
    return service._mutate(actor,'finance.transfers.post','card.repay.link',key,{'cardStatementId':statement_id,**p},action)
