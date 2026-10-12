"""Explicit isolated-test store. Never selected automatically by the runtime."""
from contextlib import contextmanager
from copy import deepcopy
from threading import RLock

from fastapi import HTTPException
from .income_controls import INCOME_CONTROLS

EQUITY_ID = 'finance-opening-equity'
PAYABLE_CONTROL_ID = 'finance-payable-control'
CONTROL_IDS = frozenset({EQUITY_ID, PAYABLE_CONTROL_ID, *INCOME_CONTROLS})
EQUITY_ACCOUNT = {
    'id': EQUITY_ID, 'code': 'OPENING_EQUITY', 'name': 'Opening balance equity control',
    'kind': 'GENERAL_LEDGER', 'glType': 'EQUITY', 'normalSide': 'CREDIT',
    'currency': 'PHP', 'controlledCash': False, 'system': True,
    'active': True, 'version': 1, 'custodian': '', 'notes': '',
    'createdBy': 'migration', 'createdAt': '2026-10-12T00:00:00+00:00',
    'updatedBy': 'migration', 'updatedAt': '2026-10-12T00:00:00+00:00',
    'archivedAt': None,
}


class MemoryRepository:
    def __init__(self, state):
        self.state = state

    @contextmanager
    def savepoint(self):
        saved=deepcopy(self.state)
        try:yield self
        except Exception:
            self.state.clear();self.state.update(saved)
            raise

    def accounts(self):
        return deepcopy(list(self.state['accounts'].values()))

    def account(self, account_id):
        if account_id not in self.state['accounts']:
            raise HTTPException(404, 'Financial account not found')
        return deepcopy(self.state['accounts'][account_id])

    def save_account(self, record):
        self.state['accounts'][record['id']] = deepcopy(record)

    def entries(self):
        return deepcopy(list(self.state['entries'].values()))

    def entry(self, entry_id):
        if entry_id not in self.state['entries']:
            raise HTTPException(404, 'Journal entry not found')
        return deepcopy(self.state['entries'][entry_id])

    def insert_entry(self, record):
        # No public update/delete operation exists for a posted entry.
        if record['id'] in self.state['entries']:
            raise HTTPException(409, 'Journal entry already exists')
        self.state['sequence'] += 1
        record = {**record, 'number': self.state['sequence']}
        self.state['entries'][record['id']] = deepcopy(record)
        return deepcopy(record)

    def openings(self):
        return deepcopy(list(self.state['openings'].values()))

    def opening(self, opening_id):
        if opening_id not in self.state['openings']:
            raise HTTPException(404, 'Opening balance request not found')
        return deepcopy(self.state['openings'][opening_id])

    def save_opening(self, record):
        self.state['openings'][record['id']] = deepcopy(record)

    def operation(self, scope, key):
        return deepcopy(self.state['operations'].get((scope, key)))

    def save_operation(self, scope, key, fingerprint, result):
        self.state['operations'][(scope, key)] = {'fingerprint': fingerprint, 'result': deepcopy(result)}

    def audit(self, event):
        self.state['audits'].append(deepcopy(event))

    def periods(self):
        return deepcopy(list(self.state['periods'].values()))

    def period(self, month):
        return deepcopy(self.state['periods'].get(month))

    def save_period(self, record):
        self.state['periods'][record['month']] = deepcopy(record)

    def period_event(self, event):
        self.state['periodEvents'].append(deepcopy(event))

    def period_events(self, month):
        return deepcopy([r for r in self.state['periodEvents'] if r['month']==month])

    def masters(self, kind):
        return deepcopy(list(self.state[kind].values()))

    def master(self, kind, record_id):
        if record_id not in self.state[kind]:
            raise HTTPException(404, 'Payee or category not found')
        return deepcopy(self.state[kind][record_id])

    def save_master(self, kind, record):
        self.state[kind][record['id']] = deepcopy(record)

    def payables(self):
        return deepcopy(list(self.state['payables'].values()))

    def payable(self, record_id):
        if record_id not in self.state['payables']:
            raise HTTPException(404, 'Expense/payable not found')
        return deepcopy(self.state['payables'][record_id])

    def save_payable(self, record):
        if record['id'] not in self.state['payables']:
            self.state['payableSequence'] += 1
            record['number'] = self.state['payableSequence']
        self.state['payables'][record['id']] = deepcopy(record)
        return record

    def payments(self, payable_id):
        return deepcopy([r for r in self.state['payments'].values() if r['payableId'] == payable_id])

    def payment(self, payment_id):
        if payment_id not in self.state['payments']:
            raise HTTPException(404, 'Payable payment not found')
        return deepcopy(self.state['payments'][payment_id])

    def insert_payment(self, record):
        self.state['payments'][record['id']] = deepcopy(record)

    def decision(self, record):
        self.state['decisions'].append(deepcopy(record))

    def decisions(self, payable_id):
        return deepcopy([r for r in self.state['decisions'] if r['payableId'] == payable_id])

    def attachments(self, payable_id):
        return deepcopy([r[0] for r in self.state['attachments'].values() if r[0]['payableId'] == payable_id])

    def attachment(self, attachment_id):
        if attachment_id not in self.state['attachments']:
            raise HTTPException(404, 'Supporting attachment not found')
        return deepcopy(self.state['attachments'][attachment_id])

    def save_attachment(self, record, content=None):
        if content is None:
            content = self.state['attachments'][record['id']][1]
        self.state['attachments'][record['id']] = (deepcopy(record),content)

    def income_documents(self, kind=None):
        return deepcopy([r for r in self.state['incomeDocuments'].values() if kind is None or r['documentKind']==kind])

    def income_document(self, record_id):
        if record_id not in self.state['incomeDocuments']:
            raise HTTPException(404,'Income document, mapping or cutover plan not found')
        return deepcopy(self.state['incomeDocuments'][record_id])

    def save_income_document(self,r):
        self.state['incomeDocuments'][r['id']]=deepcopy(r)

    def source_events(self):
        return deepcopy(list(self.state['sourceEvents'].values()))

    def source_event(self,record_id):
        if record_id not in self.state['sourceEvents']:raise HTTPException(404,'Source event not found')
        return deepcopy(self.state['sourceEvents'][record_id])

    def insert_source_event(self,r):
        self.state['sourceEvents'][r['id']]=deepcopy(r)

    def source_result(self,record_id):
        return deepcopy(self.state['sourceResults'].get(record_id))

    def source_results(self):
        return deepcopy(list(self.state['sourceResults'].values()))

    def insert_source_result(self,r):
        if r['id'] in self.state['sourceResults']:raise HTTPException(409,'Source event already finalized')
        self.state['sourceResults'][r['id']]=deepcopy(r)

    def source_claim(self,key):
        return self.state['sourceClaims'].get(key)

    def insert_source_claim(self,key,event_id):
        if key in self.state['sourceClaims']:raise HTTPException(409,'Source effect already claimed')
        self.state['sourceClaims'][key]=event_id

    def checkpoint(self,source):
        return deepcopy(self.state['sourceCheckpoints'].get(source))

    def save_checkpoint(self,r):
        self.state['sourceCheckpoints'][r['source']]=deepcopy(r)

    def reconciliation_exceptions(self):
        return deepcopy(list(self.state['reconciliationExceptions'].values()))

    def save_reconciliation_exception(self,r):
        self.state['reconciliationExceptions'][r['id']]=deepcopy(r)

    def report_snapshots(self,kind=None):
        return deepcopy([r for r in self.state['reportSnapshots'].values() if kind is None or r['kind']==kind])

    def insert_report_snapshot(self,r):
        if r['id'] in self.state['reportSnapshots']:raise HTTPException(409,'Report snapshot already exists')
        self.state['reportSnapshots'][r['id']]=deepcopy(r)


class MemoryStore:
    mode = 'memory-test'

    def __init__(self):
        self._lock = RLock()
        self._state = {
            'accounts': {EQUITY_ID: deepcopy(EQUITY_ACCOUNT),
                         PAYABLE_CONTROL_ID: {**deepcopy(EQUITY_ACCOUNT),'id':PAYABLE_CONTROL_ID,
                           'code':'PAYABLE_CONTROL','name':'Supplier and employee payables control','glType':'LIABILITY'}}, 'entries': {},
            'openings': {}, 'operations': {}, 'audits': [], 'sequence': 0,
            'payee': {}, 'category': {}, 'payables': {}, 'payments': {},
            'attachments': {}, 'decisions': [], 'payableSequence': 0,
            'incomeDocuments':{},'sourceEvents':{},'sourceResults':{},'sourceClaims':{},
            'sourceCheckpoints':{},'reconciliationExceptions':{},'reportSnapshots':{},
            'periods':{},'periodEvents':[],
        }
        for account_id,(code,name,gl_type) in INCOME_CONTROLS.items():
            self._state['accounts'][account_id]={**deepcopy(EQUITY_ACCOUNT),'id':account_id,'code':code,'name':name,
                'glType':gl_type,'normalSide':'CREDIT' if gl_type in ('LIABILITY','REVENUE') else 'DEBIT'}

    @contextmanager
    def transaction(self):
        with self._lock:
            candidate = deepcopy(self._state)
            yield MemoryRepository(candidate)
            self._state = candidate

    @contextmanager
    def read(self):
        with self._lock:
            yield MemoryRepository(deepcopy(self._state))

    def readiness(self):
        return {'mode': self.mode, 'ready': True, 'realDataReady': False, 'reason': 'Explicit isolated-test storage only'}
