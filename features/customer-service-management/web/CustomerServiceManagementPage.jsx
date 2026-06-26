import React, { useEffect, useMemo, useState } from 'react';
import {
  IconBrandFacebook,
  IconBrandTelegram,
  IconBrandWhatsapp,
  IconCalendarDue,
  IconCheck,
  IconDeviceFloppy,
  IconEdit,
  IconInbox,
  IconMessageCircle,
  IconPhoneCall,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconTrash,
  IconUsers
} from '@tabler/icons-react';
import './customerServiceManagement.css';

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

function currentLocalDateTime() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function toDateTimeLocal(value) {
  if (!value) return currentLocalDateTime();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return currentLocalDateTime();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function statusClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (['resolved', 'closed', 'done'].includes(normalized)) return 'bg-green-lt text-green';
  if (['open', 'pending', 'waiting_customer'].includes(normalized)) return 'bg-yellow-lt text-yellow';
  if (['escalated', 'urgent', 'missed', 'cancelled'].includes(normalized)) return 'bg-red-lt text-red';
  if (['in_progress', 'high'].includes(normalized)) return 'bg-orange-lt text-orange';
  return 'bg-blue-lt text-blue';
}

function formatLabel(value) {
  return String(value || '').replaceAll('_', ' ');
}

function formatDateTime(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString();
}

function customerLabel(customer) {
  if (!customer) return '-';
  return `${customer.accountNumber || 'NO-ACCOUNT'} - ${customer.name || 'Unnamed customer'}`;
}

function channelIcon(channel) {
  if (channel === 'FACEBOOK') return IconBrandFacebook;
  if (channel === 'TELEGRAM') return IconBrandTelegram;
  if (channel === 'WHATSAPP') return IconBrandWhatsapp;
  return IconMessageCircle;
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

function TextField({ label, value, onChange, type = 'text', required = false, placeholder = '', readOnly = false, autoComplete = '' }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <input
        autoComplete={autoComplete}
        className="form-control"
        placeholder={placeholder}
        readOnly={readOnly}
        type={type}
        value={value ?? ''}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function TextArea({ label, value, onChange, required = false, rows = 3 }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <textarea className="form-control" value={value ?? ''} rows={rows} required={required} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function SelectField({ label, value, onChange, options, required = false, children }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <select className="form-select" value={value ?? ''} required={required} onChange={(e) => onChange(e.target.value)}>
        {children || (options || []).map((option) => <option key={option} value={option}>{formatLabel(option)}</option>)}
      </select>
    </div>
  );
}

function CheckboxField({ label, checked, onChange }) {
  return (
    <label className="form-check form-switch mb-0">
      <input className="form-check-input" type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} />
      <span className="form-check-label">{label}</span>
    </label>
  );
}

const blankRequest = {
  id: '',
  customerId: '',
  channel: 'PHONE',
  category: 'GENERAL_INQUIRY',
  priority: 'NORMAL',
  status: 'OPEN',
  subject: '',
  description: '',
  assignedTo: 'Front Desk',
  dueDate: today(),
  resolution: '',
  tagsText: ''
};

const blankInteraction = {
  id: '',
  requestId: '',
  customerId: '',
  type: 'CALL',
  direction: 'INBOUND',
  occurredAt: currentLocalDateTime(),
  summary: '',
  details: '',
  outcome: '',
  agentName: 'Front Desk'
};

const blankFollowUp = {
  id: '',
  requestId: '',
  customerId: '',
  type: 'CALLBACK',
  status: 'PENDING',
  dueAt: currentLocalDateTime(),
  assignedTo: 'Front Desk',
  notes: '',
  completedAt: ''
};

const blankFacebookSettings = {
  enabled: false,
  pageName: '',
  pageId: '',
  appId: '',
  verifyToken: '',
  pageAccessToken: '',
  graphApiVersion: 'v25.0',
  notes: ''
};

const tabs = ['Overview', 'Inbox', 'Service Requests', 'Interactions', 'Follow-ups', 'Settings'];

export default function CustomerServiceManagementPage({ refreshShell = () => {} }) {
  const [activeTab, setActiveTab] = useState('Overview');
  const [meta, setMeta] = useState({
    channels: [],
    omniChannels: [],
    inboxThreadStatuses: [],
    requestCategories: [],
    requestStatuses: [],
    priorities: [],
    interactionTypes: [],
    interactionDirections: [],
    followUpTypes: [],
    followUpStatuses: []
  });
  const [overview, setOverview] = useState({ metrics: {}, recentRequests: [], dueFollowUps: [], recentInteractions: [] });
  const [customers, setCustomers] = useState([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [requests, setRequests] = useState([]);
  const [interactions, setInteractions] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [inboxThreads, setInboxThreads] = useState([]);
  const [selectedThreadId, setSelectedThreadId] = useState('');
  const [selectedThread, setSelectedThread] = useState(null);
  const [threadMessages, setThreadMessages] = useState([]);
  const [requestForm, setRequestForm] = useState(blankRequest);
  const [interactionForm, setInteractionForm] = useState(blankInteraction);
  const [followUpForm, setFollowUpForm] = useState(blankFollowUp);
  const [filters, setFilters] = useState({ search: '', status: '', customerId: '' });
  const [inboxFilters, setInboxFilters] = useState({ search: '', channel: '', status: '' });
  const [replyText, setReplyText] = useState('');
  const [channelSettings, setChannelSettings] = useState({});
  const [facebookForm, setFacebookForm] = useState(blankFacebookSettings);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const requestById = useMemo(() => new Map(requests.map((row) => [row.id, row])), [requests]);
  const activeThread = selectedThread || inboxThreads.find((thread) => thread.id === selectedThreadId) || inboxThreads[0] || null;

  function facebookSettingsToForm(settings = {}) {
    return {
      ...blankFacebookSettings,
      enabled: Boolean(settings.enabled),
      pageName: settings.pageName || '',
      pageId: settings.pageId || '',
      appId: settings.appId || '',
      verifyToken: settings.verifyToken || '',
      pageAccessToken: '',
      graphApiVersion: settings.graphApiVersion || blankFacebookSettings.graphApiVersion,
      notes: settings.notes || ''
    };
  }

  function publicWebhookUrl(path) {
    if (typeof window === 'undefined') return path || '';
    return `${window.location.origin}${path || ''}`;
  }

  async function load(search = customerSearch, nextFilters = filters, nextInboxFilters = inboxFilters) {
    setError('');
    try {
      const params = new URLSearchParams();
      Object.entries(nextFilters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const inboxParams = new URLSearchParams();
      Object.entries(nextInboxFilters).forEach(([key, value]) => {
        if (value) inboxParams.set(key, value);
      });
      const [
        nextMeta,
        nextOverview,
        nextCustomers,
        nextRequests,
        nextInteractions,
        nextFollowUps,
        nextInboxThreads,
        nextChannelSettings
      ] = await Promise.all([
        request('/customer-service-management/meta'),
        request('/customer-service-management/overview'),
        request(`/customer-service-management/customers?search=${encodeURIComponent(search)}`),
        request(`/customer-service-management/service-requests?${params.toString()}`),
        request('/customer-service-management/interactions'),
        request('/customer-service-management/follow-ups'),
        request(`/customer-service-management/omni-channel/inbox?${inboxParams.toString()}`),
        request('/customer-service-management/channel-settings')
      ]);
      setMeta(nextMeta);
      setOverview(nextOverview);
      setCustomers(nextCustomers);
      setRequests(nextRequests);
      setInteractions(nextInteractions);
      setFollowUps(nextFollowUps);
      setInboxThreads(nextInboxThreads);
      setChannelSettings(nextChannelSettings);
      setFacebookForm(facebookSettingsToForm(nextChannelSettings.FACEBOOK));
      const nextSelectedId = selectedThreadId && nextInboxThreads.some((thread) => thread.id === selectedThreadId)
        ? selectedThreadId
        : nextInboxThreads[0]?.id || '';
      setSelectedThreadId(nextSelectedId);
      if (nextSelectedId) {
        const detail = await request(`/customer-service-management/omni-channel/inbox/${nextSelectedId}`);
        setSelectedThread(detail.thread);
        setThreadMessages(detail.messages || []);
      } else {
        setSelectedThread(null);
        setThreadMessages([]);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  function customerOptions() {
    return (
      <>
        <option value="">Select customer</option>
        {customers.map((customer) => <option key={customer.id} value={customer.id}>{customerLabel(customer)}</option>)}
      </>
    );
  }

  function requestOptions() {
    return (
      <>
        <option value="">No linked request</option>
        {requests.map((row) => <option key={row.id} value={row.id}>{row.requestNumber} - {row.subject}</option>)}
      </>
    );
  }

  function setRequestLink(requestId, setter, form) {
    const linked = requestById.get(requestId);
    setter({ ...form, requestId, customerId: linked?.customerId || form.customerId });
  }

  async function submitRequest(e) {
    e.preventDefault();
    const body = {
      ...requestForm,
      tags: requestForm.tagsText.split(',').map((tag) => tag.trim()).filter(Boolean)
    };
    delete body.tagsText;
    delete body.id;
    const path = requestForm.id ? `/customer-service-management/service-requests/${requestForm.id}` : '/customer-service-management/service-requests';
    await request(path, { method: requestForm.id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    setRequestForm(blankRequest);
    setMessage(requestForm.id ? 'Service request saved.' : 'Service request created.');
    await load();
    refreshShell();
  }

  async function deleteRequest(id) {
    if (!window.confirm('Delete this service request?')) return;
    await request(`/customer-service-management/service-requests/${id}`, { method: 'DELETE' });
    setMessage('Service request deleted.');
    await load();
    refreshShell();
  }

  async function submitInteraction(e) {
    e.preventDefault();
    const body = { ...interactionForm, occurredAt: new Date(interactionForm.occurredAt).toISOString() };
    delete body.id;
    const path = interactionForm.id ? `/customer-service-management/interactions/${interactionForm.id}` : '/customer-service-management/interactions';
    await request(path, { method: interactionForm.id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    setInteractionForm(blankInteraction);
    setMessage(interactionForm.id ? 'Interaction saved.' : 'Interaction logged.');
    await load();
    refreshShell();
  }

  async function deleteInteraction(id) {
    if (!window.confirm('Delete this interaction?')) return;
    await request(`/customer-service-management/interactions/${id}`, { method: 'DELETE' });
    setMessage('Interaction deleted.');
    await load();
    refreshShell();
  }

  async function submitFollowUp(e) {
    e.preventDefault();
    const body = {
      ...followUpForm,
      dueAt: new Date(followUpForm.dueAt).toISOString(),
      completedAt: followUpForm.completedAt ? new Date(followUpForm.completedAt).toISOString() : null
    };
    delete body.id;
    const path = followUpForm.id ? `/customer-service-management/follow-ups/${followUpForm.id}` : '/customer-service-management/follow-ups';
    await request(path, { method: followUpForm.id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    setFollowUpForm(blankFollowUp);
    setMessage(followUpForm.id ? 'Follow-up saved.' : 'Follow-up scheduled.');
    await load();
    refreshShell();
  }

  async function deleteFollowUp(id) {
    if (!window.confirm('Delete this follow-up?')) return;
    await request(`/customer-service-management/follow-ups/${id}`, { method: 'DELETE' });
    setMessage('Follow-up deleted.');
    await load();
    refreshShell();
  }

  async function selectInboxThread(threadId) {
    setSelectedThreadId(threadId);
    const detail = await request(`/customer-service-management/omni-channel/inbox/${threadId}`);
    setSelectedThread(detail.thread);
    setThreadMessages(detail.messages || []);
    await request(`/customer-service-management/omni-channel/inbox/${threadId}/read`, { method: 'POST' });
    setInboxThreads((rows) => rows.map((row) => (row.id === threadId ? { ...row, unreadCount: 0 } : row)));
  }

  function updateInboxFilters(next) {
    const merged = { ...inboxFilters, ...next };
    setInboxFilters(merged);
    load(customerSearch, filters, merged);
  }

  async function updateThread(next) {
    if (!activeThread) return;
    const updated = await request(`/customer-service-management/omni-channel/inbox/${activeThread.id}`, {
      method: 'PATCH',
      body: JSON.stringify(next)
    });
    setSelectedThread(updated);
    setInboxThreads((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
    setMessage('Inbox thread saved.');
  }

  async function submitReply(e) {
    e.preventDefault();
    if (!activeThread || !replyText.trim()) return;
    const result = await request(`/customer-service-management/omni-channel/inbox/${activeThread.id}/reply`, {
      method: 'POST',
      body: JSON.stringify({
        message: replyText.trim(),
        agentName: 'Care Team',
        sendViaFacebook: true
      })
    });
    setReplyText('');
    setSelectedThread(result.thread);
    const detail = await request(`/customer-service-management/omni-channel/inbox/${activeThread.id}`);
    setThreadMessages(detail.messages || []);
    setInboxThreads((rows) => rows.map((row) => (row.id === result.thread.id ? result.thread : row)));
    setMessage(result.message.deliveryStatus === 'SENT' ? 'Facebook reply sent.' : 'Reply saved locally.');
    refreshShell();
  }

  function setFacebookField(field, value) {
    setFacebookForm((form) => ({ ...form, [field]: value }));
  }

  async function saveFacebookSettings(e) {
    e.preventDefault();
    const body = { ...facebookForm };
    if (!body.pageAccessToken) delete body.pageAccessToken;
    const updated = await request('/customer-service-management/channel-settings/facebook', {
      method: 'PATCH',
      body: JSON.stringify(body)
    });
    setChannelSettings((settings) => ({ ...settings, FACEBOOK: updated }));
    setFacebookForm(facebookSettingsToForm(updated));
    setMessage('Facebook settings saved.');
  }

  async function checkFacebookSettings() {
    const result = await request('/customer-service-management/channel-settings/facebook/check', { method: 'POST' });
    setMessage(result.ready ? 'Facebook setup is ready.' : `Facebook setup needs: ${result.missing.join(', ')}`);
    await load();
  }

  function editRequest(row) {
    setActiveTab('Service Requests');
    setRequestForm({ ...blankRequest, ...row, tagsText: (row.tags || []).join(', ') });
  }

  function editInteraction(row) {
    setActiveTab('Interactions');
    setInteractionForm({ ...blankInteraction, ...row, occurredAt: toDateTimeLocal(row.occurredAt) });
  }

  function editFollowUp(row) {
    setActiveTab('Follow-ups');
    setFollowUpForm({
      ...blankFollowUp,
      ...row,
      dueAt: toDateTimeLocal(row.dueAt),
      completedAt: row.completedAt ? toDateTimeLocal(row.completedAt) : ''
    });
  }

  function updateFilters(next) {
    const merged = { ...filters, ...next };
    setFilters(merged);
    load(customerSearch, merged, inboxFilters);
  }

  return (
    <div className="csm-page">
      {(message || error) && (
        <div className={`alert ${error ? 'alert-danger' : 'alert-info'}`}>{error || message}</div>
      )}
      <div className="csm-toolbar">
        <ul className="nav nav-tabs">
          {tabs.map((tab) => (
            <li className="nav-item" key={tab}>
              <button className={`nav-link ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>{tab}</button>
            </li>
          ))}
        </ul>
        <button className="btn btn-sm" onClick={() => load()}><IconRefresh size={16} className="me-1" />Refresh</button>
      </div>

      {activeTab === 'Overview' && (
        <div className="row row-cards">
          {[
            ['Open Requests', overview.metrics?.open_requests, IconMessageCircle, 'blue'],
            ['Callbacks Due', overview.metrics?.callbacks_due, IconPhoneCall, 'yellow'],
            ['SLA Risks', overview.metrics?.sla_risks, IconCalendarDue, 'red'],
            ['Interactions Today', overview.metrics?.interactions_today, IconCheck, 'green'],
            ['Inbox Unread', overview.metrics?.inbox_unread, IconInbox, 'orange'],
            ['Facebook Threads', overview.metrics?.facebook_threads, IconBrandFacebook, 'azure']
          ].map(([label, value, Icon, tone]) => (
            <div className="col-sm-6 col-xl-2" key={label}>
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
            <Card title="Recent Service Requests" icon={IconMessageCircle}>
              <RequestTable rows={overview.recentRequests || []} onEdit={editRequest} onDelete={deleteRequest} />
            </Card>
          </div>
          <div className="col-lg-5">
            <Card title="Due Follow-ups" icon={IconCalendarDue}>
              <FollowUpList rows={overview.dueFollowUps || []} onEdit={editFollowUp} />
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Inbox' && (
        <div className="row row-cards">
          <div className="col-xl-4">
            <Card title="Omni-channel Inbox" icon={IconInbox}>
              <div className="csm-inbox-filters">
                <input className="form-control" placeholder="Search conversations" value={inboxFilters.search} onChange={(e) => updateInboxFilters({ search: e.target.value })} />
                <select className="form-select" value={inboxFilters.channel} onChange={(e) => updateInboxFilters({ channel: e.target.value })}>
                  <option value="">All channels</option>
                  {(meta.omniChannels || []).map((channel) => <option key={channel} value={channel}>{formatLabel(channel)}</option>)}
                </select>
                <select className="form-select" value={inboxFilters.status} onChange={(e) => updateInboxFilters({ status: e.target.value })}>
                  <option value="">All statuses</option>
                  {(meta.inboxThreadStatuses || []).map((status) => <option key={status} value={status}>{formatLabel(status)}</option>)}
                </select>
              </div>
              <InboxThreadList rows={inboxThreads} selectedId={activeThread?.id} onSelect={selectInboxThread} />
            </Card>
          </div>
          <div className="col-xl-8">
            <Card title={activeThread ? `${formatLabel(activeThread.channel)} Conversation` : 'Conversation'} icon={activeThread ? channelIcon(activeThread.channel) : IconInbox}>
              {!activeThread ? (
                <div className="empty">No inbox conversations yet.</div>
              ) : (
                <div className="csm-conversation">
                  <div className="csm-thread-header">
                    <div>
                      <div className="d-flex align-items-center gap-2 mb-1">
                        <span className={`badge ${statusClass(activeThread.status)}`}>{formatLabel(activeThread.status)}</span>
                        <span className="badge bg-blue-lt text-blue">{formatLabel(activeThread.channel)}</span>
                      </div>
                      <h3 className="csm-thread-title">{customerLabel(activeThread.customer)}</h3>
                      <div className="text-muted">External ID: {activeThread.externalUserId || '-'}</div>
                    </div>
                    <div className="csm-thread-controls">
                      <select className="form-select" value={activeThread.status || 'OPEN'} onChange={(e) => updateThread({ status: e.target.value })}>
                        {(meta.inboxThreadStatuses || []).map((status) => <option key={status} value={status}>{formatLabel(status)}</option>)}
                      </select>
                    </div>
                  </div>
                  <MessageStream messages={threadMessages} />
                  <form className="csm-reply-box" onSubmit={submitReply}>
                    <textarea className="form-control" rows={3} value={replyText} placeholder="Reply to customer" onChange={(e) => setReplyText(e.target.value)} />
                    <div className="csm-form-actions">
                      <button className="btn btn-primary" disabled={!replyText.trim()}><IconMessageCircle size={18} className="me-2" />Send Reply</button>
                    </div>
                  </form>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Service Requests' && (
        <div className="row row-cards">
          <div className="col-12">
            <Card title="Customer Lookup" icon={IconUsers} actions={<button className="btn btn-sm" onClick={() => load(customerSearch)}><IconSearch size={16} className="me-1" />Search</button>}>
              <input className="form-control" placeholder="Search by account, name, or mobile number" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} />
            </Card>
          </div>
          <div className="col-xl-4">
            <Card title={requestForm.id ? 'Edit Service Request' : 'New Service Request'} icon={IconPlus}>
              <form onSubmit={submitRequest}>
                <div className="form-grid">
                  <SelectField label="Customer" value={requestForm.customerId} onChange={(value) => setRequestForm({ ...requestForm, customerId: value })} required>{customerOptions()}</SelectField>
                  <TextField label="Subject" value={requestForm.subject} required onChange={(value) => setRequestForm({ ...requestForm, subject: value })} />
                  <SelectField label="Channel" value={requestForm.channel} options={meta.channels} onChange={(value) => setRequestForm({ ...requestForm, channel: value })} />
                  <SelectField label="Category" value={requestForm.category} options={meta.requestCategories} onChange={(value) => setRequestForm({ ...requestForm, category: value })} />
                  <SelectField label="Priority" value={requestForm.priority} options={meta.priorities} onChange={(value) => setRequestForm({ ...requestForm, priority: value })} />
                  <SelectField label="Status" value={requestForm.status} options={meta.requestStatuses} onChange={(value) => setRequestForm({ ...requestForm, status: value })} />
                  <TextField label="Assigned To" value={requestForm.assignedTo} onChange={(value) => setRequestForm({ ...requestForm, assignedTo: value })} />
                  <TextField label="Due Date" type="date" value={requestForm.dueDate} onChange={(value) => setRequestForm({ ...requestForm, dueDate: value })} />
                  <TextArea label="Description" value={requestForm.description} required onChange={(value) => setRequestForm({ ...requestForm, description: value })} />
                  <TextArea label="Resolution" value={requestForm.resolution} rows={2} onChange={(value) => setRequestForm({ ...requestForm, resolution: value })} />
                  <TextField label="Tags" value={requestForm.tagsText} onChange={(value) => setRequestForm({ ...requestForm, tagsText: value })} />
                </div>
                <div className="csm-form-actions">
                  {requestForm.id && <button className="btn" type="button" onClick={() => setRequestForm(blankRequest)}>Cancel</button>}
                  <button className="btn btn-primary"><IconDeviceFloppy size={18} className="me-2" />Save Request</button>
                </div>
              </form>
            </Card>
          </div>
          <div className="col-xl-8">
            <Card title="Service Requests" icon={IconMessageCircle}>
              <div className="csm-filter-row">
                <input className="form-control" placeholder="Search requests" value={filters.search} onChange={(e) => updateFilters({ search: e.target.value })} />
                <select className="form-select" value={filters.status} onChange={(e) => updateFilters({ status: e.target.value })}>
                  <option value="">All statuses</option>
                  {meta.requestStatuses.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
                </select>
              </div>
              <RequestTable rows={requests} onEdit={editRequest} onDelete={deleteRequest} />
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Interactions' && (
        <div className="row row-cards">
          <div className="col-xl-4">
            <Card title={interactionForm.id ? 'Edit Interaction' : 'Log Interaction'} icon={IconPhoneCall}>
              <form onSubmit={submitInteraction}>
                <div className="form-grid">
                  <SelectField label="Linked Request" value={interactionForm.requestId} onChange={(value) => setRequestLink(value, setInteractionForm, interactionForm)}>{requestOptions()}</SelectField>
                  <SelectField label="Customer" value={interactionForm.customerId} required onChange={(value) => setInteractionForm({ ...interactionForm, customerId: value })}>{customerOptions()}</SelectField>
                  <SelectField label="Type" value={interactionForm.type} options={meta.interactionTypes} onChange={(value) => setInteractionForm({ ...interactionForm, type: value })} />
                  <SelectField label="Direction" value={interactionForm.direction} options={meta.interactionDirections} onChange={(value) => setInteractionForm({ ...interactionForm, direction: value })} />
                  <TextField label="Occurred At" type="datetime-local" value={interactionForm.occurredAt} onChange={(value) => setInteractionForm({ ...interactionForm, occurredAt: value })} />
                  <TextField label="Agent" value={interactionForm.agentName} onChange={(value) => setInteractionForm({ ...interactionForm, agentName: value })} />
                  <TextField label="Summary" value={interactionForm.summary} required onChange={(value) => setInteractionForm({ ...interactionForm, summary: value })} />
                  <TextArea label="Details" value={interactionForm.details} onChange={(value) => setInteractionForm({ ...interactionForm, details: value })} />
                  <TextField label="Outcome" value={interactionForm.outcome} onChange={(value) => setInteractionForm({ ...interactionForm, outcome: value })} />
                </div>
                <div className="csm-form-actions">
                  {interactionForm.id && <button className="btn" type="button" onClick={() => setInteractionForm(blankInteraction)}>Cancel</button>}
                  <button className="btn btn-primary"><IconDeviceFloppy size={18} className="me-2" />Save Interaction</button>
                </div>
              </form>
            </Card>
          </div>
          <div className="col-xl-8">
            <Card title="Interaction Log" icon={IconPhoneCall}>
              <InteractionTable rows={interactions} onEdit={editInteraction} onDelete={deleteInteraction} />
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Follow-ups' && (
        <div className="row row-cards">
          <div className="col-xl-4">
            <Card title={followUpForm.id ? 'Edit Follow-up' : 'Schedule Follow-up'} icon={IconCalendarDue}>
              <form onSubmit={submitFollowUp}>
                <div className="form-grid">
                  <SelectField label="Linked Request" value={followUpForm.requestId} onChange={(value) => setRequestLink(value, setFollowUpForm, followUpForm)}>{requestOptions()}</SelectField>
                  <SelectField label="Customer" value={followUpForm.customerId} required onChange={(value) => setFollowUpForm({ ...followUpForm, customerId: value })}>{customerOptions()}</SelectField>
                  <SelectField label="Type" value={followUpForm.type} options={meta.followUpTypes} onChange={(value) => setFollowUpForm({ ...followUpForm, type: value })} />
                  <SelectField label="Status" value={followUpForm.status} options={meta.followUpStatuses} onChange={(value) => setFollowUpForm({ ...followUpForm, status: value })} />
                  <TextField label="Due At" type="datetime-local" value={followUpForm.dueAt} onChange={(value) => setFollowUpForm({ ...followUpForm, dueAt: value })} />
                  <TextField label="Assigned To" value={followUpForm.assignedTo} onChange={(value) => setFollowUpForm({ ...followUpForm, assignedTo: value })} />
                  <TextArea label="Notes" value={followUpForm.notes} onChange={(value) => setFollowUpForm({ ...followUpForm, notes: value })} />
                </div>
                <div className="csm-form-actions">
                  {followUpForm.id && <button className="btn" type="button" onClick={() => setFollowUpForm(blankFollowUp)}>Cancel</button>}
                  <button className="btn btn-primary"><IconDeviceFloppy size={18} className="me-2" />Save Follow-up</button>
                </div>
              </form>
            </Card>
          </div>
          <div className="col-xl-8">
            <Card title="Follow-up Queue" icon={IconCalendarDue}>
              <FollowUpTable rows={followUps} onEdit={editFollowUp} onDelete={deleteFollowUp} />
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Settings' && (
        <div className="row row-cards">
          <div className="col-xl-8">
            <Card
              title="Facebook Messenger"
              icon={IconBrandFacebook}
              actions={<span className={`badge ${statusClass(channelSettings.FACEBOOK?.connectionStatus)}`}>{formatLabel(channelSettings.FACEBOOK?.connectionStatus || 'NOT CONFIGURED')}</span>}
            >
              <form onSubmit={saveFacebookSettings}>
                <div className="csm-settings-grid">
                  <CheckboxField label="Enable Facebook channel" checked={facebookForm.enabled} onChange={(value) => setFacebookField('enabled', value)} />
                  <TextField label="Page Name" value={facebookForm.pageName} onChange={(value) => setFacebookField('pageName', value)} />
                  <TextField label="Page ID" value={facebookForm.pageId} onChange={(value) => setFacebookField('pageId', value)} />
                  <TextField label="Meta App ID" value={facebookForm.appId} onChange={(value) => setFacebookField('appId', value)} />
                  <TextField label="Verify Token" value={facebookForm.verifyToken} onChange={(value) => setFacebookField('verifyToken', value)} />
                  <TextField label="Graph API Version" value={facebookForm.graphApiVersion} onChange={(value) => setFacebookField('graphApiVersion', value)} />
                  <TextField
                    label="Webhook Callback URL"
                    value={publicWebhookUrl(channelSettings.FACEBOOK?.webhookPath || '/api/customer-service-management/channels/facebook/webhook')}
                    readOnly
                    onChange={() => {}}
                  />
                  <TextField
                    autoComplete="off"
                    label="Page Access Token"
                    placeholder={channelSettings.FACEBOOK?.pageAccessTokenMasked || 'Paste token when rotating'}
                    type="password"
                    value={facebookForm.pageAccessToken}
                    onChange={(value) => setFacebookField('pageAccessToken', value)}
                  />
                  <TextArea label="Notes" value={facebookForm.notes} rows={2} onChange={(value) => setFacebookField('notes', value)} />
                </div>
                <div className="csm-form-actions">
                  <button className="btn" type="button" onClick={checkFacebookSettings}><IconCheck size={18} className="me-2" />Check Setup</button>
                  <button className="btn btn-primary"><IconDeviceFloppy size={18} className="me-2" />Save Facebook</button>
                </div>
              </form>
            </Card>
          </div>
          <div className="col-xl-4">
            <Card title="Future Channels" icon={IconSettings}>
              <div className="csm-channel-stack">
                <ChannelCard settings={channelSettings.TELEGRAM} icon={IconBrandTelegram} />
                <ChannelCard settings={channelSettings.WHATSAPP} icon={IconBrandWhatsapp} />
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function RequestTable({ rows, onEdit, onDelete }) {
  if (!rows?.length) return <div className="empty">No service requests yet.</div>;
  return (
    <div className="table-responsive">
      <table className="table card-table table-vcenter csm-table">
        <thead><tr><th>Request</th><th>Customer</th><th>Category</th><th>Priority</th><th>Status</th><th>Due</th><th></th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td><strong>{row.requestNumber}</strong><div className="text-muted">{row.subject}</div></td>
              <td>{customerLabel(row.customer)}</td>
              <td>{String(row.category || '').replaceAll('_', ' ')}</td>
              <td><span className={`badge ${statusClass(row.priority)}`}>{row.priority}</span></td>
              <td><span className={`badge ${statusClass(row.status)}`}>{String(row.status || '').replaceAll('_', ' ')}</span></td>
              <td>{row.dueDate || '-'}</td>
              <td className="text-end">
                <button className="btn btn-icon btn-sm" onClick={() => onEdit(row)} title="Edit"><IconEdit size={16} /></button>
                <button className="btn btn-icon btn-sm text-danger" onClick={() => onDelete(row.id)} title="Delete"><IconTrash size={16} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InboxThreadList({ rows, selectedId, onSelect }) {
  if (!rows?.length) return <div className="empty">No inbox conversations yet.</div>;
  return (
    <div className="csm-thread-list">
      {rows.map((thread) => {
        const Icon = channelIcon(thread.channel);
        return (
          <button
            className={`csm-thread-item ${selectedId === thread.id ? 'active' : ''}`}
            key={thread.id}
            onClick={() => onSelect(thread.id)}
            type="button"
          >
            <span className="csm-thread-icon"><Icon size={18} /></span>
            <span className="csm-thread-copy">
              <strong>{thread.customer?.name || thread.externalUserId || 'Unknown customer'}</strong>
              <span>{thread.lastMessage?.text || 'No messages yet'}</span>
              <small>{formatDateTime(thread.lastMessageAt)}</small>
            </span>
            {thread.unreadCount > 0 && <span className="badge bg-red text-white">{thread.unreadCount}</span>}
          </button>
        );
      })}
    </div>
  );
}

function MessageStream({ messages }) {
  if (!messages?.length) return <div className="empty">No messages yet.</div>;
  return (
    <div className="csm-message-stream">
      {messages.map((message) => (
        <div className={`csm-message ${message.direction === 'OUTBOUND' ? 'outbound' : 'inbound'}`} key={message.id}>
          <div className="csm-message-bubble">
            <div className="csm-message-meta">
              <strong>{message.actorName || formatLabel(message.direction)}</strong>
              <span>{formatDateTime(message.createdAt)}</span>
            </div>
            <p>{message.text}</p>
            {message.direction === 'OUTBOUND' && <small>{formatLabel(message.deliveryStatus)}</small>}
          </div>
        </div>
      ))}
    </div>
  );
}

function ChannelCard({ settings = {}, icon: Icon }) {
  return (
    <div className="csm-channel-card">
      <span className="csm-channel-icon">{Icon && <Icon size={20} />}</span>
      <div>
        <strong>{settings.displayName || settings.channel || 'Channel'}</strong>
        <div className="text-muted">{settings.notes || 'Planned integration'}</div>
      </div>
      <span className={`badge ${statusClass(settings.connectionStatus)}`}>{formatLabel(settings.connectionStatus || 'PLANNED')}</span>
    </div>
  );
}

function InteractionTable({ rows, onEdit, onDelete }) {
  if (!rows?.length) return <div className="empty">No interactions yet.</div>;
  return (
    <div className="table-responsive">
      <table className="table card-table table-vcenter csm-table">
        <thead><tr><th>When</th><th>Customer</th><th>Type</th><th>Summary</th><th>Outcome</th><th></th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{new Date(row.occurredAt).toLocaleString()}</td>
              <td>{customerLabel(row.customer)}</td>
              <td><span className="badge bg-blue-lt text-blue">{String(row.type || '').replaceAll('_', ' ')}</span></td>
              <td>{row.summary}</td>
              <td>{row.outcome || '-'}</td>
              <td className="text-end">
                <button className="btn btn-icon btn-sm" onClick={() => onEdit(row)} title="Edit"><IconEdit size={16} /></button>
                <button className="btn btn-icon btn-sm text-danger" onClick={() => onDelete(row.id)} title="Delete"><IconTrash size={16} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FollowUpList({ rows, onEdit }) {
  if (!rows?.length) return <div className="empty">No pending follow-ups.</div>;
  return (
    <div className="csm-follow-list">
      {rows.map((row) => (
        <button className="csm-follow-item" key={row.id} onClick={() => onEdit(row)}>
          <span className={`badge ${statusClass(row.status)}`}>{String(row.type || '').replaceAll('_', ' ')}</span>
          <strong>{customerLabel(row.customer)}</strong>
          <span className="text-muted">{new Date(row.dueAt).toLocaleString()}</span>
        </button>
      ))}
    </div>
  );
}

function FollowUpTable({ rows, onEdit, onDelete }) {
  if (!rows?.length) return <div className="empty">No follow-ups yet.</div>;
  return (
    <div className="table-responsive">
      <table className="table card-table table-vcenter csm-table">
        <thead><tr><th>Due</th><th>Customer</th><th>Type</th><th>Status</th><th>Assigned</th><th>Notes</th><th></th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{new Date(row.dueAt).toLocaleString()}</td>
              <td>{customerLabel(row.customer)}</td>
              <td>{String(row.type || '').replaceAll('_', ' ')}</td>
              <td><span className={`badge ${statusClass(row.status)}`}>{row.status}</span></td>
              <td>{row.assignedTo || '-'}</td>
              <td>{row.notes || '-'}</td>
              <td className="text-end">
                <button className="btn btn-icon btn-sm" onClick={() => onEdit(row)} title="Edit"><IconEdit size={16} /></button>
                <button className="btn btn-icon btn-sm text-danger" onClick={() => onDelete(row.id)} title="Delete"><IconTrash size={16} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
