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
  IconX,
  IconUsers
} from '@tabler/icons-react';
import CustomerEmotionAvatar from '../../system-settings/web/CustomerEmotionAvatar';
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

function serviceReference(order) {
  return order?.serviceReference || order?.serviceAccount?.serviceReference || '';
}

function accountReference(account) {
  return account?.serviceReference || '';
}

function servicePlanName(order) {
  return order?.catalogName || order?.catalog?.name || 'Internet service';
}

function accountPlanName(account) {
  return account?.catalogName || account?.catalog?.name || 'Internet service';
}

function serviceCatalogCode(order) {
  return order?.catalogCode || order?.catalog?.code || '';
}

function accountCatalogCode(account) {
  return account?.catalogCode || account?.catalog?.code || '';
}

function serviceBillingMode(order) {
  return order?.catalog?.billingMode === 'POSTPAID' ? 'POSTPAID' : 'PREPAID';
}

function accountBillingMode(account) {
  return account?.catalog?.billingMode === 'POSTPAID' ? 'POSTPAID' : 'PREPAID';
}

function serviceMonthlyRate(order) {
  return Number(order?.catalog?.monthlyRate || 0);
}

function accountMonthlyRate(account) {
  return Number(account?.catalog?.monthlyRate || 0);
}

function serviceBillingStart(order) {
  return order?.billingStartDate || order?.activationDate || order?.requestedDate || today();
}

function accountBillingStart(account) {
  return account?.activationDate || today();
}

function serviceSpeedLabel(order) {
  const down = order?.catalog?.downloadMbps;
  const up = order?.catalog?.uploadMbps;
  if (!down && !up) return '';
  return `${down || 0}/${up || 0} Mbps`;
}

function accountSpeedLabel(account) {
  const down = account?.catalog?.downloadMbps;
  const up = account?.catalog?.uploadMbps;
  if (!down && !up) return '';
  return `${down || 0}/${up || 0} Mbps`;
}

function serviceOrderOptionLabel(order) {
  const ref = serviceReference(order) || order.orderNumber;
  const code = serviceCatalogCode(order);
  return `${ref} - ${servicePlanName(order)}${code ? ` (${code})` : ''} - ${customerLabel(order.customer)}`;
}

function serviceAccountOptionLabel(account) {
  const ref = accountReference(account) || account.serviceAccountNumber;
  const code = accountCatalogCode(account);
  return `${ref} - ${accountPlanName(account)}${code ? ` (${code})` : ''} - ${customerLabel(account.customer)}`;
}

function subscriptionInvoiceDescription(subscription) {
  if (!subscription) return 'Monthly internet service';
  return `${subscription.planName} monthly internet service${subscription.serviceId ? ` (${subscription.serviceId})` : ''}`;
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

function Modal({ title, icon: Icon, open, onClose, children }) {
  if (!open) return null;
  return (
    <div className="billing-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="billing-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="billing-modal-header">
          <h3 className="billing-modal-title">
            {Icon && <Icon size={18} className="me-2 text-muted" />}
            {title}
          </h3>
          <button className="btn btn-icon" type="button" onClick={onClose} aria-label="Close">
            <IconX size={18} />
          </button>
        </div>
        <div className="billing-modal-body">{children}</div>
      </div>
    </div>
  );
}

function TextField({ label, value, onChange, type = 'text', required = false, min, max, step, disabled = false }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <input className="form-control" type={type} value={value ?? ''} min={min} max={max} step={step} required={required} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function SelectField({ label, value, onChange, options, required = false, disabled = false, children }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <select className="form-select" value={value ?? ''} required={required} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {children || options.map((option) => <option key={option} value={option}>{option.replaceAll('_', ' ')}</option>)}
      </select>
    </div>
  );
}

const blankSubscription = {
  id: '',
  customerId: '',
  serviceAccountId: '',
  serviceAccountNumber: '',
  serviceOrderId: '',
  catalogId: '',
  catalogCode: '',
  catalogName: '',
  planName: 'Home Fiber 50 Mbps',
  serviceId: '',
  listMonthlyRate: '999',
  monthlyRate: '999',
  priceOverrideEnabled: false,
  priceOverrideAmount: '',
  priceOverrideReason: '',
  pricingSource: 'MANUAL',
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
  const [avatarConfig, setAvatarConfig] = useState(null);
  const [serviceOrders, setServiceOrders] = useState([]);
  const [serviceCatalog, setServiceCatalog] = useState([]);
  const [serviceAccounts, setServiceAccounts] = useState([]);
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
  const [modal, setModal] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const invoiceById = useMemo(() => new Map(invoices.map((invoice) => [invoice.id, invoice])), [invoices]);
  const subscriptionByServiceAccountId = useMemo(() => new Map(subscriptions.filter((subscription) => subscription.serviceAccountId).map((subscription) => [subscription.serviceAccountId, subscription])), [subscriptions]);
  const serviceOrderById = useMemo(() => new Map(serviceOrders.map((order) => [order.id, order])), [serviceOrders]);
  const serviceAccountById = useMemo(() => new Map(serviceAccounts.map((account) => [account.id, account])), [serviceAccounts]);
  const recurringServiceOrders = useMemo(() => serviceOrders.filter((order) => order.catalog?.billingMode !== 'ONE_TIME'), [serviceOrders]);
  const billableServiceAccounts = useMemo(() => serviceAccounts.filter((account) => account.catalog?.billingMode !== 'ONE_TIME'), [serviceAccounts]);
  const unbilledServiceAccounts = useMemo(() => billableServiceAccounts.filter((account) => !subscriptionByServiceAccountId.has(account.id)), [billableServiceAccounts, subscriptionByServiceAccountId]);
  const latestCompletedOrderByServiceAccountId = useMemo(() => {
    const byAccount = new Map();
    recurringServiceOrders.forEach((order) => {
      const accountId = order.serviceAccountId || order.serviceAccount?.id;
      if (!accountId) return;
      const existing = byAccount.get(accountId);
      if (!existing || String(order.updatedAt || order.createdAt || '') > String(existing.updatedAt || existing.createdAt || '')) {
        byAccount.set(accountId, order);
      }
    });
    return byAccount;
  }, [recurringServiceOrders]);

  async function load(search = customerSearch) {
    setError('');
    try {
      const [nextMeta, nextOverview, nextCustomers, nextServiceOrders, nextServiceCatalog, nextServiceAccounts, nextSubscriptions, nextInvoices, nextPayments, nextAdjustments, nextBalances, nextAvatarConfig] = await Promise.all([
        request('/billing/meta'),
        request('/billing/overview'),
        request(`/billing/customers?search=${encodeURIComponent(search)}`),
        request('/service/orders?activeOnly=true'),
        request('/service/catalog?status=ACTIVE'),
        request('/service/accounts?activeOnly=true'),
        request('/billing/subscriptions'),
        request('/billing/invoices'),
        request('/billing/payments'),
        request('/billing/adjustments'),
        request('/billing/balances'),
        request('/system-settings/avatars').catch(() => null)
      ]);
      setMeta(nextMeta);
      setOverview(nextOverview);
      setCustomers(nextCustomers);
      setServiceOrders(nextServiceOrders);
      setServiceCatalog(nextServiceCatalog);
      setServiceAccounts(nextServiceAccounts);
      setSubscriptions(nextSubscriptions);
      setInvoices(nextInvoices);
      setPayments(nextPayments);
      setAdjustments(nextAdjustments);
      setBalances(nextBalances);
      setAvatarConfig(nextAvatarConfig);
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
            {customerLabel(subscription.customer)} - {subscription.planName}{subscription.serviceId ? ` - ${subscription.serviceId}` : ''}
          </option>
        ))}
      </>
    );
  }

  function serviceAccountOptions() {
    return (
      <>
        <option value="">Manual / Legacy subscription</option>
        {billableServiceAccounts.map((account) => {
          const linkedSubscription = subscriptionByServiceAccountId.get(account.id);
          const isLinkedElsewhere = Boolean(linkedSubscription && linkedSubscription.id !== subscriptionForm.id);
          return (
            <option key={account.id} value={account.id} disabled={isLinkedElsewhere}>
              {serviceAccountOptionLabel(account)}{isLinkedElsewhere ? ' - already billed' : ''}
            </option>
          );
        })}
      </>
    );
  }

  function subscriptionDraftFromServiceAccount(account, base = subscriptionForm) {
    const mode = accountBillingMode(account);
    const serviceDate = accountBillingStart(account);
    const latestOrder = latestCompletedOrderByServiceAccountId.get(account.id);
    const rate = accountMonthlyRate(account);
    return {
      ...base,
      serviceAccountId: account.id,
      serviceAccountNumber: account.serviceAccountNumber || '',
      serviceOrderId: latestOrder?.id || base.serviceOrderId || '',
      customerId: account.customerId,
      catalogId: account.catalogId || account.catalog?.id || '',
      catalogCode: accountCatalogCode(account),
      catalogName: accountPlanName(account),
      planName: accountPlanName(account),
      serviceId: accountReference(account) || base.serviceId,
      listMonthlyRate: String(rate || base.listMonthlyRate || base.monthlyRate),
      monthlyRate: String(rate || base.monthlyRate),
      priceOverrideEnabled: false,
      priceOverrideAmount: '',
      priceOverrideReason: '',
      pricingSource: 'SERVICE_CATALOG',
      billingMode: mode,
      dueDays: mode === 'PREPAID' ? '0' : '7',
      startDate: serviceDate || base.startDate,
      nextInvoiceDate: serviceDate || base.nextInvoiceDate,
      notes: base.notes || `Linked to ${account.serviceAccountNumber || 'Service Account'}.`
    };
  }

  function openServiceAccountSubscription(account) {
    setSubscriptionForm(subscriptionDraftFromServiceAccount(account, blankSubscription));
    setActiveTab('Subscriptions');
    setModal('subscription');
  }

  function serviceBridgeCards() {
    const activeServiceMrr = serviceAccounts.reduce((sum, account) => {
      if (account.catalog?.billingMode === 'ONE_TIME') return sum;
      return sum + Number(account.catalog?.monthlyRate || 0);
    }, 0);
    return [
      ['Active Service Accounts', serviceAccounts.length],
      ['Recurring Catalog Plans', serviceCatalog.filter((item) => item.billingMode !== 'ONE_TIME').length],
      ['Ready For Billing', unbilledServiceAccounts.length],
      ['Service MRR Signal', currency(activeServiceMrr)]
    ].map(([label, value]) => (
      <div className="billing-service-stat" key={label}>
        <div className="billing-service-stat-value">{value}</div>
        <div className="text-muted">{label}</div>
      </div>
    ));
  }

  function selectedInvoiceSubscription(subscriptionId) {
    return subscriptions.find((item) => item.id === subscriptionId);
  }

  function invoiceDraftForSubscription(subscriptionId) {
    const subscription = selectedInvoiceSubscription(subscriptionId);
    return {
      ...invoiceForm,
      subscriptionId,
      customerId: subscription?.customerId || invoiceForm.customerId,
      amount: subscription ? String(subscription.monthlyRate) : invoiceForm.amount,
      description: subscription ? subscriptionInvoiceDescription(subscription) : invoiceForm.description
    };
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

  function closeModal() {
    setModal(null);
  }

  function openSubscriptionForm(subscription = null) {
    setSubscriptionForm(subscription ? {
      ...blankSubscription,
      ...subscription,
      listMonthlyRate: String(subscription.listMonthlyRate ?? subscription.monthlyRate),
      monthlyRate: String(subscription.monthlyRate),
      billingDay: String(subscription.billingDay),
      dueDays: String(subscription.dueDays),
      priceOverrideEnabled: subscription.pricingSource === 'PRICE_OVERRIDE',
      priceOverrideAmount: subscription.priceOverrideAmount != null ? String(subscription.priceOverrideAmount) : '',
      priceOverrideReason: subscription.priceOverrideReason || ''
    } : blankSubscription);
    setModal('subscription');
  }

  function setSubscriptionServiceAccount(serviceAccountId) {
    const account = serviceAccounts.find((item) => item.id === serviceAccountId);
    if (!account) {
      setSubscriptionForm({
        ...blankSubscription,
        startDate: subscriptionForm.startDate,
        nextInvoiceDate: subscriptionForm.nextInvoiceDate,
        notes: subscriptionForm.notes
      });
      return;
    }
    setSubscriptionForm(subscriptionDraftFromServiceAccount(account));
  }

  function openInvoiceForm(invoice = null) {
    if (!invoice) {
      setInvoiceForm(blankInvoice);
      setModal('invoice');
      return;
    }
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
    setModal('invoice');
  }

  function openPaymentForm(payment = null) {
    setPaymentForm(payment ? {
      ...blankPayment,
      ...payment,
      amount: String(payment.amount)
    } : blankPayment);
    setModal('payment');
  }

  function openAdjustmentForm(adjustment = null) {
    setAdjustmentForm(adjustment ? {
      ...blankAdjustment,
      ...adjustment,
      amount: String(adjustment.amount)
    } : blankAdjustment);
    setModal('adjustment');
  }

  async function submitSubscription(e) {
    e.preventDefault();
    const linkedToService = Boolean(subscriptionForm.serviceAccountId);
    const usesOverride = linkedToService && subscriptionForm.priceOverrideEnabled;
    const effectiveRate = usesOverride ? subscriptionForm.priceOverrideAmount : (linkedToService ? subscriptionForm.listMonthlyRate : subscriptionForm.monthlyRate);
    const body = {
      ...subscriptionForm,
      monthlyRate: Number(effectiveRate || 0),
      listMonthlyRate: Number(linkedToService ? subscriptionForm.listMonthlyRate : effectiveRate || 0),
      priceOverrideAmount: usesOverride ? Number(subscriptionForm.priceOverrideAmount || 0) : null,
      priceOverrideReason: usesOverride ? subscriptionForm.priceOverrideReason : '',
      pricingSource: linkedToService ? (usesOverride ? 'PRICE_OVERRIDE' : 'SERVICE_CATALOG') : 'MANUAL',
      billingDay: Number(subscriptionForm.billingDay),
      dueDays: Number(subscriptionForm.dueDays)
    };
    delete body.priceOverrideEnabled;
    const path = subscriptionForm.id ? `/billing/subscriptions/${subscriptionForm.id}` : '/billing/subscriptions';
    await request(path, { method: subscriptionForm.id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    setSubscriptionForm(blankSubscription);
    closeModal();
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
    closeModal();
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
    closeModal();
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
    closeModal();
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
    openInvoiceForm(invoice);
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

  const selectedServiceAccount = serviceAccounts.find((account) => account.id === subscriptionForm.serviceAccountId);
  const linkedSubscriptionForm = Boolean(subscriptionForm.serviceAccountId);
  const editingSubscription = Boolean(subscriptionForm.id);
  const lockSubscriptionCustomer = editingSubscription || linkedSubscriptionForm;

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
          <div className="col-12">
            <Card
              title="Service To Billing"
              icon={IconRepeat}
              actions={<button className="btn btn-sm" type="button" onClick={() => setActiveTab('Subscriptions')}>Review Accounts</button>}
            >
              <div className="billing-service-grid">{serviceBridgeCards()}</div>
              <ServiceAccountBillingTable
                rows={unbilledServiceAccounts.slice(0, 5)}
                subscriptionByServiceAccountId={subscriptionByServiceAccountId}
                onCreateSubscription={openServiceAccountSubscription}
                avatarConfig={avatarConfig}
                compact
              />
            </Card>
          </div>
          <div className="col-lg-7">
            <Card title="Recent Invoices" icon={IconFileInvoice}>
              <InvoiceTable rows={overview.recentInvoices || []} onEdit={editInvoice} onVoid={voidInvoice} avatarConfig={avatarConfig} compact />
            </Card>
          </div>
          <div className="col-lg-5">
            <Card title="Collection Risk" icon={IconReceipt}>
              <InvoiceTable rows={overview.atRisk || []} onEdit={editInvoice} onVoid={voidInvoice} avatarConfig={avatarConfig} compact />
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Subscriptions' && (
        <div className="row row-cards">
          <div className="col-12">
            <Card title="Service Accounts Ready For Billing" icon={IconReceipt}>
              <ServiceAccountBillingTable
                rows={billableServiceAccounts}
                subscriptionByServiceAccountId={subscriptionByServiceAccountId}
                onCreateSubscription={openServiceAccountSubscription}
                avatarConfig={avatarConfig}
              />
            </Card>
          </div>
          <div className="col-12">
            <Card
              title="Subscriptions"
              icon={IconRepeat}
              actions={<button className="btn btn-primary btn-sm" type="button" onClick={() => openSubscriptionForm()}><IconPlus size={16} className="me-1" />New Subscription</button>}
            >
              <SubscriptionTable
                rows={subscriptions}
                avatarConfig={avatarConfig}
                serviceOrderById={serviceOrderById}
                serviceAccountById={serviceAccountById}
                onEdit={openSubscriptionForm}
                onGenerate={generateInvoice}
                onDelete={deleteSubscription}
              />
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Invoices' && (
        <div className="row row-cards">
          <div className="col-12">
            <Card
              title="Invoices"
              icon={IconFileInvoice}
              actions={<button className="btn btn-primary btn-sm" type="button" onClick={() => openInvoiceForm()}><IconPlus size={16} className="me-1" />New Invoice</button>}
            >
              <InvoiceTable rows={invoices} onEdit={editInvoice} onVoid={voidInvoice} avatarConfig={avatarConfig} />
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Payments' && (
        <div className="row row-cards">
          <div className="col-12">
            <Card
              title="Payments"
              icon={IconReceipt}
              actions={<button className="btn btn-primary btn-sm" type="button" onClick={() => openPaymentForm()}><IconPlus size={16} className="me-1" />Post Payment</button>}
            >
              <PaymentTable
                rows={payments}
                onEdit={openPaymentForm}
                onVoid={voidPayment}
              />
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Adjustments' && (
        <div className="row row-cards">
          <div className="col-12">
            <Card
              title="Adjustments"
              icon={IconPlus}
              actions={<button className="btn btn-primary btn-sm" type="button" onClick={() => openAdjustmentForm()}><IconPlus size={16} className="me-1" />Post Adjustment</button>}
            >
              <AdjustmentTable
                rows={adjustments}
                onEdit={openAdjustmentForm}
                onVoid={voidAdjustment}
              />
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Balances' && (
        <Card title="Customer Balances" icon={IconUsers}>
          <BalanceTable rows={balances} avatarConfig={avatarConfig} />
        </Card>
      )}

      <Modal title={subscriptionForm.id ? 'Edit Subscription' : 'New Subscription'} icon={IconRepeat} open={modal === 'subscription'} onClose={closeModal}>
        <form className="billing-form" onSubmit={submitSubscription}>
          {!editingSubscription && <SelectField label="Service Account" value={subscriptionForm.serviceAccountId} onChange={setSubscriptionServiceAccount}>{serviceAccountOptions()}</SelectField>}
          {selectedServiceAccount && <ServiceAccountDetail account={selectedServiceAccount} subscriptionForm={subscriptionForm} />}
          <SelectField label="Customer" value={subscriptionForm.customerId} required disabled={lockSubscriptionCustomer} onChange={(customerId) => setSubscriptionForm({ ...subscriptionForm, customerId })}>{customerOptions()}</SelectField>
          <TextField label="Plan Name" value={subscriptionForm.planName} required disabled={linkedSubscriptionForm} onChange={(planName) => setSubscriptionForm({ ...subscriptionForm, planName })} />
          <TextField label="Service ID" value={subscriptionForm.serviceId} disabled={linkedSubscriptionForm} onChange={(serviceId) => setSubscriptionForm({ ...subscriptionForm, serviceId })} />
          {linkedSubscriptionForm ? (
            <>
              <TextField label="Catalog Monthly Rate" type="number" min="0" step="0.01" value={subscriptionForm.listMonthlyRate} required disabled onChange={() => {}} />
              <label className="billing-check-row">
                <input type="checkbox" checked={subscriptionForm.priceOverrideEnabled} onChange={(event) => setSubscriptionForm({
                  ...subscriptionForm,
                  priceOverrideEnabled: event.target.checked,
                  priceOverrideAmount: event.target.checked ? (subscriptionForm.priceOverrideAmount || subscriptionForm.monthlyRate || subscriptionForm.listMonthlyRate) : '',
                  priceOverrideReason: event.target.checked ? subscriptionForm.priceOverrideReason : ''
                })} />
                <span>Use approved price override</span>
              </label>
              {subscriptionForm.priceOverrideEnabled && (
                <div className="billing-two-cols">
                  <TextField label="Override Monthly Rate" type="number" min="0" step="0.01" value={subscriptionForm.priceOverrideAmount} required onChange={(priceOverrideAmount) => setSubscriptionForm({ ...subscriptionForm, priceOverrideAmount, monthlyRate: priceOverrideAmount })} />
                  <TextField label="Override Reason" value={subscriptionForm.priceOverrideReason} required onChange={(priceOverrideReason) => setSubscriptionForm({ ...subscriptionForm, priceOverrideReason })} />
                </div>
              )}
            </>
          ) : (
            <TextField label="Monthly Rate" type="number" min="0" step="0.01" value={subscriptionForm.monthlyRate} required onChange={(monthlyRate) => setSubscriptionForm({ ...subscriptionForm, monthlyRate, listMonthlyRate: monthlyRate })} />
          )}
          <SelectField label="Billing Mode" value={subscriptionForm.billingMode} options={meta.billingModes || ['PREPAID', 'POSTPAID']} disabled={linkedSubscriptionForm} onChange={(billingMode) => setSubscriptionForm({ ...subscriptionForm, billingMode, dueDays: billingMode === 'PREPAID' ? '0' : '7' })} />
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
            <button className="btn" type="button" onClick={closeModal}>Cancel</button>
            <button className="btn btn-primary"><IconDeviceFloppy size={16} className="me-1" />Save</button>
          </div>
        </form>
      </Modal>

      <Modal title={invoiceForm.id ? 'Edit Invoice' : 'New Invoice'} icon={IconFileInvoice} open={modal === 'invoice'} onClose={closeModal}>
        <form className="billing-form" onSubmit={submitInvoice}>
          <SelectField label="Subscription" value={invoiceForm.subscriptionId} onChange={(subscriptionId) => setInvoiceForm(invoiceDraftForSubscription(subscriptionId))}>{subscriptionOptions()}</SelectField>
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
            <button className="btn" type="button" onClick={closeModal}>Cancel</button>
            <button className="btn btn-primary"><IconDeviceFloppy size={16} className="me-1" />Save</button>
          </div>
        </form>
      </Modal>

      <Modal title={paymentForm.id ? 'Edit Payment' : 'Post Payment'} icon={IconCreditCard} open={modal === 'payment'} onClose={closeModal}>
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
            <button className="btn" type="button" onClick={closeModal}>Cancel</button>
            <button className="btn btn-primary"><IconDeviceFloppy size={16} className="me-1" />Save</button>
          </div>
        </form>
      </Modal>

      <Modal title={adjustmentForm.id ? 'Edit Adjustment' : 'Post Adjustment'} icon={IconPlus} open={modal === 'adjustment'} onClose={closeModal}>
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
            <button className="btn" type="button" onClick={closeModal}>Cancel</button>
            <button className="btn btn-primary"><IconDeviceFloppy size={16} className="me-1" />Save</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function Empty() {
  return <div className="empty">No records yet.</div>;
}

function ServiceAccountDetail({ account, subscriptionForm }) {
  const effectiveRate = subscriptionForm.priceOverrideEnabled ? subscriptionForm.priceOverrideAmount : subscriptionForm.listMonthlyRate;
  return (
    <div className="billing-service-detail">
      <div className="billing-service-detail-title">{account.serviceAccountNumber || 'Service Account'} controls this subscription's catalog plan and standard price.</div>
      <div className="billing-service-pairs">
        <div>
          <span>Customer</span>
          <strong>{customerLabel(account.customer)}</strong>
        </div>
        <div>
          <span>Catalog Plan</span>
          <strong>{accountPlanName(account)}</strong>
        </div>
        <div>
          <span>Service Ref</span>
          <strong>{accountReference(account) || '-'}</strong>
        </div>
        <div>
          <span>Billing Mode</span>
          <strong>{accountBillingMode(account)}</strong>
        </div>
        <div>
          <span>Billing Start</span>
          <strong>{accountBillingStart(account)}</strong>
        </div>
        <div>
          <span>Effective Rate</span>
          <strong>{currency(effectiveRate || accountMonthlyRate(account))}</strong>
        </div>
      </div>
    </div>
  );
}

function ServiceAccountBillingTable({ rows, subscriptionByServiceAccountId, onCreateSubscription, avatarConfig, compact = false }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-responsive billing-service-orders">
      <table className="table card-table table-vcenter">
        <thead>
          <tr>
            <th>Service Account</th>
            {!compact && <th>Customer</th>}
            <th>Catalog</th>
            <th>Billing</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const linkedSubscription = subscriptionByServiceAccountId.get(row.id);
            return (
              <tr key={row.id}>
                <td>
                  <div className="billing-service-main">{row.serviceAccountNumber || '-'}</div>
                  <div className="text-muted small">{accountReference(row) || '-'}</div>
                </td>
                {!compact && (
                  <td>
                    <div className="d-flex align-items-center gap-2">
                      <CustomerEmotionAvatar customer={row.customer} avatarConfig={avatarConfig} context={{ serviceAccount: row }} size={32} />
                      <span>{customerLabel(row.customer)}</span>
                    </div>
                  </td>
                )}
                <td>
                  <div>{accountPlanName(row)}</div>
                  <div className="text-muted small">{[accountCatalogCode(row), accountSpeedLabel(row)].filter(Boolean).join(' - ') || '-'}</div>
                </td>
                <td>
                  <span className={`badge ${statusClass(accountBillingMode(row))}`}>{accountBillingMode(row)}</span>
                  <div className="text-muted small">{currency(accountMonthlyRate(row))} from {accountBillingStart(row)}</div>
                </td>
                <td>
                  <span className={`badge ${statusClass(linkedSubscription ? 'active' : 'pending')}`}>{linkedSubscription ? 'Linked' : 'Ready'}</span>
                  {linkedSubscription && <div className="text-muted small">{linkedSubscription.planName}</div>}
                </td>
                <td className="text-end">
                  <button className="btn btn-sm btn-primary" type="button" disabled={Boolean(linkedSubscription)} onClick={() => onCreateSubscription(row)}>
                    {linkedSubscription ? 'Billed' : 'Start Billing'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SubscriptionServiceCell({ subscription, serviceOrder, serviceAccount }) {
  const ref = subscription.serviceId || accountReference(serviceAccount) || serviceReference(serviceOrder);
  if (!ref && !serviceOrder && !serviceAccount) return '-';
  return (
    <div>
      <div className="billing-service-main">{ref || '-'}</div>
      {serviceAccount && <div className="text-muted small">{serviceAccount.serviceAccountNumber} - {accountPlanName(serviceAccount)}</div>}
      {serviceOrder && <div className="text-muted small">{serviceOrder.orderNumber} - {servicePlanName(serviceOrder)}</div>}
      {subscription.pricingSource === 'PRICE_OVERRIDE' && <div className="text-muted small">Override: {currency(subscription.priceOverrideAmount)}</div>}
    </div>
  );
}

function InvoiceServiceCell({ invoice }) {
  const ref = invoice.serviceId || invoice.subscription?.serviceId || '';
  const serviceAccountNumber = invoice.serviceAccountNumber || invoice.subscription?.serviceAccountNumber || '';
  const orderId = invoice.serviceOrderId || invoice.subscription?.serviceOrderId || '';
  if (!ref && !serviceAccountNumber && !orderId) return '-';
  return (
    <div>
      <div className="billing-service-main">{ref || '-'}</div>
      {(serviceAccountNumber || orderId) && <div className="text-muted small">{serviceAccountNumber || `Order ${orderId}`}</div>}
    </div>
  );
}

function SubscriptionTable({ rows, avatarConfig, serviceOrderById, serviceAccountById, onEdit, onGenerate, onDelete }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-responsive">
      <table className="table card-table table-vcenter">
        <thead>
          <tr>
            <th>Customer</th>
            <th>Plan</th>
            <th>Service Ref</th>
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
              <td>
                <div className="d-flex align-items-center gap-2">
                  <CustomerEmotionAvatar customer={row.customer} avatarConfig={avatarConfig} context={{ billing: row }} size={32} />
                  <span>{customerLabel(row.customer)}</span>
                </div>
              </td>
              <td>{row.planName}</td>
              <td><SubscriptionServiceCell subscription={row} serviceOrder={serviceOrderById?.get(row.serviceOrderId)} serviceAccount={serviceAccountById?.get(row.serviceAccountId)} /></td>
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

function InvoiceTable({ rows, onEdit, onVoid, avatarConfig, compact = false }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-responsive">
      <table className="table card-table table-vcenter">
        <thead>
          <tr>
            <th>Invoice</th>
            {!compact && <th>Customer</th>}
            {!compact && <th>Service</th>}
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
              <td>
                <div className="d-flex align-items-center gap-2">
                  {compact && <CustomerEmotionAvatar customer={row.customer} avatarConfig={avatarConfig} context={{ invoice: row }} size={30} />}
                  <span>{row.invoiceNumber}</span>
                </div>
              </td>
              {!compact && (
                <td>
                  <div className="d-flex align-items-center gap-2">
                    <CustomerEmotionAvatar customer={row.customer} avatarConfig={avatarConfig} context={{ invoice: row }} size={32} />
                    <span>{customerLabel(row.customer)}</span>
                  </div>
                </td>
              )}
              {!compact && <td><InvoiceServiceCell invoice={row} /></td>}
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

function BalanceTable({ rows, avatarConfig }) {
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
              <td>
                <div className="d-flex align-items-center gap-2">
                  <CustomerEmotionAvatar customer={row.customer} avatarConfig={avatarConfig} context={{ balance: row }} size={34} showLabel />
                  <span>{customerLabel(row.customer)}</span>
                </div>
              </td>
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
