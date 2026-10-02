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
                invoice["status"] = "PAID" if invoice["balance"] <= 0 else "PARTIALLY_PAID"
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

    def test_payment_attempt_lookup_recovers_receipt_and_hides_other_collectors(self):
        key = "collector:uncertain-mobile-post"
        self.assertEqual(
            {"status": "UNCONFIRMED"},
            collector.collection_posting_status(key, actor=self.collector_actor),
        )
        self.claim()
        posted = self.post_cash(key=key)

        recovered = collector.collection_posting_status(key, actor=self.collector_actor)
        self.assertEqual("POSTED", recovered["status"])
        self.assertEqual(posted["id"], recovered["collection"]["id"])
        self.assertEqual(posted["receiptNumber"], recovered["collection"]["receiptNumber"])
        self.assertEqual(
            {"status": "UNCONFIRMED"},
            collector.collection_posting_status(key, actor=self.other_collector),
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

    def test_collector_can_send_server_calculated_unavailable_customer_message(self):
        self.add_promo_quote()

        sent = collector.send_customer_unavailable_message(
            self.customer["id"],
            actor=self.collector_actor,
        )

        self.assertEqual("SUCCESS", sent["status"])
        self.assertEqual("3J BILL", sent["senderId"])
        self.assertEqual("*******4567", sent["destination"])
        self.assertEqual(280.0, sent["amountDue"])
        self.assertEqual(1, len(self.sms_messages))
        message = self.sms_messages[0]
        self.assertEqual(self.customer["contactNumber"], message["destination"])
        self.assertEqual("3J BILL", message["source"])
        self.assertEqual("COLLECTOR_CUSTOMER_UNAVAILABLE", message["purpose"])
        self.assertEqual(
            "Hello, Ada. Our 3J collector visited today, but no one was available. "
            "Your current amount due is P280.00. Please contact 3J to arrange payment. Thank you.",
            message["message_text"],
        )
        self.assertEqual("CUSTOMER_UNAVAILABLE", message["request_context"]["visitOutcome"])
        self.assertEqual(280.0, message["request_context"]["amountDue"])
        self.assertEqual("collector-one", message["request_context"]["collectorUsername"])
        self.assertTrue(message["request_context"]["messageRequestId"])
        audit = next(
            event
            for event in self.audit_events
            if event["action"] == "collector_customer_unavailable_sms_sent"
        )
        self.assertEqual(self.customer["id"], audit["targetId"])
        self.assertEqual("*******4567", audit["details"]["destination"])

    def test_unavailable_customer_message_requires_collector_permission_and_saved_mobile(self):
        with self.assertRaises(HTTPException) as forbidden:
            collector.send_customer_unavailable_message(
                self.customer["id"],
                actor=self.finance_actor,
            )
        self.assertEqual(403, forbidden.exception.status_code)

        self.customer["contactNumber"] = ""
        self.customer["alternateMobileNumber"] = ""
        with self.assertRaises(HTTPException) as missing_mobile:
            collector.send_customer_unavailable_message(
                self.customer["id"],
                actor=self.collector_actor,
            )
        self.assertEqual(400, missing_mobile.exception.status_code)
        self.assertEqual([], self.sms_messages)

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
            ["2026-05-01", "2026-06-01"],
            [row["billingCycleStart"] for row in posted["outstandingInvoicesBefore"]],
        )
        self.assertEqual(
            [100.0, 200.0],
            [row["amountDue"] for row in posted["outstandingInvoicesBefore"]],
        )
        self.assertEqual(1, len(posted["outstandingInvoicesAfter"]))
        self.assertEqual("2026-06-01", posted["outstandingInvoicesAfter"][0]["billingCycleStart"])
        self.assertEqual(150.0, posted["outstandingInvoicesAfter"][0]["balance"])
        self.assertEqual("PAID", posted["allocations"][0]["statusAfter"])
        self.assertEqual("PARTIALLY_PAID", posted["allocations"][1]["statusAfter"])
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
        self.assertEqual(80.0, posted["outstandingInvoicesBefore"][0]["amountDue"])
        self.assertEqual(20.0, posted["outstandingInvoicesBefore"][0]["promotionDiscountAmount"])
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

    def test_gcash_reference_is_optional_but_company_transfer_reference_is_required(self):
        self.claim()
        first = collector.create_collection(
            collector.CollectionPayload(
                customerId=self.customer["id"],
                amount=50,
                allocations=[collector.CollectionAllocationPayload(invoiceId="invoice-1", amount=50)],
                method="GCASH",
            ),
            idempotency_key="collector:gcash-no-reference-one",
            actor=self.collector_actor,
        )
        self.claim()
        second = collector.create_collection(
            collector.CollectionPayload(
                customerId=self.customer["id"],
                amount=25,
                allocations=[collector.CollectionAllocationPayload(invoiceId="invoice-1", amount=25)],
                method="GCASH",
                referenceNumber="   ",
            ),
            idempotency_key="collector:gcash-no-reference-two",
            actor=self.collector_actor,
        )
        self.assertEqual("", first["referenceNumber"])
        self.assertEqual("", second["referenceNumber"])
        self.assertEqual(2, len(self.billing_postings))
        self.assertEqual("", self.billing_postings[0]["payload"]["referenceNumber"])

        with self.assertRaises(HTTPException) as missing_transfer_reference:
            collector.submit_remittance(
                collector.RemittancePayload(gcashTransferredAmount=75),
                actor=self.collector_actor,
            )
        self.assertEqual(400, missing_transfer_reference.exception.status_code)

        submitted = collector.submit_remittance(
            collector.RemittancePayload(
                gcashTransferredAmount=75,
                gcashTransferReference="TRANSFER-OPTIONAL-CUSTOMER-REF",
            ),
            actor=self.collector_actor,
        )
        self.assertEqual(2, submitted["collectionCount"])
        self.assertEqual(75, submitted["expectedGcash"])

    def test_provided_gcash_reference_cannot_be_reused(self):
        self.claim()

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
        finance_batch = collector.finance_overview(actor=self.finance_actor)["openRemittances"][0]
        self.assertEqual(1, len(finance_batch["collectionItems"]))
        self.assertEqual("Ada Lovelace", finance_batch["collectionItems"][0]["customerName"])
        self.assertEqual("ACC-0001", finance_batch["collectionItems"][0]["accountNumber"])
        self.assertEqual(posted["receiptNumber"], finance_batch["collectionItems"][0]["receiptNumber"])
        self.assertEqual("CASH", finance_batch["collectionItems"][0]["method"])
        self.assertEqual(150.0, finance_batch["collectionItems"][0]["amount"])
        self.assertEqual(150.0, finance_batch["listedCollectionTotal"])
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

    def test_reviewed_remittance_requires_current_receipts_and_totals(self):
        self.claim()
        posted = self.post_cash()
        checklist = {
            "collectionIds": [posted["id"]],
            "reviewedAllHeld": True,
            "expectedCash": 150,
            "expectedGcash": 0,
            "declaredCash": 150,
            "gcashTransferredAmount": 0,
        }

        with self.assertRaises(HTTPException) as missing_receipt:
            collector.submit_remittance(
                collector.RemittancePayload(**{**checklist, "collectionIds": []}),
                actor=self.collector_actor,
            )
        self.assertEqual(409, missing_receipt.exception.status_code)

        with self.assertRaises(HTTPException) as changed_total:
            collector.submit_remittance(
                collector.RemittancePayload(**{**checklist, "expectedCash": 149}),
                actor=self.collector_actor,
            )
        self.assertEqual(409, changed_total.exception.status_code)
        self.assertEqual("HELD", collector.collections[0]["custodyStatus"])

        new_receipt = {**collector.collections[0], "id": "new-held-receipt"}
        collector.collections.append(new_receipt)
        with self.assertRaises(HTTPException) as new_held_receipt:
            collector.submit_remittance(collector.RemittancePayload(**checklist), actor=self.collector_actor)
        self.assertEqual(409, new_held_receipt.exception.status_code)
        collector.collections.remove(new_receipt)

        submitted = collector.submit_remittance(collector.RemittancePayload(**checklist), actor=self.collector_actor)
        self.assertEqual([posted["id"]], submitted["collectionIds"])
        self.assertEqual("SUBMITTED", collector.collections[0]["custodyStatus"])

    def test_reviewed_remittance_requires_variance_explanation(self):
        self.claim()
        posted = self.post_cash()
        checklist = {
            "collectionIds": [posted["id"]],
            "reviewedAllHeld": True,
            "expectedCash": 150,
            "expectedGcash": 0,
            "declaredCash": 140,
            "gcashTransferredAmount": 0,
        }

        with self.assertRaises(HTTPException) as missing_note:
            collector.submit_remittance(collector.RemittancePayload(**checklist), actor=self.collector_actor)
        self.assertEqual(400, missing_note.exception.status_code)
        self.assertEqual("HELD", collector.collections[0]["custodyStatus"])

        submitted = collector.submit_remittance(
            collector.RemittancePayload(**{**checklist, "notes": "Cash count is short by PHP 10"}),
            actor=self.collector_actor,
        )
        self.assertEqual(140, submitted["declaredCash"])
        self.assertEqual("Cash count is short by PHP 10", submitted["notes"])

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

    def test_finance_cannot_confirm_remittance_with_missing_collection_details(self):
        self.claim()
        self.post_cash()
        submitted = collector.submit_remittance(
            collector.RemittancePayload(declaredCash=150),
            actor=self.collector_actor,
        )
        collector.collections.clear()

        with self.assertRaises(HTTPException) as raised:
            collector.confirm_remittance(
                submitted["id"],
                collector.RemittanceConfirmationPayload(
                    countedCash=150,
                    confirmedGcashAmount=0,
                ),
                actor=self.finance_actor,
            )

        self.assertEqual(409, raised.exception.status_code)
        self.assertEqual(
            "Linked customer payments do not match the remittance summary",
            raised.exception.detail,
        )

    def test_voided_billing_payment_blocks_remittance_and_finance_confirmation(self):
        self.claim()
        posted = self.post_cash()
        collector._billing_payment_status_provider = lambda payment_id: "VOID"
        with self.assertRaises(HTTPException) as submission:
            collector.submit_remittance(
                collector.RemittancePayload(declaredCash=150),
                actor=self.collector_actor,
            )
        self.assertEqual(409, submission.exception.status_code)
        self.assertEqual("HELD", collector.collections[0]["custodyStatus"])

        collector._billing_payment_status_provider = lambda payment_id: "POSTED"
        submitted = collector.submit_remittance(
            collector.RemittancePayload(declaredCash=150),
            actor=self.collector_actor,
        )
        collector._billing_payment_status_provider = lambda payment_id: "VOID"
        with self.assertRaises(HTTPException) as confirmation:
            collector.confirm_remittance(
                submitted["id"],
                collector.RemittanceConfirmationPayload(countedCash=150, confirmedGcashAmount=0),
                actor=self.finance_actor,
            )
        self.assertEqual(409, confirmation.exception.status_code)
        self.assertEqual("SUBMITTED", collector.find_record(collector.collections, posted["id"], "Collection")["custodyStatus"])

    def test_held_reversal_stays_in_finance_review_until_disposition_is_recorded(self):
        self.claim()
        posted = self.post_cash()
        collector.synchronize_billing_payment_void(
            payment_id=posted["billingPaymentId"],
            voided_at=collector.now_iso(),
            voided_by="finance-admin",
            reason="Duplicate receipt",
        )
        overview = collector.finance_overview(actor=self.finance_actor)
        self.assertEqual(1, overview["metrics"]["pendingReversals"])
        self.assertEqual(150, overview["metrics"]["pendingReversalAmount"])
        self.assertEqual(posted["id"], overview["pendingReversals"][0]["id"])

        with self.assertRaises(HTTPException) as printing:
            collector.record_print_event(
                posted["id"], collector.PrintEventPayload(), actor=self.finance_actor
            )
        self.assertEqual(409, printing.exception.status_code)

        resolved = collector.resolve_reversed_collection(
            posted["id"],
            collector.ReversalReviewPayload(
                disposition="DUPLICATE_ENTRY_NO_FUNDS",
                note="Duplicate posting; no second payment was collected",
            ),
            actor=self.finance_actor,
        )
        self.assertEqual("RESOLVED", resolved["reversalReviewStatus"])
        self.assertEqual(0, collector.finance_overview(actor=self.finance_actor)["metrics"]["pendingReversals"])
        with self.assertRaises(HTTPException) as changed_disposition:
            collector.resolve_reversed_collection(
                posted["id"],
                collector.ReversalReviewPayload(
                    disposition="OTHER_ACCOUNTED",
                    note="Different explanation",
                ),
                actor=self.finance_actor,
            )
        self.assertEqual(409, changed_disposition.exception.status_code)


if __name__ == "__main__":
    unittest.main()
