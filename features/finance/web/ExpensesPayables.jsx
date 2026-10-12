import React, { useCallback, useEffect, useRef, useState } from 'react';
import { businessDate, moneyLabel, newReference } from './financeApi.mjs';
import { attachmentBody } from './expenseEvidence.mjs';
import FinanceDialog from './FinanceDialog.jsx';
import { withinApprovalLimit } from './reportClient.mjs';
import { useRecordView, FinanceStatus } from './FinanceRecords.jsx';

const CLASSES = { OPERATING_EXPENSE: 'Operating expense', DIRECT_COST: 'Direct cost', INVENTORY_PURCHASE: 'Inventory purchase', ASSET: 'Asset purchase' };
const ACTION_NAMES = { submit: 'Submit for review', approve: 'Approve expense', reject: 'Reject expense', reopen: 'Reopen as draft', post: 'Recognize payable', pay: 'Record supplier payment', reverse: 'Reverse expense recognition', 'reverse-payment': 'Reverse supplier payment', upload: 'Upload supporting document', retire: 'Retire supporting document' };
const REF_FIELDS = [['locationReference', 'Location reference'], ['projectReference', 'Project reference'], ['itemAssetReference', 'Inventory / asset reference'], ['evidenceReference', 'External evidence reference'], ['evidenceExceptionReason', 'Evidence exception reason']];

export default function ExpensesPayables({ api, meta, pending, onPendingChange, onBusyChange, parentBusy, refreshVersion, initialPayableId, onSaved }) {
  const [payables, setPayables] = useState([]), [payees, setPayees] = useState([]), [categories, setCategories] = useState([]), [accounts, setAccounts] = useState([]);
  const [view, setView] = useState('Payables'), [detail, setDetail] = useState(null), [attachments, setAttachments] = useState([]);
  const [dialog, setDialog] = useState(null), [form, setForm] = useState({}), [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const has = (grant) => meta.permissionsGranted.includes(grant) || meta.permissionsGranted.includes('*');
  const disabled = busy || parentBusy || loading || Boolean(pending);
  const selectedId = useRef(initialPayableId);
  const priorIdentity = useRef(meta.actorUsername);
  const closeDialog = useCallback(() => setDialog(null), []);

  async function load(selected = selectedId.current) {
    setLoading(true); setPayables([]); setPayees([]); setCategories([]); setAccounts([]); setDetail(null); setAttachments([]);
    try {
    const [p, suppliers, c, a] = await Promise.all([
      api.request('/api/finance/payables'), api.request('/api/finance/payees'), api.request('/api/finance/categories'),
      has('finance.accounts.view') ? api.request('/api/finance/accounts') : [],
    ]);
    setPayables(p); setPayees(suppliers); setCategories(c); setAccounts(a);
    if (selected) await show(selected);
    } finally { setLoading(false); }
  }
  async function show(id) {
    setDetail(null); setAttachments([]);
    const [d, files] = await Promise.all([api.request(`/api/finance/payables/${id}`), has('finance.attachments.view') ? api.request(`/api/finance/payables/${id}/attachments`) : []]);
    setDetail(d); setAttachments(files);
    selectedId.current = id;
  }
  useEffect(() => {
    if (!has('finance.expenses.view')) { setLoading(false); return; }
    if (priorIdentity.current !== meta.actorUsername) { selectedId.current = null; setDialog(null); }
    priorIdentity.current = meta.actorUsername;
    let active = true;
    load().catch((e) => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, refreshVersion, meta.actorUsername, meta.permissionsGranted.join(',')]);

  function start(type, record = detail) {
    setError(''); setNotice(''); setFile(null); setDialog({ type, record });
    const today = businessDate();
    setForm(type === 'new-expense' ? { payeeId: '', categoryId: '', documentReference: '', documentDate: today, expenseDate: today, dueDate: today, amount: '', purpose: '', ...Object.fromEntries(REF_FIELDS.map(([key]) => [key, ''])) }
      : type === 'edit-expense' ? Object.fromEntries(['version', 'payeeId', 'categoryId', 'documentReference', 'documentDate', 'expenseDate', 'dueDate', 'amount', 'purpose', ...REF_FIELDS.map(([key]) => key)].map((key) => [key, record[key]]))
        : type === 'new-payee' ? { code: '', name: '', type: 'SUPPLIER', notes: '' }
          : type === 'new-category' ? { code: '', name: '', classification: 'OPERATING_EXPENSE', accountId: '', notes: '' }
            : ['edit-payee', 'edit-category'].includes(type) ? { version: record.version, name: record.name, notes: record.notes, active: record.active, reason: '' }
              : type === 'pay' ? { accountId: '', effectiveDate: today, amount: record.outstandingAmount, sourceReference: newReference(), method: 'CASH', referenceNumber: '', reason: '' }
                : ['reverse', 'reverse-payment'].includes(type) ? { effectiveDate: today, reason: '' }
                  : { reason: '', version: record.version });
  }

  async function submit(event) {
    event.preventDefault(); setBusy(true); onBusyChange(true); setError(''); setNotice('');
    const { type, record } = dialog;
    let path, method = 'POST', body = form, result;
    try {
      if (type === 'new-expense') path = '/api/finance/payables';
      else if (type === 'edit-expense') { path = `/api/finance/payables/${record.id}`; method = 'PATCH'; }
      else if (type === 'new-payee') path = '/api/finance/payees';
      else if (type === 'new-category') path = '/api/finance/categories';
      else if (['edit-payee', 'edit-category'].includes(type)) { path = `/api/finance/${type === 'edit-payee' ? 'payees' : 'categories'}/${record.id}`; method = 'PATCH'; }
      else if (type === 'pay') path = `/api/finance/payables/${record.id}/payments`;
      else if (type === 'reverse-payment') path = `/api/finance/payments/${record.id}/reverse`;
      else if (type === 'upload') { path = `/api/finance/payables/${record.id}/attachments`; body = await attachmentBody(file, record.version); }
      else if (type === 'retire') { path = `/api/finance/payables/${detail.id}/attachments/${record.id}/retire`; body = { version: detail.version, reason: form.reason }; }
      else { path = `/api/finance/payables/${record.id}/${type}`; if (type === 'post') body = { version: record.version }; }
      result = await api.mutate(path, method, body);
      setDialog(null); onPendingChange(null); setNotice(result.idempotentReplay ? 'Existing action confirmed; no duplicate posting.' : 'Finance action saved.');
      await onSaved();
      await load(type === 'new-expense' ? result.id : selectedId.current);
    } catch (e) {
      setError(e.message);
      try { onPendingChange(api.pending()); } catch (storageError) { setError(storageError.message); }
      if (result) setDialog(null);
    } finally { setBusy(false); onBusyChange(false); }
  }

  async function download(record) {
    setError('');
    try {
      const blob = await api.download(`/api/finance/payables/${record.payableId}/attachments/${record.id}/download`);
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = record.filename; document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) { setError(e.message); }
  }

  const field = (key, label, props = {}) => <label className="finance-field" key={key}><span>{label}</span><input className="form-control" value={form[key] ?? ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} required {...props} /></label>;
  const select = (key, label, choices) => <label className="finance-field" key={key}><span>{label}</span><select className="form-select" required value={form[key] || ''} onChange={(e) => setForm({ ...form, ...(key === 'classification' ? { accountId: '' } : {}), [key]: e.target.value })}><option value="">Choose {label.toLowerCase()}</option>{choices.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>;
  const editable = detail && detail.postingStatus === 'UNPOSTED' && ['DRAFT', 'REJECTED'].includes(detail.approvalStatus);
  const canReview = detail && detail.approvalStatus === 'SUBMITTED' && ![detail.createdBy, detail.editedBy].includes(meta.actorUsername);
  const funding = accounts.filter((a) => a.active && a.kind !== 'GENERAL_LEDGER');
  const destinationType = ['OPERATING_EXPENSE', 'DIRECT_COST'].includes(form.classification) ? 'EXPENSE' : 'ASSET';
  const titles = { 'new-expense': 'New expense / payable', 'edit-expense': 'Edit expense draft', 'new-payee': 'New supplier or payee', 'edit-payee': 'Edit supplier or payee', 'new-category': 'New expense category', 'edit-category': 'Edit expense category', ...ACTION_NAMES };

  const listView = useRecordView(view === 'Payables' ? payables : view === 'Payees' ? payees : categories, { statuses: view === 'Payables' ? ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'UNPOSTED', 'POSTED', 'REVERSED', 'UNPAID', 'PARTIALLY_PAID', 'PAID'] : ['ACTIVE', 'ARCHIVED'], getStatus: (r) => view === 'Payables' ? [r.approvalStatus, r.postingStatus, r.settlementStatus] : r.active ? 'ACTIVE' : 'ARCHIVED', dates: view === 'Payables', resetKey: view });
  if (!has('finance.expenses.view')) return <p>Your role does not grant expense access.</p>;
  return <section className="finance-expenses">
    {error && <div role="alert" className="alert alert-danger">{error}</div>}
    {notice && <div role="status" className="alert alert-success">{notice}</div>}
    <div className="finance-toolbar"><nav aria-label="Expenses and payables views">{['Payables', 'Payees', 'Categories'].map((name) => <button type="button" className={`btn ${name === view ? 'btn-primary' : 'btn-outline-primary'}`} key={name} onClick={() => setView(name)}>{name}</button>)}</nav>
      <div>{has('finance.expenses.create') && <button className="btn btn-primary" disabled={disabled} onClick={() => start('new-expense')}>New expense</button>}
        {has('finance.expenses.manage') && <><button className="btn btn-outline-primary" disabled={disabled} onClick={() => start('new-payee')}>New payee</button><button className="btn btn-outline-primary" disabled={disabled || !has('finance.accounts.view')} onClick={() => start('new-category')}>New category</button></>}</div></div>
    <p>Approval, accounting recognition and payment are separate. Stock and equipment purchases remain assets; paying a payable does not record the expense again.</p>
    {!loading && listView.controls}
    {loading ? <p role="status">Loading expense records…</p> : view === 'Payables' ? <div className="table-responsive"><table className="table table-striped"><thead><tr><th>Document / payee</th><th>Recognition / due</th><th>Classification</th><th>Amount</th><th>Approval</th><th>Posting</th><th>Settlement</th><th>Outstanding</th></tr></thead><tbody>
      {listView.items.map((r) => <tr key={r.id}><td><button className="btn btn-sm btn-link" onClick={() => show(r.id).catch((e) => setError(e.message))}>#{r.number} {r.documentReference}</button><small className="finance-code">{r.payeeSnapshot.name}</small></td><td>{r.expenseDate}<small className="finance-code">Due {r.dueDate}{r.overdue ? ' · Overdue' : ''}</small></td><td>{CLASSES[r.categorySnapshot.classification]}</td><td>{moneyLabel(r.amount)}</td><td><FinanceStatus value={r.approvalStatus} /></td><td><FinanceStatus value={r.postingStatus} /></td><td><FinanceStatus value={r.settlementStatus} /></td><td>{moneyLabel(r.outstandingAmount)}</td></tr>)}
      {!listView.items.length && <tr><td colSpan="8">No expenses in your permitted scope.</td></tr>}</tbody></table></div>
      : <div className="table-responsive"><table className="table table-striped"><thead><tr><th>Name / code</th><th>Type / classification</th><th>Status</th><th>Actions</th></tr></thead><tbody>{listView.items.map((r) => <tr key={r.id}><td>{r.name}<small className="finance-code">{r.code}</small></td><td>{r.type || CLASSES[r.classification]}</td><td><FinanceStatus value={r.active ? 'ACTIVE' : 'ARCHIVED'} /></td><td>{has('finance.expenses.manage') && <button className="btn btn-sm btn-outline-primary" disabled={disabled} onClick={() => start(view === 'Payees' ? 'edit-payee' : 'edit-category', r)}>Edit / archive</button>}</td></tr>)}</tbody></table></div>}
    {!loading && listView.pagination}
    {view === 'Payables' && detail && <div className="card finance-expense-detail"><div className="card-body"><button className="btn btn-sm btn-outline-secondary float-end" onClick={() => { setDetail(null); selectedId.current = null; }}>Close detail</button>
      <h3>Expense #{detail.number} · {detail.payeeSnapshot.name}</h3><p>{detail.purpose}</p>
      <dl className="finance-detail-grid"><dt>Supplier document</dt><dd>{detail.documentReference} · {detail.documentDate}</dd><dt>Category</dt><dd>{detail.categorySnapshot.name} · {CLASSES[detail.categorySnapshot.classification]}</dd><dt>Recognition date</dt><dd>{detail.expenseDate}</dd><dt>Due date</dt><dd>{detail.dueDate}</dd><dt>Amount / paid / outstanding</dt><dd>{moneyLabel(detail.amount)} / {moneyLabel(detail.paidAmount)} / {moneyLabel(detail.outstandingAmount)}</dd><dt>Creator / last financial editor</dt><dd>{detail.createdBy} / {detail.editedBy}</dd><dt>Approval</dt><dd>{detail.approvalStatus}{detail.approvedBy ? ` by ${detail.approvedBy}` : ''}</dd><dt>Posting / settlement</dt><dd>{detail.postingStatus} / {detail.settlementStatus}</dd>
        {REF_FIELDS.filter(([key]) => detail[key]).map(([key, label]) => <React.Fragment key={key}><dt>{label}</dt><dd>{detail[key]}</dd></React.Fragment>)}</dl>
      {detail.rejectionReason && <p>Rejection: {detail.rejectionReason}</p>}
      {detail.reversalReason && <p>Recognition reversal: {detail.reversalReason}</p>}
      <div className="finance-actions">
        {editable && has('finance.expenses.create') && <button className="btn btn-outline-primary" disabled={disabled} onClick={() => start('edit-expense')}>Edit draft</button>}
        {detail.approvalStatus === 'DRAFT' && has('finance.expenses.create') && <button className="btn btn-primary" disabled={disabled} onClick={() => start('submit')}>Submit</button>}
        {canReview && has('finance.expenses.approve') && <>{withinApprovalLimit(meta, detail.amount) ? <button className="btn btn-primary" disabled={disabled} onClick={() => start('approve')}>Approve</button> : <span>Requires an approver with a higher amount limit.</span>}<button className="btn btn-outline-danger" disabled={disabled} onClick={() => start('reject')}>Reject</button></>}
        {detail.postingStatus === 'UNPOSTED' && detail.approvalStatus !== 'DRAFT' && has('finance.expenses.create') && <button className="btn btn-outline-secondary" disabled={disabled} onClick={() => start('reopen')}>Reopen draft</button>}
        {detail.postingStatus === 'UNPOSTED' && detail.approvalStatus === 'APPROVED' && has('finance.expenses.post') && <button className="btn btn-primary" disabled={disabled} onClick={() => start('post')}>Recognize payable</button>}
        {detail.postingStatus === 'POSTED' && detail.settlementStatus !== 'PAID' && has('finance.expenses.pay') && <button className="btn btn-primary" disabled={disabled || !has('finance.accounts.view')} onClick={() => start('pay')}>Record payment</button>}
        {detail.postingStatus === 'POSTED' && has('finance.expenses.reverse') && <button className="btn btn-outline-danger" disabled={disabled || detail.paidAmount !== '0.00'} onClick={() => start('reverse')}>Reverse recognition</button>}
      </div>
      <h4 className="finance-subheading">Payments</h4><div className="table-responsive"><table className="table"><thead><tr><th>Date / account</th><th>Amount</th><th>Method / reference</th><th>Actor</th><th>State / correction</th></tr></thead><tbody>{detail.payments.map((p) => <tr key={p.id}><td>{p.effectiveDate}<small className="finance-code">{p.accountSnapshot.name}</small></td><td>{moneyLabel(p.amount)}</td><td>{p.method}<small className="finance-code">{p.referenceNumber || p.sourceReference}</small></td><td>{p.createdBy}</td><td>{p.reversalJournalId ? <span>Reversed by {p.reversedBy}: {p.reversalReason}</span> : <><span>Posted</span>{has('finance.expenses.reverse') && <button className="btn btn-sm btn-outline-danger" disabled={disabled} onClick={() => start('reverse-payment', p)}>Reverse payment</button>}</>}</td></tr>)}{!detail.payments.length && <tr><td colSpan="5">No payments visible in your account scope.</td></tr>}</tbody></table></div>
      <h4 className="finance-subheading">Supporting documents</h4><p>PDF, PNG or JPEG, up to 2 MiB each. Downloads require Finance attachment access. Retired documents remain retained evidence.</p>
      {editable && has('finance.attachments.upload') && has('finance.expenses.create') && <button className="btn btn-outline-primary" disabled={disabled} onClick={() => start('upload')}>Upload document</button>}
      {!has('finance.attachments.view') ? <p>Your role does not grant attachment access.</p> : <ul className="finance-evidence-list">{attachments.map((a) => <li key={a.id}><span>{a.filename} · {a.size} bytes · {a.active ? 'Active' : 'Retired'} · {a.createdBy}</span><button className="btn btn-sm btn-outline-primary" onClick={() => download(a)}>Download</button>{a.active && editable && has('finance.attachments.upload') && has('finance.expenses.create') && <button className="btn btn-sm btn-outline-secondary" disabled={disabled} onClick={() => start('retire', a)}>Retire</button>}</li>)}</ul>}
      <h4 className="finance-subheading">Approval history</h4><ul>{detail.approvalHistory.map((event) => <li key={event.id}>{event.action} · version {event.version} · {event.actor} · {event.createdAt} · {event.reason}</li>)}</ul>
    </div></div>}
    {dialog && <FinanceDialog title={titles[dialog.type]} busy={busy} disabled={disabled} onClose={closeDialog} onSubmit={submit} error={error}>
      {['new-expense', 'edit-expense'].includes(dialog.type) && <>{select('payeeId', 'Payee', payees.filter((r) => r.active).map((r) => [r.id, r.name]))}{select('categoryId', 'Category', categories.filter((r) => r.active).map((r) => [r.id, `${r.name} · ${CLASSES[r.classification]}`]))}
        {field('documentReference', 'Supplier document reference', { maxLength: 160 })}{field('documentDate', 'Supplier document date', { type: 'date' })}{field('expenseDate', 'Expense / asset recognition date', { type: 'date' })}{field('dueDate', 'Due date', { type: 'date', min: form.documentDate })}{field('amount', 'Total recognized amount (PHP)', { inputMode: 'decimal', pattern: '\\d+(\\.\\d{1,2})?' })}{field('purpose', 'Business purpose', { minLength: 3, maxLength: 1000 })}{REF_FIELDS.map(([key, label]) => field(key, label, { required: false, maxLength: key === 'evidenceExceptionReason' ? 1000 : 160 }))}
        <p>One classification per document. Annual prepayments and tax splits require a separately reviewed recognition workflow. Evidence exceptions require an explicit server grant.</p></>}
      {['new-payee', 'new-category'].includes(dialog.type) && <>{field('code', 'Permanent code', { maxLength: 40, pattern: '[A-Za-z0-9][A-Za-z0-9_-]*' })}{field('name', 'Name', { maxLength: 160 })}
        {dialog.type === 'new-payee' ? select('type', 'Payee type', [['SUPPLIER', 'Supplier'], ['EMPLOYEE', 'Employee reimbursement'], ['OTHER', 'Other business payee']]) : <>{select('classification', 'Recognition classification', Object.entries(CLASSES))}{select('accountId', 'Recognition account', accounts.filter((a) => a.active && !a.system && a.kind === 'GENERAL_LEDGER' && a.glType === destinationType).map((a) => [a.id, a.name]))}</>}{field('notes', 'Notes', { required: false, maxLength: 1000 })}</>}
      {['edit-payee', 'edit-category'].includes(dialog.type) && <>{field('name', 'Name')}{field('notes', 'Notes', { required: false, maxLength: 1000 })}<label className="finance-field"><span>Active</span><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /></label>{field('reason', 'Change / archival reason', { minLength: 3 })}<p>Identity and accounting classification remain fixed. Archival retains referenced financial evidence.</p></>}
      {dialog.type === 'pay' && <>{select('accountId', 'Actual funding account', funding.map((a) => [a.id, `${a.name} · ${a.kind === 'CREDIT_CARD' ? 'Card liability' : a.kind}`]))}{field('effectiveDate', 'Actual payment date', { type: 'date', min: dialog.record.expenseDate, max: businessDate() })}{field('amount', 'Amount paid (PHP)', { inputMode: 'decimal', pattern: '\\d+(\\.\\d{1,2})?' })}{select('method', 'Payment method', [['CASH', 'Cash'], ['GCASH', 'GCash'], ['BANK_TRANSFER', 'Bank transfer'], ['CREDIT_CARD', 'Credit card'], ['OTHER', 'Other']])}{field('referenceNumber', 'Bank / wallet / card reference', { required: form.method !== 'CASH' })}{field('sourceReference', 'Unique payment document reference')}{field('reason', 'Payment purpose / evidence', { minLength: 3 })}<p>Outstanding {moneyLabel(dialog.record.outstandingAmount)}. Payment reduces the payable. Card payment increases card debt.</p></>}
      {['reverse', 'reverse-payment'].includes(dialog.type) && <>{field('effectiveDate', 'Correction / refund date', { type: 'date', min: dialog.type === 'reverse-payment' ? dialog.record.effectiveDate : dialog.record.expenseDate, max: businessDate() })}{field('reason', 'Reversal reason and evidence', { minLength: 3 })}<p>{dialog.type === 'reverse' ? 'All linked settlements must be reversed first. Original approval and journals remain retained.' : 'Only record the reversal after verifying the original payment error or actual refund. It restores the payable and reverses the selected account movement.'}</p></>}
      {['submit', 'approve', 'reject', 'reopen', 'retire'].includes(dialog.type) && <>{field('reason', dialog.type === 'reject' ? 'Rejection reason' : 'Action reason', { minLength: 3, maxLength: 1000 })}{dialog.type === 'approve' && <p>Approve {moneyLabel(dialog.record.amount)} for {dialog.record.payeeSnapshot.name}. Creator and financial editor cannot self-approve. This approval does not post an expense or pay the supplier.</p>}{dialog.type === 'reopen' && <p>Reopening clears approval. Edited details require a fresh independent review.</p>}{dialog.type === 'retire' && <p>Retire {dialog.record.filename} from active evidence; its bytes remain securely retained.</p>}</>}
      {dialog.type === 'post' && <p>Recognize {moneyLabel(dialog.record.amount)} on {dialog.record.expenseDate} as {CLASSES[dialog.record.categorySnapshot.classification]}. This credits the supplier payable; funds do not move.</p>}
      {dialog.type === 'upload' && <label className="finance-field"><span>Supporting PDF or image (up to 2 MiB)</span><input className="form-control" type="file" required accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files[0])} /></label>}
    </FinanceDialog>}
  </section>;
}
