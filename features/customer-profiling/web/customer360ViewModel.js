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
  onboardingVerification: '/api/customer-profiling/customers/{customerId}/onboarding-verifications/{step}',
  serviceCatalog: '/api/service/catalog?status=ACTIVE',
  serviceAccounts: '/api/service/accounts?customerId={customerId}',
  serviceOrders: '/api/service/orders?customerId={customerId}',
  billingSubscriptions: '/api/billing/subscriptions?customerId={customerId}',
  billingInstallationCharges: '/api/billing/installation-charges?customerId={customerId}',
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
    serviceCatalog: [],
    serviceAccounts: [],
    serviceOrders: [],
    subscriptions: [],
    installationCharges: [],
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
    serviceCatalog: normalizeArray(sources.serviceCatalog).sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''))),
    serviceAccounts: normalizeArray(sources.serviceAccounts).sort(byRecentDate),
    serviceOrders: normalizeArray(sources.serviceOrders).sort(byRecentDate),
    subscriptions: normalizeArray(sources.subscriptions).sort(byRecentDate),
    installationCharges: normalizeArray(sources.installationCharges).sort(byRecentDate),
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

export const CUSTOMER_ONBOARDING_STEPS = [
  { id: 'profile', label: 'Customer Profile', owner: 'Customer Profiling' },
  { id: 'serviceability', label: 'Serviceability', owner: 'Network Operations' },
  { id: 'installation-request', label: 'Plan & Installation', owner: 'Service' },
  { id: 'installation-work', label: 'Installation Work', owner: 'Ticketing / Tech Portal' },
  { id: 'activation', label: 'Activation Verification', owner: 'Network / Inventory' },
  { id: 'billing', label: 'Billing Setup', owner: 'Billing' },
  { id: 'complete', label: 'Onboarding Complete', owner: 'Customer Profiling' }
];

const ONBOARDING_DONE_STATES = new Set(['complete', 'not-required']);
const TERMINAL_FAILURE_STATUSES = new Set(['CANCELLED', 'REJECTED']);
const INSTALLATION_DONE_STATUSES = new Set(['COMPLETED']);
const TICKET_DONE_STATUSES = new Set(['RESOLVED', 'CLOSED']);
const TICKET_ATTENTION_STATUSES = new Set(['WAITING_CUSTOMER', 'WAITING_INTERNAL']);
const RESOLVED_INSTALLATION_CHARGE_STATUSES = new Set(['INVOICED', 'WAIVED', 'NO_FEE']);

export function onboardingStateLabel(state) {
  return ({
    complete: 'Complete',
    current: 'Current',
    waiting: 'Waiting',
    'needs-attention': 'Needs Attention',
    blocked: 'Blocked',
    'not-required': 'Not Required',
    'not-started': 'Not Started',
    'permission-denied': 'Permission Required'
  })[state] || 'Not Started';
}

export function onboardingStepSatisfied(step) {
  return ONBOARDING_DONE_STATES.has(step?.state);
}

function onboardingSourceError(errors, keys) {
  return keys.map((key) => errors?.[key]).find(Boolean) || null;
}

function applyOnboardingSourceState(step, errors, keys) {
  if (onboardingStepSatisfied(step)) return step;
  const sourceError = onboardingSourceError(errors, keys);
  if (!sourceError) return step;
  const permissionDenied = sourceError.status === 401 || sourceError.status === 403;
  return {
    ...step,
    state: permissionDenied ? 'permission-denied' : 'needs-attention',
    blockers: [permissionDenied ? 'Your role cannot read the records required for this step.' : sourceError.message || 'The required module data could not be loaded.']
  };
}

function stepRecord(id, state, description, blockers = [], details = {}) {
  const definition = CUSTOMER_ONBOARDING_STEPS.find((step) => step.id === id);
  return {
    ...definition,
    state,
    stateLabel: onboardingStateLabel(state),
    description,
    blockers,
    ...details
  };
}

function customerProfileMissingFields(customer = {}) {
  const fields = [
    ['firstName', 'First name'],
    ['lastName', 'Last name'],
    ['contactNumber', 'Contact number'],
    ['barangay', 'Barangay'],
    ['city', 'City']
  ];
  return fields.filter(([key]) => !String(customer[key] || '').trim()).map(([, label]) => label);
}

function matchingInstallationTicket(tickets, order) {
  if (!order) return null;
  return tickets.find((ticket) => ticket.id && ticket.id === order.ticketId)
    || tickets.find((ticket) => ticket.serviceOrderId && ticket.serviceOrderId === order.id)
    || null;
}

function matchingServiceAccount(accounts, order) {
  if (!order) return accounts.find((account) => normalizeStatus(account.status) === 'ACTIVE') || accounts[0] || null;
  return accounts.find((account) => account.id === order.serviceAccountId)
    || accounts.find((account) => account.serviceReference && account.serviceReference === order.serviceReference)
    || accounts.find((account) => normalizeStatus(account.status) === 'ACTIVE')
    || accounts[0]
    || null;
}

function matchingSubscription(subscriptions, account, order) {
  return subscriptions.find((subscription) => normalizeStatus(subscription.status) === 'ACTIVE' && subscription.serviceAccountId === account?.id)
    || subscriptions.find((subscription) => normalizeStatus(subscription.status) === 'ACTIVE' && subscription.serviceOrderId === order?.id)
    || subscriptions.find((subscription) => normalizeStatus(subscription.status) === 'ACTIVE')
    || null;
}

export function buildCustomerOnboarding(customer = {}, data = emptyCustomer360Data(), errors = {}) {
  const serviceOrders = normalizeArray(data.serviceOrders);
  const tickets = normalizeArray(data.tickets);
  const serviceAccounts = normalizeArray(data.serviceAccounts);
  const subscriptions = normalizeArray(data.subscriptions);
  const installationCharges = normalizeArray(data.installationCharges);
  const invoices = normalizeArray(data.invoices);
  const equipment = normalizeArray(data.equipment);
  const verifications = customer.onboardingVerifications || {};
  const serviceability = verifications.serviceability || {};
  const networkEquipment = verifications.networkEquipment || {};
  const installationOrders = serviceOrders.filter((order) => normalizeStatus(order.orderType || 'NEW_INSTALLATION') === 'NEW_INSTALLATION');
  const installationOrder = installationOrders.find((order) => !TERMINAL_FAILURE_STATUSES.has(normalizeStatus(order.status))) || installationOrders[0] || null;
  const installationTicket = matchingInstallationTicket(tickets, installationOrder);
  const serviceAccount = matchingServiceAccount(serviceAccounts, installationOrder);
  const activeServiceAccount = serviceAccounts.find((account) => normalizeStatus(account.status) === 'ACTIVE') || (normalizeStatus(serviceAccount?.status) === 'ACTIVE' ? serviceAccount : null);
  const activeSubscription = matchingSubscription(subscriptions, activeServiceAccount || serviceAccount, installationOrder);
  const installationCharge = installationCharges.find((charge) => charge.serviceAccountId === (activeServiceAccount || serviceAccount)?.id)
    || installationCharges[0]
    || null;
  const profileMissing = customerProfileMissingFields(customer);
  const profileStep = stepRecord(
    'profile',
    profileMissing.length ? 'needs-attention' : 'complete',
    'Confirm the customer identity, contact details, and service location.',
    profileMissing.length ? [`Complete: ${profileMissing.join(', ')}.`] : [],
    { missingFields: profileMissing }
  );

  const serviceabilityOutcome = normalizeStatus(serviceability.outcome);
  const legacyQualified = Boolean(activeSubscription);
  let serviceabilityStep;
  if (serviceabilityOutcome === 'QUALIFIED') {
    serviceabilityStep = stepRecord('serviceability', 'complete', 'The service location is approved for installation.');
  } else if (legacyQualified) {
    serviceabilityStep = stepRecord('serviceability', 'not-required', 'Existing live service is accepted as serviceability evidence.');
  } else if (serviceabilityOutcome === 'NOT_SERVICEABLE') {
    serviceabilityStep = stepRecord('serviceability', 'blocked', 'The location is not currently serviceable.', ['Installation cannot proceed until serviceability changes.']);
  } else if (serviceabilityOutcome === 'NEEDS_REVIEW') {
    serviceabilityStep = stepRecord('serviceability', 'waiting', 'Network Operations must finish the serviceability assessment.', ['Serviceability is awaiting Network Operations review.']);
  } else {
    serviceabilityStep = stepRecord(
      'serviceability',
      onboardingStepSatisfied(profileStep) ? 'current' : 'not-started',
      'Record the Network Operations serviceability disposition.',
      onboardingStepSatisfied(profileStep) ? ['A serviceability disposition has not been recorded.'] : []
    );
  }

  const orderStatus = normalizeStatus(installationOrder?.status);
  let requestStep;
  if (installationOrder && !TERMINAL_FAILURE_STATUSES.has(orderStatus)) {
    requestStep = stepRecord('installation-request', 'complete', 'A New Installation Service Order and linked ticket have been created.');
  } else if (installationOrder) {
    requestStep = stepRecord('installation-request', 'needs-attention', 'The latest installation request cannot proceed.', [`Service Order is ${orderStatus}. Create a replacement request when appropriate.`]);
  } else {
    requestStep = stepRecord(
      'installation-request',
      onboardingStepSatisfied(profileStep) && onboardingStepSatisfied(serviceabilityStep) ? 'current' : 'not-started',
      'Select the service plan and create the installation request.',
      onboardingStepSatisfied(profileStep) && onboardingStepSatisfied(serviceabilityStep) ? ['No New Installation Service Order exists.'] : []
    );
  }
  requestStep = applyOnboardingSourceState(requestStep, errors, ['serviceOrders', 'serviceCatalog']);

  const ticketStatus = normalizeStatus(installationTicket?.status || installationOrder?.ticketStatus);
  let installationStep;
  if (INSTALLATION_DONE_STATUSES.has(orderStatus) || TICKET_DONE_STATUSES.has(ticketStatus)) {
    installationStep = stepRecord('installation-work', 'complete', 'The installation work has been completed.');
  } else if (TERMINAL_FAILURE_STATUSES.has(orderStatus) || ticketStatus === 'CANCELLED') {
    installationStep = stepRecord('installation-work', 'blocked', 'Installation work was cancelled or rejected.', ['Create or restore a valid installation request before continuing.']);
  } else if (TICKET_ATTENTION_STATUSES.has(ticketStatus) || ['PENDING_REQUIREMENT', 'ON_HOLD'].includes(orderStatus)) {
    installationStep = stepRecord('installation-work', 'needs-attention', 'Installation work needs intervention before it can continue.', [ticketStatus === 'WAITING_CUSTOMER' ? 'The ticket is waiting for the customer.' : 'The ticket is waiting on an internal requirement.']);
  } else if (installationOrder) {
    installationStep = stepRecord('installation-work', 'waiting', 'Track assignment, scheduling, and technician progress on the linked ticket.');
  } else {
    installationStep = stepRecord('installation-work', 'not-started', 'Installation starts after the Service Order is created.');
  }
  installationStep = applyOnboardingSourceState(installationStep, errors, ['serviceOrders', 'tickets']);

  const activationOutcome = normalizeStatus(networkEquipment.outcome);
  const legacyActivation = Boolean(activeSubscription && activeServiceAccount && !activationOutcome);
  let activationStep;
  if (activeServiceAccount && activationOutcome === 'VERIFIED') {
    activationStep = stepRecord('activation', 'complete', 'The active Service Account, network access, and equipment assignment are verified.');
  } else if (legacyActivation) {
    activationStep = stepRecord('activation', 'not-required', 'Existing live billing and service records are accepted as activation evidence.');
  } else if (activationOutcome === 'NEEDS_ATTENTION') {
    activationStep = stepRecord('activation', 'needs-attention', 'Network access or equipment assignment still needs correction.', ['Resolve the recorded activation issue and verify again.']);
  } else if (activeServiceAccount) {
    activationStep = stepRecord('activation', 'current', 'Verify network access and installed equipment before billing starts.', ['Network and equipment verification has not been recorded.']);
  } else if (onboardingStepSatisfied(installationStep)) {
    activationStep = stepRecord('activation', 'waiting', 'Waiting for Service to expose an active Service Account.', ['No active Service Account is available yet.']);
  } else {
    activationStep = stepRecord('activation', 'not-started', 'Activation verification follows completed installation work.');
  }
  activationStep = applyOnboardingSourceState(activationStep, errors, ['serviceAccounts', 'inventoryAssignments']);

  const chargeResolved = RESOLVED_INSTALLATION_CHARGE_STATUSES.has(normalizeStatus(installationCharge?.status));
  let billingStep;
  if (activeSubscription) {
    billingStep = stepRecord('billing', 'complete', 'An active Billing subscription is linked to the Service Account.');
  } else if (!activeServiceAccount) {
    billingStep = stepRecord('billing', 'not-started', 'Billing setup starts after Service Account activation.');
  } else if (!onboardingStepSatisfied(activationStep)) {
    billingStep = stepRecord('billing', 'not-started', 'Billing setup is held until activation verification is complete.');
  } else if (!chargeResolved) {
    billingStep = stepRecord('billing', 'current', 'Resolve the installation fee before starting recurring billing.', ['The installation fee decision is missing.']);
  } else {
    billingStep = stepRecord('billing', 'current', 'Create the recurring Billing subscription.', ['No active Billing subscription is linked to the Service Account.']);
  }
  billingStep = applyOnboardingSourceState(billingStep, errors, ['subscriptions', 'installationCharges', 'invoices']);

  const setupSteps = [profileStep, serviceabilityStep, requestStep, installationStep, activationStep, billingStep];
  const setupComplete = setupSteps.every(onboardingStepSatisfied);
  const customerActive = normalizeStatus(customer.status) === 'ACTIVE';
  const completeStep = stepRecord(
    'complete',
    setupComplete && customerActive ? 'complete' : setupComplete ? 'waiting' : 'not-started',
    setupComplete && customerActive ? 'The customer is active and onboarding has no remaining blockers.' : 'Onboarding closes after all setup gates and customer status synchronization complete.',
    setupComplete && !customerActive ? ['Waiting for Customer Profiling status to synchronize to ACTIVE.'] : []
  );

  const steps = [...setupSteps, completeStep];
  const completedCount = steps.filter(onboardingStepSatisfied).length;
  const currentStep = steps.find((step) => !onboardingStepSatisfied(step)) || completeStep;
  const attentionSteps = steps.filter((step) => ['needs-attention', 'blocked', 'permission-denied'].includes(step.state));

  return {
    steps,
    completedCount,
    totalCount: steps.length,
    progress: Math.round((completedCount / steps.length) * 100),
    currentStepId: currentStep.id,
    currentStep,
    attentionCount: attentionSteps.length,
    blockers: attentionSteps.flatMap((step) => step.blockers.map((blocker) => ({ stepId: step.id, stepLabel: step.label, blocker }))),
    isComplete: onboardingStepSatisfied(completeStep),
    references: {
      installationOrder,
      installationTicket,
      serviceAccount,
      activeServiceAccount,
      activeSubscription,
      installationCharge,
      invoices,
      equipment,
      serviceability,
      networkEquipment
    }
  };
}

function rowsForCustomer(rows, customerId) {
  const stableCustomerId = String(customerId || '').trim();
  if (!stableCustomerId) return [];
  return normalizeArray(rows).filter((row) => (
    String(row?.customerId || row?.customer?.id || '').trim() === stableCustomerId
  ));
}

export function buildCustomerOnboardingProgressMap(customers = [], sources = {}, errors = {}) {
  return Object.fromEntries(normalizeArray(customers).map((customer) => {
    const customerSources = {
      serviceCatalog: sources.serviceCatalog,
      serviceAccounts: rowsForCustomer(sources.serviceAccounts, customer.id),
      serviceOrders: rowsForCustomer(sources.serviceOrders, customer.id),
      subscriptions: rowsForCustomer(sources.subscriptions, customer.id),
      installationCharges: rowsForCustomer(sources.installationCharges, customer.id),
      invoices: rowsForCustomer(sources.invoices, customer.id),
      tickets: rowsForCustomer(sources.tickets, customer.id),
      inventoryAssignments: sources.inventoryAssignments
    };
    const onboarding = buildCustomerOnboarding(customer, buildCustomer360Data(customer, customerSources), errors);
    return [customer.id, {
      completedCount: onboarding.completedCount,
      totalCount: onboarding.totalCount,
      currentStepId: onboarding.currentStepId,
      currentStepLabel: onboarding.currentStep.label,
      attentionCount: onboarding.attentionCount,
      isComplete: onboarding.isComplete
    }];
  }));
}
