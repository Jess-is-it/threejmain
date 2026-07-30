export const CUSTOMER_360_TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'subscriptions', label: 'Subscriptions' },
  { value: 'billing', label: 'Billing' },
  { value: 'payments', label: 'Payments' },
  { value: 'tickets', label: 'Tickets' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'activity', label: 'Activity' }
];

export const CUSTOMER_360_ENDPOINTS = {
  customer: '/api/customer-profiling/customers/{customerId}',
  serviceAccounts: '/api/service/accounts?customerId={customerId}',
  serviceOrders: '/api/service/orders?customerId={customerId}',
  billingSubscriptions: '/api/billing/subscriptions?customerId={customerId}',
  billingBalance: '/api/billing/customers/{customerId}/balance',
  billingInvoices: '/api/billing/invoices?customerId={customerId}',
  billingPayments: '/api/billing/payments?customerId={customerId}',
  billingAdjustments: '/api/billing/adjustments?customerId={customerId}',
  pointOfSaleSales: '/api/point-of-sale/sales',
  ticketingTickets: '/api/ticketing/tickets?customerId={customerId}',
  inventoryAssignments: '/api/inventory/assignments',
  auditLogs: '/api/logs'
};

const CLOSED_INVOICE_STATUSES = new Set(['PAID', 'VOID', 'DRAFT']);

export function emptyCustomer360Data() {
  return {
    serviceAccounts: [],
    serviceOrders: [],
    subscriptions: [],
    balance: null,
    invoices: [],
    openInvoices: [],
    overdueInvoices: [],
    payments: [],
    posSales: [],
    adjustments: [],
    tickets: [],
    equipment: [],
    activity: []
  };
}

export function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeStatus(value) {
  return String(value || '').trim().toUpperCase();
}

export function byRecentDate(left, right) {
  const leftDate = Date.parse(left.updatedAt || left.createdAt || left.paymentDate || left.issueDate || left.openedAt || left.created_at || '');
  const rightDate = Date.parse(right.updatedAt || right.createdAt || right.paymentDate || right.issueDate || right.openedAt || right.created_at || '');
  return (Number.isFinite(rightDate) ? rightDate : 0) - (Number.isFinite(leftDate) ? leftDate : 0);
}

export function isOpenInvoice(invoice) {
  const status = normalizeStatus(invoice?.status);
  if (CLOSED_INVOICE_STATUSES.has(status)) return false;
  const balance = Number(invoice?.balance);
  return Number.isFinite(balance) ? balance > 0 : true;
}

export function isOverdueInvoice(invoice) {
  return normalizeStatus(invoice?.status) === 'OVERDUE';
}

export function filterCustomerEquipment(assignments, customerId) {
  const id = String(customerId || '').trim();
  if (!id) return [];
  return normalizeArray(assignments)
    .filter((assignment) => String(assignment?.customerId || '').trim() === id)
    .sort(byRecentDate);
}

export function filterCustomerPosSales(sales, customerId) {
  const id = String(customerId || '').trim();
  if (!id) return [];
  return normalizeArray(sales)
    .filter((sale) => String(sale?.customerId || '').trim() === id)
    .sort(byRecentDate);
}

export function filterCustomerActivity(logs, customer = {}) {
  const customerId = String(customer.id || '').trim();
  const accountNumber = String(customer.accountNumber || '').trim();
  if (!customerId && !accountNumber) return [];
  return normalizeArray(logs)
    .filter((event) => {
      const details = event?.details || {};
      return String(event?.target_id || event?.targetId || '').trim() === customerId
        || String(details.customerId || '').trim() === customerId
        || (accountNumber && String(details.accountNumber || '').trim() === accountNumber);
    })
    .sort(byRecentDate);
}

export function buildCustomer360Data(customer, sources = {}) {
  const invoices = normalizeArray(sources.invoices).sort(byRecentDate);
  return {
    serviceAccounts: normalizeArray(sources.serviceAccounts).sort(byRecentDate),
    serviceOrders: normalizeArray(sources.serviceOrders).sort(byRecentDate),
    subscriptions: normalizeArray(sources.subscriptions).sort(byRecentDate),
    balance: sources.balance && typeof sources.balance === 'object' ? sources.balance : null,
    invoices,
    openInvoices: invoices.filter(isOpenInvoice),
    overdueInvoices: invoices.filter(isOverdueInvoice),
    payments: normalizeArray(sources.payments).sort(byRecentDate),
    posSales: filterCustomerPosSales(sources.posSales, customer?.id),
    adjustments: normalizeArray(sources.adjustments).sort(byRecentDate),
    tickets: normalizeArray(sources.tickets).sort(byRecentDate),
    equipment: filterCustomerEquipment(sources.inventoryAssignments, customer?.id),
    activity: filterCustomerActivity(sources.auditLogs, customer)
  };
}

export function customer360SectionState({ loading = false, error = null, items = [], fallback = null } = {}) {
  if (loading) return 'loading';
  if (error?.status === 401 || error?.status === 403) return 'permission-denied';
  if (error) return 'error';
  const rows = Array.isArray(items) ? items : fallback;
  if (Array.isArray(rows) && rows.length === 0) return 'empty';
  if (!Array.isArray(rows) && !rows) return 'empty';
  return 'ready';
}

export function hasCustomer360TabData(data, tab) {
  if (!data) return false;
  if (tab === 'overview') return true;
  if (tab === 'subscriptions') return data.subscriptions.length > 0 || data.serviceAccounts.length > 0;
  if (tab === 'billing') return data.invoices.length > 0 || data.adjustments.length > 0 || Boolean(data.balance);
  if (tab === 'payments') return data.payments.length > 0 || data.posSales.length > 0;
  if (tab === 'tickets') return data.tickets.length > 0;
  if (tab === 'equipment') return data.equipment.length > 0;
  if (tab === 'activity') return data.activity.length > 0;
  return false;
}
