import React, { useEffect, useMemo, useState } from 'react';
import {
  IconAlertTriangle,
  IconBell,
  IconBrandOpenai,
  IconCircleCheck,
  IconCircleOff,
  IconCopy,
  IconClock,
  IconDatabase,
  IconDeviceFloppy,
  IconEdit,
  IconInfoCircle,
  IconKey,
  IconListDetails,
  IconMap,
  IconMapPin,
  IconMail,
  IconMessageCircle,
  IconNetwork,
  IconPhoto,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconRobot,
  IconSearch,
  IconSend,
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
import {
  DEFAULT_MAP_PROVIDER_SETTINGS,
  MAP_PROVIDER_TYPES,
  isProviderConfigured,
  isProviderUsable,
  mapProviderTypeLabel,
  normalizeMapProviderId,
  normalizeMapProviderSettings
} from './mapProviders';
import './systemSettings.css';

const API = '/api';
const MAP_PROVIDER_VENDOR_META = {
  google: { label: 'Google', tone: 'blue' },
  esri: { label: 'Esri', tone: 'cyan' },
  openstreetmap: { label: 'OpenStreetMap', tone: 'green' },
  tomtom: { label: 'TomTom', tone: 'red' },
  maptiler: { label: 'MapTiler', tone: 'teal' },
  mapbox: { label: 'Mapbox', tone: 'indigo' },
  custom: { label: 'Custom', tone: 'purple' },
  other: { label: 'Other', tone: 'secondary' }
};
const MAP_PROVIDER_VENDOR_ORDER = ['google', 'esri', 'openstreetmap', 'tomtom', 'maptiler', 'mapbox', 'custom', 'other'];

function mapProviderVendorId(provider) {
  if (!provider?.builtIn) return 'custom';
  const haystack = `${provider.id || ''} ${provider.label || ''}`.toLowerCase();
  if (haystack.includes('google')) return 'google';
  if (haystack.includes('esri') || haystack.includes('arcgis')) return 'esri';
  if (haystack.includes('openstreetmap') || haystack.includes('osm')) return 'openstreetmap';
  if (haystack.includes('tomtom')) return 'tomtom';
  if (haystack.includes('maptiler')) return 'maptiler';
  if (haystack.includes('mapbox')) return 'mapbox';
  return 'other';
}

function mapProviderVendorLabel(vendorId) {
  return MAP_PROVIDER_VENDOR_META[vendorId]?.label || 'Other';
}

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

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to read image.'));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to read backup file.'));
    reader.readAsText(file);
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

function MapsTab() {
  const [config, setConfig] = useState(normalizeMapProviderSettings(DEFAULT_MAP_PROVIDER_SETTINGS));
  const [providerDrafts, setProviderDrafts] = useState(normalizeMapProviderSettings(DEFAULT_MAP_PROVIDER_SETTINGS).providers);
  const [defaultProviderId, setDefaultProviderId] = useState(DEFAULT_MAP_PROVIDER_SETTINGS.defaultProviderId);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeProviderVendor, setActiveProviderVendor] = useState('google');
  const [activeProviderType, setActiveProviderType] = useState('street');

  function applyMapProviderConfig(nextConfig) {
    const normalized = normalizeMapProviderSettings(nextConfig);
    setConfig(nextConfig);
    setProviderDrafts(normalized.providers);
    setDefaultProviderId(normalized.defaultProviderId);
  }

  async function loadMapProviders() {
    setLoading(true);
    setError('');
    try {
      applyMapProviderConfig(await request('/system-settings/map-providers'));
    } catch (err) {
      setError(err.message);
      applyMapProviderConfig(DEFAULT_MAP_PROVIDER_SETTINGS);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMapProviders();
  }, []);

  function updateProvider(providerId, patch) {
    setProviderDrafts((current) => current.map((provider) => (
      provider.id === providerId
        ? {
          ...provider,
          ...patch,
          requiresApiKey: patch.tileUrl !== undefined
            ? String(patch.tileUrl || '').includes('{apiKey}') || String(patch.tileUrl || '').includes('{token}') || provider.requiresApiKey
            : provider.requiresApiKey
        }
        : provider
    )));
  }

  function addCustomProvider() {
    const id = `custom-${Date.now()}`;
    setProviderDrafts((current) => ([
      ...current,
      {
        id,
        label: 'Custom XYZ Tiles',
        type: 'custom',
        tileUrl: 'https://example.com/tiles/{z}/{x}/{y}.png',
        attribution: '',
        minZoom: 1,
        maxZoom: 19,
        enabled: false,
        builtIn: false,
        requiresApiKey: false,
        apiKey: '',
        notes: 'Replace with a production tile URL.'
      }
    ]));
    setActiveProviderVendor('custom');
    setActiveProviderType('custom');
  }

  function removeCustomProvider(providerId) {
    const provider = providerDrafts.find((item) => item.id === providerId);
    if (!provider || provider.builtIn) return;
    if (!window.confirm(`Remove ${provider.label || provider.id}?`)) return;
    setProviderDrafts((current) => current.filter((item) => item.id !== providerId));
    if (defaultProviderId === providerId) setDefaultProviderId(DEFAULT_MAP_PROVIDER_SETTINGS.defaultProviderId);
  }

  async function saveMapProviders(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = normalizeMapProviderSettings({
        defaultProviderId,
        providers: providerDrafts.map((provider) => ({
          ...provider,
          id: normalizeMapProviderId(provider.id, provider.label)
        }))
      });
      const nextConfig = await request('/system-settings/map-providers', {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      applyMapProviderConfig(nextConfig);
      setMessage('Map provider options saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const usableProviders = providerDrafts.filter(isProviderUsable);
  const enabledProviders = providerDrafts.filter((provider) => provider.enabled);
  const customProviders = providerDrafts.filter((provider) => !provider.builtIn);
  const providerGroups = useMemo(() => {
    const grouped = new Map();
    providerDrafts.forEach((provider) => {
      const vendorId = mapProviderVendorId(provider);
      if (!grouped.has(vendorId)) {
        grouped.set(vendorId, {
          id: vendorId,
          label: mapProviderVendorLabel(vendorId),
          tone: MAP_PROVIDER_VENDOR_META[vendorId]?.tone || 'secondary',
          providers: []
        });
      }
      grouped.get(vendorId).providers.push(provider);
    });
    return [...grouped.values()].sort((left, right) => {
      const leftOrder = MAP_PROVIDER_VENDOR_ORDER.indexOf(left.id);
      const rightOrder = MAP_PROVIDER_VENDOR_ORDER.indexOf(right.id);
      return (leftOrder === -1 ? 99 : leftOrder) - (rightOrder === -1 ? 99 : rightOrder) || left.label.localeCompare(right.label);
    });
  }, [providerDrafts]);
  const activeProviderGroup = providerGroups.find((group) => group.id === activeProviderVendor) || providerGroups[0];
  const providerTypeTabs = useMemo(() => {
    if (!activeProviderGroup) return [];
    const byType = new Map();
    activeProviderGroup.providers.forEach((provider) => {
      if (!byType.has(provider.type)) {
        byType.set(provider.type, {
          id: provider.type,
          label: mapProviderTypeLabel(provider.type),
          providers: []
        });
      }
      byType.get(provider.type).providers.push(provider);
    });
    return [...byType.values()].sort((left, right) => {
      const leftIndex = MAP_PROVIDER_TYPES.findIndex((type) => type.id === left.id);
      const rightIndex = MAP_PROVIDER_TYPES.findIndex((type) => type.id === right.id);
      return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex) || left.label.localeCompare(right.label);
    });
  }, [activeProviderGroup]);
  const activeProviderTypeTab = providerTypeTabs.find((type) => type.id === activeProviderType) || providerTypeTabs[0];
  const visibleProviders = activeProviderTypeTab?.providers || [];
  const guidelines = config?.guidelines || [
    'Use XYZ raster tile URL templates with {z}, {x}, and {y} placeholders.',
    'Use {apiKey} or {token} in the URL when a provider requires a browser-side public key.',
    'Google Maps built-in providers use the official Map Tiles API session flow and require a Google API key with Map Tiles API enabled.',
    'Set the provider max zoom to the highest zoom level that returns real tiles in your service area.'
  ];

  useEffect(() => {
    if (!providerGroups.length) return;
    if (!providerGroups.some((group) => group.id === activeProviderVendor)) {
      setActiveProviderVendor(providerGroups[0].id);
    }
  }, [providerGroups, activeProviderVendor]);

  useEffect(() => {
    if (!providerTypeTabs.length) return;
    if (!providerTypeTabs.some((type) => type.id === activeProviderType)) {
      setActiveProviderType(providerTypeTabs[0].id);
    }
  }, [providerTypeTabs, activeProviderType]);

  function renderProviderCard(provider) {
    const configured = isProviderConfigured(provider);
    const usable = isProviderUsable(provider);
    return (
      <div className="system-settings-map-provider-card" key={provider.id}>
        <div className="system-settings-map-provider-status">
          <label className="form-check form-switch m-0">
            <input className="form-check-input" type="checkbox" checked={provider.enabled} onChange={(event) => updateProvider(provider.id, { enabled: event.target.checked })} />
            <span className="form-check-label">Enabled</span>
          </label>
          <span className={`badge ${usable ? 'bg-green-lt text-green' : configured ? 'bg-yellow-lt text-yellow' : 'bg-red-lt text-red'}`}>
            {usable ? 'Usable' : configured ? 'Configured' : 'Needs key or URL'}
          </span>
          {provider.builtIn && <span className="badge bg-blue-lt text-blue">Built-in</span>}
          {defaultProviderId === provider.id && <span className="badge bg-purple-lt text-purple">Default</span>}
        </div>
        <div className="row g-3">
          <div className="col-md-3">
            <label className="form-label">Provider ID</label>
            <input className="form-control" value={provider.id} disabled={provider.builtIn} onChange={(event) => updateProvider(provider.id, { id: normalizeMapProviderId(event.target.value, provider.id) })} />
          </div>
          <div className="col-md-3">
            <label className="form-label">Provider Name</label>
            <input className="form-control" value={provider.label} onChange={(event) => updateProvider(provider.id, { label: event.target.value })} />
          </div>
          <div className="col-md-2">
            <label className="form-label">Type</label>
            <select className="form-select" value={provider.type} onChange={(event) => updateProvider(provider.id, { type: event.target.value })}>
              {MAP_PROVIDER_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
            </select>
          </div>
          <div className="col-md-2">
            <label className="form-label">Min Zoom</label>
            <input className="form-control" type="number" min="0" max="24" value={provider.minZoom} onChange={(event) => updateProvider(provider.id, { minZoom: event.target.value })} />
          </div>
          <div className="col-md-2">
            <label className="form-label">Max Zoom</label>
            <input className="form-control" type="number" min="1" max="24" value={provider.maxZoom} onChange={(event) => updateProvider(provider.id, { maxZoom: event.target.value })} />
          </div>
          <div className="col-12">
            <label className="form-label">Tile URL Template</label>
            <input className="form-control font-monospace" value={provider.tileUrl} onChange={(event) => updateProvider(provider.id, { tileUrl: event.target.value })} placeholder="https://tiles.example.com/{z}/{x}/{y}.png" />
          </div>
          <div className="col-md-5">
            <label className="form-label">API Key / Public Token</label>
            <input className="form-control" value={provider.apiKey || ''} onChange={(event) => updateProvider(provider.id, { apiKey: event.target.value })} placeholder={provider.requiresApiKey ? 'Required for this provider' : 'Optional'} />
          </div>
          <div className="col-md-3">
            <label className="form-label">Attribution</label>
            <input className="form-control" value={provider.attribution || ''} onChange={(event) => updateProvider(provider.id, { attribution: event.target.value })} />
          </div>
          <div className="col-md-4">
            <label className="form-label">Notes</label>
            <input className="form-control" value={provider.notes || ''} onChange={(event) => updateProvider(provider.id, { notes: event.target.value })} />
          </div>
          <div className="col-12">
            <div className="btn-list justify-content-end">
              <button type="button" className="btn btn-outline-secondary btn-sm" disabled={!usable} onClick={() => setDefaultProviderId(provider.id)}>
                Set Default
              </button>
              {!provider.builtIn && (
                <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => removeCustomProvider(provider.id)}>
                  <IconTrash size={16} className="me-2" />Remove
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) return <div className="empty">Loading map provider options...</div>;

  return (
    <form className="row row-cards system-settings-map-providers" onSubmit={saveMapProviders}>
      {message && <div className="col-12"><div className="alert alert-success">{message}</div></div>}
      {error && <div className="col-12"><div className="alert alert-danger">{error}</div></div>}
      <KpiCard icon={IconMap} label="Providers" value={providerDrafts.length} tone="blue" />
      <KpiCard icon={IconCircleCheck} label="Usable" value={usableProviders.length} tone="green" />
      <KpiCard icon={IconSettings} label="Enabled" value={enabledProviders.length} tone="cyan" />
      <KpiCard icon={IconPlus} label="Custom" value={customProviders.length} tone="purple" />
      <div className="col-12">
        <Card
          title="Map Provider Options"
          icon={IconMap}
          actions={(
            <div className="btn-list">
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={loadMapProviders} disabled={saving}>
                <IconRefresh size={16} className="me-2" />Refresh
              </button>
              <button type="button" className="btn btn-outline-primary btn-sm" onClick={addCustomProvider} disabled={saving}>
                <IconPlus size={16} className="me-2" />Add Custom Provider
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                <IconDeviceFloppy size={16} className="me-2" />{saving ? 'Saving...' : 'Save Maps'}
              </button>
            </div>
          )}
        >
          <div className="row g-3 mb-3">
            <div className="col-md-6 col-xl-4">
              <label className="form-label">Default Map Provider</label>
              <select className="form-select" value={defaultProviderId} onChange={(event) => setDefaultProviderId(event.target.value)}>
                {usableProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label} / {mapProviderTypeLabel(provider.type)}
                  </option>
                ))}
              </select>
              <div className="form-hint">Mapping, Serviceability Check, OLT location capture, and Customer Profiling maps use this default.</div>
            </div>
            <div className="col-md-6 col-xl-8">
              <label className="form-label">Guidelines</label>
              <ul className="system-settings-map-provider-guidelines">
                {guidelines.map((guideline) => <li key={guideline}>{guideline}</li>)}
              </ul>
            </div>
          </div>
          <div className="system-settings-map-provider-tabs">
            <ul className="nav nav-tabs" role="tablist" aria-label="Map provider vendors">
              {providerGroups.map((group) => (
                <li className="nav-item" role="presentation" key={group.id}>
                  <button
                    type="button"
                    className={`nav-link ${activeProviderGroup?.id === group.id ? 'active' : ''}`}
                    onClick={() => {
                      setActiveProviderVendor(group.id);
                      setActiveProviderType(group.providers[0]?.type || 'custom');
                    }}
                    role="tab"
                    aria-selected={activeProviderGroup?.id === group.id}
                  >
                    <span>{group.label}</span>
                    <span className={`badge bg-${group.tone}-lt text-${group.tone}`}>{group.providers.length}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="system-settings-map-provider-subtabs">
              <div className="system-settings-map-provider-subtab-list" role="tablist" aria-label={`${activeProviderGroup?.label || 'Provider'} map types`}>
                {providerTypeTabs.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    className={`btn btn-sm ${activeProviderTypeTab?.id === type.id ? 'btn-primary' : 'btn-outline-secondary'}`}
                    onClick={() => setActiveProviderType(type.id)}
                    role="tab"
                    aria-selected={activeProviderTypeTab?.id === type.id}
                  >
                    {type.label}
                    <span className="badge bg-white text-muted ms-2">{type.providers.length}</span>
                  </button>
                ))}
              </div>
              <span className="system-settings-map-provider-tab-note">
                Showing {activeProviderGroup?.label || 'Provider'} / {activeProviderTypeTab?.label || 'Type'}
              </span>
            </div>
            <div className="system-settings-map-provider-list">
              {visibleProviders.length ? visibleProviders.map(renderProviderCard) : <div className="empty">No map providers in this type.</div>}
            </div>
          </div>
        </Card>
      </div>
    </form>
  );
}

const MAP_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';
const DEFAULT_MAP_IMAGE_MAX_BYTES = 524288;

function ImagesTab() {
  const [config, setConfig] = useState(null);
  const [imageView, setImageView] = useState('nap');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyTarget, setBusyTarget] = useState('');

  async function loadMapImages() {
    setLoading(true);
    try {
      setConfig(await request('/system-settings/map-images'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMapImages();
  }, []);

  async function uploadMapImage(target, file, input) {
    if (!file) return;
    const acceptedTypes = config?.accepted_mime_types?.length ? config.accepted_mime_types : MAP_IMAGE_ACCEPT.split(',');
    const maxBytes = config?.max_bytes || DEFAULT_MAP_IMAGE_MAX_BYTES;
    setError('');
    setMessage('');
    if (!acceptedTypes.includes(file.type)) {
      setError('Accepted image formats are PNG, JPG/JPEG, and WebP.');
      input.value = '';
      return;
    }
    if (file.size > maxBytes) {
      setError(`Image must be ${formatBytes(maxBytes)} or smaller.`);
      input.value = '';
      return;
    }
    setBusyTarget(target.id);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const nextConfig = await request(`/system-settings/map-images/${target.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          data_url: dataUrl,
          file_name: file.name,
          mime_type: file.type
        })
      });
      setConfig(nextConfig);
      setMessage(`${target.label} image saved.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyTarget('');
      input.value = '';
    }
  }

  async function removeMapImage(target) {
    if (!window.confirm(`Remove the ${target.label} image?`)) return;
    setBusyTarget(target.id);
    setError('');
    setMessage('');
    try {
      setConfig(await request(`/system-settings/map-images/${target.id}`, { method: 'DELETE' }));
      setMessage(`${target.label} image removed.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyTarget('');
    }
  }

  const targets = config?.targets || [
    { id: 'nap', label: 'NAP Box', recommended_size: '128 x 128 px', description: 'Marker shown for NAP boxes on the Network Settings map.' },
    { id: 'olt', label: 'OLT', recommended_size: '160 x 160 px', description: 'Marker shown for OLT devices on the Network Settings map.' },
    { id: 'plc-splitter-1x8', label: 'PLC Splitter 1x8', recommended_size: '180 x 120 px', description: 'Equipment image shown for 1x8 PLC splitter ports in Network Settings.' },
    { id: 'plc-splitter-1x16', label: 'PLC Splitter 1x16', recommended_size: '220 x 120 px', description: 'Equipment image shown for 1x16 PLC splitter ports in Network Settings.' }
  ];
  const plcTargets = targets.filter((target) => target.id.startsWith('plc-splitter-'));
  const imageTabs = [
    ...targets.filter((target) => !target.id.startsWith('plc-splitter-')),
    ...(plcTargets.length ? [{ id: 'plc', label: 'PLC' }] : [])
  ];
  const selectedTarget = targets.find((target) => target.id === imageView) || targets[0];
  const savedCount = targets.filter((target) => target.image).length;
  const maxBytes = config?.max_bytes || DEFAULT_MAP_IMAGE_MAX_BYTES;
  const formats = (config?.accepted_formats || ['PNG', 'JPG/JPEG', 'WebP']).join(' ');
  const guidelines = config?.guidelines || [
    'Use PNG or WebP for crisp transparent network equipment artwork.',
    'Use JPG only for photo-like images; transparent backgrounds are not preserved in JPG.',
    'Keep icons centered with safe padding so they remain readable at small map and canvas zoom levels.',
    'Recommended art is 128 x 128 px for NAP boxes, 160 x 160 px for OLT devices, and wide 1x8 or 1x16 PLC splitter artwork.',
    'Keep each image at or below 512 KB.'
  ];

  function renderImageTargetCard(target, compact = false) {
    return (
      <div className={`card system-settings-map-image-card ${compact ? 'system-settings-map-image-card-compact' : ''}`} key={target.id}>
        <div className="card-body">
          <div className="system-settings-map-image-layout">
            <div className="system-settings-map-image-preview">
              {target?.image?.data_url ? (
                <img src={target.image.data_url} alt={`${target.label} image`} />
              ) : (
                <IconPhoto size={42} className="text-muted" />
              )}
            </div>
            <div>
              <h3 className="card-title mb-1">{target.label}</h3>
              <div className="text-muted">{target.description}</div>
              <div className="system-settings-avatar-meta">
                <span className="badge bg-blue-lt text-blue">{target.recommended_size}</span>
                <span className="badge bg-secondary-lt">{target.image ? target.image.mime_type : 'No image'}</span>
                <span className="text-muted small">
                  {target.image ? `${target.image.file_name || 'image'} · ${formatBytes(target.image.byte_size)}` : 'Upload image.'}
                </span>
              </div>
              <div className="btn-list mt-3">
                <input
                  id={`map-image-upload-${target.id}`}
                  className="d-none"
                  type="file"
                  accept={MAP_IMAGE_ACCEPT}
                  onChange={(e) => uploadMapImage(target, e.target.files?.[0], e.target)}
                />
                <label className={`btn btn-outline-primary btn-sm ${busyTarget === target.id ? 'disabled' : ''}`} htmlFor={busyTarget === target.id ? undefined : `map-image-upload-${target.id}`} aria-disabled={busyTarget === target.id}>
                  <IconUpload size={16} className="me-2" />{busyTarget === target.id ? 'Saving...' : target.image ? 'Replace' : 'Upload'}
                </label>
                {target.image && (
                  <button className="btn btn-outline-danger btn-sm" type="button" onClick={() => removeMapImage(target)} disabled={busyTarget === target.id}>
                    <IconTrash size={16} className="me-2" />Remove
                  </button>
                )}
                <button className="btn btn-outline-secondary btn-sm" type="button" onClick={loadMapImages} disabled={busyTarget === target.id}>
                  <IconRefresh size={16} className="me-2" />Refresh
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="row row-cards system-settings-images">
      <div className="col-12">
        <div className="alert alert-info mb-0">
          These images are used as Network Settings visual assets for map markers and fiber equipment such as OLTs, NAP boxes, and PLC splitters.
        </div>
      </div>
      <div className="col-12">
        <div className="alert alert-secondary mb-0">
          Accepted image formats: {formats}. Maximum upload size is {formatBytes(maxBytes)} per image.
        </div>
      </div>
      {message && <div className="col-12"><div className="alert alert-success">{message}</div></div>}
      {error && <div className="col-12"><div className="alert alert-danger">{error}</div></div>}
      <KpiCard icon={IconPhoto} label="Image Types" value={targets.length || 4} tone="blue" />
      <KpiCard icon={IconDatabase} label="Uploaded" value={savedCount} tone="green" />
      <KpiCard icon={IconSettings} label="Formats" value={formats} tone="cyan" />
      <KpiCard icon={IconNetwork} label="Max Size" value={formatBytes(maxBytes)} tone="purple" />
      <div className="col-12">
        <ul className="nav nav-tabs" role="tablist" aria-label="Map image tabs">
          {imageTabs.map((target) => (
            <li className="nav-item" role="presentation" key={target.id}>
              <button className={`nav-link ${imageView === target.id ? 'active' : ''}`} type="button" role="tab" aria-selected={imageView === target.id} onClick={() => setImageView(target.id)}>
                {target.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
      {loading ? (
        <div className="col-12"><div className="empty">Loading map images...</div></div>
      ) : (
        <>
          <div className="col-lg-7">
            {imageView === 'plc' ? (
              <div className="system-settings-plc-grid">
                {plcTargets.map((target) => renderImageTargetCard(target, true))}
              </div>
            ) : (
              renderImageTargetCard(selectedTarget)
            )}
            </div>
          <div className="col-lg-5">
            <Card title="Upload Guidelines" icon={IconPhoto}>
              <ul className="system-settings-image-guidelines">
                {guidelines.map((guideline) => <li key={guideline}>{guideline}</li>)}
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function A2PMessagingSettingsTab() {
  const emptyForm = {
    enabled: false,
    provider: 'SMART_MESSAGING_SUITE',
    base_url: 'https://enterprise.messagingsuite.smart.com.ph',
    send_path: '/cgphttp/servlet/sendmsg',
    query_path: '/cgphttp/servlet/querymsg',
    cancel_path: '/cgphttp/servlet/cancelmsg',
    start_batch_path: '/cgphttp/servlet/startbatch',
    send_batch_path: '/cgphttp/servlet/sendbatch',
    credits_path: '/cgpapi/service1/credits',
    auth_method: 'API_KEY_HEADERS',
    api_id: '',
    api_key: '',
    username: '',
    password: '',
    default_source: '',
    source_addresses: '',
    registered_delivery: true,
    monthly_credit_limit: '',
    monthly_reset_day: 1,
    notes: ''
  };
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [section, setSection] = useState(() => {
    const subtab = new URLSearchParams(window.location.search).get('subtab');
    return String(subtab || '').toLowerCase() === 'messages' ? 'messages' : 'settings';
  });
  const [testForm, setTestForm] = useState({
    destination: '',
    message_text: '3J ISP Management A2P test message.',
    source: '',
    registered_delivery: true
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [creditMessage, setCreditMessage] = useState('');
  const [creditError, setCreditError] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [testError, setTestError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checkingCredits, setCheckingCredits] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

  function hydrateForm(nextConfig) {
    setForm({
      ...emptyForm,
      enabled: Boolean(nextConfig.enabled),
      provider: nextConfig.provider || emptyForm.provider,
      base_url: nextConfig.base_url || emptyForm.base_url,
      send_path: nextConfig.send_path || emptyForm.send_path,
      query_path: nextConfig.query_path || emptyForm.query_path,
      cancel_path: nextConfig.cancel_path || emptyForm.cancel_path,
      start_batch_path: nextConfig.start_batch_path || emptyForm.start_batch_path,
      send_batch_path: nextConfig.send_batch_path || emptyForm.send_batch_path,
      credits_path: nextConfig.credits_path || emptyForm.credits_path,
      auth_method: nextConfig.auth_method || emptyForm.auth_method,
      api_id: nextConfig.api_id || '',
      api_key: '',
      username: nextConfig.username || '',
      password: '',
      default_source: nextConfig.default_source || '',
      source_addresses: (nextConfig.source_addresses || []).join('\n'),
      registered_delivery: Boolean(nextConfig.registered_delivery),
      monthly_credit_limit: nextConfig.monthly_credit_limit ?? '',
      monthly_reset_day: nextConfig.monthly_reset_day || 1,
      notes: nextConfig.notes || ''
    });
  }

  async function loadA2PSettings() {
    setLoading(true);
    try {
      const nextConfig = await request('/system-settings/a2p-messaging');
      setConfig(nextConfig);
      hydrateForm(nextConfig);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadA2PSettings();
  }, []);

  useEffect(() => {
    const syncSubtab = () => {
      const params = new URLSearchParams(window.location.search);
      if (String(params.get('subtab') || '').toLowerCase() === 'messages') setSection('messages');
    };
    syncSubtab();
    window.addEventListener('popstate', syncSubtab);
    return () => window.removeEventListener('popstate', syncSubtab);
  }, []);

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function saveA2PSettings(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        enabled: form.enabled,
        provider: form.provider,
        base_url: form.base_url,
        send_path: form.send_path,
        query_path: form.query_path,
        cancel_path: form.cancel_path,
        start_batch_path: form.start_batch_path,
        send_batch_path: form.send_batch_path,
        credits_path: form.credits_path,
        auth_method: form.auth_method,
        api_id: form.api_id,
        username: form.username,
        default_source: form.default_source,
        source_addresses: form.source_addresses.split(/\n|,/).map((item) => item.trim()).filter(Boolean),
        registered_delivery: form.registered_delivery,
        monthly_credit_limit: form.monthly_credit_limit === '' ? null : Number(form.monthly_credit_limit),
        monthly_reset_day: Number(form.monthly_reset_day) || 1,
        notes: form.notes
      };
      if (form.api_key.trim()) payload.api_key = form.api_key.trim();
      if (form.password.trim()) payload.password = form.password.trim();
      const nextConfig = await request('/system-settings/a2p-messaging', {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      setConfig(nextConfig);
      hydrateForm(nextConfig);
      setMessage('A2P messaging settings saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function clearA2PSecret(secret) {
    const label = secret === 'api_key' ? 'API key' : 'password';
    if (!window.confirm(`Remove the saved A2P ${label}?`)) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const nextConfig = await request('/system-settings/a2p-messaging', {
        method: 'PATCH',
        body: JSON.stringify(secret === 'api_key' ? { clear_api_key: true } : { clear_password: true })
      });
      setConfig(nextConfig);
      hydrateForm(nextConfig);
      setMessage(`A2P ${label} removed.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function checkCredits() {
    setCheckingCredits(true);
    setCreditMessage('');
    setCreditError('');
    try {
      const nextConfig = await request('/system-settings/a2p-messaging/check-credits', { method: 'POST' });
      setConfig(nextConfig);
      hydrateForm(nextConfig);
      const available = nextConfig.credit_check?.available ?? nextConfig.last_credit_available;
      const responseSummary = nextConfig.credit_check?.response_summary || nextConfig.last_credit_response || '';
      setCreditMessage(available === null || available === undefined
        ? `Credits check completed, but Smart did not return a parsable Available value.${responseSummary ? ` Response: ${responseSummary}` : ''}`
        : `Credits check completed. Available credits: ${available}.`);
    } catch (err) {
      setCreditError(err.message);
      await loadA2PSettings();
    } finally {
      setCheckingCredits(false);
    }
  }

  async function sendTestMessage(event) {
    event.preventDefault();
    setSendingTest(true);
    setTestMessage('');
    setTestError('');
    try {
      const nextConfig = await request('/system-settings/a2p-messaging/test-send', {
        method: 'POST',
        body: JSON.stringify({
          destination: testForm.destination,
          message_text: testForm.message_text,
          source: testForm.source || null,
          registered_delivery: testForm.registered_delivery
        })
      });
      setConfig(nextConfig);
      hydrateForm(nextConfig);
      setTestMessage(`Test SMS accepted by Smart${nextConfig.test_send?.message_id ? ` · Message-ID ${nextConfig.test_send.message_id}` : ''}.`);
      window.dispatchEvent(new CustomEvent('admin-notification-refresh'));
    } catch (err) {
      setTestError(err.message);
      window.dispatchEvent(new CustomEvent('admin-notification-refresh'));
      await loadA2PSettings();
    } finally {
      setSendingTest(false);
    }
  }

  if (loading) return <div className="empty">Loading A2P messaging settings...</div>;

  const authMethod = form.auth_method || 'API_KEY_HEADERS';
  const hasApiKey = Boolean(config?.api_key_configured);
  const hasPassword = Boolean(config?.password_configured);
  const senderOptions = Array.from(new Set([
    ...String(form.source_addresses || '').split(/\n|,/).map((item) => item.trim()).filter(Boolean),
    form.default_source
  ].filter(Boolean)));
  const capabilities = config?.capabilities || {};
  const groupHeader = (icon, title, tooltip) => (
    <div className="col-12">
      <div className="d-flex align-items-center gap-2 border-bottom pb-2 mb-1">
        {icon}
        <div className="fw-bold">{title}</div>
        {tooltip && <IconInfoCircle size={17} className="text-muted" title={tooltip} />}
      </div>
    </div>
  );

  return (
    <>
      <div className="card mb-3">
        <div className="card-header p-0">
          <ul className="nav nav-tabs card-header-tabs" role="tablist">
            <li className="nav-item" role="presentation">
              <button className={`nav-link ${section === 'settings' ? 'active' : ''}`} type="button" onClick={() => setSection('settings')}>
                <IconSettings size={18} className="me-2" />Settings
              </button>
            </li>
            <li className="nav-item" role="presentation">
              <button className={`nav-link ${section === 'messages' ? 'active' : ''}`} type="button" onClick={() => setSection('messages')}>
                <IconMessageCircle size={18} className="me-2" />Messages
              </button>
            </li>
          </ul>
        </div>
      </div>
      {section === 'settings' ? (
        <div className="row row-cards system-settings-a2p">
          {message && <div className="col-12"><div className="alert alert-success">{message}</div></div>}
          {error && <div className="col-12"><div className="alert alert-danger">{error}</div></div>}

          <div className="col-12 col-xl-8">
            <Card title="A2P Messaging API" icon={IconSend}>
              <form onSubmit={saveA2PSettings}>
                <div className="row g-4">
                  {groupHeader(<IconSettings size={22} className="text-primary flex-shrink-0" />, '1. Integration Status', 'Enable A2P only after Smart/Soprano has provisioned HTTP API access for the account.')}
                  <div className="col-12">
                    <label className="form-check form-switch">
                      <input className="form-check-input" type="checkbox" checked={form.enabled} onChange={(e) => updateField('enabled', e.target.checked)} />
                      <span className="form-check-label">Enable A2P messaging integration</span>
                    </label>
                  </div>
                  {groupHeader(<IconDatabase size={22} className="text-primary flex-shrink-0" />, '2. Provider and Account', 'Default values are based on the Smart Messaging Suite HTTP developer guide.')}
                  <div className="col-md-6">
                    <label className="form-label">Provider</label>
                    <input className="form-control" value={form.provider} onChange={(e) => updateField('provider', e.target.value)} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Base URL</label>
                    <input className="form-control" value={form.base_url} onChange={(e) => updateField('base_url', e.target.value)} />
                  </div>
                  {groupHeader(<IconShieldLock size={22} className="text-primary flex-shrink-0" />, '3. Authentication', 'API key headers are recommended by the Smart guide. Basic Auth and body credentials are kept for compatibility.')}
                  <div className="col-md-4">
                    <label className="form-label">Auth Method</label>
                    <select className="form-select" value={authMethod} onChange={(e) => updateField('auth_method', e.target.value)}>
                      <option value="API_KEY_HEADERS">API key headers</option>
                      <option value="BASIC_AUTH">Basic authentication</option>
                      <option value="BODY_CREDENTIALS">Username/password body fields</option>
                    </select>
                    <div className="text-muted small mt-1">Smart recommends X-MEMS API ID and API Key headers.</div>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label">API ID</label>
                    <input className="form-control" autoComplete="off" value={form.api_id} onChange={(e) => updateField('api_id', e.target.value)} />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label">API Key</label>
                    <input className="form-control" type="password" autoComplete="off" value={form.api_key} placeholder={hasApiKey ? `Saved: ${config.api_key_hint}` : ''} onChange={(e) => updateField('api_key', e.target.value)} />
                    {hasApiKey && <button className="btn btn-link px-0 py-1" type="button" onClick={() => clearA2PSecret('api_key')}>Clear saved API key</button>}
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Username</label>
                    <input className="form-control" autoComplete="off" value={form.username} onChange={(e) => updateField('username', e.target.value)} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Password</label>
                    <input className="form-control" type="password" autoComplete="off" value={form.password} placeholder={hasPassword ? `Saved: ${config.password_hint}` : ''} onChange={(e) => updateField('password', e.target.value)} />
                    {hasPassword && <button className="btn btn-link px-0 py-1" type="button" onClick={() => clearA2PSecret('password')}>Clear saved password</button>}
                  </div>
                  {groupHeader(<IconListDetails size={22} className="text-primary flex-shrink-0" />, '4. API Endpoint Paths', 'Keep these default paths unless Smart gives a tenant-specific interface.')}
                  {[
                    ['send_path', 'Send SMS'],
                    ['query_path', 'Query Message'],
                    ['cancel_path', 'Cancel Message'],
                    ['start_batch_path', 'Start Batch'],
                    ['send_batch_path', 'Send Batch'],
                    ['credits_path', 'Current Credits']
                  ].map(([field, label]) => (
                    <div className="col-md-4" key={field}>
                      <label className="form-label">{label}</label>
                      <input className="form-control" value={form[field]} onChange={(e) => updateField(field, e.target.value)} />
                    </div>
                  ))}
                  {groupHeader(<IconBell size={22} className="text-primary flex-shrink-0" />, '5. Sender IDs and Delivery Receipts', 'Use the Sender IDs provisioned for the Smart A2P account.')}
                  <div className="col-md-6">
                    <label className="form-label">Default Sender ID</label>
                    <input className="form-control" value={form.default_source} onChange={(e) => updateField('default_source', e.target.value)} placeholder="Example: 3J ALERT" />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Registered Sender IDs</label>
                    <textarea className="form-control" rows="3" value={form.source_addresses} onChange={(e) => updateField('source_addresses', e.target.value)} placeholder="One sender ID per line" />
                  </div>
                  <div className="col-12">
                    <label className="form-check">
                      <input className="form-check-input" type="checkbox" checked={form.registered_delivery} onChange={(e) => updateField('registered_delivery', e.target.checked)} />
                      <span className="form-check-label">Request delivery receipts by default</span>
                    </label>
                  </div>
                  {groupHeader(<IconKey size={22} className="text-primary flex-shrink-0" />, '6. Local Credit Rules', 'Monthly consumption tracking uses local A2P message logs; direct credits require Smart prepaid credits API access.')}
                  <div className="col-md-4">
                    <label className="form-label">Monthly Credit Limit</label>
                    <input className="form-control" type="number" min="0" value={form.monthly_credit_limit} onChange={(e) => updateField('monthly_credit_limit', e.target.value)} placeholder="Optional" />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label">Monthly Reset Day</label>
                    <input className="form-control" type="number" min="1" max="31" value={form.monthly_reset_day} onChange={(e) => updateField('monthly_reset_day', e.target.value)} />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label">Direct Credits API</label>
                    <div className="form-control-plaintext">Supported for prepaid accounts</div>
                  </div>
                  <div className="col-12">
                    <label className="form-label">Notes</label>
                    <textarea className="form-control" rows="3" value={form.notes} onChange={(e) => updateField('notes', e.target.value)} placeholder="Account notes, source IDs, support tickets, or whitelist details." />
                  </div>
                  <div className="col-12 text-end">
                    <button className="btn btn-primary" disabled={saving}><IconDeviceFloppy size={18} className="me-2" />{saving ? 'Saving...' : 'Save A2P Settings'}</button>
                  </div>
                </div>
              </form>
            </Card>
          </div>

          <div className="col-12 col-xl-4">
            <div className="row row-cards">
              <div className="col-12">
                <Card title="Smart API Summary" icon={IconInfoCircle}>
                  <div className="d-flex flex-column gap-3">
                    <div><strong>SMS sending</strong><div className="text-muted small">Use sendmsg for one or more destinations. The guide documents up to {capabilities.max_destinations_per_sendmsg || 300} destinations per request.</div></div>
                    <div><strong>Message lifecycle</strong><div className="text-muted small">querymsg checks status by Message-ID; cancelmsg can cancel queued or scheduled messages when still cancellable.</div></div>
                    <div><strong>Batch and reports</strong><div className="text-muted small">startbatch/sendbatch can send templated batches. Local logs show API attempts in real time.</div></div>
                    <div><strong>Provisioning</strong><div className="text-muted small">HTTP API must be enabled by Smart/Soprano. Source IP whitelisting can be requested during provisioning.</div></div>
                  </div>
                </Card>
              </div>
              <div className="col-12">
                <Card title="Credit Check" icon={IconDatabase}>
                  <button className="btn btn-outline-primary w-100" type="button" onClick={checkCredits} disabled={checkingCredits}>
                    <IconRefresh size={18} className="me-2" />{checkingCredits ? 'Checking...' : 'Check Smart Credits'}
                  </button>
                  {creditMessage && <div className="alert alert-success py-2 mt-3">{creditMessage}</div>}
                  {creditError && <div className="alert alert-danger py-2 mt-3">{creditError}</div>}
                  {(config?.last_credit_check_status || config?.last_credit_response || config?.last_credit_error) && (
                    <div className="mt-3 border rounded p-2">
                      <div className="d-flex align-items-center gap-2 mb-2">
                        <span className={`badge ${config?.last_credit_check_status === 'SUCCESS' ? 'bg-success' : 'bg-danger'}`}>{config?.last_credit_check_status || 'UNKNOWN'}</span>
                        <span className="text-muted small">{formatDateTime(config?.last_credit_check_at)}</span>
                      </div>
                      <div className="small"><strong>Available:</strong> {config?.last_credit_available ?? '-'}</div>
                      <div className="text-muted small mt-2">{config?.last_credit_error || config?.last_credit_response}</div>
                    </div>
                  )}
                </Card>
              </div>
              <div className="col-12">
                <Card title="Send Test SMS" icon={IconBell}>
                  <form onSubmit={sendTestMessage}>
                    <div className="mb-3">
                      <label className="form-label">Destination</label>
                      <input className="form-control" value={testForm.destination} onChange={(e) => setTestForm({ ...testForm, destination: e.target.value })} placeholder="639171234567 or 09171234567" />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Message</label>
                      <textarea className="form-control" rows="3" value={testForm.message_text} maxLength={500} onChange={(e) => setTestForm({ ...testForm, message_text: e.target.value })} />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Sender ID</label>
                      <select className="form-select" value={testForm.source} onChange={(e) => setTestForm({ ...testForm, source: e.target.value })}>
                        <option value="">Use default sender</option>
                        {senderOptions.map((source) => <option key={source} value={source}>{source}</option>)}
                      </select>
                    </div>
                    <label className="form-check mb-3">
                      <input className="form-check-input" type="checkbox" checked={testForm.registered_delivery} onChange={(e) => setTestForm({ ...testForm, registered_delivery: e.target.checked })} />
                      <span className="form-check-label">Request delivery receipt for this test</span>
                    </label>
                    <button className="btn btn-primary w-100" disabled={sendingTest || !testForm.destination.trim() || !testForm.message_text.trim()}>
                      <IconSend size={18} className="me-2" />{sendingTest ? 'Sending...' : 'Send Test SMS'}
                    </button>
                    {testMessage && <div className="alert alert-success py-2 mt-3">{testMessage}</div>}
                    {testError && <div className="alert alert-danger py-2 mt-3">{testError}</div>}
                    {(config?.last_test_send_status || config?.last_test_send_response || config?.last_test_send_error) && (
                      <div className="mt-3 border rounded p-2">
                        <div className="d-flex align-items-center gap-2 mb-2">
                          <span className={`badge ${config?.last_test_send_status === 'SUCCESS' ? 'bg-success' : 'bg-danger'}`}>{config?.last_test_send_status || 'UNKNOWN'}</span>
                          <span className="text-muted small">{formatDateTime(config?.last_test_send_at)}</span>
                        </div>
                        <div className="small"><strong>Destination:</strong> {config?.last_test_send_destination || '-'}</div>
                        <div className="small"><strong>Message ID:</strong> {config?.last_test_send_message_id || '-'}</div>
                        <div className="text-muted small mt-2">{config?.last_test_send_error || config?.last_test_send_response}</div>
                      </div>
                    )}
                  </form>
                </Card>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <A2PMessageLogsPanel />
      )}
    </>
  );
}

function A2PMessageLogsPanel() {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({});
  const [purposes, setPurposes] = useState([]);
  const [status, setStatus] = useState('ALL');
  const [purpose, setPurpose] = useState('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadMessages(nextPage = page) {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ status, purpose, search, page: String(nextPage), page_size: String(pageSize) });
      const data = await request(`/system-settings/a2p-messaging/messages?${params.toString()}`);
      setItems(data.items || []);
      setSummary(data.summary || {});
      setPurposes(data.purposes || []);
      setTotal(Number(data.total || 0));
      setPage(Number(data.page || nextPage));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => loadMessages(1), 250);
    return () => window.clearTimeout(timer);
  }, [status, purpose, search, pageSize]);

  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  const statusBadge = (value) => value === 'SUCCESS'
    ? 'bg-success-lt text-success'
    : value === 'FAILED'
      ? 'bg-danger-lt text-danger'
      : 'bg-warning-lt text-warning';

  return (
    <div className="row row-cards system-settings-a2p-messages">
      {error && <div className="col-12"><div className="alert alert-danger">{error}</div></div>}
      <KpiCard icon={IconSend} label="Total SMS Logs" value={summary.total || 0} tone="blue" />
      <KpiCard icon={IconCircleCheck} label="Successful" value={summary.success || 0} tone="green" />
      <KpiCard icon={IconAlertTriangle} label="Failed" value={summary.failed || 0} tone="red" />
      <KpiCard icon={IconClock} label="This Month" value={summary.this_month || 0} tone="purple" />

      <div className="col-12">
        <Card title="A2P Messages" icon={IconMessageCircle}>
          <div className="row g-3 align-items-end mb-3">
            <div className="col-12 col-lg-4">
              <label className="form-label">Search</label>
              <div className="input-icon">
                <span className="input-icon-addon"><IconSearch size={18} /></span>
                <input className="form-control" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search phone, sender, message ID, text, or error..." />
              </div>
            </div>
            <div className="col-6 col-lg-2">
              <label className="form-label">Status</label>
              <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="ALL">All</option>
                <option value="SUCCESS">Success</option>
                <option value="FAILED">Failed</option>
                <option value="PENDING">Pending</option>
              </select>
            </div>
            <div className="col-6 col-lg-2">
              <label className="form-label">Purpose</label>
              <select className="form-select" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
                <option value="ALL">All purposes</option>
                {purposes.map((item) => <option key={item.purpose} value={item.purpose}>{item.purpose} ({item.count})</option>)}
              </select>
            </div>
            <div className="col-6 col-lg-2">
              <label className="form-label">Show entries</label>
              <select className="form-select" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                {[10, 20, 50, 100].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>
            <div className="col-6 col-lg-2">
              <button className="btn btn-outline-primary w-100" type="button" onClick={() => loadMessages(page)} disabled={loading}>
                <IconRefresh size={18} className="me-2" />{loading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
          </div>

          <div className="table-responsive table-sticky-wrap">
            <table className="table card-table table-vcenter">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Purpose</th>
                  <th>To</th>
                  <th>Sender ID</th>
                  <th>Message</th>
                  <th>Smart / Message ID</th>
                  <th>Result</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td><span className={`badge ${statusBadge(item.status)}`}>{item.status}</span></td>
                    <td><span className="badge bg-secondary-lt text-secondary">{item.purpose || 'GENERAL'}</span></td>
                    <td>{item.destination_masked || '-'}</td>
                    <td>{item.source || '-'}</td>
                    <td className="text-wrap" style={{ minWidth: 260 }}><div className="fw-semibold">{item.message_preview || '-'}</div></td>
                    <td>
                      <div>{item.smart_status || '-'}</div>
                      <div className="text-muted small">{item.message_id || '-'}</div>
                    </td>
                    <td className="text-wrap" style={{ minWidth: 260 }}>
                      {item.error_message ? <span className="text-danger">{item.error_message}</span> : <span className="text-muted">{item.response_summary || '-'}</span>}
                      {item.http_status && <div className="small text-muted">HTTP {item.http_status}</div>}
                    </td>
                    <td>{formatDateTime(item.created_at)}</td>
                  </tr>
                ))}
                {!items.length && (
                  <tr><td colSpan="8" className="text-center text-muted py-4">No A2P messages found.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mt-3">
            <div className="text-muted small">Showing {items.length ? ((page - 1) * pageSize) + 1 : 0}-{Math.min(total, page * pageSize)} of {total}</div>
            <div className="btn-list">
              <button className="btn btn-outline-secondary" type="button" disabled={page <= 1 || loading} onClick={() => { const next = Math.max(1, page - 1); setPage(next); loadMessages(next); }}>Previous</button>
              <span className="btn disabled">Page {page} of {maxPage}</span>
              <button className="btn btn-outline-secondary" type="button" disabled={page >= maxPage || loading} onClick={() => { const next = Math.min(maxPage, page + 1); setPage(next); loadMessages(next); }}>Next</button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function backupFilename(response, fallback) {
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
}

function BackupTab() {
  const [metadata, setMetadata] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [restoreResult, setRestoreResult] = useState(null);

  async function loadBackupMetadata() {
    try {
      setMetadata(await request('/system-settings/backups'));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadBackupMetadata();
  }, []);

  async function downloadBackup(kind) {
    setBusy(`download-${kind}`);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`${API}/system-settings/backups/${kind}`, {
        headers: token() ? { Authorization: `Bearer ${token()}` } : {}
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.detail || 'Backup download failed');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = backupFilename(response, `threejmain-${kind}-backup.json`);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setMessage(`${kind === 'full' ? 'Full system' : 'Configuration'} backup downloaded.`);
      loadBackupMetadata();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function restoreBackupFile(file, input) {
    if (!file) return;
    setError('');
    setMessage('');
    setRestoreResult(null);
    if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') {
      setError('Backup restore accepts JSON backup files only.');
      input.value = '';
      return;
    }
    if (!window.confirm('Restore this backup file? This replaces the matching configuration and data sections in the current system.')) {
      input.value = '';
      return;
    }
    setBusy('restore');
    try {
      const text = await readFileAsText(file);
      const backup = JSON.parse(text);
      const result = await request('/system-settings/backups/restore', {
        method: 'POST',
        body: JSON.stringify({ backup })
      });
      setRestoreResult(result);
      setMessage(`${result.backupType === 'full' ? 'Full system' : 'Configuration'} backup restored.`);
      loadBackupMetadata();
    } catch (err) {
      setError(err instanceof SyntaxError ? 'Backup file is not valid JSON.' : err.message);
    } finally {
      setBusy('');
      input.value = '';
    }
  }

  const configurationCounts = metadata?.configuration?.counts || {};
  const systemCounts = configurationCounts.systemSettings || {};
  const networkCounts = configurationCounts.networkSettings || {};
  const databaseStatus = metadata?.full?.database || {};
  const databaseRows = Object.values(databaseStatus.rowCounts || {}).reduce((total, value) => total + Number(value || 0), 0);
  const isBusy = Boolean(busy);

  return (
    <div className="row row-cards system-settings-backup">
      <div className="col-12">
        <div className="alert alert-warning mb-0">
          {metadata?.sensitiveNotice || 'Backup files can include API keys, router passwords, SNMP secrets, access users, and uploaded image data. Store downloaded backups securely.'}
        </div>
      </div>
      {message && <div className="col-12"><div className="alert alert-success">{message}</div></div>}
      {error && <div className="col-12"><div className="alert alert-danger">{error}</div></div>}
      <KpiCard icon={IconSettings} label="Locations" value={systemCounts.locations ?? '-'} tone="blue" />
      <KpiCard icon={IconPhoto} label="Image Assets" value={systemCounts.mapImages ?? '-'} tone="green" />
      <KpiCard icon={IconNetwork} label="Network Devices" value={(networkCounts.mikrotikRouters || 0) + (networkCounts.snmpOlts || 0)} tone="cyan" />
      <KpiCard icon={IconDatabase} label="DB Rows" value={databaseStatus.enabled ? databaseRows : 'N/A'} tone="purple" />

      <div className="col-lg-6">
        <Card title="Configuration Backup" icon={IconSettings}>
          <div className="system-settings-backup-card">
            <p className="text-muted">
              Download restorable configuration for System Settings and Network Settings, including MikroTik API routers and SNMP OLT credentials.
            </p>
            <ul className="system-settings-backup-list">
              {(metadata?.configuration?.includes || []).map((item) => <li key={item}>{item}</li>)}
            </ul>
            <button className="btn btn-primary mt-3" type="button" onClick={() => downloadBackup('configuration')} disabled={isBusy}>
              <IconDeviceFloppy size={18} className="me-2" />{busy === 'download-configuration' ? 'Preparing...' : 'Download Configuration Backup'}
            </button>
          </div>
        </Card>
      </div>

      <div className="col-lg-6">
        <Card title="Full System Backup" icon={IconDatabase}>
          <div className="system-settings-backup-card">
            <p className="text-muted">
              Download configuration plus supported PostgreSQL application data. Customer records are included when the database is available.
            </p>
            <ul className="system-settings-backup-list">
              {(metadata?.full?.includes || []).map((item) => <li key={item}>{item}</li>)}
            </ul>
            <div className="system-settings-avatar-meta">
              <span className={`badge ${databaseStatus.enabled ? 'bg-green-lt text-green' : 'bg-secondary-lt'}`}>Database {databaseStatus.status || 'checking'}</span>
              <span className="text-muted small">{databaseStatus.tables?.length ? `${databaseStatus.tables.length} public tables detected` : 'No database tables detected'}</span>
            </div>
            <button className="btn btn-primary mt-3" type="button" onClick={() => downloadBackup('full')} disabled={isBusy}>
              <IconDatabase size={18} className="me-2" />{busy === 'download-full' ? 'Preparing...' : 'Download Full System Backup'}
            </button>
          </div>
        </Card>
      </div>

      <div className="col-lg-6">
        <Card title="Restore Backup" icon={IconUpload}>
          <p className="text-muted">
            Restore a downloaded configuration or full system backup JSON file. Configuration restore refreshes System Settings and Network Settings immediately when the module is loaded.
          </p>
          <input
            id="system-settings-backup-restore"
            className="d-none"
            type="file"
            accept=".json,application/json"
            onChange={(e) => restoreBackupFile(e.target.files?.[0], e.target)}
          />
          <label className={`btn btn-outline-primary ${busy === 'restore' ? 'disabled' : ''}`} htmlFor={busy === 'restore' ? undefined : 'system-settings-backup-restore'} aria-disabled={busy === 'restore'}>
            <IconUpload size={18} className="me-2" />{busy === 'restore' ? 'Restoring...' : 'Choose Backup File'}
          </label>
        </Card>
      </div>

      <div className="col-lg-6">
        <Card title="Restore Result" icon={IconCircleCheck}>
          {restoreResult ? (
            <pre className="system-settings-backup-result">{JSON.stringify(restoreResult, null, 2)}</pre>
          ) : (
            <div className="empty">No restore has been run in this browser session.</div>
          )}
        </Card>
      </div>
    </div>
  );
}

function deployStateClass(state) {
  if (state === 'succeeded' || state === 'idle') return 'bg-green-lt text-green';
  if (state === 'running') return 'bg-blue-lt text-blue';
  if (state === 'failed') return 'bg-red-lt text-red';
  return 'bg-secondary-lt text-secondary';
}

function DeploymentControlTab() {
  const [deployment, setDeployment] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busyCommit, setBusyCommit] = useState('');

  async function loadDeployment() {
    try {
      setDeployment(await request('/system-settings/deployments'));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadDeployment();
  }, []);

  useEffect(() => {
    const running = deployment?.status?.state === 'running' || deployment?.pendingRequest;
    if (!running) return undefined;
    const timer = window.setInterval(() => loadDeployment(), 7000);
    return () => window.clearInterval(timer);
  }, [deployment?.status?.state, deployment?.pendingRequest?.id]);

  async function deployCommit(commit) {
    if (!commit?.commit) return;
    const label = `${commit.short || commit.commit.slice(0, 7)} - ${commit.subject || 'selected commit'}`;
    if (!window.confirm(`Deploy production commit ${label}?`)) return;
    setMessage('');
    setError('');
    setBusyCommit(commit.commit);
    try {
      const data = await request('/system-settings/deployments/deploy', {
        method: 'POST',
        body: JSON.stringify({ commit: commit.commit })
      });
      setDeployment(data);
      setMessage(data.message || 'Production deploy request queued.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyCommit('');
    }
  }

  const commits = deployment?.commits || [];
  const status = deployment?.status || {};
  const running = status.state === 'running';
  const pending = Boolean(deployment?.pendingRequest);
  const activeCommit = deployment?.deployed?.commit || deployment?.current?.commit || '';
  const latestCommit = commits[0]?.commit || '';
  const unavailable = deployment && !deployment.enabled;

  return (
    <Card
      title="Production Deployment"
      icon={IconPlayerPlay}
      actions={<button className="btn btn-sm" type="button" onClick={loadDeployment}><IconRefresh size={16} className="me-1" />Refresh</button>}
    >
      {message && <div className="alert alert-success">{message}</div>}
      {error && <div className="alert alert-danger">{error}</div>}
      {unavailable && (
        <div className="alert alert-warning">
          Manual production deployment is disabled in this environment.
        </div>
      )}
      <div className="row g-3 mb-3">
        <div className="col-md-3">
          <div className="text-muted small">Environment</div>
          <div className="fw-semibold">{deployment?.environment || '-'}</div>
        </div>
        <div className="col-md-3">
          <div className="text-muted small">Running Commit</div>
          <div className="fw-semibold font-monospace">{deployment?.current?.short || '-'}</div>
        </div>
        <div className="col-md-3">
          <div className="text-muted small">Deployed Commit</div>
          <div className="fw-semibold font-monospace">{deployment?.deployed?.short || '-'}</div>
        </div>
        <div className="col-md-3">
          <div className="text-muted small">Status</div>
          <span className={`badge ${deployStateClass(status.state)}`}>{status.state || 'unknown'}</span>
        </div>
      </div>
      {status.message && <div className="text-muted small mb-3">{status.message}</div>}
      {status.logPath && <div className="text-muted small mb-3 font-monospace">{status.logPath}</div>}
      <div className="alert alert-info">
        Selecting an older commit can remove UI changes added after that commit. Use the one-line production updater if a downgrade removes this screen.
      </div>
      <div className="table-responsive">
        <table className="table card-table table-vcenter">
          <thead>
            <tr>
              <th>Commit</th>
              <th>Message</th>
              <th>Author</th>
              <th>Date</th>
              <th>Status</th>
              <th className="text-end">Action</th>
            </tr>
          </thead>
          <tbody>
            {commits.map((commit) => {
              const isActive = activeCommit && commit.commit === activeCommit;
              const isLatest = latestCommit && commit.commit === latestCommit;
              const actionLabel = isActive ? 'Current' : isLatest ? 'Upgrade' : 'Deploy';
              return (
                <tr key={commit.commit}>
                  <td className="font-monospace">{commit.short || commit.commit.slice(0, 7)}</td>
                  <td>{commit.subject || '-'}</td>
                  <td>{commit.author || '-'}</td>
                  <td className="text-muted small">{formatDateTime(commit.committedAt)}</td>
                  <td>
                    {isActive && <span className="badge bg-green-lt text-green">CURRENT</span>}
                    {!isActive && isLatest && <span className="badge bg-blue-lt text-blue">LATEST</span>}
                    {!isActive && !isLatest && <span className="badge bg-yellow-lt text-yellow">OLDER</span>}
                  </td>
                  <td className="text-end">
                    <button
                      className="btn btn-sm btn-primary"
                      type="button"
                      disabled={!deployment?.enabled || isActive || running || pending || busyCommit === commit.commit}
                      onClick={() => deployCommit(commit)}
                    >
                      <IconPlayerPlay size={16} className="me-1" />{busyCommit === commit.commit ? 'Queueing...' : actionLabel}
                    </button>
                  </td>
                </tr>
              );
            })}
            {!commits.length && (
              <tr>
                <td colSpan="6" className="text-center text-muted py-4">No master commits available from the deploy worker yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="text-muted small mt-3">
        Commit list updated {formatDateTime(deployment?.commitListUpdatedAt)}.
      </div>
    </Card>
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
  contact: '',
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
      contact: user.contact || '',
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
          <div className="alert alert-info">Pre-created roles: owner, admin, viewer, and technician. Owner is locked with full permissions.</div>
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
                        <div className="text-muted small">{user.contact || '-'}</div>
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
                <label className="form-label">Contact</label>
                <input className="form-control" value={userForm.contact} onChange={(event) => setUserForm({ ...userForm, contact: event.target.value })} />
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
  const tabs = ['General', 'Location Management', 'Maps', 'Images', 'Backup', 'Avatar', 'OPENAI', 'A2P Messaging', 'Access', 'Ports', 'Runtime'];
  const initialTab = () => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    return tabs.includes(requested) ? requested : 'General';
  };
  const [tab, setTab] = useState(initialTab);
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

  useEffect(() => {
    const syncTabFromUrl = () => {
      const requested = new URLSearchParams(window.location.search).get('tab');
      if (tabs.includes(requested)) setTab(requested);
    };
    syncTabFromUrl();
    window.addEventListener('popstate', syncTabFromUrl);
    return () => window.removeEventListener('popstate', syncTabFromUrl);
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
      {tab === 'Maps' && <MapsTab />}
      {tab === 'Images' && <ImagesTab />}
      {tab === 'Backup' && <BackupTab />}
      {tab === 'Avatar' && <AvatarTab />}
      {tab === 'OPENAI' && <OpenAISettingsTab />}
      {tab === 'A2P Messaging' && <A2PMessagingSettingsTab />}
      {tab === 'Access' && <AccessTab />}
      {tab === 'Ports' && (
        <Card title="System Port Registry" icon={IconNetwork} actions={<button className="btn btn-sm" onClick={load}><IconRefresh size={16} className="me-1" />Refresh</button>}>
          <div className="alert alert-info">Use this page to avoid port collisions with 3JCentralPisowifi and other services on the server.</div>
          <Table rows={ports} columns={['environment', 'port', 'protocol', 'scope', 'owner', 'service', 'status', 'notes']} />
        </Card>
      )}
      {tab === 'Runtime' && (
        <div className="row row-cards">
          <div className="col-12">
            <DeploymentControlTab />
          </div>
          <div className="col-12">
            <Card title="Runtime Paths" icon={IconDatabase}>
              <Table rows={[settings.deployment]} columns={['environment', 'main_repo', 'worktrees']} />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
