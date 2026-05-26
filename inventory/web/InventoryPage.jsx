import React, { useEffect, useMemo, useState } from 'react';
import {
  IconBox,
  IconDeviceFloppy,
  IconEdit,
  IconPackageExport,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconUserCheck
} from '@tabler/icons-react';
import './inventory.css';

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

function statusClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (['active', 'receive', 'return', 'assigned'].includes(normalized)) return 'bg-green-lt text-green';
  if (['low', 'adjust', 'transfer', 'inactive'].includes(normalized)) return 'bg-yellow-lt text-yellow';
  if (['archived', 'issue', 'lost', 'damaged'].includes(normalized)) return 'bg-red-lt text-red';
  if (['serialized'].includes(normalized)) return 'bg-indigo-lt text-indigo';
  return 'bg-blue-lt text-blue';
}

function itemLabel(item) {
  if (!item) return '-';
  return `${item.sku || 'NO-SKU'} - ${item.name || 'Unnamed item'}`;
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

function SelectField({ label, value, onChange, options, required = false, children }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <select className="form-select" value={value ?? ''} required={required} onChange={(e) => onChange(e.target.value)}>
        {children || options.map((option) => <option key={option} value={option}>{option.replaceAll('_', ' ')}</option>)}
      </select>
    </div>
  );
}

function TextArea({ label, value, onChange }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <textarea className="form-control" rows="2" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

const blankItem = {
  id: '',
  sku: '',
  name: '',
  category: 'ONU_CPE',
  trackingType: 'STOCK',
  unit: 'pcs',
  quantityOnHand: '0',
  reorderPoint: '0',
  location: 'Main stockroom',
  supplier: '',
  unitCost: '0',
  salePrice: '0',
  taxable: false,
  sellableInPos: false,
  barcode: '',
  status: 'ACTIVE',
  serialNumbersText: '',
  notes: ''
};

const blankMovement = {
  id: '',
  itemId: '',
  type: 'RECEIVE',
  quantity: '1',
  serialNumber: '',
  fromLocation: '',
  toLocation: 'Main stockroom',
  referenceType: 'MANUAL',
  referenceId: '',
  notes: ''
};

const blankAssignment = {
  id: '',
  itemId: '',
  serialNumber: '',
  quantity: '1',
  assigneeType: 'CUSTOMER',
  assignedToName: '',
  customerId: '',
  serviceId: '',
  ticketId: '',
  location: '',
  status: 'ASSIGNED',
  assignedDate: today(),
  dueDate: '',
  returnedDate: '',
  notes: ''
};

export default function InventoryPage({ refreshShell = () => {} }) {
  const [activeTab, setActiveTab] = useState('Overview');
  const [meta, setMeta] = useState({ itemCategories: [], trackingTypes: [], itemStatuses: [], movementTypes: [], assignmentStatuses: [], assigneeTypes: [] });
  const [overview, setOverview] = useState({ metrics: {}, lowStockItems: [], recentMovements: [], activeAssignments: [] });
  const [items, setItems] = useState([]);
  const [movements, setMovements] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [itemForm, setItemForm] = useState(blankItem);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [movementForm, setMovementForm] = useState(blankMovement);
  const [assignmentForm, setAssignmentForm] = useState(blankAssignment);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  async function load(nextSearch = search) {
    setError('');
    try {
      const query = encodeURIComponent(nextSearch);
      const [nextMeta, nextOverview, nextItems, nextMovements, nextAssignments] = await Promise.all([
        request('/inventory/meta'),
        request('/inventory/overview'),
        request(`/inventory/items?search=${query}`),
        request(`/inventory/movements?search=${query}`),
        request(`/inventory/assignments?search=${query}`)
      ]);
      setMeta(nextMeta);
      setOverview(nextOverview);
      setItems(nextItems);
      setMovements(nextMovements);
      setAssignments(nextAssignments);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  function itemOptions() {
    return (
      <>
        <option value="">Select item</option>
        {items.map((item) => <option key={item.id} value={item.id}>{itemLabel(item)} ({item.availableQuantity} {item.unit})</option>)}
      </>
    );
  }

  async function submitItem(e) {
    e.preventDefault();
    const body = {
      ...itemForm,
      quantityOnHand: Number(itemForm.quantityOnHand),
      reorderPoint: Number(itemForm.reorderPoint),
      unitCost: Number(itemForm.unitCost),
      salePrice: Number(itemForm.salePrice),
      taxable: Boolean(itemForm.taxable),
      sellableInPos: Boolean(itemForm.sellableInPos),
      serialNumbers: itemForm.serialNumbersText.split(',').map((value) => value.trim()).filter(Boolean)
    };
    delete body.id;
    delete body.serialNumbersText;
    const path = itemForm.id ? `/inventory/items/${itemForm.id}` : '/inventory/items';
    await request(path, { method: itemForm.id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    setItemForm(blankItem);
    setItemModalOpen(false);
    setMessage(itemForm.id ? 'Item saved.' : 'Item created.');
    await load();
    refreshShell();
  }

  async function deleteItem(id) {
    if (!window.confirm('Archive this item?')) return;
    await request(`/inventory/items/${id}`, { method: 'DELETE' });
    setMessage('Item archived.');
    await load();
    refreshShell();
  }

  async function submitMovement(e) {
    e.preventDefault();
    const body = { ...movementForm, quantity: Number(movementForm.quantity) };
    delete body.id;
    const path = movementForm.id ? `/inventory/movements/${movementForm.id}` : '/inventory/movements';
    await request(path, { method: movementForm.id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    setMovementForm(blankMovement);
    setMessage(movementForm.id ? 'Movement saved.' : 'Movement recorded.');
    await load();
    refreshShell();
  }

  async function deleteMovement(id) {
    if (!window.confirm('Delete this movement record?')) return;
    await request(`/inventory/movements/${id}`, { method: 'DELETE' });
    setMessage('Movement deleted.');
    await load();
    refreshShell();
  }

  async function submitAssignment(e) {
    e.preventDefault();
    const body = { ...assignmentForm, quantity: Number(assignmentForm.quantity) };
    delete body.id;
    const path = assignmentForm.id ? `/inventory/assignments/${assignmentForm.id}` : '/inventory/assignments';
    await request(path, { method: assignmentForm.id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    setAssignmentForm(blankAssignment);
    setMessage(assignmentForm.id ? 'Assignment saved.' : 'Assignment created.');
    await load();
    refreshShell();
  }

  async function deleteAssignment(id) {
    if (!window.confirm('Return this assignment?')) return;
    await request(`/inventory/assignments/${id}`, { method: 'DELETE' });
    setMessage('Assignment returned.');
    await load();
    refreshShell();
  }

  function editItem(item) {
    setItemForm({
      ...blankItem,
      ...item,
      quantityOnHand: String(item.quantityOnHand),
      reorderPoint: String(item.reorderPoint),
      unitCost: String(item.unitCost),
      salePrice: String(item.salePrice || 0),
      taxable: Boolean(item.taxable),
      sellableInPos: Boolean(item.sellableInPos),
      barcode: item.barcode || '',
      serialNumbersText: (item.serialNumbers || []).join(', ')
    });
    setActiveTab('Items');
    setItemModalOpen(true);
  }

  function newItem() {
    setItemForm(blankItem);
    setActiveTab('Items');
    setItemModalOpen(true);
  }

  function closeItemModal() {
    setItemForm(blankItem);
    setItemModalOpen(false);
  }

  function metricCards() {
    const metrics = overview.metrics || {};
    return [
      ['Items', metrics.items || 0, IconBox, 'blue'],
      ['Active', metrics.active_items || 0, IconBox, 'green'],
      ['Low Stock', metrics.low_stock || 0, IconPackageExport, 'yellow'],
      ['Out of Stock', metrics.out_of_stock || 0, IconPackageExport, 'red'],
      ['Assigned', metrics.assigned_assets || 0, IconUserCheck, 'cyan'],
      ['Stock Value', money(metrics.stock_value || 0), IconBox, 'orange']
    ].map(([label, value, Icon, tone]) => (
      <div className="inventory-metric" key={label}>
        <span className={`badge bg-${tone}-lt text-${tone}`}><Icon size={18} /></span>
        <div>
          <div className="inventory-metric-value">{value}</div>
          <div className="text-muted">{label}</div>
        </div>
      </div>
    ));
  }

  return (
    <div className="inventory-page">
      {message && <div className="alert alert-info">{message}</div>}
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="inventory-toolbar">
        <div className="input-icon inventory-search">
          <span className="input-icon-addon"><IconSearch size={16} /></span>
          <input className="form-control" value={search} placeholder="Search inventory" onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(search); }} />
        </div>
        <button className="btn" onClick={() => load(search)}><IconRefresh size={16} className="me-1" />Refresh</button>
      </div>

      <ul className="nav nav-tabs mb-3">
        {['Overview', 'Items', 'Movements', 'Assignments'].map((tab) => (
          <li className="nav-item" key={tab}>
            <button className={`nav-link ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>{tab}</button>
          </li>
        ))}
      </ul>

      {activeTab === 'Overview' && (
        <div className="row row-cards">
          <div className="col-12"><div className="inventory-metrics">{metricCards()}</div></div>
          <div className="col-lg-6">
            <Card title="Low Stock" icon={IconPackageExport}>
              <ItemTable rows={overview.lowStockItems || []} onEdit={editItem} onDelete={deleteItem} compact />
            </Card>
          </div>
          <div className="col-lg-6">
            <Card title="Active Assignments" icon={IconUserCheck}>
              <AssignmentTable rows={overview.activeAssignments || []} onEdit={(row) => setAssignmentForm({ ...blankAssignment, ...row, quantity: String(row.quantity) })} onDelete={deleteAssignment} compact />
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Items' && (
        <div className="row row-cards">
          <div className="col-12">
            <Card
              title="Items"
              icon={IconBox}
              actions={<button className="btn btn-primary" type="button" onClick={newItem}><IconPlus size={16} className="me-1" />New item</button>}
            >
              <ItemTable rows={items} onEdit={editItem} onDelete={deleteItem} />
            </Card>
          </div>
        </div>
      )}

      {itemModalOpen && (
        <div className="inventory-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeItemModal(); }}>
          <div className="inventory-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-item-modal-title">
            <div className="inventory-modal-header">
              <h3 id="inventory-item-modal-title" className="inventory-modal-title">{itemForm.id ? 'Edit Item' : 'New Item'}</h3>
              <button className="btn-close" type="button" aria-label="Close" onClick={closeItemModal} />
            </div>
            <form className="inventory-form" onSubmit={submitItem}>
              <div className="inventory-modal-body">
                <TextField label="SKU" value={itemForm.sku} onChange={(sku) => setItemForm({ ...itemForm, sku })} />
                <TextField label="Name" value={itemForm.name} required onChange={(name) => setItemForm({ ...itemForm, name })} />
                <SelectField label="Category" value={itemForm.category} options={meta.itemCategories || ['OTHER']} onChange={(category) => setItemForm({ ...itemForm, category })} />
                <SelectField label="Tracking" value={itemForm.trackingType} options={meta.trackingTypes || ['STOCK']} onChange={(trackingType) => setItemForm({ ...itemForm, trackingType, unit: trackingType === 'SERIALIZED' ? 'unit' : itemForm.unit })} />
                <div className="inventory-two-cols">
                  <TextField label="Unit" value={itemForm.unit} required onChange={(unit) => setItemForm({ ...itemForm, unit })} />
                  <TextField label="Unit Cost" type="number" min="0" step="0.01" value={itemForm.unitCost} onChange={(unitCost) => setItemForm({ ...itemForm, unitCost })} />
                </div>
                <div className="inventory-two-cols">
                  <TextField label="POS Sale Price" type="number" min="0" step="0.01" value={itemForm.salePrice} onChange={(salePrice) => setItemForm({ ...itemForm, salePrice })} />
                  <TextField label="Barcode" value={itemForm.barcode} onChange={(barcode) => setItemForm({ ...itemForm, barcode })} />
                </div>
                <div className="inventory-two-cols">
                  <label className="form-check">
                    <input className="form-check-input" type="checkbox" checked={itemForm.sellableInPos} onChange={(event) => setItemForm({ ...itemForm, sellableInPos: event.target.checked })} />
                    <span className="form-check-label">Sell in POS</span>
                  </label>
                  <label className="form-check">
                    <input className="form-check-input" type="checkbox" checked={itemForm.taxable} onChange={(event) => setItemForm({ ...itemForm, taxable: event.target.checked })} />
                    <span className="form-check-label">Taxable</span>
                  </label>
                </div>
                <div className="inventory-two-cols">
                  <TextField label="On Hand" type="number" min="0" step="0.01" value={itemForm.quantityOnHand} required onChange={(quantityOnHand) => setItemForm({ ...itemForm, quantityOnHand })} />
                  <TextField label="Reorder Point" type="number" min="0" step="0.01" value={itemForm.reorderPoint} onChange={(reorderPoint) => setItemForm({ ...itemForm, reorderPoint })} />
                </div>
                <TextField label="Location" value={itemForm.location} onChange={(location) => setItemForm({ ...itemForm, location })} />
                <TextField label="Supplier" value={itemForm.supplier} onChange={(supplier) => setItemForm({ ...itemForm, supplier })} />
                <SelectField label="Status" value={itemForm.status} options={meta.itemStatuses || ['ACTIVE']} onChange={(status) => setItemForm({ ...itemForm, status })} />
                <TextArea label="Serial Numbers" value={itemForm.serialNumbersText} onChange={(serialNumbersText) => setItemForm({ ...itemForm, serialNumbersText })} />
                <TextArea label="Notes" value={itemForm.notes} onChange={(notes) => setItemForm({ ...itemForm, notes })} />
              </div>
              <div className="inventory-modal-footer">
                <button className="btn" type="button" onClick={closeItemModal}>Cancel</button>
                <button className="btn btn-primary"><IconDeviceFloppy size={16} className="me-1" />Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'Movements' && (
        <div className="row row-cards">
          <div className="col-lg-4">
            <Card title={movementForm.id ? 'Edit Movement' : 'New Movement'} icon={IconPackageExport}>
              <form className="inventory-form" onSubmit={submitMovement}>
                <SelectField label="Item" value={movementForm.itemId} required onChange={(itemId) => {
                  const item = itemById.get(itemId);
                  setMovementForm({ ...movementForm, itemId, toLocation: item?.location || movementForm.toLocation });
                }}>{itemOptions()}</SelectField>
                <SelectField label="Type" value={movementForm.type} options={meta.movementTypes || ['RECEIVE']} onChange={(type) => setMovementForm({ ...movementForm, type })} />
                <TextField label="Quantity" type="number" min="0.01" step="0.01" value={movementForm.quantity} required onChange={(quantity) => setMovementForm({ ...movementForm, quantity })} />
                <TextField label="Serial Number" value={movementForm.serialNumber} onChange={(serialNumber) => setMovementForm({ ...movementForm, serialNumber })} />
                <div className="inventory-two-cols">
                  <TextField label="From" value={movementForm.fromLocation} onChange={(fromLocation) => setMovementForm({ ...movementForm, fromLocation })} />
                  <TextField label="To" value={movementForm.toLocation} onChange={(toLocation) => setMovementForm({ ...movementForm, toLocation })} />
                </div>
                <div className="inventory-two-cols">
                  <TextField label="Reference Type" value={movementForm.referenceType} onChange={(referenceType) => setMovementForm({ ...movementForm, referenceType })} />
                  <TextField label="Reference ID" value={movementForm.referenceId} onChange={(referenceId) => setMovementForm({ ...movementForm, referenceId })} />
                </div>
                <TextArea label="Notes" value={movementForm.notes} onChange={(notes) => setMovementForm({ ...movementForm, notes })} />
                <div className="inventory-form-actions">
                  {movementForm.id && <button className="btn" type="button" onClick={() => setMovementForm(blankMovement)}>Cancel</button>}
                  <button className="btn btn-primary"><IconDeviceFloppy size={16} className="me-1" />Save</button>
                </div>
              </form>
            </Card>
          </div>
          <div className="col-lg-8">
            <Card title="Movements" icon={IconPackageExport}>
              <MovementTable rows={movements} onEdit={(row) => setMovementForm({ ...blankMovement, ...row, quantity: String(row.quantity) })} onDelete={deleteMovement} />
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Assignments' && (
        <div className="row row-cards">
          <div className="col-lg-4">
            <Card title={assignmentForm.id ? 'Edit Assignment' : 'New Assignment'} icon={IconUserCheck}>
              <form className="inventory-form" onSubmit={submitAssignment}>
                <SelectField label="Item" value={assignmentForm.itemId} required onChange={(itemId) => setAssignmentForm({ ...assignmentForm, itemId })}>{itemOptions()}</SelectField>
                <TextField label="Serial Number" value={assignmentForm.serialNumber} onChange={(serialNumber) => setAssignmentForm({ ...assignmentForm, serialNumber })} />
                <TextField label="Quantity" type="number" min="0.01" step="0.01" value={assignmentForm.quantity} required onChange={(quantity) => setAssignmentForm({ ...assignmentForm, quantity })} />
                <SelectField label="Assignee Type" value={assignmentForm.assigneeType} options={meta.assigneeTypes || ['CUSTOMER']} onChange={(assigneeType) => setAssignmentForm({ ...assignmentForm, assigneeType })} />
                <TextField label="Assigned To" value={assignmentForm.assignedToName} required onChange={(assignedToName) => setAssignmentForm({ ...assignmentForm, assignedToName })} />
                <div className="inventory-two-cols">
                  <TextField label="Customer ID" value={assignmentForm.customerId} onChange={(customerId) => setAssignmentForm({ ...assignmentForm, customerId })} />
                  <TextField label="Service ID" value={assignmentForm.serviceId} onChange={(serviceId) => setAssignmentForm({ ...assignmentForm, serviceId })} />
                </div>
                <div className="inventory-two-cols">
                  <TextField label="Ticket ID" value={assignmentForm.ticketId} onChange={(ticketId) => setAssignmentForm({ ...assignmentForm, ticketId })} />
                  <TextField label="Location" value={assignmentForm.location} onChange={(location) => setAssignmentForm({ ...assignmentForm, location })} />
                </div>
                <div className="inventory-two-cols">
                  <TextField label="Assigned Date" type="date" value={assignmentForm.assignedDate} onChange={(assignedDate) => setAssignmentForm({ ...assignmentForm, assignedDate })} />
                  <TextField label="Due Date" type="date" value={assignmentForm.dueDate} onChange={(dueDate) => setAssignmentForm({ ...assignmentForm, dueDate })} />
                </div>
                <div className="inventory-two-cols">
                  <SelectField label="Status" value={assignmentForm.status} options={meta.assignmentStatuses || ['ASSIGNED']} onChange={(status) => setAssignmentForm({ ...assignmentForm, status })} />
                  <TextField label="Returned Date" type="date" value={assignmentForm.returnedDate} onChange={(returnedDate) => setAssignmentForm({ ...assignmentForm, returnedDate })} />
                </div>
                <TextArea label="Notes" value={assignmentForm.notes} onChange={(notes) => setAssignmentForm({ ...assignmentForm, notes })} />
                <div className="inventory-form-actions">
                  {assignmentForm.id && <button className="btn" type="button" onClick={() => setAssignmentForm(blankAssignment)}>Cancel</button>}
                  <button className="btn btn-primary"><IconDeviceFloppy size={16} className="me-1" />Save</button>
                </div>
              </form>
            </Card>
          </div>
          <div className="col-lg-8">
            <Card title="Assignments" icon={IconUserCheck}>
              <AssignmentTable rows={assignments} onEdit={(row) => setAssignmentForm({ ...blankAssignment, ...row, quantity: String(row.quantity) })} onDelete={deleteAssignment} />
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

function RowActions({ onEdit, onDelete, row }) {
  return (
    <td className="text-end">
      <button className="btn btn-sm me-1" onClick={() => onEdit(row)}><IconEdit size={14} /></button>
      <button className="btn btn-sm btn-outline-danger" onClick={() => onDelete(row.id)}><IconTrash size={14} /></button>
    </td>
  );
}

function ItemTable({ rows, onEdit, onDelete, compact = false }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-responsive">
      <table className="table card-table table-vcenter">
        <thead>
          <tr>
            <th>Item</th>
            {!compact && <th>Category</th>}
            <th>On Hand</th>
            <th>Available</th>
            {!compact && <th>POS</th>}
            {!compact && <th>Location</th>}
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <div className="fw-bold">{row.name}</div>
                <div className="text-muted">{row.sku}</div>
              </td>
              {!compact && <td>{row.category.replaceAll('_', ' ')}</td>}
              <td>{row.stockTracked ? `${row.quantityOnHand} ${row.unit}` : 'Not tracked'}</td>
              <td>{row.stockTracked ? `${row.availableQuantity} ${row.unit}` : '-'}</td>
              {!compact && <td>{row.sellableInPos ? money(row.salePrice) : 'Not sold'}</td>}
              {!compact && <td>{row.location}</td>}
              <td><span className={`badge ${statusClass(row.lowStock ? 'low' : row.status)}`}>{row.lowStock ? 'LOW STOCK' : row.status}</span></td>
              <RowActions row={row} onEdit={onEdit} onDelete={onDelete} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MovementTable({ rows, onEdit, onDelete }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-responsive">
      <table className="table card-table table-vcenter">
        <thead>
          <tr>
            <th>Item</th>
            <th>Type</th>
            <th>Quantity</th>
            <th>Reference</th>
            <th>Location</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <div>{itemLabel(row.item)}</div>
                {row.serialNumber && <div className="text-muted">{row.serialNumber}</div>}
              </td>
              <td><span className={`badge ${statusClass(row.type)}`}>{row.type}</span></td>
              <td>{row.quantity} {row.item?.unit}</td>
              <td>{row.referenceType}{row.referenceId ? ` ${row.referenceId}` : ''}</td>
              <td>{row.fromLocation || '-'} {'->'} {row.toLocation || '-'}</td>
              <RowActions row={row} onEdit={onEdit} onDelete={onDelete} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AssignmentTable({ rows, onEdit, onDelete, compact = false }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-responsive">
      <table className="table card-table table-vcenter">
        <thead>
          <tr>
            <th>Item</th>
            <th>Assigned To</th>
            {!compact && <th>Type</th>}
            {!compact && <th>Links</th>}
            <th>Qty</th>
            {!compact && <th>Due</th>}
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <div>{itemLabel(row.item)}</div>
                {row.serialNumber && <div className="text-muted">{row.serialNumber}</div>}
              </td>
              <td>{row.assignedToName}</td>
              {!compact && <td>{row.assigneeType || 'CUSTOMER'}</td>}
              {!compact && <td>{[row.customerId, row.serviceId, row.ticketId].filter(Boolean).join(' / ') || '-'}</td>}
              <td>{row.quantity}</td>
              {!compact && <td>{row.dueDate || '-'}</td>}
              <td><span className={`badge ${statusClass(row.status)}`}>{row.status}</span></td>
              <RowActions row={row} onEdit={onEdit} onDelete={onDelete} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
