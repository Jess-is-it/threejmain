// Exact cent arithmetic for editable payment plans; API validates every value again.
export const ARRANGEMENTS = { PAID_NOW: 'Paid now', PAY_LATER: 'Pay later', INSTALLMENTS: 'Installments', CHARGED_TO_CARD: 'Charged to credit card' };
export function isImmediateArrangement(value) {
  return ['PAID_NOW', 'CHARGED_TO_CARD', 'ALREADY_PAID'].includes(value);
}
// Retained API records use ALREADY_PAID; their payment evidence identifies the rail.
export function expenseArrangement(record) {
  return record.paymentArrangement === 'ALREADY_PAID' ? record.paidDetails?.method === 'CREDIT_CARD' ? 'CHARGED_TO_CARD' : 'PAID_NOW' : record.paymentArrangement || 'PAY_LATER';
}
export function changeArrangement(form, value) {
  return { ...form, paymentArrangement: value, paidAccountId: '', paidReference: '', paidMethod: value === 'CHARGED_TO_CARD' ? 'CREDIT_CARD' : 'CASH' };
}
export function immediateAccounts(accounts, arrangement) {
  return accounts.filter((a) => a.active && a.kind !== 'GENERAL_LEDGER' && (arrangement === 'CHARGED_TO_CARD' ? a.kind === 'CREDIT_CARD' : a.kind !== 'CREDIT_CARD'));
}
export function expenseStatus(r) {
  if (r.postingStatus === 'REVERSED') return 'REVERSED';
  if (r.approvalStatus === 'DRAFT') return 'DRAFT';
  if (r.approvalStatus === 'SUBMITTED') return 'NEEDS_APPROVAL';
  if (r.approvalStatus === 'REJECTED') return 'REJECTED';
  if (r.postingStatus === 'UNPOSTED') return 'READY_TO_RECORD';
  return r.settlementStatus === 'UNPAID' ? 'AWAITING_PAYMENT' : r.settlementStatus;
}
export function accountMethod(account) {
  return account?.kind === 'CREDIT_CARD' ? 'CREDIT_CARD' : account?.kind === 'BANK' ? 'BANK_TRANSFER'
    : /GCASH/.test(account?.kind || '') ? 'GCASH' : 'CASH';
}
function cents(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(String(value))) throw new Error('Enter a positive amount with up to two decimal places.');
  const [whole, fraction = ''] = String(value).split('.');
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (result <= 0n) throw new Error('The amount must be greater than zero.');
  return result;
}
const decimal = (value) => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
export function monthlyInstallments(total, count, firstDueDate) {
  count = Number(count);
  if (!Number.isInteger(count) || count < 2 || count > 120) throw new Error('Choose 2 to 120 installments.');
  const amount = cents(total), part = amount / BigInt(count);
  if (!part) throw new Error('The amount is too small for this number of installments.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDueDate)) throw new Error('Choose the first due date.');
  const [year, month, day] = firstDueDate.split('-').map(Number);
  return Array.from({ length: count }, (_, index) => {
    const lastDay = new Date(Date.UTC(year, month + index, 0)).getUTCDate();
    const date = new Date(Date.UTC(year, month - 1 + index, Math.min(day, lastDay))).toISOString().slice(0, 10);
    return { dueDate: date, amount: decimal(index === count - 1 ? amount - part * BigInt(count - 1) : part) };
  });
}
export function expenseBody(form) {
  const keys = ['payeeId', 'categoryId', 'documentReference', 'expenseDate', 'amount', 'purpose', 'locationReference', 'projectReference', 'itemAssetReference', 'evidenceReference', 'evidenceExceptionReason'];
  const body = Object.fromEntries(keys.map((key) => [key, form[key] || '']));
  body.payeeId = body.payeeId || null;
  body.documentDate = form.documentDate || form.expenseDate;
  const immediate = isImmediateArrangement(form.paymentArrangement);
  if ((form.paymentArrangement === 'PAID_NOW' && form.paidMethod === 'CREDIT_CARD') ||
      (form.paymentArrangement === 'CHARGED_TO_CARD' && form.paidMethod !== 'CREDIT_CARD')) throw new Error('Choose an account matching the selected payment arrangement.');
  body.paymentArrangement = immediate ? 'ALREADY_PAID' : form.paymentArrangement || 'PAY_LATER';
  body.installments = body.paymentArrangement === 'INSTALLMENTS' ? form.installments || [] : [];
  body.dueDate = body.paymentArrangement === 'INSTALLMENTS' ? body.installments[0]?.dueDate : body.paymentArrangement === 'ALREADY_PAID' ? body.documentDate : form.dueDate;
  body.paidDetails = body.paymentArrangement === 'ALREADY_PAID' ? {
    accountId: form.paidAccountId, effectiveDate: form.paidDate, method: form.paidMethod, referenceNumber: form.paidReference || '',
  } : null;
  if (form.version) body.version = form.version;
  return body;
}
