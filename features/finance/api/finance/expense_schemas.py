"""Single-classification payable intake; money uses the foundation boundary."""
from datetime import date
from typing import Annotated, Literal

from pydantic import Field, model_validator

from .schemas import Model, Money, Reason, Text

Classification = Literal['OPERATING_EXPENSE', 'DIRECT_COST', 'INVENTORY_PURCHASE', 'ASSET']
OptionalReference = Annotated[str, Field(max_length=160)]


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
    payeeId: Text
    categoryId: Text
    documentReference: Text
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

    @model_validator(mode='after')
    def dates(self):
        if self.dueDate < self.documentDate:
            raise ValueError('Due date cannot precede the supplier document date')
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
