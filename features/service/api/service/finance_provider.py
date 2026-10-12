"""Service owns the dated census/lifecycle; Billing owns dated rate evidence."""
from copy import deepcopy
from datetime import datetime
from decimal import Decimal

from fastapi import HTTPException
from finance.integration import CaptureProvider, IntegrationStore, BUSINESS_ZONE, business_day
from finance.ledger import fingerprint
from finance.report_schemas import SubscriberEvidence, ACTIVE
from finance.source_adapters import source_money


class ServiceFinanceFeed(CaptureProvider):
    def __init__(self, authorize, store=None):
        super().__init__('service', authorize, store)


def projected_line(row, subscriptions, ever_active, *, previous=None):
    status = row.get('serviceStatus') or row.get('status')
    if row.get('deletedAt'):
        status = 'TERMINATED'
    rates = [r for r in subscriptions.values() if r.get('serviceAccountId') == row['id'] and not r.get('deletedAt')]
    billable = [r for r in rates if r.get('status') == 'ACTIVE']
    if len(billable) > 1:
        raise ValueError('Service line has multiple active Billing subscriptions; cannot certify one MRR rate')
    subscription = billable[0] if billable else rates[0] if len(rates) == 1 else None
    rate = source_money(subscription['monthlyRate']) if subscription and subscription.get('monthlyRate') is not None else None
    return {'serviceAccountId': row['id'], 'customerId': row['customerId'], 'status': status,
            'everActive': ever_active or status in ACTIVE, 'migratedExisting': bool(row.get('migration')),
            'billable': bool(billable), 'monthlyRecurringRate': rate,
            'rateEvidence': f"billing-subscription:{subscription['id']}:capture:{subscription['_financeRateSequence']}" if rate is not None else ''}


class SubscriberFinanceReport:
    def __init__(self, authorize, store=None):
        self.authorize, self.store = authorize, store or IntegrationStore()

    def fetch(self, request):
        self.authorize(request.actor_username)
        with self.store.connection() as conn:
            state = conn.execute('SELECT * FROM finance_integration_state').fetchone()
            baseline_date = state['baseline_date'].isoformat()
            # Freeze the first complete recorded day. Never attest that a partial
            # census taken at noon was the previous midnight's service population.
            if baseline_date >= datetime.now(BUSINESS_ZONE).date().isoformat():
                raise HTTPException(409, 'Dated lifecycle capture started today; the first completed-day baseline is available tomorrow. Earlier growth is unavailable; no snapshot was saved.')
            if request.as_of < baseline_date:
                raise HTTPException(409, 'Requested subscriber period precedes durable lifecycle capture; no snapshot was saved')
            changes = conn.execute("SELECT * FROM finance_source_changes WHERE (source='service' AND record_type='account') OR (source='billing' AND record_type='subscription') ORDER BY sequence").fetchall()
        accounts, subscriptions, lines = {}, {}, {}
        events, historical = [], set()
        baseline = None
        for change in changes:
            day = business_day(change['occurred_at'])
            if day > request.as_of:
                continue
            if baseline is None and day > baseline_date:
                baseline = deepcopy(list(lines.values()))
                historical.update(r['customerId'] for r in baseline if r['everActive'])
            record = deepcopy(change['after_data'] or change['before_data'])
            before = change['before_data'] or {}
            relevant = True
            if change['source'] == 'billing':
                relevant = change['operation'] in ('BASELINE', 'INSERT', 'DELETE') or any(record.get(k) != before.get(k) for k in ('monthlyRate', 'status', 'serviceAccountId', 'deletedAt'))
                if not relevant:
                    continue
                record['_financeRateSequence'] = change['sequence']
                if change['operation'] == 'DELETE':
                    record['deletedAt'] = str(change['occurred_at'])
                subscriptions[change['record_id']] = record
                affected = {record.get('serviceAccountId'), before.get('serviceAccountId')} - {None, ''}
            else:
                relevant = change['operation'] in ('BASELINE', 'INSERT', 'DELETE') or any(record.get(k) != before.get(k) for k in ('serviceStatus', 'status', 'customerId', 'deletedAt', 'migration'))
                if not relevant:
                    continue
                if change['operation'] == 'DELETE':
                    record['deletedAt'] = str(change['occurred_at'])
                accounts[change['record_id']] = record
                affected = {change['record_id']}
            for index, account_id in enumerate(sorted(affected)):
                if account_id not in accounts:
                    continue
                account, old = accounts[account_id], lines.get(account_id)
                ever = old['everActive'] if old else bool(account.get('activationDate') or account.get('migration'))
                new = projected_line(account, subscriptions, ever)
                if old == new:
                    continue
                if day <= baseline_date:
                    lines[account_id] = new
                    continue
                sequence = change['sequence'] * 10 + index * 2
                if old and old['customerId'] != new['customerId']:
                    owned = {**old, 'customerId': new['customerId']}
                    events.append({'eventId': f"lifecycle:{sequence}:ownership", 'sequence': sequence, 'effectiveDate': day, 'source': 'service',
                        'kind': 'OWNERSHIP', 'beforeStatus': old['status'], 'beforeCustomerId': old['customerId'], 'line': owned,
                        'evidenceReference': f"Retained Service ownership change {change['sequence']} recorded at {change['occurred_at']}"})
                    old, sequence = owned, sequence + 1
                entering = new['status'] in ACTIVE and (not old or old['status'] not in ACTIVE)
                leaving = old and old['status'] in ACTIVE and new['status'] not in ACTIVE
                kind = 'RATE' if change['source'] == 'billing' else 'STATUS'
                if kind != 'RATE':
                    if new['migratedExisting'] and not old:
                        kind = 'MIGRATION_BASELINE'
                    elif entering:
                        kind = 'REACTIVATION' if old and old['everActive'] else 'ACTIVATION'
                    elif leaving:
                        kind = 'SUSPENSION' if new['status'] == 'SUSPENDED' else 'TERMINATION' if new['status'] == 'TERMINATED' else 'DISCONNECTION'
                    elif new['status'] == 'TERMINATED' and (not old or old['status'] != 'TERMINATED'):
                        kind = 'TERMINATION'
                events.append({'eventId': f"lifecycle:{sequence}:{kind}", 'sequence': sequence, 'effectiveDate': day,
                    'source': 'billing' if kind == 'RATE' else 'service', 'kind': kind, 'beforeStatus': old['status'] if old else None,
                    'beforeCustomerId': old['customerId'] if old else '', 'line': new,
                    'evidenceReference': f"Retained {change['source']} change {change['sequence']} recorded at {change['occurred_at']}"})
                lines[account_id] = new
        if baseline is None:
            baseline = deepcopy(list(lines.values()))
            historical.update(r['customerId'] for r in baseline if r['everActive'])
        payload = {'kind': 'subscribers', 'baselineDate': baseline_date, 'completeThrough': request.as_of,
                   'evidenceReference': f"End-of-day recorded Service census from {baseline_date}; no earlier historical reconstruction", 'certifiedBy': 'source:service-and-billing',
                   'historicalCustomerIds': sorted(historical), 'baseline': baseline, 'events': events,
                   'ratesComplete': all(r['monthlyRecurringRate'] is not None for r in lines.values())}
        payload['snapshotId'] = fingerprint(payload)
        return SubscriberEvidence.model_validate(payload)
