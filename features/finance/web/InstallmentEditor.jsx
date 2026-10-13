import React from 'react';
import { monthlyInstallments } from './expenseForm.mjs';

export default function InstallmentEditor({ form, onChange, total, onError }) {
  const rows = form.installments || [];
  return <div className="finance-installments">
    <div className="finance-toolbar">
      <label className="finance-field"><span>Number of installments</span><input className="form-control" type="number" min="2" max="120" value={form.installmentCount || 3} onChange={(e) => onChange({ ...form, installmentCount: e.target.value })} /></label>
      <button type="button" className="btn btn-outline-primary" onClick={() => { try { onChange({ ...form, installments: monthlyInstallments(total, form.installmentCount || 3, form.dueDate) }); } catch (e) { onError(e.message); } }}>Create monthly schedule</button>
    </div>
    <p>Review the dates and amounts. Together they must equal the full purchase or bill amount.</p>
    {rows.map((row, index) => <div className="finance-installment-row" key={index}><strong>#{index + 1}</strong>
      <label className="finance-field"><span>Installment {index + 1} due date</span><input className="form-control" type="date" required value={row.dueDate} onChange={(e) => onChange({ ...form, installments: rows.map((r, i) => i === index ? { ...r, dueDate: e.target.value } : r) })} /></label>
      <label className="finance-field"><span>Installment {index + 1} amount (PHP)</span><input className="form-control" required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={row.amount} onChange={(e) => onChange({ ...form, installments: rows.map((r, i) => i === index ? { ...r, amount: e.target.value } : r) })} /></label>
    </div>)}
    {!rows.length && <p>Choose the first due date and generate the schedule before saving.</p>}
  </div>;
}
