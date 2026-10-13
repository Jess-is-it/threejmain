import React, { useCallback, useEffect, useState } from 'react';
import FinanceDialog from './FinanceDialog.jsx';
import { FinanceStatus, useRecordView } from './FinanceRecords.jsx';
import InstallmentEditor from './InstallmentEditor.jsx';
import { businessDate, moneyLabel, newReference } from './financeApi.mjs';

export default function FinanceCards({ api, meta, accounts, refreshVersion, pending, onPendingChange, onBusyChange, onSaved }) {
  const [records, setRecords] = useState([]), [selected, setSelected] = useState(null), [dialog, setDialog] = useState(null), [form, setForm] = useState({});
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [transfers, setTransfers] = useState([]);
  const has = (p) => meta.permissionsGranted.includes(p) || meta.permissionsGranted.includes('*');
  const close = useCallback(() => setDialog(null), []);
  const allowed = has('finance.accounts.view') && has('finance.transfers.view');
  async function load() {
    setLoading(true);
    try { setRecords(await api.request('/api/finance/card-statements')); } finally { setLoading(false); }
  }
  useEffect(() => { if (allowed) load().catch((e) => setError(e.message)); else { setRecords([]); setLoading(false); } }, [api, refreshVersion, meta.actorUsername, meta.permissionsGranted.join(',')]);
  const disabled = busy || loading || Boolean(pending);
  const view = useRecordView(records, { getDate: (r) => r.periodEnd, statuses: ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'SUPERSEDED'] });
  const detail = records.find((r) => r.id === selected);
  function start(type, record) {
    setError(''); setNotice(''); setDialog({ type, record });
    const today = businessDate();
    setForm(type === 'create' ? { accountId: '', statementReference: '', periodStart: `${today.slice(0, 7)}-01`, periodEnd: today, dueDate: today, statementBalance: '', evidenceReference: '', installments: [], scheduled: false }
      : type === 'correct' ? { ...record, statementReference: '', correctionReason: '', scheduled: Boolean(record.installments?.length) }
        : type === 'link' ? { journalId: '', reason: 'Allocate verified existing card repayment' }
          : type === 'repay' ? { fromAccountId: '', effectiveDate: today, amount: record.nextDueAmount || record.outstandingAmount, sourceReference: newReference(), referenceNumber: '', reason: 'Credit-card bill repayment' }
          : { effectiveDate: today, reason: '' });
    if (type === 'link') {
      setTransfers([]);
      api.request('/api/finance/transfers').then((rows) => setTransfers(rows.filter((r) => r.metadata.method === 'CARD_SETTLEMENT' && r.metadata.toAccountId === record.accountId && r.sourceNamespace === 'finance.transfer' && !r.reversedByEntryId && r.effectiveDate >= record.periodEnd))).catch((e) => setError(e.message));
    }
  }
  async function submit(event) {
    event.preventDefault(); setBusy(true); onBusyChange(true); setError('');
    const { type, record } = dialog;
    let body = form, path;
    try {
      if (['create', 'correct'].includes(type)) {
        if (form.scheduled && form.installments.length < 2) throw new Error('Create and review the installment schedule before saving.');
        body = Object.fromEntries(['accountId', 'statementReference', 'periodStart', 'periodEnd', 'dueDate', 'statementBalance', 'evidenceReference'].map((k) => [k, form[k]]));
        body.installments = form.scheduled ? form.installments : [];
        path = type === 'create' ? '/api/finance/card-statements' : `/api/finance/card-statements/${record.id}/correct`;
        if (type === 'correct') body.correctionReason = form.correctionReason;
      } else path = type === 'link' ? `/api/finance/card-statements/${record.id}/link-repayment` : type === 'repay' ? `/api/finance/card-statements/${record.id}/repayments` : `/api/finance/card-repayments/${record.id}/reverse`;
      const result = await api.mutate(path, 'POST', body);
      onPendingChange(null); setDialog(null); setNotice(result.idempotentReplay ? 'Existing action confirmed.' : 'Card action saved.');
      if (['create', 'correct'].includes(type)) setSelected(result.id);
      await onSaved(); await load();
    } catch (e) { setError(e.message); try { onPendingChange(api.pending()); } catch (storageError) { setError(storageError.message); } }
    finally { setBusy(false); onBusyChange(false); }
  }
  const field = (key, label, props = {}) => <label className="finance-field"><span>{label}</span><input className="form-control" required value={form[key] || ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} /></label>;
  const accountSelect = (key, label, options) => <label className="finance-field"><span>{label}</span><select className="form-select" required value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}><option value="">Choose account</option>{options.map((a) => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label>;
  if (!allowed) return <p>Your role does not grant credit-card bill access.</p>;
  return <section className="finance-cards">
    {error && <div className="alert alert-danger" role="alert">{error}</div>}{notice && <div className="alert alert-success" role="status">{notice}</div>}
    <div className="finance-toolbar"><h3>Credit-card bills</h3>{has('finance.accounts.manage') && <button className="btn btn-primary" disabled={disabled} onClick={() => start('create')}>Add card bill</button>}</div>
    <p>Card purchases pay the supplier and increase card debt. Bill repayments reduce that debt. Neither adding a bill nor repaying it records another expense. The latest bill carries forward any previous balance; earlier bills stay in history.</p>
    {loading ? <p role="status">Loading card bills…</p> : <>{view.controls}<div className="table-responsive"><table className="table table-striped"><thead><tr><th>Card / bill</th><th>Closing date</th><th>Next due date</th><th>Bill amount</th><th>Allocated repayments</th><th>Bill remaining</th><th>Status</th></tr></thead><tbody>{view.items.map((r) => <tr key={r.id}><td><button className="btn btn-link btn-sm" onClick={() => setSelected(r.id)}>{r.accountSnapshot.name} · {r.statementReference}</button></td><td>{r.periodEnd}</td><td>{r.nextDueDate || '—'}</td><td>{moneyLabel(r.statementBalance)}</td><td>{moneyLabel(r.paidAmount)}</td><td>{moneyLabel(r.outstandingAmount)}</td><td><FinanceStatus value={r.status} /></td></tr>)}{!view.items.length && <tr><td colSpan="7">No card bills in your permitted scope. Add the bill when the card company issues it.</td></tr>}</tbody></table></div>{view.pagination}</>}
    {detail && <div className="card"><div className="card-body"><button className="btn btn-outline-secondary btn-sm float-end" onClick={() => setSelected(null)}>Close bill</button><h3>{detail.accountSnapshot.name} · {detail.statementReference}</h3>
      <p>Statement period {detail.periodStart} to {detail.periodEnd} · Due {detail.dueDate} · <FinanceStatus value={detail.status} /></p>
      <p>Bill remaining {moneyLabel(detail.outstandingAmount)} · Current card debt in the journal {moneyLabel(detail.cardBalance)}.</p>
      <p>Evidence: {detail.evidenceReference}. Recorded by {detail.createdBy}. {detail.correctsStatementId && `Correction: ${detail.correctionReason}`}</p>
      {detail.statementVariance !== '0.00' && <p className="alert alert-warning">Bill differs from the journal at closing by {moneyLabel(detail.statementVariance)}. Reconcile missing charges, fees or payments before repayment. Adding this bill does not change the journal.</p>}
      <p>Bill balances include only allocated repayments. Link repayments already made in Transfers to avoid entering the same movement again. Current card debt also includes later purchases and corrections.</p>
      {detail.status !== 'SUPERSEDED' && <div className="finance-actions">{has('finance.transfers.post') && detail.outstandingAmount !== '0.00' && <><button className="btn btn-primary" disabled={disabled} onClick={() => start('repay', detail)}>Record card repayment</button><button className="btn btn-outline-primary" disabled={disabled} onClick={() => start('link', detail)}>Link existing repayment</button></>}{has('finance.accounts.manage') && detail.paidAmount === '0.00' && <button className="btn btn-outline-secondary" disabled={disabled} onClick={() => start('correct', detail)}>Correct bill</button>}</div>}
      <div className="table-responsive"><table className="table"><thead><tr><th>Due date</th><th>Scheduled amount</th><th>Allocated</th><th>Remaining</th></tr></thead><tbody>{detail.settlementSchedule.map((r) => <tr key={r.number}><td>{r.dueDate}</td><td>{moneyLabel(r.amount)}</td><td>{moneyLabel(r.paidAmount)}</td><td>{moneyLabel(r.outstandingAmount)}</td></tr>)}</tbody></table></div>
      <h4>Repayments</h4><div className="table-responsive"><table className="table"><thead><tr><th>Date / source account</th><th>Amount / reference</th><th>Posted by</th><th>Correction</th></tr></thead><tbody>{detail.repayments.map((r) => <tr key={r.id}><td>{r.effectiveDate}<small className="finance-code">{r.fromAccountSnapshot.name}</small></td><td>{moneyLabel(r.amount)}<small className="finance-code">{r.referenceNumber}</small></td><td>{r.createdBy}</td><td>{r.reversalJournalId ? 'Reversed' : has('finance.journals.reverse') && <button className="btn btn-outline-danger btn-sm" disabled={disabled} onClick={() => start('reverse', r)}>Reverse repayment</button>}</td></tr>)}{!detail.repayments.length && <tr><td colSpan="4">No repayments visible in your account scope.</td></tr>}</tbody></table></div>
    </div></div>}
    {dialog && <FinanceDialog title={dialog.type === 'create' ? 'Add card bill' : dialog.type === 'correct' ? 'Correct card bill' : dialog.type === 'link' ? 'Link existing card repayment' : dialog.type === 'repay' ? 'Record card repayment' : 'Reverse card repayment'} onClose={close} onSubmit={submit} busy={busy} disabled={disabled} error={error}>
      {['create', 'correct'].includes(dialog.type) && <>{dialog.type === 'create' ? accountSelect('accountId', 'Credit-card account', accounts.filter((a) => a.active && a.kind === 'CREDIT_CARD')) : <p>{dialog.record.accountSnapshot.name} · Original closing date {dialog.record.periodEnd}. Previous evidence remains retained.</p>}{field('statementReference', 'Bill reference', { maxLength: 160 })}{field('statementBalance', 'Full statement balance (PHP)', { inputMode: 'decimal', pattern: '\\d+(\\.\\d{1,2})?' })}{field('periodStart', 'Statement period start', { type: 'date' })}{dialog.type === 'create' && field('periodEnd', 'Statement closing date', { type: 'date', min: form.periodStart, max: businessDate() })}{field('dueDate', 'Bill due date', { type: 'date', min: form.periodEnd })}{field('evidenceReference', 'Statement evidence reference', { maxLength: 160 })}
        <label><input type="checkbox" checked={form.scheduled} onChange={(e) => setForm({ ...form, scheduled: e.target.checked })} /> Agreed installment plan for this bill</label>{form.scheduled && <InstallmentEditor form={form} onChange={setForm} total={form.statementBalance} onError={setError} />}
        {dialog.type === 'correct' && field('correctionReason', 'Correction reason', { minLength: 3, maxLength: 1000 })}<p>Enter the issuer's full outstanding balance, including carried balances. Fees and interest must be recorded as separate reviewed expenses. A statement is tracking evidence, not a new charge.</p></>}
      {dialog.type === 'repay' && <>{accountSelect('fromAccountId', 'Pay from account', accounts.filter((a) => a.active && !['CREDIT_CARD', 'GENERAL_LEDGER'].includes(a.kind)))}{field('amount', 'Repayment amount (PHP)', { inputMode: 'decimal', pattern: '\\d+(\\.\\d{1,2})?' })}{field('effectiveDate', 'Actual repayment date', { type: 'date', min: dialog.record.periodEnd, max: businessDate() })}{field('referenceNumber', 'Bank / wallet payment reference', { maxLength: 160 })}{field('reason', 'Purpose / evidence', { minLength: 3, maxLength: 1000 })}<p>This moves funds to repay the card. It does not create another expense.</p></>}
      {dialog.type === 'link' && <><label className="finance-field"><span>Existing repayment transfer</span><select className="form-select" required value={form.journalId} onChange={(e) => setForm({ ...form, journalId: e.target.value })}><option value="">Choose transfer</option>{transfers.map((t) => <option key={t.id} value={t.id}>#{t.number} · {t.effectiveDate} · {moneyLabel(t.metadata.amount)} · {t.metadata.referenceNumber}</option>)}</select></label>{field('reason', 'Allocation reason / evidence', { minLength: 3, maxLength: 1000 })}<p>Links retained evidence only. It posts no new transfer, income or expense.</p></>}
      {dialog.type === 'reverse' && <>{field('effectiveDate', 'Correction date', { type: 'date', min: dialog.record.effectiveDate, max: businessDate() })}{field('reason', 'Correction reason and evidence', { minLength: 3, maxLength: 1000 })}</>}
    </FinanceDialog>}
  </section>;
}
