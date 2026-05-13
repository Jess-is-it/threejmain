from datetime import date, datetime, timezone
from typing import Any, Callable
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

try:
    from inventory import get_pos_catalog_item, list_pos_catalog_items, record_pos_sale_movements, validate_pos_sale_inventory
except ImportError:  # Allows module-local checks before app-shell adds inventory/api to PYTHONPATH.
    get_pos_catalog_item = None
    list_pos_catalog_items = None
    record_pos_sale_movements = None
    validate_pos_sale_inventory = None


router = APIRouter(prefix="/api/point-of-sale", tags=["point-of-sale"])

items: list[dict[str, Any]] = []
cashier_sessions: list[dict[str, Any]] = []
sales: list[dict[str, Any]] = []
payments: list[dict[str, Any]] = []

_current_admin: Callable[[str | None], dict[str, Any]] | None = None
_audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None] | None = None
_customer_resolver: Callable[[str], dict[str, Any]] | None = None
_customer_searcher: Callable[[str], list[dict[str, Any]]] | None = None
_customer_seed: Callable[[], None] | None = None

ITEM_STATUSES = ["ACTIVE", "INACTIVE", "ARCHIVED"]
SESSION_STATUSES = ["OPEN", "CLOSED", "CANCELLED"]
SALE_STATUSES = ["COMPLETED", "VOID"]
PAYMENT_STATUSES = ["POSTED", "VOID"]
PAYMENT_METHODS = ["CASH", "GCASH", "CARD", "BANK_TRANSFER", "CHECK", "OTHER"]
DEPENDENCIES = [
    {
        "module": "Inventory",
        "status": "connected",
        "note": "Inventory is the canonical item master. POS reads sellable inventory items and posts stock movements on checkout/void.",
    },
    {
        "module": "Customer Profiling",
        "status": "optional",
        "note": "Sales can be walk-in or linked to a customer when Customer Profiling lookup is available.",
    },
    {
        "module": "Billing",
        "status": "future",
        "note": "Billing handoff for invoice settlement is intentionally deferred after core POS CRUD.",
    },
]


class ItemPayload(BaseModel):
    sku: str | None = None
    name: str | None = None
    category: str | None = None
    unitPrice: float | None = Field(default=None, ge=0)
    stockOnHand: float | None = Field(default=None, ge=0)
    reorderPoint: float | None = Field(default=None, ge=0)
    taxable: bool | None = None
    status: str | None = None
    notes: str | None = None


class SessionPayload(BaseModel):
    cashierName: str | None = None
    registerName: str | None = None
    openingFloat: float | None = Field(default=None, ge=0)
    openedAt: str | None = None
    closingCash: float | None = Field(default=None, ge=0)
    status: str | None = None
    notes: str | None = None


class SaleLinePayload(BaseModel):
    itemId: str | None = None
    serialNumber: str | None = None
    description: str | None = None
    quantity: float | None = Field(default=None, gt=0)
    unitPrice: float | None = Field(default=None, ge=0)
    discountAmount: float | None = Field(default=None, ge=0)


class SalePayload(BaseModel):
    sessionId: str | None = None
    customerId: str | None = None
    saleDate: str | None = None
    lineItems: list[SaleLinePayload] | None = None
    discountAmount: float | None = Field(default=None, ge=0)
    taxAmount: float | None = Field(default=None, ge=0)
    status: str | None = None
    notes: str | None = None
    payments: list[dict[str, Any]] | None = None


class PaymentPayload(BaseModel):
    saleId: str | None = None
    amount: float | None = Field(default=None, gt=0)
    method: str | None = None
    paymentDate: str | None = None
    referenceNumber: str | None = None
    status: str | None = None
    notes: str | None = None


def configure_point_of_sale(
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
        raise HTTPException(status_code=500, detail="Point of Sale module is not configured")
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


def admin_username(admin: dict[str, Any]) -> str:
    username = str(admin.get("username") or admin.get("email") or admin.get("id") or "pos-user").strip()
    return username or "pos-user"


def admin_display_name(admin: dict[str, Any]) -> str:
    display_name = str(
        admin.get("fullName")
        or admin.get("full_name")
        or admin.get("name")
        or admin_username(admin)
    ).strip()
    return display_name or admin_username(admin)


def money(value: Any) -> float:
    return round(float(value or 0), 2)


def parse_day(value: str | None, field_name: str) -> date:
    try:
        return date.fromisoformat(value or today_iso())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{field_name} must be YYYY-MM-DD") from exc


def next_number(prefix: str, rows: list[dict[str, Any]]) -> str:
    return f"{prefix}-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{len(rows) + 1:04d}"


def visible(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [row for row in rows if not row.get("deletedAt")]


def find_row(rows: list[dict[str, Any]], row_id: str, label: str) -> dict[str, Any]:
    for row in rows:
        if row["id"] == row_id and not row.get("deletedAt"):
            return row
    raise HTTPException(status_code=404, detail=f"{label} not found")


def find_item(item_id: str) -> dict[str, Any]:
    return find_row(items, item_id, "POS item")


def find_session(session_id: str) -> dict[str, Any]:
    return find_row(cashier_sessions, session_id, "Cashier session")


def find_session_or_none(session_id: str | None) -> dict[str, Any] | None:
    if not session_id:
        return None
    return next((session for session in visible(cashier_sessions) if session["id"] == session_id), None)


def find_sale(sale_id: str) -> dict[str, Any]:
    return find_row(sales, sale_id, "POS sale")


def find_payment(payment_id: str) -> dict[str, Any]:
    return find_row(payments, payment_id, "POS payment")


def customer_name(customer: dict[str, Any]) -> str:
    parts = [customer.get("firstName"), customer.get("middleName"), customer.get("lastName")]
    return " ".join(str(part).strip() for part in parts if str(part or "").strip()) or customer.get("name") or "Unnamed customer"


def customer_snapshot(customer: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": customer["id"],
        "accountNumber": customer.get("accountNumber", ""),
        "name": customer_name(customer),
        "status": customer.get("status", ""),
        "contactNumber": customer.get("contactNumber", ""),
    }


def seed_customers() -> None:
    if _customer_seed is not None:
        _customer_seed()


def resolve_customer(customer_id: str | None) -> dict[str, Any] | None:
    if not customer_id:
        return None
    seed_customers()
    if _customer_resolver is None:
        return {
            "id": customer_id,
            "accountNumber": "PLACEHOLDER",
            "name": "Customer lookup pending",
            "status": "",
            "contactNumber": "",
        }
    return customer_snapshot(_customer_resolver(customer_id))


def search_customers(search: str = "") -> list[dict[str, Any]]:
    seed_customers()
    if _customer_searcher is None:
        return []
    return [customer_snapshot(customer) for customer in _customer_searcher(search)]


def inventory_connected() -> bool:
    return get_pos_catalog_item is not None and list_pos_catalog_items is not None


def pos_catalog_items(search: str = "", status: str = "") -> list[dict[str, Any]]:
    if inventory_connected():
        rows = list_pos_catalog_items(search=search, status=status or "ACTIVE")
        if status:
            return [row for row in rows if normalize_upper(row.get("status")) == normalize_upper(status)]
        return rows
    return filter_rows(visible(items), search, status)


def pos_catalog_item(item_id: str) -> dict[str, Any]:
    if inventory_connected():
        return get_pos_catalog_item(item_id)
    return {
        **find_item(item_id),
        "unit": "pcs",
        "availableQuantity": find_item(item_id)["stockOnHand"],
        "stockTracked": True,
        "sellableInPos": True,
    }


def validate_sale_inventory(line_items: list[dict[str, Any]], released_line_items: list[dict[str, Any]] | None = None) -> None:
    if validate_pos_sale_inventory is not None:
        validate_pos_sale_inventory(line_items, released_line_items=released_line_items)
        return
    required_by_item: dict[str, float] = {}
    released_by_item: dict[str, float] = {}
    for line in released_line_items or []:
        if line.get("itemId"):
            released_by_item[line["itemId"]] = money(released_by_item.get(line["itemId"], 0) + money(line.get("quantity")))
    for line in line_items:
        if line.get("itemId"):
            required_by_item[line["itemId"]] = money(required_by_item.get(line["itemId"], 0) + money(line.get("quantity")))
    for item_id, required in required_by_item.items():
        item = find_item(item_id)
        if required > money(item["stockOnHand"] + released_by_item.get(item_id, 0)):
            raise HTTPException(status_code=400, detail=f"Not enough stock for {item['sku']}")


def post_sale_inventory_movements(line_items: list[dict[str, Any]], sale_reference: str, receipt_number: str, actor: str, reverse: bool = False) -> list[dict[str, Any]]:
    if record_pos_sale_movements is not None:
        return record_pos_sale_movements(line_items, sale_reference, receipt_number, actor, reverse=reverse)
    adjust_stock(line_items, 1 if reverse else -1)
    return []


def normalize_item_payload(payload: ItemPayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    record = dict(current or {})
    record.update({key: value for key, value in data.items() if value is not None})
    missing = [field for field in ["sku", "name", "unitPrice"] if record.get(field) in [None, ""]]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required item fields: {', '.join(missing)}")
    status = normalize_upper(record.get("status") or "ACTIVE")
    if status not in ITEM_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid item status")
    record["sku"] = str(record["sku"]).strip().upper()
    record["name"] = str(record["name"]).strip()
    record["category"] = str(record.get("category") or "General").strip()
    record["unitPrice"] = money(record["unitPrice"])
    record["stockOnHand"] = money(record.get("stockOnHand", 0))
    record["reorderPoint"] = money(record.get("reorderPoint", 0))
    record["taxable"] = bool(record.get("taxable", False))
    record["status"] = status
    record["notes"] = record.get("notes") or ""
    return record


def normalize_session_payload(payload: SessionPayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    record = dict(current or {})
    record.update({key: value for key, value in data.items() if value is not None})
    missing = [field for field in ["cashierName", "registerName"] if record.get(field) in [None, ""]]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required session fields: {', '.join(missing)}")
    status = normalize_upper(record.get("status") or "OPEN")
    if status not in SESSION_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid session status")
    record["cashierName"] = str(record["cashierName"]).strip()
    record["registerName"] = str(record["registerName"]).strip()
    record["openingFloat"] = money(record.get("openingFloat", 0))
    record["openedAt"] = parse_day(record.get("openedAt"), "openedAt").isoformat()
    record["closingCash"] = money(record.get("closingCash", 0))
    record["status"] = status
    record["notes"] = record.get("notes") or ""
    return record


def user_register_session(admin: dict[str, Any]) -> dict[str, Any]:
    username = admin_username(admin)
    for session in visible(cashier_sessions):
        if session.get("systemManaged") and session.get("cashierUsername") == username and session["status"] == "OPEN":
            return session
    timestamp = now_iso()
    session = {
        "id": str(uuid4()),
        "sessionNumber": next_number("POS", cashier_sessions),
        "cashierName": admin_display_name(admin),
        "cashierUsername": username,
        "registerName": "POS Register",
        "openingFloat": 0,
        "openedAt": today_iso(),
        "closingCash": 0,
        "status": "OPEN",
        "notes": "System-managed POS user register.",
        "systemManaged": True,
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
    }
    cashier_sessions.append(session)
    return session


def line_total(line: dict[str, Any]) -> float:
    return money(money(line.get("quantity", 0)) * money(line.get("unitPrice", 0)) - money(line.get("discountAmount", 0)))


def normalize_sale_lines(lines: list[SaleLinePayload] | None) -> list[dict[str, Any]]:
    normalized = []
    for line_payload in lines or []:
        line = line_payload.model_dump(exclude_unset=True)
        item = pos_catalog_item(line.get("itemId")) if line.get("itemId") else None
        description = str(line.get("description") or (item["name"] if item else "")).strip()
        if not description:
            raise HTTPException(status_code=400, detail="Sale line description is required")
        quantity = money(line.get("quantity", 1))
        unit_price = money(line.get("unitPrice", item["unitPrice"] if item else 0))
        discount = money(line.get("discountAmount", 0))
        if quantity <= 0:
            raise HTTPException(status_code=400, detail="Sale line quantity must be greater than zero")
        if item is not None and item["status"] != "ACTIVE":
            raise HTTPException(status_code=400, detail=f"Item {item['sku']} is not active")
        normalized.append(
            {
                "id": str(uuid4()),
                "itemId": item["id"] if item else None,
                "sku": item["sku"] if item else "",
                "serialNumber": line.get("serialNumber") or "",
                "description": description,
                "quantity": quantity,
                "unitPrice": unit_price,
                "discountAmount": discount,
                "unit": item.get("unit", "") if item else "",
                "stockTracked": item.get("stockTracked", False) if item else False,
                "amount": line_total({"quantity": quantity, "unitPrice": unit_price, "discountAmount": discount}),
            }
        )
    if not normalized:
        raise HTTPException(status_code=400, detail="At least one sale line item is required")
    return normalized


def adjust_stock(lines: list[dict[str, Any]], direction: int) -> None:
    for line in lines:
        if not line.get("itemId"):
            continue
        item = find_item(line["itemId"])
        next_stock = money(item["stockOnHand"] + (direction * money(line["quantity"])))
        if next_stock < 0:
            raise HTTPException(status_code=400, detail=f"Not enough stock for {item['sku']}")
        item["stockOnHand"] = next_stock
        item["updatedAt"] = now_iso()


def sale_payments(sale_id: str) -> list[dict[str, Any]]:
    return [payment for payment in visible(payments) if payment["saleId"] == sale_id and payment["status"] == "POSTED"]


def sale_summary(sale: dict[str, Any]) -> dict[str, Any]:
    if not sale.get("cashierName"):
        session = find_session_or_none(sale.get("sessionId"))
        sale["cashierName"] = session.get("cashierName", "POS user") if session else "POS user"
        sale["cashierUsername"] = session.get("cashierUsername", sale["cashierName"]) if session else sale["cashierName"]
    subtotal = money(sum(line.get("amount", line_total(line)) for line in sale.get("lineItems", [])))
    discount = money(sale.get("discountAmount", 0))
    tax = money(sale.get("taxAmount", 0))
    total = money(max(0, subtotal - discount + tax))
    paid = money(sum(payment["amount"] for payment in sale_payments(sale["id"])))
    balance = money(max(0, total - paid))
    if sale.get("status") == "VOID":
        payment_status = "VOID"
    elif balance <= 0 and total > 0:
        payment_status = "PAID"
    elif paid > 0:
        payment_status = "PARTIALLY_PAID"
    else:
        payment_status = "UNPAID"
    sale.update({"subtotal": subtotal, "total": total, "paidTotal": paid, "balance": balance, "paymentStatus": payment_status})
    return sale


def session_summary(session: dict[str, Any]) -> dict[str, Any]:
    session_sales = [
        sale_summary(sale)
        for sale in visible(sales)
        if sale["sessionId"] == session["id"] and sale["status"] != "VOID"
    ]
    cash_payments = [
        payment
        for payment in visible(payments)
        if payment["status"] == "POSTED" and payment["method"] == "CASH" and find_sale(payment["saleId"])["sessionId"] == session["id"]
    ]
    gross_sales = money(sum(sale["total"] for sale in session_sales))
    cash_expected = money(session["openingFloat"] + sum(payment["amount"] for payment in cash_payments))
    closing_cash = money(session.get("closingCash", 0))
    return {
        **session,
        "salesCount": len(session_sales),
        "grossSales": gross_sales,
        "cashExpected": cash_expected,
        "variance": money(closing_cash - cash_expected) if session["status"] == "CLOSED" else 0,
    }


def normalize_payment_payload(payload: PaymentPayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    record = dict(current or {})
    record.update({key: value for key, value in data.items() if value is not None})
    if not record.get("saleId"):
        raise HTTPException(status_code=400, detail="saleId is required")
    sale = find_sale(record["saleId"])
    if sale["status"] == "VOID":
        raise HTTPException(status_code=400, detail="Cannot post payment to a void sale")
    method = normalize_upper(record.get("method") or "CASH")
    status = normalize_upper(record.get("status") or "POSTED")
    if method not in PAYMENT_METHODS:
        raise HTTPException(status_code=400, detail="Invalid payment method")
    if status not in PAYMENT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid payment status")
    record["amount"] = money(record.get("amount", 0))
    if record["amount"] <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than zero")
    record["method"] = method
    record["paymentDate"] = parse_day(record.get("paymentDate"), "paymentDate").isoformat()
    record["referenceNumber"] = record.get("referenceNumber") or ""
    record["status"] = status
    record["notes"] = record.get("notes") or ""
    return record


def seed_point_of_sale_data() -> None:
    timestamp = now_iso()
    if not inventory_connected() and not items:
        seed_rows = [
            ("RTR-001", "Home WiFi Router", "Network Equipment", 1450, 10, 2),
            ("CAB-100", "Drop Cable per Meter", "Installation Materials", 18, 500, 100),
            ("SVC-INSTALL", "Standard Installation Fee", "Services", 1500, 9999, 0),
        ]
        for sku, name, category, price, stock, reorder in seed_rows:
            items.append(
                {
                    "id": str(uuid4()),
                    "sku": sku,
                    "name": name,
                    "category": category,
                    "unitPrice": money(price),
                    "stockOnHand": money(stock),
                    "reorderPoint": money(reorder),
                    "taxable": False,
                    "status": "ACTIVE",
                    "notes": "Fallback seed item used only when Inventory is unavailable.",
                    "createdAt": timestamp,
                    "updatedAt": timestamp,
                    "deletedAt": None,
                }
            )


def point_of_sale_metrics() -> dict[str, float | int]:
    seed_point_of_sale_data()
    today = today_iso()
    active_sales = [sale_summary(sale) for sale in visible(sales) if sale["status"] != "VOID"]
    today_sales = [sale for sale in active_sales if sale["saleDate"] == today]
    catalog_items = pos_catalog_items(status="ACTIVE")
    return {
        "today_sales": money(sum(sale["total"] for sale in today_sales)),
        "transactions": len(today_sales),
        "active_items": len(catalog_items),
        "low_stock": sum(1 for item in catalog_items if item.get("stockTracked") and item["stockOnHand"] <= item["reorderPoint"]),
    }


def filter_rows(rows: list[dict[str, Any]], search: str = "", status: str = "") -> list[dict[str, Any]]:
    filtered = rows
    if status:
        filtered = [row for row in filtered if normalize_upper(row.get("status")) == normalize_upper(status)]
    if search:
        needle = search.lower().strip()
        filtered = [
            row
            for row in filtered
            if needle in str(row.get("sku", "")).lower()
            or needle in str(row.get("name", "")).lower()
            or needle in str(row.get("category", "")).lower()
            or needle in str(row.get("saleNumber", "")).lower()
            or needle in str(row.get("receiptNumber", "")).lower()
            or needle in str(row.get("paymentNumber", "")).lower()
            or needle in str(row.get("cashierName", "")).lower()
            or needle in str(row.get("cashierUsername", "")).lower()
            or needle in str(row.get("customer", {}).get("name", "")).lower()
        ]
    return filtered


@router.get("/meta")
def pos_meta(admin=Depends(require_admin)):
    return {
        "itemStatuses": ITEM_STATUSES,
        "sessionStatuses": SESSION_STATUSES,
        "saleStatuses": SALE_STATUSES,
        "paymentMethods": PAYMENT_METHODS,
        "paymentStatuses": PAYMENT_STATUSES,
        "dependencies": DEPENDENCIES,
    }


@router.get("/customers")
def pos_customers(search: str = "", admin=Depends(require_admin)):
    return search_customers(search)[:50]


@router.get("/overview")
def pos_overview(admin=Depends(require_admin)):
    seed_point_of_sale_data()
    sale_rows = [sale_summary(sale) for sale in visible(sales)]
    catalog_items = pos_catalog_items(status="ACTIVE")
    return {
        "metrics": point_of_sale_metrics(),
        "recentSales": sorted(sale_rows, key=lambda sale: sale["createdAt"], reverse=True)[:5],
        "lowStock": [item for item in catalog_items if item.get("stockTracked") and item["stockOnHand"] <= item["reorderPoint"]][:5],
    }


@router.get("/items")
def list_items(search: str = "", status: str = "", admin=Depends(require_admin)):
    seed_point_of_sale_data()
    return pos_catalog_items(search, status)


@router.post("/items")
def create_item(payload: ItemPayload, admin=Depends(require_admin)):
    if inventory_connected():
        raise HTTPException(status_code=405, detail="Manage POS sellable items in Inventory")
    record = normalize_item_payload(payload)
    if any(item["sku"] == record["sku"] and not item.get("deletedAt") for item in items):
        raise HTTPException(status_code=400, detail="SKU already exists")
    timestamp = now_iso()
    item = {"id": str(uuid4()), "createdAt": timestamp, "updatedAt": timestamp, "deletedAt": None, **record}
    items.append(item)
    add_audit("pos_item_created", "POSItem", item["id"], {"sku": item["sku"]}, admin["username"])
    return item


@router.patch("/items/{item_id}")
def update_item(item_id: str, payload: ItemPayload, admin=Depends(require_admin)):
    if inventory_connected():
        raise HTTPException(status_code=405, detail="Manage POS sellable items in Inventory")
    current = find_item(item_id)
    record = normalize_item_payload(payload, current)
    if record["sku"] != current["sku"] and any(item["sku"] == record["sku"] and not item.get("deletedAt") for item in items):
        raise HTTPException(status_code=400, detail="SKU already exists")
    current.update(record)
    current["updatedAt"] = now_iso()
    add_audit("pos_item_updated", "POSItem", current["id"], {"sku": current["sku"]}, admin["username"])
    return current


@router.delete("/items/{item_id}")
def delete_item(item_id: str, admin=Depends(require_admin)):
    if inventory_connected():
        raise HTTPException(status_code=405, detail="Manage POS sellable items in Inventory")
    current = find_item(item_id)
    current["status"] = "ARCHIVED"
    current["deletedAt"] = now_iso()
    current["updatedAt"] = current["deletedAt"]
    add_audit("pos_item_archived", "POSItem", current["id"], {"sku": current["sku"]}, admin["username"])
    return {"status": "ok"}


@router.get("/sessions")
def list_sessions(search: str = "", status: str = "", admin=Depends(require_admin)):
    seed_point_of_sale_data()
    rows = filter_rows([session_summary(session) for session in visible(cashier_sessions)], search, status)
    return sorted(rows, key=lambda row: row["createdAt"], reverse=True)


@router.post("/sessions")
def create_session(payload: SessionPayload, admin=Depends(require_admin)):
    record = normalize_session_payload(payload)
    if record["status"] == "OPEN" and any(
        session["status"] == "OPEN" and not session.get("systemManaged") and not session.get("deletedAt")
        for session in cashier_sessions
    ):
        raise HTTPException(status_code=400, detail="Close the current open session before opening another")
    timestamp = now_iso()
    session = {"id": str(uuid4()), "sessionNumber": next_number("SHIFT", cashier_sessions), "createdAt": timestamp, "updatedAt": timestamp, "deletedAt": None, **record}
    cashier_sessions.append(session)
    add_audit("pos_session_opened", "POSCashierSession", session["id"], {"registerName": session["registerName"]}, admin["username"])
    return session_summary(session)


@router.patch("/sessions/{session_id}")
def update_session(session_id: str, payload: SessionPayload, admin=Depends(require_admin)):
    current = find_session(session_id)
    record = normalize_session_payload(payload, current)
    if current["status"] == "CLOSED" and record["status"] != "CLOSED":
        raise HTTPException(status_code=400, detail="Closed sessions cannot be reopened")
    current.update(record)
    current["updatedAt"] = now_iso()
    add_audit("pos_session_updated", "POSCashierSession", current["id"], {"status": current["status"]}, admin["username"])
    return session_summary(current)


@router.post("/sessions/{session_id}/close")
def close_session(session_id: str, payload: SessionPayload, admin=Depends(require_admin)):
    current = find_session(session_id)
    if current["status"] != "OPEN":
        raise HTTPException(status_code=400, detail="Only open sessions can be closed")
    data = payload.model_dump(exclude_unset=True)
    current["closingCash"] = money(data.get("closingCash", current.get("closingCash", 0)))
    current["notes"] = data.get("notes", current.get("notes", ""))
    current["status"] = "CLOSED"
    current["updatedAt"] = now_iso()
    add_audit("pos_session_closed", "POSCashierSession", current["id"], {"closingCash": current["closingCash"]}, admin["username"])
    return session_summary(current)


@router.delete("/sessions/{session_id}")
def delete_session(session_id: str, admin=Depends(require_admin)):
    current = find_session(session_id)
    if any(sale["sessionId"] == session_id and sale["status"] != "VOID" and not sale.get("deletedAt") for sale in sales):
        raise HTTPException(status_code=400, detail="Cannot cancel a session with active sales")
    current["status"] = "CANCELLED"
    current["deletedAt"] = now_iso()
    current["updatedAt"] = current["deletedAt"]
    add_audit("pos_session_cancelled", "POSCashierSession", current["id"], {}, admin["username"])
    return {"status": "ok"}


@router.get("/sales")
def list_sales(search: str = "", status: str = "", admin=Depends(require_admin)):
    seed_point_of_sale_data()
    rows = filter_rows([sale_summary(sale) for sale in visible(sales)], search, status)
    return sorted(rows, key=lambda row: row["createdAt"], reverse=True)


@router.post("/sales")
def create_sale(payload: SalePayload, admin=Depends(require_admin)):
    seed_point_of_sale_data()
    session = find_session(payload.sessionId) if payload.sessionId else user_register_session(admin)
    if session["status"] != "OPEN":
        raise HTTPException(status_code=400, detail="Sales can only be posted to an open cashier session")
    status = normalize_upper(payload.status or "COMPLETED")
    if status not in SALE_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid sale status")
    if status == "VOID":
        raise HTTPException(status_code=400, detail="New sales cannot be created as void")
    line_items = normalize_sale_lines(payload.lineItems)
    validate_sale_inventory(line_items)
    customer = resolve_customer(payload.customerId)
    timestamp = now_iso()
    sale_id = str(uuid4())
    sale_number = next_number("SALE", sales)
    receipt_number = next_number("OR", sales)
    actor_username = admin_username(admin)
    actor_name = admin_display_name(admin)
    movement_records = post_sale_inventory_movements(line_items, sale_number, receipt_number, actor_username)
    sale = {
        "id": sale_id,
        "saleNumber": sale_number,
        "receiptNumber": receipt_number,
        "sessionId": session["id"],
        "sessionNumber": session["sessionNumber"],
        "cashierUsername": actor_username,
        "cashierName": actor_name,
        "userId": admin.get("id", ""),
        "customerId": customer["id"] if customer else None,
        "customer": customer,
        "saleDate": parse_day(payload.saleDate, "saleDate").isoformat(),
        "lineItems": line_items,
        "inventoryMovementIds": [movement["id"] for movement in movement_records],
        "discountAmount": money(payload.discountAmount),
        "taxAmount": money(payload.taxAmount),
        "status": status,
        "notes": payload.notes or "",
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
    }
    sales.append(sale)
    for payment_payload in payload.payments or []:
        if money(payment_payload.get("amount", 0)) > 0:
            payment_record = normalize_payment_payload(PaymentPayload(**{**payment_payload, "saleId": sale["id"]}))
            payments.append(
                {
                    "id": str(uuid4()),
                    "paymentNumber": next_number("PAY", payments),
                    "createdAt": timestamp,
                    "updatedAt": timestamp,
                    "deletedAt": None,
                    **payment_record,
                }
            )
    add_audit("pos_sale_created", "POSSale", sale["id"], {"saleNumber": sale["saleNumber"]}, actor_username)
    return sale_summary(sale)


@router.patch("/sales/{sale_id}")
def update_sale(sale_id: str, payload: SalePayload, admin=Depends(require_admin)):
    current = find_sale(sale_id)
    if current["status"] == "VOID":
        raise HTTPException(status_code=400, detail="Void sales cannot be edited")
    data = payload.model_dump(exclude_unset=True)
    if "sessionId" in data and data["sessionId"]:
        session = find_session(data["sessionId"])
        if session["status"] != "OPEN":
            raise HTTPException(status_code=400, detail="Sales can only be moved to an open cashier session")
        current["sessionId"] = session["id"]
        current["sessionNumber"] = session["sessionNumber"]
    if "customerId" in data:
        customer = resolve_customer(data["customerId"])
        current["customerId"] = customer["id"] if customer else None
        current["customer"] = customer
    if "lineItems" in data and data["lineItems"] is not None:
        next_lines = normalize_sale_lines(payload.lineItems)
        validate_sale_inventory(next_lines, released_line_items=current["lineItems"])
        reverse_movements = post_sale_inventory_movements(current["lineItems"], current["saleNumber"], current["receiptNumber"], admin["username"], reverse=True)
        next_movements = post_sale_inventory_movements(next_lines, current["saleNumber"], current["receiptNumber"], admin["username"])
        current["lineItems"] = next_lines
        current["inventoryMovementIds"] = [*(current.get("inventoryMovementIds") or []), *[movement["id"] for movement in reverse_movements], *[movement["id"] for movement in next_movements]]
    if "saleDate" in data and data["saleDate"] is not None:
        current["saleDate"] = parse_day(data["saleDate"], "saleDate").isoformat()
    for field_name in ["discountAmount", "taxAmount"]:
        if field_name in data and data[field_name] is not None:
            current[field_name] = money(data[field_name])
    if "status" in data and data["status"] is not None:
        status = normalize_upper(data["status"])
        if status not in SALE_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid sale status")
        if status == "VOID":
            reverse_movements = post_sale_inventory_movements(current["lineItems"], current["saleNumber"], current["receiptNumber"], admin["username"], reverse=True)
            current["inventoryMovementIds"] = [*(current.get("inventoryMovementIds") or []), *[movement["id"] for movement in reverse_movements]]
            for payment in payments:
                if payment["saleId"] == sale_id and not payment.get("deletedAt"):
                    payment["status"] = "VOID"
                    payment["updatedAt"] = now_iso()
        current["status"] = status
    if "notes" in data and data["notes"] is not None:
        current["notes"] = data["notes"]
    current["updatedAt"] = now_iso()
    add_audit("pos_sale_updated", "POSSale", current["id"], {"saleNumber": current["saleNumber"]}, admin["username"])
    return sale_summary(current)


@router.delete("/sales/{sale_id}")
def delete_sale(sale_id: str, admin=Depends(require_admin)):
    current = find_sale(sale_id)
    if current["status"] != "VOID":
        reverse_movements = post_sale_inventory_movements(current["lineItems"], current["saleNumber"], current["receiptNumber"], admin["username"], reverse=True)
        current["inventoryMovementIds"] = [*(current.get("inventoryMovementIds") or []), *[movement["id"] for movement in reverse_movements]]
    current["status"] = "VOID"
    current["deletedAt"] = now_iso()
    current["updatedAt"] = current["deletedAt"]
    for payment in payments:
        if payment["saleId"] == sale_id and not payment.get("deletedAt"):
            payment["status"] = "VOID"
            payment["updatedAt"] = current["updatedAt"]
    add_audit("pos_sale_voided", "POSSale", current["id"], {"saleNumber": current["saleNumber"]}, admin["username"])
    return {"status": "ok"}


@router.get("/payments")
def list_payments(search: str = "", status: str = "", admin=Depends(require_admin)):
    seed_point_of_sale_data()
    rows = filter_rows(visible(payments), search, status)
    return sorted(rows, key=lambda row: row["createdAt"], reverse=True)


@router.post("/payments")
def create_payment(payload: PaymentPayload, admin=Depends(require_admin)):
    record = normalize_payment_payload(payload)
    timestamp = now_iso()
    payment = {"id": str(uuid4()), "paymentNumber": next_number("PAY", payments), "createdAt": timestamp, "updatedAt": timestamp, "deletedAt": None, **record}
    payments.append(payment)
    add_audit("pos_payment_posted", "POSPayment", payment["id"], {"saleId": payment["saleId"]}, admin["username"])
    return payment


@router.patch("/payments/{payment_id}")
def update_payment(payment_id: str, payload: PaymentPayload, admin=Depends(require_admin)):
    current = find_payment(payment_id)
    record = normalize_payment_payload(payload, current)
    current.update(record)
    current["updatedAt"] = now_iso()
    add_audit("pos_payment_updated", "POSPayment", current["id"], {"saleId": current["saleId"]}, admin["username"])
    return current


@router.delete("/payments/{payment_id}")
def delete_payment(payment_id: str, admin=Depends(require_admin)):
    current = find_payment(payment_id)
    current["status"] = "VOID"
    current["deletedAt"] = now_iso()
    current["updatedAt"] = current["deletedAt"]
    add_audit("pos_payment_voided", "POSPayment", current["id"], {"saleId": current["saleId"]}, admin["username"])
    return {"status": "ok"}
