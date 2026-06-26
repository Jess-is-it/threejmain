from __future__ import annotations

from typing import Any, Callable

from fastapi import APIRouter

router = APIRouter(prefix="/api/techportal", tags=["techportal"])

_current_admin: Callable[..., dict[str, Any]] | None = None
_audit_logger: Callable[[str, str, str, dict[str, Any], str], None] | None = None

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
) -> None:
    global _current_admin, _audit_logger
    _current_admin = current_admin
    _audit_logger = audit_logger


def seed_techportal_data() -> None:
    return None


def techportal_metrics() -> dict[str, int]:
    return {
        "assigned_tickets": 0,
        "urgent_tickets": 0,
        "in_progress_jobs": 0,
        "completed_today": 0,
    }


@router.get("/health")
def techportal_health() -> dict[str, str]:
    return {"status": "ok", "module": "techportal"}


@router.get("/meta")
def techportal_meta() -> dict[str, Any]:
    return {
        "slug": "techportal",
        "name": "Tech Portal",
        "status": "planned-shell",
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
            "Dashboard shows assigned tickets and urgent work.",
            "Technician opens a ticket and updates field status.",
            "Technician records checklist, notes, photos, readings, and materials used.",
            "Ticketing, Logs, Network Settings, Service, and Inventory receive the relevant updates.",
        ],
        "milestones": [
            "Wire /techportal route under the existing staging web runtime.",
            "Add technician-only auth gate.",
            "Build Dashboard from assigned Ticketing records.",
            "Build technician Ticketing queue and detail flow.",
            "Add notes, evidence, checklist, and material usage capture.",
            "Add technician-scoped Logs view.",
            "Add portal-safe System Settings preferences.",
            "Add offline/PWA support after online workflow is stable.",
        ],
    }
