import assert from 'node:assert/strict';
import test from 'node:test';
import { planInvoicePayment } from '../invoicePaymentPlan.mjs';

function row(id, balance, dueDate, promotion = null) {
  return {
    invoice: { id, invoiceNumber: id, dueDate },
    currentBalance: balance,
    amountToCollect: promotion?.payable ?? balance,
    promotion
  };
}

test('a partial receipt pays the oldest selected invoice first', () => {
  const plan = planInvoicePayment([
    row('newer', 500, '2026-10-20'),
    row('older', 600, '2026-09-20')
  ], 800);

  assert.deepEqual(plan.allocations.map(({ invoiceId, amount, remainingAfter }) => ({ invoiceId, amount, remainingAfter })), [
    { invoiceId: 'older', amount: 600, remainingAfter: 0 },
    { invoiceId: 'newer', amount: 200, remainingAfter: 300 }
  ]);
  assert.equal(plan.appliedAmount, 800);
  assert.equal(plan.isPartial, true);
});

test('a promotion is withheld on a partial invoice payment and applied on full payoff', () => {
  const discounted = row('promo', 1000, '2026-09-20', {
    payable: 800,
    amount: 200,
    promotionIds: ['early-bird'],
    count: 1,
    label: 'Early Bird'
  });
  const partial = planInvoicePayment([discounted], 400);
  assert.equal(partial.fullPayoffAmount, 800);
  assert.equal(partial.allocations[0].amount, 400);
  assert.equal(partial.allocations[0].remainingAfter, 600);
  assert.deepEqual(partial.allocations[0].promotionIds, []);
  assert.equal(partial.discountAmount, 0);

  const full = planInvoicePayment([discounted], 800);
  assert.equal(full.isPartial, false);
  assert.equal(full.allocations[0].remainingAfter, 0);
  assert.deepEqual(full.allocations[0].promotionIds, ['early-bird']);
  assert.equal(full.discountAmount, 200);
});

test('a full promoted payoff can be followed by a partial allocation to the next invoice', () => {
  const plan = planInvoicePayment([
    row('older', 1000, '2026-09-20', { payable: 800, amount: 200, promotionIds: ['promo'], count: 1 }),
    row('newer', 500, '2026-10-20')
  ], 900);

  assert.deepEqual(plan.allocations.map(({ invoiceId, amount, remainingAfter }) => ({ invoiceId, amount, remainingAfter })), [
    { invoiceId: 'older', amount: 800, remainingAfter: 0 },
    { invoiceId: 'newer', amount: 100, remainingAfter: 400 }
  ]);
  assert.equal(plan.discountAmount, 200);
  assert.equal(plan.isPartial, true);
});

test('amount above full payoff is left for the cashier to assign as change or advance', () => {
  const plan = planInvoicePayment([row('invoice', 1000, '2026-09-20')], 1200);
  assert.equal(plan.appliedAmount, 1000);
  assert.equal(plan.excessAmount, 200);
  assert.equal(plan.isPartial, false);
});
