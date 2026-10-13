import React from 'react';
import { moneyLabel, businessDate } from './financeApi.mjs';
import { ACCOUNT_GROUPS, ACCOUNT_LABELS, accountGroup, sumAccountBalances } from './accountPresentation.mjs';
import { FinanceStatus } from './FinanceRecords.jsx';

export default function FinanceAccountsList({ accounts, view, group, onGroup, showArchived, onArchived, onOpen, provisional }) {
  return <section className="finance-account-list">
    <div className="finance-account-summaries">{ACCOUNT_GROUPS.map((g) => {
      const active = accounts.filter((a) => a.active && accountGroup(a) === g.id);
      return <button type="button" key={g.id} className={`card card-body text-start ${group === g.id ? 'border-primary' : ''}`} aria-pressed={group === g.id} onClick={() => onGroup(group === g.id ? '' : g.id)}>
        <span>{g.id === 'card' ? 'Credit cards · Amount owed' : g.name}</span><strong>{moneyLabel(sumAccountBalances(active))}</strong>
      </button>;
    })}</div>
    <div className="finance-account-context text-secondary"><small>As of {businessDate()} · PHP · Recorded balances{provisional ? ' · Provisional' : ''}</small>
      <details><summary>About these balances</summary><p>Balances reflect posted Finance records. Company funds exclude credit-card debt and money awaiting Collector remittance. Profit is shown in Financial Reports.{provisional ? ' Starting balances and source cutover still require review.' : ''}</p></details>
    </div>
    {group && <button type="button" className="btn btn-sm btn-outline-secondary mb-2" onClick={() => onGroup('')}>Show all accounts</button>}
    {view.searchControl}
    <details className="finance-account-filters mb-3"><summary>Filters{showArchived ? ' · Includes archived' : ''}{view.hasFilters ? ' · Applied' : ''}</summary>
      {view.extraControls}<label><input type="checkbox" checked={showArchived} onChange={(e) => onArchived(e.target.checked)} /> Include archived accounts</label>
    </details>
    <div className="table-responsive"><table className="table table-vcenter finance-accounts-table"><thead><tr><th scope="col">Account</th><th scope="col" className="text-end">Balance (PHP)</th></tr></thead>
      <tbody>{view.items.map((a) => <tr key={a.id}><td><button type="button" className="btn btn-link p-0 text-start" onClick={() => onOpen(a)}>{a.name}</button>
        <small className="finance-code">{ACCOUNT_LABELS[a.kind]}{!a.active && <> · <FinanceStatus value="ARCHIVED" /></>}</small></td>
        <td className="text-end"><strong>{moneyLabel(a.balance)}</strong>{a.kind === 'CREDIT_CARD' && <small className="finance-code">Amount owed</small>}</td></tr>)}
        {!view.items.length && <tr><td colSpan="2">{accounts.some((a) => a.active || showArchived) ? 'No accounts match your filters.' : 'No accounts recorded yet.'}</td></tr>}
      </tbody></table></div>{view.pagination}
  </section>;
}
