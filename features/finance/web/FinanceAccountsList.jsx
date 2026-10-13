import React from 'react';
import { moneyLabel, businessDate } from './financeApi.mjs';
import { ACCOUNT_GROUPS, ACCOUNT_LABELS, accountGroup, latestCardBill, sumAccountBalances } from './accountPresentation.mjs';
import { FinanceStatus } from './FinanceRecords.jsx';

export default function FinanceAccountsList({ accounts, view, group, onGroup, showArchived, onArchived, onOpen, cardBills = [], hasCardAccess }) {
  return <section className="finance-account-list">
    <div className="finance-account-summaries">{ACCOUNT_GROUPS.map((g) => {
      const active = accounts.filter((a) => a.active && accountGroup(a) === g.id);
      return <button type="button" key={g.id} className={`card card-body text-start ${group === g.id ? 'border-primary' : ''}`} aria-pressed={group === g.id} onClick={() => onGroup(group === g.id ? '' : g.id)}>
        <span>{g.name}</span><strong>{moneyLabel(sumAccountBalances(active))}</strong><small>{g.balanceLabel} · {active.length} active accounts</small>
      </button>;
    })}</div>
    <p className="text-secondary">Recorded balances as of {businessDate()} · PHP · Posted Finance evidence. Collector money awaiting remittance is tracked in Income & Collections.</p>
    {group && <button type="button" className="btn btn-outline-secondary mb-3" onClick={() => onGroup('')}>Show all accounts</button>}
    {view.controls}<label className="mb-3"><input type="checkbox" checked={showArchived} onChange={(e) => onArchived(e.target.checked)} /> Include archived accounts</label>
    {ACCOUNT_GROUPS.filter((g) => !group || group === g.id).map((g) => <section key={g.id} aria-label={g.name} className="mb-4">
      <h3>{g.name}</h3><p className="text-secondary">{g.description}</p>
      <div className="table-responsive"><table className="table table-striped table-vcenter"><thead><tr><th scope="col">Account</th><th scope="col">Type / person responsible</th><th scope="col">{g.balanceLabel} (PHP)</th>{g.id === 'card' && <><th scope="col">Latest bill remaining</th><th scope="col">Next due</th></>}<th scope="col">Status</th></tr></thead>
        <tbody>{view.items.filter((a) => accountGroup(a) === g.id).map((a) => {
          const bill = latestCardBill(cardBills, a.id);
          return <tr key={a.id}><td><button type="button" className="btn btn-link p-0 text-start" onClick={() => onOpen(a)}>{a.name}</button></td><td>{ACCOUNT_LABELS[a.kind]}{a.custodian && <small className="finance-code">{a.custodian}</small>}</td><td>{moneyLabel(a.balance)}</td>
            {g.id === 'card' && <><td>{bill ? moneyLabel(bill.outstandingAmount) : hasCardAccess ? 'No bill recorded' : 'Bill access unavailable'}</td><td>{bill?.nextDueDate || '—'}</td></>}
            <td><FinanceStatus value={a.active ? 'ACTIVE' : 'ARCHIVED'} /></td></tr>;
        })}{!view.items.some((a) => accountGroup(a) === g.id) && <tr><td colSpan={g.id === 'card' ? 6 : 4}>No accounts in this group on the current page.</td></tr>}</tbody>
      </table></div>
    </section>)}{view.pagination}
  </section>;
}
