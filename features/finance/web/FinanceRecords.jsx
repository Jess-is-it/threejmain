import React, { useEffect, useMemo, useState } from 'react';
import { humanLabel } from './reportClient.mjs';

export function FinanceStatus({ value }) {
  const text = value ?? 'UNAVAILABLE';
  const color = /NOT_APPLICABLE|ARCHIVED|RETIRED|EVIDENCE|SUPERSEDED/.test(text) ? 'secondary' : /REJECT|REVERSE|OPEN|UNPAID|UNAVAILABLE|AWAITING_PAYMENT/.test(text) ? 'red' : /PARTIAL|DRAFT|SUBMITTED|UNPOSTED|PENDING|PROVISIONAL|ACKNOWLEDGED|NEEDS_APPROVAL|READY_TO_RECORD/.test(text) ? 'yellow' : 'green';
  return <span className={`badge bg-${color}-lt finance-status`}>{humanLabel(text)}</span>;
}
const searchable = (row) => JSON.stringify(row).toLowerCase();
export function useRecordView(rows, { statuses = [], getStatus = (r) => r.status || r.approvalStatus || r.settlementStatus || '', getDate = (r) => r.effectiveDate || r.expenseDate || r.documentDate || r.validFrom || r.startDate || r.dueDate || '', dates = true, resetKey = '' } = {}) {
  const [search, setSearch] = useState(''), [status, setStatus] = useState(''), [from, setFrom] = useState(''), [through, setThrough] = useState(''), [page, setPage] = useState(0), [pageSize, setPageSize] = useState(25);
  const filtered = useMemo(() => rows.filter((r) => (!search || searchable(r).includes(search.toLowerCase())) && (!status || (Array.isArray(getStatus(r)) ? getStatus(r).includes(status) : getStatus(r) === status)) && (!from || getDate(r) >= from) && (!through || getDate(r) && getDate(r) <= through)), [rows, search, status, from, through, getStatus, getDate]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)), current = Math.min(page, pages - 1);
  useEffect(() => { setPage(0); }, [search, status, from, through, pageSize]);
  useEffect(() => { setSearch(''); setStatus(''); setFrom(''); setThrough(''); setPage(0); }, [resetKey]);
  const searchControl = <div className="finance-record-controls finance-no-print"><label>Search records<input className="form-control" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, reference or purpose" /></label></div>;
  const extraControls = <div className="finance-record-controls finance-no-print">
    {statuses.length > 0 && <label>Status<select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{statuses.map((s) => <option key={s} value={s}>{humanLabel(s)}</option>)}</select></label>}
    {dates && <><label>From date<input className="form-control" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
    <label>Through date<input className="form-control" type="date" min={from} value={through} onChange={(e) => setThrough(e.target.value)} /></label></>}
    <label>Rows<select className="form-select" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>{[10, 25, 50, 100].map((n) => <option key={n}>{n}</option>)}</select></label>
    <button className="btn btn-outline-secondary" type="button" onClick={() => { setSearch(''); setStatus(''); setFrom(''); setThrough(''); setPage(0); }}>Clear filters</button>
  </div>;
  const pagination = <div className="finance-pagination finance-no-print" aria-label="Record pagination"><span role="status">{filtered.length ? `${current * pageSize + 1}–${Math.min((current + 1) * pageSize, filtered.length)}` : '0'} of {filtered.length} records{filtered.length !== rows.length ? ` (${rows.length} before filters)` : ''}</span><div><button className="btn btn-sm btn-outline-secondary" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button><span> Page {current + 1} of {pages} </span><button className="btn btn-sm btn-outline-secondary" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>Next</button></div></div>;
  const controls = <div className="finance-record-controls finance-no-print">{searchControl.props.children}{extraControls.props.children}</div>;
  return { items: filtered.slice(current * pageSize, (current + 1) * pageSize), controls, searchControl, extraControls, hasFilters: Boolean(search || status || from || through), pagination, filtered, count: filtered.length };
}

export default function FinanceRecords({ rows = [], columns, onOpen, title = 'Supporting records', empty = 'No supporting records for this period.', statuses = [], dates }) {
  const view = useRecordView(rows, { statuses, dates: dates ?? rows.some((r) => r.effectiveDate || r.expenseDate || r.documentDate || r.dueDate) });
  return <section className="finance-records"><h3>{title}</h3>{view.controls}<div className="table-responsive"><table className="table table-striped table-vcenter"><thead><tr>{columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}{onOpen && <th scope="col">Details</th>}</tr></thead><tbody>{view.items.map((r, i) => <tr key={r.id || `${r.journalId || r.serviceAccountId || r.customerId || 'row'}-${i}`}>{columns.map((c) => <td key={c.key}>{c.render ? c.render(r) : String(c.value ? c.value(r) ?? '—' : r[c.key] ?? '—')}</td>)}{onOpen && <td><button className="btn btn-sm btn-outline-primary" type="button" onClick={() => onOpen(r)}>Open record</button></td>}</tr>)}{!view.items.length && <tr><td colSpan={columns.length + Boolean(onOpen)}>{empty}</td></tr>}</tbody></table></div>{view.pagination}</section>;
}
