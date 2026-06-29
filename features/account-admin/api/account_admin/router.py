import hmac
import json
import os
import re
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any, Callable
from urllib import error as urlerror
from urllib import request as urlrequest
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel

from customer_profiling.router import customer_summary, seed_customer_data, visible_customers
from network_settings.router import list_onus as network_onus
from network_settings.router import list_pppoe_accounts as network_pppoe_accounts
from service.router import (
    account_summary as service_account_summary,
    order_summary as service_order_summary,
    order_status,
    seed_service_data,
    visible_accounts,
    visible_orders,
)
from ticketing.router import seed_ticketing_data, visible_tickets


router = APIRouter(prefix="/api/account-admin", tags=["account-admin"])

_current_admin: Callable[[str | None], dict[str, Any]] | None = None
_audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None] | None = None

customer_network_records: dict[str, dict[str, Any]] = {}
hotspot_access_state: dict[str, Any] | None = None
pppoe_discovery_cache: dict[str, Any] = {
    "capturedAt": "",
    "accounts": [],
    "kpis": {},
    "routers": [],
    "profiles": [],
    "deviceErrors": [],
    "source": "routeros-api",
}
onu_discovery_cache: dict[str, Any] = {
    "capturedAt": "",
    "onus": [],
    "deviceErrors": [],
    "source": "network-settings",
}

LIFECYCLE_STATUSES = [
    "CUSTOMER_ONLY",
    "FOR_INSTALLATION",
    "INSTALLED",
    "FOR_ACTIVATION",
    "PENDING_PROVISIONING",
    "PROVISIONED",
    "ACTIVE",
    "SUSPENDED",
    "DISCONNECTED",
    "NEEDS_REVIEW",
    "SYNC_ERROR",
]
PROVISIONING_ACTIONS = [
    "CREATE_PPPOE",
    "CHANGE_PPPOE_PASSWORD",
    "CHANGE_PPPOE_PROFILE",
    "CHANGE_WIFI_SSID",
    "CHANGE_WIFI_PASSWORD",
    "UPDATE_CPE",
    "UPDATE_IP_ASSIGNMENT",
    "UPDATE_BANDWIDTH_PROFILE",
    "ACTIVATE_SERVICE",
    "SUSPEND_SERVICE",
    "DISCONNECT_SERVICE",
]
IP_MODES = ["DYNAMIC", "STATIC", "CGNAT", "PUBLIC_STATIC", "BRIDGED"]
MAC_PROXIMITY_MATCH_MAX_DELTA = 8
HOTSPOT_ACCESS_STATE_PATH = Path(os.getenv("ACCOUNT_ADMIN_HOTSPOT_STATE_PATH", "/tmp/threejmain_account_admin_hotspot.json"))
INTERNET_SERVICE_TYPES = {"FIBER_INTERNET", "WIRELESS_INTERNET", "DEDICATED_INTERNET"}
IPTV_SERVICE_TYPES = {"IPTV", "CABLE_TV", "TV"}
IPTV_KEYWORDS = ("IPTV", "STB", "SET TOP", "SET-TOP", "TV BOX", "CABLE TV")


class NetworkConfigPayload(BaseModel):
    lifecycleStatus: str | None = None
    desiredPppoeUsername: str | None = None
    pppoePassword: str | None = None
    pppoeProfile: str | None = None
    wifiSsid: str | None = None
    wifiPassword: str | None = None
    cpeType: str | None = None
    cpeIdentifier: str | None = None
    onuId: str | None = None
    routerId: str | None = None
    routerName: str | None = None
    bandwidthProfile: str | None = None
    ipMode: str | None = None
    staticIp: str | None = None
    vlanId: str | None = None
    notes: str | None = None


class PppoeBindingPayload(BaseModel):
    pppoeAccountId: str | None = None
    routerId: str | None = None
    username: str | None = None


class ProvisioningRequestPayload(BaseModel):
    action: str
    note: str | None = None


class ProvisionedPayload(BaseModel):
    note: str | None = None


class HotspotIntegrationSettingsPayload(BaseModel):
    enabled: bool | None = None
    pisowifiApiBaseUrl: str | None = None
    apiKey: str | None = None
    apiSecret: str | None = None


class HotspotContactPayload(BaseModel):
    contactNumber: str
    label: str | None = None
    enabled: bool = True


class HotspotSubscriberContactsPayload(BaseModel):
    contacts: list[HotspotContactPayload] = []


def configure_account_admin(
    current_admin: Callable[[str | None], dict[str, Any]],
    audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None],
) -> None:
    global _current_admin, _audit_logger
    _current_admin = current_admin
    _audit_logger = audit_logger


def require_admin(authorization: str | None = Header(default=None)):
    if _current_admin is None:
        raise HTTPException(status_code=500, detail="Customer Network module is not configured")
    return _current_admin(authorization)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_upper(value: Any) -> str:
    return clean_text(value).upper()


def load_hotspot_access_state() -> dict[str, Any]:
    global hotspot_access_state
    if hotspot_access_state is not None:
        return hotspot_access_state
    default_state = {
        "settings": {
            "enabled": False,
            "pisowifiApiBaseUrl": os.getenv("PISOWIFI_API_BASE_URL", "").strip(),
            "apiKey": os.getenv("PISOWIFI_MONTHLY_API_KEY", "threejmain-monthly").strip(),
            "apiSecret": os.getenv("PISOWIFI_MONTHLY_API_SECRET", "").strip(),
        },
        "contactOverrides": {},
        "syncLogs": [],
    }
    try:
        if HOTSPOT_ACCESS_STATE_PATH.exists():
            loaded = json.loads(HOTSPOT_ACCESS_STATE_PATH.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                default_state["settings"].update(loaded.get("settings") or {})
                default_state["contactOverrides"].update(loaded.get("contactOverrides") or {})
                default_state["syncLogs"] = list(loaded.get("syncLogs") or [])[:100]
    except Exception:
        default_state["syncLogs"].insert(
            0,
            {
                "createdAt": now_iso(),
                "status": "FAILED",
                "action": "LOAD_STATE",
                "message": f"Could not load Hotspot Access state from {HOTSPOT_ACCESS_STATE_PATH}.",
            },
        )
    hotspot_access_state = default_state
    return hotspot_access_state


def save_hotspot_access_state() -> None:
    state = load_hotspot_access_state()
    HOTSPOT_ACCESS_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    HOTSPOT_ACCESS_STATE_PATH.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")


def public_hotspot_settings() -> dict[str, Any]:
    settings = dict(load_hotspot_access_state().get("settings") or {})
    return {
        **settings,
        "apiSecretSet": bool(settings.get("apiSecret")),
        "apiSecret": "",
        "statePath": str(HOTSPOT_ACCESS_STATE_PATH),
    }


def hotspot_sync_log(action: str, status: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    state = load_hotspot_access_state()
    row = {
        "id": str(uuid4()),
        "createdAt": now_iso(),
        "action": action,
        "status": status,
        "message": message,
        "details": details or {},
    }
    state.setdefault("syncLogs", []).insert(0, row)
    state["syncLogs"] = state["syncLogs"][:100]
    try:
        save_hotspot_access_state()
    except Exception:
        pass
    return row


def normalize_ph_mobile(value: Any) -> str:
    digits = re.sub(r"\D", "", clean_text(value))
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("63") and len(digits) >= 12 and digits[2] == "9":
        digits = f"0{digits[2:12]}"
    elif digits.startswith("9") and len(digits) >= 10:
        digits = f"0{digits[:10]}"
    if not re.fullmatch(r"09\d{9}", digits or ""):
        return ""
    return f"+63{digits[1:]}"


def contact_display_from_normalized(value: str) -> str:
    normalized = normalize_ph_mobile(value)
    if not normalized:
        return clean_text(value)
    return f"0{normalized[3:]}"


def customer_default_hotspot_contacts(customer: dict[str, Any]) -> list[dict[str, Any]]:
    contacts: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add_contact(number: Any, label: str) -> None:
        normalized = normalize_ph_mobile(number)
        if not normalized or normalized in seen:
            return
        seen.add(normalized)
        contacts.append(
            {
                "contactNumber": contact_display_from_normalized(normalized),
                "normalizedContact": normalized,
                "label": label,
                "enabled": True,
            }
        )

    add_contact(customer.get("contactNumber"), "Primary")
    add_contact(customer.get("alternateMobileNumber"), "Alternate")
    for item in customer.get("secondaryContacts") or []:
        label = clean_text(item.get("name") or item.get("relationship")) or "Secondary"
        add_contact(item.get("contactNumber"), label)
    return contacts


def hotspot_contacts_for_customer(customer: dict[str, Any]) -> list[dict[str, Any]]:
    state = load_hotspot_access_state()
    overrides = state.get("contactOverrides", {}).get(customer["id"])
    if overrides is None:
        return customer_default_hotspot_contacts(customer)
    contacts: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in overrides or []:
        normalized = normalize_ph_mobile(item.get("contactNumber") or item.get("normalizedContact"))
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        contacts.append(
            {
                "contactNumber": contact_display_from_normalized(normalized),
                "normalizedContact": normalized,
                "label": clean_text(item.get("label")) or "Contact",
                "enabled": bool(item.get("enabled", True)),
            }
        )
    return contacts


def customer_has_active_service(service: dict[str, Any]) -> bool:
    return any(normalize_upper(account.get("status")) == "ACTIVE" for account in service.get("serviceAccounts") or [])


def hotspot_status_for_customer(customer: dict[str, Any], service: dict[str, Any], contacts: list[dict[str, Any]]) -> str:
    if normalize_upper(customer.get("status")) in {"SUSPENDED", "INACTIVE"}:
        return "SUSPENDED"
    if not customer_has_active_service(service):
        return "INACTIVE"
    if not any(contact.get("enabled") for contact in contacts):
        return "INACTIVE"
    return "ACTIVE"


def hotspot_subscriber_payload(customer: dict[str, Any]) -> dict[str, Any]:
    service = service_bundle(customer["id"])
    contacts = hotspot_contacts_for_customer(customer)
    primary_service = service.get("serviceAccount") or {}
    status = hotspot_status_for_customer(customer, service, contacts)
    return {
        "external_subscriber_id": customer["id"],
        "account_number": customer.get("accountNumber") or customer["id"],
        "service_account_number": primary_service.get("accountNumber") or primary_service.get("serviceNumber") or primary_service.get("id") or "",
        "customer_name": customer_display_name(customer),
        "plan_name": primary_service.get("planName") or primary_service.get("servicePlan") or primary_service.get("packageName") or primary_service.get("profile") or "",
        "status": status,
        "contacts": [
            {
                "contact_number": contact["contactNumber"],
                "normalized_contact": contact["normalizedContact"],
                "label": contact.get("label") or "",
                "enabled": bool(contact.get("enabled")),
            }
            for contact in contacts
        ],
        "source": {
            "system": "3J Main",
            "module": "Account Admin",
            "customer_status": customer.get("status") or "",
            "location": {
                "barangay": customer.get("barangay") or "",
                "city": customer.get("city") or "",
                "province": customer.get("province") or "",
            },
            "service_accounts": service.get("serviceAccounts") or [],
        },
    }


def build_hotspot_subscriber_rows() -> list[dict[str, Any]]:
    seed_customer_data()
    return [hotspot_subscriber_payload(customer_summary(customer)) for customer in visible_customers()]


def hotspot_access_metrics(rows: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "subscribers": len(rows),
        "active": sum(1 for row in rows if row.get("status") == "ACTIVE"),
        "contacts": sum(len(row.get("contacts") or []) for row in rows),
        "enabledContacts": sum(1 for row in rows for contact in row.get("contacts") or [] if contact.get("enabled")),
        "withoutContacts": sum(1 for row in rows if not any(contact.get("enabled") for contact in row.get("contacts") or [])),
    }


def signed_hotspot_request(method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    settings = load_hotspot_access_state().get("settings") or {}
    base_url = clean_text(settings.get("pisowifiApiBaseUrl")).rstrip("/")
    api_key = clean_text(settings.get("apiKey"))
    api_secret = clean_text(settings.get("apiSecret"))
    if not base_url:
        raise HTTPException(status_code=400, detail="Pisowifi API base URL is required.")
    if not api_key or not api_secret:
        raise HTTPException(status_code=400, detail="Pisowifi API key and secret are required.")
    method = method.upper()
    body = b"" if method == "GET" else json.dumps(payload or {}, separators=(",", ":"), sort_keys=True).encode("utf-8")
    timestamp = str(int(datetime.now(timezone.utc).timestamp()))
    signature = hmac.new(api_secret.encode("utf-8"), timestamp.encode("utf-8") + b"." + body, sha256).hexdigest()
    request = urlrequest.Request(
        f"{base_url}{path}",
        data=body if method != "GET" else None,
        method=method,
        headers={
            "Content-Type": "application/json",
            "X-3J-Integration-Key": api_key,
            "X-3J-Timestamp": timestamp,
            "X-3J-Signature": signature,
            "X-3J-Idempotency-Key": str(uuid4()),
        },
    )
    try:
        with urlrequest.urlopen(request, timeout=20) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw or "{}")
    except urlerror.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            data = json.loads(raw or "{}")
        except json.JSONDecodeError:
            data = {"detail": raw}
        raise HTTPException(status_code=502, detail=data.get("detail") or f"Pisowifi rejected request with HTTP {exc.code}.") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Pisowifi API is unreachable: {exc}") from exc


def sync_hotspot_subscribers(rows: list[dict[str, Any]], actor: str, action: str = "SYNC_ALL") -> dict[str, Any]:
    sync_mode = "FULL" if action == "SYNC_ALL" else "PARTIAL"
    payload = {
        "source_system": "3J Main",
        "synced_by": actor,
        "sync_mode": sync_mode,
        "subscribers": rows,
    }
    result = signed_hotspot_request("POST", "/api/integrations/monthly-subscribers/upsert", payload)
    message = hotspot_sync_result_message(result, sync_mode)
    hotspot_sync_log(
        action,
        "SUCCESS",
        message,
        {"result": result},
    )
    return {**result, "message": message}


def hotspot_sync_result_message(result: dict[str, Any], sync_mode: str) -> str:
    subscriber_count = int(result.get("subscriber_count") or 0)
    contact_count = int(result.get("contact_count") or 0)
    disabled_subscriber_count = int(result.get("disabled_subscriber_count") or 0)
    disabled_contact_count = int(result.get("disabled_contact_count") or 0)
    revoked_session_count = int(result.get("revoked_session_count") or 0)
    mode_label = "Full" if sync_mode == "FULL" else "Partial"
    parts = [f"{mode_label} hotspot subscriber sync completed: {subscriber_count} subscriber(s), {contact_count} contact(s)."]
    cleanup_parts = []
    if disabled_subscriber_count:
        cleanup_parts.append(f"{disabled_subscriber_count} subscriber(s) disabled")
    if disabled_contact_count:
        cleanup_parts.append(f"{disabled_contact_count} contact(s) disabled")
    if revoked_session_count:
        cleanup_parts.append(f"{revoked_session_count} active session(s) revoked")
    if cleanup_parts:
        parts.append("Cleanup: " + ", ".join(cleanup_parts) + ".")
    return " ".join(parts)


def add_audit(action: str, target_type: str, target_id: str, details: dict[str, Any] | None, actor: str) -> None:
    if _audit_logger is not None:
        _audit_logger(action, target_type, target_id, details, actor)


def seed_account_admin_data() -> None:
    ensure_customer_network_records()


def customer_display_name(customer: dict[str, Any]) -> str:
    return clean_text(customer.get("fullName") or customer.get("name")) or "Unnamed customer"


def customer_account_number(customer: dict[str, Any]) -> str:
    return clean_text(customer.get("accountNumber")) or customer.get("id", "")[:8].upper()


def pppoe_binding_key(account: dict[str, Any] | None) -> str:
    if not account:
        return ""
    account_id = clean_text(account.get("id") or account.get("pppoeAccountId"))
    if account_id:
        return account_id
    return f"{clean_text(account.get('routerId'))}:{clean_text(account.get('username')).lower()}"


def default_network_record(customer: dict[str, Any]) -> dict[str, Any]:
    timestamp = now_iso()
    account_number = customer_account_number(customer)
    return {
        "id": f"CN-{customer['id']}",
        "customerId": customer["id"],
        "lifecycleStatus": "CUSTOMER_ONLY",
        "provisioningStatus": "NOT_REQUESTED",
        "desiredPppoeUsername": f"cust-{account_number}".lower(),
        "pppoeProfile": "",
        "pppoePasswordSet": False,
        "pppoePasswordUpdatedAt": "",
        "wifiSsid": "",
        "wifiPasswordSet": False,
        "wifiPasswordUpdatedAt": "",
        "cpeType": "",
        "cpeIdentifier": "",
        "onuId": "",
        "routerId": "",
        "routerName": "",
        "bandwidthProfile": "",
        "ipMode": "DYNAMIC",
        "staticIp": "",
        "vlanId": "",
        "notes": "",
        "pppoeBinding": None,
        "provisioningRequests": [],
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }


def normalize_record(record: dict[str, Any], customer: dict[str, Any]) -> dict[str, Any]:
    defaults = default_network_record(customer)
    for key, value in defaults.items():
        record.setdefault(key, value)
    record["customerId"] = customer["id"]
    if not record.get("desiredPppoeUsername"):
        record["desiredPppoeUsername"] = defaults["desiredPppoeUsername"]
    if record.get("ipMode") not in IP_MODES:
        record["ipMode"] = "DYNAMIC"
    return record


def ensure_customer_network_records() -> list[dict[str, Any]]:
    seed_customer_data()
    rows = [customer_summary(customer) for customer in visible_customers()]
    for customer in rows:
        record = customer_network_records.get(customer["id"])
        if record is None:
            customer_network_records[customer["id"]] = default_network_record(customer)
        else:
            normalize_record(record, customer)
    return rows


def service_bundle(customer_id: str) -> dict[str, Any]:
    seed_service_data()
    accounts = [service_account_summary(account) for account in visible_accounts() if account.get("customerId") == customer_id]
    orders = [service_order_summary(order) for order in visible_orders() if order.get("customerId") == customer_id]
    accounts = sorted(accounts, key=lambda item: clean_text(item.get("updatedAt") or item.get("createdAt")), reverse=True)
    orders = sorted(orders, key=lambda item: clean_text(item.get("updatedAt") or item.get("createdAt")), reverse=True)
    active_account = next((account for account in accounts if account.get("status") == "ACTIVE"), None)
    primary_account = active_account or (accounts[0] if accounts else None)
    installation_orders = [order for order in orders if order.get("orderType") == "NEW_INSTALLATION"]
    latest_installation = installation_orders[0] if installation_orders else None
    completed_installation = next((order for order in installation_orders if order_status(order) == "COMPLETED"), None)
    return {
        "serviceAccount": primary_account,
        "serviceAccounts": accounts,
        "serviceOrders": orders,
        "installationOrder": latest_installation,
        "completedInstallationOrder": completed_installation,
    }


def account_admin_ticket_actions(ticket: dict[str, Any]) -> list[dict[str, str]]:
    category = normalize_upper(ticket.get("category"))
    if category == "INSTALLATION":
        return [
            {
                "code": "CREATE_PPPOE_ACCOUNT",
                "label": "Create PPPoE Account",
                "reason": "Installation tickets allow customer PPPoE provisioning.",
            }
        ]
    return []


def ticket_summary(ticket: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": ticket.get("id", ""),
        "ticketNumber": ticket.get("ticketNumber", ""),
        "subject": ticket.get("subject", ""),
        "status": ticket.get("status", ""),
        "priority": ticket.get("priority", ""),
        "category": ticket.get("category", ""),
        "assignedTo": ticket.get("assignedTo", ""),
        "serviceId": ticket.get("serviceId", ""),
        "serviceOrderId": ticket.get("serviceOrderId", ""),
        "serviceOrderNumber": ticket.get("serviceOrderNumber", ""),
        "openedAt": ticket.get("openedAt", ""),
        "updatedAt": ticket.get("updatedAt", ""),
        "accountAdminActions": account_admin_ticket_actions(ticket),
    }


def ticket_bundle(customer_id: str) -> dict[str, Any]:
    seed_ticketing_data()
    rows = [ticket_summary(ticket) for ticket in visible_tickets() if ticket.get("customerId") == customer_id]
    rows = sorted(rows, key=lambda item: clean_text(item.get("updatedAt") or item.get("openedAt")), reverse=True)
    open_rows = [ticket for ticket in rows if ticket.get("status") not in {"RESOLVED", "CLOSED"}]
    return {
        "tickets": rows,
        "ticketCount": len(rows),
        "openTicketCount": len(open_rows),
        "latestTicket": rows[0] if rows else None,
    }


def text_blob(value: Any) -> str:
    if isinstance(value, dict):
        return " ".join(text_blob(item) for item in value.values())
    if isinstance(value, list):
        return " ".join(text_blob(item) for item in value)
    return clean_text(value)


def contains_keyword(value: Any, keywords: tuple[str, ...]) -> bool:
    haystack = normalize_upper(text_blob(value))
    return any(keyword in haystack for keyword in keywords)


def catalog_for_service(item: dict[str, Any]) -> dict[str, Any]:
    catalog = item.get("catalog")
    return catalog if isinstance(catalog, dict) else {}


def service_type_for(item: dict[str, Any]) -> str:
    return normalize_upper(catalog_for_service(item).get("serviceType") or item.get("serviceType"))


def service_plan_name(item: dict[str, Any] | None) -> str:
    if not item:
        return ""
    catalog = catalog_for_service(item)
    return clean_text(
        item.get("catalogName")
        or catalog.get("name")
        or item.get("planName")
        or item.get("servicePlan")
        or item.get("packageName")
        or item.get("profile")
    )


def service_account_number(item: dict[str, Any] | None) -> str:
    if not item:
        return ""
    return clean_text(item.get("serviceAccountNumber") or item.get("accountNumber") or item.get("serviceNumber") or item.get("id"))


def is_iptv_service(item: dict[str, Any]) -> bool:
    service_type = service_type_for(item)
    return service_type in IPTV_SERVICE_TYPES or contains_keyword(item, IPTV_KEYWORDS)


def is_internet_service_account(account: dict[str, Any]) -> bool:
    service_type = service_type_for(account)
    if service_type in INTERNET_SERVICE_TYPES:
        return True
    if is_iptv_service(account):
        return False
    if "INTERNET" in normalize_upper(text_blob(account)):
        return True
    return not service_type


def is_internet_order(order: dict[str, Any]) -> bool:
    service_type = service_type_for(order)
    if service_type in INTERNET_SERVICE_TYPES:
        return True
    if is_iptv_service(order):
        return False
    order_type = normalize_upper(order.get("orderType"))
    if order_type == "NEW_INSTALLATION":
        return True
    return "INTERNET" in normalize_upper(text_blob(order))


def active_service_account(accounts: list[dict[str, Any]]) -> dict[str, Any] | None:
    return next((account for account in accounts if normalize_upper(account.get("status")) == "ACTIVE"), None) or (accounts[0] if accounts else None)


def access_action(code: str, label: str, tone: str = "warning") -> dict[str, str]:
    return {"code": code, "label": label, "tone": tone}


def internet_access_summary(record: dict[str, Any], service: dict[str, Any], pppoe_status: str) -> dict[str, Any]:
    internet_accounts = [account for account in service.get("serviceAccounts") or [] if is_internet_service_account(account)]
    internet_orders = [order for order in service.get("serviceOrders") or [] if is_internet_order(order)]
    primary_account = active_service_account(internet_accounts)
    bound = record.get("pppoeBinding") or {}
    bound_username = clean_text(bound.get("username") or record.get("desiredPppoeUsername"))
    router_name = clean_text(bound.get("routerName") or record.get("routerName"))
    ip_address = clean_text(bound.get("activeAddress") or bound.get("remoteAddress") or record.get("staticIp"))
    subscribed = bool(primary_account or internet_orders)
    has_binding = bool(bound)
    status = "NO_SERVICE"
    if subscribed and not primary_account and internet_orders:
        status = "PENDING_SERVICE"
    if primary_account:
        if not has_binding:
            status = "NEEDS_SETUP"
        elif pppoe_status == "ONLINE":
            status = "ACTIVE"
        elif pppoe_status == "DISABLED":
            status = "DISABLED"
        elif pppoe_status == "OFFLINE":
            status = "OFFLINE"
        else:
            status = "PROVISIONED"
    return {
        "type": "INTERNET",
        "label": "Internet Access",
        "status": status,
        "subscribed": subscribed,
        "hasAccess": has_binding and status not in {"DISABLED"},
        "needsAction": status in {"NEEDS_SETUP", "OFFLINE", "DISABLED", "PENDING_SERVICE"},
        "primary": bound_username or ("Pending PPPoE" if subscribed else "No internet service"),
        "secondary": " / ".join(part for part in [router_name, ip_address] if part),
        "planName": service_plan_name(primary_account),
        "serviceAccountNumber": service_account_number(primary_account),
        "pppoeStatus": pppoe_status,
        "routerName": router_name,
        "ipAddress": ip_address,
        "details": [
            detail
            for detail in [
                service_plan_name(primary_account),
                service_account_number(primary_account),
                pppoe_status if has_binding else "",
            ]
            if detail
        ],
    }


def hotspot_access_summary(customer: dict[str, Any], service: dict[str, Any]) -> dict[str, Any]:
    contacts = hotspot_contacts_for_customer(customer)
    enabled_contacts = [contact for contact in contacts if contact.get("enabled")]
    base_status = hotspot_status_for_customer(customer, service, contacts)
    settings = load_hotspot_access_state().get("settings") or {}
    integration_enabled = bool(settings.get("enabled"))
    if base_status == "SUSPENDED":
        status = "SUSPENDED"
    elif not customer_has_active_service(service):
        status = "NO_SERVICE"
    elif not enabled_contacts:
        status = "NO_CONTACT"
    elif integration_enabled:
        status = "ACTIVE"
    else:
        status = "READY_TO_SYNC"
    return {
        "type": "HOTSPOT",
        "label": "Hotspot Access",
        "status": status,
        "eligible": base_status == "ACTIVE",
        "hasAccess": status == "ACTIVE",
        "needsAction": status in {"READY_TO_SYNC", "NO_CONTACT"},
        "primary": f"{len(enabled_contacts)}/{len(contacts)} contacts enabled" if contacts else "No mobile contacts",
        "secondary": "Pisowifi sync enabled" if integration_enabled else "Pisowifi sync disabled",
        "contactCount": len(contacts),
        "enabledContactCount": len(enabled_contacts),
        "integrationEnabled": integration_enabled,
        "details": [
            f"{len(enabled_contacts)} enabled",
            f"{len(contacts)} total contacts",
            "sync enabled" if integration_enabled else "sync disabled",
        ],
    }


def iptv_device_identifier(account: dict[str, Any] | None) -> str:
    if not account:
        return ""
    equipment = account.get("equipmentInfo") if isinstance(account.get("equipmentInfo"), dict) else {}
    network = account.get("networkInfo") if isinstance(account.get("networkInfo"), dict) else {}
    for source in (equipment, network, account):
        for field in ("iptvAccount", "iptvUsername", "stbMac", "stbSerial", "setTopBoxSerial", "deviceId", "macAddress", "serialNumber"):
            value = clean_text(source.get(field))
            if value:
                return value
    return ""


def iptv_access_summary(service: dict[str, Any]) -> dict[str, Any]:
    iptv_accounts = [account for account in service.get("serviceAccounts") or [] if is_iptv_service(account)]
    iptv_orders = [order for order in service.get("serviceOrders") or [] if is_iptv_service(order)]
    active_account = active_service_account([account for account in iptv_accounts if normalize_upper(account.get("status")) == "ACTIVE"])
    primary_account = active_account or active_service_account(iptv_accounts)
    device_id = iptv_device_identifier(primary_account)
    subscribed = bool(iptv_accounts or iptv_orders)
    if not subscribed:
        status = "NOT_SUBSCRIBED"
    elif active_account and device_id:
        status = "ACTIVE"
    elif active_account:
        status = "NEEDS_SETUP"
    elif any(order_status(order) not in {"COMPLETED", "CANCELLED", "REJECTED"} for order in iptv_orders):
        status = "PENDING"
    else:
        status = "SUBSCRIBED"
    return {
        "type": "IPTV",
        "label": "IPTV Access",
        "status": status,
        "subscribed": subscribed,
        "hasAccess": status == "ACTIVE",
        "needsAction": status == "NEEDS_SETUP",
        "primary": service_plan_name(primary_account) or ("IPTV subscription pending" if subscribed else "No IPTV subscription"),
        "secondary": device_id or ("No IPTV device bound" if subscribed else "Future service"),
        "planName": service_plan_name(primary_account),
        "serviceAccountNumber": service_account_number(primary_account),
        "deviceId": device_id,
        "details": [
            detail
            for detail in [
                service_plan_name(primary_account),
                service_account_number(primary_account),
                device_id,
            ]
            if detail
        ],
    }


def customer_access_summary(
    customer: dict[str, Any],
    record: dict[str, Any],
    service: dict[str, Any],
    pppoe_status: str,
    review_flags: list[str],
) -> dict[str, Any]:
    internet = internet_access_summary(record, service, pppoe_status)
    hotspot = hotspot_access_summary(customer, service)
    iptv = iptv_access_summary(service)
    actions: list[dict[str, str]] = []
    if internet["status"] == "NEEDS_SETUP":
        actions.append(access_action("CREATE_PPPOE_ACCOUNT", "Create PPPoE Account", "green"))
    elif internet["status"] in {"OFFLINE", "DISABLED"}:
        actions.append(access_action("REVIEW_PPPOE", "Review PPPoE"))
    elif internet["status"] == "PENDING_SERVICE":
        actions.append(access_action("COMPLETE_SERVICE", "Complete Service Order"))
    if hotspot["status"] == "NO_CONTACT":
        actions.append(access_action("ADD_HOTSPOT_CONTACT", "Add Hotspot Contact"))
    elif hotspot["status"] == "READY_TO_SYNC":
        actions.append(access_action("SYNC_HOTSPOT", "Sync Hotspot", "blue"))
    if iptv["status"] == "NEEDS_SETUP":
        actions.append(access_action("SETUP_IPTV", "Set Up IPTV"))
    if review_flags:
        actions.append(access_action("REVIEW_ACCOUNT", "Review Account", "red"))
    has_any_access = any(summary.get("hasAccess") for summary in (internet, hotspot, iptv))
    has_subscription = bool(internet.get("subscribed") or hotspot.get("eligible") or iptv.get("subscribed"))
    if actions:
        overall_status = "NEEDS_ACTION"
    elif has_any_access:
        overall_status = "ACTIVE"
    elif has_subscription:
        overall_status = "PENDING_PROVISIONING"
    else:
        overall_status = "NO_ACCESS"
    return {
        "overallStatus": overall_status,
        "hasAnyAccess": has_any_access,
        "needsAction": bool(actions),
        "actionRequired": actions,
        "internetAccess": internet,
        "hotspotAccess": hotspot,
        "iptvAccess": iptv,
    }


def pppoe_snapshot(admin: dict[str, Any] | None = None, refresh: bool = False) -> dict[str, Any]:
    if not refresh and pppoe_discovery_cache.get("capturedAt"):
        return pppoe_discovery_cache
    if admin is None:
        return pppoe_discovery_cache
    try:
        snapshot = network_pppoe_accounts(admin=admin)
    except Exception as exc:  # Network devices may be offline or not configured yet.
        snapshot = {
            "capturedAt": now_iso(),
            "accounts": [],
            "kpis": {},
            "routers": [],
            "profiles": [],
            "deviceErrors": [{"message": clean_text(exc) or "Unable to read PPPoE accounts"}],
            "source": "routeros-api",
        }
    pppoe_discovery_cache.update(snapshot)
    return pppoe_discovery_cache


def onu_snapshot(admin: dict[str, Any] | None = None, refresh: bool = False) -> dict[str, Any]:
    if not refresh and onu_discovery_cache.get("capturedAt"):
        return onu_discovery_cache
    if admin is None:
        return onu_discovery_cache
    try:
        onus = network_onus(admin=admin)
        snapshot = {
            "capturedAt": now_iso(),
            "onus": onus,
            "deviceErrors": [],
            "source": "network-settings",
        }
    except Exception as exc:  # OLT data may be unavailable during first setup.
        snapshot = {
            "capturedAt": now_iso(),
            "onus": [],
            "deviceErrors": [{"message": clean_text(exc) or "Unable to read ONU inventory"}],
            "source": "network-settings",
        }
    onu_discovery_cache.update(snapshot)
    return onu_discovery_cache


def normalize_key(value: Any) -> str:
    return "".join(ch for ch in clean_text(value).lower() if ch.isalnum())


def normalize_mac_key(value: Any) -> str:
    return "".join(ch for ch in normalize_upper(value) if ch in "0123456789ABCDEF")


def pppoe_mac_key(account: dict[str, Any]) -> str:
    for field in ("macAddress", "callerId", "lastCallerId"):
        key = normalize_mac_key(account.get(field))
        if len(key) == 12:
            return key
    return ""


def onu_mac_key(onu: dict[str, Any] | None) -> str:
    if not onu:
        return ""
    for field in ("macAddress", "learnedClientMacAddress"):
        key = normalize_mac_key(onu.get(field))
        if len(key) == 12:
            return key
    return ""


def mac_tail_delta(source: str, candidate: str) -> int | None:
    if len(source) != 12 or len(candidate) != 12:
        return None
    if source[:6] != candidate[:6]:
        return None
    return abs(int(source[6:], 16) - int(candidate[6:], 16))


def onu_physical_key(onu: dict[str, Any]) -> str:
    olt_id = clean_text(onu.get("oltId"))
    pon_id = clean_text(onu.get("ponPortId"))
    onu_id = clean_text(onu.get("onuId"))
    if olt_id and pon_id and onu_id:
        return f"{olt_id}:{pon_id}:{onu_id}"
    source_device_id = clean_text(onu.get("sourceDeviceId"))
    source_if_name = clean_text(onu.get("sourceIfName"))
    if source_device_id and source_if_name:
        return f"{source_device_id}:{source_if_name}"
    return clean_text(onu.get("id")) or onu_mac_key(onu)


def onu_match_key(onu: dict[str, Any]) -> str:
    return onu_physical_key(onu)


def onu_evidence_score(onu: dict[str, Any]) -> tuple[int, int, int, int, int, int, str, str]:
    optical_fields = ("rxPowerDbm", "txPowerDbm", "distanceMeters", "temperatureC", "voltageV", "biasCurrentMa")
    return (
        1 if onu_mac_key(onu) else 0,
        1 if clean_text(onu.get("macAddress")) else 0,
        1 if clean_text(onu.get("learnedClientMacAddress")) else 0,
        1 if clean_text(onu.get("serialNumber")) else 0,
        sum(1 for field in optical_fields if clean_text(onu.get(field))),
        1 if normalize_upper(onu.get("status")) == "ONLINE" else 0,
        clean_text(onu.get("lastCapturedAt") or onu.get("updatedAt")),
        clean_text(onu.get("id")),
    )


def merge_onu_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    ordered = sorted(rows, key=onu_evidence_score, reverse=True)
    merged = dict(ordered[0])
    for row in ordered[1:]:
        for key, value in row.items():
            if clean_text(value) and not clean_text(merged.get(key)):
                merged[key] = value
    if len(rows) > 1:
        merged["sourceDuplicateCount"] = len(rows)
    return merged


def dedupe_onus_for_mapping(onus: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for onu in onus:
        key = onu_physical_key(onu)
        if key:
            grouped.setdefault(key, []).append(onu)
    return sorted((merge_onu_rows(rows) for rows in grouped.values()), key=onu_sort_key)


def onu_sort_key(onu: dict[str, Any]) -> tuple[str, str, str, str, str]:
    return (
        clean_text(onu.get("oltName")),
        clean_text(onu.get("ponLabel")),
        clean_text(onu.get("onuId")),
        clean_text(onu.get("name")),
        onu_match_key(onu),
    )


def pppoe_sort_key(account: dict[str, Any]) -> tuple[str, str, str]:
    return (
        clean_text(account.get("routerName")),
        clean_text(account.get("username")),
        pppoe_binding_key(account),
    )


def pppoe_mapping_summary(account: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": account.get("id", ""),
        "routerId": account.get("routerId", ""),
        "routerName": account.get("routerName", ""),
        "routerEndpoint": account.get("routerEndpoint", ""),
        "username": account.get("username", ""),
        "service": account.get("service", ""),
        "profile": account.get("profile", ""),
        "status": account.get("status", ""),
        "active": bool(account.get("active")),
        "disabled": bool(account.get("disabled")),
        "callerId": account.get("callerId", ""),
        "macAddress": account.get("macAddress", ""),
        "lastCallerId": account.get("lastCallerId", ""),
        "activeAddress": account.get("activeAddress", ""),
        "remoteAddress": account.get("remoteAddress", ""),
        "comment": account.get("comment", ""),
        "source": account.get("source", ""),
    }


def onu_mapping_summary(onu: dict[str, Any] | None) -> dict[str, Any] | None:
    if not onu:
        return None
    return {
        "id": onu.get("id", ""),
        "oltId": onu.get("oltId", ""),
        "oltName": onu.get("oltName", ""),
        "ponPortId": onu.get("ponPortId", ""),
        "ponLabel": onu.get("ponLabel", ""),
        "ponPortNumber": onu.get("ponPortNumber", ""),
        "onuId": onu.get("onuId", ""),
        "name": onu.get("name", ""),
        "serialNumber": onu.get("serialNumber", ""),
        "macAddress": onu.get("macAddress", ""),
        "learnedClientMacAddress": onu.get("learnedClientMacAddress", ""),
        "status": onu.get("status", ""),
        "rxPowerDbm": onu.get("rxPowerDbm", ""),
        "txPowerDbm": onu.get("txPowerDbm", ""),
        "distanceMeters": onu.get("distanceMeters", ""),
        "sourceDeviceName": onu.get("sourceDeviceName", ""),
        "lastCapturedAt": onu.get("lastCapturedAt", ""),
        "sourceDuplicateCount": onu.get("sourceDuplicateCount", 1),
    }


def customer_mapping_summary(customer: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": customer.get("id", ""),
        "accountNumber": customer.get("accountNumber", ""),
        "name": customer_display_name(customer),
        "status": customer.get("status", ""),
        "customerType": customer.get("customerType", ""),
        "contactNumber": customer.get("contactNumber", ""),
        "address": customer.get("address", ""),
        "source": customer.get("source", "customer-profiling"),
        "temporary": bool(customer.get("temporary")),
    }


def sample_mapping_customer(account: dict[str, Any], onu: dict[str, Any] | None) -> dict[str, Any]:
    username = clean_text(account.get("username")) or "PPPoE"
    return {
        "id": "sample-pppoe-onu-customer",
        "accountNumber": "DEMO-PPPOE-ONU",
        "fullName": f"Sample {username} Customer",
        "status": "ACTIVE",
        "customerType": "RESIDENTIAL",
        "contactNumber": "09000000000",
        "address": "Temporary mapping profile",
        "source": "account-admin-temporary-sample",
        "temporary": True,
        "matchedPppoeUsername": username,
        "matchedOnuName": clean_text((onu or {}).get("name")),
    }


def customer_for_pppoe(account: dict[str, Any], customers: list[dict[str, Any]]) -> dict[str, Any] | None:
    username = normalize_key(account.get("username"))
    comment = normalize_key(account.get("comment"))
    for customer in customers:
        account_number = normalize_key(customer.get("accountNumber"))
        full_name = normalize_key(customer_display_name(customer))
        record = customer_network_records.get(customer["id"], {})
        desired = normalize_key(record.get("desiredPppoeUsername"))
        binding = record.get("pppoeBinding") or {}
        bound_username = normalize_key(binding.get("username"))
        if desired and desired == username:
            return customer
        if bound_username and bound_username == username:
            return customer
        if account_number and (account_number in username or account_number in comment):
            return customer
        if full_name and len(full_name) >= 8 and (full_name in username or full_name in comment):
            return customer
    return None


def pppoe_metadata_key(account: dict[str, Any]) -> str:
    account_text = " ".join(
        clean_text(account.get(field))
        for field in ("username", "comment", "callerId", "lastCallerId")
        if clean_text(account.get(field))
    )
    return normalize_key(account_text)


def default_onu_match(account: dict[str, Any]) -> dict[str, Any]:
    return {
        "onu": None,
        "matchStatus": "UNMATCHED_ONU",
        "matchReason": "No matching ONU MAC evidence or identifier found",
        "matchMethod": "none",
        "matchConfidence": "none",
        "pppoeMacKey": pppoe_mac_key(account),
        "onuMacKey": "",
        "macDelta": None,
    }


def pppoe_onu_match_lookup(
    accounts: list[dict[str, Any]],
    onus: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    onus = dedupe_onus_for_mapping(onus)
    matches = {pppoe_binding_key(account): default_onu_match(account) for account in accounts}
    available_accounts = {pppoe_binding_key(account) for account in accounts if pppoe_binding_key(account)}
    available_onus = {onu_match_key(onu) for onu in onus if onu_match_key(onu)}
    onu_by_key = {onu_match_key(onu): onu for onu in onus if onu_match_key(onu)}
    onu_mac_index: dict[str, list[dict[str, Any]]] = {}
    for onu in onus:
        mac_key = onu_mac_key(onu)
        if mac_key:
            onu_mac_index.setdefault(mac_key, []).append(onu)

    def assign(
        account: dict[str, Any],
        onu: dict[str, Any],
        status: str,
        reason: str,
        method: str,
        confidence: str,
        mac_delta: int | None = None,
    ) -> None:
        account_key = pppoe_binding_key(account)
        onu_key = onu_match_key(onu)
        matches[account_key] = {
            "onu": onu,
            "matchStatus": status,
            "matchReason": reason,
            "matchMethod": method,
            "matchConfidence": confidence,
            "pppoeMacKey": pppoe_mac_key(account),
            "onuMacKey": onu_mac_key(onu),
            "macDelta": mac_delta,
        }
        available_accounts.discard(account_key)
        available_onus.discard(onu_key)

    for account in sorted(accounts, key=pppoe_sort_key):
        account_key = pppoe_binding_key(account)
        mac_key = pppoe_mac_key(account)
        if not account_key or account_key not in available_accounts or not mac_key:
            continue
        exact_candidates = sorted(
            [onu for onu in onu_mac_index.get(mac_key, []) if onu_match_key(onu) in available_onus],
            key=onu_sort_key,
        )
        if exact_candidates:
            assign(
                account,
                exact_candidates[0],
                "MATCHED_EXACT",
                "PPPoE caller ID exactly matched ONU MAC evidence",
                "exact_mac",
                "high",
                0,
            )

    proximity_candidates: dict[str, tuple[str, int] | None] = {}
    onu_best_account: dict[str, tuple[str, int] | None] = {}
    for account in sorted(accounts, key=pppoe_sort_key):
        account_key = pppoe_binding_key(account)
        mac_key = pppoe_mac_key(account)
        if not account_key or account_key not in available_accounts or not mac_key:
            continue
        candidates: list[tuple[int, str]] = []
        for onu_key in available_onus:
            delta = mac_tail_delta(mac_key, onu_mac_key(onu_by_key[onu_key]))
            if delta is not None and 0 < delta <= MAC_PROXIMITY_MATCH_MAX_DELTA:
                candidates.append((delta, onu_key))
        candidates.sort(key=lambda item: (item[0], onu_sort_key(onu_by_key[item[1]])))
        if candidates and (len(candidates) == 1 or candidates[0][0] < candidates[1][0]):
            proximity_candidates[account_key] = (candidates[0][1], candidates[0][0])

    for onu_key in sorted(available_onus, key=lambda key: onu_sort_key(onu_by_key[key])):
        candidates = [
            (candidate[1], account_key)
            for account_key, candidate in proximity_candidates.items()
            if candidate and candidate[0] == onu_key
        ]
        candidates.sort(key=lambda item: (item[0], pppoe_sort_key(next(account for account in accounts if pppoe_binding_key(account) == item[1]))))
        if candidates and (len(candidates) == 1 or candidates[0][0] < candidates[1][0]):
            onu_best_account[onu_key] = (candidates[0][1], candidates[0][0])

    account_by_key = {pppoe_binding_key(account): account for account in accounts if pppoe_binding_key(account)}
    for account_key, candidate in sorted(proximity_candidates.items(), key=lambda item: pppoe_sort_key(account_by_key[item[0]])):
        if not candidate:
            continue
        onu_key, delta = candidate
        if account_key not in available_accounts or onu_key not in available_onus:
            continue
        best = onu_best_account.get(onu_key)
        if not best or best[0] != account_key:
            continue
        assign(
            account_by_key[account_key],
            onu_by_key[onu_key],
            "MATCHED_PROXIMITY",
            f"Same OUI and MAC ending delta {delta} between PPPoE caller ID and ONU MAC evidence",
            "same_oui_tail_delta",
            "high",
            delta,
        )

    for account in sorted(accounts, key=pppoe_sort_key):
        account_key = pppoe_binding_key(account)
        if not account_key or account_key not in available_accounts:
            continue
        account_key_text = pppoe_metadata_key(account)
        if not account_key_text:
            continue
        for onu_key in sorted(available_onus, key=lambda key: onu_sort_key(onu_by_key[key])):
            onu = onu_by_key[onu_key]
            for field in ("serialNumber", "name", "sourceIfName", "sourceIfDescr", "description"):
                field_key = normalize_key(onu.get(field))
                if field_key and len(field_key) >= 6 and field_key in account_key_text:
                    assign(
                        account,
                        onu,
                        "MATCHED_METADATA",
                        f"PPPoE metadata referenced ONU {field}",
                        "metadata_identifier",
                        "medium",
                    )
                    break
            if account_key not in available_accounts:
                break

    return matches


def match_onu_for_pppoe(account: dict[str, Any], onus: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, str, str]:
    match = pppoe_onu_match_lookup([account], onus).get(pppoe_binding_key(account), default_onu_match(account))
    return match.get("onu"), match["matchStatus"], match["matchReason"]


def mapping_search_text(mapping: dict[str, Any]) -> str:
    pppoe = mapping.get("pppoe") or {}
    onu = mapping.get("onu") or {}
    customer = mapping.get("customer") or {}
    return " ".join(
        clean_text(value)
        for value in [
            pppoe.get("username"),
            pppoe.get("routerName"),
            pppoe.get("profile"),
            pppoe.get("status"),
            pppoe.get("callerId"),
            pppoe.get("macAddress"),
            pppoe.get("activeAddress"),
            onu.get("name"),
            onu.get("onuId"),
            onu.get("macAddress"),
            onu.get("learnedClientMacAddress"),
            onu.get("serialNumber"),
            onu.get("oltName"),
            customer.get("accountNumber"),
            customer.get("name"),
            mapping.get("matchStatus"),
            mapping.get("matchReason"),
            mapping.get("matchMethod"),
            mapping.get("matchConfidence"),
            mapping.get("macDelta"),
        ]
    ).lower()


def filtered_mapping_rows(rows: list[dict[str, Any]], search: str = "", status: str = "") -> list[dict[str, Any]]:
    needle = search.strip().lower()
    normalized_status = normalize_upper(status)
    result = rows
    if normalized_status:
        result = [row for row in result if normalize_upper((row.get("pppoe") or {}).get("status")) == normalized_status]
    if needle:
        result = [row for row in result if needle in mapping_search_text(row)]
    return result


def pppoe_onu_mapping_snapshot(
    admin: dict[str, Any] | None = None,
    refresh: bool = False,
    search: str = "",
    status: str = "",
) -> dict[str, Any]:
    customers = ensure_customer_network_records()
    pppoe_data = pppoe_snapshot(admin=admin, refresh=refresh)
    onu_data = onu_snapshot(admin=admin, refresh=refresh)
    accounts = pppoe_data.get("accounts", [])
    onus = onu_data.get("onus", [])
    match_lookup = pppoe_onu_match_lookup(accounts, onus)
    mappings: list[dict[str, Any]] = []
    sample_match: dict[str, Any] | None = None

    for account in accounts:
        match = match_lookup.get(pppoe_binding_key(account), default_onu_match(account))
        onu = match.get("onu")
        customer = customer_for_pppoe(account, customers)
        is_sample_customer = False
        if onu and customer is None and sample_match is None:
            customer = sample_mapping_customer(account, onu)
            is_sample_customer = True
        mapping = {
            "id": pppoe_binding_key(account),
            "pppoe": pppoe_mapping_summary(account),
            "onu": onu_mapping_summary(onu),
            "customer": customer_mapping_summary(customer) if customer else None,
            "matchStatus": match["matchStatus"],
            "matchReason": match["matchReason"],
            "matchMethod": match["matchMethod"],
            "matchConfidence": match["matchConfidence"],
            "pppoeMacKey": match["pppoeMacKey"],
            "onuMacKey": match["onuMacKey"],
            "macDelta": match["macDelta"],
            "matched": bool(onu),
            "sampleCustomerProfile": is_sample_customer,
        }
        mappings.append(mapping)
        if is_sample_customer:
            sample_match = mapping

    if sample_match is None and pppoe_data.get("accounts") and onus:
        account = pppoe_data["accounts"][0]
        onu = onus[0]
        sample_match = {
            "id": "sample-pppoe-onu-fallback",
            "pppoe": pppoe_mapping_summary(account),
            "onu": onu_mapping_summary(onu),
            "customer": customer_mapping_summary(sample_mapping_customer(account, onu)),
            "matchStatus": "SAMPLE_MATCH",
            "matchReason": "Temporary sample customer profile for PPPoE-to-ONU review",
            "matchMethod": "sample",
            "matchConfidence": "sample",
            "pppoeMacKey": pppoe_mac_key(account),
            "onuMacKey": onu_mac_key(onu),
            "macDelta": mac_tail_delta(pppoe_mac_key(account), onu_mac_key(onu)),
            "matched": True,
            "sampleCustomerProfile": True,
        }

    filtered_mappings = filtered_mapping_rows(mappings, search=search, status=status)
    unmatched = [row for row in mappings if row["matchStatus"] == "UNMATCHED_ONU"]
    filtered_unmatched = filtered_mapping_rows(unmatched, search=search, status=status)
    matched_count = sum(1 for row in mappings if row["matched"])
    return {
        "capturedAt": max(clean_text(pppoe_data.get("capturedAt")), clean_text(onu_data.get("capturedAt"))),
        "mappings": filtered_mappings,
        "totalMappings": len(mappings),
        "unmatchedPppoe": filtered_unmatched,
        "totalUnmatchedPppoe": len(unmatched),
        "matchedCount": matched_count,
        "unmatchedCount": len(unmatched),
        "pppoeCount": len(pppoe_data.get("accounts", [])),
        "onuCount": len(onus),
        "sampleMatch": sample_match,
        "deviceErrors": [
            *(pppoe_data.get("deviceErrors") or []),
            *(onu_data.get("deviceErrors") or []),
        ],
        "sources": {
            "pppoe": pppoe_data.get("source", "routeros-api"),
            "onus": onu_data.get("source", "network-settings"),
        },
    }


def binding_map() -> dict[str, list[dict[str, Any]]]:
    bindings: dict[str, list[dict[str, Any]]] = {}
    for record in customer_network_records.values():
        key = pppoe_binding_key(record.get("pppoeBinding"))
        if key:
            bindings.setdefault(key, []).append(record)
    return bindings


def pppoe_account_lookup(snapshot: dict[str, Any]) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    for account in snapshot.get("accounts", []):
        key = pppoe_binding_key(account)
        if key:
            lookup[key] = account
    return lookup


def unbound_pppoe_accounts(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    bound = set(binding_map())
    return [account for account in snapshot.get("accounts", []) if pppoe_binding_key(account) not in bound]


def suggest_pppoe(customer: dict[str, Any], accounts: list[dict[str, Any]], bound_keys: set[str]) -> dict[str, Any] | None:
    account_number = customer_account_number(customer).lower()
    compact_name = "".join(ch for ch in customer_display_name(customer).lower() if ch.isalnum())
    for account in accounts:
        key = pppoe_binding_key(account)
        username = clean_text(account.get("username")).lower()
        if not username or key in bound_keys:
            continue
        if account_number and account_number in username:
            return account
        if compact_name and compact_name[:10] and compact_name[:10] in "".join(ch for ch in username if ch.isalnum()):
            return account
    return None


def compute_lifecycle(record: dict[str, Any], customer: dict[str, Any], service: dict[str, Any]) -> str:
    explicit = record.get("lifecycleStatus")
    if explicit in {"SUSPENDED", "DISCONNECTED", "SYNC_ERROR"}:
        return explicit
    if customer.get("status") == "SUSPENDED":
        return "SUSPENDED"
    if customer.get("status") == "INACTIVE":
        return "DISCONNECTED"
    if record.get("provisioningStatus") == "PENDING":
        return "PENDING_PROVISIONING"
    if record.get("pppoeBinding") and service.get("serviceAccount"):
        return "ACTIVE"
    if record.get("pppoeBinding"):
        return "PROVISIONED"
    installation = service.get("installationOrder")
    if not installation and not service.get("serviceAccount"):
        return "CUSTOMER_ONLY"
    if installation and order_status(installation) != "COMPLETED":
        return "FOR_INSTALLATION"
    if service.get("completedInstallationOrder") or service.get("serviceAccount"):
        return "FOR_ACTIVATION"
    return "NEEDS_REVIEW"


def review_flags(
    record: dict[str, Any],
    customer: dict[str, Any],
    service: dict[str, Any],
    discovered_lookup: dict[str, dict[str, Any]],
    duplicate_bindings: dict[str, list[dict[str, Any]]],
) -> list[str]:
    flags: list[str] = []
    installation = service.get("installationOrder")
    if not installation and not service.get("serviceAccount"):
        flags.append("No service order or service account")
    elif installation and order_status(installation) != "COMPLETED":
        flags.append("Installation order is not completed")
    elif not record.get("pppoeBinding"):
        flags.append("Ready for activation; no PPPoE binding")
    if record.get("pppoeBinding") and not service.get("serviceAccount"):
        flags.append("PPPoE bound without active service account")
    binding_key = pppoe_binding_key(record.get("pppoeBinding"))
    if binding_key:
        if len(duplicate_bindings.get(binding_key, [])) > 1:
            flags.append("PPPoE account is bound to multiple customers")
        if discovered_lookup and binding_key not in discovered_lookup:
            flags.append("Bound PPPoE account was not found in latest MikroTik discovery")
    if customer.get("status") in {"INACTIVE", "SUSPENDED"} and (record.get("pppoeBinding") or {}).get("status") == "ONLINE":
        flags.append("Customer is not active but PPPoE session is online")
    if record.get("provisioningStatus") == "ERROR":
        flags.append("Provisioning request has an error")
    return flags


def customer_network_row(
    customer: dict[str, Any],
    snapshot: dict[str, Any],
    duplicate_bindings: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    record = normalize_record(customer_network_records[customer["id"]], customer)
    service = service_bundle(customer["id"])
    tickets = ticket_bundle(customer["id"])
    discovered_lookup = pppoe_account_lookup(snapshot)
    bound_keys = set(binding_map())
    suggestion = suggest_pppoe(customer, snapshot.get("accounts", []), bound_keys) if not record.get("pppoeBinding") else None
    lifecycle = compute_lifecycle(record, customer, service)
    flags = review_flags(record, customer, service, discovered_lookup, duplicate_bindings)
    bound = record.get("pppoeBinding") or {}
    live_account = discovered_lookup.get(pppoe_binding_key(bound), {})
    pppoe_status = clean_text(live_account.get("status") or bound.get("status")) or "UNBOUND"
    access_summary = customer_access_summary(customer, record, service, pppoe_status, flags)
    return {
        "id": record["id"],
        "customerId": customer["id"],
        "customer": {
            "id": customer["id"],
            "accountNumber": customer.get("accountNumber", ""),
            "name": customer_display_name(customer),
            "status": customer.get("status", ""),
            "customerType": customer.get("customerType", ""),
            "contactNumber": customer.get("contactNumber", ""),
            "address": customer.get("address", ""),
            "locationId": customer.get("locationId", ""),
            "locationName": customer.get("locationName", ""),
            "barangay": customer.get("barangay", ""),
            "city": customer.get("city", ""),
            "province": customer.get("province", ""),
        },
        "serviceAccount": service.get("serviceAccount"),
        "serviceOrders": service.get("serviceOrders", []),
        "installationOrder": service.get("installationOrder"),
        "tickets": tickets["tickets"],
        "ticketCount": tickets["ticketCount"],
        "openTicketCount": tickets["openTicketCount"],
        "latestTicket": tickets["latestTicket"],
        "activationReadiness": "READY" if lifecycle == "FOR_ACTIVATION" else "WAITING",
        "lifecycleStatus": lifecycle,
        "provisioningStatus": record.get("provisioningStatus", "NOT_REQUESTED"),
        "accessSummary": access_summary,
        "pppoeStatus": pppoe_status,
        "onlineStatus": "ONLINE" if pppoe_status == "ONLINE" else "OFFLINE" if pppoe_status in {"OFFLINE", "DISABLED"} else "UNASSIGNED",
        "desiredPppoeUsername": record.get("desiredPppoeUsername", ""),
        "pppoeProfile": record.get("pppoeProfile", ""),
        "pppoePasswordSet": bool(record.get("pppoePasswordSet")),
        "pppoePasswordUpdatedAt": record.get("pppoePasswordUpdatedAt", ""),
        "pppoeBinding": {**bound, **live_account} if bound or live_account else None,
        "suggestedPppoe": suggestion,
        "wifiSsid": record.get("wifiSsid", ""),
        "wifiPasswordSet": bool(record.get("wifiPasswordSet")),
        "wifiPasswordUpdatedAt": record.get("wifiPasswordUpdatedAt", ""),
        "cpeType": record.get("cpeType", ""),
        "cpeIdentifier": record.get("cpeIdentifier", ""),
        "onuId": record.get("onuId", ""),
        "routerId": record.get("routerId", ""),
        "routerName": record.get("routerName", ""),
        "bandwidthProfile": record.get("bandwidthProfile", ""),
        "ipMode": record.get("ipMode", "DYNAMIC"),
        "staticIp": record.get("staticIp", ""),
        "vlanId": record.get("vlanId", ""),
        "notes": record.get("notes", ""),
        "reviewFlags": flags,
        "needsReview": bool(flags) or bool(access_summary.get("needsAction")) or lifecycle in {"NEEDS_REVIEW", "SYNC_ERROR"},
        "provisioningRequests": record.get("provisioningRequests", []),
        "createdAt": record.get("createdAt", ""),
        "updatedAt": record.get("updatedAt", ""),
    }


def build_customer_network_rows(admin: dict[str, Any] | None = None, refresh_pppoe: bool = False) -> list[dict[str, Any]]:
    customers = ensure_customer_network_records()
    snapshot = pppoe_snapshot(admin=admin, refresh=refresh_pppoe)
    duplicates = binding_map()
    return [customer_network_row(customer, snapshot, duplicates) for customer in customers]


def filtered_customer_network_rows(
    rows: list[dict[str, Any]],
    search: str = "",
    lifecycle: str = "",
    pppoe_status: str = "",
    customer_status: str = "",
    service_status: str = "",
    access_filter: str = "",
    internet_status: str = "",
    hotspot_status: str = "",
    iptv_status: str = "",
    review_only: bool = False,
) -> list[dict[str, Any]]:
    normalized_lifecycle = normalize_upper(lifecycle)
    normalized_pppoe = normalize_upper(pppoe_status)
    normalized_customer_status = normalize_upper(customer_status)
    normalized_service_status = normalize_upper(service_status)
    normalized_access_filter = normalize_upper(access_filter)
    normalized_internet_status = normalize_upper(internet_status)
    normalized_hotspot_status = normalize_upper(hotspot_status)
    normalized_iptv_status = normalize_upper(iptv_status)
    needle = search.strip().lower()
    result = rows
    if normalized_lifecycle == "ACCOUNT_ACTIVE":
        result = [row for row in result if normalize_upper(row.get("customer", {}).get("status")) == "ACTIVE"]
    elif normalized_lifecycle == "ACCOUNT_INACTIVE":
        result = [row for row in result if normalize_upper(row.get("customer", {}).get("status")) != "ACTIVE"]
    elif normalized_lifecycle == "WITH_TICKETS":
        result = [row for row in result if int(row.get("ticketCount") or 0) > 0]
    elif normalized_lifecycle == "NEEDS_ACTION":
        result = [row for row in result if row.get("accessSummary", {}).get("needsAction") or row.get("needsReview")]
    elif normalized_lifecycle == "WITH_INTERNET":
        result = [row for row in result if row.get("accessSummary", {}).get("internetAccess", {}).get("hasAccess")]
    elif normalized_lifecycle == "WITH_HOTSPOT":
        result = [row for row in result if row.get("accessSummary", {}).get("hotspotAccess", {}).get("hasAccess")]
    elif normalized_lifecycle == "WITH_IPTV":
        result = [row for row in result if row.get("accessSummary", {}).get("iptvAccess", {}).get("subscribed")]
    elif normalized_lifecycle == "NO_ACCESS":
        result = [row for row in result if not row.get("accessSummary", {}).get("hasAnyAccess")]
    elif normalized_lifecycle:
        result = [row for row in result if row["lifecycleStatus"] == normalized_lifecycle]
    if normalized_pppoe:
        result = [row for row in result if row["pppoeStatus"] == normalized_pppoe]
    if normalized_customer_status:
        result = [row for row in result if normalize_upper(row.get("customer", {}).get("status")) == normalized_customer_status]
    if normalized_service_status:
        if normalized_service_status == "NO_SERVICE":
            result = [row for row in result if not row.get("serviceAccount")]
        else:
            result = [row for row in result if normalize_upper(row.get("serviceAccount", {}).get("status")) == normalized_service_status]
    if normalized_access_filter == "NEEDS_ACTION":
        result = [row for row in result if row.get("accessSummary", {}).get("needsAction") or row.get("needsReview")]
    elif normalized_access_filter == "WITH_INTERNET":
        result = [row for row in result if row.get("accessSummary", {}).get("internetAccess", {}).get("hasAccess")]
    elif normalized_access_filter == "WITH_HOTSPOT":
        result = [row for row in result if row.get("accessSummary", {}).get("hotspotAccess", {}).get("hasAccess")]
    elif normalized_access_filter == "WITH_IPTV":
        result = [row for row in result if row.get("accessSummary", {}).get("iptvAccess", {}).get("subscribed")]
    elif normalized_access_filter == "NO_ACCESS":
        result = [row for row in result if not row.get("accessSummary", {}).get("hasAnyAccess")]
    if normalized_internet_status:
        result = [row for row in result if normalize_upper(row.get("accessSummary", {}).get("internetAccess", {}).get("status")) == normalized_internet_status]
    if normalized_hotspot_status:
        result = [row for row in result if normalize_upper(row.get("accessSummary", {}).get("hotspotAccess", {}).get("status")) == normalized_hotspot_status]
    if normalized_iptv_status:
        result = [row for row in result if normalize_upper(row.get("accessSummary", {}).get("iptvAccess", {}).get("status")) == normalized_iptv_status]
    if review_only:
        result = [row for row in result if row["needsReview"]]
    if needle:
        result = [
            row
            for row in result
            if needle
            in " ".join(
                [
                    row["customer"].get("accountNumber", ""),
                    row["customer"].get("name", ""),
                    row["customer"].get("contactNumber", ""),
                    row.get("desiredPppoeUsername", ""),
                    row.get("pppoeProfile", ""),
                    row.get("wifiSsid", ""),
                    row.get("routerName", ""),
                    row.get("cpeIdentifier", ""),
                    row.get("onuId", ""),
                    row.get("accessSummary", {}).get("overallStatus", ""),
                    row.get("accessSummary", {}).get("internetAccess", {}).get("status", ""),
                    row.get("accessSummary", {}).get("internetAccess", {}).get("primary", ""),
                    row.get("accessSummary", {}).get("internetAccess", {}).get("secondary", ""),
                    row.get("accessSummary", {}).get("hotspotAccess", {}).get("status", ""),
                    row.get("accessSummary", {}).get("hotspotAccess", {}).get("primary", ""),
                    row.get("accessSummary", {}).get("iptvAccess", {}).get("status", ""),
                    row.get("accessSummary", {}).get("iptvAccess", {}).get("primary", ""),
                    " ".join(action.get("label", "") for action in row.get("accessSummary", {}).get("actionRequired", [])),
                    (row.get("latestTicket") or {}).get("ticketNumber", ""),
                    (row.get("latestTicket") or {}).get("subject", ""),
                    (row.get("latestTicket") or {}).get("category", ""),
                    (row.get("latestTicket") or {}).get("status", ""),
                    (row.get("latestTicket") or {}).get("priority", ""),
                    (row.get("latestTicket") or {}).get("assignedTo", ""),
                ]
            ).lower()
        ]
    return sorted(result, key=lambda row: row["customer"].get("name", ""))


def account_admin_metrics(admin: dict[str, Any] | None = None, rows: list[dict[str, Any]] | None = None) -> dict[str, int]:
    rows = rows if rows is not None else build_customer_network_rows(admin=admin)
    mapping = pppoe_onu_mapping_snapshot(admin=admin) if admin else {"unmatchedCount": 0, "matchedCount": 0, "onuCount": 0, "pppoeCount": 0}
    return {
        "customer_accounts": len(rows),
        "customer_networks": len(rows),
        "with_tickets": sum(1 for row in rows if int(row.get("ticketCount") or 0) > 0),
        "needs_action": sum(1 for row in rows if row.get("accessSummary", {}).get("needsAction") or row.get("needsReview")),
        "with_internet": sum(1 for row in rows if row.get("accessSummary", {}).get("internetAccess", {}).get("hasAccess")),
        "with_hotspot": sum(1 for row in rows if row.get("accessSummary", {}).get("hotspotAccess", {}).get("hasAccess")),
        "with_iptv": sum(1 for row in rows if row.get("accessSummary", {}).get("iptvAccess", {}).get("subscribed")),
        "no_access": sum(1 for row in rows if not row.get("accessSummary", {}).get("hasAnyAccess")),
        "active_customer_accounts": sum(1 for row in rows if normalize_upper(row.get("customer", {}).get("status")) == "ACTIVE"),
        "inactive_customer_accounts": sum(1 for row in rows if normalize_upper(row.get("customer", {}).get("status")) != "ACTIVE"),
        "pppoe_accounts": int(mapping.get("pppoeCount") or 0),
        "pppoe_without_onu": int(mapping.get("unmatchedCount") or 0),
        "pppoe_onu_matched": int(mapping.get("matchedCount") or 0),
        "discovered_onus": int(mapping.get("onuCount") or 0),
        "customer_only": sum(1 for row in rows if row["lifecycleStatus"] == "CUSTOMER_ONLY"),
        "active": sum(1 for row in rows if row["lifecycleStatus"] == "ACTIVE"),
        "for_installation": sum(1 for row in rows if row["lifecycleStatus"] == "FOR_INSTALLATION"),
        "for_activation": sum(1 for row in rows if row["lifecycleStatus"] == "FOR_ACTIVATION"),
        "suspended": sum(1 for row in rows if row["lifecycleStatus"] == "SUSPENDED"),
        "disconnected": sum(1 for row in rows if row["lifecycleStatus"] == "DISCONNECTED"),
        "pppoe_bound": sum(1 for row in rows if row.get("pppoeBinding")),
        "needs_review": sum(1 for row in rows if row["needsReview"]),
        "pending_provisioning": sum(1 for row in rows if row["provisioningStatus"] == "PENDING"),
    }


def find_customer_network(customer_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    customers = ensure_customer_network_records()
    for customer in customers:
        if customer["id"] == customer_id:
            return customer, customer_network_records[customer_id]
    raise HTTPException(status_code=404, detail="Customer network record not found")


def apply_network_config(record: dict[str, Any], payload: NetworkConfigPayload) -> None:
    data = payload.model_dump(exclude_unset=True)
    if "lifecycleStatus" in data and data["lifecycleStatus"] is not None:
        status = normalize_upper(data["lifecycleStatus"])
        if status not in LIFECYCLE_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid Customer Network status")
        record["lifecycleStatus"] = status
    string_fields = [
        "desiredPppoeUsername",
        "pppoeProfile",
        "wifiSsid",
        "cpeType",
        "cpeIdentifier",
        "onuId",
        "routerId",
        "routerName",
        "bandwidthProfile",
        "staticIp",
        "vlanId",
        "notes",
    ]
    for field in string_fields:
        if field in data and data[field] is not None:
            record[field] = clean_text(data[field])
    if "ipMode" in data and data["ipMode"] is not None:
        mode = normalize_upper(data["ipMode"])
        if mode not in IP_MODES:
            raise HTTPException(status_code=400, detail="Invalid IP mode")
        record["ipMode"] = mode
    timestamp = now_iso()
    if clean_text(data.get("pppoePassword")):
        record["pppoePasswordSet"] = True
        record["pppoePasswordUpdatedAt"] = timestamp
    if clean_text(data.get("wifiPassword")):
        record["wifiPasswordSet"] = True
        record["wifiPasswordUpdatedAt"] = timestamp
    record["updatedAt"] = timestamp


def find_discovered_pppoe(payload: PppoeBindingPayload, snapshot: dict[str, Any]) -> dict[str, Any]:
    account_id = clean_text(payload.pppoeAccountId)
    router_id = clean_text(payload.routerId)
    username = clean_text(payload.username).lower()
    for account in snapshot.get("accounts", []):
        if account_id and pppoe_binding_key(account) == account_id:
            return account
        if account_id and clean_text(account.get("id")) == account_id:
            return account
        if router_id and username and clean_text(account.get("routerId")) == router_id and clean_text(account.get("username")).lower() == username:
            return account
    raise HTTPException(status_code=404, detail="PPPoE account was not found in latest MikroTik discovery")


def row_for_customer(customer_id: str, admin: dict[str, Any] | None = None) -> dict[str, Any]:
    rows = build_customer_network_rows(admin=admin)
    for row in rows:
        if row["customerId"] == customer_id:
            return row
    raise HTTPException(status_code=404, detail="Customer network record not found")


@router.get("/health")
def account_admin_health() -> dict[str, str]:
    return {"status": "ok", "module": "customer-network"}


@router.get("/meta")
def account_admin_meta(admin=Depends(require_admin)):
    return {
        "scope": "customer-network",
        "name": "Customer Network",
        "route": "/account-admin",
        "apiPrefix": "/api/account-admin",
        "lifecycleStatuses": LIFECYCLE_STATUSES,
        "provisioningActions": PROVISIONING_ACTIONS,
        "ipModes": IP_MODES,
        "systemAccessMovedTo": "/system-settings",
        "systemAccessTab": "Access",
        "implementationStatus": "phase-1-table-only",
    }


@router.get("/overview")
def account_admin_overview(admin=Depends(require_admin)):
    rows = build_customer_network_rows(admin=admin)
    metrics = account_admin_metrics(admin=admin)
    snapshot = pppoe_snapshot()
    return {
        "metrics": {
            **metrics,
            "unbound_pppoe": len(unbound_pppoe_accounts(snapshot)),
            "discovered_pppoe": len(snapshot.get("accounts", [])),
            "routers": len(snapshot.get("routers", [])),
        },
        "recentNeedsReview": [row for row in rows if row["needsReview"]][:8],
        "readyForActivation": [row for row in rows if row["lifecycleStatus"] == "FOR_ACTIVATION"][:8],
        "pppoeDiscovery": {
            "capturedAt": snapshot.get("capturedAt", ""),
            "kpis": snapshot.get("kpis", {}),
            "deviceErrors": snapshot.get("deviceErrors", []),
            "source": snapshot.get("source", "routeros-api"),
        },
        "phase": "Phase 1: Customer Accounts table, customer/service visibility, search, filters, and lifecycle tabs.",
    }


@router.get("/hotspot-access")
def hotspot_access_overview(
    search: str = "",
    status: str = "",
    admin=Depends(require_admin),
):
    rows = build_hotspot_subscriber_rows()
    needle = search.strip().lower()
    normalized_status = normalize_upper(status)
    if normalized_status:
        rows = [row for row in rows if normalize_upper(row.get("status")) == normalized_status]
    if needle:
        rows = [
            row
            for row in rows
            if needle in " ".join(
                [
                    row.get("customer_name", ""),
                    row.get("account_number", ""),
                    row.get("service_account_number", ""),
                    row.get("plan_name", ""),
                    " ".join(contact.get("contact_number", "") for contact in row.get("contacts") or []),
                    " ".join(contact.get("label", "") for contact in row.get("contacts") or []),
                ]
            ).lower()
        ]
    all_rows = build_hotspot_subscriber_rows()
    return {
        "settings": public_hotspot_settings(),
        "metrics": hotspot_access_metrics(all_rows),
        "data": sorted(rows, key=lambda row: row.get("customer_name", "")),
        "logs": load_hotspot_access_state().get("syncLogs", [])[:20],
        "guide": [
            "Monthly subscriber WiFi access is sourced from 3J Main customer/service records.",
            "Only active service accounts with enabled mobile contacts sync as ACTIVE subscribers.",
            "Each contact number can bind to one captive portal device after SMS verification.",
        ],
    }


@router.patch("/hotspot-access/settings")
def update_hotspot_access_settings(payload: HotspotIntegrationSettingsPayload, admin=Depends(require_admin)):
    state = load_hotspot_access_state()
    settings = state.setdefault("settings", {})
    if payload.enabled is not None:
        settings["enabled"] = bool(payload.enabled)
    if payload.pisowifiApiBaseUrl is not None:
        settings["pisowifiApiBaseUrl"] = clean_text(payload.pisowifiApiBaseUrl).rstrip("/")
    if payload.apiKey is not None:
        settings["apiKey"] = clean_text(payload.apiKey)
    if payload.apiSecret is not None and clean_text(payload.apiSecret):
        settings["apiSecret"] = clean_text(payload.apiSecret)
    save_hotspot_access_state()
    add_audit("hotspot_access_settings_updated", "HotspotAccess", "settings", {"enabled": settings.get("enabled")}, admin["username"])
    return {"settings": public_hotspot_settings(), "message": "Hotspot Access settings saved."}


@router.post("/hotspot-access/test")
def test_hotspot_access_connection(admin=Depends(require_admin)):
    result = signed_hotspot_request("GET", "/api/integrations/monthly-subscribers/health")
    hotspot_sync_log("TEST_CONNECTION", "SUCCESS", "Pisowifi monthly subscriber endpoint is reachable.", {"result": result})
    add_audit("hotspot_access_tested", "HotspotAccess", "settings", {"result": result}, admin["username"])
    return {"status": "SUCCESS", "message": "Pisowifi monthly subscriber endpoint is reachable.", "result": result}


@router.patch("/hotspot-access/subscribers/{customer_id}/contacts")
def update_hotspot_subscriber_contacts(customer_id: str, payload: HotspotSubscriberContactsPayload, admin=Depends(require_admin)):
    customers = ensure_customer_network_records()
    customer = next((item for item in customers if item.get("id") == customer_id), None)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer was not found.")
    normalized_contacts: list[dict[str, Any]] = []
    seen: set[str] = set()
    for contact in payload.contacts:
        normalized = normalize_ph_mobile(contact.contactNumber)
        if not normalized:
            raise HTTPException(status_code=400, detail=f"{contact.contactNumber} is not a valid PH mobile number.")
        if normalized in seen:
            continue
        seen.add(normalized)
        normalized_contacts.append(
            {
                "contactNumber": contact_display_from_normalized(normalized),
                "normalizedContact": normalized,
                "label": clean_text(contact.label) or "Contact",
                "enabled": bool(contact.enabled),
            }
        )
    state = load_hotspot_access_state()
    state.setdefault("contactOverrides", {})[customer_id] = normalized_contacts
    save_hotspot_access_state()
    row = hotspot_subscriber_payload(customer)
    add_audit("hotspot_access_contacts_updated", "HotspotAccessSubscriber", customer_id, {"contacts": len(normalized_contacts)}, admin["username"])
    return {"status": "SUCCESS", "message": "Subscriber contacts updated.", "subscriber": row}


@router.post("/hotspot-access/sync")
def sync_hotspot_access(admin=Depends(require_admin)):
    settings = load_hotspot_access_state().get("settings") or {}
    if not settings.get("enabled"):
        raise HTTPException(status_code=400, detail="Enable Hotspot Access before syncing subscribers.")
    rows = build_hotspot_subscriber_rows()
    try:
        result = sync_hotspot_subscribers(rows, admin["username"], "SYNC_ALL")
    except HTTPException as exc:
        hotspot_sync_log("SYNC_ALL", "FAILED", str(exc.detail), {"subscriber_count": len(rows)})
        raise
    add_audit("hotspot_access_synced", "HotspotAccess", "all", {"subscribers": len(rows), "result": result}, admin["username"])
    return {"status": "SUCCESS", "message": result.get("message") or "Monthly subscriber sync completed.", "result": result}


@router.post("/hotspot-access/subscribers/{customer_id}/sync")
def sync_hotspot_access_subscriber(customer_id: str, admin=Depends(require_admin)):
    settings = load_hotspot_access_state().get("settings") or {}
    if not settings.get("enabled"):
        raise HTTPException(status_code=400, detail="Enable Hotspot Access before syncing subscribers.")
    rows = [row for row in build_hotspot_subscriber_rows() if row.get("external_subscriber_id") == customer_id]
    if not rows:
        raise HTTPException(status_code=404, detail="Customer was not found.")
    try:
        result = sync_hotspot_subscribers(rows, admin["username"], "SYNC_SUBSCRIBER")
    except HTTPException as exc:
        hotspot_sync_log("SYNC_SUBSCRIBER", "FAILED", str(exc.detail), {"customer_id": customer_id})
        raise
    add_audit("hotspot_access_subscriber_synced", "HotspotAccessSubscriber", customer_id, {"result": result}, admin["username"])
    return {"status": "SUCCESS", "message": result.get("message") or "Monthly subscriber synced.", "result": result}


@router.get("/customer-accounts")
def list_customer_accounts(
    search: str = "",
    lifecycle: str = "",
    accessFilter: str = "",
    pppoeStatus: str = "",
    customerStatus: str = "",
    serviceStatus: str = "",
    internetStatus: str = "",
    hotspotStatus: str = "",
    iptvStatus: str = "",
    reviewOnly: bool = Query(default=False),
    refreshPppoe: bool = Query(default=False),
    admin=Depends(require_admin),
):
    rows = build_customer_network_rows(admin=admin, refresh_pppoe=refreshPppoe)
    metrics = account_admin_metrics(admin=admin, rows=rows)
    return {
        "data": filtered_customer_network_rows(
            rows,
            search=search,
            lifecycle=lifecycle,
            access_filter=accessFilter,
            pppoe_status=pppoeStatus,
            customer_status=customerStatus,
            service_status=serviceStatus,
            internet_status=internetStatus,
            hotspot_status=hotspotStatus,
            iptv_status=iptvStatus,
            review_only=reviewOnly,
        ),
        "total": len(rows),
        "metrics": metrics,
        "tabs": [
            {"label": "Active", "value": "ACCOUNT_ACTIVE", "count": metrics["active_customer_accounts"], "tone": "green"},
            {"label": "Inactive", "value": "ACCOUNT_INACTIVE", "count": metrics["inactive_customer_accounts"], "tone": "secondary"},
        ],
        "pppoeDiscovery": {
            "capturedAt": pppoe_discovery_cache.get("capturedAt", ""),
            "deviceErrors": pppoe_discovery_cache.get("deviceErrors", []),
        },
    }


@router.get("/customer-accounts/{customer_id}")
def get_customer_network(customer_id: str, admin=Depends(require_admin)):
    return row_for_customer(customer_id, admin=admin)


@router.post("/sync-customers")
def sync_customers(admin=Depends(require_admin)):
    before = len(customer_network_records)
    rows = build_customer_network_rows(admin=admin)
    created = len(customer_network_records) - before
    add_audit("customer_network_sync", "CustomerNetwork", "all", {"created": created, "total": len(rows)}, admin["username"])
    return {"status": "ok", "created": created, "total": len(rows), "data": rows}


@router.patch("/customer-accounts/{customer_id}/network-config")
def update_customer_network_config(customer_id: str, payload: NetworkConfigPayload, admin=Depends(require_admin)):
    customer, record = find_customer_network(customer_id)
    apply_network_config(record, payload)
    add_audit("customer_network_config_updated", "CustomerNetwork", record["id"], {"customerId": customer_id}, admin["username"])
    return customer_network_row(customer, pppoe_snapshot(admin=admin), binding_map())


@router.post("/customer-accounts/{customer_id}/bind-pppoe")
def bind_pppoe(customer_id: str, payload: PppoeBindingPayload, admin=Depends(require_admin)):
    customer, record = find_customer_network(customer_id)
    snapshot = pppoe_snapshot(admin=admin, refresh=True)
    account = find_discovered_pppoe(payload, snapshot)
    key = pppoe_binding_key(account)
    for other in customer_network_records.values():
        if other["customerId"] != customer_id and pppoe_binding_key(other.get("pppoeBinding")) == key:
            raise HTTPException(status_code=409, detail="PPPoE account is already bound to another customer")
    timestamp = now_iso()
    record["pppoeBinding"] = {
        "id": account.get("id", ""),
        "routerId": account.get("routerId", ""),
        "routerName": account.get("routerName", ""),
        "routerEndpoint": account.get("routerEndpoint", ""),
        "username": account.get("username", ""),
        "profile": account.get("profile", ""),
        "status": account.get("status", ""),
        "activeAddress": account.get("activeAddress", ""),
        "remoteAddress": account.get("remoteAddress", ""),
        "callerId": account.get("callerId", ""),
        "macAddress": account.get("macAddress", ""),
        "source": account.get("source", "routeros-api"),
        "boundAt": timestamp,
        "boundBy": admin["username"],
    }
    record["desiredPppoeUsername"] = account.get("username", record.get("desiredPppoeUsername", ""))
    record["pppoeProfile"] = account.get("profile", record.get("pppoeProfile", ""))
    record["routerId"] = account.get("routerId", record.get("routerId", ""))
    record["routerName"] = account.get("routerName", record.get("routerName", ""))
    record["provisioningStatus"] = "PROVISIONED"
    record["updatedAt"] = timestamp
    add_audit("customer_network_pppoe_bound", "CustomerNetwork", record["id"], {"customerId": customer_id, "username": account.get("username")}, admin["username"])
    return customer_network_row(customer, snapshot, binding_map())


@router.delete("/customer-accounts/{customer_id}/bind-pppoe")
def unbind_pppoe(customer_id: str, admin=Depends(require_admin)):
    customer, record = find_customer_network(customer_id)
    previous = record.get("pppoeBinding") or {}
    record["pppoeBinding"] = None
    record["provisioningStatus"] = "NOT_REQUESTED"
    record["updatedAt"] = now_iso()
    add_audit("customer_network_pppoe_unbound", "CustomerNetwork", record["id"], {"customerId": customer_id, "username": previous.get("username")}, admin["username"])
    return customer_network_row(customer, pppoe_snapshot(admin=admin), binding_map())


@router.post("/customer-accounts/{customer_id}/provisioning-requests")
def request_provisioning(customer_id: str, payload: ProvisioningRequestPayload, admin=Depends(require_admin)):
    customer, record = find_customer_network(customer_id)
    action = normalize_upper(payload.action)
    if action not in PROVISIONING_ACTIONS:
        raise HTTPException(status_code=400, detail="Invalid provisioning action")
    timestamp = now_iso()
    request = {
        "id": str(uuid4()),
        "action": action,
        "status": "PENDING",
        "note": clean_text(payload.note),
        "createdAt": timestamp,
        "createdBy": admin["username"],
    }
    record.setdefault("provisioningRequests", []).insert(0, request)
    record["provisioningStatus"] = "PENDING"
    record["lifecycleStatus"] = "PENDING_PROVISIONING"
    record["updatedAt"] = timestamp
    add_audit("customer_network_provisioning_requested", "CustomerNetwork", record["id"], {"customerId": customer_id, "action": action}, admin["username"])
    return customer_network_row(customer, pppoe_snapshot(admin=admin), binding_map())


@router.post("/customer-accounts/{customer_id}/mark-provisioned")
def mark_provisioned(customer_id: str, payload: ProvisionedPayload, admin=Depends(require_admin)):
    customer, record = find_customer_network(customer_id)
    timestamp = now_iso()
    for request in record.get("provisioningRequests", []):
        if request.get("status") == "PENDING":
            request["status"] = "COMPLETED"
            request["completedAt"] = timestamp
            request["completionNote"] = clean_text(payload.note)
            break
    record["provisioningStatus"] = "PROVISIONED"
    record["lifecycleStatus"] = "PROVISIONED"
    record["updatedAt"] = timestamp
    add_audit("customer_network_marked_provisioned", "CustomerNetwork", record["id"], {"customerId": customer_id}, admin["username"])
    return customer_network_row(customer, pppoe_snapshot(admin=admin), binding_map())


@router.get("/pppoe/discovered")
def list_discovered_pppoe(refresh: bool = Query(default=False), admin=Depends(require_admin)):
    return pppoe_snapshot(admin=admin, refresh=refresh)


@router.get("/pppoe/unbound")
def list_unbound_pppoe(refresh: bool = Query(default=False), admin=Depends(require_admin)):
    snapshot = pppoe_snapshot(admin=admin, refresh=refresh)
    accounts = unbound_pppoe_accounts(snapshot)
    return {
        "capturedAt": snapshot.get("capturedAt", ""),
        "accounts": accounts,
        "total": len(accounts),
        "deviceErrors": snapshot.get("deviceErrors", []),
    }


@router.get("/pppoe-onu-mapping")
def list_pppoe_onu_mapping(
    search: str = "",
    status: str = "",
    refresh: bool = Query(default=False),
    admin=Depends(require_admin),
):
    return pppoe_onu_mapping_snapshot(admin=admin, refresh=refresh, search=search, status=status)


@router.get("/pppoe/conflicts")
def list_pppoe_conflicts(admin=Depends(require_admin)):
    snapshot = pppoe_snapshot(admin=admin)
    discovered = pppoe_account_lookup(snapshot)
    conflicts: list[dict[str, Any]] = []
    for key, records in binding_map().items():
        if len(records) > 1:
            conflicts.append(
                {
                    "type": "DUPLICATE_BINDING",
                    "pppoeAccountId": key,
                    "customers": [record["customerId"] for record in records],
                }
            )
        if discovered and key not in discovered:
            conflicts.append(
                {
                    "type": "MISSING_FROM_DISCOVERY",
                    "pppoeAccountId": key,
                    "customers": [record["customerId"] for record in records],
                }
            )
    return {"data": conflicts, "total": len(conflicts)}


@router.post("/reconcile")
def reconcile_customer_network(refreshPppoe: bool = Query(default=True), admin=Depends(require_admin)):
    rows = build_customer_network_rows(admin=admin, refresh_pppoe=refreshPppoe)
    add_audit("customer_network_reconciled", "CustomerNetwork", "all", {"total": len(rows)}, admin["username"])
    return {
        "status": "ok",
        "total": len(rows),
        "metrics": account_admin_metrics(admin=admin),
        "pppoeDiscovery": {
            "capturedAt": pppoe_discovery_cache.get("capturedAt", ""),
            "deviceErrors": pppoe_discovery_cache.get("deviceErrors", []),
        },
    }


@router.api_route("/accounts", methods=["GET", "POST"])
@router.api_route("/accounts/{account_id}", methods=["GET", "PATCH", "DELETE"])
@router.api_route("/accounts/{account_id}/activate", methods=["POST"])
@router.api_route("/accounts/{account_id}/deactivate", methods=["POST"])
def system_access_moved():
    raise HTTPException(
        status_code=410,
        detail="System login account administration moved to System Settings -> Access.",
    )
