from __future__ import annotations

import hashlib
import json
import os
import random
import re
import socket
import threading
from datetime import datetime, timezone
from typing import Any, Callable
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field


router = APIRouter(prefix="/api/network-settings", tags=["network-settings"])

olts: list[dict[str, Any]] = []
pon_ports: list[dict[str, Any]] = []
nap_boxes: list[dict[str, Any]] = []
fbts: list[dict[str, Any]] = []
network_devices: list[dict[str, Any]] = []
device_captures: list[dict[str, Any]] = []
onus: list[dict[str, Any]] = []
_data_loaded = False

_current_admin: Callable[[str | None], dict[str, Any]] | None = None
_audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None] | None = None
_capture_lock = threading.Lock()
_data_save_lock = threading.Lock()
_poller_lock = threading.Lock()
_poller_stop_event = threading.Event()
_poller_thread: threading.Thread | None = None
_poller_state: dict[str, Any] = {
    "running": False,
    "startedAt": "",
    "lastWakeAt": "",
    "lastRunStartedAt": "",
    "lastRunFinishedAt": "",
    "lastRunDeviceCount": 0,
    "lastRunSuccessCount": 0,
    "lastRunFailureCount": 0,
    "lastError": "",
}

OLT_STATUSES = ["PLANNED", "ACTIVE", "MAINTENANCE", "OFFLINE", "ARCHIVED"]
PON_TECHNOLOGIES = ["GPON", "EPON", "XGS_PON", "OTHER"]
PON_TECHNOLOGY_DEFAULTS = {
    "GPON": {"splitRatio": "1:128", "capacity": 128},
    "XGS_PON": {"splitRatio": "1:128", "capacity": 128},
    "EPON": {"splitRatio": "1:64", "capacity": 64},
    "OTHER": {"splitRatio": "1:64", "capacity": 64},
}
ADMIN_STATUSES = ["ENABLED", "DISABLED", "RESERVED"]
OPER_STATUS = ["UNKNOWN", "UP", "DEGRADED", "DOWN"]
NAP_STATUSES = ["PLANNED", "ACTIVE", "FULL", "MAINTENANCE", "OFFLINE", "ARCHIVED"]
NAP_SPLITTER_RATIOS = ["1:8", "1:16"]
FBT_STATUSES = ["PLANNED", "ACTIVE", "FULL", "MAINTENANCE", "OFFLINE", "ARCHIVED"]
ONU_STATUSES = ["UNKNOWN", "ONLINE", "OFFLINE", "LOS", "DYING_GASP", "DISABLED"]
DEVICE_TYPES = ["MIKROTIK", "OLT"]
DEVICE_ACCESS_METHODS = ["API", "SNMP"]
DEVICE_STATUSES = ["PLANNED", "ACTIVE", "MAINTENANCE", "OFFLINE", "ARCHIVED"]
API_PROTOCOLS = ["MIKROTIK_API", "REST", "NETCONF", "SSH", "OTHER"]
PPPOE_ACCOUNT_STATUSES = ["ONLINE", "OFFLINE", "DISABLED"]
SNMP_VERSIONS = ["V1", "V2C", "V3"]
SNMP_TRANSPORTS = ["UDP", "TCP", "UDP6", "TCP6"]
PORT_ASSOCIATION_MODES = ["IFINDEX", "IFNAME", "IFDESCR", "IFALIAS"]
SNMP_AUTH_LEVELS = ["NO_AUTH_NO_PRIV", "AUTH_NO_PRIV", "AUTH_PRIV"]
SNMP_AUTH_PROTOCOLS = ["MD5", "SHA", "SHA-224", "SHA-256", "SHA-384", "SHA-512"]
SNMP_PRIVACY_PROTOCOLS = ["AES", "DES"]
SECRET_DEVICE_FIELDS = {"apiPassword", "snmpCommunity", "snmpAuthPassword", "snmpPrivacyPassword"}
PON_MODULE_FIELDS = (
    "moduleVendor",
    "modulePartNumber",
    "moduleSerial",
    "moduleHardwareRev",
    "moduleRxPowerDbm",
    "moduleTxPowerDbm",
    "moduleTemperatureC",
    "moduleVoltageV",
    "moduleBiasCurrentMa",
    "moduleEntityIndex",
    "moduleSource",
)
MIKROTIK_API_TEST_TIMEOUT_SECONDS = 3
MIKROTIK_API_MAX_REPLY_SENTENCES = 10000
SNMP_CAPTURE_TIMEOUT_SECONDS = 3
SNMP_CAPTURE_RETRIES = 1
SNMP_MAX_WALK_ROWS = 2048
DEFAULT_DEVICE_POLL_INTERVAL_SECONDS = int(os.getenv("NETWORK_SETTINGS_POLL_INTERVAL_SECONDS", "300"))
NETWORK_SETTINGS_POLL_LOOP_SECONDS = int(os.getenv("NETWORK_SETTINGS_POLL_LOOP_SECONDS", "10"))
ONU_TABLE_REFRESH_SECONDS = int(os.getenv("NETWORK_SETTINGS_ONU_TABLE_REFRESH_SECONDS", "15"))
MAX_CAPTURE_HISTORY_PER_DEVICE = int(os.getenv("NETWORK_SETTINGS_CAPTURE_HISTORY_PER_DEVICE", "10"))
MAX_CAPTURE_PREVIEW_CANDIDATES = int(os.getenv("NETWORK_SETTINGS_CAPTURE_PREVIEW_CANDIDATES", "200"))
NETWORK_SETTINGS_DATA_PATH = os.getenv(
    "NETWORK_SETTINGS_DATA_PATH",
    "/app/data/network_settings.json" if os.path.isdir("/app/data") else "",
)
DEFAULT_SNMP_COMMUNITIES = [
    value.strip()
    for value in os.getenv("NETWORK_SETTINGS_SNMP_COMMUNITIES", "public,private").split(",")
    if value.strip()
]
SYSTEM_OIDS = {
    "sysDescr": "1.3.6.1.2.1.1.1.0",
    "sysObjectID": "1.3.6.1.2.1.1.2.0",
    "sysUpTime": "1.3.6.1.2.1.1.3.0",
    "sysContact": "1.3.6.1.2.1.1.4.0",
    "sysName": "1.3.6.1.2.1.1.5.0",
    "sysLocation": "1.3.6.1.2.1.1.6.0",
}
HS_FIBER_ENTERPRISE_OID = "1.3.6.1.4.1.50224"
HS_EPON_ONU_INFO_ENTRY_OID = f"{HS_FIBER_ENTERPRISE_OID}.3.3.2.1"
HS_EPON_ONU_OPTICAL_ENTRY_OID = f"{HS_FIBER_ENTERPRISE_OID}.3.3.3.1"
HS_GPON_ONU_INFO_ENTRY_OID = f"{HS_FIBER_ENTERPRISE_OID}.3.12.2.1"
HS_GPON_ONU_OPTICAL_ENTRY_OID = f"{HS_FIBER_ENTERPRISE_OID}.3.12.3.1"
HS_ONU_OPTICAL_VALUE_SENTINELS = {"", "0", "65535", "2147483647", "-2147483648"}
VSOL_ENTERPRISE_OID = "1.3.6.1.4.1.37950"
VSOL_ONU_MAC_ENTRY_OID = f"{VSOL_ENTERPRISE_OID}.1.1.5.10.3.2.1"
IF_MIB_COLUMNS = {
    "ifDescr": "1.3.6.1.2.1.2.2.1.2",
    "ifType": "1.3.6.1.2.1.2.2.1.3",
    "ifSpeed": "1.3.6.1.2.1.2.2.1.5",
    "ifAdminStatus": "1.3.6.1.2.1.2.2.1.7",
    "ifOperStatus": "1.3.6.1.2.1.2.2.1.8",
    "ifName": "1.3.6.1.2.1.31.1.1.1.1",
    "ifAlias": "1.3.6.1.2.1.31.1.1.1.18",
}
PON_INTERFACE_RE = re.compile(r"(^|[\s_:/.-])(xgspon|xgpon|gpon|epon|xpon|pon)([\s_:/.-]|\d|$)", re.IGNORECASE)
SUBSCRIBER_INTERFACE_RE = re.compile(r"(^|[\s_:/.-])(onu|ont|gem|tcont|veip|service-port)([\s_:/.-]|\d|$)", re.IGNORECASE)
PON_CHILD_INTERFACE_RE = re.compile(
    r"\b(?:xgspon|xgpon|gpon|epon|xpon|pon)\s*\d+\s*[/.-]\s*\d+\s*[:.]\s*\d+\b",
    re.IGNORECASE,
)
PON_MODEL_TECHNOLOGY_RE = re.compile(r"\b(?:hsgq[-_\s]*)?([egx])\d{2}[a-z]*\b", re.IGNORECASE)
COMPACT_PON_ONU_INTERFACE_RE = re.compile(
    r"\b(?:xgspon|xgpon|gpon|epon|xpon|pon)\s*0*(\d{1,3})\s*(?:onu|ont)\s*0*(\d{1,3})\b",
    re.IGNORECASE,
)
ONU_SERIAL_RE = re.compile(r"\b(?:sn|serial)\s*[:#-]?\s*([A-Za-z0-9-]{6,32})\b", re.IGNORECASE)
ONU_MAC_RE = re.compile(r"\b(?:mac|macaddr|mac-address)?\s*[:#-]?\s*([0-9a-f]{2}(?::[0-9a-f]{2}){5}|[0-9a-f]{12})\b", re.IGNORECASE)
ONU_RX_RE = re.compile(r"\b(?:rx|rxpower|rx-power|receive)\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*(?:dbm)?\b", re.IGNORECASE)
ONU_TX_RE = re.compile(r"\b(?:tx|txpower|tx-power|transmit)\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*(?:dbm)?\b", re.IGNORECASE)
ONU_DISTANCE_RE = re.compile(r"\b(?:distance|dist)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(km|m)?\b", re.IGNORECASE)
ONU_TEMP_RE = re.compile(r"\b(?:temp|temperature)\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*(?:c|degc)?\b", re.IGNORECASE)
ONU_VOLTAGE_RE = re.compile(r"\b(?:volt|voltage)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:v)?\b", re.IGNORECASE)
ONU_BIAS_RE = re.compile(r"\b(?:bias|current|biascurrent|bias-current)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:ma)?\b", re.IGNORECASE)
ONU_VLAN_RE = re.compile(r"\b(?:vlan|cvlan|svlan)\s*[:=]?\s*(\d{1,5})\b", re.IGNORECASE)
ONU_SERVICE_PORT_RE = re.compile(r"\b(?:service[- ]?port|srvport|sp)\s*[:=]?\s*(\d+)\b", re.IGNORECASE)
HEX_OCTET_TEXT_RE = re.compile(r"^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$")
PON_ONU_RE = re.compile(
    r"(?:gpon|epon|xgpon|xgspon|xpon|pon|onu|ont)?\s*(?:\d+[/.-])?(\d+)\s*[:/.-]\s*(\d+)",
    re.IGNORECASE,
)
ENTERPRISE_VENDOR_MARKERS = [
    ("1.3.6.1.4.1.2011", "Huawei"),
    ("1.3.6.1.4.1.3902", "ZTE"),
    ("1.3.6.1.4.1.14988", "MikroTik"),
    ("1.3.6.1.4.1.5875", "FiberHome"),
    ("1.3.6.1.4.1.37950", "VSOL"),
]

SUB_NAV = [
    {"key": "overview", "label": "Overview", "route": "/network-settings"},
    {"key": "mikrotikSettings", "label": "MikroTik API", "route": "/network-settings/mikrotik/settings"},
    {"key": "pppoeAccounts", "label": "PPPoE Accounts", "route": "/network-settings/pppoe-accounts"},
    {"key": "oltSettings", "label": "OLT SNMP", "route": "/network-settings/olt/settings"},
    {"key": "map", "label": "Map", "route": "/network-settings/map"},
    {"key": "olts", "label": "OLT & PON", "route": "/network-settings/olts"},
    {"key": "onus", "label": "ONUs", "route": "/network-settings/onus"},
    {"key": "napBoxes", "label": "NAP Boxes", "route": "/network-settings/nap-boxes"},
    {"key": "fbts", "label": "FBT", "route": "/network-settings/fbts"},
]


class OltPayload(BaseModel):
    name: str | None = None
    site: str | None = None
    managementIp: str | None = None
    vendor: str | None = None
    model: str | None = None
    firmwareVersion: str | None = None
    latitude: str | float | None = None
    longitude: str | float | None = None
    locationId: str | None = None
    locationName: str | None = None
    status: str | None = None
    defaultPonCount: int | None = Field(default=None, ge=1, le=128)
    notes: str | None = None


class PonPayload(BaseModel):
    portNumber: int | None = Field(default=None, ge=1, le=512)
    label: str | None = None
    technology: str | None = None
    adminStatus: str | None = None
    operationalStatus: str | None = None
    splitRatio: str | None = None
    serviceVlan: str | None = None
    capacity: int | None = Field(default=None, ge=1, le=4096)
    moduleVendor: str | None = None
    modulePartNumber: str | None = None
    moduleSerial: str | None = None
    moduleHardwareRev: str | None = None
    moduleRxPowerDbm: str | float | None = None
    moduleTxPowerDbm: str | float | None = None
    moduleTemperatureC: str | float | None = None
    moduleVoltageV: str | float | None = None
    moduleBiasCurrentMa: str | float | None = None
    moduleEntityIndex: str | None = None
    moduleSource: str | None = None
    notes: str | None = None


class PonPowerPayload(BaseModel):
    moduleVendor: str | None = None
    modulePartNumber: str | None = None
    moduleSerial: str | None = None
    moduleHardwareRev: str | None = None
    moduleRxPowerDbm: str | float | None = None
    moduleTxPowerDbm: str | float | None = None
    moduleTemperatureC: str | float | None = None
    moduleVoltageV: str | float | None = None
    moduleBiasCurrentMa: str | float | None = None
    moduleSource: str | None = None


class NapPayload(BaseModel):
    name: str | None = None
    ponPortId: str | None = None
    location: str | None = None
    barangay: str | None = None
    latitude: str | None = None
    longitude: str | None = None
    splitterRatio: str | None = None
    portCapacity: int | None = Field(default=None, ge=1, le=512)
    status: str | None = None
    notes: str | None = None


class FbtPayload(BaseModel):
    name: str | None = None
    napBoxId: str | None = None
    portNumber: int | None = Field(default=None, ge=1, le=512)
    portCapacity: int | None = Field(default=None, ge=1, le=512)
    status: str | None = None
    locationHint: str | None = None
    notes: str | None = None


class DevicePayload(BaseModel):
    name: str | None = None
    deviceType: str | None = None
    accessMethod: str | None = None
    managementIp: str | None = None
    site: str | None = None
    vendor: str | None = None
    model: str | None = None
    status: str | None = None
    apiProtocol: str | None = None
    apiPort: int | None = Field(default=None, ge=1, le=65535)
    apiUsername: str | None = None
    apiPassword: str | None = None
    apiProfile: str | None = None
    snmpVersion: str | None = None
    snmpPort: int | None = Field(default=None, ge=1, le=65535)
    snmpProfile: str | None = None
    snmpCommunity: str | None = None
    snmpTransport: str | None = None
    portAssociationMode: str | None = None
    pollerGroup: str | None = None
    pollIntervalSeconds: int | None = Field(default=None, ge=30, le=86400)
    forceAdd: bool | str | None = None
    snmpAuthLevel: str | None = None
    snmpAuthName: str | None = None
    snmpAuthPassword: str | None = None
    snmpAuthProtocol: str | None = None
    snmpPrivacyProtocol: str | None = None
    snmpPrivacyPassword: str | None = None
    notes: str | None = None


class DeviceLocationBindingPayload(BaseModel):
    locationIds: list[str] = Field(default_factory=list)
    locations: list[dict[str, Any]] = Field(default_factory=list)


class DeviceOltLocationPayload(BaseModel):
    locationId: str | None = None
    location: dict[str, Any] = Field(default_factory=dict)
    label: str | None = None
    latitude: str | float | None = None
    longitude: str | float | None = None


def configure_network_settings(
    current_admin: Callable[[str | None], dict[str, Any]] | None = None,
    audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None] | None = None,
) -> None:
    global _current_admin, _audit_logger
    _current_admin = current_admin
    _audit_logger = audit_logger


def require_admin(authorization: str | None = Header(default=None)):
    if _current_admin is None:
        raise HTTPException(status_code=500, detail="Network Settings module is not configured")
    return _current_admin(authorization)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def add_audit(action: str, target_type: str, target_id: str, details: dict[str, Any] | None, actor: str) -> None:
    if _audit_logger is not None:
        _audit_logger(action, target_type, target_id, details, actor)


def load_network_settings_data() -> None:
    global _data_loaded, olts, pon_ports, nap_boxes, fbts, network_devices, device_captures, onus
    if _data_loaded:
        return
    _data_loaded = True
    if not NETWORK_SETTINGS_DATA_PATH or not os.path.exists(NETWORK_SETTINGS_DATA_PATH):
        return
    try:
        with open(NETWORK_SETTINGS_DATA_PATH, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return
    olts = list(payload.get("olts") or [])
    pon_ports = list(payload.get("ponPorts") or [])
    nap_boxes = list(payload.get("napBoxes") or [])
    fbts = list(payload.get("fbts") or [])
    network_devices = list(payload.get("networkDevices") or [])
    device_captures = list(payload.get("deviceCaptures") or [])
    onus = list(payload.get("onus") or [])
    capture_history_normalized = normalize_capture_history()
    if normalize_pon_inventory_defaults() or capture_history_normalized:
        save_network_settings_data()


def compact_capture_for_storage(capture: dict[str, Any]) -> dict[str, Any]:
    interfaces = capture.get("interfaces") if isinstance(capture.get("interfaces"), list) else []
    pon_candidates = capture.get("ponCandidates") if isinstance(capture.get("ponCandidates"), list) else []
    onu_candidates = capture.get("onuCandidates") if isinstance(capture.get("onuCandidates"), list) else []
    return {
        "id": capture.get("id"),
        "deviceId": capture.get("deviceId"),
        "status": capture.get("status", "UNKNOWN"),
        "capturedAt": capture.get("capturedAt", ""),
        "message": capture.get("message", ""),
        "system": capture.get("system") or {},
        "interfaceCount": int(capture.get("interfaceCount") or len(interfaces)),
        "ponCandidateCount": int(capture.get("ponCandidateCount") or len(pon_candidates)),
        "onuCandidateCount": int(capture.get("onuCandidateCount") or len(onu_candidates)),
        "ponCandidates": pon_candidates[:MAX_CAPTURE_PREVIEW_CANDIDATES],
        "onuCandidates": onu_candidates[:MAX_CAPTURE_PREVIEW_CANDIDATES],
        "reconciliation": capture.get("reconciliation") or {},
        "detailsPruned": bool(interfaces)
        or len(pon_candidates) > MAX_CAPTURE_PREVIEW_CANDIDATES
        or len(onu_candidates) > MAX_CAPTURE_PREVIEW_CANDIDATES
        or bool(capture.get("detailsPruned")),
    }


def compact_capture_history(captures: list[dict[str, Any]]) -> list[dict[str, Any]]:
    kept_counts: dict[str, int] = {}
    retained: list[dict[str, Any]] = []
    for capture in sorted(captures, key=lambda item: clean_text(item.get("capturedAt")), reverse=True):
        device_id = clean_text(capture.get("deviceId")) or "unknown"
        count = kept_counts.get(device_id, 0)
        if count >= MAX_CAPTURE_HISTORY_PER_DEVICE:
            continue
        retained.append(compact_capture_for_storage(capture))
        kept_counts[device_id] = count + 1
    return sorted(retained, key=lambda item: clean_text(item.get("capturedAt")))


def normalize_capture_history() -> bool:
    global device_captures
    compacted = compact_capture_history(device_captures)
    changed = compacted != device_captures
    if changed:
        device_captures = compacted
    return changed


def save_network_settings_data() -> None:
    if not NETWORK_SETTINGS_DATA_PATH:
        return
    payload = {
        "olts": olts,
        "ponPorts": pon_ports,
        "napBoxes": nap_boxes,
        "fbts": fbts,
        "networkDevices": network_devices,
        "deviceCaptures": compact_capture_history(device_captures),
        "onus": onus,
    }
    try:
        with _data_save_lock:
            os.makedirs(os.path.dirname(NETWORK_SETTINGS_DATA_PATH), exist_ok=True)
            temp_path = f"{NETWORK_SETTINGS_DATA_PATH}.tmp"
            with open(temp_path, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, separators=(",", ":"))
            os.replace(temp_path, NETWORK_SETTINGS_DATA_PATH)
    except OSError:
        return


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def clean_coordinate(value: Any, field_name: str, minimum: float, maximum: float) -> str:
    text = clean_text(value)
    if not text:
        return ""
    try:
        number = float(text)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{field_name} must be a valid number") from None
    if number < minimum or number > maximum:
        raise HTTPException(status_code=400, detail=f"{field_name} must be between {minimum:g} and {maximum:g}")
    return f"{number:.6f}".rstrip("0").rstrip(".")


def clean_unique_texts(values: list[Any]) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = clean_text(value)
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        cleaned.append(text)
        seen.add(key)
    return cleaned


def format_seconds(value: Any) -> str:
    seconds = int(value or 0)
    if seconds <= 0:
        return "Manual"
    if seconds % 3600 == 0:
        return f"{seconds // 3600}h"
    if seconds % 60 == 0:
        return f"{seconds // 60}m"
    return f"{seconds}s"


def normalize_upper(value: Any) -> str:
    return clean_text(value).upper()


def normalize_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return clean_text(value).lower() in {"1", "true", "yes", "on"}


def ensure_choice(value: Any, allowed: list[str], field_name: str, fallback: str) -> str:
    normalized = normalize_upper(value or fallback)
    if normalized not in allowed:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}")
    return normalized


def actor_name(admin: dict[str, Any]) -> str:
    return clean_text(admin.get("username") or admin.get("full_name") or admin.get("id") or "network-user")


def next_code(prefix: str, rows: list[dict[str, Any]]) -> str:
    return f"{prefix}-{len(rows) + 1:04d}"


def visible_olts() -> list[dict[str, Any]]:
    return [row for row in olts if not row.get("deletedAt")]


def visible_pons() -> list[dict[str, Any]]:
    return [row for row in pon_ports if not row.get("deletedAt")]


def visible_naps() -> list[dict[str, Any]]:
    return [row for row in nap_boxes if not row.get("deletedAt")]


def visible_fbts() -> list[dict[str, Any]]:
    return [row for row in fbts if not row.get("deletedAt")]


def visible_devices() -> list[dict[str, Any]]:
    return [row for row in network_devices if not row.get("deletedAt")]


def visible_onus() -> list[dict[str, Any]]:
    return [row for row in onus if not row.get("deletedAt")]


def find_row(rows: list[dict[str, Any]], row_id: str, label: str) -> dict[str, Any]:
    for row in rows:
        if row["id"] == row_id and not row.get("deletedAt"):
            return row
    raise HTTPException(status_code=404, detail=f"{label} not found")


def find_olt(olt_id: str) -> dict[str, Any]:
    return find_row(olts, olt_id, "OLT")


def find_pon(pon_id: str) -> dict[str, Any]:
    return find_row(pon_ports, pon_id, "PON port")


def find_nap(nap_id: str) -> dict[str, Any]:
    return find_row(nap_boxes, nap_id, "NAP box")


def find_fbt(fbt_id: str) -> dict[str, Any]:
    return find_row(fbts, fbt_id, "FBT")


def find_device(device_id: str) -> dict[str, Any]:
    return find_row(network_devices, device_id, "Network device")


def find_onu(onu_id: str) -> dict[str, Any]:
    return find_row(onus, onu_id, "ONU")


def matches_search(row: dict[str, Any], search: str) -> bool:
    term = clean_text(search).lower()
    if not term:
        return True
    return term in " ".join(str(value).lower() for value in row.values()).lower()


def pon_rows_for_olt(olt_id: str) -> list[dict[str, Any]]:
    return [row for row in visible_pons() if row["oltId"] == olt_id]


def nap_rows_for_pon(pon_id: str) -> list[dict[str, Any]]:
    return [row for row in visible_naps() if row["ponPortId"] == pon_id]


def fbt_rows_for_nap(nap_id: str) -> list[dict[str, Any]]:
    return [row for row in visible_fbts() if row["napBoxId"] == nap_id]


def onu_rows_for_pon(pon_id: str) -> list[dict[str, Any]]:
    return [row for row in visible_onus() if row["ponPortId"] == pon_id]


def unique_pon_port(olt_id: str, port_number: int, current_id: str | None = None) -> None:
    duplicate = next(
        (
            row
            for row in visible_pons()
            if row["oltId"] == olt_id and row["portNumber"] == port_number and row.get("id") != current_id
        ),
        None,
    )
    if duplicate:
        raise HTTPException(status_code=400, detail="PON port number already exists for this OLT")


def unique_nap_name(name: str, pon_port_id: str, current_id: str | None = None) -> None:
    normalized_name = normalize_upper(name)
    duplicate = next(
        (
            row
            for row in visible_naps()
            if row.get("ponPortId") == pon_port_id
            and normalize_upper(row.get("name")) == normalized_name
            and row.get("id") != current_id
        ),
        None,
    )
    if duplicate:
        current = next((row for row in nap_boxes if row.get("id") == current_id), None)
        if current and current.get("ponPortId") == pon_port_id and normalize_upper(current.get("name")) == normalized_name:
            return
        raise HTTPException(status_code=400, detail="NAP box name already exists for this PON")


def unique_fbt_port(nap_box_id: str, port_number: int, current_id: str | None = None) -> None:
    duplicate = next(
        (
            row
            for row in visible_fbts()
            if row["napBoxId"] == nap_box_id and row["portNumber"] == port_number and row.get("id") != current_id
        ),
        None,
    )
    if duplicate:
        raise HTTPException(status_code=400, detail="FBT port number already exists for this NAP")


def unique_device_endpoint(record: dict[str, Any], current_id: str | None = None) -> None:
    def endpoint_port(row: dict[str, Any]) -> int:
        if row.get("accessMethod") == "SNMP":
            return int(row.get("snmpPort") or 0)
        return int(row.get("apiPort") or 0)

    port = endpoint_port(record)
    duplicate = next(
        (
            row
            for row in visible_devices()
            if row.get("accessMethod") == record.get("accessMethod")
            and row.get("managementIp") == record.get("managementIp")
            and endpoint_port(row) == port
            and row.get("id") != current_id
        ),
        None,
    )
    if duplicate:
        raise HTTPException(status_code=400, detail="A device already uses this management IP, method, and port")


def canonical_pon_label_from_number(port_number: Any) -> str:
    try:
        number = int(port_number or 0)
    except (TypeError, ValueError):
        number = 0
    return f"PON{number:02d}" if number > 0 else "PON"


def canonical_pon_label(pon: dict[str, Any]) -> str:
    return canonical_pon_label_from_number(pon.get("portNumber"))


def normalize_olt_payload(payload: OltPayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    record = dict(current or {})
    record.update({key: value for key, value in data.items() if value is not None})
    record["name"] = clean_text(record.get("name"))
    if not record["name"]:
        raise HTTPException(status_code=400, detail="OLT name is required")
    record["site"] = clean_text(record.get("site")) or "Main POP"
    record["managementIp"] = clean_text(record.get("managementIp"))
    record["vendor"] = clean_text(record.get("vendor")) or "Generic"
    record["model"] = clean_text(record.get("model"))
    record["firmwareVersion"] = clean_text(record.get("firmwareVersion"))
    record["latitude"] = clean_coordinate(record.get("latitude"), "Latitude", -90, 90)
    record["longitude"] = clean_coordinate(record.get("longitude"), "Longitude", -180, 180)
    record["locationId"] = clean_text(record.get("locationId"))
    record["locationName"] = clean_text(record.get("locationName"))
    record["status"] = ensure_choice(record.get("status"), OLT_STATUSES, "OLT status", "PLANNED")
    record["defaultPonCount"] = int(record.get("defaultPonCount") or 4)
    record["notes"] = clean_text(record.get("notes"))
    return record


def normalize_pon_payload(payload: PonPayload, olt_id: str, current: dict[str, Any] | None = None) -> dict[str, Any]:
    find_olt(olt_id)
    data = payload.model_dump(exclude_unset=True)
    record = dict(current or {})
    record.update({key: value for key, value in data.items() if value is not None})
    record["oltId"] = olt_id
    record["portNumber"] = int(record.get("portNumber") or next_pon_number(olt_id))
    unique_pon_port(olt_id, record["portNumber"], record.get("id"))
    record["label"] = canonical_pon_label(record)
    record["technology"] = ensure_choice(record.get("technology"), PON_TECHNOLOGIES, "PON technology", "GPON")
    record["adminStatus"] = ensure_choice(record.get("adminStatus"), ADMIN_STATUSES, "admin status", "ENABLED")
    record["operationalStatus"] = ensure_choice(record.get("operationalStatus"), OPER_STATUS, "operational status", "UNKNOWN")
    record["serviceVlan"] = clean_text(record.get("serviceVlan"))
    for field in PON_MODULE_FIELDS:
        record[field] = clean_text(record.get(field))
    apply_pon_technology_defaults(record)
    record["notes"] = clean_text(record.get("notes"))
    return record


def normalize_pon_power_payload(payload: PonPowerPayload) -> dict[str, str]:
    data = payload.model_dump(exclude_unset=True)
    record = {field: clean_text(data.get(field)) for field in PON_MODULE_FIELDS if field in data}
    has_power_data = any(
        clean_text(record.get(field))
        for field in (
            "moduleVendor",
            "modulePartNumber",
            "moduleSerial",
            "moduleHardwareRev",
            "moduleRxPowerDbm",
            "moduleTxPowerDbm",
            "moduleTemperatureC",
            "moduleVoltageV",
            "moduleBiasCurrentMa",
        )
    )
    if has_power_data:
        record["moduleSource"] = clean_text(record.get("moduleSource")) or "Manual"
    elif "moduleSource" not in record:
        record["moduleSource"] = ""
    record["moduleEntityIndex"] = ""
    return record


def normalize_nap_payload(payload: NapPayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    record = dict(current or {})
    record.update({key: value for key, value in data.items() if value is not None})
    record["name"] = clean_text(record.get("name"))
    if not record["name"]:
        raise HTTPException(status_code=400, detail="NAP box name is required")
    record["ponPortId"] = clean_text(record.get("ponPortId"))
    if not record["ponPortId"]:
        raise HTTPException(status_code=400, detail="PON assignment is required")
    find_pon(record["ponPortId"])
    unique_nap_name(record["name"], record["ponPortId"], record.get("id"))
    record["location"] = clean_text(record.get("location"))
    record["barangay"] = clean_text(record.get("barangay"))
    record["latitude"] = clean_text(record.get("latitude"))
    record["longitude"] = clean_text(record.get("longitude"))
    splitter_ratio = clean_text(record.get("splitterRatio")).lower().replace("x", ":")
    record["splitterRatio"] = ensure_choice(splitter_ratio or "1:8", NAP_SPLITTER_RATIOS, "splitter ratio", "1:8")
    record["portCapacity"] = int(record.get("portCapacity") or 8)
    record["status"] = ensure_choice(record.get("status"), NAP_STATUSES, "NAP status", "PLANNED")
    record["notes"] = clean_text(record.get("notes"))
    return record


def normalize_fbt_payload(payload: FbtPayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    record = dict(current or {})
    record.update({key: value for key, value in data.items() if value is not None})
    record["name"] = clean_text(record.get("name"))
    if not record["name"]:
        raise HTTPException(status_code=400, detail="FBT name is required")
    record["napBoxId"] = clean_text(record.get("napBoxId"))
    if not record["napBoxId"]:
        raise HTTPException(status_code=400, detail="NAP assignment is required")
    find_nap(record["napBoxId"])
    record["portNumber"] = int(record.get("portNumber") or next_fbt_number(record["napBoxId"]))
    unique_fbt_port(record["napBoxId"], record["portNumber"], record.get("id"))
    record["portCapacity"] = int(record.get("portCapacity") or 8)
    record["status"] = ensure_choice(record.get("status"), FBT_STATUSES, "FBT status", "PLANNED")
    record["locationHint"] = clean_text(record.get("locationHint"))
    record["notes"] = clean_text(record.get("notes"))
    return record


def location_binding_label(location: dict[str, Any]) -> str:
    return (
        clean_text(location.get("location_name"))
        or clean_text(location.get("locationName"))
        or clean_text(location.get("barangay"))
        or clean_text(location.get("address"))
        or clean_text(location.get("id"))
        or "Location"
    )


def normalize_location_binding_snapshot(location: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(location, dict):
        return {}
    return {
        "id": clean_text(location.get("id")),
        "location_name": clean_text(location.get("location_name") or location.get("locationName")),
        "address": clean_text(location.get("address")),
        "municipality": clean_text(location.get("municipality") or location.get("city")),
        "barangay": clean_text(location.get("barangay")),
        "province": clean_text(location.get("province")),
        "region": clean_text(location.get("region")),
        "latitude": clean_coordinate(location.get("latitude"), "Latitude", -90, 90),
        "longitude": clean_coordinate(location.get("longitude"), "Longitude", -180, 180),
        "label": location_binding_label(location),
    }


def normalize_location_bindings(payload: DeviceLocationBindingPayload) -> dict[str, Any]:
    raw_locations = payload.locations if isinstance(payload.locations, list) else []
    snapshots = [
        normalize_location_binding_snapshot(location)
        for location in raw_locations
        if isinstance(location, dict)
    ]
    snapshots = [location for location in snapshots if location.get("id") or location.get("label")]
    snapshot_by_id = {location["id"]: location for location in snapshots if location.get("id")}
    ids = clean_unique_texts(list(payload.locationIds or []) + list(snapshot_by_id.keys()))
    normalized_snapshots = [snapshot_by_id[location_id] for location_id in ids if location_id in snapshot_by_id]
    return {"boundLocationIds": ids, "boundLocations": normalized_snapshots}


def normalized_location_match_values(location: dict[str, Any]) -> set[str]:
    values = {
        normalize_upper(location.get("id")),
        normalize_upper(location.get("location_name") or location.get("locationName")),
        normalize_upper(location.get("barangay")),
        normalize_upper(location.get("municipality") or location.get("city")),
        normalize_upper(location.get("province")),
    }
    composite_parts = [
        normalize_upper(location.get("barangay")),
        normalize_upper(location.get("municipality") or location.get("city")),
        normalize_upper(location.get("province")),
    ]
    if any(composite_parts):
        values.add("::".join(composite_parts))
    return {value for value in values if value}


def router_matches_location(device: dict[str, Any], location: dict[str, Any]) -> bool:
    requested_values = normalized_location_match_values(location)
    if not requested_values:
        return False
    for bound_location in device.get("boundLocations") or []:
        if requested_values.intersection(normalized_location_match_values(bound_location)):
            return True
    bound_ids = {normalize_upper(value) for value in device.get("boundLocationIds") or [] if normalize_upper(value)}
    return bool(requested_values.intersection(bound_ids))


def normalize_device_payload(payload: DevicePayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    if current:
        for field in SECRET_DEVICE_FIELDS:
            if field in data and not clean_text(data.get(field)):
                data.pop(field)
    record = dict(current or {})
    record.update({key: value for key, value in data.items() if value is not None})
    record["deviceType"] = ensure_choice(record.get("deviceType"), DEVICE_TYPES, "device type", "MIKROTIK")
    record["accessMethod"] = ensure_choice(record.get("accessMethod"), DEVICE_ACCESS_METHODS, "device access method", "API")
    record["managementIp"] = clean_text(record.get("managementIp"))
    if not record["managementIp"]:
        raise HTTPException(status_code=400, detail="Hostname or IP is required")
    record["name"] = clean_text(record.get("name")) or record["managementIp"]
    record["site"] = clean_text(record.get("site")) or "Main POP"
    record["vendor"] = clean_text(record.get("vendor")) or ("MikroTik" if record["deviceType"] == "MIKROTIK" else "Generic")
    record["model"] = clean_text(record.get("model"))
    record["status"] = ensure_choice(record.get("status"), DEVICE_STATUSES, "device status", "PLANNED")
    record["apiProtocol"] = ensure_choice(record.get("apiProtocol"), API_PROTOCOLS, "API protocol", "MIKROTIK_API")
    record["apiPort"] = int(record.get("apiPort") or (8728 if record["deviceType"] == "MIKROTIK" else 443))
    record["apiUsername"] = clean_text(record.get("apiUsername"))
    record["apiPassword"] = clean_text(record.get("apiPassword"))
    record["apiProfile"] = clean_text(record.get("apiProfile")) or "default-api-profile"
    record["snmpVersion"] = ensure_choice(record.get("snmpVersion"), SNMP_VERSIONS, "SNMP version", "V2C")
    record["snmpPort"] = int(record.get("snmpPort") or 161)
    record["snmpProfile"] = clean_text(record.get("snmpProfile"))
    record["snmpCommunity"] = clean_text(record.get("snmpCommunity"))
    record["snmpTransport"] = ensure_choice(record.get("snmpTransport"), SNMP_TRANSPORTS, "SNMP transport", "UDP")
    record["portAssociationMode"] = ensure_choice(
        record.get("portAssociationMode"),
        PORT_ASSOCIATION_MODES,
        "port association mode",
        "IFINDEX",
    )
    record["pollerGroup"] = clean_text(record.get("pollerGroup")) or "0"
    record["pollIntervalSeconds"] = int(record.get("pollIntervalSeconds") or DEFAULT_DEVICE_POLL_INTERVAL_SECONDS)
    record["forceAdd"] = normalize_bool(record.get("forceAdd"))
    record["snmpAuthLevel"] = ensure_choice(
        record.get("snmpAuthLevel"),
        SNMP_AUTH_LEVELS,
        "SNMP auth level",
        "NO_AUTH_NO_PRIV",
    )
    record["snmpAuthName"] = clean_text(record.get("snmpAuthName"))
    record["snmpAuthPassword"] = clean_text(record.get("snmpAuthPassword"))
    record["snmpAuthProtocol"] = ensure_choice(
        record.get("snmpAuthProtocol"),
        SNMP_AUTH_PROTOCOLS,
        "SNMP auth protocol",
        "SHA",
    )
    record["snmpPrivacyProtocol"] = ensure_choice(
        record.get("snmpPrivacyProtocol"),
        SNMP_PRIVACY_PROTOCOLS,
        "SNMP privacy protocol",
        "AES",
    )
    record["snmpPrivacyPassword"] = clean_text(record.get("snmpPrivacyPassword"))
    if record["accessMethod"] == "SNMP" and record["snmpVersion"] == "V3":
        if not record["snmpAuthName"]:
            raise HTTPException(status_code=400, detail="SNMPv3 auth user name is required")
        if record["snmpAuthLevel"] in {"AUTH_NO_PRIV", "AUTH_PRIV"} and not record["snmpAuthPassword"]:
            raise HTTPException(status_code=400, detail="SNMPv3 auth password is required")
        if record["snmpAuthLevel"] == "AUTH_PRIV" and not record["snmpPrivacyPassword"]:
            raise HTTPException(status_code=400, detail="SNMPv3 crypto password is required")
    record["notes"] = clean_text(record.get("notes"))
    raw_location_ids = record.get("boundLocationIds") if isinstance(record.get("boundLocationIds"), list) else []
    raw_locations = record.get("boundLocations") if isinstance(record.get("boundLocations"), list) else []
    record["boundLocationIds"] = clean_unique_texts(raw_location_ids)
    record["boundLocations"] = [
        normalize_location_binding_snapshot(row)
        for row in raw_locations
        if isinstance(row, dict)
    ]
    unique_device_endpoint(record, record.get("id"))
    return record


class RouterOsApiError(Exception):
    pass


class RouterOsAuthError(RouterOsApiError):
    pass


def routeros_encode_length(length: int) -> bytes:
    if length < 0x80:
        return bytes([length])
    if length < 0x4000:
        return (length | 0x8000).to_bytes(2, "big")
    if length < 0x200000:
        return (length | 0xC00000).to_bytes(3, "big")
    if length < 0x10000000:
        return (length | 0xE0000000).to_bytes(4, "big")
    return b"\xF0" + length.to_bytes(4, "big")


def routeros_read_exact(sock: socket.socket, length: int) -> bytes:
    data = bytearray()
    while len(data) < length:
        chunk = sock.recv(length - len(data))
        if not chunk:
            raise OSError("MikroTik API closed the connection")
        data.extend(chunk)
    return bytes(data)


def routeros_read_length(sock: socket.socket) -> int:
    first = routeros_read_exact(sock, 1)[0]
    if first < 0x80:
        return first
    if first < 0xC0:
        return ((first & 0x3F) << 8) + routeros_read_exact(sock, 1)[0]
    if first < 0xE0:
        extra = routeros_read_exact(sock, 2)
        return ((first & 0x1F) << 16) + int.from_bytes(extra, "big")
    if first < 0xF0:
        extra = routeros_read_exact(sock, 3)
        return ((first & 0x0F) << 24) + int.from_bytes(extra, "big")
    if first == 0xF0:
        return int.from_bytes(routeros_read_exact(sock, 4), "big")
    raise RouterOsApiError("Unsupported MikroTik API word length")


def routeros_send_sentence(sock: socket.socket, words: list[str]) -> None:
    for word in words:
        data = word.encode("utf-8")
        sock.sendall(routeros_encode_length(len(data)) + data)
    sock.sendall(b"\x00")


def routeros_read_sentence(sock: socket.socket) -> list[str]:
    words = []
    while True:
        length = routeros_read_length(sock)
        if length == 0:
            return words
        words.append(routeros_read_exact(sock, length).decode("utf-8", errors="replace"))


def routeros_read_reply(sock: socket.socket, max_sentences: int = MIKROTIK_API_MAX_REPLY_SENTENCES) -> list[list[str]]:
    sentences = []
    for _ in range(max_sentences):
        sentence = routeros_read_sentence(sock)
        if not sentence:
            continue
        sentences.append(sentence)
        if sentence[0] in {"!done", "!trap", "!fatal"}:
            return sentences
    raise RouterOsApiError(f"MikroTik API response exceeded {max_sentences} sentences")


def routeros_sentence_attributes(sentence: list[str]) -> dict[str, str]:
    attributes = {}
    for word in sentence[1:]:
        if not word.startswith("="):
            continue
        key, _, value = word[1:].partition("=")
        attributes[key] = value
    return attributes


def routeros_reply_status(reply: list[list[str]]) -> str:
    for sentence in reply:
        if sentence and sentence[0] in {"!done", "!trap", "!fatal"}:
            return sentence[0]
    return ""


def routeros_reply_message(reply: list[list[str]]) -> str:
    for sentence in reply:
        if not sentence or sentence[0] not in {"!trap", "!fatal"}:
            continue
        attributes = routeros_sentence_attributes(sentence)
        return clean_text(attributes.get("message") or attributes.get("category"))
    return ""


def routeros_assert_login_done(reply: list[list[str]]) -> None:
    if routeros_reply_status(reply) == "!done":
        return
    raise RouterOsAuthError(routeros_reply_message(reply) or "Authentication failed")


def routeros_login_modern(host: str, port: int, username: str, password: str) -> None:
    with socket.create_connection((host, port), timeout=MIKROTIK_API_TEST_TIMEOUT_SECONDS) as sock:
        sock.settimeout(MIKROTIK_API_TEST_TIMEOUT_SECONDS)
        routeros_login_modern_on_socket(sock, username, password)


def routeros_login_challenge(host: str, port: int, username: str, password: str) -> None:
    with socket.create_connection((host, port), timeout=MIKROTIK_API_TEST_TIMEOUT_SECONDS) as sock:
        sock.settimeout(MIKROTIK_API_TEST_TIMEOUT_SECONDS)
        routeros_login_challenge_on_socket(sock, username, password)


def routeros_login_modern_on_socket(sock: socket.socket, username: str, password: str) -> None:
    routeros_send_sentence(sock, ["/login", f"=name={username}", f"=password={password}"])
    routeros_assert_login_done(routeros_read_reply(sock))


def routeros_login_challenge_on_socket(sock: socket.socket, username: str, password: str) -> None:
    routeros_send_sentence(sock, ["/login"])
    initial_reply = routeros_read_reply(sock)
    if routeros_reply_status(initial_reply) != "!done":
        raise RouterOsAuthError(routeros_reply_message(initial_reply) or "Challenge login is not supported")
    challenge = ""
    for sentence in initial_reply:
        challenge = clean_text(routeros_sentence_attributes(sentence).get("ret"))
        if challenge:
            break
    if not challenge:
        raise RouterOsAuthError("MikroTik API did not return a login challenge")
    try:
        digest = hashlib.md5(b"\x00" + password.encode("utf-8") + bytes.fromhex(challenge)).hexdigest()
    except ValueError as exc:
        raise RouterOsAuthError("MikroTik API returned an invalid login challenge") from exc
    routeros_send_sentence(sock, ["/login", f"=name={username}", f"=response=00{digest}"])
    routeros_assert_login_done(routeros_read_reply(sock))


def routeros_open_session(host: str, port: int, username: str, password: str) -> socket.socket:
    modern_sock: socket.socket | None = None
    try:
        modern_sock = socket.create_connection((host, port), timeout=MIKROTIK_API_TEST_TIMEOUT_SECONDS)
        modern_sock.settimeout(MIKROTIK_API_TEST_TIMEOUT_SECONDS)
        routeros_login_modern_on_socket(modern_sock, username, password)
        return modern_sock
    except OSError:
        if modern_sock is not None:
            modern_sock.close()
        raise
    except RouterOsAuthError as modern_exc:
        if modern_sock is not None:
            modern_sock.close()
        challenge_sock: socket.socket | None = None
        try:
            challenge_sock = socket.create_connection((host, port), timeout=MIKROTIK_API_TEST_TIMEOUT_SECONDS)
            challenge_sock.settimeout(MIKROTIK_API_TEST_TIMEOUT_SECONDS)
            routeros_login_challenge_on_socket(challenge_sock, username, password)
            return challenge_sock
        except RouterOsAuthError as challenge_exc:
            if challenge_sock is not None:
                challenge_sock.close()
            raise RouterOsAuthError(str(challenge_exc) or str(modern_exc)) from challenge_exc


def routeros_login(host: str, port: int, username: str, password: str) -> None:
    with routeros_open_session(host, port, username, password):
        return


def routeros_rows_from_reply(reply: list[list[str]]) -> list[dict[str, str]]:
    status = routeros_reply_status(reply)
    if status == "!done":
        return [routeros_sentence_attributes(sentence) for sentence in reply if sentence and sentence[0] == "!re"]
    raise RouterOsApiError(routeros_reply_message(reply) or "RouterOS command failed")


def routeros_run_command_on_socket(sock: socket.socket, command: str, words: list[str] | None = None) -> list[dict[str, str]]:
    routeros_send_sentence(sock, [command, *(words or [])])
    return routeros_rows_from_reply(routeros_read_reply(sock))


def routeros_device_connection(device: dict[str, Any]) -> tuple[str, int, str, str]:
    host = clean_text(device.get("managementIp"))
    port = int(device.get("apiPort") or 8728)
    username = clean_text(device.get("apiUsername"))
    password = clean_text(device.get("apiPassword"))
    if not username or not password:
        raise RouterOsApiError("MikroTik API credentials are incomplete")
    return host, port, username, password


def routeros_run_command(device: dict[str, Any], command: str, words: list[str] | None = None) -> list[dict[str, str]]:
    host, port, username, password = routeros_device_connection(device)
    with routeros_open_session(host, port, username, password) as sock:
        return routeros_run_command_on_socket(sock, command, words)


def test_mikrotik_api_reachability(record: dict[str, Any]) -> None:
    if record.get("accessMethod") != "API" or record.get("deviceType") != "MIKROTIK":
        return
    host = clean_text(record.get("managementIp"))
    port = int(record.get("apiPort") or 8728)
    username = clean_text(record.get("apiUsername"))
    password = clean_text(record.get("apiPassword"))
    if not username:
        raise HTTPException(status_code=400, detail="MikroTik API username is required")
    if not password:
        raise HTTPException(status_code=400, detail="MikroTik API password is required")
    try:
        routeros_login(host, port, username, password)
    except OSError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"MikroTik API test failed. Could not connect to {host}:{port}.",
        ) from exc
    except RouterOsApiError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"MikroTik API test failed. {exc}",
        ) from exc


class SnmpError(Exception):
    pass


class BerReader:
    def __init__(self, data: bytes):
        self.data = data
        self.offset = 0

    def read_tlv(self) -> tuple[int, bytes]:
        if self.offset >= len(self.data):
            raise SnmpError("Malformed SNMP response")
        tag = self.data[self.offset]
        self.offset += 1
        if self.offset >= len(self.data):
            raise SnmpError("Malformed SNMP length")
        first = self.data[self.offset]
        self.offset += 1
        if first & 0x80:
            count = first & 0x7F
            if count == 0 or self.offset + count > len(self.data):
                raise SnmpError("Unsupported SNMP length")
            length = int.from_bytes(self.data[self.offset : self.offset + count], "big")
            self.offset += count
        else:
            length = first
        if self.offset + length > len(self.data):
            raise SnmpError("Truncated SNMP response")
        value = self.data[self.offset : self.offset + length]
        self.offset += length
        return tag, value

    def expect(self, expected_tag: int) -> bytes:
        tag, value = self.read_tlv()
        if tag != expected_tag:
            raise SnmpError("Unexpected SNMP response format")
        return value


def ber_length(length: int) -> bytes:
    if length < 0x80:
        return bytes([length])
    data = length.to_bytes((length.bit_length() + 7) // 8, "big")
    return bytes([0x80 | len(data)]) + data


def ber_tlv(tag: int, value: bytes) -> bytes:
    return bytes([tag]) + ber_length(len(value)) + value


def ber_integer(value: int) -> bytes:
    if value == 0:
        data = b"\x00"
    else:
        data = value.to_bytes((value.bit_length() + 7) // 8, "big", signed=False)
        if data[0] & 0x80:
            data = b"\x00" + data
    return ber_tlv(0x02, data)


def ber_octet_string(value: str) -> bytes:
    return ber_tlv(0x04, value.encode("utf-8"))


def oid_tuple(oid: str) -> tuple[int, ...]:
    return tuple(int(part) for part in oid.strip(".").split(".") if part != "")


def oid_string(parts: tuple[int, ...]) -> str:
    return ".".join(str(part) for part in parts)


def ber_oid(oid: str) -> bytes:
    parts = oid_tuple(oid)
    if len(parts) < 2:
        raise SnmpError("Invalid OID")
    body = bytearray([parts[0] * 40 + parts[1]])
    for part in parts[2:]:
        stack = [part & 0x7F]
        part >>= 7
        while part:
            stack.append(0x80 | (part & 0x7F))
            part >>= 7
        body.extend(reversed(stack))
    return ber_tlv(0x06, bytes(body))


def decode_integer(value: bytes) -> int:
    if not value:
        return 0
    return int.from_bytes(value, "big", signed=bool(value[0] & 0x80))


def decode_oid(value: bytes) -> str:
    if not value:
        return ""
    first = value[0]
    parts = [first // 40, first % 40]
    number = 0
    for byte in value[1:]:
        number = (number << 7) | (byte & 0x7F)
        if not byte & 0x80:
            parts.append(number)
            number = 0
    return oid_string(tuple(parts))


def decode_octets(value: bytes) -> str:
    if not value:
        return ""
    try:
        decoded = value.decode("utf-8")
    except UnicodeDecodeError:
        decoded = value.decode("latin-1", errors="replace")
    if all(char.isprintable() or char.isspace() for char in decoded):
        return decoded.strip()
    if len(value) == 6:
        return ":".join(f"{byte:02x}" for byte in value)
    return ":".join(f"{byte:02x}" for byte in value)


def decode_snmp_value(tag: int, value: bytes) -> Any:
    if tag == 0x02:
        return decode_integer(value)
    if tag in {0x41, 0x42, 0x43, 0x46}:
        return int.from_bytes(value or b"\x00", "big", signed=False)
    if tag == 0x04:
        return decode_octets(value)
    if tag == 0x06:
        return decode_oid(value)
    if tag == 0x40 and len(value) == 4:
        return ".".join(str(byte) for byte in value)
    if tag in {0x05, 0x80, 0x81, 0x82}:
        return None
    return decode_octets(value)


def build_snmp_request(version: str, community: str, pdu_tag: int, request_id: int, oids: list[str]) -> bytes:
    varbinds = b"".join(ber_tlv(0x30, ber_oid(oid) + ber_tlv(0x05, b"")) for oid in oids)
    pdu = ber_tlv(
        pdu_tag,
        ber_integer(request_id) + ber_integer(0) + ber_integer(0) + ber_tlv(0x30, varbinds),
    )
    version_number = 0 if version == "V1" else 1
    return ber_tlv(0x30, ber_integer(version_number) + ber_octet_string(community) + pdu)


def parse_snmp_response(response: bytes, request_id: int) -> list[dict[str, Any]]:
    message = BerReader(BerReader(response).expect(0x30))
    message.read_tlv()
    message.read_tlv()
    pdu_tag, pdu_payload = message.read_tlv()
    if pdu_tag != 0xA2:
        raise SnmpError("SNMP agent returned an unexpected response")
    pdu = BerReader(pdu_payload)
    response_id = decode_integer(pdu.expect(0x02))
    error_status = decode_integer(pdu.expect(0x02))
    error_index = decode_integer(pdu.expect(0x02))
    if response_id != request_id:
        raise SnmpError("SNMP response id did not match request")
    if error_status:
        raise SnmpError(f"SNMP agent returned error status {error_status} at index {error_index}")
    rows = []
    bindings = BerReader(pdu.expect(0x30))
    while bindings.offset < len(bindings.data):
        binding = BerReader(bindings.expect(0x30))
        oid = decode_oid(binding.expect(0x06))
        tag, value = binding.read_tlv()
        rows.append({"oid": oid, "tag": tag, "value": decode_snmp_value(tag, value)})
    return rows


class SnmpClient:
    def __init__(self, device: dict[str, Any], community: str):
        self.host = clean_text(device.get("managementIp"))
        self.port = int(device.get("snmpPort") or 161)
        self.version = ensure_choice(device.get("snmpVersion"), ["V1", "V2C"], "SNMP version", "V2C")
        self.community = community
        self.transport = ensure_choice(device.get("snmpTransport"), ["UDP", "UDP6"], "SNMP capture transport", "UDP")

    def request(self, pdu_tag: int, oids: list[str]) -> list[dict[str, Any]]:
        request_id = random.randint(1, 2_147_483_647)
        payload = build_snmp_request(self.version, self.community, pdu_tag, request_id, oids)
        family = socket.AF_INET6 if self.transport == "UDP6" else socket.AF_INET
        last_error: OSError | None = None
        for _ in range(SNMP_CAPTURE_RETRIES + 1):
            try:
                with socket.socket(family, socket.SOCK_DGRAM) as sock:
                    sock.settimeout(SNMP_CAPTURE_TIMEOUT_SECONDS)
                    sock.sendto(payload, (self.host, self.port))
                    response, _ = sock.recvfrom(65535)
                return parse_snmp_response(response, request_id)
            except OSError as exc:
                last_error = exc
            except SnmpError:
                raise
        raise SnmpError(f"No SNMP response from {self.host}:{self.port}") from last_error

    def get(self, oids: list[str]) -> dict[str, Any]:
        return {row["oid"]: row["value"] for row in self.request(0xA0, oids)}

    def getnext(self, oid: str) -> dict[str, Any]:
        rows = self.request(0xA1, [oid])
        if not rows:
            raise SnmpError("SNMP getnext returned no rows")
        return rows[0]

    def walk(self, base_oid: str) -> dict[str, Any]:
        base = oid_tuple(base_oid)
        current = base_oid
        values: dict[str, Any] = {}
        seen: set[str] = set()
        for _ in range(SNMP_MAX_WALK_ROWS):
            row = self.getnext(current)
            next_oid = clean_text(row.get("oid"))
            next_tuple = oid_tuple(next_oid)
            if row.get("tag") in {0x80, 0x81, 0x82} or not next_tuple[: len(base)] == base or next_oid in seen:
                break
            values[next_oid] = row.get("value")
            seen.add(next_oid)
            current = next_oid
        return values


def snmp_community_candidates(device: dict[str, Any]) -> list[tuple[str, str]]:
    community = clean_text(device.get("snmpCommunity"))
    if community:
        return [(community, "device")]
    return [(community, "configured") for community in DEFAULT_SNMP_COMMUNITIES]


def status_from_admin(value: Any) -> str:
    return "ENABLED" if int(value or 0) == 1 else "DISABLED" if int(value or 0) == 2 else "RESERVED"


def status_from_oper(value: Any) -> str:
    return "UP" if int(value or 0) == 1 else "DOWN" if int(value or 0) in {2, 7} else "UNKNOWN"


def infer_pon_technology(text: str) -> str:
    normalized = text.lower()
    if "xgs" in normalized or "xgpon" in normalized or "10g" in normalized:
        return "XGS_PON"
    if "epon" in normalized:
        return "EPON"
    if "gpon" in normalized:
        return "GPON"
    return "OTHER"


def safe_pon_technology(value: Any, fallback: str = "OTHER") -> str:
    normalized = normalize_upper(value)
    return normalized if normalized in PON_TECHNOLOGIES else fallback


def infer_model_pon_technology(text: str) -> str:
    for match in PON_MODEL_TECHNOLOGY_RE.finditer(text):
        marker = match.group(1).lower()
        if marker == "e":
            return "EPON"
        if marker == "g":
            return "GPON"
        if marker == "x":
            return "XGS_PON"
    return ""


def infer_context_pon_technology(*values: Any) -> str:
    text = " ".join(clean_text(value) for value in values if clean_text(value))
    direct = infer_pon_technology(text)
    if direct != "OTHER":
        return direct
    return infer_model_pon_technology(text)


def infer_olt_context_pon_technology(
    olt: dict[str, Any] | None = None,
    device: dict[str, Any] | None = None,
    system: dict[str, Any] | None = None,
) -> str:
    values = []
    for source in (system or {}, olt or {}, device or {}):
        values.extend(
            [
                source.get("vendor"),
                source.get("model"),
                source.get("sysDescr"),
                source.get("sourceSysDescr"),
                source.get("sysObjectID"),
                source.get("sourceSysObjectID"),
                source.get("name"),
            ]
        )
    return infer_context_pon_technology(*values)


def pon_technology_defaults(technology: Any) -> dict[str, int | str]:
    return PON_TECHNOLOGY_DEFAULTS.get(safe_pon_technology(technology), PON_TECHNOLOGY_DEFAULTS["OTHER"])


def apply_pon_technology_defaults(row: dict[str, Any], context_technology: str = "") -> bool:
    current_technology = safe_pon_technology(row.get("technology"))
    next_technology = safe_pon_technology(context_technology, current_technology)
    if current_technology == "OTHER" and next_technology != "OTHER":
        current_technology = next_technology
    defaults = pon_technology_defaults(current_technology)
    changed = False
    if row.get("technology") != current_technology:
        row["technology"] = current_technology
        changed = True
    if clean_text(row.get("splitRatio")) != clean_text(defaults["splitRatio"]):
        row["splitRatio"] = defaults["splitRatio"]
        changed = True
    if int(row.get("capacity") or 0) != int(defaults["capacity"]):
        row["capacity"] = defaults["capacity"]
        changed = True
    return changed


def normalize_pon_inventory_defaults() -> int:
    changed = 0
    timestamp = now_iso()
    olt_by_id = {row.get("id"): row for row in olts}
    device_by_id = {row.get("id"): row for row in network_devices}
    for pon in pon_ports:
        if pon.get("deletedAt"):
            continue
        olt = olt_by_id.get(pon.get("oltId")) or {}
        device = device_by_id.get(olt.get("sourceDeviceId")) or device_by_id.get(pon.get("sourceDeviceId")) or {}
        context_technology = infer_olt_context_pon_technology(olt, device)
        if apply_pon_technology_defaults(pon, context_technology):
            pon["updatedAt"] = timestamp
            changed += 1
    return changed


def infer_pon_number(text: str, used: set[int]) -> int | None:
    for raw in reversed(re.findall(r"\d+", text)):
        number = int(raw)
        if 1 <= number <= 128 and number not in used:
            return number
    return None


def assign_pon_numbers(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    used: set[int] = set()
    next_number = 1
    numbered = []
    for candidate in candidates:
        text = " ".join(
            clean_text(candidate.get(field))
            for field in ("ifName", "ifDescr", "ifAlias")
            if clean_text(candidate.get(field))
        )
        number = infer_pon_number(text, used)
        if number is None:
            while next_number in used:
                next_number += 1
            number = next_number
        used.add(number)
        numbered.append({**candidate, "portNumber": number})
    return numbered


def is_pon_child_interface(text: str) -> bool:
    normalized = clean_text(text)
    return bool(PON_CHILD_INTERFACE_RE.search(normalized) or COMPACT_PON_ONU_INTERFACE_RE.search(normalized))


def is_subscriber_interface(text: str) -> bool:
    normalized = clean_text(text)
    return bool(SUBSCRIBER_INTERFACE_RE.search(normalized) or is_pon_child_interface(normalized))


def collect_interfaces(client: SnmpClient) -> list[dict[str, Any]]:
    columns: dict[str, dict[str, Any]] = {}
    for column, base_oid in IF_MIB_COLUMNS.items():
        base = oid_tuple(base_oid)
        try:
            values = client.walk(base_oid)
        except SnmpError:
            values = {}
        for oid, value in values.items():
            suffix = oid_tuple(oid)[len(base) :]
            if not suffix:
                continue
            index = oid_string(suffix)
            row = columns.setdefault(index, {"ifIndex": int(suffix[0]) if suffix[0] else 0})
            row[column] = value
    return sorted(columns.values(), key=lambda item: int(item.get("ifIndex") or 0))


def pon_candidates_from_interfaces(interfaces: list[dict[str, Any]]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for row in interfaces:
        text = " ".join(
            clean_text(row.get(field))
            for field in ("ifName", "ifDescr", "ifAlias")
            if clean_text(row.get(field))
        )
        if not text or not PON_INTERFACE_RE.search(text) or is_subscriber_interface(text):
            continue
        label = clean_text(row.get("ifName")) or clean_text(row.get("ifDescr")) or f"PON ifIndex {row.get('ifIndex')}"
        candidates.append(
            {
                "ifIndex": row.get("ifIndex"),
                "ifName": clean_text(row.get("ifName")),
                "ifDescr": clean_text(row.get("ifDescr")),
                "ifAlias": clean_text(row.get("ifAlias")),
                "ifType": row.get("ifType"),
                "ifSpeed": row.get("ifSpeed"),
                "label": label,
                "technology": infer_pon_technology(text),
                "adminStatus": status_from_admin(row.get("ifAdminStatus")),
                "operationalStatus": status_from_oper(row.get("ifOperStatus")),
            }
        )
    return assign_pon_numbers(candidates)


def infer_onu_link(text: str, pon_candidates: list[dict[str, Any]]) -> tuple[int | None, str]:
    compact_match = COMPACT_PON_ONU_INTERFACE_RE.search(text)
    if compact_match:
        return int(compact_match.group(1)), str(int(compact_match.group(2)))
    match = PON_ONU_RE.search(text)
    if match:
        return int(match.group(1)), match.group(2)
    if len(pon_candidates) == 1:
        return int(pon_candidates[0].get("portNumber") or 1), ""
    return None, ""


def infer_onu_serial(text: str) -> str:
    match = ONU_SERIAL_RE.search(text)
    return match.group(1)[:32] if match else ""


def normalize_mac_address(value: str) -> str:
    text = clean_text(value)
    if len(text) == 6 and any(ord(char) > 127 for char in text):
        raw = text.encode("latin-1", errors="ignore").hex()
    else:
        raw = re.sub(r"[^0-9a-fA-F]", "", text)
    if len(raw) != 12:
        return ""
    return ":".join(raw[index : index + 2] for index in range(0, 12, 2)).upper()


def first_regex_value(pattern: re.Pattern[str], text: str, group: int = 1) -> str:
    match = pattern.search(text)
    return clean_text(match.group(group)) if match else ""


def infer_distance_meters(text: str) -> str:
    match = ONU_DISTANCE_RE.search(text)
    if not match:
        return ""
    value = float(match.group(1))
    unit = clean_text(match.group(2)).lower()
    meters = int(round(value * 1000 if unit == "km" else value))
    return str(meters)


def infer_last_down_reason(text: str) -> str:
    normalized = text.lower()
    if "dying" in normalized:
        return "Dying gasp"
    if "los" in normalized:
        return "LOS"
    if "lofi" in normalized:
        return "LOFI"
    return first_regex_value(re.compile(r"\b(?:last[- ]?down|down[- ]?reason|reason)\s*[:=]\s*([A-Za-z0-9 _./-]{2,40})", re.IGNORECASE), text)


def status_from_onu(admin_status: str, oper_status: str, text: str) -> str:
    normalized = text.lower()
    if admin_status == "DISABLED":
        return "DISABLED"
    if "dying" in normalized:
        return "DYING_GASP"
    if "los" in normalized:
        return "LOS"
    if oper_status == "UP":
        return "ONLINE"
    if oper_status == "DOWN":
        return "OFFLINE"
    return "UNKNOWN"


def onu_candidates_from_interfaces(
    interfaces: list[dict[str, Any]],
    pon_candidates: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for row in interfaces:
        text = " ".join(
            clean_text(row.get(field))
            for field in ("ifName", "ifDescr", "ifAlias")
            if clean_text(row.get(field))
        )
        if not text or not is_subscriber_interface(text):
            continue
        pon_number, onu_id = infer_onu_link(text, pon_candidates)
        admin_status = status_from_admin(row.get("ifAdminStatus"))
        operational_status = status_from_oper(row.get("ifOperStatus"))
        label = clean_text(row.get("ifAlias")) or clean_text(row.get("ifName")) or clean_text(row.get("ifDescr"))
        mac_address = normalize_mac_address(first_regex_value(ONU_MAC_RE, text))
        candidates.append(
            {
                "ifIndex": row.get("ifIndex"),
                "ifName": clean_text(row.get("ifName")),
                "ifDescr": clean_text(row.get("ifDescr")),
                "ifAlias": clean_text(row.get("ifAlias")),
                "ponPortNumber": pon_number,
                "onuId": onu_id or clean_text(row.get("ifIndex")),
                "serialNumber": infer_onu_serial(text),
                "macAddress": mac_address,
                "name": label or f"ONU {onu_id or row.get('ifIndex')}",
                "adminStatus": admin_status,
                "operationalStatus": operational_status,
                "status": status_from_onu(admin_status, operational_status, text),
                "rxPowerDbm": first_regex_value(ONU_RX_RE, text),
                "txPowerDbm": first_regex_value(ONU_TX_RE, text),
                "distanceMeters": infer_distance_meters(text),
                "temperatureC": first_regex_value(ONU_TEMP_RE, text),
                "voltageV": first_regex_value(ONU_VOLTAGE_RE, text),
                "biasCurrentMa": first_regex_value(ONU_BIAS_RE, text),
                "vlan": first_regex_value(ONU_VLAN_RE, text),
                "servicePort": first_regex_value(ONU_SERVICE_PORT_RE, text),
                "lastDownReason": infer_last_down_reason(text),
                "profile": first_regex_value(re.compile(r"\b(?:profile|line-profile|srv-profile)\s*[:=]\s*([A-Za-z0-9_.-]{2,40})", re.IGNORECASE), text),
                "description": text[:160],
            }
        )
    return sorted(candidates, key=lambda item: (int(item.get("ponPortNumber") or 9999), clean_text(item.get("onuId"))))


def snmp_walk_column(client: SnmpClient, column_oid: str) -> dict[str, Any]:
    try:
        rows = client.walk(column_oid)
    except SnmpError:
        return {}
    prefix = f"{column_oid}."
    return {oid.removeprefix(prefix): value for oid, value in rows.items() if oid.startswith(prefix)}


def scaled_snmp_decimal(value: Any, divisor: int = 100) -> str:
    text = clean_text(value)
    if text in HS_ONU_OPTICAL_VALUE_SENTINELS:
        return ""
    try:
        numeric = float(text) / divisor
    except ValueError:
        return ""
    return f"{numeric:.2f}".rstrip("0").rstrip(".")


def positive_integer_text(value: Any) -> str:
    text = clean_text(value)
    try:
        numeric = int(text)
    except ValueError:
        return ""
    return str(numeric) if numeric > 0 and numeric != 65535 else ""


def onu_name_key(value: Any) -> str:
    return clean_text(value).upper()


def optical_device_index(index: str) -> str:
    return clean_text(index).split(".", 1)[0]


def hs_fiber_onu_table(client: SnmpClient, info_base_oid: str, optical_base_oid: str, profile_prefix: str) -> dict[str, dict[str, str]]:
    names = snmp_walk_column(client, f"{info_base_oid}.2")
    macs = snmp_walk_column(client, f"{info_base_oid}.7")
    serials = snmp_walk_column(client, f"{info_base_oid}.15")
    distances = snmp_walk_column(client, f"{info_base_oid}.19")
    if profile_prefix == "GPON":
        line_profiles = snmp_walk_column(client, f"{info_base_oid}.22")
        service_profiles = snmp_walk_column(client, f"{info_base_oid}.23")
    else:
        line_profiles = {}
        service_profiles = {}
        distances = snmp_walk_column(client, f"{info_base_oid}.15")

    table: dict[str, dict[str, str]] = {}
    index_by_device_index: dict[str, dict[str, str]] = {}
    for device_index, name in names.items():
        row = {
            "vendorDeviceIndex": device_index,
            "name": clean_text(name),
            "macAddress": normalize_mac_address(clean_text(macs.get(device_index))) if profile_prefix == "EPON" else "",
            "serialNumber": clean_text(serials.get(device_index)) if profile_prefix == "GPON" else "",
            "distanceMeters": positive_integer_text(distances.get(device_index)),
        }
        profile_parts = []
        if clean_text(line_profiles.get(device_index)):
            profile_parts.append(f"line {clean_text(line_profiles.get(device_index))}")
        if clean_text(service_profiles.get(device_index)):
            profile_parts.append(f"service {clean_text(service_profiles.get(device_index))}")
        if profile_parts:
            row["profile"] = " / ".join(profile_parts)
        index_by_device_index[device_index] = row
        if clean_text(name):
            table[onu_name_key(name)] = row

    optical_columns = {
        "rxPowerDbm": snmp_walk_column(client, f"{optical_base_oid}.4"),
        "txPowerDbm": snmp_walk_column(client, f"{optical_base_oid}.5"),
        "biasCurrentMa": snmp_walk_column(client, f"{optical_base_oid}.6"),
        "voltageV": snmp_walk_column(client, f"{optical_base_oid}.7"),
        "temperatureC": snmp_walk_column(client, f"{optical_base_oid}.8"),
    }
    for field, values in optical_columns.items():
        for optical_index, value in values.items():
            device_index = optical_device_index(optical_index)
            row = index_by_device_index.get(device_index)
            if not row:
                continue
            row[field] = scaled_snmp_decimal(value)
    return table


def augment_hs_fiber_onu_candidates(client: SnmpClient, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    table = {
        **hs_fiber_onu_table(client, HS_EPON_ONU_INFO_ENTRY_OID, HS_EPON_ONU_OPTICAL_ENTRY_OID, "EPON"),
        **hs_fiber_onu_table(client, HS_GPON_ONU_INFO_ENTRY_OID, HS_GPON_ONU_OPTICAL_ENTRY_OID, "GPON"),
    }
    if not table:
        return candidates
    for candidate in candidates:
        enterprise_row = table.get(onu_name_key(candidate.get("name"))) or table.get(onu_name_key(candidate.get("ifName")))
        if not enterprise_row:
            continue
        candidate["vendorDeviceIndex"] = enterprise_row.get("vendorDeviceIndex", "")
        for field in (
            "macAddress",
            "serialNumber",
            "rxPowerDbm",
            "txPowerDbm",
            "distanceMeters",
            "temperatureC",
            "voltageV",
            "biasCurrentMa",
            "profile",
        ):
            if clean_text(enterprise_row.get(field)):
                candidate[field] = clean_text(enterprise_row.get(field))
    return candidates


def vsol_onu_mac_table(client: SnmpClient) -> dict[str, dict[str, str]]:
    macs = snmp_walk_column(client, f"{VSOL_ONU_MAC_ENTRY_OID}.3")
    interfaces = snmp_walk_column(client, f"{VSOL_ONU_MAC_ENTRY_OID}.5")
    table: dict[str, dict[str, str]] = {}
    for row_index, interface_name in interfaces.items():
        interface_label = clean_text(interface_name)
        mac_address = normalize_mac_address(clean_text(macs.get(row_index)))
        if not interface_label or not mac_address or not is_pon_child_interface(interface_label):
            continue
        table[onu_name_key(interface_label)] = {
            "macAddress": mac_address,
            "learnedClientMacAddress": mac_address,
        }
    return table


def augment_vsol_onu_candidates(client: SnmpClient, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    table = vsol_onu_mac_table(client)
    if not table:
        return candidates
    for candidate in candidates:
        enterprise_row = table.get(onu_name_key(candidate.get("name"))) or table.get(onu_name_key(candidate.get("ifName")))
        if not enterprise_row:
            continue
        candidate["learnedClientMacAddress"] = enterprise_row.get("learnedClientMacAddress", "")
        if clean_text(enterprise_row.get("macAddress")) and not clean_text(candidate.get("macAddress")):
            candidate["macAddress"] = clean_text(enterprise_row.get("macAddress"))
    return candidates


def augment_vendor_onu_candidates(client: SnmpClient, system: dict[str, Any], candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sys_object_id = clean_text(system.get("sysObjectID"))
    if sys_object_id.startswith(HS_FIBER_ENTERPRISE_OID):
        return augment_hs_fiber_onu_candidates(client, candidates)
    if sys_object_id.startswith(VSOL_ENTERPRISE_OID):
        return augment_vsol_onu_candidates(client, candidates)
    return candidates


def guess_vendor_model(sys_descr: str, sys_object_id: str) -> tuple[str, str]:
    haystack = f"{sys_descr} {sys_object_id}".lower()
    known_vendors = [
        ("hsgq", "HSGQ"),
        ("huawei", "Huawei"),
        ("zte", "ZTE"),
        ("fiberhome", "FiberHome"),
        ("bdcom", "BDCOM"),
        ("c-data", "C-Data"),
        ("cdata", "C-Data"),
        ("vsol", "VSOL"),
        ("zyxel", "Zyxel"),
        ("mikrotik", "MikroTik"),
    ]
    vendor = next((label for marker, label in known_vendors if marker in haystack), "")
    if not vendor:
        vendor = next((label for prefix, label in ENTERPRISE_VENDOR_MARKERS if sys_object_id.startswith(prefix)), "")
    if not vendor:
        vendor = clean_text(sys_descr).split(" ")[0][:40] if clean_text(sys_descr) else "Generic"
    model = clean_text(sys_descr)[:96]
    return vendor, model


def firmware_from_descr(sys_descr: str) -> str:
    match = re.search(r"(version|ver|software)\s*[:=]?\s*([A-Za-z0-9_.()/-]+)", sys_descr, flags=re.IGNORECASE)
    return match.group(2)[:48] if match else ""


def should_replace_captured_identity(value: Any) -> bool:
    text = clean_text(value)
    return not text or text == "Generic" or bool(HEX_OCTET_TEXT_RE.fullmatch(text))


def run_snmp_capture(device: dict[str, Any]) -> dict[str, Any]:
    if device.get("accessMethod") != "SNMP":
        raise HTTPException(status_code=400, detail="Capture is available only for SNMP devices")
    if device.get("snmpVersion") == "V3":
        raise HTTPException(status_code=400, detail="SNMPv3 capture is not available in this first capture implementation")
    if normalize_upper(device.get("snmpTransport")) not in {"UDP", "UDP6"}:
        raise HTTPException(status_code=400, detail="SNMP capture currently supports UDP and UDP6 transports")
    candidates = snmp_community_candidates(device)
    if not candidates:
        raise HTTPException(status_code=400, detail="No SNMP communities are configured for capture")
    last_error = "No SNMP response"
    for community, source in candidates:
        try:
            client = SnmpClient(device, community)
            system_values = client.get(list(SYSTEM_OIDS.values()))
            system = {name: system_values.get(oid, "") for name, oid in SYSTEM_OIDS.items()}
            interfaces = collect_interfaces(client)
            pon_candidates = pon_candidates_from_interfaces(interfaces)
            vendor, model = guess_vendor_model(clean_text(system.get("sysDescr")), clean_text(system.get("sysObjectID")))
            system["vendor"] = vendor
            system["model"] = model
            system["firmwareVersion"] = firmware_from_descr(clean_text(system.get("sysDescr")))
            context_technology = infer_olt_context_pon_technology(system=system, device=device)
            for candidate in pon_candidates:
                if safe_pon_technology(candidate.get("technology")) == "OTHER" and context_technology:
                    candidate["technology"] = context_technology
            onu_candidates = onu_candidates_from_interfaces(interfaces, pon_candidates)
            onu_candidates = augment_vendor_onu_candidates(client, system, onu_candidates)
            return {
                "credentialSource": source,
                "system": system,
                "interfaces": interfaces,
                "ponCandidates": pon_candidates,
                "onuCandidates": onu_candidates,
            }
        except SnmpError as exc:
            last_error = str(exc)
    raise HTTPException(status_code=400, detail=f"SNMP capture failed. {last_error}")


def find_captured_olt(device: dict[str, Any]) -> dict[str, Any] | None:
    management_ip = clean_text(device.get("managementIp"))
    return next(
        (
            row
            for row in visible_olts()
            if row.get("sourceDeviceId") == device.get("id")
            or (management_ip and clean_text(row.get("managementIp")) == management_ip)
        ),
        None,
    )


def find_captured_onu(device: dict[str, Any], pon_id: str, candidate: dict[str, Any]) -> dict[str, Any] | None:
    source_if_index = candidate.get("ifIndex")
    serial_number = clean_text(candidate.get("serialNumber"))
    onu_id = clean_text(candidate.get("onuId"))
    return next(
        (
            row
            for row in visible_onus()
            if row.get("sourceDeviceId") == device.get("id")
            and row.get("ponPortId") == pon_id
            and (
                (source_if_index and row.get("sourceIfIndex") == source_if_index)
                or (serial_number and clean_text(row.get("serialNumber")) == serial_number)
                or (onu_id and clean_text(row.get("onuId")) == onu_id)
            )
        ),
        None,
    )


def reconcile_onu_candidates(
    device: dict[str, Any],
    olt: dict[str, Any],
    capture_data: dict[str, Any],
    timestamp: str,
    system_vendor: str,
    system_model: str,
) -> dict[str, int]:
    pon_by_number = {int(row.get("portNumber") or 0): row for row in pon_rows_for_olt(olt["id"])}
    created = 0
    updated = 0
    skipped = 0
    for candidate in capture_data.get("onuCandidates") or []:
        pon_number = int(candidate.get("ponPortNumber") or 0)
        pon = pon_by_number.get(pon_number)
        if pon is None:
            skipped += 1
            continue
        current = find_captured_onu(device, pon["id"], candidate)
        if current is None:
            current = {
                "id": str(uuid4()),
                "createdAt": timestamp,
                "updatedAt": timestamp,
                "deletedAt": None,
                "oltId": olt["id"],
                "ponPortId": pon["id"],
                "sourceDeviceId": device.get("id"),
            }
            onus.append(current)
            created += 1
        else:
            updated += 1
        current.update(
            {
                "updatedAt": timestamp,
                "oltId": olt["id"],
                "ponPortId": pon["id"],
                "sourceDeviceId": device.get("id"),
                "onuId": clean_text(candidate.get("onuId")),
                "serialNumber": clean_text(candidate.get("serialNumber")),
                "macAddress": clean_text(candidate.get("macAddress")),
                "name": clean_text(candidate.get("name")) or f"ONU {candidate.get('onuId') or candidate.get('ifIndex')}",
                "vendor": clean_text(candidate.get("vendor")) or system_vendor,
                "model": clean_text(candidate.get("model")) or system_model,
                "firmwareVersion": clean_text(candidate.get("firmwareVersion")),
                "status": ensure_choice(candidate.get("status"), ONU_STATUSES, "ONU status", "UNKNOWN"),
                "adminStatus": ensure_choice(candidate.get("adminStatus"), ADMIN_STATUSES, "admin status", "ENABLED"),
                "operationalStatus": ensure_choice(
                    candidate.get("operationalStatus"),
                    OPER_STATUS,
                    "operational status",
                    "UNKNOWN",
                ),
                "rxPowerDbm": clean_text(candidate.get("rxPowerDbm")),
                "txPowerDbm": clean_text(candidate.get("txPowerDbm")),
                "distanceMeters": clean_text(candidate.get("distanceMeters")),
                "temperatureC": clean_text(candidate.get("temperatureC")),
                "voltageV": clean_text(candidate.get("voltageV")),
                "biasCurrentMa": clean_text(candidate.get("biasCurrentMa")),
                "vlan": clean_text(candidate.get("vlan")),
                "servicePort": clean_text(candidate.get("servicePort")),
                "profile": clean_text(candidate.get("profile")),
                "lastDownReason": clean_text(candidate.get("lastDownReason")),
                "learnedClientMacAddress": clean_text(candidate.get("learnedClientMacAddress")),
                "description": clean_text(candidate.get("description")),
                "vendorDeviceIndex": clean_text(candidate.get("vendorDeviceIndex")),
                "sourceIfIndex": candidate.get("ifIndex"),
                "sourceIfName": clean_text(candidate.get("ifName")),
                "sourceIfDescr": clean_text(candidate.get("ifDescr")),
                "sourceIfAlias": clean_text(candidate.get("ifAlias")),
                "lastCapturedAt": timestamp,
                "notes": f"Captured from SNMP ifIndex {candidate.get('ifIndex')}.",
            }
        )
    return {"createdOnus": created, "updatedOnus": updated, "skippedOnus": skipped}


def captured_child_pon_rows(olt_id: str, source_device_id: str) -> list[dict[str, Any]]:
    rows = []
    for row in pon_rows_for_olt(olt_id):
        if clean_text(row.get("sourceDeviceId")) != clean_text(source_device_id):
            continue
        source_text = " ".join(
            clean_text(row.get(field))
            for field in ("sourceIfName", "sourceIfDescr", "sourceIfAlias", "label")
            if clean_text(row.get(field))
        )
        if is_pon_child_interface(source_text):
            rows.append(row)
    return rows


def retire_captured_child_pons(olt_id: str, source_device_id: str, timestamp: str) -> int:
    retired = 0
    for row in captured_child_pon_rows(olt_id, source_device_id):
        if nap_rows_for_pon(row["id"]) or onu_rows_for_pon(row["id"]):
            continue
        row["deletedAt"] = timestamp
        row["updatedAt"] = timestamp
        retired += 1
    return retired


def reconcile_olt_capture(device: dict[str, Any], capture_data: dict[str, Any], timestamp: str) -> dict[str, Any]:
    if device.get("deviceType") != "OLT":
        return {"scope": "DEVICE_ONLY", "oltCreated": False, "oltUpdated": False, "createdPons": 0, "updatedPons": 0}
    system = capture_data.get("system") or {}
    pon_candidates = capture_data.get("ponCandidates") or []
    sys_descr = clean_text(system.get("sysDescr"))
    sys_object_id = clean_text(system.get("sysObjectID"))
    sys_name = clean_text(system.get("sysName")) or clean_text(device.get("name"))
    sys_location = clean_text(system.get("sysLocation")) or clean_text(device.get("site"))
    vendor = clean_text(system.get("vendor"))
    model = clean_text(system.get("model"))
    if not vendor or not model:
        vendor, model = guess_vendor_model(sys_descr, sys_object_id)
    captured_pon_target = max(4, min(128, len(pon_candidates) or 4))
    olt = find_captured_olt(device)
    olt_created = False
    if olt is None:
        olt_created = True
        olt = {
            "id": str(uuid4()),
            "createdAt": timestamp,
            "updatedAt": timestamp,
            "deletedAt": None,
            "name": sys_name or clean_text(device.get("name")) or clean_text(device.get("managementIp")),
            "site": sys_location or "Main POP",
            "managementIp": clean_text(device.get("managementIp")),
            "vendor": vendor,
            "model": model,
            "firmwareVersion": firmware_from_descr(sys_descr),
            "status": "ACTIVE",
            "defaultPonCount": captured_pon_target,
            "notes": f"Auto-created from SNMP capture. sysObjectID: {sys_object_id}",
            "sourceDeviceId": device.get("id"),
            "sourceSysObjectID": sys_object_id,
            "sourceSysDescr": sys_descr,
            "lastCapturedAt": timestamp,
        }
        olts.append(olt)
    else:
        olt["updatedAt"] = timestamp
        olt["sourceDeviceId"] = device.get("id")
        olt["sourceSysObjectID"] = sys_object_id
        olt["sourceSysDescr"] = sys_descr
        olt["lastCapturedAt"] = timestamp
        if not clean_text(olt.get("managementIp")):
            olt["managementIp"] = clean_text(device.get("managementIp"))
        if should_replace_captured_identity(olt.get("vendor")):
            olt["vendor"] = vendor
        if should_replace_captured_identity(olt.get("model")):
            olt["model"] = model
        if not clean_text(olt.get("firmwareVersion")):
            olt["firmwareVersion"] = firmware_from_descr(sys_descr)
        if captured_child_pon_rows(olt["id"], clean_text(device.get("id"))):
            olt["defaultPonCount"] = captured_pon_target
        else:
            olt["defaultPonCount"] = max(int(olt.get("defaultPonCount") or 4), captured_pon_target)
    created_pons = ensure_pon_count(olt["id"], int(olt.get("defaultPonCount") or 4))
    context_technology = infer_olt_context_pon_technology(olt, device, system)
    updated_pons = 0
    for candidate in pon_candidates:
        port_number = int(candidate.get("portNumber") or next_pon_number(olt["id"]))
        pon = next((row for row in visible_pons() if row["oltId"] == olt["id"] and row["portNumber"] == port_number), None)
        technology = ensure_choice(
            context_technology if safe_pon_technology(candidate.get("technology")) == "OTHER" and context_technology else candidate.get("technology"),
            PON_TECHNOLOGIES,
            "PON technology",
            "GPON",
        )
        defaults = pon_technology_defaults(technology)
        if pon is None:
            pon = create_pon_record(olt["id"], port_number, timestamp, technology)
            created_pons.append(pon)
        pon.update(
            {
                "updatedAt": timestamp,
                "label": canonical_pon_label_from_number(port_number),
                "technology": technology,
                "adminStatus": ensure_choice(candidate.get("adminStatus"), ADMIN_STATUSES, "admin status", "ENABLED"),
                "operationalStatus": ensure_choice(
                    candidate.get("operationalStatus"),
                    OPER_STATUS,
                    "operational status",
                    "UNKNOWN",
                ),
                "splitRatio": defaults["splitRatio"],
                "capacity": defaults["capacity"],
                "sourceDeviceId": device.get("id"),
                "sourceLabel": clean_text(candidate.get("label")),
                "sourceIfIndex": candidate.get("ifIndex"),
                "sourceIfName": clean_text(candidate.get("ifName")),
                "sourceIfDescr": clean_text(candidate.get("ifDescr")),
                "sourceIfAlias": clean_text(candidate.get("ifAlias")),
                "notes": f"Captured from SNMP ifIndex {candidate.get('ifIndex')}.",
            }
        )
        updated_pons += 1
    retired_pons = retire_captured_child_pons(olt["id"], clean_text(device.get("id")), timestamp)
    onu_reconciliation = reconcile_onu_candidates(device, olt, capture_data, timestamp, vendor, model)
    return {
        "scope": "OLT_PON",
        "oltCreated": olt_created,
        "oltUpdated": not olt_created,
        "oltId": olt["id"],
        "oltName": olt["name"],
        "createdPons": len({row["id"] for row in created_pons}),
        "updatedPons": updated_pons,
        "retiredPons": retired_pons,
        "ponCandidates": len(pon_candidates),
        "onuCandidates": len(capture_data.get("onuCandidates") or []),
        **onu_reconciliation,
    }


def capture_summary(capture: dict[str, Any], include_details: bool = False) -> dict[str, Any]:
    summary = {
        "id": capture["id"],
        "deviceId": capture["deviceId"],
        "status": capture["status"],
        "capturedAt": capture["capturedAt"],
        "message": capture.get("message", ""),
        "interfaceCount": int(capture.get("interfaceCount") or len(capture.get("interfaces") or [])),
        "ponCandidateCount": int(capture.get("ponCandidateCount") or len(capture.get("ponCandidates") or [])),
        "onuCandidateCount": int(capture.get("onuCandidateCount") or len(capture.get("onuCandidates") or [])),
        "system": capture.get("system") or {},
        "ponCandidates": capture.get("ponCandidates") or [],
        "onuCandidates": capture.get("onuCandidates") or [],
        "reconciliation": capture.get("reconciliation") or {},
        "detailsPruned": bool(capture.get("detailsPruned")),
    }
    if include_details:
        summary["interfaces"] = capture.get("interfaces") or []
    return summary


def latest_capture_summary(device_id: str) -> dict[str, Any] | None:
    latest = next(
        (row for row in sorted(device_captures, key=lambda item: item["capturedAt"], reverse=True) if row["deviceId"] == device_id),
        None,
    )
    return capture_summary(latest) if latest else None


def parse_iso_datetime(value: Any) -> datetime | None:
    text = clean_text(value)
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def update_poller_state(**values: Any) -> None:
    with _poller_lock:
        _poller_state.update(values)


def get_network_settings_poller_state() -> dict[str, Any]:
    with _poller_lock:
        state = dict(_poller_state)
        state["running"] = bool(_poller_thread and _poller_thread.is_alive())
        state["pollLoopSeconds"] = max(1, NETWORK_SETTINGS_POLL_LOOP_SECONDS)
        state["defaultPollIntervalSeconds"] = DEFAULT_DEVICE_POLL_INTERVAL_SECONDS
        return state


def is_pollable_device(device: dict[str, Any]) -> bool:
    return (
        device.get("accessMethod") == "SNMP"
        and not device.get("deletedAt")
        and device.get("status") not in {"OFFLINE", "ARCHIVED"}
    )


def is_device_poll_due(device: dict[str, Any], current_time: datetime) -> bool:
    interval = max(30, int(device.get("pollIntervalSeconds") or DEFAULT_DEVICE_POLL_INTERVAL_SECONDS))
    last_capture = parse_iso_datetime(device.get("lastCapturedAt"))
    return not last_capture or (current_time - last_capture).total_seconds() >= interval


def perform_device_capture(
    device: dict[str, Any],
    *,
    actor: str = "system",
    include_details: bool = True,
    raise_on_failure: bool = True,
) -> dict[str, Any]:
    timestamp = now_iso()
    with _capture_lock:
        try:
            capture_data = run_snmp_capture(device)
            reconciliation = reconcile_olt_capture(device, capture_data, timestamp)
            capture = {
                "id": str(uuid4()),
                "deviceId": device["id"],
                "status": "SUCCESS",
                "capturedAt": timestamp,
                "message": "SNMP capture completed.",
                "system": capture_data.get("system") or {},
                "interfaces": capture_data.get("interfaces") or [],
                "ponCandidates": capture_data.get("ponCandidates") or [],
                "onuCandidates": capture_data.get("onuCandidates") or [],
                "reconciliation": reconciliation,
            }
            system = capture["system"]
            device["updatedAt"] = timestamp
            device["lastCapturedAt"] = timestamp
            device["lastCaptureStatus"] = "SUCCESS"
            device["lastCaptureMessage"] = capture["message"]
            if clean_text(system.get("vendor")):
                device["vendor"] = clean_text(system.get("vendor"))
            if clean_text(system.get("model")):
                device["model"] = clean_text(system.get("model"))
            if clean_text(system.get("firmwareVersion")):
                device["firmwareVersion"] = clean_text(system.get("firmwareVersion"))
            device_captures.append(compact_capture_for_storage(capture))
            normalize_capture_history()
            add_audit(
                "network_device_captured",
                "NetworkDevice",
                device["id"],
                {
                    "name": device["name"],
                    "interfaces": len(capture["interfaces"]),
                    "ponCandidates": len(capture["ponCandidates"]),
                    "onuCandidates": len(capture["onuCandidates"]),
                    "reconciliation": reconciliation,
                },
                actor,
            )
            save_network_settings_data()
            return capture_summary(capture, include_details=include_details)
        except HTTPException as exc:
            capture = {
                "id": str(uuid4()),
                "deviceId": device["id"],
                "status": "FAILED",
                "capturedAt": timestamp,
                "message": str(exc.detail),
                "system": {},
                "interfaces": [],
                "ponCandidates": [],
                "onuCandidates": [],
                "reconciliation": {},
            }
            device["updatedAt"] = timestamp
            device["lastCapturedAt"] = timestamp
            device["lastCaptureStatus"] = "FAILED"
            device["lastCaptureMessage"] = str(exc.detail)
            device_captures.append(compact_capture_for_storage(capture))
            normalize_capture_history()
            add_audit(
                "network_device_capture_failed",
                "NetworkDevice",
                device["id"],
                {"name": device["name"], "error": str(exc.detail)},
                actor,
            )
            save_network_settings_data()
            if raise_on_failure:
                raise
            return capture_summary(capture, include_details=include_details)


def poll_due_network_devices() -> dict[str, Any]:
    seed_network_settings_data()
    current_time = datetime.now(timezone.utc)
    due_devices = [device for device in visible_devices() if is_pollable_device(device) and is_device_poll_due(device, current_time)]
    started_at = now_iso()
    update_poller_state(
        lastRunStartedAt=started_at,
        lastRunDeviceCount=len(due_devices),
        lastRunSuccessCount=0,
        lastRunFailureCount=0,
        lastError="",
    )
    success_count = 0
    failure_count = 0
    errors: list[str] = []
    for device in due_devices:
        try:
            summary = perform_device_capture(device, actor="system:network-settings-poller", include_details=False, raise_on_failure=False)
            if summary.get("status") == "SUCCESS":
                success_count += 1
            else:
                failure_count += 1
                errors.append(f"{device.get('name')}: {summary.get('message')}")
        except Exception as exc:  # Keep the scheduler alive even if one device has an unexpected failure.
            failure_count += 1
            errors.append(f"{device.get('name')}: {exc}")
    finished_at = now_iso()
    result = {
        "startedAt": started_at,
        "finishedAt": finished_at,
        "deviceCount": len(due_devices),
        "successCount": success_count,
        "failureCount": failure_count,
        "errors": errors[:5],
    }
    update_poller_state(
        lastRunFinishedAt=finished_at,
        lastRunDeviceCount=len(due_devices),
        lastRunSuccessCount=success_count,
        lastRunFailureCount=failure_count,
        lastError="; ".join(errors[:3]),
    )
    return result


def network_settings_poller_loop() -> None:
    update_poller_state(running=True, startedAt=now_iso(), lastError="")
    while not _poller_stop_event.is_set():
        update_poller_state(lastWakeAt=now_iso())
        try:
            poll_due_network_devices()
        except Exception as exc:
            update_poller_state(lastError=str(exc), lastRunFinishedAt=now_iso())
        _poller_stop_event.wait(max(1, NETWORK_SETTINGS_POLL_LOOP_SECONDS))
    update_poller_state(running=False)


def start_network_settings_poller() -> dict[str, Any]:
    global _poller_thread
    with _poller_lock:
        if not (_poller_thread and _poller_thread.is_alive()):
            _poller_stop_event.clear()
            _poller_thread = threading.Thread(target=network_settings_poller_loop, name="network-settings-poller", daemon=True)
            _poller_thread.start()
    return get_network_settings_poller_state()


def stop_network_settings_poller() -> dict[str, Any]:
    _poller_stop_event.set()
    thread = _poller_thread
    if thread and thread.is_alive():
        thread.join(timeout=5)
    update_poller_state(running=False)
    return get_network_settings_poller_state()


def next_pon_number(olt_id: str) -> int:
    used = {row["portNumber"] for row in pon_rows_for_olt(olt_id)}
    number = 1
    while number in used:
        number += 1
    return number


def next_fbt_number(nap_box_id: str) -> int:
    used = {row["portNumber"] for row in fbt_rows_for_nap(nap_box_id)}
    number = 1
    while number in used:
        number += 1
    return number


def create_pon_record(olt_id: str, port_number: int, timestamp: str, technology: str = "GPON") -> dict[str, Any]:
    normalized_technology = ensure_choice(technology, PON_TECHNOLOGIES, "PON technology", "GPON")
    defaults = pon_technology_defaults(normalized_technology)
    record = {
        "id": str(uuid4()),
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
        "oltId": olt_id,
        "portNumber": port_number,
        "label": canonical_pon_label_from_number(port_number),
        "technology": normalized_technology,
        "adminStatus": "ENABLED",
        "operationalStatus": "UNKNOWN",
        "splitRatio": defaults["splitRatio"],
        "serviceVlan": "",
        "capacity": defaults["capacity"],
        "moduleVendor": "",
        "modulePartNumber": "",
        "moduleSerial": "",
        "moduleHardwareRev": "",
        "moduleRxPowerDbm": "",
        "moduleTxPowerDbm": "",
        "moduleTemperatureC": "",
        "moduleVoltageV": "",
        "moduleBiasCurrentMa": "",
        "moduleEntityIndex": "",
        "moduleSource": "",
        "moduleLastCapturedAt": "",
        "notes": "Default PON generated from OLT configuration.",
    }
    pon_ports.append(record)
    return record


def ensure_pon_count(olt_id: str, target_count: int) -> list[dict[str, Any]]:
    timestamp = now_iso()
    created: list[dict[str, Any]] = []
    for port_number in range(1, int(target_count or 4) + 1):
        if not any(row["oltId"] == olt_id and row["portNumber"] == port_number for row in visible_pons()):
            created.append(create_pon_record(olt_id, port_number, timestamp))
    return created


def olt_summary(olt: dict[str, Any]) -> dict[str, Any]:
    pons = pon_rows_for_olt(olt["id"])
    naps = [nap for pon in pons for nap in nap_rows_for_pon(pon["id"])]
    onu_count = sum(len(onu_rows_for_pon(pon["id"])) for pon in pons)
    fbt_count = sum(len(fbt_rows_for_nap(nap["id"])) for nap in naps)
    return {
        **olt,
        "ponCount": len(pons),
        "onuCount": onu_count,
        "napCount": len(naps),
        "fbtCount": fbt_count,
        "ponTargetDelta": len(pons) - int(olt.get("defaultPonCount") or 4),
    }


def pon_summary(pon: dict[str, Any]) -> dict[str, Any]:
    olt = find_olt(pon["oltId"])
    naps = nap_rows_for_pon(pon["id"])
    pon_onus = onu_rows_for_pon(pon["id"])
    fbt_count = sum(len(fbt_rows_for_nap(nap["id"])) for nap in naps)
    display_label = canonical_pon_label(pon)
    return {
        **pon,
        "label": display_label,
        "sourceLabel": clean_text(pon.get("sourceLabel")) or clean_text(pon.get("label")),
        "ponLabel": display_label,
        "oltName": olt["name"],
        "oltVendor": clean_text(olt.get("vendor")),
        "napCount": len(naps),
        "onuCount": len(pon_onus),
        "onlineOnuCount": sum(1 for onu in pon_onus if onu.get("status") == "ONLINE"),
        "offlineOnuCount": sum(1 for onu in pon_onus if onu.get("status") in {"OFFLINE", "LOS", "DYING_GASP"}),
        "fbtCount": fbt_count,
        "availableCapacity": max(0, int(pon.get("capacity") or 0) - len(naps)),
    }


def nap_summary(nap: dict[str, Any]) -> dict[str, Any]:
    pon = find_pon(nap["ponPortId"])
    olt = find_olt(pon["oltId"])
    nap_fbts = fbt_rows_for_nap(nap["id"])
    pon_label = canonical_pon_label(pon)
    return {
        **nap,
        "ponLabel": pon_label,
        "oltId": olt["id"],
        "oltName": olt["name"],
        "oltVendor": clean_text(olt.get("vendor")),
        "fbtCount": len(nap_fbts),
        "availableFbtSlots": max(0, int(nap.get("portCapacity") or 0) - len(nap_fbts)),
    }


def fbt_summary(fbt: dict[str, Any]) -> dict[str, Any]:
    nap = find_nap(fbt["napBoxId"])
    pon = find_pon(nap["ponPortId"])
    olt = find_olt(pon["oltId"])
    pon_label = canonical_pon_label(pon)
    return {
        **fbt,
        "napName": nap["name"],
        "ponPortId": pon["id"],
        "ponLabel": pon_label,
        "oltId": olt["id"],
        "oltName": olt["name"],
        "oltVendor": clean_text(olt.get("vendor")),
    }


def onu_summary(onu: dict[str, Any]) -> dict[str, Any]:
    pon = find_pon(onu["ponPortId"])
    olt = find_olt(onu["oltId"])
    device = next((row for row in visible_devices() if row["id"] == onu.get("sourceDeviceId")), {})
    poll_interval = int(device.get("pollIntervalSeconds") or DEFAULT_DEVICE_POLL_INTERVAL_SECONDS)
    detail_defaults = {
        "macAddress": "",
        "temperatureC": "",
        "voltageV": "",
        "biasCurrentMa": "",
        "vlan": "",
        "servicePort": "",
        "lastDownReason": "",
        "profile": "",
        "description": "",
        "vendorDeviceIndex": "",
    }
    return {
        **detail_defaults,
        **onu,
        "oltName": olt["name"],
        "oltVendor": clean_text(olt.get("vendor")),
        "ponLabel": canonical_pon_label(pon),
        "ponPortNumber": pon["portNumber"],
        "sourceDeviceName": device.get("name", ""),
        "sourceDeviceVendor": device.get("vendor", ""),
        "pollIntervalSeconds": poll_interval,
        "pollIntervalLabel": format_seconds(poll_interval),
    }


def device_summary(device: dict[str, Any]) -> dict[str, Any]:
    sanitized = {key: value for key, value in device.items() if key not in SECRET_DEVICE_FIELDS}
    poll_interval = int(device.get("pollIntervalSeconds") or DEFAULT_DEVICE_POLL_INTERVAL_SECONDS)
    raw_bound_locations = device.get("boundLocations") if isinstance(device.get("boundLocations"), list) else []
    raw_bound_location_ids = device.get("boundLocationIds") if isinstance(device.get("boundLocationIds"), list) else []
    bound_locations = [
        normalize_location_binding_snapshot(row)
        for row in raw_bound_locations
        if isinstance(row, dict)
    ]
    bound_location_ids = clean_unique_texts(
        raw_bound_location_ids + [location["id"] for location in bound_locations if location.get("id")]
    )
    linked_olt = find_captured_olt(device) if is_olt_snmp_device(device) else None
    raw_olt_location = device.get("oltLocation") if isinstance(device.get("oltLocation"), dict) else {}
    olt_location = normalize_location_binding_snapshot(raw_olt_location) if raw_olt_location else {}
    olt_latitude = clean_text(linked_olt.get("latitude") if linked_olt else "") or clean_text(device.get("latitude")) or clean_text(olt_location.get("latitude"))
    olt_longitude = clean_text(linked_olt.get("longitude") if linked_olt else "") or clean_text(device.get("longitude")) or clean_text(olt_location.get("longitude"))
    olt_location_id = clean_text(linked_olt.get("locationId") if linked_olt else "") or clean_text(device.get("oltLocationId")) or clean_text(olt_location.get("id"))
    olt_location_name = clean_text(linked_olt.get("locationName") if linked_olt else "") or clean_text(device.get("oltLocationName")) or clean_text(olt_location.get("label"))
    if device["accessMethod"] == "SNMP" and device["deviceType"] == "OLT":
        discovery_status = "READY_FOR_OLT_SNMP_AUTODETECT"
    elif device["accessMethod"] == "SNMP":
        discovery_status = "READY_FOR_SNMP_POLLING"
    else:
        discovery_status = "READY_FOR_API_INTEGRATION"
    return {
        **sanitized,
        "hasApiPassword": bool(device.get("apiPassword")),
        "hasSnmpCommunity": bool(device.get("snmpCommunity")),
        "usesConfiguredSnmpCommunities": device.get("accessMethod") == "SNMP"
        and device.get("snmpVersion") in {"V1", "V2C"}
        and not device.get("snmpCommunity"),
        "hasSnmpAuthPassword": bool(device.get("snmpAuthPassword")),
        "hasSnmpPrivacyPassword": bool(device.get("snmpPrivacyPassword")),
        "connectionLabel": f"{device['managementIp']}:{device['apiPort'] if device['accessMethod'] == 'API' else device['snmpPort']}",
        "discoveryStatus": discovery_status,
        "autodetectScope": "OLT_PON_NAP_READY" if discovery_status == "READY_FOR_OLT_SNMP_AUTODETECT" else "DEVICE_MONITORING_READY",
        "pollIntervalSeconds": poll_interval,
        "pollIntervalLabel": format_seconds(poll_interval),
        "lastPolledAt": device.get("lastCapturedAt"),
        "lastCapture": latest_capture_summary(device["id"]),
        "boundLocationIds": bound_location_ids,
        "boundLocations": bound_locations,
        "locationBindingCount": len(bound_location_ids or bound_locations),
        "linkedOltId": linked_olt.get("id") if linked_olt else "",
        "latitude": olt_latitude,
        "longitude": olt_longitude,
        "oltLocationId": olt_location_id,
        "oltLocationName": olt_location_name,
        "oltLocation": olt_location,
        "hasOltMapLocation": bool(olt_latitude and olt_longitude),
    }


def is_mikrotik_api_device(device: dict[str, Any]) -> bool:
    return (
        device.get("accessMethod") == "API"
        and device.get("deviceType") == "MIKROTIK"
        and clean_text(device.get("apiProtocol") or "MIKROTIK_API") == "MIKROTIK_API"
    )


def is_olt_snmp_device(device: dict[str, Any]) -> bool:
    return (
        device.get("accessMethod") == "SNMP"
        and device.get("deviceType") == "OLT"
    )


def is_pppoe_service(value: Any) -> bool:
    service = clean_text(value).lower()
    return service in {"", "any", "pppoe"}


def normalize_routeros_id(value: Any) -> str:
    return clean_text(value).lstrip("*")


def pppoe_status(disabled: bool, active: bool) -> str:
    if disabled:
        return "DISABLED"
    if active:
        return "ONLINE"
    return "OFFLINE"


def pppoe_account_row(device: dict[str, Any], secret: dict[str, str] | None, active: dict[str, str] | None) -> dict[str, Any]:
    secret = secret or {}
    active = active or {}
    username = clean_text(secret.get("name") or active.get("name"))
    disabled = normalize_bool(secret.get("disabled"))
    caller_id = clean_text(active.get("caller-id") or secret.get("caller-id") or secret.get("last-caller-id"))
    remote_address = clean_text(secret.get("remote-address") or active.get("address"))
    active_address = clean_text(active.get("address"))
    active_flag = bool(active)
    status = pppoe_status(disabled, active_flag)
    service = clean_text(secret.get("service") or active.get("service") or "pppoe")
    router_label = f"{device.get('managementIp')}:{device.get('apiPort') or 8728}"
    return {
        "id": f"{device['id']}:{normalize_routeros_id(secret.get('.id') or active.get('.id')) or username}",
        "routerId": device["id"],
        "routerName": device["name"],
        "routerEndpoint": router_label,
        "username": username,
        "service": service,
        "profile": clean_text(secret.get("profile") or active.get("profile")),
        "status": status,
        "disabled": disabled,
        "active": active_flag,
        "callerId": caller_id,
        "macAddress": caller_id if ONU_MAC_RE.search(caller_id) else "",
        "localAddress": clean_text(secret.get("local-address")),
        "remoteAddress": remote_address,
        "activeAddress": active_address,
        "uptime": clean_text(active.get("uptime")),
        "encoding": clean_text(active.get("encoding")),
        "activeInterface": clean_text(active.get("interface")),
        "sessionId": clean_text(active.get("session-id")),
        "radius": normalize_bool(active.get("radius")),
        "comment": clean_text(secret.get("comment")),
        "lastCallerId": clean_text(secret.get("last-caller-id")),
        "lastLoggedOut": clean_text(secret.get("last-logged-out")),
        "lastDisconnectReason": clean_text(secret.get("last-disconnect-reason")),
        "source": "secret+active" if secret and active else "secret" if secret else "active",
    }


def fetch_mikrotik_pppoe_accounts(device: dict[str, Any]) -> list[dict[str, Any]]:
    host, port, username, password = routeros_device_connection(device)
    secret_fields = (
        ".id,name,service,profile,caller-id,remote-address,local-address,disabled,"
        "comment,last-logged-out,last-caller-id,last-disconnect-reason"
    )
    active_fields = ".id,name,service,caller-id,address,uptime,encoding,session-id,interface,profile,radius"
    with routeros_open_session(host, port, username, password) as sock:
        secrets = routeros_run_command_on_socket(sock, "/ppp/secret/print", [f"=.proplist={secret_fields}"])
        active_rows = routeros_run_command_on_socket(sock, "/ppp/active/print", [f"=.proplist={active_fields}"])
    active_by_name = {
        clean_text(row.get("name")): row
        for row in active_rows
        if clean_text(row.get("name")) and is_pppoe_service(row.get("service"))
    }
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for secret in secrets:
        if not is_pppoe_service(secret.get("service")):
            continue
        account = pppoe_account_row(device, secret, active_by_name.get(clean_text(secret.get("name"))))
        if not account["username"]:
            continue
        rows.append(account)
        seen.add(account["username"])
    for active in active_rows:
        active_name = clean_text(active.get("name"))
        if not active_name or active_name in seen or not is_pppoe_service(active.get("service")):
            continue
        rows.append(pppoe_account_row(device, None, active))
    return rows


def pppoe_kpis(rows: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "total": len(rows),
        "online": sum(1 for row in rows if row["status"] == "ONLINE"),
        "offline": sum(1 for row in rows if row["status"] == "OFFLINE"),
        "disabled": sum(1 for row in rows if row["status"] == "DISABLED"),
        "routers": len({row["routerId"] for row in rows}),
        "profiles": len({row["profile"] for row in rows if row.get("profile")}),
        "withCallerId": sum(1 for row in rows if row.get("callerId")),
        "withAssignedAddress": sum(1 for row in rows if row.get("activeAddress") or row.get("remoteAddress")),
    }


def network_settings_metrics() -> dict[str, int]:
    seed_network_settings_data()
    return {
        "olts": len(visible_olts()),
        "pon_ports": len(visible_pons()),
        "nap_boxes": len(visible_naps()),
        "fbts": len(visible_fbts()),
        "onus": len(visible_onus()),
        "devices": len(visible_devices()),
        "active_olts": sum(1 for row in visible_olts() if row["status"] == "ACTIVE"),
        "active_naps": sum(1 for row in visible_naps() if row["status"] == "ACTIVE"),
        "online_onus": sum(1 for row in visible_onus() if row.get("status") == "ONLINE"),
        "offline_onus": sum(1 for row in visible_onus() if row.get("status") in {"OFFLINE", "LOS", "DYING_GASP"}),
        "active_devices": sum(1 for row in visible_devices() if row["status"] == "ACTIVE"),
    }


def seed_network_settings_data() -> None:
    load_network_settings_data()
    return


@router.get("/health")
def network_settings_health() -> dict[str, str]:
    return {"status": "ok", "module": "network-settings"}


@router.get("/meta")
def network_settings_meta(admin=Depends(require_admin)) -> dict[str, Any]:
    return {
        "slug": "network-settings",
        "name": "Network Settings",
        "status": "functional-shell",
        "route": "/network-settings",
        "apiPrefix": "/api/network-settings",
        "subNav": SUB_NAV,
        "oltStatuses": OLT_STATUSES,
        "ponTechnologies": PON_TECHNOLOGIES,
        "adminStatuses": ADMIN_STATUSES,
        "operationalStatuses": OPER_STATUS,
        "napStatuses": NAP_STATUSES,
        "napSplitterRatios": NAP_SPLITTER_RATIOS,
        "fbtStatuses": FBT_STATUSES,
        "onuStatuses": ONU_STATUSES,
        "deviceTypes": DEVICE_TYPES,
        "deviceAccessMethods": DEVICE_ACCESS_METHODS,
        "deviceStatuses": DEVICE_STATUSES,
        "apiProtocols": API_PROTOCOLS,
        "pppoeAccountStatuses": PPPOE_ACCOUNT_STATUSES,
        "snmpVersions": SNMP_VERSIONS,
        "snmpTransports": SNMP_TRANSPORTS,
        "portAssociationModes": PORT_ASSOCIATION_MODES,
        "snmpAuthLevels": SNMP_AUTH_LEVELS,
        "snmpAuthProtocols": SNMP_AUTH_PROTOCOLS,
        "snmpPrivacyProtocols": SNMP_PRIVACY_PROTOCOLS,
        "defaultPollIntervalSeconds": DEFAULT_DEVICE_POLL_INTERVAL_SECONDS,
        "poller": get_network_settings_poller_state(),
        "onuTableRefreshSeconds": ONU_TABLE_REFRESH_SECONDS,
    }


@router.get("/plan")
def network_settings_plan(admin=Depends(require_admin)) -> dict[str, Any]:
    return {
        "purpose": "ISP network source-of-truth for OLTs, generated PON ports, NAP boxes, and FBT assignments.",
        "implementedNow": [
            "Network Settings app-shell navigation.",
            "OLT CRUD with default PON generation.",
            "PON CRUD under an OLT with delete safeguards.",
            "NAP CRUD assigned to a PON.",
            "FBT CRUD assigned to a NAP box.",
            "Device CRUD for MikroTik and OLT endpoints split by API and SNMP readiness.",
            "Live MikroTik PPPoE account discovery from RouterOS API secrets and active sessions.",
            "Background SNMP polling for due devices using each device poll interval.",
            "Captured ONU inventory table populated from OLT SNMP capture where the OLT exposes subscriber interfaces.",
        ],
        "nextMilestones": [
            "PPPoE-to-ONU mapping and MikroTik provisioning actions.",
            "Vendor-specific OLT/ONU MIB mappings for optical power, MAC, and profile data.",
            "Ticketing installation completion contract.",
            "Service Account network attachment.",
            "Shared PostgreSQL persistence.",
        ],
    }


@router.get("/overview")
def network_settings_overview(admin=Depends(require_admin)) -> dict[str, Any]:
    seed_network_settings_data()
    return {
        "metrics": network_settings_metrics(),
        "olts": [olt_summary(row) for row in sorted(visible_olts(), key=lambda item: item["updatedAt"], reverse=True)[:6]],
        "devices": [device_summary(row) for row in sorted(visible_devices(), key=lambda item: item["updatedAt"], reverse=True)[:6]],
        "recentNaps": [nap_summary(row) for row in sorted(visible_naps(), key=lambda item: item["updatedAt"], reverse=True)[:6]],
        "recentFbts": [fbt_summary(row) for row in sorted(visible_fbts(), key=lambda item: item["updatedAt"], reverse=True)[:6]],
    }


@router.get("/onus")
def list_onus(search: str = "", oltId: str = "", ponPortId: str = "", status: str = "", admin=Depends(require_admin)):
    seed_network_settings_data()
    normalized_status = normalize_upper(status)
    if normalized_status and normalized_status not in ONU_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid ONU status")
    rows = [
        onu_summary(row)
        for row in visible_onus()
        if (not oltId or row["oltId"] == oltId)
        and (not ponPortId or row["ponPortId"] == ponPortId)
        and (not normalized_status or row.get("status") == normalized_status)
        and matches_search({**row, **onu_summary(row)}, search)
    ]
    return sorted(rows, key=lambda item: (item["oltName"], item["ponPortNumber"], clean_text(item.get("onuId"))))


@router.get("/pppoe-accounts")
def list_pppoe_accounts(
    deviceId: str = "",
    search: str = "",
    status: str = "",
    profile: str = "",
    admin=Depends(require_admin),
):
    seed_network_settings_data()
    normalized_status = normalize_upper(status)
    if normalized_status and normalized_status not in PPPOE_ACCOUNT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid PPPoE account status")
    requested_device = find_device(deviceId) if clean_text(deviceId) else None
    if requested_device and not is_mikrotik_api_device(requested_device):
        raise HTTPException(status_code=400, detail="PPPoE discovery requires a MikroTik API device")
    devices = [requested_device] if requested_device else [device for device in visible_devices() if is_mikrotik_api_device(device)]
    rows: list[dict[str, Any]] = []
    device_errors: list[dict[str, str]] = []
    captured_at = now_iso()
    for device in devices:
        try:
            rows.extend(fetch_mikrotik_pppoe_accounts(device))
        except (OSError, RouterOsApiError) as exc:
            device_errors.append(
                {
                    "deviceId": device["id"],
                    "deviceName": device["name"],
                    "endpoint": f"{device.get('managementIp')}:{device.get('apiPort') or 8728}",
                    "message": clean_text(exc) or "Unable to read PPPoE accounts",
                }
            )
    profile_filter = clean_text(profile).lower()
    rows = [
        row
        for row in rows
        if (not normalized_status or row["status"] == normalized_status)
        and (not profile_filter or clean_text(row.get("profile")).lower() == profile_filter)
        and matches_search(row, search)
    ]
    rows = sorted(rows, key=lambda item: (item["routerName"], item["username"]))
    return {
        "capturedAt": captured_at,
        "accounts": rows,
        "kpis": pppoe_kpis(rows),
        "routers": [device_summary(device) for device in devices],
        "profiles": sorted({row["profile"] for row in rows if row.get("profile")}),
        "deviceErrors": device_errors,
        "source": "routeros-api",
    }


@router.get("/devices")
def list_network_devices(accessMethod: str = "", search: str = "", admin=Depends(require_admin)):
    seed_network_settings_data()
    method = normalize_upper(accessMethod)
    if method and method not in DEVICE_ACCESS_METHODS:
        raise HTTPException(status_code=400, detail="Invalid device access method")
    rows = [
        device_summary(row)
        for row in visible_devices()
        if (not method or row["accessMethod"] == method) and matches_search(device_summary(row), search)
    ]
    return sorted(rows, key=lambda item: (item["accessMethod"], item["deviceType"], item["name"]))


@router.post("/devices")
def create_network_device(payload: DevicePayload, admin=Depends(require_admin)):
    seed_network_settings_data()
    record = normalize_device_payload(payload)
    test_mikrotik_api_reachability(record)
    timestamp = now_iso()
    device = {"id": str(uuid4()), "createdAt": timestamp, "updatedAt": timestamp, "deletedAt": None, **record}
    network_devices.append(device)
    add_audit(
        "network_device_created",
        "NetworkDevice",
        device["id"],
        {"name": device["name"], "deviceType": device["deviceType"], "accessMethod": device["accessMethod"]},
        actor_name(admin),
    )
    save_network_settings_data()
    return device_summary(device)


@router.patch("/devices/{device_id}")
def update_network_device(device_id: str, payload: DevicePayload, admin=Depends(require_admin)):
    seed_network_settings_data()
    current = find_device(device_id)
    record = normalize_device_payload(payload, current)
    test_mikrotik_api_reachability(record)
    current.update(record)
    current["updatedAt"] = now_iso()
    add_audit(
        "network_device_updated",
        "NetworkDevice",
        current["id"],
        {"name": current["name"], "deviceType": current["deviceType"], "accessMethod": current["accessMethod"]},
        actor_name(admin),
    )
    save_network_settings_data()
    return device_summary(current)


@router.patch("/devices/{device_id}/location-bindings")
def update_device_location_bindings(device_id: str, payload: DeviceLocationBindingPayload, admin=Depends(require_admin)):
    seed_network_settings_data()
    current = find_device(device_id)
    if not is_mikrotik_api_device(current):
        raise HTTPException(status_code=400, detail="Location bindings are only available for MikroTik API routers")
    bindings = normalize_location_bindings(payload)
    current.update(bindings)
    current["updatedAt"] = now_iso()
    add_audit(
        "network_router_locations_bound",
        "NetworkDevice",
        current["id"],
        {"name": current["name"], "locationCount": len(bindings["boundLocationIds"])},
        actor_name(admin),
    )
    save_network_settings_data()
    return device_summary(current)


@router.patch("/devices/{device_id}/olt-location")
def update_device_olt_location(device_id: str, payload: DeviceOltLocationPayload, admin=Depends(require_admin)):
    seed_network_settings_data()
    current = find_device(device_id)
    if not is_olt_snmp_device(current):
        raise HTTPException(status_code=400, detail="OLT map location is only available for SNMP OLT devices")
    location_snapshot = normalize_location_binding_snapshot(payload.location or {})
    location_id = clean_text(payload.locationId) or clean_text(location_snapshot.get("id"))
    label = (
        clean_text(payload.label)
        or clean_text(location_snapshot.get("label"))
        or clean_text(location_snapshot.get("location_name"))
        or clean_text(current.get("site"))
        or "Main POP"
    )
    latitude = clean_coordinate(payload.latitude or location_snapshot.get("latitude"), "Latitude", -90, 90)
    longitude = clean_coordinate(payload.longitude or location_snapshot.get("longitude"), "Longitude", -180, 180)
    if not latitude or not longitude:
        raise HTTPException(status_code=400, detail="Latitude and longitude are required for OLT map location")
    if location_snapshot:
        location_snapshot["id"] = location_id or location_snapshot.get("id")
        location_snapshot["label"] = label
        location_snapshot["latitude"] = latitude
        location_snapshot["longitude"] = longitude
    timestamp = now_iso()
    current["oltLocationId"] = location_id
    current["oltLocationName"] = label
    current["oltLocation"] = location_snapshot
    current["latitude"] = latitude
    current["longitude"] = longitude
    current["site"] = label
    current["updatedAt"] = timestamp
    olt = find_captured_olt(current)
    created_pons: list[dict[str, Any]] = []
    if olt is None:
        olt = {
            "id": str(uuid4()),
            "createdAt": timestamp,
            "updatedAt": timestamp,
            "deletedAt": None,
            "name": clean_text(current.get("name")) or clean_text(current.get("managementIp")),
            "site": label,
            "managementIp": clean_text(current.get("managementIp")),
            "vendor": clean_text(current.get("vendor")) or "Generic",
            "model": clean_text(current.get("model")),
            "firmwareVersion": "",
            "latitude": latitude,
            "longitude": longitude,
            "locationId": location_id,
            "locationName": label,
            "status": "ACTIVE",
            "defaultPonCount": 4,
            "notes": "Created from SNMP OLT map location binding.",
            "sourceDeviceId": current.get("id"),
            "lastCapturedAt": current.get("lastCapturedAt") or "",
        }
        olts.append(olt)
        created_pons = ensure_pon_count(olt["id"], int(olt.get("defaultPonCount") or 4))
    else:
        olt.update(
            {
                "updatedAt": timestamp,
                "site": label,
                "managementIp": clean_text(olt.get("managementIp")) or clean_text(current.get("managementIp")),
                "latitude": latitude,
                "longitude": longitude,
                "locationId": location_id,
                "locationName": label,
                "sourceDeviceId": current.get("id"),
            }
        )
    add_audit(
        "network_olt_location_bound",
        "NetworkDevice",
        current["id"],
        {"name": current["name"], "location": label, "linkedOltId": olt["id"], "createdPons": len(created_pons)},
        actor_name(admin),
    )
    save_network_settings_data()
    return device_summary(current)


@router.get("/router-location-bindings")
def list_router_location_bindings(admin=Depends(require_admin)):
    seed_network_settings_data()
    routers = [device_summary(device) for device in visible_devices() if is_mikrotik_api_device(device)]
    return {
        "routers": routers,
        "totalRouters": len(routers),
        "totalBoundLocations": sum(int(router.get("locationBindingCount") or 0) for router in routers),
        "source": "network-device-location-bindings",
    }


@router.get("/routers/by-location")
def resolve_router_by_location(
    locationId: str = "",
    locationName: str = "",
    barangay: str = "",
    municipality: str = "",
    city: str = "",
    province: str = "",
    admin=Depends(require_admin),
):
    seed_network_settings_data()
    location = {
        "id": locationId,
        "location_name": locationName,
        "barangay": barangay,
        "municipality": municipality or city,
        "province": province,
    }
    matches = [device_summary(device) for device in visible_devices() if is_mikrotik_api_device(device) and router_matches_location(device, location)]
    return {
        "router": matches[0] if matches else None,
        "matches": matches,
        "matchCount": len(matches),
        "source": "network-device-location-bindings",
    }


@router.delete("/devices/{device_id}")
def delete_network_device(device_id: str, admin=Depends(require_admin)):
    seed_network_settings_data()
    current = find_device(device_id)
    timestamp = now_iso()
    current["deletedAt"] = timestamp
    current["updatedAt"] = timestamp
    add_audit("network_device_deleted", "NetworkDevice", current["id"], {"name": current["name"]}, actor_name(admin))
    save_network_settings_data()
    return {"status": "ok"}


@router.get("/devices/{device_id}/captures")
def list_device_captures(device_id: str, admin=Depends(require_admin)):
    seed_network_settings_data()
    find_device(device_id)
    rows = [capture_summary(row) for row in device_captures if row["deviceId"] == device_id]
    return sorted(rows, key=lambda item: item["capturedAt"], reverse=True)


@router.post("/devices/{device_id}/capture")
def capture_network_device(device_id: str, admin=Depends(require_admin)):
    seed_network_settings_data()
    device = find_device(device_id)
    return perform_device_capture(device, actor=actor_name(admin), include_details=True, raise_on_failure=True)


@router.get("/olts")
def list_olts(search: str = "", admin=Depends(require_admin)):
    seed_network_settings_data()
    rows = [olt_summary(row) for row in visible_olts() if matches_search(row, search)]
    return sorted(rows, key=lambda item: item["updatedAt"], reverse=True)


@router.post("/olts")
def create_olt(payload: OltPayload, admin=Depends(require_admin)):
    seed_network_settings_data()
    record = normalize_olt_payload(payload)
    timestamp = now_iso()
    olt = {"id": str(uuid4()), "createdAt": timestamp, "updatedAt": timestamp, "deletedAt": None, **record}
    olts.append(olt)
    created_pons = ensure_pon_count(olt["id"], olt["defaultPonCount"])
    add_audit("network_olt_created", "NetworkOlt", olt["id"], {"name": olt["name"], "createdPons": len(created_pons)}, actor_name(admin))
    save_network_settings_data()
    return olt_summary(olt)


@router.patch("/olts/{olt_id}")
def update_olt(olt_id: str, payload: OltPayload, admin=Depends(require_admin)):
    seed_network_settings_data()
    current = find_olt(olt_id)
    record = normalize_olt_payload(payload, current)
    current.update(record)
    current["updatedAt"] = now_iso()
    created_pons = ensure_pon_count(current["id"], current["defaultPonCount"])
    add_audit(
        "network_olt_updated",
        "NetworkOlt",
        current["id"],
        {"name": current["name"], "createdPons": len(created_pons)},
        actor_name(admin),
    )
    save_network_settings_data()
    return olt_summary(current)


@router.delete("/olts/{olt_id}")
def delete_olt(olt_id: str, admin=Depends(require_admin)):
    seed_network_settings_data()
    current = find_olt(olt_id)
    linked_pons = pon_rows_for_olt(olt_id)
    if any(nap_rows_for_pon(pon["id"]) for pon in linked_pons):
        raise HTTPException(status_code=400, detail="Delete or move assigned NAP boxes before deleting this OLT")
    timestamp = now_iso()
    current["deletedAt"] = timestamp
    current["updatedAt"] = timestamp
    for pon in linked_pons:
        pon["deletedAt"] = timestamp
        pon["updatedAt"] = timestamp
        for onu in onu_rows_for_pon(pon["id"]):
            onu["deletedAt"] = timestamp
            onu["updatedAt"] = timestamp
    add_audit("network_olt_deleted", "NetworkOlt", current["id"], {"name": current["name"]}, actor_name(admin))
    save_network_settings_data()
    return {"status": "ok"}


@router.get("/pons")
def list_all_pons(search: str = "", oltId: str = "", admin=Depends(require_admin)):
    seed_network_settings_data()
    rows = [
        pon_summary(row)
        for row in visible_pons()
        if (not oltId or row["oltId"] == oltId) and matches_search({**row, **pon_summary(row)}, search)
    ]
    return sorted(rows, key=lambda item: (item["oltName"], item["portNumber"]))


@router.get("/olts/{olt_id}/pons")
def list_olt_pons(olt_id: str, admin=Depends(require_admin)):
    seed_network_settings_data()
    find_olt(olt_id)
    return [pon_summary(row) for row in sorted(pon_rows_for_olt(olt_id), key=lambda item: item["portNumber"])]


@router.post("/olts/{olt_id}/pons")
def create_pon(olt_id: str, payload: PonPayload, admin=Depends(require_admin)):
    seed_network_settings_data()
    record = normalize_pon_payload(payload, olt_id)
    timestamp = now_iso()
    pon = {"id": str(uuid4()), "createdAt": timestamp, "updatedAt": timestamp, "deletedAt": None, **record}
    pon_ports.append(pon)
    add_audit("network_pon_created", "NetworkPonPort", pon["id"], {"oltId": olt_id, "portNumber": pon["portNumber"]}, actor_name(admin))
    save_network_settings_data()
    return pon_summary(pon)


@router.patch("/pons/{pon_id}")
def update_pon(pon_id: str, payload: PonPayload, admin=Depends(require_admin)):
    seed_network_settings_data()
    current = find_pon(pon_id)
    record = normalize_pon_payload(payload, current["oltId"], current)
    current.update(record)
    current["updatedAt"] = now_iso()
    add_audit("network_pon_updated", "NetworkPonPort", current["id"], {"portNumber": current["portNumber"]}, actor_name(admin))
    save_network_settings_data()
    return pon_summary(current)


@router.patch("/pons/{pon_id}/power")
def update_pon_power(pon_id: str, payload: PonPowerPayload, admin=Depends(require_admin)):
    seed_network_settings_data()
    current = find_pon(pon_id)
    record = normalize_pon_power_payload(payload)
    current.update(record)
    current["updatedAt"] = now_iso()
    add_audit(
        "network_pon_power_updated",
        "NetworkPonPort",
        current["id"],
        {"portNumber": current["portNumber"], "source": current.get("moduleSource", "")},
        actor_name(admin),
    )
    save_network_settings_data()
    return pon_summary(current)


@router.delete("/pons/{pon_id}")
def delete_pon(pon_id: str, admin=Depends(require_admin)):
    seed_network_settings_data()
    current = find_pon(pon_id)
    if nap_rows_for_pon(pon_id):
        raise HTTPException(status_code=400, detail="Delete or move assigned NAP boxes before deleting this PON")
    timestamp = now_iso()
    current["deletedAt"] = timestamp
    current["updatedAt"] = timestamp
    for onu in onu_rows_for_pon(pon_id):
        onu["deletedAt"] = timestamp
        onu["updatedAt"] = timestamp
    add_audit("network_pon_deleted", "NetworkPonPort", current["id"], {"portNumber": current["portNumber"]}, actor_name(admin))
    save_network_settings_data()
    return {"status": "ok"}


@router.get("/nap-boxes")
def list_nap_boxes(search: str = "", ponPortId: str = "", admin=Depends(require_admin)):
    seed_network_settings_data()
    rows = [
        nap_summary(row)
        for row in visible_naps()
        if (not ponPortId or row["ponPortId"] == ponPortId) and matches_search({**row, **nap_summary(row)}, search)
    ]
    return sorted(rows, key=lambda item: item["updatedAt"], reverse=True)


@router.post("/nap-boxes")
def create_nap_box(payload: NapPayload, admin=Depends(require_admin)):
    seed_network_settings_data()
    record = normalize_nap_payload(payload)
    timestamp = now_iso()
    nap = {"id": str(uuid4()), "createdAt": timestamp, "updatedAt": timestamp, "deletedAt": None, **record}
    nap_boxes.append(nap)
    add_audit("network_nap_created", "NetworkNapBox", nap["id"], {"name": nap["name"], "ponPortId": nap["ponPortId"]}, actor_name(admin))
    save_network_settings_data()
    return nap_summary(nap)


@router.patch("/nap-boxes/{nap_id}")
def update_nap_box(nap_id: str, payload: NapPayload, admin=Depends(require_admin)):
    seed_network_settings_data()
    current = find_nap(nap_id)
    record = normalize_nap_payload(payload, current)
    current.update(record)
    current["updatedAt"] = now_iso()
    add_audit("network_nap_updated", "NetworkNapBox", current["id"], {"name": current["name"]}, actor_name(admin))
    save_network_settings_data()
    return nap_summary(current)


@router.delete("/nap-boxes/{nap_id}")
def delete_nap_box(nap_id: str, admin=Depends(require_admin)):
    seed_network_settings_data()
    current = find_nap(nap_id)
    if fbt_rows_for_nap(nap_id):
        raise HTTPException(status_code=400, detail="Delete or move assigned FBT records before deleting this NAP")
    timestamp = now_iso()
    current["deletedAt"] = timestamp
    current["updatedAt"] = timestamp
    add_audit("network_nap_deleted", "NetworkNapBox", current["id"], {"name": current["name"]}, actor_name(admin))
    save_network_settings_data()
    return {"status": "ok"}


@router.get("/fbts")
def list_fbts(search: str = "", napBoxId: str = "", admin=Depends(require_admin)):
    seed_network_settings_data()
    rows = [
        fbt_summary(row)
        for row in visible_fbts()
        if (not napBoxId or row["napBoxId"] == napBoxId) and matches_search({**row, **fbt_summary(row)}, search)
    ]
    return sorted(rows, key=lambda item: item["updatedAt"], reverse=True)


@router.post("/fbts")
def create_fbt(payload: FbtPayload, admin=Depends(require_admin)):
    seed_network_settings_data()
    record = normalize_fbt_payload(payload)
    timestamp = now_iso()
    fbt = {"id": str(uuid4()), "createdAt": timestamp, "updatedAt": timestamp, "deletedAt": None, **record}
    fbts.append(fbt)
    add_audit("network_fbt_created", "NetworkFbt", fbt["id"], {"name": fbt["name"], "napBoxId": fbt["napBoxId"]}, actor_name(admin))
    save_network_settings_data()
    return fbt_summary(fbt)


@router.patch("/fbts/{fbt_id}")
def update_fbt(fbt_id: str, payload: FbtPayload, admin=Depends(require_admin)):
    seed_network_settings_data()
    current = find_fbt(fbt_id)
    record = normalize_fbt_payload(payload, current)
    current.update(record)
    current["updatedAt"] = now_iso()
    add_audit("network_fbt_updated", "NetworkFbt", current["id"], {"name": current["name"]}, actor_name(admin))
    save_network_settings_data()
    return fbt_summary(current)


@router.delete("/fbts/{fbt_id}")
def delete_fbt(fbt_id: str, admin=Depends(require_admin)):
    seed_network_settings_data()
    current = find_fbt(fbt_id)
    timestamp = now_iso()
    current["deletedAt"] = timestamp
    current["updatedAt"] = timestamp
    add_audit("network_fbt_deleted", "NetworkFbt", current["id"], {"name": current["name"]}, actor_name(admin))
    save_network_settings_data()
    return {"status": "ok"}
