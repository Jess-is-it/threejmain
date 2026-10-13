import React from 'react';
import { moneyLabel } from './financeApi.mjs';
import { pendingStartingBalances, startingBalanceLabel } from './accountPresentation.mjs';
import { FinanceStatus } from './FinanceRecords.jsx';

export default function FinanceStartingBalanceStatus({ openings = [], accountId, onReview, disabled, canApplyDeclaration }) {
  const pending = pendingStartingBalances(openings, accountId);
  if (!pending.length) return null;
  return <div className="finance-starting-balance-status">
    {pending.map((o) => <small className="finance-code" key={o.id}>Starting balance {moneyLabel(o.amount)} · <FinanceStatus value={startingBalanceLabel(o, canApplyDeclaration)} /></small>)}
    <button type="button" className="btn btn-link btn-sm p-0" disabled={disabled} onClick={onReview}>Review starting balance</button>
  </div>;
}
