"""Shared Access registration; existing custom roles retain their grants."""
from .permissions import Actor, PERMISSIONS
from .schemas import money

READ = tuple(p for p in PERMISSIONS if p.endswith('.view') or p.endswith('.view_all'))
OUTPUT = ('finance.reports.export', 'finance.reports.print')
OFFICER = tuple(p for p in PERMISSIONS if p not in {
    'finance.opening-balances.approve', 'finance.expenses.approve', 'finance.income.approve',
    'finance.settlement-mappings.approve', 'finance.cutover.approve',
    'finance.expenses.evidence.override',
    'finance.periods.close', 'finance.periods.reopen',
})
APPROVER = (*READ, *OUTPUT, 'finance.opening-balances.approve', 'finance.expenses.approve',
            'finance.income.approve', 'finance.settlement-mappings.approve', 'finance.cutover.approve',
            'finance.periods.close', 'finance.periods.reopen')
ACCESS_REGISTRATION = {
    'permissions': [{'code': p, 'label': p.removeprefix('finance.').replace('.', ' ').replace('-', ' ').title(),
                     'description': f'Finance Management: {p.removeprefix("finance.")}. Independent approval and scopes still apply.',
                     'category': 'Finance Management'} for p in PERMISSIONS],
    'dependencies': {p: ['finance.view'] for p in PERMISSIONS if p != 'finance.view'},
    'roles': [
        {'id': 'role-finance-approver', 'name': 'finance_approver', 'description': 'Independent Finance approval and evidence review.', 'permissionCodes': list(APPROVER)},
        {'id': 'role-finance-management', 'name': 'finance_management', 'description': 'Management financial and subscriber reporting.', 'permissionCodes': [*READ, *OUTPUT]},
        {'id': 'role-finance-auditor', 'name': 'finance_auditor', 'description': 'Read-only Finance audit evidence, reports and exports.', 'permissionCodes': [*READ, *OUTPUT]},
    ],
    'financeOfficerPermissions': list(OFFICER),
}
# Report authority always includes its documented operational read dependencies.
ACCESS_REGISTRATION['dependencies']['finance.reports.financial.view'] = [
    'finance.view', 'finance.accounts.view', 'finance.journals.view', 'finance.expenses.view',
    'finance.expenses.view_all', 'finance.income.view', 'finance.income.view_all']


def actor_from_user(user):
    scope = user.get('financeScope') or {}
    return Actor(str(user['username']), frozenset(user.get('permissions') or []),
                 frozenset(scope['accountIds']) if scope.get('accountIds') is not None else None,
                 money(scope['approvalLimit']) if scope.get('approvalLimit') is not None else None,
                 frozenset(scope['expenseIds']) if scope.get('expenseIds') is not None else None)

# Period publications contain company financial and subscriber evidence.
for code in ('finance.periods.view','finance.periods.prepare','finance.periods.close','finance.periods.reopen'):
    ACCESS_REGISTRATION['dependencies'][code]=['finance.view','finance.reports.financial.view','finance.reports.subscribers.view','finance.periods.view'] if code != 'finance.periods.view' else ['finance.view','finance.reports.financial.view','finance.reports.subscribers.view']
# Upgrade only unchanged built-in phase-7 roles; customized roles stay unchanged.
ACCESS_REGISTRATION['roleUpgrades'] = [
    {'id':role['id'],'name':role['name'],'previousPermissionCodes':[p for p in role['permissionCodes'] if not p.startswith('finance.periods.')], 'permissionCodes':role['permissionCodes']}
    for role in ACCESS_REGISTRATION['roles']
] + [{'id':'role-finance-officer','name':'finance_officer','previousPermissionCodes':['collector.portal.view','collector.finance.view','collector.finance.confirm',*[p for p in OFFICER if not p.startswith('finance.periods.')]],'permissionCodes':['collector.portal.view','collector.finance.view','collector.finance.confirm',*OFFICER]}]

# Module registration already feeds shared Roles. Upgrade only the unchanged
# built-in officer; custom roles explicitly opt in to direct recording.
DIRECT_RECORD = 'finance.expenses.record-direct'
ACCESS_REGISTRATION['dependencies'][DIRECT_RECORD] = [
    'finance.view', 'finance.expenses.create', 'finance.expenses.post']
for permission in ACCESS_REGISTRATION['permissions']:
    if permission['code'] == DIRECT_RECORD:
        permission.update(label='Record own expenses directly', description=
            'Record your own business expenses without review, within the role Finance amount limit. '
            'Reimbursements and staff submissions require independent approval. Payment needs its separate grant.')
ACCESS_REGISTRATION['roleUpgrades'].append({
    'id':'role-finance-officer', 'name':'finance_officer',
    'previousPermissionCodes':['collector.portal.view','collector.finance.view','collector.finance.confirm',
                               *[p for p in OFFICER if p != DIRECT_RECORD]],
    'permissionCodes':['collector.portal.view','collector.finance.view','collector.finance.confirm',*OFFICER],
})
# Preserve the earlier period upgrade for officers that predate this grant.
ACCESS_REGISTRATION['roleUpgrades'].append({
    'id':'role-finance-officer', 'name':'finance_officer',
    'previousPermissionCodes':['collector.portal.view','collector.finance.view','collector.finance.confirm',
                               *[p for p in OFFICER if p != DIRECT_RECORD and not p.startswith('finance.periods.')]],
    'permissionCodes':['collector.portal.view','collector.finance.view','collector.finance.confirm',*OFFICER],
})
