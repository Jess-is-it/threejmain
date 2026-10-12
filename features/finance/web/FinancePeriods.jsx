import React, { useCallback, useEffect, useState } from 'react';
import FinanceDialog from './FinanceDialog.jsx';
import { FinanceStatus } from './FinanceRecords.jsx';
import { hasGrant, humanLabel } from './reportClient.mjs';
import { businessDate } from './financeApi.mjs';

const LABELS = { bankStatements: 'Bank and wallet statements reconciled', cashCounts: 'Cash and petty-cash counts verified', collectorCustody: 'Collector custody and remittances reconciled', openingBalances: 'Opening balances and import boundary reconciled', subledgerTies: 'Receivables and payables agree with source records', recognitionAndCosts: 'Earned revenue, direct costs and inventory valuation complete', depreciationAccrualsAndTax: 'Depreciation, accruals, financing and taxes reviewed' };
export default function FinancePeriods({ api, meta, month, disabled, onChanged, onBusyChange, onPendingChange }) {
  const [record, setRecord] = useState(null), [version, setVersion] = useState(0), [loading, setLoading] = useState(true), [error, setError] = useState(''), [dialog, setDialog] = useState(null), [busy, setBusy] = useState(false), [history, setHistory] = useState(null);
  const [reason, setReason] = useState(''), [evidence, setEvidence] = useState(''), [checks, setChecks] = useState({});
  const permitted = hasGrant(meta, 'finance.periods.view') && meta.reportScopesUnrestricted && hasGrant(meta, 'finance.reports.subscribers.view');
  useEffect(() => {
    if (!permitted) return;
    let active = true; setRecord(null); setHistory(null); setError(''); setLoading(true);
    api.request('/api/finance/periods').then((rows) => { if (active) setRecord(rows.find((r) => r.month === month) || null); }).catch((e) => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, month, permitted, version]);
  const close = useCallback(() => setDialog(null), []);
  function start(action) { setReason(''); setEvidence(''); setChecks({}); setError(''); setDialog(action); }
  async function submit(event) {
    event.preventDefault(); setBusy(true); onBusyChange(true); setError('');
    try {
      const payload = { reason, evidenceReference: evidence, ...(dialog === 'prepare' ? { checklist: checks } : { version: record.version }) };
      await api.mutate(`/api/finance/periods/${month}/${dialog}`, 'POST', payload); onPendingChange(null); setDialog(null); setVersion((v) => v + 1); onChanged();
    } catch (e) { setError(e.message); try { onPendingChange(api.pending()); } catch (failure) { setError(failure.message); } }
    finally { setBusy(false); onBusyChange(false); }
  }
  async function openHistory() {
    try { const detail = await api.request(`/api/finance/periods/${month}`); setHistory(detail.history); setDialog('history'); }
    catch (e) { setError(e.message); }
  }
  if (!permitted) return null;
  const status = record?.status || 'OPEN', blocked = disabled || busy || loading, completed = month < businessDate().slice(0, 7);
  return <section className="card mb-3 finance-no-print" aria-label="Financial period controls"><div className="card-body"><h4>Financial period — {month}</h4><FinanceStatus value={status} /><p>Preparing reconciliation locks new postings for this month. Closing requires a different authorized reviewer. Reopening preserves every published revision and requires a correction reason and evidence.</p>
    <div className="finance-toolbar">
      {status === 'OPEN' && hasGrant(meta, 'finance.periods.prepare') && <button className="btn btn-outline-primary" disabled={blocked || !completed} onClick={() => start('prepare')}>Prepare month closing</button>}
      {status === 'CLOSING' && hasGrant(meta, 'finance.periods.close') && <button className="btn btn-primary" disabled={blocked || record.preparedBy === meta.actorUsername} onClick={() => start('close')}>Close reconciled month</button>}
      {status !== 'OPEN' && hasGrant(meta, 'finance.periods.reopen') && <button className="btn btn-outline-warning" disabled={blocked} onClick={() => start('reopen')}>Reopen for correction</button>}
      {record && <button className="btn btn-outline-secondary" disabled={blocked} onClick={openHistory}>View period audit trail</button>}
    </div>
    {!completed && <p>Only a completed calendar month can be prepared or closed.</p>}
    {record && <p>Revision {record.version} · Prepared by {record.preparedBy}{record.closedBy && ` · Closed by ${record.closedBy}`} · Evidence: {record.evidenceReference}</p>}
    {error && !dialog && <p className="alert alert-danger" role="alert">{error}</p>}
    {dialog && <FinanceDialog title={dialog === 'history' ? `Period audit trail — ${month}` : `${humanLabel(dialog)} financial period — ${month}`} busy={busy} disabled={blocked} onClose={close} onSubmit={submit} error={error} footer={dialog === 'history' ? <button type="button" className="btn btn-outline-secondary" onClick={close}>Close audit trail</button> : undefined}>
      {dialog === 'history' ? <div className="table-responsive"><table className="table"><thead><tr><th>Revision</th><th>Action</th><th>Actor / time</th><th>Reason / evidence</th><th>Publication</th></tr></thead><tbody>{history?.map((event) => <tr key={event.id}><td>{event.version}</td><td>{humanLabel(event.operation)}</td><td>{event.actor}<br />{event.createdAt}</td><td>{event.record.actionReason || event.record.reason}<br />{event.record.actionEvidenceReference || event.record.evidenceReference}</td><td>{event.operation === 'CLOSE' ? 'Retained published reports' : 'Retained reconciliation revision'}</td></tr>)}</tbody></table></div> : <>
        <label className="form-label">Reason<textarea className="form-control" required minLength={5} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <label className="form-label">Reconciliation or correction evidence reference<input className="form-control" required maxLength={500} value={evidence} onChange={(e) => setEvidence(e.target.value)} /></label>
        {dialog === 'prepare' && <><p>Complete accounting coverage and source recovery are checked by the server. These checks record your review of the supporting evidence.</p>{(meta.periodChecks || Object.keys(LABELS)).map((key) => <label key={key} className="form-check"><input type="checkbox" className="form-check-input" required checked={Boolean(checks[key])} onChange={(e) => setChecks({ ...checks, [key]: e.target.checked })} /><span className="form-check-label">{LABELS[key] || humanLabel(key)}</span></label>)}</>}
      </>}
    </FinanceDialog>}
  </div></section>;
}
