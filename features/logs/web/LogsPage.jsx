import React, { useEffect, useState } from 'react';
import { IconListDetails, IconRefresh } from '@tabler/icons-react';
import './logs.css';

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
      <table className="table card-table table-vcenter logs-table">
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

export default function LogsPage() {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      setLogs(await request('/logs'));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <Card title="Logs" icon={IconListDetails} actions={<button className="btn btn-sm" onClick={load}><IconRefresh size={16} className="me-1" />Refresh</button>}>
      {error && <div className="alert alert-danger">{error}</div>}
      <Table rows={logs} columns={['actor', 'action', 'target_type', 'target_id', 'details', 'created_at']} />
    </Card>
  );
}
