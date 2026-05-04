import React, { useEffect, useMemo, useState } from 'react';
import {
  IconBuildingStore,
  IconCash,
  IconCreditCard,
  IconDeviceFloppy,
  IconEdit,
  IconPackage,
  IconPlus,
  IconReceipt,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconUsers
} from '@tabler/icons-react';
import './pointOfSale.css';

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

function currency(value) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0));
}

function statusClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (['active', 'open', 'completed', 'paid', 'posted'].includes(normalized)) return 'bg-green-lt text-green';
  if (['partially_paid', 'unpaid'].includes(normalized)) return 'bg-yellow-lt text-yellow';
  if (['closed', 'inactive'].includes(normalized)) return 'bg-blue-lt text-blue';
  if (['void', 'archived', 'cancelled'].includes(normalized)) return 'bg-red-lt text-red';
  return 'bg-secondary-lt text-secondary';
}

function customerLabel(customer) {
  if (!customer) return 'Walk-in';
  return `${customer.accountNumber || 'NO-ACCOUNT'} - ${customer.name || 'Unnamed customer'}`;
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

function TextField({ label, value, onChange, type = 'text', required = false, min, max, step }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <input className="form-control" type={type} value={value ?? ''} min={min} max={max} step={step} required={required} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function SelectField({ label, value, onChange, options = [], required = false, children }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <select className="form-select" value={value ?? ''} required={required} onChange={(e) => onChange(e.target.value)}>
        {children || options.map((option) => <option key={option} value={option}>{option.replaceAll('_', ' ')}</option>)}
      </select>
    </div>
  );
}

const blankItem = {
  id: '',
  sku: '',
  name: '',
  category: 'Network Equipment',
  unitPrice: '',
  stockOnHand: '',
  reorderPoint: '0',
  taxable: false,
  status: 'ACTIVE',
  notes: ''
};

const blankSession = {
  id: '',
  cashierName: 'Admin Cashier',
  registerName: 'Main Counter',
  openingFloat: '1000',
  openedAt: today(),
  closingCash: '',
  status: 'OPEN',
  notes: ''
};

const blankSaleLine = {
  itemId: '',
  description: '',
  quantity: '1',
  unitPrice: '',
  discountAmount: '0'
};

const blankSale = {
  id: '',
  sessionId: '',
  customerId: '',
  saleDate: today(),
  lineItems: [blankSaleLine],
  discountAmount: '0',
  taxAmount: '0',
  status: 'COMPLETED',
  paymentAmount: '',
  paymentMethod: 'CASH',
  paymentReference: '',
  notes: ''
};

const blankPayment = {
  id: '',
  saleId: '',
  amount: '',
  method: 'CASH',
  paymentDate: today(),
  referenceNumber: '',
  status: 'POSTED',
  notes: ''
};

export default function PointOfSalePage({ refreshShell = () => {} }) {
  const [activeTab, setActiveTab] = useState('Overview');
  const [meta, setMeta] = useState({ itemStatuses: [], sessionStatuses: [], saleStatuses: [], paymentMethods: [], paymentStatuses: [], dependencies: [] });
  const [overview, setOverview] = useState({ metrics: {}, dependencies: [], recentSales: [], lowStock: [], openSessions: [] });
  const [items, setItems] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [sales, setSales] = useState([]);
  const [payments, setPayments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [itemForm, setItemForm] = useState(blankItem);
  const [sessionForm, setSessionForm] = useState(blankSession);
  const [saleForm, setSaleForm] = useState(blankSale);
  const [paymentForm, setPaymentForm] = useState(blankPayment);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const openSessions = useMemo(() => sessions.filter((session) => session.status === 'OPEN'), [sessions]);

  async function load(search = customerSearch, itemTerm = itemSearch) {
    setError('');
    try {
      const [nextMeta, nextOverview, nextCustomers, nextItems, nextSessions, nextSales, nextPayments] = await Promise.all([
        request('/point-of-sale/meta'),
        request('/point-of-sale/overview'),
        request(`/point-of-sale/customers?search=${encodeURIComponent(search)}`),
        request(`/point-of-sale/items?search=${encodeURIComponent(itemTerm)}`),
        request('/point-of-sale/sessions'),
        request('/point-of-sale/sales'),
        request('/point-of-sale/payments')
      ]);
      setMeta(nextMeta);
      setOverview(nextOverview);
      setCustomers(nextCustomers);
      setItems(nextItems);
      setSessions(nextSessions);
      setSales(nextSales);
      setPayments(nextPayments);
      if (!saleForm.sessionId && nextSessions.some((session) => session.status === 'OPEN')) {
        setSaleForm((form) => ({ ...form, sessionId: nextSessions.find((session) => session.status === 'OPEN')?.id || '' }));
      }
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  function customerOptions() {
    return (
      <>
        <option value="">Walk-in customer</option>
        {customers.map((customer) => <option key={customer.id} value={customer.id}>{customerLabel(customer)}</option>)}
      </>
    );
  }

  function sessionOptions() {
    return (
      <>
        <option value="">Select open session</option>
        {openSessions.map((session) => <option key={session.id} value={session.id}>{session.sessionNumber} - {session.cashierName}</option>)}
      </>
    );
  }

  function itemOptions() {
    return (
      <>
        <option value="">Manual line</option>
        {items.filter((item) => item.status === 'ACTIVE').map((item) => (
          <option key={item.id} value={item.id}>{item.sku} - {item.name} ({currency(item.unitPrice)})</option>
        ))}
      </>
    );
  }

  function saleOptions() {
    return (
      <>
        <option value="">Select sale</option>
        {sales.filter((sale) => sale.status !== 'VOID').map((sale) => (
          <option key={sale.id} value={sale.id}>{sale.receiptNumber} - {currency(sale.balance)} balance</option>
        ))}
      </>
    );
  }

  function resetItem() {
    setItemForm(blankItem);
  }

  function resetSession() {
    setSessionForm(blankSession);
  }

  function resetSale() {
    setSaleForm({ ...blankSale, sessionId: openSessions[0]?.id || '' });
  }

  function resetPayment() {
    setPaymentForm(blankPayment);
  }

  async function saveItem(e) {
    e.preventDefault();
    const payload = {
      sku: itemForm.sku,
      name: itemForm.name,
      category: itemForm.category,
      unitPrice: Number(itemForm.unitPrice || 0),
      stockOnHand: Number(itemForm.stockOnHand || 0),
      reorderPoint: Number(itemForm.reorderPoint || 0),
      taxable: Boolean(itemForm.taxable),
      status: itemForm.status,
      notes: itemForm.notes
    };
    await request(itemForm.id ? `/point-of-sale/items/${itemForm.id}` : '/point-of-sale/items', {
      method: itemForm.id ? 'PATCH' : 'POST',
      body: JSON.stringify(payload)
    });
    setMessage(itemForm.id ? 'Item saved.' : 'Item created.');
    resetItem();
    await load();
    refreshShell();
  }

  async function archiveItem(item) {
    await request(`/point-of-sale/items/${item.id}`, { method: 'DELETE' });
    setMessage('Item archived.');
    await load();
    refreshShell();
  }

  async function saveSession(e) {
    e.preventDefault();
    const payload = {
      cashierName: sessionForm.cashierName,
      registerName: sessionForm.registerName,
      openingFloat: Number(sessionForm.openingFloat || 0),
      openedAt: sessionForm.openedAt,
      closingCash: Number(sessionForm.closingCash || 0),
      status: sessionForm.status,
      notes: sessionForm.notes
    };
    await request(sessionForm.id ? `/point-of-sale/sessions/${sessionForm.id}` : '/point-of-sale/sessions', {
      method: sessionForm.id ? 'PATCH' : 'POST',
      body: JSON.stringify(payload)
    });
    setMessage(sessionForm.id ? 'Session saved.' : 'Session opened.');
    resetSession();
    await load();
    refreshShell();
  }

  async function closeSession(session) {
    const closingCash = window.prompt('Closing cash', String(session.cashExpected || session.openingFloat || 0));
    if (closingCash === null) return;
    await request(`/point-of-sale/sessions/${session.id}/close`, {
      method: 'POST',
      body: JSON.stringify({ closingCash: Number(closingCash || 0), notes: session.notes || '' })
    });
    setMessage('Session closed.');
    await load();
    refreshShell();
  }

  async function cancelSession(session) {
    await request(`/point-of-sale/sessions/${session.id}`, { method: 'DELETE' });
    setMessage('Session cancelled.');
    await load();
    refreshShell();
  }

  function setSaleLine(index, patch) {
    setSaleForm((form) => {
      const lineItems = form.lineItems.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line));
      return { ...form, lineItems };
    });
  }

  function chooseSaleItem(index, itemId) {
    const item = itemById.get(itemId);
    setSaleLine(index, {
      itemId,
      description: item?.name || '',
      unitPrice: item?.unitPrice ?? ''
    });
  }

  function addSaleLine() {
    setSaleForm((form) => ({ ...form, lineItems: [...form.lineItems, blankSaleLine] }));
  }

  function removeSaleLine(index) {
    setSaleForm((form) => {
      const lineItems = form.lineItems.filter((_, lineIndex) => lineIndex !== index);
      return { ...form, lineItems: lineItems.length ? lineItems : [blankSaleLine] };
    });
  }

  function salePayload() {
    return {
      sessionId: saleForm.sessionId,
      customerId: saleForm.customerId || null,
      saleDate: saleForm.saleDate,
      lineItems: saleForm.lineItems.map((line) => ({
        itemId: line.itemId || null,
        description: line.description,
        quantity: Number(line.quantity || 0),
        unitPrice: Number(line.unitPrice || 0),
        discountAmount: Number(line.discountAmount || 0)
      })),
      discountAmount: Number(saleForm.discountAmount || 0),
      taxAmount: Number(saleForm.taxAmount || 0),
      status: saleForm.status,
      notes: saleForm.notes,
      payments: Number(saleForm.paymentAmount || 0) > 0 ? [{
        amount: Number(saleForm.paymentAmount || 0),
        method: saleForm.paymentMethod,
        paymentDate: saleForm.saleDate,
        referenceNumber: saleForm.paymentReference,
        status: 'POSTED'
      }] : []
    };
  }

  async function saveSale(e) {
    e.preventDefault();
    await request(saleForm.id ? `/point-of-sale/sales/${saleForm.id}` : '/point-of-sale/sales', {
      method: saleForm.id ? 'PATCH' : 'POST',
      body: JSON.stringify(salePayload())
    });
    setMessage(saleForm.id ? 'Sale saved.' : 'Sale posted.');
    resetSale();
    await load();
    refreshShell();
  }

  async function voidSale(sale) {
    await request(`/point-of-sale/sales/${sale.id}`, { method: 'DELETE' });
    setMessage('Sale voided.');
    await load();
    refreshShell();
  }

  async function savePayment(e) {
    e.preventDefault();
    const payload = {
      saleId: paymentForm.saleId,
      amount: Number(paymentForm.amount || 0),
      method: paymentForm.method,
      paymentDate: paymentForm.paymentDate,
      referenceNumber: paymentForm.referenceNumber,
      status: paymentForm.status,
      notes: paymentForm.notes
    };
    await request(paymentForm.id ? `/point-of-sale/payments/${paymentForm.id}` : '/point-of-sale/payments', {
      method: paymentForm.id ? 'PATCH' : 'POST',
      body: JSON.stringify(payload)
    });
    setMessage(paymentForm.id ? 'Payment saved.' : 'Payment posted.');
    resetPayment();
    await load();
    refreshShell();
  }

  async function voidPayment(payment) {
    await request(`/point-of-sale/payments/${payment.id}`, { method: 'DELETE' });
    setMessage('Payment voided.');
    await load();
    refreshShell();
  }

  function editSale(sale) {
    setSaleForm({
      id: sale.id,
      sessionId: sale.sessionId || '',
      customerId: sale.customerId || '',
      saleDate: sale.saleDate || today(),
      lineItems: sale.lineItems?.length ? sale.lineItems.map((line) => ({
        itemId: line.itemId || '',
        description: line.description || '',
        quantity: String(line.quantity || 1),
        unitPrice: String(line.unitPrice || 0),
        discountAmount: String(line.discountAmount || 0)
      })) : [blankSaleLine],
      discountAmount: String(sale.discountAmount || 0),
      taxAmount: String(sale.taxAmount || 0),
      status: sale.status || 'COMPLETED',
      paymentAmount: '',
      paymentMethod: 'CASH',
      paymentReference: '',
      notes: sale.notes || ''
    });
    setActiveTab('Sales');
  }

  const metrics = overview.metrics || {};

  return (
    <div className="pos-page">
      {message && <div className="alert alert-info">{message}</div>}
      {error && <div className="alert alert-danger">{error}</div>}

      <ul className="nav nav-tabs mb-3">
        {['Overview', 'Items', 'Sessions', 'Sales', 'Payments'].map((tab) => (
          <li className="nav-item" key={tab}>
            <button className={`nav-link ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>{tab}</button>
          </li>
        ))}
      </ul>

      {activeTab === 'Overview' && (
        <div className="row row-cards">
          {[
            ['Today Sales', currency(metrics.today_sales), IconCash, 'green'],
            ['Transactions', metrics.transactions || 0, IconReceipt, 'blue'],
            ['Open Shifts', metrics.open_shift || 0, IconBuildingStore, 'yellow'],
            ['Low Stock', metrics.low_stock || 0, IconPackage, 'red']
          ].map(([label, value, Icon, tone]) => (
            <div className="col-sm-6 col-lg-3" key={label}>
              <div className="card status-card">
                <div className="card-body">
                  <span className={`badge bg-${tone}-lt text-${tone} mb-3`}><Icon size={18} /></span>
                  <div className="h1 mb-0">{value}</div>
                  <div className="text-muted">{label}</div>
                </div>
              </div>
            </div>
          ))}
          <div className="col-lg-7">
            <Card title="Recent Sales" icon={IconReceipt} actions={<button className="btn btn-sm" onClick={() => load()}><IconRefresh size={16} className="me-1" />Refresh</button>}>
              <div className="table-responsive">
                <table className="table card-table table-vcenter">
                  <thead><tr><th>Receipt</th><th>Customer</th><th>Total</th><th>Paid</th><th>Status</th></tr></thead>
                  <tbody>
                    {overview.recentSales?.map((sale) => (
                      <tr key={sale.id}>
                        <td>{sale.receiptNumber}</td>
                        <td>{customerLabel(sale.customer)}</td>
                        <td>{currency(sale.total)}</td>
                        <td>{currency(sale.paidTotal)}</td>
                        <td><span className={`badge ${statusClass(sale.paymentStatus)}`}>{sale.paymentStatus?.replaceAll('_', ' ')}</span></td>
                      </tr>
                    ))}
                    {!overview.recentSales?.length && <tr><td colSpan="5" className="text-muted">No records yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
          <div className="col-lg-5">
            <Card title="Prerequisites" icon={IconUsers}>
              <div className="pos-dependency-list">
                {(overview.dependencies || meta.dependencies || []).map((dependency) => (
                  <div className="pos-dependency" key={dependency.module}>
                    <div className="d-flex justify-content-between gap-3">
                      <strong>{dependency.module}</strong>
                      <span className={`badge ${dependency.status === 'placeholder' ? 'bg-yellow-lt text-yellow' : 'bg-blue-lt text-blue'}`}>{dependency.status}</span>
                    </div>
                    <div className="text-muted">{dependency.note}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
          <div className="col-lg-6">
            <Card title="Open Sessions" icon={IconBuildingStore}>
              <div className="table-responsive">
                <table className="table card-table table-vcenter">
                  <thead><tr><th>Session</th><th>Cashier</th><th>Gross</th><th>Expected Cash</th></tr></thead>
                  <tbody>
                    {overview.openSessions?.map((session) => (
                      <tr key={session.id}><td>{session.sessionNumber}</td><td>{session.cashierName}</td><td>{currency(session.grossSales)}</td><td>{currency(session.cashExpected)}</td></tr>
                    ))}
                    {!overview.openSessions?.length && <tr><td colSpan="4" className="text-muted">No records yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
          <div className="col-lg-6">
            <Card title="Low Stock" icon={IconPackage}>
              <div className="table-responsive">
                <table className="table card-table table-vcenter">
                  <thead><tr><th>SKU</th><th>Item</th><th>On Hand</th><th>Reorder</th></tr></thead>
                  <tbody>
                    {overview.lowStock?.map((item) => (
                      <tr key={item.id}><td>{item.sku}</td><td>{item.name}</td><td>{item.stockOnHand}</td><td>{item.reorderPoint}</td></tr>
                    ))}
                    {!overview.lowStock?.length && <tr><td colSpan="4" className="text-muted">No records yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Items' && (
        <div className="row row-cards">
          <div className="col-lg-4">
            <Card title={itemForm.id ? 'Edit Item' : 'New Item'} icon={IconPackage}>
              <form onSubmit={saveItem}>
                <div className="row g-3">
                  <div className="col-md-6 col-lg-12"><TextField label="SKU" value={itemForm.sku} required onChange={(value) => setItemForm({ ...itemForm, sku: value })} /></div>
                  <div className="col-md-6 col-lg-12"><TextField label="Name" value={itemForm.name} required onChange={(value) => setItemForm({ ...itemForm, name: value })} /></div>
                  <div className="col-md-6 col-lg-12"><TextField label="Category" value={itemForm.category} onChange={(value) => setItemForm({ ...itemForm, category: value })} /></div>
                  <div className="col-6"><TextField label="Unit Price" type="number" min="0" step="0.01" value={itemForm.unitPrice} required onChange={(value) => setItemForm({ ...itemForm, unitPrice: value })} /></div>
                  <div className="col-6"><TextField label="Stock" type="number" min="0" step="0.01" value={itemForm.stockOnHand} onChange={(value) => setItemForm({ ...itemForm, stockOnHand: value })} /></div>
                  <div className="col-6"><TextField label="Reorder Point" type="number" min="0" step="0.01" value={itemForm.reorderPoint} onChange={(value) => setItemForm({ ...itemForm, reorderPoint: value })} /></div>
                  <div className="col-6"><SelectField label="Status" value={itemForm.status} options={meta.itemStatuses} onChange={(value) => setItemForm({ ...itemForm, status: value })} /></div>
                  <div className="col-12">
                    <label className="form-check">
                      <input className="form-check-input" type="checkbox" checked={itemForm.taxable} onChange={(e) => setItemForm({ ...itemForm, taxable: e.target.checked })} />
                      <span className="form-check-label">Taxable</span>
                    </label>
                  </div>
                  <div className="col-12"><TextField label="Notes" value={itemForm.notes} onChange={(value) => setItemForm({ ...itemForm, notes: value })} /></div>
                  <div className="col-12 d-flex justify-content-end gap-2">
                    {itemForm.id && <button type="button" className="btn" onClick={resetItem}>Cancel</button>}
                    <button className="btn btn-primary"><IconDeviceFloppy size={18} className="me-2" />Save Item</button>
                  </div>
                </div>
              </form>
            </Card>
          </div>
          <div className="col-lg-8">
            <Card title="Item Catalog" icon={IconPackage} actions={
              <form className="d-flex gap-2" onSubmit={(e) => { e.preventDefault(); load(customerSearch, itemSearch); }}>
                <input className="form-control form-control-sm" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Search items" />
                <button className="btn btn-sm"><IconSearch size={16} /></button>
              </form>
            }>
              <div className="table-responsive">
                <table className="table card-table table-vcenter">
                  <thead><tr><th>SKU</th><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.sku}</td><td>{item.name}</td><td>{item.category}</td><td>{currency(item.unitPrice)}</td><td>{item.stockOnHand}</td>
                        <td><span className={`badge ${statusClass(item.status)}`}>{item.status}</span></td>
                        <td className="text-end">
                          <button className="btn btn-icon btn-sm me-1" onClick={() => setItemForm({ ...item, unitPrice: String(item.unitPrice), stockOnHand: String(item.stockOnHand), reorderPoint: String(item.reorderPoint) })}><IconEdit size={16} /></button>
                          <button className="btn btn-icon btn-sm text-danger" onClick={() => archiveItem(item)}><IconTrash size={16} /></button>
                        </td>
                      </tr>
                    ))}
                    {!items.length && <tr><td colSpan="7" className="text-muted">No records yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Sessions' && (
        <div className="row row-cards">
          <div className="col-lg-4">
            <Card title={sessionForm.id ? 'Edit Session' : 'New Session'} icon={IconBuildingStore}>
              <form onSubmit={saveSession}>
                <div className="row g-3">
                  <div className="col-12"><TextField label="Cashier" value={sessionForm.cashierName} required onChange={(value) => setSessionForm({ ...sessionForm, cashierName: value })} /></div>
                  <div className="col-12"><TextField label="Register" value={sessionForm.registerName} required onChange={(value) => setSessionForm({ ...sessionForm, registerName: value })} /></div>
                  <div className="col-6"><TextField label="Opening Float" type="number" min="0" step="0.01" value={sessionForm.openingFloat} onChange={(value) => setSessionForm({ ...sessionForm, openingFloat: value })} /></div>
                  <div className="col-6"><TextField label="Opened At" type="date" value={sessionForm.openedAt} onChange={(value) => setSessionForm({ ...sessionForm, openedAt: value })} /></div>
                  <div className="col-6"><TextField label="Closing Cash" type="number" min="0" step="0.01" value={sessionForm.closingCash} onChange={(value) => setSessionForm({ ...sessionForm, closingCash: value })} /></div>
                  <div className="col-6"><SelectField label="Status" value={sessionForm.status} options={meta.sessionStatuses} onChange={(value) => setSessionForm({ ...sessionForm, status: value })} /></div>
                  <div className="col-12"><TextField label="Notes" value={sessionForm.notes} onChange={(value) => setSessionForm({ ...sessionForm, notes: value })} /></div>
                  <div className="col-12 d-flex justify-content-end gap-2">
                    {sessionForm.id && <button type="button" className="btn" onClick={resetSession}>Cancel</button>}
                    <button className="btn btn-primary"><IconDeviceFloppy size={18} className="me-2" />Save Session</button>
                  </div>
                </div>
              </form>
            </Card>
          </div>
          <div className="col-lg-8">
            <Card title="Cashier Sessions" icon={IconBuildingStore}>
              <div className="table-responsive">
                <table className="table card-table table-vcenter">
                  <thead><tr><th>Session</th><th>Cashier</th><th>Gross</th><th>Expected Cash</th><th>Variance</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {sessions.map((session) => (
                      <tr key={session.id}>
                        <td>{session.sessionNumber}</td><td>{session.cashierName}</td><td>{currency(session.grossSales)}</td><td>{currency(session.cashExpected)}</td><td>{currency(session.variance)}</td>
                        <td><span className={`badge ${statusClass(session.status)}`}>{session.status}</span></td>
                        <td className="text-end">
                          {session.status === 'OPEN' && <button className="btn btn-sm me-1" onClick={() => closeSession(session)}>Close</button>}
                          <button className="btn btn-icon btn-sm me-1" onClick={() => setSessionForm({ ...session, openingFloat: String(session.openingFloat), closingCash: String(session.closingCash || '') })}><IconEdit size={16} /></button>
                          <button className="btn btn-icon btn-sm text-danger" onClick={() => cancelSession(session)}><IconTrash size={16} /></button>
                        </td>
                      </tr>
                    ))}
                    {!sessions.length && <tr><td colSpan="7" className="text-muted">No records yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Sales' && (
        <div className="row row-cards">
          <div className="col-lg-5">
            <Card title={saleForm.id ? 'Edit Sale' : 'New Sale'} icon={IconReceipt}>
              <form onSubmit={saveSale}>
                <div className="row g-3">
                  <div className="col-md-6"><SelectField label="Session" value={saleForm.sessionId} required onChange={(value) => setSaleForm({ ...saleForm, sessionId: value })}>{sessionOptions()}</SelectField></div>
                  <div className="col-md-6"><TextField label="Sale Date" type="date" value={saleForm.saleDate} onChange={(value) => setSaleForm({ ...saleForm, saleDate: value })} /></div>
                  <div className="col-12">
                    <div className="d-flex gap-2">
                      <select className="form-select" value={saleForm.customerId} onChange={(e) => setSaleForm({ ...saleForm, customerId: e.target.value })}>{customerOptions()}</select>
                      <input className="form-control" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="Search customers" />
                      <button type="button" className="btn" onClick={() => load(customerSearch, itemSearch)}><IconSearch size={16} /></button>
                    </div>
                  </div>
                  <div className="col-12">
                    <div className="pos-line-stack">
                      {saleForm.lineItems.map((line, index) => (
                        <div className="pos-line" key={index}>
                          <select className="form-select" value={line.itemId} onChange={(e) => chooseSaleItem(index, e.target.value)}>{itemOptions()}</select>
                          <input className="form-control" value={line.description} placeholder="Description" onChange={(e) => setSaleLine(index, { description: e.target.value })} required />
                          <input className="form-control pos-qty" type="number" min="0.01" step="0.01" value={line.quantity} onChange={(e) => setSaleLine(index, { quantity: e.target.value })} required />
                          <input className="form-control pos-price" type="number" min="0" step="0.01" value={line.unitPrice} onChange={(e) => setSaleLine(index, { unitPrice: e.target.value })} required />
                          <input className="form-control pos-price" type="number" min="0" step="0.01" value={line.discountAmount} onChange={(e) => setSaleLine(index, { discountAmount: e.target.value })} />
                          <button type="button" className="btn btn-icon" onClick={() => removeSaleLine(index)}><IconTrash size={16} /></button>
                        </div>
                      ))}
                    </div>
                    <button type="button" className="btn btn-sm mt-2" onClick={addSaleLine}><IconPlus size={16} className="me-1" />Add Line</button>
                  </div>
                  <div className="col-4"><TextField label="Discount" type="number" min="0" step="0.01" value={saleForm.discountAmount} onChange={(value) => setSaleForm({ ...saleForm, discountAmount: value })} /></div>
                  <div className="col-4"><TextField label="Tax" type="number" min="0" step="0.01" value={saleForm.taxAmount} onChange={(value) => setSaleForm({ ...saleForm, taxAmount: value })} /></div>
                  <div className="col-4"><SelectField label="Status" value={saleForm.status} options={meta.saleStatuses} onChange={(value) => setSaleForm({ ...saleForm, status: value })} /></div>
                  {!saleForm.id && (
                    <>
                      <div className="col-md-4"><TextField label="Payment" type="number" min="0" step="0.01" value={saleForm.paymentAmount} onChange={(value) => setSaleForm({ ...saleForm, paymentAmount: value })} /></div>
                      <div className="col-md-4"><SelectField label="Method" value={saleForm.paymentMethod} options={meta.paymentMethods} onChange={(value) => setSaleForm({ ...saleForm, paymentMethod: value })} /></div>
                      <div className="col-md-4"><TextField label="Reference" value={saleForm.paymentReference} onChange={(value) => setSaleForm({ ...saleForm, paymentReference: value })} /></div>
                    </>
                  )}
                  <div className="col-12"><TextField label="Notes" value={saleForm.notes} onChange={(value) => setSaleForm({ ...saleForm, notes: value })} /></div>
                  <div className="col-12 d-flex justify-content-end gap-2">
                    {saleForm.id && <button type="button" className="btn" onClick={resetSale}>Cancel</button>}
                    <button className="btn btn-primary"><IconReceipt size={18} className="me-2" />Save Sale</button>
                  </div>
                </div>
              </form>
            </Card>
          </div>
          <div className="col-lg-7">
            <Card title="Sales" icon={IconReceipt}>
              <div className="table-responsive">
                <table className="table card-table table-vcenter">
                  <thead><tr><th>Receipt</th><th>Customer</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {sales.map((sale) => (
                      <tr key={sale.id}>
                        <td>{sale.receiptNumber}</td><td>{customerLabel(sale.customer)}</td><td>{currency(sale.total)}</td><td>{currency(sale.paidTotal)}</td><td>{currency(sale.balance)}</td>
                        <td><span className={`badge ${statusClass(sale.paymentStatus)}`}>{sale.paymentStatus?.replaceAll('_', ' ')}</span></td>
                        <td className="text-end">
                          <button className="btn btn-icon btn-sm me-1" onClick={() => editSale(sale)}><IconEdit size={16} /></button>
                          <button className="btn btn-icon btn-sm text-danger" onClick={() => voidSale(sale)}><IconTrash size={16} /></button>
                        </td>
                      </tr>
                    ))}
                    {!sales.length && <tr><td colSpan="7" className="text-muted">No records yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Payments' && (
        <div className="row row-cards">
          <div className="col-lg-4">
            <Card title={paymentForm.id ? 'Edit Payment' : 'New Payment'} icon={IconCreditCard}>
              <form onSubmit={savePayment}>
                <div className="row g-3">
                  <div className="col-12"><SelectField label="Sale" value={paymentForm.saleId} required onChange={(value) => setPaymentForm({ ...paymentForm, saleId: value })}>{saleOptions()}</SelectField></div>
                  <div className="col-6"><TextField label="Amount" type="number" min="0.01" step="0.01" value={paymentForm.amount} required onChange={(value) => setPaymentForm({ ...paymentForm, amount: value })} /></div>
                  <div className="col-6"><SelectField label="Method" value={paymentForm.method} options={meta.paymentMethods} onChange={(value) => setPaymentForm({ ...paymentForm, method: value })} /></div>
                  <div className="col-6"><TextField label="Date" type="date" value={paymentForm.paymentDate} onChange={(value) => setPaymentForm({ ...paymentForm, paymentDate: value })} /></div>
                  <div className="col-6"><SelectField label="Status" value={paymentForm.status} options={meta.paymentStatuses} onChange={(value) => setPaymentForm({ ...paymentForm, status: value })} /></div>
                  <div className="col-12"><TextField label="Reference" value={paymentForm.referenceNumber} onChange={(value) => setPaymentForm({ ...paymentForm, referenceNumber: value })} /></div>
                  <div className="col-12"><TextField label="Notes" value={paymentForm.notes} onChange={(value) => setPaymentForm({ ...paymentForm, notes: value })} /></div>
                  <div className="col-12 d-flex justify-content-end gap-2">
                    {paymentForm.id && <button type="button" className="btn" onClick={resetPayment}>Cancel</button>}
                    <button className="btn btn-primary"><IconDeviceFloppy size={18} className="me-2" />Save Payment</button>
                  </div>
                </div>
              </form>
            </Card>
          </div>
          <div className="col-lg-8">
            <Card title="Payments" icon={IconCreditCard}>
              <div className="table-responsive">
                <table className="table card-table table-vcenter">
                  <thead><tr><th>Payment</th><th>Sale</th><th>Amount</th><th>Method</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {payments.map((payment) => (
                      <tr key={payment.id}>
                        <td>{payment.paymentNumber}</td><td>{payment.saleId}</td><td>{currency(payment.amount)}</td><td>{payment.method}</td>
                        <td><span className={`badge ${statusClass(payment.status)}`}>{payment.status}</span></td>
                        <td className="text-end">
                          <button className="btn btn-icon btn-sm me-1" onClick={() => setPaymentForm({ ...payment, amount: String(payment.amount) })}><IconEdit size={16} /></button>
                          <button className="btn btn-icon btn-sm text-danger" onClick={() => voidPayment(payment)}><IconTrash size={16} /></button>
                        </td>
                      </tr>
                    ))}
                    {!payments.length && <tr><td colSpan="6" className="text-muted">No records yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
