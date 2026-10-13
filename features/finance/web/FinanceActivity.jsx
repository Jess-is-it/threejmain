import React, { useCallback, useEffect, useRef, useState } from 'react';
import { businessDate, moneyLabel } from './financeApi.mjs';
import FinanceDialog from './FinanceDialog.jsx';
import { FinanceStatus } from './FinanceRecords.jsx';

const TYPES = [['MONEY_IN', 'Money in'], ['MONEY_OUT', 'Money out'], ['TRANSFER', 'Transfers'],
  ['CARD_PURCHASE', 'Card purchases'], ['CARD_CREDIT', 'Card credits'], ['OPENING', 'Opening balances'], ['CORRECTION', 'Corrections without money movement']];
const initialFilters = () => ({ search: '', fromDate: '', throughDate: businessDate(), accountId: '', type: '', limit: '25' });
const endpointNames = (accounts, fallback) => accounts.length ? accounts.map((a) => a.name).join(', ') : fallback;

export default function FinanceActivity({ api, meta, refreshVersion, onOpenPayable, onOpenWorkspace }) {
  const [draft, setDraft] = useState(initialFilters), [filters, setFilters] = useState(initialFilters);
  const [offset, setOffset] = useState(0), [version, setVersion] = useState(0);
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [detail, setDetail] = useState(null), [detailError, setDetailError] = useState(''), [detailLoading, setDetailLoading] = useState(false);
  const detailRequest = useRef(0);
  const has = (grant) => meta.permissionsGranted.includes(grant) || meta.permissionsGranted.includes('*');
  const allowed = ['finance.view', 'finance.accounts.view', 'finance.journals.view'].every(has);
  const close = useCallback(() => { detailRequest.current += 1; setDetail(null); setDetailLoading(false); setDetailError(''); }, []);
  useEffect(() => () => { detailRequest.current += 1; }, []);
  useEffect(() => {
    let active = true;
    close(); setData(null); setError(''); setLoading(allowed);
    if (allowed) {
      const params = new URLSearchParams({ offset: String(offset) });
      for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
      api.request('/api/finance/activity?' + params).then((result) => { if (active) setData(result); })
        .catch((e) => { if (active) setError(e.message); })
        .finally(() => { if (active) setLoading(false); });
    }
    return () => { active = false; };
  }, [api, allowed, meta.actorUsername, meta.permissionsGranted.join(','), filters, offset, version, refreshVersion, close]);

  async function open(row) {
    const requestId = ++detailRequest.current;
    setDetail(row); setDetailLoading(true); setDetailError('');
    try {
      const result = await api.request(`/api/finance/activity/${row.id}`);
      if (requestId === detailRequest.current) setDetail(result);
    } catch (e) { if (requestId === detailRequest.current) setDetailError(e.message); }
    finally { if (requestId === detailRequest.current) setDetailLoading(false); }
  }
  function apply(event) { event.preventDefault(); setOffset(0); setFilters({ ...draft }); }
  function clear() { const defaults = initialFilters(); setDraft(defaults); setFilters(defaults); setOffset(0); }
  const field = (key, label, props = {}) => <label>{label}<input className="form-control" value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} {...props} /></label>;
  const support = detail?.supportingRecord;
  if (!allowed) return <section className="finance-activity"><p>Your role needs account and journal viewing access to see transaction history.</p></section>;
  return <section className="finance-activity" aria-label="Finance transaction history">
    <div className="finance-toolbar"><div><p>Money in, money out and transfers — all in one transaction history.</p></div>
      <button type="button" className="btn btn-outline-primary" disabled={loading} onClick={() => setVersion((v) => v + 1)}>Refresh activity</button></div>
    <form className="finance-record-controls" onSubmit={apply}>
      {field('search', 'Search transactions', { type: 'search', maxLength: 160, placeholder: 'Description, reference, account or person' })}
      {field('fromDate', 'From date', { type: 'date', max: draft.throughDate })}
      {field('throughDate', 'Through date', { type: 'date', min: draft.fromDate, max: businessDate(), required: true })}
      <label>Account<select aria-label="Account" className="form-select" value={draft.accountId} onChange={(e) => setDraft({ ...draft, accountId: e.target.value })}><option value="">All permitted accounts</option>
        {(data?.accounts || []).map((a) => <option key={a.id} value={a.id}>{a.name}{a.active ? '' : ' (archived)'}</option>)}</select></label>
      <label>Activity type<select aria-label="Activity type" className="form-select" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}><option value="">All activity</option>{TYPES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>Rows<select aria-label="Rows" className="form-select" value={draft.limit} onChange={(e) => setDraft({ ...draft, limit: e.target.value })}>{[10, 25, 50, 100].map((n) => <option key={n}>{n}</option>)}</select></label>
      <button className="btn btn-primary" type="submit" disabled={loading}>Apply filters</button><button className="btn btn-outline-secondary" type="button" onClick={clear}>Clear filters</button>
    </form>
    <p className="text-secondary">Posted transactions · PHP · Dates in Asia/Manila. Money received is separate from earned revenue. Card purchases increase debt; opening balances are starting funds.</p>
    {error && <div className="alert alert-danger" role="alert">{error} <button className="btn btn-sm btn-outline-danger" type="button" onClick={() => setVersion((v) => v + 1)}>Retry activity</button></div>}
    {loading ? <p role="status">Loading transaction history…</p> : data && <>
      <div className="table-responsive"><table className="table table-striped table-vcenter finance-activity-table"><thead><tr><th>Date</th><th>Activity</th><th>Description / reference</th><th>From</th><th>To</th><th className="text-end">Amount (PHP)</th></tr></thead><tbody>
        {data.items.map((row) => <tr key={row.id}><td data-label="Date">{row.effectiveDate}</td><td data-label="Activity"><span className={`badge bg-${row.type === 'MONEY_IN' ? 'green' : row.type === 'MONEY_OUT' ? 'red' : 'blue'}-lt`}>{row.label}</span>{row.status !== 'POSTED' && <small className="finance-code"><FinanceStatus value={row.status} /></small>}</td>
          <td data-label="Description"><button type="button" className="finance-value-link" onClick={() => open(row)}>{row.description}</button><small className="finance-code">#{row.number} · {row.reference}</small><small className="finance-code">Recorded by {row.postedBy}</small></td>
          <td data-label="From">{endpointNames(row.from, row.counterparty)}</td><td data-label="To">{endpointNames(row.to, row.counterparty)}</td><td data-label="Amount (PHP)" className="text-end text-nowrap">{moneyLabel(row.amount)}</td></tr>)}
        {!data.items.length && <tr><td colSpan="6"><p className="my-3">{data.total ? 'No transactions on this page. Use Previous or clear filters.' : 'No posted transactions match these filters. Pending expenses and approvals appear in their own workspaces.'}</p></td></tr>}
      </tbody></table></div>
      <div className="finance-pagination" aria-label="Activity pagination"><span role="status">{data.items.length ? `${offset + 1}–${offset + data.items.length}` : '0'} of {data.total} transactions</span>
        <div><button type="button" className="btn btn-sm btn-outline-secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - data.limit))}>Previous</button><span> Page {Math.floor(offset / data.limit) + 1} </span>
          <button type="button" className="btn btn-sm btn-outline-secondary" disabled={offset + data.limit >= data.total} onClick={() => setOffset(offset + data.limit)}>Next</button></div></div>
    </>}
    {detail && <FinanceDialog title={detail.number ? `Transaction #${detail.number}` : 'Transaction details'} onClose={close} error={detailError} footer={<button type="button" className="btn btn-outline-secondary" onClick={close}>Close transaction</button>}>
      {detailLoading ? <p role="status">Loading supporting record…</p> : detail.journal && <>
        <p><strong>{detail.label} · {moneyLabel(detail.amount)}</strong></p><p>{detail.description}</p>
        <dl className="finance-detail-grid"><dt>Date</dt><dd>{detail.effectiveDate} · Asia/Manila</dd><dt>From</dt><dd>{endpointNames(detail.from, detail.counterparty)}</dd><dt>To</dt><dd>{endpointNames(detail.to, detail.counterparty)}</dd><dt>Reference</dt><dd>{detail.reference}</dd><dt>Recorded by</dt><dd>{detail.postedBy}</dd><dt>Posted at</dt><dd>{detail.postedAt}</dd><dt>Status</dt><dd><FinanceStatus value={detail.status} /></dd>
          {support?.documentReference && <><dt>Supporting document</dt><dd>{support.documentReference}</dd></>}{support?.evidenceReference && <><dt>Evidence reference</dt><dd>{support.evidenceReference}</dd></>}{support?.category && <><dt>Category</dt><dd>{support.category}</dd></>}
          {support?.source && <><dt>Source</dt><dd>{support.source} · {support.recordId}</dd></>}
        </dl>
        {detail.type === 'TRANSFER' && detail.incomingAmount !== detail.outgoingAmount && <p className="alert alert-warning">Sent {moneyLabel(detail.outgoingAmount)}; received {moneyLabel(detail.incomingAmount)}. The remaining difference is retained in the journal.</p>}
        {detail.from.concat(detail.to).some((a) => a.kind === 'COLLECTOR_GCASH') && <p>Personal Collector GCash is money due from the collector, separate from company-controlled cash.</p>}
        {detail.type.startsWith('CARD_') && <p>This changes credit-card debt. It does not move company cash.</p>}
        {detail.type === 'CORRECTION' && <p>No money moved. This corrects a duplicate recorded receipt and retains both accounting records.</p>}
        <div className="finance-actions">
          {support?.kind === 'PAYABLE' && <button type="button" className="btn btn-outline-primary" onClick={() => { close(); onOpenPayable(support.id); }}>Open expense / payable</button>}
          {['MANUAL_INCOME', 'SOURCE'].includes(support?.kind) && <button type="button" className="btn btn-outline-primary" onClick={() => { close(); onOpenWorkspace('Income & Collections'); }}>Open Income & Collections</button>}
          {detail.correctionOfId && <button type="button" className="btn btn-outline-secondary" onClick={() => open({ id: detail.correctionOfId })}>View original transaction</button>}
          {detail.correctedByIds.map((id) => <button type="button" className="btn btn-outline-secondary" key={id} onClick={() => open({ id })}>View correction</button>)}
        </div>
        {support?.kind === 'SOURCE' && <details className="mt-3"><summary>Source record evidence</summary>
          <dl className="finance-detail-grid mt-2">{[['amount', 'Amount'], ['advanceAmount', 'Customer advance'], ['actualAmount', 'Amount received'], ['expectedAmount', 'Amount expected'], ['referenceNumber', 'Payment reference'], ['evidenceReference', 'Evidence reference'], ['movementEvidence', 'Movement evidence'], ['reason', 'Reason'], ['authorizedBy', 'Authorized by']].filter(([key]) => support.effect[key]).map(([key, label]) => <React.Fragment key={key}><dt>{label}</dt><dd>{key.toLowerCase().includes('amount') ? moneyLabel(support.effect[key]) : support.effect[key]}</dd></React.Fragment>)}</dl>
          {support.effect.allocations?.length > 0 && <><h4>Applied to bills</h4><ul>{support.effect.allocations.map((allocation) => <li key={allocation.invoiceId}>{allocation.invoiceId} · {moneyLabel(allocation.amount)}</li>)}</ul></>}
        </details>}
        <details className="mt-3"><summary>Accounting record</summary><div className="table-responsive"><table className="table"><thead><tr><th>Account</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{detail.journal.lines.map((line, i) => <tr key={i}><td>{line.accountSnapshot.name}</td><td>{moneyLabel(line.debit)}</td><td>{moneyLabel(line.credit)}</td></tr>)}</tbody></table></div></details>
      </>}
    </FinanceDialog>}
  </section>;
}
