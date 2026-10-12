"""Certified report evidence; never browser-supplied accounting/lifecycle records."""
from dataclasses import dataclass
from datetime import date
from typing import Annotated, Literal, Protocol

from pydantic import Field, model_validator

from .schemas import Model, Money, Text, Reason

ReportKind = Literal['subscribers', 'billing-settlement', 'billing-receivables', 'financial-coverage']
ServiceStatus = Literal['PENDING_INSTALLATION', 'ACTIVE', 'PENDING_DISCONNECTION',
                        'SUSPENDED', 'PENDING_RECONNECTION', 'DISCONNECTED', 'TERMINATED', 'CANCELLED']
ACTIVE = frozenset({'ACTIVE', 'PENDING_DISCONNECTION'})
POLICY = 'finance-management-v1'


class ReportSync(Model):
    month: Annotated[str, Field(pattern=r'^\d{4}-(0[1-9]|1[0-2])$')]
    asOf: date | None = None


class SubscriberLine(Model):
    serviceAccountId: Text
    customerId: Text
    status: ServiceStatus
    everActive: bool
    migratedExisting: bool = False
    billable: bool
    monthlyRecurringRate: Annotated[Money, Field(ge=0)] | None = None
    rateEvidence: str = Field(default='', max_length=1000)

    @model_validator(mode='after')
    def proof(self):
        if self.status in ACTIVE and not self.everActive:
            raise ValueError('Active baseline/after-state must attest everActive')
        if self.monthlyRecurringRate is not None and not self.rateEvidence:
            raise ValueError('A monthly rate needs Billing-owned dated evidence')
        return self


class LifecycleEvent(Model):
    eventId: Text
    sequence: int = Field(gt=0)
    effectiveDate: date
    source: Literal['service', 'billing']
    kind: Literal['ACTIVATION', 'REACTIVATION', 'SUSPENSION', 'DISCONNECTION',
                  'TERMINATION', 'MIGRATION_BASELINE', 'OWNERSHIP', 'STATUS', 'RATE']
    beforeStatus: ServiceStatus | None
    beforeCustomerId: str = Field(default='', max_length=160)
    line: SubscriberLine
    evidenceReference: Reason

    @model_validator(mode='after')
    def owner(self):
        if (self.kind == 'RATE') != (self.source == 'billing'):
            raise ValueError('Billing owns rate effects; Service owns lifecycle/ownership effects')
        return self


class SubscriberEvidence(Model):
    kind: Literal['subscribers']
    snapshotId: Text
    baselineDate: date
    completeThrough: date
    evidenceReference: Reason
    certifiedBy: Text
    historicalCustomerIds: list[Text] = Field(max_length=10000)
    baseline: list[SubscriberLine] = Field(max_length=10000)
    events: list[LifecycleEvent] = Field(max_length=20000)
    ratesComplete: bool = False

    @model_validator(mode='after')
    def bounds(self):
        if self.baselineDate > self.completeThrough:
            raise ValueError('Baseline must not follow coverage end')
        ids=[r.serviceAccountId for r in self.baseline]
        event_ids=[r.eventId for r in self.events]; sequences=[r.sequence for r in self.events]
        if len(set(ids))!=len(ids) or len(set(event_ids))!=len(event_ids) or len(set(sequences))!=len(sequences):
            raise ValueError('Duplicate line/event/sequence identity')
        if len(set(self.historicalCustomerIds))!=len(self.historicalCustomerIds):
            raise ValueError('Duplicate historic customer identity')
        if not {r.customerId for r in self.baseline if r.everActive}.issubset(set(self.historicalCustomerIds)):
            raise ValueError('Baseline ever-active customers need historical membership evidence')
        if any(not self.baselineDate < e.effectiveDate <= self.completeThrough for e in self.events):
            raise ValueError('Lifecycle effect outside certified coverage')
        return self


class SettlementCustomer(Model):
    customerId: Text
    serviceAccountIds: list[Text] = Field(max_length=1000)
    invoiceIds: list[Text] = Field(min_length=1, max_length=1000)
    netBilledAmount: Annotated[Money, Field(ge=0)]
    cashCollected: Annotated[Money, Field(ge=0)]
    accountCreditsApplied: Annotated[Money, Field(ge=0)]
    rebatesApplied: Annotated[Money, Field(ge=0)] = 0
    outstandingAmount: Annotated[Money, Field(ge=0)]

    @model_validator(mode='after')
    def reconcile(self):
        if self.netBilledAmount != self.cashCollected+self.accountCreditsApplied+self.outstandingAmount:
            raise ValueError('Billing cohort does not reconcile; rebates are an overlapping breakdown')
        if len(set(self.invoiceIds))!=len(self.invoiceIds) or len(set(self.serviceAccountIds))!=len(self.serviceAccountIds):
            raise ValueError('Duplicate cohort identities')
        return self


class SettlementEvidence(Model):
    kind: Literal['billing-settlement']
    snapshotId: Text
    month: Annotated[str, Field(pattern=r'^\d{4}-(0[1-9]|1[0-2])$')]
    asOf: date
    evidenceReference: Reason
    certifiedBy: Text
    complete: bool
    rows: list[SettlementCustomer] = Field(max_length=10000)

    @model_validator(mode='after')
    def distinct(self):
        ids=[r.customerId for r in self.rows]; invoices=[i for r in self.rows for i in r.invoiceIds]
        if len(set(ids))!=len(ids) or len(set(invoices))!=len(invoices):
            raise ValueError('Cohort must contain each customer and invoice once')
        return self


class ReceivableInvoice(Model):
    invoiceId: Text
    customerId: Text
    dueDate: date | None
    outstandingAmount: Annotated[Money, Field(ge=0)]


class ReceivableEvidence(Model):
    kind: Literal['billing-receivables']
    snapshotId: Text
    asOf: date
    evidenceReference: Reason
    certifiedBy: Text
    complete: bool
    rows: list[ReceivableInvoice] = Field(max_length=20000)

    @model_validator(mode='after')
    def distinct(self):
        ids=[r.invoiceId for r in self.rows]
        if len(set(ids))!=len(ids):raise ValueError('Duplicate receivable invoice identity')
        return self


class CoverageEvidence(Model):
    kind: Literal['financial-coverage']
    snapshotId: Text
    startDate: date
    endDate: date
    policyVersion: Literal['finance-management-v1']
    ledgerFingerprint: Annotated[str, Field(pattern=r'^[a-f0-9]{64}$')]
    evidenceReference: Reason
    certifiedBy: Text
    cashFlow: bool = False
    registerReceivables: bool = False
    payables: bool = False
    collections: bool = False
    earnedRevenue: bool = False
    directCosts: bool = False
    operatingExpenses: bool = False
    nonoperating: bool = False
    incomeTax: bool = False
    accountClassifications: dict[str, Literal['EARNED_REVENUE', 'CONTRA_REVENUE',
           'DIRECT_COST', 'OPERATING_EXPENSE', 'FINANCING_EXPENSE', 'INCOME_TAX',
           'NONOPERATING_INCOME', 'NONOPERATING_EXPENSE']] = Field(default_factory=dict, max_length=1000)

    @model_validator(mode='after')
    def bounds(self):
        if self.startDate>self.endDate:raise ValueError('Invalid coverage dates')
        return self


ReportEvidence = Annotated[SubscriberEvidence | SettlementEvidence | ReceivableEvidence | CoverageEvidence,
                           Field(discriminator='kind')]


@dataclass(frozen=True)
class ReportFeedRequest:
    kind: str
    month: str
    start_date: str
    end_date: str
    as_of: str
    actor_username: str
    ledger_fingerprint: str


class ReportProvider(Protocol):
    def fetch(self, request: ReportFeedRequest) -> ReportEvidence: ...
