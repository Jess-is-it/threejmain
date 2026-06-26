export const CUSTOMER_AVATAR_GENDERS = [
  { id: 'male', label: 'Male' },
  { id: 'female', label: 'Female' }
];

export const CUSTOMER_AVATAR_EMOTIONS = [
  { id: 'neutral', label: 'Neutral', tone: 'blue' },
  { id: 'happy', label: 'Happy', tone: 'green' },
  { id: 'sad', label: 'Sad', tone: 'orange' },
  { id: 'angry', label: 'Angry', tone: 'red' },
  { id: 'offline', label: 'Offline', tone: 'red' },
  { id: 'support', label: 'Support', tone: 'cyan' },
  { id: 'maintenance', label: 'Maintenance', tone: 'yellow' },
  { id: 'warning', label: 'Warning', tone: 'orange' },
  { id: 'resolved', label: 'Resolved', tone: 'green' }
];

export const DEFAULT_CUSTOMER_EMOTION_SETTINGS = {
  thresholds: {
    happy_min: 30,
    warning_max: -15,
    angry_max: -35
  },
  weights: {
    customer_active: 10,
    customer_pending: -6,
    customer_inactive: -18,
    customer_suspended: -35,
    service_active: 18,
    service_pending: -5,
    service_suspended: -38,
    service_disconnected: -45,
    no_service_account: -10,
    open_service_order: -12,
    completed_service_order: 8,
    overdue_billing: -30,
    open_invoice: -10,
    urgent_ticket: -35,
    high_ticket: -22,
    open_ticket: -16,
    resolved_ticket: 14
  }
};

const OPEN_ORDER_STATUSES = new Set(['SUBMITTED', 'PENDING_REQUIREMENT', 'PENDING_REVIEW', 'APPROVED', 'IN_PROGRESS', 'ON_HOLD', 'OPEN', 'WAITING_CUSTOMER', 'WAITING_INTERNAL']);
const CLOSED_TICKET_STATUSES = new Set(['RESOLVED', 'CLOSED', 'CANCELLED']);
const MAINTENANCE_ORDER_TYPES = ['MAINTENANCE', 'REPAIR', 'REPLACEMENT', 'RELOCATION', 'EQUIPMENT'];

function normalizeUpper(value) {
  return String(value || '').trim().toUpperCase().replaceAll('-', '_').replaceAll(' ', '_');
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function mergeEmotionSettings(settings = {}) {
  return {
    thresholds: {
      ...DEFAULT_CUSTOMER_EMOTION_SETTINGS.thresholds,
      ...(settings?.thresholds || {})
    },
    weights: {
      ...DEFAULT_CUSTOMER_EMOTION_SETTINGS.weights,
      ...(settings?.weights || {})
    }
  };
}

function hasNumber(value) {
  return value !== null && value !== undefined && value !== '' && !Number.isNaN(Number(value));
}

function addWeightedSignal(state, key, reason) {
  const weight = Number(state.weights[key] || 0);
  if (!weight) return;
  state.score += weight;
  state.reasons.push({ key, label: reason, weight });
}

function scoreCustomerStatus(state, customer = {}) {
  const status = normalizeUpper(customer.status);
  if (status === 'ACTIVE') addWeightedSignal(state, 'customer_active', 'Customer is active');
  if (status === 'PENDING') addWeightedSignal(state, 'customer_pending', 'Customer is pending');
  if (status === 'INACTIVE') addWeightedSignal(state, 'customer_inactive', 'Customer is inactive');
  if (status === 'SUSPENDED') {
    addWeightedSignal(state, 'customer_suspended', 'Customer is suspended');
    state.flags.offline = true;
  }
}

function scoreServiceStatus(state, account) {
  const status = normalizeUpper(account?.status);
  if (!status) return;
  if (status === 'ACTIVE') addWeightedSignal(state, 'service_active', 'Service account is active');
  if (['PENDING', 'REQUESTED', 'DRAFT'].includes(status)) addWeightedSignal(state, 'service_pending', 'Service account is pending');
  if (['SUSPENDED', 'ON_HOLD'].includes(status)) {
    addWeightedSignal(state, 'service_suspended', 'Service account is suspended');
    state.flags.offline = true;
  }
  if (['DISCONNECTED', 'TERMINATED', 'RETIRED', 'CANCELLED'].includes(status)) {
    addWeightedSignal(state, 'service_disconnected', 'Service account is disconnected');
    state.flags.offline = true;
  }
}

function scoreServiceOrders(state, serviceOrders = []) {
  const openOrders = serviceOrders.filter((order) => OPEN_ORDER_STATUSES.has(normalizeUpper(order.status)));
  openOrders.slice(0, 3).forEach(() => addWeightedSignal(state, 'open_service_order', 'Open service order'));
  serviceOrders
    .filter((order) => normalizeUpper(order.status) === 'COMPLETED')
    .slice(0, 2)
    .forEach(() => addWeightedSignal(state, 'completed_service_order', 'Completed service order'));

  if (openOrders.length) state.flags.support = true;
  if (openOrders.some((order) => MAINTENANCE_ORDER_TYPES.some((term) => normalizeUpper(order.orderType || order.category || order.subject).includes(term)))) {
    state.flags.maintenance = true;
  }
  if (serviceOrders.some((order) => normalizeUpper(order.status) === 'COMPLETED')) {
    state.flags.resolved = true;
  }
}

function scoreBilling(state, billingInputs = []) {
  billingInputs.forEach((item) => {
    if (!item) return;
    if (hasNumber(item.overdueTotal) && Number(item.overdueTotal) > 0) {
      addWeightedSignal(state, 'overdue_billing', 'Overdue billing balance');
      state.flags.warning = true;
    }
    if (normalizeUpper(item.status) === 'OVERDUE') {
      addWeightedSignal(state, 'overdue_billing', 'Overdue invoice');
      state.flags.warning = true;
    }
    if (hasNumber(item.openInvoices) && Number(item.openInvoices) > 0) {
      addWeightedSignal(state, 'open_invoice', 'Open invoice');
    }
  });
}

function scoreTickets(state, tickets = []) {
  tickets.forEach((ticket) => {
    const status = normalizeUpper(ticket.status);
    const priority = normalizeUpper(ticket.priority);
    if (CLOSED_TICKET_STATUSES.has(status)) {
      if (status === 'RESOLVED' || status === 'CLOSED') {
        addWeightedSignal(state, 'resolved_ticket', 'Resolved ticket');
        state.flags.resolved = true;
      }
      return;
    }
    if (priority === 'URGENT') {
      addWeightedSignal(state, 'urgent_ticket', 'Urgent ticket');
      state.flags.angry = true;
    } else if (priority === 'HIGH') {
      addWeightedSignal(state, 'high_ticket', 'High priority ticket');
      state.flags.warning = true;
    } else {
      addWeightedSignal(state, 'open_ticket', 'Open ticket');
      state.flags.support = true;
    }
  });
}

export function normalizeCustomerGender(customer = {}) {
  const gender = String(customer.gender || customer.sex || customer.customerGender || '').trim().toLowerCase();
  return gender === 'female' || gender === 'f' || gender === 'woman' ? 'female' : 'male';
}

export function resolveCustomerEmotion(input = {}, settings = {}) {
  const merged = mergeEmotionSettings(settings);
  const state = {
    score: 0,
    reasons: [],
    flags: {},
    weights: merged.weights
  };
  const customer = input.customer || input.customerRecord || input;
  const serviceAccounts = toArray(input.serviceAccounts || input.accounts);
  const serviceAccount = input.serviceAccount || input.account || serviceAccounts[0] || null;
  const serviceOrders = toArray(input.serviceOrders || input.orders || input.order);
  const billingInputs = [
    ...toArray(input.billing),
    ...toArray(input.balance),
    ...toArray(input.invoice),
    ...toArray(input.invoices)
  ];
  const tickets = toArray(input.tickets || input.ticket);

  scoreCustomerStatus(state, customer);
  if (serviceAccount) {
    scoreServiceStatus(state, serviceAccount);
  } else if (input.hasService === false) {
    addWeightedSignal(state, 'no_service_account', 'No service account yet');
  }
  scoreServiceOrders(state, serviceOrders);
  scoreBilling(state, billingInputs);
  scoreTickets(state, tickets);

  const thresholds = merged.thresholds;
  let emotionId = 'neutral';
  if (state.flags.angry || state.score <= thresholds.angry_max) emotionId = 'angry';
  else if (state.flags.offline && state.score <= thresholds.warning_max) emotionId = 'offline';
  else if (state.flags.maintenance && state.score <= thresholds.happy_min) emotionId = 'maintenance';
  else if (state.flags.warning || state.score <= thresholds.warning_max) emotionId = 'warning';
  else if (state.flags.support && state.score < thresholds.happy_min) emotionId = 'support';
  else if (state.flags.resolved && state.score >= 0) emotionId = 'resolved';
  else if (state.score >= thresholds.happy_min) emotionId = 'happy';

  const moodBand = state.score >= thresholds.happy_min
    ? 'happy'
    : state.score <= thresholds.angry_max ? 'angry' : 'neutral';
  const emotion = CUSTOMER_AVATAR_EMOTIONS.find((item) => item.id === emotionId) || CUSTOMER_AVATAR_EMOTIONS[0];

  return {
    emotionId,
    label: emotion.label,
    tone: emotion.tone,
    moodBand,
    score: Math.max(-100, Math.min(100, Math.round(state.score))),
    reasons: state.reasons
  };
}

export function selectCustomerAvatar(avatarConfig, emotionId, gender = 'male') {
  const emotions = avatarConfig?.emotions || [];
  const normalizedGender = gender === 'female' ? 'female' : 'male';
  const exact = emotions.find((emotion) => emotion.id === emotionId);
  const neutral = emotions.find((emotion) => emotion.id === 'neutral');
  return exact?.avatars?.[normalizedGender]
    || exact?.avatar
    || exact?.avatars?.male
    || exact?.avatars?.female
    || neutral?.avatars?.[normalizedGender]
    || neutral?.avatar
    || neutral?.avatars?.male
    || neutral?.avatars?.female
    || null;
}

export function customerInitials(customer = {}) {
  const name = customer.name || customer.fullName || [customer.firstName, customer.lastName].filter(Boolean).join(' ');
  const words = String(name || customer.accountNumber || 'C').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join('') || 'C';
}

export function customerAvatarViewModel(input = {}, avatarConfig = null) {
  const customer = input.customer || input.customerRecord || input;
  const gender = normalizeCustomerGender(customer);
  const emotion = resolveCustomerEmotion(input, avatarConfig?.emotion_settings);
  const avatar = selectCustomerAvatar(avatarConfig, emotion.emotionId, gender);
  return {
    ...emotion,
    gender,
    avatar,
    initials: customerInitials(customer)
  };
}
