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
        self.audit_events = []
        self.location_requests = []
        self.previous_ensure_location_record = customer_profiling.ensure_location_record

        def ensure_manual_location(data, actor=None):
            self.location_requests.append((dict(data), dict(actor or {})))
            return {
                "id": data.get("locationId") or "manual-location-1",
                "location_name": data.get("location_name") or data.get("barangay") or "",
                "address": data.get("address") or "",
                "geocode_source": "MANUAL",
            }

        customer_profiling.ensure_location_record = ensure_manual_location

        def current_admin(authorization):
            if authorization != "Bearer valid-token":
                raise HTTPException(status_code=401, detail="Unauthorized")
            return self.admin

        customer_profiling.configure_customer_profiling(current_admin, lambda *args: self.audit_events.append(args))
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

    def tearDown(self):
        customer_profiling.ensure_location_record = self.previous_ensure_location_record

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

    def test_current_customer_locations_are_backfilled_to_manual_location_links_once(self):
        first = customer_profiling.sync_customer_manual_locations()
        second = customer_profiling.sync_customer_manual_locations()

        self.assertEqual({"scanned": 1, "linked": 1}, first)
        self.assertEqual({"scanned": 0, "linked": 0}, second)
        self.assertEqual("manual-location-1", customer_profiling.customers[0]["locationId"])
        self.assertEqual("ALIBAGO", customer_profiling.customers[0]["locationName"])
        self.assertEqual(1, len(self.location_requests))
        self.assertEqual("PUROK 1, ALIBAGO, ENRILE, CAGAYAN", self.location_requests[0][0]["address"])
        self.assertNotIn("geocode_source", self.location_requests[0][0])

    def test_missing_customer_returns_not_found_for_customer_360_links(self):
        admin = customer_profiling.require_admin("Bearer valid-token")

        with self.assertRaises(HTTPException) as raised:
            customer_profiling.get_customer("missing-customer", admin=admin)

        self.assertEqual(404, raised.exception.status_code)

    def test_onboarding_verification_persists_actor_timestamp_and_reference(self):
        result = customer_profiling.update_onboarding_verification(
            "customer-1",
            "serviceability",
            customer_profiling.OnboardingVerificationPayload(
                outcome="qualified",
                reference="NAP-04 / Port 8",
                notes="Optical path checked.",
            ),
            admin=self.admin,
        )

        verification = result["onboardingVerifications"]["serviceability"]
        self.assertEqual("QUALIFIED", verification["outcome"])
        self.assertEqual("NAP-04 / Port 8", verification["reference"])
        self.assertEqual("Admin User", verification["verifiedBy"])
        self.assertTrue(verification["verifiedAt"])
        self.assertEqual("customer_onboarding_verification_updated", self.audit_events[-1][0])

    def test_network_activation_requires_both_manual_checks(self):
        with self.assertRaises(HTTPException) as raised:
            customer_profiling.update_onboarding_verification(
                "customer-1",
                "network-equipment",
                customer_profiling.OnboardingVerificationPayload(
                    outcome="VERIFIED",
                    networkAccessVerified=True,
                    equipmentAssignmentVerified=False,
                ),
                admin=self.admin,
            )

        self.assertEqual(400, raised.exception.status_code)
        self.assertIn("both be verified", raised.exception.detail)

    def test_onboarding_verification_rejects_unknown_step(self):
        with self.assertRaises(HTTPException) as raised:
            customer_profiling.update_onboarding_verification(
                "customer-1",
                "payment",
                customer_profiling.OnboardingVerificationPayload(outcome="VERIFIED"),
                admin=self.admin,
            )

        self.assertEqual(400, raised.exception.status_code)


if __name__ == "__main__":
    unittest.main()
