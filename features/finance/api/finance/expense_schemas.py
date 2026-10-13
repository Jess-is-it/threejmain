"""Single-classification payable intake; money uses the foundation boundary."""
from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator

from .schemas import Model, Money, Reason, Text

Classification = Literal['OPERATING_EXPENSE', 'DIRECT_COST', 'INVENTORY_PURCHASE', 'ASSET']
OptionalReference = Annotated[str, Field(max_length=160)]


class Installment(Model):
    dueDate: date
    amount: Money = Field(gt=0)


class PaidDetails(Model):
    accountId: Text
    effectiveDate: date
    method: Literal['CASH', 'GCASH', 'BANK_TRANSFER', 'CREDIT_CARD', 'OTHER']
    referenceNumber: OptionalReference = ''


class PayeeCreate(Model):
    code: Annotated[str, Field(pattern=r'^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$')]
    name: Text
    type: Literal['SUPPLIER', 'EMPLOYEE', 'OTHER'] = 'SUPPLIER'
    notes: Annotated[str, Field(max_length=1000)] = ''


class MasterEdit(Model):
    version: int = Field(ge=1)
    name: Text
    notes: Annotated[str, Field(max_length=1000)] = ''
    active: bool
    reason: Reason


class CategoryCreate(Model):
    code: Annotated[str, Field(pattern=r'^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$')]
    name: Text
    classification: Classification
    accountId: Text
    notes: Annotated[str, Field(max_length=1000)] = ''


class PayableCreate(Model):
    payeeId: Text | None = None
    categoryId: Text
    documentReference: OptionalReference = ''
    documentDate: date
    expenseDate: date
    dueDate: date
    amount: Money = Field(gt=0)
    purpose: Reason
    locationReference: OptionalReference = ''
    projectReference: OptionalReference = ''
    itemAssetReference: OptionalReference = ''
    evidenceReference: OptionalReference = ''
    evidenceExceptionReason: Annotated[str, Field(max_length=1000)] = ''
    paymentArrangement: Literal['PAY_LATER', 'INSTALLMENTS', 'ALREADY_PAID'] = 'PAY_LATER'
    installments: list[Installment] = Field(default_factory=list, max_length=120)
    paidDetails: PaidDetails | None = None

    @field_validator('payeeId', mode='before')
    @classmethod
    def optional_payee(cls, value):
        return None if isinstance(value, str) and not value.strip() else value

    @model_validator(mode='after')
    def dates(self):
        if self.payeeId is None and self.paymentArrangement != 'ALREADY_PAID':
            raise ValueError('Payee is required for pay-later and installment expenses')
        if self.dueDate < self.documentDate:
            raise ValueError('Due date cannot precede the supplier document date')
        if self.paymentArrangement == 'INSTALLMENTS':
            if len(self.installments) < 2 or sum((r.amount for r in self.installments), Decimal('0.00')) != self.amount:
                raise ValueError('At least two installments must add up to the purchase amount')
            dates = [r.dueDate for r in self.installments]
            if dates != sorted(set(dates)) or dates[0] < max(self.documentDate, self.expenseDate):
                raise ValueError('Installment dates must be distinct, ordered and on or after the purchase date')
            if self.dueDate != dates[0]:
                raise ValueError('Due date must match the first installment')
        elif self.installments:
            raise ValueError('Installments require the installments payment arrangement')
        if (self.paymentArrangement == 'ALREADY_PAID') != (self.paidDetails is not None):
            raise ValueError('Already-paid purchases require payment details; other arrangements must omit them')
        if self.paidDetails and self.paidDetails.effectiveDate < self.expenseDate:
            raise ValueError('Payment cannot precede expense recognition')
        return self


class PayableEdit(PayableCreate):
    version: int = Field(ge=1)


class ExpenseAction(Model):
    version: int = Field(ge=1)
    reason: Reason


class ExpensePost(Model):
    version: int = Field(ge=1)


class PayablePayment(Model):
    accountId: Text
    effectiveDate: date
    amount: Money = Field(gt=0)
    sourceReference: Text
    method: Literal['CASH', 'GCASH', 'BANK_TRANSFER', 'CREDIT_CARD', 'OTHER']
    referenceNumber: OptionalReference = ''
    reason: Reason


class AttachmentUpload(Model):
    version: int = Field(ge=1)
    filename: Annotated[str, Field(min_length=1, max_length=120)]
    contentType: Literal['application/pdf', 'image/png', 'image/jpeg']
    contentBase64: Annotated[str, Field(min_length=4, max_length=2796204)]


class ExpenseIntake(PayableCreate):
    attachment: AttachmentUpload | None = None
    submitForApproval: bool = False


class CardStatementCreate(Model):
    accountId: Text
    statementReference: Text
    periodStart: date
    periodEnd: date
    dueDate: date
    statementBalance: Money = Field(gt=0)
    evidenceReference: Text
    installments: list[Installment] = Field(default_factory=list, max_length=120)

    @model_validator(mode='after')
    def dates(self):
        if self.periodStart > self.periodEnd or self.dueDate < self.periodEnd:
            raise ValueError('Statement dates must be ordered: start, end, due date')
        if self.installments:
            dates = [r.dueDate for r in self.installments]
            if len(dates) < 2 or dates != sorted(set(dates)) or dates[0] != self.dueDate:
                raise ValueError('Card installments must have ordered dates, starting on the bill due date')
            if sum((r.amount for r in self.installments), Decimal('0.00')) != self.statementBalance:
                raise ValueError('Card installments must add up to the statement balance')
        return self


class CardRepayment(Model):
    fromAccountId: Text
    effectiveDate: date
    amount: Money = Field(gt=0)
    sourceReference: Text
    referenceNumber: Text
    reason: Reason


class CardStatementCorrection(CardStatementCreate):
    correctionReason: Reason


class CardRepaymentLink(Model):
    journalId: Text
    reason: Reason
