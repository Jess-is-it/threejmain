import React, { useEffect, useMemo, useState } from 'react';
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconMapPin,
  IconMessage2,
  IconRefresh,
  IconSearch,
  IconTicket,
  IconX,
} from '@tabler/icons-react';
import './techPortal.css';

const API = '/api';
const FIELD_STATUSES = ['ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED'];
const PRIORITIES = ['URGENT', 'HIGH', 'NORMAL', 'LOW'];
const WORK_TYPES = ['Installation', 'Repair', 'Equipment', 'Relocation', 'Reconnection', 'General'];

function token() {
  return localStorage.getItem('threejmain_token');
}

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || 'Request failed');
  return data;
}

function label(value) {
  return String(value || '').replaceAll('_', ' ').replaceAll('-', ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value) {
  if (!value) return 'Unscheduled';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function priorityTone(priority) {
  if (priority === 'URGENT') return 'danger';
  if (priority === 'HIGH') return 'warning';
  if (priority === 'LOW') return 'muted';
  return 'normal';
}

function dueTone(dueState) {
  if (dueState === 'overdue') return 'danger';
  if (dueState === 'today') return 'warning';
  if (dueState === 'upcoming') return 'info';
  return 'muted';
}

function statusTone(status) {
  if (status === 'COMPLETED') return 'success';
  if (status === 'ON_HOLD') return 'warning';
  if (['EN_ROUTE', 'ON_SITE', 'IN_PROGRESS'].includes(status)) return 'info';
  return 'normal';
}

function TicketCard({ ticket, active, onOpen, onDragStart, onDragEnd }) {
  return (
    <button
      className={`techportal-kanban-card ${active ? 'active' : ''} techportal-kanban-priority-${String(ticket.priority || 'NORMAL').toLowerCase()}`}
      draggable
      type="button"
      onClick={() => onOpen(ticket.id)}
      onDragStart={(event) => onDragStart(event, ticket.id)}
      onDragEnd={onDragEnd}
    >
      <span className="techportal-kanban-card-top">
        <span className="techportal-ticket-number">{ticket.ticketNumber}</span>
        <span className={`techportal-pill techportal-pill-${priorityTone(ticket.priority)}`}>{label(ticket.priority)}</span>
      </span>
      <span className="techportal-kanban-card-title">{ticket.subject}</span>
      <span className="techportal-ticket-meta">
        <span>{ticket.workType}</span>
        <span>{formatDate(ticket.dueDate)}</span>
      </span>
      <span className="techportal-customer-line">
        <IconMapPin size={16} />
        <span>{ticket.customer?.name || 'Unassigned customer'}</span>
        <span>{ticket.customer?.address || 'Address pending'}</span>
      </span>
      <span className="techportal-kanban-card-foot">
        <span className={`techportal-pill techportal-pill-${dueTone(ticket.dueState)}`}>{label(ticket.dueState)}</span>
        {!!ticket.serviceReference && <span className="techportal-service-ref">{ticket.serviceReference}</span>}
      </span>
    </button>
  );
}

export default function TechPortalTicketingPage({ currentUser }) {
  const [ticketsData, setTicketsData] = useState({ items: [], metrics: {}, statusOptions: FIELD_STATUSES });
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [filters, setFilters] = useState({ search: '', due: '', status: '', priority: '', workType: '' });
  const [noteBody, setNoteBody] = useState('');
  const [resolutionSummary, setResolutionSummary] = useState('');
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [draggingTicketId, setDraggingTicketId] = useState('');
  const [error, setError] = useState('');

  async function loadTickets(nextFilters = filters) {
    const params = new URLSearchParams();
    if (nextFilters.search) params.set('search', nextFilters.search);
    if (nextFilters.due) params.set('due', nextFilters.due);
    if (nextFilters.status) params.set('status', nextFilters.status);
    if (nextFilters.priority) params.set('priority', nextFilters.priority);
    if (nextFilters.workType) params.set('workType', nextFilters.workType);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    setLoading(true);
    try {
      const data = await request(`/techportal/tickets${suffix}`);
      setTicketsData(data);
      setError('');
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTickets();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadTickets(filters);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [filters.search, filters.due, filters.status, filters.priority, filters.workType]);

  async function openTicket(ticketId) {
    setDetailLoading(true);
    try {
      const detail = await request(`/techportal/tickets/${encodeURIComponent(ticketId)}`);
      setSelectedTicket(detail);
      setResolutionSummary(detail.resolutionSummary || '');
      setNoteBody('');
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setDetailLoading(false);
    }
  }

  async function writeTicketStatus(ticketId, status, note = noteBody, summary = resolutionSummary) {
    setActionLoading(true);
    try {
      const detail = await request(`/techportal/tickets/${encodeURIComponent(ticketId)}/status`, {
        method: 'POST',
        body: JSON.stringify({
          status,
          note,
          resolutionSummary: summary,
        }),
      });
      setSelectedTicket((current) => (current?.id === ticketId ? detail : current));
      setResolutionSummary(detail.resolutionSummary || '');
      setNoteBody('');
      await loadTickets(filters);
      setError('');
      return detail;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setActionLoading(false);
    }
  }

  async function addNote(event) {
    event.preventDefault();
    if (!selectedTicket || !noteBody.trim()) return;
    setActionLoading(true);
    try {
      const detail = await request(`/techportal/tickets/${encodeURIComponent(selectedTicket.id)}/notes`, {
        method: 'POST',
        body: JSON.stringify({ body: noteBody, visibility: 'INTERNAL' }),
      });
      setSelectedTicket(detail);
      setNoteBody('');
      await loadTickets(filters);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  function startDrag(event, ticketId) {
    setDraggingTicketId(ticketId);
    event.dataTransfer.setData('text/plain', ticketId);
    event.dataTransfer.effectAllowed = 'move';
  }

  async function dropTicket(event, status) {
    event.preventDefault();
    const ticketId = event.dataTransfer.getData('text/plain') || draggingTicketId;
    const ticket = ticketsData.items.find((item) => item.id === ticketId);
    setDraggingTicketId('');
    if (!ticket || ticket.fieldStatus === status) return;
    await writeTicketStatus(ticket.id, status, `Moved to ${label(status)} from Tech Portal Ticketing.`, resolutionSummary);
  }

  const statuses = ticketsData.statusOptions?.length ? ticketsData.statusOptions : FIELD_STATUSES;
  const ticketsByStatus = useMemo(() => {
    return statuses.reduce((groups, status) => {
      groups[status] = (ticketsData.items || []).filter((ticket) => (ticket.fieldStatus || ticket.status) === status);
      return groups;
    }, {});
  }, [statuses, ticketsData.items]);

  const metrics = ticketsData.metrics || {};
  const displayName = currentUser?.full_name || currentUser?.username || 'Technician';

  return (
    <main className="techportal-page techportal-ticketing-page">
      <section className="techportal-hero techportal-ticketing-hero">
        <div>
          <div className="techportal-kicker">Tech Portal Ticketing</div>
          <h1>Ticketing</h1>
          <div className="techportal-subline">
            <span><IconTicket size={17} />{displayName}</span>
            <span><IconCircleCheck size={17} />{metrics.filtered ?? 0} visible</span>
            <span><IconAlertTriangle size={17} />{metrics.urgent ?? 0} urgent</span>
          </div>
        </div>
        <button className="btn btn-outline-primary" type="button" onClick={() => loadTickets(filters)} disabled={loading}>
          <IconRefresh size={18} className="me-2" />Refresh
        </button>
      </section>

      {error && <div className="alert alert-danger">{error}</div>}

      <section className="techportal-ticketing-toolbar" aria-label="Ticket filters">
        <div className="techportal-ticketing-search">
          <IconSearch size={17} />
          <input
            className="form-control"
            placeholder="Search ticket, customer, service, address"
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          />
        </div>
        <select className="form-select" value={filters.due} onChange={(event) => setFilters({ ...filters, due: event.target.value })}>
          <option value="">All due dates</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="upcoming">Upcoming</option>
          <option value="unscheduled">Unscheduled</option>
        </select>
        <select className="form-select" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
          <option value="">All stages</option>
          {statuses.map((status) => <option value={status} key={status}>{label(status)}</option>)}
        </select>
        <select className="form-select" value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })}>
          <option value="">All priorities</option>
          {PRIORITIES.map((priority) => <option value={priority} key={priority}>{label(priority)}</option>)}
        </select>
        <select className="form-select" value={filters.workType} onChange={(event) => setFilters({ ...filters, workType: event.target.value })}>
          <option value="">All work types</option>
          {WORK_TYPES.map((workType) => <option value={workType} key={workType}>{workType}</option>)}
        </select>
      </section>

      <section className="techportal-board-summary" aria-label="Ticket board summary">
        <div><span>Total</span><strong>{metrics.total ?? 0}</strong></div>
        <div><span>Filtered</span><strong>{metrics.filtered ?? 0}</strong></div>
        <div><span>Due Today</span><strong>{metrics.dueToday ?? 0}</strong></div>
        <div><span>Overdue</span><strong>{metrics.overdue ?? 0}</strong></div>
      </section>

      <section className="techportal-kanban" aria-label="Technician ticket stage board">
        {statuses.map((status) => (
          <section
            className={`techportal-kanban-column techportal-kanban-column-${statusTone(status)}`}
            key={status}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => dropTicket(event, status)}
          >
            <div className="techportal-kanban-column-header">
              <div>
                <div className="techportal-kanban-column-title">{label(status)}</div>
                <div className="techportal-kanban-column-caption">Stage</div>
              </div>
              <span className={`techportal-pill techportal-pill-${statusTone(status)}`}>{ticketsByStatus[status]?.length || 0}</span>
            </div>
            <div className="techportal-kanban-column-body">
              {(ticketsByStatus[status] || []).map((ticket) => (
                <TicketCard
                  active={selectedTicket?.id === ticket.id}
                  key={ticket.id}
                  ticket={ticket}
                  onOpen={openTicket}
                  onDragStart={startDrag}
                  onDragEnd={() => setDraggingTicketId('')}
                />
              ))}
              {!(ticketsByStatus[status] || []).length && <div className="techportal-kanban-empty">Drop tickets here</div>}
            </div>
          </section>
        ))}
      </section>

      {loading && !(ticketsData.items || []).length && <div className="techportal-empty">Loading tickets...</div>}
      {!loading && !(ticketsData.items || []).length && <div className="techportal-empty">No tickets match the current filters.</div>}
      {detailLoading && <div className="techportal-empty">Loading ticket detail...</div>}

      {selectedTicket && (
        <div className="techportal-ticket-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedTicket(null); }}>
          <aside className="techportal-ticket-drawer" role="dialog" aria-modal="true" aria-labelledby="techportal-ticket-title">
            <div className="techportal-ticket-drawer-header">
              <div>
                <div className="techportal-section-label">Ticket Detail</div>
                <h2 id="techportal-ticket-title">{selectedTicket.ticketNumber}</h2>
                <p>{selectedTicket.subject}</p>
              </div>
              <button className="btn btn-icon btn-outline-secondary" type="button" onClick={() => setSelectedTicket(null)} aria-label="Close ticket detail">
                <IconX size={18} />
              </button>
            </div>

            <div className="techportal-ticket-drawer-body">
              <div className="techportal-detail-grid">
                <div><span>Stage</span><strong>{label(selectedTicket.fieldStatus || selectedTicket.status)}</strong></div>
                <div><span>Priority</span><strong>{label(selectedTicket.priority)}</strong></div>
                <div><span>Due</span><strong>{formatDate(selectedTicket.dueDate)}</strong></div>
                <div><span>Work Type</span><strong>{selectedTicket.workType}</strong></div>
              </div>

              <section className="techportal-detail-section">
                <h3>Customer</h3>
                <p>{selectedTicket.customer?.name || 'Unassigned customer'}</p>
                <p>{selectedTicket.customer?.address || 'Address pending'} / {selectedTicket.customer?.contactNumber || 'No contact'}</p>
              </section>

              <section className="techportal-detail-section">
                <h3>Network / Service Context</h3>
                <div className="techportal-context-grid">
                  <div><span>Service Ref</span><strong>{selectedTicket.networkContext?.serviceReference || '-'}</strong></div>
                  <div><span>Service Order</span><strong>{selectedTicket.networkContext?.serviceOrderNumber || '-'}</strong></div>
                  <div><span>Serviceability</span><strong>{selectedTicket.networkContext?.serviceability || '-'}</strong></div>
                  <div><span>Path</span><strong>{selectedTicket.networkContext?.path || '-'}</strong></div>
                </div>
              </section>

              <section className="techportal-detail-section">
                <h3>Checklist</h3>
                <div className="techportal-checklist">
                  {(selectedTicket.checklist || []).map((item) => (
                    <label className="techportal-check-row" key={item.id}>
                      <input type="checkbox" checked={Boolean(item.done)} readOnly />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </section>

              <section className="techportal-detail-section">
                <h3>Field Update</h3>
                <textarea
                  className="form-control"
                  rows="3"
                  placeholder="Technician note"
                  value={noteBody}
                  onChange={(event) => setNoteBody(event.target.value)}
                />
                <textarea
                  className="form-control mt-2"
                  rows="2"
                  placeholder="Completion summary"
                  value={resolutionSummary}
                  onChange={(event) => setResolutionSummary(event.target.value)}
                />
                <div className="techportal-status-actions">
                  {FIELD_STATUSES.filter((status) => status !== 'ASSIGNED').map((status) => (
                    <button
                      className="btn btn-outline-primary btn-sm"
                      disabled={actionLoading}
                      key={status}
                      type="button"
                      onClick={() => writeTicketStatus(selectedTicket.id, status)}
                    >
                      {label(status)}
                    </button>
                  ))}
                </div>
                <form className="techportal-note-form" onSubmit={addNote}>
                  <button className="btn btn-outline-secondary btn-sm" type="submit" disabled={actionLoading || !noteBody.trim()}>
                    <IconMessage2 size={15} className="me-1" />Add Note Only
                  </button>
                </form>
              </section>

              <section className="techportal-detail-section">
                <h3>Notes</h3>
                <div className="techportal-notes">
                  {(selectedTicket.notes || []).map((note) => (
                    <div className="techportal-note" key={note.id}>
                      <strong>{note.createdBy || 'system'}</strong>
                      <span>{note.body}</span>
                      <small>{label(note.visibility)} / {formatDateTime(note.createdAt)}</small>
                    </div>
                  ))}
                  {!(selectedTicket.notes || []).length && <div className="techportal-empty techportal-empty-compact">No notes yet.</div>}
                </div>
              </section>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
