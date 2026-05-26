import React, { useEffect, useState } from 'react';
import {
  IconBrandOpenai,
  IconCircleCheck,
  IconCircleOff,
  IconCopy,
  IconDatabase,
  IconDeviceFloppy,
  IconEdit,
  IconKey,
  IconMapPin,
  IconMail,
  IconNetwork,
  IconPhoto,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconRobot,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconShieldLock,
  IconSparkles,
  IconTrash,
  IconUpload,
  IconUserPlus,
  IconUsers
} from '@tabler/icons-react';
import { CUSTOMER_AVATAR_GENDERS, DEFAULT_CUSTOMER_EMOTION_SETTINGS } from './avatarEmotion';
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

const AVATAR_UPLOAD_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
const DEFAULT_AVATAR_MAX_BYTES = 1048576;

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUsdPerMTok(value) {
  if (value === null || value === undefined || value === '') return '-';
  const numeric = Number(value);
  const precision = numeric < 1 ? 3 : 2;
  return `$${numeric.toFixed(precision).replace(/\.?0+$/, '')}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to read avatar image.'));
    reader.readAsDataURL(file);
  });
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
  const [bulkSelectEnabled, setBulkSelectEnabled] = useState(false);
  const [selectedLocationIds, setSelectedLocationIds] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);

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

  useEffect(() => {
    setSelectedLocationIds((currentIds) => currentIds.filter((id) => locations.some((location) => location.id === id)));
  }, [locations]);

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

  function toggleBulkSelect(enabled) {
    setBulkSelectEnabled(enabled);
    setSelectedLocationIds([]);
  }

  function toggleLocationSelection(locationId, checked) {
    setSelectedLocationIds((currentIds) => {
      if (checked) return currentIds.includes(locationId) ? currentIds : [...currentIds, locationId];
      return currentIds.filter((id) => id !== locationId);
    });
  }

  function toggleLocationRowSelection(locationId) {
    setSelectedLocationIds((currentIds) => (
      currentIds.includes(locationId)
        ? currentIds.filter((id) => id !== locationId)
        : [...currentIds, locationId]
    ));
  }

  function handleLocationRowKeyDown(e, locationId) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    toggleLocationRowSelection(locationId);
  }

  function toggleAllLocations(checked) {
    setSelectedLocationIds(checked ? locations.map((location) => location.id).filter(Boolean) : []);
  }

  async function deleteSelectedLocations() {
    const selectedCount = selectedLocationIds.length;
    if (!selectedCount) return;
    if (!window.confirm(`Delete ${selectedCount} selected location${selectedCount === 1 ? '' : 's'}?`)) return;
    setBulkDeleting(true);
    setError('');
    setMessage('');
    try {
      const result = await request('/system-settings/locations/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids: selectedLocationIds })
      });
      const deletedCount = result.deleted ?? selectedCount;
      setSelectedLocationIds([]);
      setMessage(`${deletedCount} selected ${deletedCount === 1 ? 'location was' : 'locations were'} deleted.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBulkDeleting(false);
    }
  }

  const counts = {
    total: locations.length,
    withCoordinates: locations.filter(hasCoordinates).length,
    municipalities: new Set(locations.map((location) => location.municipality).filter(Boolean)).size,
    barangays: new Set(locations.map((location) => location.barangay).filter(Boolean)).size
  };
  const selectedLocationIdSet = new Set(selectedLocationIds);
  const selectableLocationIds = locations.map((location) => location.id).filter(Boolean);
  const allLocationsSelected = selectableLocationIds.length > 0
    && selectableLocationIds.every((locationId) => selectedLocationIdSet.has(locationId));

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
              <div className="system-settings-location-actions">
                <label className="btn btn-outline-secondary system-settings-select-switch">
                  <span className="form-check form-switch mb-0 system-settings-select-switch-control">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      role="switch"
                      checked={bulkSelectEnabled}
                      onChange={(e) => toggleBulkSelect(e.target.checked)}
                    />
                    <span className="form-check-label">Multiple select</span>
                  </span>
                </label>
                {bulkSelectEnabled ? (
                  <button className="btn btn-danger" type="button" onClick={deleteSelectedLocations} disabled={!selectedLocationIds.length || bulkDeleting}>
                    <IconTrash size={18} className="me-2" />{bulkDeleting ? 'Deleting...' : `Delete selected${selectedLocationIds.length ? ` (${selectedLocationIds.length})` : ''}`}
                  </button>
                ) : (
                  <button className="btn btn-primary" type="button" onClick={openAddLocation}>
                    <IconPlus size={18} className="me-2" />Add Location
                  </button>
                )}
              </div>
            </div>
          </div>
          {loading ? (
            <div className="empty">Loading locations...</div>
          ) : (
            <div className="table-responsive">
              <table className="table card-table table-vcenter">
                <thead>
                  <tr>
                    {bulkSelectEnabled && (
                      <th className="system-settings-location-select">
                        <input
                          className="form-check-input m-0"
                          type="checkbox"
                          checked={allLocationsSelected}
                          onChange={(e) => toggleAllLocations(e.target.checked)}
                          disabled={!locations.length}
                          aria-label="Select all locations"
                        />
                      </th>
                    )}
                    <th>Location</th>
                    <th>Address</th>
                    <th>Municipality</th>
                    <th>Barangay</th>
                    <th>Coordinates</th>
                    <th>Source</th>
                    <th>Created At</th>
                    {!bulkSelectEnabled && <th className="w-1">Management</th>}
                  </tr>
                </thead>
                <tbody>
                  {locations.map((location) => {
                    const selected = selectedLocationIdSet.has(location.id);
                    return (
                      <tr
                        key={location.id}
                        className={bulkSelectEnabled ? `system-settings-location-row-select${selected ? ' is-selected' : ''}` : undefined}
                        tabIndex={bulkSelectEnabled ? 0 : undefined}
                        aria-selected={bulkSelectEnabled ? selected : undefined}
                        onClick={bulkSelectEnabled ? () => toggleLocationRowSelection(location.id) : undefined}
                        onKeyDown={bulkSelectEnabled ? (e) => handleLocationRowKeyDown(e, location.id) : undefined}
                      >
                        {bulkSelectEnabled && (
                          <td className="system-settings-location-select">
                            <input
                              className="form-check-input m-0"
                              type="checkbox"
                              checked={selected}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => toggleLocationSelection(location.id, e.target.checked)}
                              aria-label={`Select ${location.location_name || location.address || 'location'}`}
                            />
                          </td>
                        )}
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
                        {!bulkSelectEnabled && <td>
                          <div className="btn-list flex-nowrap">
                            <button className="btn btn-icon btn-outline-primary" type="button" onClick={() => editLocation(location)} title="Edit location" aria-label="Edit location">
                              <IconEdit size={18} />
                            </button>
                            <button className="btn btn-icon btn-outline-danger" type="button" onClick={() => deleteLocation(location)} title="Delete location" aria-label="Delete location">
                              <IconTrash size={18} />
                            </button>
                          </div>
                        </td>}
                      </tr>
                    );
                  })}
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

function AvatarTab() {
  const [avatarConfig, setAvatarConfig] = useState(null);
  const [avatarView, setAvatarView] = useState('uploads');
  const [settingsForm, setSettingsForm] = useState(DEFAULT_CUSTOMER_EMOTION_SETTINGS);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyAvatarId, setBusyAvatarId] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  async function loadAvatars() {
    setLoading(true);
    try {
      const nextConfig = await request('/system-settings/avatars');
      setAvatarConfig(nextConfig);
      setSettingsForm(nextConfig.emotion_settings || DEFAULT_CUSTOMER_EMOTION_SETTINGS);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAvatars();
  }, []);

  async function uploadAvatar(gender, emotion, file, input) {
    if (!file) return;
    const maxBytes = avatarConfig?.max_bytes || DEFAULT_AVATAR_MAX_BYTES;
    setError('');
    setMessage('');
    if (!AVATAR_UPLOAD_ACCEPT.split(',').includes(file.type)) {
      setError('Accepted avatar image formats are PNG, JPG/JPEG, WebP, and GIF.');
      input.value = '';
      return;
    }
    if (file.size > maxBytes) {
      setError(`Avatar image must be ${formatBytes(maxBytes)} or smaller.`);
      input.value = '';
      return;
    }
    const busyKey = `${gender.id}:${emotion.id}`;
    setBusyAvatarId(busyKey);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const nextConfig = await request(`/system-settings/avatars/${gender.id}/${emotion.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          data_url: dataUrl,
          file_name: file.name,
          mime_type: file.type
        })
      });
      setAvatarConfig(nextConfig);
      setSettingsForm(nextConfig.emotion_settings || DEFAULT_CUSTOMER_EMOTION_SETTINGS);
      setMessage(`${gender.label} ${emotion.label} avatar saved.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyAvatarId('');
      input.value = '';
    }
  }

  async function removeAvatar(gender, emotion) {
    if (!window.confirm(`Remove the ${gender.label} ${emotion.label} avatar?`)) return;
    setBusyAvatarId(`${gender.id}:${emotion.id}`);
    setError('');
    setMessage('');
    try {
      const nextConfig = await request(`/system-settings/avatars/${gender.id}/${emotion.id}`, { method: 'DELETE' });
      setAvatarConfig(nextConfig);
      setSettingsForm(nextConfig.emotion_settings || DEFAULT_CUSTOMER_EMOTION_SETTINGS);
      setMessage(`${gender.label} ${emotion.label} avatar removed.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyAvatarId('');
    }
  }

  function updateEmotionSetting(section, key, value) {
    setSettingsForm((current) => ({
      ...current,
      [section]: {
        ...(current?.[section] || {}),
        [key]: Number(value)
      }
    }));
  }

  async function saveEmotionSettings(event) {
    event.preventDefault();
    setSavingSettings(true);
    setError('');
    setMessage('');
    try {
      const nextConfig = await request('/system-settings/avatar-emotion-settings', {
        method: 'PATCH',
        body: JSON.stringify(settingsForm)
      });
      setAvatarConfig(nextConfig);
      setSettingsForm(nextConfig.emotion_settings || DEFAULT_CUSTOMER_EMOTION_SETTINGS);
      setMessage('Avatar emotion guide saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingSettings(false);
    }
  }

  const emotions = avatarConfig?.emotions || [];
  const genders = avatarConfig?.genders?.length ? avatarConfig.genders : CUSTOMER_AVATAR_GENDERS;
  const savedCount = emotions.reduce((total, emotion) => total + genders.filter((gender) => emotion.avatars?.[gender.id]).length, 0);
  const maxBytes = avatarConfig?.max_bytes || DEFAULT_AVATAR_MAX_BYTES;
  const thresholds = settingsForm?.thresholds || DEFAULT_CUSTOMER_EMOTION_SETTINGS.thresholds;
  const weights = settingsForm?.weights || DEFAULT_CUSTOMER_EMOTION_SETTINGS.weights;

  const settingLabels = {
    happy_min: 'Happy from score',
    warning_max: 'Warning at or below',
    angry_max: 'Angry at or below',
    customer_active: 'Customer active',
    customer_pending: 'Customer pending',
    customer_inactive: 'Customer inactive',
    customer_suspended: 'Customer suspended',
    service_active: 'Service active',
    service_pending: 'Service pending',
    service_suspended: 'Service suspended',
    service_disconnected: 'Service disconnected',
    no_service_account: 'No service account',
    open_service_order: 'Open service order',
    completed_service_order: 'Completed service order',
    overdue_billing: 'Overdue billing',
    open_invoice: 'Open invoice',
    urgent_ticket: 'Urgent ticket',
    high_ticket: 'High priority ticket',
    open_ticket: 'Open ticket',
    resolved_ticket: 'Resolved ticket'
  };

  const weightGroups = [
    ['Customer Profiling', ['customer_active', 'customer_pending', 'customer_inactive', 'customer_suspended']],
    ['Service', ['service_active', 'service_pending', 'service_suspended', 'service_disconnected', 'no_service_account', 'open_service_order', 'completed_service_order']],
    ['Billing', ['overdue_billing', 'open_invoice']],
    ['Ticketing', ['urgent_ticket', 'high_ticket', 'open_ticket', 'resolved_ticket']]
  ];

  return (
    <div className="row row-cards system-settings-avatars">
      <div className="col-12">
        <div className="alert alert-info">
          Customer-information screens can use these avatar moods to match account context such as active service, outages, support follow-up, maintenance, billing warnings, or resolved tickets.
        </div>
      </div>
      <div className="col-12">
        <div className="alert alert-secondary mb-0">
          Accepted avatar image formats: PNG, JPG/JPEG, WebP, and GIF. Maximum upload size is {formatBytes(maxBytes)} per image; square transparent PNG or WebP images around 512 x 512 px are recommended.
        </div>
      </div>
      {message && <div className="col-12"><div className="alert alert-success">{message}</div></div>}
      {error && <div className="col-12"><div className="alert alert-danger">{error}</div></div>}
      <KpiCard icon={IconPhoto} label="Avatar Moods" value={emotions.length || '-'} tone="blue" />
      <KpiCard icon={IconDatabase} label="Uploaded" value={savedCount} tone="green" />
      <KpiCard icon={IconSettings} label="Formats" value="PNG JPG WebP GIF" tone="cyan" />
      <KpiCard icon={IconNetwork} label="Max Size" value={formatBytes(maxBytes)} tone="purple" />
      <div className="col-12">
        <ul className="nav nav-tabs" role="tablist" aria-label="Avatar configuration tabs">
          {[
            ['uploads', 'Uploads'],
            ['settings', 'Settings']
          ].map(([id, label]) => (
            <li className="nav-item" role="presentation" key={id}>
              <button className={`nav-link ${avatarView === id ? 'active' : ''}`} type="button" role="tab" aria-selected={avatarView === id} onClick={() => setAvatarView(id)}>
                {label}
              </button>
            </li>
          ))}
        </ul>
      </div>
      {loading ? (
        <div className="col-12"><div className="empty">Loading avatar settings...</div></div>
      ) : avatarView === 'settings' ? (
        <div className="col-12">
          <form className="card" onSubmit={saveEmotionSettings}>
            <div className="card-body">
              <div className="row g-3">
                <div className="col-12">
                  <h3 className="card-title mb-1">Emotion Guide</h3>
                  <div className="text-muted small">Scores start at 0. Positive signals move customer behavior toward happy, and negative signals move it toward warning or angry.</div>
                </div>
                {Object.keys(thresholds).map((key) => (
                  <div className="col-md-4" key={key}>
                    <label className="form-label">{settingLabels[key] || key}</label>
                    <input className="form-control" type="number" min="-100" max="100" value={thresholds[key]} onChange={(e) => updateEmotionSetting('thresholds', key, e.target.value)} />
                  </div>
                ))}
                {weightGroups.map(([group, keys]) => (
                  <div className="col-lg-6" key={group}>
                    <div className="system-settings-emotion-group">
                      <div className="fw-semibold mb-2">{group}</div>
                      <div className="row g-2">
                        {keys.map((key) => (
                          <div className="col-md-6" key={key}>
                            <label className="form-label">{settingLabels[key] || key}</label>
                            <input className="form-control" type="number" min="-75" max="75" value={weights[key]} onChange={(e) => updateEmotionSetting('weights', key, e.target.value)} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
                {!!avatarConfig?.emotion_guide?.length && (
                  <div className="col-12">
                    <div className="system-settings-emotion-guide-list">
                      {avatarConfig.emotion_guide.map((item) => (
                        <div key={item.module}>
                          <span className="badge bg-blue-lt text-blue">{item.module}</span>
                          <div className="fw-semibold">{item.signal}</div>
                          <div className="text-muted small">{item.description}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="card-footer text-end">
              <button className="btn btn-primary" disabled={savingSettings}>
                <IconDeviceFloppy size={18} className="me-2" />{savingSettings ? 'Saving...' : 'Save Emotion Guide'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        emotions.map((emotion) => {
          return (
            <div className="col-md-6 col-xl-4" key={emotion.id}>
              <div className="card system-settings-avatar-card">
                <div className="card-body">
                  <div className="system-settings-avatar-card-header">
                    <div>
                      <h3 className="card-title mb-1">{emotion.label}</h3>
                      <div className="text-muted small">{emotion.description}</div>
                    </div>
                  </div>
                  <div className="system-settings-avatar-gender-grid">
                    {genders.map((gender) => {
                      const avatar = emotion.avatars?.[gender.id] || null;
                      const inputId = `avatar-upload-${gender.id}-${emotion.id}`;
                      const busy = busyAvatarId === `${gender.id}:${emotion.id}`;
                      return (
                        <div className="system-settings-avatar-gender-card" key={gender.id}>
                          <div className="system-settings-avatar-preview">
                            {avatar?.data_url ? (
                              <img src={avatar.data_url} alt={`${gender.label} ${emotion.label} avatar`} />
                            ) : (
                              <IconPhoto size={30} className="text-muted" />
                            )}
                          </div>
                          <div className="system-settings-avatar-meta">
                            <span className="badge bg-blue-lt text-blue">{gender.label}</span>
                            <span className="badge bg-secondary-lt">{avatar ? avatar.mime_type : 'No image'}</span>
                            <span className="text-muted small">{avatar ? `${avatar.file_name || 'avatar'} · ${formatBytes(avatar.byte_size)}` : 'Upload avatar.'}</span>
                          </div>
                          <div className="btn-list mt-3">
                            <input
                              id={inputId}
                              className="d-none"
                              type="file"
                              accept={AVATAR_UPLOAD_ACCEPT}
                              onChange={(e) => uploadAvatar(gender, emotion, e.target.files?.[0], e.target)}
                            />
                            <label className={`btn btn-outline-primary btn-sm ${busy ? 'disabled' : ''}`} htmlFor={busy ? undefined : inputId} aria-disabled={busy}>
                              <IconUpload size={16} className="me-2" />{busy ? 'Saving...' : avatar ? 'Replace' : 'Upload'}
                            </label>
                            {avatar && (
                              <button className="btn btn-outline-danger btn-sm" type="button" onClick={() => removeAvatar(gender, emotion)} disabled={busy}>
                                <IconTrash size={16} className="me-2" />Remove
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

const DEFAULT_OPENAI_TEST_PROMPT = 'Reply with one short sentence confirming this OpenAI API key works for 3J ISP Management.';

const OPENAI_REASONING_FALLBACK_LABELS = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high'
};

function reasoningEffortsForModel(model, allEfforts = []) {
  const ids = Array.isArray(model?.reasoning_efforts) && model.reasoning_efforts.length
    ? model.reasoning_efforts
    : String(model?.reasoning || '')
      .split(',')
      .map((effort) => effort.trim())
      .filter(Boolean);
  const effortById = new Map((allEfforts || []).map((effort) => [effort.id, effort]));
  return ids.map((id) => effortById.get(id) || {
    id,
    label: OPENAI_REASONING_FALLBACK_LABELS[id] || id,
    description: ''
  });
}

function defaultReasoningEffortForModel(model, allEfforts = []) {
  const efforts = reasoningEffortsForModel(model, allEfforts);
  if (efforts.some((effort) => effort.id === 'medium')) return 'medium';
  return efforts[0]?.id || '';
}

function OpenAISettingsTab() {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({
    api_key: '',
    selected_model: '',
    reasoning_effort: '',
    organization_id: '',
    project_id: ''
  });
  const [testPrompt, setTestPrompt] = useState(DEFAULT_OPENAI_TEST_PROMPT);
  const [maxOutputTokens, setMaxOutputTokens] = useState(120);
  const [testResult, setTestResult] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  async function loadOpenAISettings() {
    setLoading(true);
    try {
      const nextConfig = await request('/system-settings/openai');
      setConfig(nextConfig);
      setForm({
        api_key: '',
        selected_model: nextConfig.selected_model || '',
        reasoning_effort: nextConfig.selected_reasoning_effort || '',
        organization_id: nextConfig.organization_id || '',
        project_id: nextConfig.project_id || ''
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOpenAISettings();
  }, []);

  const selectedModel = config?.models?.find((model) => model.id === form.selected_model)
    || config?.selected_model_config
    || config?.models?.[0]
    || null;
  const selectedReasoningEfforts = reasoningEffortsForModel(selectedModel, config?.reasoning_efforts);
  const selectedReasoningEffort = selectedReasoningEfforts.find((effort) => effort.id === form.reasoning_effort)
    || selectedReasoningEfforts.find((effort) => effort.id === defaultReasoningEffortForModel(selectedModel, config?.reasoning_efforts))
    || selectedReasoningEfforts[0]
    || null;
  const activeReasoningEffortId = selectedReasoningEffort?.id || form.reasoning_effort || '';
  const pricingSource = config?.pricing_source || {};

  function updateSelectedModel(modelId) {
    const nextModel = config?.models?.find((model) => model.id === modelId);
    const nextEfforts = reasoningEffortsForModel(nextModel, config?.reasoning_efforts);
    const currentEffortStillSupported = nextEfforts.some((effort) => effort.id === form.reasoning_effort);
    setForm({
      ...form,
      selected_model: modelId,
      reasoning_effort: currentEffortStillSupported
        ? form.reasoning_effort
        : defaultReasoningEffortForModel(nextModel, config?.reasoning_efforts)
    });
  }

  async function saveOpenAISettings(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        selected_model: form.selected_model,
        reasoning_effort: activeReasoningEffortId,
        organization_id: form.organization_id,
        project_id: form.project_id
      };
      if (form.api_key.trim()) payload.api_key = form.api_key.trim();
      const nextConfig = await request('/system-settings/openai', {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      setConfig(nextConfig);
      setForm({
        api_key: '',
        selected_model: nextConfig.selected_model || '',
        reasoning_effort: nextConfig.selected_reasoning_effort || '',
        organization_id: nextConfig.organization_id || '',
        project_id: nextConfig.project_id || ''
      });
      setMessage('OpenAI settings saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function clearOpenAIKey() {
    if (!window.confirm('Remove the saved OpenAI API key?')) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const nextConfig = await request('/system-settings/openai', {
        method: 'PATCH',
        body: JSON.stringify({ clear_api_key: true })
      });
      setConfig(nextConfig);
      setForm((current) => ({ ...current, api_key: '' }));
      setMessage('OpenAI API key removed.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function runOpenAITest(event) {
    event.preventDefault();
    setTesting(true);
    setError('');
    setMessage('');
    setTestResult(null);
    try {
      const result = await request('/system-settings/openai/test', {
        method: 'POST',
        body: JSON.stringify({
          model_id: form.selected_model,
          reasoning_effort: activeReasoningEffortId,
          prompt: testPrompt,
          max_output_tokens: Number(maxOutputTokens)
        })
      });
      setTestResult(result);
      setMessage('OpenAI API test completed.');
    } catch (err) {
      setError(err.message);
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <div className="empty">Loading OpenAI settings...</div>;

  return (
    <div className="row row-cards system-settings-openai">
      <div className="col-12">
        <div className="alert alert-info">
          OpenAI settings are stored server-side and the saved API key is masked after saving. Pricing shown is {pricingSource.unit || 'USD per 1M tokens'} from {pricingSource.label || 'OpenAI pricing'}.
        </div>
      </div>
      {message && <div className="col-12"><div className="alert alert-success">{message}</div></div>}
      {error && <div className="col-12"><div className="alert alert-danger">{error}</div></div>}
      <KpiCard icon={IconKey} label="API Key" value={config?.api_key_configured ? 'Saved' : 'Missing'} tone={config?.api_key_configured ? 'green' : 'orange'} />
      <KpiCard icon={IconRobot} label="Selected Model" value={selectedModel?.id || '-'} tone="blue" />
      <KpiCard icon={IconSparkles} label="Reasoning" value={selectedReasoningEffort?.label || '-'} tone="cyan" />
      <KpiCard icon={IconShieldLock} label="Output Price" value={`${formatUsdPerMTok(selectedModel?.prices?.output)} / 1M`} tone="purple" />

      <div className="col-lg-5">
        <Card title="API Configuration" icon={IconBrandOpenai}>
          <form onSubmit={saveOpenAISettings}>
            <div className="row g-3">
              <div className="col-12">
                <label className="form-label">OpenAI API Key</label>
                <input
                  className="form-control"
                  type="password"
                  autoComplete="off"
                  value={form.api_key}
                  onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                  placeholder={config?.api_key_configured ? `Saved key: ${config.api_key_hint}` : 'sk-...'}
                />
                <div className="form-hint">Leave blank to keep the saved key.</div>
              </div>
              <div className="col-md-6">
                <label className="form-label">Model</label>
                <select className="form-select" value={form.selected_model} onChange={(e) => updateSelectedModel(e.target.value)}>
                  {(config?.models || []).map((model) => (
                    <option value={model.id} key={model.id}>{model.label} - {model.category}</option>
                  ))}
                </select>
              </div>
              <div className="col-md-6">
                <label className="form-label">Reasoning Effort</label>
                <select className="form-select" value={activeReasoningEffortId} onChange={(e) => setForm({ ...form, reasoning_effort: e.target.value })}>
                  {selectedReasoningEfforts.map((effort) => (
                    <option value={effort.id} key={effort.id}>{effort.label}</option>
                  ))}
                </select>
                <div className="form-hint">{selectedReasoningEffort?.description || 'Controls reasoning token use for supported models.'}</div>
              </div>
              <div className="col-md-6">
                <label className="form-label">Organization ID</label>
                <input className="form-control" value={form.organization_id} onChange={(e) => setForm({ ...form, organization_id: e.target.value })} placeholder="Optional" />
              </div>
              <div className="col-md-6">
                <label className="form-label">Project ID</label>
                <input className="form-control" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} placeholder="Optional" />
              </div>
              {selectedModel && (
                <div className="col-12">
                  <div className="system-settings-openai-model-summary">
                    <span className="badge bg-blue-lt text-blue">{selectedModel.category}</span>
                    <div className="fw-semibold">{selectedModel.label}</div>
                    <div className="text-muted small">{selectedModel.recommended_for}</div>
                    <div className="system-settings-openai-model-meta">
                      <span>Context: {selectedModel.context_window}</span>
                      <span>Max output: {selectedModel.max_output}</span>
                      <span>Reasoning choices: {selectedModel.reasoning}</span>
                      <span>Selected effort: {selectedReasoningEffort?.label || '-'}</span>
                    </div>
                  </div>
                </div>
              )}
              <div className="col-12">
                <div className="btn-list justify-content-end">
                  {config?.api_key_configured && (
                    <button className="btn btn-outline-danger" type="button" onClick={clearOpenAIKey} disabled={saving}>
                      <IconTrash size={18} className="me-2" />Clear Key
                    </button>
                  )}
                  <button className="btn btn-primary" disabled={saving}>
                    <IconDeviceFloppy size={18} className="me-2" />{saving ? 'Saving...' : 'Save OpenAI Settings'}
                  </button>
                </div>
              </div>
            </div>
          </form>
        </Card>
      </div>

      <div className="col-lg-7">
        <Card title="Test API" icon={IconPlayerPlay}>
          <form onSubmit={runOpenAITest}>
            <div className="row g-3">
              <div className="col-12">
                <label className="form-label">Test Prompt</label>
                <textarea className="form-control" rows="4" value={testPrompt} onChange={(e) => setTestPrompt(e.target.value)} />
              </div>
              <div className="col-md-4">
                <label className="form-label">Max Output Tokens</label>
                <input className="form-control" type="number" min="16" max="512" value={maxOutputTokens} onChange={(e) => setMaxOutputTokens(e.target.value)} />
              </div>
              <div className="col-md-8 d-flex align-items-end justify-content-end">
                <button className="btn btn-primary" disabled={testing || !config?.api_key_configured || !testPrompt.trim()}>
                  <IconPlayerPlay size={18} className="me-2" />{testing ? 'Testing...' : 'Run Test'}
                </button>
              </div>
              {!config?.api_key_configured && (
                <div className="col-12">
                  <div className="alert alert-warning mb-0">Save an OpenAI API key before running a test.</div>
                </div>
              )}
              {testResult && (
                <div className="col-12">
                  <div className="system-settings-openai-test-result">
                    <div className="d-flex flex-wrap gap-2 mb-2">
                      <span className="badge bg-green-lt text-green">Connected</span>
                      <span className="badge bg-blue-lt text-blue">{testResult.model}</span>
                      <span className="badge bg-purple-lt text-purple">{testResult.reasoning_effort}</span>
                      <span className="badge bg-secondary-lt">{testResult.latency_ms} ms</span>
                    </div>
                    <pre>{testResult.output_text || 'No text output returned.'}</pre>
                    {testResult.usage && (
                      <div className="text-muted small">Usage: {JSON.stringify(testResult.usage)}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </form>
        </Card>
      </div>

      <div className="col-12">
        <Card
          title="Model Pricing"
          icon={IconDatabase}
          actions={pricingSource.url && <a className="btn btn-sm btn-outline-primary" href={pricingSource.url} target="_blank" rel="noreferrer">Open Pricing</a>}
        >
          <div className="table-responsive">
            <table className="table card-table table-vcenter system-settings-openai-pricing-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Category</th>
                  <th>Input</th>
                  <th>Cached Input</th>
                  <th>Output</th>
                  <th>Context</th>
                  <th>Reasoning</th>
                  <th>Recommended For</th>
                </tr>
              </thead>
              <tbody>
                {(config?.models || []).map((model) => (
                  <tr key={model.id} className={model.id === form.selected_model ? 'table-active' : undefined}>
                    <td className="fw-semibold">{model.id}</td>
                    <td><span className="badge bg-blue-lt text-blue">{model.category}</span></td>
                    <td>{formatUsdPerMTok(model.prices?.input)}</td>
                    <td>{formatUsdPerMTok(model.prices?.cached_input)}</td>
                    <td>{formatUsdPerMTok(model.prices?.output)}</td>
                    <td>{model.context_window}</td>
                    <td>{model.reasoning}</td>
                    <td className="system-settings-openai-recommendation">{model.recommended_for}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-muted small mt-3">
            Source checked {pricingSource.checked_at || 'recently'}. {pricingSource.note}
          </div>
        </Card>
      </div>
    </div>
  );
}

const blankRole = {
  id: '',
  name: '',
  description: '',
  permissionCodes: []
};

const blankUser = {
  id: '',
  username: '',
  email: '',
  fullName: '',
  roleId: '',
  password: '',
  isActive: true,
  mustChangePassword: false
};

function PermissionSelector({ groups, selectedCodes, disabled = false, onToggle }) {
  const [query, setQuery] = useState('');
  const selected = new Set(selectedCodes || []);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredGroups = (groups || [])
    .map((group) => ({
      ...group,
      permissions: (group.permissions || []).filter((permission) => {
        if (!normalizedQuery) return true;
        return `${permission.code} ${permission.label} ${permission.description}`.toLowerCase().includes(normalizedQuery);
      })
    }))
    .filter((group) => group.permissions.length);

  return (
    <div className="system-settings-permission-selector">
      <div className="input-icon mb-3">
        <span className="input-icon-addon"><IconSearch size={16} /></span>
        <input className="form-control" placeholder="Search permissions" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="system-settings-permission-groups">
        {filteredGroups.map((group) => (
          <details className="system-settings-permission-group" open key={group.category}>
            <summary>
              <span className="fw-semibold">{group.category}</span>
              <span className="badge bg-secondary-lt text-secondary ms-2">{group.permissions.length}</span>
            </summary>
            <div className="system-settings-permission-list">
              {group.permissions.map((permission) => (
                <label className="form-check system-settings-permission-row" key={permission.code}>
                  <input
                    className="form-check-input"
                    type="checkbox"
                    checked={selected.has(permission.code)}
                    disabled={disabled}
                    onChange={() => onToggle(permission.code)}
                  />
                  <span className="form-check-label">
                    <span className="fw-semibold">{permission.label || permission.code}</span>
                    <code className="ms-2">{permission.code}</code>
                    <span className="text-muted d-block small">{permission.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function AccessTab() {
  const [accessTab, setAccessTab] = useState('Auth Settings');
  const [access, setAccess] = useState(null);
  const [authForm, setAuthForm] = useState(null);
  const [roleForm, setRoleForm] = useState(blankRole);
  const [userForm, setUserForm] = useState(blankUser);
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [resetPassword, setResetPassword] = useState('');

  async function loadAccess() {
    setError('');
    try {
      const data = await request('/system-settings/access');
      setAccess(data);
      setAuthForm(data.authSettings);
      if (!userForm.roleId && data.roles?.[0]?.id) {
        setUserForm((current) => ({ ...current, roleId: data.roles[0].id }));
      }
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadAccess();
  }, []);

  if (!access || !authForm) return <div className="empty">Loading access settings...</div>;

  const roleById = new Map((access.roles || []).map((role) => [role.id, role]));

  function patchAuth(updates) {
    setAuthForm({ ...authForm, ...updates });
  }

  function patchSmtp(updates) {
    setAuthForm({ ...authForm, smtp: { ...(authForm.smtp || {}), ...updates } });
  }

  async function saveAuthSettings(event) {
    event.preventDefault();
    setMessage('');
    setError('');
    try {
      const data = await request('/system-settings/access/auth-settings', { method: 'PATCH', body: JSON.stringify(authForm) });
      setAccess(data);
      setAuthForm(data.authSettings);
      setMessage('Access settings saved.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function testSmtpEmail() {
    setMessage('');
    setError('');
    try {
      const recipientEmail = window.prompt('Send test email to:') || '';
      if (!recipientEmail.trim()) return;
      const data = await request('/system-settings/access/auth-settings/test-email', {
        method: 'POST',
        body: JSON.stringify({ recipientEmail })
      });
      setMessage(data.message || 'SMTP test sent.');
    } catch (err) {
      setError(err.message);
    }
  }

  function openRole(role = null) {
    setResetPassword('');
    setRoleForm(role ? {
      id: role.id,
      name: role.name || '',
      description: role.description || '',
      permissionCodes: role.permissionCodes || []
    } : blankRole);
    setRoleModalOpen(true);
  }

  function toggleRolePermission(code) {
    const selected = new Set(roleForm.permissionCodes || []);
    if (selected.has(code)) selected.delete(code);
    else selected.add(code);
    setRoleForm({ ...roleForm, permissionCodes: Array.from(selected).sort() });
  }

  async function saveRole(event) {
    event.preventDefault();
    setMessage('');
    setError('');
    const path = roleForm.id ? `/system-settings/access/roles/${roleForm.id}` : '/system-settings/access/roles';
    const method = roleForm.id ? 'PATCH' : 'POST';
    try {
      const data = await request(path, {
        method,
        body: JSON.stringify({
          name: roleForm.name,
          description: roleForm.description,
          permissionCodes: roleForm.permissionCodes
        })
      });
      setAccess(data);
      setRoleModalOpen(false);
      setMessage(data.autoAddedPermissionCodes?.length
        ? `${data.message} Required permissions auto-added: ${data.autoAddedPermissionCodes.join(', ')}.`
        : data.message || 'Role saved.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteRole(role) {
    if (!window.confirm(`Delete role "${role.name}"?`)) return;
    setMessage('');
    setError('');
    try {
      setAccess(await request(`/system-settings/access/roles/${role.id}`, { method: 'DELETE' }));
      setMessage('Role deleted.');
    } catch (err) {
      setError(err.message);
    }
  }

  function openUser(user = null) {
    setResetPassword('');
    setUserForm(user ? {
      id: user.id,
      username: user.username || '',
      email: user.email || '',
      fullName: user.fullName || '',
      roleId: user.roleId || access.roles?.[0]?.id || '',
      password: '',
      isActive: Boolean(user.isActive),
      mustChangePassword: Boolean(user.mustChangePassword)
    } : { ...blankUser, roleId: access.roles?.[0]?.id || '' });
    setUserModalOpen(true);
  }

  async function saveUser(event) {
    event.preventDefault();
    setMessage('');
    setError('');
    const path = userForm.id ? `/system-settings/access/users/${userForm.id}` : '/system-settings/access/users';
    const method = userForm.id ? 'PATCH' : 'POST';
    const payload = { ...userForm };
    if (userForm.id && !payload.password) delete payload.password;
    try {
      setAccess(await request(path, { method, body: JSON.stringify(payload) }));
      setUserModalOpen(false);
      setMessage(userForm.id ? 'User updated.' : 'User created.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function resetUserPassword(user, emailTemporaryPassword = false) {
    const promptLabel = emailTemporaryPassword ? 'Optional explicit temporary password. Leave blank to generate and email one.' : 'Optional new password. Leave blank to generate one.';
    const newPassword = window.prompt(promptLabel) || '';
    setMessage('');
    setError('');
    setResetPassword('');
    try {
      const data = await request(`/system-settings/access/users/${user.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword: newPassword.trim() || null, emailTemporaryPassword })
      });
      setAccess(data);
      if (data.temporaryPassword) setResetPassword(data.temporaryPassword);
      setMessage(data.message || 'Password reset.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteUser(user) {
    if (!window.confirm(`Delete user "${user.username}"?`)) return;
    setMessage('');
    setError('');
    try {
      setAccess(await request(`/system-settings/access/users/${user.id}`, { method: 'DELETE' }));
      setMessage('User deleted.');
    } catch (err) {
      setError(err.message);
    }
  }

  const tabs = ['Auth Settings', 'Permissions', 'Roles', 'Users'];

  return (
    <div className="system-settings-access">
      {message && <div className="alert alert-info">{message}</div>}
      {error && <div className="alert alert-danger">{error}</div>}
      {resetPassword && (
        <div className="alert alert-warning d-flex align-items-center justify-content-between gap-2">
          <div>
            <div className="fw-semibold">Temporary password generated</div>
            <code>{resetPassword}</code>
          </div>
          <button className="btn btn-sm" type="button" onClick={() => navigator.clipboard?.writeText(resetPassword)}>
            <IconCopy size={16} className="me-1" />Copy
          </button>
        </div>
      )}

      <div className="row row-cards mb-3">
        <KpiCard icon={IconShieldLock} label="Permissions" value={access.metrics.permissions} tone="blue" />
        <KpiCard icon={IconShieldCheck} label="Roles" value={access.metrics.roles} tone="green" />
        <KpiCard icon={IconUsers} label="Users" value={access.metrics.users} tone="purple" />
        <KpiCard icon={IconCircleCheck} label="Active Users" value={access.metrics.activeUsers} tone="cyan" />
      </div>

      <ul className="nav nav-tabs mb-3">
        {tabs.map((item) => (
          <li className="nav-item" key={item}>
            <button type="button" className={`nav-link ${accessTab === item ? 'active' : ''}`} onClick={() => setAccessTab(item)}>{item}</button>
          </li>
        ))}
      </ul>

      {accessTab === 'Auth Settings' && (
        <Card title="Authentication & Session" icon={IconKey}>
          <form onSubmit={saveAuthSettings}>
            <div className="row g-3">
              <div className="col-md-4">
                <label className="form-label">Enable Authentication</label>
                <label className="form-check form-switch">
                  <input className="form-check-input" type="checkbox" checked={Boolean(authForm.enabled)} onChange={(event) => patchAuth({ enabled: event.target.checked })} />
                  <span className="form-check-label">Require login for all pages</span>
                </label>
              </div>
              <div className="col-md-4">
                <label className="form-label">Session Timeout (hours)</label>
                <input className="form-control" type="number" min="1" max="72" value={authForm.sessionIdleHours || 8} onChange={(event) => patchAuth({ sessionIdleHours: Number(event.target.value) })} />
                <div className="form-hint">Idle timeout per user session.</div>
              </div>
              <div className="col-md-4">
                <label className="form-label">Audit Retention (days)</label>
                <input className="form-control" type="number" min="30" max="3650" value={authForm.auditRetentionDays || 180} onChange={(event) => patchAuth({ auditRetentionDays: Number(event.target.value) })} />
                <div className="form-hint">System keeps access logs for this period.</div>
              </div>
            </div>
            <hr />
            <h4 className="mb-3">Forgot Password Email (SMTP)</h4>
            <div className="row g-3">
              <div className="col-md-4">
                <label className="form-label">SMTP Host</label>
                <input className="form-control" value={authForm.smtp?.host || ''} onChange={(event) => patchSmtp({ host: event.target.value })} />
              </div>
              <div className="col-md-2">
                <label className="form-label">Port</label>
                <input className="form-control" type="number" min="1" max="65535" value={authForm.smtp?.port || 587} onChange={(event) => patchSmtp({ port: Number(event.target.value) })} />
              </div>
              <div className="col-md-3">
                <label className="form-label">Username</label>
                <input className="form-control" value={authForm.smtp?.username || ''} onChange={(event) => patchSmtp({ username: event.target.value })} />
              </div>
              <div className="col-md-3">
                <label className="form-label">Password</label>
                <input className="form-control" type="password" placeholder={authForm.smtp?.passwordConfigured ? 'Saved (leave blank to keep)' : 'Enter password'} value={authForm.smtp?.password || ''} onChange={(event) => patchSmtp({ password: event.target.value, clearPassword: false })} />
                <label className="form-check mt-2">
                  <input className="form-check-input" type="checkbox" checked={Boolean(authForm.smtp?.clearPassword)} onChange={(event) => patchSmtp({ clearPassword: event.target.checked, password: '' })} />
                  <span className="form-check-label">Clear saved password</span>
                </label>
              </div>
              <div className="col-md-4">
                <label className="form-label">From Email</label>
                <input className="form-control" type="email" value={authForm.smtp?.fromEmail || ''} onChange={(event) => patchSmtp({ fromEmail: event.target.value })} />
              </div>
              <div className="col-md-4">
                <label className="form-label">From Name</label>
                <input className="form-control" value={authForm.smtp?.fromName || ''} onChange={(event) => patchSmtp({ fromName: event.target.value })} />
              </div>
              <div className="col-md-2">
                <label className="form-label">TLS</label>
                <label className="form-check form-switch">
                  <input className="form-check-input" type="checkbox" checked={Boolean(authForm.smtp?.useTls)} onChange={(event) => patchSmtp({ useTls: event.target.checked })} />
                  <span className="form-check-label">STARTTLS</span>
                </label>
              </div>
              <div className="col-md-2">
                <label className="form-label">SSL</label>
                <label className="form-check form-switch">
                  <input className="form-check-input" type="checkbox" checked={Boolean(authForm.smtp?.useSsl)} onChange={(event) => patchSmtp({ useSsl: event.target.checked })} />
                  <span className="form-check-label">SMTPS</span>
                </label>
              </div>
              <div className="col-12 text-end">
                <button className="btn btn-outline-primary me-2" type="button" onClick={testSmtpEmail}><IconMail size={18} className="me-2" />Test SMTP Email</button>
                <button className="btn btn-primary"><IconDeviceFloppy size={18} className="me-2" />Save Access Settings</button>
              </div>
            </div>
          </form>
        </Card>
      )}

      {accessTab === 'Permissions' && (
        <Card title="Permission Catalog" icon={IconShieldLock}>
          <div className="alert alert-info">Permissions are system-managed and predefined. Use the Roles tab to assign or remove permissions.</div>
          <div className="table-responsive">
            <table className="table card-table table-vcenter">
              <thead><tr><th>Feature</th><th>Code</th><th>Description</th></tr></thead>
              <tbody>
                {(access.permissionGroups || []).flatMap((group) => group.permissions.map((permission, index) => (
                  <tr key={permission.code}>
                    <td>{index === 0 && <span className="badge bg-secondary-lt text-secondary">{group.category}</span>}</td>
                    <td><code>{permission.code}</code></td>
                    <td className="text-muted small">{permission.description}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {accessTab === 'Roles' && (
        <Card title="Roles" icon={IconShieldCheck} actions={<button className="btn btn-primary btn-sm" type="button" onClick={() => openRole()}><IconPlus size={16} className="me-1" />Add Role</button>}>
          <div className="alert alert-info">Pre-created roles: owner, admin, and viewer. Owner is locked with full permissions.</div>
          <div className="table-responsive">
            <table className="table card-table table-vcenter">
              <thead><tr><th>Role</th><th>Description</th><th>Assigned Permissions</th><th className="text-end">Actions</th></tr></thead>
              <tbody>
                {(access.roles || []).map((role) => (
                  <tr key={role.id}>
                    <td>
                      <div className="fw-semibold">{role.name}</div>
                      {role.isLocked && <span className="badge bg-yellow-lt text-yellow me-1">Locked</span>}
                      {role.isBuiltin && <span className="badge bg-secondary-lt text-secondary">Built-in</span>}
                    </td>
                    <td className="text-muted small">{role.description || '-'}</td>
                    <td>
                      <span className="text-muted small">{role.permissionPreview || 'No permissions'}</span>
                      <span className="badge bg-secondary-lt text-secondary ms-2">{role.permissionCount}</span>
                    </td>
                    <td className="text-end">
                      <div className="btn-list justify-content-end">
                        <button className="btn btn-sm" type="button" onClick={() => openRole(role)}><IconEdit size={16} className="me-1" />Edit</button>
                        {!role.isBuiltin && !role.isLocked && (
                          <button className="btn btn-sm btn-outline-danger" type="button" onClick={() => deleteRole(role)}><IconTrash size={16} className="me-1" />Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {accessTab === 'Users' && (
        <Card title="Users" icon={IconUsers} actions={<button className="btn btn-primary btn-sm" type="button" onClick={() => openUser()}><IconUserPlus size={16} className="me-1" />Add User</button>}>
          <div className="table-responsive">
            <table className="table card-table table-vcenter">
              <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Force Change</th><th>Last Login</th><th className="text-end">Actions</th></tr></thead>
              <tbody>
                {(access.users || []).map((user) => {
                  const role = roleById.get(user.roleId);
                  const ownerUser = role?.name === 'owner';
                  return (
                    <tr key={user.id}>
                      <td>
                        <div className="fw-semibold">{user.username}</div>
                        <div className="text-muted small">{user.fullName || '-'}</div>
                        <div className="text-muted small">{user.email || '-'}</div>
                      </td>
                      <td>{user.roleName || '-'}</td>
                      <td><span className={`badge ${user.isActive ? 'bg-green-lt text-green' : 'bg-yellow-lt text-yellow'}`}>{user.isActive ? 'ACTIVE' : 'INACTIVE'}</span></td>
                      <td>{user.mustChangePassword ? <IconCircleCheck size={18} className="text-green" /> : <IconCircleOff size={18} className="text-muted" />}</td>
                      <td className="text-muted small">{user.lastLoginAt || 'n/a'}</td>
                      <td className="text-end">
                        <div className="btn-list justify-content-end">
                          <button className="btn btn-sm" type="button" onClick={() => openUser(user)}><IconEdit size={16} className="me-1" />Edit</button>
                          <button className="btn btn-sm btn-outline-primary" type="button" onClick={() => resetUserPassword(user, false)}><IconKey size={16} className="me-1" />Reset</button>
                          <button className="btn btn-sm btn-outline-primary" type="button" onClick={() => resetUserPassword(user, true)}><IconMail size={16} className="me-1" />Email Reset</button>
                          {!ownerUser && <button className="btn btn-sm btn-outline-danger" type="button" onClick={() => deleteUser(user)}><IconTrash size={16} className="me-1" />Delete</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {roleModalOpen && (
        <Modal title={roleForm.id ? `Edit Role - ${roleForm.name}` : 'Add Role'} onClose={() => setRoleModalOpen(false)}>
          <form onSubmit={saveRole}>
            <div className="row g-3">
              <div className="col-md-4">
                <label className="form-label">Role Name</label>
                <input className="form-control" value={roleForm.name} required disabled={roleForm.name === 'owner'} onChange={(event) => setRoleForm({ ...roleForm, name: event.target.value })} />
              </div>
              <div className="col-md-8">
                <label className="form-label">Description</label>
                <input className="form-control" value={roleForm.description} disabled={roleForm.name === 'owner'} onChange={(event) => setRoleForm({ ...roleForm, description: event.target.value })} />
              </div>
              <div className="col-12">
                {roleForm.name === 'owner' && <div className="alert alert-warning">Owner role is locked. It always keeps full permissions and cannot be edited.</div>}
                <PermissionSelector groups={access.permissionGroups} selectedCodes={roleForm.permissionCodes} disabled={roleForm.name === 'owner'} onToggle={toggleRolePermission} />
              </div>
              <div className="col-12 text-end">
                <button className="btn me-2" type="button" onClick={() => setRoleModalOpen(false)}>Cancel</button>
                {roleForm.name !== 'owner' && <button className="btn btn-primary"><IconDeviceFloppy size={18} className="me-2" />Save Role</button>}
              </div>
            </div>
          </form>
        </Modal>
      )}

      {userModalOpen && (
        <Modal title={userForm.id ? `Edit User - ${userForm.username}` : 'Add User'} onClose={() => setUserModalOpen(false)}>
          <form onSubmit={saveUser}>
            <div className="row g-3">
              <div className="col-md-4">
                <label className="form-label">Username</label>
                <input className="form-control" value={userForm.username} required disabled={Boolean(userForm.id)} onChange={(event) => setUserForm({ ...userForm, username: event.target.value })} />
              </div>
              <div className="col-md-4">
                <label className="form-label">Email</label>
                <input className="form-control" type="email" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} />
              </div>
              <div className="col-md-4">
                <label className="form-label">Full Name</label>
                <input className="form-control" value={userForm.fullName} onChange={(event) => setUserForm({ ...userForm, fullName: event.target.value })} />
              </div>
              <div className="col-md-6">
                <label className="form-label">Role</label>
                <select className="form-select" value={userForm.roleId} disabled={roleById.get(userForm.roleId)?.name === 'owner'} onChange={(event) => setUserForm({ ...userForm, roleId: event.target.value })}>
                  {(access.roles || []).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
              </div>
              <div className="col-md-6">
                <label className="form-label">{userForm.id ? 'Password (leave blank to keep)' : 'Password'}</label>
                <input className="form-control" type="password" value={userForm.password} required={!userForm.id} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} />
              </div>
              <div className="col-md-6">
                <label className="form-check">
                  <input className="form-check-input" type="checkbox" checked={Boolean(userForm.isActive)} disabled={roleById.get(userForm.roleId)?.name === 'owner'} onChange={(event) => setUserForm({ ...userForm, isActive: event.target.checked })} />
                  <span className="form-check-label">Active</span>
                </label>
              </div>
              <div className="col-md-6">
                <label className="form-check">
                  <input className="form-check-input" type="checkbox" checked={Boolean(userForm.mustChangePassword)} onChange={(event) => setUserForm({ ...userForm, mustChangePassword: event.target.checked })} />
                  <span className="form-check-label">Require password change on next login</span>
                </label>
              </div>
              <div className="col-12 text-end">
                <button className="btn me-2" type="button" onClick={() => setUserModalOpen(false)}>Cancel</button>
                <button className="btn btn-primary"><IconDeviceFloppy size={18} className="me-2" />Save User</button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export default function SystemSettingsPage({ refreshShell }) {
  const tabs = ['General', 'Location Management', 'Avatar', 'OPENAI', 'Access', 'Ports', 'Runtime'];
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
      {tab === 'Avatar' && <AvatarTab />}
      {tab === 'OPENAI' && <OpenAISettingsTab />}
      {tab === 'Access' && <AccessTab />}
      {tab === 'Ports' && (
        <Card title="System Port Registry" icon={IconNetwork} actions={<button className="btn btn-sm" onClick={load}><IconRefresh size={16} className="me-1" />Refresh</button>}>
          <div className="alert alert-info">Use this page to avoid port collisions with 3JCentralPisowifi and other services on the server.</div>
          <Table rows={ports} columns={['port', 'protocol', 'scope', 'owner', 'service', 'status', 'notes']} />
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
