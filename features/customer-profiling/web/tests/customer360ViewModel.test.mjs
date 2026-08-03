import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CUSTOMER_360_TABS,
  buildCustomerOnboarding,
  buildCustomerOnboardingProgressMap,
  buildCustomer360Data,
  customer360SectionState,
  emptyCustomer360Data,
  filterCustomerActivity,
  filterCustomerEquipment,
  hasCustomer360TabData,
  isOpenInvoice
} from '../customer360ViewModel.js';

const customer = {
  id: 'customer-1',
  accountNumber: 'ACC-001',
  fullName: 'Ada Lovelace',
  firstName: 'Ada',
  lastName: 'Lovelace',
  contactNumber: '09170000001',
  barangay: 'Alibago',
  city: 'Enrile',
  status: 'PENDING'
};

test('Customer 360 keeps onboarding outside the detail tab set', () => {
  assert.equal(CUSTOMER_360_TABS.some((tab) => tab.value === 'onboarding'), false);
  assert.equal(CUSTOMER_360_TABS[0].value, 'overview');
});

test('buildCustomer360Data keeps customer tab data scoped by stable identifiers', () => {
  const data = buildCustomer360Data(customer, {
    subscriptions: [{ id: 'sub-1', customerId: 'customer-1', status: 'ACTIVE', createdAt: '2026-07-02T00:00:00Z' }],
    invoices: [
      { id: 'inv-paid', status: 'PAID', balance: 0, createdAt: '2026-07-01T00:00:00Z' },
      { id: 'inv-open', status: 'ISSUED', balance: 300, createdAt: '2026-07-03T00:00:00Z' },
      { id: 'inv-overdue', status: 'OVERDUE', balance: 500, createdAt: '2026-07-04T00:00:00Z' }
    ],
    inventoryAssignments: [
      { id: 'asset-1', customerId: 'customer-1', serialNumber: 'ONU-A1001', createdAt: '2026-07-05T00:00:00Z' },
      { id: 'asset-2', customerId: 'other-customer', serialNumber: 'ONU-A1002', createdAt: '2026-07-06T00:00:00Z' }
    ],
    posSales: [
      { id: 'sale-1', customerId: 'customer-1', receiptNumber: 'OR-001', createdAt: '2026-07-05T00:00:00Z' },
      { id: 'sale-2', customerId: 'other-customer', receiptNumber: 'OR-002', createdAt: '2026-07-06T00:00:00Z' }
    ],
    auditLogs: [
      { id: 'log-1', target_id: 'customer-1', action: 'customer_updated', created_at: '2026-07-06T00:00:00Z' },
      { id: 'log-2', target_id: 'invoice-1', details: { customerId: 'customer-1' }, action: 'billing_invoice_generated', created_at: '2026-07-07T00:00:00Z' },
      { id: 'log-3', target_id: 'other-customer', action: 'customer_updated', created_at: '2026-07-08T00:00:00Z' }
    ]
  });

  assert.equal(data.subscriptions.length, 1);
  assert.deepEqual(data.openInvoices.map((row) => row.id), ['inv-overdue', 'inv-open']);
  assert.deepEqual(data.overdueInvoices.map((row) => row.id), ['inv-overdue']);
  assert.deepEqual(data.equipment.map((row) => row.id), ['asset-1']);
  assert.deepEqual(data.posSales.map((row) => row.id), ['sale-1']);
  assert.deepEqual(data.activity.map((row) => row.id), ['log-2', 'log-1']);
  assert.equal(hasCustomer360TabData(data, 'billing'), true);
  assert.equal(hasCustomer360TabData(data, 'payments'), true);
  assert.equal(hasCustomer360TabData(data, 'equipment'), true);
});

test('customer360SectionState exposes loading, empty, error, and permission states', () => {
  assert.equal(customer360SectionState({ loading: true }), 'loading');
  assert.equal(customer360SectionState({ items: [] }), 'empty');
  assert.equal(customer360SectionState({ items: [{ id: 'row-1' }] }), 'ready');
  assert.equal(customer360SectionState({ error: { status: 500, message: 'API failed' }, items: [] }), 'error');
  assert.equal(customer360SectionState({ error: { status: 403, message: 'Forbidden' }, items: [] }), 'permission-denied');
});

test('empty Customer 360 data produces empty tab states without mock records', () => {
  const data = emptyCustomer360Data();

  assert.equal(hasCustomer360TabData(data, 'overview'), true);
  assert.equal(hasCustomer360TabData(data, 'payments'), false);
  assert.equal(hasCustomer360TabData(data, 'tickets'), false);
  assert.equal(hasCustomer360TabData(data, 'activity'), false);
});

test('invoice open-state uses Billing-provided status and balance without recomputing totals', () => {
  assert.equal(isOpenInvoice({ status: 'ISSUED', balance: 1 }), true);
  assert.equal(isOpenInvoice({ status: 'OVERDUE', balance: 10 }), true);
  assert.equal(isOpenInvoice({ status: 'PAID', balance: 0 }), false);
  assert.equal(isOpenInvoice({ status: 'VOID', balance: 100 }), false);
});

test('customer filters tolerate missing integration data', () => {
  assert.deepEqual(filterCustomerEquipment(null, 'customer-1'), []);
  assert.deepEqual(filterCustomerActivity(undefined, customer), []);
});

test('new customer onboarding resumes at serviceability after profile completion', () => {
  const onboarding = buildCustomerOnboarding(customer, emptyCustomer360Data());

  assert.equal(onboarding.completedCount, 1);
  assert.equal(onboarding.currentStepId, 'serviceability');
  assert.equal(onboarding.steps.find((step) => step.id === 'profile').state, 'complete');
  assert.equal(onboarding.steps.find((step) => step.id === 'installation-request').state, 'not-started');
});

test('list onboarding progress scopes owning-module records to each stable customer id', () => {
  const secondCustomer = {
    ...customer,
    id: 'customer-2',
    accountNumber: 'ACC-002',
    status: 'ACTIVE'
  };
  const progress = buildCustomerOnboardingProgressMap([customer, secondCustomer], {
    serviceAccounts: [{ id: 'service-2', customerId: 'customer-2', status: 'ACTIVE' }],
    serviceOrders: [{ id: 'order-2', customerId: 'customer-2', orderType: 'NEW_INSTALLATION', status: 'COMPLETED', serviceAccountId: 'service-2' }],
    subscriptions: [{ id: 'subscription-2', customerId: 'customer-2', serviceAccountId: 'service-2', status: 'ACTIVE' }],
    tickets: [{ id: 'ticket-2', customerId: 'customer-2', serviceOrderId: 'order-2', status: 'CLOSED' }],
    inventoryAssignments: [{ id: 'asset-2', customerId: 'customer-2', status: 'INSTALLED' }]
  });

  assert.equal(progress['customer-1'].completedCount, 1);
  assert.equal(progress['customer-1'].totalCount, 7);
  assert.equal(progress['customer-2'].completedCount, 7);
  assert.equal(progress['customer-2'].isComplete, true);
});

test('onboarding derives installation and activation progress from owning module records', () => {
  const onboarding = buildCustomerOnboarding({
    ...customer,
    onboardingVerifications: {
      serviceability: { outcome: 'QUALIFIED' },
      networkEquipment: {
        outcome: 'VERIFIED',
        networkAccessVerified: true,
        equipmentAssignmentVerified: true
      }
    }
  }, buildCustomer360Data(customer, {
    serviceOrders: [{ id: 'order-1', orderType: 'NEW_INSTALLATION', status: 'COMPLETED', serviceAccountId: 'service-1', ticketId: 'ticket-1' }],
    tickets: [{ id: 'ticket-1', serviceOrderId: 'order-1', status: 'RESOLVED' }],
    serviceAccounts: [{ id: 'service-1', status: 'ACTIVE' }],
    installationCharges: [{ id: 'charge-1', serviceAccountId: 'service-1', status: 'WAIVED' }]
  }));

  assert.equal(onboarding.steps.find((step) => step.id === 'installation-request').state, 'complete');
  assert.equal(onboarding.steps.find((step) => step.id === 'installation-work').state, 'complete');
  assert.equal(onboarding.steps.find((step) => step.id === 'activation').state, 'complete');
  assert.equal(onboarding.currentStepId, 'billing');
});

test('fully provisioned active customer completes onboarding without browser balance calculations', () => {
  const activeCustomer = {
    ...customer,
    status: 'ACTIVE',
    onboardingVerifications: {
      serviceability: { outcome: 'QUALIFIED' },
      networkEquipment: { outcome: 'VERIFIED' }
    }
  };
  const onboarding = buildCustomerOnboarding(activeCustomer, buildCustomer360Data(activeCustomer, {
    serviceOrders: [{ id: 'order-1', orderType: 'NEW_INSTALLATION', status: 'COMPLETED', serviceAccountId: 'service-1', ticketId: 'ticket-1' }],
    tickets: [{ id: 'ticket-1', status: 'CLOSED' }],
    serviceAccounts: [{ id: 'service-1', status: 'ACTIVE' }],
    subscriptions: [{ id: 'subscription-1', serviceAccountId: 'service-1', status: 'ACTIVE' }],
    installationCharges: [{ id: 'charge-1', serviceAccountId: 'service-1', status: 'INVOICED' }],
    invoices: [{ id: 'invoice-1', subscriptionId: 'subscription-1', status: 'ISSUED', balance: 1500 }]
  }));

  assert.equal(onboarding.isComplete, true);
  assert.equal(onboarding.completedCount, onboarding.totalCount);
  assert.equal(onboarding.steps.find((step) => step.id === 'complete').state, 'complete');
});

test('onboarding exposes integration failures and permission restrictions at the affected step', () => {
  const qualifiedCustomer = {
    ...customer,
    onboardingVerifications: { serviceability: { outcome: 'QUALIFIED' } }
  };
  const permissionOnboarding = buildCustomerOnboarding(qualifiedCustomer, emptyCustomer360Data(), {
    serviceOrders: { status: 403, message: 'Forbidden' }
  });
  const failureOnboarding = buildCustomerOnboarding(qualifiedCustomer, emptyCustomer360Data(), {
    serviceOrders: { status: 500, message: 'Service API unavailable' }
  });

  assert.equal(permissionOnboarding.steps.find((step) => step.id === 'installation-request').state, 'permission-denied');
  assert.equal(failureOnboarding.steps.find((step) => step.id === 'installation-request').state, 'needs-attention');
  assert.match(failureOnboarding.steps.find((step) => step.id === 'installation-request').blockers[0], /Service API unavailable/);
});
