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
  IconUserSearch,
  IconX
} from '@tabler/icons-react';
import CustomerEmotionAvatar from '../../system-settings/web/CustomerEmotionAvatar';
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

function label(value) {
  return String(value || '').replaceAll('_', ' ');
}

function statusClass(value) {
  const normalized = String(value || '').toLowerCase();
  if (['resolved', 'closed'].includes(normalized)) return 'bg-green-lt text-green';
  if (['in_progress', 'waiting_customer', 'waiting_internal'].includes(normalized)) return 'bg-yellow-lt text-yellow';
  if (['urgent', 'cancelled'].includes(normalized)) return 'bg-red-lt text-red';
  if (['high'].includes(normalized)) return 'bg-orange-lt text-orange';
  if (['low'].includes(normalized)) return 'bg-secondary-lt text-secondary';
  return 'bg-blue-lt text-blue';
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

function TextField({ label: fieldLabel, value, onChange, type = 'text', required = false }) {
  return (
    <div>
      <label className="form-label">{fieldLabel}</label>
      <input className="form-control" type={type} value={value ?? ''} required={required} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function SelectField({ label: fieldLabel, value, onChange, options, children }) {
  return (
    <div>
      <label className="form-label">{fieldLabel}</label>
      <select className="form-select" value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
        {children || options.map((option) => <option key={option} value={option}>{label(option)}</option>)}
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

const defaultStatuses = ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'WAITING_INTERNAL', 'RESOLVED', 'CLOSED', 'CANCELLED'];
const defaultCategories = ['CONNECTIVITY', 'BILLING', 'INSTALLATION', 'EQUIPMENT', 'OUTAGE', 'GENERAL'];

const priorityCopy = {
  URGENT: 'Urgent',
  HIGH: 'High',
  NORMAL: 'Normal',
  LOW: 'Low'
};

function priorityClass(priority) {
  return `ticket-priority-${String(priority || 'NORMAL').toLowerCase()}`;
}

export default function TicketingPage({ refreshShell = () => {} }) {
  const [meta, setMeta] = useState({ statuses: [], priorities: [], categories: [], sources: [], noteVisibilities: [] });
  const [overview, setOverview] = useState({ metrics: {}, byStatus: {}, byPriority: {}, recentTickets: [] });
  const [tickets, setTickets] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [avatarConfig, setAvatarConfig] = useState(null);
  const [serviceOrders, setServiceOrders] = useState([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [filters, setFilters] = useState({ search: '', status: '', priority: '', category: '' });
  const [form, setForm] = useState(blankTicket);
  const [selectedId, setSelectedId] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [draggingTicketId, setDraggingTicketId] = useState('');
  const [detailTicketId, setDetailTicketId] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [noteVisibility, setNoteVisibility] = useState('INTERNAL');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const statuses = meta.statuses.length ? meta.statuses : defaultStatuses;
  const categories = meta.categories.length ? meta.categories : defaultCategories;
  const activeCategory = filters.category || categories[0] || '';
  const boardTickets = useMemo(() => {
    return activeCategory ? tickets.filter((ticket) => ticket.category === activeCategory) : tickets;
  }, [activeCategory, tickets]);
  const categoryCounts = useMemo(() => {
    return categories.reduce((counts, category) => {
      counts[category] = tickets.filter((ticket) => ticket.category === category).length;
      return counts;
    }, {});
  }, [categories, tickets]);
  const ticketsByStatus = useMemo(() => {
    return statuses.reduce((groups, status) => {
      groups[status] = boardTickets.filter((ticket) => ticket.status === status);
      return groups;
    }, {});
  }, [statuses, boardTickets]);
  const detailTicket = useMemo(() => tickets.find((ticket) => ticket.id === detailTicketId) || null, [detailTicketId, tickets]);

  async function load(nextFilters = filters, nextCustomerSearch = customerSearch) {
    setError('');
    const params = new URLSearchParams();
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value && key !== 'category') params.set(key, value);
    });
    try {
      const [nextMeta, nextOverview, nextCustomers, nextServiceOrders, nextTickets, nextAvatarConfig] = await Promise.all([
        request('/ticketing/meta'),
        request('/ticketing/overview'),
        request(`/ticketing/customers?search=${encodeURIComponent(nextCustomerSearch)}`),
        request('/service/orders?activeOnly=true'),
        request(`/ticketing/tickets?${params.toString()}`),
        request('/system-settings/avatars').catch(() => null)
      ]);
      setMeta(nextMeta);
      setOverview(nextOverview);
      setCustomers(nextCustomers);
      setServiceOrders(nextServiceOrders);
      setTickets(nextTickets);
      setAvatarConfig(nextAvatarConfig);
      if (!selectedId && nextTickets[0]) setSelectedId(nextTickets[0].id);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  function resetForm() {
    setForm(blankTicket);
    setSelectedId('');
    setIsFormOpen(true);
    setMessage('');
    setError('');
  }

  function closeTicketModal() {
    setIsFormOpen(false);
    setForm(blankTicket);
  }

  function openTicketDetail(ticket) {
    setSelectedId(ticket.id);
    setDetailTicketId(ticket.id);
  }

  function closeTicketDetail() {
    setDetailTicketId('');
    setNoteBody('');
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
    setIsFormOpen(true);
  }

  async function submitTicket(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    const body = { ...form, customerId: form.customerId || null };
    delete body.id;
    try {
      const saved = await request(form.id ? `/ticketing/tickets/${form.id}` : '/ticketing/tickets', {
        method: form.id ? 'PATCH' : 'POST',
        body: JSON.stringify(body)
      });
      setMessage(`Saved ${saved.ticketNumber}`);
      setSelectedId(saved.id);
      setForm(blankTicket);
      setIsFormOpen(false);
      await load();
      await refreshShell();
    } catch (err) {
      setError(err.message);
    }
  }

  function serviceOrderOptions() {
    const rows = form.customerId ? serviceOrders.filter((order) => order.customerId === form.customerId) : serviceOrders;
    return (
      <>
        <option value="">No service order</option>
        {rows.map((order) => (
          <option key={order.id} value={order.serviceReference || order.orderNumber}>
            {order.serviceReference || order.orderNumber} - {order.catalogName || order.catalog?.name} - {customerLabel(order.customer)}
          </option>
        ))}
      </>
    );
  }

  function setTicketServiceOrder(serviceId) {
    const order = serviceOrders.find((item) => (item.serviceReference || item.orderNumber) === serviceId);
    if (!order) {
      setForm({ ...form, serviceId });
      return;
    }
    setForm({
      ...form,
      serviceId,
      customerId: order.customerId,
      requestorName: form.requestorName || order.customer?.name || '',
      contactNumber: form.contactNumber || order.customer?.contactNumber || ''
    });
  }

  async function deleteTicket(ticket) {
    if (!window.confirm(`Delete ${ticket.ticketNumber}?`)) return;
    setError('');
    try {
      await request(`/ticketing/tickets/${ticket.id}`, { method: 'DELETE' });
      setMessage(`Deleted ${ticket.ticketNumber}`);
      if (selectedId === ticket.id) setSelectedId('');
      if (detailTicketId === ticket.id) closeTicketDetail();
      await load();
      await refreshShell();
    } catch (err) {
      setError(err.message);
    }
  }

  async function moveTicket(ticket, nextStatus) {
    if (!ticket || ticket.status === nextStatus) return;
    setError('');
    setMessage('');
    try {
      const updated = await request(`/ticketing/tickets/${ticket.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus })
      });
      setSelectedId(updated.id);
      setMessage(`Moved ${updated.ticketNumber} to ${label(nextStatus)}`);
      await load();
      await refreshShell();
    } catch (err) {
      setError(err.message);
    }
  }

  async function dropTicket(event, status) {
    event.preventDefault();
    const ticketId = event.dataTransfer.getData('text/plain') || draggingTicketId;
    const ticket = tickets.find((row) => row.id === ticketId);
    setDraggingTicketId('');
    await moveTicket(ticket, status);
  }

  async function addNote(event) {
    event.preventDefault();
    if (!detailTicket) return;
    setError('');
    try {
      const updated = await request(`/ticketing/tickets/${detailTicket.id}/notes`, {
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

  const metrics = overview.metrics || {};

  return (
    <div className="ticketing-page">
      {(message || error) && <div className={`alert ${error ? 'alert-danger' : 'alert-success'}`}>{error || message}</div>}

      <div className="row row-deck row-cards mb-3">
        {[
          ['Open Tickets', metrics.open_tickets || 0, IconTicket, 'blue'],
          ['Urgent', metrics.urgent || 0, IconAlertTriangle, 'red'],
          ['Field Jobs', metrics.field_jobs || 0, IconUserSearch, 'orange'],
          ['SLA Risks', metrics.sla_risks || 0, IconAlertTriangle, 'yellow']
        ].map(([metricLabel, value, Icon, tone]) => (
          <div className="col-sm-6 col-lg-3" key={metricLabel}>
            <div className="card ticketing-metric">
              <div className="card-body d-flex align-items-center gap-3">
                <span className={`avatar bg-${tone}-lt text-${tone}`}><Icon size={22} /></span>
                <div>
                  <div className="text-muted">{metricLabel}</div>
                  <div className="h2 m-0">{value}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Card title="Tickets Board" icon={IconTicket} actions={<button className="btn btn-primary" type="button" onClick={resetForm}><IconPlus size={16} /> New Ticket</button>}>
        <form className="row g-2 mb-3" onSubmit={(event) => { event.preventDefault(); load(filters); }}>
          <div className="col-md-4">
            <input className="form-control" placeholder="Search tickets" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
          </div>
          <div className="col-md-2">
            <select className="form-select" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
              <option value="">All statuses</option>
              {statuses.map((status) => <option key={status} value={status}>{label(status)}</option>)}
            </select>
          </div>
          <div className="col-md-2">
            <select className="form-select" value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })}>
              <option value="">All priorities</option>
              {meta.priorities.map((priority) => <option key={priority} value={priority}>{label(priority)}</option>)}
            </select>
          </div>
          <div className="col-md-4 d-flex gap-2">
            <button className="btn btn-outline-primary flex-fill" type="submit"><IconSearch size={16} /></button>
            <button className="btn btn-outline-secondary" type="button" onClick={() => load()}><IconRefresh size={16} /></button>
          </div>
        </form>

        <div className="ticketing-category-tabs" role="tablist" aria-label="Ticket categories">
          {categories.map((category) => (
            <button
              className={`ticketing-category-tab ${activeCategory === category ? 'active' : ''}`}
              key={category}
              onClick={() => setFilters({ ...filters, category })}
              role="tab"
              type="button"
              aria-selected={activeCategory === category}
            >
              <span>{label(category)}</span>
              <span className="badge bg-blue-lt text-blue">{categoryCounts[category] || 0}</span>
            </button>
          ))}
        </div>

        <div className="ticketing-board" aria-label="Ticket status board">
          {statuses.map((status) => (
            <section
              className="ticketing-column"
              key={status}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => dropTicket(event, status)}
            >
              <div className="ticketing-column-header">
                <div>
                  <div className="ticketing-column-title">{label(status)}</div>
                  <div className="text-muted small">Status queue</div>
                </div>
                <span className={`badge ${statusClass(status)}`}>{ticketsByStatus[status]?.length || 0}</span>
              </div>

              <div className="ticketing-column-body">
                {(ticketsByStatus[status] || []).map((ticket) => (
                  <article
                    className={`ticketing-card ${selectedId === ticket.id ? 'active' : ''} ${priorityClass(ticket.priority)}`}
                    draggable
                    key={ticket.id}
                    onClick={() => openTicketDetail(ticket)}
                    onDragStart={(event) => {
                      setDraggingTicketId(ticket.id);
                      event.dataTransfer.setData('text/plain', ticket.id);
                    }}
                    onDragEnd={() => setDraggingTicketId('')}
                  >
                    <div className="ticketing-card-top">
                      <span className={`badge ${statusClass(ticket.status)}`}>{label(ticket.status)}</span>
                      <span className="ticketing-number">{ticket.ticketNumber}</span>
                    </div>

                    <div className="ticketing-card-title">{ticket.subject}</div>
                    <div className="ticketing-customer">
                      <CustomerEmotionAvatar customer={ticket.customer || { name: ticket.requestorName, contactNumber: ticket.contactNumber }} avatarConfig={avatarConfig} context={{ ticket }} size={30} />
                      <span>{customerLabel(ticket.customer)}</span>
                    </div>

                    <div className="ticketing-card-actions">
                      <span className={`ticketing-priority ${priorityClass(ticket.priority)}`}>
                        <IconAlertTriangle size={14} />
                        {priorityCopy[ticket.priority] || label(ticket.priority)}
                      </span>
                      <button className="btn btn-icon btn-outline-secondary" type="button" onClick={(event) => { event.stopPropagation(); openTicketDetail(ticket); }} title="View details and notes">
                        <IconMessage2 size={16} />
                        {!!(ticket.notes || []).length && <span className="ticketing-note-count">{ticket.notes.length}</span>}
                      </button>
                    </div>
                  </article>
                ))}
                {!(ticketsByStatus[status] || []).length && <div className="ticketing-drop-empty">Drop tickets here</div>}
              </div>
            </section>
          ))}
        </div>
        {!boardTickets.length && <div className="empty mt-3">No tickets match the current category and filters.</div>}
      </Card>

      {detailTicket && (
        <div className="ticketing-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeTicketDetail(); }}>
          <aside className="ticketing-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="ticketing-detail-title">
            <div className="ticketing-drawer-header">
              <div>
                <div className="text-muted small">Ticket details</div>
                <h3 id="ticketing-detail-title">{detailTicket.ticketNumber}</h3>
                <div className="text-muted">{detailTicket.subject}</div>
              </div>
              <button className="btn btn-icon btn-outline-secondary" type="button" onClick={closeTicketDetail} title="Close details"><IconX size={18} /></button>
            </div>

            <div className="ticketing-drawer-body">
              <div className="ticketing-detail-summary">
                <div className="d-flex align-items-center gap-3">
                  <CustomerEmotionAvatar customer={detailTicket.customer || { name: detailTicket.requestorName, contactNumber: detailTicket.contactNumber }} avatarConfig={avatarConfig} context={{ ticket: detailTicket }} size={46} showLabel />
                  <div>
                    <div className="fw-bold">{customerLabel(detailTicket.customer)}</div>
                    <div className="text-muted small">{detailTicket.requestorName || 'Manual requestor'} / {detailTicket.contactNumber || 'No contact'}</div>
                  </div>
                </div>
                <span className={`ticketing-priority ${priorityClass(detailTicket.priority)}`}>
                  <IconAlertTriangle size={14} />
                  {priorityCopy[detailTicket.priority] || label(detailTicket.priority)}
                </span>
              </div>

              <div className="ticketing-detail-actions">
                <button className="btn btn-outline-primary" type="button" onClick={() => editTicket(detailTicket)}><IconEdit size={16} /> Edit</button>
                <button className="btn btn-outline-danger" type="button" onClick={() => deleteTicket(detailTicket)}><IconTrash size={16} /> Delete</button>
              </div>

              <div className="ticketing-detail-grid">
                <div><span>Status</span><strong>{label(detailTicket.status)}</strong></div>
                <div><span>Priority</span><strong>{label(detailTicket.priority)}</strong></div>
                <div><span>Category</span><strong>{label(detailTicket.category)}</strong></div>
                <div><span>Source</span><strong>{label(detailTicket.source)}</strong></div>
                <div><span>Assigned To</span><strong>{detailTicket.assignedTo || 'Unassigned'}</strong></div>
                <div><span>Due Date</span><strong>{detailTicket.dueDate || 'No due date'}</strong></div>
                <div><span>Service ID</span><strong>{detailTicket.serviceId || 'No service reference'}</strong></div>
                <div><span>Service Order</span><strong>{detailTicket.serviceOrderNumber || 'No service order'}</strong></div>
                <div><span>Source Module</span><strong>{detailTicket.sourceModule ? label(String(detailTicket.sourceModule).toUpperCase()) : 'Manual'}</strong></div>
                <div><span>Outage ID</span><strong>{detailTicket.outageId || 'No outage reference'}</strong></div>
                <div><span>Opened</span><strong>{detailTicket.openedAt ? new Date(detailTicket.openedAt).toLocaleString() : 'Not recorded'}</strong></div>
                <div><span>Updated</span><strong>{detailTicket.updatedAt ? new Date(detailTicket.updatedAt).toLocaleString() : 'Not recorded'}</strong></div>
              </div>

              <div className="ticketing-detail-section">
                <span>Description</span>
                <p>{detailTicket.description || 'No description provided.'}</p>
              </div>

              <div className="ticketing-detail-section">
                <span>Resolution Summary</span>
                <p>{detailTicket.resolutionSummary || 'No resolution summary yet.'}</p>
              </div>

              <div className="ticketing-drawer-subtitle">
                <IconMessage2 size={17} />
                Notes
              </div>

              <form className="ticketing-note-form" onSubmit={addNote}>
                <textarea className="form-control" rows="4" placeholder="Add note" value={noteBody} onChange={(event) => setNoteBody(event.target.value)} />
                <div className="ticketing-note-form-row">
                  <select className="form-select" value={noteVisibility} onChange={(event) => setNoteVisibility(event.target.value)}>
                    {meta.noteVisibilities.map((visibility) => <option key={visibility} value={visibility}>{label(visibility)}</option>)}
                  </select>
                  <button className="btn btn-primary" type="submit"><IconPlus size={16} /> Add</button>
                </div>
              </form>

              <div className="ticketing-notes">
                {(detailTicket.notes || []).map((note) => (
                  <div className="ticketing-note mb-2" key={note.id}>
                    <div className="d-flex justify-content-between gap-3">
                      <span className={`badge ${note.visibility === 'INTERNAL' ? 'bg-purple-lt text-purple' : 'bg-green-lt text-green'}`}>{label(note.visibility)}</span>
                      <span className="text-muted small">{note.createdBy} / {new Date(note.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="mt-2">{note.body}</div>
                  </div>
                ))}
                {!(detailTicket.notes || []).length && <div className="empty">No notes yet.</div>}
              </div>
            </div>
          </aside>
        </div>
      )}

      {isFormOpen && (
        <div className="ticketing-modal-backdrop" role="presentation">
          <div className="ticketing-modal" role="dialog" aria-modal="true" aria-labelledby="ticketing-modal-title">
            <div className="ticketing-modal-header">
              <div>
                <div className="text-muted small">{form.id ? 'Edit existing ticket' : 'Create new ticket'}</div>
                <h3 id="ticketing-modal-title">{form.id ? 'Edit Ticket' : 'Create Ticket'}</h3>
              </div>
              <button className="btn btn-icon btn-outline-secondary" type="button" onClick={closeTicketModal} title="Close"><IconX size={18} /></button>
            </div>

            <form className="row g-3" onSubmit={submitTicket}>
              <div className="col-12">
                <div className="input-group">
                  <input className="form-control" placeholder="Search Customer Profiling records" value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} />
                  <button className="btn btn-outline-secondary" type="button" onClick={() => load(filters, customerSearch)}><IconSearch size={16} /></button>
                </div>
              </div>
              <div className="col-12">
                <SelectField label="Customer" value={form.customerId} onChange={(value) => setForm({ ...form, customerId: value, serviceId: '' })}>
                  <option value="">Manual requestor</option>
                  {customers.map((customer) => <option key={customer.id} value={customer.id}>{customerLabel(customer)}</option>)}
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
              <div className="col-md-6"><SelectField label="Status" value={form.status} options={statuses} onChange={(value) => setForm({ ...form, status: value })} /></div>
              <div className="col-md-6"><SelectField label="Source" value={form.source} options={meta.sources} onChange={(value) => setForm({ ...form, source: value })} /></div>
              <div className="col-md-6"><TextField label="Assigned To" value={form.assignedTo} onChange={(value) => setForm({ ...form, assignedTo: value })} /></div>
              <div className="col-md-6"><TextField label="Due Date" type="date" value={form.dueDate} onChange={(value) => setForm({ ...form, dueDate: value })} /></div>
              <div className="col-md-6"><SelectField label="Service Order" value={form.serviceId} onChange={setTicketServiceOrder}>{serviceOrderOptions()}</SelectField></div>
              <div className="col-md-6"><TextField label="Outage ID" value={form.outageId} onChange={(value) => setForm({ ...form, outageId: value })} /></div>
              <div className="col-12">
                <label className="form-label">Resolution Summary</label>
                <textarea className="form-control" rows="2" value={form.resolutionSummary} onChange={(event) => setForm({ ...form, resolutionSummary: event.target.value })} />
              </div>
              <div className="col-12 d-flex gap-2 justify-content-end">
                <button className="btn btn-outline-secondary" type="button" onClick={closeTicketModal}>Cancel</button>
                <button className="btn btn-primary" type="submit"><IconDeviceFloppy size={16} /> Save Ticket</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
