from datetime import date, datetime, timezone
from typing import Any, Callable
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field


router = APIRouter(prefix="/api/service", tags=["service"])

service_catalog: list[dict[str, Any]] = []
service_accounts: list[dict[str, Any]] = []
service_orders: list[dict[str, Any]] = []

_current_admin: Callable[[str | None], dict[str, Any]] | None = None
_audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None] | None = None
_customer_resolver: Callable[[str], dict[str, Any]] | None = None
_customer_searcher: Callable[[str], list[dict[str, Any]]] | None = None
_customer_seed: Callable[[], None] | None = None
_ticket_creator: Callable[[dict[str, Any], str], dict[str, Any]] | None = None

SERVICE_TYPES = ["FIBER_INTERNET", "WIRELESS_INTERNET", "DEDICATED_INTERNET", "STATIC_IP", "INSTALLATION", "OTHER"]
INTERNET_SERVICE_TYPES = {"FIBER_INTERNET", "WIRELESS_INTERNET", "DEDICATED_INTERNET"}
SERVICE_SEGMENTS = ["RESIDENTIAL", "BUSINESS", "ENTERPRISE", "ALL"]
CATALOG_STATUSES = ["ACTIVE", "DRAFT", "RETIRED"]
ACCOUNT_STATUSES = ["PENDING_ACTIVATION", "ACTIVE", "SUSPENDED", "DISCONNECTED", "CANCELLED"]
BILLING_MODES = ["PREPAID", "POSTPAID", "ONE_TIME"]
ORDER_TYPES = [
    "NEW_INSTALLATION",
    "PLAN_UPGRADE",
    "PLAN_DOWNGRADE",
    "RELOCATION",
    "TEMPORARY_SUSPENSION",
    "RECONNECTION",
    "DISCONNECTION",
    "CHANGE_OWNERSHIP",
    "ADD_ON_SERVICE",
    "EQUIPMENT_REPLACEMENT",
]
ORDER_STATUSES = [
    "DRAFT",
    "SUBMITTED",
    "PENDING_REQUIREMENT",
    "PENDING_REVIEW",
    "APPROVED",
    "IN_PROGRESS",
    "COMPLETED",
    "CANCELLED",
    "REJECTED",
    "ON_HOLD",
]
ORDER_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"]
OPEN_ORDER_STATUSES = ["SUBMITTED", "PENDING_REQUIREMENT", "PENDING_REVIEW", "APPROVED", "IN_PROGRESS", "ON_HOLD"]
DETAIL_REQUIRED_STATUSES = ["SUBMITTED", "PENDING_REVIEW", "APPROVED", "IN_PROGRESS", "COMPLETED", "ON_HOLD"]
ORDER_STATUS_ALIASES = {
    "REQUESTED": "SUBMITTED",
    "SCHEDULED": "APPROVED",
    "INSTALLING": "IN_PROGRESS",
    "ACTIVE": "COMPLETED",
}
ORDER_DETAIL_SCHEMAS = {
    "NEW_INSTALLATION": [
        {"name": "preferredSchedule", "label": "Preferred Schedule", "type": "date", "required": True},
        {"name": "installationFee", "label": "Installation Fee", "type": "money", "readOnly": True},
        {"name": "coverageArea", "label": "Coverage Area", "type": "text", "required": True},
        {"name": "coverageCheckRequired", "label": "Coverage Check Required", "type": "boolean"},
    ],
    "PLAN_UPGRADE": [
        {"name": "currentPlan", "label": "Current Plan", "type": "text", "required": True, "readOnly": True},
        {"name": "effectiveDate", "label": "Effective Date", "type": "date", "required": True},
        {"name": "priceDifference", "label": "Price Difference", "type": "money", "required": True, "readOnly": True},
        {"name": "approvalReference", "label": "Approval Reference", "type": "text"},
    ],
    "PLAN_DOWNGRADE": [
        {"name": "currentPlan", "label": "Current Plan", "type": "text", "required": True, "readOnly": True},
        {"name": "effectiveDate", "label": "Effective Date", "type": "date", "required": True},
        {"name": "priceDifference", "label": "Price Difference", "type": "money", "required": True, "readOnly": True},
        {"name": "downgradeReason", "label": "Downgrade Reason", "type": "text", "required": True},
    ],
    "RELOCATION": [
        {"name": "currentServiceAddress", "label": "Current Service Address", "type": "text", "required": True, "readOnly": True},
        {"name": "newServiceAddress", "label": "New Service Address", "type": "text", "required": True},
        {"name": "targetTransferDate", "label": "Target Transfer Date", "type": "date", "required": True},
        {"name": "coverageCheckRequired", "label": "Coverage Check Required", "type": "boolean"},
    ],
    "TEMPORARY_SUSPENSION": [
        {"name": "suspensionStartDate", "label": "Suspension Start Date", "type": "date", "required": True},
        {"name": "suspensionEndDate", "label": "Suspension End Date", "type": "date"},
        {"name": "suspensionReason", "label": "Suspension Reason", "type": "text", "required": True},
    ],
    "RECONNECTION": [
        {"name": "reconnectionDate", "label": "Reconnection Date", "type": "date", "required": True},
        {"name": "outstandingBalance", "label": "Outstanding Balance", "type": "money", "required": True},
        {"name": "paymentReference", "label": "Payment Reference", "type": "text"},
    ],
    "DISCONNECTION": [
        {"name": "disconnectionReason", "label": "Disconnection Reason", "type": "text", "required": True},
        {"name": "outstandingBalance", "label": "Outstanding Balance", "type": "money", "required": True},
        {"name": "disconnectionType", "label": "Disconnection Type", "type": "text", "required": True},
        {"name": "targetDisconnectionDate", "label": "Target Disconnection Date", "type": "date", "required": True},
        {"name": "equipmentRetrievalRequired", "label": "Equipment Retrieval Required", "type": "boolean"},
    ],
    "CHANGE_OWNERSHIP": [
        {"name": "newOwnerCustomerId", "label": "New Owner", "type": "customer", "required": True},
        {"name": "newOwnerName", "label": "New Owner Name", "type": "text", "required": True, "readOnly": True},
        {"name": "newOwnerAccountNumber", "label": "New Owner Account No.", "type": "text", "readOnly": True},
        {"name": "newOwnerContact", "label": "New Owner Contact", "type": "text", "readOnly": True},
        {"name": "transferReason", "label": "Transfer Reason", "type": "text", "required": True},
        {"name": "effectiveDate", "label": "Effective Date", "type": "date", "required": True},
        {"name": "approvalReference", "label": "Approval Reference", "type": "text"},
    ],
    "ADD_ON_SERVICE": [
        {"name": "addOnName", "label": "Add-on Service", "type": "text", "required": True, "readOnly": True},
        {"name": "monthlyCharge", "label": "Monthly Charge", "type": "money", "required": True, "readOnly": True},
        {"name": "effectiveDate", "label": "Effective Date", "type": "date", "required": True},
        {"name": "provisioningNotes", "label": "Provisioning Notes", "type": "text"},
    ],
    "EQUIPMENT_REPLACEMENT": [
        {"name": "equipmentType", "label": "Equipment Type", "type": "text", "required": True},
        {"name": "replacementReason", "label": "Replacement Reason", "type": "text", "required": True},
        {"name": "targetReplacementDate", "label": "Target Replacement Date", "type": "date", "required": True},
        {"name": "technicianRequired", "label": "Technician Required", "type": "boolean"},
    ],
}


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
    serviceAccountId: str | None = None
    catalogId: str | None = None
    orderType: str | None = None
    requestedDate: str | None = None
    targetActivationDate: str | None = None
    activationDate: str | None = None
    billingStartDate: str | None = None
    installAddress: str | None = None
    status: str | None = None
    priority: str | None = None
    serviceReference: str | None = None
    orderDetails: dict[str, Any] | None = None
    notes: str | None = None


class ServiceAccountPayload(BaseModel):
    customerId: str | None = None
    catalogId: str | None = None
    serviceAddress: str | None = None
    status: str | None = None
    activationDate: str | None = None
    serviceReference: str | None = None
    notes: str | None = None


def configure_service(
    current_admin: Callable[[str | None], dict[str, Any]],
    audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None],
    customer_resolver: Callable[[str], dict[str, Any]] | None = None,
    customer_searcher: Callable[[str], list[dict[str, Any]]] | None = None,
    customer_seed: Callable[[], None] | None = None,
    ticket_creator: Callable[[dict[str, Any], str], dict[str, Any]] | None = None,
) -> None:
    global _current_admin, _audit_logger, _customer_resolver, _customer_searcher, _customer_seed, _ticket_creator
    _current_admin = current_admin
    _audit_logger = audit_logger
    _customer_resolver = customer_resolver
    _customer_searcher = customer_searcher
    _customer_seed = customer_seed
    _ticket_creator = ticket_creator


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


def money(value: Any, field_name: str = "Amount") -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"{field_name} must be numeric") from exc


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


def validate_order_status(value: Any) -> str:
    normalized = normalize_upper(value or "DRAFT")
    normalized = ORDER_STATUS_ALIASES.get(normalized, normalized)
    if normalized not in ORDER_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid order status")
    return normalized


def order_status(order: dict[str, Any]) -> str:
    return ORDER_STATUS_ALIASES.get(normalize_upper(order.get("status")), order.get("status") or "DRAFT")


def sanitize_order_details(order_type: str, details: Any) -> dict[str, Any]:
    source = details if isinstance(details, dict) else {}
    sanitized: dict[str, Any] = {}
    for field in ORDER_DETAIL_SCHEMAS.get(order_type, []):
        name = field["name"]
        field_type = field["type"]
        value = source.get(name)
        if field_type == "boolean":
            sanitized[name] = normalize_upper(value) in ["1", "TRUE", "YES", "ON"] if isinstance(value, str) else bool(value)
        elif field_type == "date":
            sanitized[name] = parse_day(clean_text(value), name)
        elif field_type == "money":
            sanitized[name] = None if clean_text(value) == "" else money(value, field["label"])
        elif field_type == "customer":
            sanitized[name] = clean_text(value)
        else:
            sanitized[name] = clean_text(value)
    return sanitized


def enrich_order_details(order_type: str, details: dict[str, Any], current_customer_id: str) -> dict[str, Any]:
    if order_type != "CHANGE_OWNERSHIP":
        return details
    new_owner_id = clean_text(details.get("newOwnerCustomerId"))
    if not new_owner_id:
        return details
    if new_owner_id == current_customer_id:
        raise HTTPException(status_code=400, detail="New owner must be a different Customer Profiling record")
    new_owner = resolve_customer(new_owner_id)
    return {
        **details,
        "newOwnerName": new_owner.get("name", ""),
        "newOwnerAccountNumber": new_owner.get("accountNumber", ""),
        "newOwnerContact": new_owner.get("contactNumber", ""),
    }


def missing_required_order_details(order_type: str, details: dict[str, Any]) -> list[str]:
    missing: list[str] = []
    for field in ORDER_DETAIL_SCHEMAS.get(order_type, []):
        if not field.get("required"):
            continue
        value = details.get(field["name"])
        if value is None or value == "":
            missing.append(field["label"])
    return missing


def order_readiness(order: dict[str, Any]) -> dict[str, Any]:
    status = order_status(order)
    order_type = order.get("orderType") or "NEW_INSTALLATION"
    missing = missing_required_order_details(order_type, order.get("orderDetails") or {})
    required_now = status in DETAIL_REQUIRED_STATUSES
    return {
        "requiredNow": required_now,
        "ready": not required_now or not missing,
        "missingFields": missing,
    }


def validate_order_readiness(order: dict[str, Any]) -> None:
    readiness = order_readiness(order)
    if readiness["ready"]:
        return
    raise HTTPException(status_code=400, detail=f"Missing required order details: {', '.join(readiness['missingFields'])}")


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
        "gender": customer.get("gender", ""),
        "customerType": customer.get("customerType", ""),
        "contactNumber": customer.get("contactNumber", ""),
        "barangay": customer.get("barangay", ""),
        "city": customer.get("city", ""),
        "province": customer.get("province", ""),
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


def visible_accounts() -> list[dict[str, Any]]:
    return [account for account in service_accounts if not account.get("deletedAt")]


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


def find_account(account_id: str) -> dict[str, Any]:
    for account in service_accounts:
        if account["id"] == account_id and not account.get("deletedAt"):
            return account
    raise HTTPException(status_code=404, detail="Service account not found")


def find_account_by_reference(service_reference: str) -> dict[str, Any] | None:
    reference = clean_text(service_reference)
    if not reference:
        return None
    for account in visible_accounts():
        if account.get("serviceReference") == reference:
            return account
    return None


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


def service_account_reference(customer: dict[str, Any]) -> str:
    account = customer.get("accountNumber") or customer["id"][:8].upper()
    return f"SVC-{account}-{len(service_accounts) + 1:04d}"


def account_payload_to_record(payload: ServiceAccountPayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
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
        raise HTTPException(status_code=400, detail="Only active catalog items can be assigned to service accounts")
    record["customer"] = customer
    record["catalog"] = catalog_snapshot(catalog)
    record["serviceAddress"] = clean_text(record.get("serviceAddress")) or customer.get("address", "")
    record["status"] = validate_choice(record.get("status"), ACCOUNT_STATUSES, "service account status", "ACTIVE")
    record["activationDate"] = parse_day(record.get("activationDate"), "activationDate")
    record["serviceReference"] = clean_text(record.get("serviceReference")) or service_account_reference(customer)
    record["notes"] = clean_text(record.get("notes"))
    return record


def service_account_snapshot(account: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": account["id"],
        "serviceAccountNumber": account.get("serviceAccountNumber", ""),
        "serviceReference": account.get("serviceReference", ""),
        "customerId": account.get("customerId", ""),
        "catalogId": account.get("catalogId", ""),
        "status": account.get("status", ""),
        "serviceAddress": account.get("serviceAddress", ""),
        "activationDate": account.get("activationDate", ""),
        "catalog": account.get("catalog", {}),
    }


def attach_service_account(order: dict[str, Any], account: dict[str, Any]) -> None:
    order["serviceAccountId"] = account["id"]
    order["serviceAccount"] = service_account_snapshot(account)


def order_payload_to_record(payload: ServiceOrderPayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    record = dict(current or {})
    record.update({key: value for key, value in data.items() if value is not None})
    record["orderType"] = validate_choice(record.get("orderType"), ORDER_TYPES, "order type", "NEW_INSTALLATION")
    linked_account = find_account(record["serviceAccountId"]) if record.get("serviceAccountId") else None
    if linked_account:
        if record.get("customerId") and record["customerId"] != linked_account["customerId"]:
            raise HTTPException(status_code=400, detail="Service account does not belong to the selected customer")
        record["customerId"] = linked_account["customerId"]
        record["catalogId"] = record.get("catalogId") or linked_account["catalogId"]
    elif record["orderType"] != "NEW_INSTALLATION":
        raise HTTPException(status_code=400, detail="serviceAccountId is required for service order types other than New Installation")
    if not record.get("customerId"):
        raise HTTPException(status_code=400, detail="customerId is required")
    if not record.get("catalogId"):
        raise HTTPException(status_code=400, detail="catalogId is required")
    customer = resolve_customer(record["customerId"])
    catalog = find_catalog(record["catalogId"])
    if catalog["status"] != "ACTIVE":
        raise HTTPException(status_code=400, detail="Only active catalog items can be ordered")
    validate_plan_change_catalog(record["orderType"], catalog, linked_account)
    record["customer"] = customer
    record["catalog"] = catalog_snapshot(catalog)
    if linked_account:
        attach_service_account(record, linked_account)
    record["requestedDate"] = parse_day(record.get("requestedDate") or today_iso(), "requestedDate", required=True)
    record["targetActivationDate"] = parse_day(record.get("targetActivationDate"), "targetActivationDate")
    record["activationDate"] = parse_day(record.get("activationDate"), "activationDate")
    record["billingStartDate"] = parse_day(record.get("billingStartDate"), "billingStartDate")
    default_address = linked_account.get("serviceAddress", "") if linked_account else customer.get("address", "")
    record["installAddress"] = clean_text(record.get("installAddress")) or default_address
    record["status"] = validate_order_status(record.get("status"))
    record["priority"] = validate_choice(record.get("priority"), ORDER_PRIORITIES, "order priority", "NORMAL")
    record["serviceReference"] = clean_text(record.get("serviceReference")) or (linked_account.get("serviceReference") if linked_account else "") or service_reference(customer)
    record["orderDetails"] = enrich_order_details(
        record["orderType"],
        sanitize_order_details(record["orderType"], record.get("orderDetails")),
        record["customerId"],
    )
    validate_order_readiness(record)
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


def compare_catalog_plan_level(candidate: dict[str, Any], current: dict[str, Any]) -> int:
    candidate_download = float(candidate.get("downloadMbps") or 0)
    current_download = float(current.get("downloadMbps") or 0)
    candidate_upload = float(candidate.get("uploadMbps") or 0)
    current_upload = float(current.get("uploadMbps") or 0)
    if candidate_download or current_download or candidate_upload or current_upload:
        if candidate_download != current_download:
            return 1 if candidate_download > current_download else -1
        if candidate_upload != current_upload:
            return 1 if candidate_upload > current_upload else -1
        return 0

    candidate_rate = float(candidate.get("monthlyRate") or 0)
    current_rate = float(current.get("monthlyRate") or 0)
    if candidate_rate != current_rate:
        return 1 if candidate_rate > current_rate else -1
    return 0


def validate_plan_change_catalog(order_type: str, catalog: dict[str, Any], linked_account: dict[str, Any] | None) -> None:
    if order_type not in {"PLAN_UPGRADE", "PLAN_DOWNGRADE"}:
        return
    if not linked_account:
        raise HTTPException(status_code=400, detail="serviceAccountId is required for plan change orders")
    if catalog.get("serviceType") not in INTERNET_SERVICE_TYPES:
        raise HTTPException(status_code=400, detail="Plan change orders require an internet service catalog item")

    current_catalog = linked_account.get("catalog") or find_catalog(linked_account.get("catalogId", ""))
    comparison = compare_catalog_plan_level(catalog, current_catalog)
    if order_type == "PLAN_DOWNGRADE" and comparison >= 0:
        raise HTTPException(status_code=400, detail="Plan Downgrade requires a lower active internet plan than the current Service Account plan")
    if order_type == "PLAN_UPGRADE" and comparison <= 0:
        raise HTTPException(status_code=400, detail="Plan Upgrade requires a higher active internet plan than the current Service Account plan")


def order_summary(order: dict[str, Any]) -> dict[str, Any]:
    account = order.get("serviceAccount") or {}
    ticket = order.get("ticket") or {}
    return {
        **order,
        "orderType": order.get("orderType") or "NEW_INSTALLATION",
        "status": order_status(order),
        "orderReadiness": order_readiness(order),
        "catalogName": order.get("catalog", {}).get("name", ""),
        "catalogCode": order.get("catalog", {}).get("code", ""),
        "customerName": order.get("customer", {}).get("name", ""),
        "accountNumber": order.get("customer", {}).get("accountNumber", ""),
        "serviceAccountNumber": account.get("serviceAccountNumber", ""),
        "serviceAccountStatus": account.get("status", ""),
        "ticketId": order.get("ticketId", ""),
        "ticketNumber": order.get("ticketNumber") or ticket.get("ticketNumber", ""),
        "ticketStatus": order.get("ticketStatus") or ticket.get("status", ""),
    }


def account_summary(account: dict[str, Any]) -> dict[str, Any]:
    return {
        **account,
        "catalogName": account.get("catalog", {}).get("name", ""),
        "catalogCode": account.get("catalog", {}).get("code", ""),
        "customerName": account.get("customer", {}).get("name", ""),
        "customerAccountNumber": account.get("customer", {}).get("accountNumber", ""),
    }


def account_matches(account: dict[str, Any], search: str = "", status: str = "", customer_id: str = "", catalog_id: str = "") -> bool:
    if status and account.get("status") != normalize_upper(status):
        return False
    if customer_id and account.get("customerId") != customer_id:
        return False
    if catalog_id and account.get("catalogId") != catalog_id:
        return False
    if search:
        needle = search.strip().lower()
        haystack = " ".join(
            str(value or "")
            for value in [
                account.get("serviceAccountNumber"),
                account.get("serviceReference"),
                account.get("status"),
                account.get("catalog", {}).get("code"),
                account.get("catalog", {}).get("name"),
                account.get("customer", {}).get("accountNumber"),
                account.get("customer", {}).get("name"),
                account.get("serviceAddress"),
            ]
        ).lower()
        return needle in haystack
    return True


def order_matches(order: dict[str, Any], search: str = "", status: str = "", customer_id: str = "", order_type: str = "", service_account_id: str = "") -> bool:
    status_filter = ORDER_STATUS_ALIASES.get(normalize_upper(status), normalize_upper(status))
    if status and order_status(order) != status_filter:
        return False
    if order_type and order.get("orderType") != normalize_upper(order_type):
        return False
    if customer_id and order.get("customerId") != customer_id:
        return False
    if service_account_id and order.get("serviceAccountId") != service_account_id:
        return False
    if search:
        needle = search.strip().lower()
        haystack = " ".join(
            str(value or "")
            for value in [
                order.get("orderNumber"),
                order.get("orderType"),
                order.get("status"),
                order.get("priority"),
                order.get("serviceReference"),
                order.get("serviceAccount", {}).get("serviceAccountNumber"),
                order.get("serviceAccount", {}).get("status"),
                order.get("catalog", {}).get("code"),
                order.get("catalog", {}).get("name"),
                order.get("customer", {}).get("accountNumber"),
                order.get("customer", {}).get("name"),
                order.get("installAddress"),
                *list((order.get("orderDetails") or {}).values()),
            ]
        ).lower()
        return needle in haystack
    return True


def ensure_no_conflicting_open_order(record: dict[str, Any], current_id: str | None = None) -> None:
    service_account_id = record.get("serviceAccountId")
    if not service_account_id or order_status(record) not in OPEN_ORDER_STATUSES:
        return
    for order in visible_orders():
        if order["id"] == current_id:
            continue
        if order.get("serviceAccountId") == service_account_id and order_status(order) in OPEN_ORDER_STATUSES:
            raise HTTPException(status_code=409, detail="This service account already has an open service order")


def ticket_snapshot(ticket: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": ticket.get("id", ""),
        "ticketNumber": ticket.get("ticketNumber", ""),
        "status": ticket.get("status", ""),
        "priority": ticket.get("priority", ""),
        "category": ticket.get("category", ""),
        "subject": ticket.get("subject", ""),
        "serviceId": ticket.get("serviceId", ""),
        "serviceOrderId": ticket.get("serviceOrderId", ""),
        "openedAt": ticket.get("openedAt", ""),
        "updatedAt": ticket.get("updatedAt", ""),
    }


def attach_ticket(order: dict[str, Any], ticket: dict[str, Any] | None) -> None:
    if not ticket:
        return
    snapshot = ticket_snapshot(ticket)
    order["ticketId"] = snapshot["id"]
    order["ticketNumber"] = snapshot["ticketNumber"]
    order["ticketStatus"] = snapshot["status"]
    order["ticket"] = snapshot


def create_ticket_for_order(order: dict[str, Any], actor: str) -> dict[str, Any] | None:
    if _ticket_creator is None:
        return None
    ticket = _ticket_creator(order_summary(order), actor)
    attach_ticket(order, ticket)
    return ticket


def create_or_activate_service_account_from_order(order: dict[str, Any], actor: str) -> dict[str, Any]:
    account = find_account(order["serviceAccountId"]) if order.get("serviceAccountId") else find_account_by_reference(order.get("serviceReference", ""))
    payload = ServiceAccountPayload(
        customerId=order["customerId"],
        catalogId=order["catalogId"],
        serviceAddress=order.get("installAddress"),
        status="ACTIVE",
        activationDate=order.get("activationDate") or order.get("billingStartDate") or today_iso(),
        serviceReference=order.get("serviceReference"),
        notes="Created or activated from completed New Installation order.",
    )
    timestamp = now_iso()
    if account is None:
        record = account_payload_to_record(payload)
        account = {
            "id": str(uuid4()),
            "serviceAccountNumber": next_number("SA", service_accounts),
            "createdAt": timestamp,
            "updatedAt": timestamp,
            "deletedAt": "",
            **record,
        }
        service_accounts.append(account)
        add_audit("service_account_created_from_order", "ServiceAccount", account["id"], {"orderId": order["id"]}, actor)
    else:
        record = account_payload_to_record(payload, account)
        account.update(record)
        account["deletedAt"] = ""
        account["updatedAt"] = timestamp
        add_audit("service_account_activated_from_order", "ServiceAccount", account["id"], {"orderId": order["id"]}, actor)
    attach_service_account(order, account)
    return account


def apply_completed_order_effects(order: dict[str, Any], actor: str) -> None:
    if order_status(order) != "COMPLETED":
        return
    order_type = order.get("orderType") or "NEW_INSTALLATION"
    if order_type == "NEW_INSTALLATION":
        create_or_activate_service_account_from_order(order, actor)
        return
    if not order.get("serviceAccountId"):
        return
    account = find_account(order["serviceAccountId"])
    changed = False
    if order_type in ["PLAN_UPGRADE", "PLAN_DOWNGRADE"]:
        account["catalogId"] = order["catalogId"]
        account["catalog"] = catalog_snapshot(find_catalog(order["catalogId"]))
        changed = True
    elif order_type == "RELOCATION":
        details = order.get("orderDetails") or {}
        account["serviceAddress"] = details.get("newServiceAddress") or order.get("installAddress") or account.get("serviceAddress", "")
        changed = True
    elif order_type == "TEMPORARY_SUSPENSION":
        account["status"] = "SUSPENDED"
        changed = True
    elif order_type == "RECONNECTION":
        account["status"] = "ACTIVE"
        changed = True
    elif order_type == "DISCONNECTION":
        account["status"] = "DISCONNECTED"
        changed = True
    elif order_type == "CHANGE_OWNERSHIP":
        details = order.get("orderDetails") or {}
        new_owner_id = clean_text(details.get("newOwnerCustomerId"))
        if new_owner_id:
            account["customerId"] = new_owner_id
            account["customer"] = resolve_customer(new_owner_id)
            changed = True
    if changed:
        account["updatedAt"] = now_iso()
        add_audit("service_account_updated_from_order", "ServiceAccount", account["id"], {"orderId": order["id"], "orderType": order_type}, actor)
    attach_service_account(order, account)


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
        {
            "code": "ADDON-STATIC-IP",
            "name": "Static IP Add-on",
            "serviceType": "STATIC_IP",
            "segment": "ALL",
            "downloadMbps": 0,
            "uploadMbps": 0,
            "monthlyRate": 250,
            "installFee": 0,
            "billingMode": "POSTPAID",
            "status": "ACTIVE",
            "contractMonths": 0,
            "equipmentProfile": "Static public IPv4 assignment",
            "description": "Optional static IP add-on for existing service accounts.",
            "notes": "",
        },
        {
            "code": "ADDON-MESH-WIFI",
            "name": "Mesh WiFi Add-on",
            "serviceType": "OTHER",
            "segment": "ALL",
            "downloadMbps": 0,
            "uploadMbps": 0,
            "monthlyRate": 199,
            "installFee": 0,
            "billingMode": "POSTPAID",
            "status": "ACTIVE",
            "contractMonths": 0,
            "equipmentProfile": "Mesh node provisioning",
            "description": "Optional mesh WiFi add-on for existing service accounts.",
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
    if not service_orders and _customer_searcher is not None:
        customers = search_customers("")[:2]
        catalog_rows = visible_catalog()[:2]
        if customers and catalog_rows:
            timestamp = now_iso()
            for customer, catalog in zip(customers, catalog_rows):
                order_record = order_payload_to_record(
                    ServiceOrderPayload(
                        customerId=customer["id"],
                        catalogId=catalog["id"],
                        orderType="NEW_INSTALLATION",
                        requestedDate=today_iso(),
                        status="COMPLETED",
                        priority="NORMAL",
                        billingStartDate=today_iso(),
                        orderDetails={
                            "preferredSchedule": today_iso(),
                            "installationFee": catalog.get("installFee", 0),
                            "coverageArea": customer.get("address", ""),
                            "coverageCheckRequired": False,
                        },
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
    seed_service_accounts()


def seed_service_accounts() -> None:
    if service_accounts:
        return
    for order in visible_orders():
        if order_status(order) != "COMPLETED" or (order.get("orderType") or "NEW_INSTALLATION") != "NEW_INSTALLATION":
            continue
        create_or_activate_service_account_from_order(order, "system")


def service_metrics() -> dict[str, int | float]:
    seed_service_data()
    catalog_rows = visible_catalog()
    account_rows = visible_accounts()
    order_rows = visible_orders()
    completed_orders = [order for order in order_rows if order_status(order) == "COMPLETED"]
    active_accounts = [account for account in account_rows if account.get("status") == "ACTIVE"]
    recurring_accounts = [account for account in active_accounts if account.get("catalog", {}).get("billingMode") != "ONE_TIME"]
    return {
        "catalog_items": len(catalog_rows),
        "active_catalog": sum(1 for item in catalog_rows if item["status"] == "ACTIVE"),
        "service_accounts": len(account_rows),
        "active_service_accounts": len(active_accounts),
        "open_orders": sum(1 for order in order_rows if order_status(order) in OPEN_ORDER_STATUSES),
        "in_progress_orders": sum(1 for order in order_rows if order_status(order) == "IN_PROGRESS"),
        "completed_orders": len(completed_orders),
        "active_orders": len(completed_orders),
        "monthly_recurring_value": money(sum(account.get("catalog", {}).get("monthlyRate", 0) for account in recurring_accounts)),
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
        "accountStatuses": ACCOUNT_STATUSES,
        "billingModes": BILLING_MODES,
        "orderTypes": ORDER_TYPES,
        "orderDetailSchemas": ORDER_DETAIL_SCHEMAS,
        "orderDetailRequiredStatuses": DETAIL_REQUIRED_STATUSES,
        "orderStatuses": ORDER_STATUSES,
        "orderPriorities": ORDER_PRIORITIES,
    }


@router.get("/customers")
def service_customers(search: str = "", admin=Depends(require_admin)):
    return search_customers(search)


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


@router.get("/accounts/overview")
def account_overview(admin=Depends(require_admin)):
    seed_service_data()
    rows = visible_accounts()
    return {
        "metrics": service_metrics(),
        "byStatus": {status: sum(1 for account in rows if account.get("status") == status) for status in ACCOUNT_STATUSES},
        "recentAccounts": [account_summary(account) for account in sorted(rows, key=lambda item: item["updatedAt"], reverse=True)[:6]],
    }


@router.get("/accounts")
def list_accounts(
    search: str = "",
    status: str = "",
    customerId: str = "",
    catalogId: str = "",
    activeOnly: bool = Query(default=False),
    admin=Depends(require_admin),
):
    seed_service_data()
    rows = [account for account in visible_accounts() if account_matches(account, search=search, status=status, customer_id=customerId, catalog_id=catalogId)]
    if activeOnly:
        rows = [account for account in rows if account.get("status") == "ACTIVE"]
    return [account_summary(account) for account in sorted(rows, key=lambda item: item["createdAt"], reverse=True)]


@router.post("/accounts")
def create_service_account(payload: ServiceAccountPayload, admin=Depends(require_admin)):
    seed_service_data()
    record = account_payload_to_record(payload)
    if any(account.get("serviceReference") == record["serviceReference"] and not account.get("deletedAt") for account in service_accounts):
        raise HTTPException(status_code=409, detail="Service reference already exists")
    timestamp = now_iso()
    account = {
        "id": str(uuid4()),
        "serviceAccountNumber": next_number("SA", service_accounts),
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": "",
        **record,
    }
    service_accounts.append(account)
    add_audit("service_account_created", "ServiceAccount", account["id"], {"customerId": account["customerId"]}, admin["username"])
    return account_summary(account)


@router.patch("/accounts/{account_id}")
def update_service_account(account_id: str, payload: ServiceAccountPayload, admin=Depends(require_admin)):
    current = find_account(account_id)
    record = account_payload_to_record(payload, current)
    if any(account.get("serviceReference") == record["serviceReference"] and account["id"] != account_id and not account.get("deletedAt") for account in service_accounts):
        raise HTTPException(status_code=409, detail="Service reference already exists")
    current.update(record)
    current["updatedAt"] = now_iso()
    add_audit("service_account_updated", "ServiceAccount", current["id"], {"customerId": current["customerId"]}, admin["username"])
    return account_summary(current)


@router.delete("/accounts/{account_id}")
def archive_service_account(account_id: str, admin=Depends(require_admin)):
    current = find_account(account_id)
    current["status"] = "DISCONNECTED"
    current["deletedAt"] = now_iso()
    current["updatedAt"] = current["deletedAt"]
    add_audit("service_account_archived", "ServiceAccount", current["id"], {"customerId": current["customerId"]}, admin["username"])
    return {"status": "ok"}


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
    if any(order["catalogId"] == catalog_id and order_status(order) in OPEN_ORDER_STATUSES + ["COMPLETED"] for order in visible_orders()):
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
        "byStatus": {status: sum(1 for order in rows if order_status(order) == status) for status in ORDER_STATUSES},
        "byType": {order_type: sum(1 for order in rows if order.get("orderType") == order_type) for order_type in ORDER_TYPES},
        "recentOrders": [order_summary(order) for order in sorted(rows, key=lambda item: item["updatedAt"], reverse=True)[:6]],
    }


@router.get("/orders")
def list_orders(
    search: str = "",
    status: str = "",
    orderType: str = "",
    customerId: str = "",
    serviceAccountId: str = "",
    activeOnly: bool = Query(default=False),
    admin=Depends(require_admin),
):
    seed_service_data()
    rows = [
        order
        for order in visible_orders()
        if order_matches(order, search=search, status=status, customer_id=customerId, order_type=orderType, service_account_id=serviceAccountId)
    ]
    if activeOnly:
        rows = [order for order in rows if order_status(order) == "COMPLETED"]
    return [order_summary(order) for order in sorted(rows, key=lambda item: item["createdAt"], reverse=True)]


@router.post("/orders")
def create_service_order(payload: ServiceOrderPayload, admin=Depends(require_admin)):
    seed_service_data()
    record = order_payload_to_record(payload)
    ensure_no_conflicting_open_order(record)
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
    try:
        create_ticket_for_order(order, admin["username"])
    except Exception:
        service_orders.remove(order)
        raise
    apply_completed_order_effects(order, admin["username"])
    add_audit(
        "service_order_created",
        "ServiceOrder",
        order["id"],
        {"customerId": order["customerId"], "ticketNumber": order.get("ticketNumber", "")},
        admin["username"],
    )
    return order_summary(order)


@router.patch("/orders/{order_id}")
def update_service_order(order_id: str, payload: ServiceOrderPayload, admin=Depends(require_admin)):
    current = find_order(order_id)
    record = order_payload_to_record(payload, current)
    ensure_no_conflicting_open_order(record, current_id=order_id)
    current.update(record)
    current["updatedAt"] = now_iso()
    apply_completed_order_effects(current, admin["username"])
    add_audit("service_order_updated", "ServiceOrder", current["id"], {"customerId": current["customerId"]}, admin["username"])
    return order_summary(current)


@router.delete("/orders/{order_id}")
def cancel_service_order(order_id: str, admin=Depends(require_admin)):
    current = find_order(order_id)
    current["status"] = "CANCELLED"
    current["cancelledAt"] = now_iso()
    current["updatedAt"] = current["cancelledAt"]
    add_audit("service_order_cancelled", "ServiceOrder", current["id"], {"customerId": current["customerId"]}, admin["username"])
    return {"status": "ok"}
