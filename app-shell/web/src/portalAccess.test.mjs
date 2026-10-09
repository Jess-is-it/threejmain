import assert from 'node:assert/strict';
import test from 'node:test';
import { collectorPermittedPages, filterNavItemsForPages, isCollectorPortalUser } from './portalAccess.js';

const nav = [
  { page: 'Dashboard' },
  { page: 'Customer Profiling' },
  { page: 'Billing' },
  { page: 'Collector' },
  { page: 'Point of Sale' },
  { page: 'System Settings' },
  { page: 'Service', children: [{ page: 'Service Catalog' }, { page: 'Service Account' }] },
  { page: 'Tech Portal' }
];

test('finance officer navigation follows assigned view permissions', () => {
  const user = {
    role: 'finance_officer',
    permissions: [
      'billing.view',
      'collector.finance.view',
      'collector.portal.view',
      'customer-profiling.view',
      'point-of-sale.view',
      'service.view'
    ]
  };
  assert.equal(isCollectorPortalUser(user), true);
  const pages = collectorPermittedPages(user);
  assert.deepEqual(filterNavItemsForPages(nav, pages).map((item) => item.page), [
    'Customer Profiling', 'Billing', 'Collector', 'Point of Sale', 'Service'
  ]);
  assert.deepEqual(filterNavItemsForPages(nav, pages).at(-1).children.map((item) => item.page), [
    'Service Catalog', 'Service Account'
  ]);
  assert.equal(pages.has('System Settings'), false);
  assert.equal(pages.has('Dashboard'), false);
});

test('collector without other grants remains in Collector', () => {
  const pages = collectorPermittedPages({ role: 'collector', permissions: ['collector.portal.view'] });
  assert.deepEqual(filterNavItemsForPages(nav, pages).map((item) => item.page), ['Collector']);
  assert.equal(pages.has('View Profile'), true);
  assert.equal(pages.has('Change Password'), true);
});

test('removing Collector view hides Collector even for a finance role', () => {
  const pages = collectorPermittedPages({ role: 'finance_officer', permissions: ['billing.view'] });
  assert.deepEqual(filterNavItemsForPages(nav, pages).map((item) => item.page), ['Billing']);
});

test('Dashboard appears only when its own view permission is granted', () => {
  const withoutDashboard = collectorPermittedPages({ role: 'finance_officer', permissions: ['billing.view'] });
  const withDashboard = collectorPermittedPages({ role: 'finance_officer', permissions: ['billing.view', 'dashboard.view'] });
  assert.equal(withoutDashboard.has('Dashboard'), false);
  assert.equal(withDashboard.has('Dashboard'), true);
  assert.deepEqual(filterNavItemsForPages(nav, withDashboard).map((item) => item.page), ['Dashboard', 'Billing']);
});
