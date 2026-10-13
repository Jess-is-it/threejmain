"""Real service records for intercepted UI review; no shared financial writes."""
import browserFixtures
import test_finance_expense_workflows as workflows
from finance import cards
from finance.permissions import PERMISSIONS
from test_finance_payables import CREATOR


def fixtures():
    data=browserFixtures.fixtures()
    f=workflows.ExpenseWorkflowTests();f.setUp();s=f.service
    schedule=f.posted(f.draft(amount='100.00',paymentArrangement='INSTALLMENTS',dueDate='2026-02-01',
                  installments=[{'dueDate':'2026-02-01','amount':'50.00'},{'dueDate':'2026-03-01','amount':'50.00'}]))
    funds=f.funds();f.payment(schedule,funds,'60.00',day='2026-02-05')
    expense,card,bill=f.card_bill();f.repay(bill,funds,'40.00')
    submitted=f.intake()
    for key,rows in [('accounts',s.list_accounts(CREATOR)),('payees',s.masters(CREATOR,'payee')),
                     ('categories',s.masters(CREATOR,'category')),('payables',s.list_payables(CREATOR))]:
        existing={r['id'] for r in data[key]}
        data[key].extend(r for r in rows if r['id'] not in existing)
    for r in s.list_payables(CREATOR):
        data['payables/'+r['id']]=s.payable_detail(CREATOR,r['id'])
        data['payables/'+r['id']+'/attachments']=s.list_attachments(CREATOR,r['id'])
    for account in (funds,card):
        data['accounts/'+account['id']+'/activity']=s.activity(CREATOR,account['id'])
    data['card-statements']=cards.statements(s,CREATOR)
    data['workflow']={'scheduledId':schedule['id'],'billId':bill['id'],'cardId':card['id'],
                      'fundsId':funds['id'],'submitted':submitted}
    return data
