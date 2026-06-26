from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field


router = APIRouter(prefix="/api/billing", tags=["billing"])

subscriptions: list[dict[str, Any]] = []
invoices: list[dict[str, Any]] = []
payments: list[dict[str, Any]] = []
adjustments: list[dict[str, Any]] = []

_current_admin: Callable[[str | None], dict[str, Any]] | None = None
_audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None] | None = None
_customer_resolver: Callable[[str], dict[str, Any]] | None = None
_customer_searcher: Callable[[str], list[dict[str, Any]]] | None = None
_customer_seed: Callable[[], None] | None = None

BILLING_MODES = ["PREPAID", "POSTPAID"]
PRICING_SOURCES = ["MANUAL", "SERVICE_CATALOG", "PRICE_OVERRIDE"]
SUBSCRIPTION_STATUSES = ["ACTIVE", "PAUSED", "CANCELLED", "PENDING"]
INVOICE_STATUSES = ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID"]
PAYMENT_STATUSES = ["POSTED", "VOID"]
PAYMENT_METHODS = ["CASH", "GCASH", "BANK_TRANSFER", "CARD", "CHECK", "OTHER"]
ADJUSTMENT_TYPES = ["CREDIT", "DEBIT"]
ADJUSTMENT_STATUSES = ["POSTED", "VOID"]


class SubscriptionPayload(BaseModel):
    customerId: str | None = None
    serviceAccountId: str | None = None
    serviceAccountNumber: str | None = None
    serviceOrderId: str | None = None
    catalogId: str | None = None
    catalogCode: str | None = None
    catalogName: str | None = None
    planName: str | None = None
    serviceId: str | None = None
    listMonthlyRate: float | None = Field(default=None, ge=0)
    monthlyRate: float | None = Field(default=None, ge=0)
    priceOverrideAmount: float | None = Field(default=None, ge=0)
    priceOverrideReason: str | None = None
    pricingSource: str | None = None
    billingMode: str | None = None
    billingDay: int | None = Field(default=None, ge=1, le=28)
    startDate: str | None = None
    nextInvoiceDate: str | None = None
    dueDays: int | None = Field(default=None, ge=0, le=60)
    status: str | None = None
    notes: str | None = None


class InvoicePayload(BaseModel):
    customerId: str | None = None
    subscriptionId: str | None = None
    billingCycleStart: str | None = None
    billingCycleEnd: str | None = None
    issueDate: str | None = None
    dueDate: str | None = None
    status: str | None = None
    lineItems: list[dict[str, Any]] | None = None
    notes: str | None = None


class PaymentPayload(BaseModel):
    invoiceId: str | None = None
    customerId: str | None = None
    amount: float | None = Field(default=None, gt=0)
    method: str | None = None
    paymentDate: str | None = None
    referenceNumber: str | None = None
    collectionChannel: str | None = None
    status: str | None = None
    notes: str | None = None


class AdjustmentPayload(BaseModel):
    invoiceId: str | None = None
    customerId: str | None = None
    type: str | None = None
    amount: float | None = Field(default=None, gt=0)
    reason: str | None = None
    status: str | None = None
    notes: str | None = None


def configure_billing(
    current_admin: Callable[[str | None], dict[str, Any]],
    audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None],
    customer_resolver: Callable[[str], dict[str, Any]] | None = None,
    customer_searcher: Callable[[str], list[dict[str, Any]]] | None = None,
    customer_seed: Callable[[], None] | None = None,
) -> None:
    global _current_admin, _audit_logger, _customer_resolver, _customer_searcher, _customer_seed
    _current_admin = current_admin
    _audit_logger = audit_logger
    _customer_resolver = customer_resolver
    _customer_searcher = customer_searcher
    _customer_seed = customer_seed


def require_admin(authorization: str | None = Header(default=None)):
    if _current_admin is None:
        raise HTTPException(status_code=500, detail="Billing module is not configured")
    return _current_admin(authorization)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_iso() -> str:
    return date.today().isoformat()


def add_audit(action: str, target_type: str, target_id: str, details: dict[str, Any] | None, actor: str) -> None:
    if _audit_logger is not None:
        _audit_logger(action, target_type, target_id, details, actor)


def normalize_upper(value: Any) -> str:
    return str(value or "").strip().upper()


def admin_display_name(admin: dict[str, Any]) -> str:
    display_name = str(
        admin.get("fullName")
        or admin.get("full_name")
        or admin.get("name")
        or admin.get("username")
        or "Billing user"
    ).strip()
    return display_name or "Billing user"


def money(value: Any) -> float:
    return round(float(value or 0), 2)


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def parse_day(value: str | None, field_name: str) -> date:
    try:
        return date.fromisoformat(value or today_iso())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{field_name} must be YYYY-MM-DD") from exc


def add_months(source: date, months: int = 1) -> date:
    month = source.month - 1 + months
    year = source.year + month // 12
    month = month % 12 + 1
    month_lengths = [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    return date(year, month, min(source.day, month_lengths[month - 1]))


def customer_name(customer: dict[str, Any]) -> str:
    parts = [customer.get("firstName"), customer.get("middleName"), customer.get("lastName")]
    return " ".join(str(part).strip() for part in parts if str(part or "").strip()) or customer.get("name") or "Unnamed customer"


def customer_snapshot(customer: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": customer["id"],
        "accountNumber": customer.get("accountNumber", ""),
        "name": customer_name(customer),
        "status": customer.get("status", ""),
        "gender": customer.get("gender", ""),
        "contactNumber": customer.get("contactNumber", ""),
        "address": ", ".join(
            part
            for part in [
                customer.get("addressLine1"),
                customer.get("barangay"),
                customer.get("city"),
                customer.get("province"),
            ]
            if part
        ),
    }


def seed_customers() -> None:
    if _customer_seed is not None:
        _customer_seed()


def resolve_customer(customer_id: str) -> dict[str, Any]:
    seed_customers()
    if not customer_id:
        raise HTTPException(status_code=400, detail="customerId is required")
    if _customer_resolver is None:
        raise HTTPException(status_code=400, detail="Customer Profiling provider is not available")
    return customer_snapshot(_customer_resolver(customer_id))


def search_customers(search: str = "") -> list[dict[str, Any]]:
    seed_customers()
    if _customer_searcher is None:
        return []
    return [customer_snapshot(customer) for customer in _customer_searcher(search)]


def visible_subscriptions() -> list[dict[str, Any]]:
    return [subscription for subscription in subscriptions if not subscription.get("deletedAt")]


def visible_invoices() -> list[dict[str, Any]]:
    return [invoice for invoice in invoices if not invoice.get("deletedAt")]


def visible_payments() -> list[dict[str, Any]]:
    return [payment for payment in payments if not payment.get("deletedAt")]


def visible_adjustments() -> list[dict[str, Any]]:
    return [adjustment for adjustment in adjustments if not adjustment.get("deletedAt")]


def find_row(rows: list[dict[str, Any]], row_id: str, label: str) -> dict[str, Any]:
    for row in rows:
        if row["id"] == row_id and not row.get("deletedAt"):
            return row
    raise HTTPException(status_code=404, detail=f"{label} not found")


def find_subscription(subscription_id: str) -> dict[str, Any]:
    return find_row(subscriptions, subscription_id, "Subscription")


def find_invoice(invoice_id: str) -> dict[str, Any]:
    return find_row(invoices, invoice_id, "Invoice")


def find_payment(payment_id: str) -> dict[str, Any]:
    return find_row(payments, payment_id, "Payment")


def find_adjustment(adjustment_id: str) -> dict[str, Any]:
    return find_row(adjustments, adjustment_id, "Adjustment")


def next_number(prefix: str, rows: list[dict[str, Any]], field_name: str) -> str:
    return f"{prefix}-{datetime.now(timezone.utc).strftime('%Y%m')}-{len(rows) + 1:04d}"


def normalize_subscription_payload(payload: SubscriptionPayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    record = dict(current or {})
    clearable_fields = {"priceOverrideAmount", "priceOverrideReason", "pricingSource", "serviceOrderId"}
    record.update({key: value for key, value in data.items() if value is not None or key in clearable_fields})
    required = ["customerId", "planName", "billingMode", "startDate"]
    missing = [field for field in required if record.get(field) in [None, ""]]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required subscription fields: {', '.join(missing)}")
    record["billingMode"] = normalize_upper(record.get("billingMode"))
    record["status"] = normalize_upper(record.get("status") or "ACTIVE")
    if record["billingMode"] not in BILLING_MODES:
        raise HTTPException(status_code=400, detail="Invalid billing mode")
    if record["status"] not in SUBSCRIPTION_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid subscription status")
    record["serviceAccountId"] = clean_text(record.get("serviceAccountId"))
    record["serviceAccountNumber"] = clean_text(record.get("serviceAccountNumber"))
    record["serviceOrderId"] = clean_text(record.get("serviceOrderId"))
    record["catalogId"] = clean_text(record.get("catalogId"))
    record["catalogCode"] = clean_text(record.get("catalogCode"))
    record["catalogName"] = clean_text(record.get("catalogName"))
    record["serviceId"] = clean_text(record.get("serviceId"))
    record["notes"] = clean_text(record.get("notes"))
    record["planName"] = clean_text(record.get("catalogName") or record.get("planName"))
    if record.get("monthlyRate") in [None, ""] and record.get("listMonthlyRate") in [None, ""]:
        raise HTTPException(status_code=400, detail="monthlyRate or listMonthlyRate is required")
    record["listMonthlyRate"] = money(record.get("listMonthlyRate") if record.get("listMonthlyRate") is not None else record.get("monthlyRate"))
    override_amount = record.get("priceOverrideAmount")
    override_reason = clean_text(record.get("priceOverrideReason"))
    linked_to_service = bool(record["serviceAccountId"])
    if linked_to_service:
        if not record["catalogId"]:
            raise HTTPException(status_code=400, detail="catalogId is required for Service Account billing")
        if not record["serviceId"]:
            raise HTTPException(status_code=400, detail="serviceId is required for Service Account billing")
        has_override = override_amount is not None and money(override_amount) != record["listMonthlyRate"]
        if has_override:
            if not override_reason:
                raise HTTPException(status_code=400, detail="priceOverrideReason is required when overriding catalog price")
            record["priceOverrideAmount"] = money(override_amount)
            record["monthlyRate"] = record["priceOverrideAmount"]
            record["pricingSource"] = "PRICE_OVERRIDE"
        else:
            record["priceOverrideAmount"] = None
            record["priceOverrideReason"] = ""
            record["monthlyRate"] = record["listMonthlyRate"]
            record["pricingSource"] = "SERVICE_CATALOG"
    else:
        record["monthlyRate"] = money(record["monthlyRate"])
        record["listMonthlyRate"] = record["monthlyRate"]
        record["priceOverrideAmount"] = None
        record["priceOverrideReason"] = ""
        record["pricingSource"] = "MANUAL"
    if record["pricingSource"] not in PRICING_SOURCES:
        raise HTTPException(status_code=400, detail="Invalid pricing source")
    record["priceOverrideReason"] = override_reason if record["pricingSource"] == "PRICE_OVERRIDE" else ""
    record["billingDay"] = int(record.get("billingDay") or min(parse_day(record["startDate"], "startDate").day, 28))
    record["dueDays"] = int(record.get("dueDays") if record.get("dueDays") is not None else (0 if record["billingMode"] == "PREPAID" else 7))
    record["startDate"] = parse_day(record.get("startDate"), "startDate").isoformat()
    record["nextInvoiceDate"] = parse_day(record.get("nextInvoiceDate") or record["startDate"], "nextInvoiceDate").isoformat()
    return record


def ensure_service_target_available(record: dict[str, Any], current_subscription_id: str | None = None) -> None:
    service_account_id = record.get("serviceAccountId", "")
    service_order_id = record.get("serviceOrderId", "")
    if not service_account_id and not service_order_id:
        return
    for subscription in visible_subscriptions():
        if subscription["id"] == current_subscription_id:
            continue
        if subscription.get("status") == "CANCELLED":
            continue
        if service_account_id and subscription.get("serviceAccountId") == service_account_id:
            raise HTTPException(status_code=409, detail="Service Account is already linked to an active Billing subscription")
        if service_order_id and subscription.get("serviceOrderId") == service_order_id:
            raise HTTPException(status_code=409, detail="Service Order is already linked to an active Billing subscription")


def line_amount(item: dict[str, Any]) -> float:
    quantity = money(item.get("quantity", 1) or 1)
    unit_price = money(item.get("unitPrice", item.get("amount", 0)))
    return money(quantity * unit_price)


def normalize_line_items(items: list[dict[str, Any]] | None, subscription: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    if not items and subscription is not None:
        service_ref = subscription.get("serviceId")
        description = f"{subscription['planName']} monthly internet service"
        if service_ref:
            description = f"{description} ({service_ref})"
        items = [
            {
                "description": description,
                "quantity": 1,
                "unitPrice": subscription["monthlyRate"],
                "serviceAccountId": subscription.get("serviceAccountId", ""),
                "serviceOrderId": subscription.get("serviceOrderId", ""),
                "serviceId": service_ref or "",
                "catalogId": subscription.get("catalogId", ""),
                "catalogCode": subscription.get("catalogCode", ""),
                "catalogName": subscription.get("catalogName", ""),
                "listMonthlyRate": subscription.get("listMonthlyRate", subscription["monthlyRate"]),
                "pricingSource": subscription.get("pricingSource", "MANUAL"),
                "priceOverrideAmount": subscription.get("priceOverrideAmount"),
                "priceOverrideReason": subscription.get("priceOverrideReason", ""),
            }
        ]
    normalized = []
    for item in items or []:
        description = str(item.get("description") or "Billing item").strip()
        quantity = money(item.get("quantity", 1) or 1)
        unit_price = money(item.get("unitPrice", item.get("amount", 0)))
        normalized.append(
            {
                "description": description,
                "quantity": quantity,
                "unitPrice": unit_price,
                "amount": money(quantity * unit_price),
                "serviceAccountId": item.get("serviceAccountId") or (subscription.get("serviceAccountId", "") if subscription else ""),
                "serviceOrderId": item.get("serviceOrderId") or (subscription.get("serviceOrderId", "") if subscription else ""),
                "serviceId": item.get("serviceId") or (subscription.get("serviceId", "") if subscription else ""),
                "catalogId": item.get("catalogId") or (subscription.get("catalogId", "") if subscription else ""),
                "catalogCode": item.get("catalogCode") or (subscription.get("catalogCode", "") if subscription else ""),
                "catalogName": item.get("catalogName") or (subscription.get("catalogName", "") if subscription else ""),
                "listMonthlyRate": money(item.get("listMonthlyRate") or (subscription.get("listMonthlyRate", unit_price) if subscription else unit_price)),
                "pricingSource": item.get("pricingSource") or (subscription.get("pricingSource", "MANUAL") if subscription else "MANUAL"),
                "priceOverrideAmount": item.get("priceOverrideAmount") or (subscription.get("priceOverrideAmount") if subscription else None),
                "priceOverrideReason": item.get("priceOverrideReason") or (subscription.get("priceOverrideReason", "") if subscription else ""),
            }
        )
    if not normalized:
        raise HTTPException(status_code=400, detail="At least one invoice line item is required")
    return normalized


def invoice_adjustments(invoice_id: str) -> list[dict[str, Any]]:
    return [adjustment for adjustment in visible_adjustments() if adjustment.get("invoiceId") == invoice_id and adjustment["status"] == "POSTED"]


def invoice_payments(invoice_id: str) -> list[dict[str, Any]]:
    return [payment for payment in visible_payments() if payment.get("invoiceId") == invoice_id and payment["status"] == "POSTED"]


def invoice_amounts(invoice: dict[str, Any]) -> dict[str, float]:
    subtotal = money(sum(item.get("amount", line_amount(item)) for item in invoice.get("lineItems", [])))
    adjustment_total = money(
        sum(
            adjustment["amount"] if adjustment["type"] == "DEBIT" else -adjustment["amount"]
            for adjustment in invoice_adjustments(invoice["id"])
        )
    )
    total = money(max(0, subtotal + adjustment_total))
    paid = money(sum(payment["amount"] for payment in invoice_payments(invoice["id"])))
    balance = money(max(0, total - paid))
    return {"subtotal": subtotal, "adjustmentsTotal": adjustment_total, "total": total, "paidTotal": paid, "balance": balance}


def derived_invoice_status(invoice: dict[str, Any], amounts: dict[str, float] | None = None) -> str:
    if invoice.get("status") == "VOID":
        return "VOID"
    if invoice.get("status") == "DRAFT":
        return "DRAFT"
    amounts = amounts or invoice_amounts(invoice)
    if amounts["balance"] <= 0 and amounts["total"] > 0:
        return "PAID"
    if amounts["paidTotal"] > 0:
        return "PARTIALLY_PAID"
    due = parse_day(invoice.get("dueDate"), "dueDate")
    if due < date.today():
        return "OVERDUE"
    return "ISSUED"


def validate_invoice_payment(invoice: dict[str, Any], amount: float, current_payment: dict[str, Any] | None = None) -> dict[str, Any]:
    summary = invoice_summary(invoice)
    if summary["status"] in ["VOID", "DRAFT"]:
        raise HTTPException(status_code=400, detail="Invoice is not payable")
    available_balance = summary["balance"]
    if current_payment and current_payment.get("invoiceId") == invoice["id"] and current_payment.get("status") == "POSTED":
        available_balance = money(available_balance + current_payment["amount"])
    if amount > available_balance:
        raise HTTPException(status_code=400, detail="Payment amount cannot exceed invoice balance")
    return summary


def invoice_summary(invoice: dict[str, Any]) -> dict[str, Any]:
    amounts = invoice_amounts(invoice)
    status = derived_invoice_status(invoice, amounts)
    invoice["status"] = status
    return {**invoice, **amounts}


def customer_balance(customer_id: str) -> dict[str, Any]:
    customer = resolve_customer(customer_id)
    customer_invoices = [
        invoice_summary(invoice)
        for invoice in visible_invoices()
        if invoice["customerId"] == customer_id and invoice.get("status") != "VOID"
    ]
    customer_payments = [
        payment for payment in visible_payments() if payment["customerId"] == customer_id and payment["status"] == "POSTED"
    ]
    invoiced_total = money(sum(invoice["total"] for invoice in customer_invoices))
    paid_total = money(sum(payment["amount"] for payment in customer_payments))
    balance = money(invoiced_total - paid_total)
    overdue_total = money(sum(invoice["balance"] for invoice in customer_invoices if invoice["status"] == "OVERDUE"))
    return {
        "customer": customer,
        "invoicedTotal": invoiced_total,
        "paidTotal": paid_total,
        "balance": balance,
        "credit": money(abs(balance)) if balance < 0 else 0,
        "overdueTotal": overdue_total,
        "openInvoices": sum(1 for invoice in customer_invoices if invoice["status"] not in ["PAID", "VOID"]),
    }


def billing_metrics() -> dict[str, float | int]:
    seed_billing_data()
    invoice_rows = [invoice_summary(invoice) for invoice in visible_invoices()]
    posted_payments = [payment for payment in visible_payments() if payment["status"] == "POSTED"]
    current_month = datetime.now(timezone.utc).strftime("%Y-%m")
    return {
        "active_subscriptions": sum(1 for subscription in visible_subscriptions() if subscription["status"] == "ACTIVE"),
        "open_invoices": sum(1 for invoice in invoice_rows if invoice["status"] not in ["PAID", "VOID"]),
        "overdue": sum(1 for invoice in invoice_rows if invoice["status"] == "OVERDUE"),
        "collections": money(sum(payment["amount"] for payment in posted_payments if str(payment["paymentDate"]).startswith(current_month))),
        "monthly_recurring_revenue": money(
            sum(subscription["monthlyRate"] for subscription in visible_subscriptions() if subscription["status"] == "ACTIVE")
        ),
        "outstanding_balance": money(sum(invoice["balance"] for invoice in invoice_rows if invoice["status"] != "VOID")),
    }


def create_invoice_from_subscription(subscription: dict[str, Any], cycle_start: str | None = None) -> dict[str, Any]:
    cycle_start_day = parse_day(cycle_start or subscription.get("nextInvoiceDate") or today_iso(), "billingCycleStart")
    cycle_end_day = add_months(cycle_start_day, 1) - timedelta(days=1)
    issue_day = date.today()
    due_day = cycle_start_day if subscription["billingMode"] == "PREPAID" else cycle_end_day + timedelta(days=subscription["dueDays"])
    timestamp = now_iso()
    invoice = {
        "id": str(uuid4()),
        "invoiceNumber": next_number("INV", invoices, "invoiceNumber"),
        "customerId": subscription["customerId"],
        "customer": subscription["customer"],
        "subscriptionId": subscription["id"],
        "serviceAccountId": subscription.get("serviceAccountId", ""),
        "serviceAccountNumber": subscription.get("serviceAccountNumber", ""),
        "serviceOrderId": subscription.get("serviceOrderId", ""),
        "serviceId": subscription.get("serviceId", ""),
        "catalogId": subscription.get("catalogId", ""),
        "catalogCode": subscription.get("catalogCode", ""),
        "catalogName": subscription.get("catalogName", ""),
        "listMonthlyRate": subscription.get("listMonthlyRate", subscription["monthlyRate"]),
        "pricingSource": subscription.get("pricingSource", "MANUAL"),
        "priceOverrideAmount": subscription.get("priceOverrideAmount"),
        "priceOverrideReason": subscription.get("priceOverrideReason", ""),
        "billingMode": subscription["billingMode"],
        "billingCycleStart": cycle_start_day.isoformat(),
        "billingCycleEnd": cycle_end_day.isoformat(),
        "issueDate": issue_day.isoformat(),
        "dueDate": due_day.isoformat(),
        "status": "ISSUED",
        "lineItems": normalize_line_items(None, subscription),
        "notes": "",
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
    }
    invoices.append(invoice)
    subscription["nextInvoiceDate"] = add_months(cycle_start_day, 1).isoformat()
    subscription["updatedAt"] = timestamp
    return invoice_summary(invoice)


def seed_billing_data() -> None:
    if subscriptions or _customer_searcher is None:
        return
    seed_customers()
    customer_rows = search_customers("")[:2]
    if not customer_rows:
        return
    plans = [
        ("Home Fiber 50 Mbps", "PREPAID", 999),
        ("Business Fiber 100 Mbps", "POSTPAID", 2499),
    ]
    for customer, (plan_name, billing_mode, rate) in zip(customer_rows, plans):
        timestamp = now_iso()
        start = date.today().replace(day=1).isoformat()
        subscription = {
            "id": str(uuid4()),
            "customerId": customer["id"],
            "customer": customer,
            "planName": plan_name,
            "serviceAccountId": "",
            "serviceAccountNumber": "",
            "serviceOrderId": "",
            "catalogId": "",
            "catalogCode": "",
            "catalogName": "",
            "serviceId": f"SVC-{customer.get('accountNumber') or customer['id'][:6]}",
            "listMonthlyRate": money(rate),
            "monthlyRate": money(rate),
            "priceOverrideAmount": None,
            "priceOverrideReason": "",
            "pricingSource": "MANUAL",
            "billingMode": billing_mode,
            "billingDay": 1,
            "startDate": start,
            "nextInvoiceDate": start,
            "dueDays": 0 if billing_mode == "PREPAID" else 7,
            "status": "ACTIVE",
            "notes": "Seed subscription for first working Billing shell.",
            "createdAt": timestamp,
            "updatedAt": timestamp,
            "deletedAt": None,
        }
        subscriptions.append(subscription)
        create_invoice_from_subscription(subscription, start)


def filter_rows(rows: list[dict[str, Any]], search: str = "", status: str = "", customer_id: str = "") -> list[dict[str, Any]]:
    filtered = rows
    if customer_id:
        filtered = [row for row in filtered if row.get("customerId") == customer_id]
    if status:
        filtered = [row for row in filtered if normalize_upper(row.get("status")) == normalize_upper(status)]
    if search:
        needle = search.lower().strip()
        filtered = [
            row
            for row in filtered
            if needle in str(row.get("invoiceNumber", "")).lower()
            or needle in str(row.get("receiptNumber", "")).lower()
            or needle in str(row.get("planName", "")).lower()
            or needle in str(row.get("serviceAccountNumber", "")).lower()
            or needle in str(row.get("serviceId", "")).lower()
            or needle in str(row.get("catalogCode", "")).lower()
            or needle in str(row.get("customer", {}).get("name", "")).lower()
            or needle in str(row.get("customer", {}).get("accountNumber", "")).lower()
        ]
    return filtered


@router.get("/meta")
def billing_meta(admin=Depends(require_admin)):
    return {
        "billingModes": BILLING_MODES,
        "pricingSources": PRICING_SOURCES,
        "subscriptionStatuses": SUBSCRIPTION_STATUSES,
        "invoiceStatuses": INVOICE_STATUSES,
        "paymentStatuses": PAYMENT_STATUSES,
        "paymentMethods": PAYMENT_METHODS,
        "adjustmentTypes": ADJUSTMENT_TYPES,
        "adjustmentStatuses": ADJUSTMENT_STATUSES,
    }


@router.get("/customers")
def billing_customers(search: str = "", admin=Depends(require_admin)):
    return search_customers(search)[:50]


@router.get("/overview")
def billing_overview(admin=Depends(require_admin)):
    seed_billing_data()
    invoice_rows = [invoice_summary(invoice) for invoice in visible_invoices()]
    return {
        "metrics": billing_metrics(),
        "recentInvoices": sorted(invoice_rows, key=lambda invoice: invoice["createdAt"], reverse=True)[:5],
        "recentPayments": sorted(visible_payments(), key=lambda payment: payment["createdAt"], reverse=True)[:5],
        "atRisk": [invoice for invoice in invoice_rows if invoice["status"] in ["OVERDUE", "PARTIALLY_PAID"]][:5],
    }


@router.get("/subscriptions")
def list_subscriptions(
    search: str = "",
    status: str = "",
    customerId: str = "",
    admin=Depends(require_admin),
):
    seed_billing_data()
    rows = filter_rows(visible_subscriptions(), search, status, customerId)
    return sorted(rows, key=lambda row: row["createdAt"], reverse=True)


@router.post("/subscriptions")
def create_subscription(payload: SubscriptionPayload, admin=Depends(require_admin)):
    record = normalize_subscription_payload(payload)
    ensure_service_target_available(record)
    customer = resolve_customer(record["customerId"])
    timestamp = now_iso()
    subscription = {
        "id": str(uuid4()),
        "customer": customer,
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
        **record,
    }
    subscriptions.append(subscription)
    add_audit("billing_subscription_created", "BillingSubscription", subscription["id"], {"customerId": customer["id"]}, admin["username"])
    return subscription


@router.patch("/subscriptions/{subscription_id}")
def update_subscription(subscription_id: str, payload: SubscriptionPayload, admin=Depends(require_admin)):
    current = find_subscription(subscription_id)
    record = normalize_subscription_payload(payload, current)
    ensure_service_target_available(record, current["id"])
    if record["customerId"] != current["customerId"]:
        record["customer"] = resolve_customer(record["customerId"])
    current.update(record)
    current["updatedAt"] = now_iso()
    add_audit("billing_subscription_updated", "BillingSubscription", current["id"], {"customerId": current["customerId"]}, admin["username"])
    return current


@router.delete("/subscriptions/{subscription_id}")
def delete_subscription(subscription_id: str, admin=Depends(require_admin)):
    current = find_subscription(subscription_id)
    current["status"] = "CANCELLED"
    current["deletedAt"] = now_iso()
    current["updatedAt"] = current["deletedAt"]
    add_audit("billing_subscription_deleted", "BillingSubscription", current["id"], {"customerId": current["customerId"]}, admin["username"])
    return {"status": "ok"}


@router.post("/subscriptions/{subscription_id}/generate-invoice")
def generate_subscription_invoice(subscription_id: str, cycleStart: str | None = None, admin=Depends(require_admin)):
    subscription = find_subscription(subscription_id)
    if subscription["status"] != "ACTIVE":
        raise HTTPException(status_code=400, detail="Only active subscriptions can generate invoices")
    invoice = create_invoice_from_subscription(subscription, cycleStart)
    add_audit("billing_invoice_generated", "BillingInvoice", invoice["id"], {"subscriptionId": subscription_id}, admin["username"])
    return invoice


@router.get("/invoices")
def list_invoices(
    search: str = "",
    status: str = "",
    customerId: str = "",
    admin=Depends(require_admin),
):
    seed_billing_data()
    rows = [invoice_summary(invoice) for invoice in visible_invoices()]
    rows = filter_rows(rows, search, status, customerId)
    return sorted(rows, key=lambda row: row["createdAt"], reverse=True)


@router.post("/invoices")
def create_invoice(payload: InvoicePayload, admin=Depends(require_admin)):
    subscription = find_subscription(payload.subscriptionId) if payload.subscriptionId else None
    customer_id = payload.customerId or (subscription["customerId"] if subscription else "")
    customer = subscription["customer"] if subscription else resolve_customer(customer_id)
    issue_day = parse_day(payload.issueDate, "issueDate")
    cycle_start = parse_day(payload.billingCycleStart or issue_day.isoformat(), "billingCycleStart")
    cycle_end = parse_day(payload.billingCycleEnd or (add_months(cycle_start, 1) - timedelta(days=1)).isoformat(), "billingCycleEnd")
    if cycle_end < cycle_start:
        raise HTTPException(status_code=400, detail="billingCycleEnd cannot be before billingCycleStart")
    status = normalize_upper(payload.status or "ISSUED")
    if status not in INVOICE_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid invoice status")
    due_day = parse_day(payload.dueDate or cycle_end.isoformat(), "dueDate")
    timestamp = now_iso()
    invoice = {
        "id": str(uuid4()),
        "invoiceNumber": next_number("INV", invoices, "invoiceNumber"),
        "customerId": customer["id"],
        "customer": customer,
        "subscriptionId": subscription["id"] if subscription else None,
        "serviceAccountId": subscription.get("serviceAccountId", "") if subscription else "",
        "serviceAccountNumber": subscription.get("serviceAccountNumber", "") if subscription else "",
        "serviceOrderId": subscription.get("serviceOrderId", "") if subscription else "",
        "serviceId": subscription.get("serviceId", "") if subscription else "",
        "catalogId": subscription.get("catalogId", "") if subscription else "",
        "catalogCode": subscription.get("catalogCode", "") if subscription else "",
        "catalogName": subscription.get("catalogName", "") if subscription else "",
        "listMonthlyRate": subscription.get("listMonthlyRate", subscription["monthlyRate"]) if subscription else None,
        "pricingSource": subscription.get("pricingSource", "MANUAL") if subscription else "MANUAL",
        "priceOverrideAmount": subscription.get("priceOverrideAmount") if subscription else None,
        "priceOverrideReason": subscription.get("priceOverrideReason", "") if subscription else "",
        "billingMode": subscription["billingMode"] if subscription else None,
        "billingCycleStart": cycle_start.isoformat(),
        "billingCycleEnd": cycle_end.isoformat(),
        "issueDate": issue_day.isoformat(),
        "dueDate": due_day.isoformat(),
        "status": status,
        "lineItems": normalize_line_items(payload.lineItems, subscription),
        "notes": payload.notes or "",
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
    }
    invoices.append(invoice)
    add_audit("billing_invoice_created", "BillingInvoice", invoice["id"], {"customerId": customer["id"]}, admin["username"])
    return invoice_summary(invoice)


@router.patch("/invoices/{invoice_id}")
def update_invoice(invoice_id: str, payload: InvoicePayload, admin=Depends(require_admin)):
    current = find_invoice(invoice_id)
    data = payload.model_dump(exclude_unset=True)
    if "subscriptionId" in data:
        if data["subscriptionId"]:
            subscription = find_subscription(data["subscriptionId"])
            current["subscriptionId"] = subscription["id"]
            current["customerId"] = subscription["customerId"]
            current["customer"] = subscription["customer"]
            current["serviceAccountId"] = subscription.get("serviceAccountId", "")
            current["serviceAccountNumber"] = subscription.get("serviceAccountNumber", "")
            current["serviceOrderId"] = subscription.get("serviceOrderId", "")
            current["serviceId"] = subscription.get("serviceId", "")
            current["catalogId"] = subscription.get("catalogId", "")
            current["catalogCode"] = subscription.get("catalogCode", "")
            current["catalogName"] = subscription.get("catalogName", "")
            current["listMonthlyRate"] = subscription.get("listMonthlyRate", subscription["monthlyRate"])
            current["pricingSource"] = subscription.get("pricingSource", "MANUAL")
            current["priceOverrideAmount"] = subscription.get("priceOverrideAmount")
            current["priceOverrideReason"] = subscription.get("priceOverrideReason", "")
            current["billingMode"] = subscription["billingMode"]
        else:
            current["subscriptionId"] = None
            current["serviceAccountId"] = ""
            current["serviceAccountNumber"] = ""
            current["serviceOrderId"] = ""
            current["serviceId"] = ""
            current["catalogId"] = ""
            current["catalogCode"] = ""
            current["catalogName"] = ""
            current["listMonthlyRate"] = None
            current["pricingSource"] = "MANUAL"
            current["priceOverrideAmount"] = None
            current["priceOverrideReason"] = ""
            current["billingMode"] = None
    elif "customerId" in data and data["customerId"]:
        current["customerId"] = data["customerId"]
        current["customer"] = resolve_customer(data["customerId"])
    for field_name in ["billingCycleStart", "billingCycleEnd", "issueDate", "dueDate", "notes"]:
        if field_name in data and data[field_name] is not None:
            current[field_name] = parse_day(data[field_name], field_name).isoformat() if field_name != "notes" else data[field_name]
    if "status" in data and data["status"] is not None:
        status = normalize_upper(data["status"])
        if status not in INVOICE_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid invoice status")
        current["status"] = status
    if "lineItems" in data and data["lineItems"] is not None:
        subscription = find_subscription(current["subscriptionId"]) if current.get("subscriptionId") else None
        current["lineItems"] = normalize_line_items(data["lineItems"], subscription)
    current["updatedAt"] = now_iso()
    add_audit("billing_invoice_updated", "BillingInvoice", current["id"], {"customerId": current["customerId"]}, admin["username"])
    return invoice_summary(current)


@router.delete("/invoices/{invoice_id}")
def delete_invoice(invoice_id: str, admin=Depends(require_admin)):
    current = find_invoice(invoice_id)
    current["status"] = "VOID"
    current["deletedAt"] = now_iso()
    current["updatedAt"] = current["deletedAt"]
    add_audit("billing_invoice_voided", "BillingInvoice", current["id"], {"customerId": current["customerId"]}, admin["username"])
    return {"status": "ok"}


@router.get("/payments")
def list_payments(search: str = "", customerId: str = "", admin=Depends(require_admin)):
    seed_billing_data()
    rows = filter_rows(visible_payments(), search, "", customerId)
    return sorted(rows, key=lambda row: row["createdAt"], reverse=True)


@router.post("/payments")
def create_payment(payload: PaymentPayload, admin=Depends(require_admin)):
    invoice = find_invoice(payload.invoiceId) if payload.invoiceId else None
    customer_id = payload.customerId or (invoice["customerId"] if invoice else "")
    customer = invoice["customer"] if invoice else resolve_customer(customer_id)
    amount = money(payload.amount)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than zero")
    method = normalize_upper(payload.method or "CASH")
    status = normalize_upper(payload.status or "POSTED")
    if method not in PAYMENT_METHODS:
        raise HTTPException(status_code=400, detail="Invalid payment method")
    if status not in PAYMENT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid payment status")
    if invoice is not None and status == "POSTED":
        validate_invoice_payment(invoice, amount)
    timestamp = now_iso()
    payment = {
        "id": str(uuid4()),
        "receiptNumber": next_number("OR", payments, "receiptNumber"),
        "invoiceId": invoice["id"] if invoice else None,
        "invoiceNumber": invoice["invoiceNumber"] if invoice else "",
        "customerId": customer["id"],
        "customer": customer,
        "amount": amount,
        "method": method,
        "paymentDate": parse_day(payload.paymentDate, "paymentDate").isoformat(),
        "referenceNumber": payload.referenceNumber or "",
        "collectionChannel": clean_text(payload.collectionChannel) or "BILLING",
        "postedByUsername": admin["username"],
        "postedByName": admin_display_name(admin),
        "status": status,
        "notes": payload.notes or "",
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
    }
    payments.append(payment)
    if invoice is not None:
        invoice["updatedAt"] = timestamp
    add_audit("billing_payment_posted", "BillingPayment", payment["id"], {"customerId": customer["id"], "invoiceId": payment["invoiceId"]}, admin["username"])
    return payment


@router.patch("/payments/{payment_id}")
def update_payment(payment_id: str, payload: PaymentPayload, admin=Depends(require_admin)):
    current = find_payment(payment_id)
    data = payload.model_dump(exclude_unset=True)
    target_invoice: dict[str, Any] | None = None
    if "invoiceId" in data and data["invoiceId"]:
        target_invoice = find_invoice(data["invoiceId"])
        current["invoiceId"] = target_invoice["id"]
        current["invoiceNumber"] = target_invoice["invoiceNumber"]
        current["customerId"] = target_invoice["customerId"]
        current["customer"] = target_invoice["customer"]
    elif "customerId" in data and data["customerId"]:
        current["customerId"] = data["customerId"]
        current["customer"] = resolve_customer(data["customerId"])
    if "amount" in data and data["amount"] is not None:
        amount = money(data["amount"])
        if amount <= 0:
            raise HTTPException(status_code=400, detail="Payment amount must be greater than zero")
        current["amount"] = amount
    if "method" in data and data["method"] is not None:
        method = normalize_upper(data["method"])
        if method not in PAYMENT_METHODS:
            raise HTTPException(status_code=400, detail="Invalid payment method")
        current["method"] = method
    if "status" in data and data["status"] is not None:
        status = normalize_upper(data["status"])
        if status not in PAYMENT_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid payment status")
        current["status"] = status
    for field_name in ["paymentDate", "referenceNumber", "notes"]:
        if field_name in data and data[field_name] is not None:
            current[field_name] = parse_day(data[field_name], field_name).isoformat() if field_name == "paymentDate" else data[field_name]
    if "collectionChannel" in data and data["collectionChannel"] is not None:
        current["collectionChannel"] = clean_text(data["collectionChannel"]) or current.get("collectionChannel", "BILLING")
    target_invoice = target_invoice or (find_invoice(current["invoiceId"]) if current.get("invoiceId") else None)
    if target_invoice is not None and current["status"] == "POSTED":
        validate_invoice_payment(target_invoice, current["amount"], current)
    current["updatedAt"] = now_iso()
    add_audit("billing_payment_updated", "BillingPayment", current["id"], {"customerId": current["customerId"]}, admin["username"])
    return current


@router.delete("/payments/{payment_id}")
def delete_payment(payment_id: str, admin=Depends(require_admin)):
    current = find_payment(payment_id)
    current["status"] = "VOID"
    current["deletedAt"] = now_iso()
    current["updatedAt"] = current["deletedAt"]
    add_audit("billing_payment_voided", "BillingPayment", current["id"], {"customerId": current["customerId"]}, admin["username"])
    return {"status": "ok"}


@router.get("/adjustments")
def list_adjustments(customerId: str = "", admin=Depends(require_admin)):
    seed_billing_data()
    rows = visible_adjustments()
    if customerId:
        rows = [row for row in rows if row["customerId"] == customerId]
    return sorted(rows, key=lambda row: row["createdAt"], reverse=True)


@router.post("/adjustments")
def create_adjustment(payload: AdjustmentPayload, admin=Depends(require_admin)):
    invoice = find_invoice(payload.invoiceId or "")
    adjustment_type = normalize_upper(payload.type or "CREDIT")
    status = normalize_upper(payload.status or "POSTED")
    amount = money(payload.amount)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Adjustment amount must be greater than zero")
    if adjustment_type not in ADJUSTMENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid adjustment type")
    if status not in ADJUSTMENT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid adjustment status")
    timestamp = now_iso()
    adjustment = {
        "id": str(uuid4()),
        "invoiceId": invoice["id"],
        "invoiceNumber": invoice["invoiceNumber"],
        "customerId": invoice["customerId"],
        "customer": invoice["customer"],
        "type": adjustment_type,
        "amount": amount,
        "reason": payload.reason or "Billing adjustment",
        "status": status,
        "notes": payload.notes or "",
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
    }
    adjustments.append(adjustment)
    invoice["updatedAt"] = timestamp
    add_audit("billing_adjustment_posted", "BillingAdjustment", adjustment["id"], {"invoiceId": invoice["id"]}, admin["username"])
    return adjustment


@router.patch("/adjustments/{adjustment_id}")
def update_adjustment(adjustment_id: str, payload: AdjustmentPayload, admin=Depends(require_admin)):
    current = find_adjustment(adjustment_id)
    data = payload.model_dump(exclude_unset=True)
    if "invoiceId" in data and data["invoiceId"]:
        invoice = find_invoice(data["invoiceId"])
        current["invoiceId"] = invoice["id"]
        current["invoiceNumber"] = invoice["invoiceNumber"]
        current["customerId"] = invoice["customerId"]
        current["customer"] = invoice["customer"]
    if "type" in data and data["type"] is not None:
        adjustment_type = normalize_upper(data["type"])
        if adjustment_type not in ADJUSTMENT_TYPES:
            raise HTTPException(status_code=400, detail="Invalid adjustment type")
        current["type"] = adjustment_type
    if "status" in data and data["status"] is not None:
        status = normalize_upper(data["status"])
        if status not in ADJUSTMENT_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid adjustment status")
        current["status"] = status
    if "amount" in data and data["amount"] is not None:
        amount = money(data["amount"])
        if amount <= 0:
            raise HTTPException(status_code=400, detail="Adjustment amount must be greater than zero")
        current["amount"] = amount
    for field_name in ["reason", "notes"]:
        if field_name in data and data[field_name] is not None:
            current[field_name] = data[field_name]
    current["updatedAt"] = now_iso()
    add_audit("billing_adjustment_updated", "BillingAdjustment", current["id"], {"invoiceId": current["invoiceId"]}, admin["username"])
    return current


@router.delete("/adjustments/{adjustment_id}")
def delete_adjustment(adjustment_id: str, admin=Depends(require_admin)):
    current = find_adjustment(adjustment_id)
    current["status"] = "VOID"
    current["deletedAt"] = now_iso()
    current["updatedAt"] = current["deletedAt"]
    add_audit("billing_adjustment_voided", "BillingAdjustment", current["id"], {"invoiceId": current["invoiceId"]}, admin["username"])
    return {"status": "ok"}


@router.get("/balances")
def list_balances(admin=Depends(require_admin)):
    seed_billing_data()
    customer_ids = sorted(
        {
            row["customerId"]
            for row in [*visible_subscriptions(), *visible_invoices(), *visible_payments(), *visible_adjustments()]
            if row.get("customerId")
        }
    )
    return [customer_balance(customer_id) for customer_id in customer_ids]


@router.get("/customers/{customer_id}/balance")
def get_customer_balance(customer_id: str, admin=Depends(require_admin)):
    seed_billing_data()
    return customer_balance(customer_id)
