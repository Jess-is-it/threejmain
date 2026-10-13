"""Explicit Finance grants; role names do not confer implicit accounting access."""
from dataclasses import dataclass
from decimal import Decimal

from fastapi import HTTPException


@dataclass(frozen=True)
class Actor:
    username: str
    permissions: frozenset[str]
    account_ids: frozenset[str] | None = None
    approval_limit: Decimal | None = None
    expense_ids: frozenset[str] | None = None

    def require(self, permission: str):
        if not self.username.strip():
            raise HTTPException(401, 'Authenticated actor required')
        if permission not in self.permissions and '*' not in self.permissions:
            raise HTTPException(403, f'Permission required: {permission}')

    def account(self, account_id: str):
        if self.account_ids is not None and account_id not in self.account_ids:
            raise HTTPException(403, 'Account is outside your Finance scope')

    def expense(self, record):
        expense_id = record.get('payableId', record['id'])
        owner = record.get('payableCreatedBy', record.get('createdBy'))
        if self.expense_ids is not None and expense_id not in self.expense_ids:
            raise HTTPException(403, 'Expense is outside your Finance scope')
        if owner != self.username and not ({'*', 'finance.expenses.view_all'} & self.permissions):
            raise HTTPException(403, 'Viewing another user\'s expense requires finance.expenses.view_all')


PERMISSIONS = (
    'finance.view', 'finance.accounts.view', 'finance.accounts.manage',
    'finance.opening-balances.post', 'finance.opening-balances.approve',
    'finance.transfers.view', 'finance.transfers.post',
    'finance.journals.view', 'finance.journals.post', 'finance.journals.reverse',
    'finance.expenses.view', 'finance.expenses.view_all', 'finance.expenses.manage',
    'finance.expenses.create', 'finance.expenses.approve', 'finance.expenses.post',
    'finance.expenses.record-direct',
    'finance.expenses.pay', 'finance.expenses.reverse', 'finance.expenses.evidence.override',
    'finance.attachments.view', 'finance.attachments.upload',
    'finance.income.view', 'finance.income.view_all', 'finance.income.create',
    'finance.income.approve', 'finance.income.post', 'finance.income.reverse',
    'finance.sources.sync', 'finance.settlement-mappings.manage', 'finance.settlement-mappings.approve',
    'finance.cutover.manage', 'finance.cutover.approve', 'finance.reconciliation.acknowledge',
    'finance.reports.financial.view', 'finance.reports.subscribers.view', 'finance.reports.evidence.sync', 'finance.reports.export', 'finance.reports.print',
    'finance.periods.view', 'finance.periods.prepare', 'finance.periods.close', 'finance.periods.reopen',
)
