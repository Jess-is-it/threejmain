// Exact cutover preparation; no float sums or subscriber receipt creation.
export const SOURCES = ['billing', 'point-of-sale', 'collector', 'service'];
export const INFLOW_CLASSES = { OTHER_INCOME: 'Other income', LOAN_PROCEEDS: 'Loan proceeds', OWNER_FUNDING: 'Owner contribution', OWNER_LOAN: 'Owner loan' };

export function priorDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Choose a valid cutover date.');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('Choose a valid cutover date.');
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

function cents(value) {
  if (typeof value !== 'string' || !/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Use nonnegative decimal amounts with at most two cents.');
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (amount > 999999999999999999n) throw new Error('Amount exceeds the Finance monetary limit.');
  return amount;
}

export function cutoverBody(form, funds) {
  priorDate(form.startDate);
  const receivables = form.receivables.map((r) => ({ ...r, amount: r.amount || '0.00', deferredAmount: r.owner === 'billing' ? r.deferredAmount || '0.00' : '0.00' }));
  const total = receivables.reduce((sum, r) => { cents(r.amount); return sum + cents(r.deferredAmount); }, 0n);
  if (total > 999999999999999999n) throw new Error('Deferred opening exceeds the monetary limit.');
  return {
    startDate: form.startDate, snapshots: { ...form.snapshots },
    funds: funds.filter((a) => a.active && a.kind !== 'GENERAL_LEDGER').map((a) => ({ accountId: a.id, balance: a.balance })),
    receivables, credits: form.credits.map((r) => ({ ...r })), custody: form.custody.map((r) => ({ ...r })),
    deferredAmount: `${total / 100n}.${String(total % 100n).padStart(2, '0')}`,
    evidenceReference: form.evidenceReference, reason: form.reason,
  };
}

export function manualCounterpartType(classification) {
  return classification === 'OTHER_INCOME' ? 'REVENUE' : classification === 'OWNER_FUNDING' ? 'EQUITY' : 'LIABILITY';
}
