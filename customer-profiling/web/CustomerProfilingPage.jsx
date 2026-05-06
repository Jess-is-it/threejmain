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

function normalizeUpper(value) {
  return String(value || '').trim().toUpperCase();
}

function uniqueValues(values) {
  return Array.from(new Set(values.map(normalizeUpper).filter(Boolean))).sort();
}

function keyValue(value) {
  return String(value || '').trim().toUpperCase();
}

function customerDuplicateKey(data) {
  const key = [
    data.firstName,
    data.lastName,
    data.addressLine1,
    data.province,
    data.city,
    data.barangay,
    data.latitude,
    data.longitude
  ].map(keyValue).join('|');
  return key.replaceAll('|', '') ? key : '';
}

function rowNumbers(rows) {
  return rows.map((row) => row.rowNumber).join(', ');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(value);
      if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
  return rows;
}

function parseCustomerCsv(text, requiredHeaders, existingCustomers = []) {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return { headers: [], rows: [], fileErrors: ['CSV must include a header row and at least one customer row.'] };
  }

  const headers = rows[0].map((header) => String(header || '').trim());
  const normalizedHeaders = headers.map((header) => header.toLowerCase());
  const fileErrors = requiredHeaders
    .filter((header) => !normalizedHeaders.includes(header.toLowerCase()))
    .map((header) => `Missing required header: ${header}`);

  const parsedRows = rows.slice(1).map((cells, index) => {
    const data = {};
    headers.forEach((header, cellIndex) => {
      if (header) data[header] = String(cells[cellIndex] || '').trim();
    });
    const hasData = Object.values(data).some((item) => String(item || '').trim());
    const rowErrors = requiredHeaders
      .filter((header) => !String(data[header] || '').trim())
      .map((header) => `${header} is required`);
    return {
      rowNumber: index + 2,
      hasData,
      data: {
        status: 'ACTIVE',
        customerType: 'RESIDENTIAL',
        ...data
      },
      errors: rowErrors
    };
  }).filter((item) => item.hasData);

  const existingAccounts = new Set(existingCustomers.map((customer) => keyValue(customer.accountNumber)).filter(Boolean));
  const existingCustomerKeys = new Set(existingCustomers.map(customerDuplicateKey).filter(Boolean));
  const accountRows = new Map();
  const customerKeyRows = new Map();

  parsedRows.forEach((row) => {
    const accountNumber = keyValue(row.data.accountNumber);
    const duplicateKey = customerDuplicateKey(row.data);
    if (accountNumber) accountRows.set(accountNumber, [...(accountRows.get(accountNumber) || []), row]);
    if (duplicateKey) customerKeyRows.set(duplicateKey, [...(customerKeyRows.get(duplicateKey) || []), row]);
  });

  parsedRows.forEach((row) => {
    const accountNumber = keyValue(row.data.accountNumber);
    const duplicateKey = customerDuplicateKey(row.data);
    const duplicateAccountRows = accountRows.get(accountNumber) || [];
    const duplicateCustomerRows = customerKeyRows.get(duplicateKey) || [];

    if (accountNumber && existingAccounts.has(accountNumber)) {
      row.errors.push(`Account number ${row.data.accountNumber} already exists`);
    }
    if (duplicateKey && existingCustomerKeys.has(duplicateKey)) {
      row.errors.push('Customer already exists with the same name and service address');
    }
    if (duplicateAccountRows.length > 1) {
      row.errors.push(`Duplicate account number in CSV rows ${rowNumbers(duplicateAccountRows)}`);
    }
    if (duplicateCustomerRows.length > 1) {
      row.errors.push(`Duplicate customer identity/address in CSV rows ${rowNumbers(duplicateCustomerRows)}`);
    }
  });

  return { headers, rows: parsedRows, fileErrors };
}

function locationLabel(location) {
  const parts = [
    location.location_name,
    location.barangay,
    location.municipality,
    location.province
  ].map((part) => String(part || '').trim()).filter(Boolean);
  return Array.from(new Set(parts)).join(' / ') || location.address || 'Unnamed location';
}

function formatCustomerAddress(customer) {
  return [
    customer.addressLine1,
    customer.addressLine2,
    customer.barangay,
    customer.city,
    customer.province
  ].map((part) => String(part || '').trim()).filter(Boolean).join(', ') || '-';
}

function formatCustomerLocation(customer) {
  return [
    customer.locationName,
    customer.barangay,
    customer.city
  ].map((part) => String(part || '').trim()).filter(Boolean).join(', ') || '-';
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
  locationId: '',
  locationName: '',
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
  const [meta, setMeta] = useState({ customerTypes: [], customerStatuses: [], provinces: [], cities: [], citiesByProvince: {}, barangays: [], barangaysByProvinceCity: {}, bulkUploadHeaders: [] });
  const [locations, setLocations] = useState([]);
  const [customers, setCustomers] = useState({ data: [], page: 1, pageSize: 10, total: 0, totalPages: 1 });
  const [filters, setFilters] = useState({ search: '', customerType: '', status: '', province: '', city: '', barangay: '', page: 1, pageSize: 10 });
  const [selected, setSelected] = useState(null);
  const [serviceOrders, setServiceOrders] = useState([]);
  const [form, setForm] = useState(blankCustomerForm);
  const [editingId, setEditingId] = useState('');
  const [isFormModalOpen, setFormModalOpen] = useState(false);
  const [isBulkUploadModalOpen, setBulkUploadModalOpen] = useState(false);
  const [bulkUploadFileName, setBulkUploadFileName] = useState('');
  const [bulkUploadRows, setBulkUploadRows] = useState([]);
  const [bulkUploadFileErrors, setBulkUploadFileErrors] = useState([]);
  const [bulkUploadResult, setBulkUploadResult] = useState(null);
  const [isBulkUploading, setBulkUploading] = useState(false);
  const [isDetailsPanelOpen, setDetailsPanelOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const savedProvinces = uniqueValues(locations.map((location) => normalizeUpper(location.province)));
  const provinceOptions = uniqueValues([...savedProvinces, ...(meta.provinces || [])]);
  const savedCities = uniqueValues(locations
    .filter((location) => !filters.province || normalizeUpper(location.province) === normalizeUpper(filters.province))
    .map((location) => normalizeUpper(location.municipality)));
  const formSavedCities = uniqueValues(locations
    .filter((location) => !form.province || normalizeUpper(location.province) === normalizeUpper(form.province))
    .map((location) => normalizeUpper(location.municipality)));
  const cities = filters.province ? uniqueValues([...(meta.citiesByProvince?.[filters.province] || []), ...savedCities]) : uniqueValues([...(meta.cities || []), ...savedCities]);
  const formCities = form.province ? uniqueValues([...(meta.citiesByProvince?.[form.province] || []), ...formSavedCities]) : uniqueValues([...(meta.cities || []), ...formSavedCities]);
  const barangayKey = `${filters.province}::${filters.city}`;
  const formBarangayKey = `${form.province}::${form.city}`;
  const savedBarangays = uniqueValues(locations
    .filter((location) => (!filters.province || normalizeUpper(location.province) === normalizeUpper(filters.province))
      && (!filters.city || normalizeUpper(location.municipality) === normalizeUpper(filters.city)))
    .map((location) => normalizeUpper(location.barangay)));
  const formSavedBarangays = uniqueValues(locations
    .filter((location) => (!form.province || normalizeUpper(location.province) === normalizeUpper(form.province))
      && (!form.city || normalizeUpper(location.municipality) === normalizeUpper(form.city)))
    .map((location) => normalizeUpper(location.barangay)));
  const barangays = filters.province && filters.city ? uniqueValues([...(meta.barangaysByProvinceCity?.[barangayKey] || []), ...savedBarangays]) : uniqueValues([...(meta.barangays || []), ...savedBarangays]);
  const formBarangays = form.province && form.city ? uniqueValues([...(meta.barangaysByProvinceCity?.[formBarangayKey] || []), ...formSavedBarangays]) : uniqueValues([...(meta.barangays || []), ...formSavedBarangays]);
  const requiredBulkUploadHeaders = meta.requiredBulkUploadHeaders || ['firstName', 'lastName', 'contactNumber', 'facebookAccountName'];
  const validBulkUploadRows = bulkUploadRows.filter((row) => !row.errors.length);
  const invalidBulkUploadRows = bulkUploadRows.filter((row) => row.errors.length);
  const statusTabs = [
    { label: 'All', value: '', count: overview?.totalCustomers ?? 0, tone: 'blue' },
    { label: 'Active', value: 'ACTIVE', count: overview?.activeCustomers ?? 0, tone: 'green' },
    { label: 'Pending', value: 'PENDING', count: overview?.pendingCustomers ?? 0, tone: 'yellow' },
    { label: 'Suspended', value: 'SUSPENDED', count: overview?.suspendedCustomers ?? 0, tone: 'red' },
    {
      label: 'Inactive',
      value: 'INACTIVE',
      count: Math.max(
        0,
        (overview?.totalCustomers ?? 0)
          - (overview?.activeCustomers ?? 0)
          - (overview?.pendingCustomers ?? 0)
          - (overview?.suspendedCustomers ?? 0)
      ),
      tone: 'secondary'
    }
  ];

  async function load(nextFilters = filters) {
    setError('');
    const params = new URLSearchParams();
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value !== '') params.set(key, value);
    });
    try {
      const [nextOverview, nextCustomers, nextMeta, nextLocations] = await Promise.all([
        request('/customer-profiling/customers/overview'),
        request(`/customer-profiling/customers?${params.toString()}`),
        request('/customer-profiling/meta'),
        request('/system-settings/locations').catch(() => [])
      ]);
      setOverview(nextOverview);
      setCustomers(nextCustomers);
      setMeta(nextMeta);
      setLocations(Array.isArray(nextLocations) ? nextLocations : []);
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadCustomer(id) {
    setError('');
    try {
      const [customer, customerServiceOrders] = await Promise.all([
        request(`/customer-profiling/customers/${id}`),
        request(`/service/orders?customerId=${encodeURIComponent(id)}`)
      ]);
      setSelected(customer);
      setServiceOrders(customerServiceOrders);
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

  function openBulkUploadModal() {
    setBulkUploadModalOpen(true);
    setBulkUploadFileName('');
    setBulkUploadRows([]);
    setBulkUploadFileErrors([]);
    setBulkUploadResult(null);
    setMessage('');
    setError('');
  }

  function closeBulkUploadModal() {
    setBulkUploadModalOpen(false);
    setBulkUploadFileName('');
    setBulkUploadRows([]);
    setBulkUploadFileErrors([]);
    setBulkUploadResult(null);
  }

  function closeDetailsPanel() {
    setDetailsPanelOpen(false);
    setSelected(null);
    setServiceOrders([]);
  }

  function resetForm() {
    setEditingId('');
    setForm({ ...blankCustomerForm });
  }

  function applyLocation(locationId) {
    const location = locations.find((item) => item.id === locationId);
    if (!location) {
      setForm({ ...form, locationId: '', locationName: '' });
      return;
    }
    setForm({
      ...form,
      locationId: location.id,
      locationName: location.location_name || '',
      addressLine1: location.address || form.addressLine1 || '',
      province: normalizeUpper(location.province) || form.province || '',
      city: normalizeUpper(location.municipality) || form.city || '',
      barangay: normalizeUpper(location.barangay) || form.barangay || '',
      latitude: location.latitude ?? form.latitude ?? '',
      longitude: location.longitude ?? form.longitude ?? ''
    });
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

  async function loadBulkUploadDuplicateCustomers() {
    const firstPage = await request('/customer-profiling/customers?page=1&pageSize=100&sortBy=createdAt&sortDir=desc');
    const rows = [...(firstPage.data || [])];
    const totalPages = firstPage.totalPages || 1;
    for (let page = 2; page <= totalPages; page += 1) {
      const nextPage = await request(`/customer-profiling/customers?page=${page}&pageSize=100&sortBy=createdAt&sortDir=desc`);
      rows.push(...(nextPage.data || []));
    }
    return rows;
  }

  async function handleBulkUploadFile(event) {
    const file = event.target.files?.[0];
    setBulkUploadResult(null);
    setBulkUploadRows([]);
    setBulkUploadFileErrors([]);
    setBulkUploadFileName(file?.name || '');
    if (!file) return;

    try {
      const [csvText, existingCustomers] = await Promise.all([
        file.text(),
        loadBulkUploadDuplicateCustomers()
      ]);
      const parsed = parseCustomerCsv(csvText, requiredBulkUploadHeaders, existingCustomers);
      setBulkUploadRows(parsed.rows);
      setBulkUploadFileErrors(parsed.fileErrors);
      if (!parsed.fileErrors.length && !parsed.rows.length) {
        setBulkUploadFileErrors(['No customer rows were found in the selected file.']);
      }
    } catch (err) {
      setBulkUploadFileErrors([err.message || 'Unable to read the selected CSV file.']);
    } finally {
      event.target.value = '';
    }
  }

  async function importBulkUploadRows() {
    const rowsToImport = validBulkUploadRows;
    if (!rowsToImport.length || bulkUploadFileErrors.length) return;

    setBulkUploading(true);
    setBulkUploadResult(null);
    setError('');

    const failures = [];
    let created = 0;
    for (const row of rowsToImport) {
      try {
        await request('/customer-profiling/customers', { method: 'POST', body: JSON.stringify(row.data) });
        created += 1;
      } catch (err) {
        failures.push({ rowNumber: row.rowNumber, message: err.message });
      }
    }

    setBulkUploading(false);
    setBulkUploadResult({ created, failed: failures.length, failures });
    if (created) {
      setMessage(`${created} customer${created === 1 ? '' : 's'} imported from ${bulkUploadFileName}.`);
      await load(filters);
      refreshShell();
    }
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
              <label className="form-label">Province</label>
              <select className="form-select" value={filters.province} onChange={(e) => updateFilters({ province: e.target.value, city: '', barangay: '' })}>
                <option value="">All</option>
                {provinceOptions.map((item) => <option key={item}>{item}</option>)}
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
        <Card
          title={`Customers (${customers.total})`}
          icon={IconUsers}
          actions={(
            <div className="btn-list">
              <button className="btn btn-outline-primary btn-sm" onClick={openBulkUploadModal}>
                <IconUpload size={16} className="me-1" />Bulk Upload
              </button>
              <button className="btn btn-primary btn-sm" onClick={openNewCustomerModal}>
                <IconPlus size={16} className="me-1" />New Customer
              </button>
            </div>
          )}
        >
          <div className="customer-status-tabs" role="tablist" aria-label="Customer status filter">
            {statusTabs.map((item) => (
              <button
                type="button"
                key={item.label}
                className={`customer-status-tab ${filters.status === item.value ? 'active' : ''}`}
                onClick={() => updateFilters({ status: item.value })}
                role="tab"
                aria-selected={filters.status === item.value}
              >
                <span>{item.label}</span>
                <span className={`badge bg-${item.tone}-lt text-${item.tone}`}>{item.count}</span>
              </button>
            ))}
          </div>
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
                    <td>{formatCustomerLocation(customer)}</td>
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
        <Card title="Service Orders" icon={IconWifi}>
          {!selected && <div className="empty">Select a customer to view Service module orders.</div>}
          {selected && (
            <>
              {serviceOrders.map((order) => (
                <div className="service-pill" key={order.id}>
                  <div>
                    <strong>{order.catalogName || order.catalog?.name || 'Service order'}</strong>
                    <span>{order.serviceReference || order.orderNumber}</span>
                  </div>
                  <span className={`badge ${statusClass(order.status)}`}>{order.status}</span>
                </div>
              ))}
              {!serviceOrders.length && <div className="text-muted">No Service Orders for this customer.</div>}
            </>
          )}
        </Card>
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
    {isBulkUploadModalOpen && (
      <div className="customer-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeBulkUploadModal()}>
        <div className="customer-modal customer-bulk-upload-modal" role="dialog" aria-modal="true" aria-labelledby="customer-bulk-upload-title">
          <div className="customer-modal-header">
            <div>
              <div className="text-muted small">Import customer records</div>
              <h3 id="customer-bulk-upload-title" className="customer-modal-title">Bulk Upload</h3>
            </div>
            <button type="button" className="btn btn-icon btn-sm" title="Close" onClick={closeBulkUploadModal}><IconX size={18} /></button>
          </div>
          <div className="customer-modal-body">
            <div className="btn-list mb-3">
              <button className="btn btn-outline-primary" onClick={downloadTemplate}><IconFileSpreadsheet size={18} className="me-2" />Download CSV Template</button>
              <label className="btn btn-primary mb-0">
                <IconUpload size={18} className="me-2" />Choose CSV File
                <input className="visually-hidden" type="file" accept=".csv,text/csv" onChange={handleBulkUploadFile} />
              </label>
            </div>
            {bulkUploadFileName && (
              <div className="bulk-upload-file">
                <IconFileSpreadsheet size={18} />
                <div>
                  <div className="fw-semibold">{bulkUploadFileName}</div>
                  <div className="text-muted small">{bulkUploadRows.length} parsed row{bulkUploadRows.length === 1 ? '' : 's'}</div>
                </div>
              </div>
            )}
            {!!bulkUploadFileErrors.length && (
              <div className="alert alert-danger">
                {bulkUploadFileErrors.map((item) => <div key={item}>{item}</div>)}
              </div>
            )}
            {!!bulkUploadRows.length && !bulkUploadFileErrors.length && (
              <>
                <div className="bulk-upload-summary">
                  <span className="badge bg-green-lt text-green">{validBulkUploadRows.length} valid</span>
                  <span className="badge bg-red-lt text-red">{invalidBulkUploadRows.length} needs fix</span>
                </div>
                <div className="bulk-upload-preview table-responsive">
                  <table className="table card-table table-vcenter">
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Name</th>
                        <th>Contact</th>
                        <th>Location</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkUploadRows.slice(0, 8).map((row) => (
                        <tr key={row.rowNumber}>
                          <td>{row.rowNumber}</td>
                          <td>
                            <div className="fw-semibold">{[row.data.firstName, row.data.middleName, row.data.lastName].filter(Boolean).join(' ') || '-'}</div>
                            {!!row.errors.length && <div className="text-danger small">{row.errors.join(', ')}</div>}
                          </td>
                          <td>{row.data.contactNumber || '-'}</td>
                          <td>{[row.data.locationName, row.data.barangay, row.data.city].filter(Boolean).join(', ') || '-'}</td>
                          <td><span className={`badge ${row.errors.length ? 'bg-red-lt text-red' : 'bg-green-lt text-green'}`}>{row.errors.length ? 'Invalid' : 'Ready'}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {bulkUploadRows.length > 8 && <div className="text-muted small mt-2">Showing first 8 rows. All valid rows will be imported.</div>}
                </div>
                <div className="text-end mt-3">
                  <button className="btn btn-primary" disabled={!validBulkUploadRows.length || !!invalidBulkUploadRows.length || isBulkUploading} onClick={importBulkUploadRows}>
                    <IconUpload size={18} className="me-2" />{isBulkUploading ? 'Importing...' : `Import ${validBulkUploadRows.length} Customer${validBulkUploadRows.length === 1 ? '' : 's'}`}
                  </button>
                </div>
              </>
            )}
            {bulkUploadResult && (
              <div className={`alert ${bulkUploadResult.failed ? 'alert-warning' : 'alert-success'} mt-3 mb-0`}>
                <div>{bulkUploadResult.created} imported, {bulkUploadResult.failed} failed.</div>
                {bulkUploadResult.failures.map((failure) => <div key={failure.rowNumber}>Row {failure.rowNumber}: {failure.message}</div>)}
              </div>
            )}
            <div className="small text-muted mb-2">Required headers</div>
            <div className="bulk-header-list">
              {requiredBulkUploadHeaders.map((item) => <span className="badge bg-blue-lt text-blue" key={item}>{item}</span>)}
            </div>
          </div>
        </div>
      </div>
    )}
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
                <div className="col-md-6">
                  <label className="form-label">Location Management Record</label>
                  <select className="form-select" value={form.locationId || ''} onChange={(e) => applyLocation(e.target.value)}>
                    <option value="">Manual / create location on save</option>
                    {locations.map((location) => <option key={location.id} value={location.id}>{locationLabel(location)}</option>)}
                  </select>
                  <div className="form-hint">Missing customer locations are added to System Settings for completion later.</div>
                </div>
                <div className="col-md-6"><label className="form-label">Location Name</label><input className="form-control" value={form.locationName || ''} onChange={(e) => setForm({ ...form, locationName: e.target.value })} placeholder="Optional service-area label" /></div>
                <div className="col-md-6"><label className="form-label">Address Line 1</label><input className="form-control" value={form.addressLine1 || ''} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} /></div>
                <div className="col-md-6"><label className="form-label">Address Line 2</label><input className="form-control" value={form.addressLine2 || ''} onChange={(e) => setForm({ ...form, addressLine2: e.target.value })} /></div>
                <div className="col-md-3">
                  <label className="form-label">Province</label>
                  <input className="form-control" list="customer-province-options" value={form.province || ''} onChange={(e) => setForm({ ...form, province: normalizeUpper(e.target.value), city: '', barangay: '' })} />
                </div>
                <div className="col-md-3">
                  <label className="form-label">City</label>
                  <input className="form-control" list="customer-city-options" value={form.city || ''} onChange={(e) => setForm({ ...form, city: normalizeUpper(e.target.value), barangay: '' })} />
                </div>
                <div className="col-md-3">
                  <label className="form-label">Barangay</label>
                  <input className="form-control" list="customer-barangay-options" value={form.barangay || ''} onChange={(e) => setForm({ ...form, barangay: normalizeUpper(e.target.value) })} />
                </div>
                <datalist id="customer-province-options">{provinceOptions.map((item) => <option key={item} value={item} />)}</datalist>
                <datalist id="customer-city-options">{formCities.map((item) => <option key={item} value={item} />)}</datalist>
                <datalist id="customer-barangay-options">{formBarangays.map((item) => <option key={item} value={item} />)}</datalist>
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
                <dt>Location record</dt><dd>{selected.locationName || selected.locationId || '-'}</dd>
                <dt>Address</dt><dd>{formatCustomerAddress(selected)}</dd>
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
                <div className="fw-semibold mb-2">Service orders</div>
                {serviceOrders.map((order) => (
                  <div className="service-pill" key={order.id}>
                    <div>
                      <strong>{order.catalogName || order.catalog?.name || 'Service order'}</strong>
                      <span>{order.serviceReference || order.orderNumber}</span>
                    </div>
                    <span className={`badge ${statusClass(order.status)}`}>{order.status}</span>
                  </div>
                ))}
                {!serviceOrders.length && <div className="text-muted">No service orders.</div>}
              </div>
            </div>
          </div>
        </aside>
      </div>
    )}
    </>
  );
}
