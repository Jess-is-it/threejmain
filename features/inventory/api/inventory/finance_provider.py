"""Quantity evidence and current classifications, explicitly without historic COGS."""
from finance.integration import IntegrationStore


class FinanceInventoryReferences:
    def __init__(self, authorize, store=None):
        self.authorize, self.store = authorize, store or IntegrationStore()

    def fetch(self, username, search='', offset=0, limit=50):
        self.authorize(username)
        with self.store.connection() as conn:
            rows = conn.execute('''SELECT id,data FROM inventory_items WHERE deleted_at IS NULL
                AND (data->>'name' ILIKE %s OR data->>'sku' ILIKE %s OR id=%s)
                ORDER BY id LIMIT %s OFFSET %s''', (f'%{search}%', f'%{search}%', search, limit, offset)).fetchall()
            items = []
            for row in rows:
                item = row['data']
                items.append({'itemId': row['id'], 'sku': item.get('sku'), 'name': item.get('name'),
                              'category': item.get('category'), 'itemType': item.get('itemType'),
                              'currentUnitCost': str(item.get('unitCost')) if item.get('unitCost') is not None else None,
                              'historicalCostStatus': 'UNAVAILABLE'})
        return {'items': items, 'source': 'inventory', 'offset': offset, 'limit': limit,
                'costingStatus': 'UNAVAILABLE', 'reason': 'Inventory quantity movements and current item prices do not establish dated valuation layers or COGS.'}
