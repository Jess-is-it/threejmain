"""Generate transaction-history browser responses from the real in-memory API.
Uses private fixtures only; no staging financial or source records are written.
"""
import json
import sys
from datetime import datetime
from zoneinfo import ZoneInfo
from urllib.parse import urlencode
import test_finance_reports as reports
import test_finance_income as income
from finance.schemas import TransferCreate, Reversal
from finance.income_schemas import ReviewAction


def fixtures():
    f = reports.ReportsHttpTests(); f.setUp()
    try:
        r = f.fixture; _, _, _, receipt, _, _ = r.finance_data(); s, x = r.service, r.f
        f.module.service = s
        s.today = lambda: datetime.now(ZoneInfo('Asia/Manila')).date()
        for i in range(28):
            entry = s.transfer(income.RECORDER, TransferCreate(fromAccountId=x.cash['id'], toAccountId=x.wallet['id'],
                amount='1.00', effectiveDate='2026-01-08', sourceReference=f'activity-transfer-{i}',
                reason=f'Office transfer {i:02d}', method='OTHER', referenceNumber=f'Movement slip {i}'), x.key())
        s.reverse(income.RECORDER, entry['id'], Reversal(effectiveDate='2026-01-09', reason='Transfer returned to office'), x.key())
        for classification in ('OWNER_FUNDING', 'LOAN_PROCEEDS'):
            document = x.manual(classification)
            approved = x.review(x.review(document, 'submit', income.RECORDER))
            s.post_manual(income.RECORDER, document['id'], ReviewAction(version=approved['version'], reason='Post reviewed funding'), x.key())
        x.sync('billing', [x.reverse(receipt, 'DUPLICATE_NO_FUNDS')])
        data = {}

        def get(path):
            status, _, body = f.call('GET', '/api/finance/' + path)
            if status != 200:
                raise RuntimeError(f'Fixture request {path}: {status}')
            return json.loads(body)

        for path in ('meta', 'accounts', 'opening-balances', 'journals', 'payables', 'payees', 'categories',
                     'income', 'settlement-mappings', 'cutover-plans', 'sources', 'reconciliation-exceptions'):
            data[path] = get(path)
        for row in data['payables']:
            data['payables/' + row['id']] = get('payables/' + row['id'])
            data['payables/' + row['id'] + '/attachments'] = get('payables/' + row['id'] + '/attachments')
        all_rows = get('activity?limit=100')['items']
        for row in all_rows:
            data['activity/' + row['id']] = get('activity/' + row['id'])
        queries = [{}, {'type': 'TRANSFER', 'limit': '10'}, {'type': 'TRANSFER', 'limit': '10', 'offset': '10'},
                   {'search': 'Owner funding'}, {'search': 'nonexistent'}, {'type': 'CARD_PURCHASE'}, {'type': 'CORRECTION'},
                   {'accountId': x.wallet['id']}, {'fromDate': '2026-01-05', 'throughDate': '2026-01-05'}]
        activity = {}
        for query in queries:
            key = urlencode(sorted(query.items()))
            activity[key] = get('activity?' + key)
        return {'responses': data, 'activity': activity, 'walletId': x.wallet['id']}
    finally:
        f.tearDown()


if __name__ == '__main__':
    with open(sys.argv[1], 'w') as stream:
        json.dump(fixtures(), stream)
