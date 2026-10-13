import React, { useEffect, useRef, useState } from 'react';
import { businessDate, moneyLabel } from './financeApi.mjs';
import { cents } from './reportClient.mjs';
import { ACCOUNT_LABELS, sumAccountBalances } from './accountPresentation.mjs';
import { FinanceStatus, useRecordView } from './FinanceRecords.jsx';
import FinanceAccountHistory from './FinanceAccountHistory.jsx';

export function collectorAccounts(accounts) {
  return accounts.filter((a) => !a.system && a.kind.startsWith('COLLECTOR'));
}
export function pendingRemittanceTotal(accounts) {
  // Negative custody balances are exceptions, not reductions of another collector's debt.
  return sumAccountBalances(collectorAccounts(accounts).filter((a) => cents(a.balance) > 0n));
}
const state = (a) => cents(a.balance) > 0n ? 'PENDING_REMITTANCE' : cents(a.balance) < 0n ? 'OPEN_RECONCILIATION' : 'SETTLED';

export default function FinancePendingRemittances({ api, meta, accounts }) {
  const [includeSettled, setIncludeSettled] = useState(false), [activity, setActivity] = useState(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const has = (grant) => meta.permissionsGranted.includes('*') || meta.permissionsGranted.includes(grant);
  const view = useRecordView(collectorAccounts(accounts).filter((a) => includeSettled || cents(a.balance) !== 0n), { dates: false, statuses: ['PENDING_REMITTANCE', 'OPEN_RECONCILIATION', 'SETTLED'], getStatus: state });
  useEffect(() => () => { generation.current++; }, [meta.actorUsername, meta.permissionsGranted.join(',')]);
  async function open(account) {
    const request = ++generation.current;
    setError(''); setActivity(null); setLoading(true);
    try {
      const result = await api.request(`/api/finance/accounts/${account.id}/activity`);
      if (request === generation.current) setActivity(result);
    } catch (e) { if (request === generation.current) setError(e.message); }
    finally { if (request === generation.current) setLoading(false); }
  }
  if (!has('finance.accounts.view')) return <p>Your role does not grant collector balance access.</p>;
  return <section className="finance-pending-remittances" aria-label="Pending remittances">
    <div className="finance-toolbar"><h3>Pending remittances</h3>{has('collector.finance.view') && <a className="btn btn-outline-primary" href="/collector">Open Collector</a>}</div>
    <p>Money collected and awaiting confirmed remittance. Company account balances increase when the remittance is recorded; the customer receipt stays recorded once.</p>
    <p><strong>Pending total {moneyLabel(pendingRemittanceTotal(accounts))}</strong> · Posted Finance evidence as of {businessDate()} · PHP · Asia/Manila{meta.setupStatus === 'PENDING_REVIEWED_CUTOVER' && ' · Provisional'}</p>
    <p className="text-secondary">Collector owns remittance confirmation and discrepancies. Review source records there; this view shows the custody amounts currently posted in Finance.</p>
    {error && <div className="alert alert-danger" role="alert">{error}</div>}
    {view.controls}<label className="mb-3"><input type="checkbox" checked={includeSettled} onChange={(e) => setIncludeSettled(e.target.checked)} /> Include settled custody accounts</label>
    <div className="table-responsive"><table className="table table-striped table-vcenter"><thead><tr><th scope="col">Collector / account</th><th scope="col">Collection method</th><th scope="col">Pending amount (PHP)</th><th scope="col">Status</th><th scope="col">Evidence</th></tr></thead><tbody>
      {view.items.map((a) => <tr key={a.id}><td>{a.custodian || 'Person not recorded'}<small className="finance-code">{a.name}{!a.active && ' · Archived'}</small></td><td>{ACCOUNT_LABELS[a.kind]}</td><td>{moneyLabel(a.balance)}</td><td><FinanceStatus value={state(a)} /></td><td><button type="button" className="btn btn-sm btn-outline-primary" disabled={loading} onClick={() => open(a)}>View activity</button></td></tr>)}
      {!view.items.length && <tr><td colSpan="5">No pending collector remittances match this view in posted Finance records.</td></tr>}
    </tbody></table></div>{view.pagination}
    {collectorAccounts(accounts).some((a) => cents(a.balance) < 0n) && <p className="alert alert-warning">A custody account has a negative balance. Review the correction or discrepancy with Collector. It does not reduce another collector’s pending amount.</p>}
    {loading && <p role="status">Loading custody evidence…</p>}
    {activity && <section className="card"><div className="card-body"><button type="button" className="btn btn-sm btn-outline-secondary float-end" onClick={() => setActivity(null)}>Close activity</button><h3>{activity.account.custodian || activity.account.name} · {activity.account.name}</h3><p>Custody balance {moneyLabel(activity.balance)} as of {activity.asOf}</p><FinanceAccountHistory activity={activity} /></div></section>}
  </section>;
}
