"""Certified provider effects, reviewed settlement mapping and income intake."""
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal, Union

from pydantic import Field, model_validator

from .schemas import Model, Money, Reason, Text

Source = Literal['billing', 'point-of-sale', 'collector', 'service']
Reference = Annotated[str, Field(max_length=160)]


class Settlement(Model):
    channel: Literal['OFFICE', 'POS', 'COLLECTOR', 'COMPANY']
    operator: Text
    method: Literal['CASH', 'GCASH', 'BANK_TRANSFER', 'GATEWAY']
    institution: Text


class Allocation(Model):
    invoiceId: Text
    amount: Money = Field(gt=0)


class InvoiceEffect(Model):
    kind: Literal['BILLING_INVOICE']
    customerId: Text
    amount: Money = Field(gt=0)
    invoiceType: Literal['SERVICE', 'INSTALLATION', 'LEGACY_OPENING']
    serviceAccountId: Reference = ''
    serviceOrderId: Reference = ''


class ReceiptEffect(Model):
    kind: Literal['BILLING_RECEIPT']
    customerId: Text
    amount: Money = Field(gt=0)
    allocations: list[Allocation] = Field(max_length=100)
    advanceAmount: Money = Field(default=Decimal('0.00'), ge=0)
    settlement: Settlement
    referenceNumber: Reference = ''

    @model_validator(mode='after')
    def split(self):
        if sum((a.amount for a in self.allocations), Decimal('0.00')) + self.advanceAmount != self.amount:
            raise ValueError('Retained receipt must equal allocations plus advance')
        if len({a.invoiceId for a in self.allocations}) != len(self.allocations):
            raise ValueError('An invoice may appear only once in a receipt')
        return self


class ReceiptLink(Model):
    kind: Literal['BILLING_RECEIPT_LINK']
    billingPaymentId: Text
    customerId: Text
    amount: Money = Field(gt=0)


class BillingCredit(Model):
    kind: Literal['BILLING_CREDIT', 'BILLING_DEBIT']
    customerId: Text
    invoiceId: Text
    amount: Money = Field(gt=0)
    destination: Literal['INVOICE', 'CUSTOMER_CREDIT'] = 'INVOICE'
    classification: Literal['PAYMENT_PROMOTION', 'SERVICE_REBATE', 'OTHER']
    recognitionBasis: Literal['DEFERRED', 'EARNED', 'UNKNOWN']


class CreditApplication(Model):
    kind: Literal['BILLING_CREDIT_APPLIED']
    customerId: Text
    invoiceId: Text
    creditKind: Literal['ADVANCE', 'REBATE']
    sourceCreditId: Text
    amount: Money = Field(gt=0)


class SaleEffect(Model):
    kind: Literal['POS_SALE']
    grossAmount: Money = Field(gt=0)
    discountAmount: Money = Field(default=Decimal('0.00'), ge=0)
    taxAmount: Money = Field(default=Decimal('0.00'), ge=0)
    delivered: bool
    deliveryEvidence: Text
    customerId: Reference = ''

    @model_validator(mode='after')
    def total(self):
        if self.discountAmount >= self.grossAmount:
            raise ValueError('Sale discount must leave a positive net price')
        return self


class PosReceipt(Model):
    kind: Literal['POS_RECEIPT']
    saleId: Text
    amount: Money = Field(gt=0)
    settlement: Settlement
    referenceNumber: Reference = ''


class CustodyReceipt(Model):
    billingPaymentId: Text
    amount: Money = Field(gt=0)


class RemittanceEffect(Model):
    kind: Literal['COLLECTOR_REMITTANCE']
    leg: Literal['CASH', 'GCASH']
    expectedAmount: Money = Field(gt=0)
    actualAmount: Money = Field(ge=0)
    receipts: list[CustodyReceipt] = Field(min_length=1, max_length=500)
    fromSettlement: Settlement
    toSettlement: Settlement
    movementEvidence: Text
    confirmedBy: Text

    @model_validator(mode='after')
    def total(self):
        if sum((r.amount for r in self.receipts), Decimal('0.00')) != self.expectedAmount:
            raise ValueError('Remittance leg must equal its linked retained receipts')
        if len({r.billingPaymentId for r in self.receipts}) != len(self.receipts):
            raise ValueError('Remittance cannot repeat a receipt')
        return self


class ReverseEffect(Model):
    kind: Literal['SOURCE_REVERSAL']
    targetSource: Source
    targetEventId: Text
    disposition: Literal['REFUND', 'DUPLICATE_NO_FUNDS', 'NONCASH_CORRECTION']
    evidenceReference: Text
    authorizedBy: Text
    reason: Reason
    refundSettlement: Settlement | None = None


class ReferenceEffect(Model):
    kind: Literal['REFERENCE_ONLY', 'SERVICE_INSTALLATION', 'COLLECTOR_DISCREPANCY', 'BILLING_FEE_DECISION']
    reference: Text
    reason: Reason
    customerId: Reference = ''
    serviceAccountId: Reference = ''
    serviceOrderId: Reference = ''
    billingInvoiceId: Reference = ''


Effect = Annotated[Union[InvoiceEffect, ReceiptEffect, ReceiptLink, BillingCredit,
                        CreditApplication, SaleEffect, PosReceipt, RemittanceEffect,
                        ReverseEffect, ReferenceEffect], Field(discriminator='kind')]


class SourceEvent(Model):
    contractVersion: Literal[1] = 1
    source: Source
    eventId: Text
    recordId: Text
    recordVersion: int = Field(ge=1)
    operationId: Text
    occurredAt: datetime
    effectiveDate: date
    effect: Effect

    @model_validator(mode='after')
    def ownership(self):
        if self.occurredAt.tzinfo is None:
            raise ValueError('Source timestamps must include a timezone')
        allowed = {
            'billing': {'BILLING_INVOICE', 'BILLING_RECEIPT', 'BILLING_CREDIT', 'BILLING_DEBIT',
                        'BILLING_CREDIT_APPLIED', 'BILLING_FEE_DECISION', 'REFERENCE_ONLY', 'SOURCE_REVERSAL'},
            'point-of-sale': {'POS_SALE', 'POS_RECEIPT', 'BILLING_RECEIPT_LINK', 'SOURCE_REVERSAL'},
            'collector': {'BILLING_RECEIPT_LINK', 'COLLECTOR_REMITTANCE', 'COLLECTOR_DISCREPANCY'},
            'service': {'SERVICE_INSTALLATION'},
        }
        if self.effect.kind not in allowed[self.source]:
            raise ValueError('Financial effect must come from its authoritative owner')
        if self.effect.kind == 'SOURCE_REVERSAL' and self.effect.targetSource != self.source:
            raise ValueError('Only the original source owner can authorize a reversal')
        return self


class SourceBatch(Model):
    contractVersion: Literal[1] = 1
    source: Source
    snapshotId: Text
    cursor: Reference = ''
    nextCursor: Text
    completeThrough: Text
    coverageStart: date
    events: list[SourceEvent] = Field(max_length=500)

    @model_validator(mode='after')
    def consistent(self):
        if any(e.source != self.source for e in self.events):
            raise ValueError('Batch cannot mix source owners')
        if len({e.eventId for e in self.events}) != len(self.events):
            raise ValueError('Batch cannot repeat immutable event IDs')
        if self.events and self.cursor == self.nextCursor:
            raise ValueError('Nonempty feed page must advance its opaque cursor')
        return self


class MappingCreate(Model):
    settlement: Settlement
    accountId: Text
    validFrom: date
    validThrough: date | None = None
    evidenceReference: Text
    reason: Reason

    @model_validator(mode='after')
    def dates(self):
        if self.validThrough is not None and self.validThrough < self.validFrom:
            raise ValueError('Mapping date range is inverted')
        return self


class ReviewAction(Model):
    version: int = Field(ge=1)
    reason: Reason


class ManualIncomeCreate(Model):
    classification: Literal['OTHER_INCOME', 'LOAN_PROCEEDS', 'OWNER_FUNDING', 'OWNER_LOAN']
    documentReference: Text
    payerName: Text
    effectiveDate: date
    amount: Money = Field(gt=0)
    accountId: Text
    counterpartAccountId: Text
    purpose: Reason
    evidenceReference: Text


class BaselineReceivable(Model):
    owner: Literal['billing', 'point-of-sale']
    recordId: Text
    customerId: Reference = ''
    amount: Money = Field(ge=0)
    deferredAmount: Money = Field(default=Decimal('0.00'), ge=0)


class BaselineCustody(Model):
    billingPaymentId: Text
    customerId: Text
    accountId: Text
    leg: Literal['CASH', 'GCASH']
    amount: Money = Field(gt=0)


class BaselineCredit(Model):
    kind: Literal['ADVANCE', 'REBATE']
    recordId: Text
    customerId: Text
    amount: Money = Field(gt=0)


class BaselineFund(Model):
    accountId: Text
    balance: Money = Field(ge=0)


class CutoverCreate(Model):
    startDate: date
    snapshots: dict[Source, Text]
    funds: list[BaselineFund] = Field(max_length=200)
    receivables: list[BaselineReceivable] = Field(default_factory=list, max_length=2000)
    credits: list[BaselineCredit] = Field(default_factory=list, max_length=2000)
    custody: list[BaselineCustody] = Field(default_factory=list, max_length=2000)
    deferredAmount: Money = Field(default=Decimal('0.00'), ge=0)
    evidenceReference: Text
    reason: Reason

    @model_validator(mode='after')
    def unique(self):
        if set(self.snapshots) != {'billing', 'point-of-sale', 'collector', 'service'}:
            raise ValueError('All four certified source snapshot IDs are required')
        for values in ([r.accountId for r in self.funds],
                       [(r.owner,r.recordId) for r in self.receivables],
                       [(r.kind,r.recordId) for r in self.credits],
                       [r.billingPaymentId for r in self.custody]):
            if len(values) != len(set(values)):
                raise ValueError('Cutover cannot repeat a baseline identity')
        if any(r.owner=='billing' and not r.customerId for r in self.receivables):
            raise ValueError('Billing baseline obligations require customer identities')
        if any(r.owner=='point-of-sale' and r.deferredAmount for r in self.receivables):
            raise ValueError('POS delivered sales cannot carry deferred service consideration')
        if sum((r.deferredAmount for r in self.receivables),Decimal('0.00'))!=self.deferredAmount:
            raise ValueError('Deferred opening must equal itemized invoice consideration')
        return self


class SyncRequest(Model):
    limit: int = Field(default=100, ge=1, le=500)
