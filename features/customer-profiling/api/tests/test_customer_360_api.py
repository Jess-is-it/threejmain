import importlib
import os
import sys
import unittest
from pathlib import Path

from fastapi import HTTPException


os.environ["CUSTOMER_PROFILING_STORAGE"] = "memory"
os.environ["CUSTOMER_PROFILING_SEED_DEMO"] = "false"
os.environ.pop("DATABASE_URL", None)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

customer_profiling = importlib.import_module("customer_profiling.router")


class Customer360ApiTests(unittest.TestCase):
    def setUp(self):
        customer_profiling.customers.clear()
        customer_profiling.customer_store.storage_mode = "memory"
        customer_profiling.customer_store.database_url = ""
        customer_profiling.customer_store._schema_ready = False
        customer_profiling.CUSTOMER_SEED_DEMO = False
        self.admin = {"id": "admin-1", "username": "admin", "fullName": "Admin User"}

        def current_admin(authorization):
            if authorization != "Bearer valid-token":
                raise HTTPException(status_code=401, detail="Unauthorized")
            return self.admin

        customer_profiling.configure_customer_profiling(current_admin, lambda *args: None)
        customer_profiling.customers.append(
            {
                "id": "customer-1",
                "accountNumber": "ACC-001",
                "firstName": "ADA",
                "middleName": "",
                "lastName": "LOVELACE",
                "customerType": "RESIDENTIAL",
                "status": "ACTIVE",
                "contactNumber": "09170000001",
                "addressLine1": "PUROK 1",
                "addressLine2": "",
                "barangay": "ALIBAGO",
                "city": "ENRILE",
                "province": "CAGAYAN",
                "gender": "FEMALE",
                "secondaryContacts": [],
                "createdAt": "2026-07-01T00:00:00+00:00",
                "updatedAt": "2026-07-02T00:00:00+00:00",
                "deletedAt": None,
                "createdByUserId": "admin-1",
                "updatedByUserId": "admin-1",
            }
        )

    def test_customer_detail_loading_returns_canonical_customer_identity(self):
        admin = customer_profiling.require_admin("Bearer valid-token")
        detail = customer_profiling.get_customer("customer-1", admin=admin)

        self.assertEqual("customer-1", detail["id"])
        self.assertEqual("ACC-001", detail["accountNumber"])
        self.assertEqual("ADA LOVELACE", detail["fullName"])
        self.assertEqual("ACTIVE", detail["status"])

    def test_customer_detail_loading_respects_shared_admin_guard(self):
        with self.assertRaises(HTTPException) as raised:
            customer_profiling.require_admin(None)

        self.assertEqual(401, raised.exception.status_code)

    def test_missing_customer_returns_not_found_for_customer_360_links(self):
        admin = customer_profiling.require_admin("Bearer valid-token")

        with self.assertRaises(HTTPException) as raised:
            customer_profiling.get_customer("missing-customer", admin=admin)

        self.assertEqual(404, raised.exception.status_code)


if __name__ == "__main__":
    unittest.main()
