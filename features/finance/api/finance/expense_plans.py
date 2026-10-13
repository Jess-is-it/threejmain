"""Earliest-due-first supplier allocation, derived from exact posted settlement."""
from decimal import Decimal


def settlement_plan(record, paid, as_of):
    schedule = record.get('installments') or [{'dueDate': record['dueDate'], 'amount': record['amount']}]
    remaining_paid = Decimal(paid)
    rows = []
    for index, item in enumerate(schedule):
        value = Decimal(item['amount'])
        allocated = min(value, remaining_paid)
        remaining_paid -= allocated
        outstanding = value - allocated
        rows.append({**item, 'number': index + 1, 'paidAmount': format(allocated, '.2f'),
                     'outstandingAmount': format(outstanding, '.2f'),
                     'status': 'PAID' if not outstanding else 'PARTIALLY_PAID' if allocated else 'UNPAID'})
    open_rows = [r for r in rows if Decimal(r['outstandingAmount'])]
    overdue = sum((Decimal(r['outstandingAmount']) for r in open_rows if r['dueDate'] < as_of), Decimal('0.00'))
    return {'settlementSchedule': rows, 'nextDueDate': open_rows[0]['dueDate'] if open_rows else None,
            'nextDueAmount': open_rows[0]['outstandingAmount'] if open_rows else '0.00',
            'overdueAmount': format(overdue, '.2f')}
