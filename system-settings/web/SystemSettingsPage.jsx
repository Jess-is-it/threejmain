import React, { useEffect, useState } from 'react';
import {
  IconDatabase,
  IconDeviceFloppy,
  IconEdit,
  IconMapPin,
  IconNetwork,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconTrash,
  IconUserCog
} from '@tabler/icons-react';
import './systemSettings.css';

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
            <tr key={row.id || `${row.port}-${row.protocol}` || index}>
              {columns.map((column) => <td key={column}>{fmt(row[column])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, tone = 'blue' }) {
  return (
    <div className="col-sm-6 col-lg-3">
      <div className="card">
        <div className="card-body">
          <div className="d-flex align-items-center">
            <span className={`badge bg-${tone}-lt text-${tone} me-3 system-settings-kpi-icon`}>
              <Icon size={20} />
            </span>
            <div>
              <div className="text-muted small">{label}</div>
              <div className="h2 mb-0">{value}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <>
      <div className="modal modal-blur fade show d-block system-settings-modal" tabIndex="-1" role="dialog">
        <div className="modal-dialog modal-lg modal-dialog-centered">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">{title}</h5>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            <div className="modal-body">{children}</div>
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show" onClick={onClose} />
    </>
  );
}

function hasCoordinates(location) {
  return location.latitude !== null
    && location.latitude !== undefined
    && location.latitude !== ''
    && location.longitude !== null
    && location.longitude !== undefined
    && location.longitude !== '';
}

function LocationManagementTab() {
  const emptyForm = {
    location_name: '',
    address: '',
    municipality: '',
    barangay: '',
    province: '',
    region: '',
    latitude: '',
    longitude: '',
    geocode_source: '',
    raw_geocode: null,
    notes: ''
  };
  const [locations, setLocations] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setLocations(await request('/system-settings/locations'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openAddLocation() {
    setEditingId('');
    setForm(emptyForm);
    setSearchQuery('');
    setSearchResults([]);
    setError('');
    setMessage('');
    setModalOpen(true);
  }

  function editLocation(location) {
    setEditingId(location.id);
    setForm({
      location_name: location.location_name || '',
      address: location.address || '',
      municipality: location.municipality || '',
      barangay: location.barangay || '',
      province: location.province || '',
      region: location.region || '',
      latitude: location.latitude ?? '',
      longitude: location.longitude ?? '',
      geocode_source: location.geocode_source || 'MANUAL',
      raw_geocode: location.raw_geocode || null,
      notes: location.notes || ''
    });
    setSearchQuery('');
    setSearchResults([]);
    setError('');
    setMessage('');
    setModalOpen(true);
  }

  function closeLocationModal() {
    setModalOpen(false);
    setEditingId('');
    setForm(emptyForm);
    setSearchQuery('');
    setSearchResults([]);
  }

  async function searchAddress(e) {
    e.preventDefault();
    const query = searchQuery.trim();
    if (query.length < 3) {
      setError('Search text must be at least 3 characters.');
      return;
    }
    setError('');
    setMessage('');
    setSearching(true);
    try {
      const data = await request(`/system-settings/locations/search?q=${encodeURIComponent(query)}`);
      const results = data.results || [];
      setSearchResults(results);
      if (!results.length) setMessage('No address suggestions found. You can enter the address manually.');
    } catch (err) {
      setError(`${err.message}. You can still enter the location manually.`);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  function selectSuggestion(result) {
    setForm({
      ...form,
      location_name: form.location_name || result.barangay || result.municipality || '',
      address: result.address || result.display_name || '',
      municipality: result.municipality || '',
      barangay: result.barangay || '',
      province: result.province || '',
      region: result.region || '',
      latitude: result.latitude ?? '',
      longitude: result.longitude ?? '',
      geocode_source: result.geocode_source || 'NOMINATIM',
      raw_geocode: result.raw_geocode || result
    });
    setSearchResults([]);
  }

  async function saveLocation(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const body = {
        ...form,
        latitude: form.latitude === '' ? null : Number(form.latitude),
        longitude: form.longitude === '' ? null : Number(form.longitude),
        geocode_source: form.geocode_source || 'MANUAL'
      };
      const path = editingId ? `/system-settings/locations/${editingId}` : '/system-settings/locations';
      await request(path, { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      closeLocationModal();
      setMessage(editingId ? 'Location updated.' : 'Location saved.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteLocation(location) {
    if (!window.confirm(`Delete location "${location.location_name || location.address}"?`)) return;
    setError('');
    setMessage('');
    try {
      await request(`/system-settings/locations/${location.id}`, { method: 'DELETE' });
      setMessage('Location deleted.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  const counts = {
    total: locations.length,
    withCoordinates: locations.filter(hasCoordinates).length,
    municipalities: new Set(locations.map((location) => location.municipality).filter(Boolean)).size,
    barangays: new Set(locations.map((location) => location.barangay).filter(Boolean)).size
  };

  return (
    <div className="row row-cards system-settings-locations">
      <div className="col-12">
        <div className="alert alert-info">
          Location Management stores reusable addresses for site planning. Search can auto-fill municipality, barangay, latitude, and longitude when the geocoder has a match; manual entry is always available.
        </div>
      </div>
      {message && <div className="col-12"><div className="alert alert-success">{message}</div></div>}
      {error && <div className="col-12"><div className="alert alert-danger">{error}</div></div>}
      <KpiCard icon={IconMapPin} label="Locations" value={counts.total} tone="blue" />
      <KpiCard icon={IconDatabase} label="With Coordinates" value={counts.withCoordinates} tone="green" />
      <KpiCard icon={IconNetwork} label="Municipalities" value={counts.municipalities} tone="cyan" />
      <KpiCard icon={IconSettings} label="Barangays" value={counts.barangays} tone="purple" />
      <div className="col-12">
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title mb-1">Locations</h3>
              <div className="text-muted small">Saved deployment addresses with municipality, barangay, and coordinates.</div>
            </div>
            <div className="card-actions">
              <button className="btn btn-primary" type="button" onClick={openAddLocation}>
                <IconPlus size={18} className="me-2" />Add Location
              </button>
            </div>
          </div>
          {loading ? (
            <div className="empty">Loading locations...</div>
          ) : (
            <div className="table-responsive">
              <table className="table card-table table-vcenter">
                <thead>
                  <tr>
                    <th>Location</th>
                    <th>Address</th>
                    <th>Municipality</th>
                    <th>Barangay</th>
                    <th>Coordinates</th>
                    <th>Source</th>
                    <th>Created At</th>
                    <th className="w-1">Management</th>
                  </tr>
                </thead>
                <tbody>
                  {locations.map((location) => (
                    <tr key={location.id}>
                      <td className="fw-semibold">{location.location_name || 'Unnamed location'}</td>
                      <td className="system-settings-location-address">{location.address}</td>
                      <td>{location.municipality || 'n/a'}</td>
                      <td>{location.barangay || 'n/a'}</td>
                      <td>
                        {hasCoordinates(location)
                          ? <code>{Number(location.latitude).toFixed(6)}, {Number(location.longitude).toFixed(6)}</code>
                          : <span className="text-muted">n/a</span>}
                      </td>
                      <td><span className="badge bg-blue-lt">{location.geocode_source || 'MANUAL'}</span></td>
                      <td>{fmt(location.created_at)}</td>
                      <td>
                        <div className="btn-list flex-nowrap">
                          <button className="btn btn-icon btn-outline-primary" type="button" onClick={() => editLocation(location)} title="Edit location" aria-label="Edit location">
                            <IconEdit size={18} />
                          </button>
                          <button className="btn btn-icon btn-outline-danger" type="button" onClick={() => deleteLocation(location)} title="Delete location" aria-label="Delete location">
                            <IconTrash size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!locations.length && <tr><td colSpan="8" className="text-muted p-4">No locations saved yet.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {modalOpen && (
        <Modal title={editingId ? 'Edit Location' : 'Add Location'} onClose={closeLocationModal}>
          <form onSubmit={searchAddress} className="mb-3">
            <label className="form-label">Search Address</label>
            <div className="input-group">
              <input className="form-control" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search address, municipality, or barangay" />
              <button className="btn btn-outline-primary" type="submit" disabled={searching || searchQuery.trim().length < 3}>
                <IconSearch size={18} className="me-2" />{searching ? 'Searching...' : 'Search'}
              </button>
            </div>
          </form>
          {searchResults.length > 0 && (
            <div className="list-group mb-3">
              {searchResults.map((result, index) => (
                <button className="list-group-item list-group-item-action" type="button" key={`${result.display_name}-${index}`} onClick={() => selectSuggestion(result)}>
                  <div className="fw-semibold">{result.display_name}</div>
                  <div className="text-muted small">{[result.barangay, result.municipality, result.province].filter(Boolean).join(' / ') || 'Address suggestion'}</div>
                </button>
              ))}
            </div>
          )}
          <form onSubmit={saveLocation}>
            <div className="row g-3">
              <div className="col-md-6"><label className="form-label">Location Name</label><input className="form-control" value={form.location_name} onChange={(e) => setForm({ ...form, location_name: e.target.value })} /></div>
              <div className="col-md-6"><label className="form-label">Municipality</label><input className="form-control" value={form.municipality} onChange={(e) => setForm({ ...form, municipality: e.target.value })} /></div>
              <div className="col-12"><label className="form-label">Address</label><input className="form-control" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <div className="col-md-6"><label className="form-label">Barangay</label><input className="form-control" value={form.barangay} onChange={(e) => setForm({ ...form, barangay: e.target.value })} /></div>
              <div className="col-md-6"><label className="form-label">Province</label><input className="form-control" value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} /></div>
              <div className="col-md-6"><label className="form-label">Latitude</label><input className="form-control" type="number" step="any" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} /></div>
              <div className="col-md-6"><label className="form-label">Longitude</label><input className="form-control" type="number" step="any" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} /></div>
              <div className="col-md-6"><label className="form-label">Region</label><input className="form-control" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} /></div>
              <div className="col-md-6"><label className="form-label">Source</label><input className="form-control" value={form.geocode_source || 'MANUAL'} onChange={(e) => setForm({ ...form, geocode_source: e.target.value })} /></div>
              <div className="col-12"><label className="form-label">Notes</label><textarea className="form-control" rows="3" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <div className="modal-footer px-0 pb-0">
              <button type="button" className="btn" onClick={closeLocationModal}>Cancel</button>
              <button className="btn btn-primary" disabled={saving}>
                <IconDeviceFloppy size={18} className="me-2" />{saving ? 'Saving...' : editingId ? 'Update Location' : 'Save Location'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export default function SystemSettingsPage({ refreshShell }) {
  const tabs = ['General', 'Location Management', 'Ports', 'Access', 'Runtime'];
  const [tab, setTab] = useState('General');
  const [settings, setSettings] = useState(null);
  const [ports, setPorts] = useState([]);
  const [message, setMessage] = useState('');

  async function load() {
    const [nextSettings, nextPorts] = await Promise.all([
      request('/system-settings/settings'),
      request('/system-settings/ports')
    ]);
    setSettings(nextSettings);
    setPorts(nextPorts);
  }

  useEffect(() => {
    load().catch((err) => setMessage(err.message));
  }, []);

  async function save(e) {
    e.preventDefault();
    const saved = await request('/system-settings/settings', { method: 'PATCH', body: JSON.stringify(settings) });
    setSettings(saved);
    setMessage('Settings saved.');
    refreshShell?.();
  }

  if (!settings) return <div className="empty">Loading settings...</div>;

  return (
    <div className="system-settings-module">
      {message && <div className="alert alert-info">{message}</div>}
      <ul className="nav nav-tabs mb-3">
        {tabs.map((item) => (
          <li className="nav-item" key={item}>
            <button type="button" className={`nav-link ${tab === item ? 'active' : ''}`} onClick={() => setTab(item)}>{item}</button>
          </li>
        ))}
      </ul>
      {tab === 'General' && (
        <Card title="Branding and Business Profile" icon={IconSettings}>
          <form onSubmit={save}>
            <div className="row g-3">
              <div className="col-md-6">
                <label className="form-label">System Display Name</label>
                <input className="form-control" value={settings.branding.display_name || ''} onChange={(e) => setSettings({ ...settings, branding: { ...settings.branding, display_name: e.target.value } })} />
              </div>
              <div className="col-md-6">
                <label className="form-label">Subtitle</label>
                <input className="form-control" value={settings.branding.portal_subtitle || ''} onChange={(e) => setSettings({ ...settings, branding: { ...settings.branding, portal_subtitle: e.target.value } })} />
              </div>
              <div className="col-md-6">
                <label className="form-label">Business Name</label>
                <input className="form-control" value={settings.business.name || ''} onChange={(e) => setSettings({ ...settings, business: { ...settings.business, name: e.target.value } })} />
              </div>
              <div className="col-md-3">
                <label className="form-label">Currency</label>
                <input className="form-control" value={settings.business.billing_currency || ''} onChange={(e) => setSettings({ ...settings, business: { ...settings.business, billing_currency: e.target.value } })} />
              </div>
              <div className="col-md-3">
                <label className="form-label">Accent Color</label>
                <input className="form-control form-control-color" type="color" value={settings.branding.accent_color || '#206bc4'} onChange={(e) => setSettings({ ...settings, branding: { ...settings.branding, accent_color: e.target.value } })} />
              </div>
              <div className="col-12 text-end">
                <button className="btn btn-primary"><IconDeviceFloppy size={18} className="me-2" />Save Settings</button>
              </div>
            </div>
          </form>
        </Card>
      )}
      {tab === 'Location Management' && <LocationManagementTab />}
      {tab === 'Ports' && (
        <Card title="System Port Registry" icon={IconNetwork} actions={<button className="btn btn-sm" onClick={load}><IconRefresh size={16} className="me-1" />Refresh</button>}>
          <div className="alert alert-info">Use this page to avoid port collisions with 3JCentralPisowifi and other services on the server.</div>
          <Table rows={ports} columns={['port', 'protocol', 'scope', 'owner', 'service', 'status', 'notes']} />
        </Card>
      )}
      {tab === 'Access' && (
        <Card title="Admin Access" icon={IconUserCog}>
          <div className="alert alert-warning mb-0">The first shell has one local admin account. Role and permission management will live in the Account Admin module.</div>
        </Card>
      )}
      {tab === 'Runtime' && (
        <Card title="Runtime Paths" icon={IconDatabase}>
          <Table rows={[settings.deployment]} columns={['environment', 'main_repo', 'worktrees']} />
        </Card>
      )}
    </div>
  );
}
