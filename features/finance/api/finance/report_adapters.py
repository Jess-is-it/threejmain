"""Billing-owned cohort arithmetic, with certified unpaginated identity evidence."""
from decimal import Decimal

from .report_schemas import SettlementEvidence
from .source_adapters import source_money


class BillingReportAdapter:
    @staticmethod
    def settlement(report,proof,*,invoice_ids_by_customer,service_account_ids_by_customer,all_rows=None):
        if report.get('scope')!='MONTHLY_SERVICE_INVOICES' or report.get('timeZone')!='Asia/Manila':
            raise ValueError('Need authoritative monthly-service cohort/timezone')
        if report.get('selectedStatus','ALL')!='ALL' or report.get('search'):
            raise ValueError('Filtered lists cannot certify the entire selected-month cohort')
        rows=all_rows if all_rows is not None else report['rows']
        if len(rows)!=report['billedSubscriberCount'] or report['pagination']['totalRows']!=len(rows):
            raise ValueError('All rows from the same source snapshot are required; never certify one page')
        if set(proof)!={'snapshotId','certifiedBy','evidenceReference','complete'}:
            raise ValueError('Exact certified snapshot proof required')
        clean=[]
        keys=('cashCollected','accountCreditsApplied','rebatesApplied','outstandingAmount')
        for r in rows:
            customer=r['customerId']
            clean.append({'customerId':customer,'invoiceIds':invoice_ids_by_customer[customer],
                'serviceAccountIds':service_account_ids_by_customer[customer],
                'netBilledAmount':source_money(r['billedAmount']),**{k:source_money(r[k]) for k in keys}})
        evidence=SettlementEvidence.model_validate({'kind':'billing-settlement','month':report['billingMonth'],
            'asOf':report['asOfDate'],'rows':clean,**proof})
        for k in ('netBilledAmount',*keys):
            if sum((getattr(r,k) for r in evidence.rows),Decimal('0.00'))!=Decimal(source_money(report[k])):
                raise ValueError('Cohort row sums do not agree with authoritative totals')
        if sum(len(r.invoiceIds) for r in evidence.rows)!=report['cohortInvoiceCount']:
            raise ValueError('Stable source invoice identities do not match cohort count')
        counts={'fullyPaidSubscriberCount':sum(r.outstandingAmount==0 for r in evidence.rows),
            'partiallyPaidSubscriberCount':sum(r.outstandingAmount>0 and r.cashCollected+r.accountCreditsApplied>0 for r in evidence.rows),
            'unpaidSubscriberCount':sum(r.outstandingAmount>0 and r.cashCollected+r.accountCreditsApplied==0 for r in evidence.rows)}
        if any(report[k]!=v for k,v in counts.items()):raise ValueError('Source customer statuses do not match certified rows')
        return evidence
