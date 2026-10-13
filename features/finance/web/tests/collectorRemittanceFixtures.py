"""Collector source posting examples for intercepted UI review; private memory only."""
import expenseWorkflowFixtures
from test_finance_income import IncomeTests, RECORDER, HELD, OFFICE


def fixtures():
    data = expenseWorkflowFixtures.fixtures()
    f = IncomeTests(); f.setUp(); s = f.service
    f.cutover(); f.mapping(HELD, f.held); f.mapping(OFFICE, f.cash)
    invoice = f.invoice(amount='1000.00')
    receipt = f.receipt(record='receipt-700', amount='700.00', identity=HELD)
    remainder = f.receipt(record='receipt-300', amount='300.00', identity=HELD)
    assert f.sync('billing', [invoice, receipt, remainder])['checkpointAdvanced']

    def snapshot():
        return {'accounts': s.list_accounts(RECORDER), 'sources': s.sources_view(RECORDER),
                'journals': s.entries(RECORDER),
                'activities': {a['id']: s.activity(RECORDER, a['id']) for a in (f.cash, f.held, f.personal)}}

    before = snapshot()
    remit = f.event('collector', 'remittance-700', 'COLLECTOR_REMITTANCE', leg='CASH',
                   expectedAmount='700.00', actualAmount='700.00',
                   receipts=[{'billingPaymentId': 'receipt-700', 'amount': '700.00'}],
                   fromSettlement=HELD, toSettlement=OFFICE,
                   movementEvidence='Verified partial handover', confirmedBy='source-finance')
    assert f.sync('collector', [remit])['checkpointAdvanced']
    assert f.balance(f.cash['id']) == '700.00' and f.balance(f.held['id']) == '300.00'
    assert f.result(remit)['collectionAmount'] == '0.00'
    after = snapshot()
    final = f.event('collector', 'remittance-300', 'COLLECTOR_REMITTANCE', leg='CASH',
                   expectedAmount='300.00', actualAmount='300.00',
                   receipts=[{'billingPaymentId': 'receipt-300', 'amount': '300.00'}],
                   fromSettlement=HELD, toSettlement=OFFICE,
                   movementEvidence='Verified remaining handover', confirmedBy='source-finance')
    assert f.sync('collector', [final])['checkpointAdvanced']
    assert f.balance(f.cash['id']) == '1000.00' and f.balance(f.held['id']) == '0.00'
    # Income UI also reads the integrated-source status contract; this private
    # in-memory scenario has an active source cutover and no durable queue.
    data['integration/status'] = {'baselineDate': '2026-01-02', 'cutoverActive': True, 'sources': []}
    data['collectorReview'] = {'cashId': f.cash['id'], 'custodyId': f.held['id'],
                               'before': before, 'after': after, 'settled': snapshot()}
    return data
