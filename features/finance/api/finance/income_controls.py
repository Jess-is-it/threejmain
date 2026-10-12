"""Nonspendable source subledger controls. No customer operational ledger."""
AR = 'finance-billing-ar'
DEFERRED = 'finance-deferred-service'
CREDIT = 'finance-customer-credit'
POS_AR = 'finance-pos-ar'
POS_REVENUE = 'finance-pos-revenue'
POS_DISCOUNT = 'finance-pos-discount'
TAX = 'finance-sales-tax'
VARIANCE = 'finance-custody-variance'

INCOME_CONTROLS = {
    AR: ('BILLING_AR','Billing receivable control','ASSET'),
    DEFERRED: ('DEFERRED_SERVICE','Deferred service consideration','LIABILITY'),
    CREDIT: ('CUSTOMER_CREDIT','Customer advance and rebate credit control','LIABILITY'),
    POS_AR: ('POS_AR','Register sale receivable control','ASSET'),
    POS_REVENUE: ('POS_REVENUE','Delivered register sale revenue','REVENUE'),
    POS_DISCOUNT: ('POS_DISCOUNT','Register sale discounts','CONTRA_REVENUE'),
    TAX: ('SALES_TAX','Sales tax collected liability','LIABILITY'),
    VARIANCE: ('CUSTODY_VARIANCE','Unclassified collector discrepancy clearing','ASSET'),
}
