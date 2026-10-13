"""Accounting rules shared by PostgreSQL and explicit isolated-test repositories."""
import hashlib
import json
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from .memory import EQUITY_ID, PAYABLE_CONTROL_ID, CONTROL_IDS
from .schemas import json_record, money
from .income_controls import INCOME_CONTROLS

ZERO = Decimal('0.00')


def now():
    return datetime.now(timezone.utc).isoformat()


def fingerprint(payload):
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def normal_balance(account, entries, as_of=None):
    balance = sum((Decimal(l['debit']) - Decimal(l['credit'])
                   for e in entries if as_of is None or e['effectiveDate'] <= as_of
                   for l in e['lines'] if l['accountId'] == account['id']), ZERO)
    return -balance if account['normalSide'] == 'CREDIT' else balance


def scoped(actor, account_id):
    # Fixed nonspendable equity control is safe to include with a scoped opening.
    if account_id not in CONTROL_IDS:
        actor.account(account_id)


class FinanceService:
    def __init__(self, store, today=None):
        self.store = store
        self.today = today or (lambda: datetime.now(ZoneInfo('Asia/Manila')).date())

    def _day(self, day):
        parsed = date.fromisoformat(str(day))
        if parsed > self.today():
            raise HTTPException(400, 'Future financial postings are not allowed')
        return parsed.isoformat()

    def _mutate(self, actor, permission, scope, key, payload, action):
        actor.require(permission)
        if not isinstance(key, str) or not 1 <= len(key.strip()) <= 160:
            raise HTTPException(400, 'A stable Idempotency-Key (1–160 characters) is required')
        key = key.strip()
        digest = fingerprint(payload)
        with self.store.transaction() as repo:
            prior = repo.operation(scope, key)
            if prior:
                if prior['fingerprint'] != digest:
                    raise HTTPException(409, 'Idempotency-Key was already used for another request')
                self._result_scope(actor, prior['result'], repo=repo)
                return {**prior['result'], 'idempotentReplay': True}
            result = action(repo)
            repo.save_operation(scope, key, digest, result)
            # Replayed canonical source postings do not generate a second financial audit.
            if not result.get('idempotentReplay'):
                repo.audit({'id': str(uuid4()), 'createdAt': now(), 'actor': actor.username,
                            'action': scope, 'targetId': result['id'], 'request': payload})
            return result

    @staticmethod
    def _result_scope(actor, result, repo=None):
        if 'glType' in result:
            scoped(actor,result['id'])
        if 'accountId' in result:
            scoped(actor,result['accountId'])
        if 'fromAccountId' in result:
            scoped(actor,result['fromAccountId'])
        for line in result.get('lines',[]):
            scoped(actor,line['accountId'])

    def create_account(self, actor, payload, key):
        p = json_record(payload)
        starting = p.get('startingBalance')
        if starting and Decimal(starting['amount']) > ZERO:
            # Check on every attempt, including an idempotent replay after grants change.
            actor.require('finance.opening-balances.post')
        if actor.account_ids is not None:
            raise HTTPException(403, 'Account creation requires unscoped Finance master-data permission')
        def action(repo):
            code = p['code'].upper()
            if any(a['code'] == code for a in repo.accounts()):
                raise HTTPException(409, 'Account code already exists, including archived accounts')
            kind = p['kind']
            if starting:
                if kind == 'GENERAL_LEDGER':
                    raise HTTPException(400, 'Starting balances require a financial account')
                self._day(starting['effectiveDate'])
            gl = p.get('glType')
            if kind == 'GENERAL_LEDGER':
                if not gl:
                    raise HTTPException(400, 'General-ledger accounts require glType')
            else:
                expected = 'LIABILITY' if kind == 'CREDIT_CARD' else 'ASSET'
                if gl is not None and gl != expected:
                    raise HTTPException(400, 'Account kind determines its accounting classification')
                gl = expected
            if kind in ('COLLECTOR_CASH','COLLECTOR_GCASH') and not p['custodian']:
                raise HTTPException(400, 'Collector accounts require a named custodian')
            stamp = now()
            master = {k: v for k, v in p.items() if k != 'startingBalance'}
            record = {**master, 'id': str(uuid4()), 'code': code, 'glType': gl,
                      'normalSide': 'CREDIT' if gl in ('LIABILITY','EQUITY','REVENUE') else 'DEBIT',
                      'currency': 'PHP', 'controlledCash': kind in ('CASH','PETTY_CASH','COMPANY_GCASH','BANK','COLLECTOR_CASH'),
                      'system': False, 'active': True, 'version': 1, 'createdAt': stamp,
                      'updatedAt': stamp, 'createdBy': actor.username, 'updatedBy': actor.username,
                      'archivedAt': None}
            repo.save_account(record)
            if starting and Decimal(starting['amount']) > ZERO:
                opening_payload = {'accountId': record['id'], **starting}
                opening = self._save_opening(repo, actor, opening_payload, source='ACCOUNT_CREATE')
                repo.audit({'id': str(uuid4()), 'createdAt': now(), 'actor': actor.username,
                            'action': 'opening.create', 'targetId': opening['id'],
                            'request': opening_payload, 'accountCreationId': record['id']})
                return {**record, 'startingBalance': opening}
            return record
        return self._mutate(actor,'finance.accounts.manage','account.create',key,p,action)

    def edit_account(self, actor, account_id, payload, key, active=None):
        actor.account(account_id)
        p = json_record(payload)
        scope = 'account.edit' if active is None else ('account.restore' if active else 'account.archive')
        def action(repo):
            current = repo.account(account_id)
            if current['system']:
                raise HTTPException(409, 'System control account cannot be changed')
            if current['version'] != p['version']:
                raise HTTPException(409, 'Account changed; refresh before editing')
            if active is False and normal_balance(current,repo.entries()) != ZERO:
                raise HTTPException(409, 'Account must have a zero balance before archival')
            for field in ('name','custodian','notes'):
                if field in p:
                    current[field] = p[field]
            if current['kind'] in ('COLLECTOR_CASH','COLLECTOR_GCASH') and not current['custodian']:
                raise HTTPException(400, 'Collector accounts require a named custodian')
            if active is not None:
                current.update(active=active, archivedAt=None if active else now(), archiveReason=p['reason'])
            current.update(version=current['version']+1, updatedAt=now(), updatedBy=actor.username)
            repo.save_account(current)
            return current
        return self._mutate(actor,'finance.accounts.manage',scope,key,{'accountId':account_id, **p},action)

    def list_accounts(self, actor, as_of=None):
        actor.require('finance.accounts.view')
        day = self._day(as_of or self.today())
        with self.store.read() as repo:
            entries = repo.entries()
            return [{**a, 'balance': format(normal_balance(a,entries,day),'.2f'), 'asOf':day}
                    for a in repo.accounts() if actor.account_ids is None or a['id'] in actor.account_ids]

    def _post(self, repo, actor, kind, namespace, reference, payload, lines, metadata=None, reversal_of=None):
        digest = fingerprint(payload)
        prior = next((e for e in repo.entries() if e['sourceNamespace']==namespace and e['sourceReference']==reference),None)
        if prior:
            if prior['fingerprint'] != digest:
                raise HTTPException(409, 'Source reference already has a different financial posting')
            return {**prior, 'idempotentReplay':True}
        day = self._day(payload['effectiveDate'])
        from .periods import ensure_open
        ensure_open(repo,day)
        debit = credit = ZERO
        normalized = []
        for line in lines:
            scoped(actor,line['accountId'])
            account = repo.account(line['accountId'])
            if not account['active']:
                raise HTTPException(409, 'Restore archived accounts before posting or reversing')
            try:d,c = money(line.get('debit','0.00')),money(line.get('credit','0.00'))
            except ValueError:raise HTTPException(400,'Journal line amount is outside the supported exact monetary range') from None
            if not ((d > 0 and c == 0) or (c > 0 and d == 0)):
                raise HTTPException(400, 'Every journal line needs exactly one positive debit or credit')
            debit += d
            credit += c
            normalized.append({'accountId':account['id'],'debit':format(d,'.2f'),'credit':format(c,'.2f'),
                               'memo':line.get('memo',''),'accountSnapshot':{k:account[k] for k in ('code','name','kind','glType','normalSide')}})
        if len(normalized)<2 or len({l['accountId'] for l in normalized})<2 or debit != credit:
            raise HTTPException(400, 'Journal must balance across at least two distinct accounts')
        if namespace=='finance.manual' and any(
            l['accountSnapshot']['kind'] not in ('GENERAL_LEDGER','CREDIT_CARD') and Decimal(l['debit'])>ZERO for l in normalized
        ) and any(l['accountSnapshot']['glType'] in ('REVENUE','LIABILITY','EQUITY') and Decimal(l['credit'])>ZERO for l in normalized):
            raise HTTPException(409,'Use independently approved other income/funding, opening balance or explicit card-funding workflow for this inflow')
        record = {'id':str(uuid4()),'kind':kind,'effectiveDate':day,'postedAt':now(),'postedBy':actor.username,
                  'reason':payload['reason'],'currency':'PHP','sourceNamespace':namespace,'sourceReference':reference,
                  'fingerprint':digest,'metadata':metadata or {},'status':'POSTED','reversalOfId':reversal_of,'lines':normalized}
        # Evaluate every affected daily historical balance, not just today's funds.
        entries = [*repo.entries(),record]
        for account_id in {l['accountId'] for l in normalized}:
            account = repo.account(account_id)
            if account['kind']=='GENERAL_LEDGER':
                continue
            days = sorted({e['effectiveDate'] for e in entries if any(l['accountId']==account_id for l in e['lines'])})
            if any(normal_balance(account,entries,day)<ZERO for day in days):
                raise HTTPException(409, 'Posting would create negative funds or overpay a credit-card liability')
        return repo.insert_entry(record)

    def post_journal(self, actor, payload, key):
        p=json_record(payload)
        for line in p['lines']:
            if line['accountId'] in INCOME_CONTROLS:
                raise HTTPException(409, 'Income controls require the source or reviewed cutover workflow')
            if line['accountId'] == PAYABLE_CONTROL_ID:
                raise HTTPException(409, 'Payable control must be posted through the Expenses & Payables workflow')
            scoped(actor,line['accountId'])
        return self._mutate(actor,'finance.journals.post','journal.post',key,p,
                            lambda repo:self._post(repo,actor,'JOURNAL','finance.manual',p['sourceReference'],p,p['lines']))

    def _save_opening(self, repo, actor, payload, source='STARTING_BALANCE_FORM'):
        account = repo.account(payload['accountId'])
        if account['kind'] == 'GENERAL_LEDGER' or not account['active']:
            raise HTTPException(409, 'Opening requires an active financial account')
        self._day(payload['effectiveDate'])
        record = {**payload, 'id': str(uuid4()), 'status': 'DRAFT',
                  'reason': payload.get('reason') or 'Starting balance declared during account setup',
                  'evidenceReference': payload.get('evidenceReference') or 'Operator declaration; no supporting reference provided',
                  'evidenceType': 'REFERENCE' if payload.get('evidenceReference') else 'OPERATOR_DECLARATION',
                  'declarationSource': source, 'createdBy': actor.username, 'createdAt': now(),
                  'approvedBy': None, 'approvedAt': None, 'approvalReason': None, 'journalId': None}
        repo.save_opening(record)
        return record

    def create_opening(self, actor, payload, key):
        p=json_record(payload)
        actor.account(p['accountId'])
        return self._mutate(actor,'finance.opening-balances.post','opening.create',key,p,
                            lambda repo: self._save_opening(repo, actor, p))

    def approve_opening(self, actor, opening_id, payload, key):
        p=json_record(payload)
        def action(repo):
            r=repo.opening(opening_id)
            actor.account(r['accountId'])
            if r['status']!='DRAFT':
                raise HTTPException(409,'Only a draft opening can be approved')
            if r['createdBy']==actor.username:
                raise HTTPException(403,'Opening creator cannot approve their own balance')
            if actor.approval_limit is not None and Decimal(r['amount'])>actor.approval_limit:
                raise HTTPException(403,'Opening exceeds your approval limit')
            r.update(status='APPROVED',approvedBy=actor.username,approvedAt=now(),approvalReason=p['reason'])
            repo.save_opening(r)
            return r
        return self._mutate(actor,'finance.opening-balances.approve','opening.approve',key,{'openingId':opening_id,**p},action)

    def post_opening(self, actor, opening_id, key):
        def action(repo):
            r=repo.opening(opening_id)
            actor.account(r['accountId'])
            if r['journalId']:
                return {**repo.entry(r['journalId']),'idempotentReplay':True}
            if r['status']!='APPROVED':
                raise HTTPException(409,'Opening balance requires independent approval before posting')
            entries=repo.entries()
            reversed_ids={e['reversalOfId'] for e in entries}
            if any(e['kind']=='OPENING' and e['metadata'].get('accountId')==r['accountId'] and e['id'] not in reversed_ids for e in entries):
                raise HTTPException(409,'Account already has a posted opening balance; reverse it before replacement')
            for previous in entries:
                if previous['kind']=='OPENING' and previous['metadata'].get('accountId')==r['accountId']:
                    correction=next((e for e in entries if e['reversalOfId']==previous['id']),None)
                    if correction and correction['effectiveDate']!=previous['effectiveDate']:
                        raise HTTPException(409,'A later-dated opening reversal needs a reviewed journal correction, not another opening')
            if any(e['effectiveDate']<r['effectiveDate'] and any(l['accountId']==r['accountId'] for l in e['lines']) for e in entries):
                raise HTTPException(409,'Opening date must not be later than existing account activity')
            account=repo.account(r['accountId'])
            debit=account['normalSide']=='DEBIT'
            lines=[{'accountId':account['id'],'debit':r['amount'] if debit else '0.00','credit':'0.00' if debit else r['amount']},
                   {'accountId':EQUITY_ID,'debit':'0.00' if debit else r['amount'],'credit':r['amount'] if debit else '0.00'}]
            posted=self._post(repo,actor,'OPENING','finance.opening',opening_id,r,lines,
                              {'openingId':opening_id,'accountId':r['accountId'],'approvedBy':r['approvedBy'],
                               'evidenceReference':r['evidenceReference'],
                               'evidenceType':r.get('evidenceType', 'REFERENCE'),
                               'declarationSource':r.get('declarationSource', 'LEGACY'),
                               'cashFlowExcluded':True})
            r.update(status='POSTED',journalId=posted['id'])
            repo.save_opening(r)
            return posted
        return self._mutate(actor,'finance.opening-balances.post','opening.post',key,{'openingId':opening_id},action)

    def list_openings(self, actor):
        actor.require('finance.accounts.view')
        with self.store.read() as repo:
            reversed_ids={e['reversalOfId'] for e in repo.entries() if e['reversalOfId']}
            return [{**r,'reversed':r['journalId'] in reversed_ids} for r in repo.openings()
                    if actor.account_ids is None or r['accountId'] in actor.account_ids]

    def transfer(self, actor, payload, key):
        p=json_record(payload)
        for field in ('fromAccountId','toAccountId'):
            actor.account(p[field])
        def action(repo):
            a,b=repo.account(p['fromAccountId']),repo.account(p['toAccountId'])
            if a['id']==b['id'] or any(x['kind']=='GENERAL_LEDGER' for x in (a,b)):
                raise HTTPException(400,'Transfers require two distinct financial accounts, never income/expense accounts')
            if not p['referenceNumber'] and p['method']!='CASH_HANDOVER':
                raise HTTPException(400,'Non-cash transfer requires a supporting reference')
            if p['method']=='CARD_SETTLEMENT' and (b['kind']!='CREDIT_CARD' or a['kind']=='CREDIT_CARD'):
                raise HTTPException(400,'Card settlement pays a card liability from an asset account')
            if p['method']=='CARD_FUNDING' and (a['kind']!='CREDIT_CARD' or b['kind']=='CREDIT_CARD'):
                raise HTTPException(400,'Card funding requires a credit-card source and asset destination')
            if 'CREDIT_CARD' in (a['kind'],b['kind']) and p['method'] not in ('CARD_SETTLEMENT','CARD_FUNDING'):
                raise HTTPException(400,'Use explicit Card settlement or Card funding for liabilities')
            lines=[{'accountId':b['id'],'debit':p['amount'],'credit':'0.00'},
                   {'accountId':a['id'],'debit':'0.00','credit':p['amount']}]
            return self._post(repo,actor,'TRANSFER','finance.transfer',p['sourceReference'],p,lines,
                              {**p,'state':'SETTLED','incomeEffect':'0.00','expenseEffect':'0.00'})
        return self._mutate(actor,'finance.transfers.post','transfer.post',key,p,action)

    def _reverse_in_repo(self, repo, actor, entry_id, p, *, payable_workflow=False, income_workflow=False, card_workflow=False, metadata_override=None):
        original=repo.entry(entry_id)
        if original['metadata'].get('cardStatementId') and not card_workflow:
            raise HTTPException(409, 'Use the linked credit-card repayment correction workflow')
        if any(original['metadata'].get(k) for k in ('incomeSourceId','manualIncomeId','cutoverId')) and not income_workflow:
            raise HTTPException(409, 'Use the source-owned income correction or reviewed income reversal workflow')
        if original['metadata'].get('payableId') and not payable_workflow:
            raise HTTPException(409, 'Use the linked payable/payment reversal workflow')
        for line in original['lines']:
            scoped(actor,line['accountId'])
        prior=next((e for e in repo.entries() if e['reversalOfId']==entry_id),None)
        if prior:
            if prior['fingerprint']!=fingerprint({'entryId':entry_id,**p}):
                raise HTTPException(409,'Journal already has another reversal')
            return {**prior,'idempotentReplay':True}
        if original['kind']=='REVERSAL':
            raise HTTPException(409,'A reversal cannot itself be reversed; post a reviewed replacement')
        if p['effectiveDate']<original['effectiveDate']:
            raise HTTPException(400,'Reversal date cannot precede the original entry')
        lines=[{'accountId':l['accountId'],'debit':l['credit'],'credit':l['debit'],'memo':l['memo']} for l in original['lines']]
        return self._post(repo,actor,'REVERSAL','finance.reversal',entry_id,{'entryId':entry_id,**p},lines,
                          {**original['metadata'],'originalKind':original['kind'],'originalNumber':original['number'],
                           'cashFlowExcluded':original['metadata'].get('cashFlowExcluded',False),
                           **{field:format(ZERO-Decimal(original['metadata'][field]),'.2f')
                              for field in ('incomeEffect','expenseEffect') if field in original['metadata']},
                           **(metadata_override or {})},entry_id)

    def reverse(self, actor, entry_id, payload, key):
        p=json_record(payload)
        def action(repo):
            return self._reverse_in_repo(repo,actor,entry_id,p)
        return self._mutate(actor,'finance.journals.reverse','journal.reverse',key,{'entryId':entry_id,**p},action)

    def entries(self, actor, kind=None):
        actor.require('finance.transfers.view' if kind=='TRANSFER' else 'finance.journals.view')
        with self.store.read() as repo:
            all_entries=repo.entries()
            reversed_by={e['reversalOfId']:e['id'] for e in all_entries if e['reversalOfId']}
            result=[]
            for e in all_entries:
                if kind is not None and e['kind']!=kind:continue
                try:self._entry_scope(repo,actor,e)
                except HTTPException as exc:
                    if exc.status_code==403:continue
                    raise
                result.append({**e,'reversedByEntryId':reversed_by.get(e['id'])})
            return result

    def _entry_scope(self, repo, actor, entry):
        for line in entry['lines']:
            scoped(actor,line['accountId'])

    def entry(self, actor, entry_id):
        actor.require('finance.journals.view')
        with self.store.read() as repo:
            e=repo.entry(entry_id)
            self._entry_scope(repo,actor,e)
            return e

    def activity(self, actor, account_id, as_of=None):
        actor.require('finance.accounts.view')
        actor.account(account_id)
        day=self._day(as_of or self.today())
        with self.store.read() as repo:
            a=repo.account(account_id)
            running=ZERO
            rows=[]
            for e in sorted(repo.entries(),key=lambda e:(e['effectiveDate'],e['number'])):
                if e['effectiveDate']>day:
                    continue
                for l in e['lines']:
                    if l['accountId']!=account_id:
                        continue
                    delta=Decimal(l['debit'])-Decimal(l['credit'])
                    running+=-delta if a['normalSide']=='CREDIT' else delta
                    rows.append({'entryId':e['id'],'number':e['number'],'kind':e['kind'],
                                 'effectiveDate':e['effectiveDate'],'postedAt':e['postedAt'],'postedBy':e['postedBy'],
                                 'reason':e['reason'],'debit':l['debit'],'credit':l['credit'],'balance':format(running,'.2f'),
                                 'accountSnapshot':l['accountSnapshot'],'reversalOfId':e['reversalOfId']})
            return {'account':a,'asOf':day,'balance':format(running,'.2f'),'items':rows,
                    'basis':'POSTED_JOURNAL','currency':'PHP','timeZone':'Asia/Manila'}
