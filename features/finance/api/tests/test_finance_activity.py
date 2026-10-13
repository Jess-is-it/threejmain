"""Transaction-history ties, source deduplication, card debt and scope boundaries."""
import json
import unittest
from datetime import date
from decimal import Decimal

import test_finance_reports as reports
import test_finance_income as income
import test_finance_payables as expenses
from finance.activity import transaction_history, transaction_detail
from finance.permissions import Actor, PERMISSIONS
from finance.schemas import TransferCreate, Reversal, AccountEdit, AccountAction
from finance.income_schemas import ReviewAction

A = income.RECORDER


class ActivityTests(unittest.TestCase):
    def setUp(self):
        self.r = reports.ReportsTests(); self.r.setUp()
        self.s, self.f, self.e = self.r.service, self.r.f, self.r.e

    def history(self, actor=A, **filters):
        return transaction_history(self.s, actor, **filters)

    def transfer(self, amount='50.00', **changes):
        payload = {'fromAccountId': self.f.cash['id'], 'toAccountId': self.f.wallet['id'], 'amount': amount,
                   'effectiveDate': '2026-01-03', 'sourceReference': 'transfer-history', 'reason': 'Move office funds',
                   'method': 'GCASH_TRANSFER', 'referenceNumber': 'Transfer slip', **changes}
        return self.s.transfer(A, TransferCreate(**payload), self.f.key())

    def test_posted_movements_tie_to_journal_and_do_not_repeat_accruals(self):
        self.r.finance_data()
        result = self.history()
        self.assertEqual(result['total'], 7)
        self.assertEqual(sum(Decimal(r['amount']) for r in result['items'] if r['type'] == 'MONEY_IN'), Decimal('232.00'))
        self.assertEqual(sum(Decimal(r['amount']) for r in result['items'] if r['type'] == 'MONEY_OUT'), Decimal('50.00'))
        card = next(r for r in result['items'] if r['type'] == 'CARD_PURCHASE')
        self.assertEqual(card['amount'], '20.00')
        self.assertEqual(card['supportingRecord']['kind'], 'PAYABLE')
        receipt = next(r for r in result['items'] if r['label'] == 'Subscriber payment + advance')
        self.assertEqual(receipt['supportingRecord']['effect']['advanceAmount'], '20.00')
        self.e.draft(amount='999.00')
        self.assertEqual(self.history()['total'], 7)
        for row in result['items']:
            journal = transaction_detail(self.s, A, row['id'])['journal']
            cash_delta = sum((Decimal(l['debit']) - Decimal(l['credit']) for l in journal['lines']
                              if l['accountSnapshot']['kind'] in ('CASH', 'COMPANY_GCASH')), Decimal('0.00'))
            projected = sum((Decimal(a['movement']) for a in row['from'] + row['to']
                             if a['kind'] in ('CASH', 'COMPANY_GCASH')), Decimal('0.00'))
            self.assertEqual(cash_delta, projected)

    def test_transfer_is_one_row_on_both_accounts_replay_and_correction_retained(self):
        self.f.opening(self.f.cash, '100.00')
        entry = self.transfer()
        self.assertEqual(self.transfer()['id'], entry['id'])
        self.assertEqual(self.history(activity_type='TRANSFER')['total'], 1)
        for account in (self.f.cash, self.f.wallet):
            rows = self.history(account_id=account['id'], activity_type='TRANSFER')['items']
            self.assertEqual([row['id'] for row in rows], [entry['id']])
            self.assertEqual(rows[0]['amount'], '50.00')
        reverse = self.s.reverse(A, entry['id'], Reversal(effectiveDate='2026-01-04', reason='Actual transfer returned'), self.f.key())
        original = transaction_detail(self.s, A, entry['id'])
        correction = transaction_detail(self.s, A, reverse['id'])
        self.assertEqual(original['status'], 'CORRECTED')
        self.assertEqual(original['correctedByIds'], [reverse['id']])
        self.assertEqual(correction['correctionOfId'], entry['id'])
        self.assertEqual(correction['from'][0]['id'], self.f.wallet['id'])
        self.assertEqual(correction['to'][0]['id'], self.f.cash['id'])
        self.assertEqual(self.history(activity_type='MONEY_IN')['total'], 0)

    def test_partial_payments_reversal_and_card_repayment(self):
        self.f.opening(self.f.cash, '100.00')
        payable = self.e.posted(self.e.draft(amount='30.00'))
        first = self.e.payment(payable, self.f.cash, amount='10.00')
        self.e.payment(payable, self.f.cash, amount='20.00')
        self.assertEqual([r['amount'] for r in self.history(activity_type='MONEY_OUT')['items']], ['20.00', '10.00'])
        self.s.reverse_payment(expenses.CREATOR, first['id'], Reversal(effectiveDate='2026-01-03', reason='Actual supplier refund'), self.f.key())
        refunded = self.history(activity_type='MONEY_IN')['items'][0]
        self.assertEqual(refunded['status'], 'CORRECTION')
        self.assertEqual(refunded['amount'], '10.00')
        card = self.f.account('CREDIT_CARD')
        other = self.e.posted(self.e.draft(amount='20.00'))
        self.e.payment(other, card, amount='20.00', method='CREDIT_CARD')
        self.transfer(amount='20.00', toAccountId=card['id'], method='CARD_SETTLEMENT', sourceReference='repay')
        repaid = next(r for r in self.history()['items'] if r['label'] == 'Credit-card repayment')
        self.assertEqual(repaid['type'], 'MONEY_OUT')
        self.assertEqual(self.f.balance(card['id']), '0.00')

    def test_canonical_receipt_alias_remittance_variance(self):
        self.f.cutover(); self.f.mapping(income.PERSONAL, self.f.personal); self.f.mapping(income.COMPANY, self.f.wallet)
        invoice, receipt = self.f.invoice(), self.f.receipt(identity=income.PERSONAL)
        self.f.sync('billing', [invoice, receipt])
        alias = self.f.event('point-of-sale', 'pos-alias', 'BILLING_RECEIPT_LINK', billingPaymentId='receipt', customerId='customer', amount='100.00')
        self.f.sync('point-of-sale', [alias])
        collector_alias = self.f.event('collector', 'collector-alias', 'BILLING_RECEIPT_LINK', billingPaymentId='receipt', customerId='customer', amount='100.00')
        self.f.sync('collector', [collector_alias])
        self.f.sync('billing', [receipt])
        self.assertEqual(self.history(activity_type='MONEY_IN')['total'], 1)
        remittance = self.f.event('collector', 'remit', 'COLLECTOR_REMITTANCE', leg='GCASH', expectedAmount='100.00', actualAmount='90.00',
            receipts=[{'billingPaymentId': 'receipt', 'amount': '100.00'}], fromSettlement=income.PERSONAL, toSettlement=income.COMPANY,
            movementEvidence='Verified company transfer', confirmedBy='source-finance')
        self.f.sync('collector', [remittance])
        row = self.history(activity_type='TRANSFER')['items'][0]
        self.assertEqual((row['outgoingAmount'], row['incomingAmount'], row['amount']), ('100.00', '90.00', '90.00'))
        self.assertEqual(row['label'], 'Collector remittance')
        self.assertEqual(self.history(activity_type='MONEY_IN')['total'], 1)

    def test_actual_refund_uses_actual_account_and_retains_original(self):
        self.f.cutover(); self.f.mapping()
        invoice, receipt = self.f.invoice(), self.f.receipt()
        self.f.sync('billing', [invoice, receipt])
        refund = self.f.reverse(receipt, 'REFUND', day='2026-01-03', refundSettlement=income.DESK)
        self.f.sync('billing', [refund])
        row = self.history(activity_type='MONEY_OUT')['items'][0]
        original = self.history(activity_type='MONEY_IN')['items'][0]
        self.assertEqual((row['label'], row['effectiveDate'], row['amount']), ('Customer refund', '2026-01-03', '100.00'))
        self.assertEqual(row['from'][0]['id'], self.f.cash['id'])
        self.assertEqual(original['status'], 'CORRECTED')
        self.assertEqual(row['correctionOfId'], original['id'])

    def test_financing_is_labeled_separately_from_other_income(self):
        for classification in ('OTHER_INCOME', 'LOAN_PROCEEDS', 'OWNER_FUNDING', 'OWNER_LOAN'):
            document = self.f.manual(classification)
            approved = self.f.review(self.f.review(document, 'submit', A))
            self.s.post_manual(A, document['id'], ReviewAction(version=approved['version'], reason='Post reviewed funds'), self.f.key())
        rows = self.history(activity_type='MONEY_IN')['items']
        self.assertEqual({row['label'] for row in rows}, {'Other income', 'Loan proceeds', 'Owner funding', 'Owner loan'})
        self.assertEqual(sum(Decimal(row['amount']) for row in rows), Decimal('200.00'))

    def test_duplicate_no_funds_is_a_correction_and_never_a_cash_refund(self):
        self.f.cutover(); self.f.mapping()
        receipt = self.f.receipt()
        self.f.sync('billing', [self.f.invoice(), receipt])
        correction = self.f.reverse(receipt, 'DUPLICATE_NO_FUNDS')
        self.f.sync('billing', [correction])
        row = self.history(activity_type='CORRECTION')['items'][0]
        self.assertEqual(row['amount'], '100.00')
        self.assertIn('no money moved', row['label'])
        self.assertEqual(self.history(activity_type='MONEY_OUT')['total'], 0)
        self.assertEqual(self.history(activity_type='MONEY_IN')['items'][0]['status'], 'CORRECTED')

    def test_scopes_and_linked_document_permissions_never_leak(self):
        self.r.finance_data()
        grants = frozenset({'finance.view', 'finance.accounts.view', 'finance.journals.view'})
        reader = Actor('limited', grants, account_ids=frozenset({self.f.cash['id']}))
        rows = self.history(reader)['items']
        self.assertEqual(len(rows), 1)  # only the opening; source and payables need their own grants
        self.assertEqual(len(self.history(reader)['accounts']), 1)
        hidden = next(row for row in self.history()['items'] if row['label'] == 'Supplier payment')
        self.f.expect(403, lambda: transaction_detail(self.s, reader, hidden['id']))
        self.f.expect(403, lambda: self.history(reader, account_id=self.f.wallet['id']))
        scoped = Actor(A.username, frozenset(PERMISSIONS), expense_ids=frozenset())
        self.assertFalse(any(row['supportingRecord']['kind'] == 'PAYABLE' for row in self.history(scoped)['items']))
        self.f.expect(403, lambda: self.history(Actor('revoked', frozenset())))

    def test_filters_pagination_archived_accounts_and_historic_names(self):
        self.f.opening(self.f.cash, '50.00'); entry = self.transfer()
        self.s.edit_account(A, self.f.cash['id'], AccountEdit(version=1, name='Renamed drawer', custodian='', notes=''), self.f.key())
        self.s.edit_account(A, self.f.cash['id'], AccountAction(version=2, reason='Drawer retired'), self.f.key(), active=False)
        row = self.history(search='move OFFICE', from_date=date(2026, 1, 3), through_date=date(2026, 1, 3))['items'][0]
        self.assertEqual(row['id'], entry['id']); self.assertEqual(row['from'][0]['name'], 'CASH')
        archived = next(a for a in self.history()['accounts'] if a['id'] == self.f.cash['id'])
        self.assertFalse(archived['active']); self.assertEqual(archived['name'], 'Renamed drawer')
        first = self.history(limit=1); second = self.history(limit=1, offset=1)
        self.assertEqual(first['total'], 2); self.assertNotEqual(first['items'][0]['id'], second['items'][0]['id'])
        self.assertEqual(self.history(search='nonexistent')['total'], 0)
        self.f.expect(400, lambda: self.history(from_date=date(2026, 2, 1), through_date=date(2026, 1, 1)))
        self.f.expect(400, lambda: self.history(through_date=date(2099, 1, 1)))


class ActivityHttpTests(unittest.TestCase):
    def test_api_filters_validation_detail_and_denial(self):
        fixture = reports.ReportsHttpTests(); fixture.setUp(); self.addCleanup(fixture.tearDown)
        fixture.fixture.finance_data()
        call = fixture.call
        status, _, body = call('GET', '/api/finance/activity?type=MONEY_IN&limit=1')
        self.assertEqual(status, 200)
        data = json.loads(body); self.assertEqual(data['total'], 2); self.assertEqual(len(data['items']), 1)
        self.assertEqual(call('GET', '/api/finance/activity/' + data['items'][0]['id'])[0], 200)
        for query in ('limit=101', 'offset=-1', 'type=UNKNOWN', 'fromDate=invalid'):
            self.assertEqual(call('GET', '/api/finance/activity?' + query)[0], 422)
        self.assertEqual(call('GET', '/api/finance/activity', token='denied')[0], 403)
        self.assertEqual(call('GET', '/api/finance/activity/' + data['items'][0]['id'], token='denied')[0], 403)


if __name__ == '__main__':
    unittest.main()
