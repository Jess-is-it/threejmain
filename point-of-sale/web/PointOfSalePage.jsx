import React, { useEffect, useMemo, useState } from 'react';
import {
  IconCash,
  IconPackage,
  IconReceipt,
  IconRefresh,
  IconSearch,
  IconShoppingCart,
  IconTrash,
  IconX
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

function saleUserLabel(sale) {
  return sale.cashierName || sale.cashierUsername || 'POS user';
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

const blankSaleLine = {
  itemId: '',
  serialNumber: '',
  description: '',
  quantity: '1',
  unitPrice: '',
  discountAmount: '0'
};

const blankSale = {
  id: '',
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

export default function PointOfSalePage({ refreshShell = () => {} }) {
  const [activeTab, setActiveTab] = useState('Register');
  const [meta, setMeta] = useState({ itemStatuses: [], saleStatuses: [], paymentMethods: [] });
  const [overview, setOverview] = useState({ metrics: {}, recentSales: [], lowStock: [] });
  const [items, setItems] = useState([]);
  const [sales, setSales] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [itemForm, setItemForm] = useState(blankItem);
  const [saleForm, setSaleForm] = useState(blankSale);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showLowStockPanel, setShowLowStockPanel] = useState(false);

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const cartLines = useMemo(() => saleForm.lineItems.filter((line) => line.itemId || line.description), [saleForm.lineItems]);
  const cartSubtotal = useMemo(() => cartLines.reduce((sum, line) => {
    const amount = Number(line.quantity || 0) * Number(line.unitPrice || 0) - Number(line.discountAmount || 0);
    return sum + Math.max(0, amount);
  }, 0), [cartLines]);
  const cartTotal = Math.max(0, cartSubtotal - Number(saleForm.discountAmount || 0) + Number(saleForm.taxAmount || 0));

  async function load(search = customerSearch, itemTerm = itemSearch) {
    setError('');
    try {
      const [nextMeta, nextOverview, nextCustomers, nextItems, nextSales] = await Promise.all([
        request('/point-of-sale/meta'),
        request('/point-of-sale/overview'),
        request(`/point-of-sale/customers?search=${encodeURIComponent(search)}`),
        request(`/point-of-sale/items?search=${encodeURIComponent(itemTerm)}`),
        request('/point-of-sale/sales')
      ]);
      setMeta(nextMeta);
      setOverview(nextOverview);
      setCustomers(nextCustomers);
      setItems(nextItems);
      setSales(nextSales);
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

  function resetItem() {
    setItemForm(blankItem);
  }

  function resetSale() {
    setSaleForm(blankSale);
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

  function setSaleLine(index, patch) {
    setSaleForm((form) => {
      const lineItems = form.lineItems.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line));
      return { ...form, lineItems };
    });
  }

  function addCatalogItemToCart(item) {
    if (item.stockTracked && Number(item.stockOnHand || 0) <= 0) {
      setError(`${item.sku} is out of stock.`);
      return;
    }
    setError('');
    setSaleForm((form) => {
      const currentLines = form.lineItems.filter((line) => line.itemId || line.description);
      const existingIndex = item.trackingType === 'SERIALIZED' ? -1 : currentLines.findIndex((line) => line.itemId === item.id && !line.serialNumber);
      if (existingIndex >= 0) {
        return {
          ...form,
          lineItems: currentLines.map((line, index) => (
            index === existingIndex ? { ...line, quantity: String(Number(line.quantity || 0) + 1) } : line
          ))
        };
      }
      return {
        ...form,
        lineItems: [
          ...currentLines,
          {
            ...blankSaleLine,
            itemId: item.id,
            description: item.name,
            quantity: '1',
            unitPrice: String(item.unitPrice || 0),
            discountAmount: '0'
          }
        ]
      };
    });
  }

  function removeSaleLine(index) {
    setSaleForm((form) => {
      const lineItems = form.lineItems.filter((_, lineIndex) => lineIndex !== index);
      return { ...form, lineItems: lineItems.length ? lineItems : [blankSaleLine] };
    });
  }

  function salePayload() {
    return {
      customerId: saleForm.customerId || null,
      saleDate: saleForm.saleDate,
      lineItems: saleForm.lineItems.filter((line) => line.itemId || line.description).map((line) => ({
        itemId: line.itemId || null,
        serialNumber: line.serialNumber || '',
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
    if (!cartLines.length) {
      setError('Add at least one item to the cart.');
      return;
    }
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

  const metrics = overview.metrics || {};
  const salesMetrics = [
    { label: 'Today Sales', value: currency(metrics.today_sales), icon: IconCash, tone: 'green' },
    { label: 'Transactions', value: metrics.transactions || 0, icon: IconReceipt, tone: 'blue' },
    { label: 'Active Items', value: metrics.active_items || 0, icon: IconPackage, tone: 'azure' },
    { label: 'Low Stock', value: metrics.low_stock || 0, icon: IconPackage, tone: 'red', action: () => setShowLowStockPanel(true) }
  ];

  return (
    <div className="pos-page">
      {message && <div className="alert alert-info">{message}</div>}
      {error && <div className="alert alert-danger">{error}</div>}

      <ul className="nav nav-tabs mb-3">
        {['Register', 'Sales', 'Catalog'].map((tab) => (
          <li className="nav-item" key={tab}>
            <button className={`nav-link ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>{tab}</button>
          </li>
        ))}
      </ul>

      {activeTab === 'Register' && (
        <div className="pos-register-layout">
          <Card
            title="Checkout Menu"
            icon={IconShoppingCart}
            actions={
              <form className="d-flex gap-2" onSubmit={(e) => { e.preventDefault(); load(customerSearch, itemSearch); }}>
                <input className="form-control form-control-sm" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Search SKU, barcode, or item" />
                <button className="btn btn-sm"><IconSearch size={16} /></button>
              </form>
            }
          >
            <div className="pos-product-grid">
              {items.filter((item) => item.status === 'ACTIVE').map((item) => (
                <button
                  type="button"
                  className="pos-product-tile"
                  key={item.id}
                  onClick={() => addCatalogItemToCart(item)}
                  disabled={item.stockTracked && Number(item.stockOnHand || 0) <= 0}
                >
                  <span className="pos-product-sku">{item.sku}</span>
                  <strong>{item.name}</strong>
                  <span>{currency(item.unitPrice)}</span>
                  <small>{item.stockTracked ? `${item.stockOnHand} ${item.unit || ''} available` : 'Non-stock service'}</small>
                </button>
              ))}
              {!items.length && <div className="empty">No sellable inventory items yet.</div>}
            </div>
          </Card>

          <Card title="Cart" icon={IconReceipt}>
            <form onSubmit={saveSale}>
              <div className="row g-3">
                <div className="col-md-6"><TextField label="Sale Date" type="date" value={saleForm.saleDate} onChange={(value) => setSaleForm({ ...saleForm, saleDate: value })} /></div>
                <div className="col-12">
                  <div className="d-flex gap-2">
                    <select className="form-select" value={saleForm.customerId} onChange={(e) => setSaleForm({ ...saleForm, customerId: e.target.value })}>{customerOptions()}</select>
                    <input className="form-control" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="Search customers" />
                    <button type="button" className="btn" onClick={() => load(customerSearch, itemSearch)}><IconSearch size={16} /></button>
                  </div>
                </div>
                <div className="col-12">
                  <div className="pos-cart-lines">
                    {cartLines.map((line, index) => {
                      const originalIndex = saleForm.lineItems.indexOf(line);
                      const cartItem = itemById.get(line.itemId);
                      return (
                        <div className="pos-cart-line" key={`${line.itemId || line.description}-${index}`}>
                          <div>
                            <strong>{line.description}</strong>
                            <div className="text-muted">{cartItem?.sku || 'Manual line'}</div>
                          </div>
                          <input className="form-control pos-qty" type="number" min="0.01" step="0.01" value={line.quantity} onChange={(e) => setSaleLine(originalIndex, { quantity: e.target.value })} />
                          <input className="form-control pos-price" type="number" min="0" step="0.01" value={line.unitPrice} onChange={(e) => setSaleLine(originalIndex, { unitPrice: e.target.value })} />
                          <input className="form-control pos-serial" value={line.serialNumber || ''} placeholder={cartItem?.trackingType === 'SERIALIZED' ? 'Serial required' : 'Serial'} onChange={(e) => setSaleLine(originalIndex, { serialNumber: e.target.value })} />
                          <button type="button" className="btn btn-icon" onClick={() => removeSaleLine(originalIndex)}><IconTrash size={16} /></button>
                        </div>
                      );
                    })}
                    {!cartLines.length && <div className="empty">Add items from the checkout menu.</div>}
                  </div>
                </div>
                <div className="col-6"><TextField label="Discount" type="number" min="0" step="0.01" value={saleForm.discountAmount} onChange={(value) => setSaleForm({ ...saleForm, discountAmount: value })} /></div>
                <div className="col-6"><TextField label="Tax" type="number" min="0" step="0.01" value={saleForm.taxAmount} onChange={(value) => setSaleForm({ ...saleForm, taxAmount: value })} /></div>
                <div className="col-md-4"><TextField label="Payment" type="number" min="0" step="0.01" value={saleForm.paymentAmount} onChange={(value) => setSaleForm({ ...saleForm, paymentAmount: value })} /></div>
                <div className="col-md-4"><SelectField label="Method" value={saleForm.paymentMethod} options={meta.paymentMethods} onChange={(value) => setSaleForm({ ...saleForm, paymentMethod: value })} /></div>
                <div className="col-md-4"><TextField label="Reference" value={saleForm.paymentReference} onChange={(value) => setSaleForm({ ...saleForm, paymentReference: value })} /></div>
                <div className="col-12">
                  <div className="pos-total-panel">
                    <span>Subtotal {currency(cartSubtotal)}</span>
                    <strong>Total {currency(cartTotal)}</strong>
                  </div>
                </div>
                <div className="col-12 d-flex justify-content-between gap-2">
                  <button type="button" className="btn" onClick={resetSale}>Clear</button>
                  <button className="btn btn-primary"><IconReceipt size={18} className="me-2" />Complete Checkout</button>
                </div>
              </div>
            </form>
          </Card>
        </div>
      )}

      {activeTab === 'Catalog' && (
        <div className="row row-cards">
          <div className="col-12">
            <Card title="Sellable Inventory Catalog" icon={IconPackage} actions={
              <form className="d-flex gap-2" onSubmit={(e) => { e.preventDefault(); load(customerSearch, itemSearch); }}>
                <input className="form-control form-control-sm" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Search items" />
                <button className="btn btn-sm"><IconSearch size={16} /></button>
              </form>
            }>
              <p className="text-muted mb-3">Items are maintained in Inventory. POS only sells active inventory items marked as sellable in POS.</p>
              <div className="table-responsive">
                <table className="table card-table table-vcenter">
                  <thead><tr><th>SKU</th><th>Name</th><th>Category</th><th>Price</th><th>Available</th><th>Tracking</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.sku}</td><td>{item.name}</td><td>{item.category?.replaceAll('_', ' ')}</td><td>{currency(item.unitPrice)}</td><td>{item.stockTracked ? `${item.stockOnHand} ${item.unit || ''}` : 'Not tracked'}</td><td>{item.trackingType?.replaceAll('_', ' ')}</td>
                        <td><span className={`badge ${statusClass(item.status)}`}>{item.status}</span></td>
                        <td className="text-end">
                          <button className="btn btn-sm" onClick={() => addCatalogItemToCart(item)}>Add</button>
                        </td>
                      </tr>
                    ))}
                    {!items.length && <tr><td colSpan="8" className="text-muted">No sellable inventory items yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Sales' && (
        <div className="row row-cards">
          {salesMetrics.map(({ label, value, icon: Icon, tone, action }) => (
            <div className="col-sm-6 col-lg-3" key={label}>
              {action ? (
                <div
                  className="card status-card pos-kpi-card"
                  role="button"
                  tabIndex={0}
                  onClick={action}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      action();
                    }
                  }}
                  aria-label="Show low stock items"
                >
                  <div className="card-body">
                    <span className={`badge bg-${tone}-lt text-${tone} mb-3`}><Icon size={18} /></span>
                    <div className="h1 mb-0">{value}</div>
                    <div className="text-muted">{label}</div>
                  </div>
                </div>
              ) : (
                <div className="card status-card">
                  <div className="card-body">
                    <span className={`badge bg-${tone}-lt text-${tone} mb-3`}><Icon size={18} /></span>
                    <div className="h1 mb-0">{value}</div>
                    <div className="text-muted">{label}</div>
                  </div>
                </div>
              )}
            </div>
          ))}
          <div className="col-12">
            <Card
              title="Sales History"
              icon={IconReceipt}
              actions={
                <div className="d-flex gap-2">
                  <button className="btn btn-sm" type="button" onClick={() => load()}><IconRefresh size={16} className="me-1" />Refresh</button>
                  <button className="btn btn-sm btn-primary" type="button" onClick={() => setActiveTab('Register')}><IconShoppingCart size={16} className="me-1" />Register</button>
                </div>
              }
            >
              <div className="table-responsive">
                <table className="table card-table table-vcenter">
                  <thead><tr><th>Receipt</th><th>Customer</th><th>User</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {sales.map((sale) => (
                      <tr key={sale.id}>
                        <td>{sale.receiptNumber}</td><td>{customerLabel(sale.customer)}</td><td>{saleUserLabel(sale)}</td><td>{currency(sale.total)}</td><td>{currency(sale.paidTotal)}</td><td>{currency(sale.balance)}</td>
                        <td><span className={`badge ${statusClass(sale.paymentStatus)}`}>{sale.paymentStatus?.replaceAll('_', ' ')}</span></td>
                        <td className="text-end">
                          <button className="btn btn-sm text-danger" onClick={() => voidSale(sale)}>Void</button>
                        </td>
                      </tr>
                    ))}
                    {!sales.length && <tr><td colSpan="8" className="text-muted">No records yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}

      {showLowStockPanel && (
        <div className="pos-drawer-backdrop" onClick={() => setShowLowStockPanel(false)}>
          <aside className="pos-drawer" role="dialog" aria-modal="true" aria-labelledby="pos-low-stock-title" onClick={(event) => event.stopPropagation()}>
            <div className="pos-drawer-header">
              <div>
                <h3 id="pos-low-stock-title" className="mb-1">Low Stock</h3>
                <div className="text-muted">{overview.lowStock?.length || 0} item{overview.lowStock?.length === 1 ? '' : 's'} at or below reorder point</div>
              </div>
              <button type="button" className="btn btn-icon" onClick={() => setShowLowStockPanel(false)} aria-label="Close low stock panel"><IconX size={18} /></button>
            </div>
            <div className="pos-drawer-body">
              {overview.lowStock?.length ? (
                <div className="pos-low-stock-list">
                  {overview.lowStock.map((item) => (
                    <div className="pos-low-stock-row" key={item.id}>
                      <div>
                        <strong>{item.sku}</strong>
                        <div>{item.name}</div>
                        <small className="text-muted">{item.category?.replaceAll('_', ' ') || 'Uncategorized'}</small>
                      </div>
                      <div className="pos-low-stock-counts">
                        <span>{item.stockOnHand} {item.unit || ''}</span>
                        <small>Reorder {item.reorderPoint}</small>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty">No low stock items.</div>
              )}
            </div>
          </aside>
        </div>
      )}

    </div>
  );
}
