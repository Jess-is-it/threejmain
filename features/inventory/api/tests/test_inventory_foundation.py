import importlib
import sys
import unittest
from pathlib import Path

from fastapi import HTTPException


API_ROOT = Path(__file__).resolve().parents[1]
APP_API_ROOT = Path(__file__).resolve().parents[4] / "app-shell" / "api"
for path in [str(API_ROOT), str(APP_API_ROOT)]:
    if path not in sys.path:
        sys.path.insert(0, path)

inventory = importlib.import_module("inventory.router")


class InventoryFoundationTests(unittest.TestCase):
    def setUp(self):
        self.original_mode = inventory.inventory_store.storage_mode
        inventory.inventory_store.storage_mode = "memory"
        inventory.items.clear()
        inventory.movements.clear()
        inventory.assignments.clear()
        inventory.locations.clear()
        inventory.configure_inventory(lambda _authorization: {"username": "tester"}, lambda *_args: None)
        inventory.seed_inventory_data()

    def tearDown(self):
        inventory.items.clear()
        inventory.movements.clear()
        inventory.assignments.clear()
        inventory.locations.clear()
        inventory.inventory_store.storage_mode = self.original_mode

    @staticmethod
    def admin():
        return {"username": "tester"}

    @staticmethod
    def stock_item():
        return next(item for item in inventory.items if item["sku"] == "CBL-0002")

    def test_manual_movement_requires_idempotency_key(self):
        with self.assertRaises(HTTPException) as caught:
            inventory.create_movement(
                inventory.MovementPayload(itemId=self.stock_item()["id"], type="RECEIVE", quantity=1),
                None,
                self.admin(),
            )
        self.assertEqual(caught.exception.status_code, 400)
        self.assertIn("Idempotency-Key", caught.exception.detail)

    def test_idempotent_movement_replay_does_not_apply_stock_twice(self):
        item = self.stock_item()
        initial_quantity = item["quantityOnHand"]
        payload = inventory.MovementPayload(itemId=item["id"], type="RECEIVE", quantity=5, toLocation="Main stockroom")

        first = inventory.create_movement(payload, "test-receipt-1", self.admin())
        replay = inventory.create_movement(payload, "test-receipt-1", self.admin())

        self.assertEqual(first["id"], replay["id"])
        self.assertTrue(replay["idempotentReplay"])
        self.assertEqual(item["quantityOnHand"], initial_quantity + 5)
        self.assertEqual(len(inventory.movements), 1)

    def test_posted_movements_are_immutable_and_reversed_by_new_ledger_entry(self):
        item = self.stock_item()
        initial_quantity = item["quantityOnHand"]
        posted = inventory.create_movement(
            inventory.MovementPayload(itemId=item["id"], type="RECEIVE", quantity=7, toLocation="Main stockroom"),
            "test-receipt-2",
            self.admin(),
        )

        with self.assertRaises(HTTPException) as update_caught:
            inventory.update_movement(posted["id"], inventory.MovementPayload(quantity=9), self.admin())
        with self.assertRaises(HTTPException) as delete_caught:
            inventory.delete_movement(posted["id"], self.admin())

        reversal = inventory.reverse_movement(
            posted["id"],
            inventory.MovementReversalPayload(reason="Incorrect receipt"),
            "test-reversal-2",
            self.admin(),
        )

        self.assertEqual(update_caught.exception.status_code, 405)
        self.assertEqual(delete_caught.exception.status_code, 405)
        self.assertIn(posted, inventory.movements)
        self.assertEqual(reversal["reversalOfId"], posted["id"])
        self.assertEqual(len(inventory.movements), 2)
        self.assertEqual(item["quantityOnHand"], initial_quantity)

    def test_location_codes_are_unique_in_memory_fallback(self):
        created = inventory.create_location(
            inventory.LocationPayload(code="VAN-01", name="Technician Van 01", type="VEHICLE"),
            self.admin(),
        )
        self.assertEqual(created["type"], "VEHICLE")

        with self.assertRaises(HTTPException) as caught:
            inventory.create_location(
                inventory.LocationPayload(code="van-01", name="Duplicate", type="VEHICLE"),
                self.admin(),
            )
        self.assertEqual(caught.exception.status_code, 409)

    def test_inventory_migration_declares_relational_and_append_only_controls(self):
        migrations = importlib.import_module("app.db_migrations")
        migration = next(row for row in migrations.MIGRATIONS if row["id"] == migrations.INVENTORY_FOUNDATION_MIGRATION_ID)
        sql = "\n".join(migration["statements"])

        self.assertIn("CREATE TABLE IF NOT EXISTS inventory_locations", sql)
        self.assertIn("CREATE TABLE IF NOT EXISTS inventory_stock_balances", sql)
        self.assertIn("CREATE TABLE IF NOT EXISTS inventory_stock_movements", sql)
        self.assertIn("uq_inventory_movement_idempotency", sql)
        self.assertIn("trg_inventory_movements_immutable", sql)


if __name__ == "__main__":
    unittest.main()
