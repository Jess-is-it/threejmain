"""Shared session/Access integration uses private settings and a test-only ledger."""
import asyncio
import importlib
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
main = importlib.import_module('app.main')
finance = importlib.import_module('finance.router')
settings = importlib.import_module('system_settings.router')
from finance.memory import MemoryStore


class FinanceSharedAuthTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.settings_path = Path(self.temp.name)/'settings.json'
        self.previous_path = os.environ.get('SYSTEM_SETTINGS_DATA_PATH')
        os.environ['SYSTEM_SETTINGS_DATA_PATH'] = str(self.settings_path)
        self.previous_finance = (finance.service,finance._actor_provider,finance._integration,finance._reference_providers)
        finance.configure_finance(main.current_finance_actor,store=MemoryStore())
        self.access = settings.normalize_access_store({})
        self.user_id = 'phase7-test-user-'+uuid4().hex
        self.username = 'phase7tester'
        self.user = {'id':self.user_id,'username':self.username,'roleId':'role-finance-officer','isActive':True}
        self.access['users'].append(self.user)
        self.write_access()
        self.token = 'private-phase7-token-'+uuid4().hex
        main.active_tokens[self.token] = {'id':self.user_id,'username':self.username,'auth_source':'system_access','permissions':['*']}
        main.active_session_metadata[self.token] = {'expiresAt':(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat()}

    def tearDown(self):
        main.active_tokens.pop(self.token,None);main.active_session_metadata.pop(self.token,None)
        finance.service,finance._actor_provider,finance._integration,finance._reference_providers = self.previous_finance
        if self.previous_path is None:os.environ.pop('SYSTEM_SETTINGS_DATA_PATH',None)
        else:os.environ['SYSTEM_SETTINGS_DATA_PATH'] = self.previous_path
        self.temp.cleanup()

    def write_access(self):
        self.settings_path.write_text(json.dumps({'access':self.access}))

    def http(self, method, path, body=None, token=True):
        async def run():
            events=[]
            async def receive():return {'type':'http.request','body':json.dumps(body or {}).encode(),'more_body':False}
            async def send(event):events.append(event)
            headers=[(b'content-type',b'application/json'),(b'idempotency-key',uuid4().hex.encode())]
            if token:headers.append((b'authorization',('Bearer '+self.token).encode()))
            await main.app({'type':'http','asgi':{'version':'3.0'},'http_version':'1.1','scheme':'http','method':method,
                'path':path,'query_string':b'month=2026-10' if '/reports/' in path else b'','root_path':'','headers':headers,'client':('test',1),'server':('test',80)},receive,send)
            status=next(e['status'] for e in events if e['type']=='http.response.start')
            data=b''.join(e.get('body',b'') for e in events if e['type']=='http.response.body')
            return status,json.loads(data) if data else None
        return asyncio.run(run())

    def test_finance_uses_current_access_instead_of_token_wildcard(self):
        status,meta=self.http('GET','/api/finance/meta')
        self.assertEqual(status,200)
        self.assertNotIn('*',meta['permissionsGranted'])
        self.assertIn('finance.expenses.pay',meta['permissionsGranted'])
        self.assertNotIn('finance.expenses.approve',meta['permissionsGranted'])
        self.user['roleId']='role-finance-auditor';self.write_access()
        self.assertEqual(self.http('POST','/api/finance/accounts',{'code':'FORBIDDEN','name':'Forbidden cash','kind':'CASH'})[0],403)
        self.assertEqual(self.http('POST','/api/finance/sources/billing/sync',{'limit':100})[0],403)

    def test_disabled_deleted_users_and_removed_roles_revoke_existing_sessions(self):
        self.user['isActive']=False;self.write_access()
        self.assertEqual(self.http('GET','/api/finance/meta')[0],401)
        self.user['isActive']=True
        self.access['roles']=[r for r in self.access['roles'] if r['id']!=self.user['roleId']];self.write_access()
        self.assertEqual(self.http('GET','/api/finance/meta')[0],401)
        self.access['users']=[r for r in self.access['users'] if r['id']!=self.user_id];self.write_access()
        self.assertEqual(self.http('GET','/api/finance/meta')[0],401)

    def test_shared_scope_and_approval_limit_reach_finance_actor(self):
        role=next(r for r in self.access['roles'] if r['id']==self.user['roleId'])
        role['financeScope']={'accountIds':[],'expenseIds':[],'approvalLimit':'500.25'};self.write_access()
        status,meta=self.http('GET','/api/finance/meta')
        self.assertEqual(status,200);self.assertEqual(meta['approvalLimit'],'500.25')
        self.assertFalse(meta['reportScopesUnrestricted'])
        self.assertEqual(self.http('GET','/api/finance/reports/cash-flow')[0],403)

    def test_source_owner_attestations_and_unauthenticated_routes_fail_closed(self):
        self.user['roleId']='role-finance-auditor';self.write_access()
        self.assertEqual(self.http('GET','/api/finance/meta',token=False)[0],401)
        body={'effectiveDate':'2026-10-12','evidenceReference':'Evidence reviewed','reason':'Actual movement attestation'}
        for source in ('billing','point-of-sale','collector'):
            self.assertEqual(self.http('POST',f'/api/{source}/finance/recovery/999999',body)[0],403)

    def test_reference_api_requires_expense_read_before_provider_delegation(self):
        from types import SimpleNamespace
        role=next(r for r in self.access['roles'] if r['id']==self.user['roleId'])
        role['permissionCodes']=['finance.view'];self.write_access()
        finance._reference_providers={'customer-profiling':SimpleNamespace(fetch=lambda *args: {'items':[]})}
        self.assertEqual(self.http('GET','/api/finance/references/customer-profiling')[0],403)
        role['permissionCodes'].append('finance.expenses.view');self.write_access()
        self.assertEqual(self.http('GET','/api/finance/references/customer-profiling')[0],200)

    def test_dashboard_does_not_expose_finance_counts_without_grants_or_outside_scope(self):
        dashboard=importlib.import_module('dashboard.router')
        names=('_seed_module_data','_sync_module_metrics','_modules','_customer_metrics')
        prior={name:getattr(dashboard,name) for name in names}
        try:
            dashboard._seed_module_data=lambda:None;dashboard._sync_module_metrics=lambda:None
            dashboard._customer_metrics=lambda:{'customers':0}
            dashboard._modules=[{'slug':'billing','metrics':{'invoices':2}},
                {'slug':'finance','metrics':{'accounts':10,'journals':12,'payables':5}}]
            role=next(r for r in self.access['roles'] if r['id']==self.user['roleId'])
            role['permissionCodes']=['finance.view'];self.write_access()
            status,data=self.http('GET','/api/dashboard');self.assertEqual(status,200)
            self.assertEqual(data['module_counts']['finance'],{})
            role['permissionCodes']=['finance.view','finance.accounts.view'];self.write_access()
            self.assertEqual(self.http('GET','/api/dashboard')[1]['module_counts']['finance'],{'accounts':10})
            role['financeScope']={'accountIds':[]};self.write_access()
            self.assertEqual(self.http('GET','/api/dashboard')[1]['module_counts']['finance'],{})
            role['permissionCodes']=[];self.write_access()
            data=self.http('GET','/api/dashboard')[1]
            self.assertNotIn('finance',data['module_counts']);self.assertEqual(data['module_counts']['billing'],{'invoices':2})
        finally:
            for name,value in prior.items():setattr(dashboard,name,value)


if __name__=='__main__':unittest.main()
