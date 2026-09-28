import importlib
import os
import sys
import unittest
from pathlib import Path


os.environ["POINT_OF_SALE_STORAGE"] = "memory"
os.environ.pop("DATABASE_URL", None)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

pos = importlib.import_module("point_of_sale.router")


class PointOfSaleRegisterTests(unittest.TestCase):
    def setUp(self):
        self.inventory_adapters = {
            name: getattr(pos, name)
            for name in (
                "get_pos_catalog_item",
                "list_pos_catalog_items",
                "record_pos_sale_movements",
                "validate_pos_sale_inventory",
            )
        }
        for name in self.inventory_adapters:
            setattr(pos, name, None)
        for collection in pos.POS_RECORD_COLLECTIONS.values():
            collection.clear()
        pos.invoice_payment_sms_results.clear()
        pos.pos_store.storage_mode = "memory"
        pos.pos_store.database_url = ""
        pos.pos_store._loaded = True
        pos.pos_store._schema_ready = False
        self.audit_events = []
        self.admin = {"id": "admin-1", "username": "cashier", "fullName": "Cashier User"}
        pos.configure_point_of_sale(
            lambda authorization: self.admin,
            lambda action, target_type, target_id, details, actor: self.audit_events.append(
                {
                    "action": action,
                    "targetType": target_type,
                    "targetId": target_id,
                    "details": details,
                    "actor": actor,
                }
            ),
        )

    def tearDown(self):
        for name, adapter in self.inventory_adapters.items():
            setattr(pos, name, adapter)

    def test_register_sale_posts_payment_and_replays_idempotency(self):
        pos.seed_point_of_sale_data()
        item = pos.items[0]
        payload = pos.SalePayload(
            saleDate="2026-08-03",
            lineItems=[
                pos.SaleLinePayload(
                    itemId=item["id"],
                    quantity=1,
                    unitPrice=item["unitPrice"],
                )
            ],
            payments=[
                {
                    "amount": item["unitPrice"],
                    "tenderedAmount": item["unitPrice"] + 50,
                    "method": "CASH",
                    "paymentDate": "2026-08-03",
                    "status": "POSTED",
                }
            ],
        )

        sale = pos.create_sale(payload, idempotency_key="pos-sale:test-1", admin=self.admin)
        replay = pos.create_sale(payload, idempotency_key="pos-sale:test-1", admin=self.admin)

        self.assertEqual(1, len(pos.sales))
        self.assertEqual(1, len(pos.payments))
        self.assertEqual(1, len(pos.cashier_sessions))
        self.assertEqual("PAID", sale["paymentStatus"])
        self.assertEqual(item["unitPrice"], sale["paidTotal"])
        self.assertEqual(50.0, pos.payments[0]["changeAmount"])
        self.assertTrue(replay["idempotentReplay"])
        self.assertEqual(sale["id"], replay["id"])
        self.assertIn("pos_sale_created", [event["action"] for event in self.audit_events])

    def test_readiness_reports_memory_fallback_when_postgres_is_disabled(self):
        readiness = pos.pos_readiness(admin=self.admin)

        self.assertFalse(readiness["realDataReady"])
        self.assertEqual("memory", readiness["storage"]["mode"])
        self.assertEqual(["item", "session", "sale", "payment"], readiness["durableRecords"])


if __name__ == "__main__":
    unittest.main()
