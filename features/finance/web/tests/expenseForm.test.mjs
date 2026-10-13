import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyInstallments, expenseBody, expenseStatus, accountMethod } from '../expenseForm.mjs';

test('monthly schedules preserve cents and month-end dates', () => {
  assert.deepEqual(monthlyInstallments('100.00', 3, '2026-01-31'), [
    { dueDate: '2026-01-31', amount: '33.33' }, { dueDate: '2026-02-28', amount: '33.33' }, { dueDate: '2026-03-31', amount: '33.34' },
  ]);
  assert.equal(monthlyInstallments('100.00', 3, '2028-01-31')[1].dueDate, '2028-02-29');
  assert.equal(monthlyInstallments('9999999999999999.99', 2, '2026-12-01')[1].amount, '5000000000000000.00');
});
test('reject invalid or zero-value installment suggestions', () => {
  for (const args of [['1.001', 3, '2026-01-01'], ['1.00', 1, '2026-01-01'], ['0.01', 3, '2026-01-01'], ['1.00', 121, '2026-01-01']]) assert.throws(() => monthlyInstallments(...args));
});
test('simple form defaults document dates and clears stale payment arrangements', () => {
  const form = { amount: '100.00', expenseDate: '2026-01-01', dueDate: '2026-02-01', paidAccountId: 'old-card', installments: [{ amount: '100.00', dueDate: '2026-02-01' }], paymentArrangement: 'PAY_LATER' };
  const body = expenseBody(form);
  assert.equal(body.documentDate, '2026-01-01');assert.deepEqual(body.installments, []);assert.equal(body.paidDetails, null);
  const paid = expenseBody({ ...form, paymentArrangement: 'ALREADY_PAID', paidDate: '2026-01-02', paidMethod: 'CREDIT_CARD', paidReference: 'Charge evidence' });
  assert.equal(paid.paidDetails.accountId, 'old-card');assert.equal(paid.dueDate, '2026-01-01');
});
test('status follows approval and posting before settlement', () => {
  assert.equal(expenseStatus({ approvalStatus: 'DRAFT', postingStatus: 'UNPOSTED', settlementStatus: 'UNPAID' }), 'DRAFT');
  assert.equal(expenseStatus({ approvalStatus: 'SUBMITTED', postingStatus: 'UNPOSTED', settlementStatus: 'UNPAID' }), 'NEEDS_APPROVAL');
  assert.equal(expenseStatus({ approvalStatus: 'APPROVED', postingStatus: 'POSTED', settlementStatus: 'UNPAID' }), 'AWAITING_PAYMENT');
});
test('actual accounts determine payment rails without confusing card debt with cash', () => {
  assert.equal(accountMethod({ kind: 'CREDIT_CARD' }), 'CREDIT_CARD');assert.equal(accountMethod({ kind: 'BANK' }), 'BANK_TRANSFER');
  assert.equal(accountMethod({ kind: 'COLLECTOR_GCASH' }), 'GCASH');assert.equal(accountMethod({ kind: 'PETTY_CASH' }), 'CASH');
});
