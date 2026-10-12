import test from 'node:test';
import assert from 'node:assert/strict';
import { FinanceApi, moneyLabel, businessDate, newReference } from '../financeApi.mjs';

function storage() {
  const values = new Map();
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) };
}
const ok = (value) => ({ ok: true, json: async () => value });
const fail = (status) => ({ ok: false, status, json: async () => ({ detail: 'Rejected request' }) });

test('uncertain payment retains the exact body/key across a new client and username scope', async () => {
  const local = storage(); const calls = [];
  const first = new FinanceApi({ token: () => 'token', storage: local, uuid: () => 'stable-key', fetcher: async (...args) => { calls.push(args); throw new Error('Network lost'); } });
  first.username = 'alice';
  const body = { amount: '1200.03', fromAccountId: 'cash', toAccountId: 'bank' };
  await assert.rejects(first.mutate('/api/finance/transfers', 'POST', body), /Network lost/);
  body.amount = '999.00';
  const resumed = new FinanceApi({ token: () => 'new-token', storage: local, fetcher: async (...args) => { calls.push(args); return ok({ id: 'posted', idempotentReplay: true }); } });
  resumed.username = 'bob'; assert.equal(resumed.pending(), null);
  resumed.username = 'alice';
  await resumed.retry();
  assert.equal(calls[0][1].body, calls[1][1].body);
  assert.equal(calls[1][1].headers['Idempotency-Key'], 'stable-key');
  assert.equal(JSON.parse(calls[1][1].body).amount, '1200.03');
  assert.equal(resumed.pending(), null);
});

test('blocked durable storage prevents sending a write', async () => {
  let sent = false;
  const api = new FinanceApi({ token: () => '', storage: { getItem: () => null, setItem: () => { throw new Error('Denied storage'); } }, fetcher: async () => { sent = true; return ok({}); }, uuid: () => 'key' });
  api.username = 'finance';
  await assert.rejects(api.mutate('/api/finance/accounts', 'POST', {}), /preserve the Finance request/);
  assert.equal(sent, false);
});

test('an unresolved attempt blocks a different action', async () => {
  const local = storage(); let count = 0;
  const api = new FinanceApi({ token: () => '', storage: local, uuid: () => 'key', fetcher: async () => { count++; return fail(503); } });
  api.username = 'finance';
  await assert.rejects(api.mutate('/api/finance/transfers', 'POST', { amount: '1.00' }));
  await assert.rejects(api.mutate('/api/finance/accounts', 'POST', {}), /Resolve the saved/);
  assert.equal(count, 1); assert.ok(api.pending());
});

test('definitive rejection clears attempt, expired auth keeps it', async () => {
  for (const status of [400, 403, 404, 405, 409, 413, 415, 422, 401]) {
    const api = new FinanceApi({ token: () => '', storage: storage(), uuid: () => 'key', fetcher: async () => fail(status) });
    api.username = 'finance';
    await assert.rejects(api.mutate('/api/finance/journals', 'POST', {}));
    assert.equal(Boolean(api.pending()), status === 401);
  }
});

test('money display preserves cents at NUMERIC(18,2) limits and dates use Manila', () => {
  assert.equal(moneyLabel('9999999999999999.99'), '₱9,999,999,999,999,999.99');
  assert.equal(moneyLabel('-10.03'), '₱-10.03');
  assert.equal(businessDate(new Date('2026-01-01T18:30:00Z')), '2026-01-02');
});

test('HTTP staging UUID fallback uses cryptographic bytes when randomUUID is unavailable', () => {
  const provider = { getRandomValues: (bytes) => { bytes.fill(255); return bytes; } };
  assert.equal(newReference(provider), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
  assert.throws(() => newReference({}), /safe Finance request/);
});

test('in-flight confirmation removes only the original user pending request', async () => {
  const local = storage(); let finish;
  const api = new FinanceApi({ storage: local, token: () => 'token', uuid: () => 'key', fetcher: () => new Promise((resolve) => { finish = resolve; }) });
  api.username = 'alice'; const inFlight = api.mutate('/api/finance/accounts', 'POST', { code: 'DRAWER' });
  api.username = 'bob'; local.setItem(api.pendingKey, JSON.stringify({ path: '/api/finance/transfers', method: 'POST', body: {}, key: 'bob-key' }));
  finish(ok({ id: 'alice-account' })); await inFlight;
  assert.equal(api.pending().key, 'bob-key'); api.username = 'alice'; assert.equal(api.pending(), null);
});

test('default browser fetch is bound to its native global context', async () => {
  const prior = globalThis.fetch;
  let api;
  try {
    globalThis.fetch = async function (_url, options) {
      assert.equal(this, globalThis);
      assert.equal(options.headers.Authorization, 'Bearer browser');
      return { ok: true, json: async () => ({ nativeContext: true }) };
    };
    api = new FinanceApi({ token: () => 'browser' });
  } finally { globalThis.fetch = prior; }
  assert.deepEqual(await api.request('/api/finance/meta'), { nativeContext: true });
});
