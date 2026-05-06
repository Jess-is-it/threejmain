import React, { useEffect, useMemo, useState } from 'react';
import {
  IconDeviceFloppy,
  IconEdit,
  IconListDetails,
  IconPackage,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconUsers,
  IconWifi
} from '@tabler/icons-react';
import './service.css';

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

function money(value) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0));
}

function label(value) {
  return String(value || '').replaceAll('_', ' ');
}

function statusClass(value) {
  const normalized = String(value || '').toLowerCase();
  if (['active', 'approved'].includes(normalized)) return 'bg-green-lt text-green';
  if (['requested', 'scheduled', 'installing', 'draft'].includes(normalized)) return 'bg-yellow-lt text-yellow';
  if (['cancelled', 'retired'].includes(normalized)) return 'bg-red-lt text-red';
  if (['on_hold'].includes(normalized)) return 'bg-orange-lt text-orange';
  return 'bg-blue-lt text-blue';
}

function customerLabel(customer) {
  if (!customer) return '-';
  return `${customer.accountNumber || 'NO-ACCOUNT'} - ${customer.name || customer.fullName || 'Unnamed customer'}`;
}

function serviceOrderLabel(order) {
  if (!order) return '-';
  return `${order.serviceReference || order.orderNumber} - ${order.catalogName || order.catalog?.name || 'Service'}`;
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

function TextField({ label: fieldLabel, value, onChange, type = 'text', required = false, min, max, step }) {
  return (
    <div>
      <label className="form-label">{fieldLabel}</label>
      <input className="form-control" type={type} min={min} max={max} step={step} required={required} value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function SelectField({ label: fieldLabel, value, onChange, options = [], required = false, children }) {
  return (
    <div>
      <label className="form-label">{fieldLabel}</label>
      <select className="form-select" required={required} value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
        {children || options.map((option) => <option key={option} value={option}>{label(option)}</option>)}
      </select>
    </div>
  );
}

const blankCatalog = {
  id: '',
  code: '',
  name: '',
  serviceType: 'FIBER_INTERNET',
  segment: 'RESIDENTIAL',
  downloadMbps: '50',
  uploadMbps: '20',
  monthlyRate: '999',
  installFee: '1500',
  billingMode: 'PREPAID',
  status: 'ACTIVE',
  contractMonths: '0',
  equipmentProfile: '',
  description: '',
  notes: ''
};

const blankOrder = {
  id: '',
  customerId: '',
  catalogId: '',
  requestedDate: today(),
  targetActivationDate: '',
  activationDate: '',
  billingStartDate: '',
  installAddress: '',
  status: 'REQUESTED',
  priority: 'NORMAL',
  serviceReference: '',
  notes: ''
};

export default function ServicePage({ initialSection = 'catalog', refreshShell = () => {} }) {
  const [activeView, setActiveView] = useState(initialSection);
  const [meta, setMeta] = useState({ serviceTypes: [], segments: [], catalogStatuses: [], billingModes: [], orderStatuses: [], orderPriorities: [] });
  const [catalogOverview, setCatalogOverview] = useState({ metrics: {}, byType: [], activePlans: [] });
  const [orderOverview, setOrderOverview] = useState({ metrics: {}, byStatus: {}, recentOrders: [] });
  const [catalog, setCatalog] = useState([]);
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [orderSearch, setOrderSearch] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [catalogForm, setCatalogForm] = useState(blankCatalog);
  const [orderForm, setOrderForm] = useState(blankOrder);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const activeCatalog = useMemo(() => catalog.filter((item) => item.status === 'ACTIVE'), [catalog]);

  useEffect(() => { setActiveView(initialSection); }, [initialSection]);

  async function load(nextCatalogSearch = catalogSearch, nextOrderSearch = orderSearch, nextCustomerSearch = customerSearch) {
    setError('');
    try {
      const [nextMeta, nextCatalogOverview, nextOrderOverview, nextCatalog, nextOrders, nextCustomers] = await Promise.all([
        request('/service/meta'),
        request('/service/catalog/overview'),
        request('/service/orders/overview'),
        request(`/service/catalog?search=${encodeURIComponent(nextCatalogSearch)}`),
        request(`/service/orders?search=${encodeURIComponent(nextOrderSearch)}`),
        request(`/service/customers?search=${encodeURIComponent(nextCustomerSearch)}`)
      ]);
      setMeta(nextMeta);
      setCatalogOverview(nextCatalogOverview);
      setOrderOverview(nextOrderOverview);
      setCatalog(nextCatalog);
      setOrders(nextOrders);
      setCustomers(nextCustomers);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  function editCatalog(item) {
    setCatalogForm({
      ...blankCatalog,
      ...item,
      downloadMbps: String(item.downloadMbps || ''),
      uploadMbps: String(item.uploadMbps || ''),
      monthlyRate: String(item.monthlyRate || ''),
      installFee: String(item.installFee || ''),
      contractMonths: String(item.contractMonths || 0)
    });
    setActiveView('catalog');
  }

  function editOrder(order) {
    setOrderForm({
      ...blankOrder,
      ...order,
      catalogId: order.catalogId || order.catalog?.id || '',
      targetActivationDate: order.targetActivationDate || '',
      activationDate: order.activationDate || '',
      billingStartDate: order.billingStartDate || '',
      notes: order.notes || ''
    });
    setActiveView('orders');
  }

  async function saveCatalog(event) {
    event.preventDefault();
    setError('');
    const body = {
      ...catalogForm,
      downloadMbps: Number(catalogForm.downloadMbps || 0),
      uploadMbps: Number(catalogForm.uploadMbps || 0),
      monthlyRate: Number(catalogForm.monthlyRate || 0),
      installFee: Number(catalogForm.installFee || 0),
      contractMonths: Number(catalogForm.contractMonths || 0)
    };
    delete body.id;
    try {
      const path = catalogForm.id ? `/service/catalog/${catalogForm.id}` : '/service/catalog';
      const saved = await request(path, { method: catalogForm.id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      setMessage(`${saved.code} saved.`);
      setCatalogForm(blankCatalog);
      await load();
      refreshShell();
    } catch (err) {
      setError(err.message);
    }
  }

  async function archiveCatalog(item) {
    if (!window.confirm(`Archive ${item.code}?`)) return;
    setError('');
    try {
      await request(`/service/catalog/${item.id}`, { method: 'DELETE' });
      setMessage(`${item.code} archived.`);
      await load();
      refreshShell();
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveOrder(event) {
    event.preventDefault();
    setError('');
    const body = { ...orderForm };
    delete body.id;
    try {
      const path = orderForm.id ? `/service/orders/${orderForm.id}` : '/service/orders';
      const saved = await request(path, { method: orderForm.id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      setMessage(`${saved.orderNumber} saved.`);
      setOrderForm(blankOrder);
      await load();
      refreshShell();
    } catch (err) {
      setError(err.message);
    }
  }

  async function cancelOrder(order) {
    if (!window.confirm(`Cancel ${order.orderNumber}?`)) return;
    setError('');
    try {
      await request(`/service/orders/${order.id}`, { method: 'DELETE' });
      setMessage(`${order.orderNumber} cancelled.`);
      await load();
      refreshShell();
    } catch (err) {
      setError(err.message);
    }
  }

  function setOrderCustomer(customerId) {
    const customer = customers.find((item) => item.id === customerId);
    setOrderForm({
      ...orderForm,
      customerId,
      installAddress: orderForm.installAddress || customer?.address || ''
    });
  }

  function setOrderCatalog(catalogId) {
    const item = catalog.find((row) => row.id === catalogId);
    setOrderForm({
      ...orderForm,
      catalogId,
      billingStartDate: orderForm.billingStartDate || (item?.billingMode === 'PREPAID' ? orderForm.requestedDate : '')
    });
  }

  const metrics = catalogOverview.metrics || orderOverview.metrics || {};

  return (
    <div className="service-page">
      {message && <div className="alert alert-info">{message}</div>}
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="service-metrics">
        {[
          ['Catalog Items', metrics.catalog_items || 0, IconPackage, 'blue'],
          ['Active Plans', metrics.active_catalog || 0, IconWifi, 'green'],
          ['Open Orders', metrics.open_orders || 0, IconListDetails, 'yellow'],
          ['Active Orders', metrics.active_orders || 0, IconUsers, 'cyan'],
          ['Active MRR', money(metrics.monthly_recurring_value || 0), IconWifi, 'orange']
        ].map(([metricLabel, value, Icon, tone]) => (
          <div className="service-metric" key={metricLabel}>
            <span className={`badge bg-${tone}-lt text-${tone}`}><Icon size={18} /></span>
            <div>
              <div className="service-metric-value">{value}</div>
              <div className="text-muted">{metricLabel}</div>
            </div>
          </div>
        ))}
      </div>

      <ul className="nav nav-tabs mb-3">
        <li className="nav-item">
          <button className={`nav-link ${activeView === 'catalog' ? 'active' : ''}`} onClick={() => setActiveView('catalog')}>Service Catalog</button>
        </li>
        <li className="nav-item">
          <button className={`nav-link ${activeView === 'orders' ? 'active' : ''}`} onClick={() => setActiveView('orders')}>Service Order</button>
        </li>
      </ul>

      {activeView === 'catalog' && (
        <div className="row row-cards">
          <div className="col-lg-4">
            <Card title={catalogForm.id ? 'Edit Catalog Item' : 'New Catalog Item'} icon={IconPackage}>
              <form className="service-form" onSubmit={saveCatalog}>
                <div className="service-two-cols">
                  <TextField label="Code" value={catalogForm.code} required onChange={(code) => setCatalogForm({ ...catalogForm, code })} />
                  <SelectField label="Status" value={catalogForm.status} options={meta.catalogStatuses || ['ACTIVE']} onChange={(status) => setCatalogForm({ ...catalogForm, status })} />
                </div>
                <TextField label="Name" value={catalogForm.name} required onChange={(name) => setCatalogForm({ ...catalogForm, name })} />
                <div className="service-two-cols">
                  <SelectField label="Type" value={catalogForm.serviceType} options={meta.serviceTypes || ['FIBER_INTERNET']} onChange={(serviceType) => setCatalogForm({ ...catalogForm, serviceType })} />
                  <SelectField label="Segment" value={catalogForm.segment} options={meta.segments || ['RESIDENTIAL']} onChange={(segment) => setCatalogForm({ ...catalogForm, segment })} />
                </div>
                <div className="service-two-cols">
                  <TextField label="Download Mbps" type="number" min="0" step="1" value={catalogForm.downloadMbps} onChange={(downloadMbps) => setCatalogForm({ ...catalogForm, downloadMbps })} />
                  <TextField label="Upload Mbps" type="number" min="0" step="1" value={catalogForm.uploadMbps} onChange={(uploadMbps) => setCatalogForm({ ...catalogForm, uploadMbps })} />
                </div>
                <div className="service-two-cols">
                  <TextField label="Monthly Rate" type="number" min="0" step="0.01" value={catalogForm.monthlyRate} required onChange={(monthlyRate) => setCatalogForm({ ...catalogForm, monthlyRate })} />
                  <TextField label="Install Fee" type="number" min="0" step="0.01" value={catalogForm.installFee} onChange={(installFee) => setCatalogForm({ ...catalogForm, installFee })} />
                </div>
                <div className="service-two-cols">
                  <SelectField label="Billing Mode" value={catalogForm.billingMode} options={meta.billingModes || ['PREPAID']} onChange={(billingMode) => setCatalogForm({ ...catalogForm, billingMode })} />
                  <TextField label="Contract Months" type="number" min="0" max="120" value={catalogForm.contractMonths} onChange={(contractMonths) => setCatalogForm({ ...catalogForm, contractMonths })} />
                </div>
                <TextField label="Equipment Profile" value={catalogForm.equipmentProfile} onChange={(equipmentProfile) => setCatalogForm({ ...catalogForm, equipmentProfile })} />
                <div>
                  <label className="form-label">Description</label>
                  <textarea className="form-control" rows="2" value={catalogForm.description} onChange={(event) => setCatalogForm({ ...catalogForm, description: event.target.value })} />
                </div>
                <TextField label="Notes" value={catalogForm.notes} onChange={(notes) => setCatalogForm({ ...catalogForm, notes })} />
                <div className="service-form-actions">
                  {catalogForm.id && <button className="btn" type="button" onClick={() => setCatalogForm(blankCatalog)}>Cancel</button>}
                  <button className="btn btn-primary"><IconDeviceFloppy size={16} className="me-1" />Save</button>
                </div>
              </form>
            </Card>
          </div>
          <div className="col-lg-8">
            <Card
              title="Service Catalog"
              icon={IconPackage}
              actions={
                <div className="service-search">
                  <div className="input-icon">
                    <span className="input-icon-addon"><IconSearch size={16} /></span>
                    <input className="form-control form-control-sm" placeholder="Search catalog" value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && load(catalogSearch)} />
                  </div>
                  <button className="btn btn-sm" onClick={() => load(catalogSearch)}><IconRefresh size={15} /></button>
                </div>
              }
            >
              <CatalogTable rows={catalog} onEdit={editCatalog} onArchive={archiveCatalog} />
            </Card>
          </div>
        </div>
      )}

      {activeView === 'orders' && (
        <div className="row row-cards">
          <div className="col-lg-4">
            <Card title={orderForm.id ? 'Edit Service Order' : 'New Service Order'} icon={IconListDetails}>
              <form className="service-form" onSubmit={saveOrder}>
                <div className="input-group">
                  <input className="form-control" placeholder="Search Customer Profiling records" value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} />
                  <button className="btn btn-outline-secondary" type="button" onClick={() => load(catalogSearch, orderSearch, customerSearch)}><IconSearch size={16} /></button>
                </div>
                <SelectField label="Customer" value={orderForm.customerId} required onChange={setOrderCustomer}>
                  <option value="">Select customer</option>
                  {customers.map((customer) => <option key={customer.id} value={customer.id}>{customerLabel(customer)}</option>)}
                </SelectField>
                <SelectField label="Catalog Item" value={orderForm.catalogId} required onChange={setOrderCatalog}>
                  <option value="">Select service</option>
                  {activeCatalog.map((item) => <option key={item.id} value={item.id}>{item.code} - {item.name} - {money(item.monthlyRate)}</option>)}
                </SelectField>
                <div className="service-two-cols">
                  <TextField label="Requested Date" type="date" value={orderForm.requestedDate} required onChange={(requestedDate) => setOrderForm({ ...orderForm, requestedDate })} />
                  <TextField label="Target Activation" type="date" value={orderForm.targetActivationDate} onChange={(targetActivationDate) => setOrderForm({ ...orderForm, targetActivationDate })} />
                </div>
                <div className="service-two-cols">
                  <TextField label="Activation Date" type="date" value={orderForm.activationDate} onChange={(activationDate) => setOrderForm({ ...orderForm, activationDate })} />
                  <TextField label="Billing Start" type="date" value={orderForm.billingStartDate} onChange={(billingStartDate) => setOrderForm({ ...orderForm, billingStartDate })} />
                </div>
                <div className="service-two-cols">
                  <SelectField label="Status" value={orderForm.status} options={meta.orderStatuses || ['REQUESTED']} onChange={(status) => setOrderForm({ ...orderForm, status })} />
                  <SelectField label="Priority" value={orderForm.priority} options={meta.orderPriorities || ['NORMAL']} onChange={(priority) => setOrderForm({ ...orderForm, priority })} />
                </div>
                <TextField label="Service Reference" value={orderForm.serviceReference} onChange={(serviceReference) => setOrderForm({ ...orderForm, serviceReference })} />
                <TextField label="Install Address" value={orderForm.installAddress} onChange={(installAddress) => setOrderForm({ ...orderForm, installAddress })} />
                <TextField label="Notes" value={orderForm.notes} onChange={(notes) => setOrderForm({ ...orderForm, notes })} />
                <div className="service-form-actions">
                  {orderForm.id && <button className="btn" type="button" onClick={() => setOrderForm(blankOrder)}>Cancel</button>}
                  <button className="btn btn-primary"><IconPlus size={16} className="me-1" />Save</button>
                </div>
              </form>
            </Card>
          </div>
          <div className="col-lg-8">
            <Card
              title="Service Orders"
              icon={IconListDetails}
              actions={
                <div className="service-search">
                  <div className="input-icon">
                    <span className="input-icon-addon"><IconSearch size={16} /></span>
                    <input className="form-control form-control-sm" placeholder="Search orders" value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && load(catalogSearch, orderSearch)} />
                  </div>
                  <button className="btn btn-sm" onClick={() => load(catalogSearch, orderSearch)}><IconRefresh size={15} /></button>
                </div>
              }
            >
              <OrderTable rows={orders} onEdit={editOrder} onCancel={cancelOrder} />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function Empty() {
  return <div className="empty">No records yet.</div>;
}

function CatalogTable({ rows, onEdit, onArchive }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-responsive">
      <table className="table card-table table-vcenter service-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Plan</th>
            <th>Speed</th>
            <th>Rate</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td><span className="fw-semibold">{row.code}</span></td>
              <td>
                <div className="fw-semibold">{row.name}</div>
                <div className="text-muted small">{label(row.serviceType)} / {label(row.segment)}</div>
              </td>
              <td>{Number(row.downloadMbps || 0)} / {Number(row.uploadMbps || 0)} Mbps</td>
              <td>{money(row.monthlyRate)}</td>
              <td><span className={`badge ${statusClass(row.status)}`}>{label(row.status)}</span></td>
              <td className="text-end">
                <button className="btn btn-sm me-1" onClick={() => onEdit(row)}><IconEdit size={14} /></button>
                <button className="btn btn-sm btn-outline-danger" onClick={() => onArchive(row)}><IconTrash size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrderTable({ rows, onEdit, onCancel }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-responsive">
      <table className="table card-table table-vcenter service-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Service</th>
            <th>Reference</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <div className="fw-semibold">{row.orderNumber}</div>
                <div className="text-muted small">{row.requestedDate}</div>
              </td>
              <td>{customerLabel(row.customer)}</td>
              <td>
                <div className="fw-semibold">{row.catalogName || row.catalog?.name}</div>
                <div className="text-muted small">{row.catalogCode || row.catalog?.code}</div>
              </td>
              <td>{row.serviceReference}</td>
              <td><span className={`badge ${statusClass(row.status)}`}>{label(row.status)}</span></td>
              <td className="text-end">
                <button className="btn btn-sm me-1" onClick={() => onEdit(row)}><IconEdit size={14} /></button>
                <button className="btn btn-sm btn-outline-danger" onClick={() => onCancel(row)}><IconTrash size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { serviceOrderLabel };
