import base64
import binascii
import hashlib
import json
import os
import secrets
import smtplib
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field


router = APIRouter(tags=["system-settings"])

_current_admin: Callable[[str | None], dict[str, Any]] | None = None
_audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None] | None = None
_settings: dict[str, Any] | None = None
_port_registry: Callable[[], list[dict[str, Any]]] | None = None
_locations: list[dict[str, Any]] = []
_deleted_default_location_fingerprints: set[tuple[str, str, str, str]] = set()
_system_settings_persistence_loaded = False


class SettingsPayload(BaseModel):
    branding: dict[str, Any] | None = None
    business: dict[str, Any] | None = None
    deployment: dict[str, Any] | None = None


class LocationPayload(BaseModel):
    location_name: str | None = None
    address: str | None = None
    municipality: str | None = None
    barangay: str | None = None
    province: str | None = None
    region: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    geocode_source: str | None = None
    raw_geocode: dict[str, Any] | None = None
    notes: str | None = None


class LocationPatchPayload(BaseModel):
    location_name: str | None = None
    address: str | None = None
    municipality: str | None = None
    barangay: str | None = None
    province: str | None = None
    region: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    geocode_source: str | None = None
    raw_geocode: dict[str, Any] | None = None
    notes: str | None = None


class LocationBulkDeletePayload(BaseModel):
    ids: list[str] = Field(default_factory=list, min_length=1)


class AvatarUploadPayload(BaseModel):
    data_url: str = Field(..., max_length=1_500_000)
    file_name: str | None = None
    mime_type: str | None = None


class MapImageUploadPayload(BaseModel):
    data_url: str = Field(..., max_length=800_000)
    file_name: str | None = None
    mime_type: str | None = None


class AvatarEmotionSettingsPayload(BaseModel):
    thresholds: dict[str, int | float] | None = None
    weights: dict[str, int | float] | None = None


class OpenAISettingsPayload(BaseModel):
    api_key: str | None = Field(default=None, max_length=400)
    clear_api_key: bool = False
    selected_model: str | None = Field(default=None, max_length=80)
    reasoning_effort: str | None = Field(default=None, max_length=20)
    organization_id: str | None = Field(default=None, max_length=200)
    project_id: str | None = Field(default=None, max_length=200)


class OpenAITestPayload(BaseModel):
    prompt: str = Field(default="Reply with one short sentence confirming this API key works.", max_length=4000)
    model_id: str | None = Field(default=None, max_length=80)
    reasoning_effort: str | None = Field(default=None, max_length=20)
    max_output_tokens: int = Field(default=120, ge=16, le=512)


class AccessSmtpPayload(BaseModel):
    host: str | None = Field(default=None, max_length=160)
    port: int | None = Field(default=587, ge=1, le=65535)
    username: str | None = Field(default=None, max_length=160)
    password: str | None = Field(default=None, max_length=400)
    clearPassword: bool = False
    fromEmail: str | None = Field(default=None, max_length=160)
    fromName: str | None = Field(default=None, max_length=120)
    useTls: bool = True
    useSsl: bool = False


class AccessAuthSettingsPayload(BaseModel):
    enabled: bool = True
    sessionIdleHours: int = Field(default=8, ge=1, le=72)
    auditRetentionDays: int = Field(default=180, ge=30, le=3650)
    smtp: AccessSmtpPayload = Field(default_factory=AccessSmtpPayload)


class AccessEmailTestPayload(BaseModel):
    recipientEmail: str | None = Field(default=None, max_length=160)


class AccessRolePayload(BaseModel):
    name: str = Field(..., min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=240)
    permissionCodes: list[str] = Field(default_factory=list)


class AccessUserPayload(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=60)
    email: str | None = Field(default=None, max_length=160)
    fullName: str | None = Field(default=None, max_length=120)
    roleId: str | None = Field(default=None, max_length=80)
    password: str | None = Field(default=None, min_length=8, max_length=128)
    isActive: bool = True
    mustChangePassword: bool = False


class AccessResetPasswordPayload(BaseModel):
    newPassword: str | None = Field(default=None, min_length=8, max_length=128)
    emailTemporaryPassword: bool = False


ALLOWED_AVATAR_MIME_TYPES = {
    "image/png": "PNG",
    "image/jpeg": "JPG/JPEG",
    "image/webp": "WebP",
    "image/gif": "GIF",
}
MAX_AVATAR_BYTES = 1_048_576
ALLOWED_MAP_IMAGE_MIME_TYPES = {
    "image/png": "PNG",
    "image/jpeg": "JPG/JPEG",
    "image/webp": "WebP",
}
MAX_MAP_IMAGE_BYTES = 524_288
MAP_IMAGE_TARGETS = [
    {
        "id": "nap",
        "label": "NAP Box",
        "description": "Marker shown for NAP boxes on the Network Settings map.",
        "recommended_size": "128 x 128 px",
    },
    {
        "id": "olt",
        "label": "OLT",
        "description": "Marker shown for OLT devices on the Network Settings map.",
        "recommended_size": "160 x 160 px",
    },
]
AVATAR_GENDERS = [
    {"id": "male", "label": "Male"},
    {"id": "female", "label": "Female"},
]
AVATAR_EMOTIONS = [
    {
        "id": "neutral",
        "label": "Neutral",
        "description": "Default avatar for normal customer profile viewing.",
    },
    {
        "id": "happy",
        "label": "Happy",
        "description": "Use when service is active, paid, or the account has a good standing signal.",
    },
    {
        "id": "sad",
        "label": "Sad",
        "description": "Use for customer concerns, hardship notes, or unresolved support context.",
    },
    {
        "id": "angry",
        "label": "Angry",
        "description": "Use for escalated complaints or repeated poor-service reports.",
    },
    {
        "id": "offline",
        "label": "Offline",
        "description": "Use when a customer has no connection, an outage, or a suspended line.",
    },
    {
        "id": "support",
        "label": "Support",
        "description": "Use when a CSR, dispatcher, or technician is actively helping the customer.",
    },
    {
        "id": "maintenance",
        "label": "Maintenance",
        "description": "Use for tower work, scheduled maintenance, repair tickets, or field visits.",
    },
    {
        "id": "warning",
        "label": "Warning",
        "description": "Use for billing warnings, overdue notices, signal warnings, or account risk.",
    },
    {
        "id": "resolved",
        "label": "Resolved",
        "description": "Use after a complaint, ticket, or installation issue has been resolved.",
    },
]
DEFAULT_AVATAR_EMOTION_SETTINGS = {
    "thresholds": {
        "happy_min": 30,
        "warning_max": -15,
        "angry_max": -35,
    },
    "weights": {
        "customer_active": 10,
        "customer_pending": -6,
        "customer_inactive": -18,
        "customer_suspended": -35,
        "service_active": 18,
        "service_pending": -5,
        "service_suspended": -38,
        "service_disconnected": -45,
        "no_service_account": -10,
        "open_service_order": -12,
        "completed_service_order": 8,
        "overdue_billing": -30,
        "open_invoice": -10,
        "urgent_ticket": -35,
        "high_ticket": -22,
        "open_ticket": -16,
        "resolved_ticket": 14,
    },
}
AVATAR_EMOTION_GUIDE = [
    {
        "module": "Customer Profiling",
        "signal": "Customer account status",
        "description": "Active customers trend happy; pending, inactive, and suspended statuses reduce the mood score.",
    },
    {
        "module": "Service",
        "signal": "Service account and service order state",
        "description": "Active internet service improves mood. Suspended, disconnected, or open service orders reduce mood and can show support, maintenance, or offline avatars.",
    },
    {
        "module": "Billing",
        "signal": "Overdue balance and open invoices",
        "description": "Overdue balances and unpaid invoices push the customer toward warning or angry behavior.",
    },
    {
        "module": "Ticketing",
        "signal": "Open, urgent, or resolved tickets",
        "description": "Open and urgent tickets reduce mood; recently resolved tickets can show the resolved or happy avatar.",
    },
]

OPENAI_PRICING_SOURCE = {
    "label": "OpenAI API pricing",
    "url": "https://platform.openai.com/docs/pricing/",
    "checked_at": "2026-05-11",
    "unit": "USD per 1M tokens, Standard short-context pricing",
    "note": "Long-context, Batch, Flex, Priority, regional processing, tool, image, audio, and video pricing can differ.",
}
OPENAI_REASONING_EFFORTS = [
    {"id": "none", "label": "None", "description": "Fastest responses for models that support no explicit reasoning."},
    {"id": "minimal", "label": "Minimal", "description": "Very light reasoning for simple checks and short responses."},
    {"id": "low", "label": "Low", "description": "Lower latency and lower reasoning token use."},
    {"id": "medium", "label": "Medium", "description": "Default balance between speed, cost, and reasoning quality."},
    {"id": "high", "label": "High", "description": "More complete reasoning for complex tasks."},
    {"id": "xhigh", "label": "Extra high", "description": "Maximum supported reasoning effort for the hardest tasks."},
]
OPENAI_MODEL_OPTIONS = [
    {
        "id": "gpt-5.5",
        "label": "GPT-5.5",
        "category": "Flagship",
        "recommended_for": "Highest-quality customer workflows, complex automation, tool-heavy assistants, and long-context analysis.",
        "context_window": "1M",
        "max_output": "128K",
        "reasoning": "none, minimal, low, medium, high, xhigh",
        "reasoning_efforts": ["none", "minimal", "low", "medium", "high", "xhigh"],
        "prices": {"input": 5.00, "cached_input": 0.50, "output": 30.00},
    },
    {
        "id": "gpt-5.4",
        "label": "GPT-5.4",
        "category": "Balanced flagship",
        "recommended_for": "Balanced quality and cost for production ISP back-office assistance.",
        "context_window": "1M",
        "max_output": "128K",
        "reasoning": "none, minimal, low, medium, high, xhigh",
        "reasoning_efforts": ["none", "minimal", "low", "medium", "high", "xhigh"],
        "prices": {"input": 2.50, "cached_input": 0.25, "output": 15.00},
    },
    {
        "id": "gpt-5.4-mini",
        "label": "GPT-5.4 mini",
        "category": "Default ISP operations pick",
        "recommended_for": "Cost-conscious support drafting, summaries, classification, and routine customer/account tasks.",
        "context_window": "400K",
        "max_output": "128K",
        "reasoning": "none, minimal, low, medium, high, xhigh",
        "reasoning_efforts": ["none", "minimal", "low", "medium", "high", "xhigh"],
        "prices": {"input": 0.75, "cached_input": 0.075, "output": 4.50},
    },
    {
        "id": "gpt-5.4-nano",
        "label": "GPT-5.4 nano",
        "category": "Lowest cost",
        "recommended_for": "Simple labels, fast checks, short rewrites, and low-cost helper tasks.",
        "context_window": "400K",
        "max_output": "128K",
        "reasoning": "none, minimal, low, medium, high, xhigh",
        "reasoning_efforts": ["none", "minimal", "low", "medium", "high", "xhigh"],
        "prices": {"input": 0.20, "cached_input": 0.02, "output": 1.25},
    },
    {
        "id": "gpt-5.5-pro",
        "label": "GPT-5.5 pro",
        "category": "Premium reasoning",
        "recommended_for": "Rare high-stakes analysis where output quality matters more than speed or cost.",
        "context_window": "1M",
        "max_output": "128K",
        "reasoning": "high, xhigh",
        "reasoning_efforts": ["high", "xhigh"],
        "prices": {"input": 30.00, "cached_input": None, "output": 180.00},
    },
    {
        "id": "gpt-5.4-pro",
        "label": "GPT-5.4 pro",
        "category": "Premium balanced",
        "recommended_for": "High-effort analysis with lower cost than GPT-5.5 pro.",
        "context_window": "1M",
        "max_output": "128K",
        "reasoning": "high, xhigh",
        "reasoning_efforts": ["high", "xhigh"],
        "prices": {"input": 30.00, "cached_input": None, "output": 180.00},
    },
]
DEFAULT_OPENAI_MODEL = "gpt-5.4-mini"
DEFAULT_OPENAI_REASONING_EFFORT = "medium"

ACCESS_PASSWORD_MIN_LENGTH = 8
ACCESS_PERMISSION_SEEDS = [
    {
        "code": "system.settings.view",
        "label": "System Settings View",
        "description": "View shared System Settings pages.",
        "category": "System Settings",
    },
    {
        "code": "system.settings.edit",
        "label": "System Settings Edit",
        "description": "Edit branding, business profile, runtime, and related system settings.",
        "category": "System Settings",
    },
    {
        "code": "system.access.auth.view",
        "label": "Access Auth Settings View",
        "description": "View authentication, session, audit, and SMTP settings under Access.",
        "category": "Access",
    },
    {
        "code": "system.access.auth.edit",
        "label": "Access Auth Settings Edit",
        "description": "Edit authentication, session, audit, and SMTP settings under Access.",
        "category": "Access",
    },
    {
        "code": "system.access.permissions.view",
        "label": "Permission Catalog View",
        "description": "View the system-managed permission catalog.",
        "category": "Access",
    },
    {
        "code": "system.access.roles.view",
        "label": "Roles View",
        "description": "View roles and assigned permissions.",
        "category": "Access",
    },
    {
        "code": "system.access.roles.edit",
        "label": "Roles Edit",
        "description": "Create, edit, delete, and assign permissions to roles.",
        "category": "Access",
    },
    {
        "code": "system.access.users.view",
        "label": "Users View",
        "description": "View system login users.",
        "category": "Access",
    },
    {
        "code": "system.access.users.edit",
        "label": "Users Edit",
        "description": "Create, edit, activate, deactivate, reset passwords, and delete system login users.",
        "category": "Access",
    },
    {
        "code": "customer-profiling.view",
        "label": "Customer Profiling View",
        "description": "View Customer Profiling.",
        "category": "Customer Profiling",
    },
    {
        "code": "customer-profiling.edit",
        "label": "Customer Profiling Edit",
        "description": "Create and update customer profiles.",
        "category": "Customer Profiling",
    },
    {"code": "billing.view", "label": "Billing View", "description": "View Billing.", "category": "Billing"},
    {"code": "billing.edit", "label": "Billing Edit", "description": "Create and update Billing records.", "category": "Billing"},
    {"code": "point-of-sale.view", "label": "Point of Sale View", "description": "View Point of Sale.", "category": "Point of Sale"},
    {"code": "point-of-sale.edit", "label": "Point of Sale Edit", "description": "Create and update Point of Sale records.", "category": "Point of Sale"},
    {"code": "inventory.view", "label": "Inventory View", "description": "View Inventory.", "category": "Inventory"},
    {"code": "inventory.edit", "label": "Inventory Edit", "description": "Create and update Inventory records.", "category": "Inventory"},
    {"code": "service.view", "label": "Service View", "description": "View Service Catalog and Service Orders.", "category": "Service"},
    {"code": "service.edit", "label": "Service Edit", "description": "Create and update Service Catalog and Service Orders.", "category": "Service"},
    {"code": "ticketing.view", "label": "Ticketing View", "description": "View Ticketing.", "category": "Ticketing"},
    {"code": "ticketing.edit", "label": "Ticketing Edit", "description": "Create and update Ticketing records.", "category": "Ticketing"},
    {
        "code": "customer-service-management.view",
        "label": "Customer Service View",
        "description": "View customer-service workflows.",
        "category": "Customer Service",
    },
    {
        "code": "customer-service-management.edit",
        "label": "Customer Service Edit",
        "description": "Create and update customer-service workflows.",
        "category": "Customer Service",
    },
    {"code": "network-settings.view", "label": "Network Settings View", "description": "View network settings.", "category": "Network Settings"},
    {"code": "network-settings.edit", "label": "Network Settings Edit", "description": "Create and update network settings.", "category": "Network Settings"},
    {"code": "logs.view", "label": "Logs View", "description": "View audit and system logs.", "category": "Logs"},
    {
        "code": "account-admin.customer.view",
        "label": "Customer Account Admin View",
        "description": "View customer account administration when the module is implemented.",
        "category": "Customer Account Admin",
    },
    {
        "code": "account-admin.customer.edit",
        "label": "Customer Account Admin Edit",
        "description": "Edit customer account administration when the module is implemented.",
        "category": "Customer Account Admin",
    },
]
ACCESS_PERMISSION_DEPENDENCIES = {
    "system.settings.edit": ["system.settings.view"],
    "system.access.auth.edit": ["system.access.auth.view"],
    "system.access.roles.edit": ["system.access.roles.view", "system.access.permissions.view"],
    "system.access.users.edit": ["system.access.users.view", "system.access.roles.view"],
    "customer-profiling.edit": ["customer-profiling.view"],
    "billing.edit": ["billing.view"],
    "point-of-sale.edit": ["point-of-sale.view"],
    "inventory.edit": ["inventory.view"],
    "service.edit": ["service.view"],
    "ticketing.edit": ["ticketing.view"],
    "customer-service-management.edit": ["customer-service-management.view"],
    "network-settings.edit": ["network-settings.view"],
    "account-admin.customer.edit": ["account-admin.customer.view"],
}


DEFAULT_LOCATION_SEEDS = [
    ("ALIBAGO", "ENRILE", "CAGAYAN"),
    ("BARANGAY I", "ENRILE", "CAGAYAN"),
    ("BARANGAY II", "ENRILE", "CAGAYAN"),
    ("BARANGAY III", "ENRILE", "CAGAYAN"),
    ("BARANGAY III-A", "ENRILE", "CAGAYAN"),
    ("BARANGAY IV", "ENRILE", "CAGAYAN"),
    ("BATU", "ENRILE", "CAGAYAN"),
    ("DIVISORIA", "ENRILE", "CAGAYAN"),
    ("INGA", "ENRILE", "CAGAYAN"),
    ("LANNA", "ENRILE", "CAGAYAN"),
    ("LEMU NORTE", "ENRILE", "CAGAYAN"),
    ("LEMU SUR", "ENRILE", "CAGAYAN"),
    ("LIWAN NORTE", "ENRILE", "CAGAYAN"),
    ("LIWAN SUR", "ENRILE", "CAGAYAN"),
    ("MADDARULUG NORTE", "ENRILE", "CAGAYAN"),
    ("MADDARULUG SUR", "ENRILE", "CAGAYAN"),
    ("MAGALALAG EAST", "ENRILE", "CAGAYAN"),
    ("MAGALALAG WEST", "ENRILE", "CAGAYAN"),
    ("MARRACURU", "ENRILE", "CAGAYAN"),
    ("ROMA NORTE", "ENRILE", "CAGAYAN"),
    ("ROMA SUR", "ENRILE", "CAGAYAN"),
    ("SAN ANTONIO", "ENRILE", "CAGAYAN"),
    ("BANGAD", "SANTA MARIA", "ISABELA"),
    ("BUENAVISTA", "SANTA MARIA", "ISABELA"),
    ("CALAMAGUI EAST", "SANTA MARIA", "ISABELA"),
    ("CALAMAGUI NORTH", "SANTA MARIA", "ISABELA"),
    ("CALAMAGUI WEST", "SANTA MARIA", "ISABELA"),
    ("DIVISORIA", "SANTA MARIA", "ISABELA"),
    ("LINGALING", "SANTA MARIA", "ISABELA"),
    ("MOZZOZZIN NORTH", "SANTA MARIA", "ISABELA"),
    ("MOZZOZZIN SUR", "SANTA MARIA", "ISABELA"),
    ("NAGANACAN", "SANTA MARIA", "ISABELA"),
    ("POBLACION 1", "SANTA MARIA", "ISABELA"),
    ("POBLACION 2", "SANTA MARIA", "ISABELA"),
    ("POBLACION 3", "SANTA MARIA", "ISABELA"),
    ("POBLACION GK", "SANTA MARIA", "ISABELA"),
    ("POBLACION BLISS", "SANTA MARIA", "ISABELA"),
    ("QUINAGABIAN", "SANTA MARIA", "ISABELA"),
    ("SAN ANTONIO", "SANTA MARIA", "ISABELA"),
    ("SAN ISIDRO EAST", "SANTA MARIA", "ISABELA"),
    ("SAN ISIDRO WEST", "SANTA MARIA", "ISABELA"),
    ("SAN RAFAEL EAST", "SANTA MARIA", "ISABELA"),
    ("SAN RAFAEL WEST", "SANTA MARIA", "ISABELA"),
    ("VILLABUENA", "SANTA MARIA", "ISABELA"),
    ("AGGUB", "CABAGAN", "ISABELA"),
    ("ANNARONAN", "CABAGAN", "ISABELA"),
    ("ANAO", "CABAGAN", "ISABELA"),
    ("ANGANCASILIAN", "CABAGAN", "ISABELA"),
    ("BALASIG", "CABAGAN", "ISABELA"),
    ("CATABAYUNGAN", "CABAGAN", "ISABELA"),
    ("CENTRO", "CABAGAN", "ISABELA"),
    ("GARITA", "CABAGAN", "ISABELA"),
    ("LUQUILU", "CABAGAN", "ISABELA"),
    ("MAGLETICIA", "CABAGAN", "ISABELA"),
    ("MASIPI EAST", "CABAGAN", "ISABELA"),
    ("MASIPI WEST", "CABAGAN", "ISABELA"),
    ("NGARAG", "CABAGAN", "ISABELA"),
    ("SAN ANTONIO", "CABAGAN", "ISABELA"),
    ("SAN BERNARDO", "CABAGAN", "ISABELA"),
    ("SAN JUAN", "CABAGAN", "ISABELA"),
    ("SAN PABLO", "CABAGAN", "ISABELA"),
    ("SANTA MARIA", "CABAGAN", "ISABELA"),
    ("SARANAY", "CABAGAN", "ISABELA"),
    ("SAUI", "CABAGAN", "ISABELA"),
    ("TALLAG", "CABAGAN", "ISABELA"),
    ("UGAD", "CABAGAN", "ISABELA"),
    ("UNION", "CABAGAN", "ISABELA"),
    ("VILLAFLOR", "CABAGAN", "ISABELA"),
    ("VILLAHERMOSA", "CABAGAN", "ISABELA"),
    ("VILLA IMELDA", "CABAGAN", "ISABELA"),
    ("VILLA JESUSA", "CABAGAN", "ISABELA"),
]


def configure_system_settings(
    current_admin: Callable[[str | None], dict[str, Any]],
    audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None],
    settings_store: dict[str, Any],
    port_registry: Callable[[], list[dict[str, Any]]],
) -> None:
    global _current_admin, _audit_logger, _settings, _port_registry, _system_settings_persistence_loaded
    _current_admin = current_admin
    _audit_logger = audit_logger
    _settings = settings_store
    _port_registry = port_registry
    _system_settings_persistence_loaded = False


def require_admin(authorization: str | None = Header(default=None)):
    if _current_admin is None:
        raise HTTPException(status_code=500, detail="System Settings module is not configured")
    return _current_admin(authorization)


def settings_store() -> dict[str, Any]:
    if _settings is None:
        raise HTTPException(status_code=500, detail="System Settings store is not configured")
    return _settings


def system_settings_persistence_path() -> Path:
    return Path(os.getenv("SYSTEM_SETTINGS_DATA_PATH", "/app/data/system_settings.json"))


def avatar_persistence_path() -> Path:
    return system_settings_persistence_path()


def read_persisted_system_settings() -> dict[str, Any]:
    path = system_settings_persistence_path()
    if not path.exists():
        return {}
    try:
        persisted = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail="Stored System Settings data could not be loaded") from exc
    if not isinstance(persisted, dict):
        return {}
    return persisted


def load_persisted_system_settings() -> None:
    global _system_settings_persistence_loaded
    if _system_settings_persistence_loaded:
        return
    _system_settings_persistence_loaded = True
    persisted = read_persisted_system_settings()
    locations = persisted.get("locations")
    if isinstance(locations, list):
        _locations[:] = [normalize_persisted_location(location) for location in locations if isinstance(location, dict)]
    deleted_default_location_fingerprints = persisted.get("deleted_default_location_fingerprints")
    if isinstance(deleted_default_location_fingerprints, list):
        _deleted_default_location_fingerprints.clear()
        for fingerprint in deleted_default_location_fingerprints:
            normalized = normalize_location_fingerprint(fingerprint)
            if normalized:
                _deleted_default_location_fingerprints.add(normalized)
    avatar = persisted.get("avatar")
    if isinstance(avatar, dict):
        settings_store()["avatar"] = avatar
    openai = persisted.get("openai")
    if isinstance(openai, dict):
        settings_store()["openai"] = openai
    access = persisted.get("access")
    if isinstance(access, dict):
        settings_store()["access"] = normalize_access_store(access)
    map_images = persisted.get("mapImages")
    if isinstance(map_images, dict):
        settings_store()["mapImages"] = normalize_map_image_store(map_images)


def save_persisted_system_settings(*section_names: str) -> None:
    path = system_settings_persistence_path()
    try:
        persisted = read_persisted_system_settings()
        store = settings_store()
        for section_name in section_names:
            if section_name == "locations":
                persisted["locations"] = [persisted_location(location) for location in _locations]
                persisted["deleted_default_location_fingerprints"] = [
                    list(fingerprint) for fingerprint in sorted(_deleted_default_location_fingerprints)
                ]
            elif section_name == "access":
                persisted["access"] = access_store()
            else:
                persisted[section_name] = store.get(section_name, {})
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_name(f".{path.name}.tmp")
        temp_path.write_text(
            json.dumps(persisted, ensure_ascii=True, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        os.replace(temp_path, path)
    except OSError as exc:
        raise HTTPException(status_code=500, detail="System Settings data could not be saved to persistent storage") from exc


def save_persisted_avatar_store() -> None:
    save_persisted_system_settings("avatar")


def save_persisted_map_image_store() -> None:
    save_persisted_system_settings("mapImages")


def save_persisted_location_store() -> None:
    save_persisted_system_settings("locations")


def save_persisted_access_store() -> None:
    save_persisted_system_settings("access")


def normalize_access_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_access_role_name(value: Any) -> str:
    name = normalize_access_text(value).lower().replace(" ", "_")
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Role name must be at least 2 characters")
    return name


def access_default_auth_settings() -> dict[str, Any]:
    return {
        "enabled": True,
        "sessionIdleHours": 8,
        "auditRetentionDays": 180,
        "smtp": {
            "host": "",
            "port": 587,
            "username": "",
            "password": "",
            "fromEmail": "",
            "fromName": "3J ISP Management",
            "useTls": True,
            "useSsl": False,
        },
    }


def normalize_access_auth_settings(raw: dict[str, Any] | None) -> dict[str, Any]:
    merged = access_default_auth_settings()
    raw = raw if isinstance(raw, dict) else {}
    merged["enabled"] = bool(raw.get("enabled", merged["enabled"]))
    try:
        merged["sessionIdleHours"] = max(1, min(int(raw.get("sessionIdleHours", merged["sessionIdleHours"]) or 8), 72))
    except Exception:
        merged["sessionIdleHours"] = 8
    try:
        merged["auditRetentionDays"] = max(30, min(int(raw.get("auditRetentionDays", merged["auditRetentionDays"]) or 180), 3650))
    except Exception:
        merged["auditRetentionDays"] = 180
    smtp = raw.get("smtp") if isinstance(raw.get("smtp"), dict) else {}
    merged["smtp"].update(
        {
            "host": normalize_access_text(smtp.get("host")),
            "port": max(1, min(int(smtp.get("port") or 587), 65535)),
            "username": normalize_access_text(smtp.get("username")),
            "password": normalize_access_text(smtp.get("password")),
            "fromEmail": normalize_access_text(smtp.get("fromEmail")),
            "fromName": normalize_access_text(smtp.get("fromName")) or "3J ISP Management",
            "useTls": bool(smtp.get("useTls", True)),
            "useSsl": bool(smtp.get("useSsl", False)),
        }
    )
    return merged


def access_permission_codes() -> list[str]:
    return [permission["code"] for permission in ACCESS_PERMISSION_SEEDS]


def expand_access_permission_codes(codes: list[str]) -> tuple[list[str], list[str]]:
    allowed = set(access_permission_codes())
    selected: list[str] = []
    seen: set[str] = set()
    pending = [normalize_access_text(code) for code in codes or []]
    auto_added: list[str] = []
    while pending:
        code = pending.pop(0)
        if not code or code not in allowed or code in seen:
            continue
        seen.add(code)
        selected.append(code)
        for dependency in ACCESS_PERMISSION_DEPENDENCIES.get(code, []):
            if dependency not in seen:
                pending.append(dependency)
                auto_added.append(dependency)
    return sorted(selected, key=str.lower), sorted(set(auto_added), key=str.lower)


def normalize_access_store(raw: dict[str, Any] | None) -> dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    permission_codes = access_permission_codes()
    permission_map = {permission["code"]: dict(permission) for permission in ACCESS_PERMISSION_SEEDS}
    roles = raw.get("roles") if isinstance(raw.get("roles"), list) else []
    users = raw.get("users") if isinstance(raw.get("users"), list) else []
    normalized_roles = []
    for role in roles:
        if not isinstance(role, dict):
            continue
        role_id = normalize_access_text(role.get("id")) or f"role-{uuid4()}"
        name = normalize_access_text(role.get("name")).lower()
        if not name:
            continue
        expanded, _ = expand_access_permission_codes(role.get("permissionCodes") or [])
        normalized_roles.append(
            {
                "id": role_id,
                "name": name,
                "description": normalize_access_text(role.get("description")),
                "isBuiltin": bool(role.get("isBuiltin")),
                "isLocked": bool(role.get("isLocked")) or name == "owner",
                "permissionCodes": permission_codes if name == "owner" else expanded,
                "createdAt": normalize_access_text(role.get("createdAt")) or now_iso(),
                "updatedAt": normalize_access_text(role.get("updatedAt")) or now_iso(),
            }
        )
    role_names = {role["name"] for role in normalized_roles}
    default_roles = [
        {
            "id": "role-owner",
            "name": "owner",
            "description": "System owner. Full access and immutable permissions.",
            "isBuiltin": True,
            "isLocked": True,
            "permissionCodes": permission_codes,
        },
        {
            "id": "role-admin",
            "name": "admin",
            "description": "Full operational access except locked owner controls.",
            "isBuiltin": True,
            "isLocked": False,
            "permissionCodes": permission_codes,
        },
        {
            "id": "role-viewer",
            "name": "viewer",
            "description": "Read-only operator for dashboards and records.",
            "isBuiltin": True,
            "isLocked": False,
            "permissionCodes": [code for code in permission_codes if code.endswith(".view") or code.endswith(".permissions.view")],
        },
    ]
    for role in default_roles:
        if role["name"] not in role_names:
            timestamp = now_iso()
            normalized_roles.append({**role, "createdAt": timestamp, "updatedAt": timestamp})
    role_ids = {role["id"] for role in normalized_roles}
    normalized_users = []
    for user in users:
        if not isinstance(user, dict):
            continue
        user_id = normalize_access_text(user.get("id")) or f"user-{uuid4()}"
        username = normalize_access_text(user.get("username")).lower()
        if len(username) < 3:
            continue
        role_id = normalize_access_text(user.get("roleId"))
        if role_id not in role_ids:
            role_id = "role-viewer"
        normalized_users.append(
            {
                "id": user_id,
                "username": username,
                "email": normalize_access_text(user.get("email")).lower(),
                "fullName": normalize_access_text(user.get("fullName")),
                "roleId": role_id,
                "password": normalize_access_text(user.get("password")),
                "passwordHash": normalize_access_text(user.get("passwordHash")),
                "isActive": bool(user.get("isActive", True)),
                "mustChangePassword": bool(user.get("mustChangePassword")),
                "lastLoginAt": user.get("lastLoginAt"),
                "createdAt": normalize_access_text(user.get("createdAt")) or now_iso(),
                "updatedAt": normalize_access_text(user.get("updatedAt")) or now_iso(),
            }
        )
    if not normalized_users:
        timestamp = now_iso()
        normalized_users.append(
            {
                "id": os.getenv("DEFAULT_ADMIN_ID", "admin-1"),
                "username": os.getenv("DEFAULT_ADMIN_USERNAME", "admin").strip().lower() or "admin",
                "email": os.getenv("DEFAULT_ADMIN_EMAIL", "admin@example.local").strip().lower(),
                "fullName": os.getenv("DEFAULT_ADMIN_NAME", "System Administrator").strip() or "System Administrator",
                "roleId": "role-owner",
                "password": os.getenv("DEFAULT_ADMIN_PASSWORD", "admin123"),
                "passwordHash": "",
                "isActive": True,
                "mustChangePassword": False,
                "lastLoginAt": None,
                "createdAt": timestamp,
                "updatedAt": timestamp,
            }
        )
    return {
        "authSettings": normalize_access_auth_settings(raw.get("authSettings")),
        "permissions": list(permission_map.values()),
        "roles": normalized_roles,
        "users": normalized_users,
    }


def access_store() -> dict[str, Any]:
    load_persisted_system_settings()
    store = settings_store()
    access = normalize_access_store(store.get("access"))
    store["access"] = access
    return access


def public_access_auth_settings(settings: dict[str, Any]) -> dict[str, Any]:
    smtp = dict((settings or {}).get("smtp") or {})
    password = normalize_access_text(smtp.pop("password", ""))
    smtp["passwordConfigured"] = bool(password)
    return {**settings, "smtp": smtp}


def role_by_id(access: dict[str, Any], role_id: str) -> dict[str, Any]:
    for role in access.get("roles", []):
        if role["id"] == role_id:
            return role
    raise HTTPException(status_code=404, detail="Role not found")


def user_by_id(access: dict[str, Any], user_id: str) -> dict[str, Any]:
    for user in access.get("users", []):
        if user["id"] == user_id:
            return user
    raise HTTPException(status_code=404, detail="User not found")


def access_role_public(role: dict[str, Any], permissions: list[dict[str, Any]]) -> dict[str, Any]:
    codes = role.get("permissionCodes") or []
    by_code = {permission["code"]: permission for permission in permissions}
    groups: dict[str, list[str]] = {}
    for code in codes:
        permission = by_code.get(code)
        category = permission.get("category") if permission else "Other"
        groups.setdefault(category, []).append(code)
    permission_groups = [
        {"category": category, "codes": sorted(values, key=str.lower)}
        for category, values in sorted(groups.items(), key=lambda item: item[0].lower())
    ]
    preview = ", ".join(sorted(codes, key=str.lower)[:3])
    if len(codes) > 3:
        preview = f"{preview}, +{len(codes) - 3} more"
    return {
        **role,
        "permissionCount": len(codes),
        "permissionPreview": preview,
        "permissionGroups": permission_groups,
    }


def access_user_public(user: dict[str, Any], roles: list[dict[str, Any]]) -> dict[str, Any]:
    role = next((item for item in roles if item["id"] == user.get("roleId")), None)
    return {
        key: value
        for key, value in {
            **user,
            "roleName": role.get("name") if role else "",
            "password": None,
            "passwordConfigured": bool(user.get("password") or user.get("passwordHash")),
        }.items()
        if key != "passwordHash"
    }


def public_access_store(access: dict[str, Any]) -> dict[str, Any]:
    permissions = access.get("permissions", [])
    roles = [access_role_public(role, permissions) for role in access.get("roles", [])]
    users = [access_user_public(user, roles) for user in access.get("users", [])]
    return {
        "authSettings": public_access_auth_settings(access.get("authSettings", {})),
        "permissions": permissions,
        "permissionGroups": access_permission_groups(permissions),
        "roles": roles,
        "users": users,
        "metrics": {
            "permissions": len(permissions),
            "roles": len(roles),
            "users": len(users),
            "activeUsers": sum(1 for user in users if user.get("isActive")),
        },
    }


def access_permission_groups(permissions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for permission in permissions:
        grouped.setdefault(permission.get("category") or "Other", []).append(permission)
    return [
        {
            "category": category,
            "permissions": sorted(items, key=lambda item: item["code"].lower()),
        }
        for category, items in sorted(grouped.items(), key=lambda item: item[0].lower())
    ]


def hash_access_password(password: str) -> str:
    salt = secrets.token_hex(12)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"pbkdf2_sha256${salt}${digest.hex()}"


def generated_access_password(length: int = 14) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%+-"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def send_access_email(auth_settings: dict[str, Any], to_email: str, subject: str, body_text: str) -> None:
    smtp = auth_settings.get("smtp") if isinstance(auth_settings.get("smtp"), dict) else {}
    host = normalize_access_text(smtp.get("host"))
    if not host:
        raise HTTPException(status_code=400, detail="SMTP host is required before sending email")
    from_email = normalize_access_text(smtp.get("fromEmail")) or normalize_access_text(smtp.get("username"))
    if not from_email:
        raise HTTPException(status_code=400, detail="SMTP from email is required before sending email")
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = f"{normalize_access_text(smtp.get('fromName')) or '3J ISP Management'} <{from_email}>"
    message["To"] = to_email
    message.set_content(body_text)
    port = int(smtp.get("port") or 587)
    username = normalize_access_text(smtp.get("username"))
    password = normalize_access_text(smtp.get("password"))
    if smtp.get("useSsl"):
        client = smtplib.SMTP_SSL(host, port, timeout=12)
    else:
        client = smtplib.SMTP(host, port, timeout=12)
    try:
        if smtp.get("useTls") and not smtp.get("useSsl"):
            client.starttls()
        if username:
            client.login(username, password)
        client.send_message(message)
    finally:
        client.quit()


def avatar_store() -> dict[str, Any]:
    load_persisted_system_settings()
    store = settings_store()
    avatar = store.setdefault("avatar", {})
    old_emotions = avatar.setdefault("emotions", {})
    uploads = avatar.setdefault("uploads", {})
    for gender in AVATAR_GENDERS:
        uploads.setdefault(gender["id"], {})
    for emotion_id, record in list(old_emotions.items()):
        if isinstance(record, dict) and record.get("data_url"):
            uploads["male"].setdefault(emotion_id, record)
    avatar.setdefault("accepted_formats", list(ALLOWED_AVATAR_MIME_TYPES.values()))
    avatar.setdefault("max_bytes", MAX_AVATAR_BYTES)
    avatar.setdefault("emotion_settings", default_avatar_emotion_settings())
    return avatar


def normalize_map_image_store(raw: dict[str, Any] | None) -> dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    uploads = raw.get("uploads") if isinstance(raw.get("uploads"), dict) else {}
    normalized_uploads: dict[str, dict[str, Any]] = {}
    allowed_targets = {target["id"] for target in MAP_IMAGE_TARGETS}
    for target_id, record in uploads.items():
        target = normalize_location_text(target_id).lower()
        if target not in allowed_targets or not isinstance(record, dict):
            continue
        data_url = normalize_location_text(record.get("data_url"))
        mime_type = normalize_location_text(record.get("mime_type")).lower()
        if not data_url or mime_type not in ALLOWED_MAP_IMAGE_MIME_TYPES:
            continue
        normalized_uploads[target] = {
            "file_name": normalize_location_text(record.get("file_name"))[:180] or f"{target}-map-marker",
            "mime_type": mime_type,
            "byte_size": int(record.get("byte_size") or 0),
            "data_url": data_url,
            "updated_at": normalize_location_text(record.get("updated_at")),
            "updated_by_admin_id": normalize_location_text(record.get("updated_by_admin_id")),
            "updated_by_username": normalize_location_text(record.get("updated_by_username")),
        }
    return {"uploads": normalized_uploads}


def map_image_store() -> dict[str, Any]:
    load_persisted_system_settings()
    store = settings_store()
    map_images = normalize_map_image_store(store.setdefault("mapImages", {}))
    store["mapImages"] = map_images
    return map_images


def normalize_map_image_target(target_id: str) -> str:
    normalized = normalize_location_text(target_id).lower().replace("_", "-")
    allowed = {target["id"] for target in MAP_IMAGE_TARGETS}
    if normalized not in allowed:
        raise HTTPException(status_code=404, detail="Map image target not found")
    return normalized


def map_image_payload_summary(record: dict[str, Any] | None) -> dict[str, Any] | None:
    if not record:
        return None
    return {
        "file_name": record.get("file_name"),
        "mime_type": record.get("mime_type"),
        "byte_size": record.get("byte_size"),
        "data_url": record.get("data_url"),
        "updated_at": record.get("updated_at"),
        "updated_by_username": record.get("updated_by_username"),
    }


def public_map_image_settings() -> dict[str, Any]:
    store = map_image_store()
    uploads = store.get("uploads", {})
    return {
        "accepted_formats": list(ALLOWED_MAP_IMAGE_MIME_TYPES.values()),
        "accepted_mime_types": list(ALLOWED_MAP_IMAGE_MIME_TYPES.keys()),
        "max_bytes": MAX_MAP_IMAGE_BYTES,
        "guidelines": [
            "Use PNG or WebP for crisp transparent marker icons.",
            "Use JPG only for photo-like markers; transparent backgrounds are not preserved in JPG.",
            "Keep icons centered with safe padding so they remain readable at small map zoom levels.",
            "Recommended marker art is 128 x 128 px for NAP boxes and 160 x 160 px for OLT devices.",
            "Keep each image at or below 512 KB.",
        ],
        "targets": [
            {
                **target,
                "image": map_image_payload_summary(uploads.get(target["id"])),
            }
            for target in MAP_IMAGE_TARGETS
        ],
    }


def decode_map_image_data_url(payload: MapImageUploadPayload) -> tuple[str, bytes]:
    data_url = payload.data_url.strip()
    if not data_url.startswith("data:") or ";base64," not in data_url:
        raise HTTPException(status_code=400, detail="Map marker image must be uploaded as a base64 data URL")
    header, encoded = data_url.split(",", 1)
    mime_type = header[5:].split(";", 1)[0].strip().lower()
    if payload.mime_type and payload.mime_type.lower() != mime_type:
        raise HTTPException(status_code=400, detail="Map marker MIME type does not match the uploaded image")
    if mime_type not in ALLOWED_MAP_IMAGE_MIME_TYPES:
        raise HTTPException(status_code=400, detail="Accepted map marker formats are PNG, JPG/JPEG, and WebP")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Map marker image data is not valid base64") from exc
    if not raw:
        raise HTTPException(status_code=400, detail="Map marker image is empty")
    if len(raw) > MAX_MAP_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Map marker image must be 512 KB or smaller")
    return mime_type, raw


def add_audit(action: str, target_type: str, target_id: str, details: dict[str, Any] | None, actor: str) -> None:
    if _audit_logger is not None:
        _audit_logger(action, target_type, target_id, details, actor)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def sanitize_summary(value):
    if isinstance(value, dict):
        clean = {}
        for key, item in value.items():
            key_lower = key.lower()
            if any(word in key_lower for word in ["password", "secret", "token", "authorization", "csrf", "api_key", "apikey"]):
                clean[key] = "[REDACTED]"
            else:
                clean[key] = sanitize_summary(item)
        return clean
    if isinstance(value, list):
        return [sanitize_summary(item) for item in value[:20]]
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, str) and len(value) > 1200:
        return f"{value[:1200]}...[truncated]"
    return value


def normalize_avatar_emotion(emotion_id: str) -> str:
    normalized = normalize_location_text(emotion_id).lower().replace("_", "-")
    allowed = {emotion["id"] for emotion in AVATAR_EMOTIONS}
    if normalized not in allowed:
        raise HTTPException(status_code=404, detail="Avatar emotion not found")
    return normalized


def normalize_avatar_gender(gender_id: str) -> str:
    normalized = normalize_location_text(gender_id).lower().replace("_", "-")
    allowed = {gender["id"] for gender in AVATAR_GENDERS}
    if normalized not in allowed:
        raise HTTPException(status_code=404, detail="Avatar gender not found")
    return normalized


def default_avatar_emotion_settings() -> dict[str, Any]:
    return json.loads(json.dumps(DEFAULT_AVATAR_EMOTION_SETTINGS))


def normalized_avatar_emotion_settings(settings: dict[str, Any] | None) -> dict[str, Any]:
    merged = default_avatar_emotion_settings()
    if isinstance(settings, dict):
        for section in ["thresholds", "weights"]:
            values = settings.get(section)
            if isinstance(values, dict):
                for key in merged[section]:
                    if key in values:
                        merged[section][key] = clamp_emotion_number(values[key], section)
    return merged


def clamp_emotion_number(value: Any, section: str) -> int:
    try:
        numeric = int(round(float(value)))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Emotion guide values must be numeric") from None
    if section == "thresholds":
        return max(-100, min(100, numeric))
    return max(-75, min(75, numeric))


def avatar_payload_summary(record: dict[str, Any] | None) -> dict[str, Any] | None:
    if not record:
        return None
    return {
        "file_name": record.get("file_name"),
        "mime_type": record.get("mime_type"),
        "byte_size": record.get("byte_size"),
        "data_url": record.get("data_url"),
        "updated_at": record.get("updated_at"),
        "updated_by_username": record.get("updated_by_username"),
    }


def openai_model_by_id(model_id: str | None) -> dict[str, Any] | None:
    normalized = normalize_location_text(model_id)
    return next((model for model in OPENAI_MODEL_OPTIONS if model["id"] == normalized), None)


def normalize_openai_model(model_id: str | None) -> str:
    model = openai_model_by_id(model_id or DEFAULT_OPENAI_MODEL)
    if model is None:
        allowed = ", ".join(model["id"] for model in OPENAI_MODEL_OPTIONS)
        raise HTTPException(status_code=400, detail=f"Unknown OpenAI model. Choose one of: {allowed}")
    return model["id"]


def openai_reasoning_effort_ids_for_model(model_id: str | None) -> list[str]:
    model = openai_model_by_id(model_id)
    if not model:
        return [DEFAULT_OPENAI_REASONING_EFFORT]
    efforts = model.get("reasoning_efforts")
    if isinstance(efforts, list) and efforts:
        return [normalize_location_text(effort).lower() for effort in efforts if normalize_location_text(effort)]
    reasoning = normalize_location_text(model.get("reasoning"))
    return [effort.strip().lower() for effort in reasoning.split(",") if effort.strip()] or [DEFAULT_OPENAI_REASONING_EFFORT]


def default_openai_reasoning_effort(model_id: str | None) -> str:
    efforts = openai_reasoning_effort_ids_for_model(model_id)
    if DEFAULT_OPENAI_REASONING_EFFORT in efforts:
        return DEFAULT_OPENAI_REASONING_EFFORT
    return efforts[0]


def normalize_openai_reasoning_effort(model_id: str | None, effort_id: str | None, strict: bool = False) -> str:
    model = normalize_openai_model(model_id)
    efforts = openai_reasoning_effort_ids_for_model(model)
    effort = normalize_location_text(effort_id).lower().replace("_", "-")
    if not effort:
        return default_openai_reasoning_effort(model)
    if effort not in efforts:
        if strict:
            allowed = ", ".join(efforts)
            raise HTTPException(status_code=400, detail=f"Unsupported reasoning effort for {model}. Choose one of: {allowed}")
        return default_openai_reasoning_effort(model)
    return effort


def public_openai_reasoning_efforts(model_id: str | None) -> list[dict[str, Any]]:
    effort_ids = set(openai_reasoning_effort_ids_for_model(model_id))
    return [effort for effort in OPENAI_REASONING_EFFORTS if effort["id"] in effort_ids]


def mask_openai_api_key(api_key: str | None) -> str | None:
    value = normalize_location_text(api_key)
    if not value:
        return None
    if len(value) <= 10:
        return f"{value[:3]}..."
    return f"{value[:7]}...{value[-4:]}"


def openai_store() -> dict[str, Any]:
    load_persisted_system_settings()
    store = settings_store()
    openai = store.setdefault("openai", {})
    selected_model = normalize_location_text(openai.get("selected_model"))
    if not openai_model_by_id(selected_model):
        selected_model = DEFAULT_OPENAI_MODEL
    openai["selected_model"] = selected_model
    openai["reasoning_effort"] = normalize_openai_reasoning_effort(selected_model, openai.get("reasoning_effort"))
    openai.setdefault("organization_id", "")
    openai.setdefault("project_id", "")
    return openai


def public_openai_settings() -> dict[str, Any]:
    openai = openai_store()
    selected_model = normalize_openai_model(openai.get("selected_model"))
    selected_reasoning_effort = normalize_openai_reasoning_effort(selected_model, openai.get("reasoning_effort"))
    openai["reasoning_effort"] = selected_reasoning_effort
    return {
        "api_key_configured": bool(normalize_location_text(openai.get("api_key"))),
        "api_key_hint": mask_openai_api_key(openai.get("api_key")),
        "selected_model": selected_model,
        "selected_reasoning_effort": selected_reasoning_effort,
        "selected_model_config": openai_model_by_id(selected_model),
        "organization_id": normalize_location_text(openai.get("organization_id")),
        "project_id": normalize_location_text(openai.get("project_id")),
        "models": OPENAI_MODEL_OPTIONS,
        "reasoning_efforts": OPENAI_REASONING_EFFORTS,
        "selected_model_reasoning_efforts": public_openai_reasoning_efforts(selected_model),
        "pricing_source": OPENAI_PRICING_SOURCE,
    }


def extract_openai_response_text(response_data: dict[str, Any]) -> str:
    output_text = response_data.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()
    output = response_data.get("output")
    texts: list[str] = []
    if isinstance(output, list):
        for item in output:
            if not isinstance(item, dict):
                continue
            content = item.get("content")
            if isinstance(content, list):
                for part in content:
                    if not isinstance(part, dict):
                        continue
                    text = part.get("text")
                    if isinstance(text, str) and text.strip():
                        texts.append(text.strip())
    return "\n".join(texts).strip()


def public_avatar_settings() -> dict[str, Any]:
    store = avatar_store()
    uploaded = store.get("uploads", {})
    emotion_settings = normalized_avatar_emotion_settings(store.get("emotion_settings"))
    store["emotion_settings"] = emotion_settings
    return {
        "accepted_formats": list(ALLOWED_AVATAR_MIME_TYPES.values()),
        "accepted_mime_types": list(ALLOWED_AVATAR_MIME_TYPES.keys()),
        "max_bytes": MAX_AVATAR_BYTES,
        "genders": AVATAR_GENDERS,
        "emotion_settings": emotion_settings,
        "emotion_guide": AVATAR_EMOTION_GUIDE,
        "emotions": [
            {
                **emotion,
                "avatar": avatar_payload_summary(uploaded.get("male", {}).get(emotion["id"])),
                "avatars": {
                    gender["id"]: avatar_payload_summary(uploaded.get(gender["id"], {}).get(emotion["id"]))
                    for gender in AVATAR_GENDERS
                },
            }
            for emotion in AVATAR_EMOTIONS
        ],
    }


def decode_avatar_data_url(payload: AvatarUploadPayload) -> tuple[str, bytes]:
    data_url = payload.data_url.strip()
    if not data_url.startswith("data:") or ";base64," not in data_url:
        raise HTTPException(status_code=400, detail="Avatar must be uploaded as a base64 data URL")
    header, encoded = data_url.split(",", 1)
    mime_type = header[5:].split(";", 1)[0].strip().lower()
    if payload.mime_type and payload.mime_type.lower() != mime_type:
        raise HTTPException(status_code=400, detail="Avatar MIME type does not match the uploaded image")
    if mime_type not in ALLOWED_AVATAR_MIME_TYPES:
        raise HTTPException(status_code=400, detail="Accepted avatar formats are PNG, JPG/JPEG, WebP, and GIF")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Avatar image data is not valid base64") from exc
    if not raw:
        raise HTTPException(status_code=400, detail="Avatar image is empty")
    if len(raw) > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=400, detail="Avatar image must be 1 MB or smaller")
    return mime_type, raw


def public_location(location: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in location.items() if not key.startswith("_")}


def persisted_location(location: dict[str, Any]) -> dict[str, Any]:
    record = dict(public_location(location))
    fingerprint = normalize_location_fingerprint(location.get("_default_seed_fingerprint"))
    if fingerprint:
        record["_default_seed_fingerprint"] = list(fingerprint)
    return record


def normalize_location_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_key(value: Any) -> str:
    return normalize_location_text(value).upper()


def synthesize_address(data: dict[str, Any]) -> str:
    address = normalize_location_text(data.get("address"))
    if address:
        return address
    parts = [
        data.get("location_name"),
        data.get("barangay"),
        data.get("municipality"),
        data.get("province"),
    ]
    return ", ".join(normalize_location_text(part) for part in parts if normalize_location_text(part))


def location_fingerprint(data: dict[str, Any]) -> tuple[str, str, str, str]:
    return (
        normalize_key(synthesize_address(data)),
        normalize_key(data.get("municipality")),
        normalize_key(data.get("barangay")),
        normalize_key(data.get("province")),
    )


def normalize_location_fingerprint(value: Any) -> tuple[str, str, str, str] | None:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return None
    normalized = tuple(normalize_key(part) for part in value)
    if not any(normalized):
        return None
    return normalized


def normalize_persisted_location(location: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(location)
    fingerprint = normalize_location_fingerprint(normalized.get("_default_seed_fingerprint"))
    if fingerprint:
        normalized["_default_seed_fingerprint"] = fingerprint
    elif "_default_seed_fingerprint" in normalized:
        normalized.pop("_default_seed_fingerprint", None)
    return normalized


def default_location_seed(barangay: str, municipality: str, province: str) -> dict[str, Any]:
    return {
        "location_name": barangay,
        "address": f"{barangay}, {municipality}, {province}",
        "municipality": municipality,
        "barangay": barangay,
        "province": province,
        "region": "REGION II",
        "latitude": None,
        "longitude": None,
        "geocode_source": "PRELOADED",
        "raw_geocode": {},
        "notes": "Preloaded from existing Customer Profiling service-area values.",
    }


def default_location_fingerprints() -> set[tuple[str, str, str, str]]:
    return {
        location_fingerprint(default_location_seed(barangay, municipality, province))
        for barangay, municipality, province in DEFAULT_LOCATION_SEEDS
    }


def remember_deleted_default_location(location: dict[str, Any]) -> None:
    fingerprint = location.get("_default_seed_fingerprint") or location_fingerprint(location)
    if fingerprint in default_location_fingerprints():
        _deleted_default_location_fingerprints.add(fingerprint)


def find_matching_location(data: dict[str, Any]) -> dict[str, Any] | None:
    fingerprint = location_fingerprint(data)
    if not any(fingerprint):
        return None
    for location in _locations:
        if location_fingerprint(location) == fingerprint:
            return location
    return None


def find_location(location_id: str) -> dict[str, Any]:
    seed_default_locations()
    for location in _locations:
        if location["id"] == location_id:
            return location
    raise HTTPException(status_code=404, detail="Location not found")


def location_record_from_data(
    data: dict[str, Any],
    *,
    actor: dict[str, Any] | None = None,
    source: str = "MANUAL",
) -> dict[str, Any]:
    address = synthesize_address(data)
    if not address:
        raise HTTPException(status_code=400, detail="Address or location detail is required")

    created_at = now_iso()
    return {
        "id": str(uuid4()),
        "location_name": normalize_location_text(data.get("location_name")),
        "address": address,
        "municipality": normalize_location_text(data.get("municipality")),
        "barangay": normalize_location_text(data.get("barangay")),
        "province": normalize_location_text(data.get("province")),
        "region": normalize_location_text(data.get("region")),
        "latitude": data.get("latitude"),
        "longitude": data.get("longitude"),
        "geocode_source": normalize_location_text(data.get("geocode_source")) or source,
        "raw_geocode": sanitize_summary(data.get("raw_geocode") or {}),
        "notes": normalize_location_text(data.get("notes")),
        "created_by_admin_id": actor.get("id") if actor else None,
        "created_by_username": actor.get("username") if actor else "system",
        "created_at": created_at,
        "updated_at": created_at,
    }


def merge_missing_location_fields(location: dict[str, Any], data: dict[str, Any]) -> bool:
    changed = False
    for field in ["location_name", "address", "municipality", "barangay", "province", "region", "latitude", "longitude", "notes"]:
        incoming = data.get(field)
        if incoming not in (None, "") and location.get(field) in (None, ""):
            location[field] = incoming
            changed = True
    if data.get("geocode_source") and location.get("geocode_source") in (None, "", "PRELOADED"):
        location["geocode_source"] = data["geocode_source"]
        changed = True
    if data.get("raw_geocode") and not location.get("raw_geocode"):
        location["raw_geocode"] = sanitize_summary(data["raw_geocode"])
        changed = True
    if changed:
        location["updated_at"] = now_iso()
    return changed


def seed_default_locations() -> None:
    load_persisted_system_settings()
    for barangay, municipality, province in DEFAULT_LOCATION_SEEDS:
        seed = default_location_seed(barangay, municipality, province)
        seed_fingerprint = location_fingerprint(seed)
        if seed_fingerprint in _deleted_default_location_fingerprints:
            continue
        if find_matching_location(seed):
            continue
        location = location_record_from_data(seed, source="PRELOADED")
        location["_default_seed_fingerprint"] = seed_fingerprint
        _locations.append(location)


def ensure_location_record(data: dict[str, Any], actor: dict[str, Any] | None = None) -> dict[str, Any] | None:
    seed_default_locations()
    if data.get("locationId"):
        for location in _locations:
            if location["id"] == data["locationId"]:
                if merge_missing_location_fields(location, data):
                    save_persisted_location_store()
                return public_location(location)
    if not synthesize_address(data):
        return None
    existing = find_matching_location(data)
    if existing:
        if merge_missing_location_fields(existing, data):
            save_persisted_location_store()
        return public_location(existing)
    location = location_record_from_data(data, actor=actor, source=data.get("geocode_source") or "CUSTOMER_PROFILING")
    _locations.insert(0, location)
    save_persisted_location_store()
    if actor:
        add_audit(
            "system_location_created",
            "SystemLocation",
            location["id"],
            {"address": location["address"], "municipality": location["municipality"], "barangay": location["barangay"]},
            actor["username"],
        )
    return public_location(location)


def extract_geocode_suggestion(item: dict[str, Any]) -> dict[str, Any]:
    address = item.get("address") or {}
    municipality = (
        address.get("city")
        or address.get("town")
        or address.get("municipality")
        or address.get("county")
    )
    barangay = (
        address.get("village")
        or address.get("suburb")
        or address.get("neighbourhood")
        or address.get("quarter")
        or address.get("hamlet")
    )
    return {
        "display_name": item.get("display_name"),
        "address": item.get("display_name"),
        "municipality": municipality,
        "barangay": barangay,
        "province": address.get("state") or address.get("province"),
        "region": address.get("region"),
        "latitude": float(item["lat"]) if item.get("lat") else None,
        "longitude": float(item["lon"]) if item.get("lon") else None,
        "geocode_source": "NOMINATIM",
        "raw_geocode": sanitize_summary(item),
    }


@router.get("/api/system-settings/access")
def get_access(admin=Depends(require_admin)):
    return public_access_store(access_store())


@router.patch("/api/system-settings/access/auth-settings")
def update_access_auth_settings(payload: AccessAuthSettingsPayload, admin=Depends(require_admin)):
    access = access_store()
    current_smtp = access["authSettings"].get("smtp", {})
    incoming = payload.model_dump()
    smtp = incoming.get("smtp") or {}
    if smtp.get("clearPassword"):
        smtp["password"] = ""
    elif not normalize_access_text(smtp.get("password")):
        smtp["password"] = current_smtp.get("password", "")
    smtp.pop("clearPassword", None)
    incoming["smtp"] = smtp
    access["authSettings"] = normalize_access_auth_settings(incoming)
    save_persisted_access_store()
    add_audit(
        "system_access_auth_settings_updated",
        "SystemAccess",
        "auth-settings",
        {"enabled": access["authSettings"]["enabled"]},
        admin["username"],
    )
    return public_access_store(access)


@router.post("/api/system-settings/access/auth-settings/test-email")
def test_access_email(payload: AccessEmailTestPayload, admin=Depends(require_admin)):
    access = access_store()
    recipient = normalize_access_text(payload.recipientEmail) or normalize_access_text(admin.get("email"))
    if not recipient:
        raise HTTPException(status_code=400, detail="Recipient email is required")
    send_access_email(
        access["authSettings"],
        recipient,
        "3J ISP Management SMTP test",
        "SMTP test successful. This email was sent from System Settings -> Access.",
    )
    add_audit("system_access_smtp_tested", "SystemAccess", recipient, {"recipient": recipient}, admin["username"])
    return {"status": "ok", "message": f"SMTP test email sent to {recipient}."}


@router.post("/api/system-settings/access/roles")
def create_access_role(payload: AccessRolePayload, admin=Depends(require_admin)):
    access = access_store()
    name = normalize_access_role_name(payload.name)
    if any(role["name"].lower() == name.lower() for role in access["roles"]):
        raise HTTPException(status_code=400, detail="Role already exists")
    permission_codes, auto_added = expand_access_permission_codes(payload.permissionCodes)
    timestamp = now_iso()
    role = {
        "id": f"role-{uuid4()}",
        "name": name,
        "description": normalize_access_text(payload.description),
        "isBuiltin": False,
        "isLocked": False,
        "permissionCodes": permission_codes,
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }
    access["roles"].append(role)
    save_persisted_access_store()
    add_audit("system_access_role_created", "SystemRole", role["id"], {"name": name}, admin["username"])
    response = public_access_store(access)
    response["message"] = "Role created."
    response["autoAddedPermissionCodes"] = auto_added
    return response


@router.patch("/api/system-settings/access/roles/{role_id}")
def update_access_role(role_id: str, payload: AccessRolePayload, admin=Depends(require_admin)):
    access = access_store()
    role = role_by_id(access, role_id)
    if role.get("isLocked") or role.get("name") == "owner":
        raise HTTPException(status_code=400, detail="Owner role is locked")
    name = normalize_access_role_name(payload.name)
    if any(item["id"] != role_id and item["name"].lower() == name.lower() for item in access["roles"]):
        raise HTTPException(status_code=400, detail="Role name already exists")
    permission_codes, auto_added = expand_access_permission_codes(payload.permissionCodes)
    role.update(
        {
            "name": name,
            "description": normalize_access_text(payload.description),
            "permissionCodes": permission_codes,
            "updatedAt": now_iso(),
        }
    )
    save_persisted_access_store()
    add_audit("system_access_role_updated", "SystemRole", role["id"], {"name": name}, admin["username"])
    response = public_access_store(access)
    response["message"] = "Role updated."
    response["autoAddedPermissionCodes"] = auto_added
    return response


@router.delete("/api/system-settings/access/roles/{role_id}")
def delete_access_role(role_id: str, admin=Depends(require_admin)):
    access = access_store()
    role = role_by_id(access, role_id)
    if role.get("isBuiltin") or role.get("isLocked") or role.get("name") == "owner":
        raise HTTPException(status_code=400, detail="Built-in roles cannot be deleted")
    if any(user.get("roleId") == role_id for user in access["users"]):
        raise HTTPException(status_code=400, detail="Role is assigned to one or more users")
    access["roles"] = [item for item in access["roles"] if item["id"] != role_id]
    save_persisted_access_store()
    add_audit("system_access_role_deleted", "SystemRole", role_id, {"name": role["name"]}, admin["username"])
    return public_access_store(access)


@router.post("/api/system-settings/access/users")
def create_access_user(payload: AccessUserPayload, admin=Depends(require_admin)):
    access = access_store()
    username = normalize_access_text(payload.username).lower()
    if len(username) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters")
    if any(user["username"].lower() == username.lower() for user in access["users"]):
        raise HTTPException(status_code=400, detail="Username already exists")
    email = normalize_access_text(payload.email).lower()
    if email and any(user.get("email", "").lower() == email for user in access["users"]):
        raise HTTPException(status_code=400, detail="Email already exists")
    role = role_by_id(access, normalize_access_text(payload.roleId))
    password = normalize_access_text(payload.password)
    if len(password) < ACCESS_PASSWORD_MIN_LENGTH:
        raise HTTPException(status_code=400, detail=f"Password must be at least {ACCESS_PASSWORD_MIN_LENGTH} characters")
    timestamp = now_iso()
    user = {
        "id": f"user-{uuid4()}",
        "username": username,
        "email": email,
        "fullName": normalize_access_text(payload.fullName),
        "roleId": role["id"],
        "password": "",
        "passwordHash": hash_access_password(password),
        "isActive": bool(payload.isActive),
        "mustChangePassword": bool(payload.mustChangePassword),
        "lastLoginAt": None,
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }
    access["users"].append(user)
    save_persisted_access_store()
    add_audit("system_access_user_created", "SystemUser", user["id"], {"username": username, "role": role["name"]}, admin["username"])
    return public_access_store(access)


@router.patch("/api/system-settings/access/users/{user_id}")
def update_access_user(user_id: str, payload: AccessUserPayload, admin=Depends(require_admin)):
    access = access_store()
    user = user_by_id(access, user_id)
    current_role = role_by_id(access, user["roleId"])
    owner_user = current_role["name"] == "owner"
    role_id = normalize_access_text(payload.roleId) or user["roleId"]
    next_role = role_by_id(access, role_id)
    if owner_user and next_role["name"] != "owner":
        raise HTTPException(status_code=400, detail="Owner user role cannot be changed")
    if owner_user and not payload.isActive:
        raise HTTPException(status_code=400, detail="Owner user cannot be deactivated")
    email = normalize_access_text(payload.email).lower()
    if email and any(item["id"] != user_id and item.get("email", "").lower() == email for item in access["users"]):
        raise HTTPException(status_code=400, detail="Email already exists")
    user.update(
        {
            "email": email,
            "fullName": normalize_access_text(payload.fullName),
            "roleId": next_role["id"],
            "isActive": bool(payload.isActive),
            "mustChangePassword": bool(payload.mustChangePassword),
            "updatedAt": now_iso(),
        }
    )
    if payload.password:
        user["password"] = ""
        user["passwordHash"] = hash_access_password(payload.password)
        user["mustChangePassword"] = bool(payload.mustChangePassword)
    save_persisted_access_store()
    add_audit("system_access_user_updated", "SystemUser", user["id"], {"username": user["username"]}, admin["username"])
    return public_access_store(access)


@router.post("/api/system-settings/access/users/{user_id}/reset-password")
def reset_access_user_password(user_id: str, payload: AccessResetPasswordPayload, admin=Depends(require_admin)):
    access = access_store()
    user = user_by_id(access, user_id)
    password = normalize_access_text(payload.newPassword) or generated_access_password()
    if len(password) < ACCESS_PASSWORD_MIN_LENGTH:
        raise HTTPException(status_code=400, detail=f"Password must be at least {ACCESS_PASSWORD_MIN_LENGTH} characters")
    user["password"] = ""
    user["passwordHash"] = hash_access_password(password)
    user["mustChangePassword"] = True
    user["updatedAt"] = now_iso()
    email_sent = False
    if payload.emailTemporaryPassword:
        recipient = normalize_access_text(user.get("email"))
        if not recipient:
            raise HTTPException(status_code=400, detail="User has no email configured")
        send_access_email(
            access["authSettings"],
            recipient,
            "3J ISP Management temporary password",
            (
                "A temporary password was generated for your 3J ISP Management account.\n\n"
                f"Username: {user['username']}\n"
                f"Temporary password: {password}\n\n"
                "Sign in and change your password immediately."
            ),
        )
        email_sent = True
    save_persisted_access_store()
    add_audit("system_access_user_password_reset", "SystemUser", user["id"], {"username": user["username"], "emailSent": email_sent}, admin["username"])
    response = public_access_store(access)
    response["message"] = "Temporary password emailed." if email_sent else "Password reset."
    if not email_sent:
        response["temporaryPassword"] = password
    return response


@router.delete("/api/system-settings/access/users/{user_id}")
def delete_access_user(user_id: str, admin=Depends(require_admin)):
    access = access_store()
    user = user_by_id(access, user_id)
    role = role_by_id(access, user["roleId"])
    if user["id"] == admin.get("id"):
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    if role["name"] == "owner":
        raise HTTPException(status_code=400, detail="Owner user cannot be deleted")
    access["users"] = [item for item in access["users"] if item["id"] != user_id]
    save_persisted_access_store()
    add_audit("system_access_user_deleted", "SystemUser", user_id, {"username": user["username"]}, admin["username"])
    return public_access_store(access)


@router.get("/api/system-settings/settings")
@router.get("/api/system/settings")
def get_settings(admin=Depends(require_admin)):
    return settings_store()


@router.patch("/api/system-settings/settings")
@router.patch("/api/system/settings")
def update_settings(payload: SettingsPayload, admin=Depends(require_admin)):
    store = settings_store()
    changed = payload.model_dump(exclude_none=True)
    for section in ["branding", "business", "deployment"]:
        value = changed.get(section)
        if value is not None:
            store.setdefault(section, {}).update(value)
    add_audit("settings_updated", "system", "settings", {"sections": list(changed.keys())}, admin["username"])
    return store


@router.get("/api/system-settings/ports")
@router.get("/api/system/ports")
def ports(admin=Depends(require_admin)):
    if _port_registry is None:
        raise HTTPException(status_code=500, detail="System port registry is not configured")
    return _port_registry()


@router.get("/api/system-settings/openai")
def get_openai_settings(admin=Depends(require_admin)):
    return public_openai_settings()


@router.patch("/api/system-settings/openai")
def update_openai_settings(payload: OpenAISettingsPayload, admin=Depends(require_admin)):
    store = openai_store()
    data = payload.model_dump(exclude_unset=True)
    if data.get("clear_api_key"):
        store.pop("api_key", None)
    elif "api_key" in data:
        api_key = normalize_location_text(data.get("api_key"))
        if api_key:
            if not api_key.startswith("sk-"):
                raise HTTPException(status_code=400, detail="OpenAI API key should start with sk-")
            store["api_key"] = api_key

    model_id = normalize_openai_model(store.get("selected_model"))
    if "selected_model" in data and data.get("selected_model") is not None:
        model_id = normalize_openai_model(data.get("selected_model"))
        store["selected_model"] = model_id
    if "reasoning_effort" in data and data.get("reasoning_effort") is not None:
        store["reasoning_effort"] = normalize_openai_reasoning_effort(model_id, data.get("reasoning_effort"), strict=True)
    else:
        store["reasoning_effort"] = normalize_openai_reasoning_effort(model_id, store.get("reasoning_effort"))
    if "organization_id" in data:
        store["organization_id"] = normalize_location_text(data.get("organization_id"))
    if "project_id" in data:
        store["project_id"] = normalize_location_text(data.get("project_id"))

    save_persisted_system_settings("openai")
    add_audit(
        "system_openai_settings_updated",
        "SystemOpenAI",
        "openai",
        {
            "selected_model": store.get("selected_model"),
            "reasoning_effort": store.get("reasoning_effort"),
            "api_key_configured": bool(normalize_location_text(store.get("api_key"))),
            "organization_id_configured": bool(normalize_location_text(store.get("organization_id"))),
            "project_id_configured": bool(normalize_location_text(store.get("project_id"))),
        },
        admin["username"],
    )
    return public_openai_settings()


@router.post("/api/system-settings/openai/test")
def test_openai_settings(payload: OpenAITestPayload, admin=Depends(require_admin)):
    store = openai_store()
    api_key = normalize_location_text(store.get("api_key"))
    if not api_key:
        raise HTTPException(status_code=400, detail="Save an OpenAI API key before running a test")

    model_id = normalize_openai_model(payload.model_id or store.get("selected_model"))
    reasoning_effort = normalize_openai_reasoning_effort(
        model_id,
        payload.reasoning_effort or store.get("reasoning_effort"),
        strict=True,
    )
    prompt = normalize_location_text(payload.prompt)
    if not prompt:
        raise HTTPException(status_code=400, detail="Test prompt is required")

    request_body = {
        "model": model_id,
        "reasoning": {"effort": reasoning_effort},
        "input": prompt,
        "max_output_tokens": payload.max_output_tokens,
    }
    request_headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "User-Agent": "3JMain/0.1 system-settings-openai-test",
    }
    organization_id = normalize_location_text(store.get("organization_id"))
    project_id = normalize_location_text(store.get("project_id"))
    if organization_id:
        request_headers["OpenAI-Organization"] = organization_id
    if project_id:
        request_headers["OpenAI-Project"] = project_id

    started_at = time.perf_counter()
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(request_body).encode("utf-8"),
        headers=request_headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            response_data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw_body = exc.read().decode("utf-8", errors="replace")
        try:
            error_body = json.loads(raw_body)
            message = error_body.get("error", {}).get("message") or error_body.get("detail") or raw_body
        except json.JSONDecodeError:
            message = raw_body or str(exc)
        raise HTTPException(status_code=400, detail=f"OpenAI test failed: {message}") from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"OpenAI test failed: {exc}") from exc

    latency_ms = int(round((time.perf_counter() - started_at) * 1000))
    output_text = extract_openai_response_text(response_data)
    add_audit(
        "system_openai_tested",
        "SystemOpenAI",
        model_id,
        {"model": model_id, "reasoning_effort": reasoning_effort, "latency_ms": latency_ms, "usage": sanitize_summary(response_data.get("usage") or {})},
        admin["username"],
    )
    return {
        "status": "ok",
        "model": model_id,
        "reasoning_effort": reasoning_effort,
        "latency_ms": latency_ms,
        "response_id": response_data.get("id"),
        "output_text": output_text,
        "usage": response_data.get("usage"),
    }


@router.get("/api/system-settings/avatars")
def get_avatars(admin=Depends(require_admin)):
    return public_avatar_settings()


@router.get("/api/system-settings/map-images")
def get_map_images(admin=Depends(require_admin)):
    return public_map_image_settings()


@router.put("/api/system-settings/map-images/{target_id}")
def upload_map_image(target_id: str, payload: MapImageUploadPayload, admin=Depends(require_admin)):
    target = normalize_map_image_target(target_id)
    mime_type, raw = decode_map_image_data_url(payload)
    file_name = normalize_location_text(payload.file_name) or f"{target}-map-marker"
    record = {
        "file_name": file_name[:180],
        "mime_type": mime_type,
        "byte_size": len(raw),
        "data_url": payload.data_url.strip(),
        "updated_at": now_iso(),
        "updated_by_admin_id": admin.get("id"),
        "updated_by_username": admin.get("username"),
    }
    store = map_image_store()
    store["uploads"][target] = record
    save_persisted_map_image_store()
    add_audit(
        "system_map_image_uploaded",
        "SystemMapImage",
        target,
        {"target": target, "file_name": record["file_name"], "mime_type": mime_type, "byte_size": len(raw)},
        admin["username"],
    )
    return public_map_image_settings()


@router.delete("/api/system-settings/map-images/{target_id}")
def delete_map_image(target_id: str, admin=Depends(require_admin)):
    target = normalize_map_image_target(target_id)
    store = map_image_store()
    removed = store["uploads"].pop(target, None)
    if removed is None:
        raise HTTPException(status_code=404, detail="Map marker image not found")
    save_persisted_map_image_store()
    add_audit(
        "system_map_image_deleted",
        "SystemMapImage",
        target,
        {"target": target, "file_name": removed.get("file_name"), "mime_type": removed.get("mime_type")},
        admin["username"],
    )
    return public_map_image_settings()


@router.patch("/api/system-settings/avatar-emotion-settings")
def update_avatar_emotion_settings(payload: AvatarEmotionSettingsPayload, admin=Depends(require_admin)):
    store = avatar_store()
    current = normalized_avatar_emotion_settings(store.get("emotion_settings"))
    incoming = payload.model_dump(exclude_unset=True)
    for section in ["thresholds", "weights"]:
        values = incoming.get(section)
        if not isinstance(values, dict):
            continue
        for key, value in values.items():
            if key not in current[section]:
                raise HTTPException(status_code=400, detail=f"Unknown avatar emotion {section} key: {key}")
            current[section][key] = clamp_emotion_number(value, section)
    store["emotion_settings"] = current
    save_persisted_avatar_store()
    add_audit(
        "system_avatar_emotion_settings_updated",
        "SystemAvatar",
        "emotion-settings",
        current,
        admin["username"],
    )
    return public_avatar_settings()


@router.put("/api/system-settings/avatars/{gender_id}/{emotion_id}")
def upload_gender_avatar(gender_id: str, emotion_id: str, payload: AvatarUploadPayload, admin=Depends(require_admin)):
    gender = normalize_avatar_gender(gender_id)
    emotion = normalize_avatar_emotion(emotion_id)
    mime_type, raw = decode_avatar_data_url(payload)
    file_name = normalize_location_text(payload.file_name) or f"{gender}-{emotion}-avatar"
    record = {
        "file_name": file_name[:180],
        "mime_type": mime_type,
        "byte_size": len(raw),
        "data_url": payload.data_url.strip(),
        "updated_at": now_iso(),
        "updated_by_admin_id": admin.get("id"),
        "updated_by_username": admin.get("username"),
    }
    store = avatar_store()
    store["uploads"][gender][emotion] = record
    if gender == "male":
        store["emotions"][emotion] = record
    save_persisted_avatar_store()
    add_audit(
        "system_avatar_uploaded",
        "SystemAvatar",
        f"{gender}:{emotion}",
        {"gender": gender, "emotion": emotion, "file_name": record["file_name"], "mime_type": mime_type, "byte_size": len(raw)},
        admin["username"],
    )
    return public_avatar_settings()


@router.delete("/api/system-settings/avatars/{gender_id}/{emotion_id}")
def delete_gender_avatar(gender_id: str, emotion_id: str, admin=Depends(require_admin)):
    gender = normalize_avatar_gender(gender_id)
    emotion = normalize_avatar_emotion(emotion_id)
    store = avatar_store()
    removed = store["uploads"][gender].pop(emotion, None)
    if removed is None:
        raise HTTPException(status_code=404, detail="Avatar image not found")
    if gender == "male":
        store["emotions"].pop(emotion, None)
    save_persisted_avatar_store()
    add_audit(
        "system_avatar_deleted",
        "SystemAvatar",
        f"{gender}:{emotion}",
        {"gender": gender, "emotion": emotion, "file_name": removed.get("file_name"), "mime_type": removed.get("mime_type")},
        admin["username"],
    )
    return public_avatar_settings()


@router.put("/api/system-settings/avatars/{emotion_id}")
def upload_avatar(emotion_id: str, payload: AvatarUploadPayload, admin=Depends(require_admin)):
    return upload_gender_avatar("male", emotion_id, payload, admin)


@router.delete("/api/system-settings/avatars/{emotion_id}")
def delete_avatar(emotion_id: str, admin=Depends(require_admin)):
    return delete_gender_avatar("male", emotion_id, admin)


@router.get("/api/system-settings/locations")
@router.get("/api/locations")
def list_locations(admin=Depends(require_admin)):
    seed_default_locations()
    return [public_location(location) for location in _locations]


@router.get("/api/system-settings/locations/search")
@router.get("/api/locations/search")
def search_locations(q: str, admin=Depends(require_admin)):
    query = (q or "").strip()
    if len(query) < 3:
        raise HTTPException(status_code=400, detail="Search text must be at least 3 characters")

    geocoder_url = os.getenv("GEOCODER_SEARCH_URL", "https://nominatim.openstreetmap.org/search")
    params = urllib.parse.urlencode({
        "q": f"{query}, Philippines",
        "format": "json",
        "addressdetails": 1,
        "limit": 5,
    })
    url = f"{geocoder_url}?{params}"
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "3JMain/0.1 location-management"},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            raw_results = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Address search failed: {exc}") from exc
    if not isinstance(raw_results, list):
        raise HTTPException(status_code=400, detail="Address search returned an unexpected response")

    return {"results": [extract_geocode_suggestion(item) for item in raw_results]}


@router.post("/api/system-settings/locations")
@router.post("/api/locations")
def create_location(payload: LocationPayload, admin=Depends(require_admin)):
    data = payload.model_dump()
    location = ensure_location_record(data, actor=admin)
    if location is None:
        raise HTTPException(status_code=400, detail="Address or location detail is required")
    return location


@router.post("/api/system-settings/locations/bulk-delete")
@router.post("/api/locations/bulk-delete")
def bulk_delete_locations(payload: LocationBulkDeletePayload, admin=Depends(require_admin)):
    seed_default_locations()
    location_ids = []
    seen_ids = set()
    for raw_location_id in payload.ids:
        location_id = normalize_location_text(raw_location_id)
        if location_id and location_id not in seen_ids:
            location_ids.append(location_id)
            seen_ids.add(location_id)
    if not location_ids:
        raise HTTPException(status_code=400, detail="At least one location id is required")

    selected_ids = set(location_ids)
    deleted_locations = [location for location in _locations if location["id"] in selected_ids]
    if not deleted_locations:
        raise HTTPException(status_code=404, detail="No matching locations found")

    deleted_ids = {location["id"] for location in deleted_locations}
    for location in deleted_locations:
        remember_deleted_default_location(location)
    _locations[:] = [location for location in _locations if location["id"] not in deleted_ids]
    save_persisted_location_store()
    missing_ids = [location_id for location_id in location_ids if location_id not in deleted_ids]
    add_audit(
        "system_locations_bulk_deleted",
        "SystemLocation",
        "bulk",
        {"deleted_ids": list(deleted_ids), "deleted_count": len(deleted_ids), "missing_ids": missing_ids},
        admin["username"],
    )
    return {"status": "ok", "deleted": len(deleted_ids), "missing": missing_ids}


@router.patch("/api/system-settings/locations/{location_id}")
@router.patch("/api/locations/{location_id}")
def update_location(location_id: str, payload: LocationPatchPayload, admin=Depends(require_admin)):
    location = find_location(location_id)
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return public_location(location)

    candidate = dict(location)
    for field in ["location_name", "municipality", "barangay", "province", "region", "geocode_source", "notes"]:
        if field in changes:
            candidate[field] = normalize_location_text(changes.get(field))
    for field in ["latitude", "longitude"]:
        if field in changes:
            candidate[field] = changes.get(field)
    if "raw_geocode" in changes:
        candidate["raw_geocode"] = sanitize_summary(changes.get("raw_geocode") or {})
    if "address" in changes:
        candidate["address"] = synthesize_address({**candidate, "address": changes.get("address")})
    if not synthesize_address(candidate):
        raise HTTPException(status_code=400, detail="Address or location detail is required")
    location.update(candidate)
    location["updated_at"] = now_iso()
    save_persisted_location_store()
    add_audit(
        "system_location_updated",
        "SystemLocation",
        location["id"],
        {"address": location["address"], "municipality": location["municipality"], "barangay": location["barangay"]},
        admin["username"],
    )
    return public_location(location)


@router.delete("/api/system-settings/locations/{location_id}")
@router.delete("/api/locations/{location_id}")
def delete_location(location_id: str, admin=Depends(require_admin)):
    location = find_location(location_id)
    remember_deleted_default_location(location)
    _locations.remove(location)
    save_persisted_location_store()
    add_audit(
        "system_location_deleted",
        "SystemLocation",
        location_id,
        {"address": location["address"]},
        admin["username"],
    )
    return {"status": "ok"}
