"""Minimal canonical identity/location references; never copy contact mobiles."""
from finance.integration import IntegrationStore


class FinanceCustomerReferences:
    def __init__(self, authorize, store=None):
        self.authorize, self.store = authorize, store or IntegrationStore()

    def fetch(self, username, search='', offset=0, limit=50):
        self.authorize(username)
        with self.store.connection() as conn:
            rows = conn.execute('''SELECT id,account_number,full_name,location_id,province,city,barangay
                FROM customer_profiles WHERE deleted_at IS NULL AND
                (full_name ILIKE %s OR account_number ILIKE %s OR id=%s)
                ORDER BY account_number,id LIMIT %s OFFSET %s''', (f'%{search}%', f'%{search}%', search, limit, offset)).fetchall()
        return {'items': [{'customerId': r['id'], 'accountNumber': r['account_number'], 'name': r['full_name'],
                           'locationId': r['location_id'], 'province': r['province'], 'city': r['city'], 'barangay': r['barangay']} for r in rows],
                'source': 'customer-profiling', 'contactsCopied': False, 'offset': offset, 'limit': limit}
