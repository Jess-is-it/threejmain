"""Exact ledger reports and certified source analytics; no inferred missing history."""
import calendar
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException
from pydantic import TypeAdapter, ValidationError

from .income import IncomeService, stable_id
from .income_controls import AR, POS_AR, DEFERRED, CREDIT, VARIANCE, POS_REVENUE, POS_DISCOUNT
from .ledger import ZERO, fingerprint, normal_balance, now
from .memory import PAYABLE_CONTROL_ID
from .report_schemas import ACTIVE, POLICY, ReportEvidence, ReportFeedRequest
from .schemas import json_record
from collections import Counter


def amount(value):
    return format(Decimal(value), '.2f')


def percent(numerator, denominator):
    if not denominator:return None
    return format((Decimal(numerator)*100/Decimal(denominator)).quantize(Decimal('.01'),rounding=ROUND_HALF_UP),'.2f')


def metric(value, status='COMPLETE', reasons=(), recorded=None):
    return {'value':value,'status':status,'reasons':list(reasons),
            **({'recordedValue':recorded} if recorded is not None else {})}


def month_window(month, as_of, today):
    try:
        start=date.fromisoformat(month+'-01')
        if start.year<1900 or start.strftime('%Y-%m')!=month:raise ValueError()
        end=date(start.year,start.month,calendar.monthrange(start.year,start.month)[1])
    except (ValueError,TypeError):raise HTTPException(400,'Month must be YYYY-MM') from None
    cutoff=as_of or today
    if cutoff>today or cutoff<start:raise HTTPException(400,'asOf must be on/after the selected month start and not future')
    return start,min(end,cutoff),cutoff,end


def bucket(due,as_of):
    if due is None:return 'UNKNOWN'
    days=(as_of-date.fromisoformat(due)).days
    return 'CURRENT' if days<=0 else '1_30' if days<=30 else '31_60' if days<=60 else '61_90' if days<=90 else '90_PLUS'


class ReportingService(IncomeService):
    def __init__(self,store,today=None,providers=None,report_providers=None,period_provider=None):
        super().__init__(store,today=today,providers=providers)
        self.report_providers=dict(report_providers or {})
        self.period_provider=period_provider

    @staticmethod
    def _report_access(actor,subscriber=False):
        actor.require('finance.reports.subscribers.view' if subscriber else 'finance.reports.financial.view')
        if actor.account_ids is not None or actor.expense_ids is not None:
            raise HTTPException(403,'Aggregate reports require unrestricted account/document scope')
        if not subscriber:
            for permission in ('finance.accounts.view','finance.journals.view','finance.expenses.view',
                               'finance.expenses.view_all','finance.income.view','finance.income.view_all'):
                actor.require(permission)

    @staticmethod
    def _result_scope(actor,result,repo=None):
        if result.get('entity')=='FINANCE_PERIOD':
            from .periods import period_access
            period_access(ReportingService,actor,'finance.periods.view')
            return
        if result.get('entity')=='REPORT_SNAPSHOT':
            ReportingService._report_access(actor,result['kind'] in ('subscribers','billing-settlement'))
            actor.require('finance.reports.evidence.sync')
        else:IncomeService._result_scope(actor,result,repo=repo)

    def list_periods(self,actor):
        from .periods import period_access
        period_access(self,actor,'finance.periods.view')
        with self.store.read() as repo:
            return [{k:v for k,v in r.items() if k != 'reports'} for r in repo.periods()]

    def period_detail(self,actor,month):
        from .periods import period_access
        period_access(self,actor,'finance.periods.view')
        with self.store.read() as repo:
            record=repo.period(month)
            if record is None:raise HTTPException(404,'Financial period not found')
            return {'current':record,'history':repo.period_events(month)}

    def prepare_period(self,actor,month,payload,key):
        from .periods import prepare
        return prepare(self,actor,month,payload,key)

    def transition_period(self,actor,month,payload,key,operation):
        from .periods import transition
        return transition(self,actor,month,payload,key,operation)

    @staticmethod
    def _digest(repo,end):
        # Later backdates/voids and scope/account changes invalidate coverage certificates.
        return fingerprint({'entries':sorted([e for e in repo.entries() if e['effectiveDate']<=end],key=lambda e:e['id']),
                            'accounts':sorted(repo.accounts(),key=lambda a:a['id']),
                            'exceptions':sorted(repo.reconciliation_exceptions(),key=lambda r:r['id'])})

    def sync_report_evidence(self,actor,kind,payload,key):
        subscriber=kind in ('subscribers','billing-settlement')
        self._report_access(actor,subscriber);actor.require('finance.reports.evidence.sync')
        key=key.strip() if isinstance(key,str) else key
        p=json_record(payload);start,end,as_of,_=month_window(p['month'],date.fromisoformat(p['asOf']) if p.get('asOf') else None,self.today())
        request_payload={'kind':kind,**p}
        # Confirm uncertain attempts without another provider fetch. Recheck current rights first.
        with self.store.read() as repo:
            prior=repo.operation('reports.evidence.sync',key) if isinstance(key,str) else None
            if prior:
                if prior['fingerprint']!=fingerprint(request_payload):raise HTTPException(409,'Idempotency-Key already has another report request')
                self._result_scope(actor,prior['result'],repo)
                return {**prior['result'],'idempotentReplay':True}
            digest=self._digest(repo,end.isoformat())
        if not isinstance(key,str) or not 1<=len(key.strip())<=160:raise HTTPException(400,'Stable Idempotency-Key required')
        provider=self.report_providers.get(kind)
        if provider is None:raise HTTPException(503,'Certified report provider has not been integrated')
        try:
            raw=provider.fetch(ReportFeedRequest(kind,p['month'],start.isoformat(),end.isoformat(),as_of.isoformat(),actor.username,digest))
            proof=TypeAdapter(ReportEvidence).validate_python(raw.model_dump() if hasattr(raw,'model_dump') else raw)
            evidence=proof.model_dump(mode='json')
            if evidence['kind']!=kind:raise ValueError('Wrong source report kind')
            if kind=='subscribers':
                if evidence['completeThrough']>self.today().isoformat() or evidence['completeThrough']<end.isoformat():raise ValueError('Uncovered/future lifecycle window')
                self._timeline(evidence)
            elif kind in ('billing-settlement','billing-receivables'):
                if evidence['asOf']!=as_of.isoformat():raise ValueError('Billing evidence must match the requested asOf')
                if kind=='billing-settlement' and evidence['month']!=p['month']:raise ValueError('Wrong billing month')
            else:
                if evidence['startDate']!=start.isoformat() or evidence['endDate']!=end.isoformat() or evidence['ledgerFingerprint']!=digest:
                    raise ValueError('Coverage certificate does not match the actual ledger/window')
        except (ValidationError,ValueError,KeyError,TypeError) as exc:
            raise HTTPException(502,'Invalid certified report evidence; no snapshot saved') from exc
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(502,'Certified report provider failed; no snapshot saved') from exc
        def action(repo):
            if kind=='financial-coverage':
                if self._digest(repo,end.isoformat())!=digest:raise HTTPException(409,'Ledger changed while certification was fetched')
                for account_id,classification in evidence['accountClassifications'].items():
                    account=repo.account(account_id)
                    required='REVENUE' if classification in ('EARNED_REVENUE','NONOPERATING_INCOME') else 'CONTRA_REVENUE' if classification=='CONTRA_REVENUE' else 'EXPENSE'
                    if account['kind']!='GENERAL_LEDGER' or account['glType']!=required:raise HTTPException(409,'Certified classification conflicts with account type')
                    if account_id==POS_REVENUE and classification!='EARNED_REVENUE' or account_id==POS_DISCOUNT and classification!='CONTRA_REVENUE':
                        raise HTTPException(409,'Fixed POS price/discount control classification is immutable')
            snapshots=repo.report_snapshots(kind)
            if kind=='subscribers':
                for old in snapshots:
                    previous=old['evidence']
                    if previous['baselineDate']==evidence['baselineDate'] and fingerprint(previous['baseline'])!=fingerprint(evidence['baseline']):
                        raise HTTPException(409,'Certified lifecycle baseline cannot be rewritten')
                    old_events={e['eventId']:e for e in previous['events']}
                    new_ids={e['eventId'] for e in evidence['events']}
                    if any(e['eventId'] not in new_ids for e in previous['events'] if evidence['baselineDate']<e['effectiveDate']<=evidence['completeThrough']):
                        raise HTTPException(409,'Certified overlapping history cannot omit previously retained effects')
                    for event in evidence['events']:
                        if event['eventId'] in old_events and fingerprint(event)!=fingerprint(old_events[event['eventId']]):
                            raise HTTPException(409,'Existing immutable lifecycle evidence changed')
            record_id=stable_id('report:'+kind,evidence['snapshotId']);digest_evidence=fingerprint(evidence)
            prior=next((r for r in snapshots if r['id']==record_id),None)
            if prior:
                if prior['fingerprint']!=digest_evidence:raise HTTPException(409,'Snapshot identity already has different evidence')
                return {**prior,'idempotentReplay':True}
            record={'id':record_id,'entity':'REPORT_SNAPSHOT','kind':kind,'snapshotId':evidence['snapshotId'],
                    'fingerprint':digest_evidence,'receivedAt':now(),'receivedBy':actor.username,'evidence':evidence}
            repo.insert_report_snapshot(record)
            return record
        return self._mutate(actor,'finance.reports.evidence.sync','reports.evidence.sync',key,request_payload,action)

    @staticmethod
    def _timeline(evidence):
        state={r['serviceAccountId']:dict(r) for r in evidence['baseline']}
        historical=set(evidence['historicalCustomerIds'])
        customer_counts=Counter(r['customerId'] for r in state.values() if r['status'] in ACTIVE)
        history=[];previous_day=evidence['baselineDate']
        for event in sorted(evidence['events'],key=lambda r:r['sequence']):
            line=event['line'];line_id=line['serviceAccountId'];old=state.get(line_id)
            if event['effectiveDate']<previous_day:raise ValueError('Lifecycle sequence must have monotonic effective dates')
            previous_day=event['effectiveDate']
            if event['beforeStatus']!=(old['status'] if old else None) or event['beforeCustomerId']!=(old['customerId'] if old else ''):
                raise ValueError('Lifecycle before-state does not match certified history')
            was_active=old is not None and old['status'] in ACTIVE
            affected={line['customerId']} | ({old['customerId']} if old else set())
            before_customers={c for c in affected if customer_counts[c]>0}
            entering=line['status'] in ACTIVE and not was_active
            leaving=was_active and line['status'] not in ACTIVE
            kind=event['kind']
            if kind=='ACTIVATION' and (not entering or (old and old['everActive']) or line['migratedExisting']):
                raise ValueError('First activation needs proved first entry, excluding migrated existing lines')
            if kind=='REACTIVATION' and (not entering or not old or not old['everActive']):raise ValueError('Reactivation needs previous service evidence')
            if kind=='MIGRATION_BASELINE' and not line['migratedExisting']:raise ValueError('Imported baseline adjustment needs explicit existing-subscriber evidence')
            if kind in ('SUSPENSION','DISCONNECTION','TERMINATION'):
                target={'SUSPENSION':'SUSPENDED','DISCONNECTION':'DISCONNECTED','TERMINATION':'TERMINATED'}[kind]
                if not old or line['status']!=target or old['status']==target:raise ValueError('Invalid actual lifecycle transition')
            if kind in ('RATE','OWNERSHIP'):
                if not old or old['status']!=line['status'] or old['everActive']!=line['everActive'] or old['migratedExisting']!=line['migratedExisting']:
                    raise ValueError('Rate/ownership effect cannot silently change lifecycle')
                if kind=='RATE' and old['customerId']!=line['customerId']:raise ValueError('Billing rate cannot change ownership')
                if kind=='OWNERSHIP' and (old['customerId']==line['customerId'] or any(old[f]!=line[f] for f in ('billable','monthlyRecurringRate','rateEvidence'))):
                    raise ValueError('Ownership must only change the source owner')
            if entering and kind not in ('ACTIVATION','REACTIVATION','MIGRATION_BASELINE'):
                raise ValueError('Active entry needs explicit first/reentry/migration classification')
            if leaving and kind not in ('SUSPENSION','DISCONNECTION','TERMINATION','MIGRATION_BASELINE'):
                raise ValueError('Active exit needs explicit lifecycle classification')
            if old and old['everActive'] and not line['everActive']:raise ValueError('Cannot erase historical service membership')
            if old and kind!='RATE' and any(old[f]!=line[f] for f in ('billable','monthlyRecurringRate','rateEvidence')):
                raise ValueError('Rate/billability changes require a separately certified Billing effect')
            if old and old['customerId']!=line['customerId'] and kind!='OWNERSHIP':raise ValueError('Ownership changes require an explicit Service effect')
            state[line_id]=dict(line)
            if was_active:customer_counts[old['customerId']]-=1
            if line['status'] in ACTIVE:customer_counts[line['customerId']]+=1
            after_customers={c for c in affected if customer_counts[c]>0}
            item={'event':event,'entering':entering,'leaving':leaving,
                  'customerEntries':len(after_customers-before_customers),'customerExits':len(before_customers-after_customers),
                  'newCustomer':kind=='ACTIVATION' and line['customerId'] not in historical}
            if line['everActive']:historical.add(line['customerId'])
            history.append(item)
        return state,history

    def _envelope(self,repo,start,end,as_of,basis):
        return {'period':{'startDate':start,'endDate':end},'asOf':as_of,'basis':basis,
                'timeZone':'Asia/Manila','currency':'PHP','policyVersion':POLICY,
                'generatedAt':now(),'knowledgeCutoff':'CURRENT_POSTED_EVIDENCE',
                'ledgerFingerprint':self._digest(repo,end),'sourceWatermarks':{
                    s:repo.checkpoint(s) for s in ('billing','point-of-sale','collector','service')}}

    def _coverage(self,repo,start,end,digest):
        records=[r for r in repo.report_snapshots('financial-coverage') if r['evidence']['startDate']==start and
                 r['evidence']['endDate']==end and r['evidence']['ledgerFingerprint']==digest]
        return records[-1]['evidence'] if records else {}

    def _asof_coverage(self,repo,as_of):
        digest=self._digest(repo,as_of)
        records=[r for r in repo.report_snapshots('financial-coverage') if r['evidence']['endDate']==as_of and r['evidence']['ledgerFingerprint']==digest]
        return records[-1]['evidence'] if records else {}

    def financial_report(self,actor,kind,month,as_of=None,**options):
        self._report_access(actor)
        start,end,cutoff,_=month_window(month,as_of,self.today())
        with self.store.read() as repo:
            return self._render_financial_report(repo,kind,start.isoformat(),end.isoformat(),cutoff.isoformat(),options)

    def _render_financial_report(self,repo,kind,start,end,as_of,options):
        from .periods import published
        closed=published(repo,kind,start,end,as_of,options)
        if closed:return closed
        envelope=self._envelope(repo,start,end,as_of,'FINANCE_POSTED_LEDGER')
        if kind in ('payables','receivables'):
            envelope.update(period={'startDate':None,'endDate':as_of},basis='AS_OF_OBLIGATIONS',ledgerFingerprint=self._digest(repo,as_of))
        if kind=='cash-flow':data=self._cash(repo,start,end,envelope)
        elif kind=='profit-and-loss':data=self._profit(repo,start,end,envelope)
        elif kind=='expenses':data=self._expenses(repo,start,end,options)
        elif kind=='payables':data=self._payable_report(repo,as_of)
        elif kind=='receivables':data=self._receivable_report(repo,as_of)
        elif kind=='reconciliation':data=self._exceptions_report(repo,start,end)
        elif kind=='collections':data=self._collections(repo,start,end)
        elif kind=='transactions':data=self._transactions(repo,start,end,options)
        else:raise HTTPException(404,'Unknown financial report')
        period=repo.period(start[:7])
        return {**envelope,**data,'periodState':period['status'] if period else 'OPEN'}

    @staticmethod
    def _period_entries(repo,start,end):
        return sorted([e for e in repo.entries() if start<=e['effectiveDate']<=end],key=lambda e:(e['effectiveDate'],e['number']))

    def _cash_class(self,repo,e):
        m=e['metadata']
        if m.get('cashFlowClass') in ('OPERATING','INVESTING','FINANCING'):return m['cashFlowClass']
        if m.get('effect')=='COLLECTOR_REMITTANCE':
            if any(l['accountId']==VARIANCE for l in e['lines']) and sum(Decimal(l['debit'])-Decimal(l['credit']) for l in e['lines'] if l['accountSnapshot']['kind'] in ('CASH','PETTY_CASH','COMPANY_GCASH','BANK','COLLECTOR_CASH'))<ZERO:
                return 'UNCLASSIFIED'
            return 'OPERATING'
        if m.get('incomeSourceId'):return 'OPERATING'
        if m.get('payableId'):
            payable=repo.payable(m['payableId']);category=payable['categorySnapshot']
            if category['code']=='FINANCE_INTEREST':return 'FINANCING'
            return 'INVESTING' if category['classification']=='ASSET' else 'OPERATING'
        if e['kind']=='TRANSFER' or m.get('originalKind')=='TRANSFER':
            return 'FINANCING' if any(l['accountSnapshot']['kind']=='CREDIT_CARD' for l in e['lines']) else 'OPERATING'
        return 'UNCLASSIFIED'

    def _cash(self,repo,start,end,envelope):
        entries=repo.entries();period=self._period_entries(repo,start,end);accounts=repo.accounts()
        rows=[]
        for a in accounts:
            if a['kind']=='GENERAL_LEDGER':continue
            opening=normal_balance(a,entries,(date.fromisoformat(start)-timedelta(days=1)).isoformat())
            closing=normal_balance(a,entries,end)
            adjustment=normal_balance(a,[e for e in period if e['kind']=='OPENING' or e['metadata'].get('cashFlowExcluded')])
            rows.append({'accountId':a['id'],'name':a['name'],'kind':a['kind'],'active':a['active'],
                         'controlledCash':a['controlledCash'],'normalSide':a['normalSide'],
                         'openingBalance':amount(opening),'openingAdjustments':amount(adjustment),
                         'netMovement':amount(closing-opening-adjustment),'closingBalance':amount(closing),
                         'reconciliationVariance':'0.00'})
        flows={k:ZERO for k in ('OPERATING','INVESTING','FINANCING','UNCLASSIFIED')};transactions=[];account_transactions=[];internal=[]
        for e in period:
            legs=[l for l in e['lines'] if l['accountSnapshot']['kind'] in ('CASH','PETTY_CASH','COMPANY_GCASH','BANK','COLLECTOR_CASH')]
            net=sum((Decimal(l['debit'])-Decimal(l['credit']) for l in legs),ZERO)
            if e['kind']=='OPENING' or e['metadata'].get('cashFlowExcluded'):continue
            for leg in e['lines']:
                snapshot=leg['accountSnapshot']
                if snapshot['kind']=='GENERAL_LEDGER':continue
                movement=(Decimal(leg['debit'])-Decimal(leg['credit']))*(1 if snapshot['normalSide']=='DEBIT' else -1)
                account_transactions.append({'journalId':e['id'],'effectiveDate':e['effectiveDate'],'accountId':leg['accountId'],
                                             'classification':'INTERNAL' if not net else self._cash_class(repo,e),'amount':amount(movement)})
            if not net:
                if legs:internal.append(e['id'])
                continue
            classification=self._cash_class(repo,e);flows[classification]+=net
            transactions.append({'journalId':e['id'],'effectiveDate':e['effectiveDate'],
                                 'classification':classification,'amount':amount(net),'accountIds':[l['accountId'] for l in legs]})
        cash_rows=[r for r in rows if r['controlledCash']]
        total=lambda field:sum((Decimal(r[field]) for r in cash_rows),ZERO)
        opening=total('openingBalance');adjustments=total('openingAdjustments');closing=total('closingBalance');net=sum(flows.values(),ZERO)
        cert=self._coverage(repo,start,end,envelope['ledgerFingerprint'])
        complete=cert.get('cashFlow',False) and not flows['UNCLASSIFIED']
        return {'status':'COMPLETE' if complete else 'PROVISIONAL','reasonCodes':[] if complete else ['UNCERTIFIED_CASH_COVERAGE'],
                'accounts':rows,'controlledCash':{'opening':amount(opening),'openingAdjustments':amount(adjustments),
                'netCashFlow':amount(net),'closing':amount(closing),'reconciliationVariance':amount(closing-opening-adjustments-net)},
                'flows':{k:amount(v) for k,v in flows.items()},'transactions':transactions,'accountTransactions':account_transactions,'eliminatedInternalJournalIds':internal,
                'cardLiabilities':amount(sum((Decimal(r['closingBalance']) for r in rows if r['kind']=='CREDIT_CARD'),ZERO)),
                'personalGcashDue':amount(sum((Decimal(r['closingBalance']) for r in rows if r['kind']=='COLLECTOR_GCASH'),ZERO))}

    def _profit(self,repo,start,end,envelope):
        cert=self._coverage(repo,start,end,envelope['ledgerFingerprint']);classification=cert.get('accountClassifications',{})
        totals={k:ZERO for k in ('EARNED_REVENUE','CONTRA_REVENUE','DIRECT_COST','OPERATING_EXPENSE',
            'NONOPERATING_INCOME','NONOPERATING_EXPENSE','FINANCING_EXPENSE','INCOME_TAX','UNCLASSIFIED_REVENUE','UNCLASSIFIED_EXPENSE')}
        rows=[]
        for e in self._period_entries(repo,start,end):
            if e['metadata'].get('cashFlowExcluded') or e['kind']=='OPENING':continue
            for line in e['lines']:
                gl=line['accountSnapshot']['glType']
                if gl not in ('REVENUE','CONTRA_REVENUE','EXPENSE'):continue
                role=classification.get(line['accountId']);m=e['metadata']
                if not role:
                    if line['accountId']==POS_REVENUE:role='EARNED_REVENUE'
                    elif line['accountId']==POS_DISCOUNT or gl=='CONTRA_REVENUE':role='CONTRA_REVENUE'
                    elif m.get('manualIncomeId') and m.get('classification')=='OTHER_INCOME':role='NONOPERATING_INCOME'
                    elif m.get('payableId'):
                        c=repo.payable(m['payableId'])['categorySnapshot']
                        role='FINANCING_EXPENSE' if c['code']=='FINANCE_INTEREST' else 'INCOME_TAX' if c['code']=='INCOME_TAX' else c['classification']
                    else:role='UNCLASSIFIED_REVENUE' if gl=='REVENUE' else 'UNCLASSIFIED_EXPENSE'
                if role not in totals:role='UNCLASSIFIED_EXPENSE'
                delta=Decimal(line['credit'])-Decimal(line['debit']) if gl=='REVENUE' else Decimal(line['debit'])-Decimal(line['credit'])
                totals[role]+=delta;rows.append({'journalId':e['id'],'effectiveDate':e['effectiveDate'],'accountId':line['accountId'],'accountName':line['accountSnapshot']['name'],'classification':role,'amount':amount(delta)})
        unclassified=any(r['classification'].startswith('UNCLASSIFIED') for r in rows)
        unresolved=any(r['status']!='RESOLVED' for r in repo.reconciliation_exceptions())
        flags={name:bool(cert.get(name)) and not unclassified and not unresolved for name in ('earnedRevenue','directCosts','operatingExpenses','nonoperating','incomeTax')}
        def component(key,flag):return metric(amount(totals[key]),'COMPLETE' if flags[flag] else 'PROVISIONAL',() if flags[flag] else ['UNCERTIFIED_'+flag.upper()])
        revenue=totals['EARNED_REVENUE']-totals['CONTRA_REVENUE'];gross=revenue-totals['DIRECT_COST'];operating=gross-totals['OPERATING_EXPENSE']
        pretax=operating+totals['NONOPERATING_INCOME']-totals['NONOPERATING_EXPENSE']-totals['FINANCING_EXPENSE'];net=pretax-totals['INCOME_TAX']
        revenue_ok=flags['earnedRevenue'];gross_ok=revenue_ok and flags['directCosts'];op_ok=gross_ok and flags['operatingExpenses'];pretax_ok=op_ok and flags['nonoperating'];net_ok=pretax_ok and flags['incomeTax']
        subtotal=lambda v,ok:metric(amount(v) if ok else None,'COMPLETE' if ok else 'UNAVAILABLE',() if ok else ['INCOMPLETE_RECOGNITION_OR_COSTING'],recorded=amount(v))
        return {'status':'COMPLETE' if net_ok else 'PROVISIONAL','metrics':{
                'earnedGrossRevenue':component('EARNED_REVENUE','earnedRevenue'),'contraRevenue':component('CONTRA_REVENUE','earnedRevenue'),
                'earnedRevenue':metric(amount(revenue),'COMPLETE' if revenue_ok else 'PROVISIONAL',() if revenue_ok else ['DELIVERY_RECOGNITION_NOT_CERTIFIED']),
                'directCosts':component('DIRECT_COST','directCosts'),'grossProfit':subtotal(gross,gross_ok),
                'operatingExpenses':component('OPERATING_EXPENSE','operatingExpenses'),'operatingProfit':subtotal(operating,op_ok),
                'nonoperatingIncome':component('NONOPERATING_INCOME','nonoperating'),'nonoperatingExpense':component('NONOPERATING_EXPENSE','nonoperating'),
                'financingExpense':component('FINANCING_EXPENSE','nonoperating'),'profitBeforeTax':subtotal(pretax,pretax_ok),
                'incomeTax':component('INCOME_TAX','incomeTax'),'netProfit':subtotal(net,net_ok),
                'totalExpenses':metric(amount(sum((totals[k] for k in ('DIRECT_COST','OPERATING_EXPENSE','NONOPERATING_EXPENSE','FINANCING_EXPENSE','INCOME_TAX','UNCLASSIFIED_EXPENSE')),ZERO)),
                    'COMPLETE' if all(flags.values()) else 'PROVISIONAL',() if all(flags.values()) else ['ALL_EXPENSE_COVERAGE_NOT_CERTIFIED']),
                'grossMarginPercentage':metric(percent(gross,revenue) if gross_ok and revenue>ZERO else None,'COMPLETE' if gross_ok and revenue>ZERO else 'NOT_APPLICABLE' if gross_ok else 'UNAVAILABLE'),
                'operatingMarginPercentage':metric(percent(operating,revenue) if op_ok and revenue>ZERO else None,'COMPLETE' if op_ok and revenue>ZERO else 'NOT_APPLICABLE' if op_ok else 'UNAVAILABLE')},
                'recordedClassTotals':{k:amount(v) for k,v in totals.items()},'transactions':rows,
                'deferredConsiderationAsOf':amount(normal_balance(repo.account(DEFERRED),repo.entries(),end)),
                'missingDependencies':[] if net_ok else ['SERVICE_DELIVERY_RECOGNITION','VALUED_INVENTORY_COSTS','DEPRECIATION_ACCRUALS','FINANCING_AND_TAX_COVERAGE']}

    def _expenses(self,repo,start,end,options):
        basis=options.get('basis','RECOGNIZED');group=options.get('group_by','category')
        if basis not in ('RECOGNIZED','SETTLED') or group not in ('category','payee','account','location','project'):raise HTTPException(400,'Invalid expense basis or grouping')
        groups={};rows=[];cash_paid=ZERO
        for e in self._period_entries(repo,start,end):
            pid=e['metadata'].get('payableId')
            if not pid:
                if basis=='RECOGNIZED':
                    for leg in e['lines']:
                        if leg['accountSnapshot']['glType']!='EXPENSE':continue
                        delta=Decimal(leg['debit'])-Decimal(leg['credit'])
                        if not delta:continue
                        key=leg['accountId'] if group=='account' else 'UNASSIGNED'
                        groups[key]=groups.get(key,ZERO)+delta
                        rows.append({'journalId':e['id'],'effectiveDate':e['effectiveDate'],'payableId':None,'groupId':key,'accountId':leg['accountId'],'accountName':leg['accountSnapshot']['name'],
                                     'categoryId':None,'payeeId':None,'classification':'UNCLASSIFIED_EXPENSE','amount':amount(delta)})
                continue
            payable=repo.payable(pid);category=payable['categorySnapshot']
            if category['classification'] not in ('OPERATING_EXPENSE','DIRECT_COST'):continue
            if basis=='RECOGNIZED':
                delta=sum((Decimal(l['debit'])-Decimal(l['credit']) for l in e['lines'] if l['accountId']==category['accountId']),ZERO)
                account_id=category['accountId']
            else:
                if not e['metadata'].get('paymentId'):continue
                delta=sum((Decimal(l['debit'])-Decimal(l['credit']) for l in e['lines'] if l['accountId']==PAYABLE_CONTROL_ID),ZERO)
                account_id=repo.payment(e['metadata']['paymentId'])['accountId']
                if repo.account(account_id)['controlledCash']:cash_paid+=delta
            if not delta:continue
            key={'category':payable['categoryId'],'payee':payable['payeeId'],'account':account_id,
                 'location':payable['locationReference'] or 'UNASSIGNED','project':payable['projectReference'] or 'UNASSIGNED'}[group]
            groups[key]=groups.get(key,ZERO)+delta
            rows.append({'journalId':e['id'],'effectiveDate':e['effectiveDate'],'payableId':pid,'groupId':key,'accountId':account_id,
                         'accountName':next(l['accountSnapshot']['name'] for l in e['lines'] if l['accountId']==account_id),
                         'categoryName':category['name'],'payeeName':payable['payeeSnapshot']['name'],'categoryId':payable['categoryId'],
                         'payeeId':payable['payeeId'],'classification':category['classification'],'amount':amount(delta)})
        return {'status':'PROVISIONAL','reasonCodes':['EXPENSE_COVERAGE_NOT_CERTIFIED'],'expenseBasis':basis,'groupBy':group,
                'scope':'ALL_POSTED_EXPENSE_LINES' if basis=='RECOGNIZED' else 'POSTED_EXPENSE_PAYABLE_SETTLEMENTS',
                'total':amount(sum(groups.values(),ZERO)),'groups':[{'id':k,'amount':amount(v)} for k,v in sorted(groups.items())],
                'transactions':rows,'cashPaidTotal':amount(cash_paid) if basis=='SETTLED' else None,
                'reconciliationVariance':amount(sum(groups.values(),ZERO)-sum((Decimal(r['amount']) for r in rows),ZERO))}

    def _payable_report(self,repo,as_of):
        rows=[];entries=[e for e in repo.entries() if e['effectiveDate']<=as_of]
        for p in repo.payables():
            linked=[e for e in entries if e['metadata'].get('payableId')==p['id']]
            if not linked:continue
            due=sum((Decimal(l['credit'])-Decimal(l['debit']) for e in linked for l in e['lines'] if l['accountId']==PAYABLE_CONTROL_ID),ZERO)
            if not due:continue
            from .expense_plans import settlement_plan
            plan=settlement_plan(p,Decimal(p['amount'])-due,as_of)
            for scheduled in plan['settlementSchedule']:
                if not Decimal(scheduled['outstandingAmount']):continue
                rows.append({'payableId':p['id'],'payeeId':p['payeeId'],'payeeName':p['payeeSnapshot']['name'],
                             'dueDate':scheduled['dueDate'],'installmentNumber':scheduled['number'],
                             'outstandingAmount':scheduled['outstandingAmount'],
                             'agingBucket':bucket(scheduled['dueDate'],date.fromisoformat(as_of)),
                             'journalIds':[e['id'] for e in linked]})
        total=sum((Decimal(r['outstandingAmount']) for r in rows),ZERO)
        control=normal_balance(repo.account(PAYABLE_CONTROL_ID),entries)
        complete=self._asof_coverage(repo,as_of).get('payables',False) and control==total
        return {'status':'COMPLETE' if complete else 'PROVISIONAL','reasonCodes':[] if complete else ['OPENING_PAYABLE_AND_ALL_SUPPLIER_COVERAGE_NOT_CERTIFIED'],
                'rows':rows,'total':amount(total),'controlBalance':amount(control),'reconciliationVariance':amount(control-total),
                'aging':{k:amount(sum((Decimal(r['outstandingAmount']) for r in rows if r['agingBucket']==k),ZERO)) for k in ('CURRENT','1_30','31_60','61_90','90_PLUS','UNKNOWN')}}

    def _receivable_report(self,repo,as_of):
        projections={};identities={}
        plans=[p for p in repo.income_documents('CUTOVER') if p['status']=='ACTIVE' and p['throughDate']<=as_of]
        for plan in plans:
            for r in plan['receivables']:
                key=f"ar:{r['source']}:{r['recordId']}";projections[key]=Decimal(r['amount']);identities[key]=r.get('customerId','')
        events={e['id']:e for e in repo.source_events()}
        for result in repo.source_results():
            if result['effectiveDate']>as_of:continue
            for delta in result['obligationEffects']:
                if delta['key'].startswith('ar:'):projections[delta['key']]=projections.get(delta['key'],ZERO)+Decimal(delta['amount'])
            event=events[result['id']]
            if event['effect']['kind'] in ('BILLING_INVOICE','POS_SALE'):
                identities[f"ar:{event['source']}:{event['recordId']}"]=event['effect'].get('customerId','')
        rows=[{'source':key.split(':',2)[1],'recordId':key.split(':',2)[2],'customerId':identities.get(key,''),
               'outstandingAmount':amount(value),'dueDate':None,'agingBucket':'UNKNOWN'} for key,value in sorted(projections.items()) if value]
        certs=[r for r in repo.report_snapshots('billing-receivables') if r['evidence']['asOf']==as_of]
        proof=certs[-1]['evidence'] if certs else None
        billing_rows=[{**r,'source':'billing','recordId':r['invoiceId'],'agingBucket':bucket(r['dueDate'],date.fromisoformat(as_of))} for r in proof['rows']] if proof else [r for r in rows if r['source']=='billing']
        pos_rows=[r for r in rows if r['source']=='point-of-sale'];combined=billing_rows+pos_rows
        total=lambda data:sum((Decimal(r['outstandingAmount']) for r in data),ZERO)
        entries=repo.entries();billing_control=normal_balance(repo.account(AR),entries,as_of);pos_control=normal_balance(repo.account(POS_AR),entries,as_of)
        pos_complete=self._asof_coverage(repo,as_of).get('registerReceivables',False)
        variance=billing_control-total(billing_rows)
        all_rows_complete=bool(proof and proof['complete'] and pos_complete and not variance and pos_control==total(pos_rows))
        return {'status':'COMPLETE' if all_rows_complete else 'PROVISIONAL',
                'billingStatus':'COMPLETE' if proof and proof['complete'] else 'PROVISIONAL',
                'scope':'BILLING_AUTHORITATIVE_PLUS_FINANCE_REGISTER_AR','snapshotId':proof['snapshotId'] if proof else None,
                'reasonCodes':([] if proof and proof['complete'] else ['BILLING_ASOF_PROVIDER_UNAVAILABLE_OR_INCOMPLETE'])+([] if pos_complete else ['REGISTER_AR_COVERAGE_NOT_CERTIFIED'])+(['BILLING_CONTROL_VARIANCE'] if variance else []),
                'rows':combined,'total':amount(total(combined)),'billingTotal':amount(total(billing_rows)),'posTotal':amount(total(pos_rows)),
                'billingControlBalance':amount(billing_control),'posControlBalance':amount(pos_control),
                'billingReconciliationVariance':amount(billing_control-total(billing_rows)),'posReconciliationVariance':amount(pos_control-total(pos_rows)),
                'aging':{k:amount(sum((Decimal(r['outstandingAmount']) for r in combined if r['agingBucket']==k),ZERO)) for k in ('CURRENT','1_30','31_60','61_90','90_PLUS','UNKNOWN')}}

    def _exceptions_report(self,repo,start,end):
        events={e['id']:e for e in repo.source_events()};rows=[]
        for r in repo.reconciliation_exceptions():
            event=events.get(r['eventId']);day=event['effectiveDate'] if event else r['createdAt'][:10]
            if start<=day<=end:rows.append({k:r[k] for k in ('id','source','eventId','code','status','message','version')})
        return {'status':'COMPLETE','scope':'CURRENT_EXCEPTION_STATUS_FOR_EFFECTIVE_PERIOD','rows':rows,
                'counts':{status:sum(r['status']==status for r in rows) for status in ('OPEN','ACKNOWLEDGED','RESOLVED')},
                'varianceClearingAsOf':amount(normal_balance(repo.account(VARIANCE),repo.entries(),end))}

    def _collections(self,repo,start,end,subscriber_only=False):
        events={e['id']:e for e in repo.source_events()};results={r['id']:r for r in repo.source_results()}
        rows=[];receipts={};total=ZERO;refunds=ZERO
        for r in repo.source_results():
            if not start<=r['effectiveDate']<=end:continue
            if subscriber_only and r['source']!='billing':continue
            collection=Decimal(r['collectionAmount']);refund=Decimal(r['refundAmount'])
            if not collection and not refund:continue
            original=events[r['id']];receipt_id=original['id']
            if original['effect']['kind']=='SOURCE_REVERSAL':
                correction=original['effect'];receipt_id=stable_id(correction['targetSource'],correction['targetEventId'])
                while results.get(receipt_id,{}).get('canonicalSourceId'):receipt_id=results[receipt_id]['canonicalSourceId']
                original=events.get(receipt_id,original)
            customer=original['effect'].get('customerId','')
            receipts.setdefault(receipt_id,{'customer':customer,'source':original['source'],'amount':ZERO})['amount']+=collection
            total+=collection;refunds+=refund
            rows.append({'sourceId':r['id'],'source':r['source'],'recordId':r['recordId'],'customerId':customer,
                         'effectiveDate':r['effectiveDate'],'collectionAmount':r['collectionAmount'],'refundAmount':r['refundAmount'],'journalId':r['journalId']})
        # No-funds corrections cancel the one original receipt, including aliases.
        customers={r['customer'] for r in receipts.values() if r['amount']>ZERO and r['customer']}
        billing_customers={r['customer'] for r in receipts.values() if r['amount']>ZERO and r['customer'] and r['source']=='billing'}
        cert=self._coverage(repo,start,end,self._digest(repo,end));complete=bool(cert.get('collections'))
        return {'status':'COMPLETE' if complete else 'PROVISIONAL','reasonCodes':[] if complete else ['CERTIFIED_CANONICAL_RECEIPT_COVERAGE_REQUIRED'],'basis':'RECEIPT_EFFECTIVE_MONTH',
                'grossCollections':amount(total),'refunds':amount(refunds),'netCollections':amount(total-refunds),
                'customersWhoPaid':len(billing_customers),'uniqueReceiptCustomers':len(customers),'rows':rows,
                'reconciliationVariance':amount(total-sum((Decimal(r['collectionAmount']) for r in rows),ZERO))}

    def _transactions(self,repo,start,end,options):
        offset=options.get('offset',0);limit=options.get('limit',100);account_id=options.get('account_id')
        entries=self._period_entries(repo,start,end)
        if account_id:repo.account(account_id);entries=[e for e in entries if any(l['accountId']==account_id for l in e['lines'])]
        if not 0<=offset or not 1<=limit<=500:raise HTTPException(400,'Invalid report pagination')
        total=sum((Decimal(l['debit']) for e in entries for l in e['lines'] if not account_id or l['accountId']==account_id),ZERO)
        return {'status':'COMPLETE','scope':'POSTED_JOURNALS','items':entries[offset:offset+limit],'totalRows':len(entries),
                'offset':offset,'limit':limit,'totalDebits':amount(total),
                'totalCredits':amount(sum((Decimal(l['credit']) for e in entries for l in e['lines'] if not account_id or l['accountId']==account_id),ZERO))}

    def subscriber_report(self,actor,month,as_of=None):
        self._report_access(actor,True);start,end,cutoff,_=month_window(month,as_of,self.today())
        with self.store.read() as repo:
            from .periods import published
            return published(repo,'subscribers',start.isoformat(),end.isoformat(),cutoff.isoformat(),{}) or self._subscriber_report(repo,start.isoformat(),end.isoformat(),cutoff.isoformat(),month)

    def _subscriber_report(self,repo,start,end,as_of,month):
        from .periods import published
        frozen=published(repo,'subscribers',start,end,as_of,{})
        if frozen:return frozen
        envelope=self._envelope(repo,start,end,as_of,'CERTIFIED_SERVICE_LIFECYCLE_AND_BILLING_RATES')
        eligible=[r for r in repo.report_snapshots('subscribers') if r['evidence']['baselineDate']<=end and r['evidence']['completeThrough']>=end]
        if not eligible:
            data={'status':'UNAVAILABLE','reasonCodes':['DATED_SERVICE_BASELINE_AND_LIFECYCLE_HISTORY_REQUIRED'],
                  'metrics':{name:metric(None,'UNAVAILABLE',['NO_CERTIFIED_HISTORY']) for name in ('openingActiveLines','closingActiveLines','openingActiveCustomers','closingActiveCustomers',
                         'newActivations','reactivations','suspensions','terminations','netLineGrowth','netCustomerGrowth','lineGrowthPercentage','customerGrowthPercentage','monthlyRecurringRevenue')},'events':[],'openingLines':[],'closingLines':[],'monthlyRateRows':[]}
        else:
            earliest=min(r['evidence']['baselineDate'] for r in eligible)
            proof=max((r for r in eligible if r['evidence']['baselineDate']==earliest),key=lambda r:(r['receivedAt'],r['id']))['evidence']
            state,history=self._timeline(proof)
            before={r['serviceAccountId']:dict(r) for r in proof['baseline']};closing=dict(before)
            for h in history:
                day=h['event']['effectiveDate']
                line=h['event']['line']
                if day<start:before[line['serviceAccountId']]=dict(line)
                if day<=end:closing[line['serviceAccountId']]=dict(line)
            window=[h for h in history if start<=h['event']['effectiveDate']<=end]
            opening_known=proof['baselineDate']<start
            lines=lambda s:sum(r['status'] in ACTIVE for r in s.values())
            customers=lambda s:len({r['customerId'] for r in s.values() if r['status'] in ACTIVE})
            count=lambda kind:sum(h['event']['kind']==kind for h in window)
            new=count('ACTIVATION');react=count('REACTIVATION');exits=sum(h['leaving'] for h in window if h['event']['kind']!='MIGRATION_BASELINE')
            adjustment=sum(int(h['entering'])-int(h['leaving']) for h in window if h['event']['kind']=='MIGRATION_BASELINE')
            nl=lines(closing)-lines(before);nc=customers(closing)-customers(before)
            rate_rows=[r for r in closing.values() if r['billable']]
            rates_known=proof['ratesComplete'] and all(r['monthlyRecurringRate'] is not None and r['rateEvidence'] for r in rate_rows)
            metrics={'closingActiveLines':metric(lines(closing)),'closingActiveCustomers':metric(customers(closing)),
                     'monthlyRecurringRevenue':metric(amount(sum((Decimal(r['monthlyRecurringRate']) for r in rate_rows),ZERO)) if rates_known else None,
                        'COMPLETE' if rates_known else 'UNAVAILABLE',() if rates_known else ['DATED_BILLING_RATE_COVERAGE_REQUIRED'])}
            for name,value in {'openingActiveLines':lines(before),'openingActiveCustomers':customers(before),'newActivations':new,'reactivations':react,
                'suspensions':count('SUSPENSION'),'terminations':count('TERMINATION'),'disconnections':count('DISCONNECTION'),
                'activeExits':exits,'migrationBaselineAdjustment':adjustment,'newSubscriberCustomers':sum(h['newCustomer'] for h in window),
                'customerEntries':sum(h['customerEntries'] for h in window),'customerExits':sum(h['customerExits'] for h in window),
                'netLineGrowth':nl,'netCustomerGrowth':nc,'lineGrowthPercentage':percent(nl,lines(before)),
                'customerGrowthPercentage':percent(nc,customers(before))}.items():
                metrics[name]=metric(value if opening_known else None,'NOT_APPLICABLE' if opening_known and value is None else 'COMPLETE' if opening_known else 'UNAVAILABLE',
                                     () if opening_known else ['BASELINE_AFTER_OPENING_BOUNDARY'])
            data={'status':'COMPLETE' if opening_known and rates_known else 'PROVISIONAL','snapshotId':proof['snapshotId'],
                  'coverageStart':proof['baselineDate'],'coverageEnd':proof['completeThrough'],'metrics':metrics,
                  'reasonCodes':[] if opening_known else ['BASELINE_AFTER_OPENING_BOUNDARY'],
                  'lineReconciliationVariance':lines(closing)-lines(before)-new-react+exits-adjustment if opening_known else None,
                  'customerReconciliationVariance':nc-sum(h['customerEntries']-h['customerExits'] for h in window) if opening_known else None,
                  'pendingDisconnectionLines':sum(r['status']=='PENDING_DISCONNECTION' for r in closing.values()),
                  'billableLinesForMRR':len(rate_rows),
                  'openingLines':sorted(before.values(),key=lambda r:r['serviceAccountId']) if opening_known else [],
                  'closingLines':sorted(closing.values(),key=lambda r:r['serviceAccountId']),
                  'monthlyRateRows':sorted(rate_rows,key=lambda r:r['serviceAccountId']),
                  'events':[{**h['event'],'projection':{k:h[k] for k in ('entering','leaving','customerEntries','customerExits','newCustomer')}} for h in window]}
        settlement=self._settlement_report(repo,month,as_of)
        collections=self._collections(repo,start,end,subscriber_only=True)
        payer_known=bool(collections['rows']) or collections['status']=='COMPLETE'
        data['metrics']['customersWhoPaidDuringMonth']=metric(collections['customersWhoPaid'] if payer_known else None,
            collections['status'] if payer_known else 'UNAVAILABLE',() if collections['status']=='COMPLETE' else ['CANONICAL_BILLING_RECEIPT_COVERAGE_REQUIRED'],
            recorded=collections['customersWhoPaid'])
        return {**envelope,**data,'receiptMonth':collections,'billingPeriodSettlement':settlement}

    def _settlement_report(self,repo,month,as_of):
        from .periods import published
        start,end,_,_=month_window(month,date.fromisoformat(as_of),self.today())
        frozen=published(repo,'billing-settlement',start.isoformat(),end.isoformat(),as_of,{})
        if frozen:return frozen
        snapshots=[r for r in repo.report_snapshots('billing-settlement') if r['evidence']['month']==month and r['evidence']['asOf']==as_of]
        if not snapshots:return {'status':'UNAVAILABLE','month':month,'asOf':as_of,'reasonCodes':['CERTIFIED_BILLING_COHORT_PROVIDER_REQUIRED'],
            'customers':None,'full':None,'partial':None,'unpaid':None,'netBilledAmount':None,'cashCollected':None,'accountCreditsApplied':None,'outstandingAmount':None,'rows':[]}
        proof=snapshots[-1]['evidence'];rows=[]
        for r in proof['rows']:
            status='FULL' if Decimal(r['outstandingAmount'])==ZERO else 'PARTIAL' if Decimal(r['cashCollected'])+Decimal(r['accountCreditsApplied'])>ZERO else 'UNPAID'
            rows.append({**r,'settlementStatus':status})
        sums={k:sum((Decimal(r[k]) for r in rows),ZERO) for k in ('netBilledAmount','cashCollected','accountCreditsApplied','rebatesApplied','outstandingAmount')}
        return {'status':'COMPLETE' if proof['complete'] else 'PROVISIONAL','snapshotId':proof['snapshotId'],'month':month,'asOf':as_of,
                'customers':len(rows),**{s.lower():sum(r['settlementStatus']==s for r in rows) for s in ('FULL','PARTIAL','UNPAID')},
                **{k:amount(v) for k,v in sums.items()},'rows':rows,
                'reconciliationVariance':amount(sums['netBilledAmount']-sums['cashCollected']-sums['accountCreditsApplied']-sums['outstandingAmount']),
                'subscriberSettlementRate':percent(sum(r['settlementStatus']=='FULL' for r in rows),len(rows)),
                'subscriberSettlementRateStatus':'COMPLETE' if rows else 'NOT_APPLICABLE',
                'cashCollectionRate':percent(sums['cashCollected'],sums['netBilledAmount']),
                'cashCollectionRateStatus':'COMPLETE' if sums['netBilledAmount'] else 'NOT_APPLICABLE'}

    def comparison(self,actor,kind,month,as_of=None,**options):
        self._report_access(actor,kind=='subscribers');start,end,cutoff,last=month_window(month,as_of,self.today())
        if start.year==1 and start.month==1:raise HTTPException(400,'No prior month available')
        prior_last=start-timedelta(days=1);prior_start=prior_last.replace(day=1)
        mode='COMPLETE_MONTHS' if end==last else 'EQUIVALENT_MONTH_TO_DATE'
        days=min((end-start).days+1,prior_last.day) if mode=='EQUIVALENT_MONTH_TO_DATE' else None
        current_end=start+timedelta(days=days-1) if days else end;prior_end=prior_start+timedelta(days=days-1) if days else prior_last
        with self.store.read() as repo:
            if kind=='subscribers':
                current=self._subscriber_report(repo,start.isoformat(),current_end.isoformat(),current_end.isoformat(),month)
                prior=self._subscriber_report(repo,prior_start.isoformat(),prior_end.isoformat(),prior_end.isoformat(),prior_start.strftime('%Y-%m'))
                values=lambda r:{k:v for k,v in r['metrics'].items()}
            elif kind in ('cash-flow','profit-and-loss','expenses','payables','receivables','collections'):
                current=self._render_financial_report(repo,kind,start.isoformat(),current_end.isoformat(),current_end.isoformat(),options)
                prior=self._render_financial_report(repo,kind,prior_start.isoformat(),prior_end.isoformat(),prior_end.isoformat(),options)
                def values(r):
                    if kind=='profit-and-loss':return r['metrics']
                    if kind=='cash-flow':return {'netCashFlow':metric(r['controlledCash']['netCashFlow'],r['status'])}
                    if kind=='collections':return {k:metric(r[k],r['status']) for k in ('grossCollections','refunds','netCollections','customersWhoPaid')}
                    return {'total':metric(r['total'],r['status'])}
            else:raise HTTPException(400,'Unsupported comparison report kind')
            changes={}
            for name,value in values(current).items():
                previous=values(prior).get(name);v=value['value'];p=previous['value'] if previous else None
                comparable=v is not None and p is not None and value['status']==previous['status'] and value['status'] in ('COMPLETE','PROVISIONAL')
                delta=Decimal(v)-Decimal(p) if comparable else None
                changes[name]={'absoluteChange':amount(delta) if delta is not None else None,
                    'percentageChange':percent(delta,abs(Decimal(p))) if comparable else None,
                    'status':value['status'] if comparable and Decimal(p) else 'NOT_APPLICABLE' if comparable else 'UNAVAILABLE'}
            return {'policyVersion':POLICY,'timeZone':'Asia/Manila','currency':'PHP','comparisonMode':mode,'equivalentDays':days,
                    'percentageFormula':'100 * (current - prior) / abs(prior); prior zero is N/A',
                    'current':current,'prior':prior,'changes':changes}


    def presentation_report(self,actor,kind,month,as_of=None,**options):
        """One authorized snapshot, including every journal for exports/printing."""
        self._report_access(actor,kind in ('subscribers','billing-settlement'))
        start,end,cutoff,_=month_window(month,as_of,self.today())
        with self.store.read() as repo:
            if kind=='subscribers':return self._subscriber_report(repo,start.isoformat(),end.isoformat(),cutoff.isoformat(),month)
            if kind=='billing-settlement':
                return {**self._envelope(repo,start.isoformat(),end.isoformat(),cutoff.isoformat(),'BILLING_MONTH_COHORT'),
                        **self._settlement_report(repo,month,cutoff.isoformat())}
            report=self._render_financial_report(repo,kind,start.isoformat(),end.isoformat(),cutoff.isoformat(),options)
            if kind=='transactions':
                rows=self._period_entries(repo,start.isoformat(),end.isoformat())
                account=options.get('account_id')
                report.update(items=[r for r in rows if not account or any(l['accountId']==account for l in r['lines'])],offset=0)
                report['limit']=len(report['items'])
            return report

    def monthly_series(self,actor,kind,month,as_of=None,months=6,**options):
        self._report_access(actor,kind=='subscribers')
        start,_,cutoff,_=month_window(month,as_of,self.today())
        if not 1<=months<=12:raise HTTPException(400,'Series requires 1 to 12 months')
        periods=[]
        for index in reversed(range(months)):
            number=start.year*12+start.month-1-index
            year,zero_month=divmod(number,12)
            if year<1900:raise HTTPException(400,'Series cannot precede 1900')
            label=f'{year:04d}-{zero_month+1:02d}'
            first,end,_,_=month_window(label,cutoff,self.today())
            # Past-month asOf is month-end; partial final month uses the cutoff.
            periods.append((label,first.isoformat(),end.isoformat()))
        with self.store.read() as repo:
            reports=[]
            for label,first,last in periods:
                report=self._subscriber_report(repo,first,last,last,label) if kind=='subscribers' else self._render_financial_report(repo,kind,first,last,last,options)
                reports.append({'month':label,'report':report})
            return {'kind':kind,'currency':'PHP','timeZone':'Asia/Manila','policyVersion':POLICY,
                    'windowPolicy':'CALENDAR_MONTHS_WITH_FINAL_MONTH_TO_DATE','reports':reports}
