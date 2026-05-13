from datetime import date, datetime, timezone
from typing import Any, Callable
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel


router = APIRouter(prefix="/api/ticketing", tags=["ticketing"])

tickets: list[dict[str, Any]] = []

_current_admin: Callable[[str | None], dict[str, Any]] | None = None
_audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None] | None = None
_customer_resolver: Callable[[str], dict[str, Any]] | None = None
_customer_searcher: Callable[[str], list[dict[str, Any]]] | None = None
_customer_seed: Callable[[], None] | None = None

TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "WAITING_INTERNAL", "RESOLVED", "CLOSED", "CANCELLED"]
TICKET_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"]
TICKET_CATEGORIES = ["CONNECTIVITY", "BILLING", "INSTALLATION", "EQUIPMENT", "OUTAGE", "GENERAL"]
TICKET_SOURCES = ["PHONE", "WALK_IN", "FACEBOOK", "SMS", "EMAIL", "PORTAL", "INTERNAL"]
NOTE_VISIBILITIES = ["INTERNAL", "CUSTOMER_VISIBLE"]
CLOSED_STATUSES = ["RESOLVED", "CLOSED", "CANCELLED"]


class TicketPayload(BaseModel):
    customerId: str | None = None
    requestorName: str | None = None
    contactNumber: str | None = None
    subject: str | None = None
    description: str | None = None
    category: str | None = None
    priority: str | None = None
    status: str | None = None
    source: str | None = None
    assignedTo: str | None = None
    serviceId: str | None = None
    outageId: str | None = None
    dueDate: str | None = None
    resolutionSummary: str | None = None


class TicketNotePayload(BaseModel):
    body: str | None = None
    visibility: str | None = None


def configure_ticketing(
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
        raise HTTPException(status_code=500, detail="Ticketing module is not configured")
    return _current_admin(authorization)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_iso() -> str:
    return date.today().isoformat()


def normalize_upper(value: Any) -> str:
    return str(value or "").strip().upper()


def parse_day(value: str | None, field_name: str) -> str:
    if not value:
        return ""
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{field_name} must be YYYY-MM-DD") from exc


def add_audit(action: str, target_id: str, details: dict[str, Any] | None, actor: str) -> None:
    if _audit_logger is not None:
        _audit_logger(action, "ticket", target_id, details, actor)


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


def search_customers(search: str = "") -> list[dict[str, Any]]:
    seed_customers()
    if _customer_searcher is None:
        return []
    return [customer_snapshot(customer) for customer in _customer_searcher(search)]


def resolve_customer(customer_id: str | None) -> dict[str, Any] | None:
    if not customer_id:
        return None
    seed_customers()
    if _customer_resolver is None:
        raise HTTPException(status_code=400, detail="Customer Profiling provider is not available")
    return customer_snapshot(_customer_resolver(customer_id))


def visible_tickets() -> list[dict[str, Any]]:
    return [ticket for ticket in tickets if not ticket.get("deletedAt")]


def find_ticket(ticket_id: str) -> dict[str, Any]:
    for ticket in tickets:
        if ticket["id"] == ticket_id and not ticket.get("deletedAt"):
            return ticket
    raise HTTPException(status_code=404, detail="Ticket not found")


def next_ticket_number() -> str:
    return f"TKT-{datetime.now(timezone.utc).strftime('%Y%m')}-{len(tickets) + 1:04d}"


def validate_choice(value: str, choices: list[str], label: str) -> str:
    normalized = normalize_upper(value)
    if normalized not in choices:
        raise HTTPException(status_code=400, detail=f"Invalid {label}")
    return normalized


def ticket_contact_fields(record: dict[str, Any], customer: dict[str, Any] | None) -> dict[str, Any]:
    requestor = str(record.get("requestorName") or "").strip()
    contact = str(record.get("contactNumber") or "").strip()
    if customer:
        requestor = requestor or customer.get("name") or ""
        contact = contact or customer.get("contactNumber") or ""
    if not requestor:
        raise HTTPException(status_code=400, detail="requestorName is required when no customer is selected")
    return {"requestorName": requestor, "contactNumber": contact}


def normalize_ticket_payload(payload: TicketPayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    record = dict(current or {})
    record.update({key: value for key, value in data.items() if value is not None})

    if not str(record.get("subject") or "").strip():
        raise HTTPException(status_code=400, detail="subject is required")

    customer = resolve_customer(record.get("customerId"))
    record["customer"] = customer
    record.update(ticket_contact_fields(record, customer))
    record["subject"] = str(record.get("subject") or "").strip()
    record["description"] = str(record.get("description") or "").strip()
    record["category"] = validate_choice(record.get("category") or "GENERAL", TICKET_CATEGORIES, "ticket category")
    record["priority"] = validate_choice(record.get("priority") or "NORMAL", TICKET_PRIORITIES, "ticket priority")
    record["status"] = validate_choice(record.get("status") or "OPEN", TICKET_STATUSES, "ticket status")
    record["source"] = validate_choice(record.get("source") or "PHONE", TICKET_SOURCES, "ticket source")
    record["assignedTo"] = str(record.get("assignedTo") or "").strip()
    record["serviceId"] = str(record.get("serviceId") or "").strip()
    record["outageId"] = str(record.get("outageId") or "").strip()
    record["dueDate"] = parse_day(record.get("dueDate") or "", "dueDate")
    record["resolutionSummary"] = str(record.get("resolutionSummary") or "").strip()
    return record


def apply_status_dates(ticket: dict[str, Any], previous_status: str | None = None) -> None:
    status = ticket["status"]
    if status in ["RESOLVED", "CLOSED"] and not ticket.get("resolvedAt"):
        ticket["resolvedAt"] = now_iso()
    if status == "CLOSED" and not ticket.get("closedAt"):
        ticket["closedAt"] = now_iso()
    if status not in CLOSED_STATUSES:
        ticket["closedAt"] = ""
        if previous_status in CLOSED_STATUSES:
            ticket["resolvedAt"] = ""


def ticket_matches(
    ticket: dict[str, Any],
    search: str = "",
    status: str = "",
    priority: str = "",
    category: str = "",
    customer_id: str = "",
    assigned_to: str = "",
) -> bool:
    if status and ticket.get("status") != normalize_upper(status):
        return False
    if priority and ticket.get("priority") != normalize_upper(priority):
        return False
    if category and ticket.get("category") != normalize_upper(category):
        return False
    if customer_id and ticket.get("customerId") != customer_id:
        return False
    if assigned_to and assigned_to.strip().lower() not in ticket.get("assignedTo", "").lower():
        return False
    if search:
        needle = search.strip().lower()
        customer = ticket.get("customer") or {}
        haystack = " ".join(
            str(value or "")
            for value in [
                ticket.get("ticketNumber"),
                ticket.get("subject"),
                ticket.get("description"),
                ticket.get("requestorName"),
                ticket.get("contactNumber"),
                ticket.get("assignedTo"),
                ticket.get("serviceId"),
                ticket.get("outageId"),
                customer.get("accountNumber"),
                customer.get("name"),
            ]
        ).lower()
        return needle in haystack
    return True


def ticketing_metrics() -> dict[str, int]:
    rows = visible_tickets()
    open_rows = [ticket for ticket in rows if ticket.get("status") not in CLOSED_STATUSES]
    today = date.today()
    sla_risks = 0
    for ticket in open_rows:
        due_date = ticket.get("dueDate")
        if due_date and date.fromisoformat(due_date) < today:
            sla_risks += 1
    return {
        "tickets": len(rows),
        "open_tickets": len(open_rows),
        "urgent": len([ticket for ticket in open_rows if ticket.get("priority") == "URGENT"]),
        "field_jobs": len([ticket for ticket in open_rows if ticket.get("category") in ["INSTALLATION", "EQUIPMENT"]]),
        "sla_risks": sla_risks,
    }


def seed_ticketing_data() -> None:
    if tickets:
        return
    customers = search_customers("")
    first_customer = customers[0] if customers else None
    sample = {
        "customerId": first_customer["id"] if first_customer else None,
        "requestorName": first_customer["name"] if first_customer else "Walk-in customer",
        "contactNumber": first_customer["contactNumber"] if first_customer else "09170000000",
        "subject": "Intermittent fiber connection",
        "description": "Connection drops every few minutes during peak evening hours.",
        "category": "CONNECTIVITY",
        "priority": "HIGH",
        "status": "OPEN",
        "source": "PHONE",
        "assignedTo": "Support Desk",
        "serviceId": "SERVICE-PLACEHOLDER-001",
        "dueDate": today_iso(),
    }
    record = normalize_ticket_payload(TicketPayload(**sample))
    record.update(
        {
            "id": str(uuid4()),
            "ticketNumber": next_ticket_number(),
            "openedAt": now_iso(),
            "updatedAt": now_iso(),
            "resolvedAt": "",
            "closedAt": "",
            "deletedAt": "",
            "notes": [],
        }
    )
    tickets.append(record)


@router.get("/meta")
def ticketing_meta(admin=Depends(require_admin)):
    return {
        "statuses": TICKET_STATUSES,
        "priorities": TICKET_PRIORITIES,
        "categories": TICKET_CATEGORIES,
        "sources": TICKET_SOURCES,
        "noteVisibilities": NOTE_VISIBILITIES,
        "placeholders": {
            "customerLookup": "Uses Customer Profiling when the integration provider is supplied; manual requestor fields remain available.",
            "assignedTo": "Free-text assignee until Account Admin staff records are integrated.",
            "serviceId": "Reference field for the Service module's Service Order serviceReference.",
            "outageId": "Reference field for future outage tracking integration.",
        },
    }


@router.get("/customers")
def ticketing_customers(search: str = "", admin=Depends(require_admin)):
    return search_customers(search)


@router.get("/overview")
def ticketing_overview(admin=Depends(require_admin)):
    seed_ticketing_data()
    rows = visible_tickets()
    open_rows = [ticket for ticket in rows if ticket.get("status") not in CLOSED_STATUSES]
    return {
        "metrics": ticketing_metrics(),
        "byStatus": {status: len([ticket for ticket in rows if ticket.get("status") == status]) for status in TICKET_STATUSES},
        "byPriority": {priority: len([ticket for ticket in open_rows if ticket.get("priority") == priority]) for priority in TICKET_PRIORITIES},
        "recentTickets": sorted(rows, key=lambda ticket: ticket.get("updatedAt", ""), reverse=True)[:6],
    }


@router.get("/tickets")
def list_tickets(
    search: str = "",
    status: str = "",
    priority: str = "",
    category: str = "",
    customerId: str = "",
    assignedTo: str = "",
    admin=Depends(require_admin),
):
    seed_ticketing_data()
    rows = [
        ticket
        for ticket in visible_tickets()
        if ticket_matches(ticket, search=search, status=status, priority=priority, category=category, customer_id=customerId, assigned_to=assignedTo)
    ]
    return sorted(rows, key=lambda ticket: ticket.get("updatedAt", ""), reverse=True)


@router.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: str, admin=Depends(require_admin)):
    seed_ticketing_data()
    return find_ticket(ticket_id)


@router.post("/tickets")
def create_ticket(payload: TicketPayload, admin=Depends(require_admin)):
    record = normalize_ticket_payload(payload)
    record.update(
        {
            "id": str(uuid4()),
            "ticketNumber": next_ticket_number(),
            "openedAt": now_iso(),
            "updatedAt": now_iso(),
            "resolvedAt": "",
            "closedAt": "",
            "deletedAt": "",
            "notes": [],
        }
    )
    apply_status_dates(record)
    tickets.append(record)
    add_audit("ticket_created", record["id"], {"ticketNumber": record["ticketNumber"], "subject": record["subject"]}, admin["username"])
    return record


@router.patch("/tickets/{ticket_id}")
def update_ticket(ticket_id: str, payload: TicketPayload, admin=Depends(require_admin)):
    ticket = find_ticket(ticket_id)
    previous_status = ticket.get("status")
    updated = normalize_ticket_payload(payload, ticket)
    ticket.update(updated)
    ticket["updatedAt"] = now_iso()
    apply_status_dates(ticket, previous_status)
    add_audit("ticket_updated", ticket["id"], {"ticketNumber": ticket["ticketNumber"], "status": ticket["status"]}, admin["username"])
    return ticket


@router.delete("/tickets/{ticket_id}")
def delete_ticket(ticket_id: str, admin=Depends(require_admin)):
    ticket = find_ticket(ticket_id)
    ticket["deletedAt"] = now_iso()
    ticket["updatedAt"] = now_iso()
    add_audit("ticket_deleted", ticket["id"], {"ticketNumber": ticket["ticketNumber"]}, admin["username"])
    return {"status": "deleted", "id": ticket_id}


@router.post("/tickets/{ticket_id}/notes")
def add_ticket_note(ticket_id: str, payload: TicketNotePayload, admin=Depends(require_admin)):
    ticket = find_ticket(ticket_id)
    body = str(payload.body or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="Note body is required")
    visibility = validate_choice(payload.visibility or "INTERNAL", NOTE_VISIBILITIES, "note visibility")
    note = {
        "id": str(uuid4()),
        "body": body,
        "visibility": visibility,
        "createdAt": now_iso(),
        "createdBy": admin["username"],
    }
    ticket.setdefault("notes", []).append(note)
    ticket["updatedAt"] = now_iso()
    add_audit("ticket_note_added", ticket["id"], {"ticketNumber": ticket["ticketNumber"], "visibility": visibility}, admin["username"])
    return ticket
