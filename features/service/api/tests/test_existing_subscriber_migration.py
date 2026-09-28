import importlib
import os
import sys
import unittest
from pathlib import Path


os.environ["SERVICE_STORAGE"] = "memory"
os.environ["SERVICE_SEED_CATALOG"] = "false"
os.environ.pop("DATABASE_URL", None)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

service = importlib.import_module("service.router")


class ExistingSubscriberServiceMigrationTests(unittest.TestCase):
    def setUp(self):
        for collection in service.SERVICE_RECORD_COLLECTIONS.values():
            collection.clear()
        service.service_store.storage_mode = "memory"
        service.service_store.database_url = ""
        service.service_store._loaded = True
        self.customer = {
            "id": "customer-1",
            "accountNumber": "68392741",
            "firstName": "Juan",
            "lastName": "Dela Cruz",
            "contactNumber": "09171234567",
            "address": "Purok 1, Alibago, Enrile",
            "status": "PENDING",
        }
        self.status_syncs = []
        service.configure_service(
            lambda authorization: {"username": "migration-admin"},
            lambda *args: None,
            lambda customer_id: self.customer if customer_id == self.customer["id"] else None,
            lambda search: [self.customer],
            customer_status_syncer=lambda customer_id, status, details, actor: self.status_syncs.append((customer_id, status, details, actor)) or {"status": status},
        )

    def test_migration_creates_active_line_without_order_and_replays_idempotently(self):
        payload = {
            "migrationFingerprint": "line-fingerprint-1",
            "batchId": "batch-1",
            "rowId": "row-1",
            "customerId": self.customer["id"],
            "planAction": "CREATE_LEGACY",
            "planKey": "HOME FIBER 50 MBPS|1000.00|PREPAID",
            "planName": "Home Fiber 50 Mbps",
            "monthlyRate": 1000,
            "billingMode": "PREPAID",
            "serviceStatus": "ACTIVE",
            "serviceStartDate": "2024-01-15",
            "cutoverDate": "2026-09-16",
            "nextBillingDate": "2026-10-01",
            "outstandingBalance": 2000,
            "lastPaymentDate": "2026-08-05",
            "serviceAddress": "Purok 1, Alibago, Enrile",
        }

        result = service.migrate_existing_service_line(payload, "migration-admin")
        replay = service.migrate_existing_service_line(payload, "migration-admin")

        self.assertEqual("ACTIVE", result["account"]["status"])
        self.assertEqual("2024-01-15", result["account"]["installationDate"])
        self.assertEqual("line-fingerprint-1", result["account"]["migration"]["fingerprint"])
        self.assertEqual(0, len(service.service_orders))
        self.assertEqual(1, len(service.service_accounts))
        self.assertEqual(result["account"]["id"], replay["account"]["id"])
        self.assertEqual("ACTIVE", self.status_syncs[0][1])

        reconciled = service.subscriber_migration_accounts("batch-1", admin={"username": "migration-admin"})
        self.assertEqual(1, len(reconciled))
        self.assertEqual("PENDING", reconciled[0]["customer"]["status"])


if __name__ == "__main__":
    unittest.main()
