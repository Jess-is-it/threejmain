import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyInstallments, expenseBody, expenseStatus, accountMethod, expenseArrangement, changeArrangement, immediateAccounts } from '../expenseForm.mjs';

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
  assert.equal(body.payeeId, null);
  const paid = expenseBody({ ...form, paymentArrangement: 'ALREADY_PAID', paidDate: '2026-01-02', paidMethod: 'CREDIT_CARD', paidReference: 'Charge evidence' });
  assert.equal(paid.paidDetails.accountId, 'old-card');assert.equal(paid.dueDate, '2026-01-01');
  assert.equal(paid.payeeId, null);
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
test('separate cash/card choices preserve the retained API evidence contract and reject mismatched rails', () => {
  const common = { amount: '100.00', expenseDate: '2026-01-01', paidDate: '2026-01-02', paidAccountId: 'funds', paidReference: 'Bank payment', installments: [{ dueDate: '2026-02-01', amount: '100.00' }] };
  const paid = expenseBody({ ...common, paymentArrangement: 'PAID_NOW', paidMethod: 'BANK_TRANSFER' });
  const charged = expenseBody({ ...common, paymentArrangement: 'CHARGED_TO_CARD', paidAccountId: 'card', paidMethod: 'CREDIT_CARD' });
  assert.equal(paid.paymentArrangement, 'ALREADY_PAID'); assert.equal(charged.paymentArrangement, 'ALREADY_PAID');
  assert.equal(paid.paidDetails.method, 'BANK_TRANSFER'); assert.equal(charged.paidDetails.method, 'CREDIT_CARD');
  assert.equal(paid.dueDate, '2026-01-01'); assert.deepEqual(charged.installments, []);
  assert.equal(expenseArrangement(paid), 'PAID_NOW'); assert.equal(expenseArrangement(charged), 'CHARGED_TO_CARD');
  assert.throws(() => expenseBody({ ...common, paymentArrangement: 'PAID_NOW', paidMethod: 'CREDIT_CARD' }), /matching/);
  assert.throws(() => expenseBody({ ...common, paymentArrangement: 'CHARGED_TO_CARD', paidMethod: 'CASH' }), /matching/);
});
test('switching arrangements clears stale account/reference while keeping the expense and its terms', () => {
  const original = { amount: '99.00', purpose: 'Fuel purchase', paymentArrangement: 'CHARGED_TO_CARD', paidAccountId: 'card', paidReference: 'Card receipt', paidMethod: 'CREDIT_CARD', installments: [{ dueDate: '2026-02-01', amount: '99.00' }] };
  const cash = changeArrangement(original, 'PAID_NOW');
  assert.equal(cash.paidAccountId, ''); assert.equal(cash.paidReference, ''); assert.equal(cash.paidMethod, 'CASH');
  assert.equal(cash.purpose, original.purpose); assert.equal(cash.amount, original.amount); assert.deepEqual(cash.installments, original.installments);
  const deferred = expenseBody({ ...changeArrangement(original, 'PAY_LATER'), expenseDate: '2026-01-01', dueDate: '2026-02-01' });
  assert.equal(deferred.paidDetails, null); assert.equal(deferred.paymentArrangement, 'PAY_LATER');
});
test('named immediate-payment accounts exclude incompatible, archived and ledger accounts', () => {
  const accounts = [{ id: 'cash', kind: 'CASH', active: true }, { id: 'bank', kind: 'BANK', active: true }, { id: 'gcash', kind: 'COMPANY_GCASH', active: true }, { id: 'card', kind: 'CREDIT_CARD', active: true }, { id: 'old', kind: 'CREDIT_CARD', active: false }, { id: 'ledger', kind: 'GENERAL_LEDGER', active: true }];
  assert.deepEqual(immediateAccounts(accounts, 'PAID_NOW').map((r) => r.id), ['cash', 'bank', 'gcash']);
  assert.deepEqual(immediateAccounts(accounts, 'CHARGED_TO_CARD').map((r) => r.id), ['card']);
  assert.equal(expenseArrangement({}), 'PAY_LATER');
});
