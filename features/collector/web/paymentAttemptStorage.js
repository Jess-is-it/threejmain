const PREFIX = 'threejmain_collector_pending_payment:';

export function pendingPaymentStorageKey(username) {
  return `${PREFIX}${username}`;
}

function parseAttempt(raw) {
  if (!raw) return null;
  try {
    const attempt = JSON.parse(raw);
    return attempt?.idempotencyKey && attempt?.payload && attempt?.breakdown ? attempt : null;
  } catch {
    return null;
  }
}

export function loadPendingPaymentAttempt(username, browser = window) {
  if (!username) return null;
  const key = pendingPaymentStorageKey(username);
  let durable = null;
  let legacy = null;
  try { durable = browser.localStorage.getItem(key); } catch { /* Storage may be restricted. */ }
  try { legacy = browser.sessionStorage.getItem(key); } catch { /* Storage may be restricted. */ }
  const durableAttempt = parseAttempt(durable);
  const saved = durableAttempt || parseAttempt(legacy);
  if (!saved) return null;
  if (!durableAttempt && legacy) {
    try {
      browser.localStorage.setItem(key, legacy);
      browser.sessionStorage.removeItem(key);
    } catch {
      // Keep the old same-tab attempt available until durable storage works.
    }
  }
  return saved;
}

export function savePendingPaymentAttempt(username, attempt, browser = window) {
  if (!username) return { saved: false, storageUnavailable: true };
  const existing = loadPendingPaymentAttempt(username, browser);
  if (existing?.idempotencyKey && existing.idempotencyKey !== attempt.idempotencyKey) {
    return { saved: false, pending: existing };
  }
  try {
    browser.localStorage.setItem(pendingPaymentStorageKey(username), JSON.stringify(attempt));
    return { saved: true };
  } catch {
    return { saved: false, storageUnavailable: true };
  }
}

export function clearPendingPaymentAttempt(username, browser = window) {
  if (!username) return;
  const key = pendingPaymentStorageKey(username);
  try { browser.localStorage.removeItem(key); } catch { /* Storage may be restricted. */ }
  try { browser.sessionStorage.removeItem(key); } catch { /* Storage may be restricted. */ }
}
