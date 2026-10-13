"""Read-only money movement projection of the existing immutable journal.

One row per journal, never one row per debit/credit or source alias. Accruals
without financial-account movement are intentionally absent. Journal scope
includes linked expense/source permissions; filtering never broadens access.
"""
from decimal import Decimal

from fastapi import HTTPException

ZERO = Decimal('0.00')
TYPES = ('MONEY_IN', 'MONEY_OUT', 'TRANSFER', 'CARD_PURCHASE', 'CARD_CREDIT', 'OPENING', 'CORRECTION')


def require_activity(actor):
    for permission in ('finance.view', 'finance.accounts.view', 'finance.journals.view'):
        actor.require(permission)


def _project(repo, entry, corrections):
    totals, snapshots = {}, {}
    for line in entry['lines']:
        if line['accountSnapshot']['kind'] == 'GENERAL_LEDGER':
            continue
        account_id = line['accountId']
        snapshots[account_id] = line['accountSnapshot']
        totals[account_id] = totals.get(account_id, ZERO) + Decimal(line['debit']) - Decimal(line['credit'])
    movements = [{'id': account_id, **snapshots[account_id], 'movement': format(delta, '.2f')}
                 for account_id, delta in totals.items() if delta]
    if not movements:
        return None
    incoming = [a for a in movements if Decimal(a['movement']) > ZERO]
    outgoing = [a for a in movements if Decimal(a['movement']) < ZERO]
    received = sum((Decimal(a['movement']) for a in incoming), ZERO)
    sent = -sum((Decimal(a['movement']) for a in outgoing), ZERO)
    metadata = entry['metadata']
    original_id = entry['reversalOfId'] or metadata.get('sourceCorrectionOfEntryId')
    opening = entry['kind'] == 'OPENING' or metadata.get('originalKind') == 'OPENING'
    if opening:
        kind, label = 'OPENING', 'Opening balance correction' if original_id else 'Opening balance'
    elif incoming and outgoing:
        if all(a['kind'] == 'CREDIT_CARD' for a in outgoing) and all(a['kind'] != 'CREDIT_CARD' for a in incoming):
            kind, label = 'MONEY_IN', 'Credit-card funding'
        elif all(a['kind'] == 'CREDIT_CARD' for a in incoming) and all(a['kind'] != 'CREDIT_CARD' for a in outgoing):
            kind, label = 'MONEY_OUT', 'Credit-card repayment'
        else:
            kind, label = 'TRANSFER', 'Collector remittance' if metadata.get('effect') == 'COLLECTOR_REMITTANCE' else 'Internal transfer'
    elif outgoing:
        kind, label = ('CARD_PURCHASE', 'Credit-card purchase') if all(a['kind'] == 'CREDIT_CARD' for a in outgoing) else ('MONEY_OUT', 'Money out')
    else:
        kind, label = ('CARD_CREDIT', 'Credit-card credit') if all(a['kind'] == 'CREDIT_CARD' for a in incoming) else ('MONEY_IN', 'Money in')

    counterparty, support = 'External party', {'kind': 'JOURNAL', 'id': entry['id']}
    reference = metadata.get('referenceNumber') or entry['sourceReference']
    if metadata.get('payableId'):
        payable = repo.payable(metadata['payableId'])
        counterparty = payable['payeeSnapshot']['name']
        reference = metadata.get('referenceNumber') or payable['documentReference']
        support = {'kind': 'PAYABLE', 'id': payable['id'], 'documentReference': payable['documentReference'],
                   'evidenceReference': payable['evidenceReference'], 'purpose': payable['purpose'],
                   'payee': counterparty, 'category': payable['categorySnapshot']['name']}
        if kind == 'MONEY_OUT':
            label = 'Supplier payment'
    elif metadata.get('manualIncomeId'):
        document = repo.income_document(metadata['manualIncomeId'])
        counterparty, reference = document['payerName'], document['documentReference']
        labels = {'OTHER_INCOME': 'Other income', 'LOAN_PROCEEDS': 'Loan proceeds',
                  'OWNER_FUNDING': 'Owner funding', 'OWNER_LOAN': 'Owner loan'}
        label = labels[document['classification']]
        support = {key: document[key] for key in ('id', 'documentReference', 'classification', 'payerName', 'purpose', 'evidenceReference')}
        support['kind'] = 'MANUAL_INCOME'
    elif metadata.get('incomeSourceId'):
        event = repo.source_event(metadata['incomeSourceId'])
        effect = event['effect']
        support = {'kind': 'SOURCE', 'id': event['id'], 'source': event['source'],
                   'recordId': event['recordId'], 'evidenceReference': event.get('evidenceReference', ''),
                   'effect': effect}
        reference = effect.get('referenceNumber') or event['recordId']
        if effect['kind'] == 'BILLING_RECEIPT':
            counterparty = 'Subscriber'
            label = 'Subscriber payment + advance' if Decimal(effect['advanceAmount']) and effect['allocations'] else 'Customer advance' if Decimal(effect['advanceAmount']) else 'Subscriber payment'
        elif effect['kind'] == 'POS_RECEIPT':
            counterparty, label = 'POS customer', 'POS payment'
        elif metadata.get('disposition') == 'REFUND':
            counterparty, label = 'Customer', 'Customer refund'
    if original_id and label != 'Customer refund' and not opening:
        label = f'{label} correction'
    if metadata.get('disposition') == 'DUPLICATE_NO_FUNDS':
        kind, label, counterparty = 'CORRECTION', 'Duplicate receipt correction (no money moved)', 'Duplicate entry correction'
    if opening:
        counterparty = 'Opening balance'
    return {'id': entry['id'], 'number': entry['number'], 'effectiveDate': entry['effectiveDate'],
            'postedAt': entry['postedAt'], 'postedBy': entry['postedBy'], 'type': kind, 'label': label,
            'description': entry['reason'], 'reference': reference,
            'amount': format(received if incoming else sent, '.2f'),
            'incomingAmount': format(received, '.2f'), 'outgoingAmount': format(sent, '.2f'),
            'from': outgoing, 'to': incoming, 'counterparty': counterparty,
            'status': 'CORRECTION' if original_id else 'CORRECTED' if entry['id'] in corrections else 'POSTED',
            'correctionOfId': original_id, 'correctedByIds': corrections.get(entry['id'], []),
            'supportingRecord': support}


def _visible(service, repo, actor):
    entries = repo.entries()
    allowed = []
    for entry in entries:
        try:
            service._entry_scope(repo, actor, entry)
        except HTTPException as exc:
            if exc.status_code == 403:
                continue
            raise
        allowed.append(entry)
    corrections = {}
    for entry in allowed:
        original = entry['reversalOfId'] or entry['metadata'].get('sourceCorrectionOfEntryId')
        if original:
            corrections.setdefault(original, []).append(entry['id'])
    return allowed, corrections


def transaction_history(service, actor, *, from_date=None, through_date=None, account_id=None,
                        activity_type=None, search='', offset=0, limit=25):
    require_activity(actor)
    through = service._day(through_date or service.today())
    start = from_date.isoformat() if from_date else None
    if start and start > through:
        raise HTTPException(400, 'From date must be on or before through date')
    if activity_type is not None and activity_type not in TYPES:
        raise HTTPException(400, 'Unknown activity type')
    if offset < 0 or not 1 <= limit <= 100:
        raise HTTPException(400, 'Invalid activity pagination')
    if account_id:
        actor.account(account_id)
    with service.store.read() as repo:
        accounts = [{'id': a['id'], 'name': a['name'], 'kind': a['kind'], 'active': a['active']}
                    for a in repo.accounts() if a['kind'] != 'GENERAL_LEDGER'
                    and (actor.account_ids is None or a['id'] in actor.account_ids)]
        if account_id and account_id not in {a['id'] for a in accounts}:
            raise HTTPException(404, 'Financial account not found')
        entries, corrections = _visible(service, repo, actor)
        rows = []
        needle = search.strip().casefold()
        for entry in sorted(entries, key=lambda e: (e['effectiveDate'], e['number']), reverse=True):
            if entry['effectiveDate'] > through or start and entry['effectiveDate'] < start:
                continue
            row = _project(repo, entry, corrections)
            if row is None or activity_type and row['type'] != activity_type:
                continue
            if account_id and account_id not in {a['id'] for a in row['from'] + row['to']}:
                continue
            haystack = ' '.join(str(row[k]) for k in ('number', 'label', 'description', 'reference', 'postedBy', 'counterparty'))
            haystack += ' ' + ' '.join(a['name'] + ' ' + a['code'] for a in row['from'] + row['to'])
            if needle and needle not in haystack.casefold():
                continue
            rows.append(row)
        return {'items': rows[offset:offset + limit], 'total': len(rows), 'offset': offset, 'limit': limit,
                'accounts': accounts, 'fromDate': start, 'throughDate': through,
                'basis': 'POSTED_JOURNAL_MOVEMENTS', 'currency': 'PHP', 'timeZone': 'Asia/Manila'}


def transaction_detail(service, actor, entry_id):
    require_activity(actor)
    with service.store.read() as repo:
        entry = repo.entry(entry_id)
        service._entry_scope(repo, actor, entry)
        _, corrections = _visible(service, repo, actor)
        row = _project(repo, entry, corrections)
        if row is None:
            raise HTTPException(404, 'Journal has no financial-account movement')
        return {**row, 'journal': entry, 'currency': 'PHP', 'timeZone': 'Asia/Manila'}
