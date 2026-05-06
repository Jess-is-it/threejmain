import React, { useEffect, useState } from 'react';
import {
  IconActivity,
  IconClock,
  IconDeviceFloppy,
  IconEdit,
  IconEye,
  IconFileSpreadsheet,
  IconFilter,
  IconMapPin,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconUpload,
  IconUsers,
  IconWifi,
  IconX
} from '@tabler/icons-react';
import './customerProfiling.css';

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

function fmt(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function statusClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (['active', 'paid', 'online'].includes(normalized)) return 'bg-green-lt text-green';
  if (['pending', 'paused'].includes(normalized)) return 'bg-yellow-lt text-yellow';
  if (['suspended', 'terminated', 'inactive'].includes(normalized)) return 'bg-red-lt text-red';
  return 'bg-blue-lt text-blue';
}

function csvEscape(value) {
  const str = String(value ?? '');
  return `"${str.replaceAll('"', '""')}"`;
}

function Card({ title, icon: Icon, children, actions }) {
  return (
    <div className="card">
      {(title || actions) && (
        <div className="card-header">
          <h3 className="card-title">
            {Icon && <Icon size={18} className="me-2 text-muted" />}
            {title}
          </h3>
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      <div className="card-body">{children}</div>
    </div>
  );
}

function Table({ rows, columns }) {
  if (!rows?.length) return <div className="empty">No records yet.</div>;
  return (
    <div className="table-responsive">
      <table className="table card-table table-vcenter">
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column.replaceAll('_', ' ')}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id || index}>
              {columns.map((column) => <td key={column}>{fmt(row[column])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const blankCustomerForm = {
  accountNumber: '',
  firstName: '',
  middleName: '',
  lastName: '',
  contactNumber: '',
  alternateMobileNumber: '',
  facebookAccountName: '',
  facebookProfileLink: '',
  secondaryContactName: '',
  secondaryContactNumber: '',
  secondaryContactFacebookAccount: '',
  secondaryContactRelationship: '',
  email: '',
  addressLine1: '',
  addressLine2: '',
  province: 'CAGAYAN',
  city: 'ENRILE',
  barangay: 'ALIBAGO',
  latitude: '',
  longitude: '',
  customerType: 'RESIDENTIAL',
  status: 'ACTIVE'
};

export default function CustomerProfilingPage({ refreshShell = () => {} }) {
  const [overview, setOverview] = useState(null);
  const [meta, setMeta] = useState({ customerTypes: [], customerStatuses: [], assignmentStatuses: [], provinces: [], cities: [], citiesByProvince: {}, barangays: [], barangaysByProvinceCity: {}, bulkUploadHeaders: [] });
  const [customers, setCustomers] = useState({ data: [], page: 1, pageSize: 10, total: 0, totalPages: 1 });
  const [filters, setFilters] = useState({ search: '', customerType: '', status: '', province: '', city: '', barangay: '', page: 1, pageSize: 10 });
  const [selected, setSelected] = useState(null);
  const [services, setServices] = useState([]);
  const [form, setForm] = useState(blankCustomerForm);
  const [editingId, setEditingId] = useState('');
  const [isFormModalOpen, setFormModalOpen] = useState(false);
  const [isDetailsPanelOpen, setDetailsPanelOpen] = useState(false);
  const [serviceForm, setServiceForm] = useState({ planId: 'BASIC-50MBPS', serviceId: 'FIBER-INTERNET', startDate: new Date().toISOString().slice(0, 10), endDate: '', status: 'ACTIVE' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const cities = filters.province ? (meta.citiesByProvince?.[filters.province] || []) : meta.cities || [];
  const formCities = form.province ? (meta.citiesByProvince?.[form.province] || []) : meta.cities || [];
  const barangayKey = `${filters.province}::${filters.city}`;
  const formBarangayKey = `${form.province}::${form.city}`;
  const barangays = filters.province && filters.city ? (meta.barangaysByProvinceCity?.[barangayKey] || meta.barangays || []) : meta.barangays || [];
  const formBarangays = form.province && form.city ? (meta.barangaysByProvinceCity?.[formBarangayKey] || meta.barangays || []) : meta.barangays || [];

  async function load(nextFilters = filters) {
    setError('');
    const params = new URLSearchParams();
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value !== '') params.set(key, value);
    });
    try {
      const [nextOverview, nextCustomers, nextMeta] = await Promise.all([
        request('/customer-profiling/customers/overview'),
        request(`/customer-profiling/customers?${params.toString()}`),
        request('/customer-profiling/meta')
      ]);
      setOverview(nextOverview);
      setCustomers(nextCustomers);
      setMeta(nextMeta);
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadCustomer(id) {
    setError('');
    try {
      const [customer, customerServices] = await Promise.all([
        request(`/customer-profiling/customers/${id}`),
        request(`/customer-profiling/customers/${id}/services`)
      ]);
      setSelected(customer);
      setServices(customerServices);
      setDetailsPanelOpen(true);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  function updateFilters(next) {
    const merged = { ...filters, ...next, page: 1 };
    setFilters(merged);
    load(merged);
  }

  function editCustomer(customer) {
    const firstSecondary = customer.secondaryContacts?.[0] || {};
    setEditingId(customer.id);
    setForm({
      ...blankCustomerForm,
      ...customer,
      secondaryContactName: customer.secondaryContactName || firstSecondary.name || '',
      secondaryContactNumber: customer.secondaryContactNumber || firstSecondary.contactNumber || '',
      secondaryContactFacebookAccount: customer.secondaryContactFacebookAccount || firstSecondary.facebookAccount || '',
      secondaryContactRelationship: customer.secondaryContactRelationship || firstSecondary.relationship || ''
    });
    setFormModalOpen(true);
    setMessage(`Editing ${customer.accountNumber}`);
  }

  function openNewCustomerModal() {
    setEditingId('');
    setForm({ ...blankCustomerForm });
    setFormModalOpen(true);
    setMessage('');
    setError('');
  }

  function closeCustomerFormModal() {
    setFormModalOpen(false);
    setEditingId('');
    setForm({ ...blankCustomerForm });
  }

  function closeDetailsPanel() {
    setDetailsPanelOpen(false);
    setSelected(null);
    setServices([]);
  }

  function resetForm() {
    setEditingId('');
    setForm({ ...blankCustomerForm });
  }

  async function saveCustomer(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    const method = editingId ? 'PATCH' : 'POST';
    const path = editingId ? `/customer-profiling/customers/${editingId}` : '/customer-profiling/customers';
    try {
      const saved = await request(path, { method, body: JSON.stringify(form) });
      setMessage(`${saved.accountNumber} saved.`);
      const shouldRefreshOpenDetails = isDetailsPanelOpen && selected?.id === saved.id;
      setEditingId('');
      setForm({ ...blankCustomerForm });
      setFormModalOpen(false);
      await load(filters);
      if (shouldRefreshOpenDetails) await loadCustomer(saved.id);
      refreshShell();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteCustomer(customer) {
    if (!window.confirm(`Archive ${customer.accountNumber} - ${customer.fullName}?`)) return;
    await request(`/customer-profiling/customers/${customer.id}`, { method: 'DELETE' });
    setMessage(`${customer.accountNumber} archived.`);
    if (selected?.id === customer.id) closeDetailsPanel();
    await load(filters);
    refreshShell();
  }

  async function assignService(e) {
    e.preventDefault();
    if (!selected) return;
    setError('');
    try {
      await request(`/customer-profiling/customers/${selected.id}/services`, { method: 'POST', body: JSON.stringify(serviceForm) });
      setMessage(`Service assigned to ${selected.accountNumber}.`);
      await loadCustomer(selected.id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function downloadTemplate() {
    const template = await request('/customer-profiling/customers/bulk-upload-template');
    const csv = [
      template.headers.map(csvEscape).join(','),
      template.headers.map((header) => csvEscape(template.sample?.[header] || '')).join(',')
    ].join('\n');
    const href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = href;
    link.download = template.filename;
    link.click();
    URL.revokeObjectURL(href);
  }

  const kpis = [
    ['Total Customers', overview?.totalCustomers, IconUsers, 'azure'],
    ['Active', overview?.activeCustomers, IconActivity, 'green'],
    ['Pending', overview?.pendingCustomers, IconClock, 'yellow'],
    ['Enrile Customers', overview?.enrileCustomers, IconMapPin, 'blue']
  ];

  return (
    <>
    <div className="row row-cards customer-profile-page">
      {message && <div className="col-12"><div className="alert alert-info mb-0">{message}</div></div>}
      {error && <div className="col-12"><div className="alert alert-danger mb-0">{error}</div></div>}
      {kpis.map(([label, value, Icon, tone]) => (
        <div className="col-sm-6 col-xl-3" key={label}>
          <div className="card status-card">
            <div className="card-body">
              <span className={`badge bg-${tone}-lt text-${tone} mb-3`}><Icon size={18} /></span>
              <div className="h1 mb-0">{value ?? 0}</div>
              <div className="text-muted">{label}</div>
            </div>
          </div>
        </div>
      ))}

      <div className="col-12">
        <Card title="Customer Search and Filters" icon={IconFilter} actions={<button className="btn btn-sm" onClick={() => load(filters)}><IconRefresh size={16} className="me-1" />Refresh</button>}>
          <div className="row g-2 align-items-end">
            <div className="col-md-4">
              <label className="form-label">Search</label>
              <div className="input-icon">
                <span className="input-icon-addon"><IconSearch size={16} /></span>
                <input className="form-control" placeholder="Name, account, contact, Facebook" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && updateFilters({ search: e.currentTarget.value })} />
              </div>
            </div>
            <div className="col-md-2">
              <label className="form-label">Type</label>
              <select className="form-select" value={filters.customerType} onChange={(e) => updateFilters({ customerType: e.target.value })}>
                <option value="">All</option>
                {meta.customerTypes.map((item) => <option key={item}>{item}</option>)}
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label">Status</label>
              <select className="form-select" value={filters.status} onChange={(e) => updateFilters({ status: e.target.value })}>
                <option value="">All</option>
                {meta.customerStatuses.map((item) => <option key={item}>{item}</option>)}
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label">Province</label>
              <select className="form-select" value={filters.province} onChange={(e) => updateFilters({ province: e.target.value, city: '', barangay: '' })}>
                <option value="">All</option>
                {meta.provinces.map((item) => <option key={item}>{item}</option>)}
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label">City</label>
              <select className="form-select" value={filters.city} onChange={(e) => updateFilters({ city: e.target.value, barangay: '' })}>
                <option value="">All</option>
                {cities.map((item) => <option key={item}>{item}</option>)}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label">Barangay</label>
              <select className="form-select" value={filters.barangay} onChange={(e) => updateFilters({ barangay: e.target.value })}>
                <option value="">All</option>
                {barangays.map((item) => <option key={item}>{item}</option>)}
              </select>
            </div>
            <div className="col-md-auto">
              <button className="btn btn-primary" onClick={() => updateFilters({ search: filters.search })}><IconSearch size={18} className="me-2" />Apply</button>
            </div>
          </div>
        </Card>
      </div>

      <div className="col-12 col-xl-8">
        <Card title={`Customers (${customers.total})`} icon={IconUsers} actions={<button className="btn btn-primary btn-sm" onClick={openNewCustomerModal}><IconPlus size={16} className="me-1" />New Customer</button>}>
          <div className="table-responsive">
            <table className="table card-table table-vcenter">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Address</th>
                  <th className="w-1">Actions</th>
                </tr>
              </thead>
              <tbody>
                {customers.data.map((customer) => (
                  <tr key={customer.id} className={isDetailsPanelOpen && selected?.id === customer.id ? 'table-active' : ''}>
                    <td><span className="fw-semibold">{customer.accountNumber}</span></td>
                    <td>
                      <div className="fw-semibold">{customer.fullName}</div>
                      <div className="text-muted small">{customer.facebookAccountName || '-'}</div>
                    </td>
                    <td>{customer.contactNumber}</td>
                    <td><span className="badge bg-blue-lt text-blue">{customer.customerType}</span></td>
                    <td><span className={`badge ${statusClass(customer.status)}`}>{customer.status}</span></td>
                    <td>{customer.barangay}, {customer.city}</td>
                    <td>
                      <div className="btn-list flex-nowrap">
                        <button className="btn btn-icon btn-sm" title="View" onClick={() => loadCustomer(customer.id)}><IconEye size={16} /></button>
                        <button className="btn btn-icon btn-sm" title="Edit" onClick={() => editCustomer(customer)}><IconEdit size={16} /></button>
                        <button className="btn btn-icon btn-sm text-danger" title="Archive" onClick={() => deleteCustomer(customer)}><IconTrash size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!customers.data.length && (
                  <tr><td colSpan="7"><div className="empty">No customers match the current filters.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="col-12 col-xl-4">
        <Card title="Assign Service" icon={IconWifi}>
          {!selected && <div className="empty">Select a customer before assigning service.</div>}
          {selected && (
            <form onSubmit={assignService}>
              <div className="mb-3"><label className="form-label">Plan ID</label><input className="form-control" value={serviceForm.planId} onChange={(e) => setServiceForm({ ...serviceForm, planId: e.target.value })} /></div>
              <div className="mb-3"><label className="form-label">Service ID</label><input className="form-control" value={serviceForm.serviceId} onChange={(e) => setServiceForm({ ...serviceForm, serviceId: e.target.value })} /></div>
              <div className="row g-2">
                <div className="col-6"><label className="form-label">Start Date</label><input className="form-control" type="date" value={serviceForm.startDate} onChange={(e) => setServiceForm({ ...serviceForm, startDate: e.target.value })} /></div>
                <div className="col-6"><label className="form-label">End Date</label><input className="form-control" type="date" value={serviceForm.endDate} onChange={(e) => setServiceForm({ ...serviceForm, endDate: e.target.value })} /></div>
              </div>
              <div className="mt-3"><label className="form-label">Status</label><select className="form-select" value={serviceForm.status} onChange={(e) => setServiceForm({ ...serviceForm, status: e.target.value })}>{meta.assignmentStatuses.map((item) => <option key={item}>{item}</option>)}</select></div>
              <button className="btn btn-primary w-100 mt-3"><IconPlus size={18} className="me-2" />Assign Service</button>
            </form>
          )}
        </Card>

        <div className="mt-3">
          <Card title="Bulk Upload" icon={IconUpload}>
            <div className="text-muted mb-3">The previous module supported Excel/CSV bulk creation, preview validation, invalid-row reports, and a guided template. This shell preserves that workflow entry point.</div>
            <button className="btn btn-outline-primary w-100 mb-3" onClick={downloadTemplate}><IconFileSpreadsheet size={18} className="me-2" />Download CSV Template</button>
            <div className="small text-muted mb-2">Required headers</div>
            <div className="bulk-header-list">
              {(meta.requiredBulkUploadHeaders || []).map((item) => <span className="badge bg-blue-lt text-blue" key={item}>{item}</span>)}
            </div>
          </Card>
        </div>
      </div>

      <div className="col-12">
        <Card title="Customer Distribution" icon={IconMapPin}>
          <div className="row g-3">
            <div className="col-md-6">
              <div className="fw-semibold mb-2">Municipalities</div>
              <Table rows={overview?.municipalities || []} columns={['city', 'count']} />
            </div>
            <div className="col-md-6">
              <div className="fw-semibold mb-2">Top Barangays</div>
              <Table rows={overview?.topBarangays || []} columns={['barangay', 'count']} />
            </div>
          </div>
        </Card>
      </div>
    </div>
    {isFormModalOpen && (
      <div className="customer-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeCustomerFormModal()}>
        <div className="customer-modal" role="dialog" aria-modal="true" aria-labelledby="customer-form-title">
          <div className="customer-modal-header">
            <div>
              <div className="text-muted small">{editingId ? 'Update existing profile' : 'Add a new customer record'}</div>
              <h3 id="customer-form-title" className="customer-modal-title">{editingId ? 'Edit Customer Profile' : 'Create Customer Profile'}</h3>
            </div>
            <button type="button" className="btn btn-icon btn-sm" title="Close" onClick={closeCustomerFormModal}><IconX size={18} /></button>
          </div>
          <div className="customer-modal-body">
            <form onSubmit={saveCustomer}>
              <div className="row g-3">
                <div className="col-md-3"><label className="form-label">Account Number</label><input className="form-control" value={form.accountNumber || ''} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} placeholder="Auto if blank" /></div>
                <div className="col-md-3"><label className="form-label">First Name</label><input className="form-control" required value={form.firstName || ''} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></div>
                <div className="col-md-3"><label className="form-label">Middle Name</label><input className="form-control" value={form.middleName || ''} onChange={(e) => setForm({ ...form, middleName: e.target.value })} /></div>
                <div className="col-md-3"><label className="form-label">Last Name</label><input className="form-control" required value={form.lastName || ''} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></div>
                <div className="col-md-3"><label className="form-label">Contact Number</label><input className="form-control" required value={form.contactNumber || ''} onChange={(e) => setForm({ ...form, contactNumber: e.target.value })} /></div>
                <div className="col-md-3"><label className="form-label">Alternate Mobile</label><input className="form-control" value={form.alternateMobileNumber || ''} onChange={(e) => setForm({ ...form, alternateMobileNumber: e.target.value })} /></div>
                <div className="col-md-3"><label className="form-label">Facebook Account</label><input className="form-control" required value={form.facebookAccountName || ''} onChange={(e) => setForm({ ...form, facebookAccountName: e.target.value })} /></div>
                <div className="col-md-3"><label className="form-label">Email</label><input className="form-control" type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <div className="col-md-6"><label className="form-label">Address Line 1</label><input className="form-control" required value={form.addressLine1 || ''} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} /></div>
                <div className="col-md-6"><label className="form-label">Address Line 2</label><input className="form-control" value={form.addressLine2 || ''} onChange={(e) => setForm({ ...form, addressLine2: e.target.value })} /></div>
                <div className="col-md-3">
                  <label className="form-label">Province</label>
                  <select className="form-select" value={form.province || ''} onChange={(e) => setForm({ ...form, province: e.target.value, city: '', barangay: '' })}>
                    {meta.provinces.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </div>
                <div className="col-md-3">
                  <label className="form-label">City</label>
                  <select className="form-select" value={form.city || ''} onChange={(e) => setForm({ ...form, city: e.target.value, barangay: '' })}>
                    {formCities.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </div>
                <div className="col-md-3">
                  <label className="form-label">Barangay</label>
                  <select className="form-select" value={form.barangay || ''} onChange={(e) => setForm({ ...form, barangay: e.target.value })}>
                    {formBarangays.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </div>
                <div className="col-md-3"><label className="form-label">Type</label><select className="form-select" value={form.customerType || 'RESIDENTIAL'} onChange={(e) => setForm({ ...form, customerType: e.target.value })}>{meta.customerTypes.map((item) => <option key={item}>{item}</option>)}</select></div>
                <div className="col-md-3"><label className="form-label">Status</label><select className="form-select" value={form.status || 'ACTIVE'} onChange={(e) => setForm({ ...form, status: e.target.value })}>{meta.customerStatuses.map((item) => <option key={item}>{item}</option>)}</select></div>
                <div className="col-md-3"><label className="form-label">Latitude</label><input className="form-control" value={form.latitude || ''} onChange={(e) => setForm({ ...form, latitude: e.target.value })} /></div>
                <div className="col-md-3"><label className="form-label">Longitude</label><input className="form-control" value={form.longitude || ''} onChange={(e) => setForm({ ...form, longitude: e.target.value })} /></div>
                <div className="col-md-3"><label className="form-label">Secondary Contact</label><input className="form-control" value={form.secondaryContactName || ''} onChange={(e) => setForm({ ...form, secondaryContactName: e.target.value })} /></div>
                <div className="col-md-3"><label className="form-label">Secondary Number</label><input className="form-control" value={form.secondaryContactNumber || ''} onChange={(e) => setForm({ ...form, secondaryContactNumber: e.target.value })} /></div>
                <div className="col-md-3"><label className="form-label">Secondary Facebook</label><input className="form-control" value={form.secondaryContactFacebookAccount || ''} onChange={(e) => setForm({ ...form, secondaryContactFacebookAccount: e.target.value })} /></div>
                <div className="col-md-3"><label className="form-label">Relationship</label><input className="form-control" value={form.secondaryContactRelationship || ''} onChange={(e) => setForm({ ...form, secondaryContactRelationship: e.target.value })} /></div>
                <div className="col-12 text-end">
                  <button type="button" className="btn me-2" onClick={resetForm}>Clear</button>
                  <button type="button" className="btn me-2" onClick={closeCustomerFormModal}>Cancel</button>
                  <button className="btn btn-primary"><IconDeviceFloppy size={18} className="me-2" />Save Customer</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    )}

    {isDetailsPanelOpen && selected && (
      <div className="customer-drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeDetailsPanel()}>
        <aside className="customer-detail-panel" aria-label="Selected customer details">
          <div className="customer-detail-panel-header">
            <div>
              <div className="text-muted small">Selected Customer</div>
              <h3 className="customer-modal-title">{selected.fullName}</h3>
              <div className="text-muted">{selected.accountNumber}</div>
            </div>
            <button type="button" className="btn btn-icon btn-sm" title="Close" onClick={closeDetailsPanel}><IconX size={18} /></button>
          </div>
          <div className="customer-detail-panel-body">
            <div className="customer-detail">
              <div className="d-flex justify-content-between gap-3 mb-3">
                <span className="badge bg-blue-lt text-blue">{selected.customerType}</span>
                <span className={`badge ${statusClass(selected.status)}`}>{selected.status}</span>
              </div>
              <dl className="detail-list">
                <dt>Primary contact</dt><dd>{selected.contactNumber}</dd>
                <dt>Alternate mobile</dt><dd>{selected.alternateMobileNumber || '-'}</dd>
                <dt>Facebook</dt><dd>{selected.facebookAccountName || '-'}</dd>
                <dt>Email</dt><dd>{selected.email || '-'}</dd>
                <dt>Address</dt><dd>{selected.addressLine1}, {selected.barangay}, {selected.city}, {selected.province}</dd>
                <dt>Coordinates</dt><dd>{selected.latitude || '-'}, {selected.longitude || '-'}</dd>
              </dl>
              <div className="border-top pt-3 mt-3">
                <div className="fw-semibold mb-2">Secondary contacts</div>
                {selected.secondaryContacts?.length ? selected.secondaryContacts.map((contact, index) => (
                  <div className="secondary-contact" key={`${contact.name}-${index}`}>
                    <div>{contact.name}</div>
                    <small>{contact.relationship || '-'} | {contact.contactNumber || '-'}</small>
                  </div>
                )) : <div className="text-muted">No secondary contacts.</div>}
              </div>
              <div className="border-top pt-3 mt-3">
                <div className="fw-semibold mb-2">Services</div>
                {services.map((service) => (
                  <div className="service-pill" key={service.id}>
                    <div><strong>{service.planId || 'No plan'}</strong><span>{service.serviceId || 'No service ID'}</span></div>
                    <span className={`badge ${statusClass(service.status)}`}>{service.status}</span>
                  </div>
                ))}
                {!services.length && <div className="text-muted">No services assigned.</div>}
              </div>
            </div>
          </div>
        </aside>
      </div>
    )}
    </>
  );
}
