import React, { useCallback, useEffect, useRef, useState } from 'react';
import FinanceDialog from './FinanceDialog.jsx';
import FinancePeriods from './FinancePeriods.jsx';
import FinanceRecords, { FinanceStatus } from './FinanceRecords.jsx';
import { FinanceBarChart, FinanceTrendChart } from './FinanceCharts.jsx';
import { businessDate, moneyLabel } from './financeApi.mjs';
import { REPORT_LABELS, humanLabel, metricLabel, metricText, reportQuery, defaultPeriod, reportWindowValid, hasGrant, canReadFinancial, topExpenseGroups, subscriberSupportingRows, ACTIVE_LINES } from './reportClient.mjs';

const BASIS_LABELS = { FINANCE_POSTED_LEDGER: 'Posted accounting records; expenses recognized when incurred', AS_OF_OBLIGATIONS: 'Outstanding obligations at the selected as-of date', CERTIFIED_SERVICE_LIFECYCLE_AND_BILLING_RATES: 'Dated Service history and Billing rates', BILLING_MONTH_COHORT: 'Selected billing month; settlement through the as-of date' };
const MONEY_FIELDS = new Set(['amount', 'openingBalance', 'openingAdjustments', 'netMovement', 'closingBalance', 'outstandingAmount', 'collectionAmount', 'refundAmount', 'netBilledAmount', 'cashCollected', 'accountCreditsApplied', 'rebatesApplied', 'monthlyRecurringRate', 'debit', 'credit']);
function display(key, value) {
  if (value == null) return 'Unavailable';
  if (MONEY_FIELDS.has(key)) return moneyLabel(value);
  if (Array.isArray(value)) return value.join(' · ');
  return typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value);
}
function dataRows(kind, report) {
  if (!report) return [];
  if (kind === 'cash-flow') return report.accounts || [];
  if (kind === 'profit-and-loss' || kind === 'expenses') return report.transactions || [];
  if (kind === 'transactions') return report.items || [];
  if (kind === 'subscribers') return report.events || [];
  return report.rows || [];
}
function columnsFor(rows) {
  const preferred = ['boundary', 'name', 'accountName', 'kind', 'effectiveDate', 'dueDate', 'customerId', 'serviceAccountId', 'serviceAccountIds', 'invoiceId', 'invoiceIds', 'payeeName', 'categoryName', 'classification', 'groupName', 'openingBalance', 'openingAdjustments', 'netMovement', 'closingBalance', 'amount', 'monthlyRecurringRate', 'netBilledAmount', 'cashCollected', 'accountCreditsApplied', 'rebatesApplied', 'outstandingAmount', 'collectionAmount', 'refundAmount', 'agingBucket', 'settlementStatus', 'status', 'number', 'reason', 'postedBy', 'source', 'recordId', 'code', 'message', 'evidenceReference', 'rateEvidence'];
  const flat = rows.map(flatRow);
  let keys = preferred.filter((key) => flat.some((r) => key in r));
  if (!keys.length) keys = ['effectiveDate', 'classification', 'amount'];
  return keys.map((key) => ({ key, label: humanLabel(key), render: (r) => { const row = flatRow(r); if (!(key in row)) return '—'; if (['status', 'settlementStatus'].includes(key)) return <FinanceStatus value={row[key]} />; if (['kind', 'classification', 'agingBucket'].includes(key)) return humanLabel(row[key]); return display(key, row[key]); } }));
}
function flatRow(row) { return row.line ? { ...row, ...row.line } : row; }

export function ReportContext({ report }) {
  if (!report) return null;
  return <div className="finance-report-context"><div><FinanceStatus value={report.status} /> <strong>{report.period?.startDate || 'All dates'} through {report.period?.endDate || report.asOf}</strong> · As of {report.asOf} · {report.timeZone || 'Asia/Manila'} · PHP</div><p>{BASIS_LABELS[report.basis] || humanLabel(report.basis)}{report.expenseBasis && ` · ${report.expenseBasis === 'SETTLED' ? 'Supplier payments, including card-funded payments' : 'Recognized expenses, excluding asset and inventory purchases'}`}</p><small>Generated {report.generatedAt || 'with the selected report'} · {report.periodState === 'CLOSED' ? `Published revision ${report.publicationVersion}, closed by ${report.publicationClosedBy}. Reopening preserves this publication in the period audit trail.` : 'Includes currently known posted evidence; later backdated entries can change an open period report.'}</small>{report.reasonCodes?.length > 0 && <p className="text-secondary">{report.reasonCodes.map(humanLabel).join(' · ')}</p>}{report.missingDependencies?.length > 0 && <p className="text-secondary">Coverage still required: {report.missingDependencies.map(humanLabel).join(' · ')}.</p>}</div>;
}
function Summary({ label, value, status, note, onOpen }) { return <button type="button" className="card finance-summary" onClick={onOpen}><span className="card-body"><span className="finance-summary-label">{label}</span><strong>{value}</strong><FinanceStatus value={status} />{note && <small>{note}</small>}<small>View supporting records →</small></span></button>; }
function PrintReport({ kind, report }) {
  const sections = [{ title: 'Supporting records', rows: dataRows(kind, report) }];
  if (kind === 'subscribers') sections.push({ title: 'Opening service lines', rows: report.openingLines || [] }, { title: 'Closing service lines', rows: report.closingLines || [] }, { title: 'Monthly recurring rates', rows: report.monthlyRateRows || [] }, { title: 'Receipt-month collections', rows: report.receiptMonth?.rows || [] }, { title: 'Selected bill-month settlement', rows: report.billingPeriodSettlement?.rows || [] });
  if (kind === 'cash-flow') sections.push({ title: 'Cash-flow transactions', rows: report.transactions || [] }, { title: 'Account movements including internal transfers', rows: report.accountTransactions || [] });
  return <article className="finance-print-region"><h1>Finance Management — {REPORT_LABELS[kind]}</h1><ReportContext report={report} /><p>Prepared for {report.requestedBy}. All report records are included; screen search and status filters do not affect this report.</p>{report.metrics && <dl className="finance-detail-grid">{Object.entries(report.metrics).map(([key, m]) => <React.Fragment key={key}><dt>{metricLabel(key)}</dt><dd>{metricText(key, m)} · {humanLabel(m.status)}{m.recordedValue != null && <small> · Recorded components: {m.recordedValue}</small>}</dd></React.Fragment>)}</dl>}{report.controlledCash && <dl className="finance-detail-grid">{Object.entries(report.controlledCash).map(([key, value]) => <React.Fragment key={key}><dt>{humanLabel(key)}</dt><dd>{moneyLabel(value)}</dd></React.Fragment>)}</dl>}{['total', 'netBilledAmount', 'cashCollected', 'accountCreditsApplied', 'rebatesApplied', 'outstandingAmount', 'grossCollections', 'refunds', 'netCollections'].filter((k) => k in report).map((k) => <p key={k}><strong>{humanLabel(k)}:</strong> {report[k] == null ? 'Unavailable' : moneyLabel(report[k])}</p>)}{['customers', 'full', 'partial', 'unpaid', 'customersWhoPaid', 'uniqueReceiptCustomers'].filter((k) => k in report).map((k) => <p key={k}><strong>{humanLabel(k)}:</strong> {report[k] ?? 'Unavailable'}</p>)}{['subscriberSettlementRate', 'cashCollectionRate'].filter((k) => k in report).map((k) => <p key={k}><strong>{humanLabel(k)}:</strong> {report[k] == null ? 'Not applicable / unavailable' : `${report[k]}%`}</p>)}{sections.map((s) => {
    const cols = columnsFor(s.rows);
    return <section key={s.title}><h2>{s.title}</h2><table className="table"><thead><tr>{cols.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{s.rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c.key}>{c.render(r)}</td>)}</tr>)}{!s.rows.length && <tr><td colSpan={cols.length}>No records available.</td></tr>}</tbody></table>{kind === 'transactions' && s.rows.map((r) => <section key={r.id}><h3>Entry #{r.number} — {r.effectiveDate}</h3><table className="table"><thead><tr><th>Account</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{r.lines.map((l, i) => <tr key={i}><td>{l.accountSnapshot.name}</td><td>{moneyLabel(l.debit)}</td><td>{moneyLabel(l.credit)}</td></tr>)}</tbody></table></section>)}</section>;
  })}</article>;
}

export default function FinanceReports({ api, meta, mode = 'financial', refreshVersion, onOpenPayable, pending, onPendingChange = () => {}, onBusyChange = () => {} }) {
  const [evidenceVersion, setEvidenceVersion] = useState(0);
  const [evidenceNotice, setEvidenceNotice] = useState('');
  const financial = canReadFinancial(meta), subscriber = hasGrant(meta, 'finance.reports.subscribers.view') && meta.reportScopesUnrestricted !== false;
  const kinds = mode === 'subscribers' ? ['subscribers', 'billing-settlement'] : Object.keys(REPORT_LABELS).filter((k) => !['subscribers', 'billing-settlement'].includes(k));
  const [kind, setKind] = useState(mode === 'subscribers' ? 'subscribers' : mode === 'overview' ? 'cash-flow' : 'profit-and-loss');
  const [draft, setDraft] = useState(defaultPeriod), [period, setPeriod] = useState(defaultPeriod);
  const [reports, setReports] = useState({}), [series, setSeries] = useState({}), [masters, setMasters] = useState({ categories: [], payees: [], accounts: [] });
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [detail, setDetail] = useState(null), [record, setRecord] = useState(null), [output, setOutput] = useState(null), [outputBusy, setOutputBusy] = useState(false), [comparison, setComparison] = useState(null);
  const generation = useRef(0), detailGeneration = useRef(0);
  const close = useCallback(() => { detailGeneration.current++; setDetail(null); setRecord(null); }, []);
  const seriesMonths = Math.min(6, (Number(period.month.slice(0, 4)) - 1900) * 12 + Number(period.month.slice(5, 7)));
  const query = reportQuery(period), report = reports[kind];
  const permitted = mode === 'subscribers' ? subscriber : mode === 'overview' ? financial || subscriber : financial;
  const names = (rows, key) => Object.fromEntries(rows.map((r) => [r.id, r[key] || r.name]));

  async function refreshEvidence() {
    setOutputBusy(true); onBusyChange(true); setError(''); setEvidenceNotice('');
    const feeds = mode === 'subscribers' ? ['billing-settlement', 'subscribers'] : ['billing-receivables', 'financial-coverage'];
    try {
      for (const feed of feeds) {
        await api.mutate(`/api/finance/reports/evidence/${feed}/sync`, 'POST', { month: period.month, asOf: period.asOf });
        onPendingChange(null);
      }
    } catch (e) {
      setEvidenceNotice(e.message);
      try { onPendingChange(api.pending()); } catch (storageError) { setError(storageError.message); }
    } finally {
      setEvidenceVersion((v) => v + 1); setOutputBusy(false); onBusyChange(false);
    }
  }
  const categoryNames = names(masters.categories, 'name'), payeeNames = names(masters.payees, 'name'), accountNames = names(masters.accounts, 'name');
  function enrich(rows, sourceReport) { return rows.map((row) => ({ ...row, ...(row.categoryId ? { categoryName: row.categoryName || categoryNames[row.categoryId] || 'Unassigned category' } : {}), ...(row.payeeId ? { payeeName: row.payeeName || payeeNames[row.payeeId] || row.payeeId } : {}), ...(row.accountId && !row.name ? { accountName: row.accountName || accountNames[row.accountId] || row.accountId } : {}), ...(row.groupId ? { groupName: groupLabel(row.groupId, sourceReport?.groupBy) } : {}) })); }
  function groupLabel(id, group = 'category') { return id === 'UNSPECIFIED_PAYEE' ? 'Payee not specified' : id === 'UNASSIGNED' ? 'Unassigned' : (group === 'category' ? categoryNames : group === 'payee' ? payeeNames : group === 'account' ? accountNames : {})[id] || id; }

  useEffect(() => {
    const current = ++generation.current;
    detailGeneration.current++; setReports({}); setSeries({}); setComparison(null); setDetail(null); setRecord(null); setOutput(null); setError(''); setLoading(true);
    if (!permitted) { setLoading(false); return; }
    const requests = [];
    const needed = new Set(mode === 'overview' ? ['cash-flow', 'profit-and-loss', 'expenses', 'payables', 'receivables', 'reconciliation'] : [kind]);
    if (mode !== 'subscribers' && financial) { needed.add('cash-flow'); needed.add('profit-and-loss'); needed.add('expenses'); }
    if (mode === 'subscribers' || mode === 'overview' && subscriber) { needed.add('subscribers'); needed.add('billing-settlement'); }
    for (const key of needed) {
      if (['subscribers', 'billing-settlement'].includes(key) ? !subscriber : !financial) continue;
      requests.push(api.request(`/api/finance/reports/${key}?${query}${key === 'transactions' ? '&allRecords=true' : ''}`).then((data) => { if (current === generation.current) setReports((old) => ({ ...old, [key]: data })); }));
    }
    if (financial && mode !== 'subscribers') {
      requests.push(api.request(`/api/finance/reports/monthly-series?kind=profit-and-loss&months=${seriesMonths}&${query}`).then((data) => { if (current === generation.current) setSeries((old) => ({ ...old, profit: data })); }));
      requests.push(Promise.all(['categories', 'payees', 'accounts'].map((key) => api.request(`/api/finance/${key}`))).then(([categories, payees, accounts]) => { if (current === generation.current) setMasters({ categories, payees, accounts }); }));
    }
    if (subscriber && mode !== 'financial') requests.push(api.request(`/api/finance/reports/monthly-series?kind=subscribers&months=${seriesMonths}&${query}`).then((data) => { if (current === generation.current) setSeries((old) => ({ ...old, subscribers: data })); }));
    if (mode !== 'overview' && !['billing-settlement', 'transactions', 'reconciliation'].includes(kind)) requests.push(api.request(`/api/finance/reports/comparison?kind=${kind}&${query}`).then((data) => { if (current === generation.current) setComparison(data); }));
    Promise.allSettled(requests).then((results) => { if (current !== generation.current) return; setError(results.filter((r) => r.status === 'rejected').map((r) => r.reason.message).join(' · ')); setLoading(false); });
    return () => { generation.current++; detailGeneration.current++; };
  }, [api, mode, kind, query, meta.actorUsername, meta.permissionsGranted.join(','), meta.reportScopesUnrestricted, refreshVersion, evidenceVersion]);

  function openRows(title, rows, sourceReport = report, note = '') { detailGeneration.current++; setRecord(null); setDetail({ title, rows: enrich(rows, sourceReport), report: sourceReport, note }); }
  function openSubscriberMetric(key, sourceReport = reports.subscribers) {
    let rows = subscriberSupportingRows(sourceReport, key);
    if (/^(opening|closing)ActiveCustomers$/.test(key)) {
      const grouped = new Map();
      for (const row of rows) { if (!grouped.has(row.customerId)) grouped.set(row.customerId, { customerId: row.customerId, serviceAccountIds: [] }); grouped.get(row.customerId).serviceAccountIds.push(row.serviceAccountId); }
      rows = [...grouped.values()];
    }
    openRows(metricLabel(key), rows, sourceReport, key === 'monthlyRecurringRevenue' ? 'Dated, billable monthly rates. Recurring revenue is neither collected cash nor earned revenue.' : 'Customer counts use distinct owners; line counts use distinct service accounts. Imported existing lines are baseline adjustments.');
  }
  function openProfitMetric(key, sourceReport = reports['profit-and-loss']) {
    const classes = { totalExpenses: ['DIRECT_COST', 'OPERATING_EXPENSE', 'NONOPERATING_EXPENSE', 'FINANCING_EXPENSE', 'INCOME_TAX', 'UNCLASSIFIED_EXPENSE'], earnedGrossRevenue: ['EARNED_REVENUE'], contraRevenue: ['CONTRA_REVENUE'], earnedRevenue: ['EARNED_REVENUE', 'CONTRA_REVENUE'], directCosts: ['DIRECT_COST'], operatingExpenses: ['OPERATING_EXPENSE'], nonoperatingIncome: ['NONOPERATING_INCOME'], nonoperatingExpense: ['NONOPERATING_EXPENSE'], financingExpense: ['FINANCING_EXPENSE'], incomeTax: ['INCOME_TAX'] }[key];
    openRows(metricLabel(key), (sourceReport.transactions || []).filter((r) => !classes || classes.includes(r.classification)), sourceReport, sourceReport.metrics[key]?.reasons?.map(humanLabel).join(' · ') || 'Recorded components remain provisional until all required accounting coverage is certified.');
  }
  async function openRecord(row) {
    const current = ++detailGeneration.current;
    try {
      if (mode === 'subscribers' || !financial || row.serviceAccountId || row.line || row.invoiceIds) { setRecord(row); return; }
      if (row.payableId && onOpenPayable) { close(); onOpenPayable(row.payableId); return; }
      const id = row.journalId || (row.lines ? row.id : null);
      if (id) { const data = await api.request(`/api/finance/journals/${encodeURIComponent(id)}`); if (current === detailGeneration.current) setRecord(data); }
      else if (row.accountId) { const data = await api.request(`/api/finance/accounts/${encodeURIComponent(row.accountId)}/activity?asOf=${detail.report.asOf}`); if (current === detailGeneration.current) setRecord(data); }
      else { setRecord(row); }
    } catch (e) { if (current === detailGeneration.current) setError(e.message); }
  }
  async function exportReport(type) {
    setOutputBusy(true); setError(''); const current = generation.current;
    try {
      const path = `/api/finance/reports/${kind}/${type}?${query}`;
      if (type === 'csv') {
        const blob = await api.download(path); if (current !== generation.current) return;
        const href = URL.createObjectURL(blob), link = document.createElement('a'); link.href = href; link.download = `finance-${kind}-${period.month}.csv`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(href), 1000);
      } else { const data = await api.request(path); if (current === generation.current) setOutput(data); }
    } catch (e) { if (current === generation.current) setError(e.message); } finally { setOutputBusy(false); }
  }
  function print() { document.body.classList.add('finance-printing'); try { window.print(); } finally { document.body.classList.remove('finance-printing'); } }
  const cash = reports['cash-flow'], profit = reports['profit-and-loss'], expenses = reports.expenses, subscribers = reports.subscribers, settlement = reports['billing-settlement'];
  const metrics = mode === 'subscribers' ? subscribers?.metrics : profit?.metrics;
  const cashCards = cash && <div className="finance-summary-grid">
    {[['Available controlled cash', cash.controlledCash.closing, cash.accounts.filter((r) => r.controlledCash), 'Cash held in company accounts and physical collector custody; excludes card credit and personal GCash due.'], ['Net cash flow', cash.controlledCash.netCashFlow, cash.transactions, 'Actual cash movement; opening adjustments are separate.'], ['Credit-card debt', cash.cardLiabilities, cash.accounts.filter((r) => r.kind === 'CREDIT_CARD'), 'Amount owed, separate from cash.'], ['Personal GCash due', cash.personalGcashDue, cash.accounts.filter((r) => r.kind === 'COLLECTOR_GCASH'), 'Due from collectors until company receipt.']].map(([label, value, rows, note]) => <Summary key={label} label={label} value={moneyLabel(value)} status={cash.status} note={note} onOpen={() => openRows(label, rows, cash, note)} />)}
  </div>;
  const profitCards = profit && <div className="finance-summary-grid">{['earnedRevenue', 'directCosts', 'grossProfit', 'operatingExpenses', 'operatingProfit', 'netProfit'].map((key) => <Summary key={key} label={metricLabel(key)} value={metricText(key, profit.metrics[key])} status={profit.metrics[key].status} note={profit.metrics[key].recordedValue != null ? `Recorded components: ${moneyLabel(profit.metrics[key].recordedValue)}; full profit coverage is unavailable.` : 'Earned accounting result, separate from available cash.'} onOpen={() => openProfitMetric(key, profit)} />)}</div>;
  const trendContext = (data) => <><p>{data.reports[0].report.period.startDate}–{data.reports.at(-1).report.period.endDate} · Calendar months, with the final month limited to the report date.</p><ReportContext report={data.reports.at(-1).report} /></>;
  const growthChart = series.subscribers && <FinanceTrendChart title="Subscriber growth by month" context={trendContext(series.subscribers)} labels={series.subscribers.reports.map((r) => r.month)} series={['closingActiveLines', 'closingActiveCustomers', 'newActivations'].map((key) => ({ key, label: metricLabel(key), values: series.subscribers.reports.map((r) => r.report.metrics[key]?.value ?? null), statuses: series.subscribers.reports.map((r) => r.report.metrics[key]?.status) }))} onOpen={(i, key) => openSubscriberMetric(key, series.subscribers.reports[i].report)} />;
  const settlementChart = settlement && <FinanceBarChart title={`Bill-month settlement — ${period.month}`} context={<ReportContext report={settlement} />} rows={['full', 'partial', 'unpaid'].map((key) => ({ key, label: key === 'full' ? 'Fully settled customers' : key === 'partial' ? 'Partially settled customers' : 'Unpaid customers', value: settlement[key] }))} onOpen={(r) => openRows(r.label, settlement.rows.filter((row) => row.settlementStatus === r.key.toUpperCase()), settlement, 'Selected month’s bills settled through the as-of date. Cash receipts, applied credits and rebates are shown separately.')} />;

  if (!permitted) return <p className="alert alert-info">Your access does not include {mode === 'subscribers' ? 'subscriber reports' : 'aggregate financial reports'}. Reports require the appropriate reporting grants and unrestricted account and document scope.</p>;
  return <section className="finance-reports">
    {meta.phase >= 7 && hasGrant(meta, 'finance.reports.evidence.sync') && <button type="button" className="btn btn-outline-primary mb-3" disabled={outputBusy || loading || Boolean(pending)} onClick={refreshEvidence}>Refresh authoritative source evidence</button>}
    {evidenceNotice && <div className="alert alert-warning" role="status">{evidenceNotice}</div>}
    <form className="finance-period-form finance-no-print" onSubmit={(e) => { e.preventDefault(); if (!reportWindowValid(draft)) { setError('Choose a valid month and an as-of date on or after its start, through today.'); return; } setPeriod({ ...draft }); }}>
      <label>Report month<input className="form-control" type="month" min="1900-01" max={businessDate().slice(0, 7)} required value={draft.month} onChange={(e) => setDraft({ ...draft, month: e.target.value })} /></label>
      <label>As-of date<input className="form-control" type="date" min={`${draft.month}-01`} max={businessDate()} required value={draft.asOf} onChange={(e) => setDraft({ ...draft, asOf: e.target.value })} /></label>
      {mode !== 'subscribers' && <><label>Expense basis<select className="form-select" value={draft.basis} onChange={(e) => setDraft({ ...draft, basis: e.target.value })}><option value="RECOGNIZED">Recognized expenses</option><option value="SETTLED">Supplier payments</option></select></label><label>Expense grouping<select className="form-select" value={draft.groupBy} onChange={(e) => setDraft({ ...draft, groupBy: e.target.value })}>{['category', 'payee', 'account', 'location', 'project'].map((g) => <option key={g} value={g}>{humanLabel(g)}</option>)}</select></label></>}
      <button className="btn btn-primary" disabled={loading || outputBusy}>Apply dates & basis</button></form>
    {mode !== 'overview' && <nav className="finance-toolbar finance-no-print" aria-label="Report views">{kinds.map((k) => <button key={k} type="button" className={`btn ${kind === k ? 'btn-primary' : 'btn-outline-secondary'}`} disabled={outputBusy} onClick={() => setKind(k)}>{REPORT_LABELS[k]}</button>)}</nav>}
    {error && <div className="alert alert-danger" role="alert">{error}</div>}{loading && <p role="status">Loading reports and their supporting records…</p>}
    {mode === 'financial' && meta.phase >= 8 && <FinancePeriods api={api} meta={meta} month={period.month} disabled={loading || outputBusy || Boolean(pending)} onChanged={() => setEvidenceVersion((v) => v + 1)} onBusyChange={onBusyChange} onPendingChange={onPendingChange} />}
    <ReportContext report={report || cash || subscribers} />
    {mode === 'overview' && <>{cashCards}{profitCards}<div className="finance-summary-grid">{['payables', 'receivables'].map((key) => reports[key] && <Summary key={key} label={key === 'payables' ? 'Outstanding supplier payables' : 'Outstanding customer receivables'} value={moneyLabel(reports[key].total)} status={reports[key].status} onOpen={() => openRows(REPORT_LABELS[key], reports[key].rows, reports[key])} />)}{reports.reconciliation && <Summary label="Reconciliation exceptions" value={reports.reconciliation.rows.length} status={reports.reconciliation.rows.some((r) => r.status !== 'RESOLVED') ? 'PROVISIONAL' : 'COMPLETE'} onOpen={() => openRows('Reconciliation exceptions', reports.reconciliation.rows, reports.reconciliation)} />}{subscribers && ['closingActiveCustomers', 'closingActiveLines', 'monthlyRecurringRevenue'].map((key) => <Summary key={key} label={metricLabel(key)} value={metricText(key, subscribers.metrics[key])} status={subscribers.metrics[key].status} onOpen={() => openSubscriberMetric(key)} />)}</div></>}
    {mode === 'financial' && <>{kind === 'cash-flow' && cashCards}{kind === 'profit-and-loss' && profitCards}{['expenses', 'payables', 'receivables'].includes(kind) && report && <div className="finance-summary-grid"><Summary label={kind === 'expenses' ? period.basis === 'SETTLED' ? 'Supplier payments for expenses' : 'Recognized expenses' : 'Outstanding total'} value={moneyLabel(report.total)} status={report.status} onOpen={() => openRows(REPORT_LABELS[kind], dataRows(kind, report), report)} />{report.cashPaidTotal != null && <Summary label="Actual cash paid" value={moneyLabel(report.cashPaidTotal)} status={report.status} note="Card-funded payments are excluded from this cash figure." onOpen={() => openRows('Actual cash expense payments', report.transactions.filter((r) => masters.accounts.find((a) => a.id === r.accountId)?.kind !== 'CREDIT_CARD'), report)} />}</div>}{kind === 'collections' && report && <div className="finance-summary-grid">{['grossCollections', 'refunds', 'netCollections', 'customersWhoPaid'].map((key) => <Summary key={key} label={humanLabel(key)} value={key === 'customersWhoPaid' ? report[key] : moneyLabel(report[key])} status={report.status} onOpen={() => openRows(humanLabel(key), report.rows.filter((r) => key === 'refunds' ? r.refundAmount !== '0.00' : key === 'customersWhoPaid' ? r.source === 'billing' && Number(r.collectionAmount) > 0 : true), report, 'Receipts received in this month, independently of which billing period was settled.')} />)}</div>}
      {report?.metrics && <FinanceRecords title="All revenue and profit measures" rows={Object.entries(report.metrics).map(([key, m]) => ({ key, ...m }))} columns={[{ key: 'key', label: 'Measure', render: (r) => metricLabel(r.key) }, { key: 'value', label: 'Figure', render: (r) => metricText(r.key, r) }, { key: 'status', label: 'Coverage', render: (r) => <FinanceStatus value={r.status} /> }, { key: 'reasons', label: 'Coverage required', render: (r) => r.reasons.map(humanLabel).join(' · ') || '—' }]} onOpen={(r) => openProfitMetric(r.key, report)} />}
      {report && <FinanceRecords title={REPORT_LABELS[kind]} rows={enrich(dataRows(kind, report), report)} columns={columnsFor(enrich(dataRows(kind, report), report))} onOpen={(r) => openRows('Record detail', [r], report)} statuses={kind === 'reconciliation' ? ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] : []} />}
    </>}
    {mode === 'subscribers' && subscribers && <><p>Active customers and active service lines are counted separately. Monthly recurring revenue uses dated billable rates; it is separate from cash received and earned revenue.</p><div className="finance-summary-grid">{['openingActiveCustomers', 'closingActiveCustomers', 'openingActiveLines', 'closingActiveLines', 'netCustomerGrowth', 'netLineGrowth', 'monthlyRecurringRevenue', 'customersWhoPaidDuringMonth'].map((key) => <Summary key={key} label={metricLabel(key)} value={metricText(key, metrics[key])} status={metrics[key]?.status} onOpen={() => openSubscriberMetric(key)} />)}</div>
      <FinanceRecords title="Lifecycle and growth measures" rows={Object.entries(metrics).map(([key, m]) => ({ key, ...m }))} columns={[{ key: 'key', label: 'Measure', render: (r) => metricLabel(r.key) }, { key: 'value', label: 'Figure', render: (r) => metricText(r.key, r) }, { key: 'status', label: 'Coverage', render: (r) => <FinanceStatus value={r.status} /> }]} onOpen={(r) => openSubscriberMetric(r.key)} />
      {kind === 'subscribers' ? <FinanceRecords title="Dated service lifecycle evidence" rows={subscribers.events} columns={columnsFor(subscribers.events)} onOpen={(r) => openRows('Service lifecycle evidence', [r], subscribers)} /> : settlement && <><ReportContext report={settlement} /><div className="finance-summary-grid">{['netBilledAmount', 'cashCollected', 'accountCreditsApplied', 'rebatesApplied', 'outstandingAmount'].map((key) => <Summary key={key} label={humanLabel(key)} value={settlement[key] == null ? 'Unavailable' : moneyLabel(settlement[key])} status={settlement.status} onOpen={() => openRows(humanLabel(key), settlement.rows, settlement)} />)}</div><FinanceRecords title="Selected bill-month customer settlement" rows={settlement.rows} columns={columnsFor(settlement.rows)} statuses={['FULL', 'PARTIAL', 'UNPAID']} onOpen={(r) => openRows('Customer bill-month settlement', [r], settlement)} /></>}
      <h4>Receipt month and bill month</h4><p>Customers who paid during {period.month} come from canonical Billing receipts received that month. Settlement below uses the selected month’s bills, including later payments through {period.asOf}, applied account credits and rebates.</p><button className="btn btn-outline-primary" onClick={() => openRows('Customers who paid in receipt month', subscribers.receiptMonth.rows, subscribers)}>Open receipt-month records</button>
    </>}
    {mode !== 'subscribers' && financial && <div className="finance-chart-grid">
      {series.profit && <FinanceTrendChart title="Monthly earned revenue, expenses and net profit" context={trendContext(series.profit)} labels={series.profit.reports.map((r) => r.month)} series={['earnedRevenue', 'totalExpenses', 'netProfit'].map((key) => ({ key, label: metricLabel(key), values: series.profit.reports.map((r) => r.report.metrics[key].value), statuses: series.profit.reports.map((r) => r.report.metrics[key].status) }))} format={moneyLabel} onOpen={(i, key) => openProfitMetric(key, series.profit.reports[i].report)} />}
      {expenses && <FinanceBarChart title={`Highest expense ${period.groupBy === 'category' ? 'categories' : 'groups'} — ${period.basis === 'SETTLED' ? 'paid' : 'recognized'}`} context={<ReportContext report={expenses} />} rows={topExpenseGroups(expenses).map((r) => ({ key: r.id, label: groupLabel(r.id, period.groupBy), value: r.amount }))} format={moneyLabel} onOpen={(r) => openRows(r.label, expenses.transactions.filter((t) => t.groupId === r.key), expenses)} />}
      {cash && <FinanceBarChart title="Cash flow by account — opening balances excluded" context={<ReportContext report={cash} />} rows={cash.accounts.filter((a) => a.controlledCash).map((r) => ({ key: r.accountId, label: `${r.name}${!r.controlledCash ? r.kind === 'CREDIT_CARD' ? ' (debt)' : ' (due from collector)' : ''}`, value: r.netMovement }))} format={moneyLabel} onOpen={(r) => openRows(r.label, [{ ...cash.accounts.find((a) => a.accountId === r.key) }, ...(cash.accountTransactions || []).filter((t) => t.accountId === r.key)], cash, 'Account movement includes internal transfers between accounts; these cancel from the combined cash flow. Opening adjustments are shown separately.')} />}
    </div>}
    {mode !== 'financial' && <div className="finance-chart-grid">{growthChart}{settlementChart}</div>}
    {comparison && <section className="card"><div className="card-body"><h4>{comparison.comparisonMode === 'COMPLETE_MONTHS' ? 'Complete-month comparison' : 'Equivalent month-to-date comparison'}</h4><p>{comparison.current.period.startDate}–{comparison.current.period.endDate} compared with {comparison.prior.period.startDate}–{comparison.prior.period.endDate}{comparison.equivalentDays ? ` (${comparison.equivalentDays} days each)` : ''}.</p><FinanceRecords title="Monthly changes" rows={Object.entries(comparison.changes).map(([key, value]) => ({ key, ...value }))} columns={[{ key: 'key', label: 'Measure', render: (r) => metricLabel(r.key) }, { key: 'absoluteChange', label: 'Change', render: (r) => r.absoluteChange ?? 'Unavailable' }, { key: 'percentageChange', label: 'Change %', render: (r) => r.percentageChange == null ? 'Not applicable / unavailable' : `${r.percentageChange}%` }, { key: 'status', label: 'Coverage', render: (r) => <FinanceStatus value={r.status} /> }]} onOpen={(r) => openRows(`${metricLabel(r.key)} — comparison records`, [...(kind === 'subscribers' ? subscriberSupportingRows(comparison.prior, r.key) : dataRows(kind, comparison.prior)).map((row) => ({ ...row, boundary: 'Prior' })), ...(kind === 'subscribers' ? subscriberSupportingRows(comparison.current, r.key) : dataRows(kind, comparison.current)).map((row) => ({ ...row, boundary: 'Current' }))], comparison.current, 'Change uses the matching windows above. A zero prior base has no percentage change.')} /></div></section>}
    {mode !== 'overview' && report && <div className="finance-toolbar finance-no-print"><p>Exports and print include every record in this report period; screen search and status filters are excluded.</p><div>{hasGrant(meta, 'finance.reports.export') && <button className="btn btn-outline-primary" disabled={loading || outputBusy} onClick={() => exportReport('csv')}>Export CSV</button>}{hasGrant(meta, 'finance.reports.print') && <button className="btn btn-outline-secondary" disabled={loading || outputBusy} onClick={() => exportReport('print')}>Printable report</button>}</div></div>}
    {detail && <FinanceDialog title={detail.title} titleId="finance-report-detail-title" onClose={close} footer={<button className="btn btn-outline-secondary" onClick={close}>Close records</button>}><ReportContext report={detail.report} />{detail.note && <p>{detail.note}</p>}<FinanceRecords rows={detail.rows} columns={columnsFor(detail.rows)} onOpen={openRecord} empty={detail.report?.status === 'UNAVAILABLE' ? 'The required dated source evidence is unavailable.' : 'No recorded supporting transactions in this view.'} />{record && <section className="card"><div className="card-body"><h4>Record detail</h4><dl className="finance-detail-grid">{Object.entries(flatRow(record)).filter(([key, value]) => value != null && typeof value !== 'object' && !['policyVersion', 'fingerprint'].includes(key)).map(([key, value]) => <React.Fragment key={key}><dt>{humanLabel(key)}</dt><dd>{display(key, value)}</dd></React.Fragment>)}</dl>{record.lines && <FinanceRecords title="Immutable journal lines" rows={record.lines} columns={[{ key: 'account', label: 'Account', render: (r) => r.accountSnapshot.name }, { key: 'debit', label: 'Debit (PHP)', render: (r) => moneyLabel(r.debit) }, { key: 'credit', label: 'Credit (PHP)', render: (r) => moneyLabel(r.credit) }]} />}{record.items && <FinanceRecords title="Dated account activity" rows={record.items} columns={columnsFor(record.items)} />}</div></section>}</FinanceDialog>}
    {output && <FinanceDialog title={`Printable ${REPORT_LABELS[kind]}`} titleId="finance-report-print-title" onClose={() => setOutput(null)} footer={<><button className="btn btn-outline-secondary" onClick={() => setOutput(null)}>Close preview</button><button className="btn btn-primary" onClick={print}>Print report</button></>}><PrintReport kind={kind} report={output} /></FinanceDialog>}
  </section>;
}
