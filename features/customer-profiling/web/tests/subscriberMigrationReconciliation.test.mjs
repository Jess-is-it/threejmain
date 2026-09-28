import test from 'node:test';
import assert from 'node:assert/strict';

import { reconcileSubscriberMigration } from '../subscriberMigrationReconciliation.js';

const batch = {
  id: 'batch-1', cutoverDate: '2026-09-24', rows: [{
    id: 'row-6', rowNumber: 6, status: 'IMPORTED',
    raw: { balanceAsOfDate: '2026-09-16' },
    normalized: {
      firstName: 'ELENA', middleName: 'S', lastName: 'MENDOZA', serviceStatus: 'ACTIVE',
      monthlyRate: 1000, billingMode: 'PREPAID', outstandingBalance: 0,
      balanceAsOfDate: '2026-09-16', lastPaymentAmount: 1000,
      lastPaymentDate: '2026-09-05', lastPaidThroughMonth: '2026-09'
    },
    billingPreview: { balanceVariance: 0 },
    result: {
      customerId: 'customer-1', serviceAccountId: 'service-1', subscriptionId: 'subscription-1',
      accountNumber: '68424417', serviceAccountNumber: 'SA-202609-0005', invoiceNumbers: []
    }
  }]
};

const serviceAccounts = [{
  id: 'service-1', customerId: 'customer-1', status: 'ACTIVE', monthlyRecurringCharge: 1000,
  customer: { id: 'customer-1', status: 'PENDING' }
}];

const currentCustomers = [{ id: 'customer-1', status: 'ACTIVE' }];

const billingRecords = {
  subscriptions: [{
    id: 'subscription-1', customerId: 'customer-1', serviceAccountId: 'service-1',
    billingMode: 'PREPAID', monthlyRate: 1000, nextInvoiceDate: '2026-11-01'
  }],
  invoices: [{
    id: 'invoice-oct', invoiceNumber: 'INV-202609-000023', serviceAccountId: 'service-1',
    subscriptionId: 'subscription-1', invoiceType: 'MONTHLY', billingCycleStart: '2026-10-01',
    dueDate: '2026-10-01', status: 'ISSUED', balance: 1000
  }],
  legacyPaymentEvidence: [{
    serviceAccountId: 'service-1', paymentDate: '2026-09-05', amount: 1000,
    paidThroughMonth: '2026-09', status: 'REFERENCE_ONLY'
  }],
  summaries: [{
    serviceAccountId: 'service-1', balance: 1000, paidThroughMonth: '2026-09',
    nextDueInvoice: { dueDate: '2026-10-01' }, nextInvoiceCycleStart: '2026-11-01'
  }]
};

test('a new prepaid invoice changes live balance without invalidating the imported opening balance', () => {
  const report = reconcileSubscriberMigration(batch, serviceAccounts, billingRecords, currentCustomers);
  assert.equal(report.verified, 1);
  assert.equal(report.needsReview, 0);
  assert.deepEqual({ source: report.rows[0].sourceBalance, asOf: report.rows[0].sourceBalanceAsOf, current: report.rows[0].currentBalance }, {
    source: 0, asOf: '2026-09-16', current: 1000
  });
  assert.equal(report.rows[0].nextInvoiceDueDate, '2026-10-01');
  assert.equal(report.rows[0].nextInvoiceCycleStart, '2026-11-01');
});

test('reconciliation flags missing records, duplicate cycles, and a source balance variance', () => {
  const problemBatch = structuredClone(batch);
  problemBatch.rows[0].billingPreview.balanceVariance = 1000;
  problemBatch.rows[0].result.invoiceNumbers = ['INV-MISSING'];
  const problemBilling = structuredClone(billingRecords);
  problemBilling.invoices.push({ ...problemBilling.invoices[0], id: 'invoice-duplicate' });
  const report = reconcileSubscriberMigration(problemBatch, [], problemBilling, currentCustomers);
  assert.equal(report.needsReview, 1);
  assert.match(report.rows[0].issues.join(' '), /Service account was not found/);
  assert.match(report.rows[0].issues.join(' '), /Imported invoice INV-MISSING was not found/);
  assert.match(report.rows[0].issues.join(' '), /More than one invoice exists/);
  assert.match(report.rows[0].issues.join(' '), /Source balance .* differs from reconstructed arrears/);
});
