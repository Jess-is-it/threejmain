"""Phone-free projections of authoritative records, never an HTTP list poller.

The source owner supplies immutable event identity, actual effective date and
settlement identity in a certified feed. These functions do not manufacture
those facts from mutable/current display rows or write back to the source.
"""
from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol

from .income_schemas import SourceBatch, SourceEvent
from .schemas import money


@dataclass(frozen=True)
class FeedRequest:
    source: str
    snapshot_id: str
    cursor: str
    limit: int
    actor_username: str


class SourceProvider(Protocol):
    def fetch(self, request: FeedRequest) -> SourceBatch:
        """Return an authorized consistent page including reversals/tombstones."""
        ...


def source_money(value):
    # Existing source JSON uses floats. Recover its decimal text, reject
    # fractional cents/nonfinite values; never perform float arithmetic/rounding.
    if isinstance(value, bool) or value is None:
        raise ValueError('Certified source amount is missing or invalid')
    return format(money(Decimal(str(value))), '.2f')


def event(source, row, proof, effect):
    return SourceEvent.model_validate({**proof, 'source': source, 'recordId': row['id'], 'effect': effect})


class BillingAdapter:
    @staticmethod
    def invoice(row, proof, *, invoice_type):
        if row.get('status') in ('DRAFT','VOID') or row.get('deletedAt'):
            raise ValueError('Invoice issuance needs original posted evidence; void needs a separate effect')
        # lineItems describe original consideration. Summary netBilled/paid/
        # balances already contain adjustments and must never be re-imported.
        lines=row.get('lineItems')
        if not lines:
            raise ValueError('Original invoice charge lines are required')
        amount=sum((Decimal(source_money(l['amount'])) for l in lines),Decimal('0.00'))
        return event('billing',row,proof,{'kind':'BILLING_INVOICE','customerId':row['customerId'],
                     'amount':format(amount,'.2f'),'invoiceType':invoice_type,
                     'serviceAccountId':row.get('serviceAccountId') or '',
                     'serviceOrderId':row.get('serviceOrderId') or ''})

    @staticmethod
    def receipt(row, proof, *, settlement):
        if row.get('status')!='POSTED' or row.get('deletedAt'):
            raise ValueError('Receipt must be its original POSTED record; use separate reversal evidence')
        if row.get('excludedFromCashReports') or row.get('evidenceType')=='REFERENCE_ONLY':
            raise ValueError('Migration evidence is never a cash receipt')
        amount=source_money(row['amount'])
        allocations=row.get('allocations')
        if allocations is None:
            if not row.get('invoiceId'):
                raise ValueError('Certified allocation/advance split is required')
            allocations=[{'invoiceId':row['invoiceId'],'amount':amount}]
        return event('billing',row,proof,{'kind':'BILLING_RECEIPT','customerId':row['customerId'],
                     'amount':amount,'allocations':[{'invoiceId':a['invoiceId'],'amount':source_money(a['amount'])} for a in allocations],
                     'advanceAmount':source_money(row.get('advanceAmount',0)),
                     'settlement':settlement,'referenceNumber':row.get('referenceNumber') or ''})

    @staticmethod
    def adjustment(row, proof, *, recognition_basis, attribution_invoice_id=None):
        if row.get('status')!='POSTED':
            raise ValueError('Adjustment must be posted original evidence')
        kind={'CREDIT':'BILLING_CREDIT','DEBIT':'BILLING_DEBIT'}[row['type']]
        return event('billing',row,proof,{'kind':kind,'customerId':row['customerId'],
                     'invoiceId':row.get('invoiceId') or attribution_invoice_id,
                     'amount':source_money(row['amount']),
                     'destination':'INVOICE' if row.get('invoiceId') else 'CUSTOMER_CREDIT',
                     'classification':('PAYMENT_PROMOTION' if row.get('adjustmentSource') in ('PAYMENT_PROMOTION','EARLY_BIRD_DISCOUNT')
                                       else 'SERVICE_REBATE' if row.get('adjustmentSource')=='SERVICE_REBATE' else 'OTHER'),
                     'recognitionBasis':recognition_basis})

    @staticmethod
    def credit_application(row, proof):
        if row.get('status')!='POSTED':raise ValueError('Credit application must be posted')
        source_id=row.get('sourcePaymentId') or row.get('sourceAdjustmentId')
        if not source_id:raise ValueError('Original advance/rebate credit identity is required')
        return event('billing',row,proof,{'kind':'BILLING_CREDIT_APPLIED','customerId':row['customerId'],
                     'invoiceId':row['invoiceId'],'creditKind':'ADVANCE' if row.get('sourcePaymentId') else 'REBATE',
                     'sourceCreditId':source_id,'amount':source_money(row['amount'])})

    @staticmethod
    def migration_evidence(row, proof):
        if not row.get('excludedFromCashReports') or row.get('status')!='REFERENCE_ONLY':
            raise ValueError('Reference-only migration classification must be explicit')
        return event('billing',row,proof,{'kind':'REFERENCE_ONLY','reference':row.get('referenceNumber') or row['id'],
                     'reason':'Source-certified reference-only migration evidence',
                     'customerId':row.get('customerId') or ''})


class PosAdapter:
    @staticmethod
    def sale(row, proof, *, delivery_evidence):
        if row.get('status')!='COMPLETED' or row.get('deletedAt'):
            raise ValueError('Need retained original posted sale; void is a separate effect')
        net_lines=sum((Decimal(source_money(l['amount'])) for l in row['lineItems']),Decimal('0.00'))
        line_discounts=sum((Decimal(source_money(l.get('discountAmount',0))) for l in row['lineItems']),Decimal('0.00'))
        gross=net_lines+line_discounts
        return event('point-of-sale',row,proof,{'kind':'POS_SALE','grossAmount':format(gross,'.2f'),
                     'discountAmount':format(line_discounts+Decimal(source_money(row.get('discountAmount',0))),'.2f'),
                     'taxAmount':source_money(row.get('taxAmount',0)),
                     'delivered':True,'deliveryEvidence':delivery_evidence,'customerId':row.get('customerId') or ''})

    @staticmethod
    def receipt(row, proof, *, settlement):
        if row.get('billingPaymentId'):
            return PosAdapter.invoice_collection(row,proof)
        if row.get('status')!='POSTED' or row.get('deletedAt'):
            raise ValueError('Register receipt must be retained original posting')
        return event('point-of-sale',row,proof,{'kind':'POS_RECEIPT','saleId':row['saleId'],
                     'amount':source_money(row['amount']),'settlement':settlement,
                     'referenceNumber':row.get('referenceNumber') or ''})

    @staticmethod
    def invoice_collection(row, proof):
        return event('point-of-sale',row,proof,{'kind':'BILLING_RECEIPT_LINK','billingPaymentId':row['billingPaymentId'],
                     'customerId':row['customerId'],'amount':source_money(row['amount'])})


class CollectorAdapter:
    @staticmethod
    def collection(row, proof):
        if not row.get('billingPaymentId'):raise ValueError('Collector needs its canonical Billing payment link')
        return event('collector',row,proof,{'kind':'BILLING_RECEIPT_LINK','billingPaymentId':row['billingPaymentId'],
                     'customerId':row['customerId'],'amount':source_money(row['amount'])})

    @staticmethod
    def remittance(row, proof, *, leg, receipts, from_settlement, to_settlement, movement_evidence):
        if row.get('status')!='CLOSED':raise ValueError('Only source-confirmed remittances can settle')
        expected=row['expectedCash' if leg=='CASH' else 'expectedGcash']
        actual=row['countedCash' if leg=='CASH' else 'confirmedGcashAmount']
        return event('collector',row,proof,{'kind':'COLLECTOR_REMITTANCE','leg':leg,
                     'expectedAmount':source_money(expected),'actualAmount':source_money(actual),
                     'receipts':[{'billingPaymentId':r['billingPaymentId'],'amount':source_money(r['amount'])} for r in receipts],
                     'fromSettlement':from_settlement,'toSettlement':to_settlement,
                     'movementEvidence':movement_evidence,'confirmedBy':row['receivedByUsername']})


class ServiceAdapter:
    @staticmethod
    def installation(row, proof, *, billing_invoice_id, evidence_reference):
        return event('service',row,proof,{'kind':'SERVICE_INSTALLATION','reference':evidence_reference,
                     'reason':'Source-owned installation reference; recognition remains separate',
                     'customerId':row.get('customerId') or '',
                     'serviceAccountId':row.get('serviceAccountId') or '',
                     'serviceOrderId':row['id'],'billingInvoiceId':billing_invoice_id})
