import { cents } from './reportClient.mjs';

// UI-only fields never become editable account balance or accounting evidence.
export function accountCreateBody(form) {
  const { startingBalanceAmount, startingBalanceDate, ...account } = form;
  const amount = String(startingBalanceAmount || '').trim();
  if (account.kind === 'GENERAL_LEDGER' || !amount) return account;
  if (!/^\d+(\.\d{1,2})?$/.test(amount)) throw new Error('Enter a non-negative starting balance with at most two decimal places.');
  if (cents(amount) === 0n) return account;
  if (!startingBalanceDate) throw new Error('Choose the starting-balance date.');
  return { ...account, startingBalance: { amount, effectiveDate: startingBalanceDate } };
}
