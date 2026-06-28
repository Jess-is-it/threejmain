from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/techportal", tags=["techportal"])

_current_admin: Callable[..., dict[str, Any]] | None = None
_audit_logger: Callable[[str, str, str, dict[str, Any], str], None] | None = None
_ticket_provider: Callable[[], list[dict[str, Any]]] | None = None
_ticket_seed: Callable[[], None] | None = None
_ticket_status_updater: Callable[[str, str, str, str, str], dict[str, Any]] | None = None
_ticket_note_adder: Callable[[str, str, str, str], dict[str, Any]] | None = None


class TechPortalTicketStatusPayload(BaseModel):
    status: str = Field(..., min_length=2, max_length=40)
    note: str | None = Field(default=None, max_length=1000)
    resolutionSummary: str | None = Field(default=None, max_length=1000)


class TechPortalTicketNotePayload(BaseModel):
    body: str = Field(..., min_length=1, max_length=1000)
    visibility: str | None = Field(default="INTERNAL", max_length=40)

FEATURES = [
    {
        "key": "dashboard",
        "label": "Dashboard",
        "route": "/techportal",
        "folder": "features/techportal/features/dashboard",
    },
    {
        "key": "ticketing",
        "label": "Ticketing",
        "route": "/techportal/ticketing",
        "folder": "features/techportal/features/ticketing",
    },
    {
        "key": "logs",
        "label": "Logs",
        "route": "/techportal/logs",
        "folder": "features/techportal/features/logs",
    },
    {
        "key": "systemSettings",
        "label": "System Settings",
        "route": "/techportal/system-settings",
        "folder": "features/techportal/features/system-settings",
    },
]

INTEGRATION_POINTS = [
    {"module": "Ticketing", "contract": "Assigned tickets, status updates, notes, evidence, and completion details."},
    {"module": "Customer Profiling", "contract": "Customer identity, contact, service address, and location context."},
    {"module": "Service", "contract": "Service Account, Service Order, plan, service reference, and lifecycle state."},
    {"module": "Network Settings", "contract": "Serviceability, topology, NAP/ONU/PPPoE context, and provisioning requests."},
    {"module": "Inventory", "contract": "Technician material usage and equipment assignment references."},
    {"module": "Logs", "contract": "Technician activity and audit history."},
    {"module": "System Settings", "contract": "Branding, maps, notifications, access/session settings, and portal-safe preferences."},
]


def configure_techportal(
    current_admin: Callable[..., dict[str, Any]] | None = None,
    audit_logger: Callable[[str, str, str, dict[str, Any], str], None] | None = None,
    ticket_provider: Callable[[], list[dict[str, Any]]] | None = None,
    ticket_seed: Callable[[], None] | None = None,
    ticket_status_updater: Callable[[str, str, str, str, str], dict[str, Any]] | None = None,
    ticket_note_adder: Callable[[str, str, str, str], dict[str, Any]] | None = None,
) -> None:
    global _current_admin, _audit_logger, _ticket_provider, _ticket_seed, _ticket_status_updater, _ticket_note_adder
    _current_admin = current_admin
    _audit_logger = audit_logger
    _ticket_provider = ticket_provider
    _ticket_seed = ticket_seed
    _ticket_status_updater = ticket_status_updater
    _ticket_note_adder = ticket_note_adder


def seed_techportal_data() -> None:
    return None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_iso() -> str:
    return date.today().isoformat()


def require_techportal_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if _current_admin is None:
        raise HTTPException(status_code=500, detail="Tech Portal module is not configured")
    user = _current_admin(authorization)
    role = str(user.get("role") or "").lower()
    permissions = set(user.get("permissions") or [])
    if role in {"owner", "admin", "technician"} or "techportal.dashboard.view" in permissions:
        return user
    raise HTTPException(status_code=403, detail="Tech Portal access is required")


def display_label(value: Any) -> str:
    return str(value or "").replace("_", " ").replace("-", " ").title()


def parse_day(value: Any) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return None


def user_is_technician(user: dict[str, Any]) -> bool:
    return str(user.get("role") or "").lower() == "technician"


def ticket_assigned_to_user(ticket: dict[str, Any], user: dict[str, Any]) -> bool:
    assigned = str(ticket.get("assignedTo") or "").lower()
    if not assigned:
        return False
    candidates = [
        str(user.get("username") or "").lower(),
        str(user.get("full_name") or "").lower(),
        str(user.get("fullName") or "").lower(),
    ]
    return any(candidate and candidate in assigned for candidate in candidates)


def load_ticket_rows(user: dict[str, Any]) -> list[dict[str, Any]]:
    if _ticket_seed is not None:
        _ticket_seed()
    rows = _ticket_provider() if _ticket_provider is not None else []
    active_rows = [ticket for ticket in rows if not ticket.get("deletedAt")]
    if user_is_technician(user):
        return [ticket for ticket in active_rows if ticket_assigned_to_user(ticket, user)]
    return active_rows


def find_accessible_ticket(ticket_id: str, user: dict[str, Any]) -> dict[str, Any]:
    for ticket in load_ticket_rows(user):
        if ticket.get("id") == ticket_id:
            return ticket
    raise HTTPException(status_code=404, detail="Ticket not found in technician queue")


def sample_dashboard_tickets(user: dict[str, Any]) -> list[dict[str, Any]]:
    technician_name = user.get("full_name") or user.get("username") or "Test Technician"
    today = date.today()
    samples = [
        {
            "id": "sample-install-1",
            "ticketNumber": "TECH-DEMO-001",
            "subject": "New installation - Roma Norte",
            "description": "Install ONU, validate NAP port, capture signal reading, and confirm customer handoff.",
            "category": "INSTALLATION",
            "priority": "HIGH",
            "status": "OPEN",
            "assignedTo": technician_name,
            "requestorName": "Sample Residential Customer",
            "contactNumber": "09170000001",
            "customer": {"name": "Sample Residential Customer", "address": "Roma Norte, Enrile, Cagayan"},
            "serviceOrderNumber": "SO-DEMO-001",
            "serviceReference": "FIBER-50M-DEMO",
            "dueDate": today.isoformat(),
            "source": "sample",
        },
        {
            "id": "sample-repair-1",
            "ticketNumber": "TECH-DEMO-002",
            "subject": "Intermittent connection repair",
            "description": "Check customer drop cable, ONU optical reading, and PPPoE session stability.",
            "category": "CONNECTIVITY",
            "priority": "URGENT",
            "status": "IN_PROGRESS",
            "assignedTo": technician_name,
            "requestorName": "Sample Business Customer",
            "contactNumber": "09170000002",
            "customer": {"name": "Sample Business Customer", "address": "Centro, Cabagan, Isabela"},
            "serviceReference": "BIZ-100M-DEMO",
            "dueDate": today.isoformat(),
            "source": "sample",
        },
        {
            "id": "sample-equipment-1",
            "ticketNumber": "TECH-DEMO-003",
            "subject": "Router replacement follow-up",
            "description": "Replace customer router, record serial number, and confirm Wi-Fi handoff.",
            "category": "EQUIPMENT",
            "priority": "NORMAL",
            "status": "OPEN",
            "assignedTo": technician_name,
            "requestorName": "Sample Follow-up Customer",
            "contactNumber": "09170000003",
            "customer": {"name": "Sample Follow-up Customer", "address": "Poblacion 1, Santa Maria, Isabela"},
            "serviceReference": "HOME-35M-DEMO",
            "dueDate": (today + timedelta(days=1)).isoformat(),
            "source": "sample",
        },
    ]
    return samples


def ticket_customer(ticket: dict[str, Any]) -> dict[str, Any]:
    customer = ticket.get("customer") if isinstance(ticket.get("customer"), dict) else {}
    return {
        "name": customer.get("name") or ticket.get("requestorName") or "Unassigned customer",
        "address": customer.get("address") or ticket.get("serviceAddress") or ticket.get("installAddress") or "",
        "contactNumber": customer.get("contactNumber") or ticket.get("contactNumber") or "",
    }


def ticket_work_type(ticket: dict[str, Any]) -> str:
    category = str(ticket.get("category") or "").upper()
    service_order_type = str(ticket.get("serviceOrderType") or "").upper()
    if category == "INSTALLATION" or service_order_type in {"NEW_INSTALLATION", "RELOCATION", "RECONNECTION"}:
        return "Installation"
    if category == "EQUIPMENT" or service_order_type == "EQUIPMENT_REPLACEMENT":
        return "Equipment"
    if category in {"CONNECTIVITY", "OUTAGE"}:
        return "Repair"
    return display_label(category or "General")


def normalize_dashboard_ticket(ticket: dict[str, Any]) -> dict[str, Any]:
    customer = ticket_customer(ticket)
    due = parse_day(ticket.get("dueDate"))
    today = date.today()
    if due and due < today:
        due_state = "overdue"
    elif due and due == today:
        due_state = "today"
    elif due:
        due_state = "upcoming"
    else:
        due_state = "unscheduled"
    return {
        "id": ticket.get("id"),
        "ticketNumber": ticket.get("ticketNumber") or ticket.get("id") or "Ticket",
        "subject": ticket.get("subject") or "Untitled work",
        "description": ticket.get("description") or "",
        "category": ticket.get("category") or "GENERAL",
        "workType": ticket_work_type(ticket),
        "priority": ticket.get("priority") or "NORMAL",
        "status": ticket.get("status") or "OPEN",
        "fieldStatus": ticket.get("fieldStatus") or ("COMPLETED" if ticket.get("status") in {"RESOLVED", "CLOSED"} else "ASSIGNED"),
        "assignedTo": ticket.get("assignedTo") or "",
        "customer": customer,
        "serviceReference": ticket.get("serviceReference") or ticket.get("serviceId") or "",
        "serviceOrderNumber": ticket.get("serviceOrderNumber") or "",
        "serviceOrderType": ticket.get("serviceOrderType") or "",
        "serviceAccountNumber": ticket.get("serviceAccountNumber") or "",
        "dueDate": ticket.get("dueDate") or "",
        "dueState": due_state,
        "updatedAt": ticket.get("updatedAt") or "",
        "resolvedAt": ticket.get("resolvedAt") or "",
        "closedAt": ticket.get("closedAt") or "",
        "source": ticket.get("source") or "ticketing",
    }


def queue_counts(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    queue_order = ["Installation", "Repair", "Equipment", "Relocation", "Reconnection", "General"]
    counts = {name: 0 for name in queue_order}
    for row in rows:
        work_type = row["workType"]
        counts[work_type if work_type in counts else "General"] += 1
    return [{"label": label, "count": count} for label, count in counts.items()]


def checklist_for_work_type(work_type: str) -> list[dict[str, Any]]:
    normalized = str(work_type or "").lower()
    if normalized == "installation":
        items = [
            "Verify customer identity and service address.",
            "Confirm nearest NAP and available port assignment.",
            "Install ONU/CPE and customer router.",
            "Record optical signal reading and service reference.",
            "Confirm customer handoff and basic speed test.",
        ]
    elif normalized == "repair":
        items = [
            "Confirm customer symptom and recent outage context.",
            "Inspect drop cable, connectors, and indoor router.",
            "Record ONU light level and PPPoE/session observation.",
            "Document diagnosis and resolution.",
        ]
    elif normalized == "equipment":
        items = [
            "Record removed equipment model/serial number.",
            "Install replacement equipment and validate service.",
            "Record new equipment model/serial number.",
            "Confirm customer Wi-Fi handoff.",
        ]
    else:
        items = [
            "Confirm customer and work location.",
            "Document field action taken.",
            "Record follow-up requirement before closing.",
        ]
    return [{"id": f"step-{index + 1}", "label": label, "done": False} for index, label in enumerate(items)]


def normalize_ticket_detail(ticket: dict[str, Any]) -> dict[str, Any]:
    row = normalize_dashboard_ticket(ticket)
    row.update(
        {
            "openedAt": ticket.get("openedAt") or "",
            "acceptedAt": ticket.get("acceptedAt") or "",
            "enRouteAt": ticket.get("enRouteAt") or "",
            "arrivedAt": ticket.get("arrivedAt") or "",
            "fieldStartedAt": ticket.get("fieldStartedAt") or "",
            "heldAt": ticket.get("heldAt") or "",
            "fieldCompletedAt": ticket.get("fieldCompletedAt") or "",
            "resolutionSummary": ticket.get("resolutionSummary") or "",
            "notes": ticket.get("notes") or [],
            "checklist": ticket.get("techPortalChecklist") or checklist_for_work_type(row["workType"]),
            "networkContext": {
                "serviceReference": row.get("serviceReference", ""),
                "serviceOrderNumber": row.get("serviceOrderNumber", ""),
                "serviceOrderType": row.get("serviceOrderType", ""),
                "serviceAccountNumber": row.get("serviceAccountNumber", ""),
                "serviceability": "Pending Network Settings lookup",
                "path": "OLT/PON/NAP context will be read from Network Settings when linked records exist.",
            },
            "materials": ticket.get("techPortalMaterials") or [],
        }
    )
    return row


def ticket_matches_filters(
    ticket: dict[str, Any],
    search: str = "",
    status: str = "",
    priority: str = "",
    work_type: str = "",
    due: str = "",
) -> bool:
    if status and ticket.get("fieldStatus") != status and ticket.get("status") != status:
        return False
    if priority and ticket.get("priority") != priority:
        return False
    if work_type and ticket.get("workType", "").lower() != work_type.lower():
        return False
    if due and ticket.get("dueState") != due:
        return False
    if search:
        needle = search.strip().lower()
        haystack = " ".join(
            str(value or "")
            for value in [
                ticket.get("ticketNumber"),
                ticket.get("subject"),
                ticket.get("description"),
                ticket.get("workType"),
                ticket.get("serviceReference"),
                ticket.get("serviceOrderNumber"),
                (ticket.get("customer") or {}).get("name"),
                (ticket.get("customer") or {}).get("address"),
            ]
        ).lower()
        return needle in haystack
    return True


def techportal_metrics() -> dict[str, int]:
    if _ticket_seed is not None:
        _ticket_seed()
    rows = _ticket_provider() if _ticket_provider is not None else []
    open_rows = [ticket for ticket in rows if ticket.get("status") not in {"RESOLVED", "CLOSED", "CANCELLED"} and not ticket.get("deletedAt")]
    return {
        "assigned_tickets": len(open_rows),
        "urgent_tickets": len([ticket for ticket in open_rows if ticket.get("priority") == "URGENT"]),
        "in_progress_jobs": len([ticket for ticket in open_rows if ticket.get("status") == "IN_PROGRESS"]),
        "completed_today": len(
            [
                ticket
                for ticket in rows
                if ticket.get("status") in {"RESOLVED", "CLOSED"}
                and str(ticket.get("resolvedAt") or ticket.get("closedAt") or "").startswith(today_iso())
            ]
        ),
    }


@router.get("/health")
def techportal_health() -> dict[str, str]:
    return {"status": "ok", "module": "techportal"}


@router.get("/meta")
def techportal_meta() -> dict[str, Any]:
    return {
        "slug": "techportal",
        "name": "Tech Portal",
        "status": "functional-dashboard-ticketing",
        "route": "/techportal",
        "webUrl": "http://192.168.50.70:8280/techportal",
        "apiPrefix": "/api/techportal",
        "features": FEATURES,
        "integrationPoints": INTEGRATION_POINTS,
    }


@router.get("/plan")
def techportal_plan() -> dict[str, Any]:
    return {
        "purpose": "Technician-only portal for assigned field work, ticket execution, evidence capture, and portal-safe settings.",
        "primaryWorkflow": [
            "Technician logs into Tech Portal.",
            "Dashboard shows KPI counters only.",
            "Technician opens the Ticketing page to view assigned work on a stage board.",
            "Technician opens a ticket from the board and updates field status.",
            "Technician records checklist, notes, photos, readings, and materials used.",
            "Ticketing, Logs, Network Settings, Service, and Inventory receive the relevant updates.",
        ],
        "milestones": [
            "Done: wire /techportal route under the existing staging web runtime.",
            "Done: add first-pass technician-only auth gate.",
            "Done: keep Dashboard focused on KPI counters.",
            "Done: build /techportal/ticketing Kanban queue, filters, detail, field status, and internal notes.",
            "Next: add persistent checklist, evidence, and material usage capture.",
            "Add technician-scoped Logs view.",
            "Add portal-safe System Settings preferences.",
            "Add offline/PWA support after online workflow is stable.",
        ],
    }


@router.get("/dashboard")
def techportal_dashboard(user=Depends(require_techportal_user)) -> dict[str, Any]:
    live_rows = [normalize_dashboard_ticket(ticket) for ticket in load_ticket_rows(user)]
    assigned_work = live_rows or [normalize_dashboard_ticket(ticket) for ticket in sample_dashboard_tickets(user)]
    open_rows = [ticket for ticket in assigned_work if ticket["status"] not in {"RESOLVED", "CLOSED", "CANCELLED"}]
    urgent_rows = [ticket for ticket in open_rows if ticket["priority"] == "URGENT"]
    due_today_rows = [ticket for ticket in open_rows if ticket["dueState"] == "today"]
    overdue_rows = [ticket for ticket in open_rows if ticket["dueState"] == "overdue"]
    in_progress_rows = [ticket for ticket in open_rows if ticket["status"] == "IN_PROGRESS"]
    route_rows = sorted(
        [ticket for ticket in assigned_work if ticket["customer"]["address"]],
        key=lambda ticket: (ticket["dueDate"] or "9999-12-31", ticket["priority"] != "URGENT", ticket["ticketNumber"]),
    )[:5]
    return {
        "technician": {
            "id": user.get("id"),
            "username": user.get("username"),
            "name": user.get("full_name") or user.get("username"),
            "role": user.get("role"),
            "status": "Available",
            "asOf": now_iso(),
        },
        "metrics": {
            "assigned": len(open_rows),
            "urgent": len(urgent_rows),
            "dueToday": len(due_today_rows),
            "overdue": len(overdue_rows),
            "inProgress": len(in_progress_rows),
            "completedToday": len(
                [
                    ticket
                    for ticket in assigned_work
                    if ticket["status"] in {"RESOLVED", "CLOSED"}
                    and str(ticket.get("resolvedAt") or ticket.get("closedAt") or ticket.get("updatedAt") or "").startswith(today_iso())
                ]
            ),
        },
        "assignedWork": sorted(
            assigned_work,
            key=lambda ticket: (
                ticket["dueState"] != "overdue",
                ticket["dueState"] != "today",
                ticket["priority"] != "URGENT",
                ticket["dueDate"] or "9999-12-31",
                ticket["ticketNumber"],
            ),
        ),
        "queues": queue_counts(open_rows),
        "routeStops": [
            {
                "ticketNumber": ticket["ticketNumber"],
                "customer": ticket["customer"]["name"],
                "address": ticket["customer"]["address"],
                "workType": ticket["workType"],
                "dueDate": ticket["dueDate"],
            }
            for ticket in route_rows
        ],
        "statusShortcuts": [
            {"label": "Available", "value": "AVAILABLE"},
            {"label": "En route", "value": "EN_ROUTE"},
            {"label": "On site", "value": "ON_SITE"},
            {"label": "On hold", "value": "ON_HOLD"},
        ],
        "notifications": [
            {
                "id": "sample-safety",
                "tone": "warning",
                "title": "Field safety",
                "body": "Confirm ladder, PPE, and power clearance before installation or repair work.",
            },
            {
                "id": "sample-sync",
                "tone": "info",
                "title": "Ticket sync",
                "body": "Ticket updates currently write through the admin Ticketing module until technician workflows are expanded.",
            },
        ],
        "source": "ticketing" if live_rows else "sample",
    }


@router.get("/tickets")
def techportal_tickets(
    search: str = "",
    status: str = "",
    priority: str = "",
    workType: str = "",
    due: str = "",
    user=Depends(require_techportal_user),
) -> dict[str, Any]:
    rows = [normalize_dashboard_ticket(ticket) for ticket in load_ticket_rows(user)]
    filtered = [
        ticket
        for ticket in rows
        if ticket_matches_filters(ticket, search=search, status=status, priority=priority, work_type=workType, due=due)
    ]
    filtered = sorted(
        filtered,
        key=lambda ticket: (
            ticket["dueState"] != "overdue",
            ticket["dueState"] != "today",
            ticket["priority"] != "URGENT",
            ticket["dueDate"] or "9999-12-31",
            ticket["ticketNumber"],
        ),
    )
    return {
        "items": filtered,
        "metrics": {
            "total": len(rows),
            "filtered": len(filtered),
            "urgent": len([ticket for ticket in rows if ticket["priority"] == "URGENT"]),
            "dueToday": len([ticket for ticket in rows if ticket["dueState"] == "today"]),
            "overdue": len([ticket for ticket in rows if ticket["dueState"] == "overdue"]),
        },
        "statusOptions": ["ASSIGNED", "ACCEPTED", "EN_ROUTE", "ON_SITE", "IN_PROGRESS", "ON_HOLD", "COMPLETED"],
        "source": "ticketing",
    }


@router.get("/tickets/{ticket_id}")
def techportal_ticket_detail(ticket_id: str, user=Depends(require_techportal_user)) -> dict[str, Any]:
    return normalize_ticket_detail(find_accessible_ticket(ticket_id, user))


@router.post("/tickets/{ticket_id}/status")
def techportal_ticket_status(ticket_id: str, payload: TechPortalTicketStatusPayload, user=Depends(require_techportal_user)) -> dict[str, Any]:
    if _ticket_status_updater is None:
        raise HTTPException(status_code=500, detail="Ticket status updater is not configured")
    find_accessible_ticket(ticket_id, user)
    updated = _ticket_status_updater(
        ticket_id,
        payload.status,
        user.get("username") or "technician",
        payload.note or "",
        payload.resolutionSummary or "",
    )
    return normalize_ticket_detail(updated)


@router.post("/tickets/{ticket_id}/notes")
def techportal_ticket_note(ticket_id: str, payload: TechPortalTicketNotePayload, user=Depends(require_techportal_user)) -> dict[str, Any]:
    if _ticket_note_adder is None:
        raise HTTPException(status_code=500, detail="Ticket note writer is not configured")
    find_accessible_ticket(ticket_id, user)
    updated = _ticket_note_adder(ticket_id, payload.body, payload.visibility or "INTERNAL", user.get("username") or "technician")
    return normalize_ticket_detail(updated)
