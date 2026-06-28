import React, { useEffect, useRef, useState } from 'react';
import {
  IconDeviceFloppy,
  IconEdit,
  IconFilter,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSend,
  IconSettings,
  IconShieldLock,
  IconTrash,
  IconUsers,
  IconWifi,
  IconX
} from '@tabler/icons-react';
import './accountAdmin.css';

const API = '/api';

const blankFilters = {
  search: '',
  lifecycle: '',
  customerStatus: '',
  pppoeStatus: ''
};

const PPPOE_ONU_MAPPING_TAB = 'PPPOE_ONU_MAPPING';
const MAPPING_WITHOUT_ONUS = 'WITHOUT_ONUS';
const MAPPING_MATCHED_ONUS = 'MATCHED_ONUS';

const defaultTabs = [
  { label: 'All', value: '', count: 0, tone: 'blue' },
  { label: 'Customer w/ Tickets', value: 'WITH_TICKETS', count: 0, tone: 'orange' },
  { label: 'PPPoE & ONUs', value: PPPOE_ONU_MAPPING_TAB, count: 0, tone: 'green' }
];

const customerStatuses = ['ACTIVE', 'PENDING', 'SUSPENDED', 'INACTIVE'];
const pppoeStatuses = ['UNBOUND', 'ONLINE', 'OFFLINE', 'DISABLED'];

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

function titleize(value) {
  return String(value || 'Unassigned')
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function badgeTone(value) {
  const status = String(value || '').toUpperCase();
  if (['ACTIVE', 'ONLINE', 'PROVISIONED', 'READY', 'MATCHED', 'MATCHED_EXACT', 'MATCHED_PROXIMITY', 'MATCHED_METADATA', 'SAMPLE_MATCH'].includes(status)) return 'success';
  if (['FOR_ACTIVATION', 'FOR_INSTALLATION', 'INSTALLATION', 'PENDING_PROVISIONING', 'PENDING', 'PENDING_ACTIVATION'].includes(status)) return 'warning';
  if (['SUSPENDED', 'DISCONNECTED', 'DISABLED', 'SYNC_ERROR', 'NEEDS_REVIEW', 'UNMATCHED_ONU'].includes(status)) return 'danger';
  return 'secondary';
}

function StatusBadge({ value }) {
  return <span className={`badge bg-${badgeTone(value)}-lt text-${badgeTone(value)}`}>{titleize(value)}</span>;
}

function Card({ title, icon: Icon, children, actions, className = '' }) {
  return (
    <div className={`card ${className}`.trim()}>
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

export default function AccountAdminPage() {
  const [moduleView, setModuleView] = useState('CUSTOMERS');
  const [rows, setRows] = useState([]);
  const [mappingRows, setMappingRows] = useState([]);
  const [mappingMeta, setMappingMeta] = useState(null);
  const [hotspot, setHotspot] = useState({ settings: {}, metrics: {}, data: [], logs: [], guide: [] });
  const [hotspotSettings, setHotspotSettings] = useState({ enabled: false, pisowifiApiBaseUrl: '', apiKey: '', apiSecret: '' });
  const [hotspotFilters, setHotspotFilters] = useState({ search: '', status: '' });
  const [hotspotLoading, setHotspotLoading] = useState(false);
  const [hotspotBusy, setHotspotBusy] = useState('');
  const [hotspotMessage, setHotspotMessage] = useState(null);
  const [hotspotContactModal, setHotspotContactModal] = useState(null);
  const [tabs, setTabs] = useState(defaultTabs);
  const [filters, setFilters] = useState(blankFilters);
  const [mappingView, setMappingView] = useState(MAPPING_WITHOUT_ONUS);
  const [areFiltersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const latestFiltersRef = useRef(blankFilters);
  const searchDebounceRef = useRef(null);

  const hasActiveFilters = ['customerStatus', 'pppoeStatus'].some((key) => Boolean(filters[key]));

  function applyHotspotData(data) {
    setHotspot(data || { settings: {}, metrics: {}, data: [], logs: [], guide: [] });
    setHotspotSettings({
      enabled: Boolean(data?.settings?.enabled),
      pisowifiApiBaseUrl: data?.settings?.pisowifiApiBaseUrl || '',
      apiKey: data?.settings?.apiKey || '',
      apiSecret: '',
    });
  }

  async function load(nextFilters = latestFiltersRef.current, options = {}) {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    if (options.refresh) params.set('refreshPppoe', 'true');
    try {
      const data = await request(`/account-admin/customer-accounts?${params.toString()}`);
      setRows(data.data || []);
      setTabs(data.tabs || defaultTabs);
      if (nextFilters.lifecycle === PPPOE_ONU_MAPPING_TAB) {
        const mappingParams = new URLSearchParams();
        if (nextFilters.search) mappingParams.set('search', nextFilters.search);
        if (nextFilters.pppoeStatus) mappingParams.set('status', nextFilters.pppoeStatus);
        if (options.refresh) mappingParams.set('refresh', 'true');
        const mapping = await request(`/account-admin/pppoe-onu-mapping?${mappingParams.toString()}`);
        setMappingRows(mapping.mappings || []);
        setMappingMeta(mapping);
      } else {
        setMappingRows([]);
        setMappingMeta(null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    return () => window.clearTimeout(searchDebounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (moduleView === 'HOTSPOT') loadHotspot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleView]);

  async function loadHotspot(nextFilters = hotspotFilters) {
    setHotspotLoading(true);
    setHotspotMessage(null);
    const params = new URLSearchParams();
    if (nextFilters.search) params.set('search', nextFilters.search);
    if (nextFilters.status) params.set('status', nextFilters.status);
    try {
      const data = await request(`/account-admin/hotspot-access?${params.toString()}`);
      applyHotspotData(data);
    } catch (err) {
      setHotspotMessage({ tone: 'danger', text: err.message });
    } finally {
      setHotspotLoading(false);
    }
  }

  function updateHotspotFilters(next) {
    const merged = { ...hotspotFilters, ...next };
    setHotspotFilters(merged);
    loadHotspot(merged);
  }

  async function saveHotspotSettings() {
    setHotspotBusy('settings');
    setHotspotMessage(null);
    try {
      const data = await request('/account-admin/hotspot-access/settings', {
        method: 'PATCH',
        body: JSON.stringify(hotspotSettings)
      });
      setHotspotMessage({ tone: 'success', text: data.message || 'Hotspot Access settings saved.' });
      loadHotspot();
    } catch (err) {
      setHotspotMessage({ tone: 'danger', text: err.message });
    } finally {
      setHotspotBusy('');
    }
  }

  async function testHotspotConnection() {
    setHotspotBusy('test');
    setHotspotMessage(null);
    try {
      const data = await request('/account-admin/hotspot-access/test', { method: 'POST', body: JSON.stringify({}) });
      setHotspotMessage({ tone: 'success', text: data.message || 'Pisowifi endpoint is reachable.' });
      loadHotspot();
    } catch (err) {
      setHotspotMessage({ tone: 'danger', text: err.message });
    } finally {
      setHotspotBusy('');
    }
  }

  async function syncHotspot(customerId = '') {
    const busyKey = customerId ? `sync-${customerId}` : 'sync-all';
    setHotspotBusy(busyKey);
    setHotspotMessage(null);
    try {
      const path = customerId
        ? `/account-admin/hotspot-access/subscribers/${encodeURIComponent(customerId)}/sync`
        : '/account-admin/hotspot-access/sync';
      const data = await request(path, { method: 'POST', body: JSON.stringify({}) });
      setHotspotMessage({ tone: 'success', text: data.message || 'Monthly subscribers synced.' });
      loadHotspot();
    } catch (err) {
      setHotspotMessage({ tone: 'danger', text: err.message });
    } finally {
      setHotspotBusy('');
    }
  }

  function openHotspotContactModal(row) {
    const contacts = (row.contacts || []).map((contact) => ({
      contactNumber: contact.contact_number || '',
      label: contact.label || 'Contact',
      enabled: contact.enabled !== false
    }));
    setHotspotContactModal({
      row,
      contacts: contacts.length ? contacts : [{ contactNumber: '', label: 'Primary', enabled: true }],
      message: null
    });
  }

  function updateHotspotContact(index, patch) {
    setHotspotContactModal((current) => {
      if (!current) return current;
      return {
        ...current,
        contacts: current.contacts.map((contact, contactIndex) => (
          contactIndex === index ? { ...contact, ...patch } : contact
        )),
        message: null
      };
    });
  }

  function addHotspotContact() {
    setHotspotContactModal((current) => {
      if (!current) return current;
      return {
        ...current,
        contacts: [
          ...current.contacts,
          { contactNumber: '', label: `Contact ${current.contacts.length + 1}`, enabled: true }
        ],
        message: null
      };
    });
  }

  function removeHotspotContact(index) {
    setHotspotContactModal((current) => {
      if (!current) return current;
      const contacts = current.contacts.filter((_, contactIndex) => contactIndex !== index);
      return {
        ...current,
        contacts: contacts.length ? contacts : [{ contactNumber: '', label: 'Primary', enabled: true }],
        message: null
      };
    });
  }

  async function saveHotspotContacts(syncAfterSave = false) {
    if (!hotspotContactModal?.row) return;
    const row = hotspotContactModal.row;
    const contacts = hotspotContactModal.contacts
      .map((contact) => ({
        contactNumber: String(contact.contactNumber || '').trim(),
        label: String(contact.label || '').trim() || 'Contact',
        enabled: contact.enabled !== false
      }))
      .filter((contact) => contact.contactNumber);
    setHotspotBusy('contacts');
    setHotspotContactModal((current) => current ? { ...current, message: null } : current);
    try {
      await request(`/account-admin/hotspot-access/subscribers/${encodeURIComponent(row.external_subscriber_id)}/contacts`, {
        method: 'PATCH',
        body: JSON.stringify({ contacts })
      });
      if (syncAfterSave) {
        await request(`/account-admin/hotspot-access/subscribers/${encodeURIComponent(row.external_subscriber_id)}/sync`, {
          method: 'POST',
          body: JSON.stringify({})
        });
      }
      await loadHotspot();
      setHotspotMessage({ tone: 'success', text: syncAfterSave ? 'Subscriber contacts saved and synced.' : 'Subscriber contacts saved.' });
      setHotspotContactModal(null);
    } catch (err) {
      setHotspotContactModal((current) => current ? { ...current, message: { tone: 'danger', text: err.message } } : current);
    } finally {
      setHotspotBusy('');
    }
  }

  function updateFilters(next) {
    const merged = { ...latestFiltersRef.current, ...next };
    latestFiltersRef.current = merged;
    setFilters(merged);
    load(merged);
  }

  function handleSearchChange(value) {
    const merged = { ...latestFiltersRef.current, search: value };
    latestFiltersRef.current = merged;
    setFilters(merged);
    window.clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = window.setTimeout(() => {
      load(latestFiltersRef.current);
    }, 350);
  }

  function submitSearch() {
    window.clearTimeout(searchDebounceRef.current);
    load(latestFiltersRef.current);
  }

  function clearSearch() {
    window.clearTimeout(searchDebounceRef.current);
    updateFilters({ search: '' });
  }

  function handleFilterButtonClick() {
    if (areFiltersOpen && hasActiveFilters) {
      updateFilters({ customerStatus: '', pppoeStatus: '' });
      return;
    }
    setFiltersOpen((value) => !value);
  }

  const isPppoeOnuMappingTab = filters.lifecycle === PPPOE_ONU_MAPPING_TAB;
  const unmatchedMappingRows = mappingRows.filter((row) => !row.matched);
  const matchedMappingRows = mappingRows.filter((row) => row.matched);
  const visibleMappingRows = mappingView === MAPPING_MATCHED_ONUS ? matchedMappingRows : unmatchedMappingRows;
  const mappingViewLabel = mappingView === MAPPING_MATCHED_ONUS ? 'PPPoE with matched ONUs' : 'PPPoE without ONUs';
  const tableTitle = isPppoeOnuMappingTab ? `${mappingViewLabel} (${visibleMappingRows.length})` : `Customer Accounts (${rows.length})`;

  function renderHotspotAccess() {
    const metrics = hotspot.metrics || {};
    const subscriberRows = hotspot.data || [];
    return (
      <div className="row row-cards">
        {hotspotMessage && (
          <div className="col-12">
            <div className={`alert alert-${hotspotMessage.tone || 'info'}`}>{hotspotMessage.text}</div>
          </div>
        )}
        <div className="col-lg-4">
          <Card title="Hotspot Access Settings" icon={IconSettings}>
            <div className="mb-3">
              <label className="form-check form-switch">
                <input className="form-check-input" type="checkbox" checked={hotspotSettings.enabled} onChange={(event) => setHotspotSettings({ ...hotspotSettings, enabled: event.target.checked })} />
                <span className="form-check-label">Enable monthly subscriber sync</span>
              </label>
            </div>
            <div className="mb-3">
              <label className="form-label">Pisowifi API Base URL</label>
              <input className="form-control" placeholder="https://net.3jhotspot.com" value={hotspotSettings.pisowifiApiBaseUrl} onChange={(event) => setHotspotSettings({ ...hotspotSettings, pisowifiApiBaseUrl: event.target.value })} />
            </div>
            <div className="mb-3">
              <label className="form-label">API Key</label>
              <input className="form-control" value={hotspotSettings.apiKey} onChange={(event) => setHotspotSettings({ ...hotspotSettings, apiKey: event.target.value })} />
            </div>
            <div className="mb-3">
              <label className="form-label">API Secret</label>
              <input className="form-control" type="password" placeholder={hotspot.settings?.apiSecretSet ? 'Saved. Leave blank to keep current secret.' : 'Required before sync'} value={hotspotSettings.apiSecret} onChange={(event) => setHotspotSettings({ ...hotspotSettings, apiSecret: event.target.value })} />
            </div>
            <div className="d-flex flex-wrap gap-2">
              <button className="btn btn-primary" type="button" disabled={!!hotspotBusy} onClick={saveHotspotSettings}>
                <IconDeviceFloppy size={18} className="me-2" />{hotspotBusy === 'settings' ? 'Saving...' : 'Save Settings'}
              </button>
              <button className="btn" type="button" disabled={!!hotspotBusy} onClick={testHotspotConnection}>
                <IconShieldLock size={18} className="me-2" />{hotspotBusy === 'test' ? 'Testing...' : 'Test'}
              </button>
            </div>
            <div className="text-muted small mt-3">
              Requests are signed with HMAC headers. Configure the same key and secret in Pisowifi Monthly Subscribers settings.
            </div>
          </Card>
        </div>
        <div className="col-lg-8">
          <div className="row row-cards">
            <div className="col-sm-6 col-xl-3">
              <div className="card"><div className="card-body"><div className="text-muted small">Subscribers</div><div className="h2 mb-0">{metrics.subscribers || 0}</div></div></div>
            </div>
            <div className="col-sm-6 col-xl-3">
              <div className="card"><div className="card-body"><div className="text-muted small">Active</div><div className="h2 mb-0">{metrics.active || 0}</div></div></div>
            </div>
            <div className="col-sm-6 col-xl-3">
              <div className="card"><div className="card-body"><div className="text-muted small">Enabled contacts</div><div className="h2 mb-0">{metrics.enabledContacts || 0}</div></div></div>
            </div>
            <div className="col-sm-6 col-xl-3">
              <div className="card"><div className="card-body"><div className="text-muted small">No contact</div><div className="h2 mb-0">{metrics.withoutContacts || 0}</div></div></div>
            </div>
            <div className="col-12">
              <Card
                title={`Monthly Subscribers (${subscriberRows.length})`}
                icon={IconWifi}
                actions={(
                  <div className="d-flex flex-wrap gap-2">
                    <div className="input-icon account-admin-hotspot-search">
                      <span className="input-icon-addon"><IconSearch size={16} /></span>
                      <input className="form-control form-control-sm" placeholder="Search subscriber or contact" value={hotspotFilters.search} onChange={(event) => updateHotspotFilters({ search: event.target.value })} />
                    </div>
                    <select className="form-select form-select-sm account-admin-hotspot-status" value={hotspotFilters.status} onChange={(event) => updateHotspotFilters({ status: event.target.value })}>
                      <option value="">All</option>
                      <option value="ACTIVE">Active</option>
                      <option value="INACTIVE">Inactive</option>
                      <option value="SUSPENDED">Suspended</option>
                    </select>
                    <button className="btn btn-primary btn-sm" type="button" disabled={!!hotspotBusy || hotspotLoading} onClick={() => syncHotspot()}>
                      <IconSend size={17} className="me-2" />{hotspotBusy === 'sync-all' ? 'Syncing...' : 'Sync All'}
                    </button>
                  </div>
                )}
              >
                <div className="table-responsive">
                  <table className="table table-vcenter card-table account-admin-table">
                    <thead>
                      <tr>
                        <th>Subscriber</th>
                        <th>Service</th>
                        <th>Contacts</th>
                        <th>Status</th>
                        <th className="w-1">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hotspotLoading && (
                        <tr><td colSpan="5" className="text-muted">Loading monthly subscribers...</td></tr>
                      )}
                      {!hotspotLoading && subscriberRows.length === 0 && (
                        <tr><td colSpan="5"><div className="empty">No monthly subscribers match the current filters.</div></td></tr>
                      )}
                      {!hotspotLoading && subscriberRows.map((row) => (
                        <tr key={row.external_subscriber_id}>
                          <td>
                            <div className="fw-bold">{row.customer_name}</div>
                            <div className="text-muted small">{row.account_number || row.external_subscriber_id}</div>
                          </td>
                          <td>
                            <div>{row.plan_name || '-'}</div>
                            <div className="text-muted small">{row.service_account_number || '-'}</div>
                          </td>
                          <td>
                            <div className="account-admin-contact-stack">
                              {(row.contacts || []).map((contact) => (
                                <span key={contact.normalized_contact || contact.contact_number} className={`badge ${contact.enabled ? 'bg-green-lt text-green' : 'bg-secondary-lt text-secondary'}`}>
                                  {contact.contact_number} {contact.label ? `· ${contact.label}` : ''}
                                </span>
                              ))}
                              {!(row.contacts || []).length && <span className="text-muted small">No valid mobile contacts</span>}
                            </div>
                          </td>
                          <td><StatusBadge value={row.status} /></td>
                          <td>
                            <div className="btn-list flex-nowrap">
                              <button className="btn btn-icon btn-outline-secondary btn-sm" type="button" disabled={!!hotspotBusy} onClick={() => openHotspotContactModal(row)} title="Edit allowed contact numbers">
                                <IconEdit size={16} />
                              </button>
                              <button className="btn btn-outline-primary btn-sm" type="button" disabled={!!hotspotBusy} onClick={() => syncHotspot(row.external_subscriber_id)}>
                                {hotspotBusy === `sync-${row.external_subscriber_id}` ? 'Syncing...' : 'Sync'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
            <div className="col-12">
              <Card title="Recent Sync Logs" icon={IconRefresh}>
                <div className="list-group list-group-flush">
                  {(hotspot.logs || []).slice(0, 6).map((log) => (
                    <div className="list-group-item px-0" key={log.id || log.createdAt}>
                      <div className="d-flex justify-content-between gap-2">
                        <div>
                          <div className="fw-semibold">{log.action || 'SYNC'}</div>
                          <div className="text-muted small">{log.message || '-'}</div>
                        </div>
                        <div className="text-end">
                          <StatusBadge value={log.status || 'SUCCESS'} />
                          <div className="text-muted small mt-1">{log.createdAt || '-'}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {!(hotspot.logs || []).length && <div className="text-muted">No sync logs yet.</div>}
                </div>
              </Card>
            </div>
          </div>
        </div>
        {hotspotContactModal && (
          <div className="modal modal-blur d-block account-admin-modal-backdrop" tabIndex="-1" role="dialog" aria-modal="true">
            <div className="modal-dialog modal-lg modal-dialog-centered" role="document">
              <div className="modal-content">
                <div className="modal-header">
                  <div>
                    <h5 className="modal-title">Allowed Monthly Login Contacts</h5>
                    <div className="text-muted small">
                      {hotspotContactModal.row.customer_name} · {hotspotContactModal.row.service_account_number || hotspotContactModal.row.account_number || hotspotContactModal.row.external_subscriber_id}
                    </div>
                  </div>
                  <button type="button" className="btn-close" aria-label="Close" onClick={() => setHotspotContactModal(null)} />
                </div>
                <div className="modal-body">
                  {hotspotContactModal.message && (
                    <div className={`alert alert-${hotspotContactModal.message.tone || 'info'}`}>{hotspotContactModal.message.text}</div>
                  )}
                  <div className="alert alert-info">
                    One contact number can bind to one captive portal device. Add one contact per monthly device that should get free subscriber access.
                  </div>
                  <div className="account-admin-hotspot-contact-list">
                    {hotspotContactModal.contacts.map((contact, index) => (
                      <div className="account-admin-hotspot-contact-row" key={`${index}-${contact.contactNumber}`}>
                        <div>
                          <label className="form-label">Contact number</label>
                          <input
                            className="form-control"
                            placeholder="09000000000"
                            value={contact.contactNumber}
                            onChange={(event) => updateHotspotContact(index, { contactNumber: event.target.value })}
                          />
                        </div>
                        <div>
                          <label className="form-label">Label</label>
                          <input
                            className="form-control"
                            placeholder="Primary, spouse, child"
                            value={contact.label}
                            onChange={(event) => updateHotspotContact(index, { label: event.target.value })}
                          />
                        </div>
                        <label className="form-check form-switch account-admin-hotspot-contact-switch">
                          <input className="form-check-input" type="checkbox" checked={contact.enabled !== false} onChange={(event) => updateHotspotContact(index, { enabled: event.target.checked })} />
                          <span className="form-check-label">Enabled</span>
                        </label>
                        <button className="btn btn-icon btn-outline-danger" type="button" onClick={() => removeHotspotContact(index)} title="Remove contact">
                          <IconTrash size={17} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button className="btn btn-outline-primary mt-3" type="button" onClick={addHotspotContact}>
                    <IconPlus size={17} className="me-2" />Add contact number
                  </button>
                </div>
                <div className="modal-footer">
                  <button className="btn" type="button" onClick={() => setHotspotContactModal(null)}>Cancel</button>
                  <button className="btn btn-outline-primary" type="button" disabled={hotspotBusy === 'contacts'} onClick={() => saveHotspotContacts(false)}>
                    {hotspotBusy === 'contacts' ? 'Saving...' : 'Save Contacts'}
                  </button>
                  <button className="btn btn-primary" type="button" disabled={hotspotBusy === 'contacts'} onClick={() => saveHotspotContacts(true)}>
                    {hotspotBusy === 'contacts' ? 'Saving...' : 'Save & Sync'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="account-admin-module">
      <div className="account-admin-module-view-tabs" role="tablist" aria-label="Account Admin views">
        <button className={`account-admin-module-view-tab ${moduleView === 'CUSTOMERS' ? 'active' : ''}`} type="button" onClick={() => setModuleView('CUSTOMERS')} role="tab" aria-selected={moduleView === 'CUSTOMERS'}>
          <IconUsers size={17} /> Customer Accounts
        </button>
        <button className={`account-admin-module-view-tab ${moduleView === 'HOTSPOT' ? 'active' : ''}`} type="button" onClick={() => setModuleView('HOTSPOT')} role="tab" aria-selected={moduleView === 'HOTSPOT'}>
          <IconWifi size={17} /> Hotspot Access
        </button>
      </div>

      {moduleView === 'HOTSPOT' ? renderHotspotAccess() : (
      <>
        {error && <div className="alert alert-danger">{error}</div>}

      <div className="row row-cards">
        <div className="col-12">
          <Card
            className="account-admin-table-card"
            title={tableTitle}
            icon={IconUsers}
            actions={(
              <div className="btn-list account-admin-header-actions">
                <div className="account-admin-header-search">
                  <label className="visually-hidden" htmlFor="customer-account-search">Search customer accounts</label>
                  <div className="input-icon account-admin-header-search-input">
                    <span className="input-icon-addon"><IconSearch size={16} /></span>
                    <input
                      id="customer-account-search"
                      className="form-control form-control-sm"
                      placeholder="Search customer, account, PPPoE, router, ONU, ticket"
                      value={filters.search}
                      onChange={(event) => handleSearchChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          submitSearch();
                        }
                      }}
                    />
                    {filters.search && (
                      <button type="button" className="account-admin-search-clear" title="Clear search" aria-label="Clear search" onClick={clearSearch}>
                        <IconX size={14} />
                      </button>
                    )}
                  </div>
                </div>
                <button
                  className={`btn btn-outline-secondary btn-sm account-admin-header-icon-button ${areFiltersOpen ? 'active' : ''}`}
                  title={areFiltersOpen ? (hasActiveFilters ? 'Clear Filters' : 'Close Filter') : 'Filter'}
                  aria-label={areFiltersOpen ? (hasActiveFilters ? 'Clear Filters' : 'Close Filter') : 'Filter'}
                  onClick={handleFilterButtonClick}
                  aria-expanded={areFiltersOpen}
                  type="button"
                >
                  {areFiltersOpen ? <IconX size={16} /> : <IconFilter size={16} />}
                </button>
              </div>
            )}
          >
            {areFiltersOpen && (
              <div className="account-admin-table-filters">
                <div className="row g-2 align-items-end">
                  <div className="col-md-3">
                    {!isPppoeOnuMappingTab && (
                      <>
                        <label className="form-label">Customer Status</label>
                        <select className="form-select" value={filters.customerStatus} onChange={(event) => updateFilters({ customerStatus: event.target.value })}>
                          <option value="">All</option>
                          {customerStatuses.map((item) => <option key={item} value={item}>{titleize(item)}</option>)}
                        </select>
                      </>
                    )}
                  </div>
                  <div className="col-md-3">
                    <label className="form-label">PPPoE Status</label>
                    <select className="form-select" value={filters.pppoeStatus} onChange={(event) => updateFilters({ pppoeStatus: event.target.value })}>
                      <option value="">All</option>
                      {pppoeStatuses.map((item) => <option key={item} value={item}>{titleize(item)}</option>)}
                    </select>
                  </div>
                  <div className="col-md-auto">
                    <button className="btn" type="button" onClick={() => load(filters, { refresh: true })}>
                      <IconRefresh size={18} className="me-2" />
                      Refresh
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="account-admin-status-tabs" role="tablist" aria-label="Customer account status filter">
              {tabs.map((item) => (
                <button
                  type="button"
                  key={item.label}
                  className={`account-admin-status-tab ${filters.lifecycle === item.value ? 'active' : ''}`}
                  onClick={() => updateFilters({ lifecycle: item.value })}
                  role="tab"
                  aria-selected={filters.lifecycle === item.value}
                >
                  <span>{item.label}</span>
                  <span className={`badge bg-${item.tone}-lt text-${item.tone}`}>{item.count}</span>
                </button>
              ))}
            </div>

            {isPppoeOnuMappingTab && (
              <div className="account-admin-mapping-tabs" role="tablist" aria-label="PPPoE ONU match filter">
                <button
                  type="button"
                  className={`account-admin-mapping-tab ${mappingView === MAPPING_WITHOUT_ONUS ? 'active' : ''}`}
                  onClick={() => setMappingView(MAPPING_WITHOUT_ONUS)}
                  role="tab"
                  aria-selected={mappingView === MAPPING_WITHOUT_ONUS}
                >
                  <span>PPPoE without ONUs</span>
                  <span className="badge bg-red-lt text-red">{unmatchedMappingRows.length}</span>
                </button>
                <button
                  type="button"
                  className={`account-admin-mapping-tab ${mappingView === MAPPING_MATCHED_ONUS ? 'active' : ''}`}
                  onClick={() => setMappingView(MAPPING_MATCHED_ONUS)}
                  role="tab"
                  aria-selected={mappingView === MAPPING_MATCHED_ONUS}
                >
                  <span>PPPoE with matched ONUs</span>
                  <span className="badge bg-green-lt text-green">{matchedMappingRows.length}</span>
                </button>
              </div>
            )}

            {isPppoeOnuMappingTab && mappingView === MAPPING_MATCHED_ONUS && mappingMeta?.sampleMatch?.customer && (
              <div className="account-admin-mapping-sample">
                <div>
                  <div className="text-muted small">Sample matched customer</div>
                  <div className="fw-bold">{mappingMeta.sampleMatch.customer.name}</div>
                </div>
                <div>
                  <div className="text-muted small">PPPoE</div>
                  <div>{mappingMeta.sampleMatch.pppoe?.username || '-'}</div>
                </div>
                <div>
                  <div className="text-muted small">ONU</div>
                  <div>{mappingMeta.sampleMatch.onu?.name || '-'} / {mappingMeta.sampleMatch.onu?.oltName || '-'}</div>
                </div>
              </div>
            )}

            <div className="table-responsive">
              {isPppoeOnuMappingTab ? (
                <table className="table table-vcenter card-table account-admin-table account-admin-mapping-table">
                  <thead>
                    <tr>
                      <th>PPPoE Account</th>
                      <th>Router</th>
                      <th>Status</th>
                      <th>Caller ID / MAC</th>
                      <th>Active IP</th>
                      <th>Matched ONU</th>
                      <th>ONU Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && (
                      <tr>
                        <td colSpan="7" className="text-muted">Loading PPPoE accounts...</td>
                      </tr>
                    )}
                    {!loading && mappingRows.length === 0 && (
                      <tr>
                        <td colSpan="7"><div className="empty">No PPPoE accounts match the current filters.</div></td>
                      </tr>
                    )}
                    {!loading && mappingRows.length > 0 && visibleMappingRows.length === 0 && (
                      <tr>
                        <td colSpan="7"><div className="empty">No rows in {mappingViewLabel.toLowerCase()} for the current filters.</div></td>
                      </tr>
                    )}
                    {!loading && visibleMappingRows.map((row) => (
                      <tr key={row.id || row.pppoe?.id}>
                        <td>
                          <div className="fw-bold">{row.pppoe?.username || '-'}</div>
                          <div className="text-muted small">{row.pppoe?.profile || row.pppoe?.service || '-'}</div>
                        </td>
                        <td>
                          <div>{row.pppoe?.routerName || '-'}</div>
                          <div className="text-muted small">{row.pppoe?.routerEndpoint || '-'}</div>
                        </td>
                        <td><StatusBadge value={row.pppoe?.status} /></td>
                        <td>
                          <div>{row.pppoe?.callerId || '-'}</div>
                          <div className="text-muted small">{row.pppoe?.macAddress || row.pppoe?.lastCallerId || '-'}</div>
                        </td>
                        <td>
                          <div>{row.pppoe?.activeAddress || row.pppoe?.remoteAddress || '-'}</div>
                        </td>
                        <td>
                          <div className="fw-bold">{row.onu?.name || '-'}</div>
                          <div className="text-muted small">
                            {row.onu ? `${row.onu.oltName || '-'} / ${row.onu.ponLabel || '-'} / ONU ${row.onu.onuId || '-'}` : 'No captured ONU'}
                          </div>
                          <div className="text-muted small">{row.onu?.macAddress || row.onu?.learnedClientMacAddress || row.onu?.serialNumber || '-'}</div>
                        </td>
                        <td>
                          <StatusBadge value={row.matchStatus} />
                          <div className="text-muted small mt-1">{row.matchReason || '-'}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="table table-vcenter card-table account-admin-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Customer Status</th>
                      <th>PPPoE Account</th>
                      <th>Router</th>
                      <th>Tickets</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && (
                      <tr>
                        <td colSpan="5" className="text-muted">Loading customer accounts...</td>
                      </tr>
                    )}
                    {!loading && rows.length === 0 && (
                      <tr>
                        <td colSpan="5"><div className="empty">No customer accounts match the current filters.</div></td>
                      </tr>
                    )}
                    {!loading && rows.map((row) => (
                      <tr key={row.customerId}>
                        <td>
                          <div className="fw-bold">{row.customer.name}</div>
                          <div className="text-muted small">{row.customer.accountNumber || row.customer.contactNumber || '-'}</div>
                        </td>
                        <td><StatusBadge value={row.customer.status} /></td>
                        <td>
                          <div>{row.pppoeBinding?.username || row.desiredPppoeUsername || '-'}</div>
                          <div className="mt-1"><StatusBadge value={row.pppoeStatus} /></div>
                        </td>
                        <td>
                          <div>{row.pppoeBinding?.routerName || row.routerName || '-'}</div>
                          <div className="text-muted small">{row.pppoeBinding?.activeAddress || row.pppoeBinding?.remoteAddress || row.staticIp || '-'}</div>
                        </td>
                        <td>
                          <div className="d-flex align-items-center gap-2">
                            <span className={`badge bg-${row.openTicketCount ? 'orange' : 'secondary'}-lt text-${row.openTicketCount ? 'orange' : 'secondary'}`}>
                              {row.ticketCount || 0}
                            </span>
                            <span>{row.latestTicket?.ticketNumber || '-'}</span>
                          </div>
                          {row.latestTicket ? (
                            <div className="account-admin-ticket-stack">
                              <div className="account-admin-ticket-meta">
                                <StatusBadge value={row.latestTicket.category || 'GENERAL'} />
                                <StatusBadge value={row.latestTicket.status || 'OPEN'} />
                                <StatusBadge value={row.latestTicket.priority || 'NORMAL'} />
                              </div>
                              <div className="text-muted small">{row.latestTicket.subject || 'No ticket subject'}</div>
                              {(row.latestTicket.accountAdminActions || []).length > 0 && (
                                <div className="account-admin-ticket-actions">
                                  {(row.latestTicket.accountAdminActions || []).map((action) => (
                                    <span className="badge bg-green-lt text-green" key={action.code}>{action.label}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="text-muted small">No assigned ticket</div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
