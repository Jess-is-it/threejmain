import React, { useEffect, useMemo, useState } from 'react';
import {
  IconAlertTriangle,
  IconDeviceFloppy,
  IconEdit,
  IconMessage2,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTicket,
  IconTrash,
  IconUserSearch
} from '@tabler/icons-react';
import './ticketing.css';

const API = '/api';

function token() {
  return localStorage.getItem('threejmain_token');
}

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || 'Request failed');
  return data;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function statusClass(status) {
  const value = String(status || '').toLowerCase();
  if (['resolved', 'closed'].includes(value)) return 'bg-green-lt text-green';
  if (['in_progress', 'waiting_customer', 'waiting_internal'].includes(value)) return 'bg-yellow-lt text-yellow';
  if (['urgent', 'cancelled'].includes(value)) return 'bg-red-lt text-red';
  if (['high'].includes(value)) return 'bg-orange-lt text-orange';
  if (['low'].includes(value)) return 'bg-secondary-lt text-secondary';
  return 'bg-blue-lt text-blue';
}

function formatLabel(value) {
  return String(value || '').replaceAll('_', ' ');
}

function customerLabel(customer) {
  if (!customer) return 'Manual requestor';
  return `${customer.accountNumber || 'NO-ACCOUNT'} - ${customer.name || 'Unnamed customer'}`;
}

function Card({ title, icon: Icon, actions, children }) {
  return (
    <div className="card">
      {(title || actions) && (
        <div className="card-header">
          <h3 className="card-title">{Icon && <Icon size={18} className="me-2 text-muted" />}{title}</h3>
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      <div className="card-body">{children}</div>
    </div>
  );
}

function TextField({ label, value, onChange, type = 'text', required = false }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <input className="form-control" type={type} value={value ?? ''} required={required} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function SelectField({ label, value, onChange, options, required = false, children }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <select className="form-select" value={value ?? ''} required={required} onChange={(event) => onChange(event.target.value)}>
        {children || options.map((option) => <option key={option} value={option}>{formatLabel(option)}</option>)}
      </select>
    </div>
  );
}

const blankTicket = {
  id: '',
  customerId: '',
  requestorName: '',
  contactNumber: '',
  subject: '',
  description: '',
  category: 'CONNECTIVITY',
  priority: 'NORMAL',
  status: 'OPEN',
  source: 'PHONE',
  assignedTo: '',
  serviceId: '',
  outageId: '',
  dueDate: today(),
  resolutionSummary: ''
};

export default function TicketingPage({ refreshShell = () => {} }) {
  const [meta, setMeta] = useState({ statuses: [], priorities: [], categories: [], sources: [], noteVisibilities: [], placeholders: {} });
  const [overview, setOverview] = useState({ metrics: {}, byStatus: {}, byPriority: {}, recentTickets: [] });
  const [tickets, setTickets] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [filters, setFilters] = useState({ search: '', status: '', priority: '', category: '' });
  const [form, setForm] = useState(blankTicket);
  const [selectedId, setSelectedId] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [noteVisibility, setNoteVisibility] = useState('INTERNAL');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const selectedTicket = useMemo(() => tickets.find((ticket) => ticket.id === selectedId) || null, [selectedId, tickets]);

  async function load(nextFilters = filters, nextCustomerSearch = customerSearch) {
    setError('');
    const params = new URLSearchParams();
    Object.entries(nextFilters).forEach(([key, value]) => { if (value) params.set(key, value); });
    try {
      const [nextMeta, nextOverview, nextCustomers, nextTickets] = await Promise.all([
        request('/ticketing/meta'),
        request('/ticketing/overview'),
        request(`/ticketing/customers?search=${encodeURIComponent(nextCustomerSearch)}`),
        request(`/ticketing/tickets?${params.toString()}`)
      ]);
      setMeta(nextMeta);
      setOverview(nextOverview);
      setCustomers(nextCustomers);
      setTickets(nextTickets);
      if (!selectedId && nextTickets[0]) setSelectedId(nextTickets[0].id);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  function resetForm() {
    setForm(blankTicket);
    setSelectedId('');
    setMessage('');
    setError('');
  }

  function editTicket(ticket) {
    setSelectedId(ticket.id);
    setForm({
      id: ticket.id,
      customerId: ticket.customerId || '',
      requestorName: ticket.requestorName || '',
      contactNumber: ticket.contactNumber || '',
      subject: ticket.subject || '',
      description: ticket.description || '',
      category: ticket.category || 'GENERAL',
      priority: ticket.priority || 'NORMAL',
      status: ticket.status || 'OPEN',
      source: ticket.source || 'PHONE',
      assignedTo: ticket.assignedTo || '',
      serviceId: ticket.serviceId || '',
      outageId: ticket.outageId || '',
      dueDate: ticket.dueDate || '',
      resolutionSummary: ticket.resolutionSummary || ''
    });
  }

  function customerOptions() {
    return (
      <>
        <option value="">Manual requestor</option>
        {customers.map((customer) => <option key={customer.id} value={customer.id}>{customerLabel(customer)}</option>)}
      </>
    );
  }

  async function submitTicket(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    const body = { ...form };
    delete body.id;
    if (!body.customerId) body.customerId = null;
    try {
      const saved = await request(form.id ? `/ticketing/tickets/${form.id}` : '/ticketing/tickets', {
        method: form.id ? 'PATCH' : 'POST',
        body: JSON.stringify(body)
      });
      setMessage(`Saved ${saved.ticketNumber}`);
      setSelectedId(saved.id);
      setForm({ ...blankTicket, id: '' });
      await load();
      await refreshShell();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteTicket(ticket) {
    if (!window.confirm(`Delete ${ticket.ticketNumber}?`)) return;
    setError('');
    try {
      await request(`/ticketing/tickets/${ticket.id}`, { method: 'DELETE' });
      setMessage(`Deleted ${ticket.ticketNumber}`);
      if (selectedId === ticket.id) setSelectedId('');
      await load();
      await refreshShell();
    } catch (err) {
      setError(err.message);
    }
  }

  async function addNote(event) {
    event.preventDefault();
    if (!selectedTicket) return;
    setError('');
    try {
      const updated = await request(`/ticketing/tickets/${selectedTicket.id}/notes`, {
        method: 'POST',
        body: JSON.stringify({ body: noteBody, visibility: noteVisibility })
      });
      setNoteBody('');
      setMessage(`Added note to ${updated.ticketNumber}`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function runCustomerSearch() {
    await load(filters, customerSearch);
  }

  async function applyFilters(event) {
    event.preventDefault();
    await load(filters);
  }

  const metrics = overview.metrics || {};

  return (
    <div className="ticketing-page">
      {(message || error) && (
        <div className={`alert ${error ? 'alert-danger' : 'alert-success'}`}>{error || message}</div>
      )}

      <div className="row row-deck row-cards mb-3">
        {[
          ['Open Tickets', metrics.open_tickets || 0, IconTicket, 'blue'],
          ['Urgent', metrics.urgent || 0, IconAlertTriangle, 'red'],
          ['Field Jobs', metrics.field_jobs || 0, IconUserSearch, 'orange'],
          ['SLA Risks', metrics.sla_risks || 0, IconAlertTriangle, 'yellow']
        ].map(([label, value, Icon, tone]) => (
          <div className="col-sm-6 col-lg-3" key={label}>
            <div className="card metric-card">
              <div className="card-body d-flex align-items-center gap-3">
                <span className={`avatar bg-${tone}-lt text-${tone}`}><Icon size={22} /></span>
                <div>
                  <div className="text-muted">{label}</div>
                  <div className="h2 m-0">{value}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="row row-cards">
        <div className="col-lg-7">
          <Card
            title="Tickets"
            icon={IconTicket}
            actions={<button className="btn btn-primary" type="button" onClick={resetForm}><IconPlus size={16} /> New</button>}
          >
            <form className="row g-2 mb-3" onSubmit={applyFilters}>
              <div className="col-md-4">
                <input className="form-control" placeholder="Search tickets" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
              </div>
              <div className="col-md-2">
                <select className="form-select" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
                  <option value="">All statuses</option>
                  {meta.statuses.map((status) => <option key={status} value={status}>{formatLabel(status)}</option>)}
                </select>
              </div>
              <div className="col-md-2">
                <select className="form-select" value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })}>
                  <option value="">All priorities</option>
                  {meta.priorities.map((priority) => <option key={priority} value={priority}>{formatLabel(priority)}</option>)}
                </select>
              </div>
              <div className="col-md-2">
                <select className="form-select" value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })}>
                  <option value="">All categories</option>
                  {meta.categories.map((category) => <option key={category} value={category}>{formatLabel(category)}</option>)}
                </select>
              </div>
              <div className="col-md-2 d-flex gap-2">
                <button className="btn btn-outline-primary flex-fill" type="submit"><IconSearch size={16} /></button>
                <button className="btn btn-outline-secondary" type="button" onClick={() => load()}><IconRefresh size={16} /></button>
              </div>
            </form>

            <div className="ticket-list">
              {tickets.map((ticket) => (
                <div className={`ticket-row ${selectedId === ticket.id ? 'active' : ''}`} key={ticket.id}>
                  <div className="d-flex justify-content-between gap-2">
                    <button className="btn btn-link p-0 text-start" type="button" onClick={() => { setSelectedId(ticket.id); editTicket(ticket); }}>
                      <div className="ticket-subject">{ticket.ticketNumber} - {ticket.subject}</div>
                      <div className="text-muted small">{customerLabel(ticket.customer)} / {ticket.requestorName}</div>
                    </button>
                    <div className="btn-list flex-nowrap">
                      <button className="btn btn-icon btn-outline-primary" type="button" onClick={() => editTicket(ticket)} title="Edit ticket"><IconEdit size={16} /></button>
                      <button className="btn btn-icon btn-outline-danger" type="button" onClick={() => deleteTicket(ticket)} title="Delete ticket"><IconTrash size={16} /></button>
                    </div>
                  </div>
                  <div className="ticket-meta mt-2">
                    <span className={`badge ${statusClass(ticket.status)}`}>{formatLabel(ticket.status)}</span>
                    <span className={`badge ${statusClass(ticket.priority)}`}>{formatLabel(ticket.priority)}</span>
                    <span className="badge bg-secondary-lt text-secondary">{formatLabel(ticket.category)}</span>
                    <span className="badge bg-cyan-lt text-cyan">{formatLabel(ticket.source)}</span>
                    {ticket.assignedTo && <span className="badge bg-purple-lt text-purple">{ticket.assignedTo}</span>}
                    {ticket.dueDate && <span className="badge bg-yellow-lt text-yellow">Due {ticket.dueDate}</span>}
                  </div>
                  {ticket.description && <p className="text-muted mt-2 mb-0">{ticket.description}</p>}
                </div>
              ))}
              {!tickets.length && <div className="empty">No tickets match the current filters.</div>}
            </div>
          </Card>
        </div>

        <div className="col-lg-5">
          <Card title={form.id ? 'Edit Ticket' : 'Create Ticket'} icon={IconDeviceFloppy}>
            <form className="row g-3" onSubmit={submitTicket}>
              <div className="col-12">
                <div className="input-group">
                  <input className="form-control" placeholder="Search Customer Profiling records" value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} />
                  <button className="btn btn-outline-secondary" type="button" onClick={runCustomerSearch}><IconSearch size={16} /></button>
                </div>
              </div>
              <div className="col-12">
                <SelectField label="Customer" value={form.customerId} onChange={(value) => setForm({ ...form, customerId: value })}>
                  {customerOptions()}
                </SelectField>
              </div>
              <div className="col-md-7"><TextField label="Requestor" value={form.requestorName} required={!form.customerId} onChange={(value) => setForm({ ...form, requestorName: value })} /></div>
              <div className="col-md-5"><TextField label="Contact" value={form.contactNumber} onChange={(value) => setForm({ ...form, contactNumber: value })} /></div>
              <div className="col-12"><TextField label="Subject" value={form.subject} required onChange={(value) => setForm({ ...form, subject: value })} /></div>
              <div className="col-12">
                <label className="form-label">Description</label>
                <textarea className="form-control" rows="3" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
              </div>
              <div className="col-md-6"><SelectField label="Category" value={form.category} options={meta.categories} onChange={(value) => setForm({ ...form, category: value })} /></div>
              <div className="col-md-6"><SelectField label="Priority" value={form.priority} options={meta.priorities} onChange={(value) => setForm({ ...form, priority: value })} /></div>
              <div className="col-md-6"><SelectField label="Status" value={form.status} options={meta.statuses} onChange={(value) => setForm({ ...form, status: value })} /></div>
              <div className="col-md-6"><SelectField label="Source" value={form.source} options={meta.sources} onChange={(value) => setForm({ ...form, source: value })} /></div>
              <div className="col-md-6"><TextField label="Assigned To" value={form.assignedTo} onChange={(value) => setForm({ ...form, assignedTo: value })} /></div>
              <div className="col-md-6"><TextField label="Due Date" type="date" value={form.dueDate} onChange={(value) => setForm({ ...form, dueDate: value })} /></div>
              <div className="col-md-6"><TextField label="Service ID" value={form.serviceId} onChange={(value) => setForm({ ...form, serviceId: value })} /></div>
              <div className="col-md-6"><TextField label="Outage ID" value={form.outageId} onChange={(value) => setForm({ ...form, outageId: value })} /></div>
              <div className="col-12">
                <label className="form-label">Resolution Summary</label>
                <textarea className="form-control" rows="2" value={form.resolutionSummary} onChange={(event) => setForm({ ...form, resolutionSummary: event.target.value })} />
              </div>
              <div className="col-12 d-flex gap-2">
                <button className="btn btn-primary" type="submit"><IconDeviceFloppy size={16} /> Save Ticket</button>
                <button className="btn btn-outline-secondary" type="button" onClick={resetForm}>Clear</button>
              </div>
            </form>
          </Card>

          <div className="mt-3">
            <Card title="Notes" icon={IconMessage2}>
              {selectedTicket ? (
                <>
                  <div className="mb-3">
                    <div className="fw-bold">{selectedTicket.ticketNumber}</div>
                    <div className="text-muted">{selectedTicket.subject}</div>
                  </div>
                  <form className="row g-2 mb-3" onSubmit={addNote}>
                    <div className="col-12">
                      <textarea className="form-control" rows="2" placeholder="Add note" value={noteBody} onChange={(event) => setNoteBody(event.target.value)} />
                    </div>
                    <div className="col-md-7">
                      <select className="form-select" value={noteVisibility} onChange={(event) => setNoteVisibility(event.target.value)}>
                        {meta.noteVisibilities.map((visibility) => <option key={visibility} value={visibility}>{formatLabel(visibility)}</option>)}
                      </select>
                    </div>
                    <div className="col-md-5">
                      <button className="btn btn-outline-primary w-100" type="submit"><IconPlus size={16} /> Add Note</button>
                    </div>
                  </form>
                  <div className="note-list">
                    {(selectedTicket.notes || []).map((note) => (
                      <div className="note-item mb-2" key={note.id}>
                        <div className="d-flex justify-content-between">
                          <span className={`badge ${note.visibility === 'INTERNAL' ? 'bg-purple-lt text-purple' : 'bg-green-lt text-green'}`}>{formatLabel(note.visibility)}</span>
                          <span className="text-muted small">{note.createdBy} / {new Date(note.createdAt).toLocaleString()}</span>
                        </div>
                        <div className="mt-2">{note.body}</div>
                      </div>
                    ))}
                    {!(selectedTicket.notes || []).length && <div className="text-muted">No notes yet.</div>}
                  </div>
                </>
              ) : <div className="empty">Select a ticket to manage notes.</div>}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
