"""Definitions for future shared migration registration; never auto-run on import."""
from pathlib import Path

FINANCE_FOUNDATION_MIGRATION_ID = '2026101201_finance_foundation'
MIGRATIONS = [{
    'id': FINANCE_FOUNDATION_MIGRATION_ID,
    'description': 'Finance accounts, immutable balanced journal, approvals and posting evidence',
    'statements': [(Path(__file__).parent / 'migrations' / f'{FINANCE_FOUNDATION_MIGRATION_ID}.sql').read_text()],
}]

FINANCE_PAYABLES_MIGRATION_ID = '2026101202_finance_payables'
MIGRATIONS.append({
    'id': FINANCE_PAYABLES_MIGRATION_ID,
    'description': 'Finance payees, classified expenses, independent approval, payable settlement and private evidence',
    'statements': [(Path(__file__).parent / 'migrations' / f'{FINANCE_PAYABLES_MIGRATION_ID}.sql').read_text()],
})

FINANCE_INCOME_MIGRATION_ID = '2026101203_finance_income'
MIGRATIONS.append({
    'id': FINANCE_INCOME_MIGRATION_ID,
    'description': 'Reviewed income, settlement mappings, source inbox/canonical effects, cutover and reconciliation evidence',
    'statements': [(Path(__file__).parent / 'migrations' / f'{FINANCE_INCOME_MIGRATION_ID}.sql').read_text()],
})

FINANCE_REPORTS_MIGRATION_ID = '2026101204_finance_reports'
MIGRATIONS.append({
    'id': FINANCE_REPORTS_MIGRATION_ID,
    'description': 'Immutable certified lifecycle, Billing cohort/receivable and report coverage snapshots',
    'statements': [(Path(__file__).parent / 'migrations' / f'{FINANCE_REPORTS_MIGRATION_ID}.sql').read_text()],
})

# Source tables must already exist. Keep the standalone four-migration contract
# usable by accounting tests; the shared runner registers this integration tail.
INTEGRATION_MIGRATIONS = [{
    'id': '2026101205_finance_integration',
    'description': 'Atomic immutable source change outbox, dated baseline and durable Finance recovery',
    'statements': [(Path(__file__).parent / 'migrations' / '2026101205_finance_integration.sql').read_text()],
}]

READINESS_MIGRATIONS = [{
    'id': '2026101206_finance_periods',
    'description': 'Reviewed period posting locks and immutable close/reopen publication revisions',
    'statements': [(Path(__file__).parent / 'migrations' / '2026101206_finance_periods.sql').read_text()],
}]

EXPENSE_WORKFLOW_MIGRATIONS = [{
    'id': '2026101301_finance_expense_workflows',
    'description': 'Immutable card statements, balanced repayments and reviewed expense installment terms',
    'statements': [(Path(__file__).parent / 'migrations' / '2026101301_finance_expense_workflows.sql').read_text()],
}]

EXPENSE_WORKFLOW_MIGRATIONS.append({
    'id': '2026101302_finance_optional_payee',
    'description': 'Optional identified payee for already-paid purchases, preserving creditor and evidence integrity',
    'statements': [(Path(__file__).parent / 'migrations' / '2026101302_finance_optional_payee.sql').read_text()],
})

# Foundation-only and full-system consumers both require the direct-declaration guard.
MIGRATIONS.append({
    'id': '2026101303_finance_declared_starting_balances',
    'description': 'Attributed immediate account-manager starting balances without fabricated independent approval',
    'statements': [(Path(__file__).parent / 'migrations' / '2026101303_finance_declared_starting_balances.sql').read_text()],
})

MIGRATIONS.append({
    'id': '2026101304_finance_direct_expense_recording',
    'description': 'Attributed direct own-business expense recording, retained independent reimbursement review',
    'statements': [(Path(__file__).parent / 'migrations' / '2026101304_finance_direct_expense_recording.sql').read_text()],
})
