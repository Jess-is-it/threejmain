import React, { useCallback, useEffect, useRef, useState } from 'react';
import FinanceDialog from './FinanceDialog.jsx';
import FinancePendingRemittances, { pendingRemittanceTotal } from './FinancePendingRemittances.jsx';
import { withinApprovalLimit } from './reportClient.mjs';
import { useRecordView, FinanceStatus } from './FinanceRecords.jsx';
import { businessDate, moneyLabel } from './financeApi.mjs';
import { SOURCES, INFLOW_CLASSES, cutoverBody, priorDate, manualCounterpartType } from './incomeClient.mjs';

const TITLES = { manual: 'Record other income or financing', mapping: 'Map a source settlement account', cutover: 'Prepare certified cutover', submit: 'Submit other income', approve: 'Independently approve', reject: 'Reject with reason', post: 'Post reviewed inflow', reverse: 'Reverse posted inflow', retire: 'Retire mapping for future postings', activate: 'Activate certified cutover', acknowledge: 'Acknowledge reconciliation exception' };
const PREFIX = { MANUAL_INCOME: 'income', MAPPING: 'settlement-mappings', CUTOVER: 'cutover-plans' };

export default function IncomeCollections({ api, meta, pending, parentBusy, onBusyChange, onPendingChange, refreshVersion, onSaved }) {
  const [view, setView] = useState('Collections'), [sources, setSources] = useState(null);
  const [integration, setIntegration] = useState(null);
  const [manual, setManual] = useState([]), [mappings, setMappings] = useState([]), [plans, setPlans] = useState([]), [exceptions, setExceptions] = useState([]), [accounts, setAccounts] = useState([]);
  const [dialog, setDialog] = useState(null), [form, setForm] = useState({}), [baselineFunds, setBaselineFunds] = useState([]), [evidence, setEvidence] = useState(null);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const generation = useRef(0), identity = useRef(meta.actorUsername), seenIdentity = useRef(meta.actorUsername);
  identity.current = meta.actorUsername;
  const has = (grant) => meta.permissionsGranted.includes('*') || meta.permissionsGranted.includes(grant);
  const disabled = busy || parentBusy || loading || Boolean(pending);
  const close = useCallback(() => setDialog(null), []);

  async function load() {
    const current = ++generation.current, user = identity.current;
    setLoading(true); setSources(null); setManual([]); setMappings([]); setPlans([]); setExceptions([]); setAccounts([]); setEvidence(null);
    try {
      const [s, m, a, c, e, f] = await Promise.all([
        has('finance.income.view_all') ? api.request('/api/finance/sources') : null,
        api.request('/api/finance/income'), api.request('/api/finance/settlement-mappings'), api.request('/api/finance/cutover-plans'),
        has('finance.income.view_all') ? api.request('/api/finance/reconciliation-exceptions') : [],
        has('finance.accounts.view') ? api.request('/api/finance/accounts') : [],
      ]);
      if (current !== generation.current || user !== identity.current) return;
      setSources(s); setManual(m); setMappings(a); setPlans(c); setExceptions(e); setAccounts(f);
      if (meta.phase >= 7 && meta.reportScopesUnrestricted && has('finance.income.view_all')) {
        const recovery = await api.request('/api/finance/integration/status');
        if (current === generation.current && user === identity.current) setIntegration(recovery);
      }
    } finally { if (current === generation.current) setLoading(false); }
  }

  useEffect(() => {
    if (seenIdentity.current !== meta.actorUsername) setDialog(null);
    seenIdentity.current = meta.actorUsername;
    if (!has('finance.income.view')) { setLoading(false); return; }
    load().catch((e) => setError(e.message));
    return () => { generation.current++; };
  }, [api, meta.actorUsername, meta.permissionsGranted.join(','), refreshVersion]);

  function start(type, record = null) {
    setError(''); setNotice(''); setDialog({ type, record }); setBaselineFunds([]);
    setForm(type === 'manual' ? { classification: 'OTHER_INCOME', documentReference: '', payerName: '', effectiveDate: businessDate(), amount: '', accountId: '', counterpartAccountId: '', purpose: '', evidenceReference: '' }
      : type === 'mapping' ? { channel: 'POS', operator: '', method: 'CASH', institution: '', accountId: '', validFrom: businessDate(), validThrough: '', evidenceReference: '', reason: '' }
        : type === 'cutover' ? { startDate: businessDate(), snapshots: Object.fromEntries(SOURCES.map((s) => [s, ''])), receivables: [], credits: [], custody: [], evidenceReference: '', reason: '' }
          : type === 'reverse' ? { effectiveDate: businessDate(), reason: '' } : { reason: '', version: record.version });
  }

  async function perform(path, body) {
    setBusy(true); onBusyChange(true); setError(''); setNotice('');
    let result;
    try {
      result = await api.mutate(path, 'POST', body);
      setDialog(null); onPendingChange(null);
      setNotice(result.checkpointAdvanced === false ? 'Source page retained with exceptions. Correct the mapping or source evidence, then synchronize again.' : result.idempotentReplay ? 'Existing action confirmed; no duplicate posting.' : 'Finance action saved.');
      await onSaved(); await load();
    } catch (e) {
      setError(e.message);
      try { onPendingChange(api.pending()); } catch (storageError) { setError(storageError.message); }
      if (result) setDialog(null);
    } finally { setBusy(false); onBusyChange(false); }
  }

  async function submit(event) {
    event.preventDefault(); const { type, record } = dialog;
    if (busy) return;
    setBusy(true); onBusyChange(true);
    let path, body = form;
    try {
      if (type === 'manual') path = '/api/finance/income';
      else if (type === 'mapping') {
        const { channel, operator, method, institution, validThrough, ...rest } = form;
        path = '/api/finance/settlement-mappings'; body = { ...rest, settlement: { channel, operator, method, institution }, ...(validThrough ? { validThrough } : {}) };
      } else if (type === 'cutover') {
        path = '/api/finance/cutover-plans';
        // Read the actual boundary balances, not today's balances. Server
        // independently certifies the same boundary and immutable evidence.
        const funds = await api.request(`/api/finance/accounts?asOf=${priorDate(form.startDate)}`);
        body = cutoverBody(form, funds); setBaselineFunds(funds);
      } else {
        path = type === 'acknowledge' ? `/api/finance/reconciliation-exceptions/${record.id}/acknowledge` : `/api/finance/${PREFIX[record.documentKind]}/${record.id}/${type}`;
        if (type === 'post') body = { version: record.version };
      }
      await perform(path, body);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); onBusyChange(false); }
  }

  async function showSource(id) {
    const user = identity.current, current = generation.current;
    setEvidence(null); setError('');
    try {
      const result = await api.request(`/api/finance/sources/events/${id}`);
      if (user === identity.current && current === generation.current) setEvidence(result);
    } catch (e) { setError(e.message); }
  }

  const field = (key, label, props = {}) => <label className="finance-field" key={key}><span>{label}</span><input className="form-control" required value={form[key] ?? ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} /></label>;
  const choose = (key, label, choices) => <label className="finance-field" key={key}><span>{label}</span><select className="form-select" required value={form[key] || ''} onChange={(e) => setForm({ ...form, ...(key === 'classification' ? { counterpartAccountId: '' } : {}), [key]: e.target.value })}><option value="">Choose {label.toLowerCase()}</option>{choices.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>;
  const fundOptions = accounts.filter((a) => a.active && !a.system && !['GENERAL_LEDGER', 'CREDIT_CARD'].includes(a.kind)).map((a) => [a.id, a.name]);
  const reviewButtons = (record) => {
    const type = record.documentKind, reviewGrant = type === 'MANUAL_INCOME' ? 'finance.income.approve' : type === 'MAPPING' ? 'finance.settlement-mappings.approve' : 'finance.cutover.approve';
    const reviewable = record.status === (type === 'MANUAL_INCOME' ? 'SUBMITTED' : 'DRAFT') && record.createdBy !== meta.actorUsername;
    return <div className="finance-actions">
      {type === 'MANUAL_INCOME' && record.status === 'DRAFT' && has('finance.income.create') && <button className="btn btn-sm btn-primary" disabled={disabled} onClick={() => start('submit', record)}>Submit</button>}
      {reviewable && has(reviewGrant) && <>{type !== 'MANUAL_INCOME' || withinApprovalLimit(meta, record.amount) ? <button className="btn btn-sm btn-primary" disabled={disabled} onClick={() => start('approve', record)}>Approve</button> : <span>Requires an approver with a higher amount limit.</span>}<button className="btn btn-sm btn-outline-danger" disabled={disabled} onClick={() => start('reject', record)}>Reject</button></>}
      {type === 'MANUAL_INCOME' && record.status === 'APPROVED' && has('finance.income.post') && <button className="btn btn-sm btn-primary" disabled={disabled} onClick={() => start('post', record)}>Post inflow</button>}
      {type === 'MANUAL_INCOME' && record.status === 'POSTED' && has('finance.income.reverse') && <button className="btn btn-sm btn-outline-danger" disabled={disabled} onClick={() => start('reverse', record)}>Reverse</button>}
      {type === 'MAPPING' && record.status === 'APPROVED' && has('finance.settlement-mappings.manage') && <button className="btn btn-sm btn-outline-secondary" disabled={disabled} onClick={() => start('retire', record)}>Retire</button>}
      {type === 'CUTOVER' && record.status === 'APPROVED' && has('finance.cutover.manage') && <button className="btn btn-sm btn-primary" disabled={disabled} onClick={() => start('activate', record)}>Activate cutover</button>}
    </div>;
  };

  function baselineRows(key, title, defaults, fields) {
    return <section className="finance-cutover-rows"><h4>{title}</h4>
      {(form[key] || []).map((row, index) => <div className="finance-line-grid" key={index}>{fields.map(([name, label, options]) => <label className="finance-field" key={name}><span>{label}</span>{options ? <select className="form-select" value={row[name]} required onChange={(e) => setForm({ ...form, [key]: form[key].map((r, i) => i === index ? { ...r, [name]: e.target.value } : r) })}>{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select>
        : <input className="form-control" value={row[name] ?? ''} required={name !== 'customerId' || key !== 'receivables' || row.owner === 'billing'} onChange={(e) => setForm({ ...form, [key]: form[key].map((r, i) => i === index ? { ...r, [name]: e.target.value } : r) })} />}</label>)}<button type="button" className="btn btn-outline-danger" onClick={() => setForm({ ...form, [key]: form[key].filter((_, i) => i !== index) })}>Remove row</button></div>)}
      <button type="button" className="btn btn-outline-primary" onClick={() => setForm({ ...form, [key]: [...(form[key] || []), { ...defaults }] })}>Add {title.toLowerCase()} row</button></section>;
  }

  const listView = useRecordView(view === 'Collections' ? sources?.items || [] : view === 'Other income & funding' ? manual : view === 'Settlement accounts' ? mappings : view === 'Reconciliation' ? exceptions : plans, { statuses: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'POSTED', 'REVERSED', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'ACTIVE', 'RETIRED', 'EVIDENCE'], resetKey: view });
  if (!has('finance.income.view')) return <p>Your role does not grant income access.</p>;
  return <section className="finance-income">
    {error && <div className="alert alert-danger" role="alert">{error}</div>}{notice && <div className="alert alert-success" role="status">{notice}</div>}
    {!loading && view !== 'Pending remittances' && listView.controls}
    <nav className="finance-toolbar" aria-label="Income and collections views">{['Collections', 'Pending remittances', 'Other income & funding', 'Settlement accounts', 'Reconciliation', 'Cutover'].map((name) => <button type="button" className={`btn ${view === name ? 'btn-primary' : 'btn-outline-primary'}`} key={name} disabled={busy} onClick={() => setView(name)}>{name}</button>)}</nav>
    <p>Billing owns subscriber receipts. POS and Collector links refer to that receipt once. Remittance moves funds; loans and owner contributions remain financing.</p>
    {loading ? <p role="status">Loading income records…</p> : <>
      {view === 'Pending remittances' && <FinancePendingRemittances key={meta.actorUsername} api={api} meta={meta} accounts={accounts} />}
      {view === 'Collections' && has('finance.accounts.view') && <button type="button" className="card card-body text-start mb-3" onClick={() => setView('Pending remittances')}><span>Pending remittances</span><strong>{moneyLabel(pendingRemittanceTotal(accounts))}</strong><small>Posted collector custody · View supporting records{meta.setupStatus === 'PENDING_REVIEWED_CUTOVER' && ' · Provisional'}</small></button>}
      {view === 'Collections' && (!sources ? <p>Viewing shared source collections requires explicit permission to view all income.</p> : <>
        <div className="alert alert-info">Collections are separate from earned profit. Financial Reports show the evidence available for recognized revenue and costs.</div>
        {integration && <div className="alert alert-info">Source capture began {integration.baselineDate}. {integration.cutoverActive ? 'Automatic recovery is enabled.' : 'Reviewed opening balances and a certified cutover are required before new source accounting.'} Earlier subscriber growth and historical inventory costing remain unavailable.</div>}
        <div className="finance-source-status">{SOURCES.map((source) => <div className="card" key={source}><div className="card-body"><strong>{source}</strong><p>{sources.providers[source].configured ? sources.cutoverActive ? 'Provider connected; reviewed cutover active' : 'Provider connected; certified cutover required' : 'Provider awaiting integration'}</p>
          {integration?.sources.find((r) => r.source === source) && (() => { const r = integration.sources.find((item) => item.source === source); return <><p>{r.pendingChanges} captured changes awaiting review or delivery</p><code>{r.snapshotId}</code>{r.delivery?.status.startsWith('BLOCKED') && <div className="alert alert-warning" role="alert">{r.delivery.message}<small className="d-block">Source change {r.delivery.sequence}. An authorized source owner must attest the missing movement or correction evidence before retry.</small></div>}</>; })()}
          {has('finance.sources.sync') && <button className="btn btn-primary" disabled={disabled || !sources.providers[source].configured || !sources.cutoverActive} onClick={() => perform(`/api/finance/sources/${source}/sync`, { limit: 100 })}>Synchronize source</button>}</div></div>)}</div>
        <div className="table-responsive"><table className="table table-striped"><thead><tr><th>Source / original record</th><th>Effect / date</th><th>State</th><th>Retained collections</th><th>Actual refunds</th><th>Evidence</th></tr></thead><tbody>{listView.items.map((r) => <tr key={r.id}><td>{r.source}<small className="finance-code">{r.recordId}</small></td><td>{r.kind}<small className="finance-code">{r.effectiveDate}</small></td><td><FinanceStatus value={r.status} /></td><td>{moneyLabel(r.result?.collectionAmount || '0.00')}</td><td>{moneyLabel(r.result?.refundAmount || '0.00')}</td><td><button className="btn btn-sm btn-outline-primary" onClick={() => showSource(r.id)}>Original evidence</button></td></tr>)}{!listView.items.length && <tr><td colSpan="6">No source events have been imported.</td></tr>}</tbody></table></div>
        {evidence && <div className="card"><div className="card-body"><button className="btn btn-sm btn-outline-secondary float-end" onClick={() => setEvidence(null)}>Close evidence</button><h3>Original {evidence.event.source} evidence</h3><dl className="finance-detail-grid"><dt>Record</dt><dd>{evidence.event.recordId}</dd><dt>Effect</dt><dd>{evidence.event.effect.kind}</dd><dt>Effective date</dt><dd>{evidence.event.effectiveDate}</dd><dt>Customer / service reference</dt><dd>{[evidence.event.effect.customerId, evidence.event.effect.serviceAccountId, evidence.event.effect.serviceOrderId].filter(Boolean).join(' · ') || '—'}</dd><dt>Evidence reference</dt><dd>{evidence.event.effect.evidenceReference || evidence.event.effect.deliveryEvidence || evidence.event.effect.movementEvidence || evidence.event.effect.referenceNumber || evidence.event.effect.reference || 'Retained source posting'}</dd></dl>
          {evidence.event.effect.allocations?.map((a) => <p key={a.invoiceId}>Invoice {a.invoiceId}: {moneyLabel(a.amount)}</p>)}{evidence.event.effect.advanceAmount && <p>Advance retained: {moneyLabel(evidence.event.effect.advanceAmount)}</p>}
          {evidence.result?.canonicalSourceId && <p>Linked to existing canonical source evidence; no additional receipt.</p>}
        </div></div>}
      </>)}
      {view === 'Other income & funding' && <>{has('finance.income.create') && <button className="btn btn-primary" disabled={disabled || !has('finance.accounts.view')} onClick={() => start('manual')}>New other income / funding</button>}<div className="table-responsive"><table className="table table-striped"><thead><tr><th>Document / payer</th><th>Classification / purpose</th><th>Date / amount</th><th>Evidence / approval</th><th>State</th><th>Actions</th></tr></thead><tbody>{listView.items.map((r) => <tr key={r.id}><td>{r.documentReference}<small className="finance-code">{r.payerName}</small></td><td>{INFLOW_CLASSES[r.classification]}<small className="finance-code">{r.purpose}</small></td><td>{r.effectiveDate}<small className="finance-code">{moneyLabel(r.amount)}</small></td><td>{r.evidenceReference}<small className="finance-code">Creator {r.createdBy}; reviewer {r.approvedBy || 'pending'}</small>{r.decisionReason && <small className="finance-code">{r.decisionReason}</small>}</td><td><FinanceStatus value={r.status} /></td><td>{reviewButtons(r)}</td></tr>)}{!listView.items.length && <tr><td colSpan="6">No manual inflows in your permitted scope.</td></tr>}</tbody></table></div></>}
      {view === 'Settlement accounts' && <>{has('finance.settlement-mappings.manage') && <button className="btn btn-primary" disabled={disabled || !has('finance.accounts.view')} onClick={() => start('mapping')}>New account mapping</button>}<p>A method alone does not identify an account. Map the channel, operator and actual register or institution reference for an effective date range.</p><div className="table-responsive"><table className="table"><thead><tr><th>Identity</th><th>Named account</th><th>Effective period</th><th>Evidence / reviewer</th><th>State / actions</th></tr></thead><tbody>{listView.items.map((r) => <tr key={r.id}><td>{r.settlement.channel} · {r.settlement.operator}<small className="finance-code">{r.settlement.method} · {r.settlement.institution}</small></td><td>{accounts.find((a) => a.id === r.accountId)?.name || r.accountId}</td><td>{r.validFrom} through {r.validThrough || 'ongoing'}</td><td>{r.evidenceReference}<small className="finance-code">{r.approvedBy || 'Review pending'}</small></td><td><FinanceStatus value={r.status} />{reviewButtons(r)}</td></tr>)}</tbody></table></div></>}
      {view === 'Reconciliation' && <><p>Acknowledging an exception records review. It does not classify a shortage as expense or a surplus as income. Missing mappings and dependencies resolve only after a successful source retry.</p><div className="table-responsive"><table className="table"><thead><tr><th>Source / reason</th><th>State</th><th>Review</th></tr></thead><tbody>{listView.items.map((r) => <tr key={r.id}><td>{r.source} · {r.code}<small className="finance-code">{r.message}</small></td><td><FinanceStatus value={r.status} /></td><td>{r.acknowledgementReason}{r.status !== 'RESOLVED' && has('finance.reconciliation.acknowledge') && <button className="btn btn-sm btn-outline-primary" disabled={disabled} onClick={() => start('acknowledge', r)}>Acknowledge</button>}</td></tr>)}{!listView.items.length && <tr><td colSpan="3">No reconciliation exceptions in your permitted scope.</td></tr>}</tbody></table></div></>}
      {view === 'Cutover' && <>{has('finance.cutover.manage') && <button className="btn btn-primary" disabled={disabled || !has('finance.accounts.view') || plans.some((r) => r.status === 'ACTIVE')} onClick={() => start('cutover')}>Prepare cutover</button>}<p>Opening balances cover through the day before cutover. Earlier transactions are reference evidence. Itemize open obligations, credits and unremitted custody before forward ingestion.</p>{listView.items.map((r) => <article className="card" key={r.id}><div className="card-body"><h3>{r.startDate} · {r.status}</h3><p>Opening boundary {r.throughDate}; evidence {r.evidenceReference}. Creator {r.createdBy}; reviewer {r.approvedBy || 'pending'}.</p><p>{r.funds.length} certified holdings; {r.receivables.length} obligations; {r.credits.length} credits; {r.custody.length} held receipts. Deferred consideration {moneyLabel(r.deferredAmount)}.</p><details><summary>Review itemized opening evidence</summary>{r.funds.map((f) => <p key={f.accountId}>{accounts.find((a) => a.id === f.accountId)?.name || f.accountId}: {moneyLabel(f.balance)}</p>)}{r.receivables.map((b) => <p key={`${b.owner}:${b.recordId}`}>{b.owner} {b.recordId} · customer {b.customerId || 'walk-in'}: receivable {moneyLabel(b.amount)}, deferred {moneyLabel(b.deferredAmount)}</p>)}{r.credits.map((c) => <p key={`${c.kind}:${c.recordId}`}>{c.kind} {c.recordId} · {c.customerId}: {moneyLabel(c.amount)}</p>)}{r.custody.map((c) => <p key={c.billingPaymentId}>Held receipt {c.billingPaymentId} · {c.leg}: {moneyLabel(c.amount)}</p>)}{SOURCES.map((s) => <p key={s}>{s}: {r.snapshots[s]}</p>)}</details>{reviewButtons(r)}</div></article>)}</>}
    </>}
    {!loading && view !== 'Pending remittances' && listView.pagination}
    {dialog && <FinanceDialog title={TITLES[dialog.type]} busy={busy} disabled={disabled} onClose={close} onSubmit={submit} error={error}>
      {dialog.type === 'manual' && <><p>Use existing Billing/POS receipts for subscriber or register collections. This form records independently reviewed other income, loans or owner funding.</p>{choose('classification', 'Inflow classification', Object.entries(INFLOW_CLASSES))}{field('documentReference', 'Document reference')}{field('payerName', 'Payer / funding party')}{field('effectiveDate', 'Actual funds date', { type: 'date', max: businessDate() })}{field('amount', 'Amount (PHP)', { inputMode: 'decimal' })}{choose('accountId', 'Actual receiving account', fundOptions)}{choose('counterpartAccountId', 'Income / loan / equity account', accounts.filter((a) => a.active && !a.system && a.kind === 'GENERAL_LEDGER' && a.glType === manualCounterpartType(form.classification)).map((a) => [a.id, a.name]))}{field('purpose', 'Purpose', { minLength: 3, maxLength: 1000 })}{field('evidenceReference', 'Controlled supporting evidence reference')}</>}
      {dialog.type === 'mapping' && <>{choose('channel', 'Source channel', ['POS', 'OFFICE', 'COLLECTOR', 'COMPANY'].map((s) => [s, s]))}{field('operator', 'Source operator / custodian username')}{choose('method', 'Payment method', ['CASH', 'GCASH', 'BANK_TRANSFER'].map((s) => [s, s]))}{field('institution', 'Actual register / bank / wallet reference')}{choose('accountId', 'Named financial account', fundOptions)}{field('validFrom', 'Effective from', { type: 'date' })}{field('validThrough', 'Effective through', { type: 'date', required: false })}{field('evidenceReference', 'Mapping evidence reference')}{field('reason', 'Reason', { minLength: 3 })}</>}
      {dialog.type === 'cutover' && <><p>Certify all account openings first. Submission captures ledger balances through the previous day. Every source needs its consistent snapshot certificate.</p>{field('startDate', 'First forward transaction date', { type: 'date', max: businessDate() })}{SOURCES.map((s) => <label className="finance-field" key={s}><span>{s} snapshot certificate</span><input className="form-control" required value={form.snapshots[s]} onChange={(e) => setForm({ ...form, snapshots: { ...form.snapshots, [s]: e.target.value } })} /></label>)}
        {baselineRows('receivables', 'Open obligations', { owner: 'billing', recordId: '', customerId: '', amount: '0.00', deferredAmount: '0.00' }, [['owner', 'Owner', [['billing', 'Billing'], ['point-of-sale', 'POS']]], ['recordId', 'Invoice / sale ID'], ['customerId', 'Customer ID'], ['amount', 'Remaining receivable'], ['deferredAmount', 'Unrecognized consideration']])}
        {baselineRows('credits', 'Customer credits', { kind: 'ADVANCE', recordId: '', customerId: '', amount: '' }, [['kind', 'Credit type', [['ADVANCE', 'Advance'], ['REBATE', 'Rebate']]], ['recordId', 'Original receipt / rebate ID'], ['customerId', 'Customer ID'], ['amount', 'Remaining credit']])}
        {baselineRows('custody', 'Unremitted receipts', { billingPaymentId: '', customerId: '', accountId: '', leg: 'CASH', amount: '' }, [['billingPaymentId', 'Billing receipt ID'], ['customerId', 'Customer ID'], ['accountId', 'Collector account', [['', 'Choose custody account'], ...accounts.filter((a) => a.active && a.kind.startsWith('COLLECTOR')).map((a) => [a.id, a.name])]], ['leg', 'Custody method', [['CASH', 'Cash'], ['GCASH', 'Personal GCash']]], ['amount', 'Retained amount']])}
        {baselineFunds.length > 0 && <p>Captured {baselineFunds.length} boundary account records for review.</p>}{field('evidenceReference', 'Reviewed opening / itemized source evidence')}{field('reason', 'Boundary and completeness certification', { minLength: 3 })}</>}
      {!['manual', 'mapping', 'cutover'].includes(dialog.type) && <><p>{dialog.record.documentReference || dialog.record.settlement?.institution || dialog.record.startDate || dialog.record.message}</p>{dialog.type === 'reverse' && field('effectiveDate', 'Actual reversal date', { type: 'date', min: dialog.record.effectiveDate, max: businessDate() })}{dialog.type !== 'post' && field('reason', 'Review / correction reason', { minLength: 3, maxLength: 1000 })}{dialog.type === 'activate' && <p>Activation freezes the opening boundary. Earlier evidence will not post money; certified accounts cannot receive another opening.</p>}</>}
    </FinanceDialog>}
  </section>;
}
