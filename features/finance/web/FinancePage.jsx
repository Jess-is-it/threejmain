import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FinanceApi, businessDate, moneyLabel, newReference } from './financeApi.mjs';
import './finance.css';
import ExpensesPayables from './ExpensesPayables.jsx';
import FinanceCards from './FinanceCards.jsx';
import IncomeCollections from './IncomeCollections.jsx';
import FinanceReports from './FinanceReports.jsx';
import FinanceDialog from './FinanceDialog.jsx';
import FinanceActivity from './FinanceActivity.jsx';
import { withinApprovalLimit } from './reportClient.mjs';
import { useRecordView, FinanceStatus } from './FinanceRecords.jsx';

const LABELS = {
  CASH: 'Cash', PETTY_CASH: 'Petty cash', COMPANY_GCASH: 'Company GCash', BANK: 'Bank',
  COLLECTOR_CASH: 'Collector cash custody', COLLECTOR_GCASH: 'Collector personal GCash due',
  CREDIT_CARD: 'Credit card liability', GENERAL_LEDGER: 'General ledger',
};
const EMPTY_LINE = () => ({ accountId: '', debit: '', credit: '', memo: '' });

export default function FinancePage({ apiBase = '', refreshShell = () => {}, initialWorkspace = 'Overview', onWorkspaceChange = () => {} }) {
  const api = useMemo(() => new FinanceApi({ base: apiBase, token: () => localStorage.getItem('threejmain_token') || '' }), [apiBase]);
  const [meta, setMeta] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [openings, setOpenings] = useState([]);
  const [entries, setEntries] = useState([]);
  const [section, setSection] = useState('Accounts');
  const [workspace, setWorkspace] = useState(initialWorkspace);
  useEffect(() => setWorkspace(initialWorkspace), [initialWorkspace]);
  const [expenseBusy, setExpenseBusy] = useState(false);
  const [incomeBusy, setIncomeBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [selectedExpenseId, setSelectedExpenseId] = useState(null);
  const [activity, setActivity] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [form, setForm] = useState({});
  const closeDialog = useCallback(() => setDialog(null), []);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const allowed = (code, m = meta) => m?.permissionsGranted.includes(code) || m?.permissionsGranted.includes('*');

  async function reload() {
    const m = await api.request('/api/finance/meta');
    if (api.username && api.username !== m.actorUsername) { setDialog(null); setSelectedExpenseId(null); }
    api.username = m.actorUsername;
    setMeta(m);
    setPending(api.pending());
    setAccounts([]); setOpenings([]); setEntries([]); setActivity(null);
    const [a, o, e] = await Promise.all([
      allowed('finance.accounts.view', m) ? api.request('/api/finance/accounts') : [],
      allowed('finance.accounts.view', m) ? api.request('/api/finance/opening-balances') : [],
      allowed('finance.journals.view', m) ? api.request('/api/finance/journals')
        : allowed('finance.transfers.view', m) ? api.request('/api/finance/transfers') : [],
    ]);
    setAccounts(a); setOpenings(o); setEntries(e);
  }

  useEffect(() => {
    let active = true;
    reload().catch((e) => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api]);

  function start(type, record = null) {
    setError(''); setNotice(''); setDialog({ type, record });
    setForm(type === 'account' ? { code: '', name: '', kind: 'CASH', custodian: '', notes: '' }
      : type === 'edit' ? { name: record.name, custodian: record.custodian, notes: record.notes, version: record.version }
        : type === 'journal' ? { effectiveDate: businessDate(), sourceReference: newReference(), reason: '', lines: [EMPTY_LINE(), EMPTY_LINE()] }
          : type === 'transfer' ? { fromAccountId: '', toAccountId: '', amount: '', effectiveDate: businessDate(), sourceReference: newReference(), reason: '', method: 'CASH_HANDOVER', referenceNumber: '' }
            : type === 'opening' ? { accountId: record?.id || '', amount: '', effectiveDate: businessDate(), reason: '', evidenceReference: '' }
              : { effectiveDate: businessDate(), reason: '' });
  }

  async function perform(path, method, payload) {
    setBusy(true); setError(''); setNotice('');
    let result;
    try {
      result = await api.mutate(path, method, payload);
      setPending(null); setDialog(null); setActivity(null);
      setNotice(result.idempotentReplay ? 'Existing action confirmed. No duplicate posting was created.' : 'Finance action saved.');
      await reload();
      refreshShell();
    } catch (e) {
      setError(e.message);
      try { setPending(api.pending()); } catch (storageError) { setError(storageError.message); }
      // A successful posting remains successful if reloading the display fails.
      if (result) setDialog(null);
    } finally { setBusy(false); }
  }

  async function retry() {
    setBusy(true); setError('');
    try {
      await api.retry(); setPending(null); setDialog(null); setNotice('Saved request confirmed.'); await reload(); setRefreshVersion((v) => v + 1);
    } catch (e) {
      setError(e.message); setPending(api.pending());
    } finally { setBusy(false); }
  }

  function submit(event) {
    event.preventDefault();
    const { type, record } = dialog;
    if (type === 'account') return perform('/api/finance/accounts', 'POST', form);
    if (type === 'edit') return perform(`/api/finance/accounts/${record.id}`, 'PATCH', form);
    if (type === 'archive' || type === 'restore') return perform(`/api/finance/accounts/${record.id}/${type}`, 'POST', { version: record.version, reason: form.reason });
    if (type === 'opening') return perform('/api/finance/opening-balances', 'POST', form);
    if (type === 'approve') return perform(`/api/finance/opening-balances/${record.id}/approve`, 'POST', { reason: form.reason });
    if (type === 'post-opening') return perform(`/api/finance/opening-balances/${record.id}/post`, 'POST', null);
    if (type === 'transfer') return perform('/api/finance/transfers', 'POST', form);
    if (type === 'reverse') return perform(`/api/finance/journals/${record.id}/reverse`, 'POST', form);
    if (type === 'journal') return perform('/api/finance/journals', 'POST', { ...form, lines: form.lines.map((l) => ({ ...l, debit: l.debit || '0.00', credit: l.credit || '0.00' })) });
  }

  const fields = (key, label, type = 'text', props = {}) => <label className="finance-field" key={key}>
    <span>{label}</span><input className="form-control" type={type} value={form[key] || ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} required {...props} />
  </label>;
  const accountOptions = (_selected, includeLedger = false) => accounts.filter((a) => a.active && (!a.system || a.id === 'finance-opening-equity') && (includeLedger || !a.system && a.kind !== 'GENERAL_LEDGER'))
    .map((a) => <option value={a.id} key={a.id}>{a.name} — {LABELS[a.kind]}</option>);
  const accountSelect = (key, label, includeLedger = false) => <label className="finance-field"><span>{label}</span>
    <select className="form-select" value={form[key] || ''} required onChange={(e) => setForm({ ...form, [key]: e.target.value })}>
      <option value="">Select a named account</option>{accountOptions(form[key], includeLedger)}
    </select></label>;
  const visibleAccounts = accounts.filter((a) => !a.system && (showArchived || a.active));
  const accountView = useRecordView(visibleAccounts, { statuses: ['ACTIVE', 'ARCHIVED'], getStatus: (r) => r.active ? 'ACTIVE' : 'ARCHIVED', dates: false, resetKey: section });
  const openingView = useRecordView(openings, { statuses: ['DRAFT', 'APPROVED', 'POSTED'], resetKey: section });
  const entryView = useRecordView(entries.filter((e) => section === 'Journal' || e.kind === 'TRANSFER'), { statuses: ['POSTED', 'REVERSED'], getStatus: (e) => e.reversedByEntryId ? 'REVERSED' : 'POSTED', resetKey: section });
  const title = { account: 'New financial account', edit: 'Edit account', archive: 'Archive account', restore: 'Restore account', opening: 'Opening balance request', approve: 'Approve opening balance', 'post-opening': 'Post opening balance', transfer: 'Internal transfer', journal: 'Post accounting journal', reverse: 'Reverse journal entry' };
  const buttonsDisabled = busy || expenseBusy || incomeBusy || reportBusy || Boolean(pending);

  return <div className="finance-management container-xl">
    <header className="finance-header"><div><p className="page-pretitle">Finance Management</p><h2>{workspace}</h2></div></header>
    {error && <div className="alert alert-danger" role="alert">{error}</div>}
    {notice && <div className="alert alert-success" role="status">{notice}</div>}
    {meta?.setupStatus === 'PENDING_REVIEWED_CUTOVER' && <div className="alert alert-info" role="status">Finance setup requires reviewed named-account openings and an independently approved source cutover. Financial figures currently reflect posted Finance evidence; existing Billing receipts will not be imported as new cash.</div>}
    {pending && <div className="alert alert-warning" role="status">A Finance request is awaiting confirmation. Retry the saved request before posting another action. <button type="button" className="btn btn-warning" disabled={busy || expenseBusy || incomeBusy || reportBusy} onClick={retry}>Confirm saved request</button></div>}
    {loading ? <p role="status">Loading Finance accounts…</p> : !meta ? <button className="btn btn-outline-primary" onClick={() => reload().catch((e) => setError(e.message))}>Retry loading Finance</button> : <>
      {workspace === 'Activity' && <FinanceActivity key={meta.actorUsername} api={api} meta={meta} refreshVersion={refreshVersion} onOpenPayable={(id) => { setSelectedExpenseId(id); setWorkspace('Expenses & Payables'); onWorkspaceChange('Expenses & Payables'); }} onOpenWorkspace={(name) => { setWorkspace(name); onWorkspaceChange(name); }} />}
      {['Overview', 'Financial Reports', 'Subscriber Growth'].includes(workspace) && <FinanceReports key={`${workspace}-${meta.actorUsername}`} api={api} meta={meta} mode={workspace === 'Overview' ? 'overview' : workspace === 'Subscriber Growth' ? 'subscribers' : 'financial'} refreshVersion={refreshVersion} pending={pending} onPendingChange={setPending} onBusyChange={setReportBusy} onOpenPayable={(id) => { setSelectedExpenseId(id); setWorkspace('Expenses & Payables'); onWorkspaceChange('Expenses & Payables'); }} />}
      {workspace === 'Expenses & Payables' && <ExpensesPayables api={api} meta={meta} pending={pending} onPendingChange={setPending} onBusyChange={setExpenseBusy} parentBusy={busy} refreshVersion={refreshVersion} initialPayableId={selectedExpenseId} onSaved={async () => { try { await reload(); } catch (e) { setError(e.message); } }} />}
      {workspace === 'Income & Collections' && <IncomeCollections api={api} meta={meta} pending={pending} onPendingChange={setPending} onBusyChange={setIncomeBusy} parentBusy={busy} refreshVersion={refreshVersion} onSaved={async () => { try { await reload(); } catch (e) { setError(e.message); } }} />}
      {workspace === 'Accounts & Transfers' && <><div className="finance-toolbar"><nav aria-label="Accounting foundation views">{['Accounts', 'Card bills', 'Opening balances', 'Transfers', 'Journal'].map((name) => <button type="button" className={`btn ${section === name ? 'btn-primary' : 'btn-outline-primary'}`} key={name} disabled={busy || expenseBusy} onClick={() => setSection(name)}>{name}</button>)}</nav>
        <div>{allowed('finance.accounts.manage') && <button className="btn btn-primary" disabled={buttonsDisabled} onClick={() => start('account')}>New account</button>}
          {allowed('finance.transfers.post') && <button className="btn btn-outline-primary" disabled={buttonsDisabled || !allowed('finance.accounts.view')} onClick={() => start('transfer')}>Transfer funds</button>}
          {allowed('finance.journals.post') && <button className="btn btn-outline-primary" disabled={buttonsDisabled || !allowed('finance.accounts.view')} onClick={() => start('journal')}>Post journal</button>}
        </div></div>
      {section === 'Card bills' && <FinanceCards key={meta.actorUsername} api={api} meta={meta} accounts={accounts} refreshVersion={refreshVersion} pending={pending} onPendingChange={setPending} onBusyChange={setExpenseBusy} onSaved={reload} />}
      {section === 'Accounts' && (allowed('finance.accounts.view') ? <>
        <p>Payment methods describe how money moves. Select the actual named account that holds funds. Credit-card balances show amounts owed; personal collector GCash shows funds due from the collector.</p>
        {accountView.controls}<label><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Include archived accounts</label>
        <div className="table-responsive"><table className="table table-striped"><thead><tr><th>Account</th><th>Type</th><th>Custodian</th><th>Balance (PHP)</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          {accountView.items.map((a) => <tr key={a.id}><td>{a.name}<small className="finance-code">{a.code}</small></td><td>{LABELS[a.kind]}</td><td>{a.custodian || '—'}</td><td>{moneyLabel(a.balance)}</td><td><FinanceStatus value={a.active ? 'ACTIVE' : 'ARCHIVED'} /></td><td className="finance-actions">
            <button className="btn btn-sm btn-outline-primary" onClick={async () => { try { setActivity(await api.request(`/api/finance/accounts/${a.id}/activity`)); } catch (e) { setError(e.message); } }}>Activity</button>
            {allowed('finance.accounts.manage') && <><button className="btn btn-sm btn-outline-secondary" disabled={buttonsDisabled} onClick={() => start('edit', a)}>Edit</button><button className="btn btn-sm btn-outline-secondary" disabled={buttonsDisabled} onClick={() => start(a.active ? 'archive' : 'restore', a)}>{a.active ? 'Archive' : 'Restore'}</button></>}
            {a.active && a.kind !== 'GENERAL_LEDGER' && allowed('finance.opening-balances.post') && <button className="btn btn-sm btn-outline-primary" disabled={buttonsDisabled} onClick={() => start('opening', a)}>Opening</button>}
          </td></tr>)}
          {!accountView.items.length && <tr><td colSpan="6">No financial accounts in this view.</td></tr>}
        </tbody></table></div>
        {accountView.pagination}{activity && <section className="card"><div className="card-body"><button className="btn btn-sm btn-outline-secondary float-end" onClick={() => setActivity(null)}>Close activity</button><h3>{activity.account.name} activity</h3><p>Balance {moneyLabel(activity.balance)} as of {activity.asOf}</p><div className="table-responsive"><table className="table"><thead><tr><th>Date</th><th>Entry</th><th>Debit</th><th>Credit</th><th>Balance</th><th>Posted by</th><th>Reason</th></tr></thead><tbody>{activity.items.map((r, i) => <tr key={`${r.entryId}-${i}`}><td>{r.effectiveDate}</td><td>{r.kind} #{r.number}</td><td>{moneyLabel(r.debit)}</td><td>{moneyLabel(r.credit)}</td><td>{moneyLabel(r.balance)}</td><td>{r.postedBy}</td><td>{r.reason}</td></tr>)}</tbody></table></div></div></section>}
      </> : <p>Your role does not grant financial account access.</p>)}
      {section === 'Opening balances' && (allowed('finance.accounts.view') ? <><p>Opening balances require supporting evidence and approval by a different authorized user. They do not create current-period income or cash flow.</p>{openingView.controls}<div className="table-responsive"><table className="table table-striped"><thead><tr><th>Account</th><th>Effective date</th><th>Amount</th><th>Creator</th><th>Approver</th><th>Status</th><th>Actions</th></tr></thead><tbody>{openingView.items.map((o) => <tr key={o.id}><td>{accounts.find((a) => a.id === o.accountId)?.name || 'Account'}</td><td>{o.effectiveDate}</td><td>{moneyLabel(o.amount)}</td><td>{o.createdBy}</td><td>{o.approvedBy || '—'}</td><td><FinanceStatus value={o.reversed ? 'REVERSED' : o.status} /></td><td>
        {o.status === 'DRAFT' && o.createdBy !== meta.actorUsername && allowed('finance.opening-balances.approve') && withinApprovalLimit(meta, o.amount) && <button className="btn btn-sm btn-primary" disabled={buttonsDisabled} onClick={() => start('approve', o)}>Approve</button>}
        {o.status === 'APPROVED' && allowed('finance.opening-balances.post') && <button className="btn btn-sm btn-primary" disabled={buttonsDisabled} onClick={() => start('post-opening', o)}>Post</button>}
      </td></tr>)}{!openingView.items.length && <tr><td colSpan="7">No opening balance requests.</td></tr>}</tbody></table></div>{openingView.pagination}</> : <p>Your role does not grant opening-balance access.</p>)}
      {['Journal', 'Transfers'].includes(section) && (allowed(section === 'Journal' ? 'finance.journals.view' : 'finance.transfers.view') ? <><p>Posted entries retain their original amounts and attribution. Correct mistakes through a linked reversal.</p>{entryView.controls}<div className="table-responsive"><table className="table table-striped"><thead><tr><th>Entry</th><th>Effective date</th><th>Reason / lines</th><th>Posted by</th><th>State</th><th>Action</th></tr></thead><tbody>{entryView.items.map((e) => <tr key={e.id}><td>#{e.number} {e.kind}</td><td>{e.effectiveDate}</td><td>{e.reason}{e.lines.map((l, i) => <small className="finance-code" key={i}>{l.accountSnapshot.name}: debit {moneyLabel(l.debit)}, credit {moneyLabel(l.credit)}</small>)}</td><td>{e.postedBy}</td><td><FinanceStatus value={e.reversedByEntryId ? 'REVERSED' : 'POSTED'} /></td><td>{e.metadata.payableId && <button className="btn btn-sm btn-outline-primary" disabled={busy} onClick={() => { setSelectedExpenseId(e.metadata.payableId); setWorkspace('Expenses & Payables'); onWorkspaceChange('Expenses & Payables'); }}>Open payable</button>}{!e.metadata.payableId && !e.metadata.incomeSourceId && !e.metadata.manualIncomeId && !e.metadata.cutoverId && e.kind !== 'REVERSAL' && !e.reversedByEntryId && allowed('finance.journals.reverse') && <button className="btn btn-sm btn-outline-danger" disabled={buttonsDisabled} onClick={() => start('reverse', e)}>Reverse</button>}</td></tr>)}{!entryView.items.length && <tr><td colSpan="6">No posted accounting entries.</td></tr>}</tbody></table></div>{entryView.pagination}</> : <p>Your role does not grant access to this accounting view.</p>)}
      </>}
    </>}
    {dialog && <FinanceDialog title={title[dialog.type]} onSubmit={submit} busy={busy} disabled={buttonsDisabled} onClose={closeDialog} error={error}>
      {['archive', 'restore', 'edit'].includes(dialog.type) && <p>{dialog.record.name} ({dialog.record.code})</p>}
      {dialog.type === 'account' && <>{fields('code', 'Account code', 'text', { maxLength: 40, pattern: '[A-Za-z0-9][A-Za-z0-9_-]*' })}{fields('name', 'Account name')}<label className="finance-field"><span>Account type</span><select className="form-select" value={form.kind} onChange={(e) => { const { glType, ...rest } = form; setForm({ ...rest, kind: e.target.value }); }}>{Object.entries(LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>{form.kind === 'GENERAL_LEDGER' && <label className="finance-field"><span>Accounting classification</span><select className="form-select" required value={form.glType || ''} onChange={(e) => setForm({ ...form, glType: e.target.value })}><option value="">Choose classification</option>{['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'CONTRA_REVENUE', 'EXPENSE'].map((k) => <option key={k}>{k}</option>)}</select></label>}{fields('custodian', 'Custodian', 'text', { required: form.kind.startsWith('COLLECTOR'), maxLength: 160 })}{fields('notes', 'Notes', 'text', { required: false, maxLength: 1000 })}</>}
      {dialog.type === 'edit' && <>{fields('name', 'Account name')}{fields('custodian', 'Custodian', 'text', { required: dialog.record.kind.startsWith('COLLECTOR') })}{fields('notes', 'Notes', 'text', { required: false, maxLength: 1000 })}</>}
      {dialog.type === 'opening' && <>{accountSelect('accountId', 'Named account')}{fields('amount', 'Opening balance (amount held or owed)', 'text', { inputMode: 'decimal', pattern: '\\d+(\\.\\d{1,2})?' })}{fields('effectiveDate', 'Effective date', 'date', { max: businessDate() })}{fields('evidenceReference', 'Supporting evidence reference')}{fields('reason', 'Reason', 'text', { minLength: 3, maxLength: 1000 })}<p>The request is saved for independent approval before posting.</p></>}
      {dialog.type === 'transfer' && <>{accountSelect('fromAccountId', 'From account (funding source)')}{accountSelect('toAccountId', 'To account (destination or card being repaid)')}{fields('amount', 'Amount (PHP)', 'text', { inputMode: 'decimal', pattern: '\\d+(\\.\\d{1,2})?' })}{fields('effectiveDate', 'Actual movement date', 'date', { max: businessDate() })}<label className="finance-field"><span>Transfer method</span><select className="form-select" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{['CASH_HANDOVER', 'GCASH_TRANSFER', 'BANK_TRANSFER', 'CARD_SETTLEMENT', 'CARD_FUNDING', 'OTHER'].map((k) => <option key={k}>{k}</option>)}</select></label>{fields('referenceNumber', 'Supporting transfer reference', 'text', { required: form.method !== 'CASH_HANDOVER' })}{fields('sourceReference', 'Document reference')}{fields('reason', 'Reason', 'text', { minLength: 3, maxLength: 1000 })}<p>This posts an immediate funds movement. Card funding increases the source card debt; settlement reduces the destination card debt. Fees are recorded separately.</p></>}
      {dialog.type === 'journal' && <>{fields('effectiveDate', 'Effective date', 'date', { max: businessDate() })}{fields('sourceReference', 'Document reference')}{fields('reason', 'Reason', 'text', { minLength: 3, maxLength: 1000 })}<p>Enter balanced debit and credit lines. Each line uses one side.</p>{form.lines.map((line, i) => <div className="finance-journal-line" key={i}><label><span>Account {i + 1}</span><select className="form-select" required value={line.accountId} onChange={(e) => setForm({ ...form, lines: form.lines.map((l, n) => n === i ? { ...l, accountId: e.target.value } : l) })}><option value="">Choose account</option>{accountOptions(line.accountId, true)}</select></label>{['debit', 'credit'].map((side) => <label key={side}><span>{side === 'debit' ? 'Debit' : 'Credit'}</span><input className="form-control" inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={line[side]} onChange={(e) => setForm({ ...form, lines: form.lines.map((l, n) => n === i ? { ...l, [side]: e.target.value } : l) })} /></label>)}{form.lines.length > 2 && <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setForm({ ...form, lines: form.lines.filter((_, n) => n !== i) })}>Remove</button>}</div>)}<button type="button" className="btn btn-outline-primary" disabled={form.lines.length >= 100} onClick={() => setForm({ ...form, lines: [...form.lines, EMPTY_LINE()] })}>Add line</button></>}
      {dialog.type === 'reverse' && <><p>Reverse entry #{dialog.record.number}: {dialog.record.reason}</p>{fields('effectiveDate', 'Reversal effective date', 'date', { max: businessDate(), min: dialog.record.effectiveDate })}{fields('reason', 'Correction reason', 'text', { minLength: 3, maxLength: 1000 })}</>}
      {['archive', 'restore', 'approve'].includes(dialog.type) && <>{dialog.type === 'approve' && <p>Approve {moneyLabel(dialog.record.amount)} effective {dialog.record.effectiveDate}. Evidence: {dialog.record.evidenceReference}. Creator: {dialog.record.createdBy}.</p>}{fields('reason', 'Reason', 'text', { minLength: 3, maxLength: 1000 })}{dialog.type === 'archive' && <p>Archival requires a zero balance and preserves all financial history.</p>}</>}
      {dialog.type === 'post-opening' && <p>Post the approved opening {moneyLabel(dialog.record.amount)} effective {dialog.record.effectiveDate}. Approved by {dialog.record.approvedBy}. This is an opening-equity entry.</p>}
      {pending && <p className="alert alert-warning">Request awaiting confirmation. Close this dialog and confirm the saved request.</p>}
    </FinanceDialog>}
  </div>;
}
