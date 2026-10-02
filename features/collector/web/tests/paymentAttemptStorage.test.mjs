import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const storageModuleSource = await readFile(new URL('../paymentAttemptStorage.js', import.meta.url), 'utf8');
const {
  clearPendingPaymentAttempt,
  loadPendingPaymentAttempt,
  pendingPaymentStorageKey,
  savePendingPaymentAttempt
} = await import(`data:text/javascript;base64,${Buffer.from(storageModuleSource).toString('base64')}`);

function storage(backing = new Map()) {
  return {
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => backing.set(key, value),
    removeItem: (key) => backing.delete(key)
  };
}

const attempt = { idempotencyKey: 'collector-attempt-1', payload: { amount: 150 }, breakdown: { amount: 150 } };

test('pending payment survives closing its browser tab and blocks a different attempt', () => {
  const durable = storage();
  const firstTab = { localStorage: durable, sessionStorage: storage() };
  assert.deepEqual(savePendingPaymentAttempt('collector-one', attempt, firstTab), { saved: true });

  const reopenedTab = { localStorage: durable, sessionStorage: storage() };
  assert.deepEqual(loadPendingPaymentAttempt('collector-one', reopenedTab), attempt);
  assert.deepEqual(
    savePendingPaymentAttempt('collector-one', { ...attempt, idempotencyKey: 'new-attempt' }, reopenedTab),
    { saved: false, pending: attempt }
  );
  clearPendingPaymentAttempt('collector-one', reopenedTab);
  assert.equal(loadPendingPaymentAttempt('collector-one', reopenedTab), null);
});

test('a pending payment from the former session storage is migrated', () => {
  const browser = { localStorage: storage(), sessionStorage: storage() };
  const key = pendingPaymentStorageKey('collector-one');
  browser.sessionStorage.setItem(key, JSON.stringify(attempt));
  assert.deepEqual(loadPendingPaymentAttempt('collector-one', browser), attempt);
  assert.equal(browser.sessionStorage.getItem(key), null);
  assert.deepEqual(JSON.parse(browser.localStorage.getItem(key)), attempt);
});

test('posting is refused when durable storage is unavailable', () => {
  const browser = {
    localStorage: { getItem: () => null, setItem: () => { throw new Error('blocked'); }, removeItem: () => {} },
    sessionStorage: storage()
  };
  assert.deepEqual(savePendingPaymentAttempt('collector-one', attempt, browser), { saved: false, storageUnavailable: true });
});
