import React, { useEffect, useMemo, useState } from 'react';
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCash,
  IconCheck,
  IconClock,
  IconCoin,
  IconExternalLink,
  IconMapPin,
  IconMessage,
  IconPrinter,
  IconReceipt,
  IconRefresh,
  IconSearch,
  IconSend,
  IconShieldCheck,
  IconUserCheck,
  IconWallet,
  IconX
} from '@tabler/icons-react';
import './collector.css';

const API = '/api';

function token() {
  return localStorage.getItem('threejmain_token');
}

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || 'Request failed');
  return data;
}

function money(value) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function discountMoney(value) {
  const amount = Number(value || 0);
  return money(amount > 0 ? -amount : 0);
}

function dateLabel(value) {
  if (!value) return '-';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function billMonthLabel(invoice = {}) {
  const value = invoice.billingCycleStart || invoice.issueDate || invoice.dueDate;
  if (!value) return 'Monthly bill';
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return 'Monthly bill';
  return `${parsed.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })} bill`;
}

function dateTimeLabel(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function customerName(customer = {}) {
  return customer.name
    || [customer.firstName, customer.middleName, customer.lastName].filter(Boolean).join(' ')
    || 'Unnamed customer';
}

function customerLocation(customer = {}) {
  const locality = [customer.barangay, customer.city, customer.province]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return locality.join(', ') || String(customer.address || '').trim();
}

function customerSearchText(account = {}) {
  const customer = account.customer || {};
  const invoices = account.invoices || [];
  return [
    customerName(customer),
    customer.firstName,
    customer.middleName,
    customer.lastName,
    customer.accountNumber,
    customer.contactNumber,
    customer.address,
    customer.addressLine1,
    customer.addressLine2,
    customer.barangay,
    customer.city,
    customer.province,
    account.customerId,
    account.subscriptionId,
    account.serviceReference,
    ...invoices.flatMap((invoice) => [invoice.invoiceNumber, invoice.catalogName])
  ].filter(Boolean).join(' ').toLowerCase();
}

function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `collector-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function invoicePromotionQuote(invoice = {}) {
  const balance = Number(invoice.balance || 0);
  const quote = invoice.promotionQuote || {};
  const promotionIds = Array.isArray(quote.promotionIds) ? quote.promotionIds.filter(Boolean) : [];
  const promotionDiscountAmount = Number(quote.promotionDiscountAmount || 0);
  const discountedPayable = Number(quote.discountedPayable ?? balance);
  const hasPromotion = promotionIds.length > 0 && promotionDiscountAmount > 0 && discountedPayable > 0;
  return {
    promotionIds: hasPromotion ? promotionIds : [],
    promotions: hasPromotion && Array.isArray(quote.promotions) ? quote.promotions : [],
    promotionDiscountAmount: hasPromotion ? promotionDiscountAmount : 0,
    discountedPayable: hasPromotion ? discountedPayable : balance,
    paymentDate: hasPromotion ? String(quote.paymentDate || '') : '',
    quoteFingerprint: hasPromotion ? String(quote.quoteFingerprint || '') : ''
  };
}

function accountPayableToday(account = {}) {
  if (account.payableToday !== undefined && account.payableToday !== null) {
    return Number(account.payableToday || 0);
  }
  return (account.invoices || []).reduce(
    (sum, invoice) => sum + invoicePromotionQuote(invoice).discountedPayable,
    0
  );
}

function allocateOldestFirst(invoices = [], rawAmount = 0) {
  let remaining = Number(rawAmount || 0);
  const allocations = [];
  for (const invoice of invoices) {
    if (remaining <= 0) break;
    const invoiceBalance = Number(invoice.balance || 0);
    const quote = invoicePromotionQuote(invoice);
    const appliesPromotion = quote.promotionIds.length > 0 && remaining >= quote.discountedPayable;
    const applied = appliesPromotion
      ? quote.discountedPayable
      : Math.min(invoiceBalance, remaining);
    if (applied > 0) {
      allocations.push({
        invoiceId: invoice.id,
        amount: Number(applied.toFixed(2)),
        promotionIds: appliesPromotion ? quote.promotionIds : [],
        promotionQuoteDate: appliesPromotion ? quote.paymentDate : '',
        promotionQuoteFingerprint: appliesPromotion ? quote.quoteFingerprint : '',
        promotionDiscountAmount: appliesPromotion ? quote.promotionDiscountAmount : 0,
        promotions: appliesPromotion ? quote.promotions : []
      });
      remaining = Number((remaining - applied).toFixed(2));
    }
  }
  return { allocations, unapplied: remaining };
}

function automaticPaymentBreakdown(invoices = [], rawReceived = 0, excessDecision = '') {
  const receivedAmount = Number(rawReceived || 0);
  const automatic = allocateOldestFirst(invoices, receivedAmount);
  const appliedAmount = Number(automatic.allocations.reduce((sum, row) => sum + row.amount, 0).toFixed(2));
  const promotionDiscountAmount = Number(
    automatic.allocations.reduce((sum, row) => sum + Number(row.promotionDiscountAmount || 0), 0).toFixed(2)
  );
  const excess = Number(automatic.unapplied.toFixed(2));
  const advanceAmount = excessDecision === 'ADVANCE' ? excess : 0;
  const returnedAmount = excessDecision === 'RETURN' ? excess : 0;
  return {
    receivedAmount,
    amount: Number((appliedAmount + advanceAmount).toFixed(2)),
    allocations: automatic.allocations,
    appliedAmount,
    promotionDiscountAmount,
    advanceAmount,
    returnedAmount,
    excess
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function receiptDocument(collection, printEvent) {
  const customer = collection.customer || {};
  const advanceAmount = Number(collection.advanceAmount || 0);
  const appliedAmount = Number(collection.appliedAmount ?? (Number(collection.amount || 0) - advanceAmount));
  const address = customer.address
    || [customer.addressLine1, customer.addressLine2, customer.barangay, customer.city, customer.province].filter(Boolean).join(', ');
  const allocationRows = (collection.allocations || []).map((allocation) => {
    const promotionRows = (allocation.promotions || []).map((promotion) => `
      <tr class="promo-row">
        <td>Promo: ${escapeHtml(promotion.promotionName || promotion.promotionCode || 'Automatic discount')}</td>
        <td class="num">- P ${Number(promotion.amount || 0).toFixed(2)}</td>
      </tr>
    `).join('');
    return `
      <tr>
        <td>
          ${escapeHtml(allocation.invoiceNumber || 'Invoice')}<br>
          <span class="muted">${escapeHtml(allocation.billingCycleStart || allocation.dueDate || '')}</span>
        </td>
        <td class="num">P ${Number(allocation.balanceBefore || allocation.amount || 0).toFixed(2)}</td>
      </tr>
      ${promotionRows}
      <tr class="payment-row">
        <td>Payment applied</td>
        <td class="num">P ${Number(allocation.amount || 0).toFixed(2)}</td>
      </tr>
    `;
  }).join('');
  const advanceRow = advanceAmount > 0
    ? `
      <tr>
        <td>Advance account credit<br><span class="muted">For a future monthly invoice</span></td>
        <td class="num">P ${advanceAmount.toFixed(2)}</td>
      </tr>
    `
    : '';
  const planNames = [...new Set((collection.allocations || []).map((row) => row.catalogName).filter(Boolean))].join(', ');
  const paymentReference = collection.method === 'GCASH' && collection.referenceNumber
    ? `<tr><td>GCash Reference</td><td class="num">${escapeHtml(collection.referenceNumber)}</td></tr>`
    : '';
  const receivedAmount = Number(collection.receivedAmount ?? collection.tenderedAmount ?? collection.amount ?? 0);
  const returnedAmount = Number(collection.returnedAmount ?? collection.changeAmount ?? 0);
  const promotionDiscountAmount = Number(collection.promotionDiscountAmount || 0);
  const balanceBefore = Number(collection.balanceBefore || 0);
  const receivedRows = `
    <tr><td>Amount Received</td><td class="num">P ${receivedAmount.toFixed(2)}</td></tr>
    ${returnedAmount > 0 ? `<tr><td>${collection.method === 'CASH' ? 'Returned as Change' : 'Returned to Customer'}</td><td class="num">P ${returnedAmount.toFixed(2)}</td></tr>` : ''}
  `;
  const copyLabel = printEvent?.label === 'REPRINT'
    ? `<div class="copy-label">REPRINT COPY ${Number(printEvent.copyNumber || 1)}</div>`
    : '';
  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8">
      <title>${escapeHtml(collection.receiptNumber || 'Payment Receipt')}</title>
      <style>
        * { box-sizing: border-box; }
        body { color: #000; font-family: Arial, sans-serif; font-size: 11pt; margin: 0 auto; width: 300px; -webkit-font-smoothing: none; }
        .header, .thank-you, .copy-label { text-align: center; }
        .header strong { font-size: 11pt; }
        .copy-label { border: 1px solid #000; font-size: 9pt; font-weight: bold; margin: 7px 0; padding: 3px; }
        hr { border: 0; border-top: 1px solid #000; margin: 8px 0; }
        hr.dotted { border-top-style: dotted; margin: 4px 0; }
        .section { margin-top: 8px; }
        .section-title { font-weight: bold; margin-bottom: 4px; }
        .muted { font-size: 8pt; }
        .promo-row td { font-size: 9pt; }
        .payment-row td { font-weight: bold; padding-bottom: 4px; }
        table { border-collapse: collapse; width: 100%; }
        td { padding: 1px 0; vertical-align: top; }
        td.num { text-align: right; }
        .footer-space { height: 25mm; }
        @page { margin: 4mm; size: 80mm auto; }
        @media print { body { width: 72mm; } }
      </style>
    </head>
    <body>
      <div class="header">
        <strong>3J COMPUTER AND INTERNET</strong><br>
        INSTALLATION SERVICES<br>
        Zone 2, Roma Norte, Enrile Cagayan<br>
        09058234990
      </div>
      ${copyLabel}
      <hr>
      <div class="section">
        Customer: ${escapeHtml(customerName(customer))}<br>
        Address: ${escapeHtml(address || 'N/A')}<br>
        ${planNames ? `Plan: ${escapeHtml(planNames)}<br>` : ''}
        Account: ${escapeHtml(customer.accountNumber || 'N/A')}
      </div>
      <hr>
      <div class="section">
        <div class="section-title">PAYMENT RECEIPT</div>
        Receipt #: ${escapeHtml(collection.receiptNumber || '')}<br>
        Date: ${escapeHtml(dateTimeLabel(collection.createdAt))}<br>
        Billing Status: ${escapeHtml(collection.billingPaymentStatus || 'POSTED')}
      </div>
      <div class="section">
        <div class="section-title">PAYMENT ALLOCATION</div>
        <table>${allocationRows}${advanceRow}</table>
      </div>
      <hr>
      <div class="section">
        <table>
          <tr><td><strong>Total Amount Paid</strong></td><td class="num"><strong>P ${Number(collection.amount || 0).toFixed(2)}</strong></td></tr>
          <tr><td>Regular balance before payment</td><td class="num">P ${balanceBefore.toFixed(2)}</td></tr>
          ${promotionDiscountAmount > 0 ? `<tr><td>Automatic promo discounts</td><td class="num">- P ${promotionDiscountAmount.toFixed(2)}</td></tr>` : ''}
          <tr><td>Applied to invoices</td><td class="num">P ${appliedAmount.toFixed(2)}</td></tr>
          ${advanceAmount > 0 ? `<tr><td>Added as advance credit</td><td class="num">P ${advanceAmount.toFixed(2)}</td></tr>` : ''}
          <tr><td><strong>Remaining Balance</strong></td><td class="num"><strong>P ${Number(collection.balanceAfter || 0).toFixed(2)}</strong></td></tr>
          <tr><td><strong>Available Account Credit</strong></td><td class="num"><strong>P ${Number(collection.accountCreditAfter || 0).toFixed(2)}</strong></td></tr>
        </table>
      </div>
      <hr class="dotted">
      <div class="section">
        <table>
          <tr><td>Payment Method</td><td class="num">${escapeHtml(collection.method === 'GCASH' ? 'GCash' : 'Cash')}</td></tr>
          ${paymentReference}
          ${receivedRows}
        </table>
      </div>
      <div class="section">Collector: ${escapeHtml(collection.collectorName || collection.collectorUsername || 'N/A')}</div>
      <hr class="dotted">
      <div class="thank-you section">Thank you for your payment!</div>
      <div class="footer-space"></div>
      <script>
        window.onload = function () {
          window.setTimeout(function () { window.print(); }, 150);
        };
      </script>
    </body>
  </html>`;
}

function mapsHref(customer = {}) {
  if (customer.latitude && customer.longitude) {
    return `https://www.google.com/maps?q=${encodeURIComponent(`${customer.latitude},${customer.longitude}`)}`;
  }
  const address = customer.address
    || [customer.addressLine1, customer.barangay, customer.city, customer.province].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || customerName(customer))}`;
}

function StatusChip({ value }) {
  const normalized = String(value || '').toUpperCase();
  const tone = normalized === 'SETTLED' || normalized === 'CLOSED' || normalized === 'SUCCESS' || normalized === 'PAID'
    ? 'green'
    : normalized === 'VARIANCE' || normalized === 'FAILED'
      ? 'red'
      : normalized === 'HELD'
        ? 'orange'
        : 'blue';
  return <span className={`badge bg-${tone}-lt text-${tone}`}>{value || '-'}</span>;
}

function Metric({ icon: Icon, label, value, tone = 'blue' }) {
  return (
    <div className="collector-metric card">
      <span className={`collector-metric-icon bg-${tone}-lt text-${tone}`}><Icon size={20} /></span>
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
    </div>
  );
}

function CustomerCard({ account, currentUser, onCollect, busy }) {
  const customer = account.customer || {};
  const claim = account.claim;
  const mine = claim && claim.collectorUsername === currentUser?.username;
  return (
    <article className={`collector-customer-card card ${claim && !mine ? 'collector-customer-claimed' : ''}`}>
      <div className="card-body">
        <div className="collector-card-top">
          <div>
            <h3>{customerName(customer)}</h3>
            <span>{customer.accountNumber || 'No account number'}</span>
          </div>
          <StatusChip value={account.overdueBalance > 0 ? 'OVERDUE' : account.outstandingBalance > 0 ? 'OPEN' : 'PAID'} />
        </div>
        <div className="collector-balance-row">
          <div><small>Regular balance</small><strong>{money(account.outstandingBalance)}</strong></div>
          <div className="collector-discount-value"><small>Promo savings</small><strong>{discountMoney(account.promotionDiscountTotal)}</strong></div>
          <div className="collector-due-value"><small>Amount due</small><strong>{money(accountPayableToday(account))}</strong></div>
          <div><small>Invoices</small><strong>{account.openInvoiceCount || 0}</strong></div>
        </div>
        {Number(account.accountCredit || 0) > 0 && (
          <div className="collector-account-credit">Available account credit: <strong>{money(account.accountCredit)}</strong></div>
        )}
        <div className="collector-address">
          <IconMapPin size={17} />
          <span>{customer.address || 'No saved customer address'}</span>
        </div>
        {claim && (
          <div className={`collector-claim-note ${mine ? 'is-mine' : ''}`}>
            <IconUserCheck size={16} />
            {mine
              ? `Payment entry opened by you until ${dateTimeLabel(claim.expiresAt)}`
              : `${claim.collectorName || claim.collectorUsername} is handling this customer`}
          </div>
        )}
        <div className="collector-card-actions">
          <a className="btn btn-outline-secondary" href={mapsHref(customer)} target="_blank" rel="noreferrer">
            <IconMapPin size={17} /> Map
          </a>
          <button className="btn btn-primary" type="button" disabled={busy || Boolean(claim && !mine)} onClick={() => onCollect(account)}>
            {claim && !mine ? <IconClock size={17} /> : <IconCash size={17} />}
            {busy ? 'Opening…' : claim && !mine ? 'In use' : 'Collect'}
          </button>
        </div>
      </div>
    </article>
  );
}

function CollectionCard({ collection, onPrint, printing }) {
  const customer = collection.customer || {};
  return (
    <article className="collector-history-card card">
      <div className="card-body">
        <div className="collector-card-top">
          <div>
            <h3>{collection.receiptNumber || 'Receipt'}</h3>
            <span>{dateTimeLabel(collection.createdAt)}</span>
          </div>
          <StatusChip value={collection.custodyStatus} />
        </div>
        <div className="collector-history-customer">{customerName(customer)}</div>
        <div className="collector-history-grid">
          <div><small>Amount</small><strong>{money(collection.amount)}</strong></div>
          <div><small>Promo saved</small><strong>{money(collection.promotionDiscountAmount)}</strong></div>
          <div><small>Method</small><strong>{collection.method === 'GCASH' ? 'GCash' : 'Cash'}</strong></div>
          <div><small>Balance after</small><strong>{money(collection.balanceAfter)}</strong></div>
          <div><small>SMS</small><StatusChip value={collection.sms?.status || 'PENDING'} /></div>
        </div>
        {collection.referenceNumber && <div className="collector-reference">GCash ref: {collection.referenceNumber}</div>}
        <div className="collector-card-actions">
          <button className="btn btn-outline-primary ms-auto" type="button" disabled={printing} onClick={() => onPrint(collection)}>
            <IconPrinter size={17} /> {collection.printHistory?.length ? 'Print again' : 'Print receipt'}
          </button>
        </div>
      </div>
    </article>
  );
}

function RemittanceCard({ remittance }) {
  return (
    <article className="collector-remittance-card card">
      <div className="card-body">
        <div className="collector-card-top">
          <div>
            <h3>{remittance.remittanceNumber}</h3>
            <span>{dateTimeLabel(remittance.submittedAt)}</span>
          </div>
          <StatusChip value={remittance.status} />
        </div>
        <div className="collector-history-grid">
          <div><small>Receipts</small><strong>{remittance.collectionCount}</strong></div>
          <div><small>Expected cash</small><strong>{money(remittance.expectedCash)}</strong></div>
          <div><small>Expected GCash</small><strong>{money(remittance.expectedGcash)}</strong></div>
          <div><small>Total</small><strong>{money(remittance.expectedTotal)}</strong></div>
        </div>
        {remittance.gcashTransferReference && <div className="collector-reference">Transfer ref: {remittance.gcashTransferReference}</div>}
        {remittance.status === 'VARIANCE' && (
          <div className="alert alert-danger mt-3 mb-0">
            Cash variance {money(remittance.cashVariance)} · GCash variance {money(remittance.gcashVariance)}
          </div>
        )}
      </div>
    </article>
  );
}

function FinanceRemittanceCard({ remittance, draft, onChange, onConfirm, busy }) {
  return (
    <article className="collector-finance-card card">
      <div className="card-body">
        <div className="collector-card-top">
          <div>
            <h3>{remittance.remittanceNumber}</h3>
            <span>{remittance.collectorName} · {dateTimeLabel(remittance.submittedAt)}</span>
          </div>
          <StatusChip value={remittance.status} />
        </div>
        <div className="collector-finance-expected">
          <div><small>Expected cash</small><strong>{money(remittance.expectedCash)}</strong></div>
          <div><small>Expected GCash</small><strong>{money(remittance.expectedGcash)}</strong></div>
          <div><small>Receipts</small><strong>{remittance.collectionCount}</strong></div>
        </div>
        <div className="collector-handoff-summary">
          <div><span>Collector declared cash</span><strong>{money(remittance.declaredCash)}</strong></div>
          <div><span>Collector transferred GCash</span><strong>{money(remittance.gcashTransferredAmount)}</strong></div>
          {remittance.gcashTransferReference && <div><span>Transfer reference</span><strong>{remittance.gcashTransferReference}</strong></div>}
          {remittance.companyGcashAccount && <div><span>Company GCash account</span><strong>{remittance.companyGcashAccount}</strong></div>}
        </div>
        <div className="collector-finance-form">
          <label>
            <span>Cash physically received</span>
            <input className="form-control" type="number" min="0" step="0.01" value={draft.countedCash} onChange={(event) => onChange('countedCash', event.target.value)} />
          </label>
          <label>
            <span>GCash received by company</span>
            <input className="form-control" type="number" min="0" step="0.01" value={draft.confirmedGcashAmount} onChange={(event) => onChange('confirmedGcashAmount', event.target.value)} />
          </label>
          {Number(remittance.expectedGcash || 0) > 0 && (
            <label className="collector-full-field">
              <span>Company GCash receiving reference</span>
              <input className="form-control" value={draft.companyGcashReference} onChange={(event) => onChange('companyGcashReference', event.target.value)} placeholder="Required company transaction reference" />
            </label>
          )}
          <label className="collector-full-field">
            <span>Finance notes</span>
            <textarea className="form-control" rows="2" value={draft.notes} onChange={(event) => onChange('notes', event.target.value)} />
          </label>
          <label className="collector-checkbox collector-full-field">
            <input type="checkbox" checked={draft.acceptVariance} onChange={(event) => onChange('acceptVariance', event.target.checked)} />
            <span>Accept and close even when there is a documented variance</span>
          </label>
        </div>
        <button className="btn btn-success w-100 mt-3" type="button" disabled={busy} onClick={onConfirm}>
          <IconShieldCheck size={18} /> Confirm company receipt
        </button>
      </div>
    </article>
  );
}

export default function CollectorPage({ currentUser = {} }) {
  const [meta, setMeta] = useState({});
  const [overview, setOverview] = useState({ today: {}, custody: {}, metrics: {} });
  const [customers, setCustomers] = useState([]);
  const [collections, setCollections] = useState([]);
  const [remittances, setRemittances] = useState([]);
  const [finance, setFinance] = useState({ metrics: {}, openRemittances: [], recentClosed: [] });
  const [activeTab, setActiveTab] = useState('worklist');
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [payment, setPayment] = useState(null);
  const [excessPrompt, setExcessPrompt] = useState(false);
  const [remittanceForm, setRemittanceForm] = useState({
    declaredCash: '',
    gcashTransferredAmount: '',
    gcashTransferReference: '',
    companyGcashAccount: '',
    notes: ''
  });
  const [financeDrafts, setFinanceDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const activeClaimMine = selectedCustomer?.claim?.collectorUsername === currentUser?.username;
  const paymentBreakdown = useMemo(
    () => automaticPaymentBreakdown(selectedCustomer?.invoices || [], payment?.amount || 0),
    [selectedCustomer, payment?.amount]
  );
  const paymentAmountValid = Boolean(
    payment
    && String(payment.amount ?? '').trim()
    && Number.isFinite(Number(payment.amount))
    && Number(payment.amount) > 0
  );
  const paymentAllocationByInvoice = useMemo(
    () => new Map(paymentBreakdown.allocations.map((allocation) => [allocation.invoiceId, allocation])),
    [paymentBreakdown.allocations]
  );
  const amountDueToday = accountPayableToday(selectedCustomer || {});
  const locationOptions = useMemo(
    () => [...new Set(customers.map((account) => customerLocation(account.customer)).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, 'en')),
    [customers]
  );
  const filteredCustomers = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return customers.filter((account) => {
      if (locationFilter && customerLocation(account.customer) !== locationFilter) return false;
      if (!terms.length) return true;
      const haystack = customerSearchText(account);
      return terms.every((term) => haystack.includes(term));
    });
  }, [customers, locationFilter, search]);
  const filtersActive = Boolean(search.trim() || locationFilter);

  function showError(message) {
    setError(message);
    setNotice('');
    window.setTimeout(() => setError(''), 7000);
  }

  function showNotice(message) {
    setNotice(message);
    setError('');
    window.setTimeout(() => setNotice(''), 6000);
  }

  async function load() {
    setLoading(true);
    setError('');
    try {
      const nextMeta = await request('/collector/meta');
      const calls = [
        request('/collector/overview'),
        request('/collector/customers'),
        request('/collector/collections'),
        request('/collector/remittances')
      ];
      if (nextMeta.canViewFinance) calls.push(request('/collector/finance/overview'));
      const [nextOverview, customerResult, collectionResult, remittanceResult, financeResult] = await Promise.all(calls);
      setMeta(nextMeta);
      setActiveTab((current) => {
        const allowedTabs = [
          nextMeta.canCollect && 'worklist',
          'collections',
          nextMeta.canSubmitRemittance && 'remittance',
          nextMeta.canViewFinance && 'finance'
        ].filter(Boolean);
        if (allowedTabs.includes(current)) return current;
        return nextMeta.canViewFinance && !nextMeta.canCollect ? 'finance' : allowedTabs[0];
      });
      setOverview(nextOverview);
      setCustomers(customerResult.items || []);
      setCollections(collectionResult.items || []);
      setRemittances(remittanceResult.items || []);
      if (financeResult) setFinance(financeResult);
      setRemittanceForm((current) => ({
        ...current,
        declaredCash: current.declaredCash || String(nextOverview.custody?.cash || 0),
        gcashTransferredAmount: current.gcashTransferredAmount || String(nextOverview.custody?.gcash || 0)
      }));
      if (selectedCustomer) {
        const refreshed = (customerResult.items || []).find((row) => row.customerId === selectedCustomer.customerId);
        setSelectedCustomer(refreshed || null);
      }
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCustomer(account) {
    setSelectedCustomer(account);
    setPayment({
      amount: String(accountPayableToday(account) || ''),
      method: 'CASH',
      paymentDate: account.paymentDate || '',
      referenceNumber: '',
      smsDestination: account.customer?.contactNumber || '',
      notes: '',
      idempotencyKey: createIdempotencyKey()
    });
  }

  async function startCollection(account) {
    if (account.claim?.collectorUsername === currentUser?.username) {
      openCustomer(account);
      return;
    }
    if (account.claim) {
      showError('Another collector is currently handling this customer.');
      return;
    }
    setBusy(`collect-${account.customerId}`);
    try {
      const reservation = await request(`/collector/customers/${account.customerId}/claim`, {
        method: 'POST',
        body: JSON.stringify({ minutes: 15 })
      });
      const reservedAccount = { ...account, claim: reservation };
      setCustomers((current) => current.map((row) => (
        row.customerId === account.customerId ? reservedAccount : row
      )));
      openCustomer(reservedAccount);
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function submitPayment(event) {
    event.preventDefault();
    if (paymentBreakdown.excess > 0) {
      setExcessPrompt(true);
      return;
    }
    await postPayment('');
  }

  async function postPayment(excessDecision) {
    if (!selectedCustomer || !payment) return;
    if (!activeClaimMine) {
      showError('This payment entry is no longer active. Close it and tap Collect again.');
      return;
    }
    const breakdown = automaticPaymentBreakdown(
      selectedCustomer.invoices || [],
      payment.amount,
      excessDecision
    );
    if (breakdown.receivedAmount <= 0 || breakdown.amount <= 0) {
      showError('Enter an amount received.');
      return;
    }
    setExcessPrompt(false);
    setBusy('payment');
    try {
      const result = await request('/collector/collections', {
        method: 'POST',
        headers: { 'Idempotency-Key': payment.idempotencyKey },
        body: JSON.stringify({
          customerId: selectedCustomer.customerId,
          amount: breakdown.amount,
          receivedAmount: breakdown.receivedAmount,
          returnedAmount: breakdown.returnedAmount,
          allocations: breakdown.allocations.map((allocation) => ({
            invoiceId: allocation.invoiceId,
            amount: allocation.amount,
            promotionIds: allocation.promotionIds,
            promotionQuoteDate: allocation.promotionQuoteDate,
            promotionQuoteFingerprint: allocation.promotionQuoteFingerprint
          })),
          advanceAmount: breakdown.advanceAmount,
          allocationMode: breakdown.advanceAmount > 0 ? 'ADVANCE' : 'OLDEST',
          method: payment.method,
          paymentDate: payment.paymentDate || selectedCustomer.paymentDate,
          referenceNumber: payment.referenceNumber,
          tenderedAmount: payment.method === 'CASH' ? breakdown.receivedAmount : breakdown.amount,
          smsDestination: payment.smsDestination,
          notes: payment.notes
        })
      });
      setSelectedReceipt(result);
      setSelectedCustomer(null);
      setPayment(null);
      showNotice(`Payment posted as ${result.receiptNumber}.`);
      await load();
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function closePaymentEntry() {
    if (busy === 'payment' || busy === 'close-payment') return;
    const claimId = selectedCustomer?.claim?.id;
    const customerId = selectedCustomer?.customerId;
    const shouldRelease = Boolean(claimId && activeClaimMine);
    setExcessPrompt(false);
    setSelectedCustomer(null);
    setPayment(null);
    if (!shouldRelease) return;
    setBusy('close-payment');
    try {
      await request(`/collector/claims/${claimId}`, { method: 'DELETE' });
      setCustomers((current) => current.map((row) => (
        row.customerId === customerId ? { ...row, claim: null } : row
      )));
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function printCollection(collection) {
    const printWindow = window.open('', '_blank', 'width=420,height=760');
    if (!printWindow) {
      showError('Allow pop-ups for this site so the receipt can open.');
      return;
    }
    printWindow.document.write('<p style="font-family:Arial;padding:20px">Preparing receipt…</p>');
    setBusy(`print-${collection.id}`);
    try {
      const result = await request(`/collector/collections/${collection.id}/print-events`, {
        method: 'POST',
        body: JSON.stringify({
          reason: collection.printHistory?.length ? 'Receipt reprint requested' : 'Original receipt print requested'
        })
      });
      printWindow.document.open();
      printWindow.document.write(receiptDocument(result.collection, result.printEvent));
      printWindow.document.close();
      setSelectedReceipt(result.collection);
      await load();
    } catch (err) {
      printWindow.close();
      showError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function submitRemittance(event) {
    event.preventDefault();
    setBusy('remittance');
    try {
      const result = await request('/collector/remittances', {
        method: 'POST',
        body: JSON.stringify({
          declaredCash: Number(remittanceForm.declaredCash || 0),
          gcashTransferredAmount: Number(remittanceForm.gcashTransferredAmount || 0),
          gcashTransferReference: remittanceForm.gcashTransferReference,
          companyGcashAccount: remittanceForm.companyGcashAccount,
          notes: remittanceForm.notes
        })
      });
      showNotice(`${result.remittanceNumber} was submitted to Finance.`);
      setRemittanceForm({
        declaredCash: '',
        gcashTransferredAmount: '',
        gcashTransferReference: '',
        companyGcashAccount: '',
        notes: ''
      });
      await load();
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy('');
    }
  }

  function financeDraft(remittance) {
    return financeDrafts[remittance.id] || {
      countedCash: String(remittance.countedCash ?? remittance.expectedCash ?? 0),
      confirmedGcashAmount: String(remittance.confirmedGcashAmount ?? remittance.expectedGcash ?? 0),
      companyGcashReference: remittance.companyGcashReference || '',
      notes: remittance.financeNotes || '',
      acceptVariance: false
    };
  }

  function updateFinanceDraft(remittance, key, value) {
    setFinanceDrafts((current) => ({
      ...current,
      [remittance.id]: { ...financeDraft(remittance), [key]: value }
    }));
  }

  async function confirmRemittance(remittance) {
    const draft = financeDraft(remittance);
    setBusy(`finance-${remittance.id}`);
    try {
      const result = await request(`/collector/remittances/${remittance.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          countedCash: Number(draft.countedCash || 0),
          confirmedGcashAmount: Number(draft.confirmedGcashAmount || 0),
          companyGcashReference: draft.companyGcashReference,
          notes: draft.notes,
          acceptVariance: Boolean(draft.acceptVariance)
        })
      });
      showNotice(
        result.status === 'CLOSED'
          ? `${result.remittanceNumber} is settled.`
          : `${result.remittanceNumber} has a variance requiring resolution.`
      );
      await load();
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy('');
    }
  }

  const tabs = [
    meta.canCollect && { id: 'worklist', label: 'Customers', icon: IconMapPin },
    { id: 'collections', label: 'Receipts', icon: IconReceipt },
    meta.canSubmitRemittance && { id: 'remittance', label: 'Remit', icon: IconWallet },
    meta.canViewFinance && { id: 'finance', label: 'Finance', icon: IconShieldCheck }
  ].filter(Boolean);

  return (
    <div className="collector-page">
      <header className="collector-page-header">
        <div>
          <div className="collector-eyebrow">Mobile field collections</div>
          <h2>Collector Portal</h2>
          <p>{currentUser?.full_name || currentUser?.username} · {String(currentUser?.role || '').replaceAll('_', ' ')}</p>
        </div>
        <button className="btn btn-outline-secondary collector-refresh" type="button" onClick={() => load()} disabled={loading}>
          <IconRefresh className={loading ? 'collector-spin' : ''} size={18} />
          <span>Refresh</span>
        </button>
      </header>

      {error && <div className="collector-toast alert alert-danger"><IconAlertTriangle size={19} /><span>{error}</span><button type="button" onClick={() => setError('')}><IconX size={18} /></button></div>}
      {notice && <div className="collector-toast alert alert-success"><IconCheck size={19} /><span>{notice}</span><button type="button" onClick={() => setNotice('')}><IconX size={18} /></button></div>}

      <div className="collector-metrics">
        <Metric icon={IconCoin} label="Collected today" value={money(overview.today?.total)} tone="green" />
        <Metric icon={IconCash} label="Cash held" value={money(overview.custody?.cash)} tone="orange" />
        <Metric icon={IconWallet} label="GCash held" value={money(overview.custody?.gcash)} tone="blue" />
        <Metric icon={IconClock} label="Open remittance" value={overview.myOpenRemittanceCount || 0} tone="purple" />
      </div>

      <nav className="collector-tabs" aria-label="Collector workspaces">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button className={activeTab === id ? 'active' : ''} type="button" key={id} onClick={() => setActiveTab(id)}>
            <Icon size={18} /> {label}
          </button>
        ))}
      </nav>

      {activeTab === 'worklist' && meta.canCollect && (
        <section className="collector-worklist">
          <div className="collector-worklist-filters">
            <div className="collector-search">
              <IconSearch size={18} />
              <input
                aria-label="Search customers"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search customer, account, invoice or address"
              />
              {search && <button type="button" aria-label="Clear search" onClick={() => setSearch('')}><IconX size={17} /></button>}
            </div>
            <label className="collector-location-filter">
              <IconMapPin size={18} />
              <select aria-label="Filter customers by location" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}>
                <option value="">All locations</option>
                {locationOptions.map((location) => <option value={location} key={location}>{location}</option>)}
              </select>
            </label>
            {filtersActive && (
              <button className="btn btn-outline-secondary collector-clear-filters" type="button" onClick={() => { setSearch(''); setLocationFilter(''); }}>
                <IconX size={17} /> Clear
              </button>
            )}
          </div>
          <div className="collector-list-summary">
            <span>{filtersActive ? `${filteredCustomers.length} of ${customers.length}` : customers.length} customer accounts</span>
            <strong>{money(filteredCustomers.reduce((sum, row) => sum + accountPayableToday(row), 0))} due today</strong>
          </div>
          <div className="collector-customer-grid">
            {filteredCustomers.map((account) => (
              <CustomerCard
                key={account.customerId}
                account={account}
                currentUser={currentUser}
                onCollect={startCollection}
                busy={busy === `collect-${account.customerId}`}
              />
            ))}
          </div>
          {!loading && !filteredCustomers.length && (
            <div className="collector-empty card">
              {filtersActive ? 'No customer accounts match the current filters.' : 'No active customer accounts found.'}
            </div>
          )}
        </section>
      )}

      {activeTab === 'collections' && (
        <section>
          <div className="collector-section-heading">
            <div><h3>Payment receipts</h3><p>Every receipt remains available for audited reprinting.</p></div>
            <span className="badge bg-blue-lt text-blue">{collections.length}</span>
          </div>
          <div className="collector-history-list">
            {collections.map((collection) => (
              <CollectionCard key={collection.id} collection={collection} onPrint={printCollection} printing={busy === `print-${collection.id}`} />
            ))}
          </div>
          {!loading && !collections.length && <div className="collector-empty card">No collection receipts yet.</div>}
        </section>
      )}

      {activeTab === 'remittance' && meta.canSubmitRemittance && (
        <section className="collector-remittance-layout">
          <form className="collector-remittance-form card" onSubmit={submitRemittance}>
            <div className="card-body">
              <div className="collector-section-heading">
                <div><h3>Submit collection batch</h3><p>Send all currently held cash and GCash to Finance.</p></div>
                <IconSend className="text-blue" size={25} />
              </div>
              <div className="collector-custody-total">
                <div><span>Cash expected</span><strong>{money(overview.custody?.cash)}</strong></div>
                <div><span>GCash expected</span><strong>{money(overview.custody?.gcash)}</strong></div>
                <div><span>Receipts</span><strong>{overview.custody?.collections || 0}</strong></div>
              </div>
              <label>
                <span>Cash being handed to Finance</span>
                <input className="form-control" type="number" min="0" step="0.01" value={remittanceForm.declaredCash} onChange={(event) => setRemittanceForm({ ...remittanceForm, declaredCash: event.target.value })} />
              </label>
              <label>
                <span>GCash transferred to company</span>
                <input className="form-control" type="number" min="0" step="0.01" value={remittanceForm.gcashTransferredAmount} onChange={(event) => setRemittanceForm({ ...remittanceForm, gcashTransferredAmount: event.target.value })} />
              </label>
              {Number(overview.custody?.gcash || 0) > 0 && (
                <>
                  <label>
                    <span>GCash transfer reference</span>
                    <input className="form-control" required value={remittanceForm.gcashTransferReference} onChange={(event) => setRemittanceForm({ ...remittanceForm, gcashTransferReference: event.target.value })} />
                  </label>
                  <label>
                    <span>Company GCash account</span>
                    <input className="form-control" value={remittanceForm.companyGcashAccount} onChange={(event) => setRemittanceForm({ ...remittanceForm, companyGcashAccount: event.target.value })} />
                  </label>
                </>
              )}
              <label>
                <span>Notes</span>
                <textarea className="form-control" rows="2" value={remittanceForm.notes} onChange={(event) => setRemittanceForm({ ...remittanceForm, notes: event.target.value })} />
              </label>
              <button className="btn btn-primary w-100" type="submit" disabled={busy === 'remittance' || !Number(overview.custody?.collections || 0)}>
                <IconSend size={18} /> Submit to Finance
              </button>
            </div>
          </form>
          <div>
            <div className="collector-section-heading"><div><h3>My remittances</h3><p>Finance receipt and variance status.</p></div></div>
            <div className="collector-history-list">
              {remittances.map((remittance) => <RemittanceCard key={remittance.id} remittance={remittance} />)}
            </div>
            {!remittances.length && <div className="collector-empty card">No remittance batches yet.</div>}
          </div>
        </section>
      )}

      {activeTab === 'finance' && meta.canViewFinance && (
        <section>
          <div className="collector-finance-metrics">
            <Metric icon={IconReceipt} label="Pending batches" value={finance.metrics?.pendingBatches || 0} tone="blue" />
            <Metric icon={IconCash} label="Cash expected" value={money(finance.metrics?.pendingCash)} tone="orange" />
            <Metric icon={IconWallet} label="GCash expected" value={money(finance.metrics?.pendingGcash)} tone="cyan" />
            <Metric icon={IconAlertTriangle} label="Variance batches" value={finance.metrics?.varianceBatches || 0} tone="red" />
          </div>
          <div className="collector-section-heading"><div><h3>Finance reconciliation</h3><p>Count physical cash and verify transfers in the company GCash account.</p></div></div>
          <div className="collector-finance-list">
            {(finance.openRemittances || []).map((remittance) => (
              <FinanceRemittanceCard
                key={remittance.id}
                remittance={remittance}
                draft={financeDraft(remittance)}
                onChange={(key, value) => updateFinanceDraft(remittance, key, value)}
                onConfirm={() => confirmRemittance(remittance)}
                busy={busy === `finance-${remittance.id}`}
              />
            ))}
          </div>
          {!finance.openRemittances?.length && <div className="collector-empty card"><IconShieldCheck size={30} />No remittances are waiting for Finance.</div>}
        </section>
      )}

      {selectedCustomer && payment && (
        <div className="collector-modal-backdrop" role="presentation">
          <section className="collector-payment-modal" role="dialog" aria-modal="true" aria-label="Collect customer payment">
            <header>
              <button type="button" disabled={busy === 'payment' || busy === 'close-payment'} onClick={closePaymentEntry}><IconArrowLeft size={20} /></button>
              <div><h3>Collect payment</h3><span>{customerName(selectedCustomer.customer)}</span></div>
              <button type="button" disabled={busy === 'payment' || busy === 'close-payment'} onClick={closePaymentEntry}><IconX size={20} /></button>
            </header>
            <div className="collector-payment-body">
              <div className="collector-customer-summary">
                <div><small>Regular balance</small><strong>{money(selectedCustomer.outstandingBalance)}</strong></div>
                <div className="collector-discount-value"><small>Automatic discount</small><strong>{discountMoney(selectedCustomer.promotionDiscountTotal)}</strong></div>
                <div className="collector-due-value"><small>Amount due today</small><strong>{money(accountPayableToday(selectedCustomer))}</strong></div>
                <div><small>Open invoices</small><strong>{selectedCustomer.openInvoiceCount}</strong></div>
                <a href={mapsHref(selectedCustomer.customer)} target="_blank" rel="noreferrer"><IconMapPin size={17} /> Open location <IconExternalLink size={15} /></a>
              </div>
              {!activeClaimMine && <div className="alert alert-warning">This payment session expired. Close it and tap Collect again.</div>}
              <form onSubmit={submitPayment}>
                <label>
                  <span>Amount received</span>
                  <input
                    className="form-control collector-amount-input"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    placeholder="0.00"
                    aria-describedby="collector-amount-help"
                    value={payment.amount}
                    onChange={(event) => {
                      setPayment({ ...payment, amount: event.target.value });
                      setExcessPrompt(false);
                    }}
                  />
                  <small id="collector-amount-help">Applied automatically to the oldest bill first.</small>
                </label>
                <div className="collector-amount-actions">
                  <button
                    className="btn btn-outline-primary"
                    type="button"
                    disabled={amountDueToday <= 0}
                    onClick={() => {
                      setPayment({ ...payment, amount: amountDueToday.toFixed(2) });
                      setExcessPrompt(false);
                    }}
                  >
                    Use full amount {money(amountDueToday)}
                  </button>
                </div>
                <section className="collector-invoice-ledger" aria-label="Open bills and automatic allocation">
                  <header className="collector-invoice-ledger-header">
                    <strong>Open bills</strong>
                    <span>{selectedCustomer.invoices?.length || 0}</span>
                  </header>
                  <div className="collector-invoice-list">
                    {(selectedCustomer.invoices || []).map((invoice) => {
                      const allocation = paymentAllocationByInvoice.get(invoice.id);
                      const availableQuote = invoicePromotionQuote(invoice);
                      const invoiceBalance = Number(invoice.balance || 0);
                      const promotionDiscount = Number(allocation?.promotionDiscountAmount || 0);
                      const settlementAmount = Number(allocation?.amount || 0) + promotionDiscount;
                      const fullyCovered = Boolean(allocation && settlementAmount >= invoiceBalance - 0.005);
                      let stateClass = 'is-waiting';
                      let stateTitle = 'Waiting for amount';
                      if (paymentAmountValid && allocation) {
                        stateClass = fullyCovered ? 'is-paid' : 'is-partial';
                        stateTitle = fullyCovered ? 'Covered by payment' : `Apply ${money(allocation.amount)}`;
                      } else if (paymentAmountValid) {
                        stateClass = 'is-pending';
                        stateTitle = 'Not reached yet';
                      }
                      return (
                        <article className="collector-invoice-row" key={invoice.id}>
                          <div className="collector-invoice-row-main">
                            <div className="collector-invoice-title">
                              <strong>{billMonthLabel(invoice)}</strong>
                              {availableQuote.promotionIds.length > 0 && (
                                <small className="collector-invoice-promo">
                                  Save {money(availableQuote.promotionDiscountAmount)} when fully paid
                                </small>
                              )}
                            </div>
                            <div className="collector-invoice-due">
                              <small>Amount due</small>
                              <strong>{money(availableQuote.discountedPayable)}</strong>
                            </div>
                          </div>
                          <span className={`collector-invoice-state ${stateClass}`}>{stateTitle}</span>
                        </article>
                      );
                    })}
                  </div>
                </section>
                <div className="collector-method-switch">
                  {['CASH', 'GCASH'].map((method) => (
                    <button className={payment.method === method ? 'active' : ''} type="button" key={method} onClick={() => setPayment({ ...payment, method })}>
                      {method === 'CASH' ? <IconCash size={21} /> : <IconWallet size={21} />}
                      {method === 'CASH' ? 'Cash' : 'GCash'}
                    </button>
                  ))}
                </div>
                {payment.method === 'GCASH' && (
                  <label>
                    <span>GCash transaction reference</span>
                    <input className="form-control" required value={payment.referenceNumber} onChange={(event) => setPayment({ ...payment, referenceNumber: event.target.value })} />
                  </label>
                )}
                <label>
                  <span>Customer SMS number</span>
                  <input className="form-control" inputMode="tel" value={payment.smsDestination} onChange={(event) => setPayment({ ...payment, smsDestination: event.target.value })} />
                  <small>Payment confirmation will be sent through A2P from 3J BILL.</small>
                </label>
                <label>
                  <span>Collector notes</span>
                  <textarea className="form-control" rows="2" value={payment.notes} onChange={(event) => setPayment({ ...payment, notes: event.target.value })} />
                </label>
                <button
                  className="btn btn-success collector-post-button"
                  type="submit"
                  disabled={busy === 'payment' || !activeClaimMine || !paymentAmountValid}
                >
                  <IconShieldCheck size={19} /> {busy === 'payment'
                    ? 'Posting payment…'
                    : !paymentAmountValid
                      ? 'Enter amount received'
                      : paymentBreakdown.excess > 0
                      ? `Review excess ${money(paymentBreakdown.excess)}`
                      : `Post ${money(paymentBreakdown.receivedAmount)}`}
                </button>
              </form>
            </div>
          </section>
        </div>
      )}

      {excessPrompt && selectedCustomer && payment && (
        <div className="collector-modal-backdrop collector-excess-backdrop" role="presentation">
          <section className="collector-excess-modal" role="dialog" aria-modal="true" aria-label="Choose what to do with the excess amount">
            <span className="collector-excess-icon"><IconCoin size={28} /></span>
            <h3>Amount is higher than the total due</h3>
            <p>
              Received <strong>{money(paymentBreakdown.receivedAmount)}</strong>. Total amount due is{' '}
              <strong>{money(paymentBreakdown.appliedAmount)}</strong>.
            </p>
            <div className="collector-excess-amount">
              <span>Excess</span>
              <strong>{money(paymentBreakdown.excess)}</strong>
            </div>
            <button className="btn btn-primary" type="button" disabled={busy === 'payment'} onClick={() => postPayment('ADVANCE')}>
              Apply excess as advance
            </button>
            <button
              className="btn btn-outline-secondary"
              type="button"
              disabled={busy === 'payment'}
              onClick={() => (
                paymentBreakdown.appliedAmount > 0 ? postPayment('RETURN') : closePaymentEntry()
              )}
            >
              {paymentBreakdown.appliedAmount > 0
                ? payment.method === 'CASH'
                  ? 'Return excess as change'
                  : 'Return excess to customer'
                : 'Return all — no payment'}
            </button>
            <button className="btn btn-link" type="button" disabled={busy === 'payment'} onClick={() => setExcessPrompt(false)}>
              Go back
            </button>
          </section>
        </div>
      )}

      {selectedReceipt && (
        <div className="collector-modal-backdrop" role="presentation">
          <section className="collector-receipt-modal" role="dialog" aria-modal="true" aria-label="Payment receipt">
            <header>
              <span className="collector-receipt-success"><IconCheck size={24} /></span>
              <button type="button" onClick={() => setSelectedReceipt(null)}><IconX size={20} /></button>
            </header>
            <div className="collector-receipt-summary">
              <small>Payment posted</small>
              <h3>{selectedReceipt.receiptNumber}</h3>
              <strong>{money(selectedReceipt.amount)}</strong>
              <span>{customerName(selectedReceipt.customer)}</span>
            </div>
            <div className="collector-receipt-details">
              <div><span>Method</span><strong>{selectedReceipt.method === 'GCASH' ? 'GCash' : 'Cash'}</strong></div>
              <div><span>Promo discount</span><strong>{money(selectedReceipt.promotionDiscountAmount)}</strong></div>
              <div><span>Remaining balance</span><strong>{money(selectedReceipt.balanceAfter)}</strong></div>
              <div><span>Advance added</span><strong>{money(selectedReceipt.advanceAmount)}</strong></div>
              <div><span>Account credit</span><strong>{money(selectedReceipt.accountCreditAfter)}</strong></div>
              {Number(selectedReceipt.returnedAmount || 0) > 0 && (
                <div><span>Returned to customer</span><strong>{money(selectedReceipt.returnedAmount)}</strong></div>
              )}
              <div><span>SMS confirmation</span><StatusChip value={selectedReceipt.sms?.status || 'PENDING'} /></div>
              <div><span>Custody</span><StatusChip value={selectedReceipt.custodyStatus} /></div>
            </div>
            <button className="btn btn-primary w-100" type="button" disabled={busy === `print-${selectedReceipt.id}`} onClick={() => printCollection(selectedReceipt)}>
              <IconPrinter size={19} /> {selectedReceipt.printHistory?.length ? 'Print again' : 'Print thermal receipt'}
            </button>
            <button className="btn btn-outline-secondary w-100" type="button" onClick={() => setSelectedReceipt(null)}>Done</button>
          </section>
        </div>
      )}
    </div>
  );
}
