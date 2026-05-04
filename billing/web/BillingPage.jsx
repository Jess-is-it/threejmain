import React, { useEffect, useMemo, useState } from 'react';
import {
  IconCash,
  IconCreditCard,
  IconDeviceFloppy,
  IconEdit,
  IconFileInvoice,
  IconPlus,
  IconReceipt,
  IconRefresh,
  IconRepeat,
  IconSearch,
  IconTrash,
  IconUsers
} from '@tabler/icons-react';
import './billing.css';

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

function currency(value) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0));
}

function statusClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (['active', 'paid', 'posted'].includes(normalized)) return 'bg-green-lt text-green';
  if (['issued', 'partially_paid', 'pending', 'draft'].includes(normalized)) return 'bg-yellow-lt text-yellow';
  if (['overdue', 'void', 'cancelled'].includes(normalized)) return 'bg-red-lt text-red';
  if (['prepaid'].includes(normalized)) return 'bg-cyan-lt text-cyan';
  if (['postpaid'].includes(normalized)) return 'bg-indigo-lt text-indigo';
  return 'bg-blue-lt text-blue';
}

function customerLabel(customer) {
  if (!customer) return '-';
  return `${customer.accountNumber || 'NO-ACCOUNT'} - ${customer.name || 'Unnamed customer'}`;
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

function TextField({ label, value, onChange, type = 'text', required = false, min, max, step }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <input className="form-control" type={type} value={value ?? ''} min={min} max={max} step={step} required={required} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function SelectField({ label, value, onChange, options, required = false, children }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <select className="form-select" value={value ?? ''} required={required} onChange={(e) => onChange(e.target.value)}>
        {children || options.map((option) => <option key={option} value={option}>{option.replaceAll('_', ' ')}</option>)}
      </select>
    </div>
  );
}

const blankSubscription = {
  id: '',
  customerId: '',
  planName: 'Home Fiber 50 Mbps',
  serviceId: '',
  monthlyRate: '999',
  billingMode: 'PREPAID',
  billingDay: '1',
  startDate: today(),
  nextInvoiceDate: today(),
  dueDays: '0',
  status: 'ACTIVE',
  notes: ''
};

const blankInvoice = {
  id: '',
  customerId: '',
  subscriptionId: '',
  billingCycleStart: today(),
  billingCycleEnd: '',
  issueDate: today(),
  dueDate: today(),
  status: 'ISSUED',
  description: 'Monthly internet service',
  amount: '999',
  notes: ''
};

const blankPayment = {
  id: '',
  invoiceId: '',
  customerId: '',
  amount: '',
  method: 'CASH',
  paymentDate: today(),
  referenceNumber: '',
  status: 'POSTED',
  notes: ''
};

const blankAdjustment = {
  id: '',
  invoiceId: '',
  type: 'CREDIT',
  amount: '',
  reason: 'Service credit',
  status: 'POSTED',
  notes: ''
};

export default function BillingPage({ refreshShell = () => {} }) {
  const [activeTab, setActiveTab] = useState('Overview');
  const [meta, setMeta] = useState({ billingModes: [], subscriptionStatuses: [], invoiceStatuses: [], paymentMethods: [], paymentStatuses: [], adjustmentTypes: [], adjustmentStatuses: [] });
  const [overview, setOverview] = useState({ metrics: {}, recentInvoices: [], recentPayments: [], atRisk: [] });
  const [customers, setCustomers] = useState([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [subscriptions, setSubscriptions] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [balances, setBalances] = useState([]);
  const [subscriptionForm, setSubscriptionForm] = useState(blankSubscription);
  const [invoiceForm, setInvoiceForm] = useState(blankInvoice);
  const [paymentForm, setPaymentForm] = useState(blankPayment);
  const [adjustmentForm, setAdjustmentForm] = useState(blankAdjustment);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const invoiceById = useMemo(() => new Map(invoices.map((invoice) => [invoice.id, invoice])), [invoices]);

  async function load(search = customerSearch) {
    setError('');
    try {
      const [nextMeta, nextOverview, nextCustomers, nextSubscriptions, nextInvoices, nextPayments, nextAdjustments, nextBalances] = await Promise.all([
        request('/billing/meta'),
        request('/billing/overview'),
        request(`/billing/customers?search=${encodeURIComponent(search)}`),
        request('/billing/subscriptions'),
        request('/billing/invoices'),
        request('/billing/payments'),
        request('/billing/adjustments'),
        request('/billing/balances')
      ]);
      setMeta(nextMeta);
      setOverview(nextOverview);
      setCustomers(nextCustomers);
      setSubscriptions(nextSubscriptions);
      setInvoices(nextInvoices);
      setPayments(nextPayments);
      setAdjustments(nextAdjustments);
      setBalances(nextBalances);
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

  function subscriptionOptions() {
    return (
      <>
        <option value="">Manual invoice</option>
        {subscriptions.map((subscription) => (
          <option key={subscription.id} value={subscription.id}>
            {customerLabel(subscription.customer)} - {subscription.planName}
          </option>
        ))}
      </>
    );
  }

  function invoiceOptions() {
    return (
      <>
        <option value="">Customer-level payment</option>
        {invoices.filter((invoice) => invoice.status !== 'VOID').map((invoice) => (
          <option key={invoice.id} value={invoice.id}>
            {invoice.invoiceNumber} - {customerLabel(invoice.customer)} - {currency(invoice.balance)}
          </option>
        ))}
      </>
    );
  }

  async function submitSubscription(e) {
    e.preventDefault();
    const body = {
      ...subscriptionForm,
      monthlyRate: Number(subscriptionForm.monthlyRate),
      billingDay: Number(subscriptionForm.billingDay),
      dueDays: Number(subscriptionForm.dueDays)
    };
    const path = subscriptionForm.id ? `/billing/subscriptions/${subscriptionForm.id}` : '/billing/subscriptions';
    await request(path, { method: subscriptionForm.id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    setSubscriptionForm(blankSubscription);
    setMessage(subscriptionForm.id ? 'Subscription saved.' : 'Subscription created.');
    await load();
    refreshShell();
  }

  async function deleteSubscription(id) {
    if (!window.confirm('Cancel this subscription?')) return;
    await request(`/billing/subscriptions/${id}`, { method: 'DELETE' });
    setMessage('Subscription cancelled.');
    await load();
    refreshShell();
  }

  async function generateInvoice(id) {
    const invoice = await request(`/billing/subscriptions/${id}/generate-invoice`, { method: 'POST' });
    setMessage(`Generated ${invoice.invoiceNumber}.`);
    setActiveTab('Invoices');
    await load();
    refreshShell();
  }

  async function submitInvoice(e) {
    e.preventDefault();
    const body = {
      customerId: invoiceForm.customerId,
      subscriptionId: invoiceForm.subscriptionId || null,
      billingCycleStart: invoiceForm.billingCycleStart,
      billingCycleEnd: invoiceForm.billingCycleEnd || null,
      issueDate: invoiceForm.issueDate,
      dueDate: invoiceForm.dueDate,
      status: invoiceForm.status,
      lineItems: invoiceForm.description && invoiceForm.amount ? [{ description: invoiceForm.description, quantity: 1, unitPrice: Number(invoiceForm.amount) }] : null,
      notes: invoiceForm.notes
    };
    const path = invoiceForm.id ? `/billing/invoices/${invoiceForm.id}` : '/billing/invoices';
    await request(path, { method: invoiceForm.id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    setInvoiceForm(blankInvoice);
    setMessage(invoiceForm.id ? 'Invoice saved.' : 'Invoice created.');
    await load();
    refreshShell();
  }

  async function voidInvoice(id) {
    if (!window.confirm('Void this invoice?')) return;
    await request(`/billing/invoices/${id}`, { method: 'DELETE' });
    setMessage('Invoice voided.');
    await load();
    refreshShell();
  }

  async function submitPayment(e) {
    e.preventDefault();
    const body = { ...paymentForm, amount: Number(paymentForm.amount) };
    const path = paymentForm.id ? `/billing/payments/${paymentForm.id}` : '/billing/payments';
    await request(path, { method: paymentForm.id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    setPaymentForm(blankPayment);
    setMessage(paymentForm.id ? 'Payment saved.' : 'Payment posted.');
    await load();
    refreshShell();
  }

  async function voidPayment(id) {
    if (!window.confirm('Void this payment?')) return;
    await request(`/billing/payments/${id}`, { method: 'DELETE' });
    setMessage('Payment voided.');
    await load();
    refreshShell();
  }

  async function submitAdjustment(e) {
    e.preventDefault();
    const body = { ...adjustmentForm, amount: Number(adjustmentForm.amount) };
    const path = adjustmentForm.id ? `/billing/adjustments/${adjustmentForm.id}` : '/billing/adjustments';
    await request(path, { method: adjustmentForm.id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    setAdjustmentForm(blankAdjustment);
    setMessage(adjustmentForm.id ? 'Adjustment saved.' : 'Adjustment posted.');
    await load();
    refreshShell();
  }

  async function voidAdjustment(id) {
    if (!window.confirm('Void this adjustment?')) return;
    await request(`/billing/adjustments/${id}`, { method: 'DELETE' });
    setMessage('Adjustment voided.');
    await load();
    refreshShell();
  }

  function editInvoice(invoice) {
    const firstLine = invoice.lineItems?.[0] || {};
    setInvoiceForm({
      id: invoice.id,
      customerId: invoice.customerId,
      subscriptionId: invoice.subscriptionId || '',
      billingCycleStart: invoice.billingCycleStart,
      billingCycleEnd: invoice.billingCycleEnd,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      status: invoice.status,
      description: firstLine.description || '',
      amount: String(firstLine.unitPrice || firstLine.amount || ''),
      notes: invoice.notes || ''
    });
    setActiveTab('Invoices');
  }

  function setPaymentInvoice(invoiceId) {
    const invoice = invoiceById.get(invoiceId);
    setPaymentForm({
      ...paymentForm,
      invoiceId,
      customerId: invoice?.customerId || paymentForm.customerId,
      amount: invoice ? String(invoice.balance || invoice.total || '') : paymentForm.amount
    });
  }

  function metricCards() {
    const metrics = overview.metrics || {};
    return [
      ['Active Subscriptions', metrics.active_subscriptions || 0, IconRepeat, 'green'],
      ['Open Invoices', metrics.open_invoices || 0, IconFileInvoice, 'yellow'],
      ['Overdue', metrics.overdue || 0, IconReceipt, 'red'],
      ['MRR', currency(metrics.monthly_recurring_revenue || 0), IconCash, 'blue'],
      ['Collections', currency(metrics.collections || 0), IconCreditCard, 'cyan'],
      ['Outstanding', currency(metrics.outstanding_balance || 0), IconUsers, 'orange']
    ].map(([label, value, Icon, tone]) => (
      <div className="billing-metric" key={label}>
        <span className={`badge bg-${tone}-lt text-${tone}`}><Icon size={18} /></span>
        <div>
          <div className="billing-metric-value">{value}</div>
          <div className="text-muted">{label}</div>
        </div>
      </div>
    ));
  }

  return (
    <div className="billing-page">
      {message && <div className="alert alert-info">{message}</div>}
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="billing-toolbar">
        <div className="input-icon billing-search">
          <span className="input-icon-addon"><IconSearch size={16} /></span>
          <input className="form-control" value={customerSearch} placeholder="Search customers" onChange={(e) => setCustomerSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(customerSearch); }} />
        </div>
        <button className="btn" onClick={() => load(customerSearch)}><IconRefresh size={16} className="me-1" />Refresh</button>
      </div>

      <ul className="nav nav-tabs mb-3">
        {['Overview', 'Subscriptions', 'Invoices', 'Payments', 'Adjustments', 'Balances'].map((tab) => (
          <li className="nav-item" key={tab}>
            <button className={`nav-link ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>{tab}</button>
          </li>
        ))}
      </ul>

      {activeTab === 'Overview' && (
        <div className="row row-cards">
          <div className="col-12">
            <div className="billing-metrics">{metricCards()}</div>
          </div>
          <div className="col-lg-7">
            <Card title="Recent Invoices" icon={IconFileInvoice}>
              <InvoiceTable rows={overview.recentInvoices || []} onEdit={editInvoice} onVoid={voidInvoice} compact />
            </Card>
          </div>
          <div className="col-lg-5">
            <Card title="Collection Risk" icon={IconReceipt}>
              <InvoiceTable rows={overview.atRisk || []} onEdit={editInvoice} onVoid={voidInvoice} compact />
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Subscriptions' && (
        <div className="row row-cards">
          <div className="col-lg-4">
            <Card title={subscriptionForm.id ? 'Edit Subscription' : 'New Subscription'} icon={IconRepeat}>
              <form className="billing-form" onSubmit={submitSubscription}>
                <SelectField label="Customer" value={subscriptionForm.customerId} required onChange={(customerId) => setSubscriptionForm({ ...subscriptionForm, customerId })}>{customerOptions()}</SelectField>
                <TextField label="Plan Name" value={subscriptionForm.planName} required onChange={(planName) => setSubscriptionForm({ ...subscriptionForm, planName })} />
                <TextField label="Service ID" value={subscriptionForm.serviceId} onChange={(serviceId) => setSubscriptionForm({ ...subscriptionForm, serviceId })} />
                <TextField label="Monthly Rate" type="number" min="0" step="0.01" value={subscriptionForm.monthlyRate} required onChange={(monthlyRate) => setSubscriptionForm({ ...subscriptionForm, monthlyRate })} />
                <SelectField label="Billing Mode" value={subscriptionForm.billingMode} options={meta.billingModes || ['PREPAID', 'POSTPAID']} onChange={(billingMode) => setSubscriptionForm({ ...subscriptionForm, billingMode, dueDays: billingMode === 'PREPAID' ? '0' : '7' })} />
                <div className="billing-two-cols">
                  <TextField label="Billing Day" type="number" min="1" max="28" value={subscriptionForm.billingDay} required onChange={(billingDay) => setSubscriptionForm({ ...subscriptionForm, billingDay })} />
                  <TextField label="Due Days" type="number" min="0" max="60" value={subscriptionForm.dueDays} required onChange={(dueDays) => setSubscriptionForm({ ...subscriptionForm, dueDays })} />
                </div>
                <div className="billing-two-cols">
                  <TextField label="Start Date" type="date" value={subscriptionForm.startDate} required onChange={(startDate) => setSubscriptionForm({ ...subscriptionForm, startDate, nextInvoiceDate: subscriptionForm.nextInvoiceDate || startDate })} />
                  <TextField label="Next Invoice" type="date" value={subscriptionForm.nextInvoiceDate} required onChange={(nextInvoiceDate) => setSubscriptionForm({ ...subscriptionForm, nextInvoiceDate })} />
                </div>
                <SelectField label="Status" value={subscriptionForm.status} options={meta.subscriptionStatuses || ['ACTIVE']} onChange={(status) => setSubscriptionForm({ ...subscriptionForm, status })} />
                <TextField label="Notes" value={subscriptionForm.notes} onChange={(notes) => setSubscriptionForm({ ...subscriptionForm, notes })} />
                <div className="billing-form-actions">
                  {subscriptionForm.id && <button className="btn" type="button" onClick={() => setSubscriptionForm(blankSubscription)}>Cancel</button>}
                  <button className="btn btn-primary"><IconDeviceFloppy size={16} className="me-1" />Save</button>
                </div>
              </form>
            </Card>
          </div>
          <div className="col-lg-8">
            <Card title="Subscriptions" icon={IconRepeat}>
              <SubscriptionTable
                rows={subscriptions}
                onEdit={(subscription) => setSubscriptionForm({ ...blankSubscription, ...subscription, monthlyRate: String(subscription.monthlyRate), billingDay: String(subscription.billingDay), dueDays: String(subscription.dueDays) })}
                onGenerate={generateInvoice}
                onDelete={deleteSubscription}
              />
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Invoices' && (
        <div className="row row-cards">
          <div className="col-lg-4">
            <Card title={invoiceForm.id ? 'Edit Invoice' : 'New Invoice'} icon={IconFileInvoice}>
              <form className="billing-form" onSubmit={submitInvoice}>
                <SelectField label="Subscription" value={invoiceForm.subscriptionId} onChange={(subscriptionId) => {
                  const subscription = subscriptions.find((item) => item.id === subscriptionId);
                  setInvoiceForm({ ...invoiceForm, subscriptionId, customerId: subscription?.customerId || invoiceForm.customerId, amount: subscription ? String(subscription.monthlyRate) : invoiceForm.amount });
                }}>{subscriptionOptions()}</SelectField>
                {!invoiceForm.subscriptionId && <SelectField label="Customer" value={invoiceForm.customerId} required onChange={(customerId) => setInvoiceForm({ ...invoiceForm, customerId })}>{customerOptions()}</SelectField>}
                <div className="billing-two-cols">
                  <TextField label="Cycle Start" type="date" value={invoiceForm.billingCycleStart} required onChange={(billingCycleStart) => setInvoiceForm({ ...invoiceForm, billingCycleStart })} />
                  <TextField label="Cycle End" type="date" value={invoiceForm.billingCycleEnd} onChange={(billingCycleEnd) => setInvoiceForm({ ...invoiceForm, billingCycleEnd })} />
                </div>
                <div className="billing-two-cols">
                  <TextField label="Issue Date" type="date" value={invoiceForm.issueDate} required onChange={(issueDate) => setInvoiceForm({ ...invoiceForm, issueDate })} />
                  <TextField label="Due Date" type="date" value={invoiceForm.dueDate} required onChange={(dueDate) => setInvoiceForm({ ...invoiceForm, dueDate })} />
                </div>
                <TextField label="Line Item" value={invoiceForm.description} required onChange={(description) => setInvoiceForm({ ...invoiceForm, description })} />
                <TextField label="Amount" type="number" min="0" step="0.01" value={invoiceForm.amount} required onChange={(amount) => setInvoiceForm({ ...invoiceForm, amount })} />
                <SelectField label="Status" value={invoiceForm.status} options={meta.invoiceStatuses || ['ISSUED']} onChange={(status) => setInvoiceForm({ ...invoiceForm, status })} />
                <TextField label="Notes" value={invoiceForm.notes} onChange={(notes) => setInvoiceForm({ ...invoiceForm, notes })} />
                <div className="billing-form-actions">
                  {invoiceForm.id && <button className="btn" type="button" onClick={() => setInvoiceForm(blankInvoice)}>Cancel</button>}
                  <button className="btn btn-primary"><IconDeviceFloppy size={16} className="me-1" />Save</button>
                </div>
              </form>
            </Card>
          </div>
          <div className="col-lg-8">
            <Card title="Invoices" icon={IconFileInvoice}>
              <InvoiceTable rows={invoices} onEdit={editInvoice} onVoid={voidInvoice} />
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Payments' && (
        <div className="row row-cards">
          <div className="col-lg-4">
            <Card title={paymentForm.id ? 'Edit Payment' : 'Post Payment'} icon={IconCreditCard}>
              <form className="billing-form" onSubmit={submitPayment}>
                <SelectField label="Invoice" value={paymentForm.invoiceId} onChange={setPaymentInvoice}>{invoiceOptions()}</SelectField>
                {!paymentForm.invoiceId && <SelectField label="Customer" value={paymentForm.customerId} required onChange={(customerId) => setPaymentForm({ ...paymentForm, customerId })}>{customerOptions()}</SelectField>}
                <TextField label="Amount" type="number" min="0" step="0.01" value={paymentForm.amount} required onChange={(amount) => setPaymentForm({ ...paymentForm, amount })} />
                <SelectField label="Method" value={paymentForm.method} options={meta.paymentMethods || ['CASH']} onChange={(method) => setPaymentForm({ ...paymentForm, method })} />
                <TextField label="Payment Date" type="date" value={paymentForm.paymentDate} required onChange={(paymentDate) => setPaymentForm({ ...paymentForm, paymentDate })} />
                <TextField label="Reference Number" value={paymentForm.referenceNumber} onChange={(referenceNumber) => setPaymentForm({ ...paymentForm, referenceNumber })} />
                <SelectField label="Status" value={paymentForm.status} options={meta.paymentStatuses || ['POSTED']} onChange={(status) => setPaymentForm({ ...paymentForm, status })} />
                <TextField label="Notes" value={paymentForm.notes} onChange={(notes) => setPaymentForm({ ...paymentForm, notes })} />
                <div className="billing-form-actions">
                  {paymentForm.id && <button className="btn" type="button" onClick={() => setPaymentForm(blankPayment)}>Cancel</button>}
                  <button className="btn btn-primary"><IconDeviceFloppy size={16} className="me-1" />Save</button>
                </div>
              </form>
            </Card>
          </div>
          <div className="col-lg-8">
            <Card title="Payments" icon={IconReceipt}>
              <PaymentTable
                rows={payments}
                onEdit={(payment) => setPaymentForm({ ...blankPayment, ...payment, amount: String(payment.amount) })}
                onVoid={voidPayment}
              />
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Adjustments' && (
        <div className="row row-cards">
          <div className="col-lg-4">
            <Card title={adjustmentForm.id ? 'Edit Adjustment' : 'Post Adjustment'} icon={IconPlus}>
              <form className="billing-form" onSubmit={submitAdjustment}>
                <SelectField label="Invoice" value={adjustmentForm.invoiceId} required onChange={(invoiceId) => setAdjustmentForm({ ...adjustmentForm, invoiceId })}>
                  <option value="">Select invoice</option>
                  {invoices.filter((invoice) => invoice.status !== 'VOID').map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} - {customerLabel(invoice.customer)}</option>)}
                </SelectField>
                <SelectField label="Type" value={adjustmentForm.type} options={meta.adjustmentTypes || ['CREDIT', 'DEBIT']} onChange={(type) => setAdjustmentForm({ ...adjustmentForm, type })} />
                <TextField label="Amount" type="number" min="0" step="0.01" value={adjustmentForm.amount} required onChange={(amount) => setAdjustmentForm({ ...adjustmentForm, amount })} />
                <TextField label="Reason" value={adjustmentForm.reason} required onChange={(reason) => setAdjustmentForm({ ...adjustmentForm, reason })} />
                <SelectField label="Status" value={adjustmentForm.status} options={meta.adjustmentStatuses || ['POSTED']} onChange={(status) => setAdjustmentForm({ ...adjustmentForm, status })} />
                <TextField label="Notes" value={adjustmentForm.notes} onChange={(notes) => setAdjustmentForm({ ...adjustmentForm, notes })} />
                <div className="billing-form-actions">
                  {adjustmentForm.id && <button className="btn" type="button" onClick={() => setAdjustmentForm(blankAdjustment)}>Cancel</button>}
                  <button className="btn btn-primary"><IconDeviceFloppy size={16} className="me-1" />Save</button>
                </div>
              </form>
            </Card>
          </div>
          <div className="col-lg-8">
            <Card title="Adjustments" icon={IconPlus}>
              <AdjustmentTable
                rows={adjustments}
                onEdit={(adjustment) => setAdjustmentForm({ ...blankAdjustment, ...adjustment, amount: String(adjustment.amount) })}
                onVoid={voidAdjustment}
              />
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Balances' && (
        <Card title="Customer Balances" icon={IconUsers}>
          <BalanceTable rows={balances} />
        </Card>
      )}
    </div>
  );
}

function Empty() {
  return <div className="empty">No records yet.</div>;
}

function SubscriptionTable({ rows, onEdit, onGenerate, onDelete }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-responsive">
      <table className="table card-table table-vcenter">
        <thead>
          <tr>
            <th>Customer</th>
            <th>Plan</th>
            <th>Mode</th>
            <th>Rate</th>
            <th>Next Invoice</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{customerLabel(row.customer)}</td>
              <td>{row.planName}</td>
              <td><span className={`badge ${statusClass(row.billingMode)}`}>{row.billingMode}</span></td>
              <td>{currency(row.monthlyRate)}</td>
              <td>{row.nextInvoiceDate}</td>
              <td><span className={`badge ${statusClass(row.status)}`}>{row.status}</span></td>
              <td className="text-end">
                <button className="btn btn-sm me-1" onClick={() => onEdit(row)}><IconEdit size={14} /></button>
                <button className="btn btn-sm btn-primary me-1" onClick={() => onGenerate(row.id)}><IconFileInvoice size={14} /></button>
                <button className="btn btn-sm btn-outline-danger" onClick={() => onDelete(row.id)}><IconTrash size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvoiceTable({ rows, onEdit, onVoid, compact = false }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-responsive">
      <table className="table card-table table-vcenter">
        <thead>
          <tr>
            <th>Invoice</th>
            {!compact && <th>Customer</th>}
            <th>Due</th>
            <th>Total</th>
            <th>Balance</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.invoiceNumber}</td>
              {!compact && <td>{customerLabel(row.customer)}</td>}
              <td>{row.dueDate}</td>
              <td>{currency(row.total)}</td>
              <td>{currency(row.balance)}</td>
              <td><span className={`badge ${statusClass(row.status)}`}>{row.status.replaceAll('_', ' ')}</span></td>
              <td className="text-end">
                <button className="btn btn-sm me-1" onClick={() => onEdit(row)}><IconEdit size={14} /></button>
                <button className="btn btn-sm btn-outline-danger" onClick={() => onVoid(row.id)}><IconTrash size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaymentTable({ rows, onEdit, onVoid }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-responsive">
      <table className="table card-table table-vcenter">
        <thead>
          <tr>
            <th>Receipt</th>
            <th>Customer</th>
            <th>Invoice</th>
            <th>Method</th>
            <th>Amount</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.receiptNumber}</td>
              <td>{customerLabel(row.customer)}</td>
              <td>{row.invoiceNumber || '-'}</td>
              <td>{row.method}</td>
              <td>{currency(row.amount)}</td>
              <td><span className={`badge ${statusClass(row.status)}`}>{row.status}</span></td>
              <td className="text-end">
                <button className="btn btn-sm me-1" onClick={() => onEdit(row)}><IconEdit size={14} /></button>
                <button className="btn btn-sm btn-outline-danger" onClick={() => onVoid(row.id)}><IconTrash size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdjustmentTable({ rows, onEdit, onVoid }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-responsive">
      <table className="table card-table table-vcenter">
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Customer</th>
            <th>Type</th>
            <th>Amount</th>
            <th>Reason</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.invoiceNumber}</td>
              <td>{customerLabel(row.customer)}</td>
              <td><span className={`badge ${statusClass(row.type)}`}>{row.type}</span></td>
              <td>{currency(row.amount)}</td>
              <td>{row.reason}</td>
              <td><span className={`badge ${statusClass(row.status)}`}>{row.status}</span></td>
              <td className="text-end">
                <button className="btn btn-sm me-1" onClick={() => onEdit(row)}><IconEdit size={14} /></button>
                <button className="btn btn-sm btn-outline-danger" onClick={() => onVoid(row.id)}><IconTrash size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BalanceTable({ rows }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-responsive">
      <table className="table card-table table-vcenter">
        <thead>
          <tr>
            <th>Customer</th>
            <th>Invoiced</th>
            <th>Paid</th>
            <th>Balance</th>
            <th>Credit</th>
            <th>Overdue</th>
            <th>Open Invoices</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.customer.id}>
              <td>{customerLabel(row.customer)}</td>
              <td>{currency(row.invoicedTotal)}</td>
              <td>{currency(row.paidTotal)}</td>
              <td className={row.balance > 0 ? 'text-danger' : 'text-green'}>{currency(row.balance)}</td>
              <td>{currency(row.credit)}</td>
              <td>{currency(row.overdueTotal)}</td>
              <td>{row.openInvoices}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
