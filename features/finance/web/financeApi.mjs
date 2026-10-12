export function moneyLabel(value) {
  const [whole, fraction = '00'] = String(value).split('.');
  return `₱${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction.padEnd(2, '0')}`;
}

export function businessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function newReference(provider = globalThis.crypto) {
  if (typeof provider?.randomUUID === 'function') return provider.randomUUID();
  if (typeof provider?.getRandomValues !== 'function') throw new Error('This browser cannot prepare a safe Finance request.');
  const bytes = provider.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class FinanceApi {
  constructor({ base = '', token, storage, fetcher = globalThis.fetch.bind(globalThis), uuid = newReference }) {
    Object.assign(this, { base, token, fetcher, uuid });
    try { this.storage = storage ?? globalThis.localStorage; } catch { this.storage = null; }
    this.username = null;
  }

  get pendingKey() {
    if (!this.username) throw new Error('Load the signed-in Finance identity before posting.');
    return `threejmain_finance_attempt:${this.username}`;
  }

  pending() {
    if (!this.storage) return null;
    const raw = this.storage.getItem(this.pendingKey);
    const value = raw ? JSON.parse(raw) : null;
    if (value && (typeof value.path !== 'string' || !value.path.startsWith('/api/finance/') ||
                  !['POST', 'PATCH'].includes(value.method) || typeof value.key !== 'string' || !value.key)) {
      throw new Error('The saved Finance request is invalid. Ask Finance support to review it.');
    }
    return value;
  }

  async request(path, options = {}) {
    const response = await this.fetcher(`${this.base}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${this.token()}`, 'Content-Type': 'application/json', ...options.headers },
      signal: AbortSignal.timeout(20000),
    });
    const payload = await response.json();
    if (!response.ok) {
      const error = new Error(typeof payload.detail === 'string' ? payload.detail : 'Please check the entered fields.');
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async download(path) {
    const response = await this.fetcher(`${this.base}${path}`, {
      headers: { Authorization: `Bearer ${this.token()}` }, signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(typeof payload.detail === 'string' ? payload.detail : 'Attachment access was denied.');
    }
    return response.blob();
  }

  async mutate(path, method, body) {
    if (!this.storage) throw new Error('Browser storage is unavailable. Finance cannot safely post this action.');
    if (this.pending()) throw new Error('Resolve the saved Finance request before posting another action.');
    const attempt = { path, method, body, key: this.uuid() };
    // Persist before sending; denied storage must prevent an uncertain financial write.
    try { this.storage.setItem(this.pendingKey, JSON.stringify(attempt)); }
    catch { throw new Error('This browser cannot preserve the Finance request for safe retry. Try a smaller document or contact Finance support.'); }
    if (this.storage.getItem(this.pendingKey) !== JSON.stringify(attempt)) throw new Error('Cannot preserve the Finance request for safe retry.');
    return this.retry();
  }

  async retry() {
    const savedKey = this.pendingKey;
    const attempt = this.pending();
    if (!attempt) throw new Error('No saved Finance request to retry.');
    try {
      const result = await this.request(attempt.path, {
        method: attempt.method, body: attempt.body == null ? undefined : JSON.stringify(attempt.body),
        headers: { 'Idempotency-Key': attempt.key },
      });
      this.storage.removeItem(savedKey);
      return result;
    } catch (error) {
      // Definitive transactional rejection allows a corrected request. Network/5xx
      // and expired authentication keep the frozen payload/key until resolved.
      if ([400, 403, 404, 405, 409, 413, 415, 422].includes(error.status)) this.storage.removeItem(savedKey);
      throw error;
    }
  }
}
