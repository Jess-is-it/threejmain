from datetime import date, datetime, timezone
from typing import Any, Callable
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field


router = APIRouter(prefix="/api/customer-service-management", tags=["customer-service-management"])

service_requests: list[dict[str, Any]] = []
interactions: list[dict[str, Any]] = []
follow_ups: list[dict[str, Any]] = []

_current_admin: Callable[[str | None], dict[str, Any]] | None = None
_audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None] | None = None
_customer_resolver: Callable[[str], dict[str, Any]] | None = None
_customer_searcher: Callable[[str], list[dict[str, Any]]] | None = None
_customer_seed: Callable[[], None] | None = None

CHANNELS = ["WALK_IN", "PHONE", "SMS", "FACEBOOK", "EMAIL", "FIELD_VISIT", "SYSTEM"]
REQUEST_CATEGORIES = ["GENERAL_INQUIRY", "BILLING_CONCERN", "SERVICE_CHANGE", "COMPLAINT", "RETENTION", "FOLLOW_UP", "OTHER"]
REQUEST_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "ESCALATED", "RESOLVED", "CLOSED", "CANCELLED"]
PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"]
INTERACTION_TYPES = ["CALL", "SMS", "FACEBOOK_MESSAGE", "EMAIL", "WALK_IN", "FIELD_NOTE", "INTERNAL_NOTE"]
INTERACTION_DIRECTIONS = ["INBOUND", "OUTBOUND", "INTERNAL"]
FOLLOW_UP_TYPES = ["CALLBACK", "MESSAGE", "FIELD_VISIT", "BILLING_REVIEW", "RETENTION_CHECK", "OTHER"]
FOLLOW_UP_STATUSES = ["PENDING", "DONE", "MISSED", "CANCELLED"]

FALLBACK_CUSTOMERS = [
    {
        "id": "placeholder-customer-1",
        "accountNumber": "58392741",
        "name": "MARIA SANTOS",
        "status": "ACTIVE",
        "contactNumber": "09171234567",
        "address": "ALIBAGO, ENRILE, CAGAYAN",
    },
    {
        "id": "placeholder-customer-2",
        "accountNumber": "76149028",
        "name": "JUAN DELA CRUZ",
        "status": "PENDING",
        "contactNumber": "09180000001",
        "address": "BATU, ENRILE, CAGAYAN",
    },
]


class ServiceRequestPayload(BaseModel):
    customerId: str | None = None
    channel: str | None = None
    category: str | None = None
    priority: str | None = None
    status: str | None = None
    subject: str | None = Field(default=None, max_length=180)
    description: str | None = None
    assignedTo: str | None = None
    dueDate: str | None = None
    resolution: str | None = None
    tags: list[str] = Field(default_factory=list)


class InteractionPayload(BaseModel):
    requestId: str | None = None
    customerId: str | None = None
    type: str | None = None
    direction: str | None = None
    occurredAt: str | None = None
    summary: str | None = Field(default=None, max_length=240)
    details: str | None = None
    outcome: str | None = None
    agentName: str | None = None


class FollowUpPayload(BaseModel):
    requestId: str | None = None
    customerId: str | None = None
    type: str | None = None
    status: str | None = None
    dueAt: str | None = None
    assignedTo: str | None = None
    notes: str | None = None
    completedAt: str | None = None


def configure_customer_service_management(
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
        raise HTTPException(status_code=500, detail="Customer Service Management module is not configured")
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


def parse_day(value: str | None, field_name: str, required: bool = False) -> str | None:
    if not value:
        if required:
            raise HTTPException(status_code=400, detail=f"{field_name} is required")
        return None
    try:
        return date.fromisoformat(value[:10]).isoformat()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{field_name} must be YYYY-MM-DD") from exc


def parse_timestamp(value: str | None, field_name: str, required: bool = False) -> str | None:
    if not value:
        if required:
            raise HTTPException(status_code=400, detail=f"{field_name} is required")
        return None
    normalized = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{field_name} must be an ISO timestamp") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def customer_name(customer: dict[str, Any]) -> str:
    parts = [customer.get("firstName"), customer.get("middleName"), customer.get("lastName")]
    return " ".join(str(part).strip() for part in parts if str(part or "").strip()) or customer.get("fullName") or customer.get("name") or "Unnamed customer"


def customer_snapshot(customer: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": customer["id"],
        "accountNumber": customer.get("accountNumber", ""),
        "name": customer_name(customer),
        "status": customer.get("status", ""),
        "contactNumber": customer.get("contactNumber", ""),
        "address": customer.get("address")
        or ", ".join(
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
    if _customer_resolver is not None:
        return customer_snapshot(_customer_resolver(customer_id))
    for customer in FALLBACK_CUSTOMERS:
        if customer["id"] == customer_id:
            return customer
    raise HTTPException(status_code=404, detail="Customer not found")


def search_customers(search: str = "") -> list[dict[str, Any]]:
    seed_customers()
    if _customer_searcher is not None:
        return [customer_snapshot(customer) for customer in _customer_searcher(search)]
    needle = search.strip().lower()
    rows = FALLBACK_CUSTOMERS
    if needle:
        rows = [
            customer
            for customer in rows
            if needle in customer["accountNumber"].lower()
            or needle in customer["name"].lower()
            or needle in customer["contactNumber"].lower()
        ]
    return rows


def visible_requests() -> list[dict[str, Any]]:
    return [request for request in service_requests if not request.get("deletedAt")]


def visible_interactions() -> list[dict[str, Any]]:
    return [interaction for interaction in interactions if not interaction.get("deletedAt")]


def visible_follow_ups() -> list[dict[str, Any]]:
    return [follow_up for follow_up in follow_ups if not follow_up.get("deletedAt")]


def find_row(rows: list[dict[str, Any]], row_id: str, label: str) -> dict[str, Any]:
    for row in rows:
        if row["id"] == row_id and not row.get("deletedAt"):
            return row
    raise HTTPException(status_code=404, detail=f"{label} not found")


def find_request(request_id: str) -> dict[str, Any]:
    return find_row(service_requests, request_id, "Service request")


def find_interaction(interaction_id: str) -> dict[str, Any]:
    return find_row(interactions, interaction_id, "Interaction")


def find_follow_up(follow_up_id: str) -> dict[str, Any]:
    return find_row(follow_ups, follow_up_id, "Follow-up")


def next_number(prefix: str, rows: list[dict[str, Any]]) -> str:
    return f"{prefix}-{datetime.now(timezone.utc).strftime('%Y%m')}-{len(rows) + 1:04d}"


def validate_choice(field_name: str, value: Any, choices: list[str], default: str) -> str:
    normalized = normalize_upper(value or default)
    if normalized not in choices:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}")
    return normalized


def normalize_tags(tags: list[str] | None) -> list[str]:
    return [tag.strip() for tag in tags or [] if tag and tag.strip()]


def request_payload_to_record(payload: ServiceRequestPayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
    record = dict(current or {})
    data = payload.model_dump(exclude_unset=True)
    record.update({key: value for key, value in data.items() if value is not None})
    missing = [field for field in ["customerId", "subject", "description"] if not record.get(field)]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required service request fields: {', '.join(missing)}")
    record["customer"] = resolve_customer(record["customerId"])
    record["channel"] = validate_choice("channel", record.get("channel"), CHANNELS, "PHONE")
    record["category"] = validate_choice("category", record.get("category"), REQUEST_CATEGORIES, "GENERAL_INQUIRY")
    record["priority"] = validate_choice("priority", record.get("priority"), PRIORITIES, "NORMAL")
    record["status"] = validate_choice("status", record.get("status"), REQUEST_STATUSES, "OPEN")
    record["dueDate"] = parse_day(record.get("dueDate"), "dueDate")
    record["subject"] = str(record["subject"]).strip()
    record["description"] = str(record["description"]).strip()
    record["assignedTo"] = str(record.get("assignedTo") or "").strip()
    record["resolution"] = str(record.get("resolution") or "").strip()
    record["tags"] = normalize_tags(record.get("tags"))
    if record["status"] in ["RESOLVED", "CLOSED"] and not record.get("resolvedAt"):
        record["resolvedAt"] = now_iso()
    if record["status"] not in ["RESOLVED", "CLOSED"]:
        record["resolvedAt"] = None
    return record


def interaction_payload_to_record(payload: InteractionPayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
    record = dict(current or {})
    data = payload.model_dump(exclude_unset=True)
    record.update({key: value for key, value in data.items() if value is not None})
    if record.get("requestId"):
        service_request = find_request(record["requestId"])
        record["customerId"] = record.get("customerId") or service_request["customerId"]
    missing = [field for field in ["customerId", "summary"] if not record.get(field)]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required interaction fields: {', '.join(missing)}")
    record["customer"] = resolve_customer(record["customerId"])
    record["type"] = validate_choice("interaction type", record.get("type"), INTERACTION_TYPES, "CALL")
    record["direction"] = validate_choice("interaction direction", record.get("direction"), INTERACTION_DIRECTIONS, "INBOUND")
    record["occurredAt"] = parse_timestamp(record.get("occurredAt") or now_iso(), "occurredAt", required=True)
    record["summary"] = str(record["summary"]).strip()
    record["details"] = str(record.get("details") or "").strip()
    record["outcome"] = str(record.get("outcome") or "").strip()
    record["agentName"] = str(record.get("agentName") or "").strip()
    return record


def follow_up_payload_to_record(payload: FollowUpPayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
    record = dict(current or {})
    data = payload.model_dump(exclude_unset=True)
    record.update({key: value for key, value in data.items() if value is not None})
    if record.get("requestId"):
        service_request = find_request(record["requestId"])
        record["customerId"] = record.get("customerId") or service_request["customerId"]
    missing = [field for field in ["customerId", "dueAt"] if not record.get(field)]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required follow-up fields: {', '.join(missing)}")
    record["customer"] = resolve_customer(record["customerId"])
    record["type"] = validate_choice("follow-up type", record.get("type"), FOLLOW_UP_TYPES, "CALLBACK")
    record["status"] = validate_choice("follow-up status", record.get("status"), FOLLOW_UP_STATUSES, "PENDING")
    record["dueAt"] = parse_timestamp(record.get("dueAt"), "dueAt", required=True)
    record["completedAt"] = parse_timestamp(record.get("completedAt"), "completedAt") if record.get("completedAt") else None
    if record["status"] == "DONE" and not record.get("completedAt"):
        record["completedAt"] = now_iso()
    if record["status"] != "DONE":
        record["completedAt"] = None
    record["assignedTo"] = str(record.get("assignedTo") or "").strip()
    record["notes"] = str(record.get("notes") or "").strip()
    return record


def customer_service_metrics() -> dict[str, int]:
    seed_customer_service_data()
    open_statuses = {"OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "ESCALATED"}
    today = today_iso()
    return {
        "open_requests": sum(1 for request in visible_requests() if request["status"] in open_statuses),
        "callbacks_due": sum(1 for follow_up in visible_follow_ups() if follow_up["status"] == "PENDING" and follow_up["dueAt"][:10] <= today),
        "sla_risks": sum(
            1
            for request in visible_requests()
            if request["status"] in open_statuses and request.get("dueDate") and request["dueDate"] <= today
        ),
        "interactions_today": sum(1 for interaction in visible_interactions() if interaction["occurredAt"][:10] == today),
    }


def seed_customer_service_data() -> None:
    if service_requests:
        return
    customers = search_customers("")[:2]
    if not customers:
        customers = FALLBACK_CUSTOMERS
    timestamp = now_iso()
    due = today_iso()
    seed_rows = [
        {
            "customer": customers[0],
            "customerId": customers[0]["id"],
            "channel": "PHONE",
            "category": "GENERAL_INQUIRY",
            "priority": "NORMAL",
            "status": "OPEN",
            "subject": "Plan upgrade inquiry",
            "description": "Customer asked about available fiber plan upgrades and monthly pricing.",
            "assignedTo": "Front Desk",
            "dueDate": due,
            "resolution": "",
            "tags": ["upgrade", "sales"],
        },
        {
            "customer": customers[min(1, len(customers) - 1)],
            "customerId": customers[min(1, len(customers) - 1)]["id"],
            "channel": "FACEBOOK",
            "category": "COMPLAINT",
            "priority": "HIGH",
            "status": "IN_PROGRESS",
            "subject": "Recurring slow connection concern",
            "description": "Customer reported slow evening speeds and requested a status update.",
            "assignedTo": "Care Team",
            "dueDate": due,
            "resolution": "",
            "tags": ["speed", "follow-up"],
        },
    ]
    for row in seed_rows:
        request_id = str(uuid4())
        service_requests.append(
            {
                "id": request_id,
                "requestNumber": next_number("CSR", service_requests),
                "createdAt": timestamp,
                "updatedAt": timestamp,
                "deletedAt": None,
                "resolvedAt": None,
                **row,
            }
        )
    first = service_requests[0]
    interactions.append(
        {
            "id": str(uuid4()),
            "requestId": first["id"],
            "customerId": first["customerId"],
            "customer": first["customer"],
            "type": "CALL",
            "direction": "INBOUND",
            "occurredAt": timestamp,
            "summary": "Customer asked about upgrade availability.",
            "details": "Explained current placeholder plan options; needs follow-up after Billing plans are connected.",
            "outcome": "Follow-up scheduled",
            "agentName": "Front Desk",
            "createdAt": timestamp,
            "updatedAt": timestamp,
            "deletedAt": None,
        }
    )
    follow_ups.append(
        {
            "id": str(uuid4()),
            "requestId": first["id"],
            "customerId": first["customerId"],
            "customer": first["customer"],
            "type": "CALLBACK",
            "status": "PENDING",
            "dueAt": datetime.now(timezone.utc).replace(hour=17, minute=0, second=0, microsecond=0).isoformat(),
            "assignedTo": "Front Desk",
            "notes": "Call back with available plan options.",
            "completedAt": None,
            "createdAt": timestamp,
            "updatedAt": timestamp,
            "deletedAt": None,
        }
    )


def filter_by_common_fields(rows: list[dict[str, Any]], search: str = "", status: str = "", customer_id: str = "") -> list[dict[str, Any]]:
    filtered = rows
    if customer_id:
        filtered = [row for row in filtered if row.get("customerId") == customer_id]
    if status:
        filtered = [row for row in filtered if normalize_upper(row.get("status")) == normalize_upper(status)]
    if search:
        needle = search.strip().lower()
        filtered = [
            row
            for row in filtered
            if needle in str(row.get("requestNumber", "")).lower()
            or needle in str(row.get("subject", "")).lower()
            or needle in str(row.get("summary", "")).lower()
            or needle in str(row.get("customer", {}).get("name", "")).lower()
            or needle in str(row.get("customer", {}).get("accountNumber", "")).lower()
        ]
    return filtered


@router.get("/meta")
def customer_service_meta(admin=Depends(require_admin)):
    return {
        "channels": CHANNELS,
        "requestCategories": REQUEST_CATEGORIES,
        "requestStatuses": REQUEST_STATUSES,
        "priorities": PRIORITIES,
        "interactionTypes": INTERACTION_TYPES,
        "interactionDirections": INTERACTION_DIRECTIONS,
        "followUpTypes": FOLLOW_UP_TYPES,
        "followUpStatuses": FOLLOW_UP_STATUSES,
    }


@router.get("/customers")
def customer_service_customers(search: str = "", admin=Depends(require_admin)):
    return search_customers(search)[:50]


@router.get("/overview")
def customer_service_overview(admin=Depends(require_admin)):
    seed_customer_service_data()
    return {
        "metrics": customer_service_metrics(),
        "recentRequests": sorted(visible_requests(), key=lambda row: row["createdAt"], reverse=True)[:5],
        "dueFollowUps": sorted(
            [follow_up for follow_up in visible_follow_ups() if follow_up["status"] == "PENDING"],
            key=lambda row: row["dueAt"],
        )[:5],
        "recentInteractions": sorted(visible_interactions(), key=lambda row: row["occurredAt"], reverse=True)[:5],
    }


@router.get("/service-requests")
def list_service_requests(search: str = "", status: str = "", customerId: str = "", admin=Depends(require_admin)):
    seed_customer_service_data()
    rows = filter_by_common_fields(visible_requests(), search, status, customerId)
    return sorted(rows, key=lambda row: row["createdAt"], reverse=True)


@router.post("/service-requests")
def create_service_request(payload: ServiceRequestPayload, admin=Depends(require_admin)):
    record = request_payload_to_record(payload)
    timestamp = now_iso()
    row = {
        "id": str(uuid4()),
        "requestNumber": next_number("CSR", service_requests),
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
        "resolvedAt": None,
        **record,
    }
    service_requests.append(row)
    add_audit("customer_service_request_created", "CustomerServiceRequest", row["id"], {"customerId": row["customerId"]}, admin["username"])
    return row


@router.patch("/service-requests/{request_id}")
def update_service_request(request_id: str, payload: ServiceRequestPayload, admin=Depends(require_admin)):
    current = find_request(request_id)
    record = request_payload_to_record(payload, current)
    current.update(record)
    current["updatedAt"] = now_iso()
    add_audit("customer_service_request_updated", "CustomerServiceRequest", current["id"], {"status": current["status"]}, admin["username"])
    return current


@router.delete("/service-requests/{request_id}")
def delete_service_request(request_id: str, admin=Depends(require_admin)):
    current = find_request(request_id)
    current["deletedAt"] = now_iso()
    current["updatedAt"] = current["deletedAt"]
    add_audit("customer_service_request_deleted", "CustomerServiceRequest", current["id"], {"customerId": current["customerId"]}, admin["username"])
    return {"status": "ok"}


@router.get("/service-requests/{request_id}/interactions")
def list_request_interactions(request_id: str, admin=Depends(require_admin)):
    find_request(request_id)
    return sorted(
        [interaction for interaction in visible_interactions() if interaction.get("requestId") == request_id],
        key=lambda row: row["occurredAt"],
        reverse=True,
    )


@router.get("/interactions")
def list_interactions(search: str = "", customerId: str = "", requestId: str = "", admin=Depends(require_admin)):
    seed_customer_service_data()
    rows = visible_interactions()
    if requestId:
        rows = [row for row in rows if row.get("requestId") == requestId]
    rows = filter_by_common_fields(rows, search, "", customerId)
    return sorted(rows, key=lambda row: row["occurredAt"], reverse=True)


@router.post("/interactions")
def create_interaction(payload: InteractionPayload, admin=Depends(require_admin)):
    record = interaction_payload_to_record(payload)
    timestamp = now_iso()
    row = {"id": str(uuid4()), "createdAt": timestamp, "updatedAt": timestamp, "deletedAt": None, **record}
    interactions.append(row)
    add_audit("customer_interaction_created", "CustomerInteraction", row["id"], {"customerId": row["customerId"]}, admin["username"])
    return row


@router.patch("/interactions/{interaction_id}")
def update_interaction(interaction_id: str, payload: InteractionPayload, admin=Depends(require_admin)):
    current = find_interaction(interaction_id)
    record = interaction_payload_to_record(payload, current)
    current.update(record)
    current["updatedAt"] = now_iso()
    add_audit("customer_interaction_updated", "CustomerInteraction", current["id"], {"customerId": current["customerId"]}, admin["username"])
    return current


@router.delete("/interactions/{interaction_id}")
def delete_interaction(interaction_id: str, admin=Depends(require_admin)):
    current = find_interaction(interaction_id)
    current["deletedAt"] = now_iso()
    current["updatedAt"] = current["deletedAt"]
    add_audit("customer_interaction_deleted", "CustomerInteraction", current["id"], {"customerId": current["customerId"]}, admin["username"])
    return {"status": "ok"}


@router.get("/follow-ups")
def list_follow_ups(search: str = "", status: str = "", customerId: str = "", requestId: str = "", admin=Depends(require_admin)):
    seed_customer_service_data()
    rows = visible_follow_ups()
    if requestId:
        rows = [row for row in rows if row.get("requestId") == requestId]
    rows = filter_by_common_fields(rows, search, status, customerId)
    return sorted(rows, key=lambda row: row["dueAt"])


@router.post("/follow-ups")
def create_follow_up(payload: FollowUpPayload, admin=Depends(require_admin)):
    record = follow_up_payload_to_record(payload)
    timestamp = now_iso()
    row = {"id": str(uuid4()), "createdAt": timestamp, "updatedAt": timestamp, "deletedAt": None, **record}
    follow_ups.append(row)
    add_audit("customer_follow_up_created", "CustomerFollowUp", row["id"], {"customerId": row["customerId"]}, admin["username"])
    return row


@router.patch("/follow-ups/{follow_up_id}")
def update_follow_up(follow_up_id: str, payload: FollowUpPayload, admin=Depends(require_admin)):
    current = find_follow_up(follow_up_id)
    record = follow_up_payload_to_record(payload, current)
    current.update(record)
    current["updatedAt"] = now_iso()
    add_audit("customer_follow_up_updated", "CustomerFollowUp", current["id"], {"status": current["status"]}, admin["username"])
    return current


@router.delete("/follow-ups/{follow_up_id}")
def delete_follow_up(follow_up_id: str, admin=Depends(require_admin)):
    current = find_follow_up(follow_up_id)
    current["deletedAt"] = now_iso()
    current["updatedAt"] = current["deletedAt"]
    add_audit("customer_follow_up_deleted", "CustomerFollowUp", current["id"], {"customerId": current["customerId"]}, admin["username"])
    return {"status": "ok"}
