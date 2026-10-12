"""Module-owned API; disabled until an authenticated actor provider is injected."""
from datetime import date
from typing import Callable, Literal
import json
from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, Query
from pydantic import ValidationError

from .payables import PayablesService
from .income import IncomeService
from .reporting import ReportingService
from .periods import PeriodPrepare, PeriodAction, CHECKS
from .report_schemas import ReportKind, ReportSync
from .income_schemas import (Source, MappingCreate, ManualIncomeCreate, CutoverCreate, ReviewAction, SyncRequest)
from .expense_schemas import (PayeeCreate, CategoryCreate, MasterEdit, PayableCreate,
                             PayableEdit, ExpenseAction, ExpensePost, PayablePayment, AttachmentUpload)
from .permissions import Actor, PERMISSIONS
from .schemas import (AccountAction, AccountCreate, AccountEdit, AccountKind,
                      Approval, JournalCreate, OpeningCreate, Reversal, TransferCreate)
from .storage import PostgresStore

router = APIRouter(prefix='/api/finance', tags=['finance'])
_actor_provider = None
service = ReportingService(PostgresStore())
_integration = None
_reference_providers = {}

FinancialReport = Literal['cash-flow','profit-and-loss','expenses','payables','receivables',
                          'reconciliation','collections','transactions']


def configure_finance(current_actor: Callable[[str | None], Actor], *, store=None, source_providers=None, report_providers=None, integration=None, reference_providers=None, period_provider=None):
    """Provider must return a server-resolved Actor, with current grants and scopes."""
    global _actor_provider, service, _integration, _reference_providers
    _actor_provider = current_actor
    _integration = integration
    _reference_providers = dict(reference_providers or {})
    service = ReportingService(store if store is not None else PostgresStore(), providers=source_providers,report_providers=report_providers,period_provider=period_provider)


def require_actor(authorization: str | None = Header(default=None)):
    if _actor_provider is None:
        raise HTTPException(503, 'Finance authentication provider has not been integrated')
    actor = _actor_provider(authorization)
    if not isinstance(actor, Actor) or not actor.username.strip():
        raise HTTPException(401, 'Authenticated Finance actor required')
    return actor


@router.get('/meta')
def meta(actor=Depends(require_actor)):
    actor.require('finance.view')
    setup_status = 'NOT_INTEGRATED'
    if _integration is not None:
        with service.store.read() as repo:
            setup_status = 'FORWARD_ACCOUNTING_ACTIVE' if any(p['status'] == 'ACTIVE' for p in repo.income_documents('CUTOVER')) else 'PENDING_REVIEWED_CUTOVER'
    return {'name':'Finance Management','phase':8,'currency':'PHP','timeZone':'Asia/Manila',
            'setupStatus':setup_status,'periodChecks':list(CHECKS),
            'accountKinds':[k.value for k in AccountKind], 'permissions':list(PERMISSIONS),
            'journal':'append-only','transferMode':'IMMEDIATE_SETTLEMENT',
            'permissionsGranted':sorted(actor.permissions),'actorUsername':actor.username,'approvalLimit':str(actor.approval_limit) if actor.approval_limit is not None else None,'reportScopesUnrestricted':actor.account_ids is None and actor.expense_ids is None}


@router.get('/periods')
def finance_periods(actor=Depends(require_actor)):
    return service.list_periods(actor)


@router.get('/periods/{month}')
def finance_period_detail(month:str,actor=Depends(require_actor)):
    return service.period_detail(actor,month)


@router.post('/periods/{month}/prepare')
def finance_period_prepare(month:str,payload:PeriodPrepare,idempotency_key:str|None=Header(default=None),actor=Depends(require_actor)):
    return service.prepare_period(actor,month,payload,idempotency_key)


@router.post('/periods/{month}/close')
def finance_period_close(month:str,payload:PeriodAction,idempotency_key:str|None=Header(default=None),actor=Depends(require_actor)):
    return service.transition_period(actor,month,payload,idempotency_key,'CLOSE')


@router.post('/periods/{month}/reopen')
def finance_period_reopen(month:str,payload:PeriodAction,idempotency_key:str|None=Header(default=None),actor=Depends(require_actor)):
    return service.transition_period(actor,month,payload,idempotency_key,'REOPEN')


@router.get('/readiness')
def readiness(actor=Depends(require_actor)):
    actor.require('finance.view')
    return {**service.store.readiness(),'integrated':_integration is not None,'sourceFeedsIntegrated':all(s in service.providers for s in ('billing','point-of-sale','collector','service')),
            'sourceProviders':{s:s in service.providers for s in ('billing','point-of-sale','collector','service')},
            'reportProviders':{s:s in service.report_providers for s in ('subscribers','billing-settlement','billing-receivables','financial-coverage')}}


@router.get('/integration/status')
def integration_status(actor=Depends(require_actor)):
    actor.require('finance.income.view'); actor.require('finance.income.view_all')
    service._unscoped(actor)
    if _integration is None:
        raise HTTPException(503, 'Finance source recovery has not been integrated')
    return _integration.store.status()


@router.get('/integration/cutover-preview')
def integration_cutover_preview(startDate: date, actor=Depends(require_actor)):
    actor.require('finance.cutover.manage'); service._unscoped(actor)
    if _integration is None:
        raise HTTPException(503, 'Finance source recovery has not been integrated')
    return _integration.store.cutover_evidence(startDate)


@router.get('/references/{source}')
def finance_references(source: Literal['customer-profiling','inventory'], search: str = Query(default='',max_length=160),
                       offset: int = Query(default=0,ge=0), limit: int = Query(default=50,ge=1,le=100), actor=Depends(require_actor)):
    actor.require('finance.view')
    actor.require('finance.expenses.view')
    provider = _reference_providers.get(source)
    if provider is None:
        raise HTTPException(503, 'Source reference provider has not been integrated')
    return provider.fetch(actor.username, search, offset, limit)


@router.post('/integration/recover')
def integration_recover(actor=Depends(require_actor)):
    actor.require('finance.sources.sync'); service._unscoped(actor)
    if _integration is None:
        raise HTTPException(503, 'Finance source recovery has not been integrated')
    # A caller's current grants authorize every source; do not borrow worker
    # authority to broaden HTTP permissions. Recovery replays immutable effects.
    from .integration import RecoveryWorker
    return RecoveryWorker(service, actor, _integration.store).recover()


@router.get('/accounts')
def accounts(asOf: date | None = None, actor=Depends(require_actor)):
    return service.list_accounts(actor,asOf)


@router.post('/accounts', status_code=201)
def create_account(payload: AccountCreate, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.create_account(actor,payload,idempotency_key)


@router.patch('/accounts/{account_id}')
def edit_account(account_id: str, payload: AccountEdit, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.edit_account(actor,account_id,payload,idempotency_key)


@router.post('/accounts/{account_id}/archive')
def archive_account(account_id: str, payload: AccountAction, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.edit_account(actor,account_id,payload,idempotency_key,active=False)


@router.post('/accounts/{account_id}/restore')
def restore_account(account_id: str, payload: AccountAction, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.edit_account(actor,account_id,payload,idempotency_key,active=True)


@router.get('/accounts/{account_id}/activity')
def account_activity(account_id: str, asOf: date | None = None, actor=Depends(require_actor)):
    return service.activity(actor,account_id,asOf)


@router.get('/opening-balances')
def openings(actor=Depends(require_actor)):
    return service.list_openings(actor)


@router.post('/opening-balances', status_code=201)
def create_opening(payload: OpeningCreate, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.create_opening(actor,payload,idempotency_key)


@router.post('/opening-balances/{opening_id}/approve')
def approve_opening(opening_id: str, payload: Approval, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.approve_opening(actor,opening_id,payload,idempotency_key)


@router.post('/opening-balances/{opening_id}/post')
def post_opening(opening_id: str, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.post_opening(actor,opening_id,idempotency_key)


@router.get('/journals')
def journals(actor=Depends(require_actor)):
    return service.entries(actor)


@router.get('/journals/{entry_id}')
def journal(entry_id: str, actor=Depends(require_actor)):
    return service.entry(actor,entry_id)


@router.post('/journals', status_code=201)
def post_journal(payload: JournalCreate, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.post_journal(actor,payload,idempotency_key)


@router.patch('/journals/{entry_id}')
@router.delete('/journals/{entry_id}')
def immutable_journal(entry_id: str, actor=Depends(require_actor)):
    actor.require('finance.journals.post')
    raise HTTPException(405, 'Posted journals are immutable; use an attributed reversal')


@router.post('/journals/{entry_id}/reverse', status_code=201)
def reverse_journal(entry_id: str, payload: Reversal, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.reverse(actor,entry_id,payload,idempotency_key)


@router.get('/transfers')
def transfers(actor=Depends(require_actor)):
    return service.entries(actor,'TRANSFER')


@router.post('/transfers', status_code=201)
def create_transfer(payload: TransferCreate, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.transfer(actor,payload,idempotency_key)


@router.get('/payees')
def payees(actor=Depends(require_actor)):
    return service.masters(actor,'payee')


@router.post('/payees', status_code=201)
def create_payee(payload: PayeeCreate, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.create_master(actor,'payee',payload,idempotency_key)


@router.patch('/payees/{payee_id}')
def edit_payee(payee_id: str, payload: MasterEdit, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.edit_master(actor,'payee',payee_id,payload,idempotency_key)


@router.get('/categories')
def categories(actor=Depends(require_actor)):
    return service.masters(actor,'category')


@router.post('/categories', status_code=201)
def create_category(payload: CategoryCreate, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.create_master(actor,'category',payload,idempotency_key)


@router.patch('/categories/{category_id}')
def edit_category(category_id: str, payload: MasterEdit, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.edit_master(actor,'category',category_id,payload,idempotency_key)


@router.get('/payables')
def payables(actor=Depends(require_actor)):
    return service.list_payables(actor)


@router.post('/payables', status_code=201)
def create_payable(payload: PayableCreate, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.create_payable(actor,payload,idempotency_key)


@router.get('/payables/{payable_id}')
def payable(payable_id: str, actor=Depends(require_actor)):
    return service.payable_detail(actor,payable_id)


@router.patch('/payables/{payable_id}')
def edit_payable(payable_id: str, payload: PayableEdit, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.edit_payable(actor,payable_id,payload,idempotency_key)


@router.post('/payables/{payable_id}/submit')
def submit_payable(payable_id: str, payload: ExpenseAction, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.expense_action(actor,payable_id,'submit',payload,idempotency_key)


@router.post('/payables/{payable_id}/approve')
def approve_payable(payable_id: str, payload: ExpenseAction, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.expense_action(actor,payable_id,'approve',payload,idempotency_key)


@router.post('/payables/{payable_id}/reject')
def reject_payable(payable_id: str, payload: ExpenseAction, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.expense_action(actor,payable_id,'reject',payload,idempotency_key)


@router.post('/payables/{payable_id}/reopen')
def reopen_payable(payable_id: str, payload: ExpenseAction, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.expense_action(actor,payable_id,'reopen',payload,idempotency_key)


@router.post('/payables/{payable_id}/post')
def post_payable(payable_id: str, payload: ExpensePost, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.post_payable(actor,payable_id,payload,idempotency_key)


@router.post('/payables/{payable_id}/reverse')
def reverse_payable(payable_id: str, payload: Reversal, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.reverse_payable(actor,payable_id,payload,idempotency_key)


@router.post('/payables/{payable_id}/payments', status_code=201)
def pay_payable(payable_id: str, payload: PayablePayment, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.pay(actor,payable_id,payload,idempotency_key)


@router.post('/payments/{payment_id}/reverse')
def reverse_payable_payment(payment_id: str, payload: Reversal, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.reverse_payment(actor,payment_id,payload,idempotency_key)


@router.get('/payables/{payable_id}/attachments')
def attachments(payable_id: str, actor=Depends(require_actor)):
    return service.list_attachments(actor,payable_id)


@router.post('/payables/{payable_id}/attachments', status_code=201)
async def upload_attachment(payable_id: str, request: Request, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    actor.require('finance.attachments.upload');actor.require('finance.expenses.create')
    # Bound input while streaming, before JSON parsing/base64 decoding. No multipart dependency.
    content=bytearray()
    async for chunk in request.stream():
        if len(content)+len(chunk)>2_800_000:
            raise HTTPException(413, 'Attachment request exceeds its size limit')
        content.extend(chunk)
    try:
        payload=AttachmentUpload.model_validate(json.loads(content))
    except (ValueError,ValidationError):
        # Do not echo a supporting document's bytes inside a validation response.
        raise HTTPException(422, 'Invalid attachment metadata or encoded document') from None
    return service.attach(actor,payable_id,payload,idempotency_key)


@router.post('/payables/{payable_id}/attachments/{attachment_id}/retire')
def retire_attachment(payable_id: str, attachment_id: str, payload: ExpenseAction, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.retire_attachment(actor,payable_id,attachment_id,payload,idempotency_key)


@router.get('/payables/{payable_id}/attachments/{attachment_id}/download')
def download_attachment(payable_id: str, attachment_id: str, actor=Depends(require_actor)):
    record,content=service.download_attachment(actor,payable_id,attachment_id)
    return Response(content,media_type='application/octet-stream',headers={
        'Content-Disposition':f"attachment; filename*=UTF-8''{quote(record['filename'])}",
        'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"sandbox; default-src 'none'"})


@router.get('/income')
def income(actor=Depends(require_actor)):
    return service.documents(actor,'MANUAL_INCOME')


@router.post('/income',status_code=201)
def create_income(payload: ManualIncomeCreate, idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'), actor=Depends(require_actor)):
    return service.create_manual(actor,payload,idempotency_key)


@router.get('/income/{record_id}')
def income_detail(record_id: str,actor=Depends(require_actor)):
    record=service.document(actor,record_id)
    if record['documentKind']!='MANUAL_INCOME':raise HTTPException(404,'Other-income document not found')
    return record


@router.post('/income/{record_id}/submit')
def submit_income(record_id: str,payload: ReviewAction,idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'),actor=Depends(require_actor)):
    return service.review_document(actor,record_id,'submit',payload,idempotency_key)


@router.post('/income/{record_id}/approve')
@router.post('/settlement-mappings/{record_id}/approve')
@router.post('/cutover-plans/{record_id}/approve')
def approve_income_document(record_id: str,payload: ReviewAction,idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'),actor=Depends(require_actor)):
    return service.review_document(actor,record_id,'approve',payload,idempotency_key)


@router.post('/income/{record_id}/reject')
@router.post('/settlement-mappings/{record_id}/reject')
@router.post('/cutover-plans/{record_id}/reject')
def reject_income_document(record_id: str,payload: ReviewAction,idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'),actor=Depends(require_actor)):
    return service.review_document(actor,record_id,'reject',payload,idempotency_key)


@router.post('/income/{record_id}/post')
def post_income(record_id: str,payload: ExpensePost,idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'),actor=Depends(require_actor)):
    return service.post_manual(actor,record_id,payload,idempotency_key)


@router.post('/income/{record_id}/reverse')
def reverse_income(record_id: str,payload: Reversal,idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'),actor=Depends(require_actor)):
    return service.reverse_manual(actor,record_id,payload,idempotency_key)


@router.get('/settlement-mappings')
def settlement_mappings(actor=Depends(require_actor)):
    return service.documents(actor,'MAPPING')


@router.post('/settlement-mappings',status_code=201)
def create_settlement_mapping(payload: MappingCreate,idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'),actor=Depends(require_actor)):
    return service.create_mapping(actor,payload,idempotency_key)


@router.post('/settlement-mappings/{record_id}/retire')
def retire_settlement_mapping(record_id: str,payload: ReviewAction,idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'),actor=Depends(require_actor)):
    return service.review_document(actor,record_id,'retire',payload,idempotency_key)


@router.get('/cutover-plans')
def cutover_plans(actor=Depends(require_actor)):
    return service.documents(actor,'CUTOVER')


@router.post('/cutover-plans',status_code=201)
def create_cutover_plan(payload: CutoverCreate,idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'),actor=Depends(require_actor)):
    actor.require('finance.cutover.manage'); service._unscoped(actor)
    if _integration is not None:
        from .schemas import json_record
        _integration.store.validate_cutover(json_record(payload))
    return service.create_cutover(actor,payload,idempotency_key)


@router.post('/cutover-plans/{record_id}/activate')
def activate_cutover_plan(record_id: str,payload: ReviewAction,idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'),actor=Depends(require_actor)):
    actor.require('finance.cutover.manage'); service._unscoped(actor)
    if _integration is not None:
        with service.store.read() as repo:
            plan = repo.income_document(record_id)
        _integration.store.validate_cutover(plan)
    return service.activate_cutover(actor,record_id,payload,idempotency_key)


@router.get('/sources')
def income_sources(actor=Depends(require_actor)):
    return service.sources_view(actor)


@router.post('/sources/{source}/sync')
def sync_income_source(source: Source,payload: SyncRequest,idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'),actor=Depends(require_actor)):
    return service.sync(actor,source,payload,idempotency_key)


@router.get('/sources/events/{record_id}')
def income_source_detail(record_id: str,actor=Depends(require_actor)):
    return service.source_detail(actor,record_id)


@router.get('/reconciliation-exceptions')
def reconciliation_exceptions(actor=Depends(require_actor)):
    return service.exceptions(actor)


@router.post('/reconciliation-exceptions/{record_id}/acknowledge')
def acknowledge_reconciliation(record_id: str,payload: ReviewAction,idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'),actor=Depends(require_actor)):
    return service.acknowledge_exception(actor,record_id,payload,idempotency_key)


@router.post('/reports/evidence/{kind}/sync')
def sync_report_evidence(kind: ReportKind,payload: ReportSync,idempotency_key: str | None = Header(default=None,alias='Idempotency-Key'),actor=Depends(require_actor)):
    return service.sync_report_evidence(actor,kind,payload,idempotency_key)


@router.get('/reports/subscribers')
def subscriber_report(month: str = Query(pattern=r'^\d{4}-(0[1-9]|1[0-2])$'),asOf: date | None = None,actor=Depends(require_actor)):
    return service.subscriber_report(actor,month,asOf)


@router.get('/reports/billing-settlement')
def billing_settlement_report(month: str = Query(pattern=r'^\d{4}-(0[1-9]|1[0-2])$'),asOf: date | None = None,actor=Depends(require_actor)):
    return service.presentation_report(actor,'billing-settlement',month,asOf)


@router.get('/reports/comparison')
def report_comparison(kind: Literal['cash-flow','profit-and-loss','expenses','payables','receivables','collections','subscribers'],month: str = Query(pattern=r'^\d{4}-(0[1-9]|1[0-2])$'),asOf: date | None = None,
                      basis: Literal['RECOGNIZED','SETTLED']='RECOGNIZED',groupBy: Literal['category','payee','account','location','project']='category',actor=Depends(require_actor)):
    return service.comparison(actor,kind,month,asOf,basis=basis,group_by=groupBy)


@router.get('/reports/monthly-series')
def monthly_report_series(kind: Literal['profit-and-loss','cash-flow','subscribers'],month: str = Query(pattern=r'^\d{4}-(0[1-9]|1[0-2])$'),asOf: date | None = None,
                          months: int = Query(default=6,ge=1,le=12),actor=Depends(require_actor)):
    return service.monthly_series(actor,kind,month,asOf,months)


@router.get('/reports/{kind}/csv')
@router.get('/reports/{kind}/print')
def report_output(kind: Literal['cash-flow','profit-and-loss','expenses','payables','receivables','reconciliation','collections','transactions','subscribers','billing-settlement'],
                  request: Request,month: str = Query(pattern=r'^\d{4}-(0[1-9]|1[0-2])$'),asOf: date | None = None,
                  basis: Literal['RECOGNIZED','SETTLED']='RECOGNIZED',groupBy: Literal['category','payee','account','location','project']='category',
                  accountId: str | None = None,actor=Depends(require_actor)):
    output=request.url.path.rsplit('/',1)[-1]
    actor.require('finance.reports.export' if output=='csv' else 'finance.reports.print')
    report=service.presentation_report(actor,kind,month,asOf,basis=basis,group_by=groupBy,account_id=accountId)
    report['requestedBy']=actor.username
    if output=='print':
        return Response(content=json.dumps(report),media_type='application/json',headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})
    from .report_exports import report_csv
    return Response(content=report_csv(report),media_type='text/csv; charset=utf-8',headers={
        'Content-Disposition':f'attachment; filename="finance-{kind}-{month}.csv"',
        'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})


@router.get('/reports/{kind}')
def financial_report(kind: FinancialReport,month: str = Query(pattern=r'^\d{4}-(0[1-9]|1[0-2])$'),asOf: date | None = None,
                     basis: Literal['RECOGNIZED','SETTLED']='RECOGNIZED',groupBy: Literal['category','payee','account','location','project']='category',
                     accountId: str | None = None,allRecords: bool = False,offset: int = Query(default=0,ge=0),limit: int = Query(default=100,ge=1,le=500),actor=Depends(require_actor)):
    if allRecords and kind=='transactions':return service.presentation_report(actor,kind,month,asOf,account_id=accountId)
    return service.financial_report(actor,kind,month,asOf,basis=basis,group_by=groupBy,account_id=accountId,offset=offset,limit=limit)
