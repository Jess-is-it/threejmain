export const COLLECTOR_PORTAL_ROLES = new Set([
  'collector',
  'collection_supervisor',
  'finance_officer',
  'cashier_treasury',
  'finance_approver'
]);

const PAGE_VIEW_PERMISSIONS = {
  Dashboard: 'dashboard.view',
  'Customer Profiling': 'customer-profiling.view',
  Billing: 'billing.view',
  Collector: 'collector.portal.view',
  'Point of Sale': 'point-of-sale.view',
  Inventory: 'inventory.view',
  'Account Access Management': 'account-access-management.customer.view',
  'Customer Accounts': 'account-access-management.customer.view',
  'PPPoE & ONUs': 'account-access-management.customer.view',
  'Customer Service Management': 'customer-service-management.view',
  Ticketing: 'ticketing.view',
  'Service Catalog': 'service.view',
  'Service Account': 'service.view',
  'Service Order': 'service.view',
  'Network Settings': 'network-settings.view',
  Mapping: 'network-settings.view',
  'Serviceability Check': 'network-settings.view',
  Topology: 'network-settings.view',
  'MikroTik API': 'network-settings.view',
  'PPPoE Accounts': 'network-settings.view',
  'OLT SNMP': 'network-settings.view',
  'OLT & PON': 'network-settings.view',
  ONUs: 'network-settings.view',
  'NAP Boxes': 'network-settings.view',
  Splitters: 'network-settings.view',
  'Fiber Optic': 'network-settings.view',
  'System Settings': 'system.settings.view',
  Logs: 'logs.view'
};

export function isCollectorPortalUser(user) {
  return COLLECTOR_PORTAL_ROLES.has(String(user?.role || '').toLowerCase());
}

export function collectorPermittedPages(user) {
  const permissions = new Set(Array.isArray(user?.permissions) ? user.permissions : []);
  const pages = new Set(['View Profile', 'Change Password']);
  for (const [page, permission] of Object.entries(PAGE_VIEW_PERMISSIONS)) {
    if (permissions.has('*') || permissions.has(permission)) pages.add(page);
  }
  return pages;
}

export function filterNavItemsForPages(items, pages) {
  return items.flatMap((item) => {
    if (item.children?.length) {
      const children = filterNavItemsForPages(item.children, pages);
      return children.length ? [{ ...item, children }] : [];
    }
    return pages.has(item.page) ? [item] : [];
  });
}
