import React, { useEffect, useRef, useState } from 'react';
import {
  IconActivity,
  IconCircleCheck,
  IconDashboard,
  IconDatabase,
  IconDeviceFloppy,
  IconEdit,
  IconEye,
  IconFilter,
  IconHelp,
  IconHistory,
  IconInfoCircle,
  IconKey,
  IconLock,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSend,
  IconServer,
  IconSettings,
  IconShieldLock,
  IconTrash,
  IconUsers,
  IconWifi,
  IconX
} from '@tabler/icons-react';
import './accountAccessManagement.css';

const API = '/api';

const blankFilters = {
  search: '',
  lifecycle: 'ACCOUNT_ACTIVE',
  accessFilter: '',
  customerStatus: '',
  pppoeStatus: '',
  internetStatus: '',
  hotspotStatus: '',
  iptvStatus: ''
};

const PPPOE_ONU_MAPPING_TAB = 'PPPOE_ONU_MAPPING';
const MAPPING_WITHOUT_ONUS = 'WITHOUT_ONUS';
const MAPPING_MATCHED_ONUS = 'MATCHED_ONUS';

const defaultTabs = [
  { label: 'Active', value: 'ACCOUNT_ACTIVE', count: 0, tone: 'green' },
  { label: 'Inactive', value: 'ACCOUNT_INACTIVE', count: 0, tone: 'secondary' }
];

const accessFilters = [
  { label: 'All Access', value: '' },
  { label: 'Needs Action', value: 'NEEDS_ACTION' },
  { label: 'With Internet', value: 'WITH_INTERNET' },
  { label: 'With Hotspot', value: 'WITH_HOTSPOT' },
  { label: 'With IPTV', value: 'WITH_IPTV' },
  { label: 'No Access', value: 'NO_ACCESS' }
];

const customerStatuses = ['ACTIVE', 'PENDING', 'SUSPENDED', 'INACTIVE'];
const pppoeStatuses = ['UNBOUND', 'ONLINE', 'OFFLINE', 'DISABLED'];
const internetAccessStatuses = ['ACTIVE', 'PROVISIONED', 'OFFLINE', 'DISABLED', 'NEEDS_SETUP', 'PENDING_SERVICE', 'NO_SERVICE'];
const hotspotAccessStatuses = ['ACTIVE', 'READY_TO_SYNC', 'NO_CONTACT', 'NO_SERVICE', 'SUSPENDED'];
const iptvAccessStatuses = ['ACTIVE', 'NEEDS_SETUP', 'PENDING', 'SUBSCRIBED', 'NOT_SUBSCRIBED'];
const moduleViews = new Set(['CUSTOMERS', 'PPPOE_ONU_MAPPING', 'INTERNET', 'HOTSPOT', 'IPTV']);

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
  if (['FOR_ACTIVATION', 'FOR_INSTALLATION', 'INSTALLATION', 'PENDING_PROVISIONING', 'PENDING', 'PENDING_ACTIVATION', 'NEEDS_ACTION', 'NEEDS_SETUP', 'READY_TO_SYNC', 'PENDING_SERVICE', 'NO_CONTACT', 'SUBSCRIBED'].includes(status)) return 'warning';
  if (['SUSPENDED', 'DISCONNECTED', 'DISABLED', 'SYNC_ERROR', 'NEEDS_REVIEW', 'UNMATCHED_ONU', 'OFFLINE'].includes(status)) return 'danger';
  return 'secondary';
}

function StatusBadge({ value }) {
  return <span className={`badge bg-${badgeTone(value)}-lt text-${badgeTone(value)}`}>{titleize(value)}</span>;
}

function defaultAccessFilterForModuleView(view) {
  if (view === 'INTERNET') return 'WITH_INTERNET';
  if (view === 'IPTV') return 'WITH_IPTV';
  return '';
}

function normalizedModuleView(view) {
  return moduleViews.has(view) ? view : 'CUSTOMERS';
}

function filtersForModuleView(view, current = blankFilters) {
  const nextView = normalizedModuleView(view);
  if (nextView === 'PPPOE_ONU_MAPPING') {
    return {
      ...current,
      lifecycle: PPPOE_ONU_MAPPING_TAB,
      accessFilter: '',
      customerStatus: '',
      internetStatus: '',
      hotspotStatus: '',
      iptvStatus: ''
    };
  }
  return {
    ...current,
    lifecycle: current.lifecycle === PPPOE_ONU_MAPPING_TAB ? 'ACCOUNT_ACTIVE' : (current.lifecycle || 'ACCOUNT_ACTIVE'),
    accessFilter: defaultAccessFilterForModuleView(nextView)
  };
}

function hotspotSyncResult(log) {
  return log?.details?.result || log?.details || {};
}

function HotspotSyncResultChips({ log }) {
  const result = hotspotSyncResult(log);
  const mode = String(result.sync_mode || '').toUpperCase();
  const disabledSubscribers = Number(result.disabled_subscriber_count || 0);
  const disabledContacts = Number(result.disabled_contact_count || 0);
  const revokedSessions = Number(result.revoked_session_count || 0);
  const contactCount = Number(result.contact_count || 0);
  const subscriberCount = Number(result.subscriber_count || 0);
  const chips = [];
  if (mode) chips.push({ label: mode, tone: mode === 'FULL' ? 'blue' : 'secondary' });
  if (subscriberCount || contactCount) chips.push({ label: `${subscriberCount} subs / ${contactCount} contacts`, tone: 'secondary' });
  if (disabledSubscribers) chips.push({ label: `${disabledSubscribers} disabled subs`, tone: 'orange' });
  if (disabledContacts) chips.push({ label: `${disabledContacts} disabled contacts`, tone: 'orange' });
  if (revokedSessions) chips.push({ label: `${revokedSessions} sessions revoked`, tone: 'red' });
  if (!chips.length) return null;
  return (
    <div className="d-flex flex-wrap gap-1 mt-2">
      {chips.map((chip) => (
        <span key={`${chip.label}-${chip.tone}`} className={`badge bg-${chip.tone}-lt text-${chip.tone}`}>{chip.label}</span>
      ))}
    </div>
  );
}

function AccessSummaryCell({ summary }) {
  const details = (summary?.details || []).filter(Boolean);
  return (
    <div className="account-access-management-access-cell">
      <div className="account-access-management-access-heading">
        <StatusBadge value={summary?.status || 'NO_SERVICE'} />
      </div>
      <div className="fw-semibold account-access-management-access-primary">{summary?.primary || '-'}</div>
      {summary?.secondary && <div className="text-muted small">{summary.secondary}</div>}
      {details.length > 0 && (
        <div className="account-access-management-access-detail-list">
          {details.slice(0, 3).map((detail) => (
            <span className="badge bg-secondary-lt text-secondary" key={detail}>{detail}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function CheckIndicator({ active, label }) {
  return (
    <span className={`account-access-management-check-indicator ${active ? 'active' : ''}`} title={`${label}: ${active ? 'Active' : 'Inactive'}`} aria-label={`${label}: ${active ? 'Active' : 'Inactive'}`}>
      {active ? <IconCircleCheck size={17} /> : <span aria-hidden="true">-</span>}
    </span>
  );
}

function HotspotAccessCell({ summary }) {
  const active = summary?.status === 'ACTIVE' || Boolean(summary?.hasAccess);
  const enabled = Number(summary?.enabledContactCount || 0);
  const total = Number(summary?.contactCount || 0);
  return (
    <div className="account-access-management-compact-access-cell">
      <CheckIndicator active={active} label="Hotspot Access" />
      <div>
        <div className="fw-semibold">{active ? 'Active' : 'Inactive'}</div>
        <div className="text-muted small">{enabled}/{total} contacts allowed</div>
      </div>
    </div>
  );
}

function IptvAccessCell({ summary }) {
  const active = summary?.status === 'ACTIVE' || Boolean(summary?.hasAccess);
  return (
    <div className="account-access-management-compact-access-cell">
      <CheckIndicator active={active} label="IPTV Access" />
      <div className="fw-semibold">{active ? 'Active' : 'Inactive'}</div>
    </div>
  );
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

export default function AccountAccessManagementPage({ initialView = 'CUSTOMERS' } = {}) {
  const initialModuleView = normalizedModuleView(initialView);
  const initialFilters = filtersForModuleView(initialModuleView);
  const [moduleView, setModuleView] = useState(initialModuleView);
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
  const [hotspotPageTab, setHotspotPageTab] = useState('Overview');
  const [hotspotOverviewTab, setHotspotOverviewTab] = useState('Subscribers');
  const [hotspotGuideOpen, setHotspotGuideOpen] = useState(false);
  const [tabs, setTabs] = useState(defaultTabs);
  const [filters, setFilters] = useState(initialFilters);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [detailTab, setDetailTab] = useState('INTERNET');
  const [mappingView, setMappingView] = useState(MAPPING_WITHOUT_ONUS);
  const [areFiltersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const latestFiltersRef = useRef(initialFilters);
  const latestRowsRef = useRef([]);
  const loadRequestRef = useRef(0);
  const searchDebounceRef = useRef(null);

  const hasActiveFilters = ['accessFilter', 'customerStatus', 'internetStatus', 'hotspotStatus', 'iptvStatus', 'pppoeStatus'].some((key) => Boolean(filters[key]));

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
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    if (options.refresh) params.set('refreshPppoe', 'true');
    try {
      if (nextFilters.lifecycle === PPPOE_ONU_MAPPING_TAB) {
        const mappingParams = new URLSearchParams();
        if (nextFilters.search) mappingParams.set('search', nextFilters.search);
        if (nextFilters.pppoeStatus) mappingParams.set('status', nextFilters.pppoeStatus);
        if (options.refresh) mappingParams.set('refresh', 'true');
        const mapping = await request(`/account-access-management/pppoe-onu-mapping?${mappingParams.toString()}`);
        if (requestId !== loadRequestRef.current) return;
        latestRowsRef.current = [];
        setRows([]);
        setSelectedCustomerId('');
        setTabs(defaultTabs);
        setMappingRows(mapping.mappings || []);
        setMappingMeta(mapping);
        return;
      }
      const data = await request(`/account-access-management/customer-accounts?${params.toString()}`);
      if (requestId !== loadRequestRef.current) return;
      const nextRows = data.data || [];
      latestRowsRef.current = nextRows;
      setRows(nextRows);
      setTabs(data.tabs || defaultTabs);
      setSelectedCustomerId((current) => (
        current && !nextRows.some((row) => row.customerId === current) ? '' : current
      ));
      setMappingRows([]);
      setMappingMeta(null);
    } catch (err) {
      if (requestId !== loadRequestRef.current) return;
      setError(err.message);
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (moduleView !== 'HOTSPOT') load();
    return () => window.clearTimeout(searchDebounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const nextView = normalizedModuleView(initialView);
    if (nextView !== moduleView) changeModuleView(nextView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialView]);

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
      const data = await request(`/account-access-management/hotspot-access?${params.toString()}`);
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

  function changeModuleView(nextView) {
    const normalizedView = normalizedModuleView(nextView);
    setModuleView(normalizedView);
    setSelectedCustomerId('');
    if (normalizedView === 'HOTSPOT') return;
    const merged = filtersForModuleView(normalizedView, latestFiltersRef.current);
    latestFiltersRef.current = merged;
    setFilters(merged);
    load(merged);
  }

  async function saveHotspotSettings() {
    setHotspotBusy('settings');
    setHotspotMessage(null);
    try {
      const data = await request('/account-access-management/hotspot-access/settings', {
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
      const data = await request('/account-access-management/hotspot-access/test', { method: 'POST', body: JSON.stringify({}) });
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
        ? `/account-access-management/hotspot-access/subscribers/${encodeURIComponent(customerId)}/sync`
        : '/account-access-management/hotspot-access/sync';
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
      await request(`/account-access-management/hotspot-access/subscribers/${encodeURIComponent(row.external_subscriber_id)}/contacts`, {
        method: 'PATCH',
        body: JSON.stringify({ contacts })
      });
      if (syncAfterSave) {
        await request(`/account-access-management/hotspot-access/subscribers/${encodeURIComponent(row.external_subscriber_id)}/sync`, {
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
      updateFilters({
        accessFilter: '',
        customerStatus: '',
        internetStatus: '',
        hotspotStatus: '',
        iptvStatus: '',
        pppoeStatus: ''
      });
      return;
    }
    setFiltersOpen((value) => !value);
  }

  function openCustomerDetails(row) {
    setSelectedCustomerId(row.customerId);
    setDetailTab('INTERNET');
  }

  function handleCustomerRowKeyDown(event, row) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openCustomerDetails(row);
  }

  function closeCustomerDetails() {
    setSelectedCustomerId('');
  }

  const isPppoeOnuMappingTab = moduleView === 'PPPOE_ONU_MAPPING' || filters.lifecycle === PPPOE_ONU_MAPPING_TAB;
  const selectedRow = selectedCustomerId ? rows.find((row) => row.customerId === selectedCustomerId) : null;
  const detailTabs = [
    { label: 'Internet Access', value: 'INTERNET' },
    { label: 'Hotspot', value: 'HOTSPOT' },
    { label: 'IPTV', value: 'IPTV' }
  ];
  const unmatchedMappingRows = mappingRows.filter((row) => !row.matched);
  const matchedMappingRows = mappingRows.filter((row) => row.matched);
  const visibleMappingRows = mappingView === MAPPING_MATCHED_ONUS ? matchedMappingRows : unmatchedMappingRows;
  const mappingViewLabel = mappingView === MAPPING_MATCHED_ONUS ? 'PPPoE with matched ONUs' : 'PPPoE without ONUs';
  const customerTableTitle = moduleView === 'INTERNET' ? 'Internet Access' : moduleView === 'IPTV' ? 'IPTV Access' : 'Customer Accounts';
  const tableTitle = isPppoeOnuMappingTab ? `PPPoE & ONUs - ${mappingViewLabel} (${visibleMappingRows.length})` : `${customerTableTitle} (${rows.length})`;
  const moduleViewTabs = [
    { value: 'CUSTOMERS', label: 'Customer Accounts', icon: IconUsers },
    { value: 'PPPOE_ONU_MAPPING', label: 'PPPoE & ONUs', icon: IconKey },
    { value: 'INTERNET', label: 'Internet Access', icon: IconServer },
    { value: 'HOTSPOT', label: 'Hotspot Access', icon: IconWifi },
    { value: 'IPTV', label: 'IPTV Access', icon: IconActivity }
  ];

  function renderDetailInfoRow(label, value) {
    return (
      <div className="account-access-management-detail-info-row" key={label}>
        <span>{label}</span>
        <strong>{String(value || '').trim() || '-'}</strong>
      </div>
    );
  }

  function renderAccessDetail(summary) {
    const details = (summary?.details || []).filter(Boolean);
    return (
      <div className="account-access-management-detail-access-card">
        <div className="account-access-management-detail-access-heading">
          <StatusBadge value={summary?.status || 'NO_SERVICE'} />
          <CheckIndicator active={summary?.status === 'ACTIVE' || Boolean(summary?.hasAccess)} label={summary?.label || 'Access'} />
        </div>
        <div className="h4 mb-1">{summary?.primary || '-'}</div>
        {summary?.secondary && <div className="text-muted">{summary.secondary}</div>}
        {details.length > 0 && (
          <div className="account-access-management-access-detail-list">
            {details.map((detail) => <span className="badge bg-secondary-lt text-secondary" key={detail}>{detail}</span>)}
          </div>
        )}
      </div>
    );
  }

  function renderCustomerDetailsPanel() {
    if (!selectedRow) return null;
    const customer = selectedRow.customer || {};
    const internet = selectedRow.accessSummary?.internetAccess || {};
    const hotspotSummary = selectedRow.accessSummary?.hotspotAccess || {};
    const iptv = selectedRow.accessSummary?.iptvAccess || {};
    const detailRows = [
      ['Account No.', customer.accountNumber],
      ['Contact', customer.contactNumber],
      ['Type', customer.customerType],
      ['Location', customer.locationName || [customer.barangay, customer.city, customer.province].filter(Boolean).join(', ')],
      ['Address', customer.address],
      ['Tickets', `${selectedRow.ticketCount || 0} total / ${selectedRow.openTicketCount || 0} open`],
    ];
    return (
      <aside className="account-access-management-detail-panel" aria-label="Selected customer account details">
        <div className="account-access-management-detail-panel-header">
          <div className="account-access-management-detail-heading">
            <h3>{customer.name || 'Customer'}</h3>
            <div className="account-access-management-detail-badges">
              <StatusBadge value={customer.status || 'UNKNOWN'} />
              <StatusBadge value={selectedRow.lifecycleStatus || 'UNKNOWN'} />
            </div>
          </div>
          <button type="button" className="btn btn-icon btn-sm" title="Close" onClick={closeCustomerDetails}>
            <IconX size={18} />
          </button>
        </div>
        <div className="account-access-management-detail-panel-body">
          <section className="account-access-management-detail-section">
            <h4>Customer Details</h4>
            <div className="account-access-management-detail-info-list">
              {detailRows.map(([label, value]) => renderDetailInfoRow(label, value))}
            </div>
          </section>
          <div className="account-access-management-status-tabs account-access-management-detail-tabs" role="tablist" aria-label="Customer access details">
            {detailTabs.map((tab) => (
              <button
                type="button"
                key={tab.value}
                className={`account-access-management-status-tab account-access-management-detail-tab ${detailTab === tab.value ? 'active' : ''}`}
                onClick={() => setDetailTab(tab.value)}
                role="tab"
                aria-selected={detailTab === tab.value}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {detailTab === 'INTERNET' && (
            <section className="account-access-management-detail-section">
              <h4>Internet Access</h4>
              {renderAccessDetail(internet)}
              <div className="account-access-management-detail-info-list">
                {renderDetailInfoRow('PPPoE Status', internet.pppoeStatus || selectedRow.pppoeStatus)}
                {renderDetailInfoRow('Router', internet.routerName || selectedRow.routerName)}
                {renderDetailInfoRow('IP Address', internet.ipAddress || selectedRow.staticIp)}
                {renderDetailInfoRow('Service Account', internet.serviceAccountNumber)}
              </div>
            </section>
          )}
          {detailTab === 'HOTSPOT' && (
            <section className="account-access-management-detail-section">
              <h4>Hotspot Access</h4>
              {renderAccessDetail(hotspotSummary)}
              <div className="account-access-management-detail-info-list">
                {renderDetailInfoRow('Allowed Contacts', `${hotspotSummary.enabledContactCount || 0}/${hotspotSummary.contactCount || 0}`)}
                {renderDetailInfoRow('Pisowifi Sync', hotspotSummary.integrationEnabled ? 'Enabled' : 'Disabled')}
              </div>
            </section>
          )}
          {detailTab === 'IPTV' && (
            <section className="account-access-management-detail-section">
              <h4>IPTV Access</h4>
              {renderAccessDetail(iptv)}
            </section>
          )}
        </div>
      </aside>
    );
  }

  function renderHotspotAccess() {
    const metrics = hotspot.metrics || {};
    const subscriberRows = hotspot.data || [];
    const logs = hotspot.logs || [];
    const apiBaseUrl = String(hotspotSettings.pisowifiApiBaseUrl || 'https://net.3jhotspot.com').replace(/\/+$/, '');
    const pageTabs = [
      { key: 'Overview', icon: IconDashboard },
      { key: 'Settings', icon: IconSettings },
    ];
    const overviewTabs = [
      { key: 'Subscribers', label: 'Monthly Subscribers', count: subscriberRows.length, icon: IconUsers, tone: 'blue' },
      { key: 'Logs', label: 'Sync Logs', count: logs.length, icon: IconHistory, tone: 'secondary' },
    ];
    const metricCards = [
      { label: 'Subscribers', value: metrics.subscribers || 0, icon: IconUsers, tone: 'blue' },
      { label: 'Active', value: metrics.active || 0, icon: IconWifi, tone: 'green' },
      { label: 'Enabled Contacts', value: metrics.enabledContacts || 0, icon: IconShieldLock, tone: 'cyan' },
      { label: 'No Contact', value: metrics.withoutContacts || 0, icon: IconActivity, tone: 'orange' },
    ];
    function renderMetricCard(item) {
      const Icon = item.icon;
      return (
        <div className="col-sm-6 col-xl-3" key={item.label}>
          <div className="card">
            <div className="card-body">
              <div className="d-flex align-items-center justify-content-between gap-2">
                <div>
                  <div className="text-muted small">{item.label}</div>
                  <div className="h2 mb-0">{item.value}</div>
                </div>
                <span className={`badge bg-${item.tone}-lt text-${item.tone}`}><Icon size={20} /></span>
              </div>
            </div>
          </div>
        </div>
      );
    }
    function renderSubscriberTable() {
      return (
        <>
          <div className="alert alert-info mb-3">
            Full Sync is authoritative. Customers or contact numbers missing from this 3J Main export are disabled in Pisowifi.
          </div>
          <div className="d-flex flex-wrap gap-2 mb-3">
            <div className="input-icon account-access-management-hotspot-search flex-fill">
              <span className="input-icon-addon"><IconSearch size={16} /></span>
              <input className="form-control form-control-sm" placeholder="Search subscriber or contact" value={hotspotFilters.search} onChange={(event) => updateHotspotFilters({ search: event.target.value })} />
            </div>
            <select className="form-select form-select-sm account-access-management-hotspot-status" value={hotspotFilters.status} onChange={(event) => updateHotspotFilters({ status: event.target.value })}>
              <option value="">All</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="SUSPENDED">Suspended</option>
            </select>
            <button className="btn btn-primary btn-sm" type="button" disabled={!!hotspotBusy || hotspotLoading} onClick={() => syncHotspot()}>
              <IconSend size={17} className="me-2" />{hotspotBusy === 'sync-all' ? 'Syncing...' : 'Full Sync'}
            </button>
          </div>
          <div className="table-responsive">
            <table className="table table-vcenter card-table account-access-management-table">
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
                      <div className="account-access-management-contact-stack">
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
        </>
      );
    }
    function renderSyncLogs() {
      return (
        <div className="list-group list-group-flush">
          {logs.map((log) => (
            <div className="list-group-item px-0" key={log.id || log.createdAt}>
              <div className="d-flex justify-content-between gap-2">
                <div>
                  <div className="fw-semibold">{log.action || 'SYNC'}</div>
                  <div className="text-muted small">{log.message || '-'}</div>
                  <HotspotSyncResultChips log={log} />
                </div>
                <div className="text-end">
                  <StatusBadge value={log.status || 'SUCCESS'} />
                  <div className="text-muted small mt-1">{log.createdAt || '-'}</div>
                </div>
              </div>
            </div>
          ))}
          {!logs.length && <div className="text-muted">No sync logs yet.</div>}
        </div>
      );
    }
    return (
      <div className="row row-cards">
        {hotspotMessage && (
          <div className="col-12">
            <div className={`alert alert-${hotspotMessage.tone || 'info'}`}>{hotspotMessage.text}</div>
          </div>
        )}
        <div className="col-12">
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-3">
            <div>
              <h2 className="page-title mb-1">Hotspot Access</h2>
              <div className="text-muted">Export monthly subscriber eligibility from 3J Main to the Pisowifi captive portal.</div>
            </div>
            <div className="d-flex flex-wrap gap-2">
              <button className="btn btn-outline-primary" type="button" disabled={!!hotspotBusy || hotspotLoading} onClick={() => loadHotspot()}>
                <IconRefresh size={18} className="me-2" />Refresh
              </button>
              <button className="btn" type="button" onClick={() => setHotspotGuideOpen(true)}>
                <IconHelp size={18} className="me-2" />API Guide
              </button>
            </div>
          </div>
        </div>

        <div className="col-12">
          <ul className="nav nav-tabs">
            {pageTabs.map((item) => {
              const Icon = item.icon;
              return (
                <li className="nav-item" key={item.key}>
                  <button className={`nav-link ${hotspotPageTab === item.key ? 'active' : ''}`} type="button" onClick={() => setHotspotPageTab(item.key)}>
                    <Icon size={17} className="me-1" />{item.key}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {hotspotPageTab === 'Overview' && (
          <>
            {metricCards.map(renderMetricCard)}
            <div className="col-12">
              <Card title="Hotspot Access Operations" icon={IconWifi}>
                <ul className="nav nav-tabs mb-3" role="tablist">
                  {overviewTabs.map((item) => {
                    const Icon = item.icon;
                    return (
                      <li className="nav-item" role="presentation" key={item.key}>
                        <button className={`nav-link ${hotspotOverviewTab === item.key ? 'active' : ''}`} type="button" role="tab" aria-selected={hotspotOverviewTab === item.key} onClick={() => setHotspotOverviewTab(item.key)}>
                          <Icon size={16} className="me-1" />{item.label}
                          <span className={`badge bg-${item.tone}-lt ms-2`}>{item.count}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {hotspotOverviewTab === 'Subscribers' && renderSubscriberTable()}
                {hotspotOverviewTab === 'Logs' && renderSyncLogs()}
              </Card>
            </div>
          </>
        )}

        {hotspotPageTab === 'Settings' && (
          <>
            <div className="col-lg-8">
              <Card title="API Management" icon={IconSettings}>
                <div className="row g-3">
                  <div className="col-md-6">
                    <div className="border rounded p-3 h-100">
                      <div className="d-flex align-items-start justify-content-between gap-3">
                        <div>
                          <div className="fw-semibold d-flex align-items-center gap-2"><IconShieldLock size={18} />Integration Status</div>
                          <div className="text-muted small mt-1">Controls whether 3J Main can push subscriber eligibility into Pisowifi.</div>
                        </div>
                        <label className="form-check form-switch m-0">
                          <input className="form-check-input" type="checkbox" checked={hotspotSettings.enabled} onChange={(event) => setHotspotSettings({ ...hotspotSettings, enabled: event.target.checked })} />
                        </label>
                      </div>
                      <div className="mt-3">
                        <span className={`badge ${hotspotSettings.enabled ? 'bg-green-lt text-green' : 'bg-red-lt text-red'}`}>{hotspotSettings.enabled ? 'Enabled' : 'Disabled'}</span>
                        <span className={`badge ms-2 ${hotspot.settings?.apiSecretSet ? 'bg-green-lt text-green' : 'bg-yellow-lt text-yellow'}`}>{hotspot.settings?.apiSecretSet ? 'Secret saved' : 'Secret required'}</span>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-6">
                    <div className="border rounded p-3 h-100">
                      <div className="fw-semibold d-flex align-items-center gap-2"><IconServer size={18} />Pisowifi API Target</div>
                      <div className="mt-3">
                        <label className="form-label">Pisowifi API Base URL</label>
                        <input className="form-control" placeholder="https://net.3jhotspot.com" value={hotspotSettings.pisowifiApiBaseUrl} onChange={(event) => setHotspotSettings({ ...hotspotSettings, pisowifiApiBaseUrl: event.target.value })} />
                      </div>
                      <div className="text-muted small mt-2">Use the public or internal API base that can reach Pisowifi from this 3J Main server.</div>
                    </div>
                  </div>
                  <div className="col-md-6">
                    <div className="border rounded p-3 h-100">
                      <div className="fw-semibold d-flex align-items-center gap-2 mb-3"><IconKey size={18} />Credentials</div>
                      <div className="mb-3">
                        <label className="form-label">API Key</label>
                        <input className="form-control" value={hotspotSettings.apiKey} onChange={(event) => setHotspotSettings({ ...hotspotSettings, apiKey: event.target.value })} />
                      </div>
                      <div>
                        <label className="form-label">API Secret</label>
                        <input className="form-control" type="password" placeholder={hotspot.settings?.apiSecretSet ? 'Saved. Leave blank to keep current secret.' : 'Required before sync'} value={hotspotSettings.apiSecret} onChange={(event) => setHotspotSettings({ ...hotspotSettings, apiSecret: event.target.value })} />
                        <div className="form-hint">Must match Pisowifi Monthly Subscribers API Management settings.</div>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-6">
                    <div className="border rounded p-3 h-100">
                      <div className="fw-semibold d-flex align-items-center gap-2 mb-3"><IconDatabase size={18} />Endpoint Preview</div>
                      <div className="d-grid gap-2 small">
                        <div><span className="badge bg-blue-lt text-blue me-2">GET</span><code>{apiBaseUrl}/api/integrations/monthly-subscribers/health</code></div>
                        <div><span className="badge bg-green-lt text-green me-2">POST</span><code>{apiBaseUrl}/api/integrations/monthly-subscribers/upsert</code></div>
                      </div>
                      <button className="btn btn-sm mt-3" type="button" onClick={() => setHotspotGuideOpen(true)}>
                        <IconInfoCircle size={16} className="me-1" />Read API documentation
                      </button>
                    </div>
                  </div>
                  <div className="col-12">
                    <div className="alert alert-warning mb-0">
                      <div className="fw-semibold mb-1">FULL sync is authoritative</div>
                      <div>Only use Full Sync when this page contains the complete monthly subscriber export. Pisowifi will disable missing subscribers or missing contact numbers.</div>
                    </div>
                  </div>
                  <div className="col-12 d-flex flex-wrap gap-2">
                    <button className="btn btn-primary" type="button" disabled={!!hotspotBusy} onClick={saveHotspotSettings}>
                      <IconDeviceFloppy size={18} className="me-2" />{hotspotBusy === 'settings' ? 'Saving...' : 'Save API Settings'}
                    </button>
                    <button className="btn" type="button" disabled={!!hotspotBusy} onClick={testHotspotConnection}>
                      <IconShieldLock size={18} className="me-2" />{hotspotBusy === 'test' ? 'Testing...' : 'Test Connection'}
                    </button>
                  </div>
                </div>
              </Card>
            </div>
            <div className="col-12">
              <Card title="API Flow" icon={IconActivity}>
                <div className="row g-3">
                  {[
                    ['1', 'Build subscriber export', '3J Main derives eligible customers from active service accounts and enabled contact numbers.'],
                    ['2', 'Sign the request', 'The API key, timestamp, raw JSON body, and shared secret produce the HMAC signature.'],
                    ['3', 'Sync into Pisowifi', 'Pisowifi validates the signature and stores subscriber/contact eligibility.'],
                    ['4', 'Authorize customer login', 'Customers verify by SMS OTP in the captive portal and Pisowifi authorizes the device in Omada.'],
                  ].map(([step, title, detail]) => (
                    <div className="col-md-6 col-xl-3" key={step}>
                      <div className="border rounded p-3 h-100">
                        <span className="badge bg-blue-lt text-blue mb-2">{step}</span>
                        <div className="fw-semibold">{title}</div>
                        <div className="text-muted small mt-1">{detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </>
        )}

        {hotspotContactModal && (
          <div className="modal modal-blur d-block account-access-management-modal-backdrop" tabIndex="-1" role="dialog" aria-modal="true">
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
                  <div className="account-access-management-hotspot-contact-list">
                    {hotspotContactModal.contacts.map((contact, index) => (
                      <div className="account-access-management-hotspot-contact-row" key={`${index}-${contact.contactNumber}`}>
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
                        <label className="form-check form-switch account-access-management-hotspot-contact-switch">
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
        {hotspotGuideOpen && (
          <div className="modal modal-blur d-block account-access-management-modal-backdrop" tabIndex="-1" role="dialog" aria-modal="true">
            <div className="modal-dialog modal-xl modal-dialog-centered" role="document">
              <div className="modal-content">
                <div className="modal-header">
                  <div>
                    <h5 className="modal-title">Hotspot Access API Guide</h5>
                    <div className="text-muted small">How 3J Main signs and sends monthly subscriber data to Pisowifi.</div>
                  </div>
                  <button type="button" className="btn-close" aria-label="Close" onClick={() => setHotspotGuideOpen(false)} />
                </div>
                <div className="modal-body">
                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="border rounded p-3 h-100">
                        <div className="fw-semibold d-flex align-items-center gap-2 mb-2"><IconLock size={18} />Signed Headers</div>
                        <div className="d-grid gap-2 small">
                          <code>X-3J-Integration-Key: {hotspotSettings.apiKey || 'configured-api-key'}</code>
                          <code>X-3J-Timestamp: unix timestamp seconds</code>
                          <code>X-3J-Signature: HMAC-SHA256(timestamp + "." + raw JSON body)</code>
                          <code>X-3J-Idempotency-Key: unique request id</code>
                        </div>
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="border rounded p-3 h-100">
                        <div className="fw-semibold d-flex align-items-center gap-2 mb-2"><IconDatabase size={18} />Sync Modes</div>
                        <div className="d-grid gap-2">
                          <div><span className="badge bg-blue-lt text-blue me-2">FULL</span>Complete authoritative export. Missing subscribers or contacts are disabled in Pisowifi.</div>
                          <div><span className="badge bg-secondary-lt text-secondary me-2">PARTIAL</span>Single subscriber/contact update. Unrelated customers are preserved.</div>
                        </div>
                      </div>
                    </div>
                    <div className="col-12">
                      <div className="border rounded p-3">
                        <div className="fw-semibold d-flex align-items-center gap-2 mb-2"><IconSend size={18} />Payload Example</div>
                        <pre className="mb-0"><code>{`POST ${apiBaseUrl}/api/integrations/monthly-subscribers/upsert
{
  "source_system": "3J Main",
  "synced_by": "admin",
  "sync_mode": "FULL",
  "subscribers": [
    {
      "external_subscriber_id": "customer-id",
      "account_number": "68392741",
      "service_account_number": "SA-001",
      "customer_name": "Customer Name",
      "plan_name": "Monthly Plan",
      "status": "ACTIVE",
      "contacts": [
        {
          "contact_number": "09000000000",
          "normalized_contact": "+639000000000",
          "label": "Primary",
          "enabled": true
        }
      ]
    }
  ]
}`}</code></pre>
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="alert alert-warning mb-0">
                        <div className="fw-semibold">Credential rotation</div>
                        <div>Update Pisowifi and 3J Main with the same new secret. Sync requests fail while the two systems have different secrets.</div>
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="alert alert-info mb-0">
                        <div className="fw-semibold">Contact rule</div>
                        <div>Each enabled contact number represents one allowed captive portal device after SMS verification.</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-primary" type="button" onClick={() => setHotspotGuideOpen(false)}>Close</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="account-access-management-module">
      <div className="account-access-management-module-view-tabs" role="tablist" aria-label="Account Access Management views">
        {moduleViewTabs.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={`account-access-management-module-view-tab ${moduleView === item.value ? 'active' : ''}`}
              key={item.value}
              type="button"
              onClick={() => changeModuleView(item.value)}
              role="tab"
              aria-selected={moduleView === item.value}
            >
              <Icon size={17} /> {item.label}
            </button>
          );
        })}
      </div>

      {moduleView === 'HOTSPOT' ? renderHotspotAccess() : (
      <>
        {error && <div className="alert alert-danger">{error}</div>}

      <div className={`account-access-management-customer-workspace ${selectedRow ? 'has-detail-panel' : ''}`}>
        <div className="account-access-management-customer-main">
          <div className="row row-cards">
            <div className="col-12">
              <Card
            className="account-access-management-table-card"
            title={tableTitle}
            icon={isPppoeOnuMappingTab ? IconKey : IconUsers}
            actions={(
              <div className="btn-list account-access-management-header-actions">
                <div className="account-access-management-header-search">
                  <label className="visually-hidden" htmlFor="customer-account-search">{isPppoeOnuMappingTab ? 'Search PPPoE and ONU mappings' : 'Search customer accounts'}</label>
                  <div className="input-icon account-access-management-header-search-input">
                    <span className="input-icon-addon"><IconSearch size={16} /></span>
                    <input
                      id="customer-account-search"
                      className="form-control form-control-sm"
                      placeholder={isPppoeOnuMappingTab ? 'Search PPPoE, router, caller ID, ONU' : 'Search customer, account, access, PPPoE, hotspot, IPTV, ticket'}
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
                      <button type="button" className="account-access-management-search-clear" title="Clear search" aria-label="Clear search" onClick={clearSearch}>
                        <IconX size={14} />
                      </button>
                    )}
                  </div>
                </div>
                <button
                  className={`btn btn-outline-secondary btn-sm account-access-management-header-icon-button ${areFiltersOpen ? 'active' : ''}`}
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
	              <div className="account-access-management-table-filters">
	                <div className="row g-2 align-items-end">
	                  {!isPppoeOnuMappingTab && (
	                    <>
	                      <div className="col-md-2">
	                        <label className="form-label">Access</label>
	                        <select className="form-select" value={filters.accessFilter} onChange={(event) => updateFilters({ accessFilter: event.target.value })}>
	                          {accessFilters.map((item) => <option key={item.label} value={item.value}>{item.label}</option>)}
	                        </select>
	                      </div>
	                      <div className="col-md-2">
	                        <label className="form-label">Customer Status</label>
	                        <select className="form-select" value={filters.customerStatus} onChange={(event) => updateFilters({ customerStatus: event.target.value })}>
	                          <option value="">All</option>
	                          {customerStatuses.map((item) => <option key={item} value={item}>{titleize(item)}</option>)}
	                        </select>
	                      </div>
	                      <div className="col-md-2">
	                        <label className="form-label">Internet</label>
	                        <select className="form-select" value={filters.internetStatus} onChange={(event) => updateFilters({ internetStatus: event.target.value })}>
	                          <option value="">All</option>
	                          {internetAccessStatuses.map((item) => <option key={item} value={item}>{titleize(item)}</option>)}
	                        </select>
	                      </div>
	                      <div className="col-md-2">
	                        <label className="form-label">Hotspot</label>
	                        <select className="form-select" value={filters.hotspotStatus} onChange={(event) => updateFilters({ hotspotStatus: event.target.value })}>
	                          <option value="">All</option>
	                          {hotspotAccessStatuses.map((item) => <option key={item} value={item}>{titleize(item)}</option>)}
	                        </select>
	                      </div>
	                      <div className="col-md-2">
	                        <label className="form-label">IPTV</label>
	                        <select className="form-select" value={filters.iptvStatus} onChange={(event) => updateFilters({ iptvStatus: event.target.value })}>
	                          <option value="">All</option>
	                          {iptvAccessStatuses.map((item) => <option key={item} value={item}>{titleize(item)}</option>)}
	                        </select>
	                      </div>
	                    </>
	                  )}
	                  <div className="col-md-2">
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

            {!isPppoeOnuMappingTab && (
              <div className="account-access-management-status-tabs" role="tablist" aria-label="Customer account status filter">
                {tabs.map((item) => (
                  <button
                    type="button"
                    key={item.label}
                    className={`account-access-management-status-tab ${filters.lifecycle === item.value ? 'active' : ''}`}
                    onClick={() => updateFilters({ lifecycle: item.value })}
                    role="tab"
                    aria-selected={filters.lifecycle === item.value}
                  >
                    <span>{item.label}</span>
                    <span className={`badge bg-${item.tone}-lt text-${item.tone}`}>{item.count}</span>
                  </button>
                ))}
              </div>
            )}
	            {loading && rows.length > 0 && (
	              <div className="account-access-management-refreshing" role="status" aria-live="polite">Updating customer accounts...</div>
	            )}

	            {isPppoeOnuMappingTab && (
              <div className="account-access-management-mapping-tabs" role="tablist" aria-label="PPPoE ONU match filter">
                <button
                  type="button"
                  className={`account-access-management-mapping-tab ${mappingView === MAPPING_WITHOUT_ONUS ? 'active' : ''}`}
                  onClick={() => setMappingView(MAPPING_WITHOUT_ONUS)}
                  role="tab"
                  aria-selected={mappingView === MAPPING_WITHOUT_ONUS}
                >
                  <span>PPPoE without ONUs</span>
                  <span className="badge bg-red-lt text-red">{unmatchedMappingRows.length}</span>
                </button>
                <button
                  type="button"
                  className={`account-access-management-mapping-tab ${mappingView === MAPPING_MATCHED_ONUS ? 'active' : ''}`}
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
              <div className="account-access-management-mapping-sample">
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
                <table className="table table-vcenter card-table account-access-management-table account-access-management-mapping-table">
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
                <table className="table table-vcenter card-table account-access-management-table">
	                  <thead>
	                    <tr>
	                      <th>Customer</th>
	                      <th>Internet Access</th>
	                      <th>Hotspot Access</th>
	                      <th>IPTV Access</th>
	                      <th>Tickets</th>
	                      <th>Action</th>
	                    </tr>
	                  </thead>
	                  <tbody>
	                    {loading && rows.length === 0 && (
	                      <tr>
	                        <td colSpan="6" className="text-muted">Loading customer accounts...</td>
	                      </tr>
	                    )}
	                    {!loading && rows.length === 0 && (
                      <tr>
	                        <td colSpan="6"><div className="empty">No customer accounts match the current filters.</div></td>
	                      </tr>
	                    )}
		                    {rows.map((row) => (
		                      <tr
		                        key={row.customerId}
		                        className={`account-access-management-clickable-row ${selectedCustomerId === row.customerId ? 'table-active' : ''}`}
		                        onClick={() => openCustomerDetails(row)}
		                        onKeyDown={(event) => handleCustomerRowKeyDown(event, row)}
		                        tabIndex={0}
		                        aria-label={`View ${row.customer.name}`}
		                      >
	                        <td>
	                          <div className="fw-bold">{row.customer.name}</div>
	                          <div className="text-muted small">{row.customer.accountNumber || row.customer.contactNumber || '-'}</div>
                          <div className="account-access-management-customer-badges">
                            <StatusBadge value={row.customer.status} />
                            <StatusBadge value={row.lifecycleStatus} />
	                          </div>
	                        </td>
	                        <td><AccessSummaryCell summary={row.accessSummary?.internetAccess} /></td>
	                        <td><HotspotAccessCell summary={row.accessSummary?.hotspotAccess} /></td>
	                        <td><IptvAccessCell summary={row.accessSummary?.iptvAccess} /></td>
	                        <td>
	                          <span className={`badge bg-${row.openTicketCount ? 'orange' : 'secondary'}-lt text-${row.openTicketCount ? 'orange' : 'secondary'}`}>
	                            {row.ticketCount || 0}
	                          </span>
	                        </td>
		                        <td className="account-access-management-actions-column">
		                          <div className="account-access-management-row-actions">
		                            <button
		                              type="button"
		                              className="badge account-access-management-action-badge bg-blue-lt text-blue border-0"
		                              title={`View ${row.customer.name}`}
		                              aria-label={`View ${row.customer.name}`}
		                              onClick={(event) => {
		                                event.stopPropagation();
		                                openCustomerDetails(row);
		                              }}
		                            >
		                              <IconEye size={21} />
		                            </button>
		                          </div>
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
        </div>
        {selectedRow && renderCustomerDetailsPanel()}
      </div>
      </>
      )}
    </div>
  );
}
