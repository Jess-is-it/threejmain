import importlib
import os
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

from fastapi import HTTPException


os.environ["BILLING_STORAGE"] = "memory"
os.environ.pop("DATABASE_URL", None)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

billing = importlib.import_module("billing.router")


class BillingFinancialIntegrityTests(unittest.TestCase):
    def setUp(self):
        for collection in billing.BILLING_RECORD_COLLECTIONS.values():
            collection.clear()
        billing.billing_store.storage_mode = "memory"
        billing.billing_store.database_url = ""
        billing.billing_store._loaded = True
        billing.billing_store._schema_ready = False
        self.admin = {"username": "finance-admin", "fullName": "Finance Admin"}
        self.customer = {
            "id": "customer-1",
            "accountNumber": "ACC-0001",
            "firstName": "Ada",
            "lastName": "Lovelace",
            "status": "ACTIVE",
        }
        self.audit_events = []
        billing.configure_billing(
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
            lambda customer_id: self.customer if customer_id == self.customer["id"] else None,
            lambda search: [self.customer],
        )

    def add_invoice(self, amount=100.0, status="ISSUED", invoice_id="invoice-1"):
        timestamp = billing.now_iso()
        invoice = {
            "id": invoice_id,
            "invoiceNumber": f"INV-202607-{len(billing.invoices) + 1:06d}",
            "customerId": self.customer["id"],
            "customer": billing.customer_snapshot(self.customer),
            "subscriptionId": None,
            "billingCycleStart": "2026-07-01",
            "billingCycleEnd": "2026-07-31",
            "issueDate": "2026-07-01",
            "dueDate": "2026-07-31",
            "invoiceType": "MANUAL",
            "billingMode": None,
            "status": status,
            "lineItems": [{"description": "Service", "quantity": 1, "unitPrice": amount, "amount": amount}],
            "notes": "",
            "createdAt": timestamp,
            "updatedAt": timestamp,
            "deletedAt": None,
        }
        billing.invoices.append(invoice)
        return invoice

    def add_subscription(self):
        timestamp = billing.now_iso()
        subscription = {
            "id": "subscription-1",
            "customerId": self.customer["id"],
            "customer": billing.customer_snapshot(self.customer),
            "planName": "Fiber 100",
            "monthlyRate": 1000.0,
            "listMonthlyRate": 1000.0,
            "pricingSource": "SERVICE_CATALOG",
            "priceOverrideAmount": None,
            "priceOverrideReason": "",
            "billingMode": "PREPAID",
            "billingDay": 1,
            "billingCycleAnchor": "CALENDAR_MONTH",
            "startDate": "2026-07-01",
            "nextInvoiceDate": "2026-07-01",
            "dueDays": 0,
            "earlyBirdEligible": False,
            "earlyBirdDiscountAmount": 0,
            "serviceAccountId": "service-account-1",
            "serviceAccountNumber": "SA-0001",
            "serviceOrderId": "service-order-1",
            "serviceId": "SVC-0001",
            "catalogId": "catalog-1",
            "catalogCode": "FIBER-100",
            "catalogName": "Fiber 100",
            "status": "ACTIVE",
            "notes": "",
            "createdAt": timestamp,
            "updatedAt": timestamp,
            "deletedAt": None,
        }
        billing.subscriptions.append(subscription)
        return subscription

    def payment_payload(self, amount=100.0):
        return billing.PaymentPayload(
            invoiceId="invoice-1",
            amount=amount,
            method="CASH",
            paymentDate="2026-07-14",
            collectionChannel="POS",
            status="POSTED",
        )

    def test_manual_invoice_idempotency_replays_original_invoice(self):
        payload = billing.InvoicePayload(
            customerId=self.customer["id"],
            billingCycleStart="2026-07-01",
            billingCycleEnd="2026-07-31",
            issueDate="2026-07-01",
            dueDate="2026-07-31",
            status="ISSUED",
            lineItems=[{"description": "Manual service", "quantity": 1, "unitPrice": 100}],
        )

        first = billing.create_invoice(payload, idempotency_key="invoice:test-1", admin=self.admin)
        replay = billing.create_invoice(payload, idempotency_key="invoice:test-1", admin=self.admin)

        self.assertEqual(first["id"], replay["id"])
        self.assertTrue(replay["idempotentReplay"])
        self.assertEqual(1, len(billing.invoices))

        with self.assertRaises(HTTPException) as missing_key:
            billing.create_invoice(payload, idempotency_key=None, admin=self.admin)
        self.assertEqual(400, missing_key.exception.status_code)

    def test_payment_idempotency_replays_original_posting(self):
        self.add_invoice()
        payload = self.payment_payload()

        first = billing.create_payment(payload, idempotency_key="payment:test-1", admin=self.admin)
        replay = billing.create_payment(payload, idempotency_key="payment:test-1", admin=self.admin)

        self.assertEqual(first["id"], replay["id"])
        self.assertTrue(replay["idempotentReplay"])
        self.assertEqual(1, len(billing.payments))
        self.assertEqual(1, sum(event["action"] == "billing_payment_posted" for event in self.audit_events))

    def test_idempotency_key_rejects_different_payment_payload(self):
        self.add_invoice(amount=200)
        billing.create_payment(self.payment_payload(100), idempotency_key="payment:test-2", admin=self.admin)

        with self.assertRaises(HTTPException) as raised:
            billing.create_payment(self.payment_payload(50), idempotency_key="payment:test-2", admin=self.admin)

        self.assertEqual(409, raised.exception.status_code)
        self.assertEqual(1, len(billing.payments))

    def test_concurrent_payments_cannot_overpay_invoice(self):
        self.add_invoice()
        barrier = Barrier(2)

        def post_payment(index):
            barrier.wait()
            try:
                return billing.create_payment(
                    self.payment_payload(),
                    idempotency_key=f"payment:concurrent-{index}",
                    admin=self.admin,
                )
            except HTTPException as exc:
                return exc

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(post_payment, [1, 2]))

        posted = [result for result in results if isinstance(result, dict)]
        rejected = [result for result in results if isinstance(result, HTTPException)]
        self.assertEqual(1, len(posted))
        self.assertEqual(1, len(rejected))
        self.assertEqual(100.0, sum(payment["amount"] for payment in billing.invoice_payments("invoice-1")))

    def test_subscription_cycle_generation_is_duplicate_safe(self):
        self.add_subscription()

        first = billing.generate_subscription_invoice(
            "subscription-1",
            cycleStart="2026-07-01",
            idempotency_key="invoice:cycle-1",
            admin=self.admin,
        )
        replay = billing.generate_subscription_invoice(
            "subscription-1",
            cycleStart="2026-07-01",
            idempotency_key="invoice:cycle-2",
            admin=self.admin,
        )

        self.assertEqual(first["id"], replay["id"])
        self.assertTrue(replay["idempotentReplay"])
        self.assertEqual(1, len(billing.invoices))

    def test_subscription_generation_retry_does_not_advance_two_cycles(self):
        subscription = self.add_subscription()

        first = billing.generate_subscription_invoice(
            "subscription-1",
            idempotency_key="invoice:stable-generate-action",
            admin=self.admin,
        )
        replay = billing.generate_subscription_invoice(
            "subscription-1",
            idempotency_key="invoice:stable-generate-action",
            admin=self.admin,
        )

        self.assertEqual(first["id"], replay["id"])
        self.assertTrue(replay["idempotentReplay"])
        self.assertEqual(1, len(billing.invoices))
        self.assertEqual("2026-08-01", subscription["nextInvoiceDate"])

    def test_posted_records_are_immutable_and_voids_remain_in_ledger(self):
        self.add_invoice()
        payment = billing.create_payment(
            self.payment_payload(50),
            idempotency_key="payment:immutable",
            admin=self.admin,
        )

        with self.assertRaises(HTTPException) as invoice_error:
            billing.update_invoice("invoice-1", billing.InvoicePayload(notes="Changed"), admin=self.admin)
        with self.assertRaises(HTTPException) as payment_error:
            billing.update_payment(payment["id"], billing.PaymentPayload(notes="Changed"), admin=self.admin)

        self.assertEqual(409, invoice_error.exception.status_code)
        self.assertEqual(409, payment_error.exception.status_code)

        billing.delete_payment(payment["id"], reason="Cashier correction", admin=self.admin)
        self.assertEqual("VOID", billing.payments[0]["status"])
        self.assertIsNone(billing.payments[0]["deletedAt"])
        self.assertEqual(100.0, billing.invoice_summary(billing.invoices[0])["balance"])

    def test_adjustment_replay_and_reversal_preserve_ledger_history(self):
        self.add_invoice()
        payload = billing.AdjustmentPayload(
            invoiceId="invoice-1",
            type="CREDIT",
            amount=20,
            reason="Service interruption",
            status="POSTED",
        )

        first = billing.create_adjustment(payload, idempotency_key="adjustment:test-1", admin=self.admin)
        replay = billing.create_adjustment(payload, idempotency_key="adjustment:test-1", admin=self.admin)

        self.assertEqual(first["id"], replay["id"])
        self.assertEqual(80.0, billing.invoice_summary(billing.invoices[0])["total"])
        with self.assertRaises(HTTPException) as raised:
            billing.update_adjustment(first["id"], billing.AdjustmentPayload(amount=10), admin=self.admin)
        self.assertEqual(409, raised.exception.status_code)

        billing.delete_adjustment(first["id"], reason="Credit entered in error", admin=self.admin)
        self.assertEqual("VOID", billing.adjustments[0]["status"])
        self.assertIsNone(billing.adjustments[0]["deletedAt"])
        self.assertEqual(100.0, billing.invoice_summary(billing.invoices[0])["total"])

    def test_payment_void_reverses_linked_promotion_credit_with_actor(self):
        invoice = self.add_invoice()
        payment = billing.create_payment(
            self.payment_payload(80),
            idempotency_key="payment:promotion-reversal",
            admin=self.admin,
        )
        with billing.billing_store.transaction():
            adjustment = billing.create_payment_promotion_adjustment(
                invoice,
                payment,
                {
                    "id": "promotion-1",
                    "name": "Early payment",
                    "promoCode": "EARLY-20",
                    "discountAmountForInvoice": 20,
                },
                self.admin,
                billing.now_iso(),
            )
            billing.persist_billing_state()

        self.assertEqual(self.admin["username"], adjustment["postedByUsername"])
        billing.delete_payment(payment["id"], reason="Cashier correction", admin=self.admin)

        self.assertEqual("VOID", adjustment["status"])
        self.assertEqual(self.admin["username"], adjustment["voidedByUsername"])
        self.assertIsNone(adjustment["deletedAt"])
        self.assertTrue(
            any(
                event["action"] == "billing_adjustment_voided" and event["targetId"] == adjustment["id"]
                for event in self.audit_events
            )
        )

    def test_installation_fee_void_rejects_posted_adjustments(self):
        invoice = self.add_invoice()
        invoice["invoiceType"] = "INSTALLATION_FEE"
        timestamp = billing.now_iso()
        billing.installation_charges.append(
            {
                "id": "installation-charge-1",
                "customerId": self.customer["id"],
                "serviceAccountId": "service-account-1",
                "invoiceId": invoice["id"],
                "status": "INVOICED",
                "createdAt": timestamp,
                "updatedAt": timestamp,
                "deletedAt": None,
            }
        )
        billing.create_adjustment(
            billing.AdjustmentPayload(
                invoiceId=invoice["id"],
                type="CREDIT",
                amount=10,
                reason="Approved service credit",
                status="POSTED",
            ),
            idempotency_key="adjustment:installation-credit",
            admin=self.admin,
        )

        with self.assertRaises(HTTPException) as raised:
            billing.delete_installation_charge("installation-charge-1", admin=self.admin)

        self.assertEqual(409, raised.exception.status_code)
        self.assertEqual("INVOICED", billing.installation_charges[0]["status"])
        self.assertNotEqual("VOID", billing.invoices[0]["status"])

    def test_full_credit_closes_invoice_without_voiding_financial_history(self):
        self.add_invoice()
        billing.create_adjustment(
            billing.AdjustmentPayload(
                invoiceId="invoice-1",
                type="CREDIT",
                amount=100,
                reason="Full service credit",
                status="POSTED",
            ),
            idempotency_key="adjustment:full-credit",
            admin=self.admin,
        )

        summary = billing.invoice_summary(billing.invoices[0])
        self.assertEqual(0.0, summary["total"])
        self.assertEqual(0.0, summary["balance"])
        self.assertEqual("PAID", summary["status"])

    def test_subscription_invoice_requires_adjustment_instead_of_direct_void(self):
        self.add_subscription()
        invoice = billing.generate_subscription_invoice(
            "subscription-1",
            cycleStart="2026-07-01",
            idempotency_key="invoice:no-direct-void",
            admin=self.admin,
        )

        with self.assertRaises(HTTPException) as raised:
            billing.delete_invoice(invoice["id"], reason="Incorrect amount", admin=self.admin)

        self.assertEqual(409, raised.exception.status_code)
        self.assertNotEqual("VOID", billing.invoices[0]["status"])

    def test_failed_transaction_restores_records_and_suppresses_audit(self):
        invoice = self.add_invoice()

        with self.assertRaises(RuntimeError):
            with billing.billing_store.transaction():
                invoice["status"] = "VOID"
                billing.add_audit(
                    "billing_invoice_voided",
                    "BillingInvoice",
                    invoice["id"],
                    {"reason": "forced failure"},
                    self.admin["username"],
                )
                billing.persist_billing_state()
                raise RuntimeError("forced failure")

        self.assertEqual("ISSUED", billing.invoices[0]["status"])
        self.assertEqual([], self.audit_events)


if __name__ == "__main__":
    unittest.main()
