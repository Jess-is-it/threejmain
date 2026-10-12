"""Reviewed period locks and immutable publication revisions."""
import calendar
from copy import deepcopy
from datetime import date
from uuid import uuid4

from fastapi import HTTPException
from pydantic import Field, StrictBool
from .schemas import Model, Reason, Text, json_record

CHECKS = ('bankStatements', 'cashCounts', 'collectorCustody', 'openingBalances',
          'subledgerTies', 'recognitionAndCosts', 'depreciationAccrualsAndTax')
FLAGS = ('cashFlow', 'registerReceivables', 'payables', 'collections', 'earnedRevenue',
         'directCosts', 'operatingExpenses', 'nonoperating', 'incomeTax')


class PeriodPrepare(Model):
    reason: Reason
    evidenceReference: Text
    checklist: dict[str, StrictBool]


class PeriodAction(Model):
    version: int = Field(ge=1)
    reason: Reason
    evidenceReference: Text


def bounds(month, today):
    try:
        start = date.fromisoformat(month+'-01')
        if len(month) != 7 or start.year < 1900: raise ValueError()
    except ValueError:
        raise HTTPException(422, 'Period must be YYYY-MM, from 1900') from None
    end = date(start.year,start.month,calendar.monthrange(start.year,start.month)[1])
    if end >= today:
        raise HTTPException(409, 'Only a completed month can be prepared or closed')
    return start.isoformat(),end.isoformat()


def period_access(service, actor, permission):
    actor.require(permission)
    actor.require('finance.periods.view')
    service._report_access(actor)
    service._report_access(actor,True)


def ensure_open(repo, day):
    record = repo.period(day[:7])
    if record and record['status'] in ('CLOSING','CLOSED'):
        raise HTTPException(409, f"Financial period {day[:7]} is {record['status'].lower()}; an authorized reopening is required")


def readiness(service, repo, start, end):
    digest = service._digest(repo,end)
    proof = service._coverage(repo,start,end,digest)
    missing = [flag for flag in FLAGS if not proof.get(flag)]
    if missing:
        raise HTTPException(409, 'Period cannot close without certified financial coverage: '+', '.join(missing))
    if any(r['status'] != 'RESOLVED' for r in repo.reconciliation_exceptions()):
        raise HTTPException(409, 'Unresolved reconciliation exceptions prevent period closing')
    provider = getattr(service,'period_provider',None)
    if provider is None:
        raise HTTPException(503, 'Period closing source-watermark provider is not integrated')
    source = provider(start,end)
    if not source.get('ready'):
        raise HTTPException(409, 'Period source readiness: '+source.get('reason','unverified source cutover or checkpoints'))
    reports = {kind:service._render_financial_report(repo,kind,start,end,end,{}) for kind in
               ('cash-flow','profit-and-loss','payables','receivables','reconciliation','collections','transactions')}
    if reports['cash-flow']['controlledCash']['reconciliationVariance'] != '0.00':
        raise HTTPException(409, 'Cash opening/movement/closing balances do not reconcile')
    if reports['receivables']['status'] != 'COMPLETE' or reports['payables']['status'] != 'COMPLETE':
        raise HTTPException(409, 'Receivable/payable source controls must reconcile completely')
    if any(m['status'] not in ('COMPLETE','NOT_APPLICABLE') for m in reports['profit-and-loss']['metrics'].values()):
        raise HTTPException(409, 'Revenue, costs and profit require complete certified coverage')
    reports['transactions'].update(items=service._period_entries(repo,start,end),offset=0)
    reports['transactions']['limit']=len(reports['transactions']['items'])
    for basis in ('RECOGNIZED','SETTLED'):
        for group in ('category','payee','account','location','project'):
            reports[f'expenses:{basis}:{group}']=service._render_financial_report(repo,'expenses',start,end,end,{'basis':basis,'group_by':group})
    reports['subscribers']=service._subscriber_report(repo,start,end,end,start[:7])
    reports['billing-settlement']={**service._envelope(repo,start,end,end,'BILLING_MONTH_COHORT'),**service._settlement_report(repo,start[:7],end)}
    entries=[e for e in repo.entries() if e['effectiveDate']<=end]
    from decimal import Decimal
    debits=sum((Decimal(l['debit']) for e in entries for l in e['lines']),Decimal('0.00'))
    credits=sum((Decimal(l['credit']) for e in entries for l in e['lines']),Decimal('0.00'))
    if debits != credits: raise HTTPException(409,'Trial balance does not reconcile')
    return digest,source,reports,format(debits,'.2f')


def prepare(service, actor, month, payload, key):
    period_access(service,actor,'finance.periods.prepare')
    start,end=bounds(month,service.today());p=json_record(payload)
    if set(p['checklist']) != set(CHECKS) or not all(p['checklist'].values()):
        raise HTTPException(409,'Every documented period reconciliation check must be reviewed')
    def action(repo):
        old=repo.period(month)
        if old and old['status']!='OPEN':raise HTTPException(409,'Period is already closing/closed; reopen explicitly')
        digest,source,reports,trial=readiness(service,repo,start,end)
        from .ledger import now
        record={'id':month,'entity':'FINANCE_PERIOD','month':month,'status':'CLOSING','version':(old['version'] if old else 0)+1,
                'preparedBy':actor.username,'preparedAt':now(),'ledgerFingerprint':digest,'sourceEvidence':source,
                'trialBalanceDebits':trial,'trialBalanceCredits':trial,'reports':reports,**p}
        return save(repo,actor,record,'PREPARE')
    return service._mutate(actor,'finance.periods.prepare','period.prepare',key,{'month':month,**p},action)


def transition(service, actor, month, payload, key, operation):
    permission='finance.periods.close' if operation=='CLOSE' else 'finance.periods.reopen'
    period_access(service,actor,permission)
    start,end=bounds(month,service.today());p=json_record(payload)
    def action(repo):
        record=repo.period(month)
        if not record:raise HTTPException(404,'Financial period not found')
        if record['version']!=p['version']:raise HTTPException(409,'Period changed; refresh its version')
        if operation=='CLOSE':
            if record['status']!='CLOSING':raise HTTPException(409,'Prepare the period reconciliation before closing')
            if record['preparedBy']==actor.username:raise HTTPException(403,'A different authorized reviewer must close the period')
            digest,source,_,_=readiness(service,repo,start,end)
            if digest!=record['ledgerFingerprint'] or source!=record['sourceEvidence']:
                raise HTTPException(409,'Period evidence changed; reopen and prepare a fresh revision')
            record.update(status='CLOSED',closedBy=actor.username)
        else:
            if record['status']=='OPEN':raise HTTPException(409,'Period is already open')
            record.update(status='OPEN',reopenedBy=actor.username)
        from .ledger import now
        record.update(version=record['version']+1,updatedAt=now(),actionReason=p['reason'],actionEvidenceReference=p['evidenceReference'])
        return save(repo,actor,record,operation)
    return service._mutate(actor,permission,'period.'+operation.lower(),key,{'month':month,**p},action)


def save(repo, actor, record, operation):
    from .ledger import now
    # Publication/history bytes live in immutable events as well as the current
    # state. Reopening cannot erase a previously published revision.
    event={'id':str(uuid4()),'month':record['month'],'version':record['version'],'operation':operation,
           'actor':actor.username,'createdAt':now(),'record':deepcopy(record)}
    repo.save_period(record);repo.period_event(event)
    return record


def published(repo, kind, start, end, as_of, options):
    record=repo.period(start[:7])
    if not record or record['status']!='CLOSED' or end != as_of or end[:7] != start[:7] or not start.endswith('-01'):return None
    full_end=date.fromisoformat(end).day == calendar.monthrange(int(end[:4]),int(end[5:7]))[1]
    if not full_end:return None
    name=f"expenses:{options.get('basis','RECOGNIZED')}:{options.get('group_by','category')}" if kind=='expenses' else kind
    report=deepcopy(record['reports'].get(name))
    if report is None:return None
    if kind=='transactions':
        account=options.get('account_id');rows=[e for e in report['items'] if not account or any(l['accountId']==account for l in e['lines'])]
        offset=options.get('offset',0);limit=options.get('limit',100)
        from decimal import Decimal
        report.update(items=rows[offset:offset+limit],offset=offset,limit=limit,totalRows=len(rows),
                      totalDebits=format(sum((Decimal(l['debit']) for e in rows for l in e['lines']),Decimal('0.00')),'.2f'),
                      totalCredits=format(sum((Decimal(l['credit']) for e in rows for l in e['lines']),Decimal('0.00')),'.2f'))
    return {**report,'periodState':'CLOSED','publicationVersion':record['version'],'publicationClosedBy':record['closedBy']}
