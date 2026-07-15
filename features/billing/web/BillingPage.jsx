import React, { useEffect, useMemo, useState } from 'react';
import {
  IconCash,
  IconCreditCard,
  IconDeviceFloppy,
  IconDiscount2,
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
const DEFAULT_INSTALLATION_FEE = '1500';
const DEFAULT_EARLY_BIRD_DISCOUNT = '200';
const MONTHLY_INVOICE_TYPES = new Set(['MONTHLY', 'FIRST_PRORATED', 'FIRST_FULL']);

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

function newIdempotencyKey(scope) {
  const randomValue = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${scope}:${randomValue}`;
}

function dateFromIso(value) {
  const [year, month, day] = String(value || today()).split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function isoFromDate(value) {
  return value.toISOString().slice(0, 10);
}

function monthEndDate(value) {
  const source = dateFromIso(value);
  if (!source) return null;
  return new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + 1, 0));
}

function nextMonthStartDate(value) {
  const source = dateFromIso(value);
  if (!source) return null;
  return new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + 1, 1));
}

function addDays(value, days) {
  const next = new Date(value.getTime());
  next.setUTCDate(next.getUTCDate() + Number(days || 0));
  return next;
}

function inclusiveDays(start, end) {
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

function formatDate(value) {
  const date = typeof value === 'string' ? dateFromIso(value) : value;
  if (!date) return '-';
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function formatMonth(value) {
  if (!value) return '-';
  const source = String(value).length === 7 ? `${value}-01` : value;
  const date = dateFromIso(source);
  if (!date) return '-';
  return new Intl.DateTimeFormat('en-PH', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function formatMonthShort(value) {
  const source = String(value || '').length === 7 ? `${value}-01` : value;
  const date = dateFromIso(source);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-PH', { month: 'short', timeZone: 'UTC' }).format(date);
}

function currency(value) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0));
}

function statusClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (['active', 'paid', 'posted'].includes(normalized)) return 'bg-green-lt text-green';
  if (['waived', 'no_fee'].includes(normalized)) return 'bg-green-lt text-green';
  if (['issued', 'partially_paid', 'pending', 'draft', 'invoiced', 'scheduled', 'paused'].includes(normalized)) return 'bg-yellow-lt text-yellow';
  if (['overdue', 'void', 'cancelled', 'expired', 'archived'].includes(normalized)) return 'bg-red-lt text-red';
  if (['prepaid'].includes(normalized)) return 'bg-cyan-lt text-cyan';
  if (['postpaid'].includes(normalized)) return 'bg-indigo-lt text-indigo';
  return 'bg-blue-lt text-blue';
}

function customerLabel(customer) {
  if (!customer) return '-';
  const firstLast = [customer.firstName, customer.lastName].map((part) => String(part || '').trim()).filter(Boolean).join(' ');
  return firstLast || customer.fullName || customer.name || 'Unnamed customer';
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

function installationFeeDecisionLabel(status) {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'INVOICED') return 'Charge installation fee';
  if (normalized === 'WAIVED') return 'Waive installation fee';
  if (normalized === 'NO_FEE') return 'No installation fee';
  if (normalized === 'VOID') return 'Voided';
  return 'Pending decision';
}

function invoiceTypeLabel(type) {
  const normalized = String(type || '').toUpperCase();
  if (normalized === 'FIRST_PRORATED') return 'First prorated service';
  if (normalized === 'FIRST_FULL') return 'First full service';
  if (normalized === 'MONTHLY') return 'Monthly service';
  if (normalized === 'INSTALLATION_FEE') return 'Installation fee';
  if (normalized === 'MANUAL') return 'Manual invoice';
  return '';
}

function promotionScopeLabel(scope) {
  const normalized = String(scope || '').toUpperCase();
  if (normalized === 'MONTHLY_SERVICE') return 'Monthly service';
  if (normalized === 'INSTALLATION_FEE') return 'Installation fee';
  return normalized.replaceAll('_', ' ') || '-';
}

function promotionDiscountLabel(promotion) {
  const type = String(promotion?.discountType || '').toUpperCase();
  if (type === 'WAIVE') return 'Waive full amount';
  if (type === 'PERCENT') return `${Number(promotion?.discountPercent || 0)}% off`;
  return `${currency(promotion?.discountAmount || 0)} off`;
}

function promotionPaymentRule(promotion) {
  const rule = String(promotion?.paymentRule || '').toUpperCase();
  return ['ANY_PAYMENT', 'EARLY_BIRD'].includes(rule) ? rule : 'ANY_PAYMENT';
}

function promotionPaymentRuleLabel(rule) {
  const normalized = String(rule || '').toUpperCase();
  if (normalized === 'EARLY_BIRD') return 'Early Bird payment window';
  if (normalized === 'ANY_PAYMENT') return 'Any invoice type';
  return normalized.replaceAll('_', ' ') || '-';
}

function promotionStatus(promotion) {
  return promotion?.effectiveStatus || promotion?.status || 'DRAFT';
}

function promotionActiveNow(promotion) {
  return promotion?.activeNow || promotionStatus(promotion) === 'ACTIVE';
}

function promotionDiscountAmount(promotion, baseAmount) {
  const amount = Number(baseAmount || 0);
  const type = String(promotion?.discountType || '').toUpperCase();
  if (type === 'WAIVE') return amount;
  if (type === 'PERCENT') return Math.round((amount * Number(promotion?.discountPercent || 0) / 100) * 100) / 100;
  return Math.min(amount, Number(promotion?.discountAmount || 0));
}

function promotionEligibilityLabel(promotion, customerById = new Map(), serviceCatalogById = new Map()) {
  const parts = [];
  if (promotion.billingMode) parts.push(promotion.billingMode);
  if (promotion.catalogId) {
    const plan = serviceCatalogById.get(promotion.catalogId);
    parts.push(plan ? `${plan.code ? `${plan.code} - ` : ''}${plan.name}` : 'Plan-specific');
  }
  if (promotion.customerId) {
    const customer = customerById.get(promotion.customerId);
    parts.push(customer ? customerLabel(customer) : 'Customer-specific');
  }
  return parts.join(' / ') || 'All eligible accounts';
}

function earlyBirdInvoiceNote(invoice) {
  if (!invoice?.earlyBirdEligible) return '';
  const promo = invoice.earlyBirdPromotionCode ? `${invoice.earlyBirdPromotionCode} ` : '';
  if (invoice.earlyBirdDiscountApplied) return `${promo}early bird discount applied: ${currency(invoice.earlyBirdDiscountAppliedAmount)}`;
  if (invoice.earlyBirdAvailableNow) return `${promo}early bird payable: ${currency(invoice.earlyBirdPayableBalance)} until ${formatDate(invoice.earlyBirdAvailableUntil)}`;
  if (invoice.earlyBirdAvailableUntil) return `Early bird expired after ${formatDate(invoice.earlyBirdAvailableUntil)}`;
  return '';
}

function isMonthlyUnpaidInvoice(invoice) {
  return MONTHLY_INVOICE_TYPES.has(String(invoice?.invoiceType || '').toUpperCase())
    && !['PAID', 'VOID', 'DRAFT'].includes(String(invoice?.status || '').toUpperCase())
    && Number(invoice?.balance || 0) > 0;
}

function invoiceMonthKey(invoice) {
  const source = invoice?.billingCycleStart || invoice?.issueDate || '';
  return String(source).slice(0, 7);
}

function unpaidMonthSummary(rows) {
  const unpaidRows = rows.filter(isMonthlyUnpaidInvoice);
  const months = [...new Set(unpaidRows.map(invoiceMonthKey).filter(Boolean))].sort();
  return {
    unpaidMonths: months.length,
    unpaidMonthlyInvoices: unpaidRows.length,
    unpaidMonthKeys: months,
    oldestUnpaidMonth: months[0] || '',
    newestUnpaidMonth: months[months.length - 1] || '',
    unpaidMonthlyBalance: unpaidRows.reduce((sum, invoice) => sum + Number(invoice.balance || 0), 0)
  };
}

function isNextMonthKey(previous, current) {
  const previousDate = dateFromIso(`${previous}-01`);
  const currentDate = dateFromIso(`${current}-01`);
  if (!previousDate || !currentDate) return false;
  const expectedYear = previousDate.getUTCMonth() === 11 ? previousDate.getUTCFullYear() + 1 : previousDate.getUTCFullYear();
  const expectedMonth = (previousDate.getUTCMonth() + 1) % 12;
  return currentDate.getUTCFullYear() === expectedYear && currentDate.getUTCMonth() === expectedMonth;
}

function formatMonthSpan(startKey, endKey) {
  if (!startKey || !endKey || startKey === endKey) return formatMonth(startKey);
  const startDate = dateFromIso(`${startKey}-01`);
  const endDate = dateFromIso(`${endKey}-01`);
  if (!startDate || !endDate) return formatMonth(startKey);
  const startMonth = formatMonthShort(startKey);
  const endMonth = formatMonthShort(endKey);
  if (startDate.getUTCFullYear() === endDate.getUTCFullYear()) {
    return `${startMonth}-${endMonth} ${endDate.getUTCFullYear()}`;
  }
  return `${startMonth} ${startDate.getUTCFullYear()}-${endMonth} ${endDate.getUTCFullYear()}`;
}

function formatCompactMonthRange(monthKeys) {
  const months = [...new Set((monthKeys || []).filter(Boolean))].sort();
  if (!months.length) return '-';
  const ranges = [];
  let rangeStart = months[0];
  let previous = months[0];
  months.slice(1).forEach((monthKey) => {
    if (isNextMonthKey(previous, monthKey)) {
      previous = monthKey;
      return;
    }
    ranges.push(formatMonthSpan(rangeStart, previous));
    rangeStart = monthKey;
    previous = monthKey;
  });
  ranges.push(formatMonthSpan(rangeStart, previous));
  return ranges.join(', ');
}

function monthlyAgingLine(label, count, unit, monthKeys) {
  if (!count) return '';
  return `${label} ${count} ${unit}: ${formatCompactMonthRange(monthKeys)}`;
}

function agingMonthKeys(summary, listKey, oldestKey, newestKey) {
  const list = summary?.[listKey];
  if (Array.isArray(list) && list.length) return list;
  return [summary?.[oldestKey], summary?.[newestKey]].filter((value, index, rows) => value && rows.indexOf(value) === index);
}

function installationChargeResolved(charge) {
  return ['INVOICED', 'WAIVED', 'NO_FEE'].includes(String(charge?.status || '').toUpperCase());
}

function defaultInstallationFeeAmount(account) {
  const fee = Number(account?.catalog?.installFee || account?.installFee || 0);
  return fee > 0 ? String(fee) : DEFAULT_INSTALLATION_FEE;
}

function subscriptionEffectiveRate(subscription) {
  if (subscription.serviceAccountId && subscription.priceOverrideEnabled) return Number(subscription.priceOverrideAmount || 0);
  if (subscription.serviceAccountId) return Number(subscription.listMonthlyRate || subscription.monthlyRate || 0);
  return Number(subscription.monthlyRate || 0);
}

function firstSubscriptionInvoicePreview(subscription) {
  if (!['PREPAID', 'POSTPAID'].includes(subscription.billingMode) || !subscription.startDate) return null;
  const cycleStart = dateFromIso(subscription.startDate);
  const cycleEnd = monthEndDate(subscription.startDate);
  const nextFullCycleStart = nextMonthStartDate(subscription.startDate);
  if (!cycleStart || !cycleEnd || !nextFullCycleStart) return null;
  const serviceDays = inclusiveDays(cycleStart, cycleEnd);
  const daysInCycle = cycleEnd.getUTCDate();
  const monthlyRate = subscriptionEffectiveRate(subscription);
  const isProrated = serviceDays < daysInCycle;
  const firstInvoiceAmount = isProrated ? Math.ceil(monthlyRate * serviceDays / daysInCycle) : monthlyRate;
  const nextFullCycleEnd = monthEndDate(isoFromDate(nextFullCycleStart));
  const earlyBirdQualified = Boolean(subscription.earlyBirdEligible && subscription.earlyBirdPromotionId);
  const earlyBirdDiscount = earlyBirdQualified ? Number(subscription.earlyBirdDiscountAmount || 0) : 0;
  const earlyBirdPayableAmount = Math.max(0, monthlyRate - earlyBirdDiscount);
  const earlyBirdAvailableUntil = subscription.billingMode === 'PREPAID'
    ? addDays(nextFullCycleStart, -1)
    : addDays(nextFullCycleEnd || cycleEnd, subscription.dueDays || 0);
  return {
    billingMode: subscription.billingMode,
    cycleStart: isoFromDate(cycleStart),
    cycleEnd: isoFromDate(cycleEnd),
    serviceDays,
    daysInCycle,
    isProrated,
    monthlyRate,
    firstInvoiceAmount,
    issueDate: subscription.billingMode === 'PREPAID' ? isoFromDate(cycleStart) : isoFromDate(cycleEnd),
    dueDate: subscription.billingMode === 'PREPAID' ? isoFromDate(cycleStart) : isoFromDate(addDays(cycleEnd, subscription.dueDays || 0)),
    nextFullCycleStart: isoFromDate(nextFullCycleStart),
    nextFullCycleEnd: nextFullCycleEnd ? isoFromDate(nextFullCycleEnd) : '',
    earlyBirdEligible: earlyBirdQualified,
    earlyBirdDiscount,
    earlyBirdPayableAmount,
    earlyBirdAvailableUntil: isoFromDate(earlyBirdAvailableUntil),
  };
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
  earlyBirdEligible: false,
  earlyBirdPromotionId: '',
  earlyBirdPromotionCode: '',
  earlyBirdPromotionName: '',
  earlyBirdDiscountAmount: '',
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

const blankAdjustment = {
  id: '',
  invoiceId: '',
  type: 'CREDIT',
  amount: '',
  reason: 'Service credit',
  status: 'POSTED',
  notes: ''
};

const blankInstallationCharge = {
  id: '',
  customerId: '',
  serviceAccountId: '',
  serviceAccountNumber: '',
  serviceOrderId: '',
  serviceId: '',
  catalogId: '',
  catalogCode: '',
  catalogName: '',
  billingMode: '',
  status: 'INVOICED',
  standardAmount: '',
  chargedAmount: '',
  waiverReason: '',
  promoCode: '',
  promotionId: '',
  promotionCode: '',
  promotionName: '',
  issueDate: today(),
  dueDate: today(),
  notes: ''
};

const blankPromotion = {
  id: '',
  name: '',
  promoCode: '',
  description: '',
  appliesTo: 'MONTHLY_SERVICE',
  discountType: 'FIXED_AMOUNT',
  discountAmount: DEFAULT_EARLY_BIRD_DISCOUNT,
  discountPercent: '',
  startDate: today(),
  endDate: '',
  status: 'ACTIVE',
  billingMode: '',
  customerId: '',
  catalogId: '',
  paymentRule: 'ANY_PAYMENT',
  priority: '100',
  requiresApproval: false,
  stackable: false,
  notes: ''
};

export default function BillingPage({ refreshShell = () => {} }) {
  const [activeTab, setActiveTab] = useState('Overview');
  const [meta, setMeta] = useState({ billingModes: [], subscriptionStatuses: [], invoiceStatuses: [], paymentMethods: [], paymentStatuses: [], adjustmentTypes: [], adjustmentStatuses: [], installationChargeStatuses: [], promotionStatuses: [], promotionScopes: [], promotionDiscountTypes: [], promotionPaymentRules: [] });
  const [overview, setOverview] = useState({ metrics: {}, recentInvoices: [], recentPayments: [], atRisk: [] });
  const [customers, setCustomers] = useState([]);
  const [avatarConfig, setAvatarConfig] = useState(null);
  const [serviceOrders, setServiceOrders] = useState([]);
  const [serviceCatalog, setServiceCatalog] = useState([]);
  const [serviceAccounts, setServiceAccounts] = useState([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [subscriptionSearch, setSubscriptionSearch] = useState('');
  const [promotionSearch, setPromotionSearch] = useState('');
  const [promotionStatusFilter, setPromotionStatusFilter] = useState('');
  const [promotionScopeFilter, setPromotionScopeFilter] = useState('');
  const [subscriptions, setSubscriptions] = useState([]);
  const [installationCharges, setInstallationCharges] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [balances, setBalances] = useState([]);
  const [subscriptionForm, setSubscriptionForm] = useState(blankSubscription);
  const [installationChargeForm, setInstallationChargeForm] = useState(blankInstallationCharge);
  const [promotionForm, setPromotionForm] = useState(blankPromotion);
  const [invoiceForm, setInvoiceForm] = useState(blankInvoice);
  const [adjustmentForm, setAdjustmentForm] = useState(blankAdjustment);
  const [invoiceIdempotencyKey, setInvoiceIdempotencyKey] = useState(() => newIdempotencyKey('billing-invoice'));
  const [adjustmentIdempotencyKey, setAdjustmentIdempotencyKey] = useState(() => newIdempotencyKey('billing-adjustment'));
  const [modal, setModal] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const notification = error ? { type: 'error', text: error } : (message ? { type: 'success', text: message } : null);

  const subscriptionByServiceAccountId = useMemo(() => new Map(subscriptions.filter((subscription) => subscription.serviceAccountId).map((subscription) => [subscription.serviceAccountId, subscription])), [subscriptions]);
  const installationChargeByServiceAccountId = useMemo(() => new Map(installationCharges.filter((charge) => charge.serviceAccountId && charge.status !== 'VOID').map((charge) => [charge.serviceAccountId, charge])), [installationCharges]);
  const customerById = useMemo(() => new Map(customers.map((customer) => [customer.id, customer])), [customers]);
  const serviceCatalogById = useMemo(() => new Map(serviceCatalog.map((item) => [item.id, item])), [serviceCatalog]);
  const serviceAccountById = useMemo(() => new Map(serviceAccounts.map((account) => [account.id, account])), [serviceAccounts]);
  const recurringServiceOrders = useMemo(() => serviceOrders.filter((order) => order.catalog?.billingMode !== 'ONE_TIME'), [serviceOrders]);
  const billableServiceAccounts = useMemo(() => serviceAccounts.filter((account) => account.catalog?.billingMode !== 'ONE_TIME'), [serviceAccounts]);
  const unbilledServiceAccounts = useMemo(() => billableServiceAccounts.filter((account) => !subscriptionByServiceAccountId.has(account.id)), [billableServiceAccounts, subscriptionByServiceAccountId]);
  const installationFeePendingAccounts = useMemo(() => unbilledServiceAccounts.filter((account) => !installationChargeResolved(installationChargeByServiceAccountId.get(account.id))), [unbilledServiceAccounts, installationChargeByServiceAccountId]);
  const monthlyBillingReadyAccounts = useMemo(() => unbilledServiceAccounts.filter((account) => installationChargeResolved(installationChargeByServiceAccountId.get(account.id))), [unbilledServiceAccounts, installationChargeByServiceAccountId]);
  const applicableEarlyBirdPromotions = useMemo(() => promotions.filter((promotion) => (
    promotion.appliesTo === 'MONTHLY_SERVICE'
    && promotionPaymentRule(promotion) === 'EARLY_BIRD'
    && promotionActiveNow(promotion)
    && (!promotion.billingMode || promotion.billingMode === subscriptionForm.billingMode)
    && (!promotion.customerId || promotion.customerId === subscriptionForm.customerId)
    && (!promotion.catalogId || promotion.catalogId === subscriptionForm.catalogId)
  )), [promotions, subscriptionForm.billingMode, subscriptionForm.customerId, subscriptionForm.catalogId]);
  const applicableInstallationPromotions = useMemo(() => promotions.filter((promotion) => (
    promotion.appliesTo === 'INSTALLATION_FEE'
    && promotionActiveNow(promotion)
    && (!promotion.billingMode || promotion.billingMode === installationChargeForm.billingMode)
    && (!promotion.customerId || promotion.customerId === installationChargeForm.customerId)
    && (!promotion.catalogId || promotion.catalogId === installationChargeForm.catalogId)
  )), [promotions, installationChargeForm.billingMode, installationChargeForm.customerId, installationChargeForm.catalogId]);
  const filteredSubscriptions = useMemo(() => {
    const needle = subscriptionSearch.trim().toLowerCase();
    if (!needle) return subscriptions;
    return subscriptions.filter((subscription) => [
      customerLabel(subscription.customer),
      subscription.customer?.accountNumber,
      subscription.planName,
      subscription.serviceId,
      subscription.serviceAccountNumber,
      subscription.serviceOrderId,
      subscription.catalogCode,
      subscription.catalogName,
      subscription.billingMode,
      subscription.status,
      subscription.nextInvoiceDate,
      subscription.missingBillingCycles,
      subscription.oldestMissingBillingCycle,
      subscription.newestMissingBillingCycle,
    ].some((value) => String(value || '').toLowerCase().includes(needle)));
  }, [subscriptions, subscriptionSearch]);
  const filteredPromotions = useMemo(() => {
    const needle = promotionSearch.trim().toLowerCase();
    const statusFilter = promotionStatusFilter.trim().toUpperCase();
    const scopeFilter = promotionScopeFilter.trim().toUpperCase();
    return promotions.filter((promotion) => {
      if (statusFilter && String(promotionStatus(promotion)).toUpperCase() !== statusFilter) return false;
      if (scopeFilter && String(promotion.appliesTo || '').toUpperCase() !== scopeFilter) return false;
      if (!needle) return true;
      const plan = serviceCatalogById.get(promotion.catalogId);
      const customer = customerById.get(promotion.customerId);
      return [
        promotion.name,
        promotion.promoCode,
        promotion.description,
        promotion.notes,
        promotion.appliesTo,
        promotion.discountType,
        promotion.billingMode,
        promotionStatus(promotion),
        plan?.code,
        plan?.name,
        customer ? customerLabel(customer) : '',
      ].some((value) => String(value || '').toLowerCase().includes(needle));
    });
  }, [promotions, promotionSearch, promotionStatusFilter, promotionScopeFilter, customerById, serviceCatalogById]);
  const subscriptionUnpaidSummaryById = useMemo(() => {
    const rowsBySubscriptionId = new Map();
    invoices.forEach((invoice) => {
      if (!invoice.subscriptionId || !isMonthlyUnpaidInvoice(invoice)) return;
      const rows = rowsBySubscriptionId.get(invoice.subscriptionId) || [];
      rows.push(invoice);
      rowsBySubscriptionId.set(invoice.subscriptionId, rows);
    });
    return new Map([...rowsBySubscriptionId.entries()].map(([subscriptionId, rows]) => [subscriptionId, unpaidMonthSummary(rows)]));
  }, [invoices]);
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
      const [nextMeta, nextOverview, nextCustomers, nextServiceOrders, nextServiceCatalog, nextServiceAccounts, nextSubscriptions, nextInstallationCharges, nextPromotions, nextInvoices, nextAdjustments, nextBalances, nextAvatarConfig] = await Promise.all([
        request('/billing/meta'),
        request('/billing/overview'),
        request(`/billing/customers?search=${encodeURIComponent(search)}`),
        request('/service/orders?activeOnly=true'),
        request('/service/catalog?status=ACTIVE'),
        request('/service/accounts?activeOnly=true'),
        request('/billing/subscriptions'),
        request('/billing/installation-charges'),
        request('/billing/promotions'),
        request('/billing/invoices'),
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
      setInstallationCharges(nextInstallationCharges);
      setPromotions(nextPromotions);
      setInvoices(nextInvoices);
      setAdjustments(nextAdjustments);
      setBalances(nextBalances);
      setAvatarConfig(nextAvatarConfig);
    } catch (err) {
      showError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!message && !error) return undefined;
    const timer = window.setTimeout(() => {
      setMessage('');
      setError('');
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [message, error]);

  function clearNotification() {
    setMessage('');
    setError('');
  }

  function showMessage(text) {
    setError('');
    setMessage(text);
  }

  function showError(text) {
    setMessage('');
    setError(text);
  }

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
          const installationCharge = installationChargeByServiceAccountId.get(account.id);
          const installationResolved = installationChargeResolved(installationCharge);
          const isLinkedElsewhere = Boolean(linkedSubscription && linkedSubscription.id !== subscriptionForm.id);
          const isBlockedByInstallationFee = !installationResolved && !isLinkedElsewhere;
          return (
            <option key={account.id} value={account.id} disabled={isLinkedElsewhere || isBlockedByInstallationFee}>
              {serviceAccountOptionLabel(account)}{isLinkedElsewhere ? ' - already billed' : ''}{isBlockedByInstallationFee ? ' - resolve installation fee first' : ''}
            </option>
          );
        })}
      </>
    );
  }

  function applyEarlyBirdPromotion(promotionId) {
    const promotion = promotions.find((item) => item.id === promotionId);
    if (!promotion) {
      setSubscriptionForm({
        ...subscriptionForm,
        earlyBirdEligible: false,
        earlyBirdPromotionId: '',
        earlyBirdPromotionCode: '',
        earlyBirdPromotionName: '',
        earlyBirdDiscountAmount: ''
      });
      return;
    }
    const discountAmount = promotionDiscountAmount(promotion, subscriptionEffectiveRate(subscriptionForm));
    setSubscriptionForm({
      ...subscriptionForm,
      earlyBirdEligible: true,
      earlyBirdPromotionId: promotion.id,
      earlyBirdPromotionCode: promotion.promoCode,
      earlyBirdPromotionName: promotion.name,
      earlyBirdDiscountAmount: String(discountAmount)
    });
  }

  function setSubscriptionBillingMode(billingMode) {
    const supportsEarlyBird = ['PREPAID', 'POSTPAID'].includes(billingMode);
    const selectedPromotion = promotions.find((item) => item.id === subscriptionForm.earlyBirdPromotionId);
    const keepPromotion = Boolean(
      supportsEarlyBird
      && selectedPromotion
      && promotionPaymentRule(selectedPromotion) === 'EARLY_BIRD'
      && (!selectedPromotion.billingMode || selectedPromotion.billingMode === billingMode)
    );
    setSubscriptionForm({
      ...subscriptionForm,
      billingMode,
      dueDays: '0',
      earlyBirdEligible: keepPromotion,
      earlyBirdPromotionId: keepPromotion ? subscriptionForm.earlyBirdPromotionId : '',
      earlyBirdPromotionCode: keepPromotion ? subscriptionForm.earlyBirdPromotionCode : '',
      earlyBirdPromotionName: keepPromotion ? subscriptionForm.earlyBirdPromotionName : '',
      earlyBirdDiscountAmount: keepPromotion ? subscriptionForm.earlyBirdDiscountAmount : '',
      nextInvoiceDate: nextMonthStartDate(subscriptionForm.startDate) ? isoFromDate(nextMonthStartDate(subscriptionForm.startDate)) : subscriptionForm.startDate
    });
  }

  function applyInstallationPromotion(promotionId) {
    const promotion = promotions.find((item) => item.id === promotionId);
    if (!promotion) {
      setInstallationChargeForm({
        ...installationChargeForm,
        promoCode: '',
        promotionId: '',
        promotionCode: '',
        promotionName: '',
        waiverReason: String(installationChargeForm.waiverReason || '').startsWith('Promotion ') ? '' : installationChargeForm.waiverReason
      });
      return;
    }
    const defaultAmount = defaultInstallationFeeAmount(selectedInstallationServiceAccount);
    const standardAmount = Number(installationChargeForm.standardAmount || defaultAmount || DEFAULT_INSTALLATION_FEE);
    const discountAmount = promotionDiscountAmount(promotion, standardAmount);
    const chargedAmount = Math.max(0, Math.round((standardAmount - discountAmount) * 100) / 100);
    setInstallationChargeForm({
      ...installationChargeForm,
      status: chargedAmount <= 0 ? 'WAIVED' : 'INVOICED',
      standardAmount: String(standardAmount),
      chargedAmount: String(chargedAmount),
      waiverReason: `Promotion ${promotion.promoCode} - ${promotion.name}`,
      promoCode: promotion.promoCode,
      promotionId: promotion.id,
      promotionCode: promotion.promoCode,
      promotionName: promotion.name
    });
  }

  function subscriptionDraftFromServiceAccount(account, base = subscriptionForm) {
    const mode = accountBillingMode(account);
    const serviceDate = accountBillingStart(account);
    const latestOrder = latestCompletedOrderByServiceAccountId.get(account.id);
    const rate = accountMonthlyRate(account);
    const nextInvoiceDate = nextMonthStartDate(serviceDate) ? isoFromDate(nextMonthStartDate(serviceDate)) : serviceDate;
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
      billingDay: '1',
      dueDays: '0',
      earlyBirdEligible: Boolean(base.earlyBirdEligible && base.earlyBirdPromotionId && ['PREPAID', 'POSTPAID'].includes(mode)),
      earlyBirdDiscountAmount: base.earlyBirdPromotionId ? base.earlyBirdDiscountAmount : '',
      startDate: serviceDate || base.startDate,
      nextInvoiceDate: nextInvoiceDate || base.nextInvoiceDate,
      notes: base.notes || `Linked to ${account.serviceAccountNumber || 'Service Account'}.`
    };
  }

  function openServiceAccountSubscription(account) {
    const charge = installationChargeByServiceAccountId.get(account.id);
    if (!installationChargeResolved(charge)) {
      showError('Resolve the installation fee before starting monthly billing for this Service Account.');
      openInstallationChargeForm(account, charge);
      return;
    }
    setSubscriptionForm(subscriptionDraftFromServiceAccount(account, blankSubscription));
    setActiveTab('Subscriptions');
    setModal('subscription');
  }

  function installationChargeDraftFromServiceAccount(account, charge = null) {
    if (charge) {
      return {
        ...blankInstallationCharge,
        ...charge,
        standardAmount: String(charge.standardAmount ?? ''),
        chargedAmount: String(charge.chargedAmount ?? ''),
        waiverReason: charge.waiverReason || '',
        promoCode: charge.promoCode || '',
        promotionId: charge.promotionId || '',
        promotionCode: charge.promotionCode || charge.promoCode || '',
        promotionName: charge.promotionName || '',
        notes: charge.notes || ''
      };
    }
    if (!account) return blankInstallationCharge;
    const latestOrder = latestCompletedOrderByServiceAccountId.get(account.id);
    const standardAmount = defaultInstallationFeeAmount(account);
    return {
      ...blankInstallationCharge,
      customerId: account.customerId,
      serviceAccountId: account.id,
      serviceAccountNumber: account.serviceAccountNumber || '',
      serviceOrderId: latestOrder?.id || '',
      serviceId: accountReference(account) || '',
      catalogId: account.catalogId || account.catalog?.id || '',
      catalogCode: accountCatalogCode(account),
      catalogName: accountPlanName(account),
      billingMode: accountBillingMode(account),
      standardAmount,
      chargedAmount: standardAmount,
      notes: `Installation fee decision for ${account.serviceAccountNumber || 'Service Account'}.`
    };
  }

  function openInstallationChargeForm(account, charge = null) {
    setInstallationChargeForm(installationChargeDraftFromServiceAccount(account, charge));
    if (activeTab === 'Overview') setActiveTab('Subscriptions');
    setModal('installation-charge');
  }

  function serviceBridgeCards() {
    const activeServiceMrr = serviceAccounts.reduce((sum, account) => {
      if (account.catalog?.billingMode === 'ONE_TIME') return sum;
      return sum + Number(account.catalog?.monthlyRate || 0);
    }, 0);
    return [
      ['Active Service Accounts', serviceAccounts.length],
      ['Recurring Catalog Plans', serviceCatalog.filter((item) => item.billingMode !== 'ONE_TIME').length],
      ['Installation Fee Pending', installationFeePendingAccounts.length],
      ['Ready For Monthly Billing', monthlyBillingReadyAccounts.length],
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
      earlyBirdEligible: Boolean(subscription.earlyBirdEligible),
      earlyBirdPromotionId: subscription.earlyBirdPromotionId || '',
      earlyBirdPromotionCode: subscription.earlyBirdPromotionCode || '',
      earlyBirdPromotionName: subscription.earlyBirdPromotionName || '',
      earlyBirdDiscountAmount: subscription.earlyBirdPromotionId ? String(subscription.earlyBirdDiscountAmount || '') : '',
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
      setInvoiceIdempotencyKey(newIdempotencyKey('billing-invoice'));
      setModal('invoice');
      return;
    }
    if (invoice.status !== 'DRAFT') {
      showError('Posted invoices are immutable. Use a credit or debit adjustment for corrections.');
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

  function openAdjustmentForm(adjustment = null) {
    if (adjustment) {
      showError('Posted adjustments are immutable. Void the adjustment and post a replacement.');
      return;
    }
    setAdjustmentIdempotencyKey(newIdempotencyKey('billing-adjustment'));
    setAdjustmentForm(adjustment ? {
      ...blankAdjustment,
      ...adjustment,
      amount: String(adjustment.amount)
    } : blankAdjustment);
    setModal('adjustment');
  }

  function openPromotionForm(promotion = null) {
    setPromotionForm(promotion ? {
      ...blankPromotion,
      ...promotion,
      discountAmount: String(promotion.discountAmount ?? ''),
      discountPercent: promotion.discountPercent ? String(promotion.discountPercent) : '',
      paymentRule: promotionPaymentRule(promotion),
      priority: String(promotion.priority ?? ''),
      requiresApproval: Boolean(promotion.requiresApproval),
      stackable: Boolean(promotion.stackable),
    } : blankPromotion);
    setActiveTab('Promotions');
    setModal('promotion');
  }

  async function submitSubscription(e) {
    e.preventDefault();
    const linkedToService = Boolean(subscriptionForm.serviceAccountId);
    const usesOverride = linkedToService && subscriptionForm.priceOverrideEnabled;
    const effectiveRate = usesOverride ? subscriptionForm.priceOverrideAmount : (linkedToService ? subscriptionForm.listMonthlyRate : subscriptionForm.monthlyRate);
    const supportsEarlyBird = ['PREPAID', 'POSTPAID'].includes(subscriptionForm.billingMode);
    const qualifiesForEarlyBirdPromo = supportsEarlyBird && Boolean(subscriptionForm.earlyBirdEligible);
    const selectedEarlyBirdPromotion = qualifiesForEarlyBirdPromo ? promotions.find((promotion) => promotion.id === subscriptionForm.earlyBirdPromotionId) : null;
    if (qualifiesForEarlyBirdPromo && !selectedEarlyBirdPromotion) {
      showError('Select a promotion before saving this subscription.');
      return;
    }
    const earlyBirdDiscountAmount = selectedEarlyBirdPromotion ? promotionDiscountAmount(selectedEarlyBirdPromotion, Number(effectiveRate || 0)) : 0;
    const body = {
      ...subscriptionForm,
      monthlyRate: Number(effectiveRate || 0),
      listMonthlyRate: Number(linkedToService ? subscriptionForm.listMonthlyRate : effectiveRate || 0),
      priceOverrideAmount: usesOverride ? Number(subscriptionForm.priceOverrideAmount || 0) : null,
      priceOverrideReason: usesOverride ? subscriptionForm.priceOverrideReason : '',
      pricingSource: linkedToService ? (usesOverride ? 'PRICE_OVERRIDE' : 'SERVICE_CATALOG') : 'MANUAL',
      billingDay: Number(subscriptionForm.billingDay),
      dueDays: Number(subscriptionForm.dueDays),
      earlyBirdEligible: Boolean(selectedEarlyBirdPromotion),
      earlyBirdPromotionId: selectedEarlyBirdPromotion ? selectedEarlyBirdPromotion.id : '',
      earlyBirdPromotionCode: selectedEarlyBirdPromotion ? selectedEarlyBirdPromotion.promoCode : '',
      earlyBirdPromotionName: selectedEarlyBirdPromotion ? selectedEarlyBirdPromotion.name : '',
      earlyBirdDiscountAmount
    };
    delete body.priceOverrideEnabled;
    const path = subscriptionForm.id ? `/billing/subscriptions/${subscriptionForm.id}` : '/billing/subscriptions';
    const saved = await request(path, { method: subscriptionForm.id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    setSubscriptionForm(blankSubscription);
    closeModal();
    if (!subscriptionForm.id && saved.firstInvoice) {
      showMessage(`Subscription created. First invoice ${saved.firstInvoice.invoiceNumber} for ${currency(saved.firstInvoice.total)} is due ${formatDate(saved.firstInvoice.dueDate)}.`);
    } else {
      showMessage(subscriptionForm.id ? 'Subscription saved.' : 'Subscription created.');
    }
    await load();
    refreshShell();
  }

  async function submitInstallationCharge(e) {
    e.preventDefault();
    const status = installationChargeForm.status;
    const standardAmount = status === 'NO_FEE' ? 0 : Number(installationChargeForm.standardAmount || 0);
    const chargedAmount = status === 'INVOICED' ? Number(installationChargeForm.chargedAmount || 0) : 0;
    const body = {
      ...installationChargeForm,
      standardAmount,
      chargedAmount,
      waiverReason: installationChargeForm.waiverReason,
      promoCode: installationChargeForm.promoCode,
      promotionId: installationChargeForm.status === 'NO_FEE' ? '' : installationChargeForm.promotionId,
      promotionCode: installationChargeForm.status === 'NO_FEE' ? '' : installationChargeForm.promotionCode,
      promotionName: installationChargeForm.status === 'NO_FEE' ? '' : installationChargeForm.promotionName,
      issueDate: installationChargeForm.issueDate,
      dueDate: installationChargeForm.dueDate
    };
    const path = installationChargeForm.id ? `/billing/installation-charges/${installationChargeForm.id}` : '/billing/installation-charges';
    const saved = await request(path, { method: installationChargeForm.id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    setInstallationChargeForm(blankInstallationCharge);
    closeModal();
    if (saved.status === 'INVOICED') {
      showMessage(`Installation fee invoice ${saved.invoiceNumber} created.`);
    } else if (saved.status === 'WAIVED') {
      showMessage('Installation fee waiver recorded.');
    } else {
      showMessage('No-installation-fee decision recorded.');
    }
    await load();
    refreshShell();
  }

  async function voidInstallationCharge(id) {
    if (!window.confirm('Void this installation fee decision?')) return;
    await request(`/billing/installation-charges/${id}`, { method: 'DELETE' });
    showMessage('Installation fee decision voided.');
    await load();
    refreshShell();
  }

  async function deleteSubscription(id) {
    if (!window.confirm('Cancel this subscription?')) return;
    await request(`/billing/subscriptions/${id}`, { method: 'DELETE' });
    showMessage('Subscription cancelled.');
    await load();
    refreshShell();
  }

  async function generateInvoice(id, cycleStart) {
    const cycleQuery = cycleStart ? `?cycleStart=${encodeURIComponent(cycleStart)}` : '';
    const invoice = await request(`/billing/subscriptions/${id}/generate-invoice${cycleQuery}`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `subscription-invoice:${id}:${cycleStart || 'next'}` }
    });
    showMessage(invoice.idempotentReplay ? `${invoice.invoiceNumber} already covers this billing cycle.` : `Generated ${invoice.invoiceNumber}.`);
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
    await request(path, {
      method: invoiceForm.id ? 'PATCH' : 'POST',
      headers: invoiceForm.id ? {} : { 'Idempotency-Key': invoiceIdempotencyKey },
      body: JSON.stringify(body)
    });
    setInvoiceForm(blankInvoice);
    closeModal();
    showMessage(invoiceForm.id ? 'Invoice saved.' : 'Invoice created.');
    await load();
    refreshShell();
  }

  async function voidInvoice(id) {
    if (!window.confirm('Void this invoice?')) return;
    await request(`/billing/invoices/${id}`, { method: 'DELETE' });
    showMessage('Invoice voided.');
    await load();
    refreshShell();
  }

  async function submitAdjustment(e) {
    e.preventDefault();
    const body = { ...adjustmentForm, amount: Number(adjustmentForm.amount) };
    const path = adjustmentForm.id ? `/billing/adjustments/${adjustmentForm.id}` : '/billing/adjustments';
    await request(path, {
      method: adjustmentForm.id ? 'PATCH' : 'POST',
      headers: adjustmentForm.id ? {} : { 'Idempotency-Key': adjustmentIdempotencyKey },
      body: JSON.stringify(body)
    });
    setAdjustmentForm(blankAdjustment);
    closeModal();
    showMessage(adjustmentForm.id ? 'Adjustment saved.' : 'Adjustment posted.');
    await load();
    refreshShell();
  }

  async function submitPromotion(e) {
    e.preventDefault();
    const body = {
      ...promotionForm,
      discountAmount: Number(promotionForm.discountAmount || 0),
      discountPercent: Number(promotionForm.discountPercent || 0),
      paymentRule: promotionForm.appliesTo === 'MONTHLY_SERVICE' ? promotionForm.paymentRule : 'ANY_PAYMENT',
      priority: Number(promotionForm.priority || 0),
      requiresApproval: Boolean(promotionForm.requiresApproval),
      stackable: Boolean(promotionForm.stackable)
    };
    const path = promotionForm.id ? `/billing/promotions/${promotionForm.id}` : '/billing/promotions';
    await request(path, { method: promotionForm.id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    setPromotionForm(blankPromotion);
    closeModal();
    showMessage(promotionForm.id ? 'Promotion saved.' : 'Promotion created.');
    await load();
  }

  async function archivePromotion(id) {
    if (!window.confirm('Archive this promotion? Existing invoices keep their saved promo snapshot.')) return;
    await request(`/billing/promotions/${id}`, { method: 'DELETE' });
    showMessage('Promotion archived.');
    await load();
  }

  async function voidAdjustment(id) {
    if (!window.confirm('Void this adjustment?')) return;
    await request(`/billing/adjustments/${id}`, { method: 'DELETE' });
    showMessage('Adjustment voided.');
    await load();
    refreshShell();
  }

  function editInvoice(invoice) {
    openInvoiceForm(invoice);
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
  const selectedInstallationServiceAccount = serviceAccounts.find((account) => account.id === installationChargeForm.serviceAccountId);
  const installationChargeNeedsReason = installationChargeForm.status === 'WAIVED' || (
    installationChargeForm.status === 'INVOICED' && Number(installationChargeForm.standardAmount || 0) > Number(installationChargeForm.chargedAmount || 0)
  );
  const linkedSubscriptionForm = Boolean(subscriptionForm.serviceAccountId);
  const editingSubscription = Boolean(subscriptionForm.id);
  const lockSubscriptionCustomer = editingSubscription || linkedSubscriptionForm;
  const firstInvoicePreview = firstSubscriptionInvoicePreview(subscriptionForm);
  const subscriptionSupportsEarlyBird = ['PREPAID', 'POSTPAID'].includes(subscriptionForm.billingMode);
  const promotionStatusOptions = [...new Set([...(meta.promotionStatuses || []), 'SCHEDULED'].filter((status) => status && status !== 'ARCHIVED'))];
  const promotionScopeOptions = meta.promotionScopes || ['MONTHLY_SERVICE', 'INSTALLATION_FEE'];

  return (
    <div className="billing-page">
      {notification && (
        <div className={`billing-toast billing-toast-${notification.type}`} role={notification.type === 'error' ? 'alert' : 'status'}>
          <div className="billing-toast-content">{notification.text}</div>
          <button className="billing-toast-close" type="button" onClick={clearNotification} aria-label="Dismiss notification">
            <IconX size={16} />
          </button>
        </div>
      )}

      <div className="billing-toolbar">
        <div className="input-icon billing-search">
          <span className="input-icon-addon"><IconSearch size={16} /></span>
          <input className="form-control" value={customerSearch} placeholder="Search customers" onChange={(e) => setCustomerSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(customerSearch); }} />
        </div>
        <button className="btn" onClick={() => load(customerSearch)}><IconRefresh size={16} className="me-1" />Refresh</button>
      </div>

      <ul className="nav nav-tabs mb-3">
        {['Overview', 'Subscriptions', 'Installation Fees', 'Promotions', 'Invoices', 'Adjustments', 'Balances'].map((tab) => (
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
                installationChargeByServiceAccountId={installationChargeByServiceAccountId}
                onResolveInstallationFee={openInstallationChargeForm}
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
                rows={monthlyBillingReadyAccounts}
                subscriptionByServiceAccountId={subscriptionByServiceAccountId}
                installationChargeByServiceAccountId={installationChargeByServiceAccountId}
                onResolveInstallationFee={openInstallationChargeForm}
                onCreateSubscription={openServiceAccountSubscription}
                avatarConfig={avatarConfig}
              />
            </Card>
          </div>
          <div className="col-12">
            <Card
              title="Subscriptions"
              icon={IconRepeat}
              actions={(
                <div className="billing-card-actions">
                  <div className="input-icon billing-subscription-search">
                    <span className="input-icon-addon"><IconSearch size={16} /></span>
                    <input className="form-control form-control-sm" value={subscriptionSearch} placeholder="Search subscriptions" onChange={(event) => setSubscriptionSearch(event.target.value)} />
                  </div>
                  <button className="btn btn-primary btn-sm" type="button" onClick={() => openSubscriptionForm()}><IconPlus size={16} className="me-1" />New Subscription</button>
                </div>
              )}
            >
              <SubscriptionTable
                rows={filteredSubscriptions}
                avatarConfig={avatarConfig}
                unpaidSummaryById={subscriptionUnpaidSummaryById}
                onEdit={openSubscriptionForm}
                onGenerate={generateInvoice}
                onDelete={deleteSubscription}
              />
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Installation Fees' && (
        <div className="row row-cards">
          <div className="col-12">
            <Card title="Installation Fee Decisions" icon={IconReceipt}>
              <InstallationChargeTable
                rows={installationCharges}
                serviceAccountById={serviceAccountById}
                onEdit={(charge) => openInstallationChargeForm(serviceAccountById.get(charge.serviceAccountId), charge)}
                onVoid={voidInstallationCharge}
                avatarConfig={avatarConfig}
              />
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Promotions' && (
        <div className="row row-cards">
          <div className="col-12">
            <Card
              title="Promotions"
              icon={IconDiscount2}
              actions={(
                <div className="billing-card-actions">
                  <div className="input-icon billing-promotion-search">
                    <span className="input-icon-addon"><IconSearch size={16} /></span>
                    <input className="form-control form-control-sm" value={promotionSearch} placeholder="Search promos" onChange={(event) => setPromotionSearch(event.target.value)} />
                  </div>
                  <select className="form-select form-select-sm billing-promotion-filter" aria-label="Filter promotions by status" value={promotionStatusFilter} onChange={(event) => setPromotionStatusFilter(event.target.value)}>
                    <option value="">All statuses</option>
                    {promotionStatusOptions.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
                  </select>
                  <select className="form-select form-select-sm billing-promotion-filter" aria-label="Filter promotions by scope" value={promotionScopeFilter} onChange={(event) => setPromotionScopeFilter(event.target.value)}>
                    <option value="">All scopes</option>
                    {promotionScopeOptions.map((scope) => <option key={scope} value={scope}>{promotionScopeLabel(scope)}</option>)}
                  </select>
                  <button className="btn btn-primary btn-sm" type="button" onClick={() => openPromotionForm()}><IconPlus size={16} className="me-1" />New Promo</button>
                </div>
              )}
            >
              <PromotionTable
                rows={filteredPromotions}
                customerById={customerById}
                serviceCatalogById={serviceCatalogById}
                onEdit={openPromotionForm}
                onArchive={archivePromotion}
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
          {linkedSubscriptionForm && !editingSubscription && firstInvoicePreview && <FirstSubscriptionInvoicePreview preview={firstInvoicePreview} />}
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
          <SelectField label="Billing Mode" value={subscriptionForm.billingMode} options={meta.billingModes || ['PREPAID', 'POSTPAID']} disabled={linkedSubscriptionForm} onChange={setSubscriptionBillingMode} />
          {subscriptionSupportsEarlyBird && (
            <>
              <label className="billing-check-row">
                <input type="checkbox" checked={Boolean(subscriptionForm.earlyBirdEligible)} onChange={(event) => setSubscriptionForm({
                  ...subscriptionForm,
                  earlyBirdEligible: event.target.checked,
                  earlyBirdPromotionId: event.target.checked ? subscriptionForm.earlyBirdPromotionId : '',
                  earlyBirdPromotionCode: event.target.checked ? subscriptionForm.earlyBirdPromotionCode : '',
                  earlyBirdPromotionName: event.target.checked ? subscriptionForm.earlyBirdPromotionName : '',
                  earlyBirdDiscountAmount: event.target.checked ? subscriptionForm.earlyBirdDiscountAmount : ''
                })} />
                <span>Qualified for promotion</span>
              </label>
              {subscriptionForm.earlyBirdEligible && (
                <>
                  <SelectField label="Qualified Promotion" value={subscriptionForm.earlyBirdPromotionId} required onChange={applyEarlyBirdPromotion}>
                    <option value="">Select Promotion</option>
                    {applicableEarlyBirdPromotions.map((promotion) => (
                      <option key={promotion.id} value={promotion.id}>{promotion.promoCode} - {promotion.name} ({promotionDiscountLabel(promotion)})</option>
                    ))}
                  </SelectField>
                  {subscriptionForm.earlyBirdPromotionId && (
                    <div className="billing-inline-note">
                      Promo-owned discount: {currency(subscriptionForm.earlyBirdDiscountAmount)}
                    </div>
                  )}
                </>
              )}
            </>
          )}
          <div className="billing-two-cols">
            <TextField label="Billing Day" type="number" min="1" max="28" value={subscriptionForm.billingDay} required onChange={(billingDay) => setSubscriptionForm({ ...subscriptionForm, billingDay })} />
            <TextField label="Due Days" type="number" min="0" max="60" value={subscriptionForm.dueDays} required onChange={(dueDays) => setSubscriptionForm({ ...subscriptionForm, dueDays })} />
          </div>
          <div className="billing-two-cols">
            <TextField label="Start Date" type="date" value={subscriptionForm.startDate} required onChange={(startDate) => setSubscriptionForm({ ...subscriptionForm, startDate, nextInvoiceDate: nextMonthStartDate(startDate) ? isoFromDate(nextMonthStartDate(startDate)) : (subscriptionForm.nextInvoiceDate || startDate) })} />
            <TextField label={linkedSubscriptionForm ? 'Next Full Invoice' : 'Next Invoice'} type="date" value={subscriptionForm.nextInvoiceDate} required disabled={linkedSubscriptionForm} onChange={(nextInvoiceDate) => setSubscriptionForm({ ...subscriptionForm, nextInvoiceDate })} />
          </div>
          <SelectField label="Status" value={subscriptionForm.status} options={meta.subscriptionStatuses || ['ACTIVE']} onChange={(status) => setSubscriptionForm({ ...subscriptionForm, status })} />
          <TextField label="Notes" value={subscriptionForm.notes} onChange={(notes) => setSubscriptionForm({ ...subscriptionForm, notes })} />
          <div className="billing-form-actions">
            <button className="btn" type="button" onClick={closeModal}>Cancel</button>
            <button className="btn btn-primary"><IconDeviceFloppy size={16} className="me-1" />{linkedSubscriptionForm && !editingSubscription ? 'Start Billing' : 'Save'}</button>
          </div>
        </form>
      </Modal>

      <Modal title="Installation Fee Decision" icon={IconReceipt} open={modal === 'installation-charge'} onClose={closeModal}>
        <form className="billing-form" onSubmit={submitInstallationCharge}>
          {selectedInstallationServiceAccount && <InstallationChargeDetail account={selectedInstallationServiceAccount} form={installationChargeForm} />}
          <SelectField
            label="Decision"
            value={installationChargeForm.status}
            disabled={Boolean(installationChargeForm.invoiceId)}
            onChange={(status) => {
              const defaultAmount = defaultInstallationFeeAmount(selectedInstallationServiceAccount);
              const standardAmount = status === 'NO_FEE' ? '0' : (Number(installationChargeForm.standardAmount || 0) > 0 ? installationChargeForm.standardAmount : defaultAmount);
              setInstallationChargeForm({
                ...installationChargeForm,
                status,
                standardAmount,
                chargedAmount: status === 'INVOICED' ? (Number(installationChargeForm.chargedAmount || 0) > 0 ? installationChargeForm.chargedAmount : standardAmount) : '0',
                waiverReason: status === 'NO_FEE' ? 'No installation fee required' : installationChargeForm.waiverReason,
                promoCode: status === 'NO_FEE' ? '' : installationChargeForm.promoCode,
                promotionId: status === 'NO_FEE' ? '' : installationChargeForm.promotionId,
                promotionCode: status === 'NO_FEE' ? '' : installationChargeForm.promotionCode,
                promotionName: status === 'NO_FEE' ? '' : installationChargeForm.promotionName
              });
            }}
          >
            <option value="INVOICED">Charge installation fee</option>
            <option value="WAIVED">Waive installation fee</option>
            <option value="NO_FEE">No installation fee</option>
          </SelectField>
          {installationChargeForm.status !== 'NO_FEE' && (
            <SelectField label="Installation Promo" value={installationChargeForm.promotionId} onChange={applyInstallationPromotion}>
              <option value="">No promotion</option>
              {installationChargeForm.promotionId && !applicableInstallationPromotions.some((promotion) => promotion.id === installationChargeForm.promotionId) && (
                <option value={installationChargeForm.promotionId}>{installationChargeForm.promotionCode || installationChargeForm.promoCode} - {installationChargeForm.promotionName || 'Selected promo'}</option>
              )}
              {applicableInstallationPromotions.map((promotion) => (
                <option key={promotion.id} value={promotion.id}>{promotion.promoCode} - {promotion.name} ({promotionDiscountLabel(promotion)})</option>
              ))}
            </SelectField>
          )}
          {installationChargeForm.status !== 'NO_FEE' && (
            <div className="billing-two-cols">
              <TextField label="Standard Installation Fee" type="number" min="0" step="0.01" value={installationChargeForm.standardAmount} required onChange={(standardAmount) => {
                const promotion = promotions.find((item) => item.id === installationChargeForm.promotionId);
                if (!promotion) {
                  setInstallationChargeForm({ ...installationChargeForm, standardAmount, chargedAmount: installationChargeForm.status === 'INVOICED' && !installationChargeForm.chargedAmount ? standardAmount : installationChargeForm.chargedAmount });
                  return;
                }
                const nextStandardAmount = Number(standardAmount || 0);
                const discountAmount = promotionDiscountAmount(promotion, nextStandardAmount);
                const nextChargedAmount = Math.max(0, Math.round((nextStandardAmount - discountAmount) * 100) / 100);
                setInstallationChargeForm({
                  ...installationChargeForm,
                  status: nextChargedAmount <= 0 ? 'WAIVED' : 'INVOICED',
                  standardAmount,
                  chargedAmount: String(nextChargedAmount),
                  waiverReason: `Promotion ${promotion.promoCode} - ${promotion.name}`,
                  promoCode: promotion.promoCode,
                  promotionCode: promotion.promoCode,
                  promotionName: promotion.name
                });
              }} />
              {installationChargeForm.status === 'INVOICED' && <TextField label="Amount to Bill Customer" type="number" min="0.01" step="0.01" value={installationChargeForm.chargedAmount} required onChange={(chargedAmount) => setInstallationChargeForm({ ...installationChargeForm, chargedAmount })} />}
            </div>
          )}
          {installationChargeForm.status === 'INVOICED' && (
            <div className="billing-two-cols">
              <TextField label="Issue Date" type="date" value={installationChargeForm.issueDate} required onChange={(issueDate) => setInstallationChargeForm({ ...installationChargeForm, issueDate })} />
              <TextField label="Due Date" type="date" value={installationChargeForm.dueDate} required onChange={(dueDate) => setInstallationChargeForm({ ...installationChargeForm, dueDate })} />
            </div>
          )}
          {installationChargeNeedsReason && <TextField label="Waiver / Promo Reason" value={installationChargeForm.waiverReason} required onChange={(waiverReason) => setInstallationChargeForm({ ...installationChargeForm, waiverReason })} />}
          <TextField label="Promo Code" value={installationChargeForm.promoCode} disabled={Boolean(installationChargeForm.promotionId)} onChange={(promoCode) => setInstallationChargeForm({ ...installationChargeForm, promoCode })} />
          <TextField label="Notes" value={installationChargeForm.notes} onChange={(notes) => setInstallationChargeForm({ ...installationChargeForm, notes })} />
          <div className="billing-form-actions">
            <button className="btn" type="button" onClick={closeModal}>Cancel</button>
            <button className="btn btn-primary"><IconDeviceFloppy size={16} className="me-1" />Save Decision</button>
          </div>
        </form>
      </Modal>

      <Modal title={promotionForm.id ? 'Edit Promotion' : 'New Promotion'} icon={IconDiscount2} open={modal === 'promotion'} onClose={closeModal}>
        <form className="billing-form" onSubmit={submitPromotion}>
          <div className="billing-two-cols">
            <TextField label="Promo Name" value={promotionForm.name} required onChange={(name) => setPromotionForm({ ...promotionForm, name })} />
            <TextField label="Promo Code (Optional)" value={promotionForm.promoCode} onChange={(promoCode) => setPromotionForm({ ...promotionForm, promoCode })} />
          </div>
          <TextField label="Description" value={promotionForm.description} onChange={(description) => setPromotionForm({ ...promotionForm, description })} />
          <div className="billing-two-cols">
            <SelectField label="Applies To" value={promotionForm.appliesTo} options={meta.promotionScopes || ['MONTHLY_SERVICE', 'INSTALLATION_FEE']} onChange={(appliesTo) => setPromotionForm({ ...promotionForm, appliesTo, paymentRule: appliesTo === 'MONTHLY_SERVICE' ? (promotionForm.paymentRule || 'ANY_PAYMENT') : 'ANY_PAYMENT' })} />
            <SelectField label="Discount Type" value={promotionForm.discountType} options={meta.promotionDiscountTypes || ['FIXED_AMOUNT', 'PERCENT', 'WAIVE']} onChange={(discountType) => setPromotionForm({ ...promotionForm, discountType })} />
          </div>
          {promotionForm.appliesTo === 'MONTHLY_SERVICE' && (
            <div className="billing-two-cols">
              <SelectField label="Payment Condition" value={promotionForm.paymentRule} onChange={(paymentRule) => setPromotionForm({ ...promotionForm, paymentRule })}>
                {(meta.promotionPaymentRules || ['ANY_PAYMENT', 'EARLY_BIRD']).map((rule) => <option key={rule} value={rule}>{promotionPaymentRuleLabel(rule)}</option>)}
              </SelectField>
              <TextField label="Priority" type="number" min="0" step="1" value={promotionForm.priority} onChange={(priority) => setPromotionForm({ ...promotionForm, priority })} />
            </div>
          )}
          {promotionForm.discountType === 'FIXED_AMOUNT' && <TextField label="Discount Amount" type="number" min="0.01" step="0.01" value={promotionForm.discountAmount} required onChange={(discountAmount) => setPromotionForm({ ...promotionForm, discountAmount })} />}
          {promotionForm.discountType === 'PERCENT' && <TextField label="Discount Percent" type="number" min="1" max="100" step="0.01" value={promotionForm.discountPercent} required onChange={(discountPercent) => setPromotionForm({ ...promotionForm, discountPercent })} />}
          <div className="billing-two-cols">
            <TextField label="Start Date" type="date" value={promotionForm.startDate} required onChange={(startDate) => setPromotionForm({ ...promotionForm, startDate })} />
            <TextField label="End Date" type="date" value={promotionForm.endDate} onChange={(endDate) => setPromotionForm({ ...promotionForm, endDate })} />
          </div>
          <div className="billing-two-cols">
            <SelectField label="Status" value={promotionForm.status} options={meta.promotionStatuses || ['ACTIVE']} onChange={(status) => setPromotionForm({ ...promotionForm, status })} />
            <SelectField label="Billing Mode Target" value={promotionForm.billingMode} onChange={(billingMode) => setPromotionForm({ ...promotionForm, billingMode })}>
              <option value="">Any billing mode</option>
              {(meta.billingModes || ['PREPAID', 'POSTPAID']).map((mode) => <option key={mode} value={mode}>{mode}</option>)}
            </SelectField>
          </div>
          <div className="billing-two-cols">
            <SelectField label="Plan Target" value={promotionForm.catalogId} onChange={(catalogId) => setPromotionForm({ ...promotionForm, catalogId })}>
              <option value="">Any plan</option>
              {serviceCatalog.map((item) => <option key={item.id} value={item.id}>{item.code ? `${item.code} - ` : ''}{item.name}</option>)}
            </SelectField>
            <SelectField label="Customer Target" value={promotionForm.customerId} onChange={(customerId) => setPromotionForm({ ...promotionForm, customerId })}>
              <option value="">Any customer</option>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customerLabel(customer)}</option>)}
            </SelectField>
          </div>
          <label className="billing-check-row">
            <input type="checkbox" checked={Boolean(promotionForm.requiresApproval)} onChange={(event) => setPromotionForm({ ...promotionForm, requiresApproval: event.target.checked })} />
            <span>Requires manager approval before use</span>
          </label>
          <label className="billing-check-row">
            <input type="checkbox" checked={Boolean(promotionForm.stackable)} onChange={(event) => setPromotionForm({ ...promotionForm, stackable: event.target.checked })} />
            <span>Can stack with other promotions</span>
          </label>
          <TextField label="Notes" value={promotionForm.notes} onChange={(notes) => setPromotionForm({ ...promotionForm, notes })} />
          <div className="billing-form-actions">
            <button className="btn" type="button" onClick={closeModal}>Cancel</button>
            <button className="btn btn-primary"><IconDeviceFloppy size={16} className="me-1" />Save Promotion</button>
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

function FirstSubscriptionInvoicePreview({ preview }) {
  const modeLabel = preview.billingMode === 'PREPAID' ? 'prepaid' : 'postpaid';
  return (
    <div className="billing-proration-preview">
      <div className="billing-service-detail-title">
        {preview.isProrated ? `First ${modeLabel} invoice will be prorated.` : `First ${modeLabel} invoice covers the full calendar month.`}
      </div>
      <div className="billing-service-pairs">
        <div>
          <span>First Period</span>
          <strong>{formatDate(preview.cycleStart)} to {formatDate(preview.cycleEnd)}</strong>
        </div>
        <div>
          <span>Billable Days</span>
          <strong>{preview.serviceDays} of {preview.daysInCycle}</strong>
        </div>
        <div>
          <span>Monthly Rate</span>
          <strong>{currency(preview.monthlyRate)}</strong>
        </div>
        <div>
          <span>First Invoice</span>
          <strong>{currency(preview.firstInvoiceAmount)}</strong>
        </div>
        <div>
          <span>Issue / Due</span>
          <strong>{formatDate(preview.issueDate)} / {formatDate(preview.dueDate)}</strong>
        </div>
        <div>
          <span>Next Full Billing</span>
          <strong>{formatDate(preview.nextFullCycleStart)} to {formatDate(preview.nextFullCycleEnd)}</strong>
        </div>
        {preview.earlyBirdEligible && (
          <>
            <div>
              <span>Promo Payable Amount</span>
              <strong>{currency(preview.earlyBirdPayableAmount)}</strong>
            </div>
            <div>
              <span>Promo Available Until</span>
              <strong>{formatDate(preview.earlyBirdAvailableUntil)}</strong>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function InstallationChargeDetail({ account, form }) {
  return (
    <div className="billing-service-detail">
      <div className="billing-service-detail-title">{account.serviceAccountNumber || 'Service Account'} installation fee must be resolved before monthly billing starts.</div>
      <div className="billing-service-pairs">
        <div>
          <span>Customer</span>
          <strong>{customerLabel(account.customer)}</strong>
        </div>
        <div>
          <span>Plan</span>
          <strong>{accountPlanName(account)}</strong>
        </div>
        <div>
          <span>Service Ref</span>
          <strong>{accountReference(account) || '-'}</strong>
        </div>
        <div>
          <span>Decision</span>
          <strong>{installationFeeDecisionLabel(form.status)}</strong>
        </div>
      </div>
    </div>
  );
}

function InstallationFeeStatus({ charge }) {
  if (!charge) {
    return (
      <div>
        <span className={`badge ${statusClass('pending')}`}>Pending</span>
        <div className="text-muted small">Resolve before monthly billing</div>
      </div>
    );
  }
  return (
    <div>
      <span className={`badge ${statusClass(charge.status)}`}>{installationFeeDecisionLabel(charge.status)}</span>
      <div className="text-muted small">
        {charge.status === 'INVOICED' && `${currency(charge.chargedAmount)} ${charge.invoiceNumber ? `- ${charge.invoiceNumber}` : ''}`}
        {charge.status === 'WAIVED' && `${currency(charge.waivedAmount)} waived`}
        {charge.status === 'NO_FEE' && 'No one-time charge'}
      </div>
    </div>
  );
}

function ServiceAccountBillingTable({ rows, subscriptionByServiceAccountId, installationChargeByServiceAccountId, onResolveInstallationFee, onCreateSubscription, avatarConfig, compact = false }) {
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
            <th>Installation Fee</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const linkedSubscription = subscriptionByServiceAccountId.get(row.id);
            const installationCharge = installationChargeByServiceAccountId.get(row.id);
            const installationResolved = installationChargeResolved(installationCharge);
            return (
              <tr key={row.id}>
                <td>
                  <div className="billing-service-main">{row.serviceAccountNumber || '-'}</div>
                  <div className="text-muted small">{customerLabel(row.customer)}</div>
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
                <td><InstallationFeeStatus charge={installationCharge} /></td>
                <td>
                  <span className={`badge ${statusClass(linkedSubscription ? 'active' : installationResolved ? 'pending' : 'void')}`}>{linkedSubscription ? 'Linked' : installationResolved ? 'Ready' : 'Blocked'}</span>
                  {linkedSubscription && <div className="text-muted small">{linkedSubscription.planName}</div>}
                </td>
                <td className="text-end">
                  {linkedSubscription ? (
                    <button className="btn btn-sm btn-primary" type="button" disabled>Billed</button>
                  ) : installationResolved ? (
                    <button className="btn btn-sm btn-primary" type="button" onClick={() => onCreateSubscription(row)}>Start Billing</button>
                  ) : (
                    <button className="btn btn-sm btn-primary" type="button" onClick={() => onResolveInstallationFee(row, installationCharge)}>Resolve Fee</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InstallationChargeTable({ rows, serviceAccountById, onEdit, onVoid, avatarConfig }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-responsive">
      <table className="table card-table table-vcenter">
        <thead>
          <tr>
            <th>Customer</th>
            <th>Service Account</th>
            <th>Decision</th>
            <th>Standard</th>
            <th>Charged</th>
            <th>Waived</th>
            <th>Invoice</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const account = serviceAccountById?.get(row.serviceAccountId);
            return (
              <tr key={row.id}>
                <td>
                  <div className="d-flex align-items-center gap-2">
                    <CustomerEmotionAvatar customer={row.customer} avatarConfig={avatarConfig} context={{ installationCharge: row }} size={32} />
                    <span>{customerLabel(row.customer)}</span>
                  </div>
                </td>
                <td>
                  <div className="billing-service-main">{row.serviceAccountNumber || account?.serviceAccountNumber || '-'}</div>
                  <div className="text-muted small">{row.serviceId || accountReference(account) || '-'}</div>
                </td>
                <td><span className={`badge ${statusClass(row.status)}`}>{installationFeeDecisionLabel(row.status)}</span></td>
                <td>{currency(row.standardAmount)}</td>
                <td>{currency(row.chargedAmount)}</td>
                <td>
                  {currency(row.waivedAmount)}
                  {row.waiverReason && <div className="text-muted small">{row.waiverReason}</div>}
                  {(row.promotionCode || row.promoCode) && <div className="text-muted small">Promo: {row.promotionCode || row.promoCode}{row.promotionName ? ` - ${row.promotionName}` : ''}</div>}
                </td>
                <td>
                  {row.invoiceNumber || '-'}
                  {row.invoiceStatus && <div className="text-muted small">{row.invoiceStatus.replaceAll('_', ' ')} · {currency(row.invoiceBalance)}</div>}
                </td>
                <td className="text-end">
                  {!row.invoiceId && row.status !== 'VOID' && (
                    <button className="btn btn-sm me-1" type="button" title="Edit fee decision" aria-label="Edit fee decision" onClick={() => onEdit(row)}><IconEdit size={14} /></button>
                  )}
                  {row.status !== 'VOID' && (
                    <button className="btn btn-sm btn-outline-danger" type="button" title="Void fee decision" aria-label="Void fee decision" onClick={() => onVoid(row.id)}><IconTrash size={14} /></button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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

function PromotionTable({ rows, customerById, serviceCatalogById, onEdit, onArchive }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-responsive">
      <table className="table card-table table-vcenter">
        <thead>
          <tr>
            <th>Promotion</th>
            <th>Applies To</th>
            <th>Discount</th>
            <th>Eligibility</th>
            <th>Dates</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <div className="billing-service-main">{row.name}</div>
                <div className="text-muted small">{row.promoCode}</div>
              </td>
              <td>{promotionScopeLabel(row.appliesTo)}</td>
              <td>{promotionDiscountLabel(row)}</td>
              <td>
                <div>{promotionEligibilityLabel(row, customerById, serviceCatalogById)}</div>
                {row.appliesTo === 'MONTHLY_SERVICE' && <div className="text-muted small">{promotionPaymentRuleLabel(promotionPaymentRule(row))}</div>}
                {Number(row.priority || 0) > 0 && <div className="text-muted small">Priority {row.priority}</div>}
                {row.requiresApproval && <div className="text-muted small">Approval required</div>}
                {row.stackable && <div className="text-muted small">Stackable</div>}
              </td>
              <td>
                <div>{formatDate(row.startDate)}</div>
                <div className="text-muted small">{row.endDate ? `Ends ${formatDate(row.endDate)}` : 'No end date'}</div>
              </td>
              <td><span className={`badge ${statusClass(promotionStatus(row))}`}>{promotionStatus(row).replaceAll('_', ' ')}</span></td>
              <td className="text-end">
                <button className="btn btn-sm me-1" type="button" title="Edit promotion" aria-label="Edit promotion" onClick={() => onEdit(row)}><IconEdit size={14} /></button>
                <button className="btn btn-sm btn-outline-danger" type="button" title="Archive promotion" aria-label="Archive promotion" onClick={() => onArchive(row.id)}><IconTrash size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MonthlyAgingCell({ unpaidSummary = {}, missingSummary = {}, showAmounts = false }) {
  const unpaidLine = monthlyAgingLine(
    'Unpaid',
    unpaidSummary.unpaidMonths,
    'mo',
    agingMonthKeys(unpaidSummary, 'unpaidMonthKeys', 'oldestUnpaidMonth', 'newestUnpaidMonth')
  );
  const missingLine = monthlyAgingLine(
    'Missing',
    missingSummary.missingBillingCycles,
    'inv',
    agingMonthKeys(missingSummary, 'missingBillingCycleKeys', 'oldestMissingBillingCycle', 'newestMissingBillingCycle')
  );
  if (!unpaidLine && !missingLine) return <span className="text-muted">Current</span>;
  return (
    <div className="billing-aging-lines">
      {unpaidLine && (
        <div>
          <div className="text-danger">{unpaidLine}</div>
          {showAmounts && <div className="text-muted small">{currency(unpaidSummary.unpaidMonthlyBalance || 0)} unpaid</div>}
        </div>
      )}
      {missingLine && (
        <div>
          <div className="text-orange">{missingLine}</div>
          {showAmounts && <div className="text-muted small">Est. {currency(missingSummary.missingBillingCycleEstimate || 0)}</div>}
        </div>
      )}
    </div>
  );
}

function SubscriptionTable({ rows, avatarConfig, unpaidSummaryById, onEdit, onGenerate, onDelete }) {
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
            <th>Monthly Aging</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const unpaidSummary = unpaidSummaryById?.get(row.id) || {};
            return (
              <tr key={row.id}>
                <td>
                  <div className="d-flex align-items-center gap-2">
                    <CustomerEmotionAvatar customer={row.customer} avatarConfig={avatarConfig} context={{ billing: row }} size={32} />
                    <span>{customerLabel(row.customer)}</span>
                  </div>
                </td>
                <td>{row.planName}</td>
                <td><span className={`badge ${statusClass(row.billingMode)}`}>{row.billingMode}</span></td>
                <td>
                  <div>{currency(row.monthlyRate)}</div>
                  {row.pricingSource === 'PRICE_OVERRIDE' && <div className="text-muted small">Override: {currency(row.priceOverrideAmount)}</div>}
                  {row.earlyBirdEligible && <div className="text-muted small">{row.earlyBirdPromotionCode ? `${row.earlyBirdPromotionCode}: ` : ''}Promo qualified {currency(row.earlyBirdDiscountAmount)}</div>}
                </td>
                <td>{row.nextInvoiceDate}</td>
                <td>
                  <MonthlyAgingCell
                    unpaidSummary={unpaidSummary}
                    missingSummary={row}
                  />
                </td>
                <td><span className={`badge ${statusClass(row.status)}`}>{row.status}</span></td>
                <td className="text-end">
                  <button className="btn btn-sm me-1" type="button" title="Edit subscription" aria-label="Edit subscription" onClick={() => onEdit(row)}><IconEdit size={14} /></button>
                  <button className="btn btn-sm btn-primary me-1" type="button" title="Generate invoice" aria-label="Generate invoice" onClick={() => onGenerate(row.id, row.nextInvoiceDate)}><IconFileInvoice size={14} /></button>
                  <button className="btn btn-sm btn-outline-danger" type="button" title="Cancel subscription" aria-label="Cancel subscription" onClick={() => onDelete(row.id)}><IconTrash size={14} /></button>
                </td>
              </tr>
            );
          })}
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
	                {invoiceTypeLabel(row.invoiceType) && <div className="text-muted small">{invoiceTypeLabel(row.invoiceType)}</div>}
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
              <td>
                <div>{currency(row.balance)}</div>
                {earlyBirdInvoiceNote(row) && <div className="text-muted small">{earlyBirdInvoiceNote(row)}</div>}
              </td>
              <td><span className={`badge ${statusClass(row.status)}`}>{row.status.replaceAll('_', ' ')}</span></td>
              <td className="text-end">
                {row.status === 'DRAFT' && (
                  <button className="btn btn-sm me-1" type="button" title="Edit draft invoice" aria-label="Edit draft invoice" onClick={() => onEdit(row)}><IconEdit size={14} /></button>
                )}
                {row.status !== 'VOID' && !row.subscriptionId && row.invoiceType !== 'INSTALLATION_FEE' && (
                  <button className="btn btn-sm btn-outline-danger" type="button" title="Void invoice" aria-label="Void invoice" onClick={() => onVoid(row.id)}><IconTrash size={14} /></button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdjustmentTable({ rows, onVoid }) {
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
                {row.status === 'POSTED' && (
                  <button className="btn btn-sm btn-outline-danger" type="button" title="Void adjustment" aria-label="Void adjustment" onClick={() => onVoid(row.id)}><IconTrash size={14} /></button>
                )}
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
            <th>Monthly Aging</th>
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
              <td>
                <MonthlyAgingCell
                  unpaidSummary={row}
                  missingSummary={row}
                  showAmounts
                />
              </td>
              <td>{currency(row.overdueTotal)}</td>
              <td>{row.openInvoices}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
