"""Billing-owned, phone-free Finance projections of canonical posting records."""
from collections import defaultdict
from datetime import date
from decimal import Decimal

from finance.integration import CaptureProvider, IntegrationStore, SourceResolution
from finance.ledger import fingerprint
from finance.report_adapters import BillingReportAdapter
from finance.report_schemas import ReceivableEvidence
from finance.source_adapters import source_money
from fastapi import Depends, HTTPException


class BillingFinanceFeed(CaptureProvider):
    def __init__(self, authorize, store=None):
        super().__init__('billing', authorize, store)


class BillingFinanceReport:
    def __init__(self, authorize):
        self.authorize = authorize

    def fetch(self, request):
        self.authorize(request.actor_username)
        from importlib import import_module
        billing = import_module('billing.router')
        as_of = date.fromisoformat(request.as_of)
        with billing.billing_store.read_snapshot():
            report = billing.monthly_collection_performance(request.month, as_of, page_size=100)
            rows = list(report['rows'])
            for page in range(2, report['pagination']['totalPages'] + 1):
                rows.extend(billing.monthly_collection_performance(request.month, as_of, page=page, page_size=100)['rows'])
            invoice_ids, line_ids = defaultdict(list), defaultdict(list)
            receivables = []
            postings = billing.collection_postings_as_of(as_of)
            for invoice in billing.visible_invoices():
                if not billing.invoice_active_as_of(invoice, as_of):
                    continue
                invoice_id, customer = invoice['id'], invoice['customerId']
                amount = sum((Decimal(source_money(line['amount'])) for line in invoice['lineItems']), Decimal('0.00'))
                for adjustment in postings['adjustmentsByInvoice'].get(invoice_id, []):
                    amount += Decimal(source_money(adjustment['amount'])) * (1 if adjustment['type'] == 'DEBIT' else -1)
                amount -= Decimal(source_money(postings['cashByInvoice'].get(invoice_id, 0)))
                amount -= Decimal(source_money(postings['accountCreditByInvoice'].get(invoice_id, 0)))
                if amount < 0:
                    raise HTTPException(409, 'Billing as-of projection has negative AR; reconciliation required')
                receivables.append({'invoiceId': invoice_id, 'customerId': customer, 'dueDate': invoice.get('dueDate') or None,
                                    'outstandingAmount': format(amount, '.2f')})
                month = str(invoice.get('billingCycleStart') or invoice.get('issueDate'))[:7]
                if invoice.get('invoiceType') in billing.MONTHLY_INVOICE_TYPES and month == request.month:
                    invoice_ids[customer].append(invoice_id)
                    if invoice.get('serviceAccountId'):
                        line_ids[customer].append(invoice['serviceAccountId'])
            proof = {'certifiedBy': 'source:billing', 'evidenceReference': 'Billing canonical monthly cohort and dated as-of allocations under one read snapshot', 'complete': True}
            if request.kind == 'billing-receivables':
                payload = {'kind': request.kind, 'asOf': request.as_of, 'rows': receivables, **proof}
                payload['snapshotId'] = fingerprint(payload)
                return ReceivableEvidence.model_validate(payload)
            report['pagination']['totalRows'] = len(rows)
            proof['snapshotId'] = fingerprint({'month': request.month, 'asOf': request.as_of,
                                                'rows': [{k: v for k, v in r.items() if k != 'customer'} for r in rows], 'invoices': dict(invoice_ids)})
            return BillingReportAdapter.settlement(report, proof, invoice_ids_by_customer=dict(invoice_ids),
                service_account_ids_by_customer={k: sorted(set(v)) for k, v in line_ids.items()} | {k: sorted(set(line_ids[k])) for k in invoice_ids}, all_rows=rows)


def install_finance_recovery(router, require_editor, audit_logger):
    @router.post('/finance/recovery/{sequence}')
    def attest_source(sequence: int, payload: SourceResolution, admin=Depends(require_editor)):
        result = IntegrationStore().resolve('billing', sequence, payload, admin['username'])
        audit_logger('billing_finance_evidence_attested', 'BillingFinanceChange', str(sequence), {'sequence': sequence}, admin['username'])
        return result
