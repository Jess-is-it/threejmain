import React from 'react';
import { IconAlertTriangle, IconBox, IconDashboard, IconNetwork, IconTicket, IconUsers } from '@tabler/icons-react';
import './dashboard.css';

function Card({ title, icon: Icon, children }) {
  return (
    <div className="card">
      <div className="card-header">
        <h3 className="card-title">
          <Icon size={18} className="me-2 text-muted" />
          {title}
        </h3>
      </div>
      <div className="card-body">{children}</div>
    </div>
  );
}

export default function DashboardPage({ data }) {
  const summary = data?.summary || {};
  return (
    <div className="dashboard-page row row-cards">
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
