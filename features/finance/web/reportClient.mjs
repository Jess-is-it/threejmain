import { moneyLabel, businessDate } from './financeApi.mjs';
export const ACTIVE_LINES = new Set(['ACTIVE', 'PENDING_DISCONNECTION']);
export const REPORT_LABELS = {
  'cash-flow': 'Cash flow & balances', 'profit-and-loss': 'Revenue & profit', expenses: 'Expense analysis',
  payables: 'Supplier payables', receivables: 'Customer receivables', reconciliation: 'Reconciliation exceptions',
  collections: 'Receipt-month collections', transactions: 'Accounting transactions', subscribers: 'Subscriber growth',
  'billing-settlement': 'Bill-month settlement',
};
export const METRIC_LABELS = {
  earnedGrossRevenue: 'Earned revenue before reductions', contraRevenue: 'Revenue reductions', earnedRevenue: 'Earned revenue',
  totalExpenses: 'Recorded expenses, including direct costs', directCosts: 'Direct costs', grossProfit: 'Gross profit', operatingExpenses: 'Operating expenses', operatingProfit: 'Operating profit',
  nonoperatingIncome: 'Other income', nonoperatingExpense: 'Other expenses', financingExpense: 'Financing expenses',
  profitBeforeTax: 'Profit before tax', incomeTax: 'Income tax', netProfit: 'Net profit', grossMarginPercentage: 'Gross margin', operatingMarginPercentage: 'Operating margin',
  openingActiveLines: 'Opening active service lines', closingActiveLines: 'Closing active service lines', openingActiveCustomers: 'Opening active customers', closingActiveCustomers: 'Closing active customers',
  newActivations: 'New line activations', reactivations: 'Line reactivations', suspensions: 'Line suspensions', terminations: 'Line terminations', disconnections: 'Line disconnections', activeExits: 'Lines leaving active service',
  migrationBaselineAdjustment: 'Imported baseline adjustment', newSubscriberCustomers: 'New subscriber customers', customerEntries: 'Customers entering active service', customerExits: 'Customers leaving active service',
  netLineGrowth: 'Net active line growth', netCustomerGrowth: 'Net active customer growth', lineGrowthPercentage: 'Active line growth', customerGrowthPercentage: 'Active customer growth',
  monthlyRecurringRevenue: 'Monthly recurring revenue', customersWhoPaidDuringMonth: 'Customers who paid in receipt month',
};
export function humanLabel(value) { return String(value ?? '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()); }
export function metricLabel(key) { return METRIC_LABELS[key] || humanLabel(key); }
export function metricText(key, metric) {
  if (metric?.value == null) return metric?.status === 'NOT_APPLICABLE' ? 'Not applicable' : 'Unavailable';
  if (key.includes('Percentage')) return `${metric.value}%`;
  return key === 'monthlyRecurringRevenue' || key in METRIC_LABELS && !/Active|Activations|Reactivations|Suspensions|Terminations|Disconnections|Exits|Adjustment|Subscriber|Entries|Growth|Paid/i.test(key) ? moneyLabel(metric.value) : String(metric.value);
}
export function reportQuery({ month, asOf, basis = 'RECOGNIZED', groupBy = 'category', accountId }) {
  return new URLSearchParams({ month, asOf, basis, groupBy, ...(accountId ? { accountId } : {}) }).toString();
}
export function defaultPeriod() { const asOf = businessDate(); return { month: asOf.slice(0, 7), asOf, basis: 'RECOGNIZED', groupBy: 'category' }; }
export function reportWindowValid(period, today = businessDate()) {
  try { if (new Date(`${period.asOf}T00:00:00Z`).toISOString().slice(0, 10) !== period.asOf) return false; } catch { return false; }
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(period.month) && period.month >= '1900-01' && /^\d{4}-\d{2}-\d{2}$/.test(period.asOf) && period.asOf >= `${period.month}-01` && period.asOf <= today;
}
export function cents(value) {
  if (value == null) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(String(value))) throw new Error('Invalid exact chart amount.');
  const text = String(value), negative = text.startsWith('-'), [whole, fraction = ''] = text.replace(/^-/, '').split('.');
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) * (negative ? -1n : 1n);
}
export function chartScale(values) {
  const exact = values.map(cents), present = exact.filter((v) => v != null);
  let min = 0n, max = 0n;
  for (const v of present) { if (v < min) min = v; if (v > max) max = v; }
  const range = max - min || 100n;
  const position = (v) => v == null ? null : Number((v - min) * 1000000n / range) / 1000000;
  return { positions: exact.map(position), zero: position(0n), min, max, empty: !present.length };
}
export function topExpenseGroups(report, limit = 8) {
  return [...(report?.groups || [])].sort((a, b) => cents(a.amount) === cents(b.amount) ? a.id.localeCompare(b.id) : cents(a.amount) > cents(b.amount) ? -1 : 1).slice(0, limit);
}
export function subscriberSupportingRows(report, key) {
  if (key === 'monthlyRecurringRevenue') return report.monthlyRateRows || [];
  if (key === 'customersWhoPaidDuringMonth') return report.receiptMonth?.rows || [];
  if (key.startsWith('opening')) return (report.openingLines || []).filter((r) => ACTIVE_LINES.has(r.status));
  if (key.startsWith('closing')) return (report.closingLines || []).filter((r) => ACTIVE_LINES.has(r.status));
  const eventKinds = { newActivations: 'ACTIVATION', reactivations: 'REACTIVATION', suspensions: 'SUSPENSION', terminations: 'TERMINATION', disconnections: 'DISCONNECTION', migrationBaselineAdjustment: 'MIGRATION_BASELINE' };
  if (eventKinds[key]) return (report.events || []).filter((r) => r.kind === eventKinds[key]);
  if (key === 'newSubscriberCustomers') return (report.events || []).filter((r) => r.projection?.newCustomer);
  if (key === 'activeExits') return (report.events || []).filter((r) => r.projection?.leaving && r.kind !== 'MIGRATION_BASELINE');
  if (key === 'customerEntries' || key === 'customerExits') return (report.events || []).filter((r) => r.projection?.[key] > 0);
  return [...(report.openingLines || []).filter((r) => ACTIVE_LINES.has(r.status)).map((r) => ({ ...r, boundary: 'Opening' })), ...(report.closingLines || []).filter((r) => ACTIVE_LINES.has(r.status)).map((r) => ({ ...r, boundary: 'Closing' })), ...(report.events || [])];
}
export function hasGrant(meta, grant) { return Boolean(meta?.permissionsGranted?.includes('*') || meta?.permissionsGranted?.includes(grant)); }
export function canReadFinancial(meta) {
  return meta?.reportScopesUnrestricted !== false && ['finance.reports.financial.view', 'finance.accounts.view', 'finance.journals.view', 'finance.expenses.view', 'finance.expenses.view_all', 'finance.income.view', 'finance.income.view_all'].every((grant) => hasGrant(meta, grant));
}

export function withinApprovalLimit(meta, amount) {
  if (meta?.approvalLimit == null) return true;
  try { return cents(amount) <= cents(meta.approvalLimit); } catch { return false; }
}
