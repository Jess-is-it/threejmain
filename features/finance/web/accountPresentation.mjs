import { cents } from './reportClient.mjs';

export const ACCOUNT_LABELS = {
  CASH: 'Cash', PETTY_CASH: 'Petty cash', COMPANY_GCASH: 'Company GCash', BANK: 'Bank',
  COLLECTOR_CASH: 'Collector cash', COLLECTOR_GCASH: 'Collector GCash due',
  CREDIT_CARD: 'Credit card', GENERAL_LEDGER: 'Accounting account',
};
export const ACCOUNT_GROUPS = [
  { id: 'company', name: 'Company funds', balanceLabel: 'Recorded balance', description: 'Cash, bank and company GCash balances recorded in Finance.' },
  { id: 'card', name: 'Credit cards', balanceLabel: 'Amount owed', description: 'Card debt is shown separately from company funds.' },
];
export function accountGroup(account) {
  if (account.kind === 'GENERAL_LEDGER') return 'ledger';
  if (account.kind === 'CREDIT_CARD') return 'card';
  return account.kind.startsWith('COLLECTOR') ? 'collector' : 'company';
}
export function suggestedTransferMethod(from, to) {
  if (to?.kind === 'CREDIT_CARD') return 'CARD_SETTLEMENT';
  if (from?.kind === 'CREDIT_CARD') return 'CARD_FUNDING';
  if ([from, to].some((a) => a?.kind === 'BANK')) return 'BANK_TRANSFER';
  if ([from, to].some((a) => a?.kind.includes('GCASH'))) return 'GCASH_TRANSFER';
  return 'CASH_HANDOVER';
}
export const TRANSFER_LABELS = {
  CASH_HANDOVER: 'Cash handover', GCASH_TRANSFER: 'GCash transfer', BANK_TRANSFER: 'Bank transfer',
  CARD_SETTLEMENT: 'Credit-card repayment', CARD_FUNDING: 'Cash from credit card', OTHER: 'Other movement',
};
export function movementAmounts(row, card = false, original = null) {
  // Openings establish a baseline; they are not ordinary receipts or card charges.
  if (['OPENING_BALANCE', 'OPENING'].includes(row.kind) || ['OPENING_BALANCE', 'OPENING'].includes(original?.kind)) return { in: null, out: null, label: 'Starting balance' };
  return { in: card ? row.credit : row.debit, out: card ? row.debit : row.credit, label: row.reversalOfId ? 'Correction / reversal' : row.reason };
}
export function latestCardBill(records, accountId) {
  return records.filter((r) => r.accountId === accountId && r.status !== 'SUPERSEDED')
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
}
export function sumAccountBalances(accounts) {
  const value = accounts.reduce((total, a) => total + cents(a.balance || '0.00'), 0n);
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

export function pendingStartingBalances(openings, accountId) {
  return openings.filter((o) => o.accountId === accountId && !o.journalId && !o.reversed && ['DRAFT', 'APPROVED'].includes(o.status));
}

export function startingBalanceLabel(opening, canApplyDeclaration = false) {
  if (opening.reversed) return 'REVERSED';
  if (opening.status === 'DRAFT' && opening.evidenceType === 'OPERATOR_DECLARATION' && canApplyDeclaration) return 'READY_TO_APPLY';
  return { DRAFT: 'PENDING_APPROVAL', APPROVED: 'READY_TO_APPLY', POSTED: 'POSTED' }[opening.status] || opening.status;
}
