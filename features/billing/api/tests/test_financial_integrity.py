import importlib
import os
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date, datetime
from pathlib import Path
from threading import Barrier
from unittest.mock import patch

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

    def add_early_bird_promotion(self, promotion_id, discount_amount=20.0):
        timestamp = billing.now_iso()
        promotion = {
            "id": promotion_id,
            "name": f"Early Bird {promotion_id}",
            "promoCode": promotion_id.upper(),
            "description": "",
            "appliesTo": "MONTHLY_SERVICE",
            "discountType": "FIXED_AMOUNT",
            "discountAmount": discount_amount,
            "discountPercent": 0,
            "startDate": "2026-07-01",
            "endDate": "",
            "status": "ACTIVE",
            "billingMode": "",
            "customerId": "",
            "catalogId": "",
            "paymentRule": "EARLY_BIRD",
            "priority": 10,
            "requiresApproval": False,
            "stackable": False,
            "notes": "",
            "createdAt": timestamp,
            "updatedAt": timestamp,
            "deletedAt": None,
        }
        billing.promotions.append(promotion)
        return promotion

    def qualify_invoice_for_early_bird(self, invoice, promotion, discount_amount):
        invoice.update(
            {
                "invoiceType": "MONTHLY",
                "billingMode": "PREPAID",
                "earlyBirdEligible": True,
                "earlyBirdDiscountAmount": discount_amount,
                "earlyBirdCutoffDate": "2026-08-01",
                "earlyBirdPromotionId": promotion["id"],
                "earlyBirdPromotionCode": promotion["promoCode"],
                "earlyBirdPromotionName": promotion["name"],
            }
        )

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
        self.assertEqual("2026-07", first["billingPeriodMonth"])
        self.assertEqual("July 2026", first["billingPeriodLabel"])

        with self.assertRaises(HTTPException) as missing_key:
            billing.create_invoice(payload, idempotency_key=None, admin=self.admin)
        self.assertEqual(400, missing_key.exception.status_code)

    def test_new_postpaid_subscription_defaults_to_net_seven_but_preserves_immediate_terms(self):
        fields = {
            "customerId": self.customer["id"],
            "planName": "Fiber 100",
            "billingMode": "POSTPAID",
            "startDate": "2026-08-01",
            "monthlyRate": 1000,
            "status": "ACTIVE",
        }

        default_terms = billing.normalize_subscription_payload(billing.SubscriptionPayload(**fields))
        immediate_terms = billing.normalize_subscription_payload(
            billing.SubscriptionPayload(**fields, dueDays=0)
        )

        self.assertEqual(7, default_terms["dueDays"])
        self.assertEqual(0, immediate_terms["dueDays"])

    def test_invoice_detail_and_pdf_use_authoritative_ledger_activity(self):
        invoice = self.add_invoice(amount=500)
        invoice.update(
            {
                "serviceAccountNumber": "SA-0001",
                "serviceId": "SVC-0001",
                "catalogCode": "FIBER-100",
                "catalogName": "Fiber 100",
                "billingMode": "PREPAID",
                "notes": "Thank you for your business.",
            }
        )
        payment = billing.create_payment(
            self.payment_payload(amount=100),
            idempotency_key="payment:invoice-document",
            admin=self.admin,
        )
        billing.create_adjustment(
            billing.AdjustmentPayload(
                invoiceId=invoice["id"],
                type="CREDIT",
                amount=50,
                reason="Service interruption rebate",
                status="POSTED",
            ),
            idempotency_key="adjustment:invoice-document",
            admin=self.admin,
        )

        detail = billing.get_invoice(invoice["id"], admin=self.admin)

        self.assertEqual(350.0, detail["balance"])
        self.assertEqual(payment["receiptNumber"], detail["payments"][0]["receiptNumber"])
        self.assertEqual(100.0, detail["payments"][0]["amount"])
        self.assertEqual("Manual adjustment", detail["adjustments"][0]["adjustmentLabel"])
        self.assertEqual("Service interruption rebate", detail["adjustments"][0]["reason"])

        response = billing.download_invoice_pdf(invoice["id"], admin=self.admin)
        document = response.body

        self.assertEqual("application/pdf", response.media_type)
        self.assertEqual(
            'attachment; filename="INV-202607-000001.pdf"',
            response.headers["content-disposition"],
        )
        self.assertGreater(len(document), 2500)
        self.assertTrue(document.startswith(b"%PDF-1.4"))
        self.assertTrue(document.rstrip().endswith(b"%%EOF"))
        self.assertIn(b"3J COMPUTER AND INTERNET INSTALLATION SERVICES", document)
        self.assertIn(b"Zone 2, Roma Norte, Enrile, Cagayan 3501", document)
        self.assertNotIn(b"3J ISP MANAGEMENT", document)
        self.assertIn(b"BILLING INVOICE", document)
        self.assertIn(b"Ada Lovelace", document)
        self.assertIn(b"Service interruption rebate", document)
        self.assertIn(payment["receiptNumber"].encode("ascii"), document)
        xref_offset = int(document.rsplit(b"startxref\n", 1)[1].splitlines()[0])
        self.assertTrue(document[xref_offset:].startswith(b"xref"))

    def test_monthly_charge_description_uses_billing_period_for_new_and_legacy_invoices(self):
        self.add_subscription()
        with patch.object(billing, "billing_business_date", return_value=date(2026, 7, 25)):
            generated = billing.generate_subscription_invoice(
                "subscription-1",
                cycleStart="2026-08-01",
                idempotency_key="invoice:period-description",
                admin=self.admin,
            )

        generated_description = "Fiber 100 monthly internet service (August 2026)"
        self.assertEqual(generated_description, generated["lineItems"][0]["description"])
        self.assertEqual(generated_description, billing.invoices[0]["lineItems"][0]["description"])
        generated_pdf = billing.download_invoice_pdf(generated["id"], admin=self.admin).body
        self.assertIn(b"Fiber 100 monthly internet service \\(August 2026\\)", generated_pdf)
        self.assertNotIn(b"Fiber 100 monthly internet service \\(SVC-0001\\)", generated_pdf)

        legacy = self.add_invoice(amount=1000, invoice_id="legacy-monthly-invoice")
        legacy.update(
            {
                "invoiceType": "MONTHLY",
                "serviceId": "SVC-LEGACY",
                "lineItems": [
                    {
                        "description": "Legacy monthly internet service (SVC-LEGACY)",
                        "quantity": 1,
                        "unitPrice": 1000,
                        "amount": 1000,
                        "serviceId": "SVC-LEGACY",
                    }
                ],
            }
        )

        legacy_detail = billing.get_invoice(legacy["id"], admin=self.admin)
        self.assertEqual(
            "Legacy monthly internet service (July 2026)",
            legacy_detail["lineItems"][0]["description"],
        )
        self.assertEqual(
            "Legacy monthly internet service (SVC-LEGACY)",
            legacy["lineItems"][0]["description"],
        )
        legacy_pdf = billing.download_invoice_pdf(legacy["id"], admin=self.admin).body
        self.assertIn(b"Legacy monthly internet service \\(July 2026\\)", legacy_pdf)
        self.assertNotIn(b"Legacy monthly internet service \\(SVC-LEGACY\\)", legacy_pdf)

    def test_generated_invoice_snapshots_previous_unpaid_invoice_without_double_counting(self):
        self.add_subscription()
        with patch.object(billing, "billing_business_date", return_value=date(2026, 6, 25)):
            july_invoice = billing.generate_subscription_invoice(
                "subscription-1",
                cycleStart="2026-07-01",
                idempotency_key="invoice:summary-july",
                admin=self.admin,
            )
        with patch.object(billing, "billing_business_date", return_value=date(2026, 7, 25)):
            august_invoice = billing.generate_subscription_invoice(
                "subscription-1",
                cycleStart="2026-08-01",
                idempotency_key="invoice:summary-august",
                admin=self.admin,
            )

        snapshot = august_invoice["accountSummaryAtIssue"]
        self.assertEqual(1000.0, august_invoice["total"])
        self.assertEqual(1000.0, august_invoice["balance"])
        self.assertEqual(1000.0, snapshot["previousBalance"])
        self.assertEqual(1000.0, snapshot["currentInvoiceBalance"])
        self.assertEqual(2000.0, snapshot["totalAccountAmountDue"])
        self.assertEqual(1, snapshot["previousOpenInvoiceCount"])
        self.assertEqual(july_invoice["id"], snapshot["previousOpenInvoices"][0]["invoiceId"])
        self.assertEqual("July 2026", snapshot["previousOpenInvoices"][0]["billingPeriodLabel"])
        self.assertEqual(24, snapshot["previousOpenInvoices"][0]["daysOverdueAtIssue"])

        detail = billing.get_invoice(august_invoice["id"], admin=self.admin)
        self.assertEqual(snapshot, detail["accountSummaryAtIssue"])

        document = billing.download_invoice_pdf(august_invoice["id"], admin=self.admin).body
        self.assertIn(b"ACCOUNT SUMMARY AT ISSUE", document)
        self.assertIn(b"PREVIOUS UNPAID INVOICES", document)
        self.assertIn(july_invoice["invoiceNumber"].encode("ascii"), document)
        self.assertIn(b"TOTAL ACCOUNT AMOUNT DUE", document)
        self.assertIn(b"THIS INVOICE BALANCE DUE", document)
        for omitted_detail in [
            b"Previous unpaid balance",
            b"Current invoice total",
            b"Current invoice balance",
            b"Payments applied since previous invoice",
            b"Credits posted since previous invoice",
            b"Historical account position",
        ]:
            self.assertNotIn(omitted_detail, document)

    def test_account_summary_snapshot_is_stable_after_prior_invoice_payment(self):
        self.add_subscription()
        with patch.object(billing, "billing_business_date", return_value=date(2026, 6, 25)):
            july_invoice = billing.generate_subscription_invoice(
                "subscription-1",
                cycleStart="2026-07-01",
                idempotency_key="invoice:stable-summary-july",
                admin=self.admin,
            )
        with patch.object(billing, "billing_business_date", return_value=date(2026, 7, 25)):
            august_invoice = billing.generate_subscription_invoice(
                "subscription-1",
                cycleStart="2026-08-01",
                idempotency_key="invoice:stable-summary-august",
                admin=self.admin,
            )
        original_snapshot = deepcopy(august_invoice["accountSummaryAtIssue"])

        billing.create_payment(
            billing.PaymentPayload(
                invoiceId=july_invoice["id"],
                amount=1000,
                method="CASH",
                paymentDate="2026-07-26",
                collectionChannel="COLLECTOR",
                status="POSTED",
            ),
            idempotency_key="payment:settle-july-after-august",
            admin=self.admin,
        )

        self.assertEqual(0.0, billing.get_invoice(july_invoice["id"], admin=self.admin)["balance"])
        refreshed_august = billing.get_invoice(august_invoice["id"], admin=self.admin)
        self.assertEqual(original_snapshot, refreshed_august["accountSummaryAtIssue"])
        self.assertEqual(2000.0, refreshed_august["accountSummaryAtIssue"]["totalAccountAmountDue"])
        self.assertEqual(1000.0, refreshed_august["balance"])

    def test_account_summary_records_payments_and_credits_since_previous_invoice(self):
        self.add_subscription()
        with patch.object(billing, "billing_business_date", return_value=date(2026, 6, 25)):
            july_invoice = billing.generate_subscription_invoice(
                "subscription-1",
                cycleStart="2026-07-01",
                idempotency_key="invoice:activity-summary-july",
                admin=self.admin,
            )
        billing.create_payment(
            billing.PaymentPayload(
                invoiceId=july_invoice["id"],
                amount=200,
                method="CASH",
                paymentDate="2026-07-14",
                collectionChannel="COLLECTOR",
                status="POSTED",
            ),
            idempotency_key="payment:activity-summary-july",
            admin=self.admin,
        )
        billing.create_adjustment(
            billing.AdjustmentPayload(
                invoiceId=july_invoice["id"],
                type="CREDIT",
                amount=50,
                reason="Service interruption rebate",
                status="POSTED",
            ),
            idempotency_key="adjustment:activity-summary-july",
            admin=self.admin,
        )
        with patch.object(billing, "billing_business_date", return_value=date(2026, 7, 25)):
            august_invoice = billing.generate_subscription_invoice(
                "subscription-1",
                cycleStart="2026-08-01",
                idempotency_key="invoice:activity-summary-august",
                admin=self.admin,
            )

        snapshot = august_invoice["accountSummaryAtIssue"]
        prior_invoice = snapshot["previousOpenInvoices"][0]
        self.assertEqual(200.0, snapshot["paymentsAppliedSincePreviousInvoice"])
        self.assertEqual(50.0, snapshot["creditsPostedSincePreviousInvoice"])
        self.assertEqual(750.0, snapshot["previousBalance"])
        self.assertEqual(1750.0, snapshot["totalAccountAmountDue"])
        self.assertEqual(200.0, prior_invoice["paidTotalAtIssue"])
        self.assertEqual(50.0, prior_invoice["creditAdjustmentsAtIssue"])
        self.assertEqual(750.0, prior_invoice["remainingBalanceAtIssue"])

    def test_payment_idempotency_replays_original_posting(self):
        self.add_invoice()
        payload = self.payment_payload()

        first = billing.create_payment(payload, idempotency_key="payment:test-1", admin=self.admin)
        replay = billing.create_payment(payload, idempotency_key="payment:test-1", admin=self.admin)

        self.assertEqual(first["id"], replay["id"])
        self.assertTrue(replay["idempotentReplay"])
        self.assertEqual(first["postedAt"], replay["postedAt"])
        self.assertEqual(first["createdAt"], first["postedAt"])
        self.assertIsInstance(datetime.fromisoformat(first["postedAt"]), datetime)
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

    def test_multi_invoice_payment_allocates_and_voids_by_invoice(self):
        self.add_invoice(amount=100, invoice_id="invoice-1")
        self.add_invoice(amount=75, invoice_id="invoice-2")
        payload = billing.PaymentPayload(
            customerId=self.customer["id"],
            amount=150,
            method="CASH",
            paymentDate="2026-07-14",
            collectionChannel="POS",
            status="POSTED",
            allocations=[
                billing.PaymentAllocationPayload(invoiceId="invoice-1", amount=100),
                billing.PaymentAllocationPayload(invoiceId="invoice-2", amount=50),
            ],
        )

        payment = billing.create_payment(payload, idempotency_key="payment:multi-invoice", admin=self.admin)

        self.assertIsNone(payment["invoiceId"])
        self.assertEqual("2 invoices", payment["invoiceNumber"])
        self.assertEqual(2, payment["allocationCount"])
        self.assertEqual(100.0, billing.invoice_summary(billing.invoices[0])["paidTotal"])
        self.assertEqual(0.0, billing.invoice_summary(billing.invoices[0])["balance"])
        self.assertEqual(50.0, billing.invoice_summary(billing.invoices[1])["paidTotal"])
        self.assertEqual(25.0, billing.invoice_summary(billing.invoices[1])["balance"])
        self.assertEqual(100.0, sum(row["amount"] for row in billing.invoice_payments("invoice-1")))
        self.assertEqual(50.0, sum(row["amount"] for row in billing.invoice_payments("invoice-2")))
        self.assertEqual(150.0, billing.customer_balance(self.customer["id"])["paidTotal"])

        billing.delete_payment(payment["id"], reason="Cashier correction", admin=self.admin)

        self.assertEqual("VOID", billing.payments[0]["status"])
        self.assertEqual(100.0, billing.invoice_summary(billing.invoices[0])["balance"])
        self.assertEqual(75.0, billing.invoice_summary(billing.invoices[1])["balance"])

    def test_multi_invoice_payment_applies_per_allocation_promotions(self):
        first_invoice = self.add_invoice(amount=100, invoice_id="invoice-1")
        second_invoice = self.add_invoice(amount=120, invoice_id="invoice-2")
        first_promotion = self.add_early_bird_promotion("promo-first", 20)
        second_promotion = self.add_early_bird_promotion("promo-second", 30)
        self.qualify_invoice_for_early_bird(first_invoice, first_promotion, 20)
        self.qualify_invoice_for_early_bird(second_invoice, second_promotion, 30)
        payload = billing.PaymentPayload(
            customerId=self.customer["id"],
            amount=170,
            method="CASH",
            paymentDate="2026-07-14",
            collectionChannel="POS",
            status="POSTED",
            allocations=[
                billing.PaymentAllocationPayload(invoiceId="invoice-1", amount=80, promotionId=first_promotion["id"]),
                billing.PaymentAllocationPayload(invoiceId="invoice-2", amount=90, promotionId=second_promotion["id"]),
            ],
        )

        payment = billing.create_payment(payload, idempotency_key="payment:multi-promo", admin=self.admin)

        self.assertIsNone(payment["invoiceId"])
        self.assertEqual(2, payment["allocationCount"])
        self.assertTrue(payment["promotionDiscountApplied"])
        self.assertEqual(50.0, payment["promotionDiscountAmount"])
        self.assertEqual(2, len(payment["promotionDiscountAdjustmentIds"]))
        self.assertEqual(0.0, billing.invoice_summary(first_invoice)["balance"])
        self.assertEqual(0.0, billing.invoice_summary(second_invoice)["balance"])
        posted_promo_adjustments = [
            adjustment
            for adjustment in billing.adjustments
            if adjustment.get("adjustmentSource") == "PAYMENT_PROMOTION" and adjustment.get("paymentId") == payment["id"]
        ]
        self.assertEqual(2, len(posted_promo_adjustments))

        billing.delete_payment(payment["id"], reason="Cashier correction", admin=self.admin)

        self.assertEqual({"VOID"}, {adjustment["status"] for adjustment in posted_promo_adjustments})
        self.assertEqual(100.0, billing.invoice_summary(first_invoice)["balance"])
        self.assertEqual(120.0, billing.invoice_summary(second_invoice)["balance"])

    def test_collector_quote_allows_promoted_invoice_payoff_plus_advance(self):
        invoice = self.add_invoice(amount=100, invoice_id="invoice-1")
        promotion = self.add_early_bird_promotion("promo-collector", 20)
        promotion["paymentRule"] = "ANY_PAYMENT"
        invoice.update(
            {
                "invoiceType": "MONTHLY",
                "billingMode": "PREPAID",
                "qualifiedPromotionIds": [promotion["id"]],
                "qualifiedPromotions": [
                    billing.promotion_qualification_snapshot(promotion, 100)
                ],
            }
        )
        payment_day = date(2026, 7, 14)
        quote = billing.payment_promotion_quote(invoice, payment_day)

        with patch.object(billing, "billing_business_date", return_value=payment_day):
            account = billing.collector_aging_accounts("")[0]

        self.assertEqual(100.0, account["outstandingBalance"])
        self.assertEqual(20.0, account["promotionDiscountTotal"])
        self.assertEqual(80.0, account["payableToday"])
        self.assertEqual(quote["quoteFingerprint"], account["invoices"][0]["promotionQuote"]["quoteFingerprint"])

        payment = billing.create_payment(
            billing.PaymentPayload(
                customerId=self.customer["id"],
                amount=130,
                advanceAmount=50,
                method="CASH",
                paymentDate=payment_day.isoformat(),
                collectionChannel="COLLECTOR",
                status="POSTED",
                allocations=[
                    billing.PaymentAllocationPayload(
                        invoiceId=invoice["id"],
                        amount=80,
                        promotionIds=[promotion["id"]],
                        promotionQuoteDate=quote["paymentDate"],
                        promotionQuoteFingerprint=quote["quoteFingerprint"],
                    )
                ],
            ),
            idempotency_key="payment:collector-promo-advance",
            admin=self.admin,
        )

        self.assertEqual(20.0, payment["promotionDiscountAmount"])
        self.assertEqual(50.0, payment["advanceAmount"])
        self.assertEqual(50.0, payment["accountCreditAfter"])
        self.assertEqual(0.0, billing.invoice_summary(invoice)["balance"])

    def test_stale_collector_promotion_quote_is_rejected_before_posting(self):
        invoice = self.add_invoice(amount=100, invoice_id="invoice-1")
        promotion = self.add_early_bird_promotion("promo-stale", 20)
        promotion["paymentRule"] = "ANY_PAYMENT"
        invoice.update(
            {
                "invoiceType": "MONTHLY",
                "billingMode": "PREPAID",
                "qualifiedPromotionIds": [promotion["id"]],
                "qualifiedPromotions": [
                    billing.promotion_qualification_snapshot(promotion, 100)
                ],
            }
        )

        with self.assertRaises(HTTPException) as raised:
            billing.create_payment(
                billing.PaymentPayload(
                    customerId=self.customer["id"],
                    amount=80,
                    method="CASH",
                    paymentDate="2026-07-14",
                    collectionChannel="COLLECTOR",
                    status="POSTED",
                    allocations=[
                        billing.PaymentAllocationPayload(
                            invoiceId=invoice["id"],
                            amount=80,
                            promotionIds=[promotion["id"]],
                            promotionQuoteDate="2026-07-14",
                            promotionQuoteFingerprint="stale-quote",
                        )
                    ],
                ),
                idempotency_key="payment:collector-stale-quote",
                admin=self.admin,
            )

        self.assertEqual(409, raised.exception.status_code)
        self.assertIn("refresh", raised.exception.detail.lower())
        self.assertEqual([], billing.payments)

    def test_promotion_setup_clears_customer_and_plan_targets(self):
        promotion = billing.normalize_promotion_payload(
            billing.PromotionPayload(
                name="Generic loyalty credit",
                promoCode="LOYALTY-10",
                appliesTo="MONTHLY_SERVICE",
                discountType="FIXED_AMOUNT",
                discountAmount=10,
                startDate="2026-07-01",
                status="ACTIVE",
                customerId="customer-1",
                catalogId="catalog-1",
                paymentRule="ANY_PAYMENT",
            )
        )

        self.assertEqual("", promotion["customerId"])
        self.assertEqual("", promotion["catalogId"])

    def test_subscription_rejects_multiple_promotions_when_one_is_not_stackable(self):
        early_bird = self.add_early_bird_promotion("promo-early", 100)
        loyalty = self.add_early_bird_promotion("promo-loyalty", 50)
        loyalty["paymentRule"] = "ANY_PAYMENT"
        early_bird["stackable"] = True

        with self.assertRaises(HTTPException) as raised:
            billing.normalize_subscription_payload(
                billing.SubscriptionPayload(
                    customerId=self.customer["id"],
                    planName="Fiber 100",
                    monthlyRate=1000,
                    billingMode="PREPAID",
                    startDate="2026-08-01",
                    nextInvoiceDate="2026-08-01",
                    qualifiedPromotionIds=[early_bird["id"], loyalty["id"]],
                )
            )

        self.assertEqual(400, raised.exception.status_code)
        self.assertIn("stackable", str(raised.exception.detail).lower())

    def test_stacked_subscription_promotions_snapshot_post_and_reverse_separate_credits(self):
        early_bird = self.add_early_bird_promotion("promo-early", 100)
        early_bird.update({"priority": 20, "stackable": True})
        loyalty = self.add_early_bird_promotion("promo-loyalty", 0)
        loyalty.update(
            {
                "name": "Loyalty 10 percent",
                "promoCode": "LOYALTY-10",
                "paymentRule": "ANY_PAYMENT",
                "discountType": "PERCENT",
                "discountAmount": 0,
                "discountPercent": 10,
                "priority": 10,
                "stackable": True,
            }
        )
        subscription = self.add_subscription()
        subscription.update(
            billing.normalize_subscription_payload(
                billing.SubscriptionPayload(
                    qualifiedPromotionIds=[loyalty["id"], early_bird["id"]],
                ),
                subscription,
            )
        )

        self.assertEqual([early_bird["id"], loyalty["id"]], subscription["qualifiedPromotionIds"])
        self.assertEqual(2, subscription["qualifiedPromotionCount"])
        self.assertEqual(early_bird["id"], subscription["earlyBirdPromotionId"])

        invoice = self.add_invoice(amount=1000)
        invoice.update(
            {
                "invoiceType": "MONTHLY",
                "billingMode": "PREPAID",
                "billingCycleStart": "2026-08-01",
                "billingCycleEnd": "2026-08-31",
                **billing.early_bird_invoice_fields(
                    subscription,
                    date(2026, 8, 1),
                    "MONTHLY",
                    date(2026, 8, 1),
                ),
            }
        )
        self.assertEqual([early_bird["id"], loyalty["id"]], invoice["qualifiedPromotionIds"])
        self.assertEqual(2, len(invoice["qualifiedPromotions"]))

        options = billing.eligible_payment_promotions(invoice, date(2026, 7, 14))
        bundle = billing.recommended_payment_promotion_bundle(invoice, options)
        self.assertEqual([early_bird["id"], loyalty["id"]], bundle["promotionIds"])
        self.assertEqual(190.0, bundle["discountAmount"])
        self.assertEqual(810.0, bundle["discountedPayable"])

        late_options = billing.eligible_payment_promotions(invoice, date(2026, 12, 29))
        late_bundle = billing.recommended_payment_promotion_bundle(invoice, late_options)
        self.assertEqual([loyalty["id"]], late_bundle["promotionIds"])
        self.assertEqual(100.0, late_bundle["discountAmount"])
        self.assertEqual(900.0, late_bundle["discountedPayable"])

        payment = billing.create_payment(
            billing.PaymentPayload(
                customerId=self.customer["id"],
                amount=810,
                method="CASH",
                paymentDate="2026-07-14",
                collectionChannel="POS",
                status="POSTED",
                allocations=[
                    billing.PaymentAllocationPayload(
                        invoiceId=invoice["id"],
                        amount=810,
                        promotionIds=[early_bird["id"], loyalty["id"]],
                    )
                ],
            ),
            idempotency_key="payment:stacked-promotions",
            admin=self.admin,
        )

        self.assertEqual([early_bird["id"], loyalty["id"]], payment["promotionIds"])
        self.assertEqual(190.0, payment["promotionDiscountAmount"])
        self.assertEqual(2, len(payment["promotionDiscountAdjustmentIds"]))
        self.assertEqual(0.0, billing.invoice_summary(invoice)["balance"])
        promotion_adjustments = [
            adjustment
            for adjustment in billing.adjustments
            if adjustment.get("paymentId") == payment["id"]
            and adjustment.get("adjustmentSource") == "PAYMENT_PROMOTION"
        ]
        self.assertEqual([100.0, 90.0], [adjustment["amount"] for adjustment in promotion_adjustments])

        billing.delete_payment(payment["id"], reason="Cashier correction", admin=self.admin)

        self.assertEqual({"VOID"}, {adjustment["status"] for adjustment in promotion_adjustments})
        self.assertEqual(1000.0, billing.invoice_summary(invoice)["balance"])

    def test_unqualified_monthly_promotion_is_not_offered_for_payment(self):
        invoice = self.add_invoice(amount=100)
        invoice.update({"invoiceType": "MONTHLY", "billingMode": "PREPAID"})
        promotion = self.add_early_bird_promotion("promo-global", 20)
        promotion["paymentRule"] = "ANY_PAYMENT"

        self.assertEqual([], billing.eligible_payment_promotions(invoice, date(2026, 7, 14)))

    def test_existing_invoice_without_snapshot_uses_subscription_promotions_by_payment_date(self):
        early_bird = self.add_early_bird_promotion("promo-early", 200)
        early_bird.update({"priority": 20, "stackable": True})
        less_250 = self.add_early_bird_promotion("promo-less-250", 250)
        less_250.update(
            {
                "name": "LESS 250",
                "paymentRule": "ANY_PAYMENT",
                "priority": 10,
                "stackable": True,
            }
        )
        subscription = self.add_subscription()
        subscription.update(
            billing.normalize_subscription_payload(
                billing.SubscriptionPayload(qualifiedPromotionIds=[early_bird["id"], less_250["id"]]),
                subscription,
            )
        )
        invoice = self.add_invoice(amount=1000)
        invoice.update(
            {
                "subscriptionId": subscription["id"],
                "invoiceType": "MONTHLY",
                "billingMode": "PREPAID",
                "billingCycleStart": "2026-08-01",
                "billingCycleEnd": "2026-08-31",
                "earlyBirdEligible": True,
                "earlyBirdDiscountAmount": 200,
                "earlyBirdCutoffDate": "2026-08-01",
                "earlyBirdPromotionId": early_bird["id"],
                "earlyBirdPromotionCode": early_bird["promoCode"],
                "earlyBirdPromotionName": early_bird["name"],
            }
        )
        self.assertFalse(invoice.get("qualifiedPromotionIds"))

        early_options = billing.eligible_payment_promotions(invoice, date(2026, 7, 29))
        early_bundle = billing.recommended_payment_promotion_bundle(invoice, early_options)
        self.assertEqual([early_bird["id"], less_250["id"]], early_bundle["promotionIds"])
        self.assertEqual(450.0, early_bundle["discountAmount"])
        self.assertEqual(550.0, early_bundle["discountedPayable"])

        late_options = billing.eligible_payment_promotions(invoice, date(2026, 12, 29))
        late_bundle = billing.recommended_payment_promotion_bundle(invoice, late_options)
        self.assertEqual([less_250["id"]], late_bundle["promotionIds"])
        self.assertEqual(250.0, late_bundle["discountAmount"])
        self.assertEqual(750.0, late_bundle["discountedPayable"])

    def test_any_payment_promotion_window_uses_invoice_period_not_late_payment_date(self):
        early_bird = self.add_early_bird_promotion("promo-early", 200)
        early_bird.update({"priority": 20, "stackable": True, "endDate": "2026-08-31"})
        less_250 = self.add_early_bird_promotion("promo-less-250", 250)
        less_250.update(
            {
                "name": "LESS 250",
                "paymentRule": "ANY_PAYMENT",
                "priority": 10,
                "stackable": True,
                "endDate": "2026-08-31",
            }
        )
        invoice = self.add_invoice(amount=1000)
        invoice.update(
            {
                "invoiceType": "MONTHLY",
                "billingMode": "PREPAID",
                "billingCycleStart": "2026-08-01",
                "billingCycleEnd": "2026-08-31",
                "qualifiedPromotionIds": [early_bird["id"], less_250["id"]],
                "qualifiedPromotions": [
                    billing.promotion_qualification_snapshot(early_bird, 1000),
                    billing.promotion_qualification_snapshot(less_250, 1000),
                ],
                "earlyBirdEligible": True,
                "earlyBirdDiscountAmount": 200,
                "earlyBirdCutoffDate": "2026-08-01",
                "earlyBirdPromotionId": early_bird["id"],
                "earlyBirdPromotionCode": early_bird["promoCode"],
                "earlyBirdPromotionName": early_bird["name"],
            }
        )

        early_options = billing.eligible_payment_promotions(invoice, date(2026, 7, 29))
        early_bundle = billing.recommended_payment_promotion_bundle(invoice, early_options)
        self.assertEqual([early_bird["id"], less_250["id"]], early_bundle["promotionIds"])
        self.assertEqual(450.0, early_bundle["discountAmount"])

        late_options = billing.eligible_payment_promotions(invoice, date(2026, 12, 29))
        late_bundle = billing.recommended_payment_promotion_bundle(invoice, late_options)
        self.assertEqual([less_250["id"]], late_bundle["promotionIds"])
        self.assertEqual(250.0, late_bundle["discountAmount"])
        self.assertEqual(750.0, late_bundle["discountedPayable"])

    def test_multi_invoice_payment_rejects_over_allocation(self):
        self.add_invoice(amount=100, invoice_id="invoice-1")
        payload = billing.PaymentPayload(
            customerId=self.customer["id"],
            amount=125,
            method="CASH",
            paymentDate="2026-07-14",
            collectionChannel="POS",
            status="POSTED",
            allocations=[billing.PaymentAllocationPayload(invoiceId="invoice-1", amount=125)],
        )

        with self.assertRaises(HTTPException) as raised:
            billing.create_payment(payload, idempotency_key="payment:over-allocated", admin=self.admin)

        self.assertEqual(400, raised.exception.status_code)
        self.assertEqual(0, len(billing.payments))

    def test_selected_invoice_partial_payment_does_not_touch_other_invoice(self):
        self.add_invoice(amount=100, invoice_id="invoice-1")
        self.add_invoice(amount=200, invoice_id="invoice-2")
        payload = billing.PaymentPayload(
            customerId=self.customer["id"],
            amount=75,
            method="CASH",
            paymentDate="2026-07-14",
            collectionChannel="COLLECTOR",
            status="POSTED",
            allocations=[billing.PaymentAllocationPayload(invoiceId="invoice-2", amount=75)],
        )

        billing.create_payment(payload, idempotency_key="payment:selected-invoice", admin=self.admin)

        self.assertEqual(100.0, billing.invoice_summary(billing.invoices[0])["balance"])
        selected_summary = billing.invoice_summary(billing.invoices[1])
        self.assertEqual("PARTIALLY_PAID", selected_summary["status"])
        self.assertEqual(125.0, selected_summary["balance"])

    def test_advance_credit_requires_current_invoices_to_be_fully_allocated(self):
        self.add_invoice(amount=100)
        payload = billing.PaymentPayload(
            customerId=self.customer["id"],
            amount=50,
            advanceAmount=50,
            method="CASH",
            paymentDate="2026-07-14",
            collectionChannel="COLLECTOR",
            status="POSTED",
        )

        with self.assertRaises(HTTPException) as raised:
            billing.create_payment(payload, idempotency_key="payment:invalid-advance", admin=self.admin)

        self.assertEqual(400, raised.exception.status_code)
        self.assertIn("all current invoice balances", raised.exception.detail)

    def test_collector_worklist_includes_fully_paid_active_subscription(self):
        self.add_subscription()

        accounts = billing.collector_aging_accounts("")

        self.assertEqual(1, len(accounts))
        self.assertEqual(self.customer["id"], accounts[0]["customerId"])
        self.assertEqual(0.0, accounts[0]["outstandingBalance"])
        self.assertEqual(0.0, accounts[0]["accountCredit"])
        self.assertEqual([], accounts[0]["invoices"])

    def test_overview_groups_actionable_receivables_into_one_collection_account(self):
        overdue_invoice = self.add_invoice(amount=300, invoice_id="invoice-1")
        overdue_invoice.update(
            {
                "invoiceType": "MONTHLY",
                "billingCycleStart": "2026-06-01",
                "billingCycleEnd": "2026-06-30",
                "issueDate": "2026-06-01",
                "dueDate": "2026-06-30",
            }
        )
        partial_invoice = self.add_invoice(amount=200, invoice_id="invoice-2")
        partial_invoice.update(
            {
                "invoiceType": "MONTHLY",
                "billingCycleStart": "2026-08-01",
                "billingCycleEnd": "2026-08-31",
                "issueDate": "2026-07-25",
                "dueDate": "2026-08-31",
            }
        )
        billing.create_payment(
            billing.PaymentPayload(
                customerId=self.customer["id"],
                amount=50,
                method="CASH",
                paymentDate="2026-07-14",
                collectionChannel="COLLECTOR",
                status="POSTED",
                allocations=[billing.PaymentAllocationPayload(invoiceId="invoice-2", amount=50)],
            ),
            idempotency_key="payment:collection-overview",
            admin=self.admin,
        )

        with patch.object(billing, "billing_business_date", return_value=date(2026, 7, 29)):
            overview = billing.billing_overview(admin=self.admin)

        self.assertEqual(1, overview["collectionAccountCount"])
        self.assertEqual(1, len(overview["collectionAccounts"]))
        account = overview["collectionAccounts"][0]
        self.assertEqual(self.customer["id"], account["customerId"])
        self.assertEqual("OVERDUE", account["collectionStatus"])
        self.assertEqual(450.0, account["outstandingBalance"])
        self.assertEqual(300.0, account["overdueBalance"])
        self.assertEqual(150.0, account["partiallyPaidBalance"])
        self.assertEqual(2, account["openInvoiceCount"])
        self.assertEqual(1, account["overdueInvoiceCount"])
        self.assertEqual(1, account["partiallyPaidInvoiceCount"])
        self.assertEqual("2026-06-30", account["oldestOverdueDate"])
        self.assertEqual(29, account["daysOverdue"])
        self.assertEqual(2, account["unpaidMonths"])
        self.assertEqual(["2026-06", "2026-08"], account["unpaidMonthKeys"])
        self.assertEqual(450.0, account["unpaidMonthlyBalance"])
        self.assertEqual("2026-07-14", account["lastPaymentDate"])
        self.assertEqual(50.0, account["lastPaymentAmount"])
        self.assertEqual("COLLECTOR", account["lastPaymentChannel"])
        self.assertEqual("Finance Admin", account["lastPaymentPostedByName"])

    def test_overview_excludes_open_invoice_that_is_not_due_or_partially_paid(self):
        invoice = self.add_invoice(amount=100)
        invoice["dueDate"] = "2026-08-31"

        rows = billing.collection_account_rows(
            [billing.invoice_summary(invoice)],
            as_of=date(2026, 7, 29),
        )

        self.assertEqual([], rows)

    def test_collection_accounts_rank_oldest_delinquency_before_larger_newer_balance(self):
        newer_large = self.add_invoice(amount=1000, invoice_id="invoice-1")
        newer_large["dueDate"] = "2026-07-10"
        older_customer = {
            "id": "customer-2",
            "accountNumber": "ACC-0002",
            "firstName": "Grace",
            "lastName": "Hopper",
            "status": "ACTIVE",
        }
        older_small = self.add_invoice(amount=100, invoice_id="invoice-2")
        older_small.update(
            {
                "customerId": older_customer["id"],
                "customer": billing.customer_snapshot(older_customer),
                "dueDate": "2026-06-30",
            }
        )
        customer_by_id = {
            self.customer["id"]: billing.customer_snapshot(self.customer),
            older_customer["id"]: billing.customer_snapshot(older_customer),
        }

        with patch.object(billing, "resolve_customer", side_effect=lambda customer_id: customer_by_id[customer_id]):
            rows = billing.collection_account_rows(
                [billing.invoice_summary(newer_large), billing.invoice_summary(older_small)],
                as_of=date(2026, 7, 29),
            )

        self.assertEqual([older_customer["id"], self.customer["id"]], [row["customerId"] for row in rows])
        self.assertEqual([29, 19], [row["daysOverdue"] for row in rows])

    def test_monthly_collection_performance_counts_unique_billed_customers(self):
        grace = {
            "id": "customer-2",
            "accountNumber": "ACC-0002",
            "firstName": "Grace",
            "lastName": "Hopper",
            "status": "ACTIVE",
        }
        katherine = {
            "id": "customer-3",
            "accountNumber": "ACC-0003",
            "firstName": "Katherine",
            "lastName": "Johnson",
            "status": "ACTIVE",
        }
        primary_invoice = self.add_invoice(amount=100, invoice_id="invoice-primary")
        second_service_invoice = self.add_invoice(amount=50, invoice_id="invoice-second-service")
        credited_invoice = self.add_invoice(amount=100, invoice_id="invoice-credited")
        unpaid_invoice = self.add_invoice(amount=100, invoice_id="invoice-unpaid")
        installation_invoice = self.add_invoice(amount=500, invoice_id="invoice-installation")
        manual_invoice = self.add_invoice(amount=75, invoice_id="invoice-manual")
        for invoice in [primary_invoice, second_service_invoice, credited_invoice, unpaid_invoice]:
            invoice.update(
                {
                    "invoiceType": "MONTHLY",
                    "createdAt": "2026-07-01T00:00:00+00:00",
                    "issueDate": "2026-07-01",
                }
            )
        second_service_invoice["serviceAccountNumber"] = "SA-0002"
        credited_invoice.update(
            {
                "customerId": grace["id"],
                "customer": billing.customer_snapshot(grace),
            }
        )
        unpaid_invoice.update(
            {
                "customerId": katherine["id"],
                "customer": billing.customer_snapshot(katherine),
                "dueDate": "2026-07-20",
            }
        )
        installation_invoice.update(
            {
                "invoiceType": "INSTALLATION_FEE",
                "createdAt": "2026-07-01T00:00:00+00:00",
            }
        )
        manual_invoice["createdAt"] = "2026-07-01T00:00:00+00:00"

        billing.create_payment(
            billing.PaymentPayload(
                customerId=self.customer["id"],
                amount=100,
                method="CASH",
                paymentDate="2026-07-14",
                collectionChannel="COLLECTOR",
                status="POSTED",
                allocations=[
                    billing.PaymentAllocationPayload(invoiceId=primary_invoice["id"], amount=50),
                    billing.PaymentAllocationPayload(invoiceId=second_service_invoice["id"], amount=50),
                ],
            ),
            idempotency_key="payment:monthly-performance",
            admin=self.admin,
        )
        billing.adjustments.append(
            {
                "id": "adjustment-full-credit",
                "invoiceId": credited_invoice["id"],
                "invoiceNumber": credited_invoice["invoiceNumber"],
                "customerId": grace["id"],
                "customer": billing.customer_snapshot(grace),
                "type": "CREDIT",
                "amount": 100.0,
                "reason": "Approved billing credit",
                "adjustmentSource": "MANUAL_ADJUSTMENT",
                "applicationMode": "SELECTED_INVOICE",
                "status": "POSTED",
                "createdAt": "2026-07-10T00:00:00+00:00",
                "updatedAt": "2026-07-10T00:00:00+00:00",
                "deletedAt": None,
            }
        )
        customers = {
            self.customer["id"]: billing.customer_snapshot(self.customer),
            grace["id"]: billing.customer_snapshot(grace),
            katherine["id"]: billing.customer_snapshot(katherine),
        }

        with (
            patch.object(billing, "billing_business_date", return_value=date(2026, 7, 31)),
            patch.object(billing, "resolve_customer", side_effect=lambda customer_id: customers[customer_id]),
        ):
            report = billing.monthly_collection_performance("2026-07", as_of=date(2026, 7, 31))
            unpaid_only = billing.monthly_collection_performance(
                "2026-07",
                as_of=date(2026, 7, 31),
                status="UNPAID",
                search="Katherine ACC-0003",
            )
            action_required = billing.monthly_collection_performance(
                "2026-07",
                as_of=date(2026, 7, 31),
                status="ACTION_REQUIRED",
            )

        self.assertEqual(3, report["billedSubscriberCount"])
        self.assertEqual(4, report["cohortInvoiceCount"])
        self.assertEqual(1, report["fullyPaidSubscriberCount"])
        self.assertEqual(1, report["partiallyPaidSubscriberCount"])
        self.assertEqual(1, report["unpaidSubscriberCount"])
        self.assertEqual(33.33, report["subscriberCollectionRate"])
        self.assertEqual(350.0, report["grossCharges"])
        self.assertEqual(100.0, report["invoiceCredits"])
        self.assertEqual(250.0, report["netBilledAmount"])
        self.assertEqual(100.0, report["cashCollected"])
        self.assertEqual(150.0, report["outstandingAmount"])
        self.assertEqual(40.0, report["cashCollectionRate"])
        self.assertFalse(report["hasReconciliationException"])
        self.assertEqual(1, unpaid_only["pagination"]["totalRows"])
        self.assertEqual(katherine["id"], unpaid_only["rows"][0]["customerId"])
        self.assertEqual(2, action_required["pagination"]["totalRows"])
        self.assertEqual(
            [katherine["id"], self.customer["id"]],
            [row["customerId"] for row in action_required["rows"]],
        )
        self.assertEqual(11, action_required["rows"][0]["daysOverdue"])
        self.assertEqual(100.0, action_required["rows"][0]["overdueAmount"])

    def test_collection_performance_ages_all_open_receivables_as_of_report_date(self):
        aging_inputs = [
            ("invoice-current", "2026-07-31", 100.0),
            ("invoice-1-30", "2026-07-01", 200.0),
            ("invoice-31-60", "2026-06-30", 300.0),
            ("invoice-61-90", "2026-05-31", 400.0),
            ("invoice-90-plus", "2026-05-01", 500.0),
        ]
        for invoice_id, due_date, amount in aging_inputs:
            invoice = self.add_invoice(amount=amount, invoice_id=invoice_id)
            invoice.update(
                {
                    "dueDate": due_date,
                    "createdAt": "2026-05-01T00:00:00+00:00",
                    "updatedAt": "2026-05-01T00:00:00+00:00",
                }
            )

        with patch.object(billing, "billing_business_date", return_value=date(2026, 7, 31)):
            report = billing.monthly_collection_performance(
                "2026-07",
                as_of=date(2026, 7, 31),
            )

        receivables = report["receivables"]
        self.assertEqual(1500.0, receivables["openAmount"])
        self.assertEqual(5, receivables["openInvoiceCount"])
        self.assertEqual(1, receivables["openCustomerCount"])
        self.assertEqual(1400.0, receivables["overdueAmount"])
        self.assertEqual(4, receivables["overdueInvoiceCount"])
        self.assertEqual(1, receivables["overdueCustomerCount"])
        self.assertEqual(91, receivables["oldestDaysOverdue"])
        self.assertEqual(
            [
                ("CURRENT", 100.0, 1, 1),
                ("DAYS_1_30", 200.0, 1, 1),
                ("DAYS_31_60", 300.0, 1, 1),
                ("DAYS_61_90", 400.0, 1, 1),
                ("DAYS_90_PLUS", 500.0, 1, 1),
            ],
            [
                (
                    bucket["key"],
                    bucket["amount"],
                    bucket["invoiceCount"],
                    bucket["customerCount"],
                )
                for bucket in receivables["agingBuckets"]
            ],
        )

    def test_monthly_collection_performance_reports_rebate_credit_separately_from_cash(self):
        invoice = self.add_invoice(amount=100, invoice_id="invoice-rebate")
        invoice.update(
            {
                "invoiceType": "MONTHLY",
                "createdAt": "2026-07-01T00:00:00+00:00",
                "issueDate": "2026-07-01",
            }
        )
        rebate = {
            "id": "rebate-source",
            "invoiceId": "",
            "invoiceNumber": "",
            "customerId": self.customer["id"],
            "customer": billing.customer_snapshot(self.customer),
            "type": "CREDIT",
            "amount": 100.0,
            "reason": "Service outage rebate",
            "adjustmentSource": "SERVICE_REBATE",
            "applicationMode": "CUSTOMER_ACCOUNT_CREDIT",
            "status": "POSTED",
            "createdAt": "2026-07-02T00:00:00+00:00",
            "updatedAt": "2026-07-02T00:00:00+00:00",
            "deletedAt": None,
        }
        billing.adjustments.append(rebate)
        billing.credit_applications.append(
            {
                "id": "credit-application-rebate",
                "customerId": self.customer["id"],
                "sourceType": "ADJUSTMENT_CREDIT",
                "sourcePaymentId": "",
                "sourceAdjustmentId": rebate["id"],
                "invoiceId": invoice["id"],
                "invoiceNumber": invoice["invoiceNumber"],
                "amount": 100.0,
                "status": "POSTED",
                "appliedAt": "2026-07-20T00:00:00+00:00",
                "createdAt": "2026-07-20T00:00:00+00:00",
                "updatedAt": "2026-07-20T00:00:00+00:00",
                "deletedAt": None,
            }
        )

        with patch.object(billing, "billing_business_date", return_value=date(2026, 7, 31)):
            before_application = billing.monthly_collection_performance(
                "2026-07",
                as_of=date(2026, 7, 15),
            )
            after_application = billing.monthly_collection_performance(
                "2026-07",
                as_of=date(2026, 7, 21),
            )

        self.assertEqual(1, before_application["unpaidSubscriberCount"])
        self.assertEqual(100.0, before_application["outstandingAmount"])
        self.assertEqual(1, after_application["fullyPaidSubscriberCount"])
        self.assertEqual(100.0, after_application["subscriberCollectionRate"])
        self.assertEqual(0.0, after_application["cashCollected"])
        self.assertEqual(0.0, after_application["cashCollectionRate"])
        self.assertEqual(100.0, after_application["accountCreditsApplied"])
        self.assertEqual(100.0, after_application["rebatesApplied"])
        self.assertEqual(0.0, after_application["outstandingAmount"])

    def test_monthly_collection_performance_uses_posting_date_for_as_of_cutoff(self):
        invoice = self.add_invoice(amount=100, invoice_id="invoice-posting-cutoff")
        invoice.update(
            {
                "invoiceType": "MONTHLY",
                "createdAt": "2026-07-01T00:00:00+00:00",
                "issueDate": "2026-07-01",
            }
        )
        payment = billing.create_payment(
            billing.PaymentPayload(
                invoiceId=invoice["id"],
                amount=100,
                method="CASH",
                paymentDate="2026-07-05",
                collectionChannel="POS",
                status="POSTED",
            ),
            idempotency_key="payment:posting-cutoff",
            admin=self.admin,
        )
        payment["postedAt"] = "2026-07-20T00:00:00+00:00"
        payment["createdAt"] = "2026-07-20T00:00:00+00:00"

        with patch.object(billing, "billing_business_date", return_value=date(2026, 7, 31)):
            before_posting = billing.monthly_collection_performance(
                "2026-07",
                as_of=date(2026, 7, 15),
            )
            after_posting = billing.monthly_collection_performance(
                "2026-07",
                as_of=date(2026, 7, 21),
            )

        self.assertEqual(1, before_posting["unpaidSubscriberCount"])
        self.assertEqual(0.0, before_posting["cashCollected"])
        self.assertEqual(1, after_posting["fullyPaidSubscriberCount"])
        self.assertEqual(100.0, after_posting["cashCollected"])
        self.assertEqual(100.0, after_posting["cashCollectionRate"])

    def test_advance_credit_is_applied_fifo_to_next_monthly_invoice(self):
        self.add_invoice(amount=100)
        receipt = billing.create_payment(
            billing.PaymentPayload(
                customerId=self.customer["id"],
                amount=350,
                advanceAmount=250,
                allocations=[billing.PaymentAllocationPayload(invoiceId="invoice-1", amount=100)],
                method="CASH",
                paymentDate="2026-07-14",
                collectionChannel="COLLECTOR",
                status="POSTED",
            ),
            idempotency_key="payment:advance-credit",
            admin=self.admin,
        )

        self.assertEqual(100.0, receipt["appliedAmount"])
        self.assertEqual(250.0, receipt["advanceAmount"])
        self.assertEqual(250.0, receipt["accountCreditAfter"])
        self.assertEqual(250.0, billing.customer_credit_balance(self.customer["id"]))

        self.add_subscription()
        next_invoice = billing.generate_subscription_invoice(
            "subscription-1",
            cycleStart="2026-08-01",
            idempotency_key="invoice:advance-cycle",
            admin=self.admin,
        )

        self.assertEqual("PARTIALLY_PAID", next_invoice["status"])
        self.assertEqual(250.0, next_invoice["paidTotal"])
        self.assertEqual(750.0, next_invoice["balance"])
        self.assertEqual(0.0, billing.customer_credit_balance(self.customer["id"]))
        self.assertEqual(1, len(billing.credit_applications))
        self.assertEqual(receipt["id"], billing.credit_applications[0]["sourcePaymentId"])

        with self.assertRaises(HTTPException) as raised:
            billing.delete_payment(receipt["id"], reason="Invalid reversal", admin=self.admin)
        self.assertEqual(409, raised.exception.status_code)

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
        self.assertEqual("2026-07", first["billingPeriodMonth"])
        self.assertEqual("July 2026", first["billingPeriodLabel"])

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

    def test_prepaid_cycle_enters_automatic_run_preview_on_lead_date(self):
        subscription = self.add_subscription()
        subscription["nextInvoiceDate"] = "2026-08-01"

        before_lead = billing.billing_run_preview_data(date(2026, 7, 24))
        on_lead = billing.billing_run_preview_data(date(2026, 7, 25))
        run = billing.execute_billing_run(
            date(2026, 7, 25),
            "AUTOMATIC",
            "system:automatic-biller",
            "billing-run:prepaid-lead",
            generated_on=date(2026, 7, 25),
        )

        self.assertEqual(0, before_lead["dueCycles"])
        self.assertEqual(1, on_lead["dueCycles"])
        self.assertEqual("2026-07-25", on_lead["subscriptions"][0]["nextGenerationDate"])
        self.assertEqual(1, run["invoicesCreated"])
        self.assertEqual("2026-07-25", billing.invoices[0]["issueDate"])
        self.assertEqual("2026-08-01", billing.invoices[0]["dueDate"])

    def test_postpaid_cycle_runs_only_at_period_close(self):
        subscription = self.add_subscription()
        subscription["billingMode"] = "POSTPAID"
        subscription["dueDays"] = 7

        early_run = billing.execute_billing_run(
            date(2026, 7, 30),
            "MANUAL",
            self.admin["username"],
            "billing-run:postpaid-early",
            generated_on=date(2026, 7, 30),
        )
        close_run = billing.execute_billing_run(
            date(2026, 7, 31),
            "MANUAL",
            self.admin["username"],
            "billing-run:postpaid-close",
            generated_on=date(2026, 7, 31),
        )

        self.assertEqual(0, early_run["invoicesCreated"])
        self.assertEqual(1, close_run["invoicesCreated"])
        self.assertEqual("2026-07-31", billing.invoices[0]["issueDate"])
        self.assertEqual("2026-08-07", billing.invoices[0]["dueDate"])

    def test_future_postpaid_cycle_uses_generation_date_and_contractual_due_date(self):
        subscription = self.add_subscription()
        subscription["billingMode"] = "POSTPAID"
        subscription["dueDays"] = 7
        subscription["nextInvoiceDate"] = "2026-09-01"

        with patch.object(billing, "billing_business_date", return_value=date(2026, 7, 29)):
            invoice = billing.generate_subscription_invoice(
                subscription["id"],
                cycleStart="2026-09-01",
                idempotency_key="invoice:future-postpaid",
                admin=self.admin,
            )

        self.assertEqual("2026-07-29", invoice["issueDate"])
        self.assertEqual("2026-10-07", invoice["dueDate"])

    def test_issued_subscription_invoice_uses_server_generation_date(self):
        subscription = self.add_subscription()
        subscription["billingMode"] = "POSTPAID"
        subscription["dueDays"] = 7
        payload = billing.InvoicePayload(
            subscriptionId=subscription["id"],
            billingCycleStart="2026-09-01",
            billingCycleEnd="2026-09-30",
            issueDate="2026-09-30",
            dueDate="2026-09-30",
            status="ISSUED",
            lineItems=[{"description": "September service", "quantity": 1, "unitPrice": 1000}],
        )

        with patch.object(billing, "billing_business_date", return_value=date(2026, 7, 29)):
            invoice = billing.create_invoice(
                payload,
                idempotency_key="invoice:server-issued-date",
                admin=self.admin,
            )

        self.assertEqual("2026-07-29", invoice["issueDate"])
        self.assertEqual("2026-10-07", invoice["dueDate"])

    def test_billing_run_catches_up_due_cycles_in_order(self):
        subscription = self.add_subscription()

        run = billing.execute_billing_run(
            date(2026, 9, 1),
            "MANUAL",
            self.admin["username"],
            "billing-run:catch-up",
            generated_on=date(2026, 9, 1),
        )

        self.assertEqual("COMPLETED", run["status"])
        self.assertEqual(3, run["invoicesCreated"])
        self.assertEqual(3000.0, run["totalAmount"])
        self.assertEqual(
            ["2026-07-01", "2026-08-01", "2026-09-01"],
            [invoice["billingCycleStart"] for invoice in billing.invoices],
        )
        self.assertEqual(["2026-09-01"] * 3, [invoice["issueDate"] for invoice in billing.invoices])
        self.assertEqual(["2026-09-01"] * 3, [invoice["dueDate"] for invoice in billing.invoices])
        self.assertEqual("2026-10-01", subscription["nextInvoiceDate"])

    def test_first_prepaid_invoice_uses_generation_date_and_service_start_due_date(self):
        subscription = self.add_subscription()
        subscription["startDate"] = "2026-08-01"
        subscription["nextInvoiceDate"] = "2026-08-01"

        with patch.object(billing, "billing_business_date", return_value=date(2026, 7, 29)):
            invoice = billing.create_first_subscription_invoice(subscription, self.admin["username"])

        self.assertEqual("2026-07-29", invoice["issueDate"])
        self.assertEqual("2026-08-01", invoice["dueDate"])
        self.assertEqual(
            "Fiber 100 prepaid internet service (August 2026)",
            invoice["lineItems"][0]["description"],
        )

    def test_billing_run_retry_replays_without_duplicate_invoice(self):
        self.add_subscription()

        first = billing.execute_billing_run(
            date(2026, 7, 1),
            "MANUAL",
            self.admin["username"],
            "billing-run:stable-retry",
        )
        retry = billing.execute_billing_run(
            date(2026, 7, 1),
            "MANUAL",
            self.admin["username"],
            "billing-run:stable-retry",
        )

        self.assertEqual(first["id"], retry["id"])
        self.assertTrue(retry["idempotentReplay"])
        self.assertEqual(1, len(billing.invoices))
        self.assertEqual(1, len(billing.billing_runs))

    def test_manual_billing_run_rejects_future_business_date(self):
        with patch.object(billing, "billing_business_date", return_value=date(2026, 7, 28)):
            with self.assertRaises(HTTPException) as raised:
                billing.trigger_billing_run(
                    billing.BillingRunPayload(asOf="2026-07-29"),
                    idempotency_key="billing-run:future",
                    admin=self.admin,
                )

        self.assertEqual(400, raised.exception.status_code)
        self.assertEqual([], billing.billing_runs)
        self.assertEqual([], billing.invoices)

    def test_daily_automatic_run_reopens_for_new_due_subscription(self):
        first_subscription = self.add_subscription()
        first_run = billing.execute_billing_run(
            date(2026, 7, 1),
            "AUTOMATIC",
            "system:automatic-biller",
            "billing-run:auto:2026-07-01",
        )
        second_subscription = {
            **first_subscription,
            "id": "subscription-2",
            "serviceAccountId": "service-account-2",
            "serviceAccountNumber": "SA-0002",
            "serviceId": "SVC-0002",
            "nextInvoiceDate": "2026-07-01",
        }
        billing.subscriptions.append(second_subscription)

        refreshed_run = billing.execute_billing_run(
            date(2026, 7, 1),
            "AUTOMATIC",
            "system:automatic-biller",
            "billing-run:auto:2026-07-01",
        )

        self.assertEqual(first_run["id"], refreshed_run["id"])
        self.assertEqual(2, refreshed_run["invoicesCreated"])
        self.assertEqual(2, len(billing.invoices))
        self.assertEqual(1, len(billing.billing_runs))

    def test_billing_run_isolates_invalid_subscription_and_posts_valid_cycle(self):
        valid_subscription = self.add_subscription()
        invalid_subscription = {
            **valid_subscription,
            "id": "subscription-invalid",
            "serviceAccountId": "service-account-invalid",
            "nextInvoiceDate": "not-a-date",
        }
        billing.subscriptions.append(invalid_subscription)

        run = billing.execute_billing_run(
            date(2026, 7, 1),
            "MANUAL",
            self.admin["username"],
            "billing-run:partial-success",
        )

        self.assertEqual("PARTIAL_SUCCESS", run["status"])
        self.assertEqual(1, run["invoicesCreated"])
        self.assertEqual(1, run["failedCycles"])
        self.assertEqual(1, len(billing.invoices))
        self.assertEqual("subscription-1", billing.invoices[0]["subscriptionId"])

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

    def test_customer_rebate_credit_applies_to_newest_outstanding_monthly_bill(self):
        older_invoice = self.add_invoice(amount=100, invoice_id="invoice-older")
        older_invoice.update(
            {
                "invoiceType": "MONTHLY",
                "billingCycleStart": "2026-06-01",
                "billingCycleEnd": "2026-06-30",
            }
        )
        current_invoice = self.add_invoice(amount=200, invoice_id="invoice-current")
        current_invoice.update(
            {
                "invoiceType": "MONTHLY",
                "billingCycleStart": "2026-07-01",
                "billingCycleEnd": "2026-07-31",
            }
        )
        installation_invoice = self.add_invoice(amount=500, invoice_id="invoice-installation")
        installation_invoice.update(
            {
                "invoiceType": "INSTALLATION_FEE",
                "billingCycleStart": "2026-08-01",
                "billingCycleEnd": "2026-08-31",
            }
        )
        payload = billing.AdjustmentPayload(
            customerId=self.customer["id"],
            amount=50,
            reason="Approved outage rebate",
        )

        first = billing.create_adjustment(
            payload,
            idempotency_key="adjustment:customer-rebate",
            admin=self.admin,
        )
        replay = billing.create_adjustment(
            payload,
            idempotency_key="adjustment:customer-rebate",
            admin=self.admin,
        )

        self.assertEqual(first["id"], replay["id"])
        self.assertTrue(replay["idempotentReplay"])
        self.assertEqual("", first["invoiceId"])
        self.assertEqual("invoice-current", first["initialAppliedInvoiceId"])
        self.assertEqual(50.0, first["initialAppliedAmount"])
        self.assertEqual("SERVICE_REBATE", first["adjustmentSource"])
        self.assertEqual("CUSTOMER_ACCOUNT_CREDIT", first["applicationMode"])
        self.assertEqual("CREDIT", first["type"])
        self.assertEqual(50.0, first["creditAppliedAmount"])
        self.assertEqual(0.0, first["creditAvailableAmount"])
        self.assertEqual(1, len(billing.adjustments))
        self.assertEqual(1, len(billing.credit_applications))
        self.assertEqual(first["id"], billing.credit_applications[0]["sourceAdjustmentId"])
        self.assertEqual("invoice-current", billing.credit_applications[0]["invoiceId"])
        self.assertEqual(100.0, billing.invoice_summary(older_invoice)["balance"])
        current_summary = billing.invoice_summary(current_invoice)
        self.assertEqual(50.0, current_summary["rebateTotal"])
        self.assertEqual(200.0, current_summary["total"])
        self.assertEqual(50.0, current_summary["paidTotal"])
        self.assertEqual(150.0, current_summary["balance"])
        self.assertEqual(500.0, billing.invoice_summary(installation_invoice)["balance"])
        self.assertTrue(
            any(
                event["action"] == "billing_adjustment_posted"
                and event["details"].get("source") == "SERVICE_REBATE"
                for event in self.audit_events
            )
        )

    def test_customer_rebate_excess_remains_available_after_current_bill_is_closed(self):
        self.add_invoice(amount=100)
        billing.create_payment(
            self.payment_payload(60),
            idempotency_key="payment:before-rebate",
            admin=self.admin,
        )

        rebate = billing.create_adjustment(
            billing.AdjustmentPayload(
                customerId=self.customer["id"],
                amount=50,
                reason="Outage rebate",
            ),
            idempotency_key="adjustment:rebate-carry-forward",
            admin=self.admin,
        )

        self.assertEqual(40.0, rebate["creditAppliedAmount"])
        self.assertEqual(10.0, rebate["creditAvailableAmount"])
        self.assertEqual(10.0, billing.customer_credit_balance(self.customer["id"]))
        invoice = billing.invoice_summary(billing.invoices[0])
        self.assertEqual(100.0, invoice["total"])
        self.assertEqual(60.0, invoice["paymentTotal"])
        self.assertEqual(40.0, invoice["accountCreditAppliedTotal"])
        self.assertEqual(100.0, invoice["paidTotal"])
        self.assertEqual(0.0, invoice["balance"])
        self.assertEqual(40.0, invoice["rebateTotal"])

    def test_customer_rebate_requires_reason_but_not_an_outstanding_bill(self):
        self.add_invoice(amount=100)
        with self.assertRaises(HTTPException) as missing_reason:
            billing.create_adjustment(
                billing.AdjustmentPayload(customerId=self.customer["id"], amount=20),
                idempotency_key="adjustment:rebate-no-reason",
                admin=self.admin,
            )
        self.assertEqual(400, missing_reason.exception.status_code)
        self.assertEqual([], billing.adjustments)

        billing.create_payment(
            self.payment_payload(100),
            idempotency_key="payment:close-before-rebate",
            admin=self.admin,
        )
        rebate = billing.create_adjustment(
            billing.AdjustmentPayload(
                customerId=self.customer["id"],
                amount=20,
                reason="Outage rebate",
            ),
            idempotency_key="adjustment:rebate-no-bill",
            admin=self.admin,
        )
        self.assertEqual(0.0, rebate["creditAppliedAmount"])
        self.assertEqual(20.0, rebate["creditAvailableAmount"])
        self.assertEqual(20.0, billing.customer_credit_balance(self.customer["id"]))
        self.assertEqual([], billing.credit_applications)

    def test_outage_rebate_preview_prorates_exact_calendar_month_hours(self):
        subscription = self.add_subscription()
        subscription["startDate"] = "2026-06-01"
        invoice = self.add_invoice(amount=500)
        invoice["invoiceType"] = "MONTHLY"

        july_quote = billing.preview_outage_rebates(
            billing.OutageRebatePreviewPayload(
                customerIds=[self.customer["id"]],
                outageStart="2026-07-15T00:00",
                outageEnd="2026-07-16T00:00",
            ),
            admin=self.admin,
        )
        cross_month_quote = billing.preview_outage_rebates(
            billing.OutageRebatePreviewPayload(
                customerIds=[self.customer["id"]],
                outageStart="2026-06-30T12:00",
                outageEnd="2026-07-01T12:00",
            ),
            admin=self.admin,
        )

        self.assertEqual("ACTUAL_CALENDAR_MONTH_HOURLY_PRORATION", july_quote["calculationMethod"])
        self.assertEqual("Asia/Manila", july_quote["timezone"])
        self.assertEqual(24.0, july_quote["durationHours"])
        self.assertEqual(32.26, july_quote["rows"][0]["calculatedAmount"])
        self.assertEqual(32.26, july_quote["rows"][0]["rebateAmount"])
        self.assertEqual(32.8, cross_month_quote["rows"][0]["rebateAmount"])
        self.assertTrue(july_quote["canPost"])

    def test_outage_rebate_without_open_bill_is_applied_to_next_monthly_invoice(self):
        subscription = self.add_subscription()
        subscription["startDate"] = "2026-06-01"
        preview_payload = billing.OutageRebatePreviewPayload(
            customerIds=[self.customer["id"]],
            outageStart="2026-07-15T00:00",
            outageEnd="2026-07-16T00:00",
        )

        preview = billing.preview_outage_rebates(preview_payload, admin=self.admin)

        self.assertTrue(preview["canPost"])
        self.assertEqual("", preview["rows"][0]["invoiceId"])
        self.assertEqual("NEXT_INVOICE", preview["rows"][0]["applicationMode"])
        self.assertEqual(0.0, preview["rows"][0]["applyNowAmount"])
        self.assertEqual(32.26, preview["rows"][0]["carryForwardAmount"])

        batch = billing.create_outage_rebate_batch(
            billing.OutageRebateBatchPayload(
                **preview_payload.model_dump(),
                previewFingerprint=preview["quoteFingerprint"],
            ),
            idempotency_key="outage-rebate:future-invoice",
            admin=self.admin,
        )
        adjustment = billing.adjustments[0]

        self.assertEqual(0.0, batch["totalAppliedAmount"])
        self.assertEqual(32.26, batch["totalAvailableCredit"])
        self.assertEqual(32.26, billing.customer_credit_balance(self.customer["id"]))
        self.assertEqual("", adjustment["invoiceId"])
        self.assertEqual("CUSTOMER_ACCOUNT_CREDIT", adjustment["applicationMode"])
        self.assertEqual([], billing.credit_applications)

        next_invoice = billing.generate_subscription_invoice(
            subscription["id"],
            cycleStart="2026-08-01",
            idempotency_key="invoice:rebate-credit-cycle",
            admin=self.admin,
        )

        self.assertEqual("PARTIALLY_PAID", next_invoice["status"])
        self.assertEqual(0.0, next_invoice["paymentTotal"])
        self.assertEqual(32.26, next_invoice["accountCreditAppliedTotal"])
        self.assertEqual(32.26, next_invoice["paidTotal"])
        self.assertEqual(32.26, next_invoice["rebateTotal"])
        self.assertEqual(967.74, next_invoice["balance"])
        self.assertEqual(0.0, billing.customer_credit_balance(self.customer["id"]))
        self.assertEqual(1, len(billing.credit_applications))
        self.assertEqual(adjustment["id"], billing.credit_applications[0]["sourceAdjustmentId"])
        self.assertEqual(next_invoice["id"], billing.credit_applications[0]["invoiceId"])

        detail = billing.get_invoice(next_invoice["id"], admin=self.admin)
        self.assertEqual("Service rebate", detail["adjustments"][0]["adjustmentLabel"])
        self.assertEqual(32.26, detail["adjustments"][0]["amount"])
        document = billing.download_invoice_pdf(next_invoice["id"], admin=self.admin).body
        self.assertIn(b"Service outage rebate", document)
        self.assertIn(b"Account credits applied", document)
        with self.assertRaises(HTTPException) as raised:
            billing.delete_adjustment(adjustment["id"], reason="Invalid reversal", admin=self.admin)
        self.assertEqual(409, raised.exception.status_code)

    def test_outage_rebate_batch_posts_multiple_customers_atomically_and_replays(self):
        second_customer = {
            "id": "customer-2",
            "accountNumber": "ACC-0002",
            "firstName": "Grace",
            "lastName": "Hopper",
            "status": "ACTIVE",
        }
        customer_by_id = {
            self.customer["id"]: self.customer,
            second_customer["id"]: second_customer,
        }
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
            lambda customer_id: customer_by_id[customer_id],
            lambda search: list(customer_by_id.values()),
        )
        first_subscription = self.add_subscription()
        first_subscription["startDate"] = "2026-06-01"
        second_subscription = deepcopy(first_subscription)
        second_subscription.update(
            {
                "id": "subscription-2",
                "customerId": second_customer["id"],
                "customer": billing.customer_snapshot(second_customer),
                "monthlyRate": 1500.0,
                "listMonthlyRate": 1500.0,
                "serviceAccountId": "service-account-2",
                "serviceAccountNumber": "SA-0002",
                "serviceOrderId": "service-order-2",
                "serviceId": "SVC-0002",
            }
        )
        billing.subscriptions.append(second_subscription)
        first_invoice = self.add_invoice(amount=500, invoice_id="invoice-1")
        first_invoice["invoiceType"] = "MONTHLY"
        second_invoice = self.add_invoice(amount=500, invoice_id="invoice-2")
        second_invoice.update(
            {
                "customerId": second_customer["id"],
                "customer": billing.customer_snapshot(second_customer),
                "invoiceType": "MONTHLY",
            }
        )
        preview_payload = billing.OutageRebatePreviewPayload(
            customerIds=[second_customer["id"], self.customer["id"]],
            outageStart="2026-07-15T00:00",
            outageEnd="2026-07-16T00:00",
        )
        preview = billing.preview_outage_rebates(preview_payload, admin=self.admin)
        post_payload = billing.OutageRebateBatchPayload(
            **preview_payload.model_dump(),
            previewFingerprint=preview["quoteFingerprint"],
        )

        first = billing.create_outage_rebate_batch(
            post_payload,
            idempotency_key="outage-rebate:multi-customer",
            admin=self.admin,
        )
        replay = billing.create_outage_rebate_batch(
            post_payload,
            idempotency_key="outage-rebate:multi-customer",
            admin=self.admin,
        )

        self.assertEqual(2, first["customerCount"])
        self.assertEqual(80.65, first["totalRebateAmount"])
        self.assertEqual(first["batchId"], replay["batchId"])
        self.assertTrue(replay["idempotentReplay"])
        self.assertEqual(2, len(billing.adjustments))
        self.assertEqual({32.26, 48.39}, {row["amount"] for row in billing.adjustments})
        self.assertEqual(467.74, billing.invoice_summary(first_invoice)["balance"])
        self.assertEqual(451.61, billing.invoice_summary(second_invoice)["balance"])
        self.assertTrue(all(row["outageBatchId"] == first["batchId"] for row in billing.adjustments))
        self.assertTrue(
            any(event["action"] == "billing_outage_rebate_batch_posted" for event in self.audit_events)
        )

    def test_outage_rebate_batch_rejects_stale_preview_without_partial_posting(self):
        subscription = self.add_subscription()
        subscription["startDate"] = "2026-06-01"
        invoice = self.add_invoice(amount=40)
        invoice["invoiceType"] = "MONTHLY"
        preview_payload = billing.OutageRebatePreviewPayload(
            customerIds=[self.customer["id"]],
            outageStart="2026-07-15T00:00",
            outageEnd="2026-07-16T00:00",
        )
        preview = billing.preview_outage_rebates(preview_payload, admin=self.admin)
        billing.create_payment(
            self.payment_payload(20),
            idempotency_key="payment:outage-preview-change",
            admin=self.admin,
        )

        with self.assertRaises(HTTPException) as raised:
            billing.create_outage_rebate_batch(
                billing.OutageRebateBatchPayload(
                    **preview_payload.model_dump(),
                    previewFingerprint=preview["quoteFingerprint"],
                ),
                idempotency_key="outage-rebate:stale-preview",
                admin=self.admin,
            )

        self.assertEqual(409, raised.exception.status_code)
        self.assertIn("preview changed", raised.exception.detail.lower())
        self.assertEqual([], billing.adjustments)

    def test_outage_rebate_prevents_duplicate_customer_window(self):
        subscription = self.add_subscription()
        subscription["startDate"] = "2026-06-01"
        invoice = self.add_invoice(amount=100)
        invoice["invoiceType"] = "MONTHLY"
        preview_payload = billing.OutageRebatePreviewPayload(
            customerIds=[self.customer["id"]],
            outageStart="2026-07-15T00:00",
            outageEnd="2026-07-16T00:00",
        )
        first_preview = billing.preview_outage_rebates(preview_payload, admin=self.admin)
        billing.create_outage_rebate_batch(
            billing.OutageRebateBatchPayload(
                **preview_payload.model_dump(),
                previewFingerprint=first_preview["quoteFingerprint"],
            ),
            idempotency_key="outage-rebate:first-window",
            admin=self.admin,
        )
        duplicate_preview = billing.preview_outage_rebates(preview_payload, admin=self.admin)

        self.assertFalse(duplicate_preview["canPost"])
        self.assertEqual(0, duplicate_preview["eligibleCount"])
        self.assertIn("already posted", duplicate_preview["rows"][0]["ineligibleReason"].lower())
        with self.assertRaises(HTTPException) as raised:
            billing.create_outage_rebate_batch(
                billing.OutageRebateBatchPayload(
                    **preview_payload.model_dump(),
                    previewFingerprint=duplicate_preview["quoteFingerprint"],
                ),
                idempotency_key="outage-rebate:duplicate-window",
                admin=self.admin,
            )
        self.assertEqual(409, raised.exception.status_code)
        self.assertEqual(1, len(billing.adjustments))

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
