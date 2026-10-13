import test from 'node:test';
import assert from 'node:assert/strict';
import { accountCreateBody } from '../accountForm.mjs';

const form = (amount = '') => ({ code: 'DESK', name: 'Office cash', kind: 'CASH', notes: '', custodian: '', startingBalanceAmount: amount, startingBalanceDate: '2026-01-01' });

test('account intake submits account and dated starting balance together without manual evidence or reason', () => {
  const body = accountCreateBody(form(' 1250.21 '));
  assert.deepEqual(body.startingBalance, { amount: '1250.21', effectiveDate: '2026-01-01' });
  for (const key of ['startingBalanceAmount', 'startingBalanceDate', 'reason', 'evidenceReference']) assert.equal(Object.hasOwn(body, key), false);
  const card = accountCreateBody({ ...form('9999999999999999.99'), kind: 'CREDIT_CARD' });
  assert.equal(card.startingBalance.amount, '9999999999999999.99');
});

test('blank and zero start empty without a fabricated journal; accounting accounts have no financial starting balance', () => {
  for (const amount of ['', '0', '0.00', '000.00']) assert.equal(Object.hasOwn(accountCreateBody(form(amount)), 'startingBalance'), false);
  assert.equal(Object.hasOwn(accountCreateBody({ ...form('100'), kind: 'GENERAL_LEDGER' }), 'startingBalance'), false);
});

test('negative, fractional-cent and nonnumeric balances or missing dates cannot be submitted', () => {
  for (const amount of ['-1', '1.001', 'cash', '1e3', 'NaN', 'Infinity']) assert.throws(() => accountCreateBody(form(amount)));
  assert.throws(() => accountCreateBody({ ...form('1.00'), startingBalanceDate: '' }));
});
