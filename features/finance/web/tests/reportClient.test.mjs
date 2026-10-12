import test from 'node:test';
import assert from 'node:assert/strict';
import { cents, chartScale, metricText, reportQuery, reportWindowValid, subscriberSupportingRows, topExpenseGroups, canReadFinancial, withinApprovalLimit } from '../reportClient.mjs';

test('chart geometry retains exact cents at monetary limits, signed zero and unavailable gaps', () => {
  assert.equal(cents('9999999999999999.99'), 999999999999999999n);
  assert.equal(cents('-0.01'), -1n);
  const scale = chartScale(['-100.00', null, '0.00', '100.00']);
  assert.deepEqual(scale.positions, [0, null, .5, 1]); assert.equal(scale.zero, .5);
  assert.equal(chartScale([null, null]).empty, true);
  assert.throws(() => cents('NaN')); assert.throws(() => cents('0.001'));
});
test('unavailable profit never uses recorded incomplete arithmetic as a reported value', () => {
  assert.equal(metricText('netProfit', { value: null, recordedValue: '800.00', status: 'UNAVAILABLE' }), 'Unavailable');
  assert.equal(metricText('earnedRevenue', { value: '9999999999999999.99' }), '₱9,999,999,999,999,999.99');
  assert.equal(metricText('lineGrowthPercentage', { value: '12.34' }), '12.34%');
  assert.equal(metricText('closingActiveCustomers', { value: 12 }), '12');
  assert.equal(metricText('monthlyRecurringRevenue', { value: '200.00' }), '₱200.00');
});
test('period and grouping preserve explicit basis, date and named account references', () => {
  const params = { month: '2026-01', asOf: '2026-02-28', basis: 'SETTLED', groupBy: 'project', accountId: 'bank/one' };
  assert.equal(new URLSearchParams(reportQuery(params)).get('accountId'), 'bank/one');
  assert.equal(reportWindowValid(params, '2026-10-12'), true);
  assert.equal(reportWindowValid({ ...params, asOf: '2025-12-31' }, '2026-10-12'), false);
  assert.equal(reportWindowValid({ ...params, asOf: '2099-01-01' }, '2026-10-12'), false);
});
test('subscriber drill-down selects actual membership, dated rates and independently classified migrations', () => {
  const active = { serviceAccountId: 'active', status: 'ACTIVE' }, pending = { serviceAccountId: 'pending', status: 'PENDING_DISCONNECTION' }, inactive = { serviceAccountId: 'inactive', status: 'SUSPENDED' };
  const report = { openingLines: [active, pending, inactive], closingLines: [active], monthlyRateRows: [inactive], events: [{ kind: 'MIGRATION_BASELINE' }, { kind: 'ACTIVATION', projection: { newCustomer: true } }, { kind: 'REACTIVATION' }], receiptMonth: { rows: [{ source: 'billing' }] } };
  assert.equal(subscriberSupportingRows(report, 'openingActiveCustomers').length, 2);
  assert.equal(subscriberSupportingRows(report, 'newActivations').length, 1);
  assert.equal(subscriberSupportingRows(report, 'migrationBaselineAdjustment').length, 1);
  assert.equal(subscriberSupportingRows(report, 'newSubscriberCustomers').length, 1);
  assert.equal(subscriberSupportingRows(report, 'monthlyRecurringRevenue')[0].serviceAccountId, 'inactive');
  assert.equal(subscriberSupportingRows(report, 'customersWhoPaidDuringMonth')[0].source, 'billing');
});
test('expense ordering and report access do not approximate amounts or bypass narrower scopes', () => {
  const groups = [{ id: 'small', amount: '9999999999999999.98' }, { id: 'large', amount: '9999999999999999.99' }];
  assert.equal(topExpenseGroups({ groups })[0].id, 'large');
  assert.equal(canReadFinancial({ permissionsGranted: ['*'] }), true);
  assert.equal(canReadFinancial({ permissionsGranted: ['*'], reportScopesUnrestricted: false }), false);
  assert.equal(canReadFinancial({ permissionsGranted: ['finance.reports.financial.view'] }), false);
});

test('approval controls respect the server-resolved exact monetary limit', () => {
  assert.equal(withinApprovalLimit({ approvalLimit: '100.00' }, '100.00'), true);
  assert.equal(withinApprovalLimit({ approvalLimit: '100.00' }, '100.01'), false);
  assert.equal(withinApprovalLimit({ approvalLimit: null }, '9999999999999999.99'), true);
  assert.equal(withinApprovalLimit({ approvalLimit: 'invalid' }, '1.00'), false);
});
