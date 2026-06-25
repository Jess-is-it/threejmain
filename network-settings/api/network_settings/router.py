from __future__ import annotations

import hashlib
import json
import math
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
fiber_optic_losses: list[dict[str, Any]] = []
fiber_color_settings: dict[str, Any] = {}
fiber_mapping: dict[str, Any] = {}
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
PON_COLOR_BASES = ["#20C997", "#FCC419", "#339AF0", "#CC5DE8"]
ADMIN_STATUSES = ["ENABLED", "DISABLED", "RESERVED"]
OPER_STATUS = ["UNKNOWN", "UP", "DEGRADED", "DOWN"]
NAP_STATUSES = ["PLANNED", "ACTIVE", "FULL", "MAINTENANCE", "OFFLINE", "ARCHIVED"]
NAP_SPLITTER_RATIOS = ["1:8", "1:16"]
FBT_STATUSES = ["PLANNED", "ACTIVE", "FULL", "MAINTENANCE", "OFFLINE", "ARCHIVED"]
SPLITTER_TYPES = ["PLC", "LCP", "FBT"]
PLC_SPLITTER_RATIOS = ["1:4", "1:8", "1:16"]
LCP_SPLITTER_RATIOS = ["1:4", "1:8", "1:16"]
PORT_LOSS_SPLITTER_TYPES = {"PLC", "LCP"}
SPLITTER_RATIOS = ["1:2", "1:4", "1:8", "1:16", "1:32", "1:64", "1:128", "50:50", "60:40", "70:30", "80:20", "90:10"]
FBT_SPLIT_RATIOS = ["1:99", "5:95", "10:90", "15:85", "20:80", "25:75", "30:70", "35:65", "40:60", "50:50"]
WAVELENGTHS_NM = ["1310", "1490", "1550"]
FBT_LOSS_FIELDS = [
    "connectorLoss1310Db",
    "connectorLoss1490Db",
    "connectorLoss1550Db",
    "currentNapLoss1310Db",
    "currentNapLoss1490Db",
    "currentNapLoss1550Db",
    "nextNapLoss1310Db",
    "nextNapLoss1490Db",
    "nextNapLoss1550Db",
]
SPLITTER_PACKAGE_TYPES = ["LCP_MODULE", "CASSETTE", "ABS_BOX", "STEEL_TUBE", "RACK_TRAY", "NAP_TRAY", "CLOSURE"]
SPLITTER_CONNECTOR_TYPES = ["SC/APC", "SC/UPC", "LC/APC", "LC/UPC", "BARE_FIBER", "SPLICE"]
SPLITTER_STAGES = ["PRIMARY", "SECONDARY", "DROP", "TAP"]
SPLITTER_DEFAULTS = {
    "PLC": {"splitRatio": "1:16", "outputPorts": 16, "packageType": "CASSETTE", "stage": "SECONDARY", "connectorType": "SC/APC"},
    "LCP": {"splitRatio": "1:16", "outputPorts": 16, "packageType": "LCP_MODULE", "stage": "PRIMARY", "connectorType": "SC/APC"},
    "FBT": {"splitRatio": "5:95", "outputPorts": 2, "packageType": "STEEL_TUBE", "stage": "TAP", "connectorType": "BARE_FIBER"},
}
FIBER_OPTIC_STATUSES = ["ACTIVE", "PLANNED", "ARCHIVED"]
FIBER_OPTIC_LOSS_FIELDS = ["loss1310DbPer1000m", "loss1490DbPer1000m", "loss1550DbPer1000m"]
FIBER_CORE_COUNT_OPTIONS = [1, 2, 4, 6, 8, 12, 24, 48, 60, 72]
FIBER_COLOR_GROUP_SIZE = 12
FIBER_COLOR_PALETTE_DEFAULTS = [
    {"position": 1, "name": "Blue", "hex": "#2563EB"},
    {"position": 2, "name": "Orange", "hex": "#F97316"},
    {"position": 3, "name": "Green", "hex": "#16A34A"},
    {"position": 4, "name": "Brown", "hex": "#92400E"},
    {"position": 5, "name": "Slate", "hex": "#64748B"},
    {"position": 6, "name": "White", "hex": "#F8FAFC"},
    {"position": 7, "name": "Red", "hex": "#DC2626"},
    {"position": 8, "name": "Black", "hex": "#111827"},
    {"position": 9, "name": "Yellow", "hex": "#EAB308"},
    {"position": 10, "name": "Violet", "hex": "#7C3AED"},
    {"position": 11, "name": "Rose", "hex": "#F472B6"},
    {"position": 12, "name": "Aqua", "hex": "#06B6D4"},
]
FIBER_COLOR_SETTINGS_DEFAULT = {
    "standardName": "TIA-598",
    "fiberColors": FIBER_COLOR_PALETTE_DEFAULTS,
    "tubeColors": FIBER_COLOR_PALETTE_DEFAULTS,
    "notes": "Default 12-color sequence for individual fibers and loose tubes.",
}
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
HEX_COLOR_RE = re.compile(r"^#?(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$")
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
    {"key": "map", "label": "Map", "route": "/network-settings/map"},
    {"key": "fiberMapping", "label": "Fiber Mapping", "route": "/network-settings/fiber-mapping"},
    {"key": "mikrotikSettings", "label": "MikroTik API", "route": "/network-settings/mikrotik/settings"},
    {"key": "pppoeAccounts", "label": "PPPoE Accounts", "route": "/network-settings/pppoe-accounts"},
    {"key": "oltSettings", "label": "OLT SNMP", "route": "/network-settings/olt/settings"},
    {"key": "olts", "label": "OLT & PON", "route": "/network-settings/olts"},
    {"key": "onus", "label": "ONUs", "route": "/network-settings/onus"},
    {"key": "napBoxes", "label": "NAP Boxes", "route": "/network-settings/nap-boxes"},
    {"key": "insertionLoss", "label": "Insertion Loss", "route": "/network-settings/insertion-loss"},
    {"key": "fbts", "label": "Splitters", "route": "/network-settings/insertion-loss/splitters"},
    {"key": "fiberOpticLosses", "label": "Fiber Optic", "route": "/network-settings/insertion-loss/fiber-optic"},
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
    displayOrder: int | None = Field(default=None, ge=0)
    notes: str | None = None


class PonPayload(BaseModel):
    portNumber: int | None = Field(default=None, ge=1, le=512)
    label: str | None = None
    colorHex: str | None = None
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
    moduleRxPowerDbm: str | float | None = None
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
    splitterType: str | None = None
    splitRatio: str | None = None
    ratioRows: list[dict] | None = None
    ratioProfiles: list[dict] | None = None
    portLosses: list[dict] | None = None
    inputPorts: int | None = Field(default=None, ge=1, le=16)
    outputPorts: int | None = Field(default=None, ge=1, le=512)
    portNumber: int | None = Field(default=None, ge=1, le=512)
    portCapacity: int | None = Field(default=None, ge=1, le=512)
    insertionLossDb: str | float | None = None
    connectorType: str | None = None
    packageType: str | None = None
    stage: str | None = None
    manufacturer: str | None = None
    brand: str | None = None
    model: str | None = None
    serialNumber: str | None = None
    connectorLoss1310Db: str | float | None = None
    connectorLoss1490Db: str | float | None = None
    connectorLoss1550Db: str | float | None = None
    currentNapLoss1310Db: str | float | None = None
    currentNapLoss1490Db: str | float | None = None
    currentNapLoss1550Db: str | float | None = None
    nextNapLoss1310Db: str | float | None = None
    nextNapLoss1490Db: str | float | None = None
    nextNapLoss1550Db: str | float | None = None
    lcpCabinet: str | None = None
    lcpSlot: str | None = None
    status: str | None = None
    locationHint: str | None = None
    notes: str | None = None


class FiberOpticLossPayload(BaseModel):
    name: str | None = None
    manufacturer: str | None = None
    model: str | None = None
    fiberType: str | None = None
    coreCount: int | str | None = None
    colorGroups: list[dict[str, Any]] | None = None
    loss1310DbPer1000m: str | float | None = None
    loss1490DbPer1000m: str | float | None = None
    loss1550DbPer1000m: str | float | None = None
    status: str | None = None
    notes: str | None = None


class FiberColorSettingsPayload(BaseModel):
    standardName: str | None = None
    fiberColors: list[dict[str, Any]] | None = None
    tubeColors: list[dict[str, Any]] | None = None
    notes: str | None = None


class FiberMappingPayload(BaseModel):
    nodes: dict[str, dict[str, Any]] = Field(default_factory=dict)
    edges: dict[str, dict[str, Any]] = Field(default_factory=dict)
    napSplitters: dict[str, list[str]] = Field(default_factory=dict)
    junctionBoxes: dict[str, dict[str, Any]] = Field(default_factory=dict)
    containerSplitters: dict[str, list[str]] = Field(default_factory=dict)
    containerSplitterAssignments: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)
    connectionPoints: dict[str, dict[str, Any]] = Field(default_factory=dict)
    fiberLinkSettings: dict[str, Any] = Field(default_factory=dict)


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
    displayOrder: int | None = Field(default=None, ge=0)
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


class DeviceOrderPayload(BaseModel):
    orderedIds: list[str] = Field(default_factory=list)
    accessMethod: str | None = None
    deviceType: str | None = None


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
    global _data_loaded, olts, pon_ports, nap_boxes, fbts, fiber_optic_losses, fiber_color_settings, fiber_mapping, network_devices, device_captures, onus
    if _data_loaded:
        return
    _data_loaded = True
    if not NETWORK_SETTINGS_DATA_PATH or not os.path.exists(NETWORK_SETTINGS_DATA_PATH):
        fiber_color_settings = normalize_fiber_color_settings({})
        fiber_mapping = normalize_fiber_mapping({})
        return
    try:
        with open(NETWORK_SETTINGS_DATA_PATH, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        fiber_color_settings = normalize_fiber_color_settings({})
        return
    olts = list(payload.get("olts") or [])
    pon_ports = list(payload.get("ponPorts") or [])
    nap_boxes = list(payload.get("napBoxes") or [])
    fbts = list(payload.get("fbts") or [])
    fiber_optic_losses = list(payload.get("fiberOpticLosses") or [])
    fiber_color_settings = normalize_fiber_color_settings(payload.get("fiberColorSettings"))
    fiber_mapping = normalize_fiber_mapping(payload.get("fiberMapping"))
    network_devices = list(payload.get("networkDevices") or [])
    device_captures = list(payload.get("deviceCaptures") or [])
    onus = list(payload.get("onus") or [])
    capture_history_normalized = normalize_capture_history()
    display_orders_normalized = ensure_display_orders()
    if normalize_pon_inventory_defaults() or capture_history_normalized or display_orders_normalized:
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
        "fiberOpticLosses": fiber_optic_losses,
        "fiberColorSettings": fiber_color_settings_summary(),
        "fiberMapping": fiber_mapping_summary(),
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


def default_fiber_color_settings() -> dict[str, Any]:
    return json.loads(json.dumps(FIBER_COLOR_SETTINGS_DEFAULT))


def normalize_hex_color(value: Any, fallback: str) -> str:
    text = clean_text(value)
    if not HEX_COLOR_RE.match(text):
        return fallback
    text = text.lstrip("#")
    if len(text) == 3:
        text = "".join(character * 2 for character in text)
    return f"#{text.upper()}"


def normalize_fiber_color_palette(rows: Any, defaults: list[dict[str, Any]]) -> list[dict[str, Any]]:
    source_rows = rows if isinstance(rows, list) else []
    normalized = []
    for index, fallback in enumerate(defaults):
        source = source_rows[index] if index < len(source_rows) and isinstance(source_rows[index], dict) else {}
        normalized.append({
            "position": index + 1,
            "name": clean_text(source.get("name")) or fallback["name"],
            "hex": normalize_hex_color(source.get("hex"), fallback["hex"]),
        })
    return normalized


def normalize_fiber_color_settings(payload: Any) -> dict[str, Any]:
    defaults = default_fiber_color_settings()
    source = payload if isinstance(payload, dict) else {}
    return {
        "standardName": clean_text(source.get("standardName")) or defaults["standardName"],
        "fiberColors": normalize_fiber_color_palette(source.get("fiberColors"), defaults["fiberColors"]),
        "tubeColors": normalize_fiber_color_palette(source.get("tubeColors"), defaults["tubeColors"]),
        "notes": clean_text(source.get("notes")) or defaults["notes"],
    }


def fiber_color_settings_summary() -> dict[str, Any]:
    return normalize_fiber_color_settings(fiber_color_settings)


def color_entry_for_position(palette: list[dict[str, Any]], position: int) -> dict[str, Any]:
    if not palette:
        palette = default_fiber_color_settings()["fiberColors"]
    index = (max(position, 1) - 1) % len(palette)
    return palette[index]


def resolve_fiber_color_entry(source: dict[str, Any], palette: list[dict[str, Any]], fallback_position: int) -> dict[str, str]:
    fallback = color_entry_for_position(palette, fallback_position)
    name = clean_text(source.get("colorName") or source.get("tubeColorName") or source.get("name")) or fallback["name"]
    raw_hex = source.get("colorHex") or source.get("tubeColorHex") or source.get("hex")
    return {"name": name, "hex": normalize_hex_color(raw_hex, fallback["hex"])}


def fiber_core_count_from_groups(groups: Any) -> int:
    if not isinstance(groups, list):
        return 0
    total = 0
    for group in groups:
        cores = group.get("cores") if isinstance(group, dict) else []
        if isinstance(cores, list):
            total += len(cores)
    return total


def normalize_fiber_core_count(value: Any, fallback: int = 12, strict: bool = False) -> int:
    try:
        count = int(value)
    except (TypeError, ValueError):
        count = int(fallback or 12)
    valid = count in FIBER_CORE_COUNT_OPTIONS or (count >= FIBER_COLOR_GROUP_SIZE and count % FIBER_COLOR_GROUP_SIZE == 0)
    if not valid:
        if strict:
            raise HTTPException(status_code=400, detail="Core count must be 1, 2, 4, 6, 8, 12, 24, 48, 60, 72, or another multiple of 12")
        count = int(fallback or 12)
    return max(1, min(count, 288))


def default_fiber_color_groups(core_count: int, settings: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    normalized_settings = normalize_fiber_color_settings(settings or fiber_color_settings)
    fiber_palette = normalized_settings["fiberColors"]
    tube_palette = normalized_settings["tubeColors"]
    uses_tubes = core_count > FIBER_COLOR_GROUP_SIZE
    groups: list[dict[str, Any]] = []
    fiber_number = 1
    remaining = core_count
    group_number = 1
    while remaining > 0:
        group_size = min(FIBER_COLOR_GROUP_SIZE, remaining)
        tube = color_entry_for_position(tube_palette, group_number) if uses_tubes else {"name": "", "hex": ""}
        cores = []
        for position in range(1, group_size + 1):
            color = color_entry_for_position(fiber_palette, position)
            cores.append({
                "fiberNumber": fiber_number,
                "position": position,
                "colorName": color["name"],
                "colorHex": color["hex"],
            })
            fiber_number += 1
        groups.append({
            "id": f"group-{group_number}",
            "groupNumber": group_number,
            "groupName": f"Tube {group_number}" if uses_tubes else "Core Colors",
            "tubeColorName": tube["name"],
            "tubeColorHex": tube["hex"],
            "cores": cores,
        })
        remaining -= group_size
        group_number += 1
    return groups


def normalize_fiber_color_groups(groups: Any, core_count: int, settings: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    normalized_settings = normalize_fiber_color_settings(settings or fiber_color_settings)
    defaults = default_fiber_color_groups(core_count, normalized_settings)
    source_groups = groups if isinstance(groups, list) else []
    normalized_groups = []
    fiber_number = 1
    uses_tubes = core_count > FIBER_COLOR_GROUP_SIZE
    for index, fallback_group in enumerate(defaults):
        source_group = source_groups[index] if index < len(source_groups) and isinstance(source_groups[index], dict) else {}
        group_number = index + 1
        tube = (
            resolve_fiber_color_entry(
                {
                    "tubeColorName": source_group.get("tubeColorName"),
                    "tubeColorHex": source_group.get("tubeColorHex"),
                },
                normalized_settings["tubeColors"],
                group_number,
            )
            if uses_tubes
            else {"name": "", "hex": ""}
        )
        source_cores = source_group.get("cores") if isinstance(source_group.get("cores"), list) else []
        cores = []
        for core_index, fallback_core in enumerate(fallback_group["cores"]):
            source_core = source_cores[core_index] if core_index < len(source_cores) and isinstance(source_cores[core_index], dict) else {}
            color = resolve_fiber_color_entry(source_core, normalized_settings["fiberColors"], core_index + 1)
            cores.append({
                "fiberNumber": fiber_number,
                "position": core_index + 1,
                "colorName": color["name"],
                "colorHex": color["hex"],
            })
            fiber_number += 1
        normalized_groups.append({
            "id": clean_text(source_group.get("id")) or fallback_group["id"],
            "groupNumber": group_number,
            "groupName": (clean_text(source_group.get("groupName")) or f"Tube {group_number}") if uses_tubes else "Core Colors",
            "tubeColorName": tube["name"],
            "tubeColorHex": tube["hex"],
            "cores": cores,
        })
    return normalized_groups


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


def mapping_number(value: Any, fallback: float = 0.0, minimum: float = 0.0, maximum: float = 6000.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = fallback
    return round(max(minimum, min(maximum, number)), 2)


def optional_mapping_number(value: Any, minimum: float = 0.0, maximum: float = 6000.0) -> float | None:
    if value is None or clean_text(value) == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return round(max(minimum, min(maximum, number)), 2)


def optional_geo_number(value: Any, minimum: float, maximum: float) -> float | None:
    if value is None or clean_text(value) == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return round(max(minimum, min(maximum, number)), 7)


def normalize_fiber_mapping_bend_points(points: Any) -> list[dict[str, Any]]:
    if not isinstance(points, list):
        return []
    normalized: list[dict[str, Any]] = []
    for point in points[:24]:
        source = point if isinstance(point, dict) else {}
        latitude = optional_geo_number(source.get("latitude"), -90.0, 90.0)
        longitude = optional_geo_number(source.get("longitude"), -180.0, 180.0)
        x = optional_mapping_number(source.get("x"), 0.0, 12000.0)
        y = optional_mapping_number(source.get("y"), 0.0, 12000.0)
        if (latitude is None or longitude is None) and (x is None or y is None):
            continue
        record: dict[str, Any] = {}
        if latitude is not None and longitude is not None:
            record["latitude"] = latitude
            record["longitude"] = longitude
        if x is not None and y is not None:
            record["x"] = x
            record["y"] = y
        normalized.append(record)
    return normalized


def normalize_mapping_node_key(value: Any) -> str:
    key = clean_text(value)[:160]
    if not re.fullmatch(r"[a-z]+:[A-Za-z0-9_.:-]+", key):
        return ""
    return key


def normalize_mapping_edge_key(value: Any) -> str:
    key = clean_text(value)[:220]
    if not re.fullmatch(r"[a-z]+:[A-Za-z0-9_.:-]+->[a-z]+:[A-Za-z0-9_.:-]+", key):
        return ""
    return key


def normalize_fiber_mapping_node(record: Any) -> dict[str, Any]:
    source = record if isinstance(record, dict) else {}
    normalized = {
        "x": mapping_number(source.get("x")),
        "y": mapping_number(source.get("y")),
        "locked": normalize_bool(source.get("locked")),
        "visible": not (source.get("visible") is False or clean_text(source.get("visible")).lower() in {"0", "false", "no", "off"}),
    }
    source_key = normalize_mapping_node_key(source.get("sourceKey"))
    if source_key:
        normalized["sourceKey"] = source_key
    return normalized


def normalize_fiber_mapping_edge(record: Any) -> dict[str, Any]:
    source = record if isinstance(record, dict) else {}
    available_fiber_ids = {row["id"] for row in visible_fiber_optic_losses()}
    fiber_optic_loss_id = clean_text(source.get("fiberOpticLossId"))
    if fiber_optic_loss_id and fiber_optic_loss_id not in available_fiber_ids:
        fiber_optic_loss_id = ""
    wavelength_nm = clean_text(source.get("wavelengthNm")) or WAVELENGTHS_NM[0]
    if wavelength_nm not in WAVELENGTHS_NM:
        wavelength_nm = WAVELENGTHS_NM[0]
    line_style = normalize_upper(source.get("lineStyle") or "SOLID")
    if line_style not in {"SOLID", "DASHED", "DOTTED"}:
        line_style = "SOLID"
    connection_type = normalize_upper(source.get("connectionType") or "FUSION")
    if connection_type not in {"FUSION", "MECHANICAL", "SC_CONNECTOR"}:
        connection_type = "FUSION"
    fiber_core_number = clean_text(source.get("fiberCoreNumber")) or "1"
    if not fiber_core_number.isdigit() or int(fiber_core_number) < 1:
        fiber_core_number = "1"
    return {
        "fiberOpticLossId": fiber_optic_loss_id,
        "fiberCoreNumber": fiber_core_number,
        "wavelengthNm": wavelength_nm,
        "lengthKm": clean_text(source.get("lengthKm")),
        "sourcePowerDbm": clean_text(source.get("sourcePowerDbm")),
        "connectorLossDb": clean_text(source.get("connectorLossDb")),
        "spliceLossDb": clean_text(source.get("spliceLossDb")),
        "connectionType": connection_type,
        "lineStyle": line_style,
        "lineColor": normalize_hex_color(source.get("lineColor"), "#2563EB"),
        "mapBendPoints": normalize_fiber_mapping_bend_points(source.get("mapBendPoints")),
        "notes": clean_text(source.get("notes")),
    }


def normalize_fiber_mapping_junction(record: Any, junction_id: str, valid_source_keys: set[str]) -> dict[str, Any] | None:
    source = record if isinstance(record, dict) else {}
    source_key = normalize_mapping_node_key(source.get("sourceKey"))
    if source_key not in valid_source_keys:
        return None
    name = clean_text(source.get("name"))[:80] or f"Junction Box {junction_id[-4:]}"
    return {
        "id": junction_id,
        "name": name,
        "sourceKey": source_key,
        "sourceLabel": clean_text(source.get("sourceLabel"))[:120],
        "status": clean_text(source.get("status"))[:40] or "ACTIVE",
        "createdAt": clean_text(source.get("createdAt")),
        "notes": clean_text(source.get("notes"))[:400],
    }


def normalize_fiber_mapping_connection_point(record: Any) -> dict[str, Any]:
    source = record if isinstance(record, dict) else {}
    connection_type = normalize_upper(source.get("connectionType") or source.get("type") or "FUSION")
    if connection_type not in {"FUSION", "MECHANICAL", "SC_CONNECTOR"}:
        connection_type = "FUSION"
    normalized = {
        "connectionType": connection_type,
        "label": clean_text(source.get("label"))[:80],
        "updatedAt": clean_text(source.get("updatedAt")),
    }
    position_x = optional_mapping_number(source.get("positionX"))
    position_y = optional_mapping_number(source.get("positionY"))
    if position_x is not None:
        normalized["positionX"] = position_x
    if position_y is not None:
        normalized["positionY"] = position_y
    endpoint_role = clean_text(source.get("endpointRole"))
    if endpoint_role in {"input", "output"}:
        normalized["endpointRole"] = endpoint_role
    return normalized


def normalize_fiber_mapping_splitter_assignment(
    record: Any,
    available_splitters_by_id: dict[str, dict[str, Any]],
    fallback_index: int = 0,
) -> dict[str, Any] | None:
    source = record if isinstance(record, dict) else {"splitterId": record}
    splitter_id = clean_text(source.get("splitterId") or source.get("id"))
    splitter = available_splitters_by_id.get(splitter_id)
    if not splitter:
        return None
    assignment_id = clean_text(source.get("assignmentId"))[:80]
    if not assignment_id or not re.fullmatch(r"[A-Za-z0-9_.:-]+", assignment_id):
        assignment_id = f"{splitter_id}-{fallback_index + 1}"
    ratio = clean_text(source.get("ratio") or source.get("splitRatio"))
    if normalize_upper(splitter.get("splitterType")) == "FBT":
        available_ratios = {
            normalize_fbt_split_ratio(row.get("ratio") or row.get("splitRatio"), "")
            for row in normalize_fbt_ratio_rows(splitter.get("ratioRows"), splitter, splitter.get("splitRatio") or "5:95")
        }
        ratio = normalize_fbt_split_ratio(ratio, splitter.get("splitRatio") or "5:95")
        if available_ratios and ratio not in available_ratios:
            ratio = next(iter(available_ratios))
    elif normalize_upper(splitter.get("splitterType")) in PORT_LOSS_SPLITTER_TYPES:
        splitter_type = normalize_upper(splitter.get("splitterType"))
        profiles = normalize_splitter_ratio_profiles(splitter_type, splitter.get("ratioProfiles"), splitter, splitter.get("splitRatio") or SPLITTER_DEFAULTS[splitter_type]["splitRatio"])
        available_ratios = [profile["splitRatio"] for profile in profiles]
        ratio = normalize_splitter_ratio(ratio or splitter.get("splitRatio"), splitter.get("splitRatio") or SPLITTER_DEFAULTS[splitter_type]["splitRatio"], splitter_ratio_choices_for_type(splitter_type))
        if available_ratios and ratio not in available_ratios:
            ratio = available_ratios[0]
    else:
        ratio = clean_text(ratio or splitter.get("splitRatio"))
    normalized = {
        "assignmentId": assignment_id,
        "splitterId": splitter_id,
        "ratio": ratio,
    }
    parent_assignment_id = clean_text(source.get("parentAssignmentId"))[:80]
    parent_terminal = clean_text(source.get("parentTerminal"))
    if parent_assignment_id and re.fullmatch(r"[A-Za-z0-9_.:-]+", parent_assignment_id) and parent_terminal in {"splitA", "splitB", "output"}:
        normalized["parentAssignmentId"] = parent_assignment_id
        normalized["parentTerminal"] = parent_terminal
    position_x = optional_mapping_number(source.get("positionX"))
    position_y = optional_mapping_number(source.get("positionY"))
    if position_x is not None:
        normalized["positionX"] = position_x
    if position_y is not None:
        normalized["positionY"] = position_y
    return normalized


def normalize_fiber_link_settings(raw: Any) -> dict[str, int]:
    source = raw if isinstance(raw, dict) else {}

    def bounded_int(value: Any, fallback: int, minimum: int, maximum: int) -> int:
        try:
            number = int(float(str(value).strip()))
        except (TypeError, ValueError):
            number = fallback
        return max(minimum, min(maximum, number))

    max_line_pixels = bounded_int(source.get("maxLinePixels"), 500, 160, 1200)
    min_line_pixels = bounded_int(source.get("minLinePixels"), 80, 40, max_line_pixels)
    return {
        "maxLinePixels": max_line_pixels,
        "minLinePixels": min_line_pixels,
    }


def normalize_fiber_mapping(raw: Any) -> dict[str, Any]:
    source = raw if isinstance(raw, dict) else {}
    nodes_source = source.get("nodes") if isinstance(source.get("nodes"), dict) else {}
    edges_source = source.get("edges") if isinstance(source.get("edges"), dict) else {}
    splitters_source = source.get("napSplitters") if isinstance(source.get("napSplitters"), dict) else {}
    junctions_source = source.get("junctionBoxes") if isinstance(source.get("junctionBoxes"), dict) else {}
    container_splitters_source = source.get("containerSplitters") if isinstance(source.get("containerSplitters"), dict) else {}
    container_assignments_source = source.get("containerSplitterAssignments") if isinstance(source.get("containerSplitterAssignments"), dict) else {}
    connection_points_source = source.get("connectionPoints") if isinstance(source.get("connectionPoints"), dict) else {}
    nodes = {
        key: normalize_fiber_mapping_node(value)
        for raw_key, value in nodes_source.items()
        if (key := normalize_mapping_node_key(raw_key))
    }
    edges = {
        key: normalize_fiber_mapping_edge(value)
        for raw_key, value in edges_source.items()
        if (key := normalize_mapping_edge_key(raw_key))
    }
    available_nap_ids = {row["id"] for row in visible_naps()}
    available_splitters_by_id = {row["id"]: fbt_summary(row) for row in visible_fbts()}
    available_splitter_ids = set(available_splitters_by_id)
    valid_container_keys = {key for key in nodes if key.startswith(("nap:", "junction:"))}
    valid_source_keys = (
        set(nodes.keys())
        | {f"olt:{row['id']}" for row in visible_olts()}
        | {f"pon:{row['id']}" for row in visible_pons()}
        | {f"nap:{nap_id}" for nap_id in available_nap_ids}
    )
    junction_boxes: dict[str, dict[str, Any]] = {}
    for raw_junction_id, raw_junction in junctions_source.items():
        junction_id = clean_text(raw_junction_id)[:80]
        if not junction_id or not re.fullmatch(r"[A-Za-z0-9_.:-]+", junction_id):
            continue
        junction_key = f"junction:{junction_id}"
        normalized = normalize_fiber_mapping_junction(raw_junction, junction_id, valid_source_keys | set(junction_boxes.keys()))
        if not normalized:
            continue
        junction_boxes[junction_id] = normalized
        valid_container_keys.add(junction_key)
        valid_source_keys.add(junction_key)
    nap_splitters: dict[str, list[str]] = {}
    for raw_nap_id, raw_splitters in splitters_source.items():
        nap_id = clean_text(raw_nap_id)
        if nap_id not in available_nap_ids or not isinstance(raw_splitters, list):
            continue
        splitter_ids: list[str] = []
        for raw_splitter_id in raw_splitters:
            splitter_id = clean_text(raw_splitter_id)
            if splitter_id in available_splitter_ids and splitter_id not in splitter_ids:
                splitter_ids.append(splitter_id)
        if splitter_ids:
            nap_splitters[nap_id] = splitter_ids
    container_splitters: dict[str, list[str]] = {}
    container_splitter_assignments: dict[str, list[dict[str, Any]]] = {}
    for nap_id, splitter_ids in nap_splitters.items():
        container_splitters[f"nap:{nap_id}"] = splitter_ids
        container_splitter_assignments[f"nap:{nap_id}"] = [
            assignment
            for index, splitter_id in enumerate(splitter_ids)
            if (assignment := normalize_fiber_mapping_splitter_assignment(splitter_id, available_splitters_by_id, index))
        ]
    for raw_container_key, raw_splitters in container_splitters_source.items():
        container_key = normalize_mapping_node_key(raw_container_key)
        if container_key not in valid_container_keys or not isinstance(raw_splitters, list):
            continue
        splitter_ids: list[str] = []
        assignments: list[dict[str, Any]] = []
        for raw_splitter_id in raw_splitters:
            assignment = normalize_fiber_mapping_splitter_assignment(raw_splitter_id, available_splitters_by_id, len(assignments))
            if not assignment:
                continue
            if assignment["splitterId"] not in splitter_ids:
                splitter_ids.append(assignment["splitterId"])
            assignments.append(assignment)
        if splitter_ids:
            container_splitters[container_key] = splitter_ids
            container_splitter_assignments[container_key] = assignments
            if container_key.startswith("nap:"):
                nap_splitters[container_key.split(":", 1)[1]] = splitter_ids
    for raw_container_key, raw_assignments in container_assignments_source.items():
        container_key = normalize_mapping_node_key(raw_container_key)
        if container_key not in valid_container_keys or not isinstance(raw_assignments, list):
            continue
        assignments: list[dict[str, Any]] = []
        seen_assignment_ids: set[str] = set()
        for raw_assignment in raw_assignments:
            assignment = normalize_fiber_mapping_splitter_assignment(raw_assignment, available_splitters_by_id, len(assignments))
            if not assignment:
                continue
            original_assignment_id = assignment["assignmentId"]
            suffix = 2
            while assignment["assignmentId"] in seen_assignment_ids:
                assignment["assignmentId"] = f"{original_assignment_id}-{suffix}"
                suffix += 1
            seen_assignment_ids.add(assignment["assignmentId"])
            assignments.append(assignment)
        if assignments:
            splitter_ids = []
            for assignment in assignments:
                if assignment["splitterId"] not in splitter_ids:
                    splitter_ids.append(assignment["splitterId"])
            container_splitter_assignments[container_key] = assignments
            container_splitters[container_key] = splitter_ids
            if container_key.startswith("nap:"):
                nap_splitters[container_key.split(":", 1)[1]] = splitter_ids
    connection_points: dict[str, dict[str, Any]] = {}
    valid_point_prefixes = tuple(
        f"{container_key}|{assignment['assignmentId']}|"
        for container_key, assignments in container_splitter_assignments.items()
        for assignment in assignments
    )
    for raw_point_key, raw_point in connection_points_source.items():
        point_key = clean_text(raw_point_key)[:220]
        if not point_key or not valid_point_prefixes or not point_key.startswith(valid_point_prefixes):
            continue
        connection_points[point_key] = normalize_fiber_mapping_connection_point(raw_point)
    return {
        "nodes": nodes,
        "edges": edges,
        "napSplitters": nap_splitters,
        "junctionBoxes": junction_boxes,
        "containerSplitters": container_splitters,
        "containerSplitterAssignments": container_splitter_assignments,
        "connectionPoints": connection_points,
        "fiberLinkSettings": normalize_fiber_link_settings(source.get("fiberLinkSettings")),
        "updatedAt": clean_text(source.get("updatedAt")),
    }


def fiber_mapping_summary() -> dict[str, Any]:
    global fiber_mapping
    fiber_mapping = normalize_fiber_mapping(fiber_mapping)
    return json.loads(json.dumps(fiber_mapping))


def actor_name(admin: dict[str, Any]) -> str:
    return clean_text(admin.get("username") or admin.get("full_name") or admin.get("id") or "network-user")


def next_code(prefix: str, rows: list[dict[str, Any]]) -> str:
    return f"{prefix}-{len(rows) + 1:04d}"


def normalize_display_order(value: Any, fallback: int = 0) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = int(fallback or 0)
    return max(0, number)


def display_order_sort_value(row: dict[str, Any]) -> int:
    value = normalize_display_order(row.get("displayOrder"))
    return value if value > 0 else 1_000_000


def row_created_sort_value(row: dict[str, Any]) -> str:
    return clean_text(row.get("createdAt") or row.get("updatedAt") or row.get("name"))


def olt_sort_key(row: dict[str, Any]) -> tuple[int, str, str]:
    return (display_order_sort_value(row), row_created_sort_value(row), clean_text(row.get("name")))


def device_sort_key(row: dict[str, Any]) -> tuple[str, str, int, str, str]:
    return (
        clean_text(row.get("accessMethod")),
        clean_text(row.get("deviceType")),
        display_order_sort_value(row),
        row_created_sort_value(row),
        clean_text(row.get("name")),
    )


def next_display_order(rows: list[dict[str, Any]]) -> int:
    existing = [normalize_display_order(row.get("displayOrder")) for row in rows if not row.get("deletedAt")]
    return (max(existing) if existing else 0) + 1


def ordered_visible_olts() -> list[dict[str, Any]]:
    return sorted(visible_olts(), key=olt_sort_key)


def ordered_visible_devices() -> list[dict[str, Any]]:
    return sorted(visible_devices(), key=device_sort_key)


def ensure_display_orders() -> bool:
    changed = False
    for index, olt in enumerate(ordered_visible_olts(), start=1):
        if normalize_display_order(olt.get("displayOrder")) != index:
            olt["displayOrder"] = index
            changed = True
    device_groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for device in visible_devices():
        device_groups.setdefault((clean_text(device.get("accessMethod")), clean_text(device.get("deviceType"))), []).append(device)
    for devices in device_groups.values():
        ordered = sorted(devices, key=lambda item: (display_order_sort_value(item), row_created_sort_value(item), clean_text(item.get("name"))))
        for index, device in enumerate(ordered, start=1):
            if normalize_display_order(device.get("displayOrder")) != index:
                device["displayOrder"] = index
                changed = True
    return changed


def visible_olts() -> list[dict[str, Any]]:
    return [row for row in olts if not row.get("deletedAt")]


def visible_pons() -> list[dict[str, Any]]:
    return [row for row in pon_ports if not row.get("deletedAt")]


def visible_naps() -> list[dict[str, Any]]:
    return [row for row in nap_boxes if not row.get("deletedAt")]


def visible_fbts() -> list[dict[str, Any]]:
    return [row for row in fbts if not row.get("deletedAt")]


def visible_fiber_optic_losses() -> list[dict[str, Any]]:
    return [row for row in fiber_optic_losses if not row.get("deletedAt")]


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
    return find_row(fbts, fbt_id, "Splitter")


def find_fiber_optic_loss(loss_id: str) -> dict[str, Any]:
    return find_row(fiber_optic_losses, loss_id, "Fiber optic loss profile")


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
        raise HTTPException(status_code=400, detail="Splitter slot/port number already exists for this NAP")


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


def adjust_hex_color(hex_color: str, amount: int) -> str:
    normalized = normalize_hex_color(hex_color, PON_COLOR_BASES[0]).lstrip("#")
    channels = [int(normalized[index : index + 2], 16) for index in range(0, 6, 2)]
    adjusted = [max(0, min(255, channel + amount)) for channel in channels]
    return f"#{adjusted[0]:02X}{adjusted[1]:02X}{adjusted[2]:02X}"


def default_pon_color(port_number: Any) -> str:
    try:
        number = max(1, int(port_number or 1))
    except (TypeError, ValueError):
        number = 1
    base = PON_COLOR_BASES[(number - 1) % len(PON_COLOR_BASES)]
    family_index = (number - 1) // len(PON_COLOR_BASES)
    if family_index <= 0:
        return base
    amount = ((family_index + 1) // 2) * 18
    if family_index % 2:
        amount *= -1
    return adjust_hex_color(base, amount)


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
    record["displayOrder"] = normalize_display_order(record.get("displayOrder"))
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
    record["colorHex"] = normalize_hex_color(record.get("colorHex"), default_pon_color(record["portNumber"]))
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
    record = {
        "moduleVendor": clean_text(data.get("moduleVendor")),
        "moduleRxPowerDbm": clean_text(data.get("moduleRxPowerDbm")),
        "moduleSource": clean_text(data.get("moduleSource")),
        "modulePartNumber": "",
        "moduleSerial": "",
        "moduleHardwareRev": "",
        "moduleTxPowerDbm": "",
        "moduleTemperatureC": "",
        "moduleVoltageV": "",
        "moduleBiasCurrentMa": "",
        "moduleEntityIndex": "",
    }
    has_power_data = bool(record["moduleVendor"] or record["moduleRxPowerDbm"])
    if has_power_data:
        record["moduleSource"] = clean_text(record.get("moduleSource")) or "Manual"
    else:
        record["moduleSource"] = ""
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


def normalize_splitter_ratio(value: Any, default: str, allowed: list[str] | None = None) -> str:
    normalized = clean_text(value).upper().replace("X", ":").replace("/", ":")
    return ensure_choice(normalized or default, allowed or SPLITTER_RATIOS, "splitter ratio", default)


def splitter_ratio_choices_for_type(splitter_type: str) -> list[str]:
    if splitter_type == "PLC":
        return PLC_SPLITTER_RATIOS
    if splitter_type == "LCP":
        return LCP_SPLITTER_RATIOS
    return SPLITTER_RATIOS


def normalize_fbt_split_ratio(value: Any, default: str = "5:95") -> str:
    normalized = clean_text(value).upper().replace("X", ":").replace("/", ":")
    if not normalized:
        return default
    if not re.match(r"^\d{1,3}\s*:\s*\d{1,3}$", normalized):
        raise HTTPException(status_code=400, detail="Invalid FBT split ratio")
    left, right = [int(part.strip()) for part in normalized.split(":", 1)]
    if left <= 0 or right <= 0 or left + right > 1000:
        raise HTTPException(status_code=400, detail="Invalid FBT split ratio")
    return f"{left}:{right}"


def splitter_output_ports_from_ratio(split_ratio: str) -> int:
    normalized = clean_text(split_ratio).replace("x", ":").replace("X", ":")
    if ":" not in normalized:
        return 0
    left, right = normalized.split(":", 1)
    if left.strip() == "1":
        try:
            return int(right.strip())
        except ValueError:
            return 0
    return 2


def normalize_splitter_port_losses(split_ratio: str, rows: Any, legacy_loss: Any = "") -> list[dict[str, Any]]:
    output_ports = splitter_output_ports_from_ratio(split_ratio) or 1
    existing: dict[int, dict[str, Any]] = {}
    if isinstance(rows, list):
        for item in rows:
            if not isinstance(item, dict):
                continue
            try:
                port_number = int(item.get("portNumber") or 0)
            except (TypeError, ValueError):
                port_number = 0
            if port_number > 0:
                existing[port_number] = item

    fallback_loss = clean_text(legacy_loss)
    normalized: list[dict[str, Any]] = []
    for port_number in range(1, output_ports + 1):
        row = existing.get(port_number, {})
        normalized.append({
            "id": clean_text(row.get("id")) or f"port-{port_number}",
            "portNumber": port_number,
            "insertionLossDb": clean_text(row.get("insertionLossDb")) or fallback_loss,
        })
    return normalized


def normalize_splitter_ratio_profiles(
    splitter_type: str,
    profiles: Any,
    record: dict[str, Any],
    default_ratio: str,
) -> list[dict[str, Any]]:
    if splitter_type not in PORT_LOSS_SPLITTER_TYPES:
        return []
    allowed = splitter_ratio_choices_for_type(splitter_type)
    existing: dict[str, dict[str, Any]] = {}

    if isinstance(profiles, list):
        for item in profiles:
            if not isinstance(item, dict):
                continue
            raw_ratio = clean_text(item.get("splitRatio") or item.get("ratio"))
            if not raw_ratio:
                continue
            ratio = normalize_splitter_ratio(raw_ratio, default_ratio, allowed)
            output_ports = splitter_output_ports_from_ratio(ratio) or SPLITTER_DEFAULTS[splitter_type]["outputPorts"]
            existing[ratio] = {
                "id": clean_text(item.get("id")) or f"ratio-{ratio.replace(':', '-')}",
                "splitRatio": ratio,
                "ratio": ratio,
                "outputPorts": output_ports,
                "portCapacity": output_ports,
                "portLosses": normalize_splitter_port_losses(ratio, item.get("portLosses"), item.get("insertionLossDb")),
            }

    legacy_ratio = normalize_splitter_ratio(record.get("splitRatio"), default_ratio, allowed)
    if legacy_ratio not in existing:
        output_ports = splitter_output_ports_from_ratio(legacy_ratio) or SPLITTER_DEFAULTS[splitter_type]["outputPorts"]
        existing[legacy_ratio] = {
            "id": f"ratio-{legacy_ratio.replace(':', '-')}",
            "splitRatio": legacy_ratio,
            "ratio": legacy_ratio,
            "outputPorts": output_ports,
            "portCapacity": output_ports,
            "portLosses": normalize_splitter_port_losses(legacy_ratio, record.get("portLosses"), record.get("insertionLossDb")),
        }

    normalized: list[dict[str, Any]] = []
    used: set[str] = set()
    for ratio in allowed:
        profile = existing.get(ratio)
        if not profile:
            continue
        normalized.append(profile)
        used.add(ratio)
    for ratio, profile in existing.items():
        if ratio not in used:
            normalized.append(profile)
    return normalized


def normalize_fbt_ratio_rows(rows: Any, record: dict[str, Any], default_ratio: str) -> list[dict[str, Any]]:
    existing: dict[str, dict[str, Any]] = {}
    if isinstance(rows, list):
        for item in rows:
            if not isinstance(item, dict):
                continue
            ratio = normalize_fbt_split_ratio(item.get("ratio") or item.get("splitRatio"), "")
            if not ratio:
                continue
            existing[ratio] = {
                "id": clean_text(item.get("id")) or f"ratio-{ratio.replace(':', '-')}",
                "ratio": ratio,
                "isCustom": bool(item.get("isCustom")) or ratio not in FBT_SPLIT_RATIOS,
                **{field_name: clean_text(item.get(field_name)) for field_name in FBT_LOSS_FIELDS},
            }

    legacy_losses = {field_name: clean_text(record.get(field_name)) for field_name in FBT_LOSS_FIELDS}
    legacy_ratio = normalize_fbt_split_ratio(record.get("splitRatio"), default_ratio)
    if any(legacy_losses.values()) and legacy_ratio not in existing:
        existing[legacy_ratio] = {
            "id": f"ratio-{legacy_ratio.replace(':', '-')}",
            "ratio": legacy_ratio,
            "isCustom": legacy_ratio not in FBT_SPLIT_RATIOS,
            **legacy_losses,
        }

    normalized: list[dict[str, Any]] = []
    used: set[str] = set()
    for ratio in FBT_SPLIT_RATIOS:
        row = existing.get(ratio, {})
        normalized.append({
            "id": clean_text(row.get("id")) or f"ratio-{ratio.replace(':', '-')}",
            "ratio": ratio,
            "isCustom": False,
            **{field_name: clean_text(row.get(field_name)) for field_name in FBT_LOSS_FIELDS},
        })
        used.add(ratio)

    for ratio, row in existing.items():
        if ratio in used:
            continue
        normalized.append({
            "id": clean_text(row.get("id")) or f"custom-{ratio.replace(':', '-')}",
            "ratio": ratio,
            "isCustom": True,
            **{field_name: clean_text(row.get(field_name)) for field_name in FBT_LOSS_FIELDS},
        })

    return normalized


def normalize_fbt_payload(payload: FbtPayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    record = dict(current or {})
    record.update({key: value for key, value in data.items() if value is not None})
    record["splitterType"] = ensure_choice(record.get("splitterType"), SPLITTER_TYPES, "splitter type", "FBT")
    defaults = SPLITTER_DEFAULTS.get(record["splitterType"], SPLITTER_DEFAULTS["FBT"])
    manufacturer = clean_text(record.get("manufacturer") or record.get("brand"))
    if not manufacturer:
        raise HTTPException(status_code=400, detail="Manufacturer / company is required")
    record["manufacturer"] = manufacturer
    record["brand"] = manufacturer
    record["model"] = clean_text(record.get("model"))
    record["name"] = clean_text(record.get("name")) or " ".join(
        part for part in [manufacturer, record["model"], record["splitterType"]] if part
    )
    record["napBoxId"] = clean_text(record.get("napBoxId"))
    if record["napBoxId"]:
        find_nap(record["napBoxId"])
        record["portNumber"] = int(record.get("portNumber") or next_fbt_number(record["napBoxId"]))
        unique_fbt_port(record["napBoxId"], record["portNumber"], record.get("id"))
    else:
        record["portNumber"] = int(record.get("portNumber") or 1)
    record["splitRatio"] = (
        normalize_fbt_split_ratio(record.get("splitRatio"), defaults["splitRatio"])
        if record["splitterType"] == "FBT"
        else normalize_splitter_ratio(
            record.get("splitRatio"),
            defaults["splitRatio"],
            splitter_ratio_choices_for_type(record["splitterType"]),
        )
    )
    if record["splitterType"] == "FBT":
        record["ratioRows"] = normalize_fbt_ratio_rows(record.get("ratioRows"), record, record["splitRatio"])
        record["splitRatio"] = record["ratioRows"][0]["ratio"] if record["ratioRows"] else record["splitRatio"]
        record["ratioProfiles"] = []
        record["portLosses"] = []
    else:
        record["ratioRows"] = []
        record["ratioProfiles"] = normalize_splitter_ratio_profiles(record["splitterType"], record.get("ratioProfiles"), record, record["splitRatio"])
        record["splitRatio"] = record["ratioProfiles"][0]["splitRatio"] if record["ratioProfiles"] else record["splitRatio"]
    derived_outputs = splitter_output_ports_from_ratio(record["splitRatio"])
    if record["splitterType"] in PORT_LOSS_SPLITTER_TYPES:
        record["inputPorts"] = 1
        record["outputPorts"] = derived_outputs or defaults["outputPorts"]
        record["portCapacity"] = record["outputPorts"]
        record["portLosses"] = (
            record["ratioProfiles"][0]["portLosses"]
            if record["ratioProfiles"]
            else normalize_splitter_port_losses(record["splitRatio"], record.get("portLosses"), record.get("insertionLossDb"))
        )
    else:
        record["inputPorts"] = int(record.get("inputPorts") or 1)
        record["outputPorts"] = int(record.get("outputPorts") or record.get("portCapacity") or derived_outputs or defaults["outputPorts"])
        record["portCapacity"] = int(record.get("portCapacity") or record["outputPorts"])
        record["portLosses"] = []
    record["insertionLossDb"] = clean_text(record.get("insertionLossDb"))
    record["connectorType"] = ensure_choice(record.get("connectorType"), SPLITTER_CONNECTOR_TYPES, "connector type", defaults["connectorType"])
    record["packageType"] = ensure_choice(record.get("packageType"), SPLITTER_PACKAGE_TYPES, "package type", defaults["packageType"])
    record["stage"] = ensure_choice(record.get("stage"), SPLITTER_STAGES, "splitter stage", defaults["stage"])
    record["serialNumber"] = clean_text(record.get("serialNumber"))
    for field_name in FBT_LOSS_FIELDS:
        record[field_name] = clean_text(record.get(field_name))
    record["lcpCabinet"] = clean_text(record.get("lcpCabinet"))
    record["lcpSlot"] = clean_text(record.get("lcpSlot"))
    record["status"] = ensure_choice(record.get("status"), FBT_STATUSES, "splitter status", "PLANNED")
    record["locationHint"] = clean_text(record.get("locationHint"))
    record["notes"] = clean_text(record.get("notes"))
    return record


def fiber_optic_loss_display_name(record: dict[str, Any]) -> str:
    core_count = clean_text(record.get("coreCount"))
    core_label = f"{core_count} Core" if core_count else ""
    label = " ".join(
        part
        for part in [
            clean_text(record.get("manufacturer")),
            clean_text(record.get("model")),
            core_label,
        ]
        if part
    )
    return label or clean_text(record.get("name")) or "Fiber Optic"


def normalize_fiber_optic_loss_payload(payload: FiberOpticLossPayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    record = dict(current or {})
    record.update({key: value for key, value in data.items() if value is not None})
    record["manufacturer"] = clean_text(record.get("manufacturer"))
    if not record["manufacturer"]:
        raise HTTPException(status_code=400, detail="Manufacturer / company is required")
    record["model"] = clean_text(record.get("model"))
    record["fiberType"] = clean_text(record.get("fiberType"))
    fallback_core_count = fiber_core_count_from_groups(record.get("colorGroups")) or 12
    record["coreCount"] = normalize_fiber_core_count(record.get("coreCount"), fallback_core_count, strict="coreCount" in data)
    record["colorGroups"] = normalize_fiber_color_groups(record.get("colorGroups"), record["coreCount"], fiber_color_settings_summary())
    for field_name in FIBER_OPTIC_LOSS_FIELDS:
        record[field_name] = clean_text(record.get(field_name))
    if not any(record.get(field_name) for field_name in FIBER_OPTIC_LOSS_FIELDS):
        raise HTTPException(status_code=400, detail="At least one wavelength loss value is required")
    record["name"] = fiber_optic_loss_display_name(record)
    record["status"] = ensure_choice(record.get("status"), FIBER_OPTIC_STATUSES, "fiber optic status", "ACTIVE")
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
    record["displayOrder"] = normalize_display_order(record.get("displayOrder"))
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
    next_color = normalize_hex_color(row.get("colorHex"), default_pon_color(row.get("portNumber")))
    if row.get("colorHex") != next_color:
        row["colorHex"] = next_color
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
    device_display_order = normalize_display_order(device.get("displayOrder"))
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
            "displayOrder": device_display_order or next_display_order(visible_olts()),
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
        if device_display_order:
            olt["displayOrder"] = device_display_order
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
        "colorHex": default_pon_color(port_number),
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
    color_hex = normalize_hex_color(pon.get("colorHex"), default_pon_color(pon.get("portNumber")))
    return {
        **pon,
        "label": display_label,
        "colorHex": color_hex,
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
    pon_color_hex = normalize_hex_color(pon.get("colorHex"), default_pon_color(pon.get("portNumber")))
    return {
        **nap,
        "ponLabel": pon_label,
        "ponColorHex": pon_color_hex,
        "oltId": olt["id"],
        "oltName": olt["name"],
        "oltVendor": clean_text(olt.get("vendor")),
        "fbtCount": len(nap_fbts),
        "availableFbtSlots": max(0, int(nap.get("portCapacity") or 0) - len(nap_fbts)),
    }


def fbt_summary(fbt: dict[str, Any]) -> dict[str, Any]:
    splitter_type = ensure_choice(fbt.get("splitterType"), SPLITTER_TYPES, "splitter type", "FBT")
    split_ratio = clean_text(fbt.get("splitRatio")) or SPLITTER_DEFAULTS[splitter_type]["splitRatio"]
    if splitter_type in PORT_LOSS_SPLITTER_TYPES:
        try:
            split_ratio = normalize_splitter_ratio(
                split_ratio,
                SPLITTER_DEFAULTS[splitter_type]["splitRatio"],
                splitter_ratio_choices_for_type(splitter_type),
            )
        except HTTPException:
            split_ratio = SPLITTER_DEFAULTS[splitter_type]["splitRatio"]
    ratio_rows = normalize_fbt_ratio_rows(fbt.get("ratioRows"), fbt, split_ratio) if splitter_type == "FBT" else []
    ratio_profiles = normalize_splitter_ratio_profiles(splitter_type, fbt.get("ratioProfiles"), fbt, split_ratio) if splitter_type in PORT_LOSS_SPLITTER_TYPES else []
    if ratio_profiles:
        split_ratio = ratio_profiles[0]["splitRatio"]
    if splitter_type in PORT_LOSS_SPLITTER_TYPES:
        output_ports = splitter_output_ports_from_ratio(split_ratio) or SPLITTER_DEFAULTS[splitter_type]["outputPorts"]
    else:
        output_ports = int(fbt.get("outputPorts") or fbt.get("portCapacity") or splitter_output_ports_from_ratio(split_ratio) or SPLITTER_DEFAULTS[splitter_type]["outputPorts"])
    port_losses = ratio_profiles[0]["portLosses"] if ratio_profiles else (normalize_splitter_port_losses(split_ratio, fbt.get("portLosses"), fbt.get("insertionLossDb")) if splitter_type in PORT_LOSS_SPLITTER_TYPES else [])
    nap: dict[str, Any] | None = None
    pon: dict[str, Any] | None = None
    olt: dict[str, Any] | None = None
    nap_box_id = clean_text(fbt.get("napBoxId"))
    if nap_box_id:
        try:
            nap = find_nap(nap_box_id)
            pon = find_pon(nap["ponPortId"])
            olt = find_olt(pon["oltId"])
        except HTTPException:
            nap = None
            pon = None
            olt = None
    pon_label = canonical_pon_label(pon) if pon else ""
    return {
        **fbt,
        "splitterType": splitter_type,
        "splitRatio": ratio_rows[0]["ratio"] if ratio_rows else split_ratio,
        "ratioRows": ratio_rows,
        "ratioProfiles": ratio_profiles,
        "portLosses": port_losses,
        "inputPorts": 1 if splitter_type in PORT_LOSS_SPLITTER_TYPES else int(fbt.get("inputPorts") or 1),
        "outputPorts": output_ports,
        "portCapacity": output_ports if splitter_type in PORT_LOSS_SPLITTER_TYPES else int(fbt.get("portCapacity") or output_ports),
        "insertionLossDb": clean_text(fbt.get("insertionLossDb")),
        "connectorType": clean_text(fbt.get("connectorType")) or SPLITTER_DEFAULTS[splitter_type]["connectorType"],
        "packageType": clean_text(fbt.get("packageType")) or SPLITTER_DEFAULTS[splitter_type]["packageType"],
        "stage": clean_text(fbt.get("stage")) or SPLITTER_DEFAULTS[splitter_type]["stage"],
        "manufacturer": clean_text(fbt.get("manufacturer") or fbt.get("brand")),
        "brand": clean_text(fbt.get("manufacturer") or fbt.get("brand")),
        "model": clean_text(fbt.get("model")),
        "serialNumber": clean_text(fbt.get("serialNumber")),
        **{field_name: clean_text(fbt.get(field_name)) for field_name in FBT_LOSS_FIELDS},
        "lcpCabinet": clean_text(fbt.get("lcpCabinet")),
        "lcpSlot": clean_text(fbt.get("lcpSlot")),
        "napName": nap["name"] if nap else "",
        "ponPortId": pon["id"] if pon else "",
        "ponLabel": pon_label,
        "oltId": olt["id"] if olt else "",
        "oltName": olt["name"] if olt else "",
        "oltVendor": clean_text(olt.get("vendor")) if olt else "",
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


def fiber_optic_loss_summary(row: dict[str, Any]) -> dict[str, Any]:
    fallback_core_count = fiber_core_count_from_groups(row.get("colorGroups")) or 12
    core_count = normalize_fiber_core_count(row.get("coreCount"), fallback_core_count)
    color_groups = normalize_fiber_color_groups(row.get("colorGroups"), core_count, fiber_color_settings_summary())
    return {
        **row,
        "name": fiber_optic_loss_display_name({**row, "coreCount": core_count}),
        "manufacturer": clean_text(row.get("manufacturer")),
        "model": clean_text(row.get("model")),
        "fiberType": clean_text(row.get("fiberType")),
        "coreCount": core_count,
        "colorGroups": color_groups,
        "colorGroupCount": len(color_groups),
        **{field_name: clean_text(row.get(field_name)) for field_name in FIBER_OPTIC_LOSS_FIELDS},
        "status": ensure_choice(row.get("status"), FIBER_OPTIC_STATUSES, "fiber optic status", "ACTIVE"),
        "notes": clean_text(row.get("notes")),
    }


def device_summary(device: dict[str, Any]) -> dict[str, Any]:
    hidden_fields = SECRET_DEVICE_FIELDS - {"apiPassword"}
    sanitized = {key: value for key, value in device.items() if key not in hidden_fields}
    if device.get("accessMethod") != "API":
        sanitized["apiPassword"] = ""
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
    splitters = [fbt_summary(row) for row in visible_fbts()]
    return {
        "olts": len(visible_olts()),
        "pon_ports": len(visible_pons()),
        "nap_boxes": len(visible_naps()),
        "fbts": len(visible_fbts()),
        "splitters": len(splitters),
        "plc_splitters": sum(1 for row in splitters if row.get("splitterType") == "PLC"),
        "lcp_splitters": sum(1 for row in splitters if row.get("splitterType") == "LCP"),
        "fbt_splitters": sum(1 for row in splitters if row.get("splitterType") == "FBT"),
        "fiber_optic_loss_profiles": len(visible_fiber_optic_losses()),
        "fiber_mapping_naps": sum(1 for key in fiber_mapping_summary().get("nodes", {}) if key.startswith("nap:")),
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
        "ponColorPalette": PON_COLOR_BASES,
        "adminStatuses": ADMIN_STATUSES,
        "operationalStatuses": OPER_STATUS,
        "napStatuses": NAP_STATUSES,
        "napSplitterRatios": NAP_SPLITTER_RATIOS,
        "fbtStatuses": FBT_STATUSES,
        "splitterStatuses": FBT_STATUSES,
        "splitterTypes": SPLITTER_TYPES,
        "plcSplitterRatios": PLC_SPLITTER_RATIOS,
        "lcpSplitterRatios": LCP_SPLITTER_RATIOS,
        "splitterRatios": SPLITTER_RATIOS,
        "fbtSplitRatios": FBT_SPLIT_RATIOS,
        "wavelengthsNm": WAVELENGTHS_NM,
        "fiberOpticStatuses": FIBER_OPTIC_STATUSES,
        "fiberCoreCountOptions": FIBER_CORE_COUNT_OPTIONS,
        "fiberColorSettings": fiber_color_settings_summary(),
        "splitterPackageTypes": SPLITTER_PACKAGE_TYPES,
        "splitterConnectorTypes": SPLITTER_CONNECTOR_TYPES,
        "splitterStages": SPLITTER_STAGES,
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
        "purpose": "ISP network source-of-truth for OLTs, generated PON ports, NAP boxes, and PLC/LCP/FBT splitter assignments.",
        "implementedNow": [
            "Network Settings app-shell navigation.",
            "OLT CRUD with default PON generation.",
            "PON CRUD under an OLT with delete safeguards.",
            "NAP CRUD assigned to a PON.",
            "Splitter CRUD for PLC, LCP, and FBT records assigned to a NAP box.",
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
        "recentFiberOpticLosses": [
            fiber_optic_loss_summary(row)
            for row in sorted(visible_fiber_optic_losses(), key=lambda item: item["updatedAt"], reverse=True)[:6]
        ],
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
    return sorted(rows, key=device_sort_key)


@router.post("/devices")
def create_network_device(payload: DevicePayload, admin=Depends(require_admin)):
    seed_network_settings_data()
    record = normalize_device_payload(payload)
    test_mikrotik_api_reachability(record)
    timestamp = now_iso()
    if not normalize_display_order(record.get("displayOrder")):
        scope = [
            device
            for device in visible_devices()
            if device.get("accessMethod") == record["accessMethod"] and device.get("deviceType") == record["deviceType"]
        ]
        record["displayOrder"] = next_display_order(scope)
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


@router.patch("/devices/order")
def reorder_network_devices(payload: DeviceOrderPayload, admin=Depends(require_admin)):
    seed_network_settings_data()
    method = normalize_upper(payload.accessMethod)
    device_type = normalize_upper(payload.deviceType)
    if method and method not in DEVICE_ACCESS_METHODS:
        raise HTTPException(status_code=400, detail="Invalid device access method")
    if device_type and device_type not in DEVICE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid device type")
    ordered_ids = clean_unique_texts(payload.orderedIds)
    scope_devices = [
        device
        for device in visible_devices()
        if (not method or device.get("accessMethod") == method)
        and (not device_type or device.get("deviceType") == device_type)
    ]
    scope_by_id = {device["id"]: device for device in scope_devices}
    invalid_ids = [device_id for device_id in ordered_ids if device_id not in scope_by_id]
    if invalid_ids:
        raise HTTPException(status_code=400, detail="Device order includes records outside the selected scope")
    requested = set(ordered_ids)
    ordered_scope = [scope_by_id[device_id] for device_id in ordered_ids]
    ordered_scope.extend(device for device in sorted(scope_devices, key=device_sort_key) if device["id"] not in requested)
    timestamp = now_iso()
    linked_olt_count = 0
    for index, device in enumerate(ordered_scope, start=1):
        device["displayOrder"] = index
        device["updatedAt"] = timestamp
        if is_olt_snmp_device(device):
            linked_olt = find_captured_olt(device)
            if linked_olt is not None:
                linked_olt["displayOrder"] = index
                linked_olt["updatedAt"] = timestamp
                linked_olt_count += 1
    add_audit(
        "network_device_order_updated",
        "NetworkDevice",
        method or "ALL",
        {"deviceType": device_type or "ALL", "orderedCount": len(ordered_scope), "linkedOlts": linked_olt_count},
        actor_name(admin),
    )
    save_network_settings_data()
    return {
        "devices": [device_summary(device) for device in sorted(visible_devices(), key=device_sort_key)],
        "olts": [olt_summary(olt) for olt in sorted(visible_olts(), key=olt_sort_key)],
    }


@router.patch("/devices/{device_id}")
def update_network_device(device_id: str, payload: DevicePayload, admin=Depends(require_admin)):
    seed_network_settings_data()
    current = find_device(device_id)
    record = normalize_device_payload(payload, current)
    test_mikrotik_api_reachability(record)
    current.update(record)
    current["updatedAt"] = now_iso()
    if is_olt_snmp_device(current):
        linked_olt = find_captured_olt(current)
        if linked_olt is not None and normalize_display_order(current.get("displayOrder")):
            linked_olt["displayOrder"] = normalize_display_order(current.get("displayOrder"))
            linked_olt["updatedAt"] = current["updatedAt"]
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
            "displayOrder": normalize_display_order(current.get("displayOrder")) or next_display_order(visible_olts()),
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
                "displayOrder": normalize_display_order(current.get("displayOrder")) or normalize_display_order(olt.get("displayOrder")),
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
    return sorted(rows, key=olt_sort_key)


@router.post("/olts")
def create_olt(payload: OltPayload, admin=Depends(require_admin)):
    seed_network_settings_data()
    record = normalize_olt_payload(payload)
    timestamp = now_iso()
    if not normalize_display_order(record.get("displayOrder")):
        record["displayOrder"] = next_display_order(visible_olts())
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


@router.patch("/olts/{olt_id}/pons/power")
def update_olt_pon_power(olt_id: str, payload: PonPowerPayload, admin=Depends(require_admin)):
    seed_network_settings_data()
    olt = find_olt(olt_id)
    record = normalize_pon_power_payload(payload)
    timestamp = now_iso()
    updated = []
    for pon in pon_rows_for_olt(olt_id):
        pon.update(record)
        pon["updatedAt"] = timestamp
        updated.append(pon)
    add_audit(
        "network_olt_pon_power_updated",
        "NetworkOlt",
        olt["id"],
        {"name": olt["name"], "updatedPons": len(updated), "source": record.get("moduleSource", "")},
        actor_name(admin),
    )
    save_network_settings_data()
    return {
        "status": "ok",
        "oltId": olt["id"],
        "updatedPons": len(updated),
        "pons": [pon_summary(pon) for pon in sorted(updated, key=lambda item: item["portNumber"])],
    }


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
        raise HTTPException(status_code=400, detail="Delete or move assigned splitter records before deleting this NAP")
    timestamp = now_iso()
    current["deletedAt"] = timestamp
    current["updatedAt"] = timestamp
    add_audit("network_nap_deleted", "NetworkNapBox", current["id"], {"name": current["name"]}, actor_name(admin))
    save_network_settings_data()
    return {"status": "ok"}


@router.get("/fbts")
def list_fbts(search: str = "", napBoxId: str = "", splitterType: str = "", admin=Depends(require_admin)):
    seed_network_settings_data()
    normalized_type = normalize_upper(splitterType)
    if normalized_type and normalized_type not in SPLITTER_TYPES:
        raise HTTPException(status_code=400, detail="Invalid splitter type")
    rows = [
        summary
        for row in visible_fbts()
        for summary in [fbt_summary(row)]
        if (not napBoxId or row["napBoxId"] == napBoxId)
        and (not normalized_type or summary["splitterType"] == normalized_type)
        and matches_search({**row, **summary}, search)
    ]
    return sorted(rows, key=lambda item: item["updatedAt"], reverse=True)


@router.post("/fbts")
def create_fbt(payload: FbtPayload, admin=Depends(require_admin)):
    seed_network_settings_data()
    record = normalize_fbt_payload(payload)
    timestamp = now_iso()
    fbt = {"id": str(uuid4()), "createdAt": timestamp, "updatedAt": timestamp, "deletedAt": None, **record}
    fbts.append(fbt)
    add_audit("network_splitter_created", "NetworkSplitter", fbt["id"], {"name": fbt["name"], "napBoxId": fbt["napBoxId"], "type": fbt["splitterType"]}, actor_name(admin))
    save_network_settings_data()
    return fbt_summary(fbt)


@router.patch("/fbts/{fbt_id}")
def update_fbt(fbt_id: str, payload: FbtPayload, admin=Depends(require_admin)):
    seed_network_settings_data()
    current = find_fbt(fbt_id)
    record = normalize_fbt_payload(payload, current)
    current.update(record)
    current["updatedAt"] = now_iso()
    add_audit("network_splitter_updated", "NetworkSplitter", current["id"], {"name": current["name"], "type": current["splitterType"]}, actor_name(admin))
    save_network_settings_data()
    return fbt_summary(current)


@router.delete("/fbts/{fbt_id}")
def delete_fbt(fbt_id: str, admin=Depends(require_admin)):
    seed_network_settings_data()
    current = find_fbt(fbt_id)
    timestamp = now_iso()
    current["deletedAt"] = timestamp
    current["updatedAt"] = timestamp
    add_audit("network_splitter_deleted", "NetworkSplitter", current["id"], {"name": current["name"], "type": current.get("splitterType", "FBT")}, actor_name(admin))
    save_network_settings_data()
    return {"status": "ok"}


@router.get("/fiber-optic-settings")
def get_fiber_optic_settings(admin=Depends(require_admin)):
    seed_network_settings_data()
    return {
        "coreCountOptions": FIBER_CORE_COUNT_OPTIONS,
        "colorSettings": fiber_color_settings_summary(),
    }


@router.patch("/fiber-optic-settings")
def update_fiber_optic_settings(payload: FiberColorSettingsPayload, admin=Depends(require_admin)):
    global fiber_color_settings
    seed_network_settings_data()
    data = fiber_color_settings_summary()
    data.update(payload.model_dump(exclude_unset=True))
    fiber_color_settings = normalize_fiber_color_settings(data)
    add_audit(
        "network_fiber_optic_settings_updated",
        "NetworkFiberOpticSettings",
        "fiber-optic",
        {"standardName": fiber_color_settings["standardName"]},
        actor_name(admin),
    )
    save_network_settings_data()
    return {
        "coreCountOptions": FIBER_CORE_COUNT_OPTIONS,
        "colorSettings": fiber_color_settings_summary(),
    }


@router.get("/fiber-optic-losses")
def list_fiber_optic_losses(search: str = "", admin=Depends(require_admin)):
    seed_network_settings_data()
    rows = [
        fiber_optic_loss_summary(row)
        for row in visible_fiber_optic_losses()
        if matches_search(row, search)
    ]
    return sorted(rows, key=lambda item: item["updatedAt"], reverse=True)


@router.post("/fiber-optic-losses")
def create_fiber_optic_loss(payload: FiberOpticLossPayload, admin=Depends(require_admin)):
    seed_network_settings_data()
    record = normalize_fiber_optic_loss_payload(payload)
    timestamp = now_iso()
    row = {"id": str(uuid4()), "createdAt": timestamp, "updatedAt": timestamp, "deletedAt": None, **record}
    fiber_optic_losses.append(row)
    add_audit("network_fiber_optic_loss_created", "NetworkFiberOpticLoss", row["id"], {"name": row["name"], "manufacturer": row["manufacturer"]}, actor_name(admin))
    save_network_settings_data()
    return fiber_optic_loss_summary(row)


@router.patch("/fiber-optic-losses/{loss_id}")
def update_fiber_optic_loss(loss_id: str, payload: FiberOpticLossPayload, admin=Depends(require_admin)):
    seed_network_settings_data()
    current = find_fiber_optic_loss(loss_id)
    record = normalize_fiber_optic_loss_payload(payload, current)
    current.update(record)
    current["updatedAt"] = now_iso()
    add_audit("network_fiber_optic_loss_updated", "NetworkFiberOpticLoss", current["id"], {"name": current["name"], "manufacturer": current["manufacturer"]}, actor_name(admin))
    save_network_settings_data()
    return fiber_optic_loss_summary(current)


@router.delete("/fiber-optic-losses/{loss_id}")
def delete_fiber_optic_loss(loss_id: str, admin=Depends(require_admin)):
    seed_network_settings_data()
    current = find_fiber_optic_loss(loss_id)
    timestamp = now_iso()
    current["deletedAt"] = timestamp
    current["updatedAt"] = timestamp
    add_audit("network_fiber_optic_loss_deleted", "NetworkFiberOpticLoss", current["id"], {"name": current["name"], "manufacturer": current.get("manufacturer", "")}, actor_name(admin))
    save_network_settings_data()
    return {"status": "ok"}


@router.get("/fiber-mapping")
def get_fiber_mapping(admin=Depends(require_admin)):
    seed_network_settings_data()
    return fiber_mapping_summary()


@router.patch("/fiber-mapping")
def update_fiber_mapping(payload: FiberMappingPayload, admin=Depends(require_admin)):
    global fiber_mapping
    seed_network_settings_data()
    data = payload.model_dump()
    data["updatedAt"] = now_iso()
    fiber_mapping = normalize_fiber_mapping(data)
    add_audit(
        "network_fiber_mapping_updated",
        "NetworkFiberMapping",
        "fiber-mapping",
        {
            "nodes": len(fiber_mapping.get("nodes", {})),
            "edges": len(fiber_mapping.get("edges", {})),
            "napSplitters": len(fiber_mapping.get("napSplitters", {})),
            "junctionBoxes": len(fiber_mapping.get("junctionBoxes", {})),
            "containerSplitters": len(fiber_mapping.get("containerSplitters", {})),
            "containerSplitterAssignments": len(fiber_mapping.get("containerSplitterAssignments", {})),
            "connectionPoints": len(fiber_mapping.get("connectionPoints", {})),
        },
        actor_name(admin),
    )
    save_network_settings_data()
    return fiber_mapping_summary()
