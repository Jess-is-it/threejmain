from datetime import date, datetime, timezone
from typing import Any, Callable
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field


router = APIRouter(prefix="/api/service", tags=["service"])

service_catalog: list[dict[str, Any]] = []
service_orders: list[dict[str, Any]] = []

_current_admin: Callable[[str | None], dict[str, Any]] | None = None
_audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None] | None = None
_customer_resolver: Callable[[str], dict[str, Any]] | None = None
_customer_searcher: Callable[[str], list[dict[str, Any]]] | None = None
_customer_seed: Callable[[], None] | None = None

SERVICE_TYPES = ["FIBER_INTERNET", "WIRELESS_INTERNET", "DEDICATED_INTERNET", "STATIC_IP", "INSTALLATION", "OTHER"]
SERVICE_SEGMENTS = ["RESIDENTIAL", "BUSINESS", "ENTERPRISE", "ALL"]
CATALOG_STATUSES = ["ACTIVE", "DRAFT", "RETIRED"]
BILLING_MODES = ["PREPAID", "POSTPAID", "ONE_TIME"]
ORDER_STATUSES = ["REQUESTED", "APPROVED", "SCHEDULED", "INSTALLING", "ACTIVE", "ON_HOLD", "CANCELLED"]
ORDER_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"]
OPEN_ORDER_STATUSES = ["REQUESTED", "APPROVED", "SCHEDULED", "INSTALLING", "ON_HOLD"]


class CatalogPayload(BaseModel):
    code: str | None = None
    name: str | None = None
    serviceType: str | None = None
    segment: str | None = None
    downloadMbps: float | None = Field(default=None, ge=0)
    uploadMbps: float | None = Field(default=None, ge=0)
    monthlyRate: float | None = Field(default=None, ge=0)
    installFee: float | None = Field(default=None, ge=0)
    billingMode: str | None = None
    status: str | None = None
    contractMonths: int | None = Field(default=None, ge=0, le=120)
    equipmentProfile: str | None = None
    description: str | None = None
    notes: str | None = None


class ServiceOrderPayload(BaseModel):
    customerId: str | None = None
    catalogId: str | None = None
    requestedDate: str | None = None
    targetActivationDate: str | None = None
    activationDate: str | None = None
    billingStartDate: str | None = None
    installAddress: str | None = None
    status: str | None = None
    priority: str | None = None
    serviceReference: str | None = None
    notes: str | None = None


def configure_service(
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
        raise HTTPException(status_code=500, detail="Service module is not configured")
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


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def money(value: Any) -> float:
    return round(float(value or 0), 2)


def parse_day(value: str | None, field_name: str, required: bool = False) -> str:
    if not value:
        if required:
            raise HTTPException(status_code=400, detail=f"{field_name} is required")
        return ""
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{field_name} must be YYYY-MM-DD") from exc


def validate_choice(value: Any, choices: list[str], label: str, default: str) -> str:
    normalized = normalize_upper(value or default)
    if normalized not in choices:
        raise HTTPException(status_code=400, detail=f"Invalid {label}")
    return normalized


def seed_customers() -> None:
    if _customer_seed is not None:
        _customer_seed()


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


def resolve_customer(customer_id: str | None) -> dict[str, Any]:
    if not customer_id:
        raise HTTPException(status_code=400, detail="customerId is required")
    seed_customers()
    if _customer_resolver is None:
        raise HTTPException(status_code=400, detail="Customer Profiling provider is not available")
    return customer_snapshot(_customer_resolver(customer_id))


def search_customers(search: str = "") -> list[dict[str, Any]]:
    seed_customers()
    if _customer_searcher is None:
        return []
    return [customer_snapshot(customer) for customer in _customer_searcher(search)]


def visible_catalog() -> list[dict[str, Any]]:
    return [item for item in service_catalog if not item.get("deletedAt")]


def visible_orders() -> list[dict[str, Any]]:
    return [order for order in service_orders if not order.get("deletedAt")]


def find_catalog(catalog_id: str) -> dict[str, Any]:
    for item in service_catalog:
        if item["id"] == catalog_id and not item.get("deletedAt"):
            return item
    raise HTTPException(status_code=404, detail="Service catalog item not found")


def find_order(order_id: str) -> dict[str, Any]:
    for order in service_orders:
        if order["id"] == order_id and not order.get("deletedAt"):
            return order
    raise HTTPException(status_code=404, detail="Service order not found")


def next_number(prefix: str, rows: list[dict[str, Any]]) -> str:
    return f"{prefix}-{datetime.now(timezone.utc).strftime('%Y%m')}-{len(rows) + 1:04d}"


def catalog_payload_to_record(payload: CatalogPayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    record = dict(current or {})
    record.update({key: value for key, value in data.items() if value is not None})
    required = ["code", "name", "serviceType", "monthlyRate", "billingMode"]
    missing = [field for field in required if record.get(field) in [None, ""]]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing catalog fields: {', '.join(missing)}")
    record["code"] = clean_text(record["code"]).upper()
    record["name"] = clean_text(record["name"])
    record["serviceType"] = validate_choice(record.get("serviceType"), SERVICE_TYPES, "service type", "FIBER_INTERNET")
    record["segment"] = validate_choice(record.get("segment"), SERVICE_SEGMENTS, "segment", "ALL")
    record["billingMode"] = validate_choice(record.get("billingMode"), BILLING_MODES, "billing mode", "PREPAID")
    record["status"] = validate_choice(record.get("status"), CATALOG_STATUSES, "catalog status", "ACTIVE")
    record["downloadMbps"] = float(record.get("downloadMbps") or 0)
    record["uploadMbps"] = float(record.get("uploadMbps") or 0)
    record["monthlyRate"] = money(record.get("monthlyRate"))
    record["installFee"] = money(record.get("installFee"))
    record["contractMonths"] = int(record.get("contractMonths") or 0)
    record["equipmentProfile"] = clean_text(record.get("equipmentProfile"))
    record["description"] = clean_text(record.get("description"))
    record["notes"] = clean_text(record.get("notes"))
    return record


def service_reference(customer: dict[str, Any]) -> str:
    account = customer.get("accountNumber") or customer["id"][:8].upper()
    return f"SVC-{account}-{len(service_orders) + 1:04d}"


def order_payload_to_record(payload: ServiceOrderPayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    record = dict(current or {})
    record.update({key: value for key, value in data.items() if value is not None})
    if not record.get("customerId"):
        raise HTTPException(status_code=400, detail="customerId is required")
    if not record.get("catalogId"):
        raise HTTPException(status_code=400, detail="catalogId is required")
    customer = resolve_customer(record["customerId"])
    catalog = find_catalog(record["catalogId"])
    if catalog["status"] != "ACTIVE":
        raise HTTPException(status_code=400, detail="Only active catalog items can be ordered")
    record["customer"] = customer
    record["catalog"] = catalog_snapshot(catalog)
    record["requestedDate"] = parse_day(record.get("requestedDate") or today_iso(), "requestedDate", required=True)
    record["targetActivationDate"] = parse_day(record.get("targetActivationDate"), "targetActivationDate")
    record["activationDate"] = parse_day(record.get("activationDate"), "activationDate")
    record["billingStartDate"] = parse_day(record.get("billingStartDate"), "billingStartDate")
    record["installAddress"] = clean_text(record.get("installAddress")) or customer.get("address", "")
    record["status"] = validate_choice(record.get("status"), ORDER_STATUSES, "order status", "REQUESTED")
    record["priority"] = validate_choice(record.get("priority"), ORDER_PRIORITIES, "order priority", "NORMAL")
    record["serviceReference"] = clean_text(record.get("serviceReference")) or service_reference(customer)
    record["notes"] = clean_text(record.get("notes"))
    return record


def catalog_snapshot(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item["id"],
        "code": item["code"],
        "name": item["name"],
        "serviceType": item["serviceType"],
        "segment": item["segment"],
        "downloadMbps": item["downloadMbps"],
        "uploadMbps": item["uploadMbps"],
        "monthlyRate": item["monthlyRate"],
        "installFee": item["installFee"],
        "billingMode": item["billingMode"],
        "status": item["status"],
        "contractMonths": item["contractMonths"],
        "equipmentProfile": item["equipmentProfile"],
    }


def order_summary(order: dict[str, Any]) -> dict[str, Any]:
    return {
        **order,
        "catalogName": order.get("catalog", {}).get("name", ""),
        "catalogCode": order.get("catalog", {}).get("code", ""),
        "customerName": order.get("customer", {}).get("name", ""),
        "accountNumber": order.get("customer", {}).get("accountNumber", ""),
    }


def order_matches(order: dict[str, Any], search: str = "", status: str = "", customer_id: str = "") -> bool:
    if status and order.get("status") != normalize_upper(status):
        return False
    if customer_id and order.get("customerId") != customer_id:
        return False
    if search:
        needle = search.strip().lower()
        haystack = " ".join(
            str(value or "")
            for value in [
                order.get("orderNumber"),
                order.get("serviceReference"),
                order.get("catalog", {}).get("code"),
                order.get("catalog", {}).get("name"),
                order.get("customer", {}).get("accountNumber"),
                order.get("customer", {}).get("name"),
                order.get("installAddress"),
            ]
        ).lower()
        return needle in haystack
    return True


def seed_service_catalog() -> None:
    if service_catalog:
        return
    timestamp = now_iso()
    rows = [
        {
            "code": "HOME-FIBER-50",
            "name": "Home Fiber 50 Mbps",
            "serviceType": "FIBER_INTERNET",
            "segment": "RESIDENTIAL",
            "downloadMbps": 50,
            "uploadMbps": 20,
            "monthlyRate": 999,
            "installFee": 1500,
            "billingMode": "PREPAID",
            "status": "ACTIVE",
            "contractMonths": 0,
            "equipmentProfile": "ONU + drop cable",
            "description": "Residential fiber plan for standard browsing, streaming, and work-from-home use.",
            "notes": "Seed catalog item for the first working Service shell.",
        },
        {
            "code": "HOME-FIBER-100",
            "name": "Home Fiber 100 Mbps",
            "serviceType": "FIBER_INTERNET",
            "segment": "RESIDENTIAL",
            "downloadMbps": 100,
            "uploadMbps": 50,
            "monthlyRate": 1499,
            "installFee": 1500,
            "billingMode": "PREPAID",
            "status": "ACTIVE",
            "contractMonths": 0,
            "equipmentProfile": "ONU + drop cable",
            "description": "Higher-speed residential fiber plan.",
            "notes": "",
        },
        {
            "code": "BIZ-FIBER-200",
            "name": "Business Fiber 200 Mbps",
            "serviceType": "DEDICATED_INTERNET",
            "segment": "BUSINESS",
            "downloadMbps": 200,
            "uploadMbps": 100,
            "monthlyRate": 2499,
            "installFee": 2500,
            "billingMode": "POSTPAID",
            "status": "ACTIVE",
            "contractMonths": 12,
            "equipmentProfile": "Business ONU + static routing review",
            "description": "Business internet plan with higher upload allowance.",
            "notes": "",
        },
    ]
    for row in rows:
        service_catalog.append(
            {
                "id": str(uuid4()),
                "createdAt": timestamp,
                "updatedAt": timestamp,
                "deletedAt": "",
                **catalog_payload_to_record(CatalogPayload(**row)),
            },
        )


def seed_service_data() -> None:
    seed_service_catalog()
    if service_orders or _customer_searcher is None:
        return
    customers = search_customers("")[:2]
    catalog_rows = visible_catalog()[:2]
    if not customers or not catalog_rows:
        return
    timestamp = now_iso()
    for customer, catalog in zip(customers, catalog_rows):
        order_record = order_payload_to_record(
            ServiceOrderPayload(
                customerId=customer["id"],
                catalogId=catalog["id"],
                requestedDate=today_iso(),
                status="ACTIVE",
                priority="NORMAL",
                billingStartDate=today_iso(),
                notes="Seed service order for first working Service shell.",
            ),
        )
        service_orders.append(
            {
                "id": str(uuid4()),
                "orderNumber": next_number("SO", service_orders),
                "createdAt": timestamp,
                "updatedAt": timestamp,
                "deletedAt": "",
                **order_record,
            },
        )


def service_metrics() -> dict[str, int | float]:
    seed_service_data()
    catalog_rows = visible_catalog()
    order_rows = visible_orders()
    return {
        "catalog_items": len(catalog_rows),
        "active_catalog": sum(1 for item in catalog_rows if item["status"] == "ACTIVE"),
        "open_orders": sum(1 for order in order_rows if order["status"] in OPEN_ORDER_STATUSES),
        "active_orders": sum(1 for order in order_rows if order["status"] == "ACTIVE"),
        "monthly_recurring_value": money(
            sum(order.get("catalog", {}).get("monthlyRate", 0) for order in order_rows if order["status"] == "ACTIVE")
        ),
    }


@router.get("/health")
def service_health():
    return {"module": "service", "status": "functional-shell"}


@router.get("/meta")
def service_meta(admin=Depends(require_admin)):
    return {
        "serviceTypes": SERVICE_TYPES,
        "segments": SERVICE_SEGMENTS,
        "catalogStatuses": CATALOG_STATUSES,
        "billingModes": BILLING_MODES,
        "orderStatuses": ORDER_STATUSES,
        "orderPriorities": ORDER_PRIORITIES,
    }


@router.get("/customers")
def service_customers(search: str = "", admin=Depends(require_admin)):
    return search_customers(search)[:50]


@router.get("/catalog/overview")
def catalog_overview(admin=Depends(require_admin)):
    seed_service_data()
    rows = visible_catalog()
    return {
        "metrics": service_metrics(),
        "byType": [{"name": item_type, "count": sum(1 for item in rows if item["serviceType"] == item_type)} for item_type in SERVICE_TYPES],
        "activePlans": [catalog_snapshot(item) for item in rows if item["status"] == "ACTIVE"],
    }


@router.get("/catalog")
def list_catalog(search: str = "", status: str = "", serviceType: str = "", admin=Depends(require_admin)):
    seed_service_data()
    rows = visible_catalog()
    if status:
        rows = [item for item in rows if item["status"] == normalize_upper(status)]
    if serviceType:
        rows = [item for item in rows if item["serviceType"] == normalize_upper(serviceType)]
    if search:
        needle = search.strip().lower()
        rows = [
            item
            for item in rows
            if needle in item["code"].lower()
            or needle in item["name"].lower()
            or needle in item.get("description", "").lower()
            or needle in item.get("equipmentProfile", "").lower()
        ]
    return sorted(rows, key=lambda item: item["createdAt"], reverse=True)


@router.post("/catalog")
def create_catalog_item(payload: CatalogPayload, admin=Depends(require_admin)):
    seed_service_catalog()
    record = catalog_payload_to_record(payload)
    if any(item["code"] == record["code"] and not item.get("deletedAt") for item in service_catalog):
        raise HTTPException(status_code=409, detail="Catalog code already exists")
    timestamp = now_iso()
    item = {
        "id": str(uuid4()),
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": "",
        **record,
    }
    service_catalog.append(item)
    add_audit("service_catalog_created", "ServiceCatalog", item["id"], {"code": item["code"]}, admin["username"])
    return item


@router.patch("/catalog/{catalog_id}")
def update_catalog_item(catalog_id: str, payload: CatalogPayload, admin=Depends(require_admin)):
    current = find_catalog(catalog_id)
    record = catalog_payload_to_record(payload, current)
    if any(item["code"] == record["code"] and item["id"] != catalog_id and not item.get("deletedAt") for item in service_catalog):
        raise HTTPException(status_code=409, detail="Catalog code already exists")
    current.update(record)
    current["updatedAt"] = now_iso()
    add_audit("service_catalog_updated", "ServiceCatalog", current["id"], {"code": current["code"]}, admin["username"])
    return current


@router.delete("/catalog/{catalog_id}")
def archive_catalog_item(catalog_id: str, admin=Depends(require_admin)):
    current = find_catalog(catalog_id)
    if any(order["catalogId"] == catalog_id and order["status"] in OPEN_ORDER_STATUSES + ["ACTIVE"] for order in visible_orders()):
        raise HTTPException(status_code=400, detail="Catalog item has active or open service orders")
    current["status"] = "RETIRED"
    current["deletedAt"] = now_iso()
    current["updatedAt"] = current["deletedAt"]
    add_audit("service_catalog_archived", "ServiceCatalog", current["id"], {"code": current["code"]}, admin["username"])
    return {"status": "ok"}


@router.get("/orders/overview")
def order_overview(admin=Depends(require_admin)):
    seed_service_data()
    rows = visible_orders()
    return {
        "metrics": service_metrics(),
        "byStatus": {status: sum(1 for order in rows if order["status"] == status) for status in ORDER_STATUSES},
        "recentOrders": [order_summary(order) for order in sorted(rows, key=lambda item: item["updatedAt"], reverse=True)[:6]],
    }


@router.get("/orders")
def list_orders(
    search: str = "",
    status: str = "",
    customerId: str = "",
    activeOnly: bool = Query(default=False),
    admin=Depends(require_admin),
):
    seed_service_data()
    rows = [order for order in visible_orders() if order_matches(order, search=search, status=status, customer_id=customerId)]
    if activeOnly:
        rows = [order for order in rows if order["status"] == "ACTIVE"]
    return [order_summary(order) for order in sorted(rows, key=lambda item: item["createdAt"], reverse=True)]


@router.post("/orders")
def create_service_order(payload: ServiceOrderPayload, admin=Depends(require_admin)):
    seed_service_data()
    record = order_payload_to_record(payload)
    timestamp = now_iso()
    order = {
        "id": str(uuid4()),
        "orderNumber": next_number("SO", service_orders),
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": "",
        **record,
    }
    service_orders.append(order)
    add_audit("service_order_created", "ServiceOrder", order["id"], {"customerId": order["customerId"]}, admin["username"])
    return order_summary(order)


@router.patch("/orders/{order_id}")
def update_service_order(order_id: str, payload: ServiceOrderPayload, admin=Depends(require_admin)):
    current = find_order(order_id)
    record = order_payload_to_record(payload, current)
    current.update(record)
    current["updatedAt"] = now_iso()
    add_audit("service_order_updated", "ServiceOrder", current["id"], {"customerId": current["customerId"]}, admin["username"])
    return order_summary(current)


@router.delete("/orders/{order_id}")
def cancel_service_order(order_id: str, admin=Depends(require_admin)):
    current = find_order(order_id)
    current["status"] = "CANCELLED"
    current["deletedAt"] = now_iso()
    current["updatedAt"] = current["deletedAt"]
    add_audit("service_order_cancelled", "ServiceOrder", current["id"], {"customerId": current["customerId"]}, admin["username"])
    return {"status": "ok"}
