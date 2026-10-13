import React from 'react';
import { moneyLabel } from './financeApi.mjs';
import { movementAmounts } from './accountPresentation.mjs';
import { useRecordView } from './FinanceRecords.jsx';

export default function FinanceAccountHistory({ activity }) {
  const card = activity.account.kind === 'CREDIT_CARD';
  const view = useRecordView(activity.items, { resetKey: activity.account.id });
  return <section className="finance-account-history"><h3>Transaction history</h3>
    <p className="text-secondary">Posted Finance records · PHP · Asia/Manila · As of {activity.asOf}</p>
    {view.controls}<div className="table-responsive"><table className="table table-striped table-vcenter"><thead><tr>
      <th scope="col">Date / entry</th><th scope="col">Purpose</th><th scope="col">{card ? 'Charges' : 'Money in'}</th><th scope="col">{card ? 'Repayments' : 'Money out'}</th><th scope="col">{card ? 'Amount owed' : 'Balance'}</th><th scope="col">Details</th>
    </tr></thead><tbody>{view.items.map((row, index) => {
      const movement = movementAmounts(row, card, activity.items.find((r) => r.entryId === row.reversalOfId));
      return <tr key={`${row.entryId}-${index}`}><td>{row.effectiveDate}<small className="finance-code">#{row.number}</small></td><td>{movement.label}</td>
        <td>{movement.in === null || movement.in === '0.00' ? '—' : moneyLabel(movement.in)}</td><td>{movement.out === null || movement.out === '0.00' ? '—' : moneyLabel(movement.out)}</td><td>{moneyLabel(row.balance)}</td>
        <td><details><summary>Accounting details</summary><p className="mb-0">Debit {moneyLabel(row.debit)} · Credit {moneyLabel(row.credit)}<br />Posted by {row.postedBy}<br />{row.reason}</p></details></td></tr>;
    })}{!view.items.length && <tr><td colSpan="6">No posted transactions match this view.</td></tr>}</tbody></table></div>{view.pagination}
  </section>;
}
