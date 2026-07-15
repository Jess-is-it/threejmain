import React, { useEffect, useMemo, useState } from 'react';
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconDeviceFloppy,
  IconEdit,
  IconEye,
  IconFilter,
  IconListDetails,
  IconMapPin,
  IconMinus,
  IconPackage,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTicket,
  IconTrash,
  IconUsers,
  IconWifi,
  IconX
} from '@tabler/icons-react';
import CustomerEmotionAvatar from '../../system-settings/web/CustomerEmotionAvatar';
import './service.css';

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

function money(value) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value || 0));
}

function label(value) {
  return String(value || '').replaceAll('_', ' ');
}

function titleLabel(value) {
  return label(value).toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusClass(value) {
  const normalized = String(value || '').toLowerCase();
  if (['completed', 'approved', 'active'].includes(normalized)) return 'bg-green-lt text-green';
  if (['submitted', 'pending_requirement', 'pending_review', 'in_progress', 'requested', 'scheduled', 'installing', 'draft', 'pending_installation', 'pending_disconnection', 'pending_reconnection'].includes(normalized)) return 'bg-yellow-lt text-yellow';
  if (['cancelled', 'rejected', 'retired'].includes(normalized)) return 'bg-red-lt text-red';
  if (['on_hold'].includes(normalized)) return 'bg-orange-lt text-orange';
  return 'bg-blue-lt text-blue';
}

const OPEN_ORDER_STATUSES = ['SUBMITTED', 'PENDING_REQUIREMENT', 'PENDING_REVIEW', 'APPROVED', 'IN_PROGRESS', 'ON_HOLD'];
const DETAIL_REQUIRED_STATUSES = ['SUBMITTED', 'PENDING_REVIEW', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD'];
const CREATED_ORDER_STATUS = 'SUBMITTED';
const NON_CANCELABLE_ORDER_STATUSES = ['COMPLETED', 'RESOLVED', 'CANCELLED', 'REJECTED'];
const NON_CANCELABLE_TICKET_STATUSES = ['RESOLVED', 'CLOSED', 'CANCELLED'];
const SERVICE_PAGE_SIZE_OPTIONS = ['10', '25', '50', 'ALL'];
const INTERNET_CATALOG_TYPES = ['FIBER_INTERNET', 'WIRELESS_INTERNET', 'DEDICATED_INTERNET'];
const ADD_ON_CATALOG_TYPES = ['STATIC_IP', 'OTHER'];
const CATALOG_SELECTION_ORDER_TYPES = ['NEW_INSTALLATION', 'PLAN_UPGRADE', 'PLAN_DOWNGRADE', 'ADD_ON_SERVICE'];
const INSTALL_ADDRESS_ORDER_TYPES = ['NEW_INSTALLATION'];
const SERVICE_ORDER_TICKET_CATEGORY_BY_TYPE = {
  NEW_INSTALLATION: 'INSTALLATION',
  PLAN_UPGRADE: 'INSTALLATION',
  PLAN_DOWNGRADE: 'INSTALLATION',
  RELOCATION: 'INSTALLATION',
  RECONNECTION: 'INSTALLATION',
  ADD_ON_SERVICE: 'INSTALLATION',
  EQUIPMENT_REPLACEMENT: 'EQUIPMENT',
  TEMPORARY_SUSPENSION: 'GENERAL',
  DISCONNECTION: 'GENERAL',
  CHANGE_OWNERSHIP: 'GENERAL'
};
const ORDER_CREATION_STAGE_DEFS = {
  customer: {
    id: 'customer',
    title: 'Customer',
    description: 'Search and select the customer requesting service.'
  },
  type: {
    id: 'type',
    title: 'Order Type',
    description: 'Choose the service request and target service account.'
  },
  order: {
    id: 'order',
    title: 'Order',
    description: 'Set request dates, priority, service address, and notes.'
  },
  catalog: {
    id: 'catalog',
    title: 'Service Catalog',
    description: 'Choose the plan or add-on this request will use.'
  },
  ticket: {
    id: 'ticket',
    title: 'Ticket',
    description: 'Confirm the operations ticket that will be created with this service order.'
  },
  review: {
    id: 'review',
    title: 'Review',
    description: 'Review the service order details and confirm before saving.'
  }
};
const ORDER_DETAIL_SCHEMAS = {
  NEW_INSTALLATION: [],
  PLAN_UPGRADE: [
    { name: 'currentPlan', label: 'Current Plan', type: 'text', required: true, readOnly: true },
    { name: 'effectiveDate', label: 'Effective Date', type: 'date', required: true },
    { name: 'priceDifference', label: 'Price Difference', type: 'money', required: true, readOnly: true },
    { name: 'approvalReference', label: 'Approval Reference', type: 'text' }
  ],
  PLAN_DOWNGRADE: [
    { name: 'currentPlan', label: 'Current Plan', type: 'text', required: true, readOnly: true },
    { name: 'effectiveDate', label: 'Effective Date', type: 'date', required: true },
    { name: 'priceDifference', label: 'Price Difference', type: 'money', required: true, readOnly: true },
    { name: 'downgradeReason', label: 'Downgrade Reason', type: 'text', required: true }
  ],
  RELOCATION: [
    { name: 'currentServiceAddress', label: 'Current Service Address', type: 'text', required: true, readOnly: true },
    { name: 'newServiceAddress', label: 'New Service Address', type: 'text', required: true },
    { name: 'targetTransferDate', label: 'Target Transfer Date', type: 'date', required: true },
    { name: 'coverageCheckRequired', label: 'Coverage Check Required', type: 'boolean' }
  ],
  TEMPORARY_SUSPENSION: [
    { name: 'suspensionStartDate', label: 'Suspension Start Date', type: 'date', required: true },
    { name: 'suspensionEndDate', label: 'Suspension End Date', type: 'date' },
    { name: 'suspensionReason', label: 'Suspension Reason', type: 'text', required: true }
  ],
  RECONNECTION: [
    { name: 'reconnectionDate', label: 'Reconnection Date', type: 'date', required: true },
    { name: 'outstandingBalance', label: 'Outstanding Balance', type: 'money', required: true },
    { name: 'paymentReference', label: 'Payment Reference', type: 'text' }
  ],
  DISCONNECTION: [
    { name: 'disconnectionReason', label: 'Disconnection Reason', type: 'text', required: true },
    { name: 'outstandingBalance', label: 'Outstanding Balance', type: 'money', required: true },
    { name: 'disconnectionType', label: 'Disconnection Type', type: 'text', required: true },
    { name: 'targetDisconnectionDate', label: 'Target Disconnection Date', type: 'date', required: true },
    { name: 'equipmentRetrievalRequired', label: 'Equipment Retrieval Required', type: 'boolean' }
  ],
  CHANGE_OWNERSHIP: [
    { name: 'newOwnerCustomerId', label: 'New Owner', type: 'customer', required: true },
    { name: 'newOwnerName', label: 'New Owner Name', type: 'text', required: true, readOnly: true },
    { name: 'newOwnerAccountNumber', label: 'New Owner Account No.', type: 'text', readOnly: true },
    { name: 'newOwnerContact', label: 'New Owner Contact', type: 'text', readOnly: true },
    { name: 'transferReason', label: 'Transfer Reason', type: 'text', required: true },
    { name: 'effectiveDate', label: 'Effective Date', type: 'date', required: true },
    { name: 'approvalReference', label: 'Approval Reference', type: 'text' }
  ],
  ADD_ON_SERVICE: [
    { name: 'addOnName', label: 'Add-on Service', type: 'text', required: true, readOnly: true },
    { name: 'monthlyCharge', label: 'Monthly Charge', type: 'money', required: true, readOnly: true },
    { name: 'effectiveDate', label: 'Effective Date', type: 'date', required: true },
    { name: 'provisioningNotes', label: 'Provisioning Notes', type: 'text' }
  ],
  EQUIPMENT_REPLACEMENT: [
    { name: 'equipmentType', label: 'Equipment Type', type: 'text', required: true },
    { name: 'replacementReason', label: 'Replacement Reason', type: 'text', required: true },
    { name: 'targetReplacementDate', label: 'Target Replacement Date', type: 'date', required: true },
    { name: 'technicianRequired', label: 'Technician Required', type: 'boolean' }
  ]
};

const ORDER_TYPE_PRESENTATION = {
  NEW_INSTALLATION: {
    icon: IconWifi,
    description: 'Apply for a new internet service line.'
  },
  PLAN_UPGRADE: {
    icon: IconPlus,
    description: 'Move an existing service account to a higher-speed plan.'
  },
  PLAN_DOWNGRADE: {
    icon: IconMinus,
    description: 'Move an existing service account to a lower-speed plan.'
  },
  RELOCATION: {
    icon: IconMapPin,
    description: 'Transfer an existing service account to another address.'
  },
  TEMPORARY_SUSPENSION: {
    icon: IconListDetails,
    description: 'Pause an active service account for a requested period.'
  },
  RECONNECTION: {
    icon: IconRefresh,
    description: 'Restore a suspended or disconnected service account.'
  },
  DISCONNECTION: {
    icon: IconX,
    description: 'Terminate or remove an existing service account.'
  },
  CHANGE_OWNERSHIP: {
    icon: IconUsers,
    description: 'Transfer a service account to another customer owner.'
  },
  ADD_ON_SERVICE: {
    icon: IconPackage,
    description: 'Attach an add-on such as static IP or other service.'
  },
  EQUIPMENT_REPLACEMENT: {
    icon: IconEdit,
    description: 'Request modem, ONU, router, or equipment replacement.'
  }
};

function serviceOrderTypeOptions(meta = {}) {
  return Array.isArray(meta.orderTypes) && meta.orderTypes.length
    ? meta.orderTypes
    : Object.keys(ORDER_DETAIL_SCHEMAS);
}

function serviceOrderTypePresentation(orderType) {
  return ORDER_TYPE_PRESENTATION[orderType] || {
    icon: IconListDetails,
    description: 'Create a service-related customer request.'
  };
}

function customerLabel(customer) {
  if (!customer) return '-';
  return `${customer.accountNumber || 'NO-ACCOUNT'} - ${customer.name || customer.fullName || 'Unnamed customer'}`;
}

function customerLocationParts(customer) {
  return [
    customer?.barangay,
    customer?.city || customer?.municipality
  ].filter(Boolean);
}

function customerLocationLabel(customer) {
  const parts = customerLocationParts(customer);
  return parts.length ? parts.join(', ') : 'No barangay / municipality';
}

function customerFullAddressLabel(customer) {
  return customerAddressValue(customer) || customerLocationLabel(customer);
}

function customerAddressValue(customer) {
  if (!customer) return '';
  const address = customer?.address || [
    customer?.addressLine1,
    customer?.addressLine2,
    customer?.barangay,
    customer?.city || customer?.municipality,
    customer?.province
  ].filter(Boolean).join(', ');
  return address || '';
}

function customerLocationKey(customer) {
  return customerLocationParts(customer).join('||') || 'UNSPECIFIED';
}

function locationOptionLabel(location) {
  return [
    location?.barangay,
    location?.municipality || location?.city
  ].filter(Boolean).join(', ') || location?.location_name || location?.address || 'Unnamed location';
}

function installationAddressFromParts(location, streetAddress = '') {
  return [
    streetAddress,
    location?.barangay,
    location?.municipality || location?.city
  ].map((part) => String(part || '').trim()).filter(Boolean).join(', ');
}

function customerFromOrder(order) {
  const customer = order.customer || {};
  return {
    id: order.customerId || customer.id,
    accountNumber: order.accountNumber || customer.accountNumber || '',
    name: order.customerName || customer.name || customer.fullName || 'Unnamed customer',
    status: customer.status || '',
    customerType: customer.customerType || customer.accountType || '',
    contactNumber: customer.contactNumber || '',
    barangay: customer.barangay || '',
    city: customer.city || customer.municipality || '',
    province: customer.province || '',
    address: customer.address || order.installAddress || ''
  };
}

function customerFromServiceAccount(account) {
  const customer = account.customer || {};
  return {
    id: account.customerId || customer.id,
    accountNumber: account.customerAccountNumber || customer.accountNumber || '',
    name: account.customerName || customer.name || customer.fullName || 'Unnamed customer',
    status: customer.status || '',
    customerType: customer.customerType || customer.accountType || '',
    contactNumber: customer.contactNumber || '',
    barangay: customer.barangay || '',
    city: customer.city || customer.municipality || '',
    province: customer.province || '',
    address: customer.address || account.serviceAddress || ''
  };
}

function serviceOrderLabel(order) {
  if (!order) return '-';
  return `${order.serviceReference || order.orderNumber} - ${order.catalogName || order.catalog?.name || 'Service'}`;
}

function serviceOrderToken(order) {
  return order?.serviceReference || order?.orderNumber || '-';
}

function serviceAccountLabel(account) {
  if (!account) return '-';
  return `${account.serviceAccountNumber || account.serviceReference || 'Service account'} - ${account.catalogName || account.catalog?.name || 'Service'}`;
}

function valueOrDash(value) {
  return value === null || value === undefined || value === '' ? '-' : value;
}

function parseDateValue(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysSince(value) {
  const parsed = parseDateValue(value);
  if (!parsed) return null;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  parsed.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((todayStart.getTime() - parsed.getTime()) / 86400000));
}

function orderAgeLabel(order) {
  const age = daysSince(order?.requestedDate || order?.createdAt);
  if (age === null) return '-';
  if (age === 0) return 'Today';
  return `${age} day${age === 1 ? '' : 's'}`;
}

function orderTargetLabel(order) {
  return valueOrDash(
    order?.targetActivationDate
    || order?.orderDetails?.preferredSchedule
    || order?.orderDetails?.effectiveDate
    || order?.orderDetails?.targetTransferDate
    || order?.orderDetails?.suspensionStartDate
    || order?.orderDetails?.reconnectionDate
    || order?.orderDetails?.targetDisconnectionDate
    || order?.orderDetails?.targetReplacementDate
  );
}

function accountRowId(row) {
  return row?.rowId || row?.account?.id || (row?.customer?.id ? `customer:${row.customer.id}` : '');
}

function serviceOrderSortValue(order) {
  return String(order?.createdAt || order?.updatedAt || order?.requestedDate || order?.orderNumber || '');
}

function sortServiceOrders(rows = []) {
  return [...rows].sort((left, right) => serviceOrderSortValue(right).localeCompare(serviceOrderSortValue(left)));
}

function primaryServiceAccount(accounts = []) {
  const statusRank = {
    ACTIVE: 0,
    PENDING_ACTIVATION: 1,
    SUSPENDED: 2,
    DISCONNECTED: 3,
    CANCELLED: 4
  };
  return [...accounts].sort((left, right) => {
    const leftRank = statusRank[left.status] ?? 9;
    const rightRank = statusRank[right.status] ?? 9;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return serviceAccountLabel(left).localeCompare(serviceAccountLabel(right));
  })[0] || null;
}

function ordersForServiceAccount(account, ordersByCustomer) {
  const customerOrders = ordersByCustomer.get(account.customerId) || [];
  const accountMatches = customerOrders.filter((order) => order.serviceAccountId === account.id);
  if (accountMatches.length) return accountMatches;
  return customerOrders.filter((order) => !order.serviceAccountId && account.serviceReference && order.serviceReference === account.serviceReference);
}

function orderRequiresServiceAccount(orderType) {
  return String(orderType || 'NEW_INSTALLATION') !== 'NEW_INSTALLATION';
}

function orderUsesCatalogSelection(orderType) {
  return CATALOG_SELECTION_ORDER_TYPES.includes(orderType || 'NEW_INSTALLATION');
}

function orderShowsInstallAddressField(orderType) {
  return INSTALL_ADDRESS_ORDER_TYPES.includes(orderType || 'NEW_INSTALLATION');
}

function editableOrderStatus(value) {
  const normalized = String(value || CREATED_ORDER_STATUS).toUpperCase();
  return normalized === 'DRAFT' ? CREATED_ORDER_STATUS : normalized;
}

function canCancelServiceOrder(order) {
  const orderStatus = String(order?.status || '').toUpperCase();
  const ticketStatus = String(order?.ticketStatus || order?.ticket?.status || '').toUpperCase();
  return !NON_CANCELABLE_ORDER_STATUSES.includes(orderStatus) && !NON_CANCELABLE_TICKET_STATUSES.includes(ticketStatus);
}

function orderAddressLabel(orderType) {
  if (orderType === 'NEW_INSTALLATION') return 'Installation Address';
  if (orderType === 'RELOCATION') return 'New Service Address';
  return 'Service Address';
}

function orderAddressSummary(orderLike = {}, account = null) {
  const details = orderLike.orderDetails || {};
  if (orderLike.orderType === 'RELOCATION') {
    return details.newServiceAddress || orderLike.installAddress || account?.serviceAddress || '';
  }
  if (orderLike.orderType === 'NEW_INSTALLATION') {
    return orderLike.installAddress || '';
  }
  return account?.serviceAddress || orderLike.serviceAccount?.serviceAddress || orderLike.installAddress || '';
}

function isInternetCatalog(item) {
  return INTERNET_CATALOG_TYPES.includes(item?.serviceType);
}

function isAddOnCatalog(item) {
  return ADD_ON_CATALOG_TYPES.includes(item?.serviceType);
}

function isInstallationCatalog(item) {
  return item?.serviceType === 'INSTALLATION';
}

function catalogFormHelp(serviceType) {
  if (INTERNET_CATALOG_TYPES.includes(serviceType)) {
    return 'Internet plans are selectable for New Installation, Plan Upgrade, and Plan Downgrade orders.';
  }
  if (ADD_ON_CATALOG_TYPES.includes(serviceType)) {
    return 'Add-on items are selectable only for Add-on Service orders tied to an existing service account.';
  }
  if (serviceType === 'INSTALLATION') {
    return 'Installation items are tracked as one-time setup charges and are not selected as the customer plan.';
  }
  return 'Use this catalog item for service offerings that do not fit the standard internet plan or add-on groups.';
}

function catalogDisplayMetric(item) {
  if (isInternetCatalog(item)) {
    return `${Number(item.downloadMbps || 0)} / ${Number(item.uploadMbps || 0)} Mbps`;
  }
  if (item?.serviceType === 'STATIC_IP') return 'Static IP';
  if (item?.serviceType === 'INSTALLATION') return 'Installation';
  return 'Add-on';
}

function catalogPricingLabel(item) {
  if (isInstallationCatalog(item) || item?.billingMode === 'ONE_TIME') {
    return `${money(item.installFee || item.monthlyRate || 0)} one-time`;
  }
  return `${money(item.monthlyRate)} / mo`;
}

function catalogRowsForOrderType(orderType, rows = [], account = null) {
  const activeRows = rows.filter((item) => item.status === 'ACTIVE');
  if (orderType === 'ADD_ON_SERVICE') return activeRows.filter(isAddOnCatalog);
  if (orderType === 'NEW_INSTALLATION') return activeRows.filter(isInternetCatalog);
  if (!['PLAN_UPGRADE', 'PLAN_DOWNGRADE'].includes(orderType)) return [];

  const currentCatalog = account?.catalog || {};
  const currentCatalogId = account?.catalogId || currentCatalog.id || '';
  const currentSegment = currentCatalog.segment || '';
  const currentDownload = Number(currentCatalog.downloadMbps || 0);
  const currentUpload = Number(currentCatalog.uploadMbps || 0);
  const currentRate = Number(currentCatalog.monthlyRate || 0);
  const options = activeRows.filter((item) => isInternetCatalog(item) && item.id !== currentCatalogId);

  if (currentDownload || currentUpload) {
    const speedMatches = options.filter((item) => (
      orderType === 'PLAN_UPGRADE'
        ? Number(item.downloadMbps || 0) > currentDownload
          || (Number(item.downloadMbps || 0) === currentDownload && Number(item.uploadMbps || 0) > currentUpload)
        : Number(item.downloadMbps || 0) < currentDownload
          || (Number(item.downloadMbps || 0) === currentDownload && Number(item.uploadMbps || 0) < currentUpload)
    ));
    if (speedMatches.length) {
      if (currentSegment && currentSegment !== 'ALL') {
        const sameSegment = speedMatches.filter((item) => item.segment === currentSegment || item.segment === 'ALL');
        if (sameSegment.length) return sameSegment;
      }
      return speedMatches;
    }
    return [];
  }

  if (currentRate) {
    const rateMatches = options.filter((item) => (
      orderType === 'PLAN_UPGRADE'
        ? Number(item.monthlyRate || 0) > currentRate
        : Number(item.monthlyRate || 0) < currentRate
    ));
    if (rateMatches.length) {
      if (currentSegment && currentSegment !== 'ALL') {
        const sameSegment = rateMatches.filter((item) => item.segment === currentSegment || item.segment === 'ALL');
        if (sameSegment.length) return sameSegment;
      }
      return rateMatches;
    }
    return [];
  }

  if (currentSegment && currentSegment !== 'ALL') {
    const segmentMatches = options.filter((item) => item.segment === currentSegment || item.segment === 'ALL');
    if (segmentMatches.length) return segmentMatches;
  }

  return options;
}

function downgradeEligibleAccounts(accounts = [], rows = []) {
  return accounts.filter((account) => catalogRowsForOrderType('PLAN_DOWNGRADE', rows, account).length > 0);
}

function catalogSelectionTitle(orderType) {
  if (orderType === 'PLAN_UPGRADE') return 'Requested upgrade plan';
  if (orderType === 'PLAN_DOWNGRADE') return 'Requested downgrade plan';
  if (orderType === 'ADD_ON_SERVICE') return 'Requested add-on service';
  return 'Requested service catalog';
}

function catalogSelectionHint(orderType) {
  if (orderType === 'PLAN_UPGRADE') return 'Choose the higher-speed plan the customer wants to move to.';
  if (orderType === 'PLAN_DOWNGRADE') return 'Choose the lower-speed plan the customer wants to move to.';
  if (orderType === 'ADD_ON_SERVICE') return 'Choose the add-on item to attach to the existing service account.';
  return 'Choose the internet service the customer is applying for.';
}

function detailsSeedForCatalog(orderType, item = null, account = null) {
  if (!item) return {};
  if (['PLAN_UPGRADE', 'PLAN_DOWNGRADE'].includes(orderType)) {
    const currentRate = Number(account?.catalog?.monthlyRate || 0);
    return { priceDifference: Math.abs(Number(item.monthlyRate || 0) - currentRate) };
  }
  if (orderType === 'ADD_ON_SERVICE') {
    return { addOnName: item.name || '', monthlyCharge: item.monthlyRate || '' };
  }
  return {};
}

function detailFieldsForType(orderType, schemas = ORDER_DETAIL_SCHEMAS) {
  return schemas?.[orderType] || ORDER_DETAIL_SCHEMAS[orderType] || [];
}

function missingRequiredOrderDetailLabels(orderType, details = {}, schemas = ORDER_DETAIL_SCHEMAS) {
  return detailFieldsForType(orderType, schemas)
    .filter((field) => field.required)
    .filter((field) => {
      const value = details[field.name];
      return value === null || value === undefined || (typeof value === 'string' ? value.trim() === '' : value === '');
    })
    .map((field) => field.label);
}

function defaultDetailValue(field) {
  if (field.type === 'boolean') return false;
  if (field.type === 'money') return '';
  return '';
}

function detailsForOrderType(orderType, details = {}, seed = {}, schemas = ORDER_DETAIL_SCHEMAS) {
  return detailFieldsForType(orderType, schemas).reduce((next, field) => ({
    ...next,
    [field.name]: details[field.name] ?? seed[field.name] ?? defaultDetailValue(field)
  }), {});
}

function seedDetailsForAccount(orderType, account = null) {
  if (!account) return {};
  const catalogName = account.catalogName || account.catalog?.name || '';
  const serviceAddress = account.serviceAddress || '';
  if (['PLAN_UPGRADE', 'PLAN_DOWNGRADE'].includes(orderType)) {
    return { currentPlan: catalogName };
  }
  if (orderType === 'RELOCATION') {
    return { currentServiceAddress: serviceAddress };
  }
  if (orderType === 'CHANGE_OWNERSHIP') {
    return { currentServiceAddress: serviceAddress };
  }
  return {};
}

function formatOrderDetailValue(field, value, details = {}) {
  if (field.type === 'customer') {
    const name = details.newOwnerName || '';
    const account = details.newOwnerAccountNumber || '';
    return name ? `${account ? `${account} - ` : ''}${name}` : valueOrDash(value);
  }
  if (field.type === 'boolean') return value ? 'Yes' : 'No';
  if (field.type === 'money') return value === null || value === undefined || value === '' ? '-' : money(value);
  return valueOrDash(value);
}

function statusRequiresOrderDetails(status, requiredStatuses = DETAIL_REQUIRED_STATUSES) {
  return (requiredStatuses || DETAIL_REQUIRED_STATUSES).includes(status || 'DRAFT');
}

function missingRequiredOrderDetails(orderType, details = {}, status = 'DRAFT', schemas = ORDER_DETAIL_SCHEMAS, requiredStatuses = DETAIL_REQUIRED_STATUSES) {
  if (!statusRequiresOrderDetails(status, requiredStatuses)) return [];
  return missingRequiredOrderDetailLabels(orderType, details, schemas);
}

function orderReadinessFromOrder(order, schemas = ORDER_DETAIL_SCHEMAS, requiredStatuses = DETAIL_REQUIRED_STATUSES) {
  const existing = order.orderReadiness || {};
  const requiredNow = typeof existing.requiredNow === 'boolean'
    ? existing.requiredNow
    : statusRequiresOrderDetails(order.status, requiredStatuses);
  const missingFields = Array.isArray(existing.missingFields)
    ? existing.missingFields
    : missingRequiredOrderDetails(order.orderType || 'NEW_INSTALLATION', order.orderDetails || {}, order.status, schemas, requiredStatuses);
  const ready = typeof existing.ready === 'boolean' ? existing.ready : (!requiredNow || missingFields.length === 0);
  return { requiredNow, missingFields, ready };
}

function accountRowSearchText({ customer, account, accounts = [], orders: customerOrders = [] }) {
  return [
    customerLabel(customer),
    customer?.contactNumber,
    customer?.address,
    customer?.status,
    account?.serviceAccountNumber,
    account?.serviceReference,
    account?.status,
    account?.catalogName,
    account?.catalogCode,
    account?.catalog?.name,
    account?.catalog?.code,
    account?.serviceAddress,
    ...accounts.flatMap((serviceAccount) => [
      serviceAccount.serviceAccountNumber,
      serviceAccount.serviceReference,
      serviceAccount.status,
      serviceAccount.catalogName,
      serviceAccount.catalogCode,
      serviceAccount.catalog?.name,
      serviceAccount.catalog?.code,
      serviceAccount.serviceAddress
    ]),
    ...customerOrders.flatMap((order) => [
      order.orderNumber,
      order.orderType,
      order.serviceReference,
      order.serviceAccountNumber,
      order.serviceAccountStatus,
      order.serviceAccount?.serviceAccountNumber,
      order.catalogName,
      order.catalogCode,
      order.catalog?.name,
      order.catalog?.code,
      order.status,
      order.priority,
      order.installAddress,
      ...Object.values(order.orderDetails || {})
    ])
  ].filter(Boolean).join(' ').toLowerCase();
}

function customerSearchText(customer) {
  return [
    customerLabel(customer),
    customer?.contactNumber,
    customer?.email,
    customer?.barangay,
    customer?.city || customer?.municipality,
    customer?.province,
    customer?.customerType,
    customer?.accountType,
    customer?.status
  ].filter(Boolean).join(' ').toLowerCase();
}

function isInteractiveTableTarget(target) {
  return Boolean(target?.closest?.('a,button,input,select,textarea,label,form'));
}

function preferredOrderForFilters(customerOrders = [], orderTypeFilter = 'ALL', statusFilter = 'ALL') {
  return customerOrders.find((order) => (
    (orderTypeFilter === 'ALL' || order.orderType === orderTypeFilter)
    && (statusFilter === 'ALL' || order.status === statusFilter)
  )) || customerOrders[0] || null;
}

function Card({ title, icon: Icon, actions, children }) {
  return (
    <div className="card">
      {(title || actions) && (
        <div className="card-header">
          <h3 className="card-title">{Icon && <Icon size={18} className="me-2 text-muted" />}{title}</h3>
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      <div className="card-body">{children}</div>
    </div>
  );
}

function TextField({ label: fieldLabel, value, onChange, type = 'text', required = false, min, max, step, disabled = false }) {
  return (
    <div>
      <label className="form-label">{fieldLabel}</label>
      <input className="form-control" type={type} min={min} max={max} step={step} required={required} disabled={disabled} value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function SelectField({ label: fieldLabel, value, onChange, options = [], required = false, disabled = false, children }) {
  return (
    <div>
      <label className="form-label">{fieldLabel}</label>
      <select className="form-select" required={required} disabled={disabled} value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
        {children || options.map((option) => <option key={option} value={option}>{label(option)}</option>)}
      </select>
    </div>
  );
}

const blankCatalog = {
  id: '',
  code: '',
  name: '',
  serviceType: 'FIBER_INTERNET',
  segment: 'RESIDENTIAL',
  downloadMbps: '50',
  uploadMbps: '20',
  monthlyRate: '999',
  installFee: '0',
  billingMode: 'PREPAID',
  status: 'ACTIVE',
  contractMonths: '0',
  equipmentProfile: '',
  description: '',
  notes: ''
};

const blankOrder = {
  id: '',
  customerId: '',
  serviceAccountId: '',
  catalogId: '',
  orderType: '',
  requestedDate: '',
  targetActivationDate: '',
  activationDate: '',
  billingStartDate: '',
  installAddress: '',
  installAddressSameAsCustomer: true,
  installLocationId: '',
  installLocationLabel: '',
  installStreetAddress: '',
  status: CREATED_ORDER_STATUS,
  priority: 'NORMAL',
  serviceReference: '',
  orderDetails: {},
  notes: ''
};

export default function ServicePage({ initialSection = 'catalog', refreshShell = () => {} }) {
  const pageView = initialSection === 'orders' ? 'orders' : initialSection === 'accounts' ? 'accounts' : 'catalog';
  const [meta, setMeta] = useState({ serviceTypes: [], segments: [], catalogStatuses: [], accountStatuses: [], billingModes: [], orderTypes: [], orderDetailSchemas: ORDER_DETAIL_SCHEMAS, orderStatuses: [], orderPriorities: [] });
  const [catalogOverview, setCatalogOverview] = useState({ metrics: {}, byType: [], activePlans: [] });
  const [orderOverview, setOrderOverview] = useState({ metrics: {}, byStatus: {}, recentOrders: [] });
  const [catalog, setCatalog] = useState([]);
  const [serviceAccountRecords, setServiceAccountRecords] = useState([]);
  const [orders, setOrders] = useState([]);
  const [allOrders, setAllOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [avatarConfig, setAvatarConfig] = useState(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [orderSearch, setOrderSearch] = useState('');
  const [orderPage, setOrderPage] = useState(1);
  const [orderPageSize, setOrderPageSize] = useState('10');
  const [accountServiceTab, setAccountServiceTab] = useState('WITH_SERVICE');
  const [customerStatusFilter, setCustomerStatusFilter] = useState('ALL');
  const [orderTypeFilter, setOrderTypeFilter] = useState('ALL');
  const [serviceStatusFilter, setServiceStatusFilter] = useState('ALL');
  const [catalogForm, setCatalogForm] = useState(blankCatalog);
  const [orderForm, setOrderForm] = useState(blankOrder);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [selectedServiceOrderId, setSelectedServiceOrderId] = useState('');
  const [isCatalogModalOpen, setIsCatalogModalOpen] = useState(false);
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [orderModalTab, setOrderModalTab] = useState('order');
  const [isOrderCustomerPickerOpen, setIsOrderCustomerPickerOpen] = useState(false);
  const [isOrderTypePickerOpen, setIsOrderTypePickerOpen] = useState(false);
  const [orderWizardStage, setOrderWizardStage] = useState('customer');
  const [completedOrderWizardStageIds, setCompletedOrderWizardStageIds] = useState([]);
  const [isOrderReviewConfirmed, setIsOrderReviewConfirmed] = useState(false);
  const [orderCustomerSearch, setOrderCustomerSearch] = useState('');
  const [orderCustomerLocationFilter, setOrderCustomerLocationFilter] = useState('ALL');
  const [orderCustomerTypeFilter, setOrderCustomerTypeFilter] = useState('ALL');
  const [orderCustomerSelectedId, setOrderCustomerSelectedId] = useState('');
  const [orderTypePickerCustomerId, setOrderTypePickerCustomerId] = useState('');
  const [orderTypePickerAccountId, setOrderTypePickerAccountId] = useState('');
  const [orderTypePickerType, setOrderTypePickerType] = useState('');
  const [areServiceFiltersOpen, setAreServiceFiltersOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const catalogFormIsInternet = INTERNET_CATALOG_TYPES.includes(catalogForm.serviceType);
  const catalogFormIsAddOn = ADD_ON_CATALOG_TYPES.includes(catalogForm.serviceType);
  const catalogFormIsInstallation = catalogForm.serviceType === 'INSTALLATION';
  const activeCatalog = useMemo(() => catalog.filter((item) => item.status === 'ACTIVE'), [catalog]);
  const ordersByCustomer = useMemo(() => {
    const rows = new Map();
    allOrders.forEach((order) => {
      if (!order.customerId) return;
      const customerOrders = rows.get(order.customerId) || [];
      customerOrders.push(order);
      rows.set(order.customerId, customerOrders);
    });
    return rows;
  }, [allOrders]);
  const serviceAccountsByCustomer = useMemo(() => {
    const rows = new Map();
    serviceAccountRecords.forEach((account) => {
      if (!account.customerId) return;
      const current = rows.get(account.customerId) || [];
      current.push(account);
      rows.set(account.customerId, current);
    });
    return rows;
  }, [serviceAccountRecords]);
  const serviceAccountRows = useMemo(() => serviceAccountRecords
    .map((account) => {
      const customer = customers.find((row) => row.id === account.customerId) || customerFromServiceAccount(account);
      const accountOrders = sortServiceOrders(ordersForServiceAccount(account, ordersByCustomer));
      return {
        rowId: account.id,
        customer: { ...customer, address: customer.address || account.serviceAddress || '' },
        account,
        orders: accountOrders,
        hasService: true
      };
    })
    .sort((left, right) => serviceAccountLabel(left.account).localeCompare(serviceAccountLabel(right.account))),
  [customers, ordersByCustomer, serviceAccountRecords]);
  const accountRows = useMemo(() => {
    const rowsByCustomer = new Map();
    const ensureRow = (customer, fallbackId = '') => {
      const customerId = customer?.id || fallbackId;
      if (!customerId) return null;
      const existing = rowsByCustomer.get(customerId);
      if (existing) {
        existing.customer = {
          ...existing.customer,
          ...customer,
          address: existing.customer.address || customer?.address || ''
        };
        return existing;
      }
      const nextRow = {
        customer: { ...(customer || {}), id: customerId },
        accounts: []
      };
      rowsByCustomer.set(customerId, nextRow);
      return nextRow;
    };

    customers.forEach((customer) => ensureRow(customer, customer.id));
    serviceAccountRecords.forEach((account) => {
      const customer = customers.find((row) => row.id === account.customerId) || customerFromServiceAccount(account);
      const row = ensureRow(customer, account.customerId);
      if (row) row.accounts.push(account);
    });
    ordersByCustomer.forEach((customerOrders, customerId) => {
      ensureRow(customerFromOrder(customerOrders[0]), customerId);
    });

    return Array.from(rowsByCustomer.values()).map(({ customer, accounts }) => {
      const sortedAccounts = [...accounts].sort((left, right) => serviceAccountLabel(left).localeCompare(serviceAccountLabel(right)));
      const account = primaryServiceAccount(sortedAccounts);
      const customerOrders = sortServiceOrders(ordersByCustomer.get(customer.id) || []);
      return {
        rowId: `customer:${customer.id}`,
        customer: {
          ...customer,
          address: customer.address || account?.serviceAddress || ''
        },
        account,
        accounts: sortedAccounts,
        orders: customerOrders,
        hasService: sortedAccounts.length > 0
      };
    }).sort((left, right) => {
      if (left.hasService !== right.hasService) return left.hasService ? 1 : -1;
      return customerLabel(left.customer).localeCompare(customerLabel(right.customer));
    });
  }, [customers, ordersByCustomer, serviceAccountRecords]);
  const customerStatusOptions = useMemo(() => {
    const statuses = new Set();
    accountRows.forEach(({ customer }) => customer.status && statuses.add(customer.status));
    return Array.from(statuses).sort();
  }, [accountRows]);
  const customersWithoutServiceAccount = useMemo(
    () => accountRows.filter((row) => !row.hasService).map((row) => row.customer),
    [accountRows]
  );
  const serviceAccountTabCounts = useMemo(() => ({
    WITH_SERVICE: accountRows.filter((row) => row.hasService).length,
    WITHOUT_SERVICE: accountRows.filter((row) => !row.hasService).length
  }), [accountRows]);
  const isWithoutServiceAccountTab = accountServiceTab === 'WITHOUT_SERVICE';
  const filteredAccountRows = useMemo(
    () => accountRows.filter(({ customer, account, orders: customerOrders, hasService }) => (
      (accountServiceTab === 'WITH_SERVICE' ? hasService : !hasService)
      && (customerStatusFilter === 'ALL' || customer.status === customerStatusFilter)
      && (orderTypeFilter === 'ALL' || isWithoutServiceAccountTab || (hasService && customerOrders.some((order) => order.orderType === orderTypeFilter)))
      && (serviceStatusFilter === 'ALL' || isWithoutServiceAccountTab || (hasService && customerOrders.some((order) => order.status === serviceStatusFilter)))
      && (!orderSearch.trim() || accountRowSearchText({ customer, account, orders: customerOrders }).includes(orderSearch.trim().toLowerCase()))
    )),
    [accountRows, accountServiceTab, customerStatusFilter, isWithoutServiceAccountTab, orderTypeFilter, serviceStatusFilter, orderSearch]
  );
  const filteredOrderRows = useMemo(
    () => orders.filter((order) => (
      (orderTypeFilter === 'ALL' || order.orderType === orderTypeFilter)
      && (serviceStatusFilter === 'ALL' || order.status === serviceStatusFilter)
    )),
    [orders, orderTypeFilter, serviceStatusFilter]
  );
  const orderQueueStats = useMemo(() => ({
    open: filteredOrderRows.filter((order) => OPEN_ORDER_STATUSES.includes(order.status)).length,
    inProgress: filteredOrderRows.filter((order) => order.status === 'IN_PROGRESS').length,
    pending: filteredOrderRows.filter((order) => ['SUBMITTED', 'PENDING_REQUIREMENT', 'PENDING_REVIEW', 'APPROVED'].includes(order.status)).length,
    completed: filteredOrderRows.filter((order) => order.status === 'COMPLETED').length
  }), [filteredOrderRows]);
  const activeServiceAccountCount = useMemo(
    () => serviceAccountRows.filter((row) => row.account?.status === 'ACTIVE').length,
    [serviceAccountRows]
  );
  const orderPageSizeNumber = orderPageSize === 'ALL' ? Math.max(filteredAccountRows.length, 1) : Number(orderPageSize);
  const orderPageCount = Math.max(1, Math.ceil(filteredAccountRows.length / orderPageSizeNumber));
  const orderPageStart = filteredAccountRows.length ? (Math.min(orderPage, orderPageCount) - 1) * orderPageSizeNumber : 0;
  const orderPageEnd = orderPageSize === 'ALL'
    ? filteredAccountRows.length
    : Math.min(orderPageStart + orderPageSizeNumber, filteredAccountRows.length);
  const paginatedAccountRows = orderPageSize === 'ALL' ? filteredAccountRows : filteredAccountRows.slice(orderPageStart, orderPageEnd);
  const selectedOrderCustomer = useMemo(() => {
    if (!orderForm.customerId) return null;
    return customers.find((customer) => customer.id === orderForm.customerId)
      || accountRows.find(({ customer }) => customer.id === orderForm.customerId)?.customer
      || customerFromOrder(orderForm);
  }, [accountRows, customers, orderForm]);
  const selectedServiceOrder = useMemo(
    () => allOrders.find((order) => order.id === selectedServiceOrderId) || null,
    [allOrders, selectedServiceOrderId]
  );
  const selectedAccountRow = useMemo(() => {
    if (!selectedAccountId && !selectedServiceOrder) return null;
    if (selectedAccountId) {
      const directRow = accountRows.find((row) => accountRowId(row) === selectedAccountId)
        || filteredAccountRows.find((row) => accountRowId(row) === selectedAccountId);
      if (directRow) return directRow;
    }
    if (selectedServiceOrder) {
      return accountRows.find((row) => row.orders?.some((order) => order.id === selectedServiceOrder.id))
        || accountRows.find(({ customer }) => customer.id === selectedServiceOrder.customerId)
        || { rowId: `customer:${selectedServiceOrder.customerId}`, customer: customerFromOrder(selectedServiceOrder), account: null, orders: [selectedServiceOrder], hasService: false };
    }
    return null;
  }, [accountRows, filteredAccountRows, selectedAccountId, selectedServiceOrder]);
  const selectedOrderAccount = useMemo(() => {
    if (!orderForm.serviceAccountId) return null;
    return serviceAccountRecords.find((account) => account.id === orderForm.serviceAccountId)
      || selectedAccountRow?.account
      || selectedServiceOrder?.serviceAccount
      || null;
  }, [orderForm.serviceAccountId, selectedAccountRow, selectedServiceOrder, serviceAccountRecords]);
  const serviceFiltersActive = Boolean(customerStatusFilter !== 'ALL' || (!isWithoutServiceAccountTab && (orderTypeFilter !== 'ALL' || serviceStatusFilter !== 'ALL')));
  const serviceFilterCount = [
    customerStatusFilter !== 'ALL',
    !isWithoutServiceAccountTab && orderTypeFilter !== 'ALL',
    !isWithoutServiceAccountTab && serviceStatusFilter !== 'ALL'
  ].filter(Boolean).length;
  const orderTypeOptions = useMemo(() => serviceOrderTypeOptions(meta), [meta]);
  const orderCustomerLocationOptions = useMemo(() => {
    const options = new Map();
    customers.forEach((customer) => {
      const key = customerLocationKey(customer);
      if (key !== 'UNSPECIFIED') options.set(key, customerLocationLabel(customer));
    });
    return Array.from(options.entries()).sort((left, right) => left[1].localeCompare(right[1]));
  }, [customers]);
  const orderCustomerTypeOptions = useMemo(() => {
    const options = new Set();
    customers.forEach((customer) => {
      const type = customer.customerType || customer.accountType || '';
      if (type) options.add(type);
    });
    return Array.from(options).sort((left, right) => label(left).localeCompare(label(right)));
  }, [customers]);
  const locationOptions = useMemo(() => {
    const unique = new Map();
    locations.forEach((location) => {
      const optionLabel = locationOptionLabel(location);
      if (!unique.has(optionLabel)) unique.set(optionLabel, location);
    });
    return Array.from(unique.values()).sort((left, right) => locationOptionLabel(left).localeCompare(locationOptionLabel(right)));
  }, [locations]);
  const orderCustomerPickerRows = useMemo(() => {
    const term = orderCustomerSearch.trim().toLowerCase();
    return customers
      .filter((customer) => (
        (!term || customerSearchText(customer).includes(term))
        && (orderCustomerLocationFilter === 'ALL' || customerLocationKey(customer) === orderCustomerLocationFilter)
        && (orderCustomerTypeFilter === 'ALL' || (customer.customerType || customer.accountType || '') === orderCustomerTypeFilter)
      ))
      .sort((left, right) => customerLabel(left).localeCompare(customerLabel(right)));
  }, [customers, orderCustomerLocationFilter, orderCustomerSearch, orderCustomerTypeFilter]);
  const selectedOrderPickerCustomer = useMemo(
    () => customers.find((customer) => customer.id === orderCustomerSelectedId) || null,
    [customers, orderCustomerSelectedId]
  );
  const selectedOrderTypePickerCustomer = useMemo(
    () => customers.find((customer) => customer.id === orderTypePickerCustomerId)
      || accountRows.find(({ customer }) => customer.id === orderTypePickerCustomerId)?.customer
      || null,
    [accountRows, customers, orderTypePickerCustomerId]
  );
  const selectedOrderTypePickerAccounts = useMemo(
    () => (orderTypePickerCustomerId ? serviceAccountsByCustomer.get(orderTypePickerCustomerId) || [] : []),
    [orderTypePickerCustomerId, serviceAccountsByCustomer]
  );
  const selectedOrderTypePickerAccount = useMemo(
    () => selectedOrderTypePickerAccounts.find((account) => account.id === orderTypePickerAccountId) || null,
    [orderTypePickerAccountId, selectedOrderTypePickerAccounts]
  );
  const selectedOrderTypePickerOrders = useMemo(
    () => (orderTypePickerCustomerId ? ordersByCustomer.get(orderTypePickerCustomerId) || [] : []),
    [orderTypePickerCustomerId, ordersByCustomer]
  );
  const orderTypePickerDowngradeAccounts = useMemo(
    () => downgradeEligibleAccounts(selectedOrderTypePickerAccounts, activeCatalog),
    [activeCatalog, selectedOrderTypePickerAccounts]
  );
  const orderTypePickerRequiresAccount = orderRequiresServiceAccount(orderTypePickerType);
  const orderTypePickerSelectedAccountCanDowngrade = orderTypePickerType !== 'PLAN_DOWNGRADE'
    || orderTypePickerDowngradeAccounts.some((account) => account.id === orderTypePickerAccountId);
  const orderTypePickerCanContinue = Boolean(
    selectedOrderTypePickerCustomer
    && orderTypePickerType
    && (!orderTypePickerRequiresAccount || selectedOrderTypePickerAccount)
    && orderTypePickerSelectedAccountCanDowngrade
  );
  const orderDetailRequiredStatuses = meta.orderDetailRequiredStatuses || DETAIL_REQUIRED_STATUSES;
  const orderDetailMissingFields = useMemo(
    () => missingRequiredOrderDetails(
      orderForm.orderType,
      orderForm.orderDetails || {},
      editableOrderStatus(orderForm.status),
      meta.orderDetailSchemas,
      orderDetailRequiredStatuses
    ),
    [meta.orderDetailSchemas, orderDetailRequiredStatuses, orderForm.orderDetails, orderForm.orderType, orderForm.status]
  );
  const shouldShowOrderCatalog = orderUsesCatalogSelection(orderForm.orderType);
  const orderCatalogRows = useMemo(
    () => catalogRowsForOrderType(orderForm.orderType, activeCatalog, selectedOrderAccount),
    [activeCatalog, orderForm.orderType, selectedOrderAccount]
  );
  const orderCatalogIsValid = !shouldShowOrderCatalog || orderCatalogRows.some((item) => item.id === orderForm.catalogId);
  const existingOrderMatches = useMemo(() => {
    if (!orderForm.customerId) return [];
    const currentId = orderForm.id || '';
    if (orderForm.serviceAccountId) {
      return allOrders.filter((order) => order.id !== currentId && order.serviceAccountId === orderForm.serviceAccountId);
    }
    return allOrders.filter((order) => order.id !== currentId && order.customerId === orderForm.customerId);
  }, [allOrders, orderForm.customerId, orderForm.id, orderForm.serviceAccountId]);
  const orderModalTabs = useMemo(() => [
    { id: 'order', label: 'Order' },
    ...(shouldShowOrderCatalog ? [{ id: 'catalog', label: 'Service catalog', badge: orderCatalogIsValid ? '' : '!' }] : []),
    { id: 'review', label: 'Review', badge: orderDetailMissingFields.length ? String(orderDetailMissingFields.length) : '' }
  ], [orderCatalogIsValid, orderDetailMissingFields.length, shouldShowOrderCatalog]);
  const isEditingOrder = Boolean(orderForm.id);
  const orderWizardStages = useMemo(() => [
    ORDER_CREATION_STAGE_DEFS.customer,
    ORDER_CREATION_STAGE_DEFS.type,
    ORDER_CREATION_STAGE_DEFS.order,
    ORDER_CREATION_STAGE_DEFS.catalog,
    ORDER_CREATION_STAGE_DEFS.ticket,
    ORDER_CREATION_STAGE_DEFS.review
  ], []);
  const orderWizardStageIndex = Math.max(0, orderWizardStages.findIndex((stage) => stage.id === orderWizardStage));
  const currentOrderWizardStage = orderWizardStages[orderWizardStageIndex] || orderWizardStages[0];
  const completedOrderWizardStageSet = new Set(completedOrderWizardStageIds);
  const orderWizardProgress = Math.round((Math.min(completedOrderWizardStageSet.size, orderWizardStages.length) / orderWizardStages.length) * 100);
  const isFinalOrderWizardStage = orderWizardStageIndex === orderWizardStages.length - 1;
  const orderInstallationAddressReady = !orderShowsInstallAddressField(orderForm.orderType)
    || (
      orderForm.installAddressSameAsCustomer !== false
        ? Boolean(customerAddressValue(selectedOrderCustomer))
        : Boolean(orderForm.installLocationId && String(orderForm.installStreetAddress || '').trim())
    );
  const orderSaveDisabled = !orderForm.customerId
    || !orderForm.orderType
    || (shouldShowOrderCatalog && !orderCatalogIsValid)
    || (orderRequiresServiceAccount(orderForm.orderType) && !orderForm.serviceAccountId)
    || !orderInstallationAddressReady
    || orderDetailMissingFields.length > 0
    || (!isEditingOrder && !isOrderReviewConfirmed);
  const completedOrderWizardStages = orderWizardStages.map((stage) => {
    if (isEditingOrder) {
      if (stage.id === 'customer') return Boolean(orderForm.customerId);
      if (stage.id === 'type') return Boolean(orderForm.orderType);
      if (stage.id === 'order') return Boolean(orderForm.customerId && orderForm.orderType && orderInstallationAddressReady && orderDetailMissingFields.length === 0);
      if (stage.id === 'catalog') return orderCatalogIsValid;
      if (stage.id === 'ticket') return Boolean(orderForm.customerId && orderForm.orderType);
      if (stage.id === 'review') return orderDetailMissingFields.length === 0;
    }
    return completedOrderWizardStageSet.has(stage.id);
  });

  async function load(nextCatalogSearch = catalogSearch, nextOrderSearch = orderSearch) {
    setError('');
    try {
      const [nextMeta, nextCatalogOverview, nextOrderOverview, nextAccounts, nextCatalog, nextOrders, nextAllOrders, nextCustomers, nextLocations, nextAvatarConfig] = await Promise.all([
        request('/service/meta'),
        request('/service/catalog/overview'),
        request('/service/orders/overview'),
        request('/service/accounts'),
        request(`/service/catalog?search=${encodeURIComponent(nextCatalogSearch)}`),
        request(`/service/orders?search=${encodeURIComponent(nextOrderSearch)}`),
        request('/service/orders'),
        request('/service/customers'),
        request('/system-settings/locations').catch(() => []),
        request('/system-settings/avatars').catch(() => null)
      ]);
      setMeta(nextMeta);
      setCatalogOverview(nextCatalogOverview);
      setOrderOverview(nextOrderOverview);
      setServiceAccountRecords(nextAccounts);
      setCatalog(nextCatalog);
      setOrders(nextOrders);
      setAllOrders(nextAllOrders);
      setCustomers(nextCustomers);
      setLocations(nextLocations);
      setAvatarConfig(nextAvatarConfig);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (selectedServiceOrderId && allOrders.length && !allOrders.some((order) => order.id === selectedServiceOrderId)) {
      setSelectedServiceOrderId('');
    }
  }, [allOrders, selectedServiceOrderId]);

  useEffect(() => {
    if (!selectedAccountId) return;
    const isVisible = filteredAccountRows.some((row) => accountRowId(row) === selectedAccountId);
    if (!isVisible) {
      setSelectedAccountId('');
      setSelectedServiceOrderId('');
    }
  }, [filteredAccountRows, selectedAccountId]);

  useEffect(() => {
    if (!orderCustomerSelectedId) return;
    if (!orderCustomerPickerRows.some((customer) => customer.id === orderCustomerSelectedId)) {
      setOrderCustomerSelectedId('');
    }
  }, [orderCustomerPickerRows, orderCustomerSelectedId]);

  useEffect(() => {
    setOrderPage(1);
  }, [orderSearch, accountServiceTab, customerStatusFilter, orderTypeFilter, serviceStatusFilter, orderPageSize]);

  useEffect(() => {
    if (orderPage > orderPageCount) setOrderPage(orderPageCount);
  }, [orderPage, orderPageCount]);

  useEffect(() => {
    if (!orderModalTabs.some((tab) => tab.id === orderModalTab)) {
      setOrderModalTab('order');
    }
  }, [orderModalTab, orderModalTabs]);

  useEffect(() => {
    if (!orderWizardStages.some((stage) => stage.id === orderWizardStage)) {
      setOrderWizardStage('order');
    }
  }, [orderWizardStage, orderWizardStages]);

  function setCatalogServiceType(serviceType) {
    setCatalogForm((current) => {
      const next = { ...current, serviceType };
      if (INTERNET_CATALOG_TYPES.includes(serviceType)) {
        return {
          ...next,
          downloadMbps: current.downloadMbps || '50',
          uploadMbps: current.uploadMbps || '20',
          installFee: '0',
          contractMonths: current.contractMonths || '0',
          billingMode: current.billingMode === 'ONE_TIME' ? 'PREPAID' : current.billingMode
        };
      }
      if (serviceType === 'INSTALLATION') {
        return {
          ...next,
          downloadMbps: '',
          uploadMbps: '',
          monthlyRate: '0',
          installFee: current.installFee || '0',
          contractMonths: '0',
          billingMode: 'ONE_TIME'
        };
      }
      return {
        ...next,
        downloadMbps: '',
        uploadMbps: '',
        installFee: '0',
        contractMonths: '0',
        billingMode: current.billingMode === 'ONE_TIME' ? 'POSTPAID' : current.billingMode
      };
    });
  }

  function openNewCatalogModal() {
    setMessage('');
    setError('');
    setCatalogForm(blankCatalog);
    setIsCatalogModalOpen(true);
  }

  function closeCatalogModal() {
    setIsCatalogModalOpen(false);
    setCatalogForm(blankCatalog);
    setError('');
  }

  function openOrderCustomerPicker() {
    setMessage('');
    setError('');
    setOrderCustomerSearch('');
    setOrderCustomerLocationFilter('ALL');
    setOrderCustomerTypeFilter('ALL');
    setOrderCustomerSelectedId('');
    setOrderTypePickerCustomerId('');
    setOrderTypePickerAccountId('');
    setOrderTypePickerType('');
    setCompletedOrderWizardStageIds([]);
    setIsOrderReviewConfirmed(false);
    setOrderForm({ ...blankOrder, orderDetails: {} });
    setOrderWizardStage('customer');
    setOrderModalTab('order');
    setIsOrderCustomerPickerOpen(false);
    setIsOrderTypePickerOpen(false);
    setIsOrderModalOpen(true);
  }

  function closeOrderCustomerPicker() {
    setIsOrderCustomerPickerOpen(false);
    setOrderCustomerSearch('');
    setOrderCustomerLocationFilter('ALL');
    setOrderCustomerTypeFilter('ALL');
    setOrderCustomerSelectedId('');
  }

  function selectOrderCustomer(customer) {
    setOrderCustomerSelectedId(customer.id);
  }

  function createOrderFromCustomerPicker() {
    if (!selectedOrderPickerCustomer) return;
    const customer = selectedOrderPickerCustomer;
    const customerAccounts = serviceAccountsByCustomer.get(customer.id) || [];
    const fallbackAccount = customerAccounts[0] || null;
    setOrderTypePickerCustomerId(customer.id);
    setOrderTypePickerAccountId(fallbackAccount?.id || '');
    setOrderTypePickerType('');
    setCompletedOrderWizardStageIds((current) => Array.from(new Set([...current, 'customer'])));
    setOrderWizardStage('type');
  }

  function openOrderTypePicker(customer = null, account = null) {
    const baseCustomer = customer || (account?.id ? customerFromServiceAccount(account) : null);
    if (!baseCustomer?.id) return;
    const customerAccounts = serviceAccountsByCustomer.get(baseCustomer.id) || [];
    const fallbackAccount = account?.id ? account : customerAccounts[0] || null;
    setMessage('');
    setError('');
    setOrderTypePickerCustomerId(baseCustomer.id);
    setOrderTypePickerAccountId(fallbackAccount?.id || '');
    setOrderTypePickerType('');
    setOrderCustomerSelectedId(baseCustomer.id);
    setCompletedOrderWizardStageIds([]);
    setIsOrderReviewConfirmed(false);
    setOrderForm({ ...blankOrder, orderDetails: {} });
    setOrderWizardStage('type');
    setOrderModalTab('order');
    setIsOrderCustomerPickerOpen(false);
    setIsOrderTypePickerOpen(false);
    setIsOrderModalOpen(true);
  }

  function closeOrderTypePicker() {
    setIsOrderTypePickerOpen(false);
    setOrderTypePickerCustomerId('');
    setOrderTypePickerAccountId('');
    setOrderTypePickerType('');
  }

  function selectOrderTypeForPicker(orderType) {
    let nextAccountId = orderTypePickerAccountId;
    if (orderType === 'PLAN_DOWNGRADE') {
      const eligibleAccount = orderTypePickerDowngradeAccounts.find((account) => account.id === orderTypePickerAccountId)
        || orderTypePickerDowngradeAccounts[0]
        || null;
      if (!eligibleAccount) return;
      nextAccountId = eligibleAccount.id;
    } else if (orderRequiresServiceAccount(orderType) && !nextAccountId && selectedOrderTypePickerAccounts.length) {
      nextAccountId = selectedOrderTypePickerAccounts[0].id;
    }
    if (nextAccountId !== orderTypePickerAccountId) {
      setOrderTypePickerAccountId(nextAccountId);
    }
    setOrderTypePickerType(orderType);
    setIsOrderReviewConfirmed(false);
  }

  function createOrderFromTypePicker() {
    if (!orderTypePickerCanContinue) return;
    const customer = selectedOrderTypePickerCustomer;
    const selectedType = orderTypePickerType;
    const selectedAccount = orderRequiresServiceAccount(selectedType) ? selectedOrderTypePickerAccount : null;
    openNewOrderModal(customer, selectedAccount, selectedType);
    setCompletedOrderWizardStageIds((current) => Array.from(new Set([...current, 'type'])));
    setOrderWizardStage('order');
  }

  function findInstallLocationByLabel(optionLabel) {
    return locationOptions.find((location) => locationOptionLabel(location) === optionLabel) || null;
  }

  function resolvedInstallationAddress(form = orderForm) {
    if (!orderShowsInstallAddressField(form.orderType)) return form.installAddress || '';
    if (form.installAddressSameAsCustomer !== false) {
      return customerAddressValue(selectedOrderCustomer) || form.installAddress || '';
    }
    const location = locations.find((row) => row.id === form.installLocationId) || findInstallLocationByLabel(form.installLocationLabel);
    return installationAddressFromParts(location, form.installStreetAddress);
  }

  function setInstallationSameAsCustomer(checked) {
    setOrderForm((current) => {
      if (checked) {
        return {
          ...current,
          installAddressSameAsCustomer: true,
          installAddress: customerAddressValue(selectedOrderCustomer),
          installLocationId: '',
          installLocationLabel: '',
          installStreetAddress: ''
        };
      }
      return {
        ...current,
        installAddressSameAsCustomer: false,
        installAddress: '',
        installLocationId: '',
        installLocationLabel: '',
        installStreetAddress: ''
      };
    });
  }

  function setInstallationLocation(optionLabel) {
    const location = findInstallLocationByLabel(optionLabel);
    setOrderForm((current) => ({
      ...current,
      installAddressSameAsCustomer: false,
      installLocationId: location?.id || '',
      installLocationLabel: optionLabel,
      installAddress: location ? installationAddressFromParts(location, current.installStreetAddress) : current.installAddress
    }));
  }

  function setInstallationStreetAddress(installStreetAddress) {
    setOrderForm((current) => {
      const location = locations.find((row) => row.id === current.installLocationId) || findInstallLocationByLabel(current.installLocationLabel);
      return {
        ...current,
        installStreetAddress,
        installAddress: location ? installationAddressFromParts(location, installStreetAddress) : current.installAddress
      };
    });
  }

  function openNewOrderModal(customer = null, account = null, requestedOrderType = null) {
    setMessage('');
    setError('');
    setOrderModalTab('order');
    const nextOrderType = requestedOrderType || (account?.id ? 'PLAN_UPGRADE' : 'NEW_INSTALLATION');
    const safeOrderType = !account?.id && orderRequiresServiceAccount(nextOrderType) ? 'NEW_INSTALLATION' : nextOrderType;
    if (account?.id && safeOrderType !== 'NEW_INSTALLATION') {
      const accountCustomer = customer || customerFromServiceAccount(account);
      const catalogOptions = catalogRowsForOrderType(safeOrderType, activeCatalog, account);
      const selectedCatalog = orderUsesCatalogSelection(safeOrderType)
        ? catalogOptions[0] || null
        : account.catalog || null;
      setOrderForm({
        ...blankOrder,
        customerId: account.customerId || accountCustomer.id || '',
        serviceAccountId: account.id,
        catalogId: orderUsesCatalogSelection(safeOrderType)
          ? selectedCatalog?.id || ''
          : account.catalogId || account.catalog?.id || selectedCatalog?.id || '',
        orderType: safeOrderType,
        installAddress: account.serviceAddress || accountCustomer.address || '',
        installAddressSameAsCustomer: true,
        installLocationId: '',
        installLocationLabel: '',
        installStreetAddress: '',
        serviceReference: account.serviceReference || '',
        orderDetails: detailsForOrderType(
          safeOrderType,
          detailsSeedForCatalog(safeOrderType, selectedCatalog, account),
          seedDetailsForAccount(safeOrderType, account),
          meta.orderDetailSchemas
        )
      });
    } else {
      const catalogOptions = catalogRowsForOrderType('NEW_INSTALLATION', activeCatalog);
      const selectedCatalog = catalogOptions[0] || null;
      setOrderForm(customer?.id
        ? {
          ...blankOrder,
          customerId: customer.id,
          catalogId: selectedCatalog?.id || '',
          orderType: 'NEW_INSTALLATION',
          installAddress: customerAddressValue(customer),
          installAddressSameAsCustomer: true,
          installLocationId: '',
          installLocationLabel: '',
          installStreetAddress: '',
          orderDetails: detailsForOrderType('NEW_INSTALLATION', detailsSeedForCatalog('NEW_INSTALLATION', selectedCatalog), {}, meta.orderDetailSchemas)
        }
        : { ...blankOrder, orderDetails: detailsForOrderType('NEW_INSTALLATION', {}, {}, meta.orderDetailSchemas) });
    }
    setOrderWizardStage('order');
    setIsOrderModalOpen(true);
  }

  function closeOrderModal() {
    setIsOrderModalOpen(false);
    setIsOrderCustomerPickerOpen(false);
    setIsOrderTypePickerOpen(false);
    setOrderForm(blankOrder);
    setOrderCustomerSearch('');
    setOrderCustomerLocationFilter('ALL');
    setOrderCustomerTypeFilter('ALL');
    setOrderCustomerSelectedId('');
    setOrderTypePickerCustomerId('');
    setOrderTypePickerAccountId('');
    setOrderTypePickerType('');
    setCompletedOrderWizardStageIds([]);
    setIsOrderReviewConfirmed(false);
    setOrderWizardStage('customer');
    setError('');
  }

  function editCatalog(item) {
    setMessage('');
    setError('');
    setCatalogForm({
      ...blankCatalog,
      ...item,
      downloadMbps: String(item.downloadMbps || ''),
      uploadMbps: String(item.uploadMbps || ''),
      monthlyRate: String(item.monthlyRate || ''),
      installFee: String(item.installFee || ''),
      contractMonths: String(item.contractMonths || 0)
    });
    setIsCatalogModalOpen(true);
  }

  function editOrder(order) {
    setMessage('');
    setError('');
    setOrderModalTab('order');
    const orderCustomer = customerFromOrder(order);
    const customerAddress = customerAddressValue(orderCustomer);
    const sameAsCustomer = (order.orderType || 'NEW_INSTALLATION') === 'NEW_INSTALLATION'
      ? Boolean(order.installAddress && customerAddress && order.installAddress === customerAddress)
      : true;
    setOrderForm({
      ...blankOrder,
      ...order,
      catalogId: order.catalogId || order.catalog?.id || '',
      serviceAccountId: order.serviceAccountId || order.serviceAccount?.id || '',
      orderType: order.orderType || 'NEW_INSTALLATION',
      status: editableOrderStatus(order.status),
      orderDetails: detailsForOrderType(order.orderType || 'NEW_INSTALLATION', order.orderDetails || {}, seedDetailsForAccount(order.orderType || 'NEW_INSTALLATION', order.serviceAccount), meta.orderDetailSchemas),
      targetActivationDate: order.targetActivationDate || '',
      activationDate: order.activationDate || '',
      billingStartDate: order.billingStartDate || '',
      installAddressSameAsCustomer: sameAsCustomer,
      installLocationId: '',
      installLocationLabel: '',
      installStreetAddress: sameAsCustomer ? '' : order.installAddress || '',
      notes: order.notes || ''
    });
    setOrderWizardStage('order');
    setIsOrderModalOpen(true);
  }

  async function saveCatalog(event) {
    event.preventDefault();
    setError('');
    const body = {
      ...catalogForm,
      downloadMbps: catalogFormIsInternet ? Number(catalogForm.downloadMbps || 0) : 0,
      uploadMbps: catalogFormIsInternet ? Number(catalogForm.uploadMbps || 0) : 0,
      monthlyRate: Number(catalogForm.monthlyRate || 0),
      installFee: catalogFormIsInstallation ? Number(catalogForm.installFee || 0) : 0,
      contractMonths: catalogFormIsInternet ? Number(catalogForm.contractMonths || 0) : 0
    };
    delete body.id;
    try {
      const path = catalogForm.id ? `/service/catalog/${catalogForm.id}` : '/service/catalog';
      const saved = await request(path, { method: catalogForm.id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      setMessage(`${saved.code} saved.`);
      setCatalogForm(blankCatalog);
      setIsCatalogModalOpen(false);
      await load();
      refreshShell();
    } catch (err) {
      setError(err.message);
    }
  }

  async function archiveCatalog(item) {
    if (!window.confirm(`Archive ${item.code}?`)) return;
    setError('');
    try {
      await request(`/service/catalog/${item.id}`, { method: 'DELETE' });
      setMessage(`${item.code} archived.`);
      await load();
      refreshShell();
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveOrder(event) {
    event.preventDefault();
    setError('');
    const isCreatingOrder = !orderForm.id;
    const body = { ...orderForm };
    body.status = isCreatingOrder ? CREATED_ORDER_STATUS : editableOrderStatus(body.status);
    delete body.serviceReference;
    delete body.activationDate;
    if (!body.customerId) {
      setError('Select a customer from the non-service account table before saving.');
      return;
    }
    if (!body.orderType) {
      setError('Select a service order type before saving.');
      return;
    }
    if (shouldShowOrderCatalog && (!body.catalogId || !orderCatalogIsValid)) {
      setError('Select a service catalog item before saving.');
      return;
    }
    if (orderRequiresServiceAccount(body.orderType) && !body.serviceAccountId) {
      setError('Select a service account before saving this service order type.');
      return;
    }
    if (orderShowsInstallAddressField(body.orderType)) {
      const installAddress = resolvedInstallationAddress(body);
      if (!installAddress) {
        setError(body.installAddressSameAsCustomer === false
          ? 'Select an installation location and enter Street/Zone/House#.'
          : 'The selected customer does not have an address. Use a different installation address.');
        return;
      }
      body.installAddress = installAddress;
    }
    if (!shouldShowOrderCatalog && !body.catalogId && selectedOrderAccount) {
      body.catalogId = selectedOrderAccount.catalogId || selectedOrderAccount.catalog?.id || '';
    }
    if (orderDetailMissingFields.length) {
      setError(`Complete required order details before saving: ${orderDetailMissingFields.join(', ')}.`);
      return;
    }
    delete body.installAddressSameAsCustomer;
    delete body.installLocationId;
    delete body.installLocationLabel;
    delete body.installStreetAddress;
    delete body.id;
    try {
      const path = orderForm.id ? `/service/orders/${orderForm.id}` : '/service/orders';
      const saved = await request(path, { method: orderForm.id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      setMessage(`${saved.orderNumber} ${isCreatingOrder ? 'created' : 'updated'}${saved.ticketNumber ? ` with ${saved.ticketNumber}` : ''}.`);
      setOrderForm(blankOrder);
      setIsOrderModalOpen(false);
      setOrderCustomerSearch('');
      setOrderCustomerLocationFilter('ALL');
      setOrderCustomerTypeFilter('ALL');
      setOrderCustomerSelectedId('');
      setOrderTypePickerCustomerId('');
      setOrderTypePickerAccountId('');
      setOrderTypePickerType('');
      setCompletedOrderWizardStageIds([]);
      setIsOrderReviewConfirmed(false);
      setOrderWizardStage('customer');
      await load();
      refreshShell();
    } catch (err) {
      setError(err.message);
    }
  }

  async function cancelOrder(order) {
    if (!canCancelServiceOrder(order)) {
      setError(`${order.orderNumber || 'Service order'} can no longer be cancelled.`);
      return;
    }
    if (!window.confirm(`Cancel ${order.orderNumber}?`)) return;
    setError('');
    try {
      await request(`/service/orders/${order.id}`, { method: 'DELETE' });
      setMessage(`${order.orderNumber} cancelled.`);
      setSelectedServiceOrderId((current) => (current === order.id ? '' : current));
      await load();
      refreshShell();
    } catch (err) {
      setError(err.message);
    }
  }

  function setOrderCatalog(catalogId) {
    const item = catalog.find((row) => row.id === catalogId);
    const seededDetails = detailsSeedForCatalog(orderForm.orderType, item, selectedOrderAccount);
    setOrderForm({
      ...orderForm,
      catalogId,
      billingStartDate: orderForm.billingStartDate || (item?.billingMode === 'PREPAID' ? orderForm.requestedDate : ''),
      orderDetails: detailsForOrderType(
        orderForm.orderType,
        { ...(orderForm.orderDetails || {}), ...seededDetails },
        {},
        meta.orderDetailSchemas
      )
    });
  }

  function setOrderType(orderType) {
    const nextForm = { ...orderForm, orderType };
    if (orderType === 'NEW_INSTALLATION') {
      nextForm.serviceAccountId = '';
      if (!orderForm.id) nextForm.serviceReference = '';
      if (nextForm.installAddressSameAsCustomer !== false) {
        nextForm.installAddress = customerAddressValue(selectedOrderCustomer);
      }
    } else if (!nextForm.serviceAccountId && selectedAccountRow?.account && selectedAccountRow.customer?.id === nextForm.customerId) {
      nextForm.serviceAccountId = selectedAccountRow.account.id;
      nextForm.serviceReference = selectedAccountRow.account.serviceReference || nextForm.serviceReference;
      nextForm.catalogId = nextForm.catalogId || selectedAccountRow.account.catalogId || selectedAccountRow.account.catalog?.id || '';
      nextForm.installAddress = nextForm.installAddress || selectedAccountRow.account.serviceAddress || selectedAccountRow.customer?.address || '';
    }
    const linkedAccount = serviceAccountRecords.find((account) => account.id === nextForm.serviceAccountId) || selectedAccountRow?.account || selectedOrderAccount;
    const catalogOptions = catalogRowsForOrderType(orderType, activeCatalog, linkedAccount);
    const selectedCatalog = orderUsesCatalogSelection(orderType)
      ? catalogOptions.find((item) => item.id === nextForm.catalogId) || catalogOptions[0] || null
      : linkedAccount?.catalog || null;
    nextForm.catalogId = orderUsesCatalogSelection(orderType)
      ? selectedCatalog?.id || ''
      : linkedAccount?.catalogId || linkedAccount?.catalog?.id || nextForm.catalogId || '';
    nextForm.orderDetails = detailsForOrderType(
      orderType,
      {
        ...(orderForm.orderDetails || {}),
        ...detailsSeedForCatalog(orderType, selectedCatalog, linkedAccount)
      },
      seedDetailsForAccount(orderType, linkedAccount),
      meta.orderDetailSchemas
    );
    setOrderForm(nextForm);
  }

  function setOrderDetail(name, value, field = null) {
    setOrderForm((current) => {
      const nextDetails = {
        ...(current.orderDetails || {}),
        [name]: value
      };
      if (field?.type === 'customer' && name === 'newOwnerCustomerId') {
        const owner = customers.find((customer) => customer.id === value);
        nextDetails.newOwnerName = owner ? (owner.name || customerLabel(owner)) : '';
        nextDetails.newOwnerAccountNumber = owner?.accountNumber || '';
        nextDetails.newOwnerContact = owner?.contactNumber || '';
      }
      return {
        ...current,
        orderDetails: nextDetails
      };
    });
  }

  function clearServiceFilters() {
    setCustomerStatusFilter('ALL');
    setOrderTypeFilter('ALL');
    setServiceStatusFilter('ALL');
    setOrderPage(1);
  }

  function selectAccountRow(row) {
    setSelectedAccountId(accountRowId(row));
    setSelectedServiceOrderId('');
  }

  function selectServiceOrder(order) {
    const row = accountRows.find((candidate) => candidate.orders?.some((candidateOrder) => candidateOrder.id === order.id))
      || accountRows.find(({ customer }) => customer.id === (order.customerId || order.customer?.id));
    setSelectedAccountId(row ? accountRowId(row) : `customer:${order.customerId || order.customer?.id || ''}`);
    setSelectedServiceOrderId(order.id);
  }

  function closeServiceSplitView() {
    setSelectedAccountId('');
    setSelectedServiceOrderId('');
  }

  function canOpenOrderWizardStage(stageId) {
    if (stageId === 'customer') return true;
    if (stageId === 'type') return Boolean(selectedOrderPickerCustomer || selectedOrderTypePickerCustomer || orderForm.customerId);
    if (stageId === 'order') return Boolean(orderForm.customerId && orderForm.orderType && orderInstallationAddressReady);
    if (stageId === 'catalog') return Boolean(orderForm.customerId && orderForm.orderType && orderInstallationAddressReady && orderDetailMissingFields.length === 0);
    if (stageId === 'ticket') return Boolean(orderForm.customerId && orderForm.orderType && orderInstallationAddressReady && orderDetailMissingFields.length === 0 && (!shouldShowOrderCatalog || orderCatalogIsValid));
    if (stageId === 'review') return Boolean(orderForm.customerId && orderForm.orderType && orderInstallationAddressReady && orderDetailMissingFields.length === 0 && (!shouldShowOrderCatalog || orderCatalogIsValid));
    return false;
  }

  function goToOrderWizardStage(stageId) {
    if (canOpenOrderWizardStage(stageId)) setOrderWizardStage(stageId);
  }

  function previousOrderWizardStage() {
    const nextIndex = Math.max(0, orderWizardStageIndex - 1);
    setOrderWizardStage(orderWizardStages[nextIndex].id);
  }

  function nextOrderWizardStage() {
    if (currentOrderWizardStage.id === 'customer') {
      createOrderFromCustomerPicker();
      return;
    }
    if (currentOrderWizardStage.id === 'type') {
      createOrderFromTypePicker();
      return;
    }
    if (currentOrderWizardStage.id === 'order') {
      setCompletedOrderWizardStageIds((current) => Array.from(new Set([...current, 'order'])));
    }
    if (currentOrderWizardStage.id === 'catalog') {
      setCompletedOrderWizardStageIds((current) => Array.from(new Set([...current, 'catalog'])));
    }
    if (currentOrderWizardStage.id === 'ticket') {
      setCompletedOrderWizardStageIds((current) => Array.from(new Set([...current, 'ticket'])));
    }
    const nextIndex = Math.min(orderWizardStages.length - 1, orderWizardStageIndex + 1);
    setOrderWizardStage(orderWizardStages[nextIndex].id);
  }

  function renderOrderContextCards() {
    return (
      <div className="service-order-modal-context">
        {selectedOrderCustomer ? (
          <SelectedCustomerCard
            customer={selectedOrderCustomer}
            avatarConfig={avatarConfig}
            context={{
              serviceAccount: selectedOrderAccount,
              serviceOrders: existingOrderMatches,
              hasService: Boolean(selectedOrderAccount)
            }}
          />
        ) : <div className="alert alert-warning mb-0">Select a customer before creating a service order.</div>}
        {selectedOrderAccount && <SelectedServiceAccountCard account={selectedOrderAccount} />}
      </div>
    );
  }

  function renderOrderCustomerPickerControls(autoFocus = false) {
    return (
      <div className="service-customer-picker-controls">
        <div className="service-search service-customer-search">
          <div className="input-icon">
            <span className="input-icon-addon"><IconSearch size={16} /></span>
            <input
              className="form-control"
              autoFocus={autoFocus}
              placeholder="Search customer by name, account, contact, barangay, municipality, or account type"
              value={orderCustomerSearch}
              onChange={(event) => setOrderCustomerSearch(event.target.value)}
            />
            {orderCustomerSearch && (
              <button
                className="service-search-clear"
                type="button"
                aria-label="Clear customer search"
                title="Clear search"
                onClick={() => setOrderCustomerSearch('')}
              >
                <IconX size={14} />
              </button>
            )}
          </div>
        </div>
        <select
          className="form-select service-customer-filter"
          aria-label="Filter customer location"
          value={orderCustomerLocationFilter}
          onChange={(event) => setOrderCustomerLocationFilter(event.target.value)}
        >
          <option value="ALL">All locations</option>
          {orderCustomerLocationOptions.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select>
        <select
          className="form-select service-customer-filter"
          aria-label="Filter account type"
          value={orderCustomerTypeFilter}
          onChange={(event) => setOrderCustomerTypeFilter(event.target.value)}
        >
          <option value="ALL">All account types</option>
          {orderCustomerTypeOptions.map((type) => <option key={type} value={type}>{label(type)}</option>)}
        </select>
      </div>
    );
  }

  function renderOrderCustomerPickerList() {
    return (
      <div className="service-customer-picker-list" aria-label="Customer search results">
        {orderCustomerPickerRows.length ? orderCustomerPickerRows.map((customer) => {
          const selected = orderCustomerSelectedId === customer.id;
          return (
            <button
              className={`service-customer-picker-row ${selected ? 'active' : ''}`}
              key={customer.id}
              type="button"
              onClick={() => selectOrderCustomer(customer)}
            >
              <CustomerEmotionAvatar
                customer={customer}
                avatarConfig={avatarConfig}
                context={{ hasService: (serviceAccountsByCustomer.get(customer.id) || []).length > 0 }}
                size={32}
              />
              <span className="service-customer-picker-row-main">
                <strong>{customerLabel(customer)}</strong>
                <small>{customerLocationLabel(customer)}</small>
              </span>
            </button>
          );
        }) : <div className="service-customer-picker-empty">No matching customers.</div>}
      </div>
    );
  }

  function renderOrderCustomerPickerDetail() {
    const customerOrders = selectedOrderPickerCustomer
      ? ordersByCustomer.get(selectedOrderPickerCustomer.id) || []
      : [];
    return (
      <div className="service-customer-picker-detail">
        {selectedOrderPickerCustomer ? (
          <>
            <SelectedCustomerCard
              customer={selectedOrderPickerCustomer}
              avatarConfig={avatarConfig}
            />
            <div className="service-customer-context-list">
              <div className="service-customer-context-heading">
                <div className="fw-semibold">Service Order Records</div>
                <span className="badge bg-secondary-lt text-secondary">{customerOrders.length} total</span>
              </div>
              {customerOrders.length ? customerOrders.map((order) => (
                <div className="service-customer-context-item" key={order.id}>
                  <span>
                    <strong>{order.orderNumber || order.serviceReference || 'Service order'}</strong>
                    <small>
                      {label(order.orderType || 'NEW_INSTALLATION')} / {order.catalogName || order.catalog?.name || 'No service catalog'} / Requested {order.requestedDate || '-'}
                    </small>
                  </span>
                  <span className={`badge ${statusClass(order.status || 'DRAFT')}`}>{label(order.status || 'DRAFT')}</span>
                </div>
              )) : (
                <div className="service-customer-picker-empty">No service order records yet.</div>
              )}
            </div>
          </>
        ) : (
          <div className="service-customer-picker-empty service-customer-picker-placeholder">
            Select a customer to continue creating a service order.
          </div>
        )}
      </div>
    );
  }

  function renderOrderCustomerStage() {
    return (
      <div className="service-customer-picker">
        {renderOrderCustomerPickerControls(true)}
        <div className="service-customer-picker-layout">
          {renderOrderCustomerPickerList()}
          {renderOrderCustomerPickerDetail()}
        </div>
      </div>
    );
  }

  function renderOrderTypeStage() {
    if (!selectedOrderTypePickerCustomer) {
      return (
        <div className="service-customer-picker-empty service-customer-picker-placeholder">
          Choose a customer first before selecting a service order type.
        </div>
      );
    }

    return (
      <div className="service-customer-picker">
        <SelectedCustomerCard
          customer={selectedOrderTypePickerCustomer}
          avatarConfig={avatarConfig}
          context={{
            serviceAccounts: selectedOrderTypePickerAccounts,
            serviceOrders: selectedOrderTypePickerOrders,
            hasService: selectedOrderTypePickerAccounts.length > 0
          }}
        />
        <div className="service-customer-order-summary">
          <span className="badge bg-blue-lt text-blue">{selectedOrderTypePickerAccounts.length} service account(s)</span>
          <span className="badge bg-yellow-lt text-yellow">{selectedOrderTypePickerOrders.length} service order(s)</span>
          <span className="badge bg-orange-lt text-orange">{selectedOrderTypePickerOrders.filter((order) => OPEN_ORDER_STATUSES.includes(order.status)).length} open</span>
        </div>
        <div className="service-order-type-grid" role="radiogroup" aria-label="Service order type">
          {orderTypeOptions.map((orderType) => {
            const presentation = serviceOrderTypePresentation(orderType);
            const TypeIcon = presentation.icon;
            const requiresAccount = orderRequiresServiceAccount(orderType);
            const disabledReason = requiresAccount && !selectedOrderTypePickerAccounts.length
              ? 'Requires service account'
              : orderType === 'PLAN_DOWNGRADE' && !orderTypePickerDowngradeAccounts.length
                ? 'Already lowest active plan'
                : '';
            const disabled = Boolean(disabledReason);
            const active = orderTypePickerType === orderType;
            return (
              <button
                className={`service-order-type-card ${active ? 'active' : ''}`}
                key={orderType}
                type="button"
                role="radio"
                aria-checked={active}
                title={`${label(orderType)} - ${presentation.description}`}
                disabled={disabled}
                onClick={() => selectOrderTypeForPicker(orderType)}
              >
                <span className="service-order-type-card-header">
                  <span className="service-order-type-icon"><TypeIcon size={20} /></span>
                  <span>
                    <strong>{label(orderType)}</strong>
                  </span>
                  {active && <span className="service-order-type-selected-check" aria-label="Selected"><IconCheck size={14} /></span>}
                </span>
                {disabledReason && <span className="badge bg-yellow-lt text-yellow align-self-start">{disabledReason}</span>}
              </button>
            );
          })}
        </div>
        {orderTypePickerRequiresAccount ? (
          selectedOrderTypePickerAccounts.length ? (
            <div className="service-order-type-target">
              <div>
                <div className="fw-semibold">Target Service Account</div>
                <div className="text-muted small">This request will apply to the selected internet line.</div>
              </div>
              <div className="service-target-options" role="radiogroup" aria-label="Target service account">
                {selectedOrderTypePickerAccounts.map((account) => {
                  const downgradeUnavailable = orderTypePickerType === 'PLAN_DOWNGRADE'
                    && !catalogRowsForOrderType('PLAN_DOWNGRADE', activeCatalog, account).length;
                  return (
                    <button
                      className={`service-target-option ${orderTypePickerAccountId === account.id ? 'active' : ''}`}
                      key={account.id}
                      type="button"
                      role="radio"
                      aria-checked={orderTypePickerAccountId === account.id}
                      disabled={downgradeUnavailable}
                      onClick={() => !downgradeUnavailable && setOrderTypePickerAccountId(account.id)}
                    >
                      <span>
                        <strong>{serviceAccountLabel(account)}</strong>
                        <small>{account.serviceAddress || 'No service address'} / {account.serviceReference || 'No service reference'}</small>
                        {downgradeUnavailable && <small>No lower active catalog plan</small>}
                      </span>
                      <span className={`badge ${statusClass(account.status || 'ACTIVE')}`}>{label(account.status || 'ACTIVE')}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="alert alert-warning mb-0">This service order type needs an existing Service Account. Choose New Installation for customers without service.</div>
          )
        ) : selectedOrderTypePickerAccounts.length ? (
          <div className="alert alert-info mb-0">New Installation creates an additional service line for this customer and does not target an existing Service Account.</div>
        ) : null}
      </div>
    );
  }

  function renderOrderInfoStage() {
    const showInstallAddress = orderShowsInstallAddressField(orderForm.orderType);
    return (
      <div className="service-order-tab-panel">
        {renderOrderContextCards()}
        <div className="service-order-form-panel">
          <div className="service-order-type-heading">
            <div>
              <div className="fw-semibold">Order Information</div>
              <div className="text-muted small">Request dates, priority, service address, and notes.</div>
            </div>
          </div>
          {orderRequiresServiceAccount(orderForm.orderType) && !orderForm.serviceAccountId && (
            <div className="alert alert-warning mb-0">This order type must be started from an existing Service Account.</div>
          )}
          {!shouldShowOrderCatalog && selectedOrderAccount && (
            <div className="alert alert-info mb-0">This order type uses the account's current service catalog: {selectedOrderAccount.catalogName || selectedOrderAccount.catalog?.name || 'Service'}.</div>
          )}
          {isEditingOrder && (
            <div className="service-two-cols">
              <TextField label="Workflow Status" value={label(editableOrderStatus(orderForm.status))} disabled onChange={() => {}} />
              <TextField label="Order Number" value={orderForm.orderNumber || ''} disabled onChange={() => {}} />
            </div>
          )}
          <div className="service-two-cols">
            <TextField label={orderForm.orderType === 'NEW_INSTALLATION' ? 'Requested installation date' : 'Requested Date'} type="date" value={orderForm.requestedDate} onChange={(requestedDate) => setOrderForm({ ...orderForm, requestedDate })} />
            <SelectField label="Priority" value={orderForm.priority} options={meta.orderPriorities || ['NORMAL']} onChange={(priority) => setOrderForm({ ...orderForm, priority })} />
          </div>
          {showInstallAddress && (
            <div className="service-install-address-panel">
              <label className="form-check">
                <input
                  className="form-check-input"
                  type="checkbox"
                  checked={orderForm.installAddressSameAsCustomer !== false}
                  onChange={(event) => setInstallationSameAsCustomer(event.target.checked)}
                />
                <span className="form-check-label">Use customer address as installation address</span>
              </label>
              {orderForm.installAddressSameAsCustomer !== false ? (
                <div className="service-readonly-address">
                  <IconMapPin size={15} />
                  <span>{customerAddressValue(selectedOrderCustomer) || 'No customer address saved.'}</span>
                </div>
              ) : (
                <>
                  <div className="service-two-cols">
                    <div>
                      <label className="form-label">Installation Location</label>
                      <input
                        className="form-control"
                        list="service-install-location-options"
                        placeholder="Search barangay / municipality"
                        value={orderForm.installLocationLabel || ''}
                        onChange={(event) => setInstallationLocation(event.target.value)}
                      />
                      <datalist id="service-install-location-options">
                        {locationOptions.map((location) => (
                          <option key={location.id || locationOptionLabel(location)} value={locationOptionLabel(location)} />
                        ))}
                      </datalist>
                    </div>
                    <TextField label="Street/Zone/House#" value={orderForm.installStreetAddress || ''} onChange={setInstallationStreetAddress} />
                  </div>
                  <div className="service-readonly-address">
                    <IconMapPin size={15} />
                    <span>{resolvedInstallationAddress() || 'Select a location and enter Street/Zone/House#.'}</span>
                  </div>
                </>
              )}
            </div>
          )}
          <ServiceOrderTypeFields
            orderType={orderForm.orderType}
            details={orderForm.orderDetails || {}}
            schemas={meta.orderDetailSchemas}
            status={orderForm.status}
            requiredStatuses={orderDetailRequiredStatuses}
            forceRequired={!isEditingOrder}
            customers={customers}
            currentCustomerId={orderForm.customerId}
            onChange={setOrderDetail}
          />
          <TextField label="Notes" value={orderForm.notes} onChange={(notes) => setOrderForm({ ...orderForm, notes })} />
        </div>
      </div>
    );
  }

  function renderOrderCatalogStage() {
    if (!shouldShowOrderCatalog) {
      return (
        <div className="service-order-tab-panel">
          {renderOrderContextCards()}
          <div className="service-order-form-panel">
            <div className="service-order-type-heading">
              <div>
                <div className="fw-semibold">Service Catalog</div>
                <div className="text-muted small">This request does not require a catalog change.</div>
              </div>
            </div>
            <div className="alert alert-info mb-0">
              {selectedOrderAccount
                ? `This order uses the account's current service catalog: ${selectedOrderAccount.catalogName || selectedOrderAccount.catalog?.name || 'Service'}.`
                : 'The selected service order type does not need a service catalog selection.'}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="service-order-tab-panel">
        {renderOrderContextCards()}
        <div className="service-order-tab-heading">
          <div>
            <div className="fw-semibold">{catalogSelectionTitle(orderForm.orderType)}</div>
            <div className="text-muted small">{catalogSelectionHint(orderForm.orderType)}</div>
          </div>
          {selectedOrderAccount && ['PLAN_UPGRADE', 'PLAN_DOWNGRADE'].includes(orderForm.orderType) && (
            <span className="badge bg-secondary-lt text-secondary">Current: {selectedOrderAccount.catalogName || selectedOrderAccount.catalog?.name || 'Service'}</span>
          )}
        </div>
        <ServiceCatalogPicker
          rows={orderCatalogRows}
          selectedId={orderForm.catalogId}
          onSelect={setOrderCatalog}
          emptyMessage="No active service catalog items match this order type."
        />
      </div>
    );
  }

  function renderOrderTicketStage() {
    const selectedCatalog = catalog.find((item) => item.id === orderForm.catalogId) || selectedOrderAccount?.catalog || {};
    const ticketCategory = SERVICE_ORDER_TICKET_CATEGORY_BY_TYPE[orderForm.orderType] || 'GENERAL';
    const ticketSubject = `${titleLabel(orderForm.orderType || 'NEW_INSTALLATION')} - Service order`;
    return (
      <div className="service-order-tab-panel">
        {renderOrderContextCards()}
        <div className="service-order-form-panel">
          <div className="service-order-type-heading">
            <div>
              <div className="fw-semibold">Ticket</div>
              <div className="text-muted small">Ticketing receives the operations work item after save.</div>
            </div>
            <span className="badge bg-red-lt text-red service-header-icon-badge" title="Ticket" aria-label="Ticket">
              <IconTicket size={16} />
            </span>
          </div>
          <div className="service-detail-grid">
            <DetailRow label="Subject" value={ticketSubject} />
            <DetailRow label="Category" value={label(ticketCategory)} />
            <DetailRow label="Priority" value={label(orderForm.priority || 'NORMAL')} />
            <DetailRow label="Source" value="INTERNAL" />
            <DetailRow label="Due Date" value={orderTargetLabel(orderForm) !== '-' ? orderTargetLabel(orderForm) : orderForm.requestedDate || '-'} />
            <DetailRow label="Service Reference" value={selectedOrderAccount?.serviceReference || 'Generated on save'} />
            <DetailRow label="Service Catalog" value={selectedCatalog.name || selectedOrderAccount?.catalogName || '-'} />
            <DetailRow label="Ticket Status" value="OPEN" />
          </div>
        </div>
      </div>
    );
  }

  function renderOrderReviewStage() {
    const selectedCatalog = catalog.find((item) => item.id === orderForm.catalogId) || selectedOrderAccount?.catalog || {};
    const ticketCategory = SERVICE_ORDER_TICKET_CATEGORY_BY_TYPE[orderForm.orderType] || 'GENERAL';
    const linkedTicketNumber = orderForm.ticketNumber || orderForm.ticket?.ticketNumber;
    const linkedTicketStatus = orderForm.ticketStatus || orderForm.ticket?.status;
    return (
      <div className="service-order-tab-panel">
        {renderOrderContextCards()}
        <div className="service-order-review-grid">
          <div className="service-order-form-panel">
            <div className="fw-semibold">Order Summary</div>
            <DetailRow label="Order Type" value={orderForm.orderType ? label(orderForm.orderType) : '-'} />
            <DetailRow label="Workflow Status" value={label(editableOrderStatus(orderForm.status))} />
            <DetailRow label="Customer" value={selectedOrderCustomer ? customerLabel(selectedOrderCustomer) : '-'} />
            <DetailRow label="Service Account" value={selectedOrderAccount ? serviceAccountLabel(selectedOrderAccount) : 'New installation'} />
            <DetailRow label={orderForm.orderType === 'NEW_INSTALLATION' ? 'Requested installation date' : 'Requested Date'} value={orderForm.requestedDate || '-'} />
            <DetailRow label="Priority" value={label(orderForm.priority || 'NORMAL')} />
          </div>
          <div className="service-order-form-panel">
            <div className="fw-semibold">Service Summary</div>
            <DetailRow label="Service Catalog" value={selectedCatalog.name || selectedOrderAccount?.catalogName || '-'} />
            <DetailRow label={orderAddressLabel(orderForm.orderType)} value={orderAddressSummary(orderForm, selectedOrderAccount) || '-'} />
            <DetailRow label="Notes" value={orderForm.notes || '-'} />
          </div>
          <div className="service-order-form-panel">
            <div className="fw-semibold">Ticket Summary</div>
            <DetailRow label="Ticket" value={isEditingOrder ? valueOrDash(linkedTicketNumber) : 'Created on save'} />
            <DetailRow label="Category" value={label(ticketCategory)} />
            <DetailRow label="Status" value={isEditingOrder ? (linkedTicketStatus ? label(linkedTicketStatus) : '-') : 'OPEN'} />
            <DetailRow label="Source" value="INTERNAL" />
          </div>
        </div>
        <OrderTypeDetailsPreview
          orderType={orderForm.orderType}
          details={orderForm.orderDetails || {}}
          schemas={meta.orderDetailSchemas}
        />
        {shouldShowOrderCatalog && !orderCatalogIsValid && (
          <div className="alert alert-warning mb-0">Select a matching service catalog item in the Service catalog stage.</div>
        )}
        {orderDetailMissingFields.length > 0 && (
          <div className="alert alert-warning mb-0">Complete required fields: {orderDetailMissingFields.join(', ')}.</div>
        )}
        <label className="service-review-confirm">
          <input
            type="checkbox"
            checked={isOrderReviewConfirmed}
            onChange={(event) => {
              setIsOrderReviewConfirmed(event.target.checked);
              if (event.target.checked) {
                setCompletedOrderWizardStageIds(orderWizardStages.map((stage) => stage.id));
              } else {
                setCompletedOrderWizardStageIds((current) => current.filter((stageId) => stageId !== 'review'));
              }
            }}
          />
          <span>I reviewed the customer, order type, service catalog, ticket, and order details.</span>
        </label>
      </div>
    );
  }

  function renderCurrentOrderWizardStage() {
    if (currentOrderWizardStage.id === 'customer') return renderOrderCustomerStage();
    if (currentOrderWizardStage.id === 'type') return renderOrderTypeStage();
    if (currentOrderWizardStage.id === 'catalog') return renderOrderCatalogStage();
    if (currentOrderWizardStage.id === 'ticket') return renderOrderTicketStage();
    if (currentOrderWizardStage.id === 'review') return renderOrderReviewStage();
    return renderOrderInfoStage();
  }

  const metrics = { ...(catalogOverview.metrics || {}), ...(orderOverview.metrics || {}) };
  const orderModalType = orderForm.customerId ? (orderForm.orderType || orderTypePickerType || '') : (orderTypePickerType || orderForm.orderType || '');
  const orderModalTypePresentation = serviceOrderTypePresentation(orderModalType);
  const OrderModalTypeIcon = orderModalTypePresentation.icon;

  return (
    <div className="service-page">
      {message && <div className="alert alert-info">{message}</div>}
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="service-metrics">
        {[
          ['Catalog Items', metrics.catalog_items || 0, IconPackage, 'blue'],
          ['Active Plans', metrics.active_catalog || 0, IconWifi, 'green'],
          ['Service Accounts', metrics.service_accounts || 0, IconUsers, 'cyan'],
          ['Open Orders', metrics.open_orders || 0, IconListDetails, 'yellow'],
          ['Active MRR', money(metrics.monthly_recurring_value || 0), IconWifi, 'orange']
        ].map(([metricLabel, value, Icon, tone]) => (
          <div className="service-metric" key={metricLabel}>
            <span className={`badge bg-${tone}-lt text-${tone}`}><Icon size={18} /></span>
            <div>
              <div className="service-metric-value">{value}</div>
              <div className="text-muted">{metricLabel}</div>
            </div>
          </div>
        ))}
      </div>

      {pageView === 'catalog' && (
        <div className="row row-cards">
          <div className="col-12">
            <Card
              title="Service Catalog"
              icon={IconPackage}
              actions={
                <div className="service-card-actions">
                  <div className="service-search">
                    <div className="input-icon">
                      <span className="input-icon-addon"><IconSearch size={16} /></span>
                      <input className="form-control form-control-sm" placeholder="Search catalog" value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && load(catalogSearch)} />
                    </div>
                  </div>
                  <button className="btn btn-primary btn-sm" type="button" onClick={openNewCatalogModal}><IconPlus size={15} className="me-1" />New Catalog Item</button>
                </div>
              }
            >
              <CatalogTable rows={catalog} onEdit={editCatalog} onArchive={archiveCatalog} />
            </Card>
          </div>
        </div>
      )}

      {pageView === 'orders' && (
        <div className="row row-cards">
          <div className="col-12">
            <div className="service-order-kpis">
              {[
                ['Open Requests', orderQueueStats.open, IconListDetails, 'yellow'],
                ['In Progress', orderQueueStats.inProgress, IconRefresh, 'blue'],
                ['Pending Review', orderQueueStats.pending, IconTicket, 'orange'],
                ['Completed', orderQueueStats.completed, IconCheck, 'green']
              ].map(([metricLabel, value, Icon, tone]) => (
                <div className="service-order-kpi" key={metricLabel}>
                  <span className={`badge bg-${tone}-lt text-${tone}`}><Icon size={18} /></span>
                  <div>
                    <div className="service-metric-value">{value}</div>
                    <div className="text-muted">{metricLabel}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="col-12">
            <Card
              title="Service Order Queue"
              icon={IconListDetails}
              actions={
                <div className="service-card-actions">
                  <div className="service-search">
                    <div className="input-icon">
                      <span className="input-icon-addon"><IconSearch size={16} /></span>
                      <input
                        className="form-control form-control-sm"
                        placeholder="Search order / customer / ticket"
                        value={orderSearch}
                        onChange={(event) => setOrderSearch(event.target.value)}
                        onKeyDown={(event) => event.key === 'Enter' && load(catalogSearch, orderSearch)}
                      />
                    </div>
                  </div>
                  <select className="form-select form-select-sm service-filter-select" aria-label="Service order type" value={orderTypeFilter} onChange={(event) => setOrderTypeFilter(event.target.value)}>
                    <option value="ALL">All order types</option>
                    {(meta.orderTypes || []).map((orderType) => <option key={orderType} value={orderType}>{label(orderType)}</option>)}
                  </select>
                  <select className="form-select form-select-sm service-filter-select" aria-label="Service order status" value={serviceStatusFilter} onChange={(event) => setServiceStatusFilter(event.target.value)}>
                    <option value="ALL">All statuses</option>
                    {(meta.orderStatuses || []).map((status) => <option key={status} value={status}>{label(status)}</option>)}
                  </select>
                  <button className="btn btn-primary btn-sm" type="button" onClick={openOrderCustomerPicker}>
                    <IconPlus size={15} className="me-1" />
                    New Service Order
                  </button>
                </div>
              }
            >
              <ServiceOrdersRegistryTable
                rows={filteredOrderRows}
                selectedOrderId={selectedServiceOrderId}
                onSelectOrder={selectServiceOrder}
                onEdit={editOrder}
                onCancel={cancelOrder}
              />
            </Card>
          </div>
          {selectedServiceOrder && (
            <div className="col-12">
              <ServiceOrderDetailPanel
                order={selectedServiceOrder}
                onEdit={editOrder}
                onCancel={cancelOrder}
                onClose={() => setSelectedServiceOrderId('')}
              />
            </div>
          )}
        </div>
      )}

      {pageView === 'accounts' && (
        <div className="row row-cards">
          <div className="col-12">
            <div className="service-order-kpis">
              {[
                ['Active Service Accounts', activeServiceAccountCount, IconWifi, 'green'],
                ['Total Service Accounts', serviceAccountRows.length, IconUsers, 'cyan'],
                ['Customers Without Service', customersWithoutServiceAccount.length, IconListDetails, 'yellow']
              ].map(([metricLabel, value, Icon, tone]) => (
                <div className="service-order-kpi" key={metricLabel}>
                  <span className={`badge bg-${tone}-lt text-${tone}`}><Icon size={18} /></span>
                  <div>
                    <div className="service-metric-value">{value}</div>
                    <div className="text-muted">{metricLabel}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="col-12">
            <Card
              title="Service Accounts"
              icon={IconWifi}
              actions={
                <div className="service-card-actions">
                  <div className="service-search">
                    <div className="input-icon">
                      <span className="input-icon-addon"><IconSearch size={16} /></span>
                      <input
                        className="form-control form-control-sm"
                        placeholder="Search customer / service"
                        value={orderSearch}
                        onChange={(event) => setOrderSearch(event.target.value)}
                      />
                    </div>
                  </div>
                  <select className="form-select form-select-sm service-filter-select service-show-select" aria-label="Show entries" value={orderPageSize} onChange={(event) => setOrderPageSize(event.target.value)}>
                    {SERVICE_PAGE_SIZE_OPTIONS.map((option) => <option key={option} value={option}>Show {option === 'ALL' ? 'All' : option}</option>)}
                  </select>
                  <button
                    className={`btn btn-sm ${areServiceFiltersOpen || serviceFiltersActive ? 'btn-primary' : 'btn-outline-secondary'}`}
                    type="button"
                    aria-controls="service-accounts-filters"
                    aria-expanded={areServiceFiltersOpen}
                    onClick={() => setAreServiceFiltersOpen((open) => !open)}
                  >
                    <IconFilter size={15} className="me-1" />
                    Filter
                    {serviceFilterCount > 0 && <span className="badge bg-white text-primary ms-2">{serviceFilterCount}</span>}
                  </button>
                  <button className="btn btn-primary btn-sm" type="button" onClick={openOrderCustomerPicker}>
                    <IconPlus size={15} className="me-1" />
                    New Service Request
                  </button>
                </div>
              }
            >
              {areServiceFiltersOpen && (
                <div className="service-filter-panel" id="service-accounts-filters">
                  <div className="service-filter-panel-header">
                    <div>
                      <div className="fw-semibold">Subscription filters</div>
                      <div className="text-muted small">Customer, service account, and related request filters.</div>
                    </div>
                    {serviceFiltersActive && <button className="btn btn-sm btn-outline-secondary" type="button" onClick={clearServiceFilters}>Clear filters</button>}
                  </div>
                  <div className="service-filter-grid">
                    <div>
                      <label className="form-label">Customer status</label>
                      <select className="form-select form-select-sm service-filter-select" aria-label="Customer status" value={customerStatusFilter} onChange={(event) => setCustomerStatusFilter(event.target.value)}>
                        <option value="ALL">All customer statuses</option>
                        {customerStatusOptions.map((status) => <option key={status} value={status}>{label(status)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="form-label">Order type</label>
                      <select className="form-select form-select-sm service-filter-select" aria-label="Service order type" value={orderTypeFilter} onChange={(event) => setOrderTypeFilter(event.target.value)} disabled={isWithoutServiceAccountTab}>
                        <option value="ALL">All order types</option>
                        {(meta.orderTypes || []).map((orderType) => <option key={orderType} value={orderType}>{label(orderType)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="form-label">Order status</label>
                      <select className="form-select form-select-sm service-filter-select" aria-label="Service order status" value={serviceStatusFilter} onChange={(event) => setServiceStatusFilter(event.target.value)} disabled={isWithoutServiceAccountTab}>
                        <option value="ALL">All order statuses</option>
                        {(meta.orderStatuses || []).map((status) => <option key={status} value={status}>{label(status)}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              )}
              <div className="service-account-tabs" role="tablist" aria-label="Service account status">
                {[
                  { value: 'WITH_SERVICE', label: 'With Service', count: serviceAccountTabCounts.WITH_SERVICE, tone: 'green' },
                  { value: 'WITHOUT_SERVICE', label: 'Without Service', count: serviceAccountTabCounts.WITHOUT_SERVICE, tone: 'yellow' }
                ].map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    className={`service-account-tab ${accountServiceTab === tab.value ? 'active' : ''}`}
                    role="tab"
                    aria-selected={accountServiceTab === tab.value}
                    onClick={() => setAccountServiceTab(tab.value)}
                  >
                    <span>{tab.label}</span>
                    <span className={`badge bg-${tab.tone}-lt text-${tab.tone}`}>{tab.count}</span>
                  </button>
                ))}
              </div>
              {selectedAccountRow ? (
                <ServiceOrderSplitView
                  rows={filteredAccountRows}
                  selectedAccountId={selectedAccountId}
                  selectedAccountRow={selectedAccountRow}
                  selectedOrderId={selectedServiceOrderId}
                  selectedOrder={selectedServiceOrder}
                  orderTypeFilter={orderTypeFilter}
                  serviceStatusFilter={serviceStatusFilter}
                  onSelectAccount={selectAccountRow}
                  onSelectOrder={selectServiceOrder}
                  onAddOrder={openOrderTypePicker}
                  onEdit={editOrder}
                  onCancel={cancelOrder}
                  onClose={closeServiceSplitView}
                  avatarConfig={avatarConfig}
                />
              ) : (
                <AccountsTable
                  rows={paginatedAccountRows}
                  selectedAccountId={selectedAccountId}
                  selectedOrderId={selectedServiceOrderId}
                  orderTypeFilter={orderTypeFilter}
                  serviceStatusFilter={serviceStatusFilter}
                  onAddOrder={openOrderTypePicker}
                  onSelectAccount={selectAccountRow}
                  onSelectOrder={selectServiceOrder}
                  avatarConfig={avatarConfig}
                  pagination={{
                    total: filteredAccountRows.length,
                    start: orderPageStart,
                    end: orderPageEnd,
                    page: Math.min(orderPage, orderPageCount),
                    pages: orderPageCount,
                    onPrev: () => setOrderPage((current) => Math.max(1, current - 1)),
                    onNext: () => setOrderPage((current) => Math.min(orderPageCount, current + 1))
                  }}
                />
              )}
            </Card>
          </div>
        </div>
      )}

      {isCatalogModalOpen && (
        <div className="service-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeCatalogModal()}>
          <div className="service-modal" role="dialog" aria-modal="true" aria-labelledby="service-catalog-modal-title">
            <div className="service-modal-header">
              <h3 id="service-catalog-modal-title">{catalogForm.id ? 'Edit Catalog Item' : 'New Catalog Item'}</h3>
              <button className="btn btn-icon" type="button" aria-label="Close" onClick={closeCatalogModal}><IconX size={18} /></button>
            </div>
            <div className="service-modal-body">
              {error && <div className="alert alert-danger">{error}</div>}
              <form className="service-form" onSubmit={saveCatalog}>
                <div className="service-two-cols">
                  <TextField label="Code" value={catalogForm.code} required onChange={(code) => setCatalogForm({ ...catalogForm, code })} />
                  <SelectField label="Status" value={catalogForm.status} options={meta.catalogStatuses || ['ACTIVE']} onChange={(status) => setCatalogForm({ ...catalogForm, status })} />
                </div>
                <TextField label="Name" value={catalogForm.name} required onChange={(name) => setCatalogForm({ ...catalogForm, name })} />
                <div className="service-two-cols">
                  <SelectField label="Service catalog type" value={catalogForm.serviceType} options={meta.serviceTypes || ['FIBER_INTERNET']} onChange={setCatalogServiceType} />
                  <SelectField label="Segment" value={catalogForm.segment} options={meta.segments || ['RESIDENTIAL']} onChange={(segment) => setCatalogForm({ ...catalogForm, segment })} />
                </div>
                <div className="service-catalog-form-note">{catalogFormHelp(catalogForm.serviceType)}</div>
                {catalogFormIsInternet && (
                  <div className="service-two-cols">
                    <TextField label="Download Mbps" type="number" min="0" step="1" value={catalogForm.downloadMbps} required onChange={(downloadMbps) => setCatalogForm({ ...catalogForm, downloadMbps })} />
                    <TextField label="Upload Mbps" type="number" min="0" step="1" value={catalogForm.uploadMbps} required onChange={(uploadMbps) => setCatalogForm({ ...catalogForm, uploadMbps })} />
                  </div>
                )}
                <div className="service-two-cols">
                  <TextField label={catalogFormIsInstallation ? 'One-time Charge' : catalogFormIsAddOn ? 'Monthly Add-on Charge' : 'Monthly Rate'} type="number" min="0" step="0.01" value={catalogFormIsInstallation ? catalogForm.installFee : catalogForm.monthlyRate} required onChange={(value) => setCatalogForm(catalogFormIsInstallation ? { ...catalogForm, installFee: value, monthlyRate: '0' } : { ...catalogForm, monthlyRate: value })} />
                </div>
                <div className="service-two-cols">
                  <SelectField label="Billing Mode" value={catalogForm.billingMode} options={meta.billingModes || ['PREPAID']} onChange={(billingMode) => setCatalogForm({ ...catalogForm, billingMode })} />
                  {catalogFormIsInternet ? (
                    <TextField label="Contract Months" type="number" min="0" max="120" value={catalogForm.contractMonths} onChange={(contractMonths) => setCatalogForm({ ...catalogForm, contractMonths })} />
                  ) : (
                    <TextField label="Scope" value={catalogDisplayMetric(catalogForm)} disabled onChange={() => {}} />
                  )}
                </div>
                <TextField label={catalogFormIsAddOn ? 'Provisioning / Equipment Notes' : 'Equipment Profile'} value={catalogForm.equipmentProfile} onChange={(equipmentProfile) => setCatalogForm({ ...catalogForm, equipmentProfile })} />
                <div>
                  <label className="form-label">Description</label>
                  <textarea className="form-control" rows="2" value={catalogForm.description} onChange={(event) => setCatalogForm({ ...catalogForm, description: event.target.value })} />
                </div>
                <TextField label="Notes" value={catalogForm.notes} onChange={(notes) => setCatalogForm({ ...catalogForm, notes })} />
                <div className="service-form-actions">
                  <button className="btn" type="button" onClick={closeCatalogModal}>Cancel</button>
                  <button className="btn btn-primary" type="submit"><IconDeviceFloppy size={16} className="me-1" />Save</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {isOrderCustomerPickerOpen && (
        <div className="service-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeOrderCustomerPicker()}>
          <div className="service-modal service-customer-order-modal" role="dialog" aria-modal="true" aria-labelledby="service-customer-order-modal-title">
            <div className="service-modal-header">
              <h3 id="service-customer-order-modal-title">New Service Order</h3>
              <button className="btn btn-icon" type="button" aria-label="Close" onClick={closeOrderCustomerPicker}><IconX size={18} /></button>
            </div>
            <div className="service-modal-body">
              <div className="service-customer-picker">
                {renderOrderCustomerPickerControls(true)}
                <div className="service-customer-picker-layout">
                  {renderOrderCustomerPickerList()}
                  {renderOrderCustomerPickerDetail()}
                </div>
                <div className="service-form-actions">
                  <button className="btn" type="button" onClick={closeOrderCustomerPicker}>Cancel</button>
                  <button className="btn btn-primary" type="button" disabled={!selectedOrderPickerCustomer} onClick={createOrderFromCustomerPicker}>
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isOrderTypePickerOpen && (
        <div className="service-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeOrderTypePicker()}>
          <div className="service-modal service-customer-order-modal" role="dialog" aria-modal="true" aria-labelledby="service-order-type-modal-title">
            <div className="service-modal-header">
              <h3 id="service-order-type-modal-title">Choose Service Order Type</h3>
              <button className="btn btn-icon" type="button" aria-label="Close" onClick={closeOrderTypePicker}><IconX size={18} /></button>
            </div>
            <div className="service-modal-body">
              <div className="service-customer-picker">
                {selectedOrderTypePickerCustomer ? (
                  <>
                    <SelectedCustomerCard
                      customer={selectedOrderTypePickerCustomer}
                      avatarConfig={avatarConfig}
                      context={{
                        serviceAccounts: selectedOrderTypePickerAccounts,
                        serviceOrders: selectedOrderTypePickerOrders,
                        hasService: selectedOrderTypePickerAccounts.length > 0
                      }}
                    />
                    <div className="service-customer-order-summary">
                      <span className="badge bg-blue-lt text-blue">{selectedOrderTypePickerAccounts.length} service account(s)</span>
                      <span className="badge bg-yellow-lt text-yellow">{selectedOrderTypePickerOrders.length} service order(s)</span>
                      <span className="badge bg-orange-lt text-orange">{selectedOrderTypePickerOrders.filter((order) => OPEN_ORDER_STATUSES.includes(order.status)).length} open</span>
                    </div>
                    <div className="service-order-type-grid" role="radiogroup" aria-label="Service order type">
                      {orderTypeOptions.map((orderType) => {
                        const presentation = serviceOrderTypePresentation(orderType);
                        const TypeIcon = presentation.icon;
                        const requiresAccount = orderRequiresServiceAccount(orderType);
                        const disabledReason = requiresAccount && !selectedOrderTypePickerAccounts.length
                          ? 'Requires service account'
                          : orderType === 'PLAN_DOWNGRADE' && !orderTypePickerDowngradeAccounts.length
                            ? 'Already lowest active plan'
                            : '';
                        const disabled = Boolean(disabledReason);
                        const active = orderTypePickerType === orderType;
                        return (
                          <button
                            className={`service-order-type-card ${active ? 'active' : ''}`}
                            key={orderType}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            title={`${label(orderType)} - ${presentation.description}`}
                            disabled={disabled}
                            onClick={() => selectOrderTypeForPicker(orderType)}
                          >
                            <span className="service-order-type-card-header">
                              <span className="service-order-type-icon"><TypeIcon size={20} /></span>
                              <span>
                                <strong>{label(orderType)}</strong>
                              </span>
                              {active && <span className="service-order-type-selected-check" aria-label="Selected"><IconCheck size={14} /></span>}
                            </span>
                            {disabledReason && <span className="badge bg-yellow-lt text-yellow align-self-start">{disabledReason}</span>}
                          </button>
                        );
                      })}
                    </div>
                    {orderTypePickerRequiresAccount ? (
                      selectedOrderTypePickerAccounts.length ? (
                        <div className="service-order-type-target">
                          <div>
                            <div className="fw-semibold">Target Service Account</div>
                            <div className="text-muted small">This request will apply to the selected internet line.</div>
                          </div>
                          <div className="service-target-options" role="radiogroup" aria-label="Target service account">
                            {selectedOrderTypePickerAccounts.map((account) => {
                              const downgradeUnavailable = orderTypePickerType === 'PLAN_DOWNGRADE'
                                && !catalogRowsForOrderType('PLAN_DOWNGRADE', activeCatalog, account).length;
                              return (
                                <button
                                  className={`service-target-option ${orderTypePickerAccountId === account.id ? 'active' : ''}`}
                                  key={account.id}
                                  type="button"
                                  role="radio"
                                  aria-checked={orderTypePickerAccountId === account.id}
                                  disabled={downgradeUnavailable}
                                  onClick={() => !downgradeUnavailable && setOrderTypePickerAccountId(account.id)}
                                >
                                  <span>
                                    <strong>{serviceAccountLabel(account)}</strong>
                                    <small>{account.serviceAddress || 'No service address'} / {account.serviceReference || 'No service reference'}</small>
                                    {downgradeUnavailable && <small>No lower active catalog plan</small>}
                                  </span>
                                  <span className={`badge ${statusClass(account.status || 'ACTIVE')}`}>{label(account.status || 'ACTIVE')}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="alert alert-warning mb-0">This service order type needs an existing Service Account. Choose New Installation for customers without service.</div>
                      )
                    ) : selectedOrderTypePickerAccounts.length ? (
                      <div className="alert alert-info mb-0">New Installation creates an additional service line for this customer and does not target an existing Service Account.</div>
                    ) : null}
                  </>
                ) : (
                  <div className="service-customer-picker-empty service-customer-picker-placeholder">
                    Choose a customer first before selecting a service order type.
                  </div>
                )}
                <div className="service-form-actions">
                  <button className="btn" type="button" onClick={closeOrderTypePicker}>Cancel</button>
                  <button className="btn btn-primary" type="button" disabled={!orderTypePickerCanContinue} onClick={createOrderFromTypePicker}>
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isOrderModalOpen && (
        <div className="service-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeOrderModal()}>
          <div className={`service-modal service-order-modal ${isEditingOrder ? '' : 'service-order-wizard-modal'}`} role="dialog" aria-modal="true" aria-labelledby="service-order-modal-title">
            <div className="service-modal-header">
              <div>
                <h3 className="service-order-modal-title" id="service-order-modal-title">
                  <span className="service-order-title-icon"><OrderModalTypeIcon size={18} /></span>
                  <span>{isEditingOrder ? 'Edit Service Order' : 'New Service Order'}</span>
                  <span className={`badge ${orderModalType ? 'bg-blue-lt text-blue' : 'bg-secondary-lt text-secondary'}`}>{orderModalType ? label(orderModalType) : 'Select order type'}</span>
                </h3>
              </div>
              <div className="service-modal-header-actions">
                {!isEditingOrder && <span className="badge bg-blue-lt text-blue">Step {orderWizardStageIndex + 1} of {orderWizardStages.length}</span>}
                <button className="btn btn-icon" type="button" aria-label="Close" onClick={closeOrderModal}><IconX size={18} /></button>
              </div>
            </div>
            <div className="service-modal-body">
              {error && <div className="alert alert-danger">{error}</div>}
              <form className="service-form" onSubmit={saveOrder}>
                <div className="service-order-modal-scroll">
                  {isEditingOrder ? (
                    <>
                      <div className="service-order-modal-tabs" role="tablist" aria-label="Service order sections">
                        {orderModalTabs.map((tab) => (
                          <button
                            className={`service-order-modal-tab ${orderModalTab === tab.id ? 'active' : ''}`}
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={orderModalTab === tab.id}
                            onClick={() => setOrderModalTab(tab.id)}
                          >
                            <span>{tab.label}</span>
                            {tab.badge && <span className="badge bg-yellow-lt text-yellow">{tab.badge}</span>}
                          </button>
                        ))}
                      </div>
                      {orderModalTab === 'order' && renderOrderInfoStage()}
                      {orderModalTab === 'catalog' && shouldShowOrderCatalog && renderOrderCatalogStage()}
                      {orderModalTab === 'review' && renderOrderReviewStage()}
                      {shouldShowOrderCatalog && !orderCatalogIsValid && orderModalTab !== 'catalog' && (
                        <div className="alert alert-warning mb-0">Select a matching service catalog item in the Service catalog tab.</div>
                      )}
                      {orderDetailMissingFields.length > 0 && orderModalTab !== 'review' && (
                        <div className="alert alert-warning mb-0">Complete required fields in the Review tab: {orderDetailMissingFields.join(', ')}.</div>
                      )}
                    </>
                  ) : (
                    <div className="service-order-stage-layout">
                      <div className="service-order-progress" aria-label={`Service order form ${orderWizardProgress}% complete`}>
                        <div className="service-order-progress-track">
                          <span style={{ width: `${orderWizardProgress}%` }} />
                          <strong style={{ left: `clamp(1.125rem, ${orderWizardProgress}%, calc(100% - 1.125rem))` }}>{orderWizardProgress}%</strong>
                        </div>
                      </div>
                      <div className="service-order-stage-nav" role="tablist" aria-label="Service order stages">
                        {orderWizardStages.map((stage, index) => (
                          <button
                            type="button"
                            className={`service-order-stage-button ${currentOrderWizardStage.id === stage.id ? 'active' : ''}`}
                            key={stage.id}
                            onClick={() => goToOrderWizardStage(stage.id)}
                            disabled={!canOpenOrderWizardStage(stage.id)}
                            role="tab"
                            aria-selected={currentOrderWizardStage.id === stage.id}
                            title={stage.description}
                          >
                            <span className={`service-order-stage-indicator ${completedOrderWizardStages[index] ? 'complete' : ''}`}>
                              {completedOrderWizardStages[index] ? <IconCheck size={14} /> : index + 1}
                            </span>
                            <strong>{stage.title}</strong>
                          </button>
                        ))}
                      </div>
                      <div className="service-order-stage-panel">
                        <div className="service-order-stage-heading">
                          <h4>{currentOrderWizardStage.title}</h4>
                          <p>{currentOrderWizardStage.description}</p>
                        </div>
                        {renderCurrentOrderWizardStage()}
                      </div>
                    </div>
                  )}
                </div>

                <div className="service-form-actions service-form-actions-between">
                  <div className="btn-list">
                    {!isEditingOrder && (
                      <button type="button" className="btn" disabled={orderWizardStageIndex === 0} onClick={previousOrderWizardStage}>
                        <IconChevronLeft size={16} className="me-1" />Previous
                      </button>
                    )}
                  </div>
                  <div className="btn-list">
                    <button className="btn" type="button" onClick={closeOrderModal}>Cancel</button>
                    {!isEditingOrder && !isFinalOrderWizardStage ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={(currentOrderWizardStage.id === 'customer' && !selectedOrderPickerCustomer) || (currentOrderWizardStage.id === 'type' && !orderTypePickerCanContinue) || (currentOrderWizardStage.id === 'order' && (!orderInstallationAddressReady || orderDetailMissingFields.length > 0)) || (currentOrderWizardStage.id === 'catalog' && !orderCatalogIsValid)}
                        onClick={nextOrderWizardStage}
                      >
                        Next<IconChevronRight size={16} className="ms-1" />
                      </button>
                    ) : (
                      <button className="btn btn-primary" type="submit" disabled={orderSaveDisabled}>
                        {isEditingOrder ? <IconDeviceFloppy size={16} className="me-1" /> : <IconPlus size={16} className="me-1" />}
                        {isEditingOrder ? 'Update Service Order' : 'Create Service Order'}
                      </button>
                    )}
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Empty() {
  return <div className="empty">No records yet.</div>;
}

function CatalogTable({ rows, onEdit, onArchive }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-responsive">
      <table className="table card-table table-vcenter service-table service-zebra-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Catalog Item</th>
            <th>Service Catalog Type</th>
            <th>Speed / Scope</th>
            <th>Pricing</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td><span className="fw-semibold">{row.code}</span></td>
              <td>
                <div className="fw-semibold">{row.name}</div>
                <div className="text-muted small">{label(row.segment)}</div>
              </td>
              <td><span className="badge bg-blue-lt text-blue">{label(row.serviceType)}</span></td>
              <td>{catalogDisplayMetric(row)}</td>
              <td>{catalogPricingLabel(row)}</td>
              <td><span className={`badge ${statusClass(row.status)}`}>{label(row.status)}</span></td>
              <td className="text-end">
                <button className="btn btn-sm me-1" type="button" onClick={() => onEdit(row)}><IconEdit size={14} /></button>
                <button className="btn btn-sm btn-outline-danger" type="button" onClick={() => onArchive(row)}><IconTrash size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrderTable({ rows, onEdit, onCancel }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-responsive">
      <table className="table card-table table-vcenter service-table service-zebra-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Type</th>
            <th>Service</th>
            <th>Reference</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <div className="fw-semibold">{row.orderNumber}</div>
                <div className="text-muted small">{row.requestedDate}</div>
              </td>
              <td>{customerLabel(row.customer)}</td>
              <td>{label(row.orderType || 'NEW_INSTALLATION')}</td>
              <td>
                <div className="fw-semibold">{row.catalogName || row.catalog?.name}</div>
                <div className="text-muted small">{row.catalogCode || row.catalog?.code}</div>
              </td>
              <td>{row.serviceReference}</td>
              <td><span className={`badge ${statusClass(row.status)}`}>{label(row.status)}</span></td>
              <td className="text-end">
                <button className="btn btn-sm me-1" type="button" onClick={() => onEdit(row)}><IconEdit size={14} /></button>
                {canCancelServiceOrder(row) && (
                  <button className="btn btn-sm btn-outline-danger" type="button" onClick={() => onCancel(row)}><IconTrash size={14} /></button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SelectedCustomerCard({ customer, avatarConfig, context = {} }) {
  return (
    <div className="service-selected-customer">
      <div className="d-flex align-items-center gap-3">
        <CustomerEmotionAvatar customer={customer} avatarConfig={avatarConfig} context={context} size={46} />
        <div>
          <div className="text-muted small">Customer</div>
          <div className="h3 mb-1">{customerLabel(customer)}</div>
          <div className="service-selected-customer-meta">
            <span>{customerFullAddressLabel(customer)}</span>
          </div>
        </div>
      </div>
      <div className="service-selected-customer-badges">
        <span className={`badge ${statusClass(customer.status)}`}>{label(customer.status || 'UNKNOWN')}</span>
      </div>
    </div>
  );
}

function SelectedServiceAccountCard({ account }) {
  const catalog = account.catalog || {};
  return (
    <div className="service-selected-customer">
      <div>
        <div className="text-muted small">Service Account</div>
        <div className="h3 mb-1">{serviceAccountLabel(account)}</div>
        <div className="service-selected-customer-meta">
          <span>{account.serviceReference || 'No service reference'}</span>
          <span>{account.serviceAddress || 'No service address'}</span>
          <span>{Number(catalog.downloadMbps || 0)} / {Number(catalog.uploadMbps || 0)} Mbps</span>
        </div>
      </div>
      <span className={`badge ${statusClass(account.status || 'ACTIVE')}`}>{label(account.status || 'ACTIVE')}</span>
    </div>
  );
}

function ServiceCatalogPicker({ rows, selectedId, onSelect, emptyMessage = 'No active service catalog items.' }) {
  if (!rows.length) return <div className="service-catalog-empty">{emptyMessage}</div>;
  return (
    <div className="table-responsive service-catalog-picker">
      <table className="table card-table table-vcenter service-table service-zebra-table mb-0">
        <thead>
          <tr>
            <th className="w-1" />
            <th>Code</th>
            <th>Service</th>
            <th>Speed / Scope</th>
            <th>Monthly Rate</th>
            <th>Billing</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const selected = selectedId === row.id;
            return (
              <tr className={selected ? 'service-catalog-selected-row' : undefined} key={row.id} onClick={() => onSelect(row.id)}>
                <td>
                  <input
                    className="form-check-input m-0"
                    type="radio"
                    name="serviceCatalogPicker"
                    aria-label={`Select ${row.name}`}
                    checked={selected}
                    onChange={() => onSelect(row.id)}
                  />
                </td>
                <td><span className="fw-semibold">{row.code}</span></td>
                <td>
                  <div className="fw-semibold">{row.name}</div>
                  <div className="text-muted small">{label(row.serviceType)} / {label(row.segment)}</div>
                </td>
                <td>{catalogDisplayMetric(row)}</td>
                <td>{money(row.monthlyRate)}</td>
                <td>{label(row.billingMode)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ServiceOrderTypeFields({ orderType, details, schemas, status, requiredStatuses, forceRequired = false, customers = [], currentCustomerId = '', onChange }) {
  const fields = detailFieldsForType(orderType, schemas);
  if (!fields.length) return null;
  const requiredNow = forceRequired || statusRequiresOrderDetails(status, requiredStatuses);
  const missingFields = forceRequired
    ? missingRequiredOrderDetailLabels(orderType, details, schemas)
    : missingRequiredOrderDetails(orderType, details, status, schemas, requiredStatuses);
  const readinessClass = requiredNow && missingFields.length
    ? 'bg-red-lt text-red'
    : requiredNow ? 'bg-green-lt text-green' : 'bg-secondary-lt text-secondary';
  const customerOptions = customers.filter((customer) => customer.id !== currentCustomerId);
  return (
    <div className="service-order-type-fields">
      <div className="service-order-type-heading">
        <div>
          <div className="fw-semibold">{label(orderType)} Details</div>
          <div className="text-muted small">{requiredNow ? 'Required fields must be complete before this order can continue.' : 'Required fields become mandatory in active workflow statuses.'}</div>
        </div>
        <span className={`badge ${readinessClass}`}>
          {requiredNow ? (missingFields.length ? `${missingFields.length} required missing` : 'Ready') : 'Optional now'}
        </span>
      </div>
      {missingFields.length > 0 && (
        <div className="alert alert-warning mb-0">
          Complete required order details: {missingFields.join(', ')}.
        </div>
      )}
      <div className="service-two-cols">
        {fields.map((field) => {
          const required = requiredNow && Boolean(field.required) && field.type !== 'boolean';
          const fieldLabel = `${field.label}${required ? ' *' : ''}`;
          if (field.type === 'customer') {
            return (
              <SelectField
                key={field.name}
                label={fieldLabel}
                value={details[field.name] ?? ''}
                required={required}
                disabled={Boolean(field.readOnly)}
                onChange={(value) => onChange(field.name, value, field)}
              >
                <option value="">Select Customer Profiling record</option>
                {customerOptions.map((customer) => (
                  <option key={customer.id} value={customer.id}>{customerLabel(customer)}</option>
                ))}
              </SelectField>
            );
          }
          if (field.type === 'boolean') {
            return (
              <label className="form-check service-form-check" key={field.name}>
                <input
                  className="form-check-input"
                  type="checkbox"
                  checked={Boolean(details[field.name])}
                  disabled={Boolean(field.readOnly)}
                  onChange={(event) => onChange(field.name, event.target.checked, field)}
                />
                <span className="form-check-label">{fieldLabel}</span>
              </label>
            );
          }
          return (
            <TextField
              key={field.name}
              label={fieldLabel}
              type={field.type === 'date' ? 'date' : field.type === 'money' ? 'number' : 'text'}
              min={field.type === 'money' ? '0' : undefined}
              step={field.type === 'money' ? '0.01' : undefined}
              required={required}
              disabled={Boolean(field.readOnly)}
              value={details[field.name] ?? ''}
              onChange={(value) => onChange(field.name, value, field)}
            />
          );
        })}
      </div>
    </div>
  );
}

function OrderTypeDetailsPreview({ orderType, details, schemas }) {
  const fields = detailFieldsForType(orderType, schemas);
  if (!fields.length) return null;
  return (
    <div className="service-order-form-panel">
      <div className="fw-semibold">{label(orderType)} Details</div>
      {fields.map((field) => (
        <DetailRow key={field.name} label={field.label} value={formatOrderDetailValue(field, details[field.name], details)} />
      ))}
    </div>
  );
}

function ServiceOrderSplitView({
  rows,
  selectedAccountId,
  selectedAccountRow,
  selectedOrderId,
  selectedOrder,
  orderTypeFilter,
  serviceStatusFilter,
  onSelectAccount,
  onSelectOrder,
  onAddOrder,
  onEdit,
  onCancel,
  onClose,
  avatarConfig
}) {
  function selectRow(row) {
    onSelectAccount(row);
  }

  return (
    <div className="service-split-view">
      <div className="service-split-list">
        <div className="card">
          <div className="card-body p-0">
            <div className="service-table-wrap service-split-list-wrap">
              <table className="table table-vcenter table-hover table-sm mb-0 service-table">
                <thead>
                  <tr>
                    <th>Customer / Subscription</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const { customer, account, accounts = [], orders: customerOrders = [], hasService } = row;
                    const latestOrder = preferredOrderForFilters(customerOrders, orderTypeFilter, serviceStatusFilter);
                    const selected = selectedAccountId === accountRowId(row);
                    return (
                      <tr
                        className={`service-split-row ${selected ? 'table-active' : ''}`}
                        key={accountRowId(row)}
                        role="button"
                        tabIndex={0}
                        onClick={() => selectRow(row)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            selectRow(row);
                          }
                        }}
                      >
                        <td>
                          <div className="d-flex align-items-center gap-2">
                            <CustomerEmotionAvatar customer={customer} avatarConfig={avatarConfig} context={{ serviceAccount: account, serviceOrders: customerOrders, hasService }} size={32} />
                            <div className="fw-semibold">{customerLabel(customer)}</div>
                          </div>
                          {hasService ? (
                            <>
                              <div className="text-muted small">{accounts.length} service account{accounts.length === 1 ? '' : 's'}</div>
                              <div className="text-muted small">
                                {account?.catalogName || account?.catalog?.name || latestOrder?.catalogName || 'Service'} · {label(account?.status || 'ACTIVE')}
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="text-muted small">No service account yet</div>
                              <div className="text-muted small">{customerOrders.length ? `${customerOrders.length} service order request${customerOrders.length === 1 ? '' : 's'}` : 'No service order yet'}</div>
                            </>
                          )}
                          {latestOrder && (
                            <div className="text-muted small">Recent request: {latestOrder.serviceReference || latestOrder.orderNumber}</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!rows.length && (
                    <tr>
                      <td className="text-muted p-3">No accounts in this view.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      <div className="service-split-detail">
        <CustomerAccountDetailPanel
          row={selectedAccountRow}
          selectedOrderId={selectedOrder?.id || selectedOrderId}
          onAddOrder={onAddOrder}
          onSelectOrder={onSelectOrder}
          onEdit={onEdit}
          onCancel={onCancel}
          onClose={onClose}
          avatarConfig={avatarConfig}
        />
      </div>
    </div>
  );
}

function CustomerAccountDetailPanel({ row, selectedOrderId, onAddOrder, onSelectOrder, onEdit, onCancel, onClose, avatarConfig }) {
  const rowKey = accountRowId(row);
  const customer = row?.customer || null;
  const accounts = row?.accounts || (row?.account ? [row.account] : []);
  const primaryAccount = row?.account || primaryServiceAccount(accounts);
  const customerOrders = row?.orders || [];
  const [expandedOrderIds, setExpandedOrderIds] = useState(() => (
    selectedOrderId ? [selectedOrderId] : (customerOrders[0]?.id ? [customerOrders[0].id] : [])
  ));

  useEffect(() => {
    if (selectedOrderId) {
      setExpandedOrderIds((current) => Array.from(new Set([...current, selectedOrderId])));
    } else if (customerOrders[0]?.id) {
      setExpandedOrderIds([customerOrders[0].id]);
    } else {
      setExpandedOrderIds([]);
    }
  }, [rowKey, selectedOrderId]);

  if (!customer) return null;

  const openCount = customerOrders.filter((order) => OPEN_ORDER_STATUSES.includes(order.status)).length;
  const completedCount = customerOrders.filter((order) => order.status === 'COMPLETED').length;
  const hasService = accounts.length > 0;
  const customerContext = {
    serviceAccount: primaryAccount,
    serviceAccounts: accounts,
    serviceOrders: customerOrders,
    hasService
  };

  function toggleOrder(order) {
    onSelectOrder(order);
    setExpandedOrderIds((current) => (
      current.includes(order.id)
        ? current.filter((orderId) => orderId !== order.id)
        : [...current, order.id]
    ));
  }

  return (
    <div className="card service-detail-card">
      <div className="card-body">
        <div className="service-customer-detail-header">
          <div className="service-customer-detail-identity">
            <CustomerEmotionAvatar customer={customer} avatarConfig={avatarConfig} context={customerContext} size={48} />
            <div>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <span className={`badge ${hasService ? 'bg-green-lt text-green' : 'bg-yellow-lt text-yellow'} service-header-icon-badge`} title="Customer Account" aria-label="Customer Account">
                  <IconUsers size={16} />
                </span>
                <h3 className="m-0">{customerLabel(customer)}</h3>
                <span className={`badge ${statusClass(customer.status || 'ACTIVE')}`}>{label(customer.status || 'ACTIVE')}</span>
              </div>
              <div className="text-muted small mt-1">
                <span>{customer.accountNumber || 'No account number'}</span>
                <span className="ms-2">· {customerFullAddressLabel(customer)}</span>
              </div>
            </div>
          </div>
          <div className="service-detail-actions">
            <button className="btn btn-primary btn-sm" type="button" onClick={() => onAddOrder(customer, primaryAccount)}>
              <IconPlus size={14} className="me-1" />{hasService ? 'Create Service Request' : 'Create New Installation'}
            </button>
            <button type="button" className="badge bg-secondary-lt text-secondary service-header-icon-badge border-0" title="Close" aria-label="Close" onClick={onClose}>
              <IconX size={14} />
            </button>
          </div>
        </div>

        <div className="service-detail-panel mt-3">
          <div className="row g-2">
            <div className="col-6 col-lg-3">
              <div className="service-detail-kpi">
                <div className="text-muted small">Service Accounts</div>
                <div className="fw-semibold">{accounts.length}</div>
              </div>
            </div>
            <div className="col-6 col-lg-3">
              <div className="service-detail-kpi">
                <div className="text-muted small">Related Requests</div>
                <div className="fw-semibold">{customerOrders.length} total</div>
              </div>
            </div>
            <div className="col-6 col-lg-3">
              <div className="service-detail-kpi">
                <div className="text-muted small">Open / Completed Requests</div>
                <div className="fw-semibold">{openCount} / {completedCount}</div>
              </div>
            </div>
            <div className="col-6 col-lg-3">
              <div className="service-detail-kpi">
                <div className="text-muted small">Current Service</div>
                <div className="fw-semibold">{primaryAccount?.catalogName || primaryAccount?.catalog?.name || (hasService ? 'Service account' : 'None')}</div>
              </div>
            </div>
          </div>

          <section className="service-detail-section">
            <h4>Service Accounts</h4>
            {accounts.length ? (
              <div className="service-account-mini-list">
                {accounts.map((account) => (
                  <div className="service-account-mini-card" key={account.id}>
                    <div>
                      <div className="fw-semibold">{account.serviceAccountNumber || account.serviceReference}</div>
                      <div className="text-muted small">{account.catalogName || account.catalog?.name || 'Service'} · {account.serviceAddress || customerFullAddressLabel(customer)}</div>
                    </div>
                    <span className={`badge ${statusClass(account.status || 'ACTIVE')}`}>{label(account.status || 'ACTIVE')}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-muted small">This customer does not have a service account yet.</div>
            )}
          </section>

          <section className="service-detail-section">
            <div className="service-customer-context-heading">
              <h4>Service Order History</h4>
              <span className="text-muted small">Latest first</span>
            </div>
            {customerOrders.length ? (
              <div className="service-customer-order-list">
                {customerOrders.map((order) => {
                  const expanded = expandedOrderIds.includes(order.id);
                  const catalog = order.catalog || {};
                  const serviceAccount = order.serviceAccount || accounts.find((account) => account.id === order.serviceAccountId) || {};
                  const readiness = orderReadinessFromOrder(order);
                  return (
                    <div className={`service-customer-order-item ${expanded ? 'active' : ''}`} key={order.id}>
                      <button
                        className="service-customer-order-summary"
                        type="button"
                        onClick={() => toggleOrder(order)}
                        aria-expanded={expanded}
                      >
                        <span className={`service-customer-order-chevron ${expanded ? 'expanded' : ''}`}><IconChevronRight size={16} /></span>
                        <span className="service-customer-order-main">
                          <span className="fw-semibold">{serviceOrderToken(order)}</span>
                          <small>{label(order.orderType || 'NEW_INSTALLATION')} · {order.catalogName || catalog.name || 'Service'} · Requested {valueOrDash(order.requestedDate)}</small>
                        </span>
                        <span className={`badge ${statusClass(order.status)}`}>{label(order.status)}</span>
                      </button>
                      {expanded && (
                        <div className="service-customer-order-expanded">
                          <div className="service-detail-actions">
                            <button className="btn btn-sm" type="button" onClick={() => onEdit(order)}><IconEdit size={14} className="me-1" />Edit</button>
                            {canCancelServiceOrder(order) && (
                              <button className="btn btn-sm btn-outline-danger" type="button" onClick={() => onCancel(order)}><IconTrash size={14} className="me-1" />Cancel</button>
                            )}
                          </div>
                          <div className="service-detail-grid">
                            <DetailRow label="Order Number" value={valueOrDash(order.orderNumber)} />
                            <DetailRow label="Service Reference" value={valueOrDash(order.serviceReference)} />
                            <DetailRow label="Ticket" value={valueOrDash(order.ticketNumber || order.ticket?.ticketNumber)} />
                            <DetailRow label="Ticket Status" value={order.ticketStatus || order.ticket?.status ? label(order.ticketStatus || order.ticket?.status) : '-'} />
                            <DetailRow label="Order Type" value={label(order.orderType || 'NEW_INSTALLATION')} />
                            <DetailRow label="Status" value={label(order.status || 'DRAFT')} />
                            <DetailRow label="Priority" value={label(order.priority || 'NORMAL')} />
                            <DetailRow label="Requested Date" value={valueOrDash(order.requestedDate)} />
                            <DetailRow label="Service Account" value={valueOrDash(serviceAccount.serviceAccountNumber || order.serviceAccountNumber)} />
                            <DetailRow label="Service Address" value={valueOrDash(serviceAccount.serviceAddress || order.installAddress)} />
                            <DetailRow label="Service Catalog" value={valueOrDash(catalog.name || order.catalogName)} />
                            <DetailRow label="Readiness" value={readiness.requiredNow ? (readiness.ready ? 'Ready for processing' : `Missing: ${readiness.missingFields.join(', ')}`) : 'Not required for current status'} />
                            <DetailRow label="Notes" value={valueOrDash(order.notes)} />
                          </div>
                          <OrderTypeDetailsSection order={order} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-muted small">No service orders are linked to this customer yet.</div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function ServiceAccountDetailPanel({ row, onAddOrder, onSelectOrder, onClose, avatarConfig }) {
  if (!row?.account) return null;

  const { account, customer, orders: customerOrders = [] } = row;
  const catalog = account.catalog || {};
  const openCount = customerOrders.filter((order) => OPEN_ORDER_STATUSES.includes(order.status)).length;
  const completedCount = customerOrders.filter((order) => order.status === 'COMPLETED').length;

  return (
    <div className="card service-detail-card">
      <div className="card-body">
        <div className="d-flex align-items-start justify-content-between flex-wrap gap-2">
          <div>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <span className="badge bg-green-lt text-green service-header-icon-badge" title="Service Account" aria-label="Service Account">
                <IconWifi size={16} />
              </span>
              <h3 className="m-0">{account.serviceAccountNumber || account.serviceReference}</h3>
              <span className={`badge ${statusClass(account.status)}`}>{label(account.status)}</span>
              <CustomerEmotionAvatar customer={customer} avatarConfig={avatarConfig} context={{ serviceAccount: account, serviceOrders: customerOrders, hasService: true }} size={36} showLabel />
            </div>
            <div className="text-muted small mt-1">
              <span>{account.serviceReference}</span>
              <span className="ms-2">· {account.catalogName || catalog.name || 'Service'}</span>
              <span className="ms-2">· Activated {valueOrDash(account.activationDate)}</span>
            </div>
          </div>
          <div className="service-detail-actions">
            <button className="btn btn-primary btn-sm" type="button" onClick={() => onAddOrder(customer, account)}>
              <IconPlus size={14} className="me-1" />Create Service Request
            </button>
            <button type="button" className="badge bg-secondary-lt text-secondary service-header-icon-badge border-0" title="Close" aria-label="Close" onClick={onClose}>
              <IconX size={14} />
            </button>
          </div>
        </div>

        <div className="service-detail-panel mt-3">
          <div className="row g-2">
            <div className="col-6 col-lg-3">
              <div className="service-detail-kpi">
                <div className="text-muted small">Current Plan</div>
                <div className="fw-semibold">{account.catalogName || catalog.name || '-'}</div>
              </div>
            </div>
            <div className="col-6 col-lg-3">
              <div className="service-detail-kpi">
                <div className="text-muted small">Monthly Rate</div>
                <div className="fw-semibold">{money(catalog.monthlyRate)}</div>
              </div>
            </div>
            <div className="col-6 col-lg-3">
              <div className="service-detail-kpi">
                <div className="text-muted small">Related Requests</div>
                <div className="fw-semibold">{customerOrders.length} total</div>
              </div>
            </div>
            <div className="col-6 col-lg-3">
              <div className="service-detail-kpi">
                <div className="text-muted small">Open / Completed Requests</div>
                <div className="fw-semibold">{openCount} / {completedCount}</div>
              </div>
            </div>
          </div>

          <section className="service-detail-section">
            <h4>Service Account</h4>
            <DetailRow label="Service Account No." value={valueOrDash(account.serviceAccountNumber)} />
            <DetailRow label="Service Reference" value={valueOrDash(account.serviceReference)} />
            <DetailRow label="Status" value={label(account.status || 'UNKNOWN')} />
            <DetailRow label="Status Reason" value={valueOrDash(account.statusReason)} />
            <DetailRow label="Activation Date" value={valueOrDash(account.activationDate)} />
            <DetailRow label="Suspension Date" value={valueOrDash(account.suspensionDate)} />
            <DetailRow label="Disconnection Date" value={valueOrDash(account.disconnectionDate)} />
            <DetailRow label="Reconnection Date" value={valueOrDash(account.reconnectionDate)} />
            <DetailRow label="Termination Date" value={valueOrDash(account.terminationDate)} />
            <DetailRow label="Service Address" value={valueOrDash(account.serviceAddress)} />
            <DetailRow label="Notes" value={valueOrDash(account.notes)} />
          </section>

          <section className="service-detail-section">
            <h4>Billing Summary</h4>
            <DetailRow label="Billing Status" value={label(account.billingStatus || 'NOT_STARTED')} />
            <DetailRow label="Billing Cycle" value={label(account.billingCycle || 'MONTHLY')} />
            <DetailRow label="Billing Start" value={valueOrDash(account.billingStartDate)} />
            <DetailRow label="Monthly Recurring Charge" value={money(account.monthlyRecurringCharge ?? catalog.monthlyRate)} />
            <DetailRow label="Outstanding Balance" value={money(account.outstandingBalance || 0)} />
            <DetailRow label="Last Payment" value={valueOrDash(account.lastPaymentDate)} />
            <DetailRow label="Next Billing" value={valueOrDash(account.nextBillingDate)} />
          </section>

          <section className="service-detail-section">
            <h4>Installation</h4>
            <DetailRow label="Installation Date" value={valueOrDash(account.installationDate)} />
            <DetailRow label="Installation Ticket" value={valueOrDash(account.installationTicketId || account.ticketNumber)} />
            <DetailRow label="Installed By" value={valueOrDash(account.installedBy)} />
            <DetailRow label="Installation Remarks" value={valueOrDash(account.installationRemarks)} />
          </section>

          <section className="service-detail-section">
            <h4>Customer</h4>
            <DetailRow label="Name" value={customerLabel(customer)} />
            <DetailRow label="Account Number" value={valueOrDash(customer.accountNumber)} />
            <DetailRow label="Contact" value={valueOrDash(customer.contactNumber)} />
            <DetailRow label="Status" value={label(customer.status || 'UNKNOWN')} />
          </section>

          <section className="service-detail-section">
            <h4>Service Catalog</h4>
            <DetailRow label="Service" value={valueOrDash(catalog.name || account.catalogName)} />
            <DetailRow label="Code" value={valueOrDash(catalog.code || account.catalogCode)} />
            <DetailRow label="Type" value={label(catalog.serviceType || '')} />
            <DetailRow label="Segment" value={label(catalog.segment || '')} />
            <DetailRow label="Speed" value={`${Number(catalog.downloadMbps || 0)} / ${Number(catalog.uploadMbps || 0)} Mbps`} />
            <DetailRow label="Billing" value={label(catalog.billingMode || '')} />
          </section>

          <section className="service-detail-section">
            <h4>Network</h4>
            <DetailRow label="PPPoE Username" value={valueOrDash(account.networkInfo?.pppoeUsername)} />
            <DetailRow label="Static IP" value={valueOrDash(account.networkInfo?.staticIp)} />
            <DetailRow label="OLT" value={valueOrDash(account.networkInfo?.olt)} />
            <DetailRow label="NAP Box" value={valueOrDash(account.networkInfo?.napBox)} />
            <DetailRow label="Port / VLAN" value={valueOrDash([account.networkInfo?.port, account.networkInfo?.vlan].filter(Boolean).join(' / '))} />
            <DetailRow label="Bandwidth Profile" value={valueOrDash(account.networkInfo?.bandwidthProfile || catalog.name)} />
          </section>

          <section className="service-detail-section">
            <h4>Equipment</h4>
            <DetailRow label="ONU" value={valueOrDash(account.equipmentInfo?.onuSerialNumber)} />
            <DetailRow label="Router" value={valueOrDash(account.equipmentInfo?.routerSerialNumber)} />
            <DetailRow label="MAC Address" value={valueOrDash(account.equipmentInfo?.macAddress)} />
            <DetailRow label="Ownership" value={valueOrDash(account.equipmentInfo?.ownership)} />
            <DetailRow label="Equipment Status" value={valueOrDash(account.equipmentInfo?.status)} />
            <DetailRow label="Retrieval Required" value={account.equipmentInfo?.retrievalRequired ? 'Yes' : 'No'} />
          </section>

          <section className="service-detail-section">
            <h4>Service Order History</h4>
            {customerOrders.length ? (
              <div className="service-reference-list">
                {customerOrders.map((order) => (
                  <button
                    className={`badge border-0 ${statusClass(order.status)} service-order-chip`}
                    key={order.id}
                    type="button"
                    onClick={() => onSelectOrder(order)}
                  >
                    {order.orderNumber} · {label(order.orderType || 'NEW_INSTALLATION')}
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-muted small">No service orders are linked to this service account yet.</div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function NoServiceAccountPanel({ customer, orders: customerOrders = [], onAddOrder, onSelectOrder, onClose, avatarConfig }) {
  if (!customer) return null;
  const openCount = customerOrders.filter((order) => OPEN_ORDER_STATUSES.includes(order.status)).length;
  return (
    <div className="card service-detail-card">
      <div className="card-body">
        <div className="d-flex align-items-start justify-content-between flex-wrap gap-2">
          <div>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <span className="badge bg-yellow-lt text-yellow service-header-icon-badge" title="Non-service account" aria-label="Non-service account">
                <IconUsers size={16} />
              </span>
              <h3 className="m-0">{customerLabel(customer)}</h3>
              <span className="badge bg-yellow-lt text-yellow">No service account</span>
              <CustomerEmotionAvatar customer={customer} avatarConfig={avatarConfig} context={{ serviceOrders: customerOrders, hasService: false }} size={36} showLabel />
            </div>
            <div className="text-muted small mt-1">
              <span>{customer.contactNumber || 'No contact'}</span>
              <span className="ms-2">· {customer.address || 'No service address'}</span>
            </div>
          </div>
          <div className="service-detail-actions">
            <button className="btn btn-primary btn-sm" type="button" onClick={() => onAddOrder(customer)}>
              <IconPlus size={14} className="me-1" />Create New Installation
            </button>
            <button type="button" className="badge bg-secondary-lt text-secondary service-header-icon-badge border-0" title="Close" aria-label="Close" onClick={onClose}>
              <IconX size={14} />
            </button>
          </div>
        </div>

        <div className="service-detail-panel mt-3">
          <div className="row g-2">
            <div className="col-6 col-lg-3">
              <div className="service-detail-kpi">
                <div className="text-muted small">Account Type</div>
                <div className="fw-semibold">Non-service</div>
              </div>
            </div>
            <div className="col-6 col-lg-3">
              <div className="service-detail-kpi">
                <div className="text-muted small">Related Requests</div>
                <div className="fw-semibold">{customerOrders.length}</div>
              </div>
            </div>
            <div className="col-6 col-lg-3">
              <div className="service-detail-kpi">
                <div className="text-muted small">Customer Status</div>
                <div className="fw-semibold">{label(customer.status || 'UNKNOWN')}</div>
              </div>
            </div>
            <div className="col-6 col-lg-3">
              <div className="service-detail-kpi">
                <div className="text-muted small">Next Action</div>
                <div className="fw-semibold">{openCount ? 'Review open request' : 'Create installation'}</div>
              </div>
            </div>
          </div>

          <section className="service-detail-section">
            <h4>Customer</h4>
            <DetailRow label="Name" value={customerLabel(customer)} />
            <DetailRow label="Account Number" value={valueOrDash(customer.accountNumber)} />
            <DetailRow label="Contact" value={valueOrDash(customer.contactNumber)} />
            <DetailRow label="Address" value={valueOrDash(customer.address)} />
            <DetailRow label="Status" value={label(customer.status || 'UNKNOWN')} />
          </section>

          <section className="service-detail-section">
            <h4>Service Order History</h4>
            {customerOrders.length ? (
              <div className="service-reference-list">
                {customerOrders.map((order) => (
                  <button
                    className={`badge border-0 ${statusClass(order.status)} service-order-chip`}
                    key={order.id}
                    type="button"
                    onClick={() => onSelectOrder(order)}
                  >
                    {order.orderNumber} · {label(order.orderType || 'NEW_INSTALLATION')}
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-muted small">No service orders are linked to this customer yet.</div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function ServiceOrderDetailPanel({ order, onEdit, onCancel, onClose }) {
  if (!order) return null;

  const customer = customerFromOrder(order);
  const catalog = order.catalog || {};
  const account = order.serviceAccount || {};
  const readiness = orderReadinessFromOrder(order);

  return (
    <div className="card service-detail-card">
      <div className="card-body">
        <div className="d-flex align-items-start justify-content-between flex-wrap gap-2">
          <div>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <span className="badge bg-blue-lt text-blue service-header-icon-badge" title="Service Order" aria-label="Service Order">
                <IconListDetails size={16} />
              </span>
              <h3 className="m-0">{order.serviceReference || order.orderNumber}</h3>
              <span className={`badge ${statusClass(order.status)}`}>{label(order.status)}</span>
            </div>
            <div className="text-muted small mt-1">
              <span>{order.orderNumber}</span>
              <span className="ms-2">· {label(order.orderType || 'NEW_INSTALLATION')}</span>
              <span className="ms-2">· {order.catalogName || order.catalog?.name || 'Service'}</span>
              <span className="ms-2">· Requested {valueOrDash(order.requestedDate)}</span>
            </div>
          </div>
          <div className="service-detail-actions">
            <button className="btn btn-sm" type="button" onClick={() => onEdit(order)}><IconEdit size={14} className="me-1" />Edit</button>
            {canCancelServiceOrder(order) && (
              <button className="btn btn-sm btn-outline-danger" type="button" onClick={() => onCancel(order)}><IconTrash size={14} className="me-1" />Cancel</button>
            )}
            <button type="button" className="badge bg-secondary-lt text-secondary service-header-icon-badge border-0" title="Close" aria-label="Close" onClick={onClose}>
              <IconX size={14} />
            </button>
          </div>
        </div>

        <div className="service-detail-panel mt-3">
          <div className="row g-2">
            <div className="col-6 col-lg-3">
              <div className="service-detail-kpi">
                <div className="text-muted small">Order Type</div>
                <div className="fw-semibold">{label(order.orderType || 'NEW_INSTALLATION')}</div>
              </div>
            </div>
            <div className="col-6 col-lg-3">
              <div className="service-detail-kpi">
                <div className="text-muted small">Priority</div>
                <div className="fw-semibold">{label(order.priority)}</div>
              </div>
            </div>
            <div className="col-6 col-lg-3">
              <div className="service-detail-kpi">
                <div className="text-muted small">Request Age</div>
                <div className="fw-semibold">{orderAgeLabel(order)}</div>
              </div>
            </div>
            <div className="col-6 col-lg-3">
              <div className="service-detail-kpi">
                <div className="text-muted small">Target Date</div>
                <div className="fw-semibold">{orderTargetLabel(order)}</div>
              </div>
            </div>
          </div>

          <section className="service-detail-section">
            <h4>Customer</h4>
            <DetailRow label="Name" value={customerLabel(customer)} />
            <DetailRow label="Account Number" value={valueOrDash(customer.accountNumber || order.accountNumber)} />
            <DetailRow label="Contact" value={valueOrDash(customer.contactNumber)} />
            <DetailRow label="Status" value={label(customer.status || 'UNKNOWN')} />
          </section>

          {order.serviceAccountId && (
            <section className="service-detail-section">
              <h4>Service Account</h4>
              <DetailRow label="Service Account No." value={valueOrDash(account.serviceAccountNumber || order.serviceAccountNumber)} />
              <DetailRow label="Service Account Status" value={label(account.status || order.serviceAccountStatus || 'UNKNOWN')} />
              <DetailRow label="Service Reference" value={valueOrDash(account.serviceReference || order.serviceReference)} />
              <DetailRow label="Service Address" value={valueOrDash(account.serviceAddress || order.installAddress)} />
            </section>
          )}

          <section className="service-detail-section">
            <h4>Service Catalog</h4>
            <DetailRow label="Service" value={valueOrDash(catalog.name || order.catalogName)} />
            <DetailRow label="Code" value={valueOrDash(catalog.code || order.catalogCode)} />
            <DetailRow label="Type" value={label(catalog.serviceType || '')} />
            <DetailRow label="Segment" value={label(catalog.segment || '')} />
            <DetailRow label="Billing" value={label(catalog.billingMode || '')} />
            <DetailRow label="Contract" value={`${Number(catalog.contractMonths || 0)} months`} />
            <DetailRow label="Equipment" value={valueOrDash(catalog.equipmentProfile)} />
          </section>

          <OrderTypeDetailsSection order={order} />

          <section className="service-detail-section">
            <h4>Ticket</h4>
            <DetailRow label="Ticket Number" value={valueOrDash(order.ticketNumber || order.ticket?.ticketNumber)} />
            <DetailRow label="Ticket Status" value={order.ticketStatus || order.ticket?.status ? label(order.ticketStatus || order.ticket?.status) : '-'} />
            <DetailRow label="Ticket Subject" value={valueOrDash(order.ticket?.subject)} />
          </section>

          <section className="service-detail-section">
            <h4>Order Readiness</h4>
            <DetailRow
              label="Validation"
              value={readiness.requiredNow ? (readiness.ready ? 'Ready for processing' : 'Missing required details') : 'Not required for current status'}
            />
            <DetailRow label="Missing Fields" value={readiness.missingFields.length ? readiness.missingFields.join(', ') : '-'} />
          </section>

          <section className="service-detail-section">
            <h4>Order Details</h4>
            <DetailRow label="Type" value={label(order.orderType || 'NEW_INSTALLATION')} />
            <DetailRow label="Priority" value={label(order.priority)} />
            <DetailRow label="Activation Date" value={valueOrDash(order.activationDate)} />
            <DetailRow label="Billing Start" value={valueOrDash(order.billingStartDate)} />
            <DetailRow label={orderAddressLabel(order.orderType)} value={valueOrDash(orderAddressSummary(order, account))} />
            <DetailRow label="Notes" value={valueOrDash(order.notes)} />
            <DetailRow label="Created" value={valueOrDash(order.createdAt)} />
            <DetailRow label="Updated" value={valueOrDash(order.updatedAt)} />
          </section>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label: rowLabel, value }) {
  return (
    <div className="service-detail-row">
      <span>{rowLabel}</span>
      <strong>{value}</strong>
    </div>
  );
}

function OrderTypeDetailsSection({ order }) {
  const orderType = order.orderType || 'NEW_INSTALLATION';
  const fields = detailFieldsForType(orderType);
  const details = order.orderDetails || {};
  if (!fields.length) return null;
  return (
    <section className="service-detail-section">
      <h4>{label(orderType)} Details</h4>
      {fields.map((field) => (
        <DetailRow key={field.name} label={field.label} value={formatOrderDetailValue(field, details[field.name], details)} />
      ))}
    </section>
  );
}

function AccountsTable({ rows, selectedAccountId, selectedOrderId, orderTypeFilter, serviceStatusFilter, onAddOrder, onSelectAccount, onSelectOrder, avatarConfig, pagination }) {
  if (!rows.length) return <Empty />;
  return (
    <>
      <div className="service-table-wrap">
        <table className="table card-table table-vcenter table-hover service-table service-zebra-table service-orders-table">
          <thead>
            <tr>
              <th className="service-col-customer">Customer Account</th>
              <th className="service-col-type">Service Status</th>
              <th className="service-col-service">Current Subscription</th>
              <th className="service-col-orders">Recent Request</th>
              <th className="service-col-action text-end" aria-label="Actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const { customer, account, accounts = [], orders: customerOrders, hasService } = row;
              const selectableOrder = preferredOrderForFilters(customerOrders, orderTypeFilter, serviceStatusFilter);
              const openCount = customerOrders.filter((order) => OPEN_ORDER_STATUSES.includes(order.status)).length;
              const completedCount = customerOrders.filter((order) => order.status === 'COMPLETED').length;
              const latestOrder = selectableOrder || customerOrders[0] || null;
              const remainingOrderCount = latestOrder ? Math.max(0, customerOrders.length - 1) : 0;
              const rowId = accountRowId(row);
              const selected = selectedAccountId === rowId || customerOrders.some((order) => order.id === selectedOrderId);
              const rowClassNames = [
                'service-clickable-row',
                hasService ? '' : 'service-no-service-row',
                selected ? 'service-selected-order-row' : ''
              ].filter(Boolean).join(' ');
              const selectAccount = () => onSelectAccount(row);
              return (
                <tr
                  className={rowClassNames || undefined}
                  key={rowId}
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    if (isInteractiveTableTarget(event.target)) return;
                    selectAccount();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      selectAccount();
                    }
                  }}
                >
                  <td className="service-col-customer">
                    <div className="d-flex align-items-center gap-2">
                      <CustomerEmotionAvatar customer={customer} avatarConfig={avatarConfig} context={{ serviceAccount: account, serviceOrders: customerOrders, hasService }} size={34} />
                      <div>
                        <div className="fw-semibold">{customerLabel(customer)}</div>
                        <div className="service-cell-stack text-muted small">
                          <span>{customerFullAddressLabel(customer)}</span>
                          <span>{accounts.length ? `${accounts.length} service account${accounts.length === 1 ? '' : 's'}` : 'No service account'}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="service-col-type">
                    {hasService ? (
                      <div className="service-cell-stack">
                        <span className={`badge ${statusClass(account?.status || 'ACTIVE')}`}>{label(account?.status || 'ACTIVE')}</span>
                        {openCount > 0 && <span className="text-muted small">{openCount} open order{openCount === 1 ? '' : 's'}</span>}
                      </div>
                    ) : (
                      <span className="badge bg-yellow-lt text-yellow">Non-service account</span>
                    )}
                  </td>
                  <td className="service-col-service">
                    {hasService ? (
                      <>
                        <button className="service-order-text-button fw-semibold" type="button" onClick={() => onSelectAccount(row)}>
                          {account?.catalogName || account?.catalog?.name || latestOrder?.catalogName || '-'}
                        </button>
                        <div className="text-muted small">{account?.serviceAccountNumber || account?.serviceReference || 'Service account'}</div>
                        <div className="text-muted small">{completedCount} completed · {openCount} open</div>
                      </>
                    ) : (
                      <>
                        <div className="fw-semibold">No service account yet</div>
                        <div className="text-muted small">{customerOrders.length ? `${customerOrders.length} service request(s)` : 'Needs new installation'}</div>
                      </>
                    )}
                  </td>
                  <td className="service-col-orders">
                    {customerOrders.length ? (
                      <div className="service-order-inline-summary">
                        <div className="service-reference-list">
                          <button
                            className={`badge border-0 ${statusClass(latestOrder.status)} service-order-chip ${selectedOrderId === latestOrder.id ? 'service-order-chip-selected' : ''}`}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onSelectOrder(latestOrder);
                            }}
                          >
                            {serviceOrderToken(latestOrder)}
                          </button>
                          {remainingOrderCount > 0 && (
                            <span className="badge bg-secondary-lt text-secondary service-order-count-badge">+{remainingOrderCount}</span>
                          )}
                        </div>
                        <div className="text-muted small">{label(latestOrder.orderType || 'NEW_INSTALLATION')} · {label(latestOrder.status)}</div>
                      </div>
                    ) : hasService ? <span className="text-muted small">No service requests yet</span> : '-'}
                  </td>
                  <td className="service-col-action text-end">
                    {hasService ? (
                      <div className="service-row-actions">
                        <button
                          className="badge bg-green-lt text-green service-add-order-badge"
                          type="button"
                          title="Create service request"
                          aria-label={`Create service request for ${customerLabel(customer)}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onAddOrder(customer, account);
                          }}
                        >
                          <IconPlus size={14} />
                        </button>
                        <button
                          className="badge bg-blue-lt text-blue service-add-order-badge"
                          type="button"
                          title="View customer account"
                          aria-label={`View service account for ${customerLabel(customer)}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelectAccount(row);
                          }}
                        >
                          <IconEye size={14} />
                        </button>
                      </div>
                    ) : !hasService && (
                      <button
                        className="badge bg-blue-lt text-blue service-add-order-badge"
                        type="button"
                        title="Create new installation"
                        aria-label={`Create new installation for ${customerLabel(customer)}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onAddOrder(customer);
                        }}
                      >
                        <IconPlus size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pagination && (
        <div className="service-table-footer">
          <div className="text-muted small">
            Showing {pagination.total ? pagination.start + 1 : 0}-{pagination.end} of {pagination.total}
          </div>
          <div className="btn-list">
            <button className="btn btn-sm btn-outline-secondary" type="button" disabled={pagination.page <= 1} onClick={pagination.onPrev}>Prev</button>
            <span className="btn btn-sm disabled">Page {pagination.page} of {pagination.pages}</span>
            <button className="btn btn-sm btn-outline-secondary" type="button" disabled={pagination.page >= pagination.pages} onClick={pagination.onNext}>Next</button>
          </div>
        </div>
      )}
    </>
  );
}

function ServiceOrdersRegistryTable({ rows, selectedOrderId, onSelectOrder, onEdit, onCancel }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="service-table-wrap">
      <table className="table card-table table-vcenter table-hover service-table service-zebra-table service-orders-table service-order-registry-table">
        <thead>
          <tr>
            <th>Service Order</th>
            <th>Requester</th>
            <th>Workflow</th>
            <th>Ticket</th>
            <th>Target Account</th>
            <th className="service-col-action text-end" aria-label="Actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((order) => {
            const selected = selectedOrderId === order.id;
            const account = order.serviceAccount || {};
            const catalog = order.catalog || {};
            return (
              <tr
                className={`service-clickable-row ${selected ? 'service-selected-order-row' : ''}`}
                key={order.id}
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  if (isInteractiveTableTarget(event.target)) return;
                  onSelectOrder(order);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectOrder(order);
                  }
                }}
              >
                <td>
                  <div className="fw-semibold">{order.orderNumber}</div>
                  <div className="text-muted small">{label(order.orderType || 'NEW_INSTALLATION')}</div>
                  <div className="text-muted small">{catalog.name || order.catalogName || '-'}</div>
                </td>
                <td>
                  <div className="fw-semibold">{order.customerName || customerLabel(order.customer || {})}</div>
                  <div className="text-muted small">{order.accountNumber || order.customer?.accountNumber || '-'}</div>
                </td>
                <td>
                  <span className={`badge ${statusClass(order.status)}`}>{label(order.status)}</span>
                  <div className="text-muted small">Age: {orderAgeLabel(order)}</div>
                  <div className="text-muted small">Target: {orderTargetLabel(order)}</div>
                </td>
                <td>
                  <div className="fw-semibold">{order.ticketNumber || order.ticket?.ticketNumber || '-'}</div>
                  <div className="text-muted small">{order.ticketStatus || order.ticket?.status ? label(order.ticketStatus || order.ticket?.status) : '-'}</div>
                </td>
                <td>
                  <div className="fw-semibold">{account.serviceAccountNumber || order.serviceAccountNumber || 'New installation'}</div>
                  <div className="text-muted small">{order.serviceReference || account.serviceReference || '-'}</div>
                </td>
                <td className="service-col-action text-end">
                  <div className="service-row-actions">
                    <button className="badge bg-blue-lt text-blue service-add-order-badge" type="button" title="View service order" aria-label={`View ${order.orderNumber}`} onClick={(event) => { event.stopPropagation(); onSelectOrder(order); }}>
                      <IconEye size={14} />
                    </button>
                    <button className="badge bg-secondary-lt text-secondary service-add-order-badge" type="button" title="Edit service order" aria-label={`Edit ${order.orderNumber}`} onClick={(event) => { event.stopPropagation(); onEdit(order); }}>
                      <IconEdit size={14} />
                    </button>
                    {canCancelServiceOrder(order) && (
                      <button className="badge bg-red-lt text-red service-add-order-badge" type="button" title="Cancel service order" aria-label={`Cancel ${order.orderNumber}`} onClick={(event) => { event.stopPropagation(); onCancel(order); }}>
                        <IconTrash size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export { serviceOrderLabel };
