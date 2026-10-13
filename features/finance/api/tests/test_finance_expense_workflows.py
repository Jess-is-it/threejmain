"""Simple intake preserves approval, journal, evidence and debt invariants."""
import base64
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from unittest.mock import patch

from pydantic import ValidationError
import test_finance_payables as expenses
from finance import cards
from finance.expense_schemas import (ExpenseIntake, PayableCreate, ExpenseAction,
                                    CardStatementCreate, CardStatementCorrection, CardRepayment, CardRepaymentLink, PayableEdit)
from finance.memory import MemoryRepository
from finance.permissions import Actor, PERMISSIONS
from finance.reporting import ReportingService
from finance.schemas import Reversal, TransferCreate


class ExpenseWorkflowTests(expenses.PayablesTests):
    def setUp(self):
        super().setUp()
        self.service=ReportingService(self.store,today=self.service.today)

    def repository_class(self):
        if self.store.mode == 'memory-test':return MemoryRepository
        from finance.storage import PostgresRepository
        return PostgresRepository

    def intake(self, r=None, submit=True, key=None, **changes):
        r=r or self.draft()
        body={k:r[k] for k in PayableCreate.model_fields}
        body.update(documentReference='',evidenceReference='',submitForApproval=submit,
                    attachment={'version':1,'filename':'receipt.pdf','contentType':'application/pdf',
                                'contentBase64':base64.b64encode(b'%PDF-1.7\nSupplier receipt').decode()},**changes)
        return self.service.expense_intake(expenses.CREATOR,ExpenseIntake(**body),key or self.key())

    def approve_record(self,r,actor=expenses.APPROVER,key=None):
        return self.service.expense_action(actor,r['id'],'approve',
                    ExpenseAction(version=r['version'],reason='Independent cost and evidence review'),key or self.key(),recognize=True)

    def unnamed_body(self):
        funds=self.funds();category=self.category()
        return dict(categoryId=category['id'],documentDate=expenses.DAY,expenseDate=expenses.DAY,
                    dueDate=expenses.DAY,amount='100.00',purpose='Fuel for installation vehicle',
                    evidenceReference='Fuel receipt',paymentArrangement='ALREADY_PAID',
                    paidDetails={'accountId':funds['id'],'effectiveDate':expenses.DAY,'method':'CASH'},
                    submitForApproval=True)

    def test_payee_optional_only_for_already_paid_with_real_payment_details(self):
        body=self.unnamed_body()
        for value in (None,'','   '):
            self.assertIsNone(ExpenseIntake(**{**body,'payeeId':value}).payeeId)
        self.assertIsNone(ExpenseIntake(**body).payeeId)
        for arrangement in ('PAY_LATER','INSTALLMENTS'):
            with self.assertRaisesRegex(ValidationError,'Payee is required'):
                ExpenseIntake(**{**body,'paymentArrangement':arrangement,'paidDetails':None})
        with self.assertRaises(ValidationError):ExpenseIntake(**{**body,'paidDetails':None})
        self.expect(400,lambda:self.draft(payeeId=None,paymentArrangement='ALREADY_PAID',
                    paidDetails={'accountId':body['paidDetails']['accountId'],'effectiveDate':expenses.DAY,'method':'CREDIT_CARD'}))

    def test_unnamed_expense_settlement_activity_reports_and_refund_reconcile(self):
        from finance.activity import transaction_history
        body=self.unnamed_body()
        with self.store.read() as repo:payees_before=len(repo.masters('payee'))
        record=self.service.expense_intake(expenses.CREATOR,ExpenseIntake(**body),'unnamed-fuel')
        replay=self.service.expense_intake(expenses.CREATOR,ExpenseIntake(**body),'unnamed-fuel')
        self.assertEqual(record['id'],replay['id']);self.assertIsNone(record['payeeId'])
        self.assertEqual(record['payeeSnapshot']['name'],'Payee not specified')
        with self.store.read() as repo:self.assertEqual(len(repo.masters('payee')),payees_before)
        self.expect(403,lambda:self.approve_record(record,actor=expenses.CREATOR))
        posted=self.approve_record(record)
        with self.store.read() as repo:funds=repo.account(body['paidDetails']['accountId'])
        payment=self.payment(posted,funds,'100.00',reference='confirmed-fuel-payment',key='unnamed-payment')
        self.assertEqual(self.payment(posted,funds,'100.00',reference='confirmed-fuel-payment',key='unnamed-payment')['id'],payment['id'])
        self.assertEqual(self.details(posted)['settlementStatus'],'PAID')
        self.assertEqual(self.balance(funds['id']),'900.00')
        with self.store.read() as repo:
            for basis in ('RECOGNIZED','SETTLED'):
                report=self.service._expenses(repo,'2026-01-01','2026-01-31',{'basis':basis,'group_by':'payee'})
                self.assertEqual(report['total'],'100.00');self.assertEqual(report['reconciliationVariance'],'0.00')
                self.assertEqual(report['groups'],[{'id':'UNSPECIFIED_PAYEE','amount':'100.00'}])
        rows=transaction_history(self.service,expenses.CREATOR,activity_type='MONEY_OUT')['items']
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['counterparty'],'Payee not specified')
        self.service.reverse_payment(expenses.CREATOR,payment['id'],Reversal(effectiveDate='2026-01-03',reason='Actual fuel purchase refund'),self.key())
        self.assertEqual(self.balance(funds['id']),'1000.00')
        self.assertEqual(self.balance(posted['categorySnapshot']['accountId']),'100.00')
        self.assertIsNone(self.details(posted)['payeeId'])
        with self.store.read() as repo:
            report=self.service._expenses(repo,'2026-01-01','2026-01-31',{'basis':'SETTLED','group_by':'payee'})
            self.assertEqual((report['total'],report['reconciliationVariance']),('0.00','0.00'))

    def test_unnamed_draft_edit_requires_creditor_when_switching_to_pay_later(self):
        body=self.unnamed_body();body['submitForApproval']=False
        draft=self.service.expense_intake(expenses.CREATOR,ExpenseIntake(**body),self.key())
        edit={k:draft[k] for k in PayableCreate.model_fields}
        edit.update(version=draft['version'],purpose='Fuel for service vehicle')
        changed=self.service.edit_payable(expenses.CREATOR,draft['id'],PayableEdit(**edit),self.key())
        self.assertIsNone(changed['payeeId'])
        edit.update(version=changed['version'],paymentArrangement='PAY_LATER',paidDetails=None)
        with self.assertRaisesRegex(ValidationError,'Payee is required'):PayableEdit(**edit)
        supplier=self.draft()['payeeId'];edit['payeeId']=supplier
        changed=self.service.edit_payable(expenses.CREATOR,draft['id'],PayableEdit(**edit),self.key())
        self.assertEqual(changed['payeeId'],supplier);self.assertEqual(changed['payeeSnapshot']['name'],'Supplier')
        self.assertIsNone(changed['paidDetails'])

    def test_named_and_unnamed_payee_groups_sort_and_keep_duplicate_evidence(self):
        body=self.unnamed_body();body['documentReference']='FUEL-RECEIPT-123'
        draft=self.service.expense_intake(expenses.CREATOR,ExpenseIntake(**body),self.key())
        self.expect(409,lambda:self.service.expense_intake(expenses.CREATOR,ExpenseIntake(**body),self.key()))
        self.approve_record(draft);named=self.posted()
        with self.store.read() as repo:
            report=self.service._expenses(repo,'2026-01-01','2026-01-31',{'group_by':'payee'})
        self.assertEqual(report['total'],'200.00');self.assertEqual(len(report['groups']),2)
        self.assertEqual({r['id'] for r in report['groups']},{named['payeeId'],'UNSPECIFIED_PAYEE'})

    def test_unnamed_card_purchase_keeps_supplier_settlement_separate_from_card_debt(self):
        body=self.unnamed_body();card=self.account('CREDIT_CARD')
        body['paidDetails']={'accountId':card['id'],'effectiveDate':expenses.DAY,'method':'CREDIT_CARD','referenceNumber':'Fuel card slip'}
        record=self.service.expense_intake(expenses.CREATOR,ExpenseIntake(**body),self.key())
        posted=self.approve_record(record)
        self.payment(posted,card,'100.00',method='CREDIT_CARD')
        self.assertEqual(self.details(posted)['settlementStatus'],'PAID')
        self.assertEqual(self.balance(card['id']),'100.00')
        self.assertEqual(self.balance(posted['categorySnapshot']['accountId']),'100.00')

    def card_bill(self,amount='100.00',**changes):
        expense=self.posted(self.draft(amount=amount));card=self.account('CREDIT_CARD')
        self.payment(expense,card,amount,method='CREDIT_CARD')
        payload=CardStatementCreate(accountId=card['id'],statementReference=self.key(),periodStart=expenses.DAY,
                    periodEnd='2026-01-31',dueDate='2026-02-15',statementBalance=amount,evidenceReference='Private issuer statement',**changes)
        bill=cards.create(self.service,expenses.CREATOR,payload,self.key())
        return expense,card,bill

    def repay(self,bill,funds,amount='40.00',key=None,reference=None):
        return cards.repay(self.service,expenses.CREATOR,bill['id'],CardRepayment(fromAccountId=funds['id'],
                    effectiveDate='2026-02-03',amount=amount,sourceReference=reference or self.key(),
                    referenceNumber='Bank confirmation',reason='Verified card repayment'),key or self.key())

    def test_simple_intake_is_atomic_private_and_retry_safe(self):
        draft=self.draft();first=self.intake(draft,key='simple-intake');second=self.intake(draft,key='simple-intake')
        self.assertEqual(first['id'],second['id']);self.assertTrue(second['idempotentReplay'])
        self.assertEqual((first['approvalStatus'],first['postingStatus']),('SUBMITTED','UNPOSTED'))
        self.assertEqual(first['documentReferenceKind'],'INTERNAL')
        with self.store.read() as repo:
            self.assertEqual(len(repo.attachments(first['id'])),1)
            self.assertNotIn('contentBase64',str(repo.state if hasattr(repo,'state') else repo.operation('expense.intake','simple-intake')))
            self.assertEqual(len(repo.decisions(first['id'])),1)
        self.expect(409,lambda:self.intake(draft,key='simple-intake',purpose='Changed request'))

    def test_intake_submission_failure_leaves_no_orphan_draft_or_file(self):
        draft=self.draft()
        with self.store.read() as repo:before=len(repo.payables())
        with patch.object(self.repository_class(),'save_operation',side_effect=RuntimeError('Audit durability failed')):
            with self.assertRaises(RuntimeError):self.intake(draft,key='failed-intake')
        with self.store.read() as repo:
            self.assertEqual(len(repo.payables()),before)
            self.assertIsNone(repo.operation('expense.intake','failed-intake'))

    def test_approval_records_only_reviewed_cost_with_stock_approver_grants(self):
        from finance.access import APPROVER
        submitted=self.intake()
        actor=Actor('independent-stock-approver',frozenset(APPROVER))
        self.assertNotIn('finance.expenses.post',actor.permissions)
        result=self.approve_record(submitted,actor=actor,key='approve-record')
        self.assertEqual(result['postingStatus'],'POSTED');self.assertEqual(result['paidAmount'],'0.00')
        self.assertEqual(self.balance(result['categorySnapshot']['accountId']),'100.00')
        self.assertEqual(self.approve_record(submitted,actor=actor,key='approve-record')['postingJournalId'],result['postingJournalId'])
        self.expect(403,lambda:self.approve_record(self.intake(),actor=expenses.CREATOR))
        small=Actor('small-limit',frozenset(PERMISSIONS),approval_limit=Decimal('99.99'))
        self.expect(403,lambda:self.approve_record(self.intake(),actor=small))
        self.expect(403,lambda:self.approve_record(self.intake(),actor=Actor('viewer',frozenset({'finance.expenses.view_all'}))))

    def test_failed_recognition_rolls_back_approval_and_decision(self):
        submitted=self.intake()
        with patch.object(self.service,'_post',side_effect=RuntimeError('Posting failed')):
            with self.assertRaises(RuntimeError):self.approve_record(submitted,key='retry-approval')
        detail=self.details(submitted)
        self.assertEqual((detail['approvalStatus'],detail['postingStatus']),('SUBMITTED','UNPOSTED'))
        self.assertEqual([e['action'] for e in detail['approvalHistory']],['SUBMIT'])
        self.approve_record(submitted,key='retry-approval')

    def test_concurrent_simple_approval_does_not_double_post(self):
        submitted=self.intake()
        with ThreadPoolExecutor(max_workers=3) as pool:
            results=list(pool.map(lambda _:self.approve_record(submitted,key='concurrent-approval'),range(3)))
        self.assertEqual(len({r['postingJournalId'] for r in results}),1)
        self.assertEqual(self.balance(results[0]['categorySnapshot']['accountId']),'100.00')

    def test_installments_partial_payments_reversals_and_asof_aging_reconcile(self):
        r=self.posted(self.draft(paymentArrangement='INSTALLMENTS',dueDate='2026-02-01',
                    installments=[{'dueDate':'2026-02-01','amount':'50.00'},{'dueDate':'2026-03-01','amount':'50.00'}]))
        funds=self.funds();payment=self.payment(r,funds,'60.00',day='2026-02-05')
        detail=self.details(r)
        self.assertEqual([(s['paidAmount'],s['outstandingAmount']) for s in detail['settlementSchedule']],[('50.00','0.00'),('10.00','40.00')])
        self.assertEqual((detail['nextDueDate'],detail['nextDueAmount']),('2026-03-01','40.00'))
        with self.store.read() as repo:
            feb=self.service._payable_report(repo,'2026-02-20');jan=self.service._payable_report(repo,'2026-01-31')
        self.assertEqual((feb['total'],feb['aging']['CURRENT'],feb['reconciliationVariance']),('40.00','40.00','0.00'))
        self.assertEqual(jan['total'],'100.00')
        self.service.reverse_payment(expenses.CREATOR,payment['id'],Reversal(effectiveDate='2026-02-06',reason='Actual supplier refund'),self.key())
        self.assertEqual(self.details(r)['nextDueDate'],'2026-02-01')
        self.assertEqual(self.balance(r['categorySnapshot']['accountId']),'100.00')

    def test_invalid_installment_totals_dates_and_paid_details_rejected(self):
        for changes in [dict(paymentArrangement='INSTALLMENTS',installments=[{'dueDate':'2026-01-31','amount':'99.00'}]),
                        dict(paymentArrangement='ALREADY_PAID'),dict(paidDetails={'accountId':'x','effectiveDate':expenses.DAY,'method':'CASH'})]:
            with self.assertRaises(ValidationError):self.draft(**changes)
        card=self.account('CREDIT_CARD')
        self.expect(400,lambda:self.draft(paymentArrangement='ALREADY_PAID',paidDetails={'accountId':card['id'],'effectiveDate':expenses.DAY,'method':'CASH'}))

    def test_editing_draft_keeps_real_supplier_reference_and_clears_stale_paid_details(self):
        card=self.account('CREDIT_CARD')
        draft=self.intake(submit=False,paymentArrangement='ALREADY_PAID',paidDetails={
                    'accountId':card['id'],'effectiveDate':expenses.DAY,'method':'CREDIT_CARD','referenceNumber':'Charge slip'})
        body={k:draft[k] for k in PayableCreate.model_fields}
        body.update(documentReference='supplier-778',paymentArrangement='PAY_LATER',paidDetails=None)
        result=self.service.edit_payable(expenses.CREATOR,draft['id'],PayableEdit(version=draft['version'],**body),self.key())
        self.assertEqual(result['documentReferenceKind'],'SUPPLIER');self.assertEqual(result['documentReference'],'SUPPLIER-778')
        self.assertIsNone(result['paidDetails'])

    def test_card_repayment_failure_rolls_back_money_and_replay_evidence(self):
        _,card,bill=self.card_bill();funds=self.funds()
        with patch.object(self.repository_class(),'insert_card_repayment',side_effect=RuntimeError('Allocation write failed')):
            with self.assertRaises(RuntimeError):self.repay(bill,funds,key='failed-card-payment',reference='failed-reference')
        self.assertEqual(self.balance(card['id']),'100.00');self.assertEqual(self.balance(funds['id']),'1000.00')
        with self.store.read() as repo:self.assertIsNone(repo.operation('card.repay','failed-card-payment'))
        self.repay(bill,funds,key='failed-card-payment',reference='failed-reference')

    def test_declared_card_charge_does_not_move_money_until_actual_payment(self):
        card=self.account('CREDIT_CARD')
        r=self.intake(paymentArrangement='ALREADY_PAID',paidDetails={'accountId':card['id'],'effectiveDate':expenses.DAY,'method':'CREDIT_CARD','referenceNumber':'Charge slip'})
        posted=self.approve_record(r)
        self.assertEqual(self.balance(card['id']),'0.00');self.assertEqual(posted['outstandingAmount'],'100.00')
        self.payment(posted,card,'100.00',day=expenses.DAY,method='CREDIT_CARD')
        self.assertEqual(self.balance(card['id']),'100.00');self.assertEqual(self.details(posted)['settlementStatus'],'PAID')

    def test_card_bill_repays_liability_never_repeats_cost(self):
        expense,card,bill=self.card_bill();funds=self.funds()
        self.assertEqual(self.balance(card['id']),'100.00')
        payment=self.repay(bill,funds,key='card-retry',reference='card-payment-1')
        self.assertEqual(self.repay(bill,funds,key='card-retry',reference='card-payment-1')['id'],payment['id'])
        self.assertEqual(self.repay(bill,funds,reference='card-payment-1')['id'],payment['id'])
        self.assertEqual((self.balance(card['id']),self.balance(funds['id']),self.balance(expense['categorySnapshot']['accountId'])),('60.00','960.00','100.00'))
        self.assertEqual(cards.statements(self.service,expenses.CREATOR)[0]['outstandingAmount'],'60.00')
        self.expect(409,lambda:self.repay(bill,funds,'60.01'))
        self.expect(409,lambda:self.service.reverse(expenses.CREATOR,payment['journalId'],Reversal(effectiveDate='2026-02-04',reason='Wrong route'),self.key()))
        cards.reverse(self.service,expenses.CREATOR,payment['id'],Reversal(effectiveDate='2026-02-04',reason='Verified erroneous repayment'),self.key())
        self.assertEqual(cards.statements(self.service,expenses.CREATOR)[0]['outstandingAmount'],'100.00')
        self.assertEqual(self.balance(card['id']),'100.00')

    def test_card_statement_installments_and_account_scopes(self):
        _,card,bill=self.card_bill(installments=[{'dueDate':'2026-02-15','amount':'50.00'},{'dueDate':'2026-03-15','amount':'50.00'}])
        funds=self.funds();self.repay(bill,funds,'60.00')
        card_only=Actor('card-reader',frozenset({'finance.accounts.view','finance.transfers.view'}),account_ids=frozenset({card['id']}))
        scoped=cards.statements(self.service,card_only)[0]
        self.assertEqual(scoped['nextDueAmount'],'40.00');self.assertEqual(scoped['repayments'],[])
        no_scope=Actor('reader',card_only.permissions,account_ids=frozenset())
        self.assertEqual(cards.statements(self.service,no_scope),[])
        self.expect(403,lambda:cards.create(self.service,card_only,CardStatementCreate(accountId=card['id'],statementReference='unauthorized',periodStart='2026-02-01',periodEnd='2026-02-28',dueDate='2026-03-15',statementBalance='40.00',evidenceReference='Bill'),self.key()))

    def test_card_carry_forward_and_correction_retain_evidence(self):
        _,card,bill=self.card_bill();funds=self.funds();self.repay(bill,funds,'40.00')
        second=cards.create(self.service,expenses.CREATOR,CardStatementCreate(accountId=card['id'],statementReference='Next bill',periodStart='2026-02-01',periodEnd='2026-02-28',dueDate='2026-03-15',statementBalance='60.00',evidenceReference='Second statement'),self.key())
        self.assertEqual([r['status'] for r in cards.statements(self.service,expenses.CREATOR)],['SUPERSEDED','UNPAID'])
        self.expect(409,lambda:self.repay(bill,funds,'10.00'))
        corrected=cards.create(self.service,expenses.CREATOR,CardStatementCorrection(accountId=card['id'],statementReference='Corrected bill',periodStart='2026-02-01',periodEnd='2026-02-28',dueDate='2026-03-16',statementBalance='60.00',evidenceReference='Corrected second statement',correctionReason='Fixed due date'),self.key(),correcting=second['id'])
        self.assertEqual(corrected['correctsStatementId'],second['id'])
        self.assertEqual(len(cards.statements(self.service,expenses.CREATOR)),3)

    def test_link_existing_card_transfer_posts_no_second_movement(self):
        expense,card,bill=self.card_bill();funds=self.funds()
        transfer=self.service.transfer(expenses.CREATOR,TransferCreate(fromAccountId=funds['id'],toAccountId=card['id'],
                    effectiveDate='2026-02-03',amount='40.00',sourceReference='existing-card-payment',
                    reason='Original card payment',method='CARD_SETTLEMENT',referenceNumber='Bank reference'),self.key())
        payload=CardRepaymentLink(journalId=transfer['id'],reason='Verified existing payment')
        with self.store.read() as repo:before=len(repo.entries())
        linked=cards.link(self.service,expenses.CREATOR,bill['id'],payload,'link-existing')
        self.assertEqual(cards.link(self.service,expenses.CREATOR,bill['id'],payload,self.key())['id'],linked['id'])
        with self.store.read() as repo:self.assertEqual(len(repo.entries()),before)
        self.assertEqual(cards.statements(self.service,expenses.CREATOR)[0]['outstandingAmount'],'60.00')
        self.assertEqual(self.balance(expense['categorySnapshot']['accountId']),'100.00')
        cards.reverse(self.service,expenses.CREATOR,linked['id'],Reversal(effectiveDate='2026-02-04',reason='Verified incorrect bank movement'),self.key())
        self.assertEqual(cards.statements(self.service,expenses.CREATOR)[0]['outstandingAmount'],'100.00')

    def test_concurrent_card_repayments_cannot_over_settle(self):
        _,card,bill=self.card_bill();funds=self.funds()
        def run(index):
            try:return self.repay(bill,funds,'60.00',reference=f'competing-card-{index}')
            except expenses.HTTPException as exc:return exc.status_code
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(run,range(2)))
        self.assertEqual(sum(isinstance(r,dict) for r in results),1);self.assertIn(409,results)
        self.assertEqual(self.balance(card['id']),'40.00')


class ExpenseWorkflowApiTests(expenses.ExpenseApiTests):
    def test_http_unnamed_purchase_create_edit_and_creditor_validation(self):
        category=self.fixture.category();funds=self.fixture.funds()
        body=dict(categoryId=category['id'],documentDate=expenses.DAY,expenseDate=expenses.DAY,
                  dueDate=expenses.DAY,amount='100.00',purpose='Fuel for installation vehicle',
                  evidenceReference='Fuel receipt',paymentArrangement='ALREADY_PAID',
                  paidDetails={'accountId':funds['id'],'effectiveDate':expenses.DAY,'method':'CASH'})
        status,_,response=self.request('POST','/api/finance/expenses',body)
        self.assertEqual(status,201);record=expenses.json.loads(response)
        self.assertIsNone(record['payeeId']);self.assertEqual(record['payeeSnapshot']['name'],'Payee not specified')
        edit={k:record[k] for k in PayableCreate.model_fields};edit.update(version=record['version'],purpose='Fuel for field service')
        status,_,response=self.request('PATCH',f"/api/finance/payables/{record['id']}",edit)
        self.assertEqual(status,200);self.assertIsNone(expenses.json.loads(response)['payeeId'])
        for arrangement in ('PAY_LATER','INSTALLMENTS'):
            self.assertEqual(self.request('POST','/api/finance/expenses',{**body,'paymentArrangement':arrangement,'paidDetails':None})[0],422)

    def test_simple_intake_stream_boundaries_and_private_validation(self):
        r=self.fixture.draft();body={k:r[k] for k in PayableCreate.model_fields}
        body.update(documentReference='',submitForApproval=True)
        status,_,response=self.request('POST','/api/finance/expenses',body)
        self.assertEqual(status,201);record=expenses.json.loads(response)
        status,_,response=self.request('POST',f"/api/finance/payables/{record['id']}/approve-record",{'version':record['version'],'reason':'Review expense'},token='approver')
        self.assertEqual(status,200);self.assertEqual(expenses.json.loads(response)['postingStatus'],'POSTED')
        body['attachment']={'version':1,'filename':'private.pdf','contentType':'application/pdf','contentBase64':'SECRET_NOT_DOCUMENT'}
        status,_,response=self.request('POST','/api/finance/expenses',body)
        self.assertEqual(status,400);self.assertNotIn(b'SECRET_NOT_DOCUMENT',response)
        body['attachment']['contentBase64']='x'*2_850_001
        self.assertEqual(self.request('POST','/api/finance/expenses',body)[0],413)


if __name__=='__main__':
    import unittest
    unittest.main()
