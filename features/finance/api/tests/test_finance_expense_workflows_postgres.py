"""New extension verified with real PostgreSQL, isolated from application rows."""
import os
import unittest
from datetime import date

import test_finance_expense_workflows as workflows
import test_finance_payables_postgres as postgres
from finance.migrations import EXPENSE_WORKFLOW_MIGRATIONS
from finance.reporting import ReportingService
from finance.storage import psycopg


@unittest.skipUnless(psycopg and os.getenv('FINANCE_TEST_DATABASE_URL'),'Requires authorized Finance test DSN')
class ExpenseWorkflowPostgresTests(workflows.ExpenseWorkflowTests):
    def setUp(self):
        postgres.PayablesPostgresTests.setUp(self)
        for migration in EXPENSE_WORKFLOW_MIGRATIONS:
            for statement in migration['statements']:self.conn.execute(statement)
        self.service=ReportingService(self.store,today=lambda:date(2026,10,12))

    @unittest.skip('Independent connections covered by the private committed worker fixture')
    def test_concurrent_simple_approval_does_not_double_post(self):pass

    @unittest.skip('Independent connections covered by the private committed worker fixture')
    def test_concurrent_card_repayments_cannot_over_settle(self):pass

    @unittest.skip('Inherited payable worker contention covered in its independent connection suite')
    def test_concurrent_posting_and_payments_are_atomic_and_idempotent(self):pass

    def test_post_and_payment_failures_roll_back_document_journal_audit_and_replay(self):
        postgres.PayablesPostgresTests.test_post_and_payment_failures_roll_back_document_journal_audit_and_replay(self)

    sql_rejected=postgres.PayablesPostgresTests.sql_rejected

    def test_sql_direct_recording_keeps_attribution_states_and_journals_immutable(self):
        import json
        r=self.direct(self.direct_body())
        self.sql_rejected("UPDATE finance_payables SET version=version+1,data=jsonb_set(data,'{authorizedBy}','\"Another actor\"') WHERE id=%s",(r['id'],))
        self.sql_rejected("UPDATE finance_payables SET version=version+1,data=jsonb_set(data,'{isReimbursement}','true') WHERE id=%s",(r['id'],))
        self.sql_rejected("DELETE FROM finance_approval_events WHERE payable_id=%s AND action='DIRECT_RECORD'",(r['id'],))
        self.sql_rejected("UPDATE finance_journal_entries SET metadata=jsonb_set(metadata,'{authorizationLimit}','\"1.00\"') WHERE id=%s",(r['postingJournalId'],))
        draft=self.draft()
        with self.store.read() as repo:data=repo.payable(draft['id'])
        data.update(version=draft['version']+1,approvalStatus='NOT_REQUIRED',postingStatus='POSTED',
            authorizationPolicy='AUTHORIZED_OWN_BUSINESS_EXPENSE',authorizedBy=data['createdBy'],
            authorizedAt='2026-01-01T00:00:00+00:00',authorizedVersion=draft['version']+1)
        self.sql_rejected("UPDATE finance_payables SET version=version+1,approval_status='NOT_REQUIRED',posting_status='POSTED',data=%s::jsonb WHERE id=%s",(json.dumps(data),draft['id']))

    def test_sql_unnamed_payee_requires_paid_terms_and_matching_nullable_snapshot(self):
        import json
        body=self.unnamed_body();body['submitForApproval']=False
        record=self.service.expense_intake(workflows.expenses.CREATOR,workflows.ExpenseIntake(**body),self.key())
        row=self.conn.execute('SELECT payee_id,data FROM finance_payables WHERE id=%s',(record['id'],)).fetchone()
        self.assertIsNone(row[0]);self.assertIsNone(row[1]['payeeId'])
        for changes in ({'paymentArrangement':'PAY_LATER','paidDetails':None},{'payeeId':'false-supplier'},
                        {'payeeSnapshot':{'id':'false-supplier','name':'False supplier'}},
                        {'payeeSnapshot':{'id':None,'name':'False supplier'}},{'paidDetails':None}):
            data={**row[1],**changes,'version':record['version']+1}
            self.sql_rejected('UPDATE finance_payables SET version=version+1,data=%s::jsonb WHERE id=%s',(json.dumps(data),record['id']))

    def test_sql_unnamed_supplier_reference_and_posted_identity_remain_protected(self):
        import json
        body=self.unnamed_body();body.update(submitForApproval=False,documentReference='UNNAMED-FUEL')
        record=self.service.expense_intake(workflows.expenses.CREATOR,workflows.ExpenseIntake(**body),self.key())
        with self.store.read() as repo:data=repo.payable(record['id'])
        copied={**data,'id':self.key()};copied.pop('number',None)
        self.sql_rejected('''INSERT INTO finance_payables(id,payee_id,category_id,document_reference,amount,
                    expense_date,approval_status,posting_status,version,data)
                    VALUES (%s,NULL,%s,%s,%s,%s,'DRAFT','UNPOSTED',1,%s::jsonb)''',
                    (copied['id'],copied['categoryId'],copied['documentReference'],copied['amount'],copied['expenseDate'],json.dumps(copied)))
        submitted=self.action(record,'submit');posted=self.approve_record(submitted)
        self.sql_rejected("UPDATE finance_payables SET version=version+1,data=jsonb_set(data,'{payeeSnapshot,name}','\"Edited supplier\"') WHERE id=%s",(posted['id'],))

    def test_sql_cannot_rewrite_installments_or_delete_card_evidence(self):
        r=self.posted(self.draft(paymentArrangement='INSTALLMENTS',dueDate='2026-02-01',installments=[
                    {'dueDate':'2026-02-01','amount':'50.00'},{'dueDate':'2026-03-01','amount':'50.00'}]))
        self.sql_rejected("UPDATE finance_payables SET version=version+1,data=jsonb_set(data,'{installments,0,amount}','\"60.00\"') WHERE id=%s",(r['id'],))
        _,_,bill=self.card_bill()
        self.sql_rejected('DELETE FROM finance_card_statements WHERE id=%s',(bill['id'],))
        self.sql_rejected("UPDATE finance_card_statements SET data=jsonb_set(data,'{dueDate}','\"2026-03-01\"') WHERE id=%s",(bill['id'],))

    def test_sql_card_repays_are_immutable_and_mapping_must_match_journal(self):
        _,_,bill=self.card_bill();funds=self.funds();payment=self.repay(bill,funds)
        self.sql_rejected('DELETE FROM finance_card_repayments WHERE id=%s',(payment['id'],))
        self.sql_rejected('UPDATE finance_card_repayments SET amount=1 WHERE id=%s',(payment['id'],))


@unittest.skipUnless(psycopg and os.getenv('FINANCE_TEST_DATABASE_URL'),'Requires authorized Finance test DSN')
class ExpenseWorkflowIndependentWorkers(postgres.PostgresConcurrentPayablesTests):
    def setUp(self):
        super().setUp()
        with self.conn.transaction():
            for migration in EXPENSE_WORKFLOW_MIGRATIONS:
                for statement in migration['statements']:self.conn.execute(statement)
        self.workflow=workflows.ExpenseWorkflowTests()
        self.workflow.store=self.fixture.store
        self.workflow.service=ReportingService(self.fixture.store,today=lambda:date(2026,10,12))

    def test_real_card_payment_and_approval_workers(self):
        f=self.workflow;r=f.intake()
        results=self.race([lambda:f.approve_record(r,key='same-approval'),lambda:f.approve_record(r,key='same-approval')])
        self.assertEqual(len({p['postingJournalId'] for p in results}),1)
        _,card,bill=f.card_bill();funds=f.funds()
        results=self.race([lambda:f.repay(bill,funds,'60.00',reference='card-worker-one'),lambda:f.repay(bill,funds,'60.00',reference='card-worker-two')])
        self.assertEqual(sum(isinstance(r,dict) for r in results),1);self.assertIn(409,results)
        self.assertEqual(f.balance(card['id']),'40.00')

    def test_real_direct_recording_retry_and_competing_draft_workers(self):
        f=self.workflow;body=f.direct_body()
        results=self.race([lambda:f.direct(body,key='same-direct'),lambda:f.direct(body,key='same-direct')])
        self.assertEqual(len({r['postingJournalId'] for r in results}),1)
        self.assertEqual(len(f.details(results[0])['payments']),1)
        self.assertEqual(f.balance(body['paidDetails']['accountId']),'900.00')
        draft=f.draft()
        from finance.expense_schemas import ExpensePost
        results=self.race([lambda:f.service.record_direct(workflows.expenses.CREATOR,draft['id'],ExpensePost(version=draft['version']),'direct-worker-one'),
                           lambda:f.service.record_direct(workflows.expenses.CREATOR,draft['id'],ExpensePost(version=draft['version']),'direct-worker-two')])
        self.assertEqual(sum(isinstance(r,dict) for r in results),1);self.assertIn(409,results)
