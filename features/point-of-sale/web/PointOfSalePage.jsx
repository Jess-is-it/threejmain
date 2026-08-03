import React, { useEffect, useMemo, useState } from 'react';
import {
  IconArrowsExchange2,
  IconAlertTriangle,
  IconCash,
  IconCircleCheck,
  IconCreditCard,
  IconDownload,
  IconFileInvoice,
  IconLoader2,
  IconMapPin,
  IconPackage,
  IconPrinter,
  IconReceipt,
  IconRefresh,
  IconSearch,
  IconShoppingCart,
  IconTrash,
  IconX
} from '@tabler/icons-react';
import './pointOfSale.css';

const API = '/api';
const RECEIPT_BUSINESS_NAME = '3J COMPUTER AND INTERNET INSTALLATION SERVICES';
const RECEIPT_BUSINESS_ADDRESS = 'Zone 2, Roma Norte, Enrile, Cagayan';

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

function dateKey(value) {
  if (!value) return '';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function monthLabel(value) {
  const key = dateKey(value);
  if (!key) return '';
  const date = new Date(`${key}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return key;
  return new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function invoiceCoverageLabel(invoice) {
  if (invoice?.billingPeriodLabel) return invoice.billingPeriodLabel;
  if (invoice?.billingPeriodMonth) return monthLabel(`${invoice.billingPeriodMonth}-01`) || invoice.billingPeriodMonth;
  const start = invoice?.billingCycleStart || invoice?.issueDate || '';
  const end = invoice?.billingCycleEnd || start;
  const startLabel = monthLabel(start);
  const endLabel = monthLabel(end);
  if (startLabel && endLabel && startLabel !== endLabel) return `${startLabel} - ${endLabel}`;
  return startLabel || endLabel || '-';
}

function newIdempotencyKey(scope) {
  const randomValue = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${scope}:${randomValue}`;
}

function currency(value) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0));
}

function labelize(value) {
  return String(value || '').replaceAll('_', ' ');
}

function stockQuantity(item) {
  return Number(item?.availableQuantity ?? item?.stockOnHand ?? item?.quantityOnHand ?? 0);
}

function statusClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (['active', 'open', 'completed', 'paid', 'posted', 'success'].includes(normalized)) return 'bg-green-lt text-green';
  if (['issued', 'issue', 'partially_paid', 'unpaid', 'pending', 'skipped'].includes(normalized)) return 'bg-yellow-lt text-yellow';
  if (['closed', 'inactive', 'return', 'returned'].includes(normalized)) return 'bg-blue-lt text-blue';
  if (['overdue', 'void', 'archived', 'cancelled', 'failed', 'error'].includes(normalized)) return 'bg-red-lt text-red';
  return 'bg-secondary-lt text-secondary';
}

function customerLabel(customer) {
  if (!customer) return 'Walk-in';
  return `${customer.accountNumber || 'NO-ACCOUNT'} - ${customer.name || 'Unnamed customer'}`;
}

function customerNameOnly(customer) {
  if (!customer) return 'Walk-in';
  const firstLast = [customer.firstName || customer.first_name, customer.lastName || customer.last_name].filter(Boolean).join(' ').trim();
  return firstLast || customer.fullName || customer.name || customer.displayName || 'Unnamed customer';
}

function compactLocationParts(parts) {
  return parts.map((part) => String(part || '').trim()).filter(Boolean).join(', ');
}

function customerLocationLabel(customer, fallback = '') {
  if (!customer) return fallback;
  const locationName = String(
    customer.locationName
    || customer.location_name
    || customer.serviceLocationName
    || customer.location
    || ''
  ).trim();
  const areaLabel = compactLocationParts([
    customer.barangay,
    customer.city || customer.municipality,
    customer.province
  ]);
  const addressLabel = String(
    customer.address
    || customer.serviceAddress
    || customer.installAddress
    || customer.installationAddress
    || compactLocationParts([customer.addressLine1, customer.addressLine2])
    || ''
  ).trim();
  return locationName || areaLabel || addressLabel || fallback;
}

function invoiceLocationLabel(invoice, fallback = '') {
  return customerLocationLabel(invoice?.customer, '')
    || String(invoice?.serviceAddress || invoice?.installAddress || invoice?.installationAddress || '').trim()
    || fallback;
}

function billingGroupLocationLabel(group, fallback = '-') {
  if (!group) return fallback;
  return customerLocationLabel(group.customer, '')
    || (group.invoices || []).map((invoice) => invoiceLocationLabel(invoice, '')).find(Boolean)
    || fallback;
}

function customerSmsNumber(customer) {
  return String(
    customer?.contactNumber
    || customer?.mobileNumber
    || customer?.phoneNumber
    || customer?.mobile
    || customer?.phone
    || ''
  ).trim();
}

function paymentSmsDestination(payment, invoice) {
  return customerSmsNumber(payment?.customer) || customerSmsNumber(invoice?.customer);
}

function smsStatusLabel(sms) {
  return String(sms?.status || 'NOT SENT').replaceAll('_', ' ');
}

function smsStatusDetail(sms) {
  const status = String(sms?.status || '').toUpperCase();
  if (!sms) return 'SMS confirmation was not attempted for this receipt.';
  if (status === 'SUCCESS') {
    const messageId = sms.message_id || sms.messageId;
    return `SMS confirmation sent${sms.destination ? ` to ${sms.destination}` : ''}${messageId ? ` (Message ID ${messageId})` : ''}.`;
  }
  if (status === 'SKIPPED') {
    return sms.error || 'SMS confirmation skipped because the customer has no SMS number.';
  }
  if (status === 'FAILED') {
    return `SMS confirmation failed: ${sms.error || sms.response_summary || 'No provider detail returned.'}`;
  }
  return sms.error || sms.response_summary || `SMS status: ${smsStatusLabel(sms)}.`;
}

function saleUserLabel(sale) {
  return sale.cashierName || sale.cashierUsername || 'POS user';
}

function invoiceServiceLabel(invoice) {
  return invoice?.serviceId || invoice?.serviceAccountNumber || invoice?.catalogName || invoice?.lineItems?.[0]?.description || 'Billing invoice';
}

function receiptPeriodLabel(row) {
  if (!row) return '-';
  if (row.billingPeriodLabel) return row.billingPeriodLabel;
  if (row.billingPeriodMonth) return monthLabel(`${row.billingPeriodMonth}-01`) || row.billingPeriodMonth;
  const start = row.billingCycleStart || row.issueDate || row.dueDate || row.paymentDate || '';
  const end = row.billingCycleEnd || start;
  const startLabel = monthLabel(start);
  const endLabel = monthLabel(end);
  if (startLabel && endLabel && startLabel !== endLabel) return `${startLabel} - ${endLabel}`;
  return startLabel || endLabel || '-';
}

function paymentAllocationLabel(payment) {
  const allocations = paymentReceiptAllocations(payment);
  if (allocations.length > 1) return `${allocations.length} invoices`;
  return payment?.invoiceNumber || allocations[0]?.invoiceNumber || '-';
}

function paymentAllocationDetail(payment) {
  const allocations = paymentReceiptAllocations(payment);
  if (allocations.length <= 1) return '';
  const labels = allocations.slice(0, 2).map((allocation) => allocation.invoiceNumber).filter(Boolean);
  const suffix = allocations.length > 2 ? ` +${allocations.length - 2} more` : '';
  return `${labels.join(', ')}${suffix}`;
}

function paymentReceiptAllocations(payment) {
  if (!payment) return [];
  const rows = payment.allocations?.length
    ? payment.allocations
    : (payment.invoiceId ? [{
      invoiceId: payment.invoiceId,
      invoiceNumber: payment.invoiceNumber,
      amount: payment.amount,
      balanceBefore: payment.amount
    }] : []);
  return rows.map((allocation, index) => {
    const amount = roundMoney(allocation.amount);
    const balanceBefore = roundMoney(allocation.balanceBefore ?? allocation.balance ?? amount);
    return {
      id: allocation.id || `${allocation.invoiceId || payment.id}-${index}`,
      invoiceId: allocation.invoiceId || payment.invoiceId || '',
      invoiceNumber: allocation.invoiceNumber || payment.invoiceNumber || '-',
      dueDate: allocation.dueDate || '',
      billingPeriodLabel: receiptPeriodLabel(allocation),
      service: allocation.serviceAccountNumber || allocation.catalogName || allocation.serviceId || 'Billing invoice',
      balanceBefore,
      amount,
      remainingAfter: roundMoney(Math.max(0, balanceBefore - amount))
    };
  });
}

function isPayableInvoice(invoice) {
  return Number(invoice?.balance || 0) > 0 && !['PAID', 'VOID', 'DRAFT'].includes(String(invoice?.status || '').toUpperCase());
}

function isInvoiceOverdue(invoice) {
  return isPayableInvoice(invoice) && invoice?.dueDate && invoice.dueDate < today();
}

function paymentRequiresReference(method) {
  return String(method || '').toUpperCase() !== 'CASH';
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

const historyPageSizes = ['5', '10', '25', '50'];

const historyControlDefaults = {
  register: { search: '', status: 'ALL', pageSize: '10', page: 1 },
  invoice: { search: '', status: 'ALL', pageSize: '10', page: 1 },
  office: { search: '', status: 'ALL', pageSize: '10', page: 1 }
};

function matchesHistorySearch(search, fields) {
  const needle = String(search || '').trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => String(field ?? '').toLowerCase().includes(needle));
}

function invoiceCustomerKey(invoice) {
  const customer = invoice?.customer || {};
  return String(customer.id || invoice?.customerId || customer.accountNumber || customer.name || 'unknown-customer');
}

function invoiceDueValue(invoice) {
  return invoice?.dueDate || '9999-12-31';
}

function compareBillingInvoices(first, second) {
  const firstOverdue = isInvoiceOverdue(first) ? 1 : 0;
  const secondOverdue = isInvoiceOverdue(second) ? 1 : 0;
  if (firstOverdue !== secondOverdue) return secondOverdue - firstOverdue;
  const dueCompare = invoiceDueValue(first).localeCompare(invoiceDueValue(second));
  if (dueCompare !== 0) return dueCompare;
  return String(first.invoiceNumber || '').localeCompare(String(second.invoiceNumber || ''));
}

function buildBillingCustomerGroups(invoices) {
  const groups = new Map();
  invoices.forEach((invoice) => {
    const key = invoiceCustomerKey(invoice);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        customer: invoice.customer,
        invoices: []
      });
    }
    groups.get(key).invoices.push(invoice);
  });

  return Array.from(groups.values()).map((group) => {
    const sortedInvoices = [...group.invoices].sort(compareBillingInvoices);
    const overdueInvoices = sortedInvoices.filter(isInvoiceOverdue);
    const serviceLabels = Array.from(new Set(sortedInvoices.map(invoiceServiceLabel).filter(Boolean)));
    const locationLabel = billingGroupLocationLabel({ ...group, invoices: sortedInvoices }, '');
    return {
      ...group,
      invoices: sortedInvoices,
      openInvoiceCount: sortedInvoices.length,
      totalBalance: sortedInvoices.reduce((sum, invoice) => sum + Number(invoice.balance || 0), 0),
      overdueInvoiceCount: overdueInvoices.length,
      overdueBalance: overdueInvoices.reduce((sum, invoice) => sum + Number(invoice.balance || 0), 0),
      oldestDueDate: sortedInvoices[0]?.dueDate || '',
      locationLabel,
      serviceLabels
    };
  }).sort((first, second) => {
    if (first.overdueInvoiceCount !== second.overdueInvoiceCount) return second.overdueInvoiceCount - first.overdueInvoiceCount;
    const dueCompare = (first.oldestDueDate || '9999-12-31').localeCompare(second.oldestDueDate || '9999-12-31');
    if (dueCompare !== 0) return dueCompare;
    return customerNameOnly(first.customer).localeCompare(customerNameOnly(second.customer));
  });
}

function billingCustomerGroupMatchesSearch(group, search) {
  const invoiceFields = group.invoices.flatMap((invoice) => [
    invoice.invoiceNumber,
    invoiceServiceLabel(invoice),
    invoice.status,
    invoice.balance,
    invoice.dueDate
  ]);
  return matchesHistorySearch(search, [
    customerNameOnly(group.customer),
    customerLabel(group.customer),
    group.customer?.accountNumber,
    group.openInvoiceCount,
    group.totalBalance,
    group.oldestDueDate,
    group.overdueBalance,
    group.locationLabel,
    billingGroupLocationLabel(group, ''),
    group.customer?.address,
    group.customer?.barangay,
    group.customer?.city,
    group.customer?.province,
    ...group.serviceLabels,
    ...invoiceFields
  ]);
}

function moneyEquals(first, second) {
  return Math.abs(roundMoney(first) - roundMoney(second)) < 0.001;
}

function promotionOptionLabel(option, invoice) {
  if (!option && !invoice) return 'Discount';
  const name = option?.name || invoice?.earlyBirdPromotionName || 'Early bird discount';
  return name;
}

function invoicePromotionOptions(invoice, promotionState) {
  const options = promotionState?.promotions || [];
  return options
    .map((option) => ({
      id: option.id,
      label: promotionOptionLabel(option, invoice),
      amount: roundMoney(option.discountAmountForInvoice),
      payable: roundMoney(option.discountedPayable),
      until: option.availableUntil || invoice?.earlyBirdAvailableUntil || '',
      source: option.paymentRule || 'PROMOTION'
    }))
    .filter((option) => option.id && option.amount > 0);
}

function invoicePromotionSummary(invoice, promotionState, selectedPromotionId = '') {
  if (selectedPromotionId === 'NONE') return null;
  const options = invoicePromotionOptions(invoice, promotionState);
  const recommendedId = promotionState?.recommendedPromotionId || '';
  const selected = selectedPromotionId
    ? options.find((option) => option.id === selectedPromotionId)
    : options.find((option) => option.id === recommendedId) || options[0];
  return selected || null;
}

function invoiceRecommendedPromotionBundle(invoice, promotionState) {
  const rawBundle = promotionState?.recommendedPromotionBundle;
  const rawPromotions = rawBundle?.promotions || [];
  const promotionIds = (
    promotionState?.recommendedPromotionIds
    || rawBundle?.promotionIds
    || rawPromotions.map((promotion) => promotion.id)
  ).filter(Boolean);
  const discountAmount = roundMoney(rawBundle?.discountAmount);
  const discountedPayable = roundMoney(rawBundle?.discountedPayable);
  if (promotionIds.length && discountAmount > 0 && discountedPayable > 0) {
    const labels = rawPromotions
      .map((promotion) => promotionOptionLabel(promotion, invoice))
      .filter(Boolean);
    return {
      id: promotionIds.length === 1 ? promotionIds[0] : '',
      promotionIds,
      promotions: rawPromotions,
      label: labels.join(' + ') || `${promotionIds.length} promotions`,
      count: promotionIds.length,
      amount: discountAmount,
      payable: discountedPayable,
      source: 'PROMOTION_BUNDLE'
    };
  }
  const singlePromotion = invoicePromotionSummary(invoice, promotionState);
  if (!singlePromotion) return null;
  return {
    ...singlePromotion,
    promotionIds: [singlePromotion.id],
    promotions: [singlePromotion],
    count: 1
  };
}

function triggeredPromotionForAllocation(invoice, promotionState, allocationAmount) {
  const promotion = invoiceRecommendedPromotionBundle(invoice, promotionState);
  if (!promotion) return null;
  return moneyEquals(allocationAmount, promotion.payable) ? promotion : null;
}

function paymentDiscountAmount(payment) {
  return roundMoney(
    payment?.discountAmount
    ?? payment?.promotionDiscountAmount
    ?? payment?.earlyBirdDiscountAmount
    ?? 0
  );
}

function paymentDiscountLabel(payment) {
  return payment?.discountLabel
    || payment?.promotionName
    || (payment?.earlyBirdDiscountApplied ? 'Early bird discount' : 'Discount applied');
}

function uniqueOptions(values) {
  return ['ALL', ...Array.from(new Set(values.filter(Boolean)))];
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' });
}

function paymentRecordedAt(payment) {
  return payment?.postedAt || payment?.paidAt || payment?.createdAt || '';
}

function paymentRecordedDateKey(payment) {
  return dateKey(paymentRecordedAt(payment)) || dateKey(payment?.paymentDate);
}

function pagedRows(rows, control) {
  const pageSize = Number(control.pageSize || 10);
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(Number(control.page || 1), 1), totalPages);
  const startIndex = (page - 1) * pageSize;
  const pageRows = rows.slice(startIndex, startIndex + pageSize);
  return {
    rows: pageRows,
    page,
    pageSize,
    total,
    totalPages,
    start: total ? startIndex + 1 : 0,
    end: Math.min(startIndex + pageSize, total)
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

function TextField({ label, value, onChange, type = 'text', required = false, min, max, step, disabled = false }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <input className="form-control" type={type} value={value ?? ''} min={min} max={max} step={step} required={required} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function SelectField({ label, value, onChange, options = [], required = false, disabled = false, children }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <select className="form-select" value={value ?? ''} required={required} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {children || options.map((option) => <option key={option} value={option}>{option.replaceAll('_', ' ')}</option>)}
      </select>
    </div>
  );
}

function HistoryControls({ control, filterOptions, searchPlaceholder, onChange }) {
  return (
    <div className="pos-table-controls">
      <div className="pos-table-search">
        <IconSearch size={16} />
        <input
          className="form-control form-control-sm"
          value={control.search}
          onChange={(event) => onChange({ search: event.target.value })}
          placeholder={searchPlaceholder}
        />
      </div>
      <label className="pos-table-select">
        <span>Filter</span>
        <select className="form-select form-select-sm" value={control.status} onChange={(event) => onChange({ status: event.target.value })}>
          {filterOptions.map((option) => <option key={option} value={option}>{labelize(option)}</option>)}
        </select>
      </label>
      <label className="pos-table-select">
        <span>Show</span>
        <select className="form-select form-select-sm" value={control.pageSize} onChange={(event) => onChange({ pageSize: event.target.value })}>
          {historyPageSizes.map((size) => <option key={size} value={size}>{size} entries</option>)}
        </select>
      </label>
    </div>
  );
}

function HistoryPagination({ page, totalPages, start, end, total, onPage }) {
  return (
    <div className="pos-table-pagination">
      <span>Showing {start} to {end} of {total} entries</span>
      <div className="btn-group">
        <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <button type="button" className="btn btn-sm" disabled>{page} / {totalPages}</button>
        <button type="button" className="btn btn-sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

function receiptMoney(value) {
  return `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function safeReceiptText(value) {
  return String(value ?? '').replace(/[<>&"]/g, (char) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;'
  }[char]));
}

function pdfText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[\\()]/g, '\\$&')
    .slice(0, 120);
}

function receiptFileName(receiptNumber) {
  const clean = String(receiptNumber || 'official-receipt').replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '');
  return `${clean || 'official-receipt'}.pdf`;
}

function normalizeReceiptBalanceDetails(details) {
  return (details || [])
    .map((detail, index) => ({
      id: detail.id || detail.invoiceId || `${detail.invoiceNumber || 'balance'}-${index}`,
      invoiceId: detail.invoiceId || '',
      invoiceNumber: detail.invoiceNumber || '',
      periodLabel: detail.periodLabel || receiptPeriodLabel(detail),
      amount: roundMoney(detail.amount ?? detail.balance)
    }))
    .filter((detail) => detail.amount > 0);
}

function receiptRemainingBalanceDetails(payment, invoiceRows = []) {
  const explicitDetails = normalizeReceiptBalanceDetails(payment?.remainingBalanceDetails);
  if (explicitDetails.length) return explicitDetails;
  const customerId = payment?.customerId || payment?.customer?.id || '';
  if (!customerId) return [];
  return normalizeReceiptBalanceDetails(
    invoiceRows
      .filter((invoice) => invoice?.customerId === customerId && isPayableInvoice(invoice))
      .map((invoice) => ({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        periodLabel: invoiceCoverageLabel(invoice),
        amount: invoice.balance
      }))
  );
}

function selectedReceiptRemainingDetails(rows, selectedInvoiceIds = []) {
  const selectedIds = new Set(selectedInvoiceIds);
  return normalizeReceiptBalanceDetails(
    (rows || []).map((row) => {
      const selected = selectedIds.has(row.invoice?.id);
      const selectedDiscount = selected ? roundMoney(row.promotion?.amount || 0) : 0;
      const selectedPayment = selected ? roundMoney(row.amountToCollect || 0) : 0;
      const amount = selected
        ? roundMoney(Math.max(0, row.currentBalance - selectedPayment - selectedDiscount))
        : roundMoney(row.currentBalance);
      if (amount <= 0) return null;
      return {
        invoiceId: row.invoice?.id,
        invoiceNumber: row.invoice?.invoiceNumber,
        periodLabel: invoiceCoverageLabel(row.invoice),
        amount
      };
    }).filter(Boolean)
  );
}

function receiptViewModel(payment, invoiceRows = []) {
  const allocations = paymentReceiptAllocations(payment);
  const discountAmount = paymentDiscountAmount(payment);
  const amountReceived = roundMoney(payment.amountReceived ?? payment.amount);
  const appliedAmount = roundMoney(payment.appliedAmount ?? allocations.reduce((sum, allocation) => sum + allocation.amount, 0));
  const returnedAmount = roundMoney(payment.returnedAmount || 0);
  const advanceAmount = roundMoney(payment.advanceAmount || 0);
  const originalInvoiceBalance = roundMoney(allocations.reduce((sum, allocation) => sum + allocation.balanceBefore, 0));
  const remainingAccountBalance = roundMoney(payment.remainingAccountBalance ?? Math.max(0, allocations.reduce((sum, allocation) => sum + allocation.remainingAfter, 0) - discountAmount));
  const remainingBalanceDetails = receiptRemainingBalanceDetails(payment, invoiceRows);
  const recordedAt = paymentRecordedAt(payment);
  return {
    receiptNumber: payment.receiptNumber || '-',
    customerName: customerNameOnly(payment.customer),
    accountNumber: payment.customer?.accountNumber || '-',
    customerLocation: customerLocationLabel(payment.customer, '-'),
    postedAt: recordedAt ? formatDateTime(recordedAt) : (payment.paymentDate || '-'),
    method: labelize(payment.method || '-'),
    referenceNumber: payment.referenceNumber || '-',
    cashier: payment.postedByName || payment.postedByUsername || '-',
    allocations,
    originalInvoiceBalance,
    appliedAmount,
    amountReceived,
    discountAmount,
    discountLabel: discountAmount > 0 ? paymentDiscountLabel(payment) : '',
    returnedAmount,
    advanceAmount,
    remainingAccountBalance,
    remainingBalanceDetails
  };
}

function receiptRemainingDetailText(receipt) {
  if (receipt.remainingAccountBalance <= 0) return '';
  if (!receipt.remainingBalanceDetails.length) return 'Remaining unpaid customer balance.';
  return receipt.remainingBalanceDetails
    .map((detail) => `${detail.periodLabel}${detail.invoiceNumber ? ` (${detail.invoiceNumber})` : ''}: ${receiptMoney(detail.amount)}`)
    .join('; ');
}

function buildReceiptPrintHtml(receipt) {
  const allocationRows = receipt.allocations.map((allocation) => `
    <tr>
      <td>
        <strong>${safeReceiptText(allocation.invoiceNumber)}</strong>
        <span>${safeReceiptText(allocation.billingPeriodLabel || '-')}</span>
      </td>
      <td>${safeReceiptText(receiptMoney(allocation.amount))}</td>
    </tr>
  `).join('');
  const discountRow = receipt.discountAmount > 0
    ? `<div><span>Less ${safeReceiptText(receipt.discountLabel || 'Discount')}</span><strong>-${safeReceiptText(receiptMoney(receipt.discountAmount))}</strong></div>`
    : '';
  const changeRow = receipt.returnedAmount > 0
    ? `<div><span>Change returned</span><strong>${safeReceiptText(receiptMoney(receipt.returnedAmount))}</strong></div>`
    : '';
  const advanceRow = receipt.advanceAmount > 0
    ? `<div><span>Advance credit</span><strong>${safeReceiptText(receiptMoney(receipt.advanceAmount))}</strong></div>`
    : '';
  const remainingDetail = receiptRemainingDetailText(receipt);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${safeReceiptText(receipt.receiptNumber)}</title>
  <style>
    @page { size: 80mm auto; margin: 4mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #111827; font-family: Arial, sans-serif; font-size: 11px; }
    .receipt { width: 72mm; margin: 0 auto; }
    .center { text-align: center; }
    h1, h2, p { margin: 0; }
    h1 { font-size: 13px; letter-spacing: 0; text-transform: uppercase; }
    h2 { margin-top: 5px; font-size: 12px; letter-spacing: 0; text-transform: uppercase; }
    .muted { color: #4b5563; }
    .line { border-top: 1px dashed #111827; margin: 7px 0; }
    .row, .total div { display: flex; justify-content: space-between; gap: 8px; margin: 3px 0; }
    .row span:first-child, .total span { color: #4b5563; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    td { padding: 4px 0; vertical-align: top; border-bottom: 1px dotted #9ca3af; }
    td:last-child { text-align: right; white-space: nowrap; }
    td span { display: block; color: #4b5563; font-size: 10px; line-height: 1.25; }
    .total strong { white-space: nowrap; }
    .grand { margin-top: 5px; padding-top: 5px; border-top: 1px solid #111827; font-size: 12px; }
    .sign { margin-top: 18px; text-align: center; }
    .sign div { border-top: 1px solid #111827; padding-top: 3px; }
  </style>
</head>
<body>
  <main class="receipt">
    <header class="center">
      <h1>${safeReceiptText(RECEIPT_BUSINESS_NAME)}</h1>
      <p class="muted">${safeReceiptText(RECEIPT_BUSINESS_ADDRESS)}</p>
      <h2>Official Receipt</h2>
    </header>
    <div class="line"></div>
    <section>
      <div class="row"><span>OR No.</span><strong>${safeReceiptText(receipt.receiptNumber)}</strong></div>
      <div class="row"><span>Date/Time</span><strong>${safeReceiptText(receipt.postedAt)}</strong></div>
    </section>
    <div class="line"></div>
    <section>
      <div class="row"><span>Received from</span><strong>${safeReceiptText(receipt.customerName)}</strong></div>
      <div class="row"><span>Account</span><strong>${safeReceiptText(receipt.accountNumber)}</strong></div>
      <div class="row"><span>Location</span><strong>${safeReceiptText(receipt.customerLocation)}</strong></div>
    </section>
    <div class="line"></div>
    <table>
      <tbody>
        ${allocationRows || '<tr><td>No invoice lines found.</td><td>PHP 0.00</td></tr>'}
      </tbody>
    </table>
    <section class="total">
      <div><span>Invoice balance</span><strong>${safeReceiptText(receiptMoney(receipt.originalInvoiceBalance))}</strong></div>
      ${discountRow}
      <div class="grand"><span>Payment applied</span><strong>${safeReceiptText(receiptMoney(receipt.appliedAmount))}</strong></div>
      <div><span>Amount received</span><strong>${safeReceiptText(receiptMoney(receipt.amountReceived))}</strong></div>
      ${changeRow}
      ${advanceRow}
      <div><span>Remaining balance</span><strong>${safeReceiptText(receiptMoney(receipt.remainingAccountBalance))}</strong></div>
      ${remainingDetail ? `<p class="muted">${safeReceiptText(remainingDetail)}</p>` : ''}
    </section>
    <div class="line"></div>
    <section>
      <div class="row"><span>Method</span><strong>${safeReceiptText(receipt.method)}</strong></div>
      <div class="row"><span>Reference</span><strong>${safeReceiptText(receipt.referenceNumber)}</strong></div>
      <div class="row"><span>Cashier</span><strong>${safeReceiptText(receipt.cashier)}</strong></div>
    </section>
    <footer class="sign">
      <div>Authorized Signature</div>
    </footer>
    <p class="center muted">Thank you for your payment!</p>
  </main>
</body>
</html>`;
}

function printThermalReceipt(payment, invoiceRows = []) {
  const receipt = receiptViewModel(payment, invoiceRows);
  const printWindow = window.open('', '_blank', 'width=380,height=720');
  if (!printWindow) return;
  printWindow.document.open();
  printWindow.document.write(buildReceiptPrintHtml(receipt));
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 250);
}

function pdfPlainText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}

function pdfNumber(value) {
  return Number(value).toFixed(2).replace(/\.?0+$/, '') || '0';
}

function pdfColor(color) {
  return color.map((component) => pdfNumber(Number(component) / 255)).join(' ');
}

function pdfTextWidth(value, size = 10) {
  return pdfPlainText(value).split('').reduce((sum, char) => {
    if (char === ' ') return sum + size * 0.28;
    if ('ilI1.,:;!|'.includes(char)) return sum + size * 0.28;
    if ('MW@#%&'.includes(char)) return sum + size * 0.82;
    if (/[A-Z]/.test(char)) return sum + size * 0.58;
    if (/[0-9]/.test(char)) return sum + size * 0.54;
    return sum + size * 0.5;
  }, 0);
}

function pdfWrapText(value, maxWidth, size = 10) {
  const text = pdfPlainText(value) || '-';
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (pdfTextWidth(next, size) <= maxWidth || !current) {
      current = next;
      return;
    }
    lines.push(current);
    current = word;
  });
  if (current) lines.push(current);
  return lines.length ? lines : ['-'];
}

function buildPdfDocument(pageStreams) {
  const pageCount = pageStreams.length;
  const fontRegularId = 3 + (pageCount * 2);
  const fontBoldId = fontRegularId + 1;
  const pageIds = pageStreams.map((_, index) => 3 + (index * 2));
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`
  ];
  pageStreams.forEach((stream, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}

function buildReceiptPdf(receipt) {
  const colors = {
    ink: [31, 41, 55],
    muted: [75, 85, 99],
    border: [209, 213, 219],
    panel: [249, 250, 251],
    header: [243, 244, 246],
    white: [255, 255, 255]
  };
  const pageStreams = [];
  let commands = [];
  let cursorY = 736;
  const receiptX = 42;
  const receiptW = 528;
  const contentX = 78;
  const contentW = 456;
  const pageBottom = 54;

  const add = (command) => commands.push(command);
  const rect = (x, topY, width, height, options = {}) => {
    const bottomY = topY - height;
    if (options.fill) add(`q ${pdfColor(options.fill)} rg ${pdfNumber(x)} ${pdfNumber(bottomY)} ${pdfNumber(width)} ${pdfNumber(height)} re f Q`);
    if (options.stroke) add(`q ${pdfColor(options.stroke)} RG ${pdfNumber(options.lineWidth || 0.75)} w ${pdfNumber(x)} ${pdfNumber(bottomY)} ${pdfNumber(width)} ${pdfNumber(height)} re S Q`);
  };
  const line = (x1, y1, x2, y2, options = {}) => {
    add(`q ${pdfColor(options.color || colors.border)} RG ${pdfNumber(options.width || 0.75)} w ${pdfNumber(x1)} ${pdfNumber(y1)} m ${pdfNumber(x2)} ${pdfNumber(y2)} l S Q`);
  };
  const text = (value, x, y, options = {}) => {
    const size = options.size || 10;
    const clean = pdfPlainText(value) || '-';
    const width = options.width || 0;
    let drawX = x;
    if (options.align === 'center' && width) drawX = x + ((width - pdfTextWidth(clean, size)) / 2);
    if (options.align === 'right' && width) drawX = x + width - pdfTextWidth(clean, size);
    add(`${pdfColor(options.color || colors.ink)} rg BT /${options.bold ? 'F2' : 'F1'} ${pdfNumber(size)} Tf ${pdfNumber(drawX)} ${pdfNumber(y)} Td (${pdfText(clean)}) Tj ET`);
  };
  const drawPageFrame = (continued = false) => {
    rect(receiptX, 760, receiptW, 704, { fill: colors.white, stroke: colors.border, lineWidth: 1 });
    if (continued) {
      text(RECEIPT_BUSINESS_NAME, contentX, 736, { size: 10, bold: true, width: contentW, align: 'center' });
      text(`Official Receipt ${receipt.receiptNumber} - continued`, contentX, 720, { size: 9, color: colors.muted, width: contentW, align: 'center' });
      line(contentX, 704, contentX + contentW, 704, { color: colors.ink, width: 1 });
      cursorY = 684;
    }
  };
  const startPage = (continued = false) => {
    if (commands.length) pageStreams.push(commands.join('\n'));
    commands = [];
    cursorY = 736;
    drawPageFrame(continued);
  };
  const ensureSpace = (height) => {
    if (cursorY - height < pageBottom) startPage(true);
  };
  const drawFieldSection = (fields) => {
    const rows = fields.map((field) => ({
      ...field,
      valueLines: pdfWrapText(field.value, contentW - 124, 10)
    }));
    const height = rows.reduce((sum, row) => sum + Math.max(22, 8 + (row.valueLines.length * 12)), 10);
    ensureSpace(height + 12);
    rect(contentX, cursorY, contentW, height, { stroke: colors.border, lineWidth: 0.75 });
    let rowTop = cursorY - 10;
    rows.forEach((row, index) => {
      const rowHeight = Math.max(22, 8 + (row.valueLines.length * 12));
      text(row.label, contentX + 12, rowTop - 10, { size: 9, color: colors.muted });
      row.valueLines.forEach((valueLine, lineIndex) => {
        text(valueLine, contentX + 122, rowTop - 10 - (lineIndex * 12), { size: 10, bold: true });
      });
      if (index < rows.length - 1) line(contentX, rowTop - rowHeight + 2, contentX + contentW, rowTop - rowHeight + 2, { color: colors.border, width: 0.5 });
      rowTop -= rowHeight;
    });
    cursorY -= height + 12;
  };
  const drawTableHeader = () => {
    const headerH = 26;
    rect(contentX, cursorY, contentW, headerH, { fill: colors.header, stroke: colors.border, lineWidth: 0.75 });
    text('Particulars', contentX + 10, cursorY - 17, { size: 9, bold: true, color: colors.muted });
    text('Invoice Balance', contentX + 286, cursorY - 17, { size: 9, bold: true, color: colors.muted, width: 82, align: 'right' });
    text('Payment Applied', contentX + 374, cursorY - 17, { size: 9, bold: true, color: colors.muted, width: 72, align: 'right' });
    line(contentX + 274, cursorY, contentX + 274, cursorY - headerH, { color: colors.border, width: 0.5 });
    line(contentX + 370, cursorY, contentX + 370, cursorY - headerH, { color: colors.border, width: 0.5 });
    cursorY -= headerH;
  };
  const drawParticularsTable = () => {
    const rows = receipt.allocations.length ? receipt.allocations : [{
      id: 'empty',
      invoiceNumber: 'No invoice allocation lines found',
      billingPeriodLabel: '-',
      balanceBefore: 0,
      amount: 0
    }];
    ensureSpace(60);
    drawTableHeader();
    rows.forEach((allocation) => {
      const invoiceLines = pdfWrapText(allocation.invoiceNumber, 252, 10);
      const periodLines = pdfWrapText(allocation.billingPeriodLabel || '-', 252, 9);
      const rowH = Math.max(36, 14 + (invoiceLines.length * 12) + (periodLines.length * 11));
      if (cursorY - rowH < pageBottom) {
        startPage(true);
        drawTableHeader();
      }
      rect(contentX, cursorY, contentW, rowH, { stroke: colors.border, lineWidth: 0.5 });
      let textY = cursorY - 14;
      invoiceLines.forEach((lineText, index) => text(lineText, contentX + 10, textY - (index * 12), { size: 10, bold: true }));
      textY -= invoiceLines.length * 12;
      periodLines.forEach((lineText, index) => text(lineText, contentX + 10, textY - (index * 11), { size: 9, color: colors.muted }));
      text(receiptMoney(allocation.balanceBefore), contentX + 286, cursorY - 21, { size: 10, width: 82, align: 'right' });
      text(receiptMoney(allocation.amount), contentX + 374, cursorY - 21, { size: 10, bold: true, width: 72, align: 'right' });
      line(contentX + 274, cursorY, contentX + 274, cursorY - rowH, { color: colors.border, width: 0.5 });
      line(contentX + 370, cursorY, contentX + 370, cursorY - rowH, { color: colors.border, width: 0.5 });
      cursorY -= rowH;
    });
    cursorY -= 14;
  };
  const drawTotals = () => {
    const rows = [
      { label: 'Invoice Balance', value: receiptMoney(receipt.originalInvoiceBalance) },
      ...(receipt.discountAmount > 0 ? [{ label: `Less ${receipt.discountLabel || 'Discount'}`, value: `-${receiptMoney(receipt.discountAmount)}`, color: [21, 128, 61] }] : []),
      { label: 'Payment Applied', value: receiptMoney(receipt.appliedAmount), bold: true, ruleBefore: true },
      { label: 'Amount Received', value: receiptMoney(receipt.amountReceived) },
      ...(receipt.returnedAmount > 0 ? [{ label: 'Change Returned', value: receiptMoney(receipt.returnedAmount) }] : []),
      ...(receipt.advanceAmount > 0 ? [{ label: 'Advance Credit', value: receiptMoney(receipt.advanceAmount) }] : []),
      { label: 'Remaining Balance', value: receiptMoney(receipt.remainingAccountBalance), bold: true }
    ];
    const detailLines = receipt.remainingAccountBalance > 0
      ? pdfWrapText(receiptRemainingDetailText(receipt), 230, 8.5)
      : [];
    const boxW = 268;
    const boxX = contentX + contentW - boxW;
    const height = 16 + (rows.length * 18) + (detailLines.length ? 8 + (detailLines.length * 11) : 0);
    ensureSpace(height + 16);
    rect(boxX, cursorY, boxW, height, { fill: colors.panel, stroke: colors.border, lineWidth: 0.75 });
    let rowY = cursorY - 17;
    rows.forEach((row) => {
      if (row.ruleBefore) line(boxX + 12, rowY + 8, boxX + boxW - 12, rowY + 8, { color: colors.border, width: 0.75 });
      text(row.label, boxX + 12, rowY, { size: 9.5, color: row.color || colors.muted });
      text(row.value, boxX + 116, rowY, { size: 9.5, bold: row.bold, color: row.color || colors.ink, width: boxW - 128, align: 'right' });
      rowY -= 18;
    });
    if (detailLines.length) {
      rowY -= 2;
      detailLines.forEach((detailLine) => {
        text(detailLine, boxX + 12, rowY, { size: 8.5, color: colors.muted });
        rowY -= 11;
      });
    }
    cursorY -= height + 16;
  };
  const drawSignature = () => {
    ensureSpace(84);
    const centerX = contentX + (contentW / 2);
    line(centerX - 92, cursorY - 28, centerX + 92, cursorY - 28, { color: colors.ink, width: 0.75 });
    text('Authorized Signature', centerX - 92, cursorY - 43, { size: 9, color: colors.muted, width: 184, align: 'center' });
    text('Thank you for your payment!', contentX, cursorY - 74, { size: 10, bold: true, color: colors.muted, width: contentW, align: 'center' });
    cursorY -= 92;
  };

  startPage(false);
  text(RECEIPT_BUSINESS_NAME, contentX, cursorY, { size: 13, bold: true, width: contentW, align: 'center' });
  cursorY -= 17;
  text(RECEIPT_BUSINESS_ADDRESS, contentX, cursorY, { size: 10, color: colors.muted, width: contentW, align: 'center' });
  cursorY -= 26;
  text('OFFICIAL RECEIPT', contentX, cursorY, { size: 15, bold: true, width: contentW, align: 'center' });
  cursorY -= 18;
  line(contentX, cursorY, contentX + contentW, cursorY, { color: colors.ink, width: 1.2 });
  cursorY -= 18;

  drawFieldSection([
    { label: 'OR No.', value: receipt.receiptNumber },
    { label: 'Date/Time', value: receipt.postedAt }
  ]);
  drawFieldSection([
    { label: 'Received from', value: receipt.customerName },
    { label: 'Account', value: receipt.accountNumber },
    { label: 'Location', value: receipt.customerLocation }
  ]);
  drawParticularsTable();
  drawTotals();
  drawFieldSection([
    { label: 'Payment Method', value: receipt.method },
    { label: 'Reference', value: receipt.referenceNumber },
    { label: 'Cashier', value: receipt.cashier }
  ]);
  drawSignature();

  pageStreams.push(commands.join('\n'));
  return buildPdfDocument(pageStreams);
}

function downloadReceiptPdf(payment, invoiceRows = []) {
  const receipt = receiptViewModel(payment, invoiceRows);
  const blob = new Blob([buildReceiptPdf(receipt)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = receiptFileName(receipt.receiptNumber);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function ReceiptDetailModal({ payment, invoiceRows = [], onClose, onVoid }) {
  if (!payment) return null;
  const receipt = receiptViewModel(payment, invoiceRows);
  const canVoid = payment.status === 'POSTED';
  return (
    <div className="pos-modal-backdrop" onClick={onClose}>
      <section className="pos-modal pos-receipt-modal" role="dialog" aria-modal="true" aria-labelledby="pos-receipt-title" onClick={(event) => event.stopPropagation()}>
        <div className="pos-modal-header">
          <div>
            <span className="pos-modal-eyebrow">Official Receipt</span>
            <h3 id="pos-receipt-title">{payment.receiptNumber || '-'}</h3>
          </div>
          <button type="button" className="btn btn-icon btn-sm" onClick={onClose} aria-label="Close receipt detail"><IconX size={18} /></button>
        </div>
        <div className="pos-modal-body pos-receipt-modal-body">
          <article className="pos-official-receipt">
            <header className="pos-official-receipt-header">
              <strong>{RECEIPT_BUSINESS_NAME}</strong>
              <span>{RECEIPT_BUSINESS_ADDRESS}</span>
              <h2>Official Receipt</h2>
            </header>

            <section className="pos-official-receipt-meta">
              <div><span>OR No.</span><strong>{receipt.receiptNumber}</strong></div>
              <div><span>Date/Time</span><strong>{receipt.postedAt}</strong></div>
            </section>

            <section className="pos-official-receipt-party">
              <div>
                <span>Received from</span>
                <strong>{receipt.customerName}</strong>
              </div>
              <div>
                <span>Account</span>
                <strong>{receipt.accountNumber}</strong>
              </div>
              <div>
                <span>Location</span>
                <strong>{receipt.customerLocation}</strong>
              </div>
            </section>

            <div className="pos-official-receipt-table-wrap">
              <table className="pos-official-receipt-table">
                <thead><tr><th>Particulars</th><th>Invoice Balance</th><th>Payment Applied</th></tr></thead>
                <tbody>
                  {receipt.allocations.map((allocation) => (
                    <tr key={allocation.id}>
                      <td>
                        <strong>{allocation.invoiceNumber}</strong>
                        <span>{allocation.billingPeriodLabel || '-'}</span>
                      </td>
                      <td>{currency(allocation.balanceBefore)}</td>
                      <td>{currency(allocation.amount)}</td>
                    </tr>
                  ))}
                  {!receipt.allocations.length && <tr><td colSpan="3" className="text-muted">No invoice allocation lines found for this receipt.</td></tr>}
                </tbody>
              </table>
            </div>

            <section className="pos-official-receipt-totals">
              <div><span>Invoice Balance</span><strong>{currency(receipt.originalInvoiceBalance)}</strong></div>
              {receipt.discountAmount > 0 && (
                <div><span>Less {receipt.discountLabel || 'Discount'}</span><strong>-{currency(receipt.discountAmount)}</strong></div>
              )}
              <div className="is-total"><span>Payment Applied</span><strong>{currency(receipt.appliedAmount)}</strong></div>
              <div><span>Amount Received</span><strong>{currency(receipt.amountReceived)}</strong></div>
              {receipt.returnedAmount > 0 && <div><span>Change Returned</span><strong>{currency(receipt.returnedAmount)}</strong></div>}
              {receipt.advanceAmount > 0 && <div><span>Advance Credit</span><strong>{currency(receipt.advanceAmount)}</strong></div>}
              <div><span>Remaining Balance</span><strong>{currency(receipt.remainingAccountBalance)}</strong></div>
              {receipt.remainingAccountBalance > 0 && (
                <section className="pos-official-receipt-balance-detail">
                  {receipt.remainingBalanceDetails.length ? (
                    receipt.remainingBalanceDetails.map((detail) => (
                      <span key={detail.id}>
                        {detail.periodLabel}{detail.invoiceNumber ? ` (${detail.invoiceNumber})` : ''}: {currency(detail.amount)}
                      </span>
                    ))
                  ) : (
                    <span>Remaining unpaid customer balance.</span>
                  )}
                </section>
              )}
            </section>

            <section className="pos-official-receipt-payment">
              <div><span>Payment Method</span><strong>{receipt.method}</strong></div>
              <div><span>Reference</span><strong>{receipt.referenceNumber}</strong></div>
              <div><span>Cashier</span><strong>{receipt.cashier}</strong></div>
            </section>

            <div className="pos-official-receipt-signature">
              <span>Authorized Signature</span>
            </div>
            <p className="pos-official-receipt-thanks">Thank you for your payment!</p>
          </article>
        </div>
        <div className="pos-modal-footer">
          <div className="btn-list">
            <button type="button" className="btn" onClick={() => downloadReceiptPdf(payment, invoiceRows)}><IconDownload size={16} className="me-1" />Download PDF</button>
            <button type="button" className="btn" onClick={() => printThermalReceipt(payment, invoiceRows)}><IconPrinter size={16} className="me-1" />Print</button>
          </div>
          <div className="btn-list">
            {canVoid && <button type="button" className="btn text-danger" onClick={() => onVoid(payment)}><IconTrash size={16} className="me-1" />Void Receipt</button>}
            <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function VoidBillingReceiptModal({ payment, reason, submitting, onReasonChange, onClose, onConfirm }) {
  if (!payment) return null;
  const allocations = paymentReceiptAllocations(payment);
  return (
    <div className="pos-modal-backdrop" onClick={submitting ? undefined : onClose}>
      <section className="pos-modal pos-void-modal" role="dialog" aria-modal="true" aria-labelledby="pos-void-title" onClick={(event) => event.stopPropagation()}>
        <form onSubmit={onConfirm}>
          <div className="pos-modal-header">
            <div>
              <span className="pos-modal-eyebrow">Void Billing Receipt</span>
              <h3 id="pos-void-title">{payment.receiptNumber || '-'}</h3>
            </div>
            <button type="button" className="btn btn-icon btn-sm" disabled={submitting} onClick={onClose} aria-label="Close void receipt"><IconX size={18} /></button>
          </div>
          <div className="pos-modal-body">
            <div className="alert alert-warning mb-3">
              Voiding this receipt reverses {allocations.length || 1} invoice allocation{allocations.length === 1 ? '' : 's'} totaling {currency(payment.amount)}.
            </div>
            <label className="form-label">Void Reason</label>
            <textarea
              className="form-control"
              rows="4"
              value={reason}
              required
              disabled={submitting}
              placeholder="Example: Wrong customer, wrong amount, duplicate posting, or payment cancelled."
              onChange={(event) => onReasonChange(event.target.value)}
            />
          </div>
          <div className="pos-modal-footer">
            <button type="button" className="btn" disabled={submitting} onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-danger" disabled={submitting}>
              {submitting ? <IconLoader2 size={16} className="me-1 pos-spin" /> : <IconTrash size={16} className="me-1" />}
              {submitting ? 'Voiding Receipt' : 'Void Receipt'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

const blankItem = {
  id: '',
  sku: '',
  name: '',
  category: 'Network Equipment',
  unitPrice: '',
  stockOnHand: '',
  reorderPoint: '0',
  taxable: false,
  status: 'ACTIVE',
  notes: ''
};

const blankSaleLine = {
  itemId: '',
  serialNumber: '',
  description: '',
  quantity: '1',
  unitPrice: '',
  discountAmount: '0'
};

const blankSale = {
  id: '',
  customerId: '',
  saleDate: today(),
  lineItems: [blankSaleLine],
  discountAmount: '0',
  status: 'COMPLETED',
  paymentAmount: '',
  paymentMethod: 'CASH',
  paymentReference: '',
  notes: ''
};

const blankOfficeStockForm = {
  referenceId: '',
  handledBy: '',
  location: '',
  notes: ''
};

const blankInvoicePayment = {
  invoiceId: '',
  amount: '',
  excessAction: '',
  method: 'CASH',
  paymentDate: today(),
  referenceNumber: '',
  notes: ''
};

const officeModeCopy = {
  ISSUE: {
    title: 'Check Out',
    button: 'Complete Check Out',
    message: 'Office stock checked out.'
  },
  RETURN: {
    title: 'Check In',
    button: 'Complete Check In',
    message: 'Office stock checked in.'
  }
};

export default function PointOfSalePage({ refreshShell = () => {} }) {
  const [activeTab, setActiveTab] = useState('Register');
  const [meta, setMeta] = useState({ itemStatuses: [], saleStatuses: [], paymentMethods: [] });
  const [overview, setOverview] = useState({ metrics: {}, recentSales: [], lowStock: [] });
  const [items, setItems] = useState([]);
  const [sales, setSales] = useState([]);
  const [registerPayments, setRegisterPayments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [officeItems, setOfficeItems] = useState([]);
  const [officeSearch, setOfficeSearch] = useState('');
  const [officeMode, setOfficeMode] = useState('ISSUE');
  const [officeStockForm, setOfficeStockForm] = useState(blankOfficeStockForm);
  const [officeCart, setOfficeCart] = useState([]);
  const [officeMovements, setOfficeMovements] = useState([]);
  const [billingMeta, setBillingMeta] = useState({ paymentMethods: [] });
  const [billingInvoices, setBillingInvoices] = useState([]);
  const [billingPayments, setBillingPayments] = useState([]);
  const [billingInvoicePromotionsById, setBillingInvoicePromotionsById] = useState({});
  const [billingSearch, setBillingSearch] = useState('');
  const [selectedBillingInvoiceId, setSelectedBillingInvoiceId] = useState('');
  const [selectedBillingInvoiceIds, setSelectedBillingInvoiceIds] = useState([]);
  const [selectedBillingCustomerId, setSelectedBillingCustomerId] = useState('');
  const [invoicePaymentForm, setInvoicePaymentForm] = useState(blankInvoicePayment);
  const [registerCheckoutIdempotencyKey, setRegisterCheckoutIdempotencyKey] = useState(() => newIdempotencyKey('pos-sale'));
  const [invoicePaymentIdempotencyKey, setInvoicePaymentIdempotencyKey] = useState(() => newIdempotencyKey('billing-payment'));
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);
  const [invoicePaymentSubmitting, setInvoicePaymentSubmitting] = useState(false);
  const [itemForm, setItemForm] = useState(blankItem);
  const [saleForm, setSaleForm] = useState(blankSale);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [checkoutNotice, setCheckoutNotice] = useState(null);
  const [showLowStockPanel, setShowLowStockPanel] = useState(false);
  const [selectedBillingReceipt, setSelectedBillingReceipt] = useState(null);
  const [voidBillingReceipt, setVoidBillingReceipt] = useState(null);
  const [voidBillingReason, setVoidBillingReason] = useState('');
  const [voidBillingSubmitting, setVoidBillingSubmitting] = useState(false);
  const [salesHistoryTab, setSalesHistoryTab] = useState('Register');
  const [historyControls, setHistoryControls] = useState(historyControlDefaults);

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const officeItemById = useMemo(() => new Map(officeItems.map((item) => [item.id, item])), [officeItems]);
  const cartLines = useMemo(() => saleForm.lineItems.filter((line) => line.itemId || line.description), [saleForm.lineItems]);
  const officeCartLines = useMemo(() => officeCart.filter((line) => line.itemId), [officeCart]);
  const payableBillingInvoices = useMemo(() => billingInvoices.filter(isPayableInvoice), [billingInvoices]);
  const billingCustomerGroups = useMemo(() => buildBillingCustomerGroups(payableBillingInvoices), [payableBillingInvoices]);
  const visibleBillingCustomerGroups = useMemo(() => (
    billingCustomerGroups.filter((group) => billingCustomerGroupMatchesSearch(group, billingSearch))
  ), [billingCustomerGroups, billingSearch]);
  const visiblePayableBillingInvoices = useMemo(() => (
    visibleBillingCustomerGroups.flatMap((group) => group.invoices)
  ), [visibleBillingCustomerGroups]);
  const selectedBillingInvoice = useMemo(() => (
    billingInvoices.find((invoice) => invoice.id === selectedBillingInvoiceId)
    || billingInvoices.find((invoice) => selectedBillingInvoiceIds.includes(invoice.id))
  ), [billingInvoices, selectedBillingInvoiceId, selectedBillingInvoiceIds]);
  const selectedBillingCustomerGroup = useMemo(() => {
    const customerKey = selectedBillingCustomerId || (selectedBillingInvoice ? invoiceCustomerKey(selectedBillingInvoice) : '');
    return customerKey ? billingCustomerGroups.find((group) => group.key === customerKey) || null : null;
  }, [billingCustomerGroups, selectedBillingCustomerId, selectedBillingInvoice]);
  const selectedBillingCustomerActualId = selectedBillingCustomerGroup?.customer?.id || selectedBillingCustomerGroup?.invoices?.[0]?.customerId || '';
  const selectedCustomerInvoiceRows = useMemo(() => (
    (selectedBillingCustomerGroup?.invoices || []).map((invoice) => {
      const promotionState = billingInvoicePromotionsById[invoice.id];
      const promotion = invoiceRecommendedPromotionBundle(invoice, promotionState);
      return {
        invoice,
        currentBalance: roundMoney(invoice.balance),
        promotion,
        amountToCollect: promotion ? promotion.payable : roundMoney(invoice.balance)
      };
    })
  ), [selectedBillingCustomerGroup, billingInvoicePromotionsById]);
  const selectedPaymentInvoiceRows = useMemo(() => (
    selectedCustomerInvoiceRows.filter((row) => selectedBillingInvoiceIds.includes(row.invoice.id))
  ), [selectedCustomerInvoiceRows, selectedBillingInvoiceIds]);
  const selectedCustomerBalance = selectedCustomerInvoiceRows.length
    ? selectedCustomerInvoiceRows.reduce((sum, row) => roundMoney(sum + row.currentBalance), 0)
    : roundMoney(selectedBillingCustomerGroup?.totalBalance || 0);
  const selectedInvoiceTotalBeforeDiscount = selectedPaymentInvoiceRows.reduce((sum, row) => roundMoney(sum + row.currentBalance), 0);
  const invoicePaymentAmount = roundMoney(Number(invoicePaymentForm.amount || 0));
  const invoicePaymentAllocations = useMemo(() => (
    selectedPaymentInvoiceRows
      .filter((row) => row.amountToCollect > 0)
      .map((row) => ({
        invoiceId: row.invoice.id,
        invoiceNumber: row.invoice.invoiceNumber,
        dueDate: row.invoice.dueDate,
        billingPeriodLabel: invoiceCoverageLabel(row.invoice),
        billingPeriodMonth: row.invoice.billingPeriodMonth,
        billingCycleStart: row.invoice.billingCycleStart,
        billingCycleEnd: row.invoice.billingCycleEnd,
        service: invoiceServiceLabel(row.invoice),
        balance: row.currentBalance,
        amount: row.amountToCollect,
        remainingAfter: roundMoney(row.currentBalance - row.amountToCollect),
        promotionIds: row.promotion?.promotionIds || [],
        promotionCount: row.promotion?.count || 0,
        promotionAmount: row.promotion?.amount || 0
      }))
  ), [selectedPaymentInvoiceRows]);
  const invoicePaymentAllocatedTotal = invoicePaymentAllocations.reduce((sum, allocation) => roundMoney(sum + allocation.amount), 0);
  const invoicePaymentAppliedAmount = invoicePaymentAllocatedTotal;
  const invoicePaymentShortfallAmount = roundMoney(Math.max(0, invoicePaymentAppliedAmount - invoicePaymentAmount));
  const invoicePaymentExcessAmount = roundMoney(Math.max(0, invoicePaymentAmount - invoicePaymentAppliedAmount));
  const invoicePaymentAdvanceAmount = 0;
  const invoicePaymentReturnedAmount = invoicePaymentExcessAmount;
  const invoicePaymentExcessLabel = invoicePaymentExcessAmount > 0 ? 'Change / excess' : 'Change';
  const invoicePaymentExcessDisplayAmount = invoicePaymentExcessAmount;
  const invoicePaymentPostAmount = invoicePaymentAppliedAmount;
  const invoicePaymentPromotionByInvoiceId = useMemo(() => {
    const promotionRows = selectedPaymentInvoiceRows
      .filter((row) => row.promotion && moneyEquals(row.amountToCollect, row.promotion.payable))
      .map((row) => [row.invoice.id, row.promotion]);
    return new Map(promotionRows);
  }, [selectedPaymentInvoiceRows]);
  const invoicePaymentDiscountTotal = Array.from(invoicePaymentPromotionByInvoiceId.values()).reduce((sum, promotion) => roundMoney(sum + promotion.amount), 0);
  const invoicePaymentPromotionCount = Array.from(invoicePaymentPromotionByInvoiceId.values()).reduce((sum, promotion) => (
    sum + Number(promotion.count || promotion.promotionIds?.length || 1)
  ), 0);
  const invoicePaymentDiscountLabel = invoicePaymentPromotionCount > 1
    ? `${invoicePaymentPromotionCount} automatic promotions`
    : (Array.from(invoicePaymentPromotionByInvoiceId.values())[0]?.label || '');
  const selectedInvoiceRemaining = roundMoney(Math.max(0, selectedCustomerBalance - invoicePaymentAllocatedTotal - invoicePaymentDiscountTotal));
  const invoicePaymentReferenceRequired = paymentRequiresReference(invoicePaymentForm.method);
  const invoicePaymentIsCash = String(invoicePaymentForm.method || '').toUpperCase() === 'CASH';
  const billingPaymentMethods = useMemo(() => (
    billingMeta.paymentMethods?.length ? billingMeta.paymentMethods : (meta.paymentMethods?.length ? meta.paymentMethods : ['CASH'])
  ), [billingMeta.paymentMethods, meta.paymentMethods]);
  useEffect(() => {
    if (!selectedBillingCustomerGroup) return;
    const nextAmount = invoicePaymentAppliedAmount > 0 ? String(invoicePaymentAppliedAmount) : '';
    setInvoicePaymentForm((form) => (
      String(form.amount || '') === nextAmount ? form : { ...form, amount: nextAmount, excessAction: '' }
    ));
  }, [selectedBillingCustomerGroup, invoicePaymentAppliedAmount]);
  const billingPaymentMetrics = useMemo(() => ({
    customerAccounts: visibleBillingCustomerGroups.length,
    outstanding: visiblePayableBillingInvoices.reduce((sum, invoice) => sum + Number(invoice.balance || 0), 0),
    overdue: visiblePayableBillingInvoices.filter(isInvoiceOverdue).length,
    collectedToday: billingPayments
      .filter((payment) => payment.status === 'POSTED' && paymentRecordedDateKey(payment) === today())
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  }), [visibleBillingCustomerGroups, visiblePayableBillingInvoices, billingPayments]);
  const registerHistoryRows = useMemo(() => (
    sales.filter((sale) => {
      const control = historyControls.register;
      const statusMatches = control.status === 'ALL' || sale.paymentStatus === control.status || sale.status === control.status;
      return statusMatches && matchesHistorySearch(control.search, [
        sale.receiptNumber,
        sale.saleNumber,
        customerLabel(sale.customer),
        saleUserLabel(sale),
        sale.createdAt,
        sale.paymentStatus,
        sale.total,
        sale.paidTotal,
        sale.balance
      ]);
    })
  ), [sales, historyControls.register]);
  const invoicePaymentHistoryRows = useMemo(() => (
    billingPayments.filter((payment) => {
      const control = historyControls.invoice;
      const statusMatches = control.status === 'ALL'
        || payment.status === control.status
        || payment.method === control.status
        || (payment.collectionChannel || 'BILLING') === control.status;
      return statusMatches && matchesHistorySearch(control.search, [
        payment.receiptNumber,
        payment.invoiceNumber,
        ...(payment.allocations || []).flatMap((allocation) => [allocation.invoiceNumber, allocation.amount]),
        customerNameOnly(payment.customer),
        customerLabel(payment.customer),
        payment.method,
        payment.referenceNumber,
        payment.collectionChannel,
        payment.paymentDate,
        paymentRecordedAt(payment),
        payment.postedByName,
        payment.postedByUsername,
        payment.status,
        payment.amount
      ]);
    })
  ), [billingPayments, historyControls.invoice]);
  const officeMovementHistoryRows = useMemo(() => (
    officeMovements.filter((movement) => {
      const control = historyControls.office;
      const statusMatches = control.status === 'ALL' || movement.type === control.status;
      return statusMatches && matchesHistorySearch(control.search, [
        movement.item?.sku,
        movement.item?.name,
        movement.referenceId,
        movement.serialNumber,
        movement.fromLocation,
        movement.toLocation,
        movement.notes,
        movement.type
      ]);
    })
  ), [officeMovements, historyControls.office]);
  const registerHistory = useMemo(() => pagedRows(registerHistoryRows, historyControls.register), [registerHistoryRows, historyControls.register]);
  const invoicePaymentHistory = useMemo(() => pagedRows(invoicePaymentHistoryRows, historyControls.invoice), [invoicePaymentHistoryRows, historyControls.invoice]);
  const officeMovementHistory = useMemo(() => pagedRows(officeMovementHistoryRows, historyControls.office), [officeMovementHistoryRows, historyControls.office]);
  const registerFilterOptions = useMemo(() => uniqueOptions(sales.flatMap((sale) => [sale.paymentStatus, sale.status])), [sales]);
  const invoicePaymentFilterOptions = useMemo(() => uniqueOptions(billingPayments.flatMap((payment) => [payment.status, payment.method, payment.collectionChannel || 'BILLING'])), [billingPayments]);
  const officeMovementFilterOptions = useMemo(() => uniqueOptions(officeMovements.map((movement) => movement.type)), [officeMovements]);
  const saleById = useMemo(() => new Map(sales.map((sale) => [sale.id, sale])), [sales]);
  const cashierCollectionRows = useMemo(() => {
    const rows = new Map();
    const todayKey = today();
    const ensureRow = (key, label) => {
      const normalizedKey = key || label || 'pos-user';
      if (!rows.has(normalizedKey)) {
        rows.set(normalizedKey, {
          key: normalizedKey,
          cashier: label || normalizedKey || 'POS user',
          registerCash: 0,
          registerOther: 0,
          invoiceCash: 0,
          invoiceOther: 0,
          registerReceipts: 0,
          invoiceReceipts: 0,
          voidedReceipts: 0,
          voidedAmount: 0
        });
      }
      return rows.get(normalizedKey);
    };

    registerPayments.forEach((payment) => {
      if (payment.status !== 'POSTED') return;
      const sale = saleById.get(payment.saleId);
      if (!sale || sale.status === 'VOID' || paymentRecordedDateKey(payment) !== todayKey) return;
      const row = ensureRow(sale.cashierUsername, saleUserLabel(sale));
      if (String(payment.method || '').toUpperCase() === 'CASH') {
        row.registerCash = roundMoney(row.registerCash + Number(payment.amount || 0));
      } else {
        row.registerOther = roundMoney(row.registerOther + Number(payment.amount || 0));
      }
      row.registerReceipts += 1;
    });

    registerPayments.forEach((payment) => {
      if (payment.status !== 'VOID' || dateKey(payment.updatedAt || payment.deletedAt) !== todayKey) return;
      const sale = saleById.get(payment.saleId);
      const row = ensureRow(sale?.cashierUsername || payment.saleId, sale ? saleUserLabel(sale) : 'Register voids');
      row.voidedReceipts += 1;
      row.voidedAmount = roundMoney(row.voidedAmount + Number(payment.amount || 0));
    });

    billingPayments.forEach((payment) => {
      if ((payment.collectionChannel || 'BILLING') !== 'POS') return;
      if (payment.status === 'POSTED' && paymentRecordedDateKey(payment) === todayKey) {
        const row = ensureRow(payment.postedByUsername, payment.postedByName || payment.postedByUsername || 'POS user');
        if (String(payment.method || '').toUpperCase() === 'CASH') {
          row.invoiceCash = roundMoney(row.invoiceCash + Number(payment.amount || 0));
        } else {
          row.invoiceOther = roundMoney(row.invoiceOther + Number(payment.amount || 0));
        }
        row.invoiceReceipts += 1;
      }
      if (payment.status === 'VOID' && dateKey(payment.voidedAt || payment.updatedAt) === todayKey) {
        const row = ensureRow(payment.voidedByUsername || payment.postedByUsername, payment.voidedByName || payment.postedByName || payment.voidedByUsername || 'POS user');
        row.voidedReceipts += 1;
        row.voidedAmount = roundMoney(row.voidedAmount + Number(payment.amount || 0));
      }
    });

    return Array.from(rows.values()).map((row) => ({
      ...row,
      totalCash: roundMoney(row.registerCash + row.invoiceCash),
      totalOther: roundMoney(row.registerOther + row.invoiceOther),
      totalCollected: roundMoney(row.registerCash + row.registerOther + row.invoiceCash + row.invoiceOther),
      receiptCount: row.registerReceipts + row.invoiceReceipts
    })).sort((first, second) => second.totalCollected - first.totalCollected || first.cashier.localeCompare(second.cashier));
  }, [billingPayments, registerPayments, saleById]);
  const cashierCollectionTotals = useMemo(() => cashierCollectionRows.reduce((totals, row) => ({
    totalCash: roundMoney(totals.totalCash + row.totalCash),
    totalOther: roundMoney(totals.totalOther + row.totalOther),
    totalCollected: roundMoney(totals.totalCollected + row.totalCollected),
    receiptCount: totals.receiptCount + row.receiptCount,
    voidedReceipts: totals.voidedReceipts + row.voidedReceipts,
    voidedAmount: roundMoney(totals.voidedAmount + row.voidedAmount)
  }), {
    totalCash: 0,
    totalOther: 0,
    totalCollected: 0,
    receiptCount: 0,
    voidedReceipts: 0,
    voidedAmount: 0
  }), [cashierCollectionRows]);
  const cartSubtotal = useMemo(() => cartLines.reduce((sum, line) => {
    const amount = Number(line.quantity || 0) * Number(line.unitPrice || 0) - Number(line.discountAmount || 0);
    return sum + Math.max(0, amount);
  }, 0), [cartLines]);
  const cartTotal = Math.max(0, cartSubtotal - Number(saleForm.discountAmount || 0));
  const paymentAmount = Number(saleForm.paymentAmount || 0);
  const allocatedRegisterPayment = Math.min(paymentAmount, cartTotal);
  const paymentShortfall = Math.max(0, cartTotal - paymentAmount);
  const cashChange = Math.max(0, paymentAmount - cartTotal);
  const isCashPayment = String(saleForm.paymentMethod || '').toUpperCase() === 'CASH';
  const registerReferenceRequired = paymentRequiresReference(saleForm.paymentMethod);

  async function load(search = customerSearch, itemTerm = itemSearch) {
    setError('');
    try {
      const [nextMeta, nextOverview, nextCustomers, nextItems, nextSales, nextRegisterPayments] = await Promise.all([
        request('/point-of-sale/meta'),
        request('/point-of-sale/overview'),
        request(`/point-of-sale/customers?search=${encodeURIComponent(search)}`),
        request(`/point-of-sale/items?search=${encodeURIComponent(itemTerm)}`),
        request('/point-of-sale/sales'),
        request('/point-of-sale/payments')
      ]);
      setMeta(nextMeta);
      setOverview(nextOverview);
      setCustomers(nextCustomers);
      setItems(nextItems);
      setSales(nextSales);
      setRegisterPayments(nextRegisterPayments);
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadCustomers(search = customerSearch) {
    setError('');
    try {
      const nextCustomers = await request(`/point-of-sale/customers?search=${encodeURIComponent(search)}`);
      setCustomers(nextCustomers);
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadOfficeItems(search = officeSearch) {
    setError('');
    try {
      const nextItems = await request(`/inventory/items?status=ACTIVE&search=${encodeURIComponent(search)}`);
      setOfficeItems(nextItems.filter((item) => item.stockTracked && item.status === 'ACTIVE'));
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadBillingPayments(search = billingSearch) {
    setError('');
    try {
      const [nextMeta, nextInvoices, nextPayments] = await Promise.all([
        request('/billing/meta'),
        request(`/billing/invoices?search=${encodeURIComponent(search)}`),
        request('/billing/payments')
      ]);
      setBillingMeta(nextMeta);
      setBillingInvoices(nextInvoices);
      setBillingPayments(nextPayments);
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadBillingInvoicePromotions(invoices, paymentDate = today()) {
    const payableInvoices = invoices.filter(isPayableInvoice);
    if (!payableInvoices.length) return;
    const results = await Promise.all(payableInvoices.map(async (invoice) => {
      try {
        const result = await request(`/billing/invoices/${invoice.id}/eligible-promotions?paymentDate=${encodeURIComponent(paymentDate)}`);
        return [invoice.id, result];
      } catch (err) {
        return [invoice.id, {
          promotions: [],
          recommendedPromotionId: '',
          recommendedPromotionIds: [],
          recommendedPromotionBundle: null,
          error: err.message
        }];
      }
    }));
    setBillingInvoicePromotionsById((current) => ({
      ...current,
      ...Object.fromEntries(results)
    }));
  }

  async function loadOfficeMovements() {
    setError('');
    try {
      const nextMovements = await request('/inventory/movements');
      setOfficeMovements(nextMovements.filter((movement) => movement.referenceType === 'OFFICE_STOCK'));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    loadOfficeItems();
    loadBillingPayments();
    loadOfficeMovements();
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      loadCustomers(customerSearch);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [customerSearch]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      loadBillingPayments(billingSearch);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [billingSearch]);

  function updateHistoryControl(key, patch) {
    setHistoryControls((current) => ({
      ...current,
      [key]: {
        ...current[key],
        ...patch,
        page: patch.page ?? 1
      }
    }));
  }

  function customerOptions() {
    return (
      <>
        <option value="">Walk-in customer</option>
        {customers.map((customer) => <option key={customer.id} value={customer.id}>{customerLabel(customer)}</option>)}
      </>
    );
  }

  function selectSaleCustomer(customer) {
    setSaleForm({ ...saleForm, customerId: customer?.id || '' });
    setCustomerSearch(customer ? customerLabel(customer) : '');
    setCustomerSearchOpen(false);
  }

  function showCheckoutFailure(messageText) {
    setError(messageText);
    setCheckoutNotice({
      type: 'error',
      title: 'Checkout not completed',
      message: messageText,
      detail: 'Review the cart and payment details, then click Complete Checkout again.'
    });
  }

  function customerSearchResults() {
    if (!customerSearchOpen || !customerSearch.trim()) return null;
    return (
      <div className="pos-customer-suggestions">
        {customers.length ? customers.map((customer) => (
          <button
            type="button"
            className="pos-customer-option"
            key={customer.id}
            onMouseDown={(event) => {
              event.preventDefault();
              selectSaleCustomer(customer);
            }}
          >
            <strong>{customerLabel(customer)}</strong>
            <span>{[customer.barangay, customer.city, customer.province].filter(Boolean).join(', ') || 'Customer profile'}</span>
          </button>
        )) : (
          <div className="pos-customer-empty">No matching customers.</div>
        )}
      </div>
    );
  }

  function resetItem() {
    setItemForm(blankItem);
  }

  function resetSale() {
    setSaleForm({ ...blankSale, saleDate: today() });
    setRegisterCheckoutIdempotencyKey(newIdempotencyKey('pos-sale'));
  }

  async function saveItem(e) {
    e.preventDefault();
    const payload = {
      sku: itemForm.sku,
      name: itemForm.name,
      category: itemForm.category,
      unitPrice: Number(itemForm.unitPrice || 0),
      stockOnHand: Number(itemForm.stockOnHand || 0),
      reorderPoint: Number(itemForm.reorderPoint || 0),
      taxable: Boolean(itemForm.taxable),
      status: itemForm.status,
      notes: itemForm.notes
    };
    await request(itemForm.id ? `/point-of-sale/items/${itemForm.id}` : '/point-of-sale/items', {
      method: itemForm.id ? 'PATCH' : 'POST',
      body: JSON.stringify(payload)
    });
    setMessage(itemForm.id ? 'Item saved.' : 'Item created.');
    resetItem();
    await load();
    refreshShell();
  }

  async function archiveItem(item) {
    await request(`/point-of-sale/items/${item.id}`, { method: 'DELETE' });
    setMessage('Item archived.');
    await load();
    refreshShell();
  }

  function setSaleLine(index, patch) {
    setSaleForm((form) => {
      const lineItems = form.lineItems.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line));
      return { ...form, lineItems };
    });
  }

  function addCatalogItemToCart(item) {
    if (item.stockTracked && Number(item.stockOnHand || 0) <= 0) {
      setError(`${item.sku} is out of stock.`);
      return;
    }
    setError('');
    setSaleForm((form) => {
      const currentLines = form.lineItems.filter((line) => line.itemId || line.description);
      const existingIndex = item.trackingType === 'SERIALIZED' ? -1 : currentLines.findIndex((line) => line.itemId === item.id && !line.serialNumber);
      if (existingIndex >= 0) {
        return {
          ...form,
          lineItems: currentLines.map((line, index) => (
            index === existingIndex ? { ...line, quantity: String(Number(line.quantity || 0) + 1) } : line
          ))
        };
      }
      return {
        ...form,
        lineItems: [
          ...currentLines,
          {
            ...blankSaleLine,
            itemId: item.id,
            description: item.name,
            quantity: '1',
            unitPrice: String(item.unitPrice || 0),
            discountAmount: '0'
          }
        ]
      };
    });
  }

  function removeSaleLine(index) {
    setSaleForm((form) => {
      const lineItems = form.lineItems.filter((_, lineIndex) => lineIndex !== index);
      return { ...form, lineItems: lineItems.length ? lineItems : [blankSaleLine] };
    });
  }

  function resetOfficeStock() {
    setOfficeCart([]);
    setOfficeStockForm(blankOfficeStockForm);
  }

  function setOfficeLine(index, patch) {
    setOfficeCart((lines) => lines.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));
  }

  function addOfficeItemToCart(item) {
    if (!item.stockTracked) {
      setError(`${item.sku} is a non-stock item.`);
      return;
    }
    if (officeMode === 'ISSUE' && stockQuantity(item) <= 0) {
      setError(`${item.sku} has no available office stock.`);
      return;
    }
    setError('');
    setOfficeCart((lines) => {
      const existingIndex = item.trackingType === 'SERIALIZED' ? -1 : lines.findIndex((line) => line.itemId === item.id && !line.serialNumber);
      if (existingIndex >= 0) {
        return lines.map((line, index) => (
          index === existingIndex ? { ...line, quantity: String(Number(line.quantity || 0) + 1) } : line
        ));
      }
      return [...lines, { itemId: item.id, serialNumber: '', quantity: '1' }];
    });
  }

  function removeOfficeLine(index) {
    setOfficeCart((lines) => lines.filter((_, lineIndex) => lineIndex !== index));
  }

  function selectBillingInvoice(invoice, options = {}) {
    if (!invoice) return;
    const paymentDate = today();
    setSelectedBillingInvoiceId(invoice.id);
    setSelectedBillingInvoiceIds([invoice.id]);
    setSelectedBillingCustomerId(options.customerKey || invoiceCustomerKey(invoice));
    setInvoicePaymentIdempotencyKey(newIdempotencyKey('billing-payment'));
    setInvoicePaymentForm({
      ...blankInvoicePayment,
      invoiceId: invoice.id,
      amount: String(options.amount ?? ''),
      method: invoicePaymentForm.method || 'CASH',
      paymentDate,
      excessAction: ''
    });
    setError('');
  }

  async function selectBillingCustomerGroup(group) {
    let nextGroup = group;
    const customerId = group?.customer?.id || group?.invoices?.[0]?.customerId || '';
    const paymentDate = today();
    if (customerId) {
      try {
        const customerInvoices = await request(`/billing/invoices?customerId=${encodeURIComponent(customerId)}`);
        const payableInvoices = customerInvoices.filter(isPayableInvoice);
        if (payableInvoices.length) {
          const [freshGroup] = buildBillingCustomerGroups(payableInvoices);
          nextGroup = freshGroup || group;
          setBillingInvoices((currentRows) => {
            const byId = new Map(currentRows.map((invoice) => [invoice.id, invoice]));
            customerInvoices.forEach((invoice) => byId.set(invoice.id, invoice));
            return Array.from(byId.values());
          });
          await loadBillingInvoicePromotions(payableInvoices, paymentDate);
        }
      } catch (err) {
        setError(err.message);
        return;
      }
    }
    const nextInvoices = nextGroup?.invoices || [];
    if (nextInvoices.length) {
      setSelectedBillingInvoiceId(nextInvoices[0].id);
      setSelectedBillingInvoiceIds(nextInvoices.map((invoice) => invoice.id));
      setSelectedBillingCustomerId(nextGroup.key);
      setInvoicePaymentIdempotencyKey(newIdempotencyKey('billing-payment'));
      setInvoicePaymentForm({
        ...blankInvoicePayment,
        invoiceId: nextInvoices[0].id,
        amount: '',
        method: invoicePaymentForm.method || 'CASH',
        paymentDate,
        excessAction: ''
      });
      setError('');
    }
  }

  function changeInvoicePaymentDate(paymentDate) {
    setInvoicePaymentForm((form) => ({ ...form, paymentDate }));
    if (selectedBillingCustomerGroup?.invoices?.length) {
      loadBillingInvoicePromotions(selectedBillingCustomerGroup.invoices, paymentDate).catch((err) => setError(err.message));
    }
  }

  function toggleInvoicePaymentInvoice(invoiceId) {
    setSelectedBillingInvoiceId(invoiceId);
    setSelectedBillingInvoiceIds((current) => (
      current.includes(invoiceId)
        ? current.filter((id) => id !== invoiceId)
        : [...current, invoiceId]
    ));
  }

  function resetInvoicePayment() {
    setSelectedBillingInvoiceId('');
    setSelectedBillingInvoiceIds([]);
    setSelectedBillingCustomerId('');
    setInvoicePaymentForm({ ...blankInvoicePayment, paymentDate: today() });
    setInvoicePaymentIdempotencyKey(newIdempotencyKey('billing-payment'));
  }

  async function sendInvoicePaymentSms(payment, invoice, paymentSummary = {}) {
    try {
      return await request('/point-of-sale/invoice-payment-confirmations', {
        method: 'POST',
        body: JSON.stringify({
          billingPaymentId: payment.id,
          receiptNumber: payment.receiptNumber,
          invoiceNumber: payment.invoiceNumber,
          customerId: payment.customerId || payment.customer?.id || invoice?.customerId || invoice?.customer?.id || '',
          customerName: customerNameOnly(payment.customer || invoice?.customer),
          destination: paymentSmsDestination(payment, invoice),
          amount: payment.amount,
          amountReceived: paymentSummary.amountReceived ?? payment.amount,
          appliedAmount: paymentSummary.appliedAmount ?? payment.appliedAmount,
          returnedAmount: paymentSummary.returnedAmount || 0,
          advanceAmount: paymentSummary.advanceAmount ?? payment.advanceAmount ?? 0,
          method: payment.method,
          paymentDate: payment.paymentDate,
          postedAt: payment.postedAt || payment.createdAt || '',
          referenceNumber: payment.referenceNumber,
          remainingAccountBalance: paymentSummary.remainingAccountBalance,
          accountCreditAfter: payment.accountCreditAfter || paymentSummary.accountCreditAfter || 0,
          allocations: payment.allocations || []
        })
      });
    } catch (err) {
      return { status: 'FAILED', error: err.message || 'SMS confirmation request failed.' };
    }
  }

  async function saveInvoicePayment(e) {
    e.preventDefault();
    if (invoicePaymentSubmitting) return;
    if (!selectedBillingCustomerGroup) {
      setError('Select a billing customer first.');
      return;
    }
    if (!selectedPaymentInvoiceRows.length) {
      setError('Select at least one open invoice to pay.');
      return;
    }
    const amountReceived = invoicePaymentAmount;
    const amountDue = invoicePaymentAppliedAmount;
    if (amountDue <= 0) {
      setError('Selected invoices have no collectible amount.');
      return;
    }
    if (amountReceived <= 0) {
      setError('Amount received must be greater than zero.');
      return;
    }
    if (amountReceived + 0.001 < amountDue) {
      setError(`Amount received must be at least ${currency(amountDue)}.`);
      return;
    }
    if (!invoicePaymentIsCash && !moneyEquals(amountReceived, amountDue)) {
      setError('Non-cash payments must match the selected invoice total.');
      return;
    }
    if (invoicePaymentReferenceRequired && !String(invoicePaymentForm.referenceNumber || '').trim()) {
      setError('Reference number is required for non-cash invoice payments.');
      return;
    }
    if (!invoicePaymentAllocations.length) {
      setError('Select at least one open invoice to pay.');
      return;
    }
    if (invoicePaymentForm.paymentDate > today()) {
      setError('Payment date cannot be in the future.');
      return;
    }
    setError('');
    setInvoicePaymentSubmitting(true);
    try {
      const paymentBody = {
        customerId: selectedBillingCustomerGroup?.customer?.id || selectedBillingInvoice?.customerId,
        amount: invoicePaymentPostAmount,
        allocations: invoicePaymentAllocations.map((allocation) => ({
          invoiceId: allocation.invoiceId,
          amount: allocation.amount,
          ...(allocation.promotionIds?.length ? { promotionIds: allocation.promotionIds } : {})
        })),
        advanceAmount: invoicePaymentAdvanceAmount,
        method: invoicePaymentForm.method,
        paymentDate: invoicePaymentForm.paymentDate,
        referenceNumber: invoicePaymentForm.referenceNumber,
        collectionChannel: 'POS',
        status: 'POSTED',
        notes: invoicePaymentForm.notes || `Posted from POS for ${customerNameOnly(selectedBillingCustomerGroup.customer)}`
      };
      const postedPayment = await request('/billing/payments', {
        method: 'POST',
        headers: { 'Idempotency-Key': invoicePaymentIdempotencyKey },
        body: JSON.stringify(paymentBody)
      });
      const invoiceReceiptContextById = new Map(selectedCustomerInvoiceRows.map((row) => [
        row.invoice.id,
        {
          invoiceNumber: row.invoice.invoiceNumber,
          dueDate: row.invoice.dueDate,
          billingPeriodLabel: invoiceCoverageLabel(row.invoice),
          billingPeriodMonth: row.invoice.billingPeriodMonth,
          billingCycleStart: row.invoice.billingCycleStart,
          billingCycleEnd: row.invoice.billingCycleEnd,
          service: invoiceServiceLabel(row.invoice),
          balanceBefore: row.currentBalance
        }
      ]));
      const postedPaymentWithPeriods = {
        ...postedPayment,
        allocations: (postedPayment.allocations || []).map((allocation) => ({
          ...allocation,
          ...(invoiceReceiptContextById.get(allocation.invoiceId) || {})
        }))
      };
      const paymentSummary = {
        amountReceived,
        appliedAmount: invoicePaymentAllocatedTotal,
        returnedAmount: invoicePaymentReturnedAmount,
        advanceAmount: invoicePaymentAdvanceAmount,
        discountAmount: paymentDiscountAmount(postedPaymentWithPeriods) || invoicePaymentDiscountTotal,
        discountLabel: paymentDiscountAmount(postedPaymentWithPeriods) ? paymentDiscountLabel(postedPaymentWithPeriods) : invoicePaymentDiscountLabel,
        remainingAccountBalance: selectedInvoiceRemaining,
        remainingBalanceDetails: selectedReceiptRemainingDetails(selectedCustomerInvoiceRows, selectedBillingInvoiceIds)
      };
      const smsResult = await sendInvoicePaymentSms(postedPaymentWithPeriods, selectedPaymentInvoiceRows[0]?.invoice || selectedBillingInvoice, paymentSummary);
      const postedPaymentWithSms = { ...postedPaymentWithPeriods, ...paymentSummary, sms: smsResult };
      const successMessage = `Payment posted for ${customerNameOnly(selectedBillingCustomerGroup.customer)} across ${invoicePaymentAllocations.length} invoice${invoicePaymentAllocations.length === 1 ? '' : 's'}.`;
      const excessDetail = invoicePaymentReturnedAmount > 0
        ? `Returned ${currency(invoicePaymentReturnedAmount)} to the customer.`
        : (invoicePaymentAdvanceAmount > 0 ? `Stored ${currency(invoicePaymentAdvanceAmount)} as advance credit.` : '');
      const discountDetail = paymentSummary.discountAmount > 0
        ? `${paymentSummary.discountLabel || 'Discount'} deducted ${currency(paymentSummary.discountAmount)}.`
        : '';
      const smsDetail = smsStatusDetail(smsResult);
      setSelectedBillingReceipt(postedPaymentWithSms);
      setMessage(`${successMessage} ${discountDetail} ${excessDetail} ${smsDetail}`.trim());
      setCheckoutNotice({
        type: 'success',
        title: 'Invoice payment posted',
        message: successMessage,
        detail: `${discountDetail} ${excessDetail} ${smsDetail}`.trim()
      });
      resetInvoicePayment();
      await Promise.all([loadBillingPayments(billingSearch), load(customerSearch, itemSearch)]);
      refreshShell();
    } catch (err) {
      const messageText = err.message || 'Invoice payment failed. No receipt was posted.';
      setError(messageText);
      setCheckoutNotice({
        type: 'error',
        title: 'Invoice payment not posted',
        message: messageText,
        detail: 'No receipt was created and no SMS confirmation was sent.'
      });
    } finally {
      setInvoicePaymentSubmitting(false);
    }
  }

  function requestVoidBillingPayment(payment) {
    setVoidBillingReceipt(payment);
    setVoidBillingReason('');
    setError('');
  }

  async function confirmVoidBillingPayment(event) {
    event.preventDefault();
    const reason = voidBillingReason.trim();
    if (!voidBillingReceipt || voidBillingSubmitting) return;
    if (!reason) {
      setError('Void reason is required.');
      return;
    }
    setVoidBillingSubmitting(true);
    try {
      await request(`/billing/payments/${voidBillingReceipt.id}?reason=${encodeURIComponent(reason)}`, { method: 'DELETE' });
      setMessage(`Receipt ${voidBillingReceipt.receiptNumber} voided.`);
      setSelectedBillingReceipt((current) => (
        current?.id === voidBillingReceipt.id
          ? { ...current, status: 'VOID', voidReason: reason, voidedAt: new Date().toISOString() }
          : current
      ));
      setVoidBillingReceipt(null);
      setVoidBillingReason('');
      await loadBillingPayments(billingSearch);
      refreshShell();
    } catch (err) {
      setError(err.message);
    } finally {
      setVoidBillingSubmitting(false);
    }
  }

  async function saveOfficeStock(e) {
    e.preventDefault();
    if (!officeCartLines.length) {
      setError('Add at least one office stock item.');
      return;
    }

    for (const line of officeCartLines) {
      const item = officeItemById.get(line.itemId);
      const quantity = Number(line.quantity || 0);
      if (!item) {
        setError('One office stock item is no longer available.');
        return;
      }
      if (quantity <= 0) {
        setError(`Quantity must be greater than zero for ${item.sku}.`);
        return;
      }
      if (item.trackingType === 'SERIALIZED') {
        if (quantity !== 1) {
          setError(`Serialized item ${item.sku} must be checked one unit per line.`);
          return;
        }
        if (!String(line.serialNumber || '').trim()) {
          setError(`Serial number is required for ${item.sku}.`);
          return;
        }
      }
      if (officeMode === 'ISSUE' && quantity > stockQuantity(item)) {
        setError(`Not enough available office stock for ${item.sku}.`);
        return;
      }
    }

    const referenceId = officeStockForm.referenceId.trim() || `OFFICE-${today()}-${Date.now()}`;
    const handledBy = officeStockForm.handledBy.trim();
    const noteParts = [
      officeMode === 'ISSUE' ? 'Office stock check-out' : 'Office stock check-in',
      handledBy ? `Person: ${handledBy}` : '',
      officeStockForm.notes.trim()
    ].filter(Boolean);

    try {
      await Promise.all(officeCartLines.map((line) => {
        const item = officeItemById.get(line.itemId);
        const stockLocation = officeStockForm.location.trim() || item?.location || 'Main stockroom';
        return request('/inventory/movements', {
          method: 'POST',
          body: JSON.stringify({
            itemId: line.itemId,
            type: officeMode,
            quantity: Number(line.quantity || 0),
            serialNumber: line.serialNumber || '',
            fromLocation: officeMode === 'ISSUE' ? stockLocation : handledBy,
            toLocation: officeMode === 'RETURN' ? stockLocation : (handledBy || 'Office use'),
            referenceType: 'OFFICE_STOCK',
            referenceId,
            notes: noteParts.join(' - ')
          })
        });
      }));
      setMessage(officeModeCopy[officeMode].message);
      resetOfficeStock();
      await Promise.all([load(customerSearch, itemSearch), loadOfficeItems(officeSearch), loadOfficeMovements()]);
      refreshShell();
    } catch (err) {
      setError(err.message);
    }
  }

  function salePayload() {
    const allocatedPaymentAmount = isCashPayment ? allocatedRegisterPayment : paymentAmount;
    return {
      customerId: saleForm.customerId || null,
      saleDate: saleForm.saleDate,
      lineItems: saleForm.lineItems.filter((line) => line.itemId || line.description).map((line) => ({
        itemId: line.itemId || null,
        serialNumber: line.serialNumber || '',
        description: line.description,
        quantity: Number(line.quantity || 0),
        unitPrice: Number(line.unitPrice || 0),
        discountAmount: Number(line.discountAmount || 0)
      })),
      discountAmount: Number(saleForm.discountAmount || 0),
      taxAmount: 0,
      status: saleForm.status,
      notes: saleForm.notes,
      payments: paymentAmount > 0 ? [{
        amount: allocatedPaymentAmount,
        tenderedAmount: paymentAmount,
        changeAmount: isCashPayment ? cashChange : 0,
        method: saleForm.paymentMethod,
        paymentDate: saleForm.saleDate,
        referenceNumber: saleForm.paymentReference,
        status: 'POSTED'
      }] : []
    };
  }

  async function saveSale(e) {
    e?.preventDefault?.();
    if (checkoutSubmitting) return;
    if (!cartLines.length) {
      showCheckoutFailure('Add at least one item to the cart.');
      return;
    }
    if (cartTotal <= 0) {
      showCheckoutFailure('Checkout total must be greater than zero.');
      return;
    }
    if (paymentAmount <= 0) {
      showCheckoutFailure('Payment amount is required before completing checkout.');
      return;
    }
    if (paymentAmount + 0.001 < cartTotal) {
      showCheckoutFailure('Payment amount must cover the checkout total.');
      return;
    }
    if (!isCashPayment && Math.abs(paymentAmount - cartTotal) > 0.001) {
      showCheckoutFailure('Non-cash payment amount must match the checkout total.');
      return;
    }
    if (registerReferenceRequired && !String(saleForm.paymentReference || '').trim()) {
      showCheckoutFailure('Reference number is required for non-cash checkout payments.');
      return;
    }
    setError('');
    setCheckoutNotice(null);
    setCheckoutSubmitting(true);
    let postedSale;
    try {
      postedSale = await request(saleForm.id ? `/point-of-sale/sales/${saleForm.id}` : '/point-of-sale/sales', {
        method: saleForm.id ? 'PATCH' : 'POST',
        headers: saleForm.id ? {} : { 'Idempotency-Key': registerCheckoutIdempotencyKey },
        body: JSON.stringify(salePayload())
      });
    } catch (err) {
      showCheckoutFailure(err.message || 'Checkout failed. No sale was posted.');
      return;
    } finally {
      setCheckoutSubmitting(false);
    }
    const receiptNumber = postedSale.receiptNumber || postedSale.saleNumber || 'receipt';
    const successMessage = saleForm.id ? 'Sale saved.' : 'Sale posted.';
    const successDetail = isCashPayment && cashChange > 0
      ? `${currency(postedSale.total || cartTotal)} applied from ${currency(paymentAmount)} cash tendered; ${currency(cashChange)} change.`
      : `${currency(postedSale.total || cartTotal)} collected by ${labelize(saleForm.paymentMethod)}.`;
    setMessage(successMessage);
    setCheckoutNotice({
      type: 'success',
      title: 'Checkout completed',
      message: `${receiptNumber} was posted successfully.`,
      detail: successDetail
    });
    resetSale();
    await load();
    refreshShell();
  }

  async function voidSale(sale) {
    await request(`/point-of-sale/sales/${sale.id}`, { method: 'DELETE' });
    setMessage('Sale voided.');
    await load();
    refreshShell();
  }

  const metrics = overview.metrics || {};
  const salesMetrics = [
    { label: 'Today Sales', value: currency(metrics.today_sales), icon: IconCash, tone: 'green' },
    { label: 'Transactions', value: metrics.transactions || 0, icon: IconReceipt, tone: 'blue' },
    { label: 'Active Items', value: metrics.active_items || 0, icon: IconPackage, tone: 'azure' },
    { label: 'Low Stock', value: metrics.low_stock || 0, icon: IconPackage, tone: 'red', action: () => setShowLowStockPanel(true) }
  ];

  return (
    <div className="pos-page">
      {checkoutNotice && (
        <div className={`pos-checkout-popup pos-checkout-popup-${checkoutNotice.type}`} role="alert" aria-live="assertive">
          <div className="pos-checkout-popup-icon" aria-hidden="true">
            {checkoutNotice.type === 'success' ? <IconCircleCheck size={26} /> : <IconAlertTriangle size={26} />}
          </div>
          <div className="pos-checkout-popup-copy">
            <strong>{checkoutNotice.title}</strong>
            <span>{checkoutNotice.message}</span>
            {checkoutNotice.detail && <small>{checkoutNotice.detail}</small>}
          </div>
          <button type="button" className="btn btn-icon btn-sm" onClick={() => setCheckoutNotice(null)} aria-label="Close checkout notification">
            <IconX size={16} />
          </button>
        </div>
      )}

      <ul className="nav nav-tabs mb-3">
        {['Register', 'Invoice Payments', 'Office Stock', 'Sales', 'Catalog'].map((tab) => (
          <li className="nav-item" key={tab}>
            <button className={`nav-link ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>{tab}</button>
          </li>
        ))}
      </ul>

      {activeTab === 'Register' && (
        <div className="pos-register-layout">
          <Card
            title="Checkout Menu"
            icon={IconShoppingCart}
            actions={
              <form className="d-flex gap-2" onSubmit={(e) => { e.preventDefault(); load(customerSearch, itemSearch); }}>
                <input className="form-control form-control-sm" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Search SKU, barcode, or item" />
                <button className="btn btn-sm"><IconSearch size={16} /></button>
              </form>
            }
          >
            <div className="pos-product-grid">
              {items.filter((item) => item.status === 'ACTIVE').map((item) => (
                <button
                  type="button"
                  className="pos-product-tile"
                  key={item.id}
                  onClick={() => addCatalogItemToCart(item)}
                  disabled={checkoutSubmitting || (item.stockTracked && Number(item.stockOnHand || 0) <= 0)}
                >
                  <span className="pos-product-sku">{item.sku}</span>
                  <strong>{item.name}</strong>
                  <span>{currency(item.unitPrice)}</span>
                  <small>{item.stockTracked ? `${item.stockOnHand} ${item.unit || ''} available` : 'Non-stock service'}</small>
                </button>
              ))}
              {!items.length && <div className="empty">No sellable inventory items yet.</div>}
            </div>
          </Card>

          <Card title="Cart" icon={IconReceipt}>
            <form onSubmit={(e) => e.preventDefault()}>
              <div className="row g-3">
                <div className="col-md-6"><TextField label="Sale Date" type="date" value={saleForm.saleDate} disabled={checkoutSubmitting} onChange={(value) => setSaleForm({ ...saleForm, saleDate: value })} /></div>
                <div className="col-12">
                  <div className="d-flex gap-2">
                    <select
                      className="form-select"
                      value={saleForm.customerId}
                      disabled={checkoutSubmitting}
                      onChange={(e) => selectSaleCustomer(customers.find((customer) => customer.id === e.target.value) || null)}
                    >
                      {customerOptions()}
                    </select>
                    <div className="pos-customer-picker">
                      <input
                        className="form-control"
                        value={customerSearch}
                        onChange={(e) => {
                          setCustomerSearch(e.target.value);
                          setCustomerSearchOpen(true);
                        }}
                        onFocus={() => setCustomerSearchOpen(true)}
                        onBlur={() => window.setTimeout(() => setCustomerSearchOpen(false), 120)}
                        disabled={checkoutSubmitting}
                        placeholder="Search customers"
                      />
                      {customerSearchResults()}
                    </div>
                    <button type="button" className="btn" disabled={checkoutSubmitting} onClick={() => { setCustomerSearchOpen(true); loadCustomers(customerSearch); }}><IconSearch size={16} /></button>
                  </div>
                </div>
                <div className="col-12">
                  <div className="pos-cart-lines">
                    {cartLines.map((line, index) => {
                      const originalIndex = saleForm.lineItems.indexOf(line);
                      const cartItem = itemById.get(line.itemId);
                      return (
                        <div className="pos-cart-line" key={`${line.itemId || line.description}-${index}`}>
                          <div>
                            <strong>{line.description}</strong>
                            <div className="text-muted">{cartItem?.sku || 'Manual line'}</div>
                          </div>
                          <input className="form-control pos-qty" type="number" min="0.01" step="0.01" value={line.quantity} disabled={checkoutSubmitting} onChange={(e) => setSaleLine(originalIndex, { quantity: e.target.value })} />
                          <input className="form-control pos-price" type="number" min="0" step="0.01" value={line.unitPrice} disabled={checkoutSubmitting} onChange={(e) => setSaleLine(originalIndex, { unitPrice: e.target.value })} />
                          <input className="form-control pos-serial" value={line.serialNumber || ''} disabled={checkoutSubmitting} placeholder={cartItem?.trackingType === 'SERIALIZED' ? 'Serial required' : 'Serial'} onChange={(e) => setSaleLine(originalIndex, { serialNumber: e.target.value })} />
                          <button type="button" className="btn btn-icon" disabled={checkoutSubmitting} onClick={() => removeSaleLine(originalIndex)}><IconTrash size={16} /></button>
                        </div>
                      );
                    })}
                    {!cartLines.length && <div className="empty">Add items from the checkout menu.</div>}
                  </div>
                </div>
                <div className="col-md-4"><TextField label="Discount" type="number" min="0" step="0.01" value={saleForm.discountAmount} disabled={checkoutSubmitting} onChange={(value) => setSaleForm({ ...saleForm, discountAmount: value })} /></div>
                <div className="col-md-4"><TextField label={isCashPayment ? 'Cash Tendered' : 'Payment'} type="number" min="0.01" step="0.01" required value={saleForm.paymentAmount} disabled={checkoutSubmitting} onChange={(value) => setSaleForm({ ...saleForm, paymentAmount: value })} /></div>
                <div className="col-md-4"><SelectField label="Method" value={saleForm.paymentMethod} options={meta.paymentMethods} disabled={checkoutSubmitting} onChange={(value) => setSaleForm({ ...saleForm, paymentMethod: value })} /></div>
                <div className="col-12">
                  <TextField label={registerReferenceRequired ? 'Reference Required' : 'Reference'} value={saleForm.paymentReference} disabled={checkoutSubmitting} onChange={(value) => setSaleForm({ ...saleForm, paymentReference: value })} />
                  {registerReferenceRequired && <div className="pos-field-hint">Required for {labelize(saleForm.paymentMethod)} payments.</div>}
                </div>
                <div className="col-12">
                  <div className="pos-total-panel pos-checkout-summary">
                    <div>
                      <span>Subtotal</span>
                      <strong>{currency(cartSubtotal)}</strong>
                    </div>
                    <div>
                      <span>Discount</span>
                      <strong>{currency(saleForm.discountAmount)}</strong>
                    </div>
                    <div>
                      <span>Total due</span>
                      <strong>{currency(cartTotal)}</strong>
                    </div>
                    <div>
                      <span>Payment applied</span>
                      <strong>{currency(isCashPayment ? allocatedRegisterPayment : paymentAmount)}</strong>
                    </div>
                    <div>
                      <span>{isCashPayment ? 'Change' : 'Remaining due'}</span>
                      <strong className={paymentShortfall > 0 ? 'text-danger' : 'text-green'}>
                        {currency(isCashPayment ? cashChange : paymentShortfall)}
                      </strong>
                    </div>
                  </div>
                </div>
                <div className="col-12 d-flex justify-content-between gap-2">
                  <button type="button" className="btn" disabled={checkoutSubmitting} onClick={resetSale}>Clear</button>
                  <button type="button" className="btn btn-primary" disabled={checkoutSubmitting} onClick={saveSale}>
                    {checkoutSubmitting ? <IconLoader2 size={18} className="me-2 pos-spin" /> : <IconReceipt size={18} className="me-2" />}
                    {checkoutSubmitting ? 'Posting Checkout' : 'Complete Checkout'}
                  </button>
                </div>
              </div>
            </form>
          </Card>
        </div>
      )}

      {activeTab === 'Invoice Payments' && (
        <div className="row row-cards">
          <div className="col-12">
            <div className="pos-invoice-metrics">
              <div className="pos-invoice-metric">
                <span className="badge bg-yellow-lt text-yellow"><IconFileInvoice size={18} /></span>
                <div>
                  <strong>{billingPaymentMetrics.customerAccounts}</strong>
                  <span>Customers with balance</span>
                </div>
              </div>
              <div className="pos-invoice-metric">
                <span className="badge bg-orange-lt text-orange"><IconCash size={18} /></span>
                <div>
                  <strong>{currency(billingPaymentMetrics.outstanding)}</strong>
                  <span>Outstanding</span>
                </div>
              </div>
              <div className="pos-invoice-metric">
                <span className="badge bg-red-lt text-red"><IconReceipt size={18} /></span>
                <div>
                  <strong>{billingPaymentMetrics.overdue}</strong>
                  <span>Overdue</span>
                </div>
              </div>
              <div className="pos-invoice-metric">
                <span className="badge bg-green-lt text-green"><IconCreditCard size={18} /></span>
                <div>
                  <strong>{currency(billingPaymentMetrics.collectedToday)}</strong>
                  <span>Collected today</span>
                </div>
              </div>
            </div>
          </div>

          <div className="col-12">
            <div className="pos-invoice-layout">
              <Card
                title="Billing Invoice Queue"
                icon={IconFileInvoice}
                actions={
                  <form className="d-flex gap-2" onSubmit={(e) => { e.preventDefault(); loadBillingPayments(billingSearch); }}>
                    <input className="form-control form-control-sm" value={billingSearch} onChange={(e) => setBillingSearch(e.target.value)} placeholder="Search customer, location, invoice, or service" />
                    <button className="btn btn-sm"><IconSearch size={16} /></button>
                  </form>
                }
              >
                <div className="table-responsive">
                  <table className="table card-table table-vcenter pos-invoice-table">
                    <thead><tr><th>Customer</th><th>Location</th><th>Open Invoices</th><th>Oldest Due</th><th>Overdue</th><th>Total Balance</th><th /></tr></thead>
                    <tbody>
                      {visibleBillingCustomerGroups.map((group) => (
                        <tr key={group.key} className={selectedBillingCustomerGroup?.key === group.key ? 'is-selected' : ''}>
                          <td>
                            <strong>{customerNameOnly(group.customer)}</strong>
                            <div className="text-muted small">
                              {group.customer?.accountNumber || group.serviceLabels.slice(0, 2).join(', ') || 'Billing customer'}
                            </div>
                          </td>
                          <td className="pos-invoice-location-cell">
                            <span>{group.locationLabel || billingGroupLocationLabel(group)}</span>
                          </td>
                          <td>
                            <strong>{group.openInvoiceCount}</strong>
                            <div className="text-muted small">{group.openInvoiceCount === 1 ? 'invoice' : 'invoices'}</div>
                          </td>
                          <td className={group.overdueInvoiceCount ? 'text-danger' : ''}>{group.oldestDueDate || '-'}</td>
                          <td>
                            {group.overdueInvoiceCount ? (
                              <>
                                <span className="badge bg-red-lt text-red">{group.overdueInvoiceCount} overdue</span>
                                <div className="text-muted small">{currency(group.overdueBalance)}</div>
                              </>
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                          </td>
                          <td>{currency(group.totalBalance)}</td>
                          <td className="text-end">
                            <button type="button" className="btn btn-sm btn-primary" disabled={invoicePaymentSubmitting} onClick={() => selectBillingCustomerGroup(group)}>Take Payment</button>
                          </td>
                        </tr>
                      ))}
                      {!visibleBillingCustomerGroups.length && <tr><td colSpan="7" className="text-muted">No customers with payable invoices.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </Card>

            </div>

            {selectedBillingCustomerGroup && (
              <div className="pos-modal-backdrop" onClick={invoicePaymentSubmitting ? undefined : resetInvoicePayment}>
                <section className="pos-modal pos-payment-modal" role="dialog" aria-modal="true" aria-labelledby="pos-payment-title" onClick={(event) => event.stopPropagation()}>
                  <form className="pos-payment-modal-form" onSubmit={saveInvoicePayment}>
                    <div className="pos-modal-header">
                      <div>
                        <span className="pos-modal-eyebrow">Customer Invoice Payment</span>
                        <div className="pos-modal-title-row">
                          <h3 id="pos-payment-title">{customerNameOnly(selectedBillingCustomerGroup.customer)}</h3>
                          <span className="pos-modal-location">
                            <IconMapPin size={15} />
                            <span>{billingGroupLocationLabel(selectedBillingCustomerGroup)}</span>
                          </span>
                        </div>
                      </div>
                      <button type="button" className="btn btn-icon btn-sm" disabled={invoicePaymentSubmitting} onClick={resetInvoicePayment} aria-label="Close payment desk"><IconX size={18} /></button>
                    </div>
                    <div className="pos-modal-body pos-payment-modal-body">
                      <section className="pos-payment-section pos-payment-selection-section">
                        <div className="pos-payment-section-header">
                          <div>
                            <span>Open Invoices</span>
                            <strong>{selectedPaymentInvoiceRows.length} selected</strong>
                          </div>
                          <strong>{currency(invoicePaymentAppliedAmount)}</strong>
                        </div>
                        <div className="pos-payment-invoice-list">
                          {selectedCustomerInvoiceRows.map(({ invoice, currentBalance, promotion, amountToCollect }) => {
                            const selected = selectedBillingInvoiceIds.includes(invoice.id);
                            return (
                              <label key={invoice.id} className={`pos-payment-invoice-row ${selected ? 'is-selected' : ''}`}>
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  disabled={invoicePaymentSubmitting}
                                  onChange={() => toggleInvoicePaymentInvoice(invoice.id)}
                                />
                                <span className="pos-payment-invoice-main">
                                  <strong>{invoice.invoiceNumber}</strong>
                                  <span>{invoiceCoverageLabel(invoice)}</span>
                                </span>
                                <span className="pos-payment-invoice-total">
                                  <strong>{currency(currentBalance)}</strong>
                                  <span>Total</span>
                                </span>
                                <span className="pos-payment-invoice-due">
                                  {promotion && (
                                    <span className="badge bg-green-lt text-green">
                                      {promotion.count > 1 ? `${promotion.count} promotions` : promotion.label} -{currency(promotion.amount)}
                                    </span>
                                  )}
                                  <strong>{currency(amountToCollect)}</strong>
                                </span>
                              </label>
                            );
                          })}
                          {!selectedCustomerInvoiceRows.length && <div className="text-muted">No payable invoices found for this customer.</div>}
                        </div>
                      </section>
                      <section className="pos-payment-section">
                        <div className="pos-payment-section-header">
                          <div>
                            <span>Payment Details</span>
                            <strong>{currency(invoicePaymentAppliedAmount)}</strong>
                          </div>
                        </div>
                        <div className="row g-3">
                          <div className="col-md-6"><TextField label="Payment Date" type="date" max={today()} value={invoicePaymentForm.paymentDate} required disabled={invoicePaymentSubmitting} onChange={changeInvoicePaymentDate} /></div>
                          <div className="col-md-6"><SelectField label="Method" value={invoicePaymentForm.method} options={billingPaymentMethods} disabled={invoicePaymentSubmitting} onChange={(method) => setInvoicePaymentForm({ ...invoicePaymentForm, method })} /></div>
                          <div className="col-md-6"><TextField label="Amount Received" type="number" min="0.01" step="0.01" value={invoicePaymentForm.amount} required disabled={invoicePaymentSubmitting} onChange={(amount) => setInvoicePaymentForm({ ...invoicePaymentForm, amount })} /></div>
                          <div className="col-md-6">
                            <TextField label={invoicePaymentReferenceRequired ? 'Reference Required' : 'Reference'} value={invoicePaymentForm.referenceNumber} disabled={invoicePaymentSubmitting} onChange={(referenceNumber) => setInvoicePaymentForm({ ...invoicePaymentForm, referenceNumber })} />
                            {invoicePaymentReferenceRequired && <div className="pos-field-hint">Required for {labelize(invoicePaymentForm.method)} payments.</div>}
                          </div>
                          {invoicePaymentExcessAmount > 0 && invoicePaymentIsCash && (
                            <div className="col-12">
                              <div className="pos-excess-note">
                                <div>
                                  <strong>{invoicePaymentExcessLabel}</strong>
                                  <span>{currency(invoicePaymentExcessAmount)} will be returned to the customer.</span>
                                </div>
                              </div>
                            </div>
                          )}
                          <div className="col-12">
                            <details className="pos-payment-disclosure">
                              <summary>
                                <span>Notes</span>
                                <strong>{invoicePaymentForm.notes ? 'Added' : 'Optional'}</strong>
                              </summary>
                              <div>
                                <textarea className="form-control" rows="3" value={invoicePaymentForm.notes} disabled={invoicePaymentSubmitting} onChange={(e) => setInvoicePaymentForm({ ...invoicePaymentForm, notes: e.target.value })} />
                              </div>
                            </details>
                          </div>
                        </div>
                      </section>
                      <div className="pos-total-panel pos-payment-totals pos-payment-totals-compact">
                        <div>
                          <span>Invoice total</span>
                          <strong>{currency(selectedInvoiceTotalBeforeDiscount)}</strong>
                        </div>
                        <div>
                          <span>Less discount</span>
                          <strong className={invoicePaymentDiscountTotal > 0 ? 'text-green' : ''}>{invoicePaymentDiscountTotal > 0 ? `-${currency(invoicePaymentDiscountTotal)}` : currency(0)}</strong>
                        </div>
                        <div>
                          <span>Amount due</span>
                          <strong>{currency(invoicePaymentAppliedAmount)}</strong>
                        </div>
                        <div>
                          <span>Received</span>
                          <strong>{currency(invoicePaymentAmount)}</strong>
                        </div>
                        <div>
                          <span>{invoicePaymentShortfallAmount > 0 ? 'Short' : invoicePaymentExcessLabel}</span>
                          <strong className={invoicePaymentShortfallAmount > 0 ? 'text-danger' : ''}>{currency(invoicePaymentShortfallAmount || invoicePaymentExcessDisplayAmount)}</strong>
                        </div>
                        <div>
                          <span>Remaining balance</span>
                          <strong>{currency(selectedInvoiceRemaining)}</strong>
                        </div>
                      </div>
                    </div>
                    <div className="pos-modal-footer">
                      <button type="button" className="btn" disabled={invoicePaymentSubmitting} onClick={resetInvoicePayment}>Cancel</button>
                      <button type="submit" className="btn btn-primary" disabled={invoicePaymentSubmitting || !selectedPaymentInvoiceRows.length || invoicePaymentAppliedAmount <= 0}>
                        {invoicePaymentSubmitting ? <IconLoader2 size={18} className="me-2 pos-spin" /> : <IconCreditCard size={18} className="me-2" />}
                        {invoicePaymentSubmitting ? 'Posting Payment' : 'Post Payment'}
                      </button>
                    </div>
                  </form>
                </section>
              </div>
            )}
          </div>

        </div>
      )}

      {activeTab === 'Office Stock' && (
        <div className="pos-register-layout">
          <Card
            title="Office Stock"
            icon={IconArrowsExchange2}
            actions={
              <form className="d-flex gap-2" onSubmit={(e) => { e.preventDefault(); loadOfficeItems(officeSearch); }}>
                <input className="form-control form-control-sm" value={officeSearch} onChange={(e) => setOfficeSearch(e.target.value)} placeholder="Search office stock" />
                <button className="btn btn-sm"><IconSearch size={16} /></button>
              </form>
            }
          >
            <div className="pos-product-grid">
              {officeItems.map((item) => {
                const available = stockQuantity(item);
                const disabled = officeMode === 'ISSUE' && available <= 0;
                return (
                  <button
                    type="button"
                    className="pos-product-tile"
                    key={item.id}
                    onClick={() => addOfficeItemToCart(item)}
                    disabled={disabled}
                  >
                    <span className="pos-product-sku">{item.sku}</span>
                    <strong>{item.name}</strong>
                    <span className="badge bg-blue-lt text-blue pos-stock-badge">{labelize(item.category)}</span>
                    <small>{available} {item.unit || ''} available</small>
                    <small>{item.location || 'Main stockroom'}</small>
                  </button>
                );
              })}
              {!officeItems.length && <div className="empty">No active office stock items yet.</div>}
            </div>
          </Card>

          <Card title={officeModeCopy[officeMode].title} icon={IconReceipt}>
            <form onSubmit={saveOfficeStock}>
              <div className="row g-3">
                <div className="col-12">
                  <div className="btn-group w-100 pos-mode-switch" role="group" aria-label="Office stock movement type">
                    <button type="button" className={`btn ${officeMode === 'ISSUE' ? 'btn-primary' : ''}`} onClick={() => setOfficeMode('ISSUE')}>Check Out</button>
                    <button type="button" className={`btn ${officeMode === 'RETURN' ? 'btn-primary' : ''}`} onClick={() => setOfficeMode('RETURN')}>Check In</button>
                  </div>
                </div>
                <div className="col-md-6"><TextField label="Reference" value={officeStockForm.referenceId} onChange={(value) => setOfficeStockForm({ ...officeStockForm, referenceId: value })} /></div>
                <div className="col-md-6"><TextField label="Person / Team" value={officeStockForm.handledBy} onChange={(value) => setOfficeStockForm({ ...officeStockForm, handledBy: value })} /></div>
                <div className="col-12"><TextField label="Stock Location" value={officeStockForm.location} onChange={(value) => setOfficeStockForm({ ...officeStockForm, location: value })} /></div>
                <div className="col-12">
                  <div className="pos-cart-lines">
                    {officeCartLines.map((line, index) => {
                      const item = officeItemById.get(line.itemId);
                      return (
                        <div className="pos-cart-line pos-office-cart-line" key={`${line.itemId}-${index}`}>
                          <div>
                            <strong>{item?.name || 'Office stock item'}</strong>
                            <div className="text-muted">{item?.sku || line.itemId}</div>
                          </div>
                          <input className="form-control pos-qty" type="number" min="0.01" step="0.01" value={line.quantity} onChange={(e) => setOfficeLine(index, { quantity: e.target.value })} />
                          <input className="form-control pos-serial" value={line.serialNumber || ''} required={item?.trackingType === 'SERIALIZED'} placeholder={item?.trackingType === 'SERIALIZED' ? 'Serial required' : 'Serial'} onChange={(e) => setOfficeLine(index, { serialNumber: e.target.value })} />
                          <button type="button" className="btn btn-icon" onClick={() => removeOfficeLine(index)}><IconTrash size={16} /></button>
                        </div>
                      );
                    })}
                    {!officeCartLines.length && <div className="empty">Add stock items from the office stock menu.</div>}
                  </div>
                </div>
                <div className="col-12">
                  <label className="form-label">Notes</label>
                  <textarea className="form-control" rows="3" value={officeStockForm.notes} onChange={(e) => setOfficeStockForm({ ...officeStockForm, notes: e.target.value })} />
                </div>
                <div className="col-12">
                  <div className="pos-total-panel pos-office-summary">
                    <span>{officeCartLines.length} line{officeCartLines.length === 1 ? '' : 's'}</span>
                    <strong>{officeMode === 'ISSUE' ? 'Stock Out' : 'Stock In'}</strong>
                  </div>
                </div>
                <div className="col-12 d-flex justify-content-between gap-2">
                  <button type="button" className="btn" onClick={resetOfficeStock}>Clear</button>
                  <button className="btn btn-primary"><IconArrowsExchange2 size={18} className="me-2" />{officeModeCopy[officeMode].button}</button>
                </div>
              </div>
            </form>
          </Card>
        </div>
      )}

      {activeTab === 'Catalog' && (
        <div className="row row-cards">
          <div className="col-12">
            <Card title="Sellable Inventory Catalog" icon={IconPackage} actions={
              <form className="d-flex gap-2" onSubmit={(e) => { e.preventDefault(); load(customerSearch, itemSearch); }}>
                <input className="form-control form-control-sm" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Search items" />
                <button className="btn btn-sm"><IconSearch size={16} /></button>
              </form>
            }>
              <p className="text-muted mb-3">Items are maintained in Inventory. POS only sells active inventory items marked as sellable in POS.</p>
              <div className="table-responsive">
                <table className="table card-table table-vcenter">
                  <thead><tr><th>SKU</th><th>Name</th><th>Category</th><th>Price</th><th>Available</th><th>Tracking</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.sku}</td><td>{item.name}</td><td>{item.category?.replaceAll('_', ' ')}</td><td>{currency(item.unitPrice)}</td><td>{item.stockTracked ? `${item.stockOnHand} ${item.unit || ''}` : 'Not tracked'}</td><td>{item.trackingType?.replaceAll('_', ' ')}</td>
                        <td><span className={`badge ${statusClass(item.status)}`}>{item.status}</span></td>
                        <td className="text-end">
                          <button className="btn btn-sm" onClick={() => addCatalogItemToCart(item)}>Add</button>
                        </td>
                      </tr>
                    ))}
                    {!items.length && <tr><td colSpan="8" className="text-muted">No sellable inventory items yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'Sales' && (
        <div className="row row-cards">
          {salesMetrics.map(({ label, value, icon: Icon, tone, action }) => (
            <div className="col-sm-6 col-lg-3" key={label}>
              {action ? (
                <div
                  className="card status-card pos-kpi-card"
                  role="button"
                  tabIndex={0}
                  onClick={action}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      action();
                    }
                  }}
                  aria-label="Show low stock items"
                >
                  <div className="card-body">
                    <span className={`badge bg-${tone}-lt text-${tone} mb-3`}><Icon size={18} /></span>
                    <div className="h1 mb-0">{value}</div>
                    <div className="text-muted">{label}</div>
                  </div>
                </div>
              ) : (
                <div className="card status-card">
                  <div className="card-body">
                    <span className={`badge bg-${tone}-lt text-${tone} mb-3`}><Icon size={18} /></span>
                    <div className="h1 mb-0">{value}</div>
                    <div className="text-muted">{label}</div>
                  </div>
                </div>
              )}
            </div>
          ))}
          <div className="col-12">
            <Card title="Today Cashier Collections" icon={IconCash}>
              <div className="pos-collection-summary">
                <div className="pos-collection-totals">
                  <div>
                    <span>Total Collected</span>
                    <strong>{currency(cashierCollectionTotals.totalCollected)}</strong>
                  </div>
                  <div>
                    <span>Cash</span>
                    <strong>{currency(cashierCollectionTotals.totalCash)}</strong>
                  </div>
                  <div>
                    <span>Non-Cash</span>
                    <strong>{currency(cashierCollectionTotals.totalOther)}</strong>
                  </div>
                  <div>
                    <span>Receipts</span>
                    <strong>{cashierCollectionTotals.receiptCount}</strong>
                  </div>
                  <div>
                    <span>Voids</span>
                    <strong>{cashierCollectionTotals.voidedReceipts}</strong>
                  </div>
                  <div>
                    <span>Void Amount</span>
                    <strong>{currency(cashierCollectionTotals.voidedAmount)}</strong>
                  </div>
                </div>
                <div className="table-responsive">
                  <table className="table card-table table-vcenter pos-collection-table">
                    <thead><tr><th>Cashier</th><th>Register Cash</th><th>Register Non-Cash</th><th>Invoice Cash</th><th>Invoice Non-Cash</th><th>Total</th><th>Receipts</th><th>Voids</th></tr></thead>
                    <tbody>
                      {cashierCollectionRows.map((row) => (
                        <tr key={row.key}>
                          <td><strong>{row.cashier}</strong></td>
                          <td>{currency(row.registerCash)}</td>
                          <td>{currency(row.registerOther)}</td>
                          <td>{currency(row.invoiceCash)}</td>
                          <td>{currency(row.invoiceOther)}</td>
                          <td><strong>{currency(row.totalCollected)}</strong></td>
                          <td>{row.receiptCount}</td>
                          <td>
                            {row.voidedReceipts ? (
                              <>
                                <span className="badge bg-red-lt text-red">{row.voidedReceipts}</span>
                                <div className="text-muted small">{currency(row.voidedAmount)}</div>
                              </>
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {!cashierCollectionRows.length && <tr><td colSpan="8" className="text-muted">No cashier collections posted today.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>
          </div>
          <div className="col-12">
            <Card
              title="Sales"
              icon={IconReceipt}
              actions={
                <div className="d-flex gap-2">
                  <button className="btn btn-sm" type="button" onClick={() => { load(); loadBillingPayments(billingSearch); loadOfficeMovements(); }}><IconRefresh size={16} className="me-1" />Refresh</button>
                  <button className="btn btn-sm btn-primary" type="button" onClick={() => setActiveTab('Register')}><IconShoppingCart size={16} className="me-1" />Register</button>
                </div>
              }
            >
              <div className="pos-history-tabs">
                {['Register', 'Invoice Payments', 'Office Stock'].map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={`btn btn-sm ${salesHistoryTab === tab ? 'btn-primary' : ''}`}
                    onClick={() => setSalesHistoryTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {salesHistoryTab === 'Register' && (
                <div className="pos-history-panel">
                  <div className="pos-history-header">
                    <div>
                      <h4>Register Receipts</h4>
                      <p>Checkout sales posted from the POS register.</p>
                    </div>
                    <button className="btn btn-sm" type="button" onClick={() => setActiveTab('Register')}><IconShoppingCart size={16} className="me-1" />Open Register</button>
                  </div>
                  <HistoryControls
                    control={historyControls.register}
                    filterOptions={registerFilterOptions}
                    searchPlaceholder="Search receipt, customer, user, or amount"
                    onChange={(patch) => updateHistoryControl('register', patch)}
                  />
                  <div className="table-responsive">
                    <table className="table card-table table-vcenter">
                      <thead><tr><th>Receipt</th><th>Posted At</th><th>Customer</th><th>User</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th /></tr></thead>
                      <tbody>
                        {registerHistory.rows.map((sale) => (
                          <tr key={sale.id}>
                            <td>{sale.receiptNumber}</td><td>{formatDateTime(sale.createdAt)}</td><td>{customerLabel(sale.customer)}</td><td>{saleUserLabel(sale)}</td><td>{currency(sale.total)}</td><td>{currency(sale.paidTotal)}</td><td>{currency(sale.balance)}</td>
                            <td><span className={`badge ${statusClass(sale.paymentStatus)}`}>{sale.paymentStatus?.replaceAll('_', ' ')}</span></td>
                            <td className="text-end">
                              <button className="btn btn-sm text-danger" onClick={() => voidSale(sale)}>Void</button>
                            </td>
                          </tr>
                        ))}
                        {!registerHistory.rows.length && <tr><td colSpan="9" className="text-muted">No matching register sales.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <HistoryPagination {...registerHistory} onPage={(page) => updateHistoryControl('register', { page })} />
                </div>
              )}

              {salesHistoryTab === 'Invoice Payments' && (
                <div className="pos-history-panel">
                  <div className="pos-history-header">
                    <div>
                      <h4>Invoice Payment Receipts</h4>
                      <p>Customer invoice payments posted into Billing from POS.</p>
                    </div>
                    <button className="btn btn-sm" type="button" onClick={() => setActiveTab('Invoice Payments')}><IconCreditCard size={16} className="me-1" />Take Payment</button>
                  </div>
                  <HistoryControls
                    control={historyControls.invoice}
                    filterOptions={invoicePaymentFilterOptions}
                    searchPlaceholder="Search receipt, invoice, customer, method, or user"
                    onChange={(patch) => updateHistoryControl('invoice', patch)}
                  />
                  <div className="table-responsive">
                    <table className="table card-table table-vcenter">
                      <thead><tr><th>Receipt</th><th>Posted At</th><th>Customer</th><th>Invoice</th><th>Method</th><th>Channel</th><th>Amount</th><th>User</th><th>Status</th><th /></tr></thead>
                      <tbody>
                        {invoicePaymentHistory.rows.map((payment) => (
                          <tr key={payment.id}>
                            <td>{payment.receiptNumber}</td>
                            <td>{paymentRecordedAt(payment) ? formatDateTime(paymentRecordedAt(payment)) : (payment.paymentDate || '-')}</td>
                            <td>{customerNameOnly(payment.customer)}</td>
                            <td>
                              <strong>{paymentAllocationLabel(payment)}</strong>
                              {paymentAllocationDetail(payment) && <div className="text-muted small">{paymentAllocationDetail(payment)}</div>}
                            </td>
                            <td>{labelize(payment.method)}</td>
                            <td>{labelize(payment.collectionChannel || 'Billing')}</td>
                            <td>{currency(payment.amount)}</td>
                            <td>{payment.postedByName || payment.postedByUsername || '-'}</td>
                            <td><span className={`badge ${statusClass(payment.status)}`}>{labelize(payment.status)}</span></td>
                            <td className="text-end">
                              <div className="btn-list justify-content-end flex-nowrap">
                                <button type="button" className="btn btn-sm" onClick={() => setSelectedBillingReceipt(payment)}>View</button>
                                {payment.status === 'POSTED' && (
                                  <button type="button" className="btn btn-sm text-danger" onClick={() => requestVoidBillingPayment(payment)}>Void</button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                        {!invoicePaymentHistory.rows.length && <tr><td colSpan="10" className="text-muted">No matching invoice payment receipts.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <HistoryPagination {...invoicePaymentHistory} onPage={(page) => updateHistoryControl('invoice', { page })} />
                </div>
              )}

              {salesHistoryTab === 'Office Stock' && (
                <div className="pos-history-panel">
                  <div className="pos-history-header">
                    <div>
                      <h4>Office Stock Movements</h4>
                      <p>Non-sales inventory check-out and check-in activity.</p>
                    </div>
                    <button className="btn btn-sm" type="button" onClick={() => setActiveTab('Office Stock')}><IconArrowsExchange2 size={16} className="me-1" />Open Office Stock</button>
                  </div>
                  <HistoryControls
                    control={historyControls.office}
                    filterOptions={officeMovementFilterOptions}
                    searchPlaceholder="Search item, reference, person, serial, or notes"
                    onChange={(patch) => updateHistoryControl('office', patch)}
                  />
                  <div className="table-responsive">
                    <table className="table card-table table-vcenter">
                      <thead><tr><th>Date</th><th>Item</th><th>Type</th><th>Qty</th><th>Person / Location</th><th>Reference</th><th>Serial</th><th>Notes</th></tr></thead>
                      <tbody>
                        {officeMovementHistory.rows.map((movement) => {
                          const person = movement.type === 'ISSUE' ? movement.toLocation : movement.fromLocation;
                          const location = movement.type === 'ISSUE' ? movement.fromLocation : movement.toLocation;
                          return (
                            <tr key={movement.id}>
                              <td>{formatDateTime(movement.createdAt)}</td>
                              <td>
                                <strong>{movement.item?.sku || movement.itemId}</strong>
                                <div className="text-muted small">{movement.item?.name || 'Inventory item'}</div>
                              </td>
                              <td><span className={`badge ${statusClass(movement.type)}`}>{labelize(movement.type)}</span></td>
                              <td>{movement.quantity} {movement.item?.unit || ''}</td>
                              <td>
                                <strong>{person || '-'}</strong>
                                <div className="text-muted small">{location || '-'}</div>
                              </td>
                              <td>{movement.referenceId || '-'}</td>
                              <td>{movement.serialNumber || '-'}</td>
                              <td>{movement.notes || '-'}</td>
                            </tr>
                          );
                        })}
                        {!officeMovementHistory.rows.length && <tr><td colSpan="8" className="text-muted">No matching office stock movements.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <HistoryPagination {...officeMovementHistory} onPage={(page) => updateHistoryControl('office', { page })} />
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {showLowStockPanel && (
        <div className="pos-drawer-backdrop" onClick={() => setShowLowStockPanel(false)}>
          <aside className="pos-drawer" role="dialog" aria-modal="true" aria-labelledby="pos-low-stock-title" onClick={(event) => event.stopPropagation()}>
            <div className="pos-drawer-header">
              <div>
                <h3 id="pos-low-stock-title" className="mb-1">Low Stock</h3>
                <div className="text-muted">{overview.lowStock?.length || 0} item{overview.lowStock?.length === 1 ? '' : 's'} at or below reorder point</div>
              </div>
              <button type="button" className="btn btn-icon" onClick={() => setShowLowStockPanel(false)} aria-label="Close low stock panel"><IconX size={18} /></button>
            </div>
            <div className="pos-drawer-body">
              {overview.lowStock?.length ? (
                <div className="pos-low-stock-list">
                  {overview.lowStock.map((item) => (
                    <div className="pos-low-stock-row" key={item.id}>
                      <div>
                        <strong>{item.sku}</strong>
                        <div>{item.name}</div>
                        <small className="text-muted">{item.category?.replaceAll('_', ' ') || 'Uncategorized'}</small>
                      </div>
                      <div className="pos-low-stock-counts">
                        <span>{item.stockOnHand} {item.unit || ''}</span>
                        <small>Reorder {item.reorderPoint}</small>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty">No low stock items.</div>
              )}
            </div>
          </aside>
        </div>
      )}

      <ReceiptDetailModal
        payment={selectedBillingReceipt}
        invoiceRows={billingInvoices}
        onClose={() => setSelectedBillingReceipt(null)}
        onVoid={requestVoidBillingPayment}
      />

      <VoidBillingReceiptModal
        payment={voidBillingReceipt}
        reason={voidBillingReason}
        submitting={voidBillingSubmitting}
        onReasonChange={setVoidBillingReason}
        onClose={() => {
          if (voidBillingSubmitting) return;
          setVoidBillingReceipt(null);
          setVoidBillingReason('');
        }}
        onConfirm={confirmVoidBillingPayment}
      />

    </div>
  );
}
