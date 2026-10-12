import React from 'react';
import { chartScale } from './reportClient.mjs';
const COLORS = ['var(--tblr-primary, #206bc4)', 'var(--tblr-warning, #f59f00)', 'var(--tblr-success, #2fb344)', 'var(--tblr-danger, #d63939)'];
const activate = (event, action) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(); } };

export function FinanceTrendChart({ title, labels, series, onOpen, format = String, context }) {
  const scale = chartScale(series.flatMap((s) => s.values));
  const x = (i) => 58 + i * 535 / Math.max(1, labels.length - 1), y = (p) => 210 - p * 170;
  return <section className="card finance-chart"><div className="card-body"><h3>{title}</h3>{context}<p className="text-secondary">Select a point or a value below to open supporting records. Gaps mean unavailable data.</p>
    <svg viewBox="0 0 660 260" role="group" aria-label={title}><line x1="45" y1={y(scale.zero)} x2="625" y2={y(scale.zero)} className="finance-chart-axis" />
      {series.map((s, si) => {
        const positions = scale.positions.slice(si * labels.length, (si + 1) * labels.length);
        return <g key={s.key} style={{ color: COLORS[si % COLORS.length] }}>{positions.map((p, i) => <React.Fragment key={i}>{p != null && i > 0 && positions[i - 1] != null && <line x1={x(i - 1)} y1={y(positions[i - 1])} x2={x(i)} y2={y(p)} stroke="currentColor" strokeWidth="3" />}{p != null && <g role="button" tabIndex="0" aria-label={`${labels[i]} ${s.label}: ${format(s.values[i])}. Open supporting records`} onClick={() => onOpen(i, s.key)} onKeyDown={(e) => activate(e, () => onOpen(i, s.key))} className="finance-chart-point"><circle cx={x(i)} cy={y(p)} r="10" fill="transparent" /><circle cx={x(i)} cy={y(p)} r="5" fill="currentColor" /><title>{labels[i]} · {s.label} · {format(s.values[i])}</title></g>}</React.Fragment>)}</g>;
      })}{labels.map((label, i) => <text key={label} x={x(i)} y="242" textAnchor="middle" className="finance-chart-label">{label}</text>)}
      {scale.empty && <text x="330" y="120" textAnchor="middle" className="finance-chart-label">No available figures</text>}
    </svg><div className="finance-chart-legend">{series.map((s, i) => <span key={s.key}><i style={{ background: COLORS[i % COLORS.length] }} />{s.label}</span>)}</div>
    <div className="table-responsive"><table className="table table-sm finance-chart-values"><thead><tr><th>Month</th>{series.map((s) => <th key={s.key}>{s.label}</th>)}</tr></thead><tbody>{labels.map((label, i) => <tr key={label}><th>{label}</th>{series.map((s) => <td key={s.key}><button type="button" className="finance-value-link" onClick={() => onOpen(i, s.key)}>{s.values[i] == null ? 'Unavailable' : format(s.values[i])}{s.statuses?.[i] && <small className="finance-code">{s.statuses[i].toLowerCase()}</small>}</button></td>)}</tr>)}</tbody></table></div>
  </div></section>;
}
export function FinanceBarChart({ title, rows, onOpen, format = String, context }) {
  const scale = chartScale(rows.map((r) => r.value));
  return <section className="card finance-chart"><div className="card-body"><h3>{title}</h3>{context}<p className="text-secondary">Select a bar to view its supporting records.</p>{rows.map((r, i) => <button type="button" className="finance-bar" key={r.key} onClick={() => onOpen(r)}><span>{r.label}</span><span className="finance-bar-track"><span className="finance-bar-zero" style={{ left: `${scale.zero * 100}%` }} /><span className={`finance-bar-fill ${String(r.value).startsWith('-') ? 'finance-bar-negative' : ''}`} style={{ left: `${Math.min(scale.zero, scale.positions[i] ?? scale.zero) * 100}%`, width: `${Math.abs((scale.positions[i] ?? scale.zero) - scale.zero) * 100}%` }} /></span><strong>{r.value == null ? 'Unavailable' : format(r.value)}</strong></button>)}{!rows.length && <p>No records for this chart.</p>}</div></section>;
}
