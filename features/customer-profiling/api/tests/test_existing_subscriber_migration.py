import importlib
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


os.environ["CUSTOMER_PROFILING_STORAGE"] = "memory"
os.environ.pop("DATABASE_URL", None)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

customer_profiling = importlib.import_module("customer_profiling.router")


class ExistingSubscriberMigrationTests(unittest.TestCase):
    def setUp(self):
        customer_profiling.customers.clear()
        customer_profiling.subscriber_migration_store._batches.clear()
        customer_profiling.subscriber_migration_store._rows.clear()
        customer_profiling.customer_store.storage_mode = "memory"
        customer_profiling.ensure_location_record = None
        self.admin = {"id": "admin-1", "username": "migration-admin", "fullName": "Migration Admin"}
        self.catalog = {
            "id": "catalog-1",
            "name": "Home Fiber 50 Mbps",
            "code": "HOME-50",
            "monthlyRate": 1000,
            "billingMode": "PREPAID",
            "status": "ACTIVE",
        }
        self.early_bird = {
            "id": "promotion-early-bird-200",
            "promoCode": "EARLY-BIRD-200",
            "name": "Early Bird 200",
            "appliesTo": "MONTHLY_SERVICE",
            "discountType": "FIXED_AMOUNT",
            "discountAmount": 200,
            "discountPercent": 0,
            "paymentRule": "EARLY_BIRD",
            "billingMode": "PREPAID",
            "stackable": False,
            "requiresApproval": False,
            "startDate": "2026-01-01",
            "endDate": "",
            "status": "ACTIVE",
        }
        self.service_calls = []
        self.billing_calls = []
        customer_profiling._service_catalog_provider = lambda: [self.catalog]
        customer_profiling._service_migration_provider = self.migrate_service
        customer_profiling._billing_migration_provider = self.migrate_billing
        customer_profiling._billing_promotion_provider = lambda: [self.early_bird]

    def migrate_service(self, payload, actor):
        self.service_calls.append(payload)
        return {
            "account": {
                "id": f"service-{payload['rowId']}",
                "serviceAccountNumber": "SA-202609-0001",
                "serviceReference": "SVC-0001",
            },
            "catalog": self.catalog,
        }

    def migrate_billing(self, payload, actor):
        self.billing_calls.append(payload)
        return {
            "subscription": {"id": "subscription-1"},
            "invoices": [
                {"invoiceNumber": f"INV-{month}"}
                for month in payload.get("arrearMonths", [])
            ],
        }

    @staticmethod
    def sample_row(**overrides):
        row = {
            "firstName": "JUAN",
            "lastName": "DELA CRUZ",
            "contactNumber": "09171234567",
            "addressLine1": "PUROK 1",
            "province": "CAGAYAN",
            "city": "ENRILE",
            "barangay": "ALIBAGO",
            "latitude": "17.559311",
            "longitude": "121.684928",
            "gender": "MALE",
            "monthlyRate": "1000",
            "billingMode": "PREPAID",
            "serviceStartDate": "2024-01-15",
            "serviceStatus": "ACTIVE",
            "lastPaymentDate": "2026-08-05",
            "lastPaymentAmount": "2000",
            "paymentCoverageFromMonth": "",
            "lastPaidThroughMonth": "2026-07",
            "outstandingBalance": "2000",
            "balanceAsOfDate": "2026-09-16",
        }
        row.update(overrides)
        return row

    def test_two_thousand_payment_covers_two_one_thousand_months(self):
        normalized, errors = customer_profiling.normalize_migration_row(self.sample_row(), 2, "2026-09-16")

        self.assertEqual([], errors)
        preview = normalized["billingPreview"]
        self.assertEqual("2026-06", preview["coverageFromMonth"])
        self.assertEqual("2026-07", preview["paidThroughMonth"])
        self.assertEqual(2, preview["coveredMonthCount"])
        self.assertEqual(["2026-08", "2026-09"], preview["arrearMonths"])
        self.assertEqual(2000, preview["calculatedBalance"])
        self.assertEqual("INFERRED_COVERAGE", preview["classification"])
        self.assertEqual("2026-10-01", preview["nextBillingDate"])
        self.assertEqual(1, preview["billingDay"])
        self.assertEqual("1000.00|PREPAID", normalized["planKey"])
        self.assertEqual("MONTHLY_RATE_AND_BILLING_MODE", normalized["planReferenceSource"])

    def test_coordinates_normalize_dms_and_reject_invalid_values_during_preview(self):
        normalized, errors = customer_profiling.normalize_migration_row(
            self.sample_row(latitude='17°31\'31.42"N', longitude='121°41′05.74″E'),
            2,
            "2026-09-16",
        )
        self.assertEqual([], errors)
        self.assertEqual("17.52539444", normalized["latitude"])
        self.assertEqual("121.68492778", normalized["longitude"])

        southern, errors = customer_profiling.normalize_migration_row(
            self.sample_row(latitude='17°31\'31.42"S', longitude='121°41\'05.74"W'),
            2,
            "2026-09-16",
        )
        self.assertEqual([], errors)
        self.assertEqual("-17.52539444", southern["latitude"])
        self.assertEqual("-121.68492778", southern["longitude"])

        for latitude, longitude in [
            ('17°61\'31.42"N', '121.684928'),
            ('17°31\'61.42"N', '121.684928'),
            ('17°31\'31.42"E', '121.684928'),
            ('91°00\'00"N', '121.684928'),
            ('17.559311', '181.684928'),
        ]:
            with self.subTest(latitude=latitude, longitude=longitude):
                _, errors = customer_profiling.normalize_migration_row(
                    self.sample_row(latitude=latitude, longitude=longitude),
                    2,
                    "2026-09-16",
                )
                self.assertTrue(any(error.startswith("latitude") or error.startswith("longitude") for error in errors))

    def test_postpaid_schedule_keeps_current_month_for_month_end_generation(self):
        normalized, errors = customer_profiling.normalize_migration_row(
            self.sample_row(billingMode="POSTPAID", lastPaymentAmount="1000"),
            2,
            "2026-09-16",
        )

        self.assertEqual([], errors)
        preview = normalized["billingPreview"]
        self.assertEqual(["2026-08"], preview["arrearMonths"])
        self.assertEqual("2026-09-01", preview["nextBillingDate"])

    def test_discounted_last_payment_matches_early_bird_without_creating_a_residual(self):
        normalized, errors = customer_profiling.normalize_migration_row(
            self.sample_row(
                qualifiedPromotionCodes="EARLY-BIRD-200",
                lastPaymentPromotionCode="EARLY-BIRD-200",
                lastPaymentAmount="800",
                paymentCoverageFromMonth="2026-08",
                lastPaidThroughMonth="2026-08",
                outstandingBalance="1000",
            ),
            2,
            "2026-09-16",
            [self.early_bird],
        )

        self.assertEqual([], errors)
        preview = normalized["billingPreview"]
        self.assertEqual("MATCHED", preview["legacyPaymentPromotion"]["matchStatus"])
        self.assertEqual(200, preview["legacyPaymentPromotion"]["discountPerMonth"])
        self.assertEqual(800, preview["legacyPaymentPromotion"]["expectedDiscountedAmount"])
        self.assertEqual("PROMOTION_DISCOUNTED", preview["paymentAmountInterpretation"])
        self.assertEqual(["2026-09"], preview["arrearMonths"])
        self.assertEqual(1000, preview["calculatedBalance"])
        self.assertFalse(any("does not equal" in warning for warning in preview["warnings"]))

    def test_balance_variance_defaults_to_reviewed_opening_balance(self):
        normalized, errors = customer_profiling.normalize_migration_row(
            self.sample_row(outstandingBalance="2750"),
            2,
            "2026-09-16",
        )

        self.assertEqual([], errors)
        self.assertEqual("BALANCE_VARIANCE", normalized["billingPreview"]["classification"])
        self.assertEqual(750, normalized["billingPreview"]["balanceVariance"])
        self.assertEqual("OPENING_BALANCE", normalized["billingPreview"]["defaultResolution"])

    def test_commit_generates_customer_and_checkpoints_cross_module_results(self):
        location_data = []

        def ensure_location(data, actor):
            location_data.append(data)
            return {"id": "location-1", "location_name": "Imported location"}

        customer_profiling.ensure_location_record = ensure_location
        with patch.object(customer_profiling, "subscriber_migration_business_date", side_effect=["2026-09-16", "2026-09-18"]):
            batch = customer_profiling.create_subscriber_migration_batch(
                customer_profiling.ExistingSubscriberMigrationBatchPayload(
                    filename="existing.csv",
                    rows=[self.sample_row(latitude='17°31\'31.42"N', longitude='121°41\'05.74"E')],
                ),
                self.admin,
            )
            self.assertEqual("PENDING_COMMIT", batch["effectiveDateStatus"])
            row = batch["rows"][0]
            self.assertEqual("17.52539444", row["normalized"]["latitude"])
            self.assertEqual("121.68492778", row["normalized"]["longitude"])
            committed = customer_profiling.commit_subscriber_migration_batch(
                batch["id"],
                customer_profiling.ExistingSubscriberMigrationCommitPayload(
                    planMappings={row["planKey"]: {"action": "MAP_EXISTING", "catalogId": self.catalog["id"]}},
                    rowDecisions={row["id"]: {"customerAction": "CREATE", "balanceResolution": "MONTHLY_INVOICES"}},
                ),
                self.admin,
            )

        result = committed["rows"][0]["result"]
        self.assertEqual("COMPLETED", committed["status"])
        self.assertEqual("IMPORTED", committed["rows"][0]["status"])
        self.assertEqual(8, len(result["accountNumber"]))
        self.assertEqual("SA-202609-0001", result["serviceAccountNumber"])
        self.assertEqual(2, result["invoiceCount"])
        self.assertTrue(customer_profiling.customers[0]["migration"]["existingSubscriber"])
        self.assertEqual("17.52539444", customer_profiling.customers[0]["latitude"])
        self.assertEqual("121.68492778", location_data[0]["longitude"])
        self.assertEqual(["2026-08", "2026-09"], self.billing_calls[0]["arrearMonths"])
        self.assertEqual("2026-09-18", committed["cutoverDate"])
        self.assertEqual("ASSIGNED", committed["effectiveDateStatus"])
        self.assertTrue(committed["migrationCommittedAt"])
        self.assertEqual("2026-09-18", self.service_calls[0]["cutoverDate"])
        self.assertEqual("2026-09-18", self.billing_calls[0]["cutoverDate"])
        self.assertEqual("2026-10-01", self.billing_calls[0]["nextBillingDate"])
        self.assertEqual(1, self.billing_calls[0]["billingDay"])
        self.assertEqual(self.catalog["name"], self.billing_calls[0]["planName"])

        customer_profiling.customers[0]["status"] = "ACTIVE"
        current_customers = customer_profiling.subscriber_migration_current_customers(batch["id"], self.admin)
        self.assertEqual([{"id": result["customerId"], "status": "ACTIVE", "firstName": "JUAN", "lastName": "DELA CRUZ"}], current_customers)

        replay = customer_profiling.commit_subscriber_migration_batch(
            batch["id"],
            customer_profiling.ExistingSubscriberMigrationCommitPayload(),
            self.admin,
        )
        self.assertEqual("IMPORTED", replay["rows"][0]["status"])
        self.assertEqual("2026-09-18", replay["cutoverDate"])
        self.assertEqual(1, len(self.service_calls))
        self.assertEqual(1, len(self.billing_calls))

    def test_template_uses_complete_location_catalog_without_schedule_columns(self):
        template = customer_profiling.existing_subscriber_template(self.admin)

        self.assertEqual("existing-subscribers-migration-template.xlsx", template["filename"])
        self.assertEqual(30, len(template["headers"]))
        self.assertNotIn("billingDay", template["headers"])
        self.assertNotIn("nextBillingDate", template["headers"])
        self.assertNotIn("locationId", template["headers"])
        self.assertNotIn("locationName", template["headers"])
        self.assertNotIn("planName", template["headers"])
        self.assertIn("latitude", template["headers"])
        self.assertIn("longitude", template["headers"])
        self.assertIn("monthlyRate", template["headers"])
        self.assertIn("qualifiedPromotionCodes", template["headers"])
        self.assertIn("lastPaymentPromotionCode", template["headers"])
        self.assertEqual("EARLY-BIRD-200", template["promotions"][0]["promoCode"])
        self.assertIn("EARLY-BIRD-200", template["allowedValues"]["promotionCode"])
        self.assertEqual(template["headers"], [item["column"] for item in template["columnGuide"]])
        service_start_guide = next(item for item in template["columnGuide"] if item["column"] == "serviceStartDate")
        self.assertEqual("Yes", service_start_guide["required"])
        self.assertEqual("YYYY-MM-DD", service_start_guide["format"])
        self.assertEqual("2024-01-15", service_start_guide["example"])
        last_payment_guide = next(item for item in template["columnGuide"] if item["column"] == "lastPaymentAmount")
        self.assertIn("old-system payment", last_payment_guide["purpose"])
        self.assertEqual(29, len(template["allowedValues"]["citiesByProvince"]["CAGAYAN"]))
        self.assertEqual(37, len(template["allowedValues"]["citiesByProvince"]["ISABELA"]))
        self.assertEqual(22, len(template["allowedValues"]["barangaysByProvinceCity"]["CAGAYAN::ENRILE"]))
        self.assertIn("DELFIN ALBANO", template["allowedValues"]["citiesByProvince"]["ISABELA"])

    def test_rate_and_billing_mode_drive_plan_mapping(self):
        normalized, errors = customer_profiling.normalize_migration_row(self.sample_row(), 2, "2026-09-16")
        self.assertEqual([], errors)

        one_match = customer_profiling.migration_plan_groups([normalized], [self.catalog])[0]
        self.assertEqual({"action": "MAP_EXISTING", "catalogId": self.catalog["id"]}, one_match["suggestedMapping"])

        ambiguous = customer_profiling.migration_plan_groups(
            [normalized],
            [self.catalog, {**self.catalog, "id": "catalog-2", "name": "Another 1000 Plan"}],
        )[0]
        self.assertEqual({"action": "REVIEW"}, ambiguous["suggestedMapping"])

    def test_commit_passes_promotion_qualification_and_legacy_discount_evidence_to_billing(self):
        batch = customer_profiling.create_subscriber_migration_batch(
            customer_profiling.ExistingSubscriberMigrationBatchPayload(
                filename="discounted-existing.csv",
                rows=[self.sample_row(
                    qualifiedPromotionCodes="EARLY-BIRD-200",
                    lastPaymentPromotionCode="EARLY-BIRD-200",
                    lastPaymentAmount="800",
                    paymentCoverageFromMonth="2026-08",
                    lastPaidThroughMonth="2026-08",
                    outstandingBalance="1000",
                )],
            ),
            self.admin,
        )
        row = batch["rows"][0]
        committed = customer_profiling.commit_subscriber_migration_batch(
            batch["id"],
            customer_profiling.ExistingSubscriberMigrationCommitPayload(
                planMappings={row["planKey"]: {"action": "MAP_EXISTING", "catalogId": self.catalog["id"]}},
                promotionMappings={"EARLY-BIRD-200": {"action": "MAP_EXISTING", "promotionId": self.early_bird["id"]}},
                rowDecisions={row["id"]: {"customerAction": "CREATE", "balanceResolution": "MONTHLY_INVOICES"}},
            ),
            self.admin,
        )

        self.assertEqual("COMPLETED", committed["status"])
        payload = self.billing_calls[0]
        self.assertEqual([self.early_bird["id"]], payload["qualifiedPromotionIds"])
        self.assertEqual("EARLY-BIRD-200", payload["lastPaymentPromotionCode"])
        self.assertEqual(200, payload["lastPaymentPromotionDiscountPerMonth"])
        self.assertEqual(800, payload["lastPaymentExpectedDiscountedAmount"])
        self.assertEqual("MATCHED", payload["lastPaymentPromotionMatchStatus"])

    def test_ignored_promotion_codes_stay_empty_in_result_export(self):
        batch = customer_profiling.create_subscriber_migration_batch(
            customer_profiling.ExistingSubscriberMigrationBatchPayload(
                filename="ignored-promotion.csv",
                rows=[self.sample_row(
                    qualifiedPromotionCodes="OLD-EARLY-BIRD",
                    lastPaymentPromotionCode="OLD-EARLY-BIRD",
                )],
            ),
            self.admin,
        )
        row = batch["rows"][0]
        customer_profiling.commit_subscriber_migration_batch(
            batch["id"],
            customer_profiling.ExistingSubscriberMigrationCommitPayload(
                planMappings={row["planKey"]: {"action": "MAP_EXISTING", "catalogId": self.catalog["id"]}},
                promotionMappings={"OLD-EARLY-BIRD": {"action": "IGNORE"}},
                rowDecisions={row["id"]: {"customerAction": "CREATE", "balanceResolution": "MONTHLY_INVOICES"}},
            ),
            self.admin,
        )

        exported = customer_profiling.subscriber_migration_result(batch["id"], self.admin)

        self.assertEqual("", exported["rows"][0]["qualifiedPromotionCodes"])
        self.assertEqual("", exported["rows"][0]["lastPaymentPromotionCode"])
        self.assertEqual([], self.billing_calls[0]["qualifiedPromotionIds"])
        self.assertEqual("", self.billing_calls[0]["lastPaymentPromotionCode"])

    def test_coordinates_create_the_internal_location_reference(self):
        captured = {}

        def ensure_location(payload, actor):
            captured.update(payload)
            return {"id": "location-1", "location_name": "ALIBAGO / ENRILE"}

        customer_profiling.ensure_location_record = ensure_location
        record = {
            "locationId": "",
            "locationName": "",
            "addressLine1": "PUROK 1",
            "landmark": "NEAR BARANGAY HALL",
            "province": "CAGAYAN",
            "city": "ENRILE",
            "barangay": "ALIBAGO",
            "latitude": "17.559311",
            "longitude": "121.684928",
        }

        changed = customer_profiling.ensure_customer_location(record, self.admin)

        self.assertTrue(changed)
        self.assertEqual("17.559311", captured["latitude"])
        self.assertEqual("121.684928", captured["longitude"])
        self.assertEqual("location-1", record["locationId"])
        self.assertEqual("ALIBAGO / ENRILE", record["locationName"])


if __name__ == "__main__":
    unittest.main()
