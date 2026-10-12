// Shared integration should mount this single parent page at /finance.
export { default, default as FinanceManagementPage } from './FinancePage.jsx';
export { default as FinanceReports } from './FinanceReports.jsx';
export { default as ExpensesPayables } from './ExpensesPayables.jsx';
export { default as IncomeCollections } from './IncomeCollections.jsx';
export { FinanceTrendChart, FinanceBarChart } from './FinanceCharts.jsx';
export { default as FinanceRecords, FinanceStatus } from './FinanceRecords.jsx';
export const FINANCE_WORKSPACES = Object.freeze([
  { id: 'overview', label: 'Overview' },
  { id: 'accounts_and_transfers', label: 'Accounts & Transfers' },
  { id: 'expenses_and_payables', label: 'Expenses & Payables' },
  { id: 'income_and_collections', label: 'Income & Collections' },
  { id: 'financial_reports', label: 'Financial Reports' },
  { id: 'subscriber_growth', label: 'Subscriber Growth' },
]);
