import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconActivity,
  IconArrowDown,
  IconRefresh,
  IconSearch,
  IconZoomIn,
  IconZoomOut
} from '@tabler/icons-react';
import './processFlow.css';

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

function label(value) {
  return String(value || '').replaceAll('_', ' ');
}

function moduleTone(moduleName = '') {
  const name = moduleName.toLowerCase();
  if (name.includes('customer')) return 'azure';
  if (name.includes('service account')) return 'green';
  if (name.includes('service order')) return 'cyan';
  if (name.includes('service catalog')) return 'blue';
  if (name.includes('ticket')) return 'red';
  if (name.includes('billing')) return 'green';
  if (name.includes('inventory')) return 'orange';
  if (name.includes('network')) return 'indigo';
  return 'secondary';
}

export default function ProcessFlowPage() {
  const [flows, setFlows] = useState([]);
  const [selectedFlowId, setSelectedFlowId] = useState('');
  const [search, setSearch] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(null);
  const [error, setError] = useState('');
  const canvasRef = useRef(null);

  async function load() {
    setError('');
    try {
      const nextFlows = await request('/process-flow/flows');
      setFlows(nextFlows);
      setSelectedFlowId((current) => current || nextFlows[0]?.id || '');
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  const filteredFlows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return flows;
    return flows.filter((flow) => [
      flow.title,
      flow.summary,
      ...(flow.modules || []),
      ...(flow.stages || []).flatMap((stage) => [stage.title, stage.module, stage.status, stage.detail])
    ].join(' ').toLowerCase().includes(term));
  }, [flows, search]);

  const selectedFlow = useMemo(
    () => flows.find((flow) => flow.id === selectedFlowId) || filteredFlows[0] || flows[0] || null,
    [filteredFlows, flows, selectedFlowId]
  );

  function resetCanvas() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function startDrag(event) {
    if (!canvasRef.current) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging({ pointerId: event.pointerId, x: event.clientX, y: event.clientY, pan });
  }

  function moveDrag(event) {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    setPan({
      x: dragging.pan.x + event.clientX - dragging.x,
      y: dragging.pan.y + event.clientY - dragging.y
    });
  }

  function stopDrag(event) {
    if (dragging?.pointerId === event.pointerId) setDragging(null);
  }

  return (
    <div className="process-flow-page">
      {error && <div className="alert alert-danger">{error}</div>}
      <div className="process-flow-layout">
        <aside className="process-flow-sidebar">
          <div className="process-flow-search input-icon">
            <span className="input-icon-addon"><IconSearch size={16} /></span>
            <input className="form-control form-control-sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search process" />
          </div>
          <div className="process-flow-list">
            {filteredFlows.map((flow) => (
              <button
                className={`process-flow-list-item ${selectedFlow?.id === flow.id ? 'active' : ''}`}
                key={flow.id}
                type="button"
                onClick={() => {
                  setSelectedFlowId(flow.id);
                  resetCanvas();
                }}
              >
                <span className="process-flow-list-icon"><IconActivity size={17} /></span>
                <span>
                  <span className="fw-semibold">{flow.title}</span>
                  <small>{flow.stages?.length || 0} stages · {(flow.modules || []).join(', ')}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="process-flow-main">
          <div className="process-flow-toolbar">
            <div>
              <h3>{selectedFlow?.title || 'Process Flow'}</h3>
              <p>{selectedFlow?.summary || 'Select a process to view its system flow.'}</p>
            </div>
            <div className="btn-list">
              <button className="btn btn-sm btn-outline-secondary" type="button" onClick={() => setZoom((current) => Math.max(0.65, Number((current - 0.1).toFixed(2))))}><IconZoomOut size={16} /></button>
              <span className="btn btn-sm disabled">{Math.round(zoom * 100)}%</span>
              <button className="btn btn-sm btn-outline-secondary" type="button" onClick={() => setZoom((current) => Math.min(1.5, Number((current + 0.1).toFixed(2))))}><IconZoomIn size={16} /></button>
              <button className="btn btn-sm btn-outline-secondary" type="button" onClick={resetCanvas}><IconRefresh size={16} className="me-1" />Reset</button>
            </div>
          </div>

          <div
            className={`process-flow-canvas ${dragging ? 'dragging' : ''}`}
            ref={canvasRef}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={stopDrag}
            onPointerCancel={stopDrag}
          >
            <div className="process-flow-stage-track" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
              {(selectedFlow?.stages || []).map((stage, index, stages) => {
                const tone = moduleTone(stage.module);
                const isLast = index === stages.length - 1;
                return (
                  <div className="process-flow-stage-block" key={`${stage.title}-${index}`}>
                    <div className="process-flow-stage-card">
                      <div className="process-flow-stage-index">{index + 1}</div>
                      <div className="process-flow-stage-content">
                        <div className="d-flex align-items-center gap-2 flex-wrap">
                          <span className={`badge bg-${tone}-lt text-${tone}`}>{stage.module}</span>
                          <span className="badge bg-secondary-lt text-secondary">{label(stage.status)}</span>
                        </div>
                        <h4>{stage.title}</h4>
                        <p>{stage.detail}</p>
                      </div>
                    </div>
                    {!isLast && (
                      <div className="process-flow-connector" aria-hidden="true">
                        <span className="process-flow-connector-line" />
                        <span className="process-flow-connector-pulse"><IconArrowDown size={16} /></span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
