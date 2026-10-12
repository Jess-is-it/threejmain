import test from 'node:test';
import assert from 'node:assert/strict';
import { cutoverBody, priorDate, manualCounterpartType } from '../incomeClient.mjs';
import { FinanceApi } from '../financeApi.mjs';

test('cutover uses prior calendar day and exact itemized deferred cents', () => {
  assert.equal(priorDate('2026-01-01'), '2025-12-31');
  assert.equal(priorDate('2024-03-01'), '2024-02-29');
  assert.throws(() => priorDate('2026-02-30'));
  const form = { startDate: '2026-01-02', snapshots: { billing: 'snapshot' }, receivables: [
    { owner: 'billing', recordId: 'invoice', customerId: 'customer', amount: '0.00', deferredAmount: '90071992547409.91' },
    { owner: 'billing', recordId: 'invoice-2', customerId: 'customer', amount: '1.00', deferredAmount: '0.09' },
  ], credits: [], custody: [], evidenceReference: 'Reviewed opening', reason: 'Certified cutover' };
  const result = cutoverBody(form, [{ id: 'cash', kind: 'CASH', active: true, balance: '100.01' }, { id: 'revenue', kind: 'GENERAL_LEDGER', active: true, balance: '1.00' }]);
  assert.equal(result.deferredAmount, '90071992547410.00');
  assert.deepEqual(result.funds, [{ accountId: 'cash', balance: '100.01' }]);
  form.receivables[0].deferredAmount = '0.001';
  assert.throws(() => cutoverBody(form, []));
});

test('classified loans and owner contributions select balance-sheet counterparts', () => {
  assert.equal(manualCounterpartType('OTHER_INCOME'), 'REVENUE');
  assert.equal(manualCounterpartType('LOAN_PROCEEDS'), 'LIABILITY');
  assert.equal(manualCounterpartType('OWNER_LOAN'), 'LIABILITY');
  assert.equal(manualCounterpartType('OWNER_FUNDING'), 'EQUITY');
});

test('uncertain source sync retries its frozen request without requesting client receipt creation', async () => {
  const values = new Map(), calls = [];
  const storage = { getItem: (k) => values.get(k) || null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) };
  let unavailable = true;
  const fetcher = async (path, options) => {
    calls.push({ path, key: options.headers['Idempotency-Key'], body: options.body });
    if (unavailable) throw new Error('Lost response');
    return { ok: true, json: async () => ({ id: 'saved-sync', checkpointAdvanced: true }) };
  };
  const first = new FinanceApi({ storage, fetcher, token: () => 'shared-token', uuid: () => 'source-key' }); first.username = 'recorder';
  await assert.rejects(first.mutate('/api/finance/sources/billing/sync', 'POST', { limit: 100 }));
  const restored = new FinanceApi({ storage, fetcher, token: () => 'shared-token' }); restored.username = 'recorder'; unavailable = false;
  await restored.retry();
  assert.deepEqual(calls[0], calls[1]); assert.equal(calls[1].body, '{"limit":100}'); assert.equal(restored.pending(), null);
});
