import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconCash,
  IconChevronLeft,
  IconChevronRight,
  IconCreditCard,
  IconDeviceFloppy,
  IconDiscount2,
  IconDownload,
  IconEdit,
  IconEye,
  IconFileInvoice,
  IconMessage,
  IconPlayerPlay,
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
const DEFAULT_INVOICE_PAGE_SIZE = 20;
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

function formatDateTime(value, timeZone = 'Asia/Manila') {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone
  }).format(parsed);
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

function invoiceBillingPeriod(invoice) {
  const start = invoice?.billingCycleStart || invoice?.issueDate || '';
  const end = invoice?.billingCycleEnd || start;
  const startMonth = String(start).slice(0, 7);
  const endMonth = String(end).slice(0, 7);
  const fallbackLabel = startMonth === endMonth
    ? formatMonth(start)
    : `${formatMonth(start)} - ${formatMonth(end)}`;
  return {
    label: invoice?.billingPeriodLabel || fallbackLabel,
    coverage: start === end ? formatDate(start) : `${formatDate(start)} - ${formatDate(end)}`
  };
}

function currency(value) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0));
}

function smsCurrency(value) {
  return `PHP ${new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0))}`;
}

function collectionFollowUpMessage(account, asOf) {
  const customer = account?.customer || {};
  const firstName = String(customer.firstName || customer.name || 'Customer').trim().split(/\s+/)[0];
  const accountReference = customer.accountNumber ? ` for account ${customer.accountNumber}` : '';
  const overdue = Number(account?.overdueBalance || 0);
  const balance = Number(account?.outstandingBalance || 0);
  const balanceText = overdue > 0
    ? `an overdue balance of ${smsCurrency(overdue)} and a total open balance of ${smsCurrency(balance)}`
    : `an open balance of ${smsCurrency(balance)}`;
  return `Good day, ${firstName}. This is 3J Computer and Internet Installation Services. As of ${formatDate(asOf)}, you have ${balanceText}${accountReference}. Please settle your account or contact our office if payment has already been made. Thank you.`;
}

function percent(value, applicable = true) {
  if (!applicable) return '-';
  return `${new Intl.NumberFormat('en-PH', { maximumFractionDigits: 1 }).format(Number(value || 0))}%`;
}

function collectionPerformancePath({ billingMonth, asOf, status, search, page, pageSize }) {
  const params = new URLSearchParams();
  if (billingMonth) params.set('billingMonth', billingMonth);
  if (asOf) params.set('asOf', asOf);
  if (status && status !== 'ALL') params.set('status', status);
  if (search) params.set('search', search);
  params.set('page', String(page || 1));
  params.set('pageSize', String(pageSize || 20));
  return `/billing/collection-performance?${params.toString()}`;
}

function collectionWorklistPath({ asOf, billingPeriod, status, search, page, pageSize }) {
  const params = new URLSearchParams();
  if (asOf) params.set('asOf', asOf);
  if (billingPeriod && billingPeriod !== 'ALL') params.set('billingPeriod', billingPeriod);
  if (status) params.set('status', status);
  if (search) params.set('search', search);
  params.set('page', String(page || 1));
  params.set('pageSize', String(pageSize || 20));
  return `/billing/collections/worklist?${params.toString()}`;
}

function collectionAccountPath(customerId, { asOf, billingPeriod = 'ALL' } = {}) {
  const params = new URLSearchParams();
  if (asOf) params.set('asOf', asOf);
  if (billingPeriod && billingPeriod !== 'ALL') params.set('billingPeriod', billingPeriod);
  const query = params.toString();
  return `/billing/collections/accounts/${customerId}${query ? `?${query}` : ''}`;
}

function adjustmentEntryLabel(adjustment) {
  if (adjustment.adjustmentSource === 'SERVICE_REBATE') return 'REBATE';
  if (['PAYMENT_PROMOTION', 'EARLY_BIRD_DISCOUNT'].includes(adjustment.adjustmentSource)) return 'PROMOTION';
  return adjustment.type || 'ADJUSTMENT';
}

function statusClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (['active', 'paid', 'fully_paid', 'posted', 'completed', 'created', 'replayed', 'resolved'].includes(normalized)) return 'bg-green-lt text-green';
  if (['waived', 'no_fee'].includes(normalized)) return 'bg-green-lt text-green';
  if (['issued', 'partially_paid', 'pending', 'draft', 'invoiced', 'scheduled', 'paused', 'partial_success'].includes(normalized)) return 'bg-yellow-lt text-yellow';
  if (['unpaid', 'overdue', 'void', 'cancelled', 'expired', 'archived', 'failed'].includes(normalized)) return 'bg-red-lt text-red';
  if (['running'].includes(normalized)) return 'bg-blue-lt text-blue';
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

function promotionBundlePreview(promotionRows, baseAmount) {
  const ordered = [...(promotionRows || [])].sort((left, right) => (
    Number(right.priority || 0) - Number(left.priority || 0)
    || String(left.promoCode || left.name || '').localeCompare(String(right.promoCode || right.name || ''))
  ));
  let remaining = Math.max(0, Number(baseAmount || 0));
  const promotions = ordered.map((promotion) => {
    const discountAmount = Math.min(remaining, promotionDiscountAmount(promotion, remaining));
    remaining = Math.max(0, Math.round((remaining - discountAmount) * 100) / 100);
    return { ...promotion, discountAmountForInvoice: discountAmount, discountedPayable: remaining };
  }).filter((promotion) => promotion.discountAmountForInvoice > 0);
  return {
    promotions,
    discountAmount: Math.max(0, Math.round((Number(baseAmount || 0) - remaining) * 100) / 100),
    discountedPayable: remaining
  };
}

function promotionEligibilityLabel(promotion) {
  return promotion.billingMode || 'Any billing mode';
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

function currentCustomerRebateInvoice(rows, customerId) {
  const openServiceInvoices = rows.filter((invoice) => (
    invoice.customerId === customerId
    && invoice.invoiceType !== 'INSTALLATION_FEE'
    && !['DRAFT', 'PAID', 'VOID'].includes(String(invoice.status || '').toUpperCase())
    && Number(invoice.balance || 0) > 0
  ));
  const monthlyInvoices = openServiceInvoices.filter((invoice) => MONTHLY_INVOICE_TYPES.has(String(invoice.invoiceType || '').toUpperCase()));
  const eligibleInvoices = monthlyInvoices.length ? monthlyInvoices : openServiceInvoices;
  return [...eligibleInvoices].sort((left, right) => {
    const leftKey = `${left.billingCycleStart || ''}|${left.issueDate || ''}|${left.createdAt || ''}|${left.invoiceNumber || ''}`;
    const rightKey = `${right.billingCycleStart || ''}|${right.issueDate || ''}|${right.createdAt || ''}|${right.invoiceNumber || ''}`;
    return rightKey.localeCompare(leftKey);
  })[0] || null;
}

function formatDuration(minutesValue) {
  const minutes = Number(minutesValue || 0);
  if (!Number.isFinite(minutes) || minutes <= 0) return '-';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const totalHours = minutes / 60;
  if (totalHours < 24) return `${Number(totalHours.toFixed(2))} hr`;
  const days = Math.floor(totalHours / 24);
  const remainingHours = Number((totalHours - (days * 24)).toFixed(2));
  return remainingHours ? `${days} d ${remainingHours} hr` : `${days} d`;
}

function localDateTimeInputValue(value = new Date()) {
  const localValue = new Date(value.getTime() - (value.getTimezoneOffset() * 60000));
  return localValue.toISOString().slice(0, 16);
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

function generatedSubscriptionInvoiceDates(subscription, cycleStartValue) {
  const issueDate = dateFromIso(today());
  const cycleStart = dateFromIso(cycleStartValue);
  const cycleEnd = monthEndDate(cycleStartValue);
  if (!issueDate || !cycleStart || !cycleEnd) return null;
  const contractualDueDate = subscription.billingMode === 'PREPAID' ? cycleStart : cycleEnd;
  const dueBase = new Date(Math.max(contractualDueDate.getTime(), issueDate.getTime()));
  const dueDate = subscription.billingMode === 'POSTPAID'
    ? addDays(dueBase, subscription.dueDays || 0)
    : dueBase;
  return {
    cycleStart: isoFromDate(cycleStart),
    cycleEnd: isoFromDate(cycleEnd),
    issueDate: isoFromDate(issueDate),
    dueDate: isoFromDate(dueDate)
  };
}

function firstSubscriptionInvoicePreview(subscription) {
  if (!['PREPAID', 'POSTPAID'].includes(subscription.billingMode) || !subscription.startDate) return null;
  const cycleStart = dateFromIso(subscription.startDate);
  const cycleEnd = monthEndDate(subscription.startDate);
  const nextFullCycleStart = nextMonthStartDate(subscription.startDate);
  const invoiceDates = generatedSubscriptionInvoiceDates(subscription, subscription.startDate);
  if (!cycleStart || !cycleEnd || !nextFullCycleStart || !invoiceDates) return null;
  const serviceDays = inclusiveDays(cycleStart, cycleEnd);
  const daysInCycle = cycleEnd.getUTCDate();
  const monthlyRate = subscriptionEffectiveRate(subscription);
  const isProrated = serviceDays < daysInCycle;
  const firstInvoiceAmount = isProrated ? Math.ceil(monthlyRate * serviceDays / daysInCycle) : monthlyRate;
  const nextFullCycleEnd = monthEndDate(isoFromDate(nextFullCycleStart));
  const qualifiedPromotions = subscription.qualifiedPromotions?.length
    ? subscription.qualifiedPromotions
    : (
      subscription.earlyBirdEligible && subscription.earlyBirdPromotionId
        ? [{
          id: subscription.earlyBirdPromotionId,
          promoCode: subscription.earlyBirdPromotionCode,
          name: subscription.earlyBirdPromotionName,
          paymentRule: 'EARLY_BIRD',
          discountType: 'FIXED_AMOUNT',
          discountAmount: Number(subscription.earlyBirdDiscountAmount || 0),
          priority: 0,
          stackable: false
        }]
        : []
    );
  const promotionQuote = promotionBundlePreview(qualifiedPromotions, monthlyRate);
  const earlyBirdQualified = qualifiedPromotions.some((promotion) => promotionPaymentRule(promotion) === 'EARLY_BIRD');
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
    issueDate: invoiceDates.issueDate,
    dueDate: invoiceDates.dueDate,
    nextFullCycleStart: isoFromDate(nextFullCycleStart),
    nextFullCycleEnd: nextFullCycleEnd ? isoFromDate(nextFullCycleEnd) : '',
    promotionQualified: promotionQuote.promotions.length > 0,
    qualifiedPromotionCount: promotionQuote.promotions.length,
    promotionDiscount: promotionQuote.discountAmount,
    promotionPayableAmount: promotionQuote.discountedPayable,
    earlyBirdEligible: earlyBirdQualified,
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

function Modal({ title, icon: Icon, open, onClose, children, size = 'default' }) {
  if (!open) return null;
  return (
    <div className="billing-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`billing-modal ${size === 'wide' ? 'billing-modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
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
      <input className="form-control" type={type} value={value ?? ''} min={min} max={max} step={step} required={required} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function SelectField({ label, value, onChange, options, required = false, disabled = false, children }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <select className="form-select" value={value ?? ''} required={required} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.value)}>
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
  qualifiedPromotionIds: [],
  qualifiedPromotions: [],
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
  customerIds: [],
  customerSearch: '',
  outageStart: '',
  outageEnd: ''
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
  paymentRule: 'ANY_PAYMENT',
  priority: '100',
  requiresApproval: false,
  stackable: false,
  notes: ''
};

export default function BillingPage({ refreshShell = () => {} }) {
  const [activeTab, setActiveTab] = useState('Overview');
  const [meta, setMeta] = useState({ billingModes: [], subscriptionStatuses: [], invoiceStatuses: [], paymentMethods: [], paymentStatuses: [], adjustmentTypes: [], adjustmentStatuses: [], installationChargeStatuses: [], promotionStatuses: [], promotionScopes: [], promotionDiscountTypes: [], promotionPaymentRules: [] });
  const [collectionPerformance, setCollectionPerformance] = useState({
    rows: [],
    receivables: { agingBuckets: [] },
    pagination: { page: 1, pageSize: 20, totalRows: 0, totalPages: 1 }
  });
  const [collectionMonth, setCollectionMonth] = useState(today().slice(0, 7));
  const [collectionAsOf, setCollectionAsOf] = useState(today());
  const [collectionWorklist, setCollectionWorklist] = useState({
    scope: 'ALL_OPEN_RECEIVABLES',
    billingPeriod: 'ALL',
    availableBillingPeriods: [],
    summary: {},
    rows: [],
    pagination: { page: 1, pageSize: 20, totalRows: 0, totalPages: 1 }
  });
  const [collectionWorklistAsOf, setCollectionWorklistAsOf] = useState(today());
  const [collectionBillingPeriod, setCollectionBillingPeriod] = useState('ALL');
  const [collectionStatus, setCollectionStatus] = useState('ACTION_REQUIRED');
  const [collectionSearch, setCollectionSearch] = useState('');
  const [collectionPage, setCollectionPage] = useState(1);
  const [collectionPageSize, setCollectionPageSize] = useState(20);
  const [collectionPerformanceBusy, setCollectionPerformanceBusy] = useState(false);
  const [collectionWorklistBusy, setCollectionWorklistBusy] = useState(false);
  const collectionPerformanceFiltersReady = useRef(false);
  const collectionWorklistFiltersReady = useRef(false);
  const collectionRequestSequence = useRef(0);
  const collectionWorklistRequestSequence = useRef(0);
  const [customers, setCustomers] = useState([]);
  const [avatarConfig, setAvatarConfig] = useState(null);
  const [serviceOrders, setServiceOrders] = useState([]);
  const [serviceCatalog, setServiceCatalog] = useState([]);
  const [serviceAccounts, setServiceAccounts] = useState([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [subscriptionSearch, setSubscriptionSearch] = useState('');
  const [billingSetupFilter, setBillingSetupFilter] = useState('READY');
  const [promotionSearch, setPromotionSearch] = useState('');
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [promotionStatusFilter, setPromotionStatusFilter] = useState('');
  const [promotionScopeFilter, setPromotionScopeFilter] = useState('');
  const [invoicePage, setInvoicePage] = useState(1);
  const [invoicePageSize, setInvoicePageSize] = useState(DEFAULT_INVOICE_PAGE_SIZE);
  const [subscriptions, setSubscriptions] = useState([]);
  const [installationCharges, setInstallationCharges] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [balances, setBalances] = useState([]);
  const [billingRuns, setBillingRuns] = useState([]);
  const [billingRunPreview, setBillingRunPreview] = useState({
    businessDate: today(),
    dueSubscriptions: 0,
    dueCycles: 0,
    estimatedAmount: 0,
    invalidSubscriptions: [],
    scheduler: {}
  });
  const [selectedBillingRun, setSelectedBillingRun] = useState(null);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [selectedCollectionAccount, setSelectedCollectionAccount] = useState(null);
  const [collectionAccountBusy, setCollectionAccountBusy] = useState(false);
  const [collectionSmsForm, setCollectionSmsForm] = useState(null);
  const [collectionSmsBusy, setCollectionSmsBusy] = useState(false);
  const [invoiceDetailBusy, setInvoiceDetailBusy] = useState(false);
  const [invoicePdfBusyId, setInvoicePdfBusyId] = useState('');
  const [billingRunBusy, setBillingRunBusy] = useState(false);
  const [subscriptionForm, setSubscriptionForm] = useState(blankSubscription);
  const [installationChargeForm, setInstallationChargeForm] = useState(blankInstallationCharge);
  const [promotionForm, setPromotionForm] = useState(blankPromotion);
  const [invoiceForm, setInvoiceForm] = useState(blankInvoice);
  const [adjustmentForm, setAdjustmentForm] = useState(blankAdjustment);
  const [adjustmentPreview, setAdjustmentPreview] = useState(null);
  const [adjustmentPreviewBusy, setAdjustmentPreviewBusy] = useState(false);
  const [adjustmentPreviewError, setAdjustmentPreviewError] = useState('');
  const [adjustmentPreviewVersion, setAdjustmentPreviewVersion] = useState(0);
  const [adjustmentPostBusy, setAdjustmentPostBusy] = useState(false);
  const [invoiceIdempotencyKey, setInvoiceIdempotencyKey] = useState(() => newIdempotencyKey('billing-invoice'));
  const [adjustmentIdempotencyKey, setAdjustmentIdempotencyKey] = useState(() => newIdempotencyKey('billing-adjustment'));
  const [modal, setModal] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const notification = error ? { type: 'error', text: error } : (message ? { type: 'success', text: message } : null);

  const subscriptionByServiceAccountId = useMemo(() => new Map(subscriptions.filter((subscription) => subscription.serviceAccountId).map((subscription) => [subscription.serviceAccountId, subscription])), [subscriptions]);
  const installationChargeByServiceAccountId = useMemo(() => new Map(installationCharges.filter((charge) => charge.serviceAccountId && charge.status !== 'VOID').map((charge) => [charge.serviceAccountId, charge])), [installationCharges]);
  const customerById = useMemo(() => new Map(customers.map((customer) => [customer.id, customer])), [customers]);
  const serviceAccountById = useMemo(() => new Map(serviceAccounts.map((account) => [account.id, account])), [serviceAccounts]);
  const recurringServiceOrders = useMemo(() => serviceOrders.filter((order) => order.catalog?.billingMode !== 'ONE_TIME'), [serviceOrders]);
  const billableServiceAccounts = useMemo(() => serviceAccounts.filter((account) => account.catalog?.billingMode !== 'ONE_TIME'), [serviceAccounts]);
  const unbilledServiceAccounts = useMemo(() => billableServiceAccounts.filter((account) => !subscriptionByServiceAccountId.has(account.id)), [billableServiceAccounts, subscriptionByServiceAccountId]);
  const installationFeePendingAccounts = useMemo(() => unbilledServiceAccounts.filter((account) => !installationChargeResolved(installationChargeByServiceAccountId.get(account.id))), [unbilledServiceAccounts, installationChargeByServiceAccountId]);
  const monthlyBillingReadyAccounts = useMemo(() => unbilledServiceAccounts.filter((account) => installationChargeResolved(installationChargeByServiceAccountId.get(account.id))), [unbilledServiceAccounts, installationChargeByServiceAccountId]);
  const billingSetupAccounts = billingSetupFilter === 'INSTALLATION_PENDING'
    ? installationFeePendingAccounts
    : monthlyBillingReadyAccounts;
  const missingBillingCycleCount = useMemo(
    () => subscriptions.reduce((total, subscription) => total + Number(subscription.missingBillingCycles || 0), 0),
    [subscriptions]
  );
  const subscriptionsWithMissingCycles = useMemo(
    () => subscriptions.filter((subscription) => Number(subscription.missingBillingCycles || 0) > 0).length,
    [subscriptions]
  );
  const latestBillingRun = billingRuns[0] || null;
  const rebateCustomerCandidates = useMemo(() => {
    const candidateByCustomerId = new Map();
    subscriptions.forEach((subscription) => {
      if (subscription.status !== 'ACTIVE' || Number(subscription.monthlyRate || 0) <= 0) return;
      const customerId = subscription.customerId;
      const current = candidateByCustomerId.get(customerId) || {
        customerId,
        customer: subscription.customer || customerById.get(customerId),
        subscriptions: [],
        monthlyRecurringCharge: 0
      };
      current.subscriptions.push(subscription);
      current.monthlyRecurringCharge += Number(subscription.monthlyRate || 0);
      candidateByCustomerId.set(customerId, current);
    });
    return [...candidateByCustomerId.values()].map((candidate) => ({
      ...candidate,
      currentInvoice: currentCustomerRebateInvoice(invoices, candidate.customerId),
      monthlyRecurringCharge: Math.round(candidate.monthlyRecurringCharge * 100) / 100
    })).sort((left, right) => customerLabel(left.customer).localeCompare(customerLabel(right.customer)));
  }, [subscriptions, invoices, customerById]);
  const filteredRebateCustomerCandidates = useMemo(() => {
    const terms = String(adjustmentForm.customerSearch || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return rebateCustomerCandidates;
    return rebateCustomerCandidates.filter((candidate) => {
      const searchable = [
        customerLabel(candidate.customer),
        candidate.customer?.accountNumber,
        candidate.customer?.contactNumber,
        candidate.customer?.address,
        ...candidate.subscriptions.flatMap((subscription) => [
          subscription.planName,
          subscription.serviceAccountNumber,
          subscription.serviceId
        ])
      ].map((value) => String(value || '')).join(' ').toLowerCase();
      return terms.every((term) => searchable.includes(term));
    });
  }, [rebateCustomerCandidates, adjustmentForm.customerSearch]);
  const selectedRebateCustomerIdsKey = [...(adjustmentForm.customerIds || [])].sort().join('|');
  useEffect(() => {
    if (
      modal !== 'adjustment'
      || !selectedRebateCustomerIdsKey
      || !adjustmentForm.outageStart
      || !adjustmentForm.outageEnd
    ) {
      setAdjustmentPreview(null);
      setAdjustmentPreviewBusy(false);
      setAdjustmentPreviewError('');
      return undefined;
    }
    if (adjustmentForm.outageEnd <= adjustmentForm.outageStart) {
      setAdjustmentPreview(null);
      setAdjustmentPreviewBusy(false);
      setAdjustmentPreviewError('Outage end must be after outage start.');
      return undefined;
    }

    let cancelled = false;
    setAdjustmentPreview(null);
    setAdjustmentPreviewBusy(true);
    setAdjustmentPreviewError('');
    const timer = window.setTimeout(async () => {
      try {
        const preview = await request('/billing/adjustments/outage-rebates/preview', {
          method: 'POST',
          body: JSON.stringify({
            customerIds: adjustmentForm.customerIds,
            outageStart: adjustmentForm.outageStart,
            outageEnd: adjustmentForm.outageEnd
          })
        });
        if (!cancelled) setAdjustmentPreview(preview);
      } catch (previewError) {
        if (!cancelled) setAdjustmentPreviewError(previewError.message);
      } finally {
        if (!cancelled) setAdjustmentPreviewBusy(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    modal,
    selectedRebateCustomerIdsKey,
    adjustmentForm.outageStart,
    adjustmentForm.outageEnd,
    adjustmentPreviewVersion
  ]);
  const applicableSubscriptionPromotions = useMemo(() => promotions.filter((promotion) => (
    promotion.appliesTo === 'MONTHLY_SERVICE'
    && (
      (promotionActiveNow(promotion) && !promotion.requiresApproval)
      || (subscriptionForm.qualifiedPromotionIds || []).includes(promotion.id)
    )
    && (!promotion.billingMode || promotion.billingMode === subscriptionForm.billingMode)
  )).sort((left, right) => (
    Number(right.priority || 0) - Number(left.priority || 0)
    || String(left.promoCode || left.name || '').localeCompare(String(right.promoCode || right.name || ''))
  )), [promotions, subscriptionForm.billingMode, subscriptionForm.qualifiedPromotionIds]);
  const applicableInstallationPromotions = useMemo(() => promotions.filter((promotion) => (
    promotion.appliesTo === 'INSTALLATION_FEE'
    && promotionActiveNow(promotion)
    && (!promotion.billingMode || promotion.billingMode === installationChargeForm.billingMode)
  )), [promotions, installationChargeForm.billingMode]);
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
      return [
        promotion.name,
        promotion.promoCode,
        promotion.description,
        promotion.notes,
        promotion.appliesTo,
        promotion.discountType,
        promotion.billingMode,
        promotionStatus(promotion),
      ].some((value) => String(value || '').toLowerCase().includes(needle));
    });
  }, [promotions, promotionSearch, promotionStatusFilter, promotionScopeFilter]);
  const filteredInvoices = useMemo(() => {
    const terms = invoiceSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return invoices;
    return invoices.filter((invoice) => {
      const customer = invoice.customer || customerById.get(invoice.customerId) || {};
      const period = invoiceBillingPeriod(invoice);
      const searchableText = [
        customerLabel(customer),
        customer.name,
        customer.fullName,
        customer.firstName,
        customer.middleName,
        customer.lastName,
        customer.accountNumber,
        customer.contactNumber,
        customer.address,
        invoice.customerId,
        invoice.invoiceNumber,
        invoice.invoiceType,
        invoice.status,
        invoice.billingPeriodMonth,
        invoice.billingPeriodLabel,
        invoice.billingCycleStart,
        invoice.billingCycleEnd,
        period.label,
        period.coverage,
        invoice.serviceId,
        invoice.serviceAccountId,
        invoice.serviceAccountNumber,
        invoice.serviceOrderId,
        invoice.catalogCode,
        invoice.catalogName,
        invoice.billingMode,
        invoice.subscription?.planName,
      ].map((value) => String(value || '')).join(' ').toLowerCase();
      return terms.every((term) => searchableText.includes(term));
    });
  }, [invoices, invoiceSearch, customerById]);
  const invoicePageCount = Math.max(1, Math.ceil(filteredInvoices.length / invoicePageSize));
  const currentInvoicePage = Math.min(invoicePage, invoicePageCount);
  const invoicePageStartIndex = (currentInvoicePage - 1) * invoicePageSize;
  const paginatedInvoices = filteredInvoices.slice(invoicePageStartIndex, invoicePageStartIndex + invoicePageSize);
  useEffect(() => {
    setInvoicePage((currentPage) => Math.min(currentPage, invoicePageCount));
  }, [invoicePageCount]);
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
    const collectionRequestId = collectionRequestSequence.current + 1;
    collectionRequestSequence.current = collectionRequestId;
    const worklistRequestId = collectionWorklistRequestSequence.current + 1;
    collectionWorklistRequestSequence.current = worklistRequestId;
    setCollectionPerformanceBusy(true);
    setCollectionWorklistBusy(true);
    setError('');
    try {
      const [nextMeta, nextCollectionPerformance, nextCollectionWorklist, nextCustomers, nextServiceOrders, nextServiceCatalog, nextServiceAccounts, nextSubscriptions, nextInstallationCharges, nextPromotions, nextInvoices, nextAdjustments, nextBalances, nextBillingRuns, nextBillingRunPreview, nextAvatarConfig] = await Promise.all([
        request('/billing/meta'),
        request(collectionPerformancePath({
          billingMonth: collectionMonth,
          asOf: collectionAsOf,
          status: 'ALL',
          search: '',
          page: 1,
          pageSize: 10
        })),
        request(collectionWorklistPath({
          asOf: collectionWorklistAsOf,
          billingPeriod: collectionBillingPeriod,
          status: collectionStatus,
          search: collectionSearch,
          page: collectionPage,
          pageSize: collectionPageSize
        })),
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
        request('/billing/billing-runs'),
        request('/billing/billing-runs/preview'),
        request('/system-settings/avatars').catch(() => null)
      ]);
      setMeta(nextMeta);
      if (collectionRequestId === collectionRequestSequence.current) {
        setCollectionPerformance(nextCollectionPerformance);
        setCollectionMonth(nextCollectionPerformance.billingMonth);
        setCollectionAsOf(nextCollectionPerformance.asOfDate);
      }
      if (worklistRequestId === collectionWorklistRequestSequence.current) {
        setCollectionWorklist(nextCollectionWorklist);
        setCollectionWorklistAsOf(nextCollectionWorklist.asOfDate);
        setCollectionBillingPeriod(nextCollectionWorklist.billingPeriod || 'ALL');
        setCollectionStatus(nextCollectionWorklist.selectedStatus || 'ACTION_REQUIRED');
        setCollectionPage(nextCollectionWorklist.pagination?.page || 1);
      }
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
      setBillingRuns(nextBillingRuns);
      setBillingRunPreview(nextBillingRunPreview);
      setAvatarConfig(nextAvatarConfig);
    } catch (err) {
      showError(err.message);
    } finally {
      if (collectionRequestId === collectionRequestSequence.current) {
        setCollectionPerformanceBusy(false);
      }
      if (worklistRequestId === collectionWorklistRequestSequence.current) {
        setCollectionWorklistBusy(false);
      }
    }
  }

  async function loadCollectionPerformance() {
    const collectionRequestId = collectionRequestSequence.current + 1;
    collectionRequestSequence.current = collectionRequestId;
    setCollectionPerformanceBusy(true);
    try {
      const report = await request(collectionPerformancePath({
        billingMonth: collectionMonth,
        asOf: collectionAsOf,
        status: 'ALL',
        search: '',
        page: 1,
        pageSize: 10
      }));
      if (collectionRequestId !== collectionRequestSequence.current) return;
      setCollectionPerformance(report);
      setCollectionMonth(report.billingMonth);
      setCollectionAsOf(report.asOfDate);
    } catch (err) {
      if (collectionRequestId === collectionRequestSequence.current) {
        showError(err.message);
      }
    } finally {
      if (collectionRequestId === collectionRequestSequence.current) {
        setCollectionPerformanceBusy(false);
      }
    }
  }

  async function loadCollectionWorklist() {
    const requestId = collectionWorklistRequestSequence.current + 1;
    collectionWorklistRequestSequence.current = requestId;
    setCollectionWorklistBusy(true);
    try {
      const report = await request(collectionWorklistPath({
        asOf: collectionWorklistAsOf,
        billingPeriod: collectionBillingPeriod,
        status: collectionStatus,
        search: collectionSearch,
        page: collectionPage,
        pageSize: collectionPageSize
      }));
      if (requestId !== collectionWorklistRequestSequence.current) return;
      setCollectionWorklist(report);
      setCollectionWorklistAsOf(report.asOfDate);
      setCollectionBillingPeriod(report.billingPeriod || 'ALL');
      setCollectionStatus(report.selectedStatus || 'ACTION_REQUIRED');
      setCollectionPage(report.pagination?.page || 1);
    } catch (err) {
      if (requestId === collectionWorklistRequestSequence.current) {
        showError(err.message);
      }
    } finally {
      if (requestId === collectionWorklistRequestSequence.current) {
        setCollectionWorklistBusy(false);
      }
    }
  }

  function openCollectionWorklist(status = 'ACTION_REQUIRED', billingPeriod = 'ALL') {
    setCollectionPage(1);
    setCollectionStatus(status);
    setCollectionBillingPeriod(billingPeriod || 'ALL');
    setActiveTab('Collections');
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!collectionPerformanceFiltersReady.current) {
      collectionPerformanceFiltersReady.current = true;
      return undefined;
    }
    const timer = window.setTimeout(() => {
      loadCollectionPerformance();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    collectionMonth,
    collectionAsOf
  ]);

  useEffect(() => {
    if (!collectionWorklistFiltersReady.current) {
      collectionWorklistFiltersReady.current = true;
      return undefined;
    }
    const timer = window.setTimeout(() => {
      loadCollectionWorklist();
    }, collectionSearch ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [
    collectionWorklistAsOf,
    collectionBillingPeriod,
    collectionStatus,
    collectionSearch,
    collectionPage,
    collectionPageSize
  ]);

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

  function subscriptionPromotionFields(promotionIds, form = subscriptionForm) {
    const selectedPromotions = promotions
      .filter((promotion) => promotionIds.includes(promotion.id))
      .sort((left, right) => (
        Number(right.priority || 0) - Number(left.priority || 0)
        || String(left.promoCode || left.name || '').localeCompare(String(right.promoCode || right.name || ''))
      ));
    const earlyBirdPromotion = selectedPromotions.find((promotion) => promotionPaymentRule(promotion) === 'EARLY_BIRD');
    return {
      qualifiedPromotionIds: selectedPromotions.map((promotion) => promotion.id),
      qualifiedPromotions: selectedPromotions,
      earlyBirdEligible: Boolean(earlyBirdPromotion),
      earlyBirdPromotionId: earlyBirdPromotion?.id || '',
      earlyBirdPromotionCode: earlyBirdPromotion?.promoCode || '',
      earlyBirdPromotionName: earlyBirdPromotion?.name || '',
      earlyBirdDiscountAmount: earlyBirdPromotion
        ? String(promotionDiscountAmount(earlyBirdPromotion, subscriptionEffectiveRate(form)))
        : ''
    };
  }

  function toggleQualifiedPromotion(promotionId) {
    const promotion = promotions.find((item) => item.id === promotionId);
    if (!promotion) return;
    const currentIds = subscriptionForm.qualifiedPromotionIds || [];
    if (currentIds.includes(promotionId)) {
      const nextIds = currentIds.filter((id) => id !== promotionId);
      setSubscriptionForm({
        ...subscriptionForm,
        ...subscriptionPromotionFields(nextIds)
      });
      return;
    }
    const currentPromotions = promotions.filter((item) => currentIds.includes(item.id));
    if (currentPromotions.length && (!promotion.stackable || currentPromotions.some((item) => !item.stackable))) {
      showError('Multiple promotions can only be combined when every selected promotion is marked stackable.');
      return;
    }
    const nextIds = [...currentIds, promotionId];
    setSubscriptionForm({
      ...subscriptionForm,
      ...subscriptionPromotionFields(nextIds)
    });
  }

  function setSubscriptionBillingMode(billingMode) {
    const nextForm = {
      ...subscriptionForm,
      billingMode,
      dueDays: billingMode === 'POSTPAID' ? '7' : '0',
      nextInvoiceDate: nextMonthStartDate(subscriptionForm.startDate) ? isoFromDate(nextMonthStartDate(subscriptionForm.startDate)) : subscriptionForm.startDate
    };
    const keepPromotionIds = (subscriptionForm.qualifiedPromotionIds || []).filter((promotionId) => {
      const promotion = promotions.find((item) => item.id === promotionId);
      return promotion && (!promotion.billingMode || promotion.billingMode === billingMode);
    });
    setSubscriptionForm({
      ...nextForm,
      ...subscriptionPromotionFields(keepPromotionIds, nextForm)
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
    const draft = {
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
      dueDays: mode === 'POSTPAID' ? '7' : '0',
      startDate: serviceDate || base.startDate,
      nextInvoiceDate: nextInvoiceDate || base.nextInvoiceDate,
      notes: base.notes || `Linked to ${account.serviceAccountNumber || 'Service Account'}.`
    };
    const compatiblePromotionIds = (base.qualifiedPromotionIds || []).filter((promotionId) => {
      const promotion = promotions.find((item) => item.id === promotionId);
      return promotion && (!promotion.billingMode || promotion.billingMode === mode);
    });
    return {
      ...draft,
      ...subscriptionPromotionFields(compatiblePromotionIds, draft)
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

  function openBillingSetupQueue(filter) {
    setBillingSetupFilter(filter);
    setActiveTab('Subscriptions');
  }

  function selectedInvoiceSubscription(subscriptionId) {
    return subscriptions.find((item) => item.id === subscriptionId);
  }

  function invoiceDraftForSubscription(subscriptionId) {
    const subscription = selectedInvoiceSubscription(subscriptionId);
    const cycleStart = subscription?.nextInvoiceDate || invoiceForm.billingCycleStart || today();
    const invoiceDates = subscription ? generatedSubscriptionInvoiceDates(subscription, cycleStart) : null;
    return {
      ...invoiceForm,
      subscriptionId,
      customerId: subscription?.customerId || invoiceForm.customerId,
      amount: subscription ? String(subscription.monthlyRate) : invoiceForm.amount,
      description: subscription ? subscriptionInvoiceDescription(subscription) : invoiceForm.description,
      ...(invoiceDates ? {
        billingCycleStart: invoiceDates.cycleStart,
        billingCycleEnd: invoiceDates.cycleEnd,
        issueDate: invoiceDates.issueDate,
        dueDate: invoiceDates.dueDate
      } : {})
    };
  }

  function closeModal() {
    setModal(null);
    setSelectedBillingRun(null);
    setSelectedInvoice(null);
    setSelectedCollectionAccount(null);
    setCollectionSmsForm(null);
    setInvoiceDetailBusy(false);
    setCollectionAccountBusy(false);
    setCollectionSmsBusy(false);
    setAdjustmentPreview(null);
    setAdjustmentPreviewBusy(false);
    setAdjustmentPreviewError('');
    setAdjustmentPostBusy(false);
  }

  function openBillingRun(run) {
    setSelectedBillingRun(run);
    setModal('billing-run');
  }

  async function openInvoiceDetail(invoice) {
    setSelectedInvoice(invoice);
    setInvoiceDetailBusy(true);
    setModal('invoice-detail');
    try {
      const detail = await request(`/billing/invoices/${invoice.id}`);
      setSelectedInvoice(detail);
    } catch (err) {
      showError(err.message);
    } finally {
      setInvoiceDetailBusy(false);
    }
  }

  async function downloadInvoicePdf(invoice) {
    setInvoicePdfBusyId(invoice.id);
    try {
      const response = await fetch(`${API}/billing/invoices/${invoice.id}/pdf`, {
        headers: token() ? { Authorization: `Bearer ${token()}` } : {}
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || 'Invoice PDF download failed');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const dispositionFilename = disposition.match(/filename="?([^";]+)"?/i)?.[1];
      const filename = dispositionFilename || `${invoice.invoiceNumber || 'invoice'}.pdf`;
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err) {
      showError(err.message);
    } finally {
      setInvoicePdfBusyId('');
    }
  }

  async function fetchCollectionAccount(customerId, billingPeriod = collectionBillingPeriod) {
    return request(collectionAccountPath(customerId, {
      asOf: collectionWorklistAsOf,
      billingPeriod
    }));
  }

  async function openCollectionAccount(account) {
    setSelectedCollectionAccount(account);
    setCollectionAccountBusy(true);
    setModal('collection-account');
    try {
      const detail = await fetchCollectionAccount(account.customerId);
      setSelectedCollectionAccount(detail);
    } catch (err) {
      showError(err.message);
    } finally {
      setCollectionAccountBusy(false);
    }
  }

  async function openCollectionSms(account) {
    setCollectionAccountBusy(true);
    try {
      const detail = await fetchCollectionAccount(account.customerId, 'ALL');
      setCollectionSmsForm({
        account: detail,
        messageText: collectionFollowUpMessage(detail, collectionWorklistAsOf).slice(0, 500)
      });
      setModal('collection-sms');
    } catch (err) {
      showError(err.message);
    } finally {
      setCollectionAccountBusy(false);
    }
  }

  async function submitCollectionSms(event) {
    event.preventDefault();
    if (!collectionSmsForm?.account?.customerId || !collectionSmsForm.messageText.trim()) return;
    setCollectionSmsBusy(true);
    try {
      const result = await request(
        `/billing/collections/accounts/${collectionSmsForm.account.customerId}/follow-up-sms`,
        {
          method: 'POST',
          body: JSON.stringify({
            messageText: collectionSmsForm.messageText.trim(),
            asOf: collectionWorklistAsOf
          })
        }
      );
      closeModal();
      showMessage(`Collection follow-up SMS accepted for ${customerLabel(collectionSmsForm.account.customer)}${result.messageId ? ` (${result.messageId})` : ''}.`);
    } catch (err) {
      showError(err.message);
      setCollectionSmsBusy(false);
    }
  }

  async function runBillingNow() {
    const dueCycles = Number(billingRunPreview.dueCycles || 0);
    const invalidCount = Number(billingRunPreview.invalidSubscriptions?.length || 0);
    const confirmation = dueCycles
      ? `Generate ${dueCycles} due invoice${dueCycles === 1 ? '' : 's'} for ${currency(billingRunPreview.estimatedAmount)}?`
      : invalidCount
        ? `Run billing with ${invalidCount} subscription exception${invalidCount === 1 ? '' : 's'}?`
        : 'Run billing reconciliation now?';
    if (!window.confirm(confirmation)) return;
    setBillingRunBusy(true);
    try {
      const run = await request('/billing/billing-runs/run', {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey('billing-run') },
        body: JSON.stringify({ asOf: billingRunPreview.businessDate || today() })
      });
      if (run.status === 'COMPLETED') {
        showMessage(`Billing run completed: ${run.invoicesCreated || 0} invoice${run.invoicesCreated === 1 ? '' : 's'} created.`);
      } else {
        showError(`Billing run ${String(run.status || 'failed').replaceAll('_', ' ').toLowerCase()}: ${run.failedCycles || 0} exception${run.failedCycles === 1 ? '' : 's'}.`);
      }
      await load();
      refreshShell();
    } catch (err) {
      showError(err.message);
    } finally {
      setBillingRunBusy(false);
    }
  }

  function openSubscriptionForm(subscription = null) {
    if (!subscription) {
      setSubscriptionForm(blankSubscription);
      setModal('subscription');
      return;
    }
    const form = {
      ...blankSubscription,
      ...subscription,
      listMonthlyRate: String(subscription.listMonthlyRate ?? subscription.monthlyRate),
      monthlyRate: String(subscription.monthlyRate),
      billingDay: String(subscription.billingDay),
      dueDays: String(subscription.dueDays),
      priceOverrideEnabled: subscription.pricingSource === 'PRICE_OVERRIDE',
      priceOverrideAmount: subscription.priceOverrideAmount != null ? String(subscription.priceOverrideAmount) : '',
      priceOverrideReason: subscription.priceOverrideReason || ''
    };
    const promotionIds = subscription.qualifiedPromotionIds?.length
      ? subscription.qualifiedPromotionIds
      : (subscription.earlyBirdPromotionId ? [subscription.earlyBirdPromotionId] : []);
    setSubscriptionForm({
      ...form,
      ...subscriptionPromotionFields(promotionIds, form)
    });
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

  function openAdjustmentForm() {
    setAdjustmentIdempotencyKey(newIdempotencyKey('billing-outage-rebate'));
    setAdjustmentForm({ ...blankAdjustment, customerIds: [] });
    setAdjustmentPreview(null);
    setAdjustmentPreviewBusy(false);
    setAdjustmentPreviewError('');
    setAdjustmentPreviewVersion(0);
    setAdjustmentPostBusy(false);
    setModal('adjustment');
  }

  function toggleRebateCustomer(customerId) {
    const currentIds = adjustmentForm.customerIds || [];
    const nextIds = currentIds.includes(customerId)
      ? currentIds.filter((id) => id !== customerId)
      : [...currentIds, customerId];
    if (nextIds.length > 500) {
      setAdjustmentPreviewError('A rebate batch cannot exceed 500 customers.');
      return;
    }
    setAdjustmentForm({ ...adjustmentForm, customerIds: nextIds });
  }

  function selectVisibleRebateCustomers() {
    const selectableIds = filteredRebateCustomerCandidates
      .map((candidate) => candidate.customerId);
    const nextIds = [...new Set([...(adjustmentForm.customerIds || []), ...selectableIds])].slice(0, 500);
    setAdjustmentForm({ ...adjustmentForm, customerIds: nextIds });
  }

  function clearRebateCustomers() {
    setAdjustmentForm({ ...adjustmentForm, customerIds: [] });
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
    const selectedPromotions = promotions.filter((promotion) => (
      (subscriptionForm.qualifiedPromotionIds || []).includes(promotion.id)
    ));
    if (selectedPromotions.length !== (subscriptionForm.qualifiedPromotionIds || []).length) {
      showError('One or more selected promotions are no longer available.');
      return;
    }
    if (selectedPromotions.some((promotion) => !promotionActiveNow(promotion) || promotion.requiresApproval)) {
      showError('Remove unavailable promotions before saving this subscription.');
      return;
    }
    if (selectedPromotions.length > 1 && selectedPromotions.some((promotion) => !promotion.stackable)) {
      showError('Multiple promotions can only be combined when every selected promotion is marked stackable.');
      return;
    }
    const promotionFields = subscriptionPromotionFields(
      selectedPromotions.map((promotion) => promotion.id),
      { ...subscriptionForm, monthlyRate: effectiveRate }
    );
    const body = {
      ...subscriptionForm,
      monthlyRate: Number(effectiveRate || 0),
      listMonthlyRate: Number(linkedToService ? subscriptionForm.listMonthlyRate : effectiveRate || 0),
      priceOverrideAmount: usesOverride ? Number(subscriptionForm.priceOverrideAmount || 0) : null,
      priceOverrideReason: usesOverride ? subscriptionForm.priceOverrideReason : '',
      pricingSource: linkedToService ? (usesOverride ? 'PRICE_OVERRIDE' : 'SERVICE_CATALOG') : 'MANUAL',
      billingDay: Number(subscriptionForm.billingDay),
      dueDays: Number(subscriptionForm.dueDays),
      ...promotionFields
    };
    delete body.qualifiedPromotions;
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
    if (!window.confirm('Void this invoice?')) return false;
    await request(`/billing/invoices/${id}`, { method: 'DELETE' });
    showMessage('Invoice voided.');
    await load();
    refreshShell();
    return true;
  }

  async function submitAdjustment(e) {
    e.preventDefault();
    if (!adjustmentPreview?.canPost || adjustmentPostBusy) return;
    setAdjustmentPostBusy(true);
    setAdjustmentPreviewError('');
    try {
      const batch = await request('/billing/adjustments/outage-rebates', {
        method: 'POST',
        headers: { 'Idempotency-Key': adjustmentIdempotencyKey },
        body: JSON.stringify({
          customerIds: adjustmentForm.customerIds,
          outageStart: adjustmentForm.outageStart,
          outageEnd: adjustmentForm.outageEnd,
          previewFingerprint: adjustmentPreview.quoteFingerprint
        })
      });
      setAdjustmentForm({ ...blankAdjustment, customerIds: [] });
      closeModal();
      const availableCreditMessage = Number(batch.totalAvailableCredit || 0) > 0
        ? ` ${currency(batch.totalAvailableCredit)} remains available for future invoices.`
        : '';
      showMessage(`${batch.customerCount} customer rebate${batch.customerCount === 1 ? '' : 's'} totaling ${currency(batch.totalRebateAmount)} posted.${availableCreditMessage}`);
      await load();
      refreshShell();
    } catch (submitError) {
      setAdjustmentPreviewError(submitError.message);
      setAdjustmentPreviewVersion((version) => version + 1);
    } finally {
      setAdjustmentPostBusy(false);
    }
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
    delete body.customerId;
    delete body.catalogId;
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
    const receivables = collectionPerformance.receivables || {};
    const periodLabel = collectionPerformance.billingPeriodLabel || formatMonth(collectionMonth);
    const asOfLabel = formatDate(collectionPerformance.asOfDate || collectionAsOf);
    return [
      ['Net Billed', currency(collectionPerformance.netBilledAmount), periodLabel, IconFileInvoice, 'blue'],
      ['Cash Collected', currency(collectionPerformance.cashCollected), periodLabel, IconCreditCard, 'green'],
      [
        'Cash Collection',
        percent(collectionPerformance.cashCollectionRate, collectionPerformance.cashCollectionRateApplicable),
        `${currency(collectionPerformance.cashCollected)} of ${currency(collectionPerformance.netBilledAmount)}`,
        IconCash,
        'cyan'
      ],
      [
        'A/R Outstanding',
        currency(receivables.openAmount),
        `${receivables.openInvoiceCount || 0} open invoice${Number(receivables.openInvoiceCount || 0) === 1 ? '' : 's'} as of ${asOfLabel}`,
        IconUsers,
        'orange'
      ],
      [
        'Overdue A/R',
        currency(receivables.overdueAmount),
        `${receivables.overdueCustomerCount || 0} customer${Number(receivables.overdueCustomerCount || 0) === 1 ? '' : 's'} as of ${asOfLabel}`,
        IconReceipt,
        'red'
      ]
    ].map(([label, value, context, Icon, tone]) => (
      <div className="billing-metric" key={label}>
        <span className={`badge bg-${tone}-lt text-${tone}`}><Icon size={18} /></span>
        <div className="billing-metric-copy">
          <div className="billing-metric-value">{value}</div>
          <div className="billing-metric-label">{label}</div>
          <div className="billing-metric-context">{context}</div>
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
  const subscriptionSupportsPromotions = ['PREPAID', 'POSTPAID'].includes(subscriptionForm.billingMode);
  const selectedSubscriptionPromotions = applicableSubscriptionPromotions.filter((promotion) => (
    (subscriptionForm.qualifiedPromotionIds || []).includes(promotion.id)
  ));
  const subscriptionPromotionQuote = promotionBundlePreview(
    selectedSubscriptionPromotions,
    subscriptionEffectiveRate(subscriptionForm)
  );
  const promotionStatusOptions = [...new Set([...(meta.promotionStatuses || []), 'SCHEDULED'].filter((status) => status && status !== 'ARCHIVED'))];
  const promotionScopeOptions = meta.promotionScopes || ['MONTHLY_SERVICE', 'INSTALLATION_FEE'];
  const billingScheduler = billingRunPreview.scheduler || {};

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
        {['Overview', 'Subscriptions', 'Billing Runs', 'Installation Fees', 'Promotions', 'Invoices', 'Collections', 'Adjustments', 'Balances'].map((tab) => (
          <li className="nav-item" key={tab}>
            <button className={`nav-link ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>{tab}</button>
          </li>
        ))}
      </ul>

      {activeTab === 'Overview' && (
        <div className="row row-cards">
          <div className="col-12">
            <CollectionPeriodControls
              report={collectionPerformance}
              busy={collectionPerformanceBusy}
              billingMonth={collectionMonth}
              asOf={collectionAsOf}
              onBillingMonth={(value) => {
                setCollectionPage(1);
                setCollectionMonth(value);
              }}
              onAsOf={(value) => {
                setCollectionPage(1);
                setCollectionAsOf(value);
              }}
              onRefresh={loadCollectionPerformance}
            />
          </div>
          <div className="col-12">
            <div className="billing-metrics" aria-busy={collectionPerformanceBusy}>{metricCards()}</div>
          </div>
          <div className="col-12">
            <Card title="Monthly Collection Performance" icon={IconCreditCard}>
              <MonthlyCollectionPerformance
                report={collectionPerformance}
                busy={collectionPerformanceBusy}
                selectedStatus={collectionStatus}
                onWorklistStatus={(status) => openCollectionWorklist(status, collectionMonth)}
              />
            </Card>
          </div>
          <div className="col-12">
            <Card title="Billing Control Center" icon={IconRepeat}>
              <BillingControlCenter
                scheduler={billingScheduler}
                preview={billingRunPreview}
                latestRun={latestBillingRun}
                report={collectionPerformance}
                installationPending={installationFeePendingAccounts.length}
                billingReady={monthlyBillingReadyAccounts.length}
                missingCycleCount={missingBillingCycleCount}
                missingSubscriptionCount={subscriptionsWithMissingCycles}
                onBillingRuns={() => setActiveTab('Billing Runs')}
                onSetup={openBillingSetupQueue}
                onCollections={() => openCollectionWorklist('ACTION_REQUIRED')}
              />
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Subscriptions' && (
        <div className="row row-cards">
          <div className="col-12">
            <Card title="Billing Setup Queue" icon={IconReceipt}>
              <div className="billing-setup-filter" role="group" aria-label="Filter billing setup queue">
                <button
                  className={billingSetupFilter === 'INSTALLATION_PENDING' ? 'is-active' : ''}
                  type="button"
                  aria-pressed={billingSetupFilter === 'INSTALLATION_PENDING'}
                  onClick={() => setBillingSetupFilter('INSTALLATION_PENDING')}
                >
                  <span>Installation Fee Pending</span>
                  <strong>{installationFeePendingAccounts.length}</strong>
                </button>
                <button
                  className={billingSetupFilter === 'READY' ? 'is-active' : ''}
                  type="button"
                  aria-pressed={billingSetupFilter === 'READY'}
                  onClick={() => setBillingSetupFilter('READY')}
                >
                  <span>Ready for Monthly Billing</span>
                  <strong>{monthlyBillingReadyAccounts.length}</strong>
                </button>
              </div>
              <ServiceAccountBillingTable
                rows={billingSetupAccounts}
                subscriptionByServiceAccountId={subscriptionByServiceAccountId}
                installationChargeByServiceAccountId={installationChargeByServiceAccountId}
                onResolveInstallationFee={openInstallationChargeForm}
                onCreateSubscription={openServiceAccountSubscription}
                avatarConfig={avatarConfig}
                emptyMessage={billingSetupFilter === 'INSTALLATION_PENDING'
                  ? 'No Service Accounts have a pending installation fee decision.'
                  : 'No Service Accounts are waiting for monthly Billing setup.'}
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

      {activeTab === 'Billing Runs' && (
        <div className="row row-cards">
          <div className="col-12">
            <Card
              title="Automatic Billing"
              icon={IconRepeat}
              actions={(
                <button className="btn btn-primary btn-sm" type="button" disabled={billingRunBusy} onClick={runBillingNow}>
                  <IconPlayerPlay size={16} className="me-1" />{billingRunBusy ? 'Running' : 'Run now'}
                </button>
              )}
            >
              <div className="billing-service-grid billing-run-stats">
                <div className="billing-service-stat">
                  <div className="billing-service-stat-value">
                    <span className={`badge ${statusClass(billingScheduler.running ? 'RUNNING' : billingScheduler.enabled ? 'SCHEDULED' : 'PAUSED')}`}>
                      {billingScheduler.running ? 'RUNNING' : billingScheduler.enabled ? 'STARTING' : 'DISABLED'}
                    </span>
                  </div>
                  <div className="text-muted">Scheduler</div>
                </div>
                <div className="billing-service-stat">
                  <div className="billing-service-stat-value">{formatDate(billingRunPreview.businessDate)}</div>
                  <div className="text-muted">Business Date</div>
                </div>
                <div className="billing-service-stat">
                  <div className="billing-service-stat-value">{billingRunPreview.dueCycles || 0}</div>
                  <div className="text-muted">Due Cycles</div>
                </div>
                <div className="billing-service-stat">
                  <div className="billing-service-stat-value">{currency(billingRunPreview.estimatedAmount)}</div>
                  <div className="text-muted">Estimated Billing</div>
                </div>
                <div className="billing-service-stat">
                  <div className="billing-service-stat-value">{billingRunPreview.invalidSubscriptions?.length || 0}</div>
                  <div className="text-muted">Schedule Exceptions</div>
                </div>
                <div className="billing-service-stat">
                  <div className="billing-service-stat-value billing-run-time">
                    {formatDateTime(billingScheduler.lastCompletedAt, billingScheduler.timezone)}
                  </div>
                  <div className="text-muted">Last Scheduler Pass</div>
                </div>
              </div>
            </Card>
          </div>
          <div className="col-12">
            <Card title="Run History" icon={IconFileInvoice}>
              <BillingRunTable
                rows={billingRuns}
                timeZone={billingScheduler.timezone}
                onOpen={openBillingRun}
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
              <div className="billing-invoice-toolbar">
                <div className="input-icon billing-invoice-search">
                  <span className="input-icon-addon"><IconSearch size={17} /></span>
                  <input
                    className="form-control"
                    type="search"
                    value={invoiceSearch}
                    placeholder="Search customer or invoice"
                    aria-label="Search invoices by customer, account number, or invoice number"
                    onChange={(event) => {
                      setInvoiceSearch(event.target.value);
                      setInvoicePage(1);
                    }}
                  />
                  {invoiceSearch && (
                    <button
                      className="billing-invoice-search-clear"
                      type="button"
                      title="Clear invoice search"
                      aria-label="Clear invoice search"
                      onClick={() => {
                        setInvoiceSearch('');
                        setInvoicePage(1);
                      }}
                    >
                      <IconX size={15} />
                    </button>
                  )}
                </div>
                <div className="billing-invoice-count text-muted small" role="status" aria-live="polite">
                  {invoiceSearch.trim() ? `${filteredInvoices.length} of ${invoices.length} invoices` : `${invoices.length} invoices`}
                </div>
              </div>
              <InvoiceTable
                rows={paginatedInvoices}
                onEdit={editInvoice}
                onVoid={voidInvoice}
                onView={openInvoiceDetail}
                onDownload={downloadInvoicePdf}
                pdfBusyId={invoicePdfBusyId}
                avatarConfig={avatarConfig}
                emptyMessage={invoiceSearch.trim() ? 'No invoices match your search.' : undefined}
              />
              <InvoicePagination
                page={currentInvoicePage}
                pageSize={invoicePageSize}
                total={filteredInvoices.length}
                totalPages={invoicePageCount}
                onPage={setInvoicePage}
                onPageSize={(nextPageSize) => {
                  setInvoicePageSize(nextPageSize);
                  setInvoicePage(1);
                }}
              />
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Collections' && (
        <div className="row row-cards">
          <div className="col-12">
            <Card
              title="Collection Worklist"
              icon={IconReceipt}
              actions={(
                <button className="btn btn-sm" type="button" onClick={() => setActiveTab('Balances')}>
                  <IconUsers size={16} className="me-1" />View Balances
                </button>
              )}
            >
              <div className="billing-collection-workspace">
                <CollectionWorklistControls
                  report={collectionWorklist}
                  busy={collectionWorklistBusy}
                  billingPeriod={collectionBillingPeriod}
                  asOf={collectionWorklistAsOf}
                  onBillingPeriod={(value) => {
                    setCollectionPage(1);
                    setCollectionBillingPeriod(value);
                  }}
                  onAsOf={(value) => {
                    setCollectionPage(1);
                    setCollectionWorklistAsOf(value);
                  }}
                  onRefresh={loadCollectionWorklist}
                />
                <CollectionWorkspaceSummary report={collectionWorklist} />
                <CollectionWorklist
                  report={collectionWorklist}
                  busy={collectionWorklistBusy}
                  selectedStatus={collectionStatus}
                  search={collectionSearch}
                  pageSize={collectionPageSize}
                  avatarConfig={avatarConfig}
                  actionBusy={collectionAccountBusy}
                  onStatus={(value) => {
                    setCollectionPage(1);
                    setCollectionStatus(value);
                  }}
                  onSearch={(value) => {
                    setCollectionPage(1);
                    setCollectionSearch(value);
                  }}
                  onPage={setCollectionPage}
                  onPageSize={(value) => {
                    setCollectionPage(1);
                    setCollectionPageSize(value);
                  }}
                  onViewAccount={openCollectionAccount}
                  onSms={openCollectionSms}
                />
              </div>
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
              actions={<button className="btn btn-primary btn-sm" type="button" onClick={openAdjustmentForm}><IconDiscount2 size={16} className="me-1" />Apply Outage Rebates</button>}
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
          {subscriptionSupportsPromotions && (
            <div className="billing-promotion-selector">
              <label className="form-label">Qualified Promotions</label>
              <div className="billing-promotion-options">
                {applicableSubscriptionPromotions.map((promotion) => {
                  const checked = (subscriptionForm.qualifiedPromotionIds || []).includes(promotion.id);
                  const unavailable = !promotionActiveNow(promotion) || promotion.requiresApproval;
                  const otherSelected = selectedSubscriptionPromotions.filter((item) => item.id !== promotion.id);
                  const stackingBlocked = !checked && otherSelected.length > 0 && (
                    !promotion.stackable || otherSelected.some((item) => !item.stackable)
                  );
                  return (
                    <label
                      key={promotion.id}
                      className={`billing-promotion-option ${checked ? 'is-selected' : ''} ${stackingBlocked ? 'is-disabled' : ''}`}
                      title={stackingBlocked ? 'Every promotion must be marked stackable to combine it.' : ''}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={stackingBlocked}
                        onChange={() => toggleQualifiedPromotion(promotion.id)}
                      />
                      <span className="billing-promotion-option-main">
                        <strong>{promotion.promoCode ? `${promotion.promoCode} - ` : ''}{promotion.name}</strong>
                        <span>{promotionPaymentRuleLabel(promotionPaymentRule(promotion))} - {promotionDiscountLabel(promotion)}</span>
                      </span>
                      {unavailable
                        ? <span className="badge bg-secondary-lt text-secondary">Unavailable</span>
                        : (promotion.stackable && <span className="badge bg-blue-lt text-blue">Stackable</span>)}
                    </label>
                  );
                })}
                {!applicableSubscriptionPromotions.length && (
                  <div className="billing-inline-note">No active monthly-service promotions are available for this billing mode.</div>
                )}
              </div>
              {selectedSubscriptionPromotions.length > 0 && (
                <div className="billing-inline-note billing-promotion-total">
                  <span>{selectedSubscriptionPromotions.length} promotion{selectedSubscriptionPromotions.length === 1 ? '' : 's'} qualified</span>
                  <strong>{currency(subscriptionPromotionQuote.discountAmount)} estimated discount - {currency(subscriptionPromotionQuote.discountedPayable)} payable</strong>
                </div>
              )}
            </div>
          )}
          <div className="billing-two-cols">
            <TextField label="Billing Day" type="number" min="1" max="28" value={subscriptionForm.billingDay} required onChange={(billingDay) => setSubscriptionForm({ ...subscriptionForm, billingDay })} />
            <TextField label="Payment Terms (Days)" type="number" min="0" max="60" value={subscriptionForm.dueDays} required onChange={(dueDays) => setSubscriptionForm({ ...subscriptionForm, dueDays })} />
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

      <Modal
        title={selectedCollectionAccount ? `Collections · ${customerLabel(selectedCollectionAccount.customer)}` : 'Collection Account'}
        icon={IconReceipt}
        open={modal === 'collection-account'}
        onClose={closeModal}
        size="wide"
      >
        <CollectionAccountDetail
          account={selectedCollectionAccount}
          busy={collectionAccountBusy}
          pdfBusyId={invoicePdfBusyId}
          onViewInvoice={openInvoiceDetail}
          onDownloadInvoice={downloadInvoicePdf}
          onSms={openCollectionSms}
          onClose={closeModal}
        />
      </Modal>

      <Modal
        title="Send Collection Follow-up"
        icon={IconMessage}
        open={modal === 'collection-sms'}
        onClose={closeModal}
      >
        {collectionSmsForm && (
          <CollectionSmsEditor
            form={collectionSmsForm}
            busy={collectionSmsBusy}
            onChange={(messageText) => setCollectionSmsForm({ ...collectionSmsForm, messageText })}
            onSubmit={submitCollectionSms}
            onClose={closeModal}
          />
        )}
      </Modal>

      <Modal
        title={selectedInvoice?.invoiceNumber || 'Invoice Details'}
        icon={IconFileInvoice}
        open={modal === 'invoice-detail'}
        onClose={closeModal}
        size="wide"
      >
        {invoiceDetailBusy ? (
          <div className="billing-invoice-detail-loading" role="status">
            <IconRefresh size={18} />
            Loading invoice details
          </div>
        ) : selectedInvoice ? (
          <InvoiceDetail
            invoice={selectedInvoice}
            pdfBusy={invoicePdfBusyId === selectedInvoice.id}
            onDownload={downloadInvoicePdf}
            onEdit={(invoice) => {
              closeModal();
              openInvoiceForm(invoice);
            }}
            onVoid={async (invoice) => {
              if (await voidInvoice(invoice.id)) closeModal();
            }}
            onClose={closeModal}
          />
        ) : null}
      </Modal>

      <Modal title={invoiceForm.id ? 'Edit Invoice' : 'New Invoice'} icon={IconFileInvoice} open={modal === 'invoice'} onClose={closeModal}>
        <form className="billing-form" onSubmit={submitInvoice}>
          <SelectField label="Subscription" value={invoiceForm.subscriptionId} onChange={(subscriptionId) => setInvoiceForm(invoiceDraftForSubscription(subscriptionId))}>{subscriptionOptions()}</SelectField>
          {!invoiceForm.subscriptionId && <SelectField label="Customer" value={invoiceForm.customerId} required onChange={(customerId) => setInvoiceForm({ ...invoiceForm, customerId })}>{customerOptions()}</SelectField>}
          <div className="billing-two-cols">
            <TextField label="Billing Period Start" type="date" value={invoiceForm.billingCycleStart} required onChange={(billingCycleStart) => setInvoiceForm({ ...invoiceForm, billingCycleStart })} />
            <TextField label="Billing Period End" type="date" value={invoiceForm.billingCycleEnd} onChange={(billingCycleEnd) => setInvoiceForm({ ...invoiceForm, billingCycleEnd })} />
          </div>
          <div className="billing-two-cols">
            <TextField label="Issue Date" type="date" value={invoiceForm.issueDate} required disabled={Boolean(invoiceForm.subscriptionId)} onChange={(issueDate) => setInvoiceForm({ ...invoiceForm, issueDate })} />
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

      <Modal title="Apply Outage Rebates" icon={IconDiscount2} open={modal === 'adjustment'} onClose={closeModal} size="wide">
        <form className="billing-form" onSubmit={submitAdjustment}>
          <div className="billing-two-cols">
            <TextField
              label="Outage Start"
              type="datetime-local"
              max={adjustmentForm.outageEnd || localDateTimeInputValue()}
              value={adjustmentForm.outageStart}
              required
              onChange={(outageStart) => setAdjustmentForm({ ...adjustmentForm, outageStart })}
            />
            <TextField
              label="Outage End"
              type="datetime-local"
              min={adjustmentForm.outageStart}
              max={localDateTimeInputValue()}
              value={adjustmentForm.outageEnd}
              required
              onChange={(outageEnd) => setAdjustmentForm({ ...adjustmentForm, outageEnd })}
            />
          </div>
          <OutageRebateCustomerSelector
            rows={filteredRebateCustomerCandidates}
            totalRows={rebateCustomerCandidates.length}
            selectedIds={adjustmentForm.customerIds || []}
            search={adjustmentForm.customerSearch || ''}
            onSearch={(customerSearch) => setAdjustmentForm({ ...adjustmentForm, customerSearch })}
            onToggle={toggleRebateCustomer}
            onSelectVisible={selectVisibleRebateCustomers}
            onClear={clearRebateCustomers}
          />
          <OutageRebatePreview
            preview={adjustmentPreview}
            busy={adjustmentPreviewBusy}
            error={adjustmentPreviewError}
          />
          <div className="billing-form-actions">
            <button className="btn" type="button" onClick={closeModal}>Cancel</button>
            <button
              className="btn btn-primary"
              disabled={!adjustmentPreview?.canPost || adjustmentPreviewBusy || adjustmentPostBusy}
              aria-busy={adjustmentPostBusy}
            >
              <IconDiscount2 size={16} className="me-1" />
              {adjustmentPostBusy
                ? 'Posting Rebates'
                : `Post ${adjustmentPreview?.eligibleCount || 0} Rebate${adjustmentPreview?.eligibleCount === 1 ? '' : 's'}`}
            </button>
          </div>
        </form>
      </Modal>

      <Modal title={selectedBillingRun?.runNumber || 'Billing Run'} icon={IconRepeat} open={modal === 'billing-run'} onClose={closeModal}>
        {selectedBillingRun && (
          <div className="billing-run-detail">
            <div className="billing-service-pairs">
              <div>
                <span>Status</span>
                <strong><span className={`badge ${statusClass(selectedBillingRun.status)}`}>{String(selectedBillingRun.status || '').replaceAll('_', ' ')}</span></strong>
              </div>
              <div>
                <span>Run Type</span>
                <strong>{selectedBillingRun.runType}</strong>
              </div>
              <div>
                <span>Business Date</span>
                <strong>{formatDate(selectedBillingRun.businessDate)}</strong>
              </div>
              <div>
                <span>Completed</span>
                <strong>{formatDateTime(selectedBillingRun.finishedAt, billingScheduler.timezone)}</strong>
              </div>
              <div>
                <span>Invoices Created</span>
                <strong>{selectedBillingRun.invoicesCreated || 0}</strong>
              </div>
              <div>
                <span>Total Posted</span>
                <strong>{currency(selectedBillingRun.totalAmount)}</strong>
              </div>
              <div>
                <span>Exceptions</span>
                <strong>{selectedBillingRun.failedCycles || 0}</strong>
              </div>
              <div>
                <span>Attempts</span>
                <strong>{selectedBillingRun.attemptCount || 0}</strong>
              </div>
            </div>
            <BillingRunItemTable rows={selectedBillingRun.items || []} />
          </div>
        )}
      </Modal>
    </div>
  );
}

function Empty({ message = 'No records yet.' }) {
  return <div className="empty">{message}</div>;
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
        {preview.promotionQualified && (
          <>
            <div>
              <span>Promotion Payable</span>
              <strong>{currency(preview.promotionPayableAmount)}</strong>
            </div>
            {preview.earlyBirdEligible && (
              <div>
                <span>Early Bird Until</span>
                <strong>{formatDate(preview.earlyBirdAvailableUntil)}</strong>
              </div>
            )}
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

function ServiceAccountBillingTable({ rows, subscriptionByServiceAccountId, installationChargeByServiceAccountId, onResolveInstallationFee, onCreateSubscription, avatarConfig, compact = false, emptyMessage = 'No records found.' }) {
  if (!rows.length) return <Empty message={emptyMessage} />;
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

function PromotionTable({ rows, onEdit, onArchive }) {
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
                <div>{promotionEligibilityLabel(row)}</div>
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

function MonthlyAgingCell({ unpaidSummary = {}, missingSummary = {}, showAmounts = false, emptyLabel = 'Current' }) {
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
  if (!unpaidLine && !missingLine) return <span className="text-muted">{emptyLabel}</span>;
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

function CollectionPeriodControls({
  report,
  busy,
  billingMonth,
  asOf,
  onBillingMonth,
  onAsOf,
  onRefresh
}) {
  return (
    <div className="billing-reporting-period" aria-busy={busy}>
      <div className="billing-reporting-period-copy">
        <span>Reporting Period</span>
        <strong>{report?.billingPeriodLabel || formatMonth(billingMonth)}</strong>
        <small>As of {formatDate(report?.asOfDate || asOf)} · {report?.timeZone || 'Asia/Manila'}</small>
      </div>
      <div className="billing-reporting-period-controls">
        <label>
          <span>Billing Month</span>
          <input
            className="form-control form-control-sm"
            type="month"
            value={billingMonth}
            onChange={(event) => onBillingMonth(event.target.value)}
          />
        </label>
        <label>
          <span>As Of</span>
          <input
            className="form-control form-control-sm"
            type="date"
            value={asOf}
            onChange={(event) => onAsOf(event.target.value)}
          />
        </label>
        <button
          className="btn btn-sm btn-icon"
          type="button"
          title="Refresh reporting period"
          aria-label="Refresh reporting period"
          disabled={busy}
          onClick={onRefresh}
        >
          <IconRefresh size={17} />
        </button>
      </div>
    </div>
  );
}

function CollectionWorklistControls({
  report,
  busy,
  billingPeriod,
  asOf,
  onBillingPeriod,
  onAsOf,
  onRefresh
}) {
  const availablePeriods = [...new Set([
    ...(report?.availableBillingPeriods || []),
    ...(billingPeriod && billingPeriod !== 'ALL' ? [billingPeriod] : [])
  ])].sort().reverse();
  return (
    <div className="billing-reporting-period" aria-busy={busy}>
      <div className="billing-reporting-period-copy">
        <span>Collection Scope</span>
        <strong>{report?.billingPeriodLabel || 'All Open Billing Periods'}</strong>
        <small>Open receivables as of {formatDate(report?.asOfDate || asOf)} · {report?.timeZone || 'Asia/Manila'}</small>
      </div>
      <div className="billing-reporting-period-controls">
        <label>
          <span>Billing Period</span>
          <select
            className="form-select form-select-sm"
            value={billingPeriod}
            onChange={(event) => onBillingPeriod(event.target.value)}
          >
            <option value="ALL">All Open Periods</option>
            {availablePeriods.map((period) => (
              <option value={period} key={period}>{formatMonth(period)}</option>
            ))}
          </select>
        </label>
        <label>
          <span>As Of</span>
          <input
            className="form-control form-control-sm"
            type="date"
            value={asOf}
            onChange={(event) => onAsOf(event.target.value)}
          />
        </label>
        <button
          className="btn btn-sm btn-icon"
          type="button"
          title="Refresh collection worklist"
          aria-label="Refresh collection worklist"
          disabled={busy}
          onClick={onRefresh}
        >
          <IconRefresh size={17} />
        </button>
      </div>
    </div>
  );
}

function MonthlyCollectionPerformance({
  report,
  busy,
  selectedStatus,
  onWorklistStatus
}) {
  const subscriberRate = Math.max(0, Math.min(100, Number(report?.subscriberCollectionRate || 0)));
  const cashRate = Math.max(0, Math.min(100, Number(report?.cashCollectionRate || 0)));
  const statusOptions = [
    { value: 'ALL', label: 'All Billed', count: report?.billedSubscriberCount || 0 },
    { value: 'FULLY_PAID', label: 'Fully Paid', count: report?.fullyPaidSubscriberCount || 0 },
    { value: 'PARTIALLY_PAID', label: 'Partially Paid', count: report?.partiallyPaidSubscriberCount || 0, actionable: true },
    { value: 'UNPAID', label: 'Unpaid', count: report?.unpaidSubscriberCount || 0, actionable: true }
  ];
  const settlementComposition = [
    ['Gross Charges', report?.grossCharges],
    ['Invoice Credits', report?.invoiceCredits],
    ['Account Credits', report?.accountCreditsApplied],
    ['Rebates Applied', report?.rebatesApplied]
  ];

  return (
    <div className="billing-collection-performance" aria-busy={busy}>
      <div className="billing-collection-rate-grid">
        <section className="billing-collection-rate" aria-label="Subscriber collection rate">
          <div className="billing-collection-rate-heading">
            <span>Subscriber Collection</span>
            <strong>{percent(report?.subscriberCollectionRate, report?.subscriberCollectionRateApplicable)}</strong>
          </div>
          <div className="billing-collection-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={subscriberRate}>
            <span className="billing-collection-progress-subscriber" style={{ width: `${subscriberRate}%` }} />
          </div>
          <div className="text-muted small">
            {report?.fullyPaidSubscriberCount || 0} of {report?.billedSubscriberCount || 0} billed subscribers fully settled
          </div>
        </section>
        <section className="billing-collection-rate" aria-label="Cash collection rate">
          <div className="billing-collection-rate-heading">
            <span>Cash Collection</span>
            <strong>{percent(report?.cashCollectionRate, report?.cashCollectionRateApplicable)}</strong>
          </div>
          <div className="billing-collection-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={cashRate}>
            <span className="billing-collection-progress-cash" style={{ width: `${cashRate}%` }} />
          </div>
          <div className="text-muted small">
            {currency(report?.cashCollected)} of {currency(report?.netBilledAmount)} net billed
          </div>
        </section>
      </div>

      <div className="billing-collection-status-summary" aria-label="Monthly subscriber payment status">
        {statusOptions.map((option) => {
          const content = (
            <>
              <span>{option.label}</span>
              <strong>{option.count}</strong>
            </>
          );
          if (!option.actionable) {
            return <div key={option.value}>{content}</div>;
          }
          return (
            <button
              className={selectedStatus === option.value ? 'is-active' : ''}
              type="button"
              key={option.value}
              title={`Show ${option.label.toLowerCase()} accounts in Collection Worklist`}
              aria-pressed={selectedStatus === option.value}
              disabled={busy}
              onClick={() => onWorklistStatus(option.value)}
            >
              {content}
            </button>
          );
        })}
      </div>

      <div className="billing-collection-composition" aria-label="Monthly billing and credit composition">
        {settlementComposition.map(([label, value]) => (
          <div className="billing-collection-financial" key={label}>
            <span>{label}</span>
            <strong>{currency(value)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function BillingControlCenter({
  scheduler,
  preview,
  latestRun,
  report,
  installationPending,
  billingReady,
  missingCycleCount,
  missingSubscriptionCount,
  onBillingRuns,
  onSetup,
  onCollections
}) {
  const schedulerState = scheduler?.running ? 'RUNNING' : scheduler?.enabled ? 'SCHEDULED' : 'PAUSED';
  const scheduleExceptions = preview?.invalidSubscriptions?.length || 0;
  const latestFailures = Number(latestRun?.failedCycles || 0);
  const actionRequired = Number(report?.subscriberOutstandingCount || 0);
  const reconciliationException = Boolean(report?.hasReconciliationException);
  const controlActions = [
    {
      label: 'Installation Fee Pending',
      value: installationPending,
      context: 'Billing setup',
      tone: installationPending ? 'pending' : 'clear',
      onClick: () => onSetup('INSTALLATION_PENDING')
    },
    {
      label: 'Ready for Monthly Billing',
      value: billingReady,
      context: 'Billing setup',
      tone: billingReady ? 'ready' : 'clear',
      onClick: () => onSetup('READY')
    },
    {
      label: 'Missing Invoice Cycles',
      value: missingCycleCount,
      context: `${missingSubscriptionCount} subscription${Number(missingSubscriptionCount) === 1 ? '' : 's'} affected`,
      tone: missingCycleCount ? 'danger' : 'clear',
      onClick: onBillingRuns
    },
    {
      label: 'Accounts Requiring Follow-up',
      value: actionRequired,
      context: `${currency(report?.outstandingAmount)} selected-month balance`,
      tone: actionRequired ? 'danger' : 'clear',
      onClick: onCollections
    }
  ];

  return (
    <div className="billing-control-center">
      <div className="billing-control-health">
        <div className="billing-control-health-heading">
          <div>
            <span>Automatic Billing</span>
            <strong className={`badge ${statusClass(schedulerState)}`}>{schedulerState}</strong>
          </div>
          <button className="btn btn-sm" type="button" onClick={onBillingRuns}>
            View Billing Runs <IconChevronRight size={16} className="ms-1" />
          </button>
        </div>
        <div className="billing-control-health-grid">
          <div>
            <span>Last Scheduler Pass</span>
            <strong>{formatDateTime(scheduler?.lastCompletedAt, scheduler?.timezone)}</strong>
          </div>
          <div>
            <span>Due Billing Cycles</span>
            <strong>{preview?.dueCycles || 0}</strong>
          </div>
          <div>
            <span>Schedule Exceptions</span>
            <strong className={scheduleExceptions ? 'text-danger' : ''}>{scheduleExceptions}</strong>
          </div>
          <div>
            <span>Latest Run Failures</span>
            <strong className={latestFailures ? 'text-danger' : ''}>{latestFailures}</strong>
          </div>
        </div>
      </div>

      <div className="billing-control-actions" role="group" aria-label="Billing and collection exception queues">
        {controlActions.map((action) => (
          <button
            className={`billing-control-action billing-control-action-${action.tone}`}
            type="button"
            key={action.label}
            onClick={action.onClick}
          >
            <span className="billing-control-action-value">{action.value}</span>
            <span className="billing-control-action-copy">
              <strong>{action.label}</strong>
              <small>{action.context}</small>
            </span>
            <IconChevronRight size={18} />
          </button>
        ))}
      </div>

      <div
        className={`billing-control-reconciliation ${reconciliationException ? 'is-exception' : 'is-balanced'}`}
        role={reconciliationException ? 'alert' : 'status'}
      >
        <span>Posting Reconciliation</span>
        <strong>
          {reconciliationException
            ? `${currency(report?.reconciliationVariance)} variance`
            : 'Balanced'}
        </strong>
      </div>
    </div>
  );
}

function CollectionWorkspaceSummary({ report }) {
  const summary = report?.summary || {};
  const rows = [
    ['Needs Follow-up', summary.actionRequiredCustomerCount || 0],
    ['Total Open A/R', currency(summary.openAmount)],
    ['Overdue A/R', currency(summary.overdueAmount)],
    ['Oldest Overdue', summary.oldestDaysOverdue ? `${summary.oldestDaysOverdue} days` : 'Current']
  ];
  return (
    <div className="billing-collection-workspace-summary" aria-label="Collection worklist summary">
      {rows.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function CollectionWorklist({
  report,
  busy,
  selectedStatus,
  search,
  pageSize,
  avatarConfig,
  actionBusy,
  onStatus,
  onSearch,
  onPage,
  onPageSize,
  onViewAccount,
  onSms
}) {
  const rows = report?.rows || [];
  const pagination = report?.pagination || { page: 1, pageSize, totalRows: 0, totalPages: 1 };
  const currentPage = pagination.page || 1;
  const totalPages = pagination.totalPages || 1;
  const totalRows = pagination.totalRows || 0;
  const rangeStart = totalRows ? ((currentPage - 1) * pagination.pageSize) + 1 : 0;
  const rangeEnd = totalRows ? Math.min(currentPage * pagination.pageSize, totalRows) : 0;
  const statusOptions = [
    { value: 'ACTION_REQUIRED', label: 'Needs Follow-up' },
    { value: 'PARTIALLY_PAID', label: 'Partially Paid' },
    { value: 'UNPAID', label: 'Unpaid' },
    { value: 'ALL_OPEN', label: 'All Open' }
  ];

  return (
    <div className="billing-collection-worklist" aria-busy={busy}>
      <div className="billing-collection-worklist-toolbar">
        <div className="billing-collection-status-filter" role="group" aria-label="Filter collection worklist by payment status">
          {statusOptions.map((option) => (
            <button
              className={selectedStatus === option.value ? 'is-active' : ''}
              type="button"
              key={option.value}
              aria-pressed={selectedStatus === option.value}
              onClick={() => onStatus(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="input-icon billing-collection-worklist-search">
          <span className="input-icon-addon"><IconSearch size={16} /></span>
          <input
            className="form-control form-control-sm"
            type="search"
            value={search}
            placeholder="Search customer or account"
            aria-label="Search collection worklist"
            onChange={(event) => onSearch(event.target.value)}
          />
          {search && (
            <button
              className="billing-invoice-search-clear"
              type="button"
              title="Clear collection search"
              aria-label="Clear collection search"
              onClick={() => onSearch('')}
            >
              <IconX size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="billing-collection-worklist-updating text-muted small" role="status" aria-live="polite">
        {busy
          ? 'Updating collection worklist...'
          : `${rangeStart}-${rangeEnd} of ${totalRows} accounts · ${report?.billingPeriodLabel || 'All Open Billing Periods'}`}
      </div>

      {rows.length ? (
        <div className="table-responsive">
          <table className="table table-vcenter billing-collection-worklist-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Collection State</th>
                <th>Aging</th>
                <th>Open Invoices</th>
                <th>Balance</th>
                <th>Last Payment</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const periodLabels = (row.billingPeriods || []).slice(0, 2).map(formatMonth);
                const remainingPeriods = Math.max(0, Number(row.billingPeriods?.length || 0) - periodLabels.length);
                return (
                  <tr key={row.customerId}>
                    <td data-label="Customer">
                      <div className="billing-collection-customer">
                        <CustomerEmotionAvatar
                          customer={row.customer}
                          avatarConfig={avatarConfig}
                          context={{
                            balance: {
                              balance: row.outstandingBalance,
                              overdueTotal: row.overdueBalance,
                              openInvoices: row.openInvoiceCount
                            }
                          }}
                          size={34}
                        />
                        <div className="billing-collection-customer-copy">
                          <div className="billing-service-main">{customerLabel(row.customer)}</div>
                          <div className="text-muted small">{row.customer?.accountNumber || 'No account number'}</div>
                        </div>
                      </div>
                    </td>
                    <td data-label="Collection State">
                      <span className={`badge ${statusClass(row.collectionStatus)}`}>{String(row.collectionStatus || '').replaceAll('_', ' ')}</span>
                      {Number(row.partiallyPaidInvoiceCount || 0) > 0 && row.collectionStatus !== 'PARTIALLY_PAID' && (
                        <div className="text-muted small mt-1">Includes partial payment</div>
                      )}
                    </td>
                    <td data-label="Aging">
                      {Number(row.daysOverdue || 0) > 0 ? (
                        <>
                          <div className="billing-collection-worklist-amount text-danger">{row.daysOverdue} days overdue</div>
                          <div className="text-muted small">Due {formatDate(row.oldestOverdueDate)}</div>
                        </>
                      ) : (
                        <>
                          <div>Current</div>
                          <div className="text-muted small">Next due {formatDate(row.oldestDueDate)}</div>
                        </>
                      )}
                    </td>
                    <td data-label="Open Invoices">
                      <div>{row.openInvoiceCount || 0} invoice{Number(row.openInvoiceCount || 0) === 1 ? '' : 's'}</div>
                      <div className="text-muted small billing-collection-worklist-references">
                        {periodLabels.join(', ')}{remainingPeriods ? ` +${remainingPeriods}` : ''}
                      </div>
                    </td>
                    <td
                      data-label="Balance"
                      className="billing-collection-worklist-amount"
                    >
                      <div>{currency(row.outstandingBalance)}</div>
                      <div className={`small ${Number(row.overdueBalance || 0) > 0 ? 'text-danger' : 'text-muted'}`}>
                        {currency(row.overdueBalance)} overdue
                      </div>
                    </td>
                    <td data-label="Last Payment">
                      {row.lastPaymentDate ? (
                        <>
                          <div>{currency(row.lastPaymentAmount)}</div>
                          <div className="text-muted small">{formatDate(row.lastPaymentDate)}</div>
                          {row.lastPaymentChannel && <div className="text-muted small">{String(row.lastPaymentChannel).replaceAll('_', ' ')}</div>}
                        </>
                      ) : <span className="text-muted">None recorded</span>}
                    </td>
                    <td data-label="Actions">
                      <div className="billing-collection-worklist-actions">
                        <button
                          className="btn btn-sm btn-icon"
                          type="button"
                          title="View collection account"
                          aria-label={`View collection account for ${customerLabel(row.customer)}`}
                          disabled={actionBusy}
                          onClick={() => onViewAccount(row)}
                        >
                          <IconEye size={16} />
                        </button>
                        <button
                          className="btn btn-sm btn-icon"
                          type="button"
                          title={row.customer?.contactNumber ? 'Send collection follow-up SMS' : 'Customer has no saved mobile number'}
                          aria-label={`Send collection follow-up SMS to ${customerLabel(row.customer)}`}
                          disabled={actionBusy || !row.customer?.contactNumber}
                          onClick={() => onSms(row)}
                        >
                          <IconMessage size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty message={search ? 'No accounts match this collection search.' : 'No open accounts match this collection state and billing-period filter.'} />
      )}

      {totalRows > 0 && (
        <div className="billing-collection-worklist-pagination" aria-label="Collection worklist pagination">
          <label className="billing-collection-worklist-page-size text-muted small">
            <span>Rows</span>
            <select
              className="form-select form-select-sm"
              value={pageSize}
              aria-label="Accounts per page"
              onChange={(event) => onPageSize(Number(event.target.value))}
            >
              {[10, 20, 50].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <div className="billing-collection-worklist-page-controls">
            <button
              className="btn btn-sm btn-icon"
              type="button"
              title="Previous worklist page"
              aria-label="Previous worklist page"
              disabled={currentPage <= 1 || busy}
              onClick={() => onPage(currentPage - 1)}
            >
              <IconChevronLeft size={17} />
            </button>
            <span>Page {currentPage} of {totalPages}</span>
            <button
              className="btn btn-sm btn-icon"
              type="button"
              title="Next worklist page"
              aria-label="Next worklist page"
              disabled={currentPage >= totalPages || busy}
              onClick={() => onPage(currentPage + 1)}
            >
              <IconChevronRight size={17} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CollectionAccountDetail({
  account,
  busy,
  pdfBusyId,
  onViewInvoice,
  onDownloadInvoice,
  onSms,
  onClose
}) {
  if (busy) {
    return (
      <div className="billing-invoice-detail-loading" role="status">
        <IconRefresh size={18} />
        Loading collection account
      </div>
    );
  }
  if (!account) return null;
  const customer = account.customer || {};
  const openInvoices = account.openInvoices || [];
  const summary = [
    ['Total Open', currency(account.outstandingBalance)],
    ['Overdue', currency(account.overdueBalance)],
    ['Current', currency(account.currentBalance)],
    ['Oldest Overdue', account.daysOverdue ? `${account.daysOverdue} days` : 'Current']
  ];
  return (
    <div className="billing-collection-account-detail">
      <div className="billing-collection-account-heading">
        <div>
          <strong>{customerLabel(customer)}</strong>
          <span>{customer.accountNumber || 'No account number'}</span>
          <small>{customer.contactNumber || 'No saved mobile number'}{customer.address ? ` · ${customer.address}` : ''}</small>
        </div>
        <button
          className="btn btn-sm btn-primary"
          type="button"
          disabled={!customer.contactNumber}
          title={customer.contactNumber ? 'Send collection follow-up SMS' : 'Customer has no saved mobile number'}
          onClick={() => onSms(account)}
        >
          <IconMessage size={16} className="me-1" />Send SMS
        </button>
      </div>

      <div className="billing-collection-account-summary" aria-label="Collection account balance summary">
        {summary.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <div className="billing-collection-account-context">
        <div>
          <span>Scope</span>
          <strong>{account.billingPeriod === 'ALL' ? 'All Open Periods' : formatMonth(account.billingPeriod)}</strong>
        </div>
        <div>
          <span>As Of</span>
          <strong>{formatDate(account.asOfDate)}</strong>
        </div>
        <div>
          <span>Last Payment</span>
          <strong>{account.lastPaymentDate ? `${currency(account.lastPaymentAmount)} · ${formatDate(account.lastPaymentDate)}` : 'None recorded'}</strong>
        </div>
      </div>

      <div className="table-responsive">
        <table className="table table-vcenter billing-collection-account-invoices">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Billing Period</th>
              <th>Aging</th>
              <th>Net Billed</th>
              <th>Settled</th>
              <th>Balance</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {openInvoices.map((invoice) => (
              <tr key={invoice.id}>
                <td data-label="Invoice">
                  <div className="billing-service-main">{invoice.invoiceNumber}</div>
                  <div className="text-muted small">{String(invoice.invoiceType || 'INVOICE').replaceAll('_', ' ')}</div>
                </td>
                <td data-label="Billing Period">
                  <div>{invoice.billingPeriodLabel}</div>
                  <div className="text-muted small">{invoice.serviceAccountNumber || invoice.serviceId || 'No service reference'}</div>
                </td>
                <td data-label="Aging">
                  <span className={`badge ${statusClass(invoice.collectionState)}`}>{String(invoice.collectionState || '').replaceAll('_', ' ')}</span>
                  <div className="text-muted small mt-1">Due {formatDate(invoice.dueDate)}</div>
                  {invoice.daysOverdue > 0 && <div className="text-danger small">{invoice.daysOverdue} days overdue</div>}
                </td>
                <td data-label="Net Billed" className="billing-collection-worklist-amount">{currency(invoice.netBilledAmount)}</td>
                <td data-label="Settled">
                  <div className="billing-collection-worklist-amount">{currency(invoice.settledAmount)}</div>
                  <div className="text-muted small">{currency(invoice.cashCollected)} cash</div>
                  <div className="text-muted small">{currency(invoice.accountCreditsApplied)} credits</div>
                </td>
                <td data-label="Balance" className="billing-collection-worklist-amount text-danger">{currency(invoice.balance)}</td>
                <td data-label="Actions">
                  <div className="billing-collection-worklist-actions">
                    <button
                      className="btn btn-sm btn-icon"
                      type="button"
                      title="View invoice"
                      aria-label={`View ${invoice.invoiceNumber}`}
                      onClick={() => onViewInvoice(invoice)}
                    >
                      <IconEye size={16} />
                    </button>
                    <button
                      className="btn btn-sm btn-icon"
                      type="button"
                      title="Download invoice PDF"
                      aria-label={`Download ${invoice.invoiceNumber} PDF`}
                      disabled={pdfBusyId === invoice.id}
                      onClick={() => onDownloadInvoice(invoice)}
                    >
                      {pdfBusyId === invoice.id ? <IconRefresh size={16} /> : <IconDownload size={16} />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="billing-form-actions">
        <button className="btn" type="button" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function CollectionSmsEditor({ form, busy, onChange, onSubmit, onClose }) {
  const account = form.account || {};
  const customer = account.customer || {};
  return (
    <form className="billing-form billing-collection-sms" onSubmit={onSubmit}>
      <div className="billing-collection-sms-recipient">
        <div>
          <span>Recipient</span>
          <strong>{customerLabel(customer)}</strong>
          <small>{customer.contactNumber || 'No saved mobile number'}</small>
        </div>
        <div>
          <span>Sender ID</span>
          <strong>3J BILL</strong>
          <small>A2P Messaging</small>
        </div>
      </div>
      <div className="billing-collection-sms-balance">
        <div>
          <span>Total Open</span>
          <strong>{currency(account.outstandingBalance)}</strong>
        </div>
        <div>
          <span>Overdue</span>
          <strong>{currency(account.overdueBalance)}</strong>
        </div>
        <div>
          <span>Open Invoices</span>
          <strong>{account.openInvoiceCount || 0}</strong>
        </div>
      </div>
      <label>
        <span className="form-label">Message</span>
        <textarea
          className="form-control billing-collection-sms-message"
          value={form.messageText}
          maxLength={500}
          rows={7}
          required
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <div className="billing-collection-sms-count text-muted small">{form.messageText.length} / 500 characters</div>
      <div className="billing-form-actions">
        <button className="btn" type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" type="submit" disabled={busy || !form.messageText.trim() || !customer.contactNumber}>
          <IconMessage size={16} className="me-1" />{busy ? 'Sending...' : 'Send SMS'}
        </button>
      </div>
    </form>
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
                  {Number(row.qualifiedPromotionCount || row.qualifiedPromotionIds?.length || (row.earlyBirdEligible ? 1 : 0)) > 0 && (
                    <div className="text-muted small">
                      {Number(row.qualifiedPromotionCount || row.qualifiedPromotionIds?.length || 1)} promotion{Number(row.qualifiedPromotionCount || row.qualifiedPromotionIds?.length || 1) === 1 ? '' : 's'} qualified
                    </div>
                  )}
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

function BillingRunTable({ rows, timeZone, onOpen }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-responsive">
      <table className="table card-table table-vcenter billing-run-history">
        <thead>
          <tr>
            <th>Run</th>
            <th>Invoices</th>
            <th>Exceptions</th>
            <th>Total Posted</th>
            <th>Status</th>
            <th>Completed</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <div className="billing-service-main billing-run-number">{row.runNumber}</div>
                <div className="text-muted small">{row.runType} · {formatDate(row.businessDate)} · Attempt {row.attemptCount || 0}</div>
              </td>
              <td>
                <div>{row.invoicesCreated || 0} created</div>
                {Number(row.invoicesReplayed || 0) > 0 && <div className="text-muted small">{row.invoicesReplayed} reconciled</div>}
              </td>
              <td className={Number(row.failedCycles || 0) > 0 ? 'text-danger' : ''}>{row.failedCycles || 0}</td>
              <td>{currency(row.totalAmount)}</td>
              <td><span className={`badge ${statusClass(row.status)}`}>{String(row.status || '').replaceAll('_', ' ')}</span></td>
              <td>{formatDateTime(row.finishedAt, timeZone)}</td>
              <td className="text-end">
                <button className="btn btn-sm" type="button" title="View billing run" aria-label="View billing run" onClick={() => onOpen(row)}>
                  <IconEye size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BillingRunItemTable({ rows }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-responsive">
      <table className="table table-vcenter billing-run-items">
        <thead>
          <tr>
            <th>Subscription</th>
            <th>Cycle</th>
            <th>Invoice</th>
            <th>Amount</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.itemKey}>
              <td>
                <div className="billing-service-main">{row.planName || row.subscriptionId}</div>
                {row.serviceAccountId && <div className="text-muted small">{row.serviceAccountId}</div>}
              </td>
              <td>{row.cycleStart && row.cycleStart !== 'UNKNOWN' ? formatMonth(row.cycleStart) : '-'}</td>
              <td>{row.invoiceNumber || '-'}</td>
              <td>{currency(row.amount)}</td>
              <td>
                <span className={`badge ${statusClass(row.status)}`}>{String(row.status || '').replaceAll('_', ' ')}</span>
                {row.error && <div className="billing-run-error">{row.error}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvoiceBillingPeriod({ invoice, compact = false }) {
  const period = invoiceBillingPeriod(invoice);
  return (
    <div className={`billing-period-cell ${compact ? 'billing-period-cell-compact' : ''}`}>
      <div className="billing-service-main">{compact ? `Billing period: ${period.label}` : period.label}</div>
      <div className="text-muted small">{period.coverage}</div>
    </div>
  );
}

function DetailField({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || '-'}</dd>
    </div>
  );
}

function InvoiceDetail({ invoice, pdfBusy, onDownload, onEdit, onVoid, onClose }) {
  const period = invoiceBillingPeriod(invoice);
  const payments = invoice.payments || [];
  const adjustments = invoice.adjustments || [];
  const lineItems = invoice.lineItems || [];
  const accountSummary = invoice.accountSummaryAtIssue && typeof invoice.accountSummaryAtIssue === 'object'
    ? invoice.accountSummaryAtIssue
    : null;
  const previousOpenInvoices = Array.isArray(accountSummary?.previousOpenInvoices)
    ? accountSummary.previousOpenInvoices
    : [];
  const hasPostedPayment = payments.some((payment) => payment.status === 'POSTED');
  const hasPostedAdjustment = adjustments.some((adjustment) => adjustment.status === 'POSTED');
  const canVoid = invoice.status !== 'VOID'
    && !invoice.subscriptionId
    && invoice.invoiceType !== 'INSTALLATION_FEE'
    && !hasPostedPayment
    && !hasPostedAdjustment;
  const adjustmentAmount = Number(invoice.adjustmentsTotal || 0);
  const accountCreditAppliedAmount = Number(invoice.accountCreditAppliedTotal || 0);
  const paymentAmount = Number(
    invoice.paymentTotal ?? Math.max(0, Number(invoice.paidTotal || 0) - accountCreditAppliedAmount)
  );
  const serviceDetails = [
    ['Plan', invoice.catalogName],
    ['Catalog Code', invoice.catalogCode],
    ['Service ID', invoice.serviceId],
    ['Service Account', invoice.serviceAccountNumber],
    ['Service Order', invoice.serviceOrderId],
    ['Billing Mode', invoice.billingMode ? invoice.billingMode.replaceAll('_', ' ') : ''],
  ].filter(([, value]) => value);

  return (
    <div className="billing-invoice-detail">
      <div className="billing-invoice-detail-heading">
        <div>
          <div className="billing-invoice-detail-label">Billing Period</div>
          <div className="billing-invoice-detail-period">{period.label}</div>
          <div className="text-muted small">{period.coverage}</div>
        </div>
        <span className={`badge ${statusClass(invoice.status)}`}>{String(invoice.status || '').replaceAll('_', ' ')}</span>
      </div>

      <div className="billing-invoice-detail-columns">
        <section className="billing-invoice-detail-section">
          <h4>Customer</h4>
          <dl className="billing-invoice-detail-fields">
            <DetailField label="Name" value={customerLabel(invoice.customer)} />
            <DetailField label="Account Number" value={invoice.customer?.accountNumber} />
            <DetailField label="Contact Number" value={invoice.customer?.contactNumber} />
            <DetailField label="Address" value={invoice.customer?.address} />
          </dl>
        </section>
        <section className="billing-invoice-detail-section">
          <h4>Invoice</h4>
          <dl className="billing-invoice-detail-fields">
            <DetailField label="Invoice Number" value={invoice.invoiceNumber} />
            <DetailField label="Invoice Type" value={invoiceTypeLabel(invoice.invoiceType)} />
            <DetailField label="Issue Date" value={formatDate(invoice.issueDate)} />
            <DetailField label="Due Date" value={formatDate(invoice.dueDate)} />
            <DetailField label="Created" value={formatDateTime(invoice.createdAt)} />
          </dl>
        </section>
      </div>

      {serviceDetails.length > 0 && (
        <section className="billing-invoice-detail-section">
          <h4>Service</h4>
          <dl className="billing-invoice-detail-fields billing-invoice-service-fields">
            {serviceDetails.map(([label, value]) => <DetailField key={label} label={label} value={value} />)}
          </dl>
        </section>
      )}

      {accountSummary && (
        <section className="billing-invoice-detail-section">
          <h4>Account Summary at Issue</h4>
          <div className="billing-invoice-account-total">
            <span>Total Account Amount Due</span>
            <strong>{currency(accountSummary.totalAccountAmountDue)}</strong>
          </div>
        </section>
      )}

      {previousOpenInvoices.length > 0 && (
        <section className="billing-invoice-detail-section">
          <h4>Previous Unpaid Invoices</h4>
          <div className="table-responsive">
            <table className="table table-vcenter billing-invoice-detail-table billing-invoice-prior-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Billing Period</th>
                  <th>Due Date</th>
                  <th>Status at Issue</th>
                  <th className="text-end">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {previousOpenInvoices.map((previousInvoice) => {
                  const previousStatus = previousInvoice.isOverdueAtIssue ? 'OVERDUE' : previousInvoice.statusAtIssue;
                  return (
                    <tr key={previousInvoice.invoiceId || previousInvoice.invoiceNumber}>
                      <td className="fw-bold">{previousInvoice.invoiceNumber || '-'}</td>
                      <td><InvoiceBillingPeriod invoice={previousInvoice} /></td>
                      <td>{formatDate(previousInvoice.dueDate)}</td>
                      <td>
                        <span className={`badge ${statusClass(previousStatus)}`}>{String(previousStatus || '').replaceAll('_', ' ')}</span>
                        {previousInvoice.isOverdueAtIssue && (
                          <div className="text-muted small">{Number(previousInvoice.daysOverdueAtIssue || 0)} days overdue</div>
                        )}
                      </td>
                      <td className="text-end fw-bold">{currency(previousInvoice.remainingBalanceAtIssue)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="billing-invoice-detail-section">
        <h4>Charges</h4>
        <div className="table-responsive">
          <table className="table table-vcenter billing-invoice-detail-table">
            <thead>
              <tr>
                <th>Description</th>
                <th className="text-end">Quantity</th>
                <th className="text-end">Unit Price</th>
                <th className="text-end">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item, index) => (
                <tr key={`${item.description || 'item'}-${index}`}>
                  <td>
                    <div>{item.description || 'Billing item'}</div>
                    {(item.serviceId || item.catalogCode) && <div className="text-muted small">{[item.serviceId, item.catalogCode].filter(Boolean).join(' · ')}</div>}
                  </td>
                  <td className="text-end">{Number(item.quantity || 0).toLocaleString('en-PH')}</td>
                  <td className="text-end">{currency(item.unitPrice)}</td>
                  <td className="text-end fw-bold">{currency(item.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {adjustments.length > 0 && (
        <section className="billing-invoice-detail-section">
          <h4>Adjustments and Credits</h4>
          <div className="table-responsive">
            <table className="table table-vcenter billing-invoice-detail-table">
              <thead>
                <tr>
                  <th>Entry</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th className="text-end">Amount</th>
                </tr>
              </thead>
              <tbody>
                {adjustments.map((adjustment) => (
                  <tr key={adjustment.id}>
                    <td>{adjustment.adjustmentLabel || adjustmentEntryLabel(adjustment)}</td>
                    <td>{adjustment.reason || '-'}</td>
                    <td><span className={`badge ${statusClass(adjustment.status)}`}>{String(adjustment.status || '').replaceAll('_', ' ')}</span></td>
                    <td className="text-end">{adjustment.type === 'CREDIT' ? '-' : '+'}{currency(adjustment.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {payments.length > 0 && (
        <section className="billing-invoice-detail-section">
          <h4>Payment Activity</h4>
          <div className="table-responsive">
            <table className="table table-vcenter billing-invoice-detail-table">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Recorded At</th>
                  <th>Method</th>
                  <th>Status</th>
                  <th className="text-end">Applied</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{payment.receiptNumber || (payment.isCreditApplication ? 'Account credit' : '-')}</td>
                    <td>{payment.postedAt || payment.createdAt ? formatDateTime(payment.postedAt || payment.createdAt) : formatDate(payment.paymentDate)}</td>
                    <td>{String(payment.method || '-').replaceAll('_', ' ')}</td>
                    <td><span className={`badge ${statusClass(payment.status)}`}>{String(payment.status || '').replaceAll('_', ' ')}</span></td>
                    <td className="text-end">{currency(payment.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="billing-invoice-detail-section billing-invoice-financial-section">
        <h4>Summary</h4>
        <div className="billing-invoice-financial-summary">
          <div><span>Subtotal</span><strong>{currency(invoice.subtotal)}</strong></div>
          <div><span>Adjustments</span><strong>{adjustmentAmount < 0 ? '-' : adjustmentAmount > 0 ? '+' : ''}{currency(Math.abs(adjustmentAmount))}</strong></div>
          <div><span>Invoice Total</span><strong>{currency(invoice.total)}</strong></div>
          <div><span>Payments</span><strong>-{currency(paymentAmount)}</strong></div>
          {accountCreditAppliedAmount > 0 && (
            <div className="text-green"><span>Account Credits Applied</span><strong>-{currency(accountCreditAppliedAmount)}</strong></div>
          )}
          <div className="billing-invoice-balance-row">
            <span>{accountSummary ? 'This Invoice Balance Due' : 'Balance Due'}</span>
            <strong>{currency(invoice.balance)}</strong>
          </div>
        </div>
        {earlyBirdInvoiceNote(invoice) && <div className="billing-invoice-detail-note">{earlyBirdInvoiceNote(invoice)}</div>}
      </section>

      {(invoice.notes || invoice.status === 'VOID') && (
        <section className="billing-invoice-detail-section">
          <h4>Notes</h4>
          {invoice.notes && <div className="billing-invoice-detail-note">{invoice.notes}</div>}
          {invoice.status === 'VOID' && (
            <div className="billing-invoice-detail-note text-danger">
              Voided {formatDateTime(invoice.voidedAt)} by {invoice.voidedByUsername || 'Billing user'}: {invoice.voidReason || 'No reason recorded'}
            </div>
          )}
        </section>
      )}

      <div className="billing-invoice-detail-actions">
        <div>
          {invoice.status === 'DRAFT' && (
            <button className="btn" type="button" onClick={() => onEdit(invoice)}>
              <IconEdit size={16} className="me-1" />Edit Draft
            </button>
          )}
          {canVoid && (
            <button className="btn btn-outline-danger" type="button" onClick={() => onVoid(invoice)}>
              <IconTrash size={16} className="me-1" />Void Invoice
            </button>
          )}
        </div>
        <div>
          <button className="btn" type="button" onClick={onClose}>Close</button>
          <button className="btn btn-primary" type="button" disabled={pdfBusy} aria-busy={pdfBusy} onClick={() => onDownload(invoice)}>
            <IconDownload size={16} className="me-1" />{pdfBusy ? 'Preparing PDF' : 'Download PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}

function InvoiceTable({
  rows,
  onEdit,
  onVoid,
  onView,
  onDownload,
  pdfBusyId,
  avatarConfig,
  compact = false,
  emptyMessage
}) {
  if (!rows.length) return <Empty message={emptyMessage} />;
  if (!compact) {
    return (
      <div className="table-responsive billing-invoice-ledger-wrap">
        <table className="table card-table table-vcenter billing-invoice-ledger">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Billing Period</th>
              <th>Balance</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td data-label="Customer">
                  <div className="billing-invoice-ledger-customer">
                    <div className="billing-service-main">{customerLabel(row.customer)}</div>
                    {row.customer?.accountNumber && <div className="text-muted small">{row.customer.accountNumber}</div>}
                  </div>
                </td>
                <td data-label="Billing Period"><InvoiceBillingPeriod invoice={row} /></td>
                <td className="billing-invoice-ledger-balance" data-label="Balance">{currency(row.balance)}</td>
                <td className="text-end" data-label="Actions">
                  <div className="billing-invoice-row-actions">
                    <button className="btn btn-sm" type="button" title={`View ${row.invoiceNumber}`} aria-label={`View ${row.invoiceNumber}`} onClick={() => onView(row)}>
                      <IconEye size={16} />
                    </button>
                    <button
                      className="btn btn-sm"
                      type="button"
                      title={`Download ${row.invoiceNumber} PDF`}
                      aria-label={`Download ${row.invoiceNumber} PDF`}
                      disabled={pdfBusyId === row.id}
                      onClick={() => onDownload(row)}
                    >
                      <IconDownload size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="table-responsive">
      <table className="table card-table table-vcenter">
        <thead>
          <tr>
            <th>Invoice</th>
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
                  <InvoiceBillingPeriod invoice={row} compact />
	              </td>
              <td>{row.dueDate}</td>
              <td>
                <div>{currency(row.total)}</div>
                {Number(row.rebateTotal || 0) > 0 && <div className="text-green small">Rebate -{currency(row.rebateTotal)}</div>}
              </td>
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

function InvoicePagination({ page, pageSize, total, totalPages, onPage, onPageSize }) {
  if (!total) return null;
  const start = ((page - 1) * pageSize) + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="billing-invoice-pagination" aria-label="Invoice table pagination">
      <div className="billing-invoice-pagination-summary text-muted small" role="status" aria-live="polite">
        Showing {start}-{end} of {total}
      </div>
      <div className="billing-invoice-pagination-controls">
        <label className="billing-invoice-page-size text-muted small">
          <span>Rows per page</span>
          <select
            className="form-select form-select-sm"
            value={pageSize}
            aria-label="Invoices per page"
            onChange={(event) => onPageSize(Number(event.target.value))}
          >
            {[10, 20, 50].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <div className="billing-invoice-page-navigation">
          <button
            className="btn btn-sm billing-invoice-page-button"
            type="button"
            title="Previous invoice page"
            aria-label="Previous invoice page"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            <IconChevronLeft size={17} />
          </button>
          <span className="billing-invoice-page-status" aria-current="page">
            Page {page} of {totalPages}
          </span>
          <button
            className="btn btn-sm billing-invoice-page-button"
            type="button"
            title="Next invoice page"
            aria-label="Next invoice page"
            disabled={page >= totalPages}
            onClick={() => onPage(page + 1)}
          >
            <IconChevronRight size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}

function OutageRebateCustomerSelector({
  rows,
  totalRows,
  selectedIds,
  search,
  onSearch,
  onToggle,
  onSelectVisible,
  onClear
}) {
  const selectedIdSet = new Set(selectedIds);
  const selectableCount = rows.length;
  return (
    <section className="billing-rebate-selector" aria-labelledby="billing-rebate-customers-title">
      <div className="billing-rebate-section-heading">
        <div>
          <div className="form-label mb-0" id="billing-rebate-customers-title">Customers</div>
          <div className="text-muted small">{selectedIds.length} selected · {totalRows} active subscriber accounts</div>
        </div>
        <div className="billing-rebate-selection-actions">
          <button className="btn btn-sm" type="button" disabled={!selectableCount} onClick={onSelectVisible}>Select Shown</button>
          <button className="btn btn-sm" type="button" disabled={!selectedIds.length} onClick={onClear}>Clear</button>
        </div>
      </div>
      <div className="input-icon billing-rebate-customer-search">
        <span className="input-icon-addon"><IconSearch size={17} /></span>
        <input
          className="form-control"
          type="search"
          value={search}
          placeholder="Search customer, account, or plan"
          aria-label="Search rebate customers"
          onChange={(event) => onSearch(event.target.value)}
        />
        {search && (
          <button
            className="billing-invoice-search-clear"
            type="button"
            title="Clear customer search"
            aria-label="Clear customer search"
            onClick={() => onSearch('')}
          >
            <IconX size={15} />
          </button>
        )}
      </div>
      <div className="billing-rebate-customer-list" role="group" aria-label="Customers receiving outage rebates">
        {rows.length ? rows.map((row) => {
          const selected = selectedIdSet.has(row.customerId);
          const planNames = [...new Set(row.subscriptions.map((subscription) => subscription.planName).filter(Boolean))];
          return (
            <label
              className={`billing-rebate-customer-row ${selected ? 'is-selected' : ''}`}
              key={row.customerId}
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggle(row.customerId)}
              />
              <span className="billing-rebate-customer-main">
                <strong>{customerLabel(row.customer)}</strong>
                <span>
                  {[row.customer?.accountNumber, planNames.join(', ')].filter(Boolean).join(' · ') || 'Active subscription'}
                </span>
              </span>
              <span className="billing-rebate-customer-financial">
                <strong>{currency(row.monthlyRecurringCharge)} MRC</strong>
                <span>
                  {row.currentInvoice
                    ? `${row.currentInvoice.invoiceNumber} · ${currency(row.currentInvoice.balance)} balance`
                    : 'No open bill · applies to next invoice'}
                </span>
              </span>
            </label>
          );
        }) : (
          <div className="billing-rebate-empty text-muted">No active subscriber accounts match the search.</div>
        )}
      </div>
    </section>
  );
}

function OutageRebatePreview({ preview, busy, error }) {
  if (!preview && !busy && !error) return null;
  return (
    <section className="billing-rebate-preview" aria-labelledby="billing-rebate-preview-title">
      <div className="form-label mb-0" id="billing-rebate-preview-title">Rebate Preview</div>
      {busy && (
        <div className="billing-rebate-preview-loading" role="status">
          <span className="spinner-border spinner-border-sm" aria-hidden="true" />
          Calculating rebates
        </div>
      )}
      {error && <div className="alert alert-danger mb-0">{error}</div>}
      {preview && !busy && (
        <>
          <div className="billing-rebate-preview-summary">
            <div>
              <span>Outage Duration</span>
              <strong>{formatDuration(preview.durationMinutes)}</strong>
            </div>
            <div>
              <span>Customers</span>
              <strong>{preview.eligibleCount} of {preview.customerCount}</strong>
            </div>
            <div>
              <span>Total Rebate</span>
              <strong>{currency(preview.totalRebateAmount)}</strong>
            </div>
          </div>
          <div className="table-responsive billing-rebate-preview-table-wrap">
            <table className="table table-vcenter billing-rebate-preview-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Subscription</th>
                  <th>Credit Application</th>
                  <th className="text-end">Rebate</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr className={row.eligible ? '' : 'billing-rebate-preview-ineligible'} key={row.customerId}>
                    <td data-label="Customer">
                      <div className="billing-service-main">{customerLabel(row.customer)}</div>
                      <div className="text-muted small">{row.customer?.accountNumber || '-'}</div>
                      {!row.eligible && <div className="text-danger small mt-1">{row.ineligibleReason}</div>}
                    </td>
                    <td data-label="Subscription">
                      {row.subscriptions.map((subscription) => (
                        <div className="billing-rebate-plan-line" key={subscription.subscriptionId}>
                          <span>{subscription.planName}</span>
                          <strong>{currency(subscription.monthlyRate)} MRC</strong>
                        </div>
                      ))}
                    </td>
                    <td data-label="Credit Application">
                      <div>{row.invoiceNumber || 'Next generated invoice'}</div>
                      <div className="text-muted small">
                        {row.invoiceNumber
                          ? `${currency(row.applyNowAmount)} applied now`
                          : `${currency(row.carryForwardAmount)} held as account credit`}
                      </div>
                      {Number(row.carryForwardAmount || 0) > 0 && row.invoiceNumber && (
                        <div>
                          <span className="badge bg-blue-lt text-blue mt-1">
                            {currency(row.carryForwardAmount)} carries forward
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="text-end" data-label="Rebate">
                      <strong className={row.eligible ? 'text-green' : 'text-muted'}>
                        {row.eligible ? currency(row.rebateAmount) : '-'}
                      </strong>
                      {row.eligible && !row.invoiceNumber && (
                        <div><span className="badge bg-blue-lt text-blue mt-1">For next bill</span></div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!preview.canPost && (
            <div className="alert alert-warning mb-0" role="status">
              One or more selected customers are not eligible for this outage batch.
            </div>
          )}
        </>
      )}
    </section>
  );
}

function AdjustmentTable({ rows, onVoid }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-responsive">
      <table className="table card-table table-vcenter">
        <thead>
          <tr>
            <th>Application</th>
            <th>Customer</th>
            <th>Entry</th>
            <th>Amount</th>
            <th>Reason</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const applicationInvoiceNumbers = row.applicationInvoiceNumbers || [];
            const applicationLabel = applicationInvoiceNumbers.length > 1
              ? `${applicationInvoiceNumbers[0]} + ${applicationInvoiceNumbers.length - 1} more`
              : applicationInvoiceNumbers[0] || '';
            return (
              <tr key={row.id}>
                <td>
                  {row.applicationMode === 'CUSTOMER_ACCOUNT_CREDIT' ? (
                    <>
                      <div>{applicationLabel || 'Customer account credit'}</div>
                      {Number(row.creditAvailableAmount || 0) > 0 && (
                        <div className="text-muted small">{currency(row.creditAvailableAmount)} available</div>
                      )}
                    </>
                  ) : (row.invoiceNumber || '-')}
                </td>
                <td>{customerLabel(row.customer)}</td>
                <td><span className={`badge ${row.adjustmentSource === 'SERVICE_REBATE' ? 'bg-green-lt text-green' : statusClass(row.type)}`}>{adjustmentEntryLabel(row)}</span></td>
                <td>{row.type === 'CREDIT' ? '-' : '+'}{currency(row.amount)}</td>
                <td>
                  <div>{row.reason}</div>
                  {row.outageStart && (
                    <div className="text-muted small">
                      {formatDuration(row.outageDurationMinutes)} · {formatDateTime(row.outageStart)} - {formatDateTime(row.outageEnd)}
                    </div>
                  )}
                </td>
                <td><span className={`badge ${statusClass(row.status)}`}>{row.status}</span></td>
                <td className="text-end">
                  {row.status === 'POSTED' && (
                    <button className="btn btn-sm btn-outline-danger" type="button" title="Void adjustment" aria-label="Void adjustment" onClick={() => onVoid(row.id)}><IconTrash size={14} /></button>
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
