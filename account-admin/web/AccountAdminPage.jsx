import React, { useEffect, useState } from 'react';
import {
  IconCircleCheck,
  IconCircleOff,
  IconDeviceFloppy,
  IconEdit,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconShieldLock,
  IconTrash,
  IconUserCog,
  IconUsers
} from '@tabler/icons-react';
import './accountAdmin.css';

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

function statusClass(status) {
  return status === 'ACTIVE' ? 'bg-green-lt text-green' : 'bg-yellow-lt text-yellow';
}

function fmt(value) {
  if (!value) return '-';
  return String(value);
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

function TextField({ label, value, onChange, type = 'text', required = false, placeholder = '' }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <input className="form-control" type={type} value={value ?? ''} required={required} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <select className="form-select" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </div>
  );
}

const blankAccount = {
  id: '',
  username: '',
  password: '',
  fullName: '',
  email: '',
  phone: '',
  status: 'ACTIVE',
  notes: ''
};

export default function AccountAdminPage({ refreshShell = () => {} }) {
  const [activeTab, setActiveTab] = useState('Overview');
  const [meta, setMeta] = useState({ accountStatuses: ['ACTIVE', 'INACTIVE'] });
  const [overview, setOverview] = useState({ metrics: {}, recentAccounts: [], inactiveAccounts: [], notes: [] });
  const [accounts, setAccounts] = useState([]);
  const [filters, setFilters] = useState({ search: '', status: '' });
  const [form, setForm] = useState(blankAccount);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load(nextFilters = filters) {
    setError('');
    try {
      const query = new URLSearchParams();
      if (nextFilters.search) query.set('search', nextFilters.search);
      if (nextFilters.status) query.set('status', nextFilters.status);
      const suffix = query.toString() ? `?${query.toString()}` : '';
      const [nextMeta, nextOverview, nextAccounts] = await Promise.all([
        request('/account-admin/meta'),
        request('/account-admin/overview'),
        request(`/account-admin/accounts${suffix}`)
      ]);
      setMeta(nextMeta);
      setOverview(nextOverview);
      setAccounts(nextAccounts);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  function resetForm() {
    setForm(blankAccount);
  }

  function editAccount(account) {
    setForm({
      id: account.id,
      username: account.username || '',
      password: '',
      fullName: account.fullName || '',
      email: account.email || '',
      phone: account.phone || '',
      status: account.status || 'ACTIVE',
      notes: account.notes || ''
    });
    setActiveTab('Accounts');
  }

  async function saveAccount(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    const payload = {
      username: form.username,
      fullName: form.fullName,
      email: form.email,
      phone: form.phone,
      status: form.status,
      notes: form.notes
    };
    if (form.password) payload.password = form.password;
    try {
      if (form.id) {
        await request(`/account-admin/accounts/${form.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        setMessage('Account updated.');
      } else {
        await request('/account-admin/accounts', { method: 'POST', body: JSON.stringify(payload) });
        setMessage('Account created.');
      }
      resetForm();
      await load();
      refreshShell();
    } catch (err) {
      setError(err.message);
    }
  }

  async function changeStatus(account, action) {
    setError('');
    setMessage('');
    try {
      await request(`/account-admin/accounts/${account.id}/${action}`, { method: 'POST' });
      setMessage(action === 'activate' ? 'Account activated.' : 'Account deactivated.');
      await load();
      refreshShell();
    } catch (err) {
      setError(err.message);
    }
  }

  async function archiveAccount(account) {
    setError('');
    setMessage('');
    try {
      await request(`/account-admin/accounts/${account.id}`, { method: 'DELETE' });
      if (form.id === account.id) resetForm();
      setMessage('Account archived.');
      await load();
      refreshShell();
    } catch (err) {
      setError(err.message);
    }
  }

  function applyFilters(e) {
    e.preventDefault();
    load(filters);
  }

  return (
    <div className="account-admin-module">
      {message && <div className="alert alert-info">{message}</div>}
      {error && <div className="alert alert-danger">{error}</div>}

      <ul className="nav nav-tabs mb-3">
        {['Overview', 'Accounts'].map((item) => (
          <li className="nav-item" key={item}>
            <button className={`nav-link ${activeTab === item ? 'active' : ''}`} onClick={() => setActiveTab(item)}>{item}</button>
          </li>
        ))}
      </ul>

      {activeTab === 'Overview' && (
        <div className="row row-cards">
          {[
            ['Accounts', overview.metrics.accounts, IconUsers, 'blue'],
            ['Active', overview.metrics.active, IconCircleCheck, 'green'],
            ['Inactive', overview.metrics.inactive, IconCircleOff, 'yellow']
          ].map(([label, value, Icon, tone]) => (
            <div className="col-sm-6 col-lg-4" key={label}>
              <div className="card status-card">
                <div className="card-body">
                  <span className={`badge bg-${tone}-lt text-${tone} mb-3`}><Icon size={18} /></span>
                  <div className="h1 mb-0">{value ?? 0}</div>
                  <div className="text-muted">{label}</div>
                </div>
              </div>
            </div>
          ))}
          <div className="col-lg-7">
            <Card title="Recent Accounts" icon={IconUserCog}>
              <AccountTable accounts={overview.recentAccounts || []} compact />
            </Card>
          </div>
          <div className="col-lg-5">
            <Card title="Current Scope" icon={IconShieldLock}>
              {(overview.notes || []).map((note) => <div className="alert alert-info mb-2" key={note}>{note}</div>)}
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Accounts' && (
        <div className="row row-cards">
          <div className="col-12 col-xl-4">
            <Card title={form.id ? 'Edit Account' : 'Create Account'} icon={form.id ? IconEdit : IconPlus}>
              <form onSubmit={saveAccount}>
                <div className="row g-3">
                  <div className="col-12">
                    <TextField label="Username" value={form.username} required onChange={(value) => setForm({ ...form, username: value })} />
                  </div>
                  <div className="col-12">
                    <TextField label="Full Name" value={form.fullName} required onChange={(value) => setForm({ ...form, fullName: value })} />
                  </div>
                  <div className="col-12">
                    <TextField label={form.id ? 'Password (leave blank to keep)' : 'Password'} type="password" value={form.password} required={!form.id} onChange={(value) => setForm({ ...form, password: value })} />
                  </div>
                  <div className="col-12">
                    <TextField label="Email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} />
                  </div>
                  <div className="col-12">
                    <TextField label="Phone" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} />
                  </div>
                  <div className="col-12">
                    <SelectField label="Status" value={form.status} options={meta.accountStatuses || ['ACTIVE', 'INACTIVE']} onChange={(value) => setForm({ ...form, status: value })} />
                  </div>
                  <div className="col-12">
                    <label className="form-label">Notes</label>
                    <textarea className="form-control" rows="3" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                  </div>
                  <div className="col-12 d-flex justify-content-end gap-2">
                    {form.id && <button className="btn" type="button" onClick={resetForm}>Cancel</button>}
                    <button className="btn btn-primary"><IconDeviceFloppy size={18} className="me-2" />Save Account</button>
                  </div>
                </div>
              </form>
            </Card>
          </div>
          <div className="col-12 col-xl-8">
            <Card
              title="Admin Accounts"
              icon={IconUsers}
              actions={<button className="btn btn-sm" onClick={() => load()}><IconRefresh size={16} className="me-1" />Refresh</button>}
            >
              <form className="account-admin-filters" onSubmit={applyFilters}>
                <div className="input-icon">
                  <span className="input-icon-addon"><IconSearch size={16} /></span>
                  <input className="form-control" placeholder="Search username, name, email, phone" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
                </div>
                <select className="form-select" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                  <option value="">All statuses</option>
                  {(meta.accountStatuses || []).map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
                <button className="btn btn-primary">Filter</button>
              </form>
              <AccountTable accounts={accounts} selectedId={form.id} onEdit={editAccount} onActivate={(account) => changeStatus(account, 'activate')} onDeactivate={(account) => changeStatus(account, 'deactivate')} onArchive={archiveAccount} />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function AccountTable({ accounts, selectedId = '', onEdit, onActivate, onDeactivate, onArchive, compact = false }) {
  if (!accounts?.length) return <div className="empty">No accounts found.</div>;
  return (
    <div className="table-responsive">
      <table className="table card-table table-vcenter account-admin-table">
        <thead>
          <tr>
            <th>Account</th>
            {!compact && <th>Contact</th>}
            <th>Status</th>
            {!compact && <th>Last Login</th>}
            {!compact && <th className="text-end">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.id} className={selectedId === account.id ? 'table-active' : ''}>
              <td>
                <div className="fw-semibold">{account.fullName}</div>
                <div className="text-muted">@{account.username}</div>
              </td>
              {!compact && (
                <td>
                  <div>{fmt(account.email)}</div>
                  <div className="text-muted">{fmt(account.phone)}</div>
                </td>
              )}
              <td><span className={`badge ${statusClass(account.status)}`}>{account.status}</span></td>
              {!compact && <td>{fmt(account.lastLoginAt)}</td>}
              {!compact && (
                <td className="text-end">
                  <div className="btn-list justify-content-end flex-nowrap">
                    <button className="btn btn-sm" onClick={() => onEdit(account)}><IconEdit size={16} className="me-1" />Edit</button>
                    {account.status === 'ACTIVE' ? (
                      <button className="btn btn-sm btn-outline-warning" onClick={() => onDeactivate(account)}><IconCircleOff size={16} className="me-1" />Deactivate</button>
                    ) : (
                      <button className="btn btn-sm btn-outline-success" onClick={() => onActivate(account)}><IconCircleCheck size={16} className="me-1" />Activate</button>
                    )}
                    <button className="btn btn-sm btn-outline-danger" onClick={() => onArchive(account)}><IconTrash size={16} className="me-1" />Archive</button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
