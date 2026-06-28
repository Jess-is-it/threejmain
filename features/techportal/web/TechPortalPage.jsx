import React, { useEffect, useState } from 'react';
import {
  IconAlertTriangle,
  IconCalendarEvent,
  IconCircleCheck,
  IconRefresh,
  IconTicket,
  IconTool,
  IconUserCheck,
} from '@tabler/icons-react';
import './techPortal.css';

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
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || 'Request failed');
  return data;
}

function label(value) {
  return String(value || '').replaceAll('_', ' ').replaceAll('-', ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function KpiTile({ icon: Icon, label: title, value, tone }) {
  return (
    <article className={`techportal-kpi techportal-kpi-${tone}`}>
      <div className="techportal-kpi-icon"><Icon size={20} /></div>
      <div>
        <div className="techportal-kpi-value">{value ?? 0}</div>
        <div className="techportal-kpi-label">{title}</div>
      </div>
    </article>
  );
}

export default function TechPortalPage({ currentUser, onNavigatePage = () => {} }) {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadDashboard() {
    setLoading(true);
    try {
      const dashboardData = await request('/techportal/dashboard');
      setDashboard(dashboardData);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  const metrics = dashboard?.metrics || {};
  const technician = dashboard?.technician || {};
  const displayName = technician.name || currentUser?.full_name || currentUser?.username || 'Technician';
  const sourceLabel = dashboard?.source === 'sample' ? 'Sample Work' : 'Ticketing';

  return (
    <main className="techportal-page">
      <section className="techportal-hero">
        <div>
          <div className="techportal-kicker">Tech Portal Dashboard</div>
          <h1>{displayName}</h1>
          <div className="techportal-subline">
            <span><IconUserCheck size={17} />{label(technician.role || currentUser?.role || 'technician')}</span>
            <span><IconCircleCheck size={17} />{technician.status || 'Available'}</span>
            <span><IconTicket size={17} />{sourceLabel}</span>
          </div>
        </div>
        <div className="techportal-hero-actions">
          <button className="btn btn-outline-primary" type="button" onClick={loadDashboard} disabled={loading}>
            <IconRefresh size={18} className="me-2" />Refresh
          </button>
          <button className="btn btn-primary" type="button" onClick={() => onNavigatePage('Tech Portal Ticketing')}>
            <IconTicket size={18} className="me-2" />Ticketing
          </button>
        </div>
      </section>

      {error && <div className="alert alert-danger">{error}</div>}

      <section className="techportal-kpis techportal-kpis-dashboard" aria-label="Technician KPI dashboard">
        <KpiTile icon={IconTicket} label="Assigned" value={metrics.assigned} tone="blue" />
        <KpiTile icon={IconAlertTriangle} label="Urgent" value={metrics.urgent} tone="red" />
        <KpiTile icon={IconCalendarEvent} label="Due Today" value={metrics.dueToday} tone="orange" />
        <KpiTile icon={IconAlertTriangle} label="Overdue" value={metrics.overdue} tone="red" />
        <KpiTile icon={IconTool} label="In Progress" value={metrics.inProgress} tone="green" />
        <KpiTile icon={IconCircleCheck} label="Completed Today" value={metrics.completedToday} tone="blue" />
      </section>
    </main>
  );
}
