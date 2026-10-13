"""Source contract and shared Access regression checks without live writes."""
import importlib
import sys
import unittest
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from unittest.mock import Mock

from fastapi import HTTPException
from finance.access import ACCESS_REGISTRATION, actor_from_user, OFFICER, APPROVER
from finance.integration import CaptureProvider, SourceResolution, IntegrationStore, settlement_for, cursor_number


class IntegrationContractTests(unittest.TestCase):
    def change(self, typ, after, before=None, sequence=5, source='billing'):
        return {'source': source, 'record_type': typ, 'record_id': after['id'], 'after_data': after,
                'before_data': before, 'sequence': sequence, 'operation': 'UPDATE' if before else 'INSERT',
                'transaction_id': 'tx1', 'occurred_at': datetime(2026,10,12,tzinfo=timezone.utc), 'actor': 'bill'}

    def test_period_source_readiness_requires_full_cutover_and_consumed_cursors(self):
        store=IntegrationStore();state={'cutoverActive':True,'cutoverStartDate':'2026-01-01','baselineDate':'2025-12-31','lastSequence':9,'sources':[{'source':'billing','cursor':'capture:9','pendingChanges':0}]}
        store.status=lambda:state
        self.assertTrue(store.period_readiness('2026-01-01','2026-01-31')['ready'])
        state['sources'][0]['pendingChanges']=1;self.assertFalse(store.period_readiness('2026-01-01','2026-01-31')['ready'])
        state['sources'][0]['pendingChanges']=0;state['cutoverStartDate']='2026-01-02';self.assertFalse(store.period_readiness('2026-01-01','2026-01-31')['ready'])
        state['cutoverStartDate']='2026-01-01';state['cutoverActive']=False;self.assertFalse(store.period_readiness('2026-01-01','2026-01-31')['ready'])

    def test_issued_invoice_is_deferred_and_paid_display_update_is_not_reissued(self):
        provider = CaptureProvider('billing', lambda _: None)
        invoice = {'id':'invoice1','customerId':'customer1','status':'ISSUED','issueDate':'2026-10-12','lineItems':[{'amount':'100.00'}]}
        first = provider.project(self.change('invoice', invoice), None, Mock())
        self.assertEqual(first[0].effect.kind, 'BILLING_INVOICE')
        self.assertEqual(first[0].effect.amount, Decimal('100.00'))
        self.assertEqual(provider.project(self.change('invoice', {**invoice,'status':'PAID','balance':0}, invoice), None, Mock()), [])
        with self.assertRaisesRegex(ValueError, 'economic fields'):
            provider.project(self.change('invoice', {**invoice,'lineItems':[{'amount':'99.00'}]}, invoice), None, Mock())

    def test_receipt_is_canonical_retained_cash_with_actual_desk_identity(self):
        row = {'id':'r1','customerId':'c1','status':'POSTED','amount':'100.00','tenderedAmount':'200.00','returnedAmount':'100.00',
               'paymentDate':'2026-10-12','method':'CASH','collectionChannel':'POS','postedByUsername':'cashier',
               'allocations':[{'invoiceId':'i1','amount':'90.00'}],'advanceAmount':'10.00'}
        event = CaptureProvider('billing', lambda _: None).project(self.change('payment',row), None, Mock())[0]
        self.assertEqual(event.effect.amount, Decimal('100.00'))
        self.assertEqual(event.effect.settlement.institution, 'pos-cash:cashier')
        self.assertEqual(event.effect.advanceAmount, Decimal('10.00'))

    def test_company_noncash_does_not_guess_a_bank_or_wallet(self):
        with self.assertRaisesRegex(ValueError, 'actual|Actual'):
            settlement_for('billing', {'method':'GCASH','postedByUsername':'bill'}, None)
        self.assertEqual(settlement_for('billing', {'method':'GCASH','collectionChannel':'COLLECTOR','postedByUsername':'col'}, None)['institution'], 'collector-wallet:col')

    def test_existing_capture_baseline_never_creates_money(self):
        change = self.change('payment', {'id':'r1','amount':'100.00','status':'POSTED'})
        change['operation'] = 'BASELINE'
        self.assertEqual(CaptureProvider('billing', lambda _: None).project(change,None,Mock()), [])

    def test_void_requires_actual_source_disposition_and_retains_original_identity(self):
        original = self.change('payment', {'id':'r1','status':'POSTED'}, sequence=4)
        conn = Mock(); conn.execute.return_value.fetchone.return_value = original
        void = self.change('payment', {'id':'r1','status':'VOID','voidedByUsername':'bill','voidedAt':'2026-10-12T00:00:00Z'}, {'id':'r1','status':'POSTED'})
        provider = CaptureProvider('billing', lambda _: None)
        with self.assertRaisesRegex(ValueError, 'attestation'):
            provider.project(void,None,conn)
        proof = {'authorized_by':'bill','data':{'disposition':'DUPLICATE_NO_FUNDS','effectiveDate':'2026-10-12','reason':'Duplicate mistaken receipt', 'evidenceReference':'review:1'}}
        effect = provider.project(void,proof,conn)[0].effect
        self.assertEqual(effect.targetEventId, 'capture:4:payment')
        self.assertEqual(effect.authorizedBy, 'bill')

    def test_pos_alias_never_supplies_another_subscriber_receipt(self):
        row = {'id':'receipt1','customerId':'c1','billingPaymentId':'receipt1','amount':'100.00','paymentDate':'2026-10-12'}
        event = CaptureProvider('point-of-sale', lambda _: None).project(self.change('invoice_sms',row,source='point-of-sale'),None,Mock())[0]
        self.assertEqual(event.effect.kind, 'BILLING_RECEIPT_LINK')

    def test_cursor_and_trusted_actor_scopes_fail_closed(self):
        self.assertEqual(cursor_number('c:42'),42)
        with self.assertRaises(HTTPException): cursor_number('42')
        actor = actor_from_user({'username':'staff','permissions':['finance.view'],'financeScope':{'accountIds':[], 'expenseIds':['expense1'],'approvalLimit':'123.45'}})
        self.assertEqual(actor.approval_limit, Decimal('123.45'))
        with self.assertRaises(HTTPException): actor.account('a1')
        self.assertNotIn('finance.expenses.approve',OFFICER)
        self.assertIn('finance.expenses.approve',APPROVER)


class SharedFinanceAccessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'system-settings'/'api'))
        cls.settings = importlib.import_module('system_settings.router')
        cls.settings.register_access_module(ACCESS_REGISTRATION)

    def test_existing_custom_roles_keep_exact_permissions_and_builtin_officer_upgrades(self):
        settings = self.settings
        data = settings.normalize_access_store({'roles':[
            {'id':'custom','name':'custom','permissionCodes':['billing.view']},
            {'id':'role-finance-officer','name':'finance_officer','isBuiltin':True,'permissionCodes':list(settings._legacy_finance_permissions)},
            {'id':'viewer-old','name':'viewer','permissionCodes':['dashboard.view']},
        ]})
        roles = {r['name']:r for r in data['roles']}
        self.assertEqual(roles['custom']['permissionCodes'], ['billing.view'])
        self.assertEqual(roles['viewer']['permissionCodes'], ['dashboard.view'])
        self.assertIn('collector.finance.confirm',roles['finance_officer']['permissionCodes'])
        self.assertIn('finance.expenses.pay',roles['finance_officer']['permissionCodes'])
        self.assertNotIn('finance.expenses.approve',roles['finance_officer']['permissionCodes'])
        self.assertIn('finance.expenses.approve', roles['finance_approver']['permissionCodes'])
        self.assertNotIn('finance.expenses.pay', roles['finance_auditor']['permissionCodes'])

    def test_unchanged_phase7_builtin_roles_gain_period_grants_custom_roles_do_not(self):
        previous=[{**u,'isBuiltin':True,'permissionCodes':u['previousPermissionCodes']} for u in ACCESS_REGISTRATION['roleUpgrades']]
        custom={**previous[0],'id':'custom-reviewer','name':'custom-reviewer'}
        changed={**previous[0],'permissionCodes':[p for p in previous[0]['permissionCodes'] if p!='finance.reports.print']}
        rows=self.settings.normalize_access_store({'roles':[custom,changed,*previous[1:]]})['roles']
        custom_row=next(r for r in rows if r['id']=='custom-reviewer')
        self.assertFalse(any(p.startswith('finance.periods.') for p in custom_row['permissionCodes']))
        changed_row=next(r for r in rows if r['id']==changed['id'])
        self.assertFalse(any(p.startswith('finance.periods.') for p in changed_row['permissionCodes']))
        officer=next(r for r in rows if r['name']=='finance_officer')
        self.assertIn('finance.periods.prepare',officer['permissionCodes']);self.assertNotIn('finance.periods.close',officer['permissionCodes'])
        upgraded=self.settings.normalize_access_store({'roles':[previous[0]]})['roles']
        approver=next(r for r in upgraded if r['id']==previous[0]['id'])
        self.assertIn('finance.periods.close',approver['permissionCodes']);self.assertIn('finance.periods.reopen',approver['permissionCodes'])

    def test_scopes_are_decimal_attributed_role_settings_and_invalid_limits_rejected(self):
        self.assertEqual(self.settings.normalize_finance_scope({'approvalLimit':'12.30','accountIds':['a1']})['approvalLimit'],'12.30')
        for value in [12.3, '-1.00','NaN','0.001']:
            with self.assertRaises(HTTPException): self.settings.normalize_finance_scope({'approvalLimit':value})

    def test_direct_recording_upgrades_only_unchanged_officers_and_is_role_assignable(self):
        direct='finance.expenses.record-direct'
        old=['collector.portal.view','collector.finance.view','collector.finance.confirm',*[p for p in OFFICER if p!=direct]]
        rows=self.settings.normalize_access_store({'roles':[
            {'id':'role-finance-officer','name':'finance_officer','isBuiltin':True,'permissionCodes':old},
            {'id':'custom-expenses','name':'custom_expenses','permissionCodes':old},
        ]})['roles']
        self.assertIn(direct,next(r for r in rows if r['id']=='role-finance-officer')['permissionCodes'])
        self.assertNotIn(direct,next(r for r in rows if r['id']=='custom-expenses')['permissionCodes'])
        self.assertNotIn(direct,APPROVER)
        self.assertIn(direct,{p['code'] for p in self.settings.ACCESS_PERMISSION_SEEDS})


if __name__ == '__main__': unittest.main()
