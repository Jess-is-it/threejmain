import React, { useEffect, useRef, useState } from 'react';
import {
  IconFilter,
  IconRefresh,
  IconSearch,
  IconUsers,
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
  const [rows, setRows] = useState([]);
  const [mappingRows, setMappingRows] = useState([]);
  const [mappingMeta, setMappingMeta] = useState(null);
  const [tabs, setTabs] = useState(defaultTabs);
  const [filters, setFilters] = useState(blankFilters);
  const [mappingView, setMappingView] = useState(MAPPING_WITHOUT_ONUS);
  const [areFiltersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const latestFiltersRef = useRef(blankFilters);
  const searchDebounceRef = useRef(null);

  const hasActiveFilters = ['customerStatus', 'pppoeStatus'].some((key) => Boolean(filters[key]));

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

  return (
    <div className="account-admin-module">
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
    </div>
  );
}
