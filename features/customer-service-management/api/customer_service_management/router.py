from datetime import date, datetime, timezone
import json
from typing import Any, Callable
from urllib import error as urlerror
from urllib import request as urlrequest
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field


router = APIRouter(prefix="/api/customer-service-management", tags=["customer-service-management"])

service_requests: list[dict[str, Any]] = []
interactions: list[dict[str, Any]] = []
follow_ups: list[dict[str, Any]] = []
inbox_threads: list[dict[str, Any]] = []
inbox_messages: list[dict[str, Any]] = []

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
OMNI_CHANNELS = ["FACEBOOK", "TELEGRAM", "WHATSAPP"]
INBOX_THREAD_STATUSES = ["OPEN", "PENDING_AGENT", "PENDING_CUSTOMER", "RESOLVED"]
MESSAGE_DIRECTIONS = ["INBOUND", "OUTBOUND"]
FACEBOOK_WEBHOOK_PATH = "/api/customer-service-management/channels/facebook/webhook"
FACEBOOK_SEND_API_VERSION = "v25.0"

channel_settings: dict[str, dict[str, Any]] = {
    "FACEBOOK": {
        "channel": "FACEBOOK",
        "displayName": "Facebook Messenger",
        "enabled": False,
        "connectionStatus": "NOT_CONFIGURED",
        "pageName": "",
        "pageId": "",
        "appId": "",
        "verifyToken": "change-this-facebook-webhook-token",
        "pageAccessToken": "",
        "graphApiVersion": FACEBOOK_SEND_API_VERSION,
        "webhookPath": FACEBOOK_WEBHOOK_PATH,
        "subscribedFields": ["messages", "messaging_postbacks"],
        "lastCheckedAt": None,
        "lastError": "",
        "notes": "Configure Messenger webhooks in Meta with this callback path and verify token.",
    },
    "TELEGRAM": {
        "channel": "TELEGRAM",
        "displayName": "Telegram",
        "enabled": False,
        "connectionStatus": "PLANNED",
        "botName": "",
        "webhookPath": "/api/customer-service-management/channels/telegram/webhook",
        "notes": "Placeholder only. Telegram bot token and webhook processing will be added later.",
    },
    "WHATSAPP": {
        "channel": "WHATSAPP",
        "displayName": "WhatsApp",
        "enabled": False,
        "connectionStatus": "PLANNED",
        "businessAccountName": "",
        "phoneNumberId": "",
        "webhookPath": "/api/customer-service-management/channels/whatsapp/webhook",
        "notes": "Placeholder only. WhatsApp Cloud API setup will be added later.",
    },
}

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


class FacebookChannelSettingsPayload(BaseModel):
    enabled: bool | None = None
    pageName: str | None = Field(default=None, max_length=120)
    pageId: str | None = Field(default=None, max_length=80)
    appId: str | None = Field(default=None, max_length=80)
    verifyToken: str | None = Field(default=None, max_length=160)
    pageAccessToken: str | None = None
    graphApiVersion: str | None = Field(default=None, max_length=20)
    notes: str | None = None


class InboxThreadPayload(BaseModel):
    status: str | None = None
    assignedTo: str | None = None
    linkedRequestId: str | None = None
    customerId: str | None = None


class InboxReplyPayload(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    agentName: str | None = Field(default=None, max_length=120)
    sendViaFacebook: bool = True


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


def visible_inbox_threads() -> list[dict[str, Any]]:
    return [thread for thread in inbox_threads if not thread.get("deletedAt")]


def visible_inbox_messages() -> list[dict[str, Any]]:
    return [message for message in inbox_messages if not message.get("deletedAt")]


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


def find_inbox_thread(thread_id: str) -> dict[str, Any]:
    return find_row(inbox_threads, thread_id, "Inbox thread")


def next_number(prefix: str, rows: list[dict[str, Any]]) -> str:
    return f"{prefix}-{datetime.now(timezone.utc).strftime('%Y%m')}-{len(rows) + 1:04d}"


def validate_choice(field_name: str, value: Any, choices: list[str], default: str) -> str:
    normalized = normalize_upper(value or default)
    if normalized not in choices:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}")
    return normalized


def normalize_tags(tags: list[str] | None) -> list[str]:
    return [tag.strip() for tag in tags or [] if tag and tag.strip()]


def clean_text(value: Any, max_length: int | None = None) -> str:
    text = str(value or "").strip()
    return text[:max_length] if max_length else text


def mask_secret(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}...{value[-4:]}"


def channel_settings_summary() -> dict[str, dict[str, Any]]:
    summary: dict[str, dict[str, Any]] = {}
    for channel, settings in channel_settings.items():
        row = dict(settings)
        if channel == "FACEBOOK":
            row["pageAccessTokenConfigured"] = bool(row.get("pageAccessToken"))
            row["pageAccessTokenMasked"] = mask_secret(row.get("pageAccessToken", ""))
            row.pop("pageAccessToken", None)
        summary[channel] = row
    return summary


def facebook_settings_ready() -> tuple[bool, list[str]]:
    settings = channel_settings["FACEBOOK"]
    missing = [
        label
        for label, value in [
            ("Page ID", settings.get("pageId")),
            ("App ID", settings.get("appId")),
            ("Verify token", settings.get("verifyToken")),
            ("Page access token", settings.get("pageAccessToken")),
        ]
        if not value
    ]
    return not missing, missing


def update_facebook_connection_status() -> str:
    settings = channel_settings["FACEBOOK"]
    ready, missing = facebook_settings_ready()
    if not settings.get("enabled"):
        status = "DISABLED"
    elif ready:
        status = "READY"
    else:
        status = "NEEDS_SETUP"
    settings["connectionStatus"] = status
    settings["lastError"] = "" if ready else f"Missing: {', '.join(missing)}"
    return status


def thread_customer_snapshot(customer_id: str | None, external_user_id: str, fallback_name: str = "") -> dict[str, Any]:
    if customer_id:
        try:
            return resolve_customer(customer_id)
        except HTTPException:
            pass
    return {
        "id": customer_id or "",
        "accountNumber": external_user_id,
        "name": fallback_name or f"Facebook PSID {external_user_id[-6:] if external_user_id else 'unknown'}",
        "status": "UNMATCHED",
        "contactNumber": "",
        "address": "",
    }


def find_or_create_inbox_thread(
    channel: str,
    external_user_id: str,
    external_page_id: str = "",
    customer_id: str | None = None,
    customer_name_hint: str = "",
) -> dict[str, Any]:
    for thread in visible_inbox_threads():
        if thread.get("channel") == channel and thread.get("externalUserId") == external_user_id:
            if customer_id and not thread.get("customerId"):
                thread["customerId"] = customer_id
                thread["customer"] = thread_customer_snapshot(customer_id, external_user_id, customer_name_hint)
            if external_page_id:
                thread["externalPageId"] = external_page_id
            return thread

    timestamp = now_iso()
    thread = {
        "id": str(uuid4()),
        "channel": channel,
        "status": "OPEN",
        "assignedTo": "Care Team",
        "linkedRequestId": None,
        "customerId": customer_id or "",
        "customer": thread_customer_snapshot(customer_id, external_user_id, customer_name_hint),
        "externalUserId": external_user_id,
        "externalPageId": external_page_id,
        "lastMessageAt": timestamp,
        "unreadCount": 0,
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
    }
    inbox_threads.append(thread)
    return thread


def create_inbox_message(
    thread: dict[str, Any],
    direction: str,
    text: str,
    actor_name: str,
    external_message_id: str = "",
    delivery_status: str = "RECEIVED",
    raw_event: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if external_message_id:
        for message in visible_inbox_messages():
            if message["threadId"] == thread["id"] and message.get("externalMessageId") == external_message_id:
                return message
    timestamp = now_iso()
    row = {
        "id": str(uuid4()),
        "threadId": thread["id"],
        "channel": thread["channel"],
        "direction": validate_choice("message direction", direction, MESSAGE_DIRECTIONS, "INBOUND"),
        "text": clean_text(text, 2000),
        "actorName": clean_text(actor_name, 120),
        "externalMessageId": external_message_id,
        "deliveryStatus": delivery_status,
        "rawEvent": raw_event or {},
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
    }
    inbox_messages.append(row)
    thread["lastMessageAt"] = timestamp
    thread["updatedAt"] = timestamp
    thread["status"] = "PENDING_AGENT" if direction == "INBOUND" else "PENDING_CUSTOMER"
    thread["unreadCount"] = thread.get("unreadCount", 0) + (1 if direction == "INBOUND" else 0)
    return row


def messages_for_thread(thread_id: str) -> list[dict[str, Any]]:
    return sorted(
        [message for message in visible_inbox_messages() if message["threadId"] == thread_id],
        key=lambda row: row["createdAt"],
    )


def inbox_thread_summary(thread: dict[str, Any]) -> dict[str, Any]:
    messages = messages_for_thread(thread["id"])
    last_message = messages[-1] if messages else None
    return {
        **thread,
        "messageCount": len(messages),
        "lastMessage": last_message,
    }


def send_facebook_message(psid: str, text: str) -> tuple[str, dict[str, Any]]:
    settings = channel_settings["FACEBOOK"]
    token = settings.get("pageAccessToken")
    if not token:
        return "LOCAL_ONLY", {"detail": "No Page access token configured"}
    version = clean_text(settings.get("graphApiVersion") or FACEBOOK_SEND_API_VERSION).lstrip("/")
    endpoint = f"https://graph.facebook.com/{version}/me/messages?access_token={token}"
    payload = {
        "recipient": {"id": psid},
        "message": {"text": text},
        "messaging_type": "RESPONSE",
    }
    data = json.dumps(payload).encode("utf-8")
    request = urlrequest.Request(endpoint, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlrequest.urlopen(request, timeout=10) as response:
            response_body = json.loads(response.read().decode("utf-8") or "{}")
            return "SENT", response_body
    except urlerror.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return "FAILED", {"status": exc.code, "detail": body}
    except urlerror.URLError as exc:
        return "FAILED", {"detail": str(exc.reason)}


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
        "inbox_unread": sum(thread.get("unreadCount", 0) for thread in visible_inbox_threads()),
        "facebook_threads": sum(1 for thread in visible_inbox_threads() if thread.get("channel") == "FACEBOOK"),
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
    facebook_thread = find_or_create_inbox_thread(
        "FACEBOOK",
        "psid-demo-58392741",
        channel_settings["FACEBOOK"].get("pageId", ""),
        first["customerId"],
        first["customer"]["name"],
    )
    create_inbox_message(
        facebook_thread,
        "INBOUND",
        "Hi, can you confirm if my fiber upgrade request is already available?",
        first["customer"]["name"],
        "mid.demo.1",
        "RECEIVED",
        {"source": "seed"},
    )
    create_inbox_message(
        facebook_thread,
        "OUTBOUND",
        "We are checking your area availability and will update you today.",
        "Front Desk",
        "local.demo.1",
        "LOCAL_ONLY",
        {"source": "seed"},
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
        "omniChannels": OMNI_CHANNELS,
        "inboxThreadStatuses": INBOX_THREAD_STATUSES,
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
        "recentInboxThreads": sorted(
            [inbox_thread_summary(thread) for thread in visible_inbox_threads()],
            key=lambda row: row["lastMessageAt"],
            reverse=True,
        )[:5],
    }


@router.get("/channel-settings")
def get_channel_settings(admin=Depends(require_admin)):
    update_facebook_connection_status()
    return channel_settings_summary()


@router.patch("/channel-settings/facebook")
def update_facebook_settings(payload: FacebookChannelSettingsPayload, admin=Depends(require_admin)):
    settings = channel_settings["FACEBOOK"]
    data = payload.model_dump(exclude_unset=True)
    for key in ["pageName", "pageId", "appId", "verifyToken", "graphApiVersion", "notes"]:
        if key in data and data[key] is not None:
            settings[key] = clean_text(data[key], 2000 if key == "notes" else None)
    if "enabled" in data and data["enabled"] is not None:
        settings["enabled"] = bool(data["enabled"])
    if data.get("pageAccessToken"):
        settings["pageAccessToken"] = clean_text(data["pageAccessToken"])
    settings["updatedAt"] = now_iso()
    status = update_facebook_connection_status()
    add_audit(
        "customer_service_facebook_settings_updated",
        "CustomerServiceChannelSettings",
        "FACEBOOK",
        {"status": status, "pageId": settings.get("pageId", "")},
        admin["username"],
    )
    return channel_settings_summary()["FACEBOOK"]


@router.post("/channel-settings/facebook/check")
def check_facebook_settings(admin=Depends(require_admin)):
    ready, missing = facebook_settings_ready()
    status = update_facebook_connection_status()
    channel_settings["FACEBOOK"]["lastCheckedAt"] = now_iso()
    return {
        "ready": ready,
        "status": status,
        "missing": missing,
        "webhookPath": FACEBOOK_WEBHOOK_PATH,
        "requiredWebhookFields": channel_settings["FACEBOOK"]["subscribedFields"],
        "sendApiReady": bool(channel_settings["FACEBOOK"].get("pageAccessToken")),
    }


@router.get("/omni-channel/inbox")
def list_omni_channel_inbox(channel: str = "", status: str = "", search: str = "", admin=Depends(require_admin)):
    seed_customer_service_data()
    rows = visible_inbox_threads()
    if channel:
        rows = [row for row in rows if row["channel"] == normalize_upper(channel)]
    if status:
        rows = [row for row in rows if row["status"] == normalize_upper(status)]
    if search:
        needle = search.strip().lower()
        rows = [
            row
            for row in rows
            if needle in str(row.get("customer", {}).get("name", "")).lower()
            or needle in str(row.get("customer", {}).get("accountNumber", "")).lower()
            or needle in str(row.get("externalUserId", "")).lower()
            or any(needle in message["text"].lower() for message in messages_for_thread(row["id"]))
        ]
    return sorted([inbox_thread_summary(row) for row in rows], key=lambda row: row["lastMessageAt"], reverse=True)


@router.get("/omni-channel/inbox/{thread_id}")
def get_omni_channel_thread(thread_id: str, admin=Depends(require_admin)):
    thread = find_inbox_thread(thread_id)
    return {
        "thread": inbox_thread_summary(thread),
        "messages": messages_for_thread(thread_id),
    }


@router.patch("/omni-channel/inbox/{thread_id}")
def update_omni_channel_thread(thread_id: str, payload: InboxThreadPayload, admin=Depends(require_admin)):
    thread = find_inbox_thread(thread_id)
    data = payload.model_dump(exclude_unset=True)
    if data.get("status"):
        thread["status"] = validate_choice("thread status", data["status"], INBOX_THREAD_STATUSES, thread["status"])
        if thread["status"] == "RESOLVED":
            thread["unreadCount"] = 0
    if "assignedTo" in data and data["assignedTo"] is not None:
        thread["assignedTo"] = clean_text(data["assignedTo"], 120)
    if "linkedRequestId" in data and data["linkedRequestId"]:
        find_request(data["linkedRequestId"])
        thread["linkedRequestId"] = data["linkedRequestId"]
    if "customerId" in data and data["customerId"]:
        thread["customerId"] = data["customerId"]
        thread["customer"] = resolve_customer(data["customerId"])
    thread["updatedAt"] = now_iso()
    add_audit(
        "customer_service_inbox_thread_updated",
        "CustomerServiceInboxThread",
        thread["id"],
        {"status": thread["status"], "channel": thread["channel"]},
        admin["username"],
    )
    return inbox_thread_summary(thread)


@router.post("/omni-channel/inbox/{thread_id}/read")
def mark_omni_channel_thread_read(thread_id: str, admin=Depends(require_admin)):
    thread = find_inbox_thread(thread_id)
    thread["unreadCount"] = 0
    thread["updatedAt"] = now_iso()
    return inbox_thread_summary(thread)


@router.post("/omni-channel/inbox/{thread_id}/reply")
def reply_to_omni_channel_thread(thread_id: str, payload: InboxReplyPayload, admin=Depends(require_admin)):
    thread = find_inbox_thread(thread_id)
    if thread["channel"] != "FACEBOOK":
        raise HTTPException(status_code=400, detail="Replies are only implemented for Facebook in this phase")
    delivery_status = "LOCAL_ONLY"
    delivery_response: dict[str, Any] = {"detail": "Stored locally"}
    if payload.sendViaFacebook:
        delivery_status, delivery_response = send_facebook_message(thread["externalUserId"], payload.message)
    row = create_inbox_message(
        thread,
        "OUTBOUND",
        payload.message,
        payload.agentName or admin["username"],
        f"local.{uuid4()}",
        delivery_status,
        {"facebookSendResponse": delivery_response},
    )
    thread["unreadCount"] = 0
    add_audit(
        "customer_service_inbox_reply_created",
        "CustomerServiceInboxMessage",
        row["id"],
        {"threadId": thread["id"], "deliveryStatus": delivery_status},
        admin["username"],
    )
    return {"message": row, "thread": inbox_thread_summary(thread), "deliveryResponse": delivery_response}


@router.get("/channels/facebook/webhook", response_class=PlainTextResponse)
def verify_facebook_webhook(
    mode: str = Query(default="", alias="hub.mode"),
    verify_token: str = Query(default="", alias="hub.verify_token"),
    challenge: str = Query(default="", alias="hub.challenge"),
):
    expected = channel_settings["FACEBOOK"].get("verifyToken")
    if mode == "subscribe" and verify_token and verify_token == expected:
        return PlainTextResponse(challenge)
    raise HTTPException(status_code=403, detail="Facebook webhook verification failed")


@router.post("/channels/facebook/webhook")
def receive_facebook_webhook(payload: dict[str, Any]):
    created: list[dict[str, Any]] = []
    for entry in payload.get("entry", []):
        page_id = clean_text(entry.get("id"))
        for event in entry.get("messaging", []):
            sender_id = clean_text(event.get("sender", {}).get("id"))
            recipient_id = clean_text(event.get("recipient", {}).get("id") or page_id)
            message = event.get("message") or {}
            postback = event.get("postback") or {}
            text = message.get("text") or postback.get("title") or postback.get("payload") or ""
            if not sender_id or not text:
                continue
            thread = find_or_create_inbox_thread("FACEBOOK", sender_id, recipient_id)
            before_count = len(visible_inbox_messages())
            row = create_inbox_message(
                thread,
                "INBOUND",
                text,
                f"Facebook PSID {sender_id[-6:]}",
                clean_text(message.get("mid") or postback.get("mid")),
                "RECEIVED",
                event,
            )
            if len(visible_inbox_messages()) > before_count:
                created.append(row)
    return {"status": "ok", "messagesCreated": len(created)}


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
