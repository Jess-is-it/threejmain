import importlib
import os
import sys
import unittest
from pathlib import Path

from fastapi import HTTPException


os.environ["COLLECTOR_STORAGE"] = "memory"
os.environ.pop("DATABASE_URL", None)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

collector = importlib.import_module("collector.router")


class CollectorWorkflowTests(unittest.TestCase):
    def setUp(self):
        for records in collector.COLLECTOR_RECORD_COLLECTIONS.values():
            records.clear()
        collector.collector_store.storage_mode = "memory"
        collector.collector_store.database_url = ""
        collector.collector_store._loaded = True
        collector.collector_store._schema_ready = False

        self.collector_actor = {
            "id": "user-collector",
            "username": "collector-one",
            "full_name": "Collector One",
            "role": "collector",
            "permissions": [
                "collector.portal.view",
                "collector.payment.collect",
                "collector.remittance.submit",
            ],
        }
        self.other_collector = {
            "id": "user-collector-two",
            "username": "collector-two",
            "full_name": "Collector Two",
            "role": "collector",
            "permissions": [
                "collector.portal.view",
                "collector.payment.collect",
                "collector.remittance.submit",
            ],
        }
        self.finance_actor = {
            "id": "user-finance",
            "username": "finance-one",
            "full_name": "Finance One",
            "role": "finance_officer",
            "permissions": [
                "collector.portal.view",
                "collector.finance.view",
                "collector.finance.confirm",
            ],
        }
        self.customer = {
            "id": "customer-1",
            "accountNumber": "ACC-0001",
            "name": "Ada Lovelace",
            "firstName": "Ada",
            "lastName": "Lovelace",
            "contactNumber": "09171234567",
            "addressLine1": "Zone 2",
            "barangay": "Roma Norte",
            "city": "Enrile",
            "province": "Cagayan",
        }
        self.invoice_rows = [
            {
                "id": "invoice-1",
                "invoiceNumber": "INV-000001",
                "status": "OVERDUE",
                "dueDate": "2026-05-31",
                "billingCycleStart": "2026-05-01",
                "billingCycleEnd": "2026-05-31",
                "catalogName": "Fiber 100",
                "lineItems": [],
                "balance": 100.0,
            },
            {
                "id": "invoice-2",
                "invoiceNumber": "INV-000002",
                "status": "ISSUED",
                "dueDate": "2026-06-30",
                "billingCycleStart": "2026-06-01",
                "billingCycleEnd": "2026-06-30",
                "catalogName": "Fiber 100",
                "lineItems": [],
                "balance": 200.0,
            },
        ]
        self.billing_postings = []
        self.account_credit = 0.0
        self.audit_events = []
        self.sms_messages = []

        def aging_provider(search=""):
            open_invoices = [dict(row) for row in self.invoice_rows if row["balance"] > 0]
            outstanding = round(sum(row["balance"] for row in open_invoices), 2)
            overdue = round(sum(row["balance"] for row in open_invoices if row["status"] == "OVERDUE"), 2)
            promotion_discount_total = round(
                sum(
                    float((row.get("promotionQuote") or {}).get("promotionDiscountAmount") or 0)
                    for row in open_invoices
                ),
                2,
            )
            payable_today = round(
                sum(
                    float((row.get("promotionQuote") or {}).get("discountedPayable", row["balance"]))
                    for row in open_invoices
                ),
                2,
            )
            row = {
                "customerId": self.customer["id"],
                "customer": dict(self.customer),
                "outstandingBalance": outstanding,
                "promotionDiscountTotal": promotion_discount_total,
                "payableToday": payable_today,
                "overdueBalance": overdue,
                "openInvoiceCount": len(open_invoices),
                "overdueInvoiceCount": sum(row["status"] == "OVERDUE" for row in open_invoices),
                "oldestDueDate": min((row["dueDate"] for row in open_invoices), default=""),
                "accountCredit": self.account_credit,
                "invoices": open_invoices,
            }
            quote_dates = [
                (invoice.get("promotionQuote") or {}).get("paymentDate")
                for invoice in open_invoices
                if (invoice.get("promotionQuote") or {}).get("paymentDate")
            ]
            if quote_dates:
                row["paymentDate"] = quote_dates[0]
            needle = search.strip().lower()
            return [row] if not needle or needle in self.customer["name"].lower() else []

        def payment_poster(payload, idempotency_key, actor):
            allocations = []
            promotion_adjustments = []
            for requested in payload["allocations"]:
                invoice = next(row for row in self.invoice_rows if row["id"] == requested["invoiceId"])
                before = invoice["balance"]
                quote = invoice.get("promotionQuote") or {}
                requested_promotion_ids = requested.get("promotionIds") or []
                promotion_discount = (
                    float(quote.get("promotionDiscountAmount") or 0)
                    if requested_promotion_ids == (quote.get("promotionIds") or [])
                    else 0
                )
                invoice["balance"] = round(before - requested["amount"] - promotion_discount, 2)
                allocations.append(
                    {
                        "invoiceId": invoice["id"],
                        "invoiceNumber": invoice["invoiceNumber"],
                        "amount": requested["amount"],
                        "balanceBefore": before,
                        "promotionIds": requested_promotion_ids,
                    }
                )
                for promotion in quote.get("promotions") or []:
                    if promotion.get("id") not in requested_promotion_ids:
                        continue
                    promotion_adjustments.append(
                        {
                            "invoiceId": invoice["id"],
                            "invoiceNumber": invoice["invoiceNumber"],
                            "promotionId": promotion["id"],
                            "promotionCode": promotion.get("promoCode") or "",
                            "promotionName": promotion.get("name") or "",
                            "amount": promotion.get("discountAmount") or 0,
                        }
                    )
            self.account_credit = round(self.account_credit + float(payload.get("advanceAmount") or 0), 2)
            payment = {
                "id": f"billing-payment-{len(self.billing_postings) + 1}",
                "receiptNumber": f"OR-{len(self.billing_postings) + 1:06d}",
                "status": "POSTED",
                "allocations": allocations,
                "advanceAmount": float(payload.get("advanceAmount") or 0),
                "promotionDiscountAdjustments": promotion_adjustments,
                "promotionDiscountAmount": round(
                    sum(float(row["amount"]) for row in promotion_adjustments),
                    2,
                ),
                "accountCreditAfter": self.account_credit,
                "collectionChannel": "COLLECTOR",
                "idempotencyKey": idempotency_key,
            }
            self.billing_postings.append({"payload": payload, "payment": payment, "actor": actor})
            return payment

        collector.configure_collector(
            lambda authorization: self.collector_actor,
            lambda action, target_type, target_id, details, actor: self.audit_events.append(
                {
                    "action": action,
                    "targetType": target_type,
                    "targetId": target_id,
                    "details": details,
                    "actor": actor,
                }
            ),
            lambda customer_id: dict(self.customer) if customer_id == self.customer["id"] else {},
            lambda search: [dict(self.customer)],
            aging_provider,
            payment_poster,
            self.send_sms,
        )

    def send_sms(self, **kwargs):
        self.sms_messages.append(kwargs)
        return {"status": "SUCCESS", "messageId": f"sms-{len(self.sms_messages)}"}

    def add_promo_quote(
        self,
        invoice_id="invoice-1",
        discount=20,
        payable=80,
        payment_date="2026-07-28",
        fingerprint="quote-invoice-1-v1",
    ):
        invoice = next(row for row in self.invoice_rows if row["id"] == invoice_id)
        invoice["promotionQuote"] = {
            "version": 1,
            "paymentDate": payment_date,
            "quoteFingerprint": fingerprint,
            "invoiceBalance": invoice["balance"],
            "promotionIds": ["promo-automatic"],
            "promotions": [
                {
                    "id": "promo-automatic",
                    "name": "Automatic Loyalty Discount",
                    "promoCode": "LOYALTY-20",
                    "discountAmount": discount,
                }
            ],
            "promotionDiscountAmount": discount,
            "discountedPayable": payable,
            "hasAutomaticPromotion": True,
        }
        return invoice["promotionQuote"]

    def claim(self, actor=None):
        return collector.claim_customer(
            self.customer["id"],
            collector.ClaimPayload(minutes=60),
            actor=actor or self.collector_actor,
        )

    def post_cash(self, key="collector:test-cash"):
        return collector.create_collection(
            collector.CollectionPayload(
                customerId=self.customer["id"],
                amount=150,
                allocations=[
                    collector.CollectionAllocationPayload(invoiceId="invoice-1", amount=100),
                    collector.CollectionAllocationPayload(invoiceId="invoice-2", amount=50),
                ],
                method="CASH",
                paymentDate="2026-07-28",
                tenderedAmount=200,
                smsDestination=self.customer["contactNumber"],
            ),
            idempotency_key=key,
            actor=self.collector_actor,
        )

    def test_claim_prevents_two_collectors_from_collecting_same_customer(self):
        claimed = self.claim()

        with self.assertRaises(HTTPException) as raised:
            self.claim(self.other_collector)

        self.assertEqual(409, raised.exception.status_code)
        self.assertEqual("collector-one", claimed["collectorUsername"])
        self.assertEqual(1, len(collector.claims))

    def test_finance_role_cannot_collect_or_submit_collector_custody(self):
        metadata = collector.meta(actor=self.finance_actor)

        self.assertFalse(metadata["canCollect"])
        self.assertFalse(metadata["canSubmitRemittance"])
        self.assertTrue(metadata["canViewFinance"])
        self.assertTrue(metadata["canConfirmFinance"])

    def test_payment_posts_to_billing_sends_sms_and_replays_safely(self):
        self.claim()
        posted = self.post_cash()
        replay = self.post_cash()

        self.assertEqual("POSTED", posted["billingPaymentStatus"])
        self.assertEqual("HELD", posted["custodyStatus"])
        self.assertEqual(150.0, posted["balanceAfter"])
        self.assertEqual(50.0, posted["changeAmount"])
        self.assertEqual("SUCCESS", posted["sms"]["status"])
        self.assertEqual(posted["id"], replay["id"])
        self.assertTrue(replay["idempotentReplay"])
        self.assertEqual(1, len(self.billing_postings))
        self.assertEqual(1, len(self.sms_messages))
        self.assertEqual("COLLECTOR", self.billing_postings[0]["payload"]["collectionChannel"])
        self.assertEqual("3J BILL", self.sms_messages[0]["source"])
        self.assertEqual(self.customer["contactNumber"], self.sms_messages[0]["destination"])
        self.assertEqual("COLLECTOR_PAYMENT_CONFIRMATION", self.sms_messages[0]["purpose"])
        self.assertEqual("3J BILL", posted["sms"]["senderId"])
        self.assertEqual(
            "Thank you, Ada! We received your payment of P150.00. "
            "You have a remaining balance of P150.00.",
            self.sms_messages[0]["message_text"],
        )

    def test_promotions_are_automatic_per_invoice_and_forwarded_to_billing(self):
        quote = self.add_promo_quote()
        self.claim()
        posted = collector.create_collection(
            collector.CollectionPayload(
                customerId=self.customer["id"],
                amount=130,
                receivedAmount=130,
                allocations=[
                    collector.CollectionAllocationPayload(
                        invoiceId="invoice-1",
                        amount=80,
                        promotionIds=quote["promotionIds"],
                        promotionQuoteDate=quote["paymentDate"],
                        promotionQuoteFingerprint=quote["quoteFingerprint"],
                    ),
                    collector.CollectionAllocationPayload(invoiceId="invoice-2", amount=50),
                ],
                method="CASH",
                paymentDate=quote["paymentDate"],
                smsDestination=self.customer["contactNumber"],
            ),
            idempotency_key="collector:automatic-promo",
            actor=self.collector_actor,
        )

        billing_payload = self.billing_postings[0]["payload"]
        self.assertEqual(["promo-automatic"], billing_payload["allocations"][0]["promotionIds"])
        self.assertEqual(quote["quoteFingerprint"], billing_payload["allocations"][0]["promotionQuoteFingerprint"])
        self.assertEqual(20.0, posted["promotionDiscountAmount"])
        self.assertEqual(300.0, posted["balanceBefore"])
        self.assertEqual(150.0, posted["balanceAfter"])
        self.assertEqual(0.0, posted["allocations"][0]["balanceAfter"])
        self.assertEqual("Automatic Loyalty Discount", posted["allocations"][0]["promotions"][0]["promotionName"])
        self.assertEqual(
            "Thank you, Ada! We received your payment of P130.00. "
            "You have a remaining balance of P150.00.",
            self.sms_messages[0]["message_text"],
        )

    def test_partial_payment_does_not_grant_full_payoff_promotion(self):
        quote = self.add_promo_quote()
        self.claim()
        posted = collector.create_collection(
            collector.CollectionPayload(
                customerId=self.customer["id"],
                amount=50,
                allocations=[
                    collector.CollectionAllocationPayload(invoiceId="invoice-1", amount=50)
                ],
                method="CASH",
                paymentDate=quote["paymentDate"],
            ),
            idempotency_key="collector:promo-partial",
            actor=self.collector_actor,
        )

        self.assertEqual([], self.billing_postings[0]["payload"]["allocations"][0]["promotionIds"])
        self.assertEqual(0.0, posted["promotionDiscountAmount"])
        self.assertEqual(50.0, self.invoice_rows[0]["balance"])

    def test_stale_or_manipulated_promotion_allocation_is_rejected(self):
        quote = self.add_promo_quote()
        self.claim()

        with self.assertRaises(HTTPException) as raised:
            collector.create_collection(
                collector.CollectionPayload(
                    customerId=self.customer["id"],
                    amount=80,
                    allocations=[
                        collector.CollectionAllocationPayload(
                            invoiceId="invoice-1",
                            amount=80,
                            promotionIds=quote["promotionIds"],
                            promotionQuoteDate=quote["paymentDate"],
                            promotionQuoteFingerprint="stale-fingerprint",
                        )
                    ],
                    method="CASH",
                    paymentDate=quote["paymentDate"],
                ),
                idempotency_key="collector:stale-promo",
                actor=self.collector_actor,
            )

        self.assertEqual(409, raised.exception.status_code)
        self.assertEqual([], self.billing_postings)

    def test_client_cannot_bypass_oldest_first_allocation(self):
        self.claim()
        with self.assertRaises(HTTPException) as raised:
            collector.create_collection(
                collector.CollectionPayload(
                    customerId=self.customer["id"],
                    amount=75,
                    allocations=[collector.CollectionAllocationPayload(invoiceId="invoice-2", amount=75)],
                    allocationMode="SELECTED",
                    method="CASH",
                    tenderedAmount=75,
                ),
                idempotency_key="collector:selected-partial",
                actor=self.collector_actor,
            )

        self.assertEqual(100.0, self.invoice_rows[0]["balance"])
        self.assertEqual(200.0, self.invoice_rows[1]["balance"])
        self.assertEqual(409, raised.exception.status_code)
        self.assertIn("automatic promotions", raised.exception.detail)

    def test_payment_can_clear_invoices_and_store_advance_credit(self):
        self.claim()
        posted = collector.create_collection(
            collector.CollectionPayload(
                customerId=self.customer["id"],
                amount=400,
                allocations=[
                    collector.CollectionAllocationPayload(invoiceId="invoice-1", amount=100),
                    collector.CollectionAllocationPayload(invoiceId="invoice-2", amount=200),
                ],
                advanceAmount=100,
                allocationMode="ADVANCE",
                method="CASH",
                tenderedAmount=400,
                smsDestination=self.customer["contactNumber"],
            ),
            idempotency_key="collector:advance-credit",
            actor=self.collector_actor,
        )

        self.assertEqual(300.0, posted["appliedAmount"])
        self.assertEqual(100.0, posted["advanceAmount"])
        self.assertEqual(100.0, posted["accountCreditAfter"])
        self.assertEqual(0.0, posted["balanceAfter"])
        self.assertEqual(
            "Thank you, Ada! We received your payment of P400.00. "
            "Your account is now fully paid.",
            self.sms_messages[0]["message_text"],
        )
        self.assertNotIn("advance credit", self.sms_messages[0]["message_text"].lower())

    def test_promoted_payoff_can_store_customer_excess_as_advance(self):
        quote = self.add_promo_quote()
        self.claim()
        posted = collector.create_collection(
            collector.CollectionPayload(
                customerId=self.customer["id"],
                amount=330,
                receivedAmount=330,
                allocations=[
                    collector.CollectionAllocationPayload(
                        invoiceId="invoice-1",
                        amount=80,
                        promotionIds=quote["promotionIds"],
                        promotionQuoteDate=quote["paymentDate"],
                        promotionQuoteFingerprint=quote["quoteFingerprint"],
                    ),
                    collector.CollectionAllocationPayload(invoiceId="invoice-2", amount=200),
                ],
                advanceAmount=50,
                allocationMode="ADVANCE",
                method="CASH",
                paymentDate=quote["paymentDate"],
                smsDestination=self.customer["contactNumber"],
            ),
            idempotency_key="collector:promo-advance",
            actor=self.collector_actor,
        )

        self.assertEqual(20.0, posted["promotionDiscountAmount"])
        self.assertEqual(280.0, posted["appliedAmount"])
        self.assertEqual(50.0, posted["advanceAmount"])
        self.assertEqual(50.0, posted["accountCreditAfter"])
        self.assertEqual(0.0, posted["balanceAfter"])
        self.assertEqual(
            "Thank you, Ada! We received your payment of P330.00. "
            "Your account is now fully paid.",
            self.sms_messages[0]["message_text"],
        )

    def test_excess_cash_can_be_returned_without_increasing_custody(self):
        self.claim()
        posted = collector.create_collection(
            collector.CollectionPayload(
                customerId=self.customer["id"],
                amount=300,
                receivedAmount=500,
                returnedAmount=200,
                allocations=[
                    collector.CollectionAllocationPayload(invoiceId="invoice-1", amount=100),
                    collector.CollectionAllocationPayload(invoiceId="invoice-2", amount=200),
                ],
                allocationMode="OLDEST",
                method="CASH",
                smsDestination=self.customer["contactNumber"],
            ),
            idempotency_key="collector:return-change",
            actor=self.collector_actor,
        )

        self.assertEqual(300.0, posted["amount"])
        self.assertEqual(500.0, posted["receivedAmount"])
        self.assertEqual(200.0, posted["returnedAmount"])
        self.assertEqual(200.0, posted["changeAmount"])
        self.assertEqual(300.0, collector.collection_totals(collector.collections)["cash"])
        self.assertEqual(
            "Thank you, Ada! We received your payment of P300.00. "
            "Your account is now fully paid.",
            self.sms_messages[0]["message_text"],
        )

    def test_receipt_can_be_reprinted_without_another_payment_or_sms(self):
        self.claim()
        posted = self.post_cash()

        original = collector.record_print_event(
            posted["id"],
            collector.PrintEventPayload(reason="Customer copy"),
            actor=self.collector_actor,
        )
        reprint = collector.record_print_event(
            posted["id"],
            collector.PrintEventPayload(reason="Printer paper jam"),
            actor=self.collector_actor,
        )

        self.assertEqual("ORIGINAL", original["printEvent"]["label"])
        self.assertEqual("REPRINT", reprint["printEvent"]["label"])
        self.assertEqual(2, reprint["printEvent"]["copyNumber"])
        self.assertEqual(posted["receiptNumber"], reprint["collection"]["receiptNumber"])
        self.assertEqual(1, len(self.billing_postings))
        self.assertEqual(1, len(self.sms_messages))

    def test_gcash_reference_is_required_and_cannot_be_reused(self):
        self.claim()
        with self.assertRaises(HTTPException) as missing_reference:
            collector.create_collection(
                collector.CollectionPayload(
                    customerId=self.customer["id"],
                    amount=50,
                    allocations=[collector.CollectionAllocationPayload(invoiceId="invoice-1", amount=50)],
                    method="GCASH",
                ),
                idempotency_key="collector:gcash-missing",
                actor=self.collector_actor,
            )
        self.assertEqual(400, missing_reference.exception.status_code)

        posted = collector.create_collection(
            collector.CollectionPayload(
                customerId=self.customer["id"],
                amount=50,
                allocations=[collector.CollectionAllocationPayload(invoiceId="invoice-1", amount=50)],
                method="GCASH",
                referenceNumber="GCASH-ABC-123",
            ),
            idempotency_key="collector:gcash-one",
            actor=self.collector_actor,
        )
        self.assertEqual("GCASH", posted["method"])

        with self.assertRaises(HTTPException) as duplicate_reference:
            collector.create_collection(
                collector.CollectionPayload(
                    customerId=self.customer["id"],
                    amount=25,
                    allocations=[collector.CollectionAllocationPayload(invoiceId="invoice-1", amount=25)],
                    method="GCASH",
                    referenceNumber="gcash-abc-123",
                ),
                idempotency_key="collector:gcash-two",
                actor=self.collector_actor,
            )
        self.assertEqual(409, duplicate_reference.exception.status_code)

    def test_finance_confirmation_settles_collector_custody(self):
        self.claim()
        posted = self.post_cash()
        submitted = collector.submit_remittance(
            collector.RemittancePayload(declaredCash=150),
            actor=self.collector_actor,
        )
        closed = collector.confirm_remittance(
            submitted["id"],
            collector.RemittanceConfirmationPayload(
                countedCash=150,
                confirmedGcashAmount=0,
            ),
            actor=self.finance_actor,
        )

        self.assertEqual("CLOSED", closed["status"])
        self.assertEqual("SETTLED", collector.find_record(collector.collections, posted["id"], "Collection")["custodyStatus"])
        self.assertEqual(0, collector.finance_overview(actor=self.finance_actor)["metrics"]["pendingBatches"])

    def test_cash_and_gcash_variances_do_not_cancel_each_other(self):
        self.claim()
        self.post_cash()
        self.claim()
        collector.create_collection(
            collector.CollectionPayload(
                customerId=self.customer["id"],
                amount=50,
                allocations=[collector.CollectionAllocationPayload(invoiceId="invoice-2", amount=50)],
                method="GCASH",
                referenceNumber="GCASH-VARIANCE-1",
            ),
            idempotency_key="collector:variance-gcash",
            actor=self.collector_actor,
        )
        submitted = collector.submit_remittance(
            collector.RemittancePayload(
                declaredCash=150,
                gcashTransferredAmount=50,
                gcashTransferReference="TRANSFER-1",
            ),
            actor=self.collector_actor,
        )
        reviewed = collector.confirm_remittance(
            submitted["id"],
            collector.RemittanceConfirmationPayload(
                countedCash=160,
                confirmedGcashAmount=40,
                companyGcashReference="COMPANY-1",
                acceptVariance=False,
            ),
            actor=self.finance_actor,
        )

        self.assertEqual("VARIANCE", reviewed["status"])
        self.assertEqual("UNDER_REVIEW", collector.collections[0]["custodyStatus"])


if __name__ == "__main__":
    unittest.main()
