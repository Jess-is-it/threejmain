import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { billingMonthLabel, receiptDocument } from './receiptDocument.js';
import './collector.css';

const API = '/api';
const PAYMENT_POST_TIMEOUT_MS = 20000;
const PAYMENT_LOOKUP_TIMEOUT_MS = 10000;

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
  if (!response.ok) {
    const error = new Error(data.detail || 'Request failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

async function requestWithTimeout(path, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await request(path, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
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
  const month = billingMonthLabel(invoice);
  return month === 'Billing period' ? 'Monthly bill' : `${month} bill`;
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

function customerFirstName(customer = {}) {
  const firstName = String(customer.firstName || '').trim();
  if (firstName) return firstName;
  return customerName(customer).trim().split(/\s+/)[0] || 'Customer';
}

function customerSmsDestination(customer = {}) {
  return String(customer.contactNumber || customer.alternateMobileNumber || '').trim();
}

function smsAmount(value) {
  return Number(value || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function unavailableCustomerMessage(account = {}) {
  return `Hello, ${customerFirstName(account.customer)}. Our 3J collector visited today, but no one was available. `
    + `Your current amount due is P${smsAmount(accountPayableToday(account))}. `
    + 'Please contact 3J to arrange payment. Thank you.';
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

function pendingPaymentStorageKey(username) {
  return `threejmain_collector_pending_payment:${username}`;
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

function CustomerCard({ account, currentUser, onCollect, onMessage, collecting, messaging }) {
  const customer = account.customer || {};
  const claim = account.claim;
  const mine = claim && claim.collectorUsername === currentUser?.username;
  const messageDestination = customerSmsDestination(customer);
  const unavailable = Boolean(claim && !mine);
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
          <button
            className="btn btn-outline-primary"
            type="button"
            disabled={messaging || unavailable || !messageDestination}
            title={!messageDestination ? 'No saved mobile number' : unavailable ? 'Another collector is handling this customer' : 'Send customer unavailable notice'}
            onClick={() => onMessage(account)}
          >
            <IconMessage size={17} /> {messaging ? 'Sending…' : 'Message'}
          </button>
          <button className="btn btn-primary" type="button" disabled={collecting || unavailable} onClick={() => onCollect(account)}>
            {claim && !mine ? <IconClock size={17} /> : <IconCash size={17} />}
            {collecting ? 'Opening…' : claim && !mine ? 'In use' : 'Collect'}
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
          <button className="btn btn-outline-primary ms-auto" type="button" disabled={printing || collection.status !== 'POSTED'} onClick={() => onPrint(collection)}>
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
  const collectionItems = Array.isArray(remittance.collectionItems) ? remittance.collectionItems : [];
  const detailMismatch = collectionItems.length !== Number(remittance.collectionCount || 0)
    || Math.abs(Number(remittance.listedCollectionTotal || 0) - Number(remittance.expectedTotal || 0)) > 0.005;
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
        <section className="collector-reconciliation-items" aria-label={`Payments in ${remittance.remittanceNumber}`}>
          <div className="collector-reconciliation-heading">
            <div>
              <strong>Customers in this remittance</strong>
              <span>Review every customer payment before confirming receipt.</span>
            </div>
            <span>{collectionItems.length} {collectionItems.length === 1 ? 'payment' : 'payments'}</span>
          </div>
          <div className="collector-reconciliation-table" role="table" aria-label="Customer payments">
            <div className="collector-reconciliation-table-head" role="row">
              <span role="columnheader">Customer and receipt</span>
              <span role="columnheader">Method</span>
              <span role="columnheader">Payment amount</span>
            </div>
            {collectionItems.map((item) => (
              <div className="collector-reconciliation-row" role="row" key={item.collectionId}>
                <div className="collector-reconciliation-customer" role="cell">
                  <strong>{item.customerName || 'Unnamed customer'}</strong>
                  <span>{item.accountNumber || 'No account number'} · {item.receiptNumber || 'No receipt number'}</span>
                </div>
                <div className="collector-reconciliation-method" role="cell">
                  <span className={`badge ${item.method === 'GCASH' ? 'bg-cyan-lt text-cyan' : 'bg-orange-lt text-orange'}`}>
                    {item.method === 'GCASH' ? 'GCash' : 'Cash'}
                  </span>
                </div>
                <strong className="collector-reconciliation-amount" role="cell">{money(item.amount)}</strong>
              </div>
            ))}
            {!collectionItems.length && (
              <div className="collector-reconciliation-empty">No linked customer payments were found for this remittance.</div>
            )}
            <div className="collector-reconciliation-total">
              <span>Listed payment total</span>
              <strong>{money(remittance.listedCollectionTotal)}</strong>
            </div>
          </div>
        </section>
        {detailMismatch && (
          <div className="alert alert-danger collector-reconciliation-warning" role="alert">
            Linked payment details do not match this remittance summary. Refresh and resolve the discrepancy before confirming.
          </div>
        )}
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
        <button className="btn btn-success w-100 mt-3" type="button" disabled={busy || detailMismatch} onClick={onConfirm}>
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
  const [finance, setFinance] = useState({ metrics: {}, openRemittances: [], recentClosed: [], pendingReversals: [] });
  const [activeTab, setActiveTab] = useState('worklist');
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [messageCustomer, setMessageCustomer] = useState(null);
  const [messageSent, setMessageSent] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [payment, setPayment] = useState(null);
  const [excessPrompt, setExcessPrompt] = useState(false);
  const [paymentReview, setPaymentReview] = useState(null);
  const [paymentRecoveryMessage, setPaymentRecoveryMessage] = useState('');
  const [paymentRecoveryStatus, setPaymentRecoveryStatus] = useState('');
  const [remittanceForm, setRemittanceForm] = useState({
    declaredCash: '',
    gcashTransferredAmount: '',
    gcashTransferReference: '',
    companyGcashAccount: '',
    notes: ''
  });
  const [financeDrafts, setFinanceDrafts] = useState({});
  const [reversalDrafts, setReversalDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const paymentPostingRef = useRef(false);

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

  async function load({ preserveSelection = true } = {}) {
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
      if (preserveSelection && selectedCustomer) {
        const refreshed = (customerResult.items || []).find((row) => row.customerId === selectedCustomer.customerId);
        setSelectedCustomer(refreshed || null);
      }
      if (messageCustomer) {
        const refreshed = (customerResult.items || []).find((row) => row.customerId === messageCustomer.customerId);
        setMessageCustomer(refreshed || null);
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

  useEffect(() => {
    if (!currentUser?.username) return;
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(pendingPaymentStorageKey(currentUser.username)) || 'null');
      if (!saved?.idempotencyKey || !saved?.payload || !saved?.breakdown) return;
      setPaymentReview(saved);
      setPaymentRecoveryMessage('Checking the payment attempt saved in this browser session.');
      checkPaymentStatus(saved);
    } catch {
      try {
        window.sessionStorage.removeItem(pendingPaymentStorageKey(currentUser.username));
      } catch {
        // Restricted browser storage must not prevent the portal from opening.
      }
    }
  }, [currentUser?.username]);

  function savePendingPaymentAttempt(attempt) {
    if (!currentUser?.username) return;
    try {
      window.sessionStorage.setItem(pendingPaymentStorageKey(currentUser.username), JSON.stringify(attempt));
    } catch {
      // The current modal still supports lookup and retry when session storage is unavailable.
    }
  }

  function clearPendingPaymentAttempt() {
    if (!currentUser?.username) return;
    try {
      window.sessionStorage.removeItem(pendingPaymentStorageKey(currentUser.username));
    } catch {
      // Browser storage can be unavailable in restricted modes.
    }
  }

  function openCustomer(account) {
    setPaymentReview(null);
    setPaymentRecoveryMessage('');
    setPaymentRecoveryStatus('');
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

  function openUnavailableMessage(account) {
    if (!customerSmsDestination(account.customer)) {
      showError('This customer has no saved mobile number.');
      return;
    }
    setMessageCustomer(account);
  }

  async function sendUnavailableMessage() {
    if (!messageCustomer) return;
    const customerId = messageCustomer.customerId;
    setBusy(`message-${customerId}`);
    try {
      const result = await request(`/collector/customers/${customerId}/unavailable-message`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      setMessageSent({
        customerName: customerName(messageCustomer.customer),
        destination: result.destination,
        senderId: result.senderId
      });
      setMessageCustomer(null);
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
    openPaymentReview('');
  }

  function openPaymentReview(excessDecision) {
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
    if (payment.method === 'GCASH' && !payment.referenceNumber.trim()) {
      showError('Enter the GCash transaction reference.');
      return;
    }
    setExcessPrompt(false);
    setPaymentRecoveryMessage('');
    setPaymentRecoveryStatus('');
    setPaymentReview({
      idempotencyKey: payment.idempotencyKey,
      customerName: customerName(selectedCustomer.customer),
      accountNumber: selectedCustomer.customer?.accountNumber || '',
      balanceBefore: Number(selectedCustomer.outstandingBalance || 0),
      breakdown,
      payload: {
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
      }
    });
  }

  async function completePostedPayment(result) {
    clearPendingPaymentAttempt();
    setSelectedReceipt(result);
    setSelectedCustomer(null);
    setPayment(null);
    setPaymentReview(null);
    setPaymentRecoveryMessage('');
    setPaymentRecoveryStatus('');
    showNotice(`Payment posted as ${result.receiptNumber}.`);
    await load({ preserveSelection: false });
  }

  async function checkPaymentStatus(attempt) {
    if (!attempt) return 'UNCONFIRMED';
    setPaymentRecoveryMessage('Checking whether this payment was recorded. Do not collect again.');
    setBusy('payment-check');
    try {
      const result = await requestWithTimeout(
        `/collector/collections/by-idempotency-key/${encodeURIComponent(attempt.idempotencyKey)}`,
        {},
        PAYMENT_LOOKUP_TIMEOUT_MS
      );
      if (result.status === 'POSTED' && result.collection?.receiptNumber) {
        await completePostedPayment(result.collection);
        return 'POSTED';
      }
      if (result.status === 'UNCONFIRMED' && (attempt.needsOffice || paymentRecoveryStatus === 'NEEDS_OFFICE')) {
        setPaymentRecoveryStatus('NEEDS_OFFICE');
        setPaymentRecoveryMessage('This payment was rejected and no Collector receipt is confirmed. Contact the office before taking another payment.');
        return 'UNCONFIRMED';
      }
      setPaymentRecoveryStatus(result.status || 'UNCONFIRMED');
      if (result.status === 'VOID') clearPendingPaymentAttempt();
      setPaymentRecoveryMessage(result.status === 'VOID'
        ? 'This receipt was voided. Contact Finance before taking another payment.'
        : 'Payment is not confirmed yet. Check again or retry this same payment. Do not take a second payment.');
      return result.status || 'UNCONFIRMED';
    } catch (err) {
      const needsOffice = attempt.needsOffice || paymentRecoveryStatus === 'NEEDS_OFFICE';
      setPaymentRecoveryStatus(needsOffice ? 'NEEDS_OFFICE' : 'UNREACHABLE');
      setPaymentRecoveryMessage(needsOffice
        ? 'The connection is unavailable. Contact the office to verify this attempt before taking another payment.'
        : 'The connection is unavailable. Keep this payment open and check again when connected. Do not take a second payment.');
      return 'UNREACHABLE';
    } finally {
      setBusy('');
    }
  }

  async function postPayment(attempt) {
    if (!attempt || paymentPostingRef.current || busy || ['VOID', 'NEEDS_OFFICE'].includes(paymentRecoveryStatus)) return;
    paymentPostingRef.current = true;
    setPaymentRecoveryMessage('');
    setPaymentRecoveryStatus('');
    savePendingPaymentAttempt(attempt);
    setBusy('payment');
    try {
      const result = await requestWithTimeout('/collector/collections', {
        method: 'POST',
        headers: { 'Idempotency-Key': attempt.idempotencyKey },
        body: JSON.stringify(attempt.payload)
      }, PAYMENT_POST_TIMEOUT_MS);
      if (result?.status === 'VOID') {
        clearPendingPaymentAttempt();
        setPaymentRecoveryStatus('VOID');
        setPaymentRecoveryMessage('This receipt was voided. Contact Finance before taking another payment.');
        return;
      }
      if (result?.status !== 'POSTED' || !result?.receiptNumber) throw new Error('Payment response was incomplete');
      await completePostedPayment(result);
    } catch (err) {
      if (err.status && err.status < 500 && err.status !== 409) {
        clearPendingPaymentAttempt();
        setPaymentReview(null);
        setPayment((current) => current ? { ...current, idempotencyKey: createIdempotencyKey() } : current);
        showError(err.message);
      } else {
        const status = await checkPaymentStatus(attempt);
        if (err.status === 409 && status === 'UNCONFIRMED') {
          savePendingPaymentAttempt({ ...attempt, needsOffice: true });
          setPaymentRecoveryStatus('NEEDS_OFFICE');
          setPaymentRecoveryMessage(`${err.message}. The receipt could not be confirmed. Contact the office before taking another payment.`);
        }
      }
    } finally {
      paymentPostingRef.current = false;
      setBusy('');
    }
  }

  async function closePaymentEntry() {
    if (busy === 'payment' || busy === 'close-payment') return;
    const claimId = selectedCustomer?.claim?.id;
    const customerId = selectedCustomer?.customerId;
    const shouldRelease = Boolean(claimId && activeClaimMine);
    setExcessPrompt(false);
    setPaymentReview(null);
    setPaymentRecoveryMessage('');
    setPaymentRecoveryStatus('');
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
      printWindow.document.write(receiptDocument(result.collection));
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

  function reversalDraft(collection) {
    return reversalDrafts[collection.id] || { disposition: '', note: '', referenceNumber: '' };
  }

  function updateReversalDraft(collection, key, value) {
    setReversalDrafts((current) => ({
      ...current,
      [collection.id]: { ...reversalDraft(collection), [key]: value }
    }));
  }

  async function resolveReversal(collection) {
    const draft = reversalDraft(collection);
    setBusy(`reversal-${collection.id}`);
    try {
      await request(`/collector/finance/reversed-collections/${collection.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify(draft)
      });
      showNotice(`${collection.receiptNumber} custody review recorded.`);
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
                onMessage={openUnavailableMessage}
                collecting={busy === `collect-${account.customerId}`}
                messaging={busy === `message-${account.customerId}`}
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
          <div className="collector-section-heading"><div><h3>Finance reconciliation</h3><p>Review the included customer payments, count physical cash, and verify company GCash transfers.</p></div></div>
          {(finance.pendingReversals || []).length > 0 && (
            <div className="collector-reversal-review">
              <div className="collector-section-heading">
                <div>
                  <h3>Reversed receipts to review</h3>
                  <p>{finance.metrics?.pendingReversals || 0} receipt(s) · {money(finance.metrics?.pendingReversalAmount)} removed from remittance totals. Record what happened to the funds.</p>
                </div>
              </div>
              <div className="collector-finance-list">
                {(finance.pendingReversals || []).map((collection) => {
                  const draft = reversalDraft(collection);
                  return (
                    <article className="card collector-reversal-card" key={collection.id}>
                      <div className="card-body">
                        <div className="collector-card-top">
                          <div>
                            <h3>{collection.receiptNumber} · {money(collection.amount)}</h3>
                            <span>{collection.customerName || 'Customer'} · {collection.collectorName} · {collection.method}</span>
                          </div>
                          <StatusChip value="VOID" />
                        </div>
                        <p className="text-muted small mt-2">Voided {dateTimeLabel(collection.voidedAt)} · {collection.voidReason || 'No reason recorded'}</p>
                        <div className="collector-reversal-fields">
                          <label>
                            <span>Funds disposition</span>
                            <select className="form-select" value={draft.disposition} onChange={(event) => updateReversalDraft(collection, 'disposition', event.target.value)}>
                              <option value="">Choose disposition</option>
                              <option value="REFUNDED_TO_CUSTOMER">Refunded to customer</option>
                              <option value="DUPLICATE_ENTRY_NO_FUNDS">Duplicate entry; no funds received</option>
                              <option value="OTHER_ACCOUNTED">Other accounted disposition</option>
                            </select>
                          </label>
                          <label>
                            <span>Reference (required for GCash refund)</span>
                            <input className="form-control" value={draft.referenceNumber} onChange={(event) => updateReversalDraft(collection, 'referenceNumber', event.target.value)} />
                          </label>
                          <label className="collector-reversal-note">
                            <span>Finance note</span>
                            <textarea className="form-control" rows={2} value={draft.note} onChange={(event) => updateReversalDraft(collection, 'note', event.target.value)} />
                          </label>
                        </div>
                        <button className="btn btn-primary mt-2" type="button" disabled={busy === `reversal-${collection.id}` || !draft.disposition || draft.note.trim().length < 3} onClick={() => resolveReversal(collection)}>
                          {busy === `reversal-${collection.id}` ? 'Saving...' : 'Record custody review'}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}
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

      {messageCustomer && (
        <div className="collector-modal-backdrop" role="presentation">
          <section className="collector-message-modal" role="dialog" aria-modal="true" aria-label="Send customer unavailable message">
            <header>
              <span className="collector-message-icon"><IconMessage size={23} /></span>
              <div>
                <h3>Customer unavailable</h3>
                <span>{customerName(messageCustomer.customer)}</span>
              </div>
              <button
                type="button"
                aria-label="Close message preview"
                disabled={busy === `message-${messageCustomer.customerId}`}
                onClick={() => setMessageCustomer(null)}
              >
                <IconX size={20} />
              </button>
            </header>
            <div className="collector-message-body">
              <div className="collector-message-recipient">
                <div><small>Send to</small><strong>{customerSmsDestination(messageCustomer.customer)}</strong></div>
                <div><small>Sender ID</small><strong>3J BILL</strong></div>
                <div><small>Current amount due</small><strong>{money(accountPayableToday(messageCustomer))}</strong></div>
              </div>
              <div className="collector-message-preview">
                <small>Message preview</small>
                <p>{unavailableCustomerMessage(messageCustomer)}</p>
              </div>
              <p className="collector-message-note">
                The system checks the customer’s current Billing amount again before sending.
              </p>
              <div className="collector-message-actions">
                <button
                  className="btn btn-outline-secondary"
                  type="button"
                  disabled={busy === `message-${messageCustomer.customerId}`}
                  onClick={() => setMessageCustomer(null)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={busy === `message-${messageCustomer.customerId}`}
                  onClick={sendUnavailableMessage}
                >
                  <IconSend size={18} />
                  {busy === `message-${messageCustomer.customerId}` ? 'Sending…' : 'Send message'}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {messageSent && (
        <div className="collector-modal-backdrop" role="presentation">
          <section className="collector-receipt-modal collector-message-success-modal" role="dialog" aria-modal="true" aria-label="Message sent">
            <header>
              <span className="collector-receipt-success"><IconCheck size={24} /></span>
              <button type="button" aria-label="Close message sent popup" onClick={() => setMessageSent(null)}><IconX size={20} /></button>
            </header>
            <div className="collector-receipt-summary">
              <small>A2P notification</small>
              <h3>Message sent</h3>
              <span>The customer-unavailable notice was sent to {messageSent.customerName}.</span>
              <strong className="collector-message-success-destination">{messageSent.destination}</strong>
              <span>Sender ID: {messageSent.senderId}</span>
            </div>
            <button className="btn btn-primary w-100" type="button" onClick={() => setMessageSent(null)}>Done</button>
          </section>
        </div>
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
            <button className="btn btn-primary" type="button" disabled={busy === 'payment'} onClick={() => openPaymentReview('ADVANCE')}>
              Apply excess as advance
            </button>
            <button
              className="btn btn-outline-secondary"
              type="button"
              disabled={busy === 'payment'}
              onClick={() => (
                paymentBreakdown.appliedAmount > 0 ? openPaymentReview('RETURN') : closePaymentEntry()
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

      {paymentReview && (
        <div className="collector-modal-backdrop collector-review-backdrop" role="presentation">
          <section className="collector-review-modal" role="dialog" aria-modal="true" aria-label={paymentRecoveryMessage ? 'Check payment status' : 'Review payment before posting'}>
            <header>
              <span className="collector-review-icon"><IconShieldCheck size={25} /></span>
              <div>
                <h3>{paymentRecoveryMessage ? 'Check payment status' : 'Review payment'}</h3>
                <span>{paymentReview.customerName} · {paymentReview.accountNumber || 'No account number'}</span>
              </div>
            </header>
            <div className="collector-review-details">
              <div><span>Amount received</span><strong>{money(paymentReview.breakdown.receivedAmount)}</strong></div>
              <div><span>Payment method</span><strong>{paymentReview.payload.method === 'GCASH' ? 'GCash' : 'Cash'}</strong></div>
              {paymentReview.payload.method === 'GCASH' && (
                <div><span>GCash reference</span><strong>{paymentReview.payload.referenceNumber}</strong></div>
              )}
              <div><span>Applied to bills</span><strong>{money(paymentReview.breakdown.appliedAmount)}</strong></div>
              {paymentReview.breakdown.promotionDiscountAmount > 0 && (
                <div><span>Automatic savings</span><strong>{discountMoney(paymentReview.breakdown.promotionDiscountAmount)}</strong></div>
              )}
              {paymentReview.breakdown.advanceAmount > 0 && (
                <div><span>Advance credit</span><strong>{money(paymentReview.breakdown.advanceAmount)}</strong></div>
              )}
              {paymentReview.breakdown.returnedAmount > 0 && (
                <div><span>Return to customer</span><strong>{money(paymentReview.breakdown.returnedAmount)}</strong></div>
              )}
              <div className="collector-review-total"><span>Amount kept for remittance</span><strong>{money(paymentReview.breakdown.amount)}</strong></div>
              <div><span>Expected balance after</span><strong>{money(Math.max(0, paymentReview.balanceBefore - paymentReview.breakdown.appliedAmount - paymentReview.breakdown.promotionDiscountAmount))}</strong></div>
            </div>
            {paymentRecoveryMessage ? (
              <div className="collector-review-recovery" role="alert">
                <IconAlertTriangle size={20} />
                <p>{paymentRecoveryMessage}<small>Attempt reference: {paymentReview.idempotencyKey}</small></p>
              </div>
            ) : (
              <p className="collector-review-note">
                {paymentReview.payload.method === 'GCASH'
                  ? 'Confirm the GCash amount reached your account before posting. Billing will check the balance again.'
                  : 'Confirm you have received the cash and returned any change shown above. Billing will check the balance again.'}
              </p>
            )}
            <div className="collector-review-actions">
              {paymentRecoveryMessage ? (
                <>
                  <button className="btn btn-outline-primary" type="button" disabled={Boolean(busy)} onClick={() => checkPaymentStatus(paymentReview)}>
                    <IconRefresh size={18} /> {busy === 'payment-check' ? 'Checking…' : 'Check status again'}
                  </button>
                  {!['VOID', 'NEEDS_OFFICE'].includes(paymentRecoveryStatus) && (
                    <button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => postPayment(paymentReview)}>
                      <IconShieldCheck size={18} /> Retry same payment safely
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button className="btn btn-outline-secondary" type="button" disabled={Boolean(busy)} onClick={() => setPaymentReview(null)}>Back to edit</button>
                  <button className="btn btn-success" type="button" disabled={Boolean(busy)} onClick={() => postPayment(paymentReview)}>
                    <IconShieldCheck size={18} /> {busy === 'payment' ? 'Posting payment…' : 'Confirm received and post'}
                  </button>
                </>
              )}
            </div>
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
            <button className="btn btn-primary w-100" type="button" disabled={busy === `print-${selectedReceipt.id}` || selectedReceipt.status !== 'POSTED'} onClick={() => printCollection(selectedReceipt)}>
              <IconPrinter size={19} /> {selectedReceipt.printHistory?.length ? 'Print again' : 'Print thermal receipt'}
            </button>
            <button className="btn btn-outline-secondary w-100" type="button" onClick={() => setSelectedReceipt(null)}>Done</button>
          </section>
        </div>
      )}
    </div>
  );
}
