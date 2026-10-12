import test from 'node:test';
import assert from 'node:assert/strict';
import { attachmentBody, ATTACHMENT_LIMIT } from '../expenseEvidence.mjs';
import { FinanceApi } from '../financeApi.mjs';

function file(name = 'invoice.pdf', type = 'application/pdf', bytes = new TextEncoder().encode('%PDF-1.7\nEvidence')) {
  return { name, type, size: bytes.byteLength, arrayBuffer: async () => bytes.buffer };
}
function storage() {
  const values = new Map();
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) };
}

test('attachment preparation preserves exact bytes and document version', async () => {
  const input = file('scan.png', 'image/png', Uint8Array.from([137, 80, 78, 71, 0, 255, 3]));
  const body = await attachmentBody(input, 7);
  assert.equal(body.version, 7); assert.equal(body.contentType, 'image/png');
  assert.deepEqual([...Buffer.from(body.contentBase64, 'base64')], [137, 80, 78, 71, 0, 255, 3]);
});

test('invalid filenames, types, limits and changed file reads are rejected before posting', async () => {
  for (const input of [file('../invoice.pdf'), file('invoice.html', 'text/html'), file('image.png', 'application/pdf'),
    { ...file(), size: ATTACHMENT_LIMIT + 1 }, { ...file(), size: 0 }, { ...file(), size: 100 }]) {
    await assert.rejects(attachmentBody(input, 1));
  }
});

test('uncertain attachment upload retries frozen bytes and version after reload', async () => {
  const local = storage(), calls = [];
  const first = new FinanceApi({ storage: local, token: () => 'token', uuid: () => 'upload-key', fetcher: async (...args) => { calls.push(args); throw new Error('Response lost'); } });
  first.username = 'recorder'; const body = await attachmentBody(file(), 2);
  await assert.rejects(first.mutate('/api/finance/payables/bill/attachments', 'POST', body));
  body.version = 3; body.contentBase64 = 'Changed bytes';
  const resumed = new FinanceApi({ storage: local, token: () => 'new-token', fetcher: async (...args) => { calls.push(args); return { ok: true, json: async () => ({ id: 'evidence', idempotentReplay: true }) }; } });
  resumed.username = 'recorder'; await resumed.retry();
  assert.equal(calls[0][1].body, calls[1][1].body); assert.equal(calls[1][1].headers['Idempotency-Key'], 'upload-key');
});

test('attachment download sends shared bearer auth and returns a blob only on success', async () => {
  let headers;
  const blob = new Blob(['%PDF-1.7\nEvidence']);
  const api = new FinanceApi({ token: () => 'current-token', storage: storage(), fetcher: async (_path, options) => { headers = options.headers; return { ok: true, blob: async () => blob }; } });
  assert.equal(await api.download('/api/finance/payables/bill/attachments/file/download'), blob);
  assert.equal(headers.Authorization, 'Bearer current-token');
  api.fetcher = async () => ({ ok: false, json: async () => ({ detail: 'Outside expense scope' }), blob: async () => { throw new Error('Must not read denied content'); } });
  await assert.rejects(api.download('/api/finance/payables/bill/attachments/file/download'), /Outside expense scope/);
});
