import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FinanceApi, businessDate, moneyLabel, newReference } from './financeApi.mjs';
import './finance.css';
import ExpensesPayables from './ExpensesPayables.jsx';
import FinanceCards from './FinanceCards.jsx';
import FinanceAccountsList from './FinanceAccountsList.jsx';
import FinanceAccountHistory from './FinanceAccountHistory.jsx';
import { ACCOUNT_LABELS as LABELS, suggestedTransferMethod, TRANSFER_LABELS, accountGroup } from './accountPresentation.mjs';
import IncomeCollections from './IncomeCollections.jsx';
import FinanceReports from './FinanceReports.jsx';
import FinanceDialog from './FinanceDialog.jsx';
import FinanceActivity from './FinanceActivity.jsx';
import FinanceNotifications, { FinanceNotice, FinanceNotificationProvider } from './FinanceNotifications.jsx';
import { withinApprovalLimit } from './reportClient.mjs';
import { useRecordView, FinanceStatus } from './FinanceRecords.jsx';

const EMPTY_LINE = () => ({ accountId: '', debit: '', credit: '', memo: '' });

function FinanceContent({ apiBase = '', refreshShell = () => {}, initialWorkspace = 'Overview', onWorkspaceChange = () => {} }) {
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
  const [accountGroupFilter, setAccountGroupFilter] = useState('');
  const [cardAccountId, setCardAccountId] = useState('');
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
    setForm(type === 'account' ? { code: `FA-${newReference()}`, name: '', kind: section === 'Accounting accounts' ? 'GENERAL_LEDGER' : section === 'Collector custody' ? 'COLLECTOR_CASH' : 'CASH', custodian: '', notes: '', setStartingBalance: false }
      : type === 'edit' ? { name: record.name, custodian: record.custodian, notes: record.notes, version: record.version }
        : type === 'journal' ? { effectiveDate: businessDate(), sourceReference: newReference(), reason: '', lines: [EMPTY_LINE(), EMPTY_LINE()] }
          : type === 'transfer' ? { fromAccountId: record?.kind !== 'CREDIT_CARD' ? record?.id || '' : '', toAccountId: '', amount: '', effectiveDate: businessDate(), sourceReference: newReference(), reason: '', method: suggestedTransferMethod(record?.kind !== 'CREDIT_CARD' ? record : null, null), referenceNumber: '' }
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
      return result;
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

  async function submit(event) {
    event.preventDefault();
    const { type, record } = dialog;
    if (type === 'account') {
      const { setStartingBalance, ...payload } = form;
      const created = await perform('/api/finance/accounts', 'POST', payload);
      if (created && setStartingBalance && payload.kind !== 'GENERAL_LEDGER') {
        setSection('Starting balances'); start('opening', created);
        setNotice('Account created. Add its starting-balance evidence for independent approval, or cancel to do this later.');
      }
      return;
    }
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
  const visibleAccounts = accounts.filter((a) => !a.system && (showArchived || a.active) && (section === 'Accounting accounts' ? a.kind === 'GENERAL_LEDGER' : section === 'Collector custody' ? a.kind.startsWith('COLLECTOR') : !a.kind.startsWith('COLLECTOR') && a.kind !== 'GENERAL_LEDGER' && (!accountGroupFilter || accountGroup(a) === accountGroupFilter)));
  const accountView = useRecordView(visibleAccounts, { statuses: ['ACTIVE', 'ARCHIVED'], getStatus: (r) => r.active ? 'ACTIVE' : 'ARCHIVED', dates: false, resetKey: `${section}-${accountGroupFilter}` });
  const openingView = useRecordView(openings, { statuses: ['DRAFT', 'APPROVED', 'POSTED'], resetKey: section });
  const entryView = useRecordView(entries.filter((e) => section === 'Journal' || e.kind === 'TRANSFER'), { statuses: ['POSTED', 'REVERSED'], getStatus: (e) => e.reversedByEntryId ? 'REVERSED' : 'POSTED', resetKey: section });
  const title = { account: 'New financial account', edit: 'Edit account', archive: 'Archive account', restore: 'Restore account', opening: 'Set starting balance', approve: 'Approve opening balance', 'post-opening': 'Post opening balance', transfer: 'Transfer money', journal: 'Post accounting journal', reverse: 'Reverse journal entry' };
  const buttonsDisabled = busy || expenseBusy || incomeBusy || reportBusy || Boolean(pending);
  const canReviewSetup = ['finance.accounts.manage', 'finance.opening-balances.post', 'finance.opening-balances.approve', 'finance.cutover.manage', 'finance.cutover.approve'].some((grant) => allowed(grant));

  return <div className="finance-management container-xl">
    <header className="finance-header"><div><p className="page-pretitle">Finance Management</p><h2>{workspace}</h2></div></header>
    <FinanceNotifications error={error} notice={notice} hideError={Boolean(dialog)} onErrorDismiss={() => setError('')} onNoticeDismiss={() => setNotice('')} />
    {workspace === 'Overview' && canReviewSetup && meta?.setupStatus === 'PENDING_REVIEWED_CUTOVER' && <details className="finance-setup-notice mb-3"><summary>Finance setup is incomplete. <span className="text-primary">Review setup</span></summary><div className="card card-body mt-2"><p>Review starting account balances in Accounts &amp; Transfers → Manage → Starting balances. Then agree on the date Finance starts recording existing payment sources in Income &amp; Collections → Cutover.</p><p className="mb-0">A different authorized person must approve the setup. Earlier Billing receipts remain historical evidence so money is counted once. Reports show provisional figures until the required evidence is complete.</p></div></details>}
    <FinanceNotice message={pending ? "A Finance request is awaiting confirmation. Retry the saved request before posting another action." : ""} tone="warning" dismissible={false}><button type="button" className="btn btn-warning" disabled={busy || expenseBusy || incomeBusy || reportBusy} onClick={retry}>Confirm saved request</button></FinanceNotice>
    {loading ? <p role="status">Loading Finance accounts…</p> : !meta ? <button className="btn btn-outline-primary" onClick={() => reload().catch((e) => setError(e.message))}>Retry loading Finance</button> : <>
      {workspace === 'Activity' && <FinanceActivity key={meta.actorUsername} api={api} meta={meta} refreshVersion={refreshVersion} onOpenPayable={(id) => { setSelectedExpenseId(id); setWorkspace('Expenses & Payables'); onWorkspaceChange('Expenses & Payables'); }} onOpenWorkspace={(name) => { setWorkspace(name); onWorkspaceChange(name); }} />}
      {['Overview', 'Financial Reports', 'Subscriber Growth'].includes(workspace) && <FinanceReports key={`${workspace}-${meta.actorUsername}`} api={api} meta={meta} mode={workspace === 'Overview' ? 'overview' : workspace === 'Subscriber Growth' ? 'subscribers' : 'financial'} refreshVersion={refreshVersion} pending={pending} onPendingChange={setPending} onBusyChange={setReportBusy} onOpenPayable={(id) => { setSelectedExpenseId(id); setWorkspace('Expenses & Payables'); onWorkspaceChange('Expenses & Payables'); }} />}
      {workspace === 'Expenses & Payables' && <ExpensesPayables api={api} meta={meta} pending={pending} onPendingChange={setPending} onBusyChange={setExpenseBusy} parentBusy={busy} refreshVersion={refreshVersion} initialPayableId={selectedExpenseId} onSaved={async () => { try { await reload(); } catch (e) { setError(e.message); } }} />}
      {workspace === 'Income & Collections' && <IncomeCollections api={api} meta={meta} pending={pending} onPendingChange={setPending} onBusyChange={setIncomeBusy} parentBusy={busy} refreshVersion={refreshVersion} onSaved={async () => { try { await reload(); } catch (e) { setError(e.message); } }} />}
      {workspace === 'Accounts & Transfers' && <>
        <div className="finance-toolbar"><div>
          {(section !== 'Accounts' || activity) && <button className="btn btn-outline-secondary" disabled={buttonsDisabled} onClick={() => { setActivity(null); setSection('Accounts'); }}>Back to accounts</button>}
          {allowed('finance.accounts.manage') && <button className="btn btn-primary" disabled={buttonsDisabled} onClick={() => start('account')}>{section === 'Accounting accounts' ? 'Add accounting account' : section === 'Collector custody' ? 'Add custody account' : 'Add account'}</button>}
          {allowed('finance.transfers.post') && <button className="btn btn-outline-primary" disabled={buttonsDisabled || !allowed('finance.accounts.view')} onClick={() => start('transfer', activity?.account)}>Transfer money</button>}
        </div>
        {(['finance.accounts.manage', 'finance.opening-balances.post', 'finance.opening-balances.approve', 'finance.journals.view', 'finance.journals.post', 'finance.transfers.view'].some((p) => allowed(p))) && <details className="finance-manage"><summary className="btn btn-outline-secondary">Manage</summary><div className="finance-manage-options">
          {allowed('finance.accounts.view') && allowed('finance.transfers.view') && <button type="button" className="btn btn-link" disabled={buttonsDisabled} onClick={(event) => { event.currentTarget.closest('details').open = false; setCardAccountId(activity?.account.kind === 'CREDIT_CARD' ? activity.account.id : ''); setActivity(null); setSection('Card bills'); }}>Pay credit card</button>}
          {allowed('finance.transfers.view') && <button type="button" className="btn btn-link" disabled={buttonsDisabled} onClick={(event) => { event.currentTarget.closest('details').open = false; setActivity(null); setSection('Transfers'); }}>Transfer history</button>}
          {['finance.accounts.manage', 'finance.opening-balances.post', 'finance.opening-balances.approve', 'finance.journals.view', 'finance.journals.post'].some((p) => allowed(p)) && allowed('finance.accounts.view') && ['Accounting accounts', 'Collector custody', 'Starting balances'].map((name) => <button type="button" className="btn btn-link" key={name} disabled={buttonsDisabled} onClick={(event) => { event.currentTarget.closest('details').open = false; setActivity(null); setSection(name); }}>{name}</button>)}
          {allowed('finance.journals.view') && <button type="button" className="btn btn-link" disabled={buttonsDisabled} onClick={(event) => { event.currentTarget.closest('details').open = false; setActivity(null); setSection('Journal'); }}>Journal entries</button>}
          {allowed('finance.journals.post') && allowed('finance.accounts.view') && <button type="button" className="btn btn-link" disabled={buttonsDisabled} onClick={(event) => { event.currentTarget.closest('details').open = false; start('journal'); }}>Post journal</button>}
        </div></details>}
        </div>
        {section !== 'Accounts' && <h3>{section === 'Journal' ? 'Journal entries' : section === 'Transfers' ? 'Transfer history' : section}</h3>}
        {section === 'Card bills' && <FinanceCards key={`${meta.actorUsername}-${cardAccountId}`} api={api} meta={meta} accounts={accounts} accountId={cardAccountId} refreshVersion={refreshVersion} pending={pending} onPendingChange={setPending} onBusyChange={setExpenseBusy} onSaved={reload} />}
        {section === 'Accounts' && (allowed('finance.accounts.view') ? activity ? <section className="card"><div className="card-body">
          <h3>{activity.account.name}</h3><p>{LABELS[activity.account.kind]} · <FinanceStatus value={activity.account.active ? 'ACTIVE' : 'ARCHIVED'} /></p>
          <p className="finance-account-balance">{activity.account.kind === 'CREDIT_CARD' ? 'Amount owed' : activity.account.kind.startsWith('COLLECTOR') ? 'Held / due' : 'Recorded balance'} <strong>{moneyLabel(activity.balance)}</strong> · As of {activity.asOf}</p>
          <div className="finance-actions mb-3">{allowed('finance.accounts.manage') && !activity.account.system && <><button className="btn btn-outline-secondary" disabled={buttonsDisabled} onClick={() => start('edit', activity.account)}>Edit account</button><button className="btn btn-outline-secondary" disabled={buttonsDisabled} onClick={() => start(activity.account.active ? 'archive' : 'restore', activity.account)}>{activity.account.active ? 'Archive account' : 'Restore account'}</button></>}
          {activity.account.active && allowed('finance.opening-balances.post') && <button className="btn btn-outline-secondary" disabled={buttonsDisabled} onClick={() => start('opening', activity.account)}>Set starting balance</button>}</div>
          <details className="mb-3"><summary>Account details</summary><p>Account code: {activity.account.code}<br />Person responsible: {activity.account.custodian || '—'}<br />Notes: {activity.account.notes || '—'}</p></details>
          <FinanceAccountHistory activity={activity} />
        </div></section> : <FinanceAccountsList accounts={accounts.filter((a) => !a.system && !a.kind.startsWith('COLLECTOR') && a.kind !== 'GENERAL_LEDGER')} view={accountView} group={accountGroupFilter} onGroup={setAccountGroupFilter} showArchived={showArchived} onArchived={setShowArchived} provisional={meta.setupStatus === 'PENDING_REVIEWED_CUTOVER'} onOpen={async (a) => { try { setActivity(await api.request(`/api/finance/accounts/${a.id}/activity`)); } catch (e) { setError(e.message); } }} /> : <p>Your role does not grant financial account access.</p>)}
        {['Accounting accounts', 'Collector custody'].includes(section) && (allowed('finance.accounts.view') ? <>{accountView.controls}<label className="mb-3"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Include archived accounts</label><div className="table-responsive"><table className="table table-striped"><thead><tr><th>Account</th><th>{section === 'Collector custody' ? 'Type / person responsible' : 'Classification'}</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead><tbody>{accountView.items.map((a) => <tr key={a.id}><td>{a.name}<small className="finance-code">{a.code}</small></td><td>{section === 'Collector custody' ? <>{LABELS[a.kind]}<small className="finance-code">{a.custodian}</small></> : a.glType}</td><td>{moneyLabel(a.balance)}</td><td><FinanceStatus value={a.active ? 'ACTIVE' : 'ARCHIVED'} /></td><td>{allowed('finance.accounts.manage') && <><button className="btn btn-sm btn-outline-secondary" disabled={buttonsDisabled} onClick={() => start('edit', a)}>Edit</button><button className="btn btn-sm btn-outline-secondary" disabled={buttonsDisabled} onClick={() => start(a.active ? 'archive' : 'restore', a)}>{a.active ? 'Archive' : 'Restore'}</button></>}</td></tr>)}{!accountView.items.length && <tr><td colSpan="5">No accounting accounts in this view.</td></tr>}</tbody></table></div>{accountView.pagination}</> : <p>Your role does not grant accounting account access.</p>)}
      {section === 'Starting balances' && (allowed('finance.accounts.view') ? <><p>Opening balances require supporting evidence and approval by a different authorized user. They do not create current-period income or cash flow.</p>{openingView.controls}<div className="table-responsive"><table className="table table-striped"><thead><tr><th>Account</th><th>Effective date</th><th>Amount</th><th>Creator</th><th>Approver</th><th>Status</th><th>Actions</th></tr></thead><tbody>{openingView.items.map((o) => <tr key={o.id}><td>{accounts.find((a) => a.id === o.accountId)?.name || 'Account'}</td><td>{o.effectiveDate}</td><td>{moneyLabel(o.amount)}</td><td>{o.createdBy}</td><td>{o.approvedBy || '—'}</td><td><FinanceStatus value={o.reversed ? 'REVERSED' : o.status} /></td><td>
        {o.status === 'DRAFT' && o.createdBy !== meta.actorUsername && allowed('finance.opening-balances.approve') && withinApprovalLimit(meta, o.amount) && <button className="btn btn-sm btn-primary" disabled={buttonsDisabled} onClick={() => start('approve', o)}>Approve</button>}
        {o.status === 'APPROVED' && allowed('finance.opening-balances.post') && <button className="btn btn-sm btn-primary" disabled={buttonsDisabled} onClick={() => start('post-opening', o)}>Post</button>}
      </td></tr>)}{!openingView.items.length && <tr><td colSpan="7">No opening balance requests.</td></tr>}</tbody></table></div>{openingView.pagination}</> : <p>Your role does not grant opening-balance access.</p>)}
      {['Journal', 'Transfers'].includes(section) && (allowed(section === 'Journal' ? 'finance.journals.view' : 'finance.transfers.view') ? <><p>Posted entries retain their original amounts and attribution. Correct mistakes through a linked reversal.</p>{entryView.controls}<div className="table-responsive"><table className="table table-striped"><thead><tr><th>Entry</th><th>Effective date</th><th>{section === 'Transfers' ? 'Movement / purpose' : 'Reason / lines'}</th><th>Posted by</th><th>State</th><th>Action</th></tr></thead><tbody>{entryView.items.map((e) => <tr key={e.id}><td>#{e.number} {e.kind}</td><td>{e.effectiveDate}</td><td>{section === 'Transfers' && <><strong>{accounts.find((a) => a.id === e.metadata.fromAccountId)?.name || e.lines.find((l) => l.accountId === e.metadata.fromAccountId)?.accountSnapshot.name || 'Source account'} → {accounts.find((a) => a.id === e.metadata.toAccountId)?.name || e.lines.find((l) => l.accountId === e.metadata.toAccountId)?.accountSnapshot.name || 'Destination account'}</strong><small className="finance-code">{moneyLabel(e.metadata.amount)} · {TRANSFER_LABELS[e.metadata.method] || 'Transfer'}</small></>}{e.reason}<details><summary>Accounting details</summary>{e.lines.map((l, i) => <small className="finance-code" key={i}>{l.accountSnapshot.name}: debit {moneyLabel(l.debit)}, credit {moneyLabel(l.credit)}</small>)}</details></td><td>{e.postedBy}</td><td><FinanceStatus value={e.reversedByEntryId ? 'REVERSED' : 'POSTED'} /></td><td>{e.metadata.cardStatementId && <button className="btn btn-sm btn-outline-primary" disabled={buttonsDisabled} onClick={() => { setCardAccountId(e.metadata.toAccountId || ''); setSection('Card bills'); }}>Open card bills</button>}{e.metadata.payableId && <button className="btn btn-sm btn-outline-primary" disabled={busy} onClick={() => { setSelectedExpenseId(e.metadata.payableId); setWorkspace('Expenses & Payables'); onWorkspaceChange('Expenses & Payables'); }}>Open payable</button>}{!e.metadata.cardStatementId && !e.metadata.payableId && !e.metadata.incomeSourceId && !e.metadata.manualIncomeId && !e.metadata.cutoverId && e.kind !== 'REVERSAL' && !e.reversedByEntryId && allowed('finance.journals.reverse') && <button className="btn btn-sm btn-outline-danger" disabled={buttonsDisabled} onClick={() => start('reverse', e)}>Reverse</button>}</td></tr>)}{!entryView.items.length && <tr><td colSpan="6">No posted accounting entries.</td></tr>}</tbody></table></div>{entryView.pagination}</> : <p>Your role does not grant access to this accounting view.</p>)}
      </>}
    </>}
    {dialog && <FinanceDialog title={title[dialog.type]} onSubmit={submit} busy={busy} disabled={buttonsDisabled} onClose={closeDialog} error={error}>
      {['archive', 'restore', 'edit'].includes(dialog.type) && <p>{dialog.record.name} ({dialog.record.code})</p>}
      {dialog.type === 'account' && <>{fields('name', 'Account name')}<label className="finance-field"><span>Account type</span><select className="form-select" value={form.kind} onChange={(e) => { const { glType, ...rest } = form; setForm({ ...rest, kind: e.target.value, setStartingBalance: false }); }}>{Object.entries(LABELS).filter(([k]) => section === 'Accounting accounts' ? k === 'GENERAL_LEDGER' : section === 'Collector custody' ? k.startsWith('COLLECTOR') : k !== 'GENERAL_LEDGER' && !k.startsWith('COLLECTOR')).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>
        {form.kind === 'GENERAL_LEDGER' && <label className="finance-field"><span>Accounting classification</span><select className="form-select" required value={form.glType || ''} onChange={(e) => setForm({ ...form, glType: e.target.value })}><option value="">Choose classification</option>{['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'CONTRA_REVENUE', 'EXPENSE'].map((k) => <option key={k}>{k}</option>)}</select></label>}
        {form.kind.startsWith('COLLECTOR') && fields('custodian', 'Person responsible', 'text', { maxLength: 160 })}
        <details className="mb-3"><summary>More details</summary>{!form.kind.startsWith('COLLECTOR') && fields('custodian', 'Person responsible (optional)', 'text', { required: false, maxLength: 160 })}{fields('notes', 'Notes (optional)', 'text', { required: false, maxLength: 1000 })}<p>Account code is generated automatically: {form.code}</p></details>
        {form.kind !== 'GENERAL_LEDGER' && allowed('finance.opening-balances.post') && <label><input type="checkbox" checked={form.setStartingBalance} onChange={(e) => setForm({ ...form, setStartingBalance: e.target.checked })} /> Set starting balance after creating this account</label>}
      </>}
      {dialog.type === 'edit' && <>{fields('name', 'Account name')}{fields('custodian', 'Custodian', 'text', { required: dialog.record.kind.startsWith('COLLECTOR') })}{fields('notes', 'Notes', 'text', { required: false, maxLength: 1000 })}</>}
      {dialog.type === 'opening' && <>{accountSelect('accountId', 'Named account')}{fields('amount', 'Opening balance (amount held or owed)', 'text', { inputMode: 'decimal', pattern: '\\d+(\\.\\d{1,2})?' })}{fields('effectiveDate', 'Effective date', 'date', { max: businessDate() })}{fields('evidenceReference', 'Supporting evidence reference')}{fields('reason', 'Reason', 'text', { minLength: 3, maxLength: 1000 })}<p>The request is saved for independent approval before posting.</p></>}
      {dialog.type === 'transfer' && <>{['fromAccountId', 'toAccountId'].map((key) => <label className="finance-field" key={key}><span>{key === 'fromAccountId' ? 'From account' : 'To account'}</span><select className="form-select" aria-label={key === 'fromAccountId' ? 'From account' : 'To account'} required value={form[key]} onChange={(e) => { const next = { ...form, [key]: e.target.value, referenceNumber: '' }; next.method = suggestedTransferMethod(accounts.find((a) => a.id === next.fromAccountId), accounts.find((a) => a.id === next.toAccountId)); setForm(next); }}><option value="">Choose account</option>{accounts.filter((a) => a.active && !a.system && a.kind !== 'GENERAL_LEDGER' && a.id !== form[key === 'fromAccountId' ? 'toAccountId' : 'fromAccountId'] && !(a.kind === 'CREDIT_CARD' && accounts.find((other) => other.id === form[key === 'fromAccountId' ? 'toAccountId' : 'fromAccountId'])?.kind === 'CREDIT_CARD')).map((a) => <option key={a.id} value={a.id}>{a.name} — {LABELS[a.kind]}</option>)}</select></label>)}
        {fields('amount', 'Amount (PHP)', 'text', { inputMode: 'decimal', pattern: '\\d+(\\.\\d{1,2})?' })}{fields('effectiveDate', 'Transfer date', 'date', { max: businessDate() })}{fields('reason', 'Purpose', 'text', { minLength: 3, maxLength: 1000 })}
        {form.method !== 'CASH_HANDOVER' && fields('referenceNumber', 'Payment / transfer reference', 'text', { maxLength: 160 })}
        {form.fromAccountId && form.toAccountId && form.amount && <p className="alert alert-info">Move {moneyLabel(form.amount)} from {accounts.find((a) => a.id === form.fromAccountId)?.name} to {accounts.find((a) => a.id === form.toAccountId)?.name}.</p>}
        <details><summary>More details</summary><label className="finance-field"><span>Transfer method</span><select className="form-select" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value, referenceNumber: '' })}>{Object.entries(TRANSFER_LABELS).filter(([k]) => { const hasCard = accounts.find((a) => a.id === form.fromAccountId)?.kind === 'CREDIT_CARD' || accounts.find((a) => a.id === form.toAccountId)?.kind === 'CREDIT_CARD'; return hasCard ? k === suggestedTransferMethod(accounts.find((a) => a.id === form.fromAccountId), accounts.find((a) => a.id === form.toAccountId)) : !k.startsWith('CARD_'); }).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label></details>
        <p>This moves funds between accounts. It creates no income or expense. {form.method === 'CARD_SETTLEMENT' ? 'To allocate a repayment to a card bill, use Pay credit card or link this transfer to the bill later.' : form.method === 'CARD_FUNDING' ? 'This increases card debt. Record fees separately.' : ''}</p>
      </>}
      {dialog.type === 'journal' && <>{fields('effectiveDate', 'Effective date', 'date', { max: businessDate() })}{fields('sourceReference', 'Document reference')}{fields('reason', 'Reason', 'text', { minLength: 3, maxLength: 1000 })}<p>Enter balanced debit and credit lines. Each line uses one side.</p>{form.lines.map((line, i) => <div className="finance-journal-line" key={i}><label><span>Account {i + 1}</span><select className="form-select" required value={line.accountId} onChange={(e) => setForm({ ...form, lines: form.lines.map((l, n) => n === i ? { ...l, accountId: e.target.value } : l) })}><option value="">Choose account</option>{accountOptions(line.accountId, true)}</select></label>{['debit', 'credit'].map((side) => <label key={side}><span>{side === 'debit' ? 'Debit' : 'Credit'}</span><input className="form-control" inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={line[side]} onChange={(e) => setForm({ ...form, lines: form.lines.map((l, n) => n === i ? { ...l, [side]: e.target.value } : l) })} /></label>)}{form.lines.length > 2 && <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setForm({ ...form, lines: form.lines.filter((_, n) => n !== i) })}>Remove</button>}</div>)}<button type="button" className="btn btn-outline-primary" disabled={form.lines.length >= 100} onClick={() => setForm({ ...form, lines: [...form.lines, EMPTY_LINE()] })}>Add line</button></>}
      {dialog.type === 'reverse' && <><p>Reverse entry #{dialog.record.number}: {dialog.record.reason}</p>{fields('effectiveDate', 'Reversal effective date', 'date', { max: businessDate(), min: dialog.record.effectiveDate })}{fields('reason', 'Correction reason', 'text', { minLength: 3, maxLength: 1000 })}</>}
      {['archive', 'restore', 'approve'].includes(dialog.type) && <>{dialog.type === 'approve' && <p>Approve {moneyLabel(dialog.record.amount)} effective {dialog.record.effectiveDate}. Evidence: {dialog.record.evidenceReference}. Creator: {dialog.record.createdBy}.</p>}{fields('reason', 'Reason', 'text', { minLength: 3, maxLength: 1000 })}{dialog.type === 'archive' && <p>Archival requires a zero balance and preserves all financial history.</p>}</>}
      {dialog.type === 'post-opening' && <p>Post the approved opening {moneyLabel(dialog.record.amount)} effective {dialog.record.effectiveDate}. Approved by {dialog.record.approvedBy}. This is an opening-equity entry.</p>}
      {pending && <p className="alert alert-warning">Request awaiting confirmation. Close this dialog and confirm the saved request.</p>}
    </FinanceDialog>}
  </div>;
}

export default function FinancePage(props) {
  return <FinanceNotificationProvider><FinanceContent {...props} /></FinanceNotificationProvider>;
}
