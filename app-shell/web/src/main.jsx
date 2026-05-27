import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@tabler/core/dist/css/tabler.min.css';
import {
  IconActivity,
  IconAlertTriangle,
  IconBox,
  IconBuildingStore,
  IconCash,
  IconChevronDown,
  IconChevronUp,
  IconClock,
  IconCpu,
  IconDashboard,
  IconDatabase,
  IconDeviceFloppy,
  IconId,
  IconKey,
  IconListDetails,
  IconLogout,
  IconMenu2,
  IconNetwork,
  IconPackage,
  IconRouter,
  IconSettings,
  IconShieldLock,
  IconTicket,
  IconTool,
  IconUser,
  IconUserCog,
  IconUsers,
  IconWifi
} from '@tabler/icons-react';
import AccountAdminPage from '../../../account-admin/web/AccountAdminPage.jsx';
import BillingPage from '../../../billing/web/BillingPage.jsx';
import CustomerProfilingPage from '../../../customer-profiling/web/CustomerProfilingPage.jsx';
import CustomerServiceManagementPage from '../../../customer-service-management/web/CustomerServiceManagementPage.jsx';
import InventoryPage from '../../../inventory/web/InventoryPage.jsx';
import LogsPage from '../../../logs/web/LogsPage.jsx';
import NetworkSettingsPage from '../../../network-settings/web/NetworkSettingsPage.jsx';
import PointOfSalePage from '../../../point-of-sale/web/PointOfSalePage.jsx';
import ServicePage from '../../../service/web/ServicePage.jsx';
import SystemSettingsPage from '../../../system-settings/web/SystemSettingsPage.jsx';
import TicketingPage from '../../../ticketing/web/TicketingPage.jsx';
import './styles.css';

const API = '/api';

const moduleNav = [
  { page: 'Dashboard', slug: 'dashboard', icon: IconDashboard, tone: 'blue' },
  { page: 'Customer Profiling', slug: 'customer-profiling', icon: IconUsers, tone: 'azure' },
  { page: 'Billing', slug: 'billing', icon: IconCash, tone: 'green' },
  { page: 'Point of Sale', slug: 'point-of-sale', icon: IconBuildingStore, tone: 'yellow' },
  { page: 'Inventory', slug: 'inventory', icon: IconBox, tone: 'orange' },
  { page: 'Account Admin', slug: 'account-admin', icon: IconUserCog, tone: 'purple' },
  { page: 'Customer Service Management', slug: 'customer-service-management', icon: IconTool, tone: 'cyan' },
  { page: 'Ticketing', slug: 'ticketing', icon: IconTicket, tone: 'red' },
  {
    page: 'Service',
    slug: 'service/catalog',
    icon: IconWifi,
    tone: 'blue',
    children: [
      { page: 'Service Catalog', slug: 'service/catalog', icon: IconPackage, tone: 'blue' },
      { page: 'Service Order', slug: 'service/order', icon: IconListDetails, tone: 'cyan' }
    ]
  },
  {
    page: 'Network Settings',
    slug: 'network-settings',
    icon: IconNetwork,
    tone: 'indigo',
    children: [
      {
        page: 'MikroTik',
        icon: IconRouter,
        tone: 'cyan',
        children: [
          { page: 'MikroTik Settings', label: 'Settings', slug: 'network-settings/mikrotik/settings', icon: IconSettings, tone: 'cyan' },
          { page: 'PPPoE Accounts', slug: 'network-settings/pppoe-accounts', icon: IconKey, tone: 'cyan' }
        ]
      },
      {
        page: 'OLT',
        icon: IconWifi,
        tone: 'blue',
        children: [
          { page: 'OLT Settings', label: 'Settings', slug: 'network-settings/olt/settings', icon: IconSettings, tone: 'blue' },
          { page: 'OLT & PON', slug: 'network-settings/olts', icon: IconWifi, tone: 'blue' },
          { page: 'ONUs', slug: 'network-settings/onus', icon: IconRouter, tone: 'cyan' },
          { page: 'NAP Boxes', slug: 'network-settings/nap-boxes', icon: IconBox, tone: 'orange' },
          { page: 'FBT', slug: 'network-settings/fbts', icon: IconNetwork, tone: 'green' }
        ]
      }
    ]
  },
  { page: 'System Settings', slug: 'system-settings', icon: IconSettings, tone: 'secondary' },
  { page: 'Logs', slug: 'logs', icon: IconListDetails, tone: 'yellow' }
];

const profilePages = {
  'View Profile': { icon: IconId, tone: 'blue' },
  'Change Password': { icon: IconKey, tone: 'blue' }
};

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

async function publicRequest(path) {
  const res = await fetch(`${API}${path}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || 'Request failed');
  return data;
}

function navItems() {
  const flatten = (items) => items.flatMap((item) => [item, ...flatten(item.children || [])]);
  return flatten(moduleNav);
}

function firstLeafNavItem(item) {
  if (!item?.children?.length) return item;
  return firstLeafNavItem(item.children[0]);
}

function navContainsPage(item, page) {
  return item.page === page || Boolean(item.children?.some((child) => navContainsPage(child, page)));
}

function navParentChainForPage(page, items = moduleNav, chain = []) {
  for (const item of items) {
    if (item.page === page) return chain;
    if (item.children?.length) {
      const found = navParentChainForPage(page, item.children, [...chain, item]);
      if (found.length) return found;
    }
  }
  return [];
}

function routeForPage(page) {
  const item = navItems().find((navItem) => navItem.page === page);
  if (item?.children?.length) return `/${firstLeafNavItem(item).slug}`;
  if (item?.slug) return `/${item.slug}`;
  if (page === 'View Profile') return '/profile';
  if (page === 'Change Password') return '/change-password';
  return '/dashboard';
}

function pageFromLocation() {
  const slug = window.location.pathname.replace(/^\/+|\/+$/g, '') || 'dashboard';
  const item = navItems().find((navItem) => navItem.slug && navItem.slug === slug);
  if (item) return item.page;
  if (slug === 'network-settings/devices') return 'MikroTik Settings';
  if (slug === 'profile') return 'View Profile';
  if (slug === 'change-password') return 'Change Password';
  return 'Dashboard';
}

function pageMeta(page) {
  const item = navItems().find((navItem) => navItem.page === page);
  return item || profilePages[page] || { icon: IconShieldLock, tone: 'blue' };
}

function formatUptime(seconds = 0) {
  const total = Number(seconds) || 0;
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
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
            <tr key={row.id || index}>
              {columns.map((column) => <td key={column}>{fmt(row[column])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Login({ branding, onLogin }) {
  const [form, setForm] = useState({ username: 'admin', password: 'admin123' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const data = await request('/auth/login', { method: 'POST', body: JSON.stringify(form) });
      localStorage.setItem('threejmain_token', data.access_token);
      onLogin();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-panel">
        <div className="login-brand">
          <span className="brand-compact"><IconWifi size={24} /></span>
          <h1>{branding.display_name}</h1>
          <p>{branding.portal_subtitle}</p>
        </div>
        <Card title="Admin Login" icon={IconShieldLock}>
          {error && <div className="alert alert-danger">{error}</div>}
          <form onSubmit={submit}>
            <div className="mb-3">
              <label className="form-label">Username</label>
              <input className="form-control" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>
            <div className="mb-3">
              <label className="form-label">Password</label>
              <input className="form-control" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <button className="btn btn-primary w-100" disabled={loading}>{loading ? 'Signing in...' : 'Sign in'}</button>
            <div className="form-hint mt-3">Default local credentials: admin / admin123. Change the password before deployment.</div>
          </form>
        </Card>
      </div>
    </div>
  );
}

function environmentTone(environment) {
  const normalized = String(environment || '').toLowerCase();
  if (normalized.includes('prod')) return 'production';
  if (normalized.includes('stag')) return 'staging';
  return 'local';
}

function Sidebar({ page, setPage, me, logout, branding, versionInfo, collapsed }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [navOpen, setNavOpen] = useState({});
  const environment = versionInfo?.environmentLabel || versionInfo?.environment || 'Local';
  const version = versionInfo?.version || 'local';
  const systemName = versionInfo?.systemName || branding.display_name || '3J ISP Management';
  const activate = (nextPage) => {
    setPage(nextPage);
    setMobileOpen(false);
    setProfileOpen(false);
  };

  useEffect(() => {
    const parents = navParentChainForPage(page);
    if (parents.length) {
      setNavOpen((current) => ({
        ...current,
        ...Object.fromEntries(parents.map((parent) => [parent.page, true]))
      }));
    }
  }, [page]);

  const renderNavItem = (item, depth = 0) => {
    const Icon = item.icon;
    const hasChildren = Boolean(item.children?.length);
    const activeChild = hasChildren && item.children.some((child) => navContainsPage(child, page));
    const active = page === item.page || activeChild;
    const expanded = navOpen[item.page] || activeChild;
    if (hasChildren) {
      return (
        <li className={`nav-item nav-item-parent ${active ? 'active' : ''}`} key={item.page}>
          <button
            className={`nav-link ${depth > 0 ? 'nav-sub-link nav-sub-parent' : ''} ${active ? 'active' : ''}`}
            onClick={() => {
              if (collapsed) {
                activate(firstLeafNavItem(item).page);
                return;
              }
              setNavOpen((current) => ({ ...current, [item.page]: !expanded }));
            }}
          >
            <span className="nav-link-icon d-md-none d-lg-inline-block"><Icon size={depth > 0 ? 18 : 20} /></span>
            <span className="nav-link-title">{item.label || item.page}</span>
            {!collapsed && <span className="nav-link-chevron ms-auto">{expanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}</span>}
          </button>
          {!collapsed && expanded && (
            <ul className={`nav-submenu nav-submenu-depth-${depth + 1}`}>
              {item.children.map((child) => renderNavItem(child, depth + 1))}
            </ul>
          )}
        </li>
      );
    }
    return (
      <li className="nav-item" key={item.page}>
        <button className={`nav-link ${depth > 0 ? 'nav-sub-link' : ''} ${page === item.page ? 'active' : ''}`} onClick={() => activate(item.page)}>
          <span className="nav-link-icon d-md-none d-lg-inline-block"><Icon size={depth > 0 ? 18 : 20} /></span>
          <span className="nav-link-title">{item.label || item.page}</span>
        </button>
      </li>
    );
  };

  return (
    <aside className="navbar navbar-vertical navbar-expand-lg" data-bs-theme="dark">
      <div className="container-fluid">
        <button className="navbar-toggler" type="button" onClick={() => setMobileOpen(!mobileOpen)}><span className="navbar-toggler-icon" /></button>
        <h1 className="navbar-brand navbar-brand-autodark">
          <button className="brand-button" onClick={() => activate('Dashboard')}>
            {collapsed ? <span className="brand-compact"><IconWifi size={22} /></span> : (branding.company_logo_url ? <img src={branding.company_logo_url} className="navbar-brand-logo" alt="Company Logo" /> : branding.display_name)}
          </button>
        </h1>
        <div className={`collapse navbar-collapse d-lg-flex flex-lg-column ${mobileOpen ? 'show' : ''}`}>
          <ul className="navbar-nav pt-lg-3">
            {moduleNav.map((item) => renderNavItem(item))}
          </ul>
          <div className="sidebar-user mt-auto">
            <button className="sidebar-user-trigger" type="button" onClick={() => !collapsed && setProfileOpen(!profileOpen)}>
              <span className="avatar avatar-sm bg-blue-lt text-blue"><IconUser size={18} /></span>
              <span className="sidebar-user-text">
                <span className="sidebar-user-name">{me?.full_name || me?.username || 'Admin'}</span>
                <span className="sidebar-user-role">{me?.role || 'owner'}</span>
              </span>
              <span className="sidebar-user-chevron">{profileOpen ? <IconChevronDown size={18} /> : <IconChevronUp size={18} />}</span>
            </button>
            {!collapsed && profileOpen && (
              <div className="sidebar-user-menu">
                <button className="dropdown-item" onClick={() => activate('View Profile')}><IconId size={18} className="me-2" />View Profile</button>
                <button className="dropdown-item" onClick={() => activate('Change Password')}><IconKey size={18} className="me-2" />Change Password</button>
                <div className="dropdown-divider" />
                <button className="dropdown-item text-danger" onClick={logout}><IconLogout size={18} className="me-2" />Logout</button>
              </div>
            )}
            {!collapsed && (
              <div className="sidebar-version" title={`${systemName} ${environment} ${versionInfo?.commitShort || ''}`.trim()}>
                <span className={`sidebar-version-env sidebar-version-env-${environmentTone(environment)}`}>{environment}</span>
                <span className="sidebar-version-name">{systemName}</span>
                <span className="sidebar-version-build">v{version}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

function Header({ page, resources, onToggleSidebar, sidebarCollapsed }) {
  const meta = pageMeta(page);
  const PageIcon = meta.icon;
  return (
    <header className="navbar navbar-expand-md navbar-light d-print-none sticky-top shell-header shell-header-content-aligned">
      <div className="container-xl">
        <div className="d-flex w-100 align-items-center">
          <button className="topnav-title" type="button" onClick={onToggleSidebar} aria-pressed={sidebarCollapsed}>
            <span className={`badge bg-${meta.tone}-lt text-${meta.tone} header-icon-badge`}><PageIcon size={18} /></span>
            <div className="h3 m-0">{page}</div>
          </button>
          <div className="sys-metrics d-none d-lg-flex ms-auto gap-4">
            <div className="sys-metric text-muted"><IconCpu size={18} /><span>CPU {resources?.cpu_pct ?? 0}%</span></div>
            <div className="sys-metric text-muted"><IconActivity size={18} /><span>RAM {resources?.ram_pressure_pct ?? 0}%</span></div>
            <div className="sys-metric text-muted"><IconDatabase size={18} /><span>DISK {resources?.disk_pct ?? 0}%</span></div>
            <div className="sys-metric text-muted"><IconClock size={18} /><span>UPTIME {formatUptime(resources?.uptime_seconds)}</span></div>
          </div>
        </div>
      </div>
    </header>
  );
}

function Dashboard({ data }) {
  const summary = data?.summary || {};
  return (
    <div className="row row-cards">
      {[
        ['Modules', summary.modules, IconDashboard, 'blue'],
        ['Customers', summary.customers, IconUsers, 'azure'],
        ['Open Tickets', summary.open_tickets, IconTicket, 'red'],
        ['Inventory Alerts', summary.inventory_alerts, IconBox, 'orange']
      ].map(([label, value, Icon, tone]) => (
        <div className="col-sm-6 col-lg-3" key={label}>
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
        <Card title="Business Modules" icon={IconNetwork}>
          <div className="module-grid">
            {(data?.modules || []).map((module) => (
              <div className="module-card" key={module.slug}>
                <div className="d-flex justify-content-between gap-3">
                  <div>
                    <h3>{module.name}</h3>
                    <div className="text-muted">{module.description}</div>
                  </div>
                  <span className={`badge ${module.status === 'planned' ? 'bg-blue-lt text-blue' : 'bg-green-lt text-green'}`}>{module.status}</span>
                </div>
                <div className="module-folder mt-3">{module.folder}/</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="col-12">
        <Card title="Operational Notes" icon={IconAlertTriangle}>
          {(data?.alerts || []).map((alert) => <div className={`alert alert-${alert.level === 'warning' ? 'warning' : 'info'} mb-2`} key={alert.message}>{alert.message}</div>)}
        </Card>
      </div>
    </div>
  );
}

function ModulePage({ module }) {
  if (!module) return <div className="empty">Module not found.</div>;
  const metrics = Object.entries(module.metrics || {});
  return (
    <div className="row row-cards">
      <div className="col-12">
        <Card title={module.name} icon={pageMeta(module.name).icon}>
          <div className="d-flex flex-wrap justify-content-between gap-3">
            <div>
              <p className="lead mb-2">{module.description}</p>
              <div className="text-muted">Folder: <code>{module.folder}/</code></div>
            </div>
            <span className={`badge ${module.status === 'planned' ? 'bg-blue-lt text-blue' : 'bg-green-lt text-green'}`}>{module.status}</span>
          </div>
        </Card>
      </div>
      {metrics.map(([name, value]) => (
        <div className="col-sm-6 col-lg-4" key={name}>
          <Card title={name.replaceAll('_', ' ')}>
            <div className="h1 mb-0">{value}</div>
            <div className="text-muted">Placeholder metric</div>
          </Card>
        </div>
      ))}
      <div className="col-12">
        <Card title="Next Build Area" icon={IconTool}>
          <div className="text-muted">Module-specific UI and API should live in this module folder, then be imported by the shared shell.</div>
        </Card>
      </div>
    </div>
  );
}

function ProfilePage({ mode, onSaved }) {
  const [profile, setProfile] = useState({});
  const [passwords, setPasswords] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [message, setMessage] = useState('');

  useEffect(() => { request('/me').then(setProfile).catch((err) => setMessage(err.message)); }, []);

  async function saveProfile(e) {
    e.preventDefault();
    const saved = await request('/me', { method: 'PATCH', body: JSON.stringify({ full_name: profile.full_name, email: profile.email }) });
    setProfile(saved);
    setMessage('Profile saved.');
    onSaved();
  }

  async function changePassword(e) {
    e.preventDefault();
    await request('/me/change-password', { method: 'POST', body: JSON.stringify(passwords) });
    setPasswords({ current_password: '', new_password: '', confirm_password: '' });
    setMessage('Password changed.');
  }

  return (
    <div className="row justify-content-center row-cards">
      {message && <div className="col-12 col-lg-10"><div className="alert alert-info">{message}</div></div>}
      {mode !== 'password' && (
        <div className="col-12 col-md-7 col-lg-5">
          <Card title="View Profile" icon={IconId}>
            <form onSubmit={saveProfile}>
              <div className="mb-3"><label className="form-label">Username</label><input className="form-control" value={profile.username || ''} readOnly /></div>
              <div className="mb-3"><label className="form-label">Full Name</label><input className="form-control" value={profile.full_name || ''} onChange={(e) => setProfile({ ...profile, full_name: e.target.value })} /></div>
              <div className="mb-3"><label className="form-label">Email</label><input className="form-control" value={profile.email || ''} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></div>
              <div className="text-end"><button className="btn btn-primary"><IconDeviceFloppy size={18} className="me-2" />Save Profile</button></div>
            </form>
          </Card>
        </div>
      )}
      {mode !== 'profile' && (
        <div className="col-12 col-md-7 col-lg-5">
          <Card title="Change Password" icon={IconKey}>
            <form onSubmit={changePassword}>
              <div className="mb-3"><label className="form-label">Current Password</label><input className="form-control" type="password" value={passwords.current_password} onChange={(e) => setPasswords({ ...passwords, current_password: e.target.value })} /></div>
              <div className="mb-3"><label className="form-label">New Password</label><input className="form-control" type="password" value={passwords.new_password} onChange={(e) => setPasswords({ ...passwords, new_password: e.target.value })} /></div>
              <div className="mb-3"><label className="form-label">Confirm New Password</label><input className="form-control" type="password" value={passwords.confirm_password} onChange={(e) => setPasswords({ ...passwords, confirm_password: e.target.value })} /></div>
              <div className="text-end"><button className="btn btn-primary"><IconKey size={18} className="me-2" />Save Password</button></div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}

function App() {
  const [authed, setAuthed] = useState(Boolean(token()));
  const [page, setPage] = useState(pageFromLocation());
  const [branding, setBranding] = useState({ display_name: '3J ISP Management', portal_subtitle: 'Small ISP operations dashboard', accent_color: '#206bc4' });
  const [me, setMe] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [modules, setModules] = useState([]);
  const [resources, setResources] = useState(null);
  const [versionInfo, setVersionInfo] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  async function loadPublicShell() {
    const [nextBranding, nextVersion] = await Promise.all([
      publicRequest('/public/branding'),
      publicRequest('/system/version')
    ]);
    setBranding(nextBranding);
    setVersionInfo(nextVersion);
  }

  async function refresh() {
    await loadPublicShell();
    if (token()) {
      const [nextMe, nextDashboard, nextModules] = await Promise.all([
        request('/me'),
        request('/dashboard'),
        request('/modules')
      ]);
      setMe(nextMe);
      setDashboard(nextDashboard);
      setModules(nextModules);
    }
  }

  function navigate(nextPage, replace = false) {
    setPage(nextPage);
    const path = routeForPage(nextPage);
    if (window.location.pathname !== path) window.history[replace ? 'replaceState' : 'pushState']({ page: nextPage }, '', path);
  }

  const moduleByPage = useMemo(() => {
    const map = new Map();
    modules.forEach((module) => map.set(module.name, module));
    return map;
  }, [modules]);

  useEffect(() => { loadPublicShell().catch(() => {}); }, []);
  useEffect(() => {
    const onPopState = () => setPage(pageFromLocation());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  useEffect(() => { if (authed) refresh().catch(() => setAuthed(false)); }, [authed]);
  useEffect(() => { document.documentElement.style.setProperty('--tblr-primary', branding.accent_color || '#206bc4'); }, [branding.accent_color]);
  useEffect(() => {
    if (!authed) return undefined;
    let mounted = true;
    const loadResources = async () => {
      try {
        const data = await request('/system/resources');
        if (mounted) setResources(data);
      } catch (_err) {
        if (mounted) setResources(null);
      }
    };
    loadResources();
    const timer = window.setInterval(loadResources, 15000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [authed]);

  if (!authed) return <Login branding={branding} onLogin={() => setAuthed(true)} />;

  const logout = async () => {
    await request('/auth/logout', { method: 'POST' }).catch(() => {});
    localStorage.removeItem('threejmain_token');
    setAuthed(false);
  };

  return (
    <div className={`page ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar page={page} setPage={navigate} me={me} logout={logout} branding={branding} versionInfo={versionInfo} collapsed={sidebarCollapsed} />
      <div className="page-wrapper">
        <Header page={page} resources={resources} onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)} sidebarCollapsed={sidebarCollapsed} />
        <div className="page-body">
          <div className="container-xl">
            {page === 'Dashboard' && <Dashboard data={dashboard} />}
            {page === 'Customer Profiling' && <CustomerProfilingPage refreshShell={refresh} />}
            {page === 'Billing' && <BillingPage refreshShell={refresh} />}
            {page === 'Point of Sale' && <PointOfSalePage refreshShell={refresh} />}
            {page === 'Inventory' && <InventoryPage refreshShell={refresh} />}
            {page === 'Account Admin' && <AccountAdminPage refreshShell={refresh} />}
            {page === 'Customer Service Management' && <CustomerServiceManagementPage refreshShell={refresh} />}
            {page === 'Ticketing' && <TicketingPage refreshShell={refresh} />}
            {page === 'Service Catalog' && <ServicePage initialSection="catalog" refreshShell={refresh} />}
            {page === 'Service Order' && <ServicePage initialSection="orders" refreshShell={refresh} />}
            {page === 'Network Settings' && <NetworkSettingsPage initialSection="overview" refreshShell={refresh} />}
            {page === 'MikroTik Settings' && <NetworkSettingsPage initialSection="mikrotik-settings" refreshShell={refresh} />}
            {page === 'PPPoE Accounts' && <NetworkSettingsPage initialSection="pppoe" refreshShell={refresh} />}
            {page === 'OLT Settings' && <NetworkSettingsPage initialSection="olt-settings" refreshShell={refresh} />}
            {page === 'OLT & PON' && <NetworkSettingsPage initialSection="olts" refreshShell={refresh} />}
            {page === 'ONUs' && <NetworkSettingsPage initialSection="onus" refreshShell={refresh} />}
            {page === 'NAP Boxes' && <NetworkSettingsPage initialSection="naps" refreshShell={refresh} />}
            {page === 'FBT' && <NetworkSettingsPage initialSection="fbts" refreshShell={refresh} />}
            {moduleNav.filter((item) => ![
              'Dashboard',
              'Customer Profiling',
              'Billing',
              'Point of Sale',
              'Inventory',
              'Account Admin',
              'Customer Service Management',
              'Ticketing',
              'Service',
              'Network Settings',
              'System Settings',
              'Logs'
            ].includes(item.page)).map((item) => (
              page === item.page ? <ModulePage key={item.page} module={moduleByPage.get(item.page)} /> : null
            ))}
            {page === 'System Settings' && <SystemSettingsPage refreshShell={refresh} />}
            {page === 'Logs' && <LogsPage />}
            {page === 'View Profile' && <ProfilePage mode="profile" onSaved={refresh} />}
            {page === 'Change Password' && <ProfilePage mode="password" onSaved={refresh} />}
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
