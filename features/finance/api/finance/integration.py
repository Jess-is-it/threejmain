"""Shared PostgreSQL outbox providers and recoverable source delivery.

Only source-owned immutable change images are projected. Current HTTP lists are
never used as a feed. Failures retain their cursor and a durable visible error.
"""
import os
from contextlib import contextmanager
from datetime import date, datetime, timezone
from decimal import Decimal
from threading import Event, Thread
from uuid import uuid4
from zoneinfo import ZoneInfo
from typing import Literal

from fastapi import HTTPException
from pydantic import Field

from .income_schemas import SourceBatch, SourceEvent, Settlement, SyncRequest
from .source_adapters import BillingAdapter, PosAdapter, CollectorAdapter, ServiceAdapter, source_money
from .report_schemas import CoverageEvidence
from .schemas import Model, Reason, Text, json_record
from .ledger import fingerprint
from .storage import psycopg, dict_row, Jsonb

SOURCES = ('billing', 'point-of-sale', 'collector', 'service')
SNAPSHOT = 'finance-capture-v1'
BUSINESS_ZONE = ZoneInfo('Asia/Manila')


class SourceResolution(Model):
    effectiveDate: date
    evidenceReference: Text
    reason: Reason
    disposition: str | None = Field(default=None, pattern='^(REFUND|DUPLICATE_NO_FUNDS|NONCASH_CORRECTION)$')
    settlement: Settlement | None = None
    fromSettlement: Settlement | None = None
    toSettlement: Settlement | None = None
    fromSettlements: dict[Literal['CASH','GCASH'], Settlement] | None = None
    toSettlements: dict[Literal['CASH','GCASH'], Settlement] | None = None
    effectiveDates: dict[Literal['CASH','GCASH'], date] | None = None
    invoiceId: str | None = None


class IntegrationStore:
    def __init__(self, database_url=None):
        self.database_url = database_url if database_url is not None else os.getenv('DATABASE_URL', '')

    @contextmanager
    def connection(self, *, isolation='REPEATABLE READ'):
        if not psycopg or not self.database_url:
            raise HTTPException(503, 'Finance integration PostgreSQL is unavailable')
        if isolation not in ('REPEATABLE READ', 'READ COMMITTED'):
            raise ValueError('Unsupported integration isolation policy')
        with psycopg.connect(self.database_url, row_factory=dict_row) as conn:
            conn.execute('SET TRANSACTION ISOLATION LEVEL '+isolation)
            yield conn

    def delivery(self, source, status, sequence=None, message=''):
        with self.connection() as conn:
            conn.execute('''INSERT INTO finance_source_delivery(source,checked_at,status,sequence,message)
                VALUES(%s,clock_timestamp(),%s,%s,%s) ON CONFLICT(source) DO UPDATE SET
                checked_at=EXCLUDED.checked_at,status=EXCLUDED.status,sequence=EXCLUDED.sequence,message=EXCLUDED.message''',
                         (source, status, sequence, message[:1000]))

    def status(self):
        with self.connection() as conn:
            state = conn.execute('SELECT * FROM finance_integration_state').fetchone()
            active = conn.execute("SELECT data FROM finance_income_documents WHERE kind='CUTOVER' AND status='ACTIVE'").fetchone()
            checkpoints = {r['source']: r['data'] for r in conn.execute('SELECT source,data FROM finance_source_checkpoints')}
            deliveries = {r['source']: r for r in conn.execute('SELECT * FROM finance_source_delivery')}
            result = []
            for source in SOURCES:
                cursor = checkpoints.get(source, {}).get('cursor', '')
                sequence = cursor_number(cursor)
                count = conn.execute('SELECT count(*) AS total FROM finance_source_changes WHERE source=%s AND sequence>%s', (source, sequence)).fetchone()['total']
                result.append({'source': source, 'pendingChanges': count, 'cursor': cursor,
                               'delivery': deliveries.get(source), 'snapshotId': SNAPSHOT})
            return {'baselineDate': state['baseline_date'].isoformat(), 'captureStartedAt': state['captured_at'].isoformat(),
                    'lastSequence': state['last_sequence'], 'cutoverActive': bool(active),
                    'cutoverStartDate': active['data']['startDate'] if active else None,
                    'state': 'RECOVERY_ENABLED' if active else 'AWAITING_REVIEWED_CUTOVER', 'sources': result,
                    'historyPolicy': 'RECORDED_FROM_CAPTURE_BASELINE; earlier lifecycle/cost history unavailable'}

    def period_readiness(self,start,end):
        """Stable committed capture/cursor boundary, never a browser attestation."""
        state=self.status()
        if not state['cutoverActive'] or state['cutoverStartDate']>start or state['baselineDate']>start:
            return {'ready':False,'reason':'A reviewed cutover and capture baseline must cover the full month'}
        if any(row['pendingChanges'] for row in state['sources']):
            return {'ready':False,'reason':'Source recovery has pending changes; complete reconciliation first'}
        return {'ready':True,'baselineDate':state['baselineDate'],'cutoverStartDate':state['cutoverStartDate'],
                'lastSequence':state['lastSequence'],'cursors':{row['source']:row['cursor'] for row in state['sources']}}

    def resolve(self, source, sequence, payload, actor):
        """Called only by the source router after its own edit authorization."""
        data = json_record(payload)
        today = datetime.now(BUSINESS_ZONE).date().isoformat()
        if data['effectiveDate'] > today or any(day > today for day in (data.get('effectiveDates') or {}).values()):
            raise HTTPException(400, 'Source resolution cannot attest future funds movement')
        with self.connection(isolation='READ COMMITTED') as conn:
            # Serialize duplicate attestations and observe the preceding commit.
            row = conn.execute('SELECT * FROM finance_source_changes WHERE sequence=%s FOR UPDATE', (sequence,)).fetchone()
            if not row or row['source'] != source or row['operation'] == 'BASELINE':
                raise HTTPException(404, 'Source change awaiting resolution not found')
            existing = conn.execute('SELECT * FROM finance_source_resolutions WHERE sequence=%s', (sequence,)).fetchone()
            if existing:
                if existing['data'] != data:
                    raise HTTPException(409, 'Source attestation is immutable; conflicting resolution rejected')
                return {'sequence': sequence, 'idempotentReplay': True}
            try:
                effects = CaptureProvider(source, lambda _: None, self).project(row, {'data':data,'authorized_by':actor}, conn)
                if not effects:
                    raise ValueError('Source change has no effect requiring financial attestation')
            except (ValueError, KeyError, TypeError) as exc:
                raise HTTPException(422, f'Source attestation is incomplete or inconsistent: {exc}') from None
            conn.execute('INSERT INTO finance_source_resolutions(sequence,source,authorized_by,data) VALUES(%s,%s,%s,%s)',
                         (sequence, source, actor, Jsonb(data)))
        return {'sequence': sequence, 'authorizedBy': actor, 'state': 'ATTESTED_RETRY_PENDING'}

    def cutover_evidence(self, start_date):
        """Frozen source controls at the prior recorded business-day boundary."""
        start = date.fromisoformat(str(start_date))
        with self.connection() as conn:
            baseline = conn.execute('SELECT baseline_date FROM finance_integration_state').fetchone()['baseline_date']
            if start <= baseline:
                raise HTTPException(409, 'Cutover must follow the first recorded capture day; earlier source balances cannot be certified')
            changes = conn.execute('''SELECT DISTINCT ON (source,record_type,record_id) source,record_type,record_id,after_data
                FROM finance_source_changes WHERE (occurred_at AT TIME ZONE 'Asia/Manila')::date < %s
                ORDER BY source,record_type,record_id,sequence DESC''', (start,)).fetchall()
        records = {(r['source'], r['record_type'], r['record_id']): r['after_data'] for r in changes if r['after_data'] is not None}
        active = lambda row: not row.get('deletedAt') and row.get('status') != 'VOID'
        invoice_rows = {rid: r for (s, t, rid), r in records.items() if s == 'billing' and t == 'invoice' and active(r) and r.get('status') != 'DRAFT'}
        sale_rows = {rid: r for (s, t, rid), r in records.items() if s == 'point-of-sale' and t == 'sale' and active(r) and r.get('status') == 'COMPLETED'}
        ar = {('billing', rid): sum((Decimal(source_money(l['amount'])) for l in r['lineItems']), Decimal('0.00')) for rid, r in invoice_rows.items()}
        ar.update({('point-of-sale', rid): sum((Decimal(source_money(l['amount'])) for l in r['lineItems']), Decimal('0.00')) - Decimal(source_money(r.get('discountAmount', 0))) + Decimal(source_money(r.get('taxAmount', 0))) for rid, r in sale_rows.items()})
        credit_rows = {}
        for (source, typ, rid), row in records.items():
            if not active(row):
                continue
            if source == 'billing' and typ == 'payment' and row.get('status') == 'POSTED' and not row.get('excludedFromCashReports'):
                allocations = row.get('allocations')
                if allocations is None:
                    allocations = [{'invoiceId': row.get('invoiceId'), 'amount': row['amount']}]
                for allocation in allocations:
                    key = ('billing', allocation['invoiceId'])
                    if key not in ar:
                        raise HTTPException(409, 'Cutover receipt allocation references an unavailable invoice')
                    ar[key] -= Decimal(source_money(allocation['amount']))
                advance = Decimal(source_money(row.get('advanceAmount', 0)))
                if advance:
                    credit_rows[('ADVANCE', rid)] = {'customerId': row['customerId'], 'amount': advance}
            elif source == 'billing' and typ == 'adjustment' and row.get('status') == 'POSTED':
                value = Decimal(source_money(row['amount']))
                if row.get('invoiceId'):
                    key = ('billing', row['invoiceId'])
                    if key not in ar:
                        raise HTTPException(409, 'Cutover adjustment references an unavailable invoice')
                    ar[key] += value if row['type'] == 'DEBIT' else -value
                elif row['type'] == 'CREDIT':
                    credit_rows[('REBATE', rid)] = {'customerId': row['customerId'], 'amount': value}
                else:
                    raise HTTPException(409, 'Unattributed customer-credit debit needs source reconciliation before cutover')
            elif source == 'point-of-sale' and typ == 'payment' and row.get('status') == 'POSTED':
                key = ('point-of-sale', row['saleId'])
                if key not in ar:
                    raise HTTPException(409, 'Cutover register payment has no delivered sale')
                ar[key] -= Decimal(source_money(row['amount']))
        for (source, typ, rid), row in records.items():
            if source == 'billing' and typ == 'credit_application' and active(row) and row.get('status') == 'POSTED':
                key = ('billing', row['invoiceId'])
                origin = ('ADVANCE', row['sourcePaymentId']) if row.get('sourcePaymentId') else ('REBATE', row.get('sourceAdjustmentId'))
                if key not in ar or origin not in credit_rows:
                    raise HTTPException(409, 'Cutover applied credit has missing origin or invoice')
                value = Decimal(source_money(row['amount']))
                ar[key] -= value; credit_rows[origin]['amount'] -= value
        if any(v < 0 for v in ar.values()) or any(r['amount'] < 0 for r in credit_rows.values()):
            raise HTTPException(409, 'Source opening controls are negative; reconcile source records first')
        receipts = []
        for (source, typ, rid), row in records.items():
            if source == 'collector' and typ == 'collection' and active(row) and row.get('custodyStatus') != 'SETTLED' and row.get('billingPaymentId'):
                canonical = records.get(('billing','payment',row['billingPaymentId']))
                if not canonical or canonical.get('status') != 'POSTED' or not active(canonical) or source_money(canonical['amount']) != source_money(row['amount']) or canonical['customerId'] != row['customerId']:
                    raise HTTPException(409, 'Opening collector custody does not match its canonical retained Billing receipt')
                receipts.append({'billingPaymentId': row['billingPaymentId'], 'customerId': row['customerId'], 'leg': row['method'],
                    'amount': source_money(row['amount']), 'custodian': row['collectorUsername'], 'accountId': None})
        receivables = [{'owner': owner, 'recordId': rid, 'customerId': (invoice_rows if owner == 'billing' else sale_rows)[rid].get('customerId') or '',
                        'amount': format(value, '.2f'), 'deferredAmount': None if owner == 'billing' else '0.00'} for (owner, rid), value in sorted(ar.items())]
        credits = [{'kind': kind, 'recordId': rid, 'customerId': r['customerId'], 'amount': format(r['amount'], '.2f')} for (kind, rid), r in sorted(credit_rows.items()) if r['amount']]
        return {'startDate': start.isoformat(), 'snapshots': {s: SNAPSHOT for s in SOURCES},
                'receivables': receivables, 'credits': credits, 'custody': receipts,
                'sourceFingerprint': fingerprint({'receivables': receivables, 'credits': credits, 'custody': receipts}),
                'status': 'REVIEW_REQUIRED', 'missingDecisions': ['ACTUAL_NAMED_FUND_OPENINGS', 'DEFERRED_SERVICE_OBLIGATIONS', 'CUSTODY_ACCOUNT_MAPPING'],
                'referenceOnlyMigrationMoney': 'EXCLUDED', 'fundsImportedAgain': False}

    def validate_cutover(self, payload):
        expected = self.cutover_evidence(payload['startDate'])
        if payload['snapshots'] != expected['snapshots']:
            raise HTTPException(409, 'Cutover source snapshot IDs do not match shared capture certification')
        project_ar = lambda rows: sorted((r['owner'], r['recordId'], r.get('customerId', ''), Decimal(r['amount'])) for r in rows)
        project_credits = lambda rows: sorted((r['kind'], r['recordId'], r['customerId'], Decimal(r['amount'])) for r in rows)
        project_custody = lambda rows: sorted((r['billingPaymentId'], r['customerId'], r['leg'], Decimal(r['amount'])) for r in rows)
        if project_ar(payload['receivables']) != project_ar(expected['receivables']) or project_credits(payload['credits']) != project_credits(expected['credits']) or project_custody(payload['custody']) != project_custody(expected['custody']):
            raise HTTPException(409, 'Cutover itemized receivables, credits or custody differ from source evidence; reconcile before activation')
        custody = {r['billingPaymentId']: r for r in expected['custody']}
        with self.connection() as conn:
            for row in payload['custody']:
                account = conn.execute('SELECT kind,data FROM finance_accounts WHERE id=%s', (row['accountId'],)).fetchone()
                if not account or account['data'].get('custodian') != custody[row['billingPaymentId']]['custodian']:
                    raise HTTPException(409, 'Opening custody account custodian differs from source-owned evidence')
        return expected


def cursor_number(cursor):
    if not cursor:
        return 0
    if not cursor.startswith('c:') or not cursor[2:].isdigit():
        raise HTTPException(409, 'Unknown Finance capture cursor')
    return int(cursor[2:])


def business_day(value):
    if not value:
        raise ValueError('Source effective date is missing')
    text = str(value)
    if len(text) == 10:
        return date.fromisoformat(text).isoformat()
    parsed = datetime.fromisoformat(text.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('Source effective timestamp needs a timezone')
    return parsed.astimezone(BUSINESS_ZONE).date().isoformat()


def settlement_for(source, row, resolution):
    if resolution and resolution.get('settlement'):
        return resolution['settlement']
    if row.get('financeSettlement'):
        return row['financeSettlement']
    method = row.get('method')
    channel = 'COLLECTOR' if row.get('collectionChannel') == 'COLLECTOR' else 'POS' if source == 'point-of-sale' or row.get('collectionChannel') == 'POS' else 'OFFICE'
    operator = row.get('collectorUsername') or row.get('postedByUsername') or row.get('cashierUsername')
    # Cash desk / collector wallet identities are stable source-owned usernames.
    # Company noncash accounts require an explicit actual wallet/bank identity.
    if method == 'CASH' and operator:
        institution = f'{channel.lower()}-cash:{operator}'
    elif channel == 'COLLECTOR' and method == 'GCASH' and operator:
        institution = f'collector-wallet:{operator}'
    else:
        raise ValueError('Actual company wallet/bank settlement identity requires source attestation')
    return json_record(Settlement(channel=channel, operator=operator, method=method, institution=institution))


def proof_for(change, day, suffix):
    return {'eventId': f"capture:{change['sequence']}:{suffix}", 'recordVersion': change['sequence'],
            'operationId': f"source-tx:{change['transaction_id']}", 'occurredAt': change['occurred_at'], 'effectiveDate': day}


class CaptureProvider:
    def __init__(self, source, authorize, store=None):
        self.source, self.authorize, self.store = source, authorize, store or IntegrationStore()

    def fetch(self, request):
        self.authorize(request.actor_username)
        if request.source != self.source or request.snapshot_id != SNAPSHOT:
            raise HTTPException(409, 'Unknown certified source capture snapshot')
        sequence = cursor_number(request.cursor)
        failed_sequence = None
        try:
            with self.store.connection() as conn:
                state = conn.execute('SELECT * FROM finance_integration_state').fetchone()
                plan = conn.execute("SELECT data FROM finance_income_documents WHERE kind='CUTOVER' AND status='ACTIVE'").fetchone()
                count = max(1, request.limit // 2) if self.source == 'collector' else request.limit
                rows = conn.execute('SELECT * FROM finance_source_changes WHERE source=%s AND sequence>%s ORDER BY sequence LIMIT %s',
                                    (self.source, sequence, count)).fetchall()
                events = []
                for row in rows:
                    failed_sequence = row['sequence']
                    resolved = conn.execute('SELECT data,authorized_by FROM finance_source_resolutions WHERE sequence=%s', (row['sequence'],)).fetchone()
                    projected = self.project(row, resolved, conn)
                    if plan and business_day(row['occurred_at']) >= plan['data']['startDate'] and any(e.effectiveDate.isoformat() < plan['data']['startDate'] and e.effect.kind not in ('REFERENCE_ONLY', 'SERVICE_INSTALLATION', 'BILLING_RECEIPT_LINK') for e in projected):
                        raise ValueError('Late source posting predates the certified opening boundary; source/opening correction required')
                    events.extend(projected)
                next_seq = rows[-1]['sequence'] if len(rows) == count else state['last_sequence']
                batch = SourceBatch(source=self.source, snapshotId=SNAPSHOT, cursor=request.cursor,
                                    nextCursor=f'c:{next_seq}', completeThrough=f'c:{state["last_sequence"]}',
                                    coverageStart=state['baseline_date'], events=events)
            self.store.delivery(self.source, 'FETCHED', next_seq)
            return batch
        except (ValueError, KeyError, TypeError) as exc:
            self.store.delivery(self.source, 'BLOCKED_SOURCE_EVIDENCE', failed_sequence, str(exc))
            raise HTTPException(503, f'{self.source} change {failed_sequence}: {exc}; source cursor retained, source-owner attestation required') from None

    def project(self, change, resolved, conn):
        if change['operation'] == 'BASELINE':
            return []  # Existing holdings are reviewed cutover controls, never new cash.
        source = self.source
        row, before = change['after_data'] or {}, change['before_data'] or {}
        typ = change['record_type']
        resolution = resolved['data'] if resolved else None
        if change['operation'] == 'DELETE' and typ in ('invoice', 'payment', 'adjustment', 'credit_application', 'sale', 'collection', 'remittance'):
            raise ValueError('Financial source deletion requires retained correction evidence')
        void = (row.get('status') == 'VOID' or row.get('deletedAt')) and before.get('status') != 'VOID' and not before.get('deletedAt')
        if source in ('billing', 'point-of-sale') and typ in ('invoice', 'payment', 'adjustment', 'credit_application', 'sale') and void:
            return [self.reversal(change, resolved, conn)]
        posted = row.get('status') in ('POSTED', 'ISSUED', 'UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'COMPLETED')
        old_posted = before.get('status') in ('POSTED', 'ISSUED', 'UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'COMPLETED')
        if old_posted and source in ('billing', 'point-of-sale') and typ in ('invoice', 'payment', 'adjustment', 'credit_application', 'sale'):
            economic = ('amount', 'allocations', 'advanceAmount', 'lineItems', 'discountAmount', 'taxAmount', 'customerId', 'invoiceId', 'saleId', 'method', 'paymentDate', 'issueDate', 'saleDate')
            if any(row.get(k) != before.get(k) for k in economic):
                raise ValueError('Posted source economic fields changed without a retained reversal/replacement')
            return []
        day_value = (resolution or {}).get('effectiveDate') or row.get('paymentDate') or row.get('saleDate') or row.get('issueDate') or row.get('appliedDate') or row.get('adjustmentDate') or row.get('createdAt') or change['occurred_at']
        day = business_day(day_value)
        proof = proof_for(change, day, typ)
        if source == 'billing' and typ == 'invoice' and posted:
            return [BillingAdapter.invoice(row, proof, invoice_type='LEGACY_OPENING' if row.get('invoiceType') == 'LEGACY_OPENING' else 'INSTALLATION' if row.get('invoiceType') == 'INSTALLATION' else 'SERVICE')]
        if source == 'billing' and typ == 'payment' and posted:
            return [BillingAdapter.receipt(row, proof, settlement=settlement_for(source, row, resolution))]
        if source == 'billing' and typ == 'adjustment' and posted:
            return [BillingAdapter.adjustment(row, proof, recognition_basis='DEFERRED', attribution_invoice_id=(resolution or {}).get('invoiceId'))]
        if source == 'billing' and typ == 'credit_application' and posted:
            return [BillingAdapter.credit_application(row, proof)]
        if source == 'billing' and typ == 'migration_evidence' and row.get('status') == 'REFERENCE_ONLY':
            return [BillingAdapter.migration_evidence(row, proof)]
        if source == 'point-of-sale' and typ == 'sale' and posted:
            return [PosAdapter.sale(row, proof, delivery_evidence=f"POS completed checkout {row['id']}; inventory movements {','.join(row.get('inventoryMovementIds') or [])}")]
        if source == 'point-of-sale' and typ == 'payment' and posted:
            return [PosAdapter.receipt(row, proof, settlement=settlement_for(source, row, resolution))]
        if source == 'point-of-sale' and typ == 'invoice_sms' and row.get('billingPaymentId') and not before.get('billingPaymentId'):
            return [PosAdapter.invoice_collection(row, proof)]
        if source == 'collector' and typ == 'collection' and row.get('billingPaymentId') and not before.get('billingPaymentId'):
            return [CollectorAdapter.collection(row, proof)]
        if source == 'collector' and typ == 'remittance' and row.get('status') == 'CLOSED' and before.get('status') != 'CLOSED':
            if not resolution:
                raise ValueError('Collector confirmation needs actual funds date, receiving account and movement attestation')
            receipts = []
            for cid in row['collectionIds']:
                record = conn.execute("SELECT after_data FROM finance_source_changes WHERE source='collector' AND record_type='collection' AND record_id=%s AND sequence<=%s ORDER BY sequence DESC LIMIT 1", (cid, change['sequence'])).fetchone()
                if not record:
                    raise ValueError('Remittance linked receipt evidence missing')
                receipts.append(record['after_data'])
            effects = []
            for leg in ('CASH', 'GCASH'):
                if Decimal(source_money(row.get('expectedCash' if leg == 'CASH' else 'expectedGcash', 0))) <= 0:
                    continue
                origin = (resolution.get('fromSettlements') or {}).get(leg) or resolution.get('fromSettlement')
                destination = (resolution.get('toSettlements') or {}).get(leg) or resolution.get('toSettlement')
                if not origin or origin['method'] != leg or not destination:
                    raise ValueError(f'Actual {leg} custody and receiving account identities are required separately')
                subset = [r for r in receipts if r.get('method') == leg]
                actual_date = (resolution.get('effectiveDates') or {}).get(leg) or resolution['effectiveDate']
                effects.append(CollectorAdapter.remittance(row, proof_for(change, actual_date, f'remittance-{leg}'), leg=leg, receipts=subset,
                    from_settlement=origin, to_settlement=destination, movement_evidence=resolution['evidenceReference']))
            return effects
        if source == 'service' and typ == 'order' and row.get('orderType') == 'INSTALLATION' and row.get('status') == 'COMPLETED' and before.get('status') != 'COMPLETED':
            return [ServiceAdapter.installation(row, proof, billing_invoice_id=row.get('billingInvoiceId') or '', evidence_reference=f"service-order:{row['id']}")]
        return []

    def reversal(self, change, resolved, conn):
        row = change['after_data']
        original = conn.execute('''SELECT * FROM finance_source_changes WHERE source=%s AND record_type=%s AND record_id=%s
            AND sequence<%s AND operation<>'BASELINE' AND (before_data IS NULL OR before_data->>'status'='DRAFT')
            ORDER BY sequence LIMIT 1''', (self.source, change['record_type'], change['record_id'], change['sequence'])).fetchone()
        if not original:
            raise ValueError('Pre-capture/opening reversal entitlement needs a reviewed opening correction contract')
        typ = change['record_type']
        if typ == 'payment':
            if not resolved or not resolved['data'].get('disposition'):
                raise ValueError('Receipt void needs source-owned refund or duplicate/no-funds attestation')
            data = resolved['data']
            disposition = data['disposition']
            day = data['effectiveDate']
            actor = resolved['authorized_by']
        else:
            data = {'evidenceReference': f"source-void:{change['sequence']}", 'reason': row.get('voidReason') or 'Retained source-owned void'}
            disposition, day = 'NONCASH_CORRECTION', business_day(row.get('voidedAt') or change['occurred_at'])
            actor = row.get('voidedByUsername') or change['actor']
        effect = {'kind': 'SOURCE_REVERSAL', 'targetSource': self.source,
                  'targetEventId': f"capture:{original['sequence']}:{typ}", 'disposition': disposition,
                  'evidenceReference': data['evidenceReference'], 'authorizedBy': actor, 'reason': data['reason'],
                  'refundSettlement': data.get('settlement')}
        return SourceEvent(source=self.source, recordId=change['record_id'], effect=effect, **proof_for(change, day, f'{typ}-reversal'))


class CoverageProvider:
    def __init__(self, authorize):
        self.authorize = authorize

    def fetch(self, request):
        self.authorize(request.actor_username)
        # Provider presence does not certify missing historical valuation,
        # recognition, payroll, depreciation, financing or tax evidence.
        payload = {'kind': 'financial-coverage', 'startDate': request.start_date, 'endDate': request.end_date,
                   'ledgerFingerprint': request.ledger_fingerprint, 'policyVersion': 'finance-management-v1',
                   'evidenceReference': 'Shared Finance integration; unsupported coverage remains false', 'certifiedBy': 'system:finance-coverage'}
        payload['snapshotId'] = fingerprint(payload)
        return CoverageEvidence.model_validate(payload)


class RecoveryWorker:
    def __init__(self, service, actor, store=None, audit_logger=None):
        self.service, self.actor = service, actor
        self.store, self.audit_logger = store or IntegrationStore(), audit_logger
        self.stop_event, self.thread = Event(), None

    def recover(self):
        result = {}
        state = self.store.status()
        if not state['cutoverActive']:
            return {'state': state['state'], 'sources': result}
        # Repeated passes resolve aliases/credits whose canonical effects arrived
        # in another page; failed pages remain durable and visible.
        for source in SOURCES:
            pending = next(r['pendingChanges'] for r in state['sources'] if r['source'] == source)
            if not pending:
                result[source] = {'status': 'CAUGHT_UP'}
                continue
            try:
                r = self.service.sync(self.actor, source, SyncRequest(limit=100), f'worker:{uuid4()}')
                result[source] = r
                self.store.delivery(source, 'POSTED' if not r['blocked'] else 'BLOCKED_FINANCE_POSTING', cursor_number(r['cursor']),
                                    '' if not r['blocked'] else f"{r['blocked']} unresolved Finance effects; review reconciliation exceptions")
            except HTTPException as exc:
                result[source] = {'status': 'BLOCKED', 'reason': str(exc.detail)}
                if exc.status_code != 503:
                    self.store.delivery(source, 'BLOCKED_FINANCE_POSTING', message=str(exc.detail))
        return {'state': 'RECOVERY_ATTEMPTED', 'sources': result}

    def deliver_audit(self):
        if not self.audit_logger:
            return
        with self.store.connection() as conn:
            # Shared Logs is a bounded display mirror. Durable Finance events
            # remain authoritative, including private attachment attribution.
            for row in conn.execute('''SELECT a.* FROM finance_audit_events a LEFT JOIN finance_shared_audit_delivery d ON d.event_id=a.id
                WHERE d.event_id IS NULL ORDER BY a.created_at,a.id LIMIT 100 FOR UPDATE OF a SKIP LOCKED''').fetchall():
                self.audit_logger(row['action'], 'Finance', row['target_id'], {'financeAuditId': row['id']}, row['actor'])
                conn.execute('INSERT INTO finance_shared_audit_delivery(event_id) VALUES(%s) ON CONFLICT DO NOTHING', (row['id'],))

    def start(self):
        if self.thread and self.thread.is_alive():
            return
        self.stop_event.clear()
        def run():
            while not self.stop_event.is_set():
                try:
                    self.recover()
                    self.deliver_audit()
                except Exception:
                    import logging
                    logging.getLogger(__name__).exception('Finance recovery failed; durable source evidence retained')
                self.stop_event.wait(30)
        self.thread = Thread(target=run, daemon=True, name='finance-recovery')
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=5)
