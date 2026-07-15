import React, { useEffect, useMemo, useState } from 'react';
import {
  IconArrowsExchange2,
  IconAlertTriangle,
  IconCash,
  IconCircleCheck,
  IconCreditCard,
  IconFileInvoice,
  IconPackage,
  IconReceipt,
  IconRefresh,
  IconSearch,
  IconShoppingCart,
  IconTrash,
  IconX
} from '@tabler/icons-react';
import './pointOfSale.css';

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
  if (['active', 'open', 'completed', 'paid', 'posted'].includes(normalized)) return 'bg-green-lt text-green';
  if (['issued', 'issue', 'partially_paid', 'unpaid', 'pending'].includes(normalized)) return 'bg-yellow-lt text-yellow';
  if (['closed', 'inactive', 'return', 'returned'].includes(normalized)) return 'bg-blue-lt text-blue';
  if (['overdue', 'void', 'archived', 'cancelled'].includes(normalized)) return 'bg-red-lt text-red';
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

function saleUserLabel(sale) {
  return sale.cashierName || sale.cashierUsername || 'POS user';
}

function invoiceServiceLabel(invoice) {
  return invoice?.serviceId || invoice?.serviceAccountNumber || invoice?.catalogName || invoice?.lineItems?.[0]?.description || 'Billing invoice';
}

function paymentPromotionLabel(promotion) {
  const code = promotion?.promoCode ? `${promotion.promoCode} - ` : '';
  return `${code}${promotion?.name || 'Promotion'} (${currency(promotion?.discountAmountForInvoice)} off)`;
}

function isPayableInvoice(invoice) {
  return Number(invoice?.balance || 0) > 0 && !['PAID', 'VOID', 'DRAFT'].includes(String(invoice?.status || '').toUpperCase());
}

function isInvoiceOverdue(invoice) {
  return isPayableInvoice(invoice) && invoice?.dueDate && invoice.dueDate < today();
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

function invoiceMatchesSearch(invoice, search) {
  return matchesHistorySearch(search, [
    invoice.invoiceNumber,
    invoiceServiceLabel(invoice),
    customerNameOnly(invoice.customer),
    customerLabel(invoice.customer),
    invoice.status,
    invoice.balance,
    invoice.dueDate
  ]);
}

function uniqueOptions(values) {
  return ['ALL', ...Array.from(new Set(values.filter(Boolean)))];
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
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

function TextField({ label, value, onChange, type = 'text', required = false, min, max, step }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <input className="form-control" type={type} value={value ?? ''} min={min} max={max} step={step} required={required} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function SelectField({ label, value, onChange, options = [], required = false, children }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <select className="form-select" value={value ?? ''} required={required} onChange={(e) => onChange(e.target.value)}>
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
  method: 'CASH',
  paymentDate: today(),
  promotionId: '',
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
  const [eligibleBillingPromotions, setEligibleBillingPromotions] = useState([]);
  const [billingSearch, setBillingSearch] = useState('');
  const [selectedBillingInvoiceId, setSelectedBillingInvoiceId] = useState('');
  const [invoicePaymentForm, setInvoicePaymentForm] = useState(blankInvoicePayment);
  const [invoicePaymentIdempotencyKey, setInvoicePaymentIdempotencyKey] = useState(() => newIdempotencyKey('billing-payment'));
  const [itemForm, setItemForm] = useState(blankItem);
  const [saleForm, setSaleForm] = useState(blankSale);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [checkoutNotice, setCheckoutNotice] = useState(null);
  const [showLowStockPanel, setShowLowStockPanel] = useState(false);
  const [salesHistoryTab, setSalesHistoryTab] = useState('Register');
  const [historyControls, setHistoryControls] = useState(historyControlDefaults);

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const officeItemById = useMemo(() => new Map(officeItems.map((item) => [item.id, item])), [officeItems]);
  const cartLines = useMemo(() => saleForm.lineItems.filter((line) => line.itemId || line.description), [saleForm.lineItems]);
  const officeCartLines = useMemo(() => officeCart.filter((line) => line.itemId), [officeCart]);
  const payableBillingInvoices = useMemo(() => billingInvoices.filter(isPayableInvoice), [billingInvoices]);
  const visiblePayableBillingInvoices = useMemo(() => (
    payableBillingInvoices.filter((invoice) => invoiceMatchesSearch(invoice, billingSearch))
  ), [payableBillingInvoices, billingSearch]);
  const selectedBillingInvoice = useMemo(() => billingInvoices.find((invoice) => invoice.id === selectedBillingInvoiceId), [billingInvoices, selectedBillingInvoiceId]);
  const selectedBillingPromotion = useMemo(() => (
    eligibleBillingPromotions.find((promotion) => promotion.id === invoicePaymentForm.promotionId)
  ), [eligibleBillingPromotions, invoicePaymentForm.promotionId]);
  const selectedInvoiceBalance = Number(selectedBillingInvoice?.balance || 0);
  const selectedPromotionDiscount = selectedBillingPromotion ? Number(selectedBillingPromotion.discountAmountForInvoice || 0) : 0;
  const selectedPromotionPayable = selectedBillingPromotion ? Number(selectedBillingPromotion.discountedPayable || 0) : selectedInvoiceBalance;
  const selectedInvoiceRemaining = Math.max(0, selectedInvoiceBalance - selectedPromotionDiscount - Number(invoicePaymentForm.amount || 0));
  const billingPaymentMethods = useMemo(() => (
    billingMeta.paymentMethods?.length ? billingMeta.paymentMethods : (meta.paymentMethods?.length ? meta.paymentMethods : ['CASH'])
  ), [billingMeta.paymentMethods, meta.paymentMethods]);
  const billingPaymentMetrics = useMemo(() => ({
    openInvoices: visiblePayableBillingInvoices.length,
    outstanding: visiblePayableBillingInvoices.reduce((sum, invoice) => sum + Number(invoice.balance || 0), 0),
    overdue: visiblePayableBillingInvoices.filter(isInvoiceOverdue).length,
    collectedToday: billingPayments
      .filter((payment) => payment.status === 'POSTED' && payment.paymentDate === today())
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  }), [visiblePayableBillingInvoices, billingPayments]);
  const registerHistoryRows = useMemo(() => (
    sales.filter((sale) => {
      const control = historyControls.register;
      const statusMatches = control.status === 'ALL' || sale.paymentStatus === control.status || sale.status === control.status;
      return statusMatches && matchesHistorySearch(control.search, [
        sale.receiptNumber,
        sale.saleNumber,
        customerLabel(sale.customer),
        saleUserLabel(sale),
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
        customerNameOnly(payment.customer),
        customerLabel(payment.customer),
        payment.method,
        payment.referenceNumber,
        payment.collectionChannel,
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
  const cartSubtotal = useMemo(() => cartLines.reduce((sum, line) => {
    const amount = Number(line.quantity || 0) * Number(line.unitPrice || 0) - Number(line.discountAmount || 0);
    return sum + Math.max(0, amount);
  }, 0), [cartLines]);
  const cartTotal = Math.max(0, cartSubtotal - Number(saleForm.discountAmount || 0));
  const paymentAmount = Number(saleForm.paymentAmount || 0);
  const paymentShortfall = Math.max(0, cartTotal - paymentAmount);
  const cashChange = Math.max(0, paymentAmount - cartTotal);
  const isCashPayment = String(saleForm.paymentMethod || '').toUpperCase() === 'CASH';

  async function load(search = customerSearch, itemTerm = itemSearch) {
    setError('');
    try {
      const [nextMeta, nextOverview, nextCustomers, nextItems, nextSales] = await Promise.all([
        request('/point-of-sale/meta'),
        request('/point-of-sale/overview'),
        request(`/point-of-sale/customers?search=${encodeURIComponent(search)}`),
        request(`/point-of-sale/items?search=${encodeURIComponent(itemTerm)}`),
        request('/point-of-sale/sales')
      ]);
      setMeta(nextMeta);
      setOverview(nextOverview);
      setCustomers(nextCustomers);
      setItems(nextItems);
      setSales(nextSales);
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

  async function loadEligibleBillingPromotions(invoiceId, paymentDate = today()) {
    if (!invoiceId) {
      setEligibleBillingPromotions([]);
      return { promotions: [], recommendedPromotionId: '' };
    }
    const result = await request(`/billing/invoices/${invoiceId}/eligible-promotions?paymentDate=${encodeURIComponent(paymentDate)}`);
    const rows = result.promotions || [];
    setEligibleBillingPromotions(rows);
    return { promotions: rows, recommendedPromotionId: result.recommendedPromotionId || '' };
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
    setSaleForm(blankSale);
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

  function selectBillingInvoice(invoice) {
    const paymentDate = today();
    setSelectedBillingInvoiceId(invoice.id);
    setInvoicePaymentIdempotencyKey(newIdempotencyKey('billing-payment'));
    setEligibleBillingPromotions([]);
    setInvoicePaymentForm({
      ...blankInvoicePayment,
      invoiceId: invoice.id,
      amount: String(invoice.balance || ''),
      method: invoicePaymentForm.method || 'CASH',
      paymentDate
    });
    setError('');
    loadEligibleBillingPromotions(invoice.id, paymentDate)
      .then(({ promotions: rows, recommendedPromotionId }) => {
        const recommended = rows.find((item) => item.id === recommendedPromotionId) || rows.find((item) => item.autoApply);
        if (!recommended) return;
        setInvoicePaymentForm((form) => (
          form.invoiceId === invoice.id
            ? { ...form, promotionId: recommended.id, amount: String(recommended.discountedPayable || '') }
            : form
        ));
      })
      .catch((err) => setError(err.message));
  }

  function applyBillingPromotion(promotionId, promotionRows = eligibleBillingPromotions) {
    const promotion = promotionRows.find((item) => item.id === promotionId);
    setInvoicePaymentForm((form) => ({
      ...form,
      promotionId,
      amount: promotion ? String(promotion.discountedPayable || '') : String(selectedBillingInvoice?.balance || '')
    }));
  }

  function changeInvoicePaymentDate(paymentDate) {
    setInvoicePaymentForm((form) => ({ ...form, paymentDate }));
    if (!selectedBillingInvoice) return;
    loadEligibleBillingPromotions(selectedBillingInvoice.id, paymentDate)
      .then(({ promotions: rows, recommendedPromotionId }) => {
        setInvoicePaymentForm((form) => {
          const promotion = form.promotionId ? rows.find((item) => item.id === form.promotionId) : null;
          if (!promotion) {
            const recommended = rows.find((item) => item.id === recommendedPromotionId) || rows.find((item) => item.autoApply);
            return recommended
              ? { ...form, promotionId: recommended.id, amount: String(recommended.discountedPayable || '') }
              : { ...form, promotionId: '', amount: String(selectedBillingInvoice.balance || '') };
          }
          return { ...form, amount: String(promotion.discountedPayable || '') };
        });
      })
      .catch((err) => setError(err.message));
  }

  function resetInvoicePayment() {
    setSelectedBillingInvoiceId('');
    setEligibleBillingPromotions([]);
    setInvoicePaymentForm(blankInvoicePayment);
    setInvoicePaymentIdempotencyKey(newIdempotencyKey('billing-payment'));
  }

  async function saveInvoicePayment(e) {
    e.preventDefault();
    if (!selectedBillingInvoice) {
      setError('Select a billing invoice first.');
      return;
    }
    const amount = Number(invoicePaymentForm.amount || 0);
    if (amount <= 0) {
      setError('Payment amount must be greater than zero.');
      return;
    }
    if (selectedBillingPromotion && Number(amount.toFixed(2)) !== Number(selectedPromotionPayable.toFixed(2))) {
      setError(`Payment amount must match the promo payable amount of ${currency(selectedPromotionPayable)}.`);
      return;
    }
    if (amount > Number(selectedBillingInvoice.balance || 0)) {
      setError('Payment amount cannot exceed the invoice balance.');
      return;
    }
    try {
      await request('/billing/payments', {
        method: 'POST',
        headers: { 'Idempotency-Key': invoicePaymentIdempotencyKey },
        body: JSON.stringify({
          invoiceId: selectedBillingInvoice.id,
          amount,
          method: invoicePaymentForm.method,
          paymentDate: invoicePaymentForm.paymentDate,
          referenceNumber: invoicePaymentForm.referenceNumber,
          promotionId: invoicePaymentForm.promotionId || null,
          collectionChannel: 'POS',
          status: 'POSTED',
          notes: invoicePaymentForm.notes || `Posted from POS for ${selectedBillingInvoice.invoiceNumber}`
        })
      });
      setMessage(`Payment posted for ${selectedBillingInvoice.invoiceNumber}.`);
      resetInvoicePayment();
      await Promise.all([loadBillingPayments(billingSearch), load(customerSearch, itemSearch)]);
      refreshShell();
    } catch (err) {
      setError(err.message);
    }
  }

  async function voidBillingPayment(payment) {
    if (!window.confirm(`Void receipt ${payment.receiptNumber}?`)) return;
    try {
      await request(`/billing/payments/${payment.id}`, { method: 'DELETE' });
      setMessage(`Receipt ${payment.receiptNumber} voided.`);
      await loadBillingPayments(billingSearch);
      refreshShell();
    } catch (err) {
      setError(err.message);
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
        amount: paymentAmount,
        method: saleForm.paymentMethod,
        paymentDate: saleForm.saleDate,
        referenceNumber: saleForm.paymentReference,
        status: 'POSTED'
      }] : []
    };
  }

  async function saveSale(e) {
    e?.preventDefault?.();
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
    setError('');
    setCheckoutNotice(null);
    let postedSale;
    try {
      postedSale = await request(saleForm.id ? `/point-of-sale/sales/${saleForm.id}` : '/point-of-sale/sales', {
        method: saleForm.id ? 'PATCH' : 'POST',
        body: JSON.stringify(salePayload())
      });
    } catch (err) {
      showCheckoutFailure(err.message || 'Checkout failed. No sale was posted.');
      return;
    }
    const receiptNumber = postedSale.receiptNumber || postedSale.saleNumber || 'receipt';
    const successMessage = saleForm.id ? 'Sale saved.' : 'Sale posted.';
    setMessage(successMessage);
    setCheckoutNotice({
      type: 'success',
      title: 'Checkout completed',
      message: `${receiptNumber} was posted successfully.`,
      detail: `${currency(postedSale.total || cartTotal)} collected by ${labelize(saleForm.paymentMethod)}.`
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
                  disabled={item.stockTracked && Number(item.stockOnHand || 0) <= 0}
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
                <div className="col-md-6"><TextField label="Sale Date" type="date" value={saleForm.saleDate} onChange={(value) => setSaleForm({ ...saleForm, saleDate: value })} /></div>
                <div className="col-12">
                  <div className="d-flex gap-2">
                    <select
                      className="form-select"
                      value={saleForm.customerId}
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
                        placeholder="Search customers"
                      />
                      {customerSearchResults()}
                    </div>
                    <button type="button" className="btn" onClick={() => { setCustomerSearchOpen(true); loadCustomers(customerSearch); }}><IconSearch size={16} /></button>
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
                          <input className="form-control pos-qty" type="number" min="0.01" step="0.01" value={line.quantity} onChange={(e) => setSaleLine(originalIndex, { quantity: e.target.value })} />
                          <input className="form-control pos-price" type="number" min="0" step="0.01" value={line.unitPrice} onChange={(e) => setSaleLine(originalIndex, { unitPrice: e.target.value })} />
                          <input className="form-control pos-serial" value={line.serialNumber || ''} placeholder={cartItem?.trackingType === 'SERIALIZED' ? 'Serial required' : 'Serial'} onChange={(e) => setSaleLine(originalIndex, { serialNumber: e.target.value })} />
                          <button type="button" className="btn btn-icon" onClick={() => removeSaleLine(originalIndex)}><IconTrash size={16} /></button>
                        </div>
                      );
                    })}
                    {!cartLines.length && <div className="empty">Add items from the checkout menu.</div>}
                  </div>
                </div>
                <div className="col-md-4"><TextField label="Discount" type="number" min="0" step="0.01" value={saleForm.discountAmount} onChange={(value) => setSaleForm({ ...saleForm, discountAmount: value })} /></div>
                <div className="col-md-4"><TextField label="Payment" type="number" min="0.01" step="0.01" required value={saleForm.paymentAmount} onChange={(value) => setSaleForm({ ...saleForm, paymentAmount: value })} /></div>
                <div className="col-md-4"><SelectField label="Method" value={saleForm.paymentMethod} options={meta.paymentMethods} onChange={(value) => setSaleForm({ ...saleForm, paymentMethod: value })} /></div>
                <div className="col-12"><TextField label="Reference" value={saleForm.paymentReference} onChange={(value) => setSaleForm({ ...saleForm, paymentReference: value })} /></div>
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
                      <span>{isCashPayment ? 'Change' : 'Remaining due'}</span>
                      <strong className={paymentShortfall > 0 ? 'text-danger' : 'text-green'}>
                        {currency(isCashPayment ? cashChange : paymentShortfall)}
                      </strong>
                    </div>
                  </div>
                </div>
                <div className="col-12 d-flex justify-content-between gap-2">
                  <button type="button" className="btn" onClick={resetSale}>Clear</button>
                  <button type="button" className="btn btn-primary" onClick={saveSale}><IconReceipt size={18} className="me-2" />Complete Checkout</button>
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
                  <strong>{billingPaymentMetrics.openInvoices}</strong>
                  <span>Open invoices</span>
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
                    <input className="form-control form-control-sm" value={billingSearch} onChange={(e) => setBillingSearch(e.target.value)} placeholder="Search invoice, customer, or service" />
                    <button className="btn btn-sm"><IconSearch size={16} /></button>
                  </form>
                }
              >
                <div className="table-responsive">
                  <table className="table card-table table-vcenter pos-invoice-table">
                    <thead><tr><th>Invoice</th><th>Customer</th><th>Due</th><th>Balance</th><th>Status</th><th /></tr></thead>
                    <tbody>
                      {visiblePayableBillingInvoices.map((invoice) => (
                        <tr key={invoice.id} className={selectedBillingInvoiceId === invoice.id ? 'is-selected' : ''}>
                          <td>
                            <strong>{invoice.invoiceNumber}</strong>
                            <div className="text-muted small">{invoiceServiceLabel(invoice)}</div>
                          </td>
                          <td>{customerNameOnly(invoice.customer)}</td>
                          <td className={isInvoiceOverdue(invoice) ? 'text-danger' : ''}>{invoice.dueDate}</td>
                          <td>{currency(invoice.balance)}</td>
                          <td><span className={`badge ${statusClass(invoice.status)}`}>{invoice.status?.replaceAll('_', ' ')}</span></td>
                          <td className="text-end">
                            <button type="button" className="btn btn-sm btn-primary" onClick={() => selectBillingInvoice(invoice)}>Take Payment</button>
                          </td>
                        </tr>
                      ))}
                      {!visiblePayableBillingInvoices.length && <tr><td colSpan="6" className="text-muted">No payable invoices.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card title="Payment Desk" icon={IconCreditCard}>
                {selectedBillingInvoice ? (
                  <form onSubmit={saveInvoicePayment}>
                    <div className="pos-payment-summary">
                      <div>
                        <span>Invoice</span>
                        <strong>{selectedBillingInvoice.invoiceNumber}</strong>
                      </div>
                      <div>
                        <span>Customer</span>
                        <strong>{customerNameOnly(selectedBillingInvoice.customer)}</strong>
                      </div>
                      <div>
                        <span>Service</span>
                        <strong>{invoiceServiceLabel(selectedBillingInvoice)}</strong>
                      </div>
                      <div>
                        <span>Balance</span>
                        <strong>{currency(selectedBillingInvoice.balance)}</strong>
                      </div>
                    </div>
                    <div className="row g-3 mt-1">
                      <div className="col-md-6"><TextField label="Payment Date" type="date" value={invoicePaymentForm.paymentDate} required onChange={changeInvoicePaymentDate} /></div>
                      <div className="col-md-6"><SelectField label="Method" value={invoicePaymentForm.method} options={billingPaymentMethods} onChange={(method) => setInvoicePaymentForm({ ...invoicePaymentForm, method })} /></div>
                      <div className="col-md-6">
                        <SelectField label="Promotion" value={invoicePaymentForm.promotionId} onChange={applyBillingPromotion}>
                          <option value="">No promotion</option>
                          {eligibleBillingPromotions.map((promotion) => (
                            <option key={promotion.id} value={promotion.id}>{paymentPromotionLabel(promotion)}</option>
                          ))}
                        </SelectField>
                      </div>
                      <div className="col-md-6"><TextField label={selectedBillingPromotion ? 'Amount to Collect' : 'Amount'} type="number" min="0.01" max={selectedPromotionPayable || selectedBillingInvoice.balance} step="0.01" value={invoicePaymentForm.amount} required onChange={(amount) => setInvoicePaymentForm({ ...invoicePaymentForm, amount })} /></div>
                      <div className="col-md-6"><TextField label="Reference" value={invoicePaymentForm.referenceNumber} onChange={(referenceNumber) => setInvoicePaymentForm({ ...invoicePaymentForm, referenceNumber })} /></div>
                      {selectedBillingPromotion && (
                        <div className="col-12">
                          <div className="pos-promo-note">
                            <strong>{selectedBillingPromotion.name}</strong>
                            <span>{currency(selectedPromotionDiscount)} discount applied to this payment.</span>
                          </div>
                        </div>
                      )}
                      <div className="col-12">
                        <label className="form-label">Notes</label>
                        <textarea className="form-control" rows="3" value={invoicePaymentForm.notes} onChange={(e) => setInvoicePaymentForm({ ...invoicePaymentForm, notes: e.target.value })} />
                      </div>
                      <div className="col-12">
                        <div className="pos-total-panel pos-payment-totals">
                          <div>
                            <span>Invoice balance</span>
                            <strong>{currency(selectedInvoiceBalance)}</strong>
                          </div>
                          {selectedBillingPromotion && (
                            <div>
                              <span>Promo discount</span>
                              <strong>-{currency(selectedPromotionDiscount)}</strong>
                            </div>
                          )}
                          <div>
                            <span>Remaining after payment</span>
                            <strong>{currency(selectedInvoiceRemaining)}</strong>
                          </div>
                        </div>
                      </div>
                      <div className="col-12 d-flex justify-content-between gap-2">
                        <button type="button" className="btn" onClick={resetInvoicePayment}>Clear</button>
                        <button className="btn btn-primary"><IconCreditCard size={18} className="me-2" />Post Invoice Payment</button>
                      </div>
                    </div>
                  </form>
                ) : (
                  <div className="empty">Select an invoice from the queue.</div>
                )}
              </Card>
            </div>
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
                      <thead><tr><th>Receipt</th><th>Customer</th><th>User</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th /></tr></thead>
                      <tbody>
                        {registerHistory.rows.map((sale) => (
                          <tr key={sale.id}>
                            <td>{sale.receiptNumber}</td><td>{customerLabel(sale.customer)}</td><td>{saleUserLabel(sale)}</td><td>{currency(sale.total)}</td><td>{currency(sale.paidTotal)}</td><td>{currency(sale.balance)}</td>
                            <td><span className={`badge ${statusClass(sale.paymentStatus)}`}>{sale.paymentStatus?.replaceAll('_', ' ')}</span></td>
                            <td className="text-end">
                              <button className="btn btn-sm text-danger" onClick={() => voidSale(sale)}>Void</button>
                            </td>
                          </tr>
                        ))}
                        {!registerHistory.rows.length && <tr><td colSpan="8" className="text-muted">No matching register sales.</td></tr>}
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
                      <thead><tr><th>Receipt</th><th>Customer</th><th>Invoice</th><th>Method</th><th>Channel</th><th>Amount</th><th>User</th><th>Status</th><th /></tr></thead>
                      <tbody>
                        {invoicePaymentHistory.rows.map((payment) => (
                          <tr key={payment.id}>
                            <td>{payment.receiptNumber}</td>
                            <td>{customerNameOnly(payment.customer)}</td>
                            <td>{payment.invoiceNumber || '-'}</td>
                            <td>{labelize(payment.method)}</td>
                            <td>{labelize(payment.collectionChannel || 'Billing')}</td>
                            <td>{currency(payment.amount)}</td>
                            <td>{payment.postedByName || payment.postedByUsername || '-'}</td>
                            <td><span className={`badge ${statusClass(payment.status)}`}>{labelize(payment.status)}</span></td>
                            <td className="text-end">
                              {payment.status === 'POSTED' && (
                                <button type="button" className="btn btn-sm text-danger" onClick={() => voidBillingPayment(payment)}>Void</button>
                              )}
                            </td>
                          </tr>
                        ))}
                        {!invoicePaymentHistory.rows.length && <tr><td colSpan="9" className="text-muted">No matching invoice payment receipts.</td></tr>}
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

    </div>
  );
}
