"""Finance request boundaries. Money is exact PHP, never binary float arithmetic."""
from datetime import date
from decimal import Decimal, InvalidOperation
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

MAX_MONEY = Decimal('9999999999999999.99')


def money(value):
    if isinstance(value, (bool, float)):
        raise ValueError('Money must be a decimal string or integer, not a float')
    try:
        amount = Decimal(value)
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError('Invalid monetary value') from None
    if not amount.is_finite() or abs(amount) > MAX_MONEY:
        raise ValueError('Money is outside the supported range')
    if amount != amount.quantize(Decimal('0.01')):
        raise ValueError('Money must have at most two decimal places')
    return amount.quantize(Decimal('0.01'))


Money = Annotated[Decimal, BeforeValidator(money)]
Text = Annotated[str, Field(min_length=1, max_length=160)]
Reason = Annotated[str, Field(min_length=3, max_length=1000)]


class AccountKind(StrEnum):
    CASH = 'CASH'
    PETTY_CASH = 'PETTY_CASH'
    COMPANY_GCASH = 'COMPANY_GCASH'
    BANK = 'BANK'
    COLLECTOR_CASH = 'COLLECTOR_CASH'
    COLLECTOR_GCASH = 'COLLECTOR_GCASH'
    CREDIT_CARD = 'CREDIT_CARD'
    GENERAL_LEDGER = 'GENERAL_LEDGER'


class Model(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class AccountCreate(Model):
    code: Annotated[str, Field(pattern=r'^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$')]
    name: Text
    kind: AccountKind
    glType: Literal['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'CONTRA_REVENUE', 'EXPENSE'] | None = None
    custodian: Annotated[str, Field(max_length=160)] = ''
    notes: Annotated[str, Field(max_length=1000)] = ''


class AccountEdit(Model):
    version: int = Field(ge=1)
    name: Text | None = None
    custodian: Annotated[str, Field(max_length=160)] | None = None
    notes: Annotated[str, Field(max_length=1000)] | None = None


class AccountAction(Model):
    version: int = Field(ge=1)
    reason: Reason


class OpeningCreate(Model):
    accountId: Text
    effectiveDate: date
    amount: Money = Field(gt=0)
    reason: Reason
    evidenceReference: Text


class Approval(Model):
    reason: Reason


class JournalLine(Model):
    accountId: Text
    debit: Money = Field(default=Decimal('0.00'), ge=0)
    credit: Money = Field(default=Decimal('0.00'), ge=0)
    memo: Annotated[str, Field(max_length=300)] = ''


class JournalCreate(Model):
    effectiveDate: date
    sourceReference: Text
    reason: Reason
    lines: list[JournalLine] = Field(min_length=2, max_length=100)


class TransferCreate(Model):
    fromAccountId: Text
    toAccountId: Text
    effectiveDate: date
    amount: Money = Field(gt=0)
    sourceReference: Text
    reason: Reason
    # Method describes the rail; IDs identify the financial accounts.
    method: Literal['CASH_HANDOVER', 'GCASH_TRANSFER', 'BANK_TRANSFER', 'CARD_SETTLEMENT', 'CARD_FUNDING', 'OTHER']
    referenceNumber: Annotated[str, Field(max_length=160)] = ''


class Reversal(Model):
    effectiveDate: date
    reason: Reason


def json_record(model: BaseModel) -> dict:
    return model.model_dump(mode='json', exclude_none=True)
