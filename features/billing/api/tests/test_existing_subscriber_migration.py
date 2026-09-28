import importlib
import os
import sys
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch


os.environ["BILLING_STORAGE"] = "memory"
os.environ.pop("DATABASE_URL", None)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

billing = importlib.import_module("billing.router")


class ExistingSubscriberBillingMigrationTests(unittest.TestCase):
    def setUp(self):
        for collection in billing.BILLING_RECORD_COLLECTIONS.values():
            collection.clear()
        billing.billing_store.storage_mode = "memory"
        billing.billing_store.database_url = ""
        billing.billing_store._loaded = True
        self.customer = {
            "id": "customer-1",
            "accountNumber": "68392741",
            "firstName": "Juan",
            "lastName": "Dela Cruz",
            "contactNumber": "09171234567",
            "status": "ACTIVE",
        }
        billing.configure_billing(
            lambda authorization: {"username": "migration-admin"},
            lambda *args: None,
            lambda customer_id: self.customer if customer_id == self.customer["id"] else None,
            lambda search: [self.customer],
        )

    def payload(self, **overrides):
        payload = {
            "migrationFingerprint": "line-fingerprint-1",
            "customerId": self.customer["id"],
            "serviceAccount": {"id": "service-1", "serviceAccountNumber": "SA-202609-0001", "serviceReference": "SVC-0001"},
            "catalog": {"id": "catalog-1", "code": "HOME-50", "name": "Home Fiber 50 Mbps", "monthlyRate": 1000, "billingMode": "PREPAID"},
            "planName": "Home Fiber 50 Mbps",
            "monthlyRate": 1000,
            "billingMode": "PREPAID",
            "serviceStartDate": "2024-01-15",
            "cutoverDate": "2026-09-16",
            "arrearMonths": ["2026-08", "2026-09"],
            "outstandingBalance": 2000,
            "balanceAsOfDate": "2026-09-16",
            "balanceResolution": "MONTHLY_INVOICES",
            "lastPaymentDate": "2026-08-05",
            "lastPaymentAmount": 2000,
            "paymentCoverageFromMonth": "2026-06",
            "lastPaidThroughMonth": "2026-07",
            "coverageSource": "INFERRED_FROM_AMOUNT_AND_PAID_THROUGH",
            "serviceStatus": "ACTIVE",
        }
        payload.update(overrides)
        return payload

    def test_monthly_reconstruction_does_not_post_legacy_cash(self):
        result = billing.migrate_existing_subscriber_billing(self.payload(), "migration-admin")

        self.assertEqual(["2026-08", "2026-09"], [invoice["billingPeriodMonth"] for invoice in result["invoices"]])
        self.assertEqual("2026-10-01", result["subscription"]["nextInvoiceDate"])
        self.assertTrue(result["subscription"]["firstInvoiceSuppressedForMigration"])
        self.assertEqual(0, len(billing.payments))
        self.assertEqual(1, len(billing.legacy_payment_evidence))

        live = billing.service_account_billing_summary("service-1")
        self.assertEqual(2000, live["balance"])
        self.assertEqual("2026-07", live["paidThroughMonth"])
        self.assertEqual("2026-10-01", live["nextInvoiceCycleStart"])
        self.assertEqual("2026-09-24", live["nextInvoiceGenerationDate"])
        self.assertTrue(billing.legacy_payment_evidence[0]["excludedFromCashReports"])

        replay = billing.migrate_existing_subscriber_billing(self.payload(), "migration-admin")
        self.assertTrue(replay["idempotentReplay"])
        self.assertEqual(1, len(billing.subscriptions))
        self.assertEqual(2, len(billing.invoices))
        self.assertEqual(1, len(billing.legacy_payment_evidence))

    def test_imported_monthly_aging_starts_at_fixed_new_system_cycle(self):
        result = billing.migrate_existing_subscriber_billing(self.payload(), "migration-admin")
        subscription = billing.find_subscription(result["subscription"]["id"])

        self.assertEqual("2026-10-01", subscription["migration"]["invoiceExpectationStart"])
        self.assertEqual("2026-07", subscription["migration"]["lastPaidThroughMonth"])
        self.assertEqual([], billing.missing_billing_cycle_keys(subscription, billing.invoices, date(2026, 9, 30)))
        self.assertEqual(["2026-10"], billing.missing_billing_cycle_keys(subscription, billing.invoices, date(2026, 10, 1)))

        billing.create_invoice_from_subscription(subscription, "2026-10-01", generated_on=date(2026, 9, 24))
        self.assertEqual("2026-11-01", subscription["nextInvoiceDate"])
        self.assertEqual(["2026-11"], billing.missing_billing_cycle_keys(subscription, billing.invoices, date(2026, 11, 1)))
        self.assertEqual(2, len([invoice for invoice in billing.invoices if invoice.get("migration")]))
        self.assertEqual([], billing.payments)

    def test_older_import_uses_reference_coverage_after_schedule_advances(self):
        result = billing.migrate_existing_subscriber_billing(
            self.payload(
                migrationFingerprint="line-fingerprint-legacy-postpaid",
                billingMode="POSTPAID",
                catalog={"id": "catalog-2", "name": "Business Fiber", "monthlyRate": 1000, "billingMode": "POSTPAID"},
                arrearMonths=[],
                outstandingBalance=0,
                lastPaidThroughMonth="2026-10",
            ),
            "migration-admin",
        )
        subscription = billing.find_subscription(result["subscription"]["id"])
        subscription["migration"].pop("invoiceExpectationStart")
        subscription["migration"].pop("lastPaidThroughMonth")

        self.assertEqual([], billing.missing_billing_cycle_keys(subscription, billing.invoices, date(2026, 10, 31)))
        billing.create_invoice_from_subscription(subscription, "2026-11-01", generated_on=date(2026, 11, 30))
        self.assertEqual("2026-12-01", subscription["nextInvoiceDate"])
        self.assertEqual(["2026-12"], billing.missing_billing_cycle_keys(subscription, billing.invoices, date(2026, 12, 31)))

    def test_older_import_without_payment_evidence_uses_unadvanced_schedule(self):
        result = billing.migrate_existing_subscriber_billing(
            self.payload(
                migrationFingerprint="line-fingerprint-no-evidence",
                arrearMonths=[],
                outstandingBalance=0,
                lastPaymentDate="",
                lastPaymentAmount=0,
                lastPaidThroughMonth="2026-10",
            ),
            "migration-admin",
        )
        subscription = billing.find_subscription(result["subscription"]["id"])
        subscription["migration"].pop("invoiceExpectationStart")
        subscription["migration"].pop("lastPaidThroughMonth")

        self.assertEqual([], billing.legacy_payment_evidence)
        self.assertEqual([], billing.missing_billing_cycle_keys(subscription, billing.invoices, date(2026, 10, 31)))
        self.assertEqual(["2026-11"], billing.missing_billing_cycle_keys(subscription, billing.invoices, date(2026, 11, 1)))

        billing.create_invoice_from_subscription(subscription, "2026-11-01", generated_on=date(2026, 10, 25))
        self.assertEqual("2026-12-01", subscription["nextInvoiceDate"])
        self.assertEqual(["2026-12"], billing.missing_billing_cycle_keys(subscription, billing.invoices, date(2026, 12, 1)))

    def test_opening_balance_is_unchanged_and_does_not_imply_legacy_missing_invoices(self):
        result = billing.migrate_existing_subscriber_billing(
            self.payload(
                migrationFingerprint="line-fingerprint-opening",
                balanceResolution="OPENING_BALANCE",
                outstandingBalance=2750,
                arrearMonths=[],
                lastPaymentDate="",
                lastPaymentAmount=0,
            ),
            "migration-admin",
        )
        subscription = billing.find_subscription(result["subscription"]["id"])

        self.assertEqual([], billing.missing_billing_cycle_keys(subscription, billing.invoices, date(2026, 9, 30)))
        self.assertEqual(2750, result["invoices"][0]["balance"])
        self.assertEqual("MANUAL", result["invoices"][0]["invoiceType"])
        self.assertEqual([], billing.payments)

    def test_historical_installation_decision_is_visible_but_cannot_be_changed(self):
        billing.migrate_existing_subscriber_billing(self.payload(), "migration-admin")
        charge = billing.installation_charges[0]

        self.assertEqual("NO_FEE", charge["status"])
        self.assertEqual(0, charge["chargedAmount"])
        self.assertEqual("EXISTING_SUBSCRIBER_CSV", charge["migration"]["source"])
        self.assertEqual(charge["id"], billing.list_installation_charges(admin={"username": "migration-admin"})[0]["id"])

        with self.assertRaises(billing.HTTPException) as update_error:
            billing.update_installation_charge(
                charge["id"],
                billing.InstallationChargePayload(status="INVOICED", standardAmount=1500, chargedAmount=1500),
                admin={"username": "migration-admin"},
            )
        self.assertEqual(409, update_error.exception.status_code)

        with self.assertRaises(billing.HTTPException) as void_error:
            billing.delete_installation_charge(charge["id"], admin={"username": "migration-admin"})
        self.assertEqual(409, void_error.exception.status_code)
        self.assertEqual("NO_FEE", charge["status"])
        self.assertEqual(0, charge["chargedAmount"])
        self.assertEqual(2, len(billing.invoices))

        # A previously voided migration record must not permit a new fee.
        charge["status"] = "VOID"
        with self.assertRaises(billing.HTTPException) as create_error:
            billing.create_installation_charge(
                billing.InstallationChargePayload(
                    customerId=self.customer["id"], serviceAccountId="service-1",
                    status="INVOICED", standardAmount=1500, chargedAmount=1500,
                ),
                admin={"username": "migration-admin"},
            )
        self.assertEqual(409, create_error.exception.status_code)
        self.assertEqual(2, len(billing.invoices))

    def test_batch_reconciliation_reads_current_invoices_without_reposting_legacy_cash(self):
        billing.migrate_existing_subscriber_billing(self.payload(batchId="batch-1"), "migration-admin")
        records = billing.subscriber_migration_billing_records("batch-1", admin={"username": "migration-admin"})

        self.assertEqual(1, len(records["subscriptions"]))
        self.assertEqual(2, len(records["invoices"]))
        self.assertEqual(1, len(records["legacyPaymentEvidence"]))
        self.assertEqual("REFERENCE_ONLY", records["legacyPaymentEvidence"][0]["status"])
        self.assertEqual(2000, records["summaries"][0]["balance"])
        self.assertEqual([], billing.payments)

    def test_prepaid_summary_uses_upcoming_due_date_after_an_overdue_invoice(self):
        billing.migrate_existing_subscriber_billing(
            self.payload(arrearMonths=["2026-09"], lastPaidThroughMonth="2026-08"),
            "migration-admin",
        )
        billing.create_invoice_from_subscription(
            billing.subscriptions[0], "2026-10-01", generated_on=date(2026, 9, 24),
        )

        with patch.object(billing, "billing_business_date", return_value=date(2026, 9, 24)):
            summary = billing.service_account_billing_summary("service-1")

        self.assertEqual(2000, summary["balance"])
        self.assertEqual("2026-10-01", summary["nextDueInvoice"]["dueDate"])
        self.assertEqual("2026-11-01", summary["nextInvoiceCycleStart"])

    def test_postpaid_cutover_derives_current_month_schedule(self):
        result = billing.migrate_existing_subscriber_billing(
            self.payload(
                migrationFingerprint="line-fingerprint-postpaid",
                billingMode="POSTPAID",
                catalog={
                    "id": "catalog-2",
                    "code": "BIZ-50",
                    "name": "Business Fiber 50 Mbps",
                    "monthlyRate": 1000,
                    "billingMode": "POSTPAID",
                },
                arrearMonths=["2026-08"],
                outstandingBalance=1000,
                lastPaymentAmount=1000,
            ),
            "migration-admin",
        )

        self.assertEqual(["2026-08"], [invoice["billingPeriodMonth"] for invoice in result["invoices"]])
        self.assertEqual("2026-09-01", result["subscription"]["nextInvoiceDate"])
        self.assertEqual(1, result["subscription"]["billingDay"])

    def test_reviewed_variance_creates_one_opening_balance_and_pauses_suspended_line(self):
        result = billing.migrate_existing_subscriber_billing(
            self.payload(
                migrationFingerprint="line-fingerprint-2",
                serviceStatus="SUSPENDED",
                balanceResolution="OPENING_BALANCE",
                outstandingBalance=2750,
                arrearMonths=[],
                lastPaymentDate="",
                lastPaymentAmount=0,
            ),
            "migration-admin",
        )

        self.assertEqual("PAUSED", result["subscription"]["status"])
        self.assertEqual(1, len(result["invoices"]))
        self.assertEqual("MANUAL", result["invoices"][0]["invoiceType"])
        self.assertEqual(2750, result["invoices"][0]["balance"])
        self.assertEqual("Legacy Opening Balance", result["invoices"][0]["lineItems"][0]["description"])

    def test_promotion_qualification_starts_with_future_invoices_and_preserves_legacy_discount_evidence(self):
        promotion = {
            "id": "promotion-early-bird-200",
            "promoCode": "EARLY-BIRD-200",
            "name": "Early Bird 200",
            "description": "Pay before the prepaid cycle begins.",
            "appliesTo": "MONTHLY_SERVICE",
            "discountType": "FIXED_AMOUNT",
            "discountAmount": 200,
            "discountPercent": 0,
            "startDate": "2026-01-01",
            "endDate": "",
            "status": "ACTIVE",
            "billingMode": "PREPAID",
            "paymentRule": "EARLY_BIRD",
            "priority": 100,
            "requiresApproval": False,
            "stackable": False,
            "createdAt": "2026-01-01T00:00:00+00:00",
            "updatedAt": "2026-01-01T00:00:00+00:00",
            "deletedAt": None,
        }
        billing.promotions.append(promotion)

        result = billing.migrate_existing_subscriber_billing(
            self.payload(
                qualifiedPromotionIds=[promotion["id"]],
                lastPaymentAmount=800,
                paymentCoverageFromMonth="2026-08",
                lastPaidThroughMonth="2026-08",
                arrearMonths=["2026-09"],
                outstandingBalance=1000,
                lastPaymentRegularMonthlyRate=1000,
                lastPaymentPromotionId=promotion["id"],
                lastPaymentPromotionCode=promotion["promoCode"],
                lastPaymentPromotionName=promotion["name"],
                lastPaymentPromotionDiscountPerMonth=200,
                lastPaymentExpectedDiscountedAmount=800,
                lastPaymentPromotionMatchStatus="MATCHED",
            ),
            "migration-admin",
        )

        subscription = result["subscription"]
        self.assertEqual([promotion["id"]], subscription["qualifiedPromotionIds"])
        self.assertTrue(subscription["earlyBirdEligible"])
        self.assertEqual([], result["invoices"][0]["qualifiedPromotionIds"])
        self.assertEqual("HISTORICAL_BALANCE_EXCLUDED", result["invoices"][0]["migrationPromotionPolicy"])
        self.assertEqual([], billing.invoice_qualified_promotion_terms(billing.find_invoice(result["invoices"][0]["id"])))

        evidence = result["legacyPaymentEvidence"]
        self.assertEqual(800, evidence["amount"])
        self.assertEqual(1000, evidence["regularMonthlyRate"])
        self.assertEqual(200, evidence["promotionDiscountPerMonth"])
        self.assertEqual("EARLY-BIRD-200", evidence["promotionCode"])
        self.assertEqual("MATCHED", evidence["promotionMatchStatus"])

        future = billing.create_invoice_from_subscription(
            billing.find_subscription(subscription["id"]),
            "2026-10-01",
            generated_on=billing.date(2026, 9, 25),
        )
        self.assertEqual([promotion["id"]], future["qualifiedPromotionIds"])
        self.assertTrue(future["earlyBirdEligible"])


if __name__ == "__main__":
    unittest.main()
