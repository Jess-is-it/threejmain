import FinanceNotifications from './FinanceNotifications.jsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { businessDate, moneyLabel, newReference } from './financeApi.mjs';
import { attachmentBody } from './expenseEvidence.mjs';
import FinanceDialog from './FinanceDialog.jsx';
import InstallmentEditor from './InstallmentEditor.jsx';
import { ARRANGEMENTS, accountMethod, expenseBody, expenseStatus, expenseArrangement, isImmediateArrangement, changeArrangement, immediateAccounts, expenseReviewReason } from './expenseForm.mjs';
import { withinApprovalLimit } from './reportClient.mjs';
import { useRecordView, FinanceStatus } from './FinanceRecords.jsx';

const CLASSES = { OPERATING_EXPENSE: 'Operating expense', DIRECT_COST: 'Direct cost', INVENTORY_PURCHASE: 'Inventory purchase', ASSET: 'Asset purchase' };
const ACTION_NAMES = { 'record-direct': 'Record own expense', submit: 'Submit for review', approve: 'Approve expense', reject: 'Reject expense', reopen: 'Reopen as draft', post: 'Record approved expense', pay: 'Record supplier payment', reverse: 'Reverse expense recognition', 'reverse-payment': 'Reverse supplier payment', upload: 'Upload supporting document', retire: 'Retire supporting document' };
const REF_FIELDS = [['locationReference', 'Location reference'], ['projectReference', 'Project reference'], ['itemAssetReference', 'Inventory / asset reference'], ['evidenceReference', 'External evidence reference'], ['evidenceExceptionReason', 'Evidence exception reason']];

export default function ExpensesPayables({ api, meta, pending, onPendingChange, onBusyChange, parentBusy, refreshVersion, initialPayableId, onSaved }) {
  const [payables, setPayables] = useState([]), [payees, setPayees] = useState([]), [categories, setCategories] = useState([]), [accounts, setAccounts] = useState([]);
  const [view, setView] = useState('Payables'), [detail, setDetail] = useState(null), [attachments, setAttachments] = useState([]);
  const [dialog, setDialog] = useState(null), [form, setForm] = useState({}), [file, setFile] = useState(null);
  const [categoryDraft, setCategoryDraft] = useState(null);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const has = (grant) => meta.permissionsGranted.includes(grant) || meta.permissionsGranted.includes('*');
  const disabled = busy || parentBusy || loading || Boolean(pending);
  const selectedId = useRef(initialPayableId);
  const manageMenu = useRef(null);
  const priorIdentity = useRef(meta.actorUsername);
  const closeDialog = useCallback(() => setDialog(null), []);
  const closeCategory = useCallback(() => { setCategoryDraft(null); setError(''); }, []);
  const recognitionAccounts = (classification) => accounts.filter((a) => a.active && !a.system && a.kind === 'GENERAL_LEDGER' && a.glType === (['OPERATING_EXPENSE', 'DIRECT_COST'].includes(classification) ? 'EXPENSE' : 'ASSET'));

  function addCategory() {
    if (disabled || !has('finance.expenses.manage') || !has('finance.accounts.view')) return;
    const choices = recognitionAccounts('OPERATING_EXPENSE');
    setError('');
    setCategoryDraft({ code: `CAT-${newReference()}`, name: '', classification: 'OPERATING_EXPENSE', accountId: choices.length === 1 ? choices[0].id : '', notes: '' });
  }

  async function saveCategory(event, retry = false) {
    event.preventDefault();
    if (busy || parentBusy || !has('finance.expenses.manage') || !has('finance.accounts.view')) return;
    setBusy(true); onBusyChange(true); setError('');
    try {
      if (retry && (pending?.path !== '/api/finance/categories' || pending?.method !== 'POST' || pending?.body?.code !== categoryDraft.code)) throw new Error('Resolve the saved Finance request before adding a category.');
      const result = retry ? await api.retry() : await api.mutate('/api/finance/categories', 'POST', categoryDraft);
      setCategories((rows) => [...rows.filter((r) => r.id !== result.id), result]);
      setForm((draft) => ({ ...draft, categoryId: result.id }));
      setCategoryDraft(null); onPendingChange(null); setNotice(`Category “${result.name}” added and selected.`);
    } catch (e) {
      setError(e.message);
      try { onPendingChange(api.pending()); } catch (storageError) { setError(storageError.message); }
    } finally { setBusy(false); onBusyChange(false); }
  }

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
    if (priorIdentity.current !== meta.actorUsername) { selectedId.current = null; setDialog(null); setCategoryDraft(null); }
    priorIdentity.current = meta.actorUsername;
    let active = true;
    load().catch((e) => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, refreshVersion, meta.actorUsername, meta.permissionsGranted.join(',')]);

  function start(type, record = detail) {
    setError(''); setNotice(''); setFile(null); setCategoryDraft(null); setDialog({ type, record });
    const today = businessDate();
    setForm(type === 'new-expense' ? { isReimbursement: false, paymentArrangement: 'PAY_LATER', installments: [], paidAccountId: '', paidDate: today, paidMethod: 'CASH', paidReference: '', payeeId: '', categoryId: '', documentReference: '', documentDate: '', expenseDate: today, dueDate: today, amount: '', purpose: '', ...Object.fromEntries(REF_FIELDS.map(([key]) => [key, ''])) }
      : type === 'edit-expense' ? { isReimbursement: Boolean(record.isReimbursement), paymentArrangement: expenseArrangement(record), installments: record.installments || [], paidAccountId: record.paidDetails?.accountId || '', paidDate: record.paidDetails?.effectiveDate || today, paidMethod: record.paidDetails?.method || 'CASH', paidReference: record.paidDetails?.referenceNumber || '', ...Object.fromEntries(['version', 'payeeId', 'categoryId', 'documentReference', 'documentDate', 'expenseDate', 'dueDate', 'amount', 'purpose', ...REF_FIELDS.map(([key]) => key)].map((key) => [key, key === 'documentReference' && record.documentReferenceKind === 'INTERNAL' ? '' : record[key]])) }
        : type === 'new-payee' ? { code: '', name: '', type: 'SUPPLIER', notes: '' }
          : type === 'new-category' ? { code: '', name: '', classification: 'OPERATING_EXPENSE', accountId: '', notes: '' }
            : ['edit-payee', 'edit-category'].includes(type) ? { version: record.version, name: record.name, notes: record.notes, active: record.active, reason: '' }
              : type === 'pay' ? { accountId: '', effectiveDate: today, amount: record.nextDueAmount || record.outstandingAmount, sourceReference: newReference(), method: 'CASH', referenceNumber: '', reason: 'Supplier payment', ...(record.paidDetails && record.paidAmount === '0.00' ? { ...record.paidDetails, amount: record.outstandingAmount } : {}) }
                : ['reverse', 'reverse-payment'].includes(type) ? { effectiveDate: today, reason: '' }
                  : { reason: '', version: record.version });
  }

  async function submit(event) {
    event.preventDefault(); setBusy(true); onBusyChange(true); setError(''); setNotice('');
    const { type, record } = dialog;
    let path, method = 'POST', body = form, result;
    try {
      if (type === 'new-expense') {
        path = '/api/finance/expenses'; const mode = event.nativeEvent.submitter?.value || (reviewReason ? 'submit' : 'record');
        body = { ...expenseBody(form), submitForApproval: mode === 'submit', recordImmediately: mode === 'record' };
        if (file) body.attachment = await attachmentBody(file, 1);
      }
      else if (type === 'edit-expense') { path = `/api/finance/payables/${record.id}`; method = 'PATCH'; body = expenseBody(form); }
      else if (type === 'new-payee') path = '/api/finance/payees';
      else if (type === 'new-category') path = '/api/finance/categories';
      else if (['edit-payee', 'edit-category'].includes(type)) { path = `/api/finance/${type === 'edit-payee' ? 'payees' : 'categories'}/${record.id}`; method = 'PATCH'; }
      else if (type === 'pay') path = `/api/finance/payables/${record.id}/payments`;
      else if (type === 'reverse-payment') path = `/api/finance/payments/${record.id}/reverse`;
      else if (type === 'upload') { path = `/api/finance/payables/${record.id}/attachments`; body = await attachmentBody(file, record.version); }
      else if (type === 'retire') { path = `/api/finance/payables/${detail.id}/attachments/${record.id}/retire`; body = { version: detail.version, reason: form.reason }; }
      else { path = `/api/finance/payables/${record.id}/${type === 'approve' ? 'approve-record' : type}`; if (['post', 'record-direct'].includes(type)) body = { version: record.version }; }
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
  const select = (key, label, choices, required = true) => <label className="finance-field" key={key}><span>{label}</span><select className="form-select" required={required} value={form[key] || ''} onChange={(e) => setForm(key === 'paymentArrangement' ? changeArrangement(form, e.target.value) : { ...form, ...(key === 'classification' ? { accountId: '' } : {}), [key]: e.target.value, ...(key === 'accountId' ? { method: accountMethod(accounts.find((a) => a.id === e.target.value)) } : key === 'paidAccountId' ? { paidMethod: accountMethod(accounts.find((a) => a.id === e.target.value)) } : {}) })}><option value="">{required ? `Choose ${label.toLowerCase()}` : 'Payee not specified'}</option>{choices.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>;
  const editable = detail && detail.postingStatus === 'UNPOSTED' && ['DRAFT', 'REJECTED'].includes(detail.approvalStatus);
  const canReview = detail && detail.approvalStatus === 'SUBMITTED' && ![detail.createdBy, detail.editedBy].includes(meta.actorUsername);
  const funding = accounts.filter((a) => a.active && a.kind !== 'GENERAL_LEDGER');
  const immediate = isImmediateArrangement(form.paymentArrangement), cardCharge = form.paymentArrangement === 'CHARGED_TO_CARD';
  const paidAccounts = immediateAccounts(accounts, form.paymentArrangement);
  const reviewReason = expenseReviewReason(meta, form, payees);
  const canRecordDraft = detail && detail.approvalStatus === 'DRAFT' && detail.postingStatus === 'UNPOSTED' && !expenseReviewReason(meta, detail);
  const destinationType = ['OPERATING_EXPENSE', 'DIRECT_COST'].includes(form.classification) ? 'EXPENSE' : 'ASSET';
  const titles = { 'new-expense': 'Add expense', 'edit-expense': 'Edit expense draft', 'new-payee': 'New supplier or payee', 'edit-payee': 'Edit supplier or payee', 'new-category': 'New expense category', 'edit-category': 'Edit expense category', ...ACTION_NAMES };

  const listView = useRecordView(view === 'Payables' ? payables : view === 'Payees' ? payees : categories, { statuses: view === 'Payables' ? ['DRAFT', 'NEEDS_APPROVAL', 'READY_TO_RECORD', 'AWAITING_PAYMENT', 'PARTIALLY_PAID', 'PAID', 'REJECTED', 'REVERSED'] : ['ACTIVE', 'ARCHIVED'], getStatus: (r) => view === 'Payables' ? expenseStatus(r) : r.active ? 'ACTIVE' : 'ARCHIVED', dates: view === 'Payables', resetKey: view });
  if (!has('finance.expenses.view')) return <p>Your role does not grant expense access.</p>;
  return <section className="finance-expenses">
    <FinanceNotifications error={error} notice={notice} hideError={Boolean(dialog)} onErrorDismiss={() => setError('')} onNoticeDismiss={() => setNotice('')} />
    <div className="finance-toolbar"><div>{view !== 'Payables' && <><button type="button" className="btn btn-outline-secondary" disabled={disabled} onClick={() => setView('Payables')}>Back to expenses</button><h3 className="mb-0">{view}</h3></>}</div>
      <div>{view === 'Payables' && has('finance.expenses.create') && <button className="btn btn-primary" disabled={disabled} onClick={() => start('new-expense')}>Add expense</button>}
        {has('finance.expenses.manage') && view === 'Payees' && <button className="btn btn-primary" disabled={disabled} onClick={() => start('new-payee')}>New payee</button>}
        {has('finance.expenses.manage') && view === 'Categories' && <button className="btn btn-primary" disabled={disabled || !has('finance.accounts.view')} onClick={() => start('new-category')}>New category</button>}
        <details className="finance-manage" ref={manageMenu}><summary className="btn btn-outline-secondary dropdown-toggle">Manage</summary><div className="finance-manage-options">{['Payees', 'Categories'].map((name) => <button type="button" className="btn btn-link" key={name} disabled={disabled} onClick={() => { setView(name); manageMenu.current.open = false; }}>{name}</button>)}</div></details>
      </div></div>
    {view === 'Payables' && <p>Add the purchase, send it for approval, then record payments. Pay later and installments show what is still owed. A card charge pays the supplier; repay the card in Accounts &amp; Transfers.</p>}
    {!loading && listView.controls}
    {loading ? <p role="status">Loading expense records…</p> : view === 'Payables' ? <div className="table-responsive"><table className="table table-striped finance-expense-table"><thead><tr><th>Date</th><th>Payee</th><th>Category</th><th>Amount</th><th>Paid to supplier</th><th>Remaining</th><th>Status</th></tr></thead><tbody>
      {listView.items.map((r) => <tr key={r.id}><td data-label="Date">{r.expenseDate}<small className="finance-code">{r.nextDueDate ? `Due ${r.nextDueDate}${r.overdue ? ' · Overdue' : ''}` : 'Settled'}</small></td><td data-label="Payee"><button className="btn btn-sm btn-link" onClick={() => show(r.id).catch((e) => setError(e.message))}>#{r.number} {r.payeeSnapshot.name}</button></td><td data-label="Category">{r.categorySnapshot.name}<small className="finance-code">{ARRANGEMENTS[expenseArrangement(r)]}</small></td><td data-label="Amount">{moneyLabel(r.amount)}</td><td data-label="Paid to supplier">{moneyLabel(r.paidAmount)}</td><td data-label="Remaining">{r.postingStatus === 'UNPOSTED' ? 'Pending approval / recording' : moneyLabel(r.outstandingAmount)}</td><td data-label="Status"><FinanceStatus value={expenseStatus(r)} /></td></tr>)}
      {!listView.items.length && <tr><td colSpan="7">No expenses in your permitted scope. Add an expense to get started.</td></tr>}</tbody></table></div>
      : <div className="table-responsive"><table className="table table-striped"><thead><tr><th>Name / code</th><th>Type / classification</th><th>Status</th><th>Actions</th></tr></thead><tbody>{listView.items.map((r) => <tr key={r.id}><td>{r.name}<small className="finance-code">{r.code}</small></td><td>{r.type || CLASSES[r.classification]}</td><td><FinanceStatus value={r.active ? 'ACTIVE' : 'ARCHIVED'} /></td><td>{has('finance.expenses.manage') && <button className="btn btn-sm btn-outline-primary" disabled={disabled} onClick={() => start(view === 'Payees' ? 'edit-payee' : 'edit-category', r)}>Edit / archive</button>}</td></tr>)}</tbody></table></div>}
    {!loading && listView.pagination}
    {view === 'Payables' && detail && <div className="card finance-expense-detail"><div className="card-body"><button className="btn btn-sm btn-outline-secondary float-end" onClick={() => { setDetail(null); selectedId.current = null; }}>Close detail</button>
      <h3>Expense #{detail.number} · {detail.payeeSnapshot.name}</h3><p>{detail.purpose}</p><p>Payment arrangement: {ARRANGEMENTS[expenseArrangement(detail)]}</p>
      <p><FinanceStatus value={expenseStatus(detail)} /> · Amount {moneyLabel(detail.amount)} · Paid to supplier {moneyLabel(detail.paidAmount)} · Remaining {detail.postingStatus === 'UNPOSTED' ? 'pending approval / recording' : moneyLabel(detail.outstandingAmount)}</p><details className="finance-more-details"><summary>Accounting and audit details</summary><dl className="finance-detail-grid"><dt>Document reference</dt><dd>{detail.documentReferenceKind === 'INTERNAL' ? `Internal expense #${detail.number}` : detail.documentReference} · {detail.documentDate}</dd><dt>Category</dt><dd>{detail.categorySnapshot.name} · {CLASSES[detail.categorySnapshot.classification]}</dd><dt>Recognition date</dt><dd>{detail.expenseDate}</dd><dt>Due date</dt><dd>{detail.dueDate}</dd><dt>Amount / supplier paid / remaining</dt><dd>{moneyLabel(detail.amount)} / {moneyLabel(detail.paidAmount)} / {moneyLabel(detail.outstandingAmount)}</dd><dt>Creator / last financial editor</dt><dd>{detail.createdBy} / {detail.editedBy}</dd><dt>Approval</dt><dd>{detail.approvalStatus === 'NOT_REQUIRED' ? `Not required · recorded by ${detail.authorizedBy}` : detail.approvalStatus}{detail.approvedBy ? ` by ${detail.approvedBy}` : ''}</dd><dt>Posting / settlement</dt><dd>{detail.postingStatus} / {detail.settlementStatus}</dd>
        {REF_FIELDS.filter(([key]) => detail[key]).map(([key, label]) => <React.Fragment key={key}><dt>{label}</dt><dd>{detail[key]}</dd></React.Fragment>)}</dl></details>
      {detail.rejectionReason && <p>Rejection: {detail.rejectionReason}</p>}
      {detail.reversalReason && <p>Recognition reversal: {detail.reversalReason}</p>}
      <div className="finance-actions">
        {editable && has('finance.expenses.create') && <button className="btn btn-outline-primary" disabled={disabled} onClick={() => start('edit-expense')}>Edit draft</button>}
        {canRecordDraft && <button className="btn btn-primary" disabled={disabled} onClick={() => start('record-direct')}>Record expense</button>}
        {detail.approvalStatus === 'DRAFT' && has('finance.expenses.create') && <button className="btn btn-primary" disabled={disabled} onClick={() => start('submit')}>Submit</button>}
        {canReview && has('finance.expenses.approve') && <>{withinApprovalLimit(meta, detail.amount) ? <button className="btn btn-primary" disabled={disabled} onClick={() => start('approve')}>Approve</button> : <span>Requires an approver with a higher amount limit.</span>}<button className="btn btn-outline-danger" disabled={disabled} onClick={() => start('reject')}>Reject</button></>}
        {detail.postingStatus === 'UNPOSTED' && detail.approvalStatus !== 'DRAFT' && has('finance.expenses.create') && <button className="btn btn-outline-secondary" disabled={disabled} onClick={() => start('reopen')}>Reopen draft</button>}
        {detail.postingStatus === 'UNPOSTED' && detail.approvalStatus === 'APPROVED' && has('finance.expenses.post') && <button className="btn btn-primary" disabled={disabled} onClick={() => start('post')}>Record approved expense</button>}
        {detail.postingStatus === 'POSTED' && detail.settlementStatus !== 'PAID' && has('finance.expenses.pay') && <button className="btn btn-primary" disabled={disabled || !has('finance.accounts.view')} onClick={() => start('pay')}>Record payment</button>}
        {detail.postingStatus === 'POSTED' && has('finance.expenses.reverse') && <button className="btn btn-outline-danger" disabled={disabled || detail.paidAmount !== '0.00'} onClick={() => start('reverse')}>Reverse recognition</button>}
      </div>
      {detail.paymentArrangement === 'ALREADY_PAID' && detail.paidAmount === '0.00' && <p className="alert alert-info">Payment details were declared on entry. Finance must confirm the payment after approval before balances change.</p>}
      {detail.paymentArrangement === 'INSTALLMENTS' && <><h4 className="finance-subheading">Supplier installment schedule</h4><div className="table-responsive"><table className="table"><thead><tr><th>Installment</th><th>Due date</th><th>Amount</th><th>Paid</th><th>Remaining</th></tr></thead><tbody>{(detail.settlementSchedule || []).map((r) => <tr key={r.number}><td>#{r.number}</td><td>{r.dueDate}</td><td>{moneyLabel(r.amount)}</td><td>{moneyLabel(r.paidAmount)}</td><td>{moneyLabel(r.outstandingAmount)}</td></tr>)}</tbody></table></div><p>Payments settle the earliest due installment first.</p></>}
      {detail.payments.some((p) => p.method === 'CREDIT_CARD' && !p.reversalJournalId) && <p className="alert alert-info">Card charges settle the supplier and increase card debt. The supplier's paid status does not mean the credit card has been repaid. Check card bills in Accounts &amp; Transfers.</p>}
      <h4 className="finance-subheading">Supplier payments</h4><div className="table-responsive"><table className="table"><thead><tr><th>Date / account</th><th>Amount</th><th>Method / reference</th><th>Actor</th><th>State / correction</th></tr></thead><tbody>{detail.payments.map((p) => <tr key={p.id}><td>{p.effectiveDate}<small className="finance-code">{p.accountSnapshot.name}</small></td><td>{moneyLabel(p.amount)}</td><td>{p.method}<small className="finance-code">{p.referenceNumber || p.sourceReference}</small></td><td>{p.createdBy}</td><td>{p.reversalJournalId ? <span>Reversed by {p.reversedBy}: {p.reversalReason}</span> : <><span>Posted</span>{has('finance.expenses.reverse') && <button className="btn btn-sm btn-outline-danger" disabled={disabled} onClick={() => start('reverse-payment', p)}>Reverse payment</button>}</>}</td></tr>)}{!detail.payments.length && <tr><td colSpan="5">No payments visible in your account scope.</td></tr>}</tbody></table></div>
      <h4 className="finance-subheading">Supporting documents</h4><p>PDF, PNG or JPEG, up to 2 MiB each. Downloads require Finance attachment access. Retired documents remain retained evidence.</p>
      {editable && has('finance.attachments.upload') && has('finance.expenses.create') && <button className="btn btn-outline-primary" disabled={disabled} onClick={() => start('upload')}>Upload document</button>}
      {!has('finance.attachments.view') ? <p>Your role does not grant attachment access.</p> : <ul className="finance-evidence-list">{attachments.map((a) => <li key={a.id}><span>{a.filename} · {a.size} bytes · {a.active ? 'Active' : 'Retired'} · {a.createdBy}</span><button className="btn btn-sm btn-outline-primary" onClick={() => download(a)}>Download</button>{a.active && editable && has('finance.attachments.upload') && has('finance.expenses.create') && <button className="btn btn-sm btn-outline-secondary" disabled={disabled} onClick={() => start('retire', a)}>Retire</button>}</li>)}</ul>}
      <h4 className="finance-subheading">Review and recording history</h4><ul>{detail.approvalHistory.map((event) => <li key={event.id}>{event.action === 'DIRECT_RECORD' ? 'Recorded directly' : event.action} · version {event.version} · {event.actor} · {event.createdAt} · {event.reason}</li>)}</ul>
    </div></div>}
    {dialog && <FinanceDialog title={categoryDraft ? 'Add expense category' : titles[dialog.type]} busy={busy} disabled={disabled} onClose={categoryDraft ? closeCategory : closeDialog} onSubmit={categoryDraft ? saveCategory : submit} error={error} footer={categoryDraft ? <><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={closeCategory}>Cancel</button>{pending ? <button type="button" className="btn btn-warning" disabled={busy || parentBusy || pending.path !== '/api/finance/categories' || pending.method !== 'POST' || pending.body?.code !== categoryDraft.code || !has('finance.expenses.manage') || !has('finance.accounts.view')} onClick={(e) => saveCategory(e, true)}>Confirm saved category</button> : <button type="submit" className="btn btn-primary" disabled={disabled || !has('finance.expenses.manage') || !has('finance.accounts.view')}>{busy ? 'Saving…' : 'Save category'}</button>}</> : dialog.type === 'new-expense' ? <><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={closeDialog}>Cancel</button><button type="submit" className="btn btn-outline-primary" disabled={disabled} value="draft">Save draft</button><button type="submit" className="btn btn-primary" disabled={disabled} value={reviewReason ? "submit" : "record"}>{reviewReason ? "Submit for approval" : "Save & record"}</button></> : undefined}>
      {categoryDraft && <>
        <p>Your expense details and attachment are kept while you add this category.</p>
        <label className="finance-field"><span>Category name</span><input className="form-control" required maxLength={160} value={categoryDraft.name} onChange={(e) => setCategoryDraft({ ...categoryDraft, name: e.target.value })} /></label>
        <label className="finance-field"><span>Classification</span><select className="form-select" value={categoryDraft.classification} onChange={(e) => { const choices = recognitionAccounts(e.target.value); setCategoryDraft({ ...categoryDraft, classification: e.target.value, accountId: choices.length === 1 ? choices[0].id : '' }); }}>{Object.entries(CLASSES).map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>
        <label className="finance-field"><span>Recognition account</span><select className="form-select" required value={categoryDraft.accountId} onChange={(e) => setCategoryDraft({ ...categoryDraft, accountId: e.target.value })}><option value="">Choose recognition account</option>{recognitionAccounts(categoryDraft.classification).map((a) => <option value={a.id} key={a.id}>{a.name}</option>)}</select><small>The ledger account that records this category, separate from the account you pay from.</small></label>
        {!recognitionAccounts(categoryDraft.classification).length && <p role="status" className="alert alert-info">No matching recognition account is available. Ask an authorized Finance account manager to set one up, then return to this expense.</p>}
        <details className="finance-more-details"><summary>More details</summary><label className="finance-field"><span>Notes</span><input className="form-control" maxLength={1000} value={categoryDraft.notes} onChange={(e) => setCategoryDraft({ ...categoryDraft, notes: e.target.value })} /></label></details>
      </>}
      {['new-expense', 'edit-expense'].includes(dialog.type) && <fieldset className="finance-expense-fields" hidden={Boolean(categoryDraft)} disabled={Boolean(categoryDraft)}>{select('payeeId', immediate && !form.isReimbursement ? 'Payee (optional)' : 'Payee', payees.filter((r) => r.active && (!form.isReimbursement || r.type === 'EMPLOYEE')).map((r) => [r.id, r.name]), !immediate || form.isReimbursement)}<div className="finance-category-picker">{select('categoryId', 'Category', categories.filter((r) => r.active).map((r) => [r.id, `${r.name} · ${CLASSES[r.classification]}`]))}{has('finance.expenses.manage') && has('finance.accounts.view') && <button type="button" className="btn btn-outline-primary" disabled={disabled} onClick={addCategory}>+ Add category</button>}</div>
        {field('amount', 'Amount (PHP)', { inputMode: 'decimal', pattern: '\\d+(\\.\\d{1,2})?' })}{field('expenseDate', 'Expense date', { type: 'date', max: businessDate() })}{field('purpose', 'Description / purpose', { minLength: 3, maxLength: 1000 })}
        <label className="finance-field"><span><input type="checkbox" checked={Boolean(form.isReimbursement)} onChange={(e) => setForm({ ...form, isReimbursement: e.target.checked, payeeId: '' })} /> Employee reimbursement</span></label>
        {select('paymentArrangement', 'Payment arrangement', Object.entries(ARRANGEMENTS))}
        {dialog.type === 'new-expense' && <p>{reviewReason || 'Save & record adds this expense to accounting immediately.'}</p>}
        {!immediate && field('dueDate', form.paymentArrangement === 'INSTALLMENTS' ? 'First due date' : 'Due date', { type: 'date', min: form.documentDate || form.expenseDate })}
        {form.paymentArrangement === 'INSTALLMENTS' && <InstallmentEditor form={form} onChange={setForm} total={form.amount} onError={setError} />}
        {immediate && <>{select('paidAccountId', cardCharge ? 'Credit-card account' : 'Paid from account', paidAccounts.map((a) => [a.id, a.name]))}{field('paidDate', cardCharge ? 'Card charge date' : 'Payment date', { type: 'date', min: form.expenseDate, max: businessDate() })}{form.paidMethod !== 'CASH' && field('paidReference', cardCharge ? 'Card charge reference' : 'Payment reference', { maxLength: 160 })}{!paidAccounts.length && <p role="status" className="alert alert-info">{cardCharge ? 'No active credit-card account is available in your scope.' : 'No active cash, e-Wallet or bank account is available in your scope.'} Ask an authorized Finance account manager to review account setup.</p>}<p>{reviewReason || dialog.type === 'edit-expense' ? 'The payment details are retained for confirmation when this expense is recorded.' : cardCharge ? 'Save & record confirms this charge. The supplier is paid; card debt increases. Repay the card in Accounts & Transfers.' : 'Save & record confirms this payment and updates the selected account balance.'}</p></>}
        {dialog.type === 'new-expense' && has('finance.attachments.upload') && <label className="finance-field"><span>Receipt or invoice (optional for draft)</span><input className="form-control" type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files[0])} /><small>PDF or image, up to 2 MiB. Evidence is required to record or approve an expense.</small></label>}
        <details className="finance-more-details"><summary>More details</summary>{field('documentReference', 'Supplier invoice number', { required: false, maxLength: 160 })}{field('documentDate', 'Supplier document date', { type: 'date', required: false })}{REF_FIELDS.map(([key, label]) => field(key, label, { required: false, maxLength: key === 'evidenceExceptionReason' ? 1000 : 160 }))}<p>Category controls how the purchase is recorded. Inventory and equipment stay assets until their separate costing workflow. Prepayments and tax splits require Finance review.</p></details></fieldset>}
      {['new-payee', 'new-category'].includes(dialog.type) && <>{field('code', 'Permanent code', { maxLength: 40, pattern: '[A-Za-z0-9][A-Za-z0-9_-]*' })}{field('name', 'Name', { maxLength: 160 })}
        {dialog.type === 'new-payee' ? select('type', 'Payee type', [['SUPPLIER', 'Supplier'], ['EMPLOYEE', 'Employee reimbursement'], ['OTHER', 'Other business payee']]) : <>{select('classification', 'Recognition classification', Object.entries(CLASSES))}{select('accountId', 'Recognition account', accounts.filter((a) => a.active && !a.system && a.kind === 'GENERAL_LEDGER' && a.glType === destinationType).map((a) => [a.id, a.name]))}</>}{field('notes', 'Notes', { required: false, maxLength: 1000 })}</>}
      {['edit-payee', 'edit-category'].includes(dialog.type) && <>{field('name', 'Name')}{field('notes', 'Notes', { required: false, maxLength: 1000 })}<label className="finance-field"><span>Active</span><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /></label>{field('reason', 'Change / archival reason', { minLength: 3 })}<p>Identity and accounting classification remain fixed. Archival retains referenced financial evidence.</p></>}
      {dialog.type === 'pay' && <>{select('accountId', 'Actual funding account', funding.map((a) => [a.id, `${a.name} · ${a.kind === 'CREDIT_CARD' ? 'Card liability' : a.kind}`]))}{field('effectiveDate', 'Actual payment date', { type: 'date', min: dialog.record.expenseDate, max: businessDate() })}{field('amount', 'Amount paid (PHP)', { inputMode: 'decimal', pattern: '\\d+(\\.\\d{1,2})?' })}<p>Payment method: {form.method.replaceAll('_', ' ').toLowerCase()} (from the selected account).</p>{field('referenceNumber', 'Bank / wallet / card reference', { required: form.method !== 'CASH' })}{field('reason', 'Payment purpose / evidence', { minLength: 3 })}<p>Outstanding {moneyLabel(dialog.record.outstandingAmount)}. Payment reduces the payable. Card payment increases card debt.</p></>}
      {['reverse', 'reverse-payment'].includes(dialog.type) && <>{field('effectiveDate', 'Correction / refund date', { type: 'date', min: dialog.type === 'reverse-payment' ? dialog.record.effectiveDate : dialog.record.expenseDate, max: businessDate() })}{field('reason', 'Reversal reason and evidence', { minLength: 3 })}<p>{dialog.type === 'reverse' ? 'All linked settlements must be reversed first. Original approval and journals remain retained.' : 'Only record the reversal after verifying the original payment error or actual refund. It restores the payable and reverses the selected account movement.'}</p></>}
      {['submit', 'approve', 'reject', 'reopen', 'retire'].includes(dialog.type) && <>{field('reason', dialog.type === 'reject' ? 'Rejection reason' : 'Action reason', { minLength: 3, maxLength: 1000 })}{dialog.type === 'approve' && <p>Approve {moneyLabel(dialog.record.amount)} for {dialog.record.payeeSnapshot.name}. Creator and financial editor cannot self-approve. Approval records this reviewed cost on its expense date. It does not pay the supplier.</p>}{dialog.type === 'reopen' && <p>Reopening clears approval. Edited details require a fresh independent review.</p>}{dialog.type === 'retire' && <p>Retire {dialog.record.filename} from active evidence; its bytes remain securely retained.</p>}</>}
      {dialog.type === 'record-direct' && <p>Record {moneyLabel(dialog.record.amount)} as your own business expense. {dialog.record.paidDetails ? 'The declared payment will be recorded at the same time.' : 'It remains unpaid until a payment is recorded.'} Your identity and accounting evidence are retained.</p>}
      {dialog.type === 'post' && <p>Recognize {moneyLabel(dialog.record.amount)} on {dialog.record.expenseDate} as {CLASSES[dialog.record.categorySnapshot.classification]}. This credits the supplier payable; funds do not move.</p>}
      {dialog.type === 'upload' && <label className="finance-field"><span>Supporting PDF or image (up to 2 MiB)</span><input className="form-control" type="file" required accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files[0])} /></label>}
    </FinanceDialog>}
  </section>;
}
