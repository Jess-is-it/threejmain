import base64
import binascii
import hashlib
import hmac
import json
import os
import re
import secrets
import smtplib
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from decimal import Decimal
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

try:
    import psycopg
    from psycopg import sql
    from psycopg.rows import dict_row
    from psycopg.types.json import Json
except Exception:  # pragma: no cover - optional when DATABASE_URL is not configured
    psycopg = None
    sql = None
    dict_row = None
    Json = None


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


class MapProviderSettingsPayload(BaseModel):
    defaultProviderId: str | None = None
    default_provider_id: str | None = None
    providers: list[dict[str, Any]] = Field(default_factory=list)


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


class A2PMessagingSettingsPayload(BaseModel):
    enabled: bool | None = None
    provider: str | None = Field(default=None, max_length=80)
    base_url: str | None = Field(default=None, max_length=300)
    send_path: str | None = Field(default=None, max_length=200)
    query_path: str | None = Field(default=None, max_length=200)
    cancel_path: str | None = Field(default=None, max_length=200)
    start_batch_path: str | None = Field(default=None, max_length=200)
    send_batch_path: str | None = Field(default=None, max_length=200)
    credits_path: str | None = Field(default=None, max_length=200)
    auth_method: str | None = Field(default=None, max_length=40)
    api_id: str | None = Field(default=None, max_length=200)
    api_key: str | None = Field(default=None, max_length=500)
    clear_api_key: bool = False
    username: str | None = Field(default=None, max_length=200)
    password: str | None = Field(default=None, max_length=500)
    clear_password: bool = False
    default_source: str | None = Field(default=None, max_length=80)
    source_addresses: list[str] | None = None
    registered_delivery: bool | None = None
    monthly_credit_limit: int | None = Field(default=None, ge=0, le=1_000_000_000)
    monthly_reset_day: int | None = Field(default=None, ge=1, le=31)
    notes: str | None = Field(default=None, max_length=1000)


class A2PMessagingTestSendPayload(BaseModel):
    destination: str = Field(..., min_length=8, max_length=32)
    message_text: str = Field(..., min_length=1, max_length=500)
    source: str | None = Field(default=None, max_length=80)
    registered_delivery: bool | None = None


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


class BackupRestorePayload(BaseModel):
    backup: dict[str, Any] = Field(default_factory=dict)


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
    {
        "id": "plc-splitter-1x8",
        "label": "PLC Splitter 1x8",
        "description": "Equipment image shown for 1x8 PLC splitter ports in Network Settings.",
        "recommended_size": "180 x 120 px",
    },
    {
        "id": "plc-splitter-1x16",
        "label": "PLC Splitter 1x16",
        "description": "Equipment image shown for 1x16 PLC splitter ports in Network Settings.",
        "recommended_size": "220 x 120 px",
    },
]
MAP_PROVIDER_TYPES = {"street", "satellite", "hybrid", "custom"}
DEFAULT_MAP_PROVIDER_ID = "esri-streets"
DEFAULT_MAP_PROVIDERS = [
    {
        "id": "esri-streets",
        "label": "Esri Streets",
        "type": "street",
        "tileUrl": "https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
        "attribution": "Esri World Street Map",
        "minZoom": 1,
        "maxZoom": 19,
        "enabled": True,
        "builtIn": True,
        "requiresApiKey": False,
        "apiKey": "",
        "notes": "Default street map provider. Some high zoom areas may stop before the nominal service limit.",
    },
    {
        "id": "esri-satellite",
        "label": "Esri Satellite",
        "type": "satellite",
        "tileUrl": "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        "attribution": "Esri World Imagery",
        "minZoom": 1,
        "maxZoom": 19,
        "enabled": True,
        "builtIn": True,
        "requiresApiKey": False,
        "apiKey": "",
        "notes": "Satellite imagery. Some areas return provider placeholders at high zoom.",
    },
    {
        "id": "osm-standard",
        "label": "OpenStreetMap",
        "type": "street",
        "tileUrl": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        "attribution": "OpenStreetMap contributors",
        "minZoom": 1,
        "maxZoom": 19,
        "enabled": True,
        "builtIn": True,
        "requiresApiKey": False,
        "apiKey": "",
        "notes": "Use responsibly; public OSM tiles are not intended for heavy production load.",
    },
    {
        "id": "google-roadmap",
        "label": "Google Roadmap",
        "type": "street",
        "tileUrl": "https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session={sessionToken}&key={apiKey}",
        "attribution": "Google Maps",
        "minZoom": 0,
        "maxZoom": 22,
        "enabled": False,
        "builtIn": True,
        "requiresApiKey": True,
        "apiKey": "",
        "sessionProvider": "google-map-tiles",
        "googleMapType": "roadmap",
        "googleLanguage": "en-US",
        "googleRegion": "PH",
        "notes": "Requires Google Maps Platform Map Tiles API. The browser creates a Google tile session before loading tiles.",
    },
    {
        "id": "google-satellite",
        "label": "Google Satellite",
        "type": "satellite",
        "tileUrl": "https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session={sessionToken}&key={apiKey}",
        "attribution": "Google Maps",
        "minZoom": 0,
        "maxZoom": 22,
        "enabled": False,
        "builtIn": True,
        "requiresApiKey": True,
        "apiKey": "",
        "sessionProvider": "google-map-tiles",
        "googleMapType": "satellite",
        "googleLanguage": "en-US",
        "googleRegion": "PH",
        "notes": "Requires Google Maps Platform Map Tiles API. Satellite imagery availability can vary by area.",
    },
    {
        "id": "tomtom-basic",
        "label": "TomTom Basic",
        "type": "street",
        "tileUrl": "https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key={apiKey}",
        "attribution": "TomTom",
        "minZoom": 1,
        "maxZoom": 22,
        "enabled": False,
        "builtIn": True,
        "requiresApiKey": True,
        "apiKey": "",
        "notes": "Requires a TomTom API key.",
    },
    {
        "id": "maptiler-streets",
        "label": "MapTiler Streets",
        "type": "street",
        "tileUrl": "https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key={apiKey}",
        "attribution": "MapTiler, OpenStreetMap contributors",
        "minZoom": 1,
        "maxZoom": 22,
        "enabled": False,
        "builtIn": True,
        "requiresApiKey": True,
        "apiKey": "",
        "notes": "Requires a MapTiler API key.",
    },
    {
        "id": "maptiler-satellite",
        "label": "MapTiler Satellite",
        "type": "satellite",
        "tileUrl": "https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key={apiKey}",
        "attribution": "MapTiler",
        "minZoom": 1,
        "maxZoom": 20,
        "enabled": False,
        "builtIn": True,
        "requiresApiKey": True,
        "apiKey": "",
        "notes": "Requires a MapTiler API key.",
    },
    {
        "id": "mapbox-streets",
        "label": "Mapbox Streets",
        "type": "street",
        "tileUrl": "https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}?access_token={apiKey}",
        "attribution": "Mapbox, OpenStreetMap",
        "minZoom": 1,
        "maxZoom": 22,
        "enabled": False,
        "builtIn": True,
        "requiresApiKey": True,
        "apiKey": "",
        "notes": "Requires a Mapbox public access token.",
    },
    {
        "id": "mapbox-satellite-streets",
        "label": "Mapbox Satellite Streets",
        "type": "hybrid",
        "tileUrl": "https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/{z}/{x}/{y}?access_token={apiKey}",
        "attribution": "Mapbox",
        "minZoom": 1,
        "maxZoom": 22,
        "enabled": False,
        "builtIn": True,
        "requiresApiKey": True,
        "apiKey": "",
        "notes": "Requires a Mapbox public access token.",
    },
]
BACKUP_SCHEMA_ID = "threejmain.system-backup"
BACKUP_SCHEMA_VERSION = 1
BACKUP_APPLICATION_TABLE_EXCLUDES = {"schema_migrations"}
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

A2P_AUTH_METHODS = {"API_KEY_HEADERS", "BASIC_AUTH", "BODY_CREDENTIALS"}
A2P_DEFAULT_SOURCE_ADDRESSES = ["3JXENTRONET", "3J BILL", "3J ALERT", "3J PROMO", "3J FibrWIFI"]
A2P_DEFAULT_SETTINGS = {
    "enabled": False,
    "provider": "SMART_MESSAGING_SUITE",
    "base_url": "https://enterprise.messagingsuite.smart.com.ph",
    "send_path": "/cgphttp/servlet/sendmsg",
    "query_path": "/cgphttp/servlet/querymsg",
    "cancel_path": "/cgphttp/servlet/cancelmsg",
    "start_batch_path": "/cgphttp/servlet/startbatch",
    "send_batch_path": "/cgphttp/servlet/sendbatch",
    "credits_path": "/cgpapi/service1/credits",
    "auth_method": "API_KEY_HEADERS",
    "api_id": "",
    "api_key": "",
    "username": "",
    "password": "",
    "default_source": "",
    "source_addresses": A2P_DEFAULT_SOURCE_ADDRESSES,
    "registered_delivery": True,
    "monthly_credit_limit": None,
    "monthly_reset_day": 1,
    "notes": "",
    "last_credit_check_at": "",
    "last_credit_check_status": "",
    "last_credit_available": None,
    "last_credit_response": "",
    "last_credit_error": "",
    "last_test_send_at": "",
    "last_test_send_status": "",
    "last_test_send_destination": "",
    "last_test_send_message_id": "",
    "last_test_send_response": "",
    "last_test_send_error": "",
}
A2P_MAX_MESSAGE_LOGS = 500

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
    {
        "code": "techportal.dashboard.view",
        "label": "Tech Portal Dashboard View",
        "description": "View the technician portal dashboard.",
        "category": "Tech Portal",
    },
    {
        "code": "techportal.ticketing.view",
        "label": "Tech Portal Ticketing View",
        "description": "View assigned technician tickets in Tech Portal.",
        "category": "Tech Portal",
    },
    {
        "code": "techportal.ticketing.update",
        "label": "Tech Portal Ticket Updates",
        "description": "Update assigned technician ticket status, notes, and field progress in Tech Portal.",
        "category": "Tech Portal",
    },
    {
        "code": "techportal.logs.view",
        "label": "Tech Portal Logs View",
        "description": "View technician-scoped activity in Tech Portal.",
        "category": "Tech Portal",
    },
    {
        "code": "techportal.settings.view",
        "label": "Tech Portal Settings View",
        "description": "View technician-safe portal settings.",
        "category": "Tech Portal",
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
    "techportal.ticketing.update": ["techportal.ticketing.view", "techportal.dashboard.view"],
}

TECHNICIAN_TEST_USERNAME = "tech"
TECHNICIAN_TEST_PASSWORD = "tech12345"
TECHNICIAN_PERMISSION_CODES = [
    "techportal.dashboard.view",
    "techportal.ticketing.view",
    "techportal.ticketing.update",
    "techportal.logs.view",
    "techportal.settings.view",
    "ticketing.view",
    "logs.view",
]


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
    store = settings_store()
    for section_name in ["branding", "business", "deployment"]:
        section = persisted.get(section_name)
        if isinstance(section, dict):
            store.setdefault(section_name, {}).update(section)
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
        store["avatar"] = avatar
    openai = persisted.get("openai")
    if isinstance(openai, dict):
        store["openai"] = openai
    a2p_messaging = persisted.get("a2pMessaging")
    if isinstance(a2p_messaging, dict):
        store["a2pMessaging"] = a2p_messaging
    access = persisted.get("access")
    if isinstance(access, dict):
        store["access"] = normalize_access_store(access)
    map_images = persisted.get("mapImages")
    if isinstance(map_images, dict):
        store["mapImages"] = normalize_map_image_store(map_images)
    map_providers = persisted.get("mapProviders")
    if isinstance(map_providers, dict):
        store["mapProviders"] = normalize_map_provider_store(map_providers)


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


def save_persisted_map_provider_store() -> None:
    save_persisted_system_settings("mapProviders")


def save_persisted_location_store() -> None:
    save_persisted_system_settings("locations")


def save_persisted_access_store() -> None:
    save_persisted_system_settings("access")


def save_persisted_a2p_messaging_store() -> None:
    save_persisted_system_settings("a2pMessaging")


def network_settings_persistence_path() -> Path | None:
    default_path = "/app/data/network_settings.json" if os.path.isdir("/app/data") else ""
    configured = os.getenv("NETWORK_SETTINGS_DATA_PATH", default_path).strip()
    return Path(configured) if configured else None


def read_json_file(path: Path | None, label: str) -> dict[str, Any]:
    if path is None or not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail=f"Stored {label} data could not be loaded") from exc
    return payload if isinstance(payload, dict) else {}


def write_json_file(path: Path, payload: dict[str, Any], label: str) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_name(f".{path.name}.tmp")
        temp_path.write_text(
            json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        os.replace(temp_path, path)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"{label} data could not be restored") from exc


def json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [json_safe(item) for item in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, bytes):
        return base64.b64encode(value).decode("ascii")
    return value


def backup_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def settings_snapshot_for_backup() -> dict[str, Any]:
    load_persisted_system_settings()
    store = settings_store()
    return json_safe({
        "branding": store.get("branding", {}),
        "business": store.get("business", {}),
        "deployment": store.get("deployment", {}),
    })


def system_settings_backup_counts(payload: dict[str, Any]) -> dict[str, int]:
    avatar_uploads = payload.get("avatar", {}).get("uploads", {}) if isinstance(payload.get("avatar"), dict) else {}
    map_uploads = payload.get("mapImages", {}).get("uploads", {}) if isinstance(payload.get("mapImages"), dict) else {}
    map_providers = payload.get("mapProviders", {}).get("providers", []) if isinstance(payload.get("mapProviders"), dict) else []
    avatar_count = 0
    if isinstance(avatar_uploads, dict):
        for gender_uploads in avatar_uploads.values():
            if isinstance(gender_uploads, dict):
                avatar_count += len(gender_uploads)
    return {
        "locations": len(payload.get("locations") or []),
        "deletedLocationMarkers": len(payload.get("deleted_default_location_fingerprints") or []),
        "mapImages": len(map_uploads) if isinstance(map_uploads, dict) else 0,
        "mapProviders": len(map_providers) if isinstance(map_providers, list) else 0,
        "avatarImages": avatar_count,
        "a2pMessageLogs": len(payload.get("a2pMessaging", {}).get("messageLogs", []) if isinstance(payload.get("a2pMessaging"), dict) else []),
        "accessRoles": len(payload.get("access", {}).get("roles", []) if isinstance(payload.get("access"), dict) else []),
        "accessUsers": len(payload.get("access", {}).get("users", []) if isinstance(payload.get("access"), dict) else []),
    }


def network_settings_backup_counts(payload: dict[str, Any]) -> dict[str, int]:
    return {
        "mikrotikRouters": len([
            item for item in payload.get("networkDevices", [])
            if isinstance(item, dict) and item.get("deviceType") == "MIKROTIK" and item.get("accessMethod") == "API" and not item.get("deletedAt")
        ]),
        "snmpOlts": len([
            item for item in payload.get("networkDevices", [])
            if isinstance(item, dict) and item.get("accessMethod") == "SNMP" and not item.get("deletedAt")
        ]),
        "olts": len([item for item in payload.get("olts", []) if isinstance(item, dict) and not item.get("deletedAt")]),
        "ponPorts": len([item for item in payload.get("ponPorts", []) if isinstance(item, dict) and not item.get("deletedAt")]),
        "napBoxes": len([item for item in payload.get("napBoxes", []) if isinstance(item, dict) and not item.get("deletedAt")]),
        "splitters": len([item for item in payload.get("fbts", []) if isinstance(item, dict) and not item.get("deletedAt")]),
        "onus": len([item for item in payload.get("onus", []) if isinstance(item, dict) and not item.get("deletedAt")]),
    }


def database_connection_status() -> dict[str, Any]:
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        return {"enabled": False, "status": "not_configured", "tables": []}
    if psycopg is None or dict_row is None:
        return {"enabled": False, "status": "driver_unavailable", "tables": []}
    try:
        with psycopg.connect(database_url, row_factory=dict_row) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                    ORDER BY table_name
                    """
                )
                table_names = [row["table_name"] for row in cursor.fetchall()]
                counts = {}
                for table_name in table_names:
                    cursor.execute(sql.SQL("SELECT count(*) AS total FROM {}").format(sql.Identifier(table_name)))
                    counts[table_name] = int(cursor.fetchone()["total"])
        return {"enabled": True, "status": "available", "tables": table_names, "rowCounts": counts}
    except Exception as exc:
        return {"enabled": False, "status": "unavailable", "message": str(exc), "tables": []}


def database_backup_snapshot() -> dict[str, Any]:
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        return {"enabled": False, "status": "not_configured", "tables": {}, "metadataTables": {}}
    if psycopg is None or dict_row is None or sql is None:
        return {"enabled": False, "status": "driver_unavailable", "tables": {}, "metadataTables": {}}
    try:
        with psycopg.connect(database_url, row_factory=dict_row) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                    ORDER BY table_name
                    """
                )
                table_names = [row["table_name"] for row in cursor.fetchall()]
                tables: dict[str, Any] = {}
                metadata_tables: dict[str, Any] = {}
                for table_name in table_names:
                    cursor.execute(
                        """
                        SELECT column_name, data_type
                        FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = %s
                        ORDER BY ordinal_position
                        """,
                        (table_name,),
                    )
                    columns = [dict(row) for row in cursor.fetchall()]
                    cursor.execute(sql.SQL("SELECT * FROM {}").format(sql.Identifier(table_name)))
                    rows = [json_safe(dict(row)) for row in cursor.fetchall()]
                    table_snapshot = {"columns": columns, "rowCount": len(rows), "rows": rows}
                    if table_name in BACKUP_APPLICATION_TABLE_EXCLUDES:
                        metadata_tables[table_name] = table_snapshot
                    else:
                        tables[table_name] = table_snapshot
        return {"enabled": True, "status": "ok", "tables": tables, "metadataTables": metadata_tables}
    except Exception as exc:
        return {"enabled": False, "status": "error", "message": str(exc), "tables": {}, "metadataTables": {}}


def build_backup_payload(backup_type: str, admin: dict[str, Any]) -> dict[str, Any]:
    system_data = read_persisted_system_settings()
    network_path = network_settings_persistence_path()
    network_data = read_json_file(network_path, "Network Settings")
    sections: dict[str, Any] = {
        "applicationSettings": {
            "description": "Current branding, business, and deployment settings from the running app shell.",
            "data": settings_snapshot_for_backup(),
        },
        "systemSettings": {
            "description": "Persisted System Settings data including locations, map providers, Access, OPENAI, A2P Messaging, avatars, and image assets.",
            "path": str(system_settings_persistence_path()),
            "counts": system_settings_backup_counts(system_data),
            "data": json_safe(system_data),
        },
        "networkSettings": {
            "description": "Persisted Network Settings data including MikroTik API routers, SNMP OLT devices, OLT/PON/NAP, splitter, fiber mapping, capture, and ONU records.",
            "path": str(network_path) if network_path else "",
            "counts": network_settings_backup_counts(network_data),
            "data": json_safe(network_data),
        },
    }
    if backup_type == "full":
        sections["database"] = {
            "description": "Supported PostgreSQL application tables. Migration bookkeeping is exported as metadata and is not restored.",
            "data": database_backup_snapshot(),
        }
    return {
        "schema": BACKUP_SCHEMA_ID,
        "schemaVersion": BACKUP_SCHEMA_VERSION,
        "backupType": backup_type,
        "createdAt": now_iso(),
        "createdBy": {
            "id": admin.get("id"),
            "username": admin.get("username"),
        },
        "sensitive": True,
        "sensitiveNotice": "This backup can include map provider API keys, OpenAI API keys, A2P Messaging API keys, MikroTik API credentials, SNMP communities, SNMPv3 secrets, access users, and uploaded image data.",
        "sections": sections,
    }


def backup_json_response(payload: dict[str, Any], backup_type: str) -> JSONResponse:
    filename = f"threejmain-{backup_type}-backup-{backup_timestamp()}.json"
    return JSONResponse(
        content=payload,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def backup_section_data(backup: dict[str, Any], section_name: str) -> Any:
    section = backup.get("sections", {}).get(section_name) if isinstance(backup.get("sections"), dict) else None
    if isinstance(section, dict):
        return section.get("data")
    return None


def restore_application_settings(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        return {"status": "skipped", "message": "No application settings section found."}
    store = settings_store()
    restored = []
    for section_name in ["branding", "business", "deployment"]:
        if isinstance(data.get(section_name), dict):
            store[section_name] = json_safe(data[section_name])
            restored.append(section_name)
    if restored:
        save_persisted_system_settings(*restored)
    return {"status": "restored", "sections": restored}


def restore_system_settings_data(data: Any) -> dict[str, Any]:
    global _system_settings_persistence_loaded
    if not isinstance(data, dict):
        return {"status": "skipped", "message": "No System Settings data section found."}
    write_json_file(system_settings_persistence_path(), json_safe(data), "System Settings")
    store = settings_store()
    for section_name in ["avatar", "openai", "a2pMessaging", "access", "mapImages", "mapProviders"]:
        store.pop(section_name, None)
    _locations.clear()
    _deleted_default_location_fingerprints.clear()
    _system_settings_persistence_loaded = False
    load_persisted_system_settings()
    return {"status": "restored", "counts": system_settings_backup_counts(data)}


def apply_network_settings_runtime_state(data: dict[str, Any]) -> dict[str, Any]:
    try:
        import importlib

        network_router = importlib.import_module("network_settings.router")
        network_router.olts = list(data.get("olts") or [])
        network_router.pon_ports = list(data.get("ponPorts") or [])
        network_router.nap_boxes = list(data.get("napBoxes") or [])
        network_router.fbts = list(data.get("fbts") or [])
        network_router.fiber_optic_losses = list(data.get("fiberOpticLosses") or [])
        network_router.fiber_color_settings = network_router.normalize_fiber_color_settings(data.get("fiberColorSettings"))
        network_router.fiber_mapping = network_router.normalize_fiber_mapping(data.get("fiberMapping"))
        network_router.network_devices = list(data.get("networkDevices") or [])
        network_router.device_captures = list(data.get("deviceCaptures") or [])
        network_router.onus = list(data.get("onus") or [])
        network_router._data_loaded = True
        capture_history_changed = network_router.normalize_capture_history()
        inventory_changed = network_router.normalize_pon_inventory_defaults()
        if capture_history_changed or inventory_changed:
            network_router.save_network_settings_data()
        return {"status": "active", "message": "Network Settings runtime state updated."}
    except Exception as exc:
        return {"status": "file_restored", "message": f"Network Settings data file restored; restart API to load active runtime state. {exc}"}


def restore_network_settings_data(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        return {"status": "skipped", "message": "No Network Settings data section found."}
    path = network_settings_persistence_path()
    if path is None:
        return {"status": "skipped", "message": "NETWORK_SETTINGS_DATA_PATH is not configured."}
    write_json_file(path, json_safe(data), "Network Settings")
    return {"status": "restored", "counts": network_settings_backup_counts(data), "runtime": apply_network_settings_runtime_state(data)}


def restore_database_snapshot(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict) or not isinstance(data.get("tables"), dict):
        return {"status": "skipped", "message": "No database table data section found."}
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        return {"status": "skipped", "message": "DATABASE_URL is not configured."}
    if psycopg is None or dict_row is None or sql is None or Json is None:
        return {"status": "skipped", "message": "PostgreSQL driver is unavailable."}
    restored: dict[str, int] = {}
    skipped: dict[str, str] = {}
    try:
        with psycopg.connect(database_url, row_factory=dict_row) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                    """
                )
                existing_tables = {row["table_name"] for row in cursor.fetchall()}
                for table_name, table_payload in data.get("tables", {}).items():
                    if table_name in BACKUP_APPLICATION_TABLE_EXCLUDES:
                        skipped[table_name] = "Metadata table restore is intentionally skipped."
                        continue
                    if table_name not in existing_tables:
                        skipped[table_name] = "Table does not exist in this deployment."
                        continue
                    rows = table_payload.get("rows") if isinstance(table_payload, dict) else None
                    if not isinstance(rows, list):
                        skipped[table_name] = "Table backup rows are missing or invalid."
                        continue
                    cursor.execute(
                        """
                        SELECT column_name, data_type
                        FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = %s
                        ORDER BY ordinal_position
                        """,
                        (table_name,),
                    )
                    column_types = {row["column_name"]: row["data_type"] for row in cursor.fetchall()}
                    if not column_types:
                        skipped[table_name] = "No restorable columns found."
                        continue
                    cursor.execute(sql.SQL("TRUNCATE TABLE {} RESTART IDENTITY CASCADE").format(sql.Identifier(table_name)))
                    inserted = 0
                    for row in rows:
                        if not isinstance(row, dict):
                            continue
                        columns = [column for column in column_types if column in row]
                        if not columns:
                            continue
                        values = []
                        for column in columns:
                            value = row.get(column)
                            if column_types[column] in {"json", "jsonb"} and value is not None:
                                values.append(Json(value))
                            else:
                                values.append(value)
                        placeholders = sql.SQL(", ").join(sql.Placeholder() for _ in columns)
                        cursor.execute(
                            sql.SQL("INSERT INTO {} ({}) VALUES ({})").format(
                                sql.Identifier(table_name),
                                sql.SQL(", ").join(sql.Identifier(column) for column in columns),
                                placeholders,
                            ),
                            values,
                        )
                        inserted += 1
                    restored[table_name] = inserted
        return {"status": "restored", "tables": restored, "skipped": skipped}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Database data could not be restored: {exc}") from exc


def restore_backup_data(backup: dict[str, Any], admin: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(backup, dict):
        raise HTTPException(status_code=400, detail="Backup file must contain a JSON object")
    if backup.get("schema") != BACKUP_SCHEMA_ID:
        raise HTTPException(status_code=400, detail="Backup file is not a 3J ISP Management backup")
    if int(backup.get("schemaVersion") or 0) != BACKUP_SCHEMA_VERSION:
        raise HTTPException(status_code=400, detail="Backup schema version is not supported")
    backup_type = normalize_location_text(backup.get("backupType")).lower()
    if backup_type not in {"configuration", "full"}:
        raise HTTPException(status_code=400, detail="Backup type is not supported")
    result = {
        "backupType": backup_type,
        "systemSettings": restore_system_settings_data(backup_section_data(backup, "systemSettings")),
        "applicationSettings": restore_application_settings(backup_section_data(backup, "applicationSettings")),
        "networkSettings": restore_network_settings_data(backup_section_data(backup, "networkSettings")),
    }
    if backup_type == "full":
        result["database"] = restore_database_snapshot(backup_section_data(backup, "database"))
    add_audit(
        "system_backup_restored",
        "SystemBackup",
        backup_type,
        {"backup_type": backup_type, "created_at": backup.get("createdAt"), "result": {key: value.get("status") if isinstance(value, dict) else "unknown" for key, value in result.items()}},
        admin["username"],
    )
    return result


def public_backup_metadata() -> dict[str, Any]:
    system_data = read_persisted_system_settings()
    network_data = read_json_file(network_settings_persistence_path(), "Network Settings")
    database_status = database_connection_status()
    return {
        "schema": BACKUP_SCHEMA_ID,
        "schemaVersion": BACKUP_SCHEMA_VERSION,
        "acceptedFileTypes": [".json", "application/json"],
        "sensitiveNotice": "Backup files can include map provider API keys, OpenAI API keys, A2P Messaging API keys, MikroTik API passwords, SNMP communities, SNMPv3 secrets, access users, and uploaded image data. Store downloaded backups securely.",
        "configuration": {
            "includes": [
                "Branding, business, and deployment settings from the running app shell.",
                "System Settings persisted configuration: locations, map providers, Access, OPENAI, A2P Messaging, avatar, and Images uploads.",
                "Network Settings persisted configuration: MikroTik API routers, SNMP OLT devices, OLT/PON/NAP, splitters, fiber mapping, capture history, and ONU records.",
            ],
            "counts": {
                "systemSettings": system_settings_backup_counts(system_data),
                "networkSettings": network_settings_backup_counts(network_data),
            },
            "restoreBehavior": "Restoring a configuration backup replaces the persisted System Settings and Network Settings configuration stores. Network Settings runtime state is refreshed immediately when its module is loaded.",
        },
        "full": {
            "includes": [
                "Everything in the configuration backup.",
                "Supported PostgreSQL application tables such as Customer Profiling customer records.",
            ],
            "database": database_status,
            "restoreBehavior": "Restoring a full backup replaces supported application table rows. Migration metadata is exported for reference and is not overwritten.",
        },
    }


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
        {
            "id": "role-technician",
            "name": "technician",
            "description": "Field technician access for Tech Portal assigned-work workflows.",
            "isBuiltin": True,
            "isLocked": False,
            "permissionCodes": expand_access_permission_codes(TECHNICIAN_PERMISSION_CODES)[0],
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
    if not any(user["username"].lower() == TECHNICIAN_TEST_USERNAME for user in normalized_users):
        timestamp = now_iso()
        normalized_users.append(
            {
                "id": "user-tech",
                "username": TECHNICIAN_TEST_USERNAME,
                "email": "tech@example.local",
                "fullName": "Test Technician",
                "roleId": "role-technician",
                "password": "",
                "passwordHash": hash_access_password(TECHNICIAN_TEST_PASSWORD),
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


def verify_access_password(user: dict[str, Any], password: str) -> bool:
    candidate = normalize_access_text(password)
    password_hash = normalize_access_text(user.get("passwordHash"))
    if password_hash:
        try:
            algorithm, salt, digest_hex = password_hash.split("$", 2)
        except ValueError:
            return False
        if algorithm != "pbkdf2_sha256" or not salt or not digest_hex:
            return False
        digest = hashlib.pbkdf2_hmac("sha256", candidate.encode("utf-8"), salt.encode("utf-8"), 120_000)
        return hmac.compare_digest(digest.hex(), digest_hex)
    legacy_password = normalize_access_text(user.get("password"))
    return bool(legacy_password) and hmac.compare_digest(legacy_password, candidate)


def access_session_user(user: dict[str, Any], role: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": user["id"],
        "username": user["username"],
        "full_name": user.get("fullName") or user["username"],
        "email": user.get("email", ""),
        "role": role.get("name", ""),
        "status": "active" if user.get("isActive") else "inactive",
        "permissions": role.get("permissionCodes") or [],
        "mustChangePassword": bool(user.get("mustChangePassword")),
        "auth_source": "system_access",
    }


def authenticate_access_user(username: str, password: str) -> dict[str, Any] | None:
    access = access_store()
    normalized_username = normalize_access_text(username).lower()
    for user in access.get("users", []):
        if user.get("username", "").lower() != normalized_username:
            continue
        if not user.get("isActive", True) or not verify_access_password(user, password):
            return None
        if user.get("password") and not user.get("passwordHash"):
            user["passwordHash"] = hash_access_password(password)
            user["password"] = ""
        user["lastLoginAt"] = now_iso()
        user["updatedAt"] = now_iso()
        save_persisted_access_store()
        return access_session_user(user, role_by_id(access, user["roleId"]))
    return None


def update_access_session_user(user_id: str, full_name: str | None = None, email: str | None = None) -> dict[str, Any]:
    access = access_store()
    user = user_by_id(access, user_id)
    if full_name is not None:
        user["fullName"] = normalize_access_text(full_name)
    if email is not None:
        user["email"] = normalize_access_text(email).lower()
    user["updatedAt"] = now_iso()
    save_persisted_access_store()
    return access_session_user(user, role_by_id(access, user["roleId"]))


def change_access_session_password(user_id: str, current_password: str, new_password: str, confirm_password: str) -> None:
    if new_password != confirm_password:
        raise HTTPException(status_code=400, detail="Password confirmation does not match")
    if len(normalize_access_text(new_password)) < ACCESS_PASSWORD_MIN_LENGTH:
        raise HTTPException(status_code=400, detail=f"Password must be at least {ACCESS_PASSWORD_MIN_LENGTH} characters")
    access = access_store()
    user = user_by_id(access, user_id)
    if not verify_access_password(user, current_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user["password"] = ""
    user["passwordHash"] = hash_access_password(new_password)
    user["mustChangePassword"] = False
    user["updatedAt"] = now_iso()
    save_persisted_access_store()


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


def normalize_map_provider_id(value: Any, fallback: str = "") -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", normalize_location_text(value).lower()).strip("-")
    return normalized or fallback


def map_provider_number(value: Any, fallback: int, minimum: int = 0, maximum: int = 24) -> int:
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(maximum, number))


def normalize_map_provider_record(raw: dict[str, Any] | None, preset: dict[str, Any] | None = None) -> dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    preset = preset if isinstance(preset, dict) else {}
    merged = {**preset, **raw}
    tile_url = normalize_location_text(merged.get("tileUrl") or merged.get("tile_url"))[:600]
    provider_type = normalize_location_text(merged.get("type")).lower()
    if provider_type not in MAP_PROVIDER_TYPES:
        provider_type = normalize_location_text(preset.get("type") or "custom").lower()
    if provider_type not in MAP_PROVIDER_TYPES:
        provider_type = "custom"
    requires_api_key = bool(
        merged.get("requiresApiKey")
        or merged.get("requires_api_key")
        or "{apiKey}" in tile_url
        or "{token}" in tile_url
    )
    google_layer_types = merged.get("googleLayerTypes") or merged.get("google_layer_types") or []
    if not isinstance(google_layer_types, list):
        google_layer_types = []
    return {
        "id": normalize_map_provider_id(merged.get("id"), normalize_map_provider_id(preset.get("id"))),
        "label": normalize_location_text(merged.get("label"))[:120]
        or normalize_location_text(preset.get("label"))[:120]
        or "Map Provider",
        "type": provider_type,
        "tileUrl": tile_url,
        "attribution": normalize_location_text(merged.get("attribution"))[:240],
        "minZoom": map_provider_number(merged.get("minZoom") or merged.get("min_zoom"), int(preset.get("minZoom") or 1), 0, 24),
        "maxZoom": map_provider_number(merged.get("maxZoom") or merged.get("max_zoom"), int(preset.get("maxZoom") or 19), 1, 24),
        "enabled": bool(merged.get("enabled")),
        "builtIn": bool(preset.get("builtIn") or preset.get("built_in") or merged.get("builtIn") or merged.get("built_in")),
        "requiresApiKey": requires_api_key,
        "apiKey": normalize_location_text(merged.get("apiKey") or merged.get("api_key"))[:300],
        "sessionProvider": normalize_location_text(merged.get("sessionProvider") or merged.get("session_provider"))[:80],
        "googleMapType": normalize_location_text(merged.get("googleMapType") or merged.get("google_map_type"))[:40],
        "googleLanguage": normalize_location_text(merged.get("googleLanguage") or merged.get("google_language") or "en-US")[:24],
        "googleRegion": normalize_location_text(merged.get("googleRegion") or merged.get("google_region") or "PH").upper()[:8],
        "googleLayerTypes": [
            normalize_location_text(item)[:40]
            for item in google_layer_types
            if normalize_location_text(item)
        ],
        "googleOverlay": bool(merged.get("googleOverlay") or merged.get("google_overlay")),
        "notes": normalize_location_text(merged.get("notes"))[:300],
    }


def map_provider_is_configured(provider: dict[str, Any]) -> bool:
    if not provider.get("tileUrl"):
        return False
    if not provider.get("requiresApiKey"):
        return True
    return bool(normalize_location_text(provider.get("apiKey")))


def map_provider_is_usable(provider: dict[str, Any]) -> bool:
    return bool(provider.get("enabled") and map_provider_is_configured(provider))


def normalize_map_provider_store(raw: dict[str, Any] | None) -> dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    provided = raw.get("providers") if isinstance(raw.get("providers"), list) else []
    provided_by_id: dict[str, dict[str, Any]] = {}
    for item in provided:
        if not isinstance(item, dict):
            continue
        provider_id = normalize_map_provider_id(item.get("id"))
        if provider_id and provider_id not in provided_by_id:
            provided_by_id[provider_id] = item

    presets_by_id = {provider["id"]: provider for provider in DEFAULT_MAP_PROVIDERS}
    providers = [
        normalize_map_provider_record(provided_by_id.get(preset["id"]), preset)
        for preset in DEFAULT_MAP_PROVIDERS
    ]
    for provider_id, item in provided_by_id.items():
        if provider_id in presets_by_id:
            continue
        provider = normalize_map_provider_record(item)
        if provider["id"] and provider["tileUrl"]:
            providers.append(provider)

    requested_default = normalize_map_provider_id(raw.get("defaultProviderId") or raw.get("default_provider_id"), DEFAULT_MAP_PROVIDER_ID)
    usable_ids = {provider["id"] for provider in providers if map_provider_is_usable(provider)}
    first_usable_id = next((provider["id"] for provider in providers if map_provider_is_usable(provider)), DEFAULT_MAP_PROVIDER_ID)
    default_provider_id = requested_default if requested_default in usable_ids else first_usable_id
    return {
        "defaultProviderId": default_provider_id,
        "providers": providers,
    }


def map_provider_store() -> dict[str, Any]:
    load_persisted_system_settings()
    store = settings_store()
    map_providers = normalize_map_provider_store(store.setdefault("mapProviders", {}))
    store["mapProviders"] = map_providers
    return map_providers


def public_map_provider_settings() -> dict[str, Any]:
    store = map_provider_store()
    return {
        "defaultProviderId": store.get("defaultProviderId") or DEFAULT_MAP_PROVIDER_ID,
        "providerTypes": [
            {"id": "street", "label": "Street"},
            {"id": "satellite", "label": "Satellite"},
            {"id": "hybrid", "label": "Hybrid"},
            {"id": "custom", "label": "Custom"},
        ],
        "providers": [
            {
                **provider,
                "configured": map_provider_is_configured(provider),
                "usable": map_provider_is_usable(provider),
            }
            for provider in store.get("providers", [])
        ],
        "guidelines": [
            "Use XYZ raster tile URL templates with {z}, {x}, and {y} placeholders.",
            "Use {apiKey} or {token} in the URL when a provider requires a browser-side public key.",
            "Google Maps built-in providers use the official Map Tiles API session flow and require a Google API key with Map Tiles API enabled.",
            "Set the provider max zoom to the highest zoom level that returns real tiles in your service area.",
        ],
    }


def public_map_image_settings() -> dict[str, Any]:
    store = map_image_store()
    uploads = store.get("uploads", {})
    return {
        "accepted_formats": list(ALLOWED_MAP_IMAGE_MIME_TYPES.values()),
        "accepted_mime_types": list(ALLOWED_MAP_IMAGE_MIME_TYPES.keys()),
        "max_bytes": MAX_MAP_IMAGE_BYTES,
        "guidelines": [
            "Use PNG or WebP for crisp transparent network equipment artwork.",
            "Use JPG only for photo-like images; transparent backgrounds are not preserved in JPG.",
            "Keep icons centered with safe padding so they remain readable at small map and canvas zoom levels.",
            "Recommended art is 128 x 128 px for NAP boxes, 160 x 160 px for OLT devices, and wide 1x8 or 1x16 PLC splitter artwork.",
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


def normalize_a2p_text(value: Any, max_length: int = 500) -> str:
    text = "" if value is None else str(value)
    text = text.replace("\x00", "")
    text = re.sub(r"[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    return text.strip()[:max_length]


def normalize_a2p_path(value: Any, fallback: str) -> str:
    path = normalize_a2p_text(value or fallback, 200)
    if not path:
        path = fallback
    if not path.startswith("/"):
        path = f"/{path}"
    return path


def normalize_a2p_base_url(value: Any) -> str:
    url = normalize_a2p_text(value or A2P_DEFAULT_SETTINGS["base_url"], 300).rstrip("/")
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="A2P base URL must be a valid http or https URL")
    return url


def normalize_a2p_source_addresses(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        raw_items = re.split(r"[\n,]+", value)
    elif isinstance(value, list):
        raw_items = value
    else:
        raw_items = []
    addresses: list[str] = []
    seen: set[str] = set()
    for item in raw_items:
        source = normalize_a2p_text(item, 80)
        if not source or source in seen:
            continue
        seen.add(source)
        addresses.append(source)
    return addresses[:50]


def mask_a2p_secret(value: str | None) -> str | None:
    text = normalize_a2p_text(value)
    if not text:
        return None
    if len(text) <= 8:
        return f"{text[:2]}..."
    return f"{text[:4]}...{text[-4:]}"


def a2p_join_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def normalize_a2p_destination(value: str) -> str:
    digits = re.sub(r"\D", "", normalize_a2p_text(value, 32))
    if digits.startswith("09") and len(digits) == 11:
        digits = f"63{digits[1:]}"
    if not re.fullmatch(r"\d{8,15}", digits or ""):
        raise HTTPException(status_code=400, detail="Destination must be an international-format mobile number, for example 639171234567")
    return digits


def safe_mask_a2p_destination(destination: str | None) -> str:
    digits = re.sub(r"\D", "", normalize_a2p_text(destination, 32))
    if not digits:
        return ""
    if len(digits) <= 6:
        return "***"
    return f"{digits[:4]}...{digits[-3:]}"


def a2p_messaging_store() -> dict[str, Any]:
    load_persisted_system_settings()
    store = settings_store()
    current = store.setdefault("a2pMessaging", {})
    for key, value in A2P_DEFAULT_SETTINGS.items():
        if key not in current:
            current[key] = json.loads(json.dumps(value))
    current["enabled"] = bool(current.get("enabled"))
    current["provider"] = normalize_a2p_text(current.get("provider") or A2P_DEFAULT_SETTINGS["provider"], 80)
    current["base_url"] = normalize_a2p_base_url(current.get("base_url"))
    for key in ("send_path", "query_path", "cancel_path", "start_batch_path", "send_batch_path", "credits_path"):
        current[key] = normalize_a2p_path(current.get(key), A2P_DEFAULT_SETTINGS[key])
    auth_method = normalize_a2p_text(current.get("auth_method") or "API_KEY_HEADERS", 40).upper()
    current["auth_method"] = auth_method if auth_method in A2P_AUTH_METHODS else "API_KEY_HEADERS"
    current["api_id"] = normalize_a2p_text(current.get("api_id"), 200)
    current["api_key"] = normalize_a2p_text(current.get("api_key"), 500)
    current["username"] = normalize_a2p_text(current.get("username"), 200)
    current["password"] = normalize_a2p_text(current.get("password"), 500)
    current["default_source"] = normalize_a2p_text(current.get("default_source"), 80)
    current["source_addresses"] = normalize_a2p_source_addresses(current.get("source_addresses")) or A2P_DEFAULT_SOURCE_ADDRESSES.copy()
    current["registered_delivery"] = bool(current.get("registered_delivery", True))
    monthly_credit_limit = current.get("monthly_credit_limit")
    current["monthly_credit_limit"] = int(monthly_credit_limit) if monthly_credit_limit not in (None, "") else None
    current["monthly_reset_day"] = min(31, max(1, int(current.get("monthly_reset_day") or 1)))
    current["notes"] = normalize_a2p_text(current.get("notes"), 1000)
    logs = current.get("messageLogs")
    current["messageLogs"] = logs if isinstance(logs, list) else []
    read_ids = current.get("notificationReadIds")
    current["notificationReadIds"] = [normalize_a2p_text(item, 120) for item in read_ids if normalize_a2p_text(item, 120)] if isinstance(read_ids, list) else []
    return current


def public_a2p_messaging_settings() -> dict[str, Any]:
    store = a2p_messaging_store()
    return {
        "enabled": bool(store.get("enabled")),
        "provider": store.get("provider"),
        "base_url": store.get("base_url"),
        "send_path": store.get("send_path"),
        "query_path": store.get("query_path"),
        "cancel_path": store.get("cancel_path"),
        "start_batch_path": store.get("start_batch_path"),
        "send_batch_path": store.get("send_batch_path"),
        "credits_path": store.get("credits_path"),
        "auth_method": store.get("auth_method"),
        "api_id": store.get("api_id"),
        "api_key_configured": bool(normalize_a2p_text(store.get("api_key"))),
        "api_key_hint": mask_a2p_secret(store.get("api_key")),
        "username": store.get("username"),
        "password_configured": bool(normalize_a2p_text(store.get("password"))),
        "password_hint": mask_a2p_secret(store.get("password")),
        "default_source": store.get("default_source"),
        "source_addresses": store.get("source_addresses") or [],
        "registered_delivery": bool(store.get("registered_delivery")),
        "monthly_credit_limit": store.get("monthly_credit_limit"),
        "monthly_reset_day": store.get("monthly_reset_day"),
        "notes": store.get("notes"),
        "last_credit_check_at": store.get("last_credit_check_at"),
        "last_credit_check_status": store.get("last_credit_check_status"),
        "last_credit_available": store.get("last_credit_available"),
        "last_credit_response": store.get("last_credit_response"),
        "last_credit_error": store.get("last_credit_error"),
        "last_test_send_at": store.get("last_test_send_at"),
        "last_test_send_status": store.get("last_test_send_status"),
        "last_test_send_destination": store.get("last_test_send_destination"),
        "last_test_send_message_id": store.get("last_test_send_message_id"),
        "last_test_send_response": store.get("last_test_send_response"),
        "last_test_send_error": store.get("last_test_send_error"),
        "capabilities": {
            "send_sms": True,
            "send_batch": True,
            "query_message": True,
            "cancel_message": True,
            "delivery_receipts": True,
            "mobile_originated_replies": True,
            "credits_query": True,
            "max_destinations_per_sendmsg": 300,
            "documented_request_rate_per_customer_ip": "100 requests/second",
        },
        "credits_tracking": {
            "smart_prepaid_credits_endpoint": "/cgpapi/service1/credits",
            "direct_balance_check_supported": True,
            "monthly_usage_requires_local_message_logs": True,
            "portal_reports_available": True,
        },
    }


def a2p_auth_headers_and_params(store: dict[str, Any]) -> tuple[dict[str, str], dict[str, str]]:
    headers = {"User-Agent": "3JMain/0.1 a2p-messaging"}
    extra_params: dict[str, str] = {}
    api_key = normalize_a2p_text(store.get("api_key"), 500)
    username = normalize_a2p_text(store.get("username"), 200)
    password = normalize_a2p_text(store.get("password"), 500)
    auth_method = store.get("auth_method")
    if auth_method == "API_KEY_HEADERS":
        if not store.get("api_id") or not api_key:
            raise HTTPException(status_code=400, detail="Save API ID and API key first")
        headers["X-MEMS-API-ID"] = store["api_id"]
        headers["X-MEMS-API-KEY"] = api_key
    elif auth_method == "BASIC_AUTH":
        if not username or not password:
            raise HTTPException(status_code=400, detail="Save username and password first")
        token_value = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
        headers["Authorization"] = f"Basic {token_value}"
    else:
        if not username or not password:
            raise HTTPException(status_code=400, detail="Save username and password first")
        extra_params["username"] = username
        extra_params["password"] = password
    return headers, extra_params


def a2p_http_request(
    url: str,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    form_data: dict[str, Any] | None = None,
    timeout: int = 30,
) -> tuple[int, str]:
    encoded = None
    request_headers = headers.copy() if headers else {}
    if form_data is not None:
        encoded = urllib.parse.urlencode(form_data).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
    request = urllib.request.Request(url, data=encoded, headers=request_headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            return int(response.status), raw.decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        return int(exc.code), raw.decode("utf-8", errors="replace")
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=400, detail=f"Smart request failed: {exc.reason}") from exc


def parse_a2p_credit_available(text: str):
    clean = normalize_a2p_text(text, 1000)
    patterns = [
        r"Available\s*[:=]?\s*([\d,]+(?:\.\d+)?)",
        r"Credits?\s*[:=]?\s*([\d,]+(?:\.\d+)?)",
        r"Balance\s*[:=]?\s*([\d,]+(?:\.\d+)?)",
    ]
    for pattern in patterns:
        match = re.search(pattern, clean, re.IGNORECASE)
        if match:
            value = match.group(1).replace(",", "")
            return float(value) if "." in value else int(value)
    if re.fullmatch(r"[\d,]+(?:\.\d+)?", clean):
        value = clean.replace(",", "")
        return float(value) if "." in value else int(value)
    return None


def a2p_message_log_public(log: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": log.get("id"),
        "provider": log.get("provider"),
        "purpose": log.get("purpose"),
        "destination": log.get("destination"),
        "destination_masked": log.get("destination_masked") or safe_mask_a2p_destination(log.get("destination")),
        "source": log.get("source"),
        "message_text": log.get("message_text"),
        "message_preview": log.get("message_preview"),
        "status": log.get("status"),
        "smart_status": log.get("smart_status"),
        "http_status": log.get("http_status"),
        "message_id": log.get("message_id"),
        "response_summary": log.get("response_summary"),
        "error_message": log.get("error_message"),
        "request_context": sanitize_summary(log.get("request_context") or {}),
        "created_at": log.get("created_at"),
        "updated_at": log.get("updated_at"),
    }


def record_a2p_message_log(
    *,
    status: str,
    destination: str | None,
    source: str | None,
    message_text: str | None,
    purpose: str = "GENERAL",
    provider: str = "SMART_MESSAGING_SUITE",
    smart_status: str | None = None,
    http_status: int | None = None,
    message_id: str | None = None,
    response_summary: str | None = None,
    error_message: str | None = None,
    request_context: dict[str, Any] | None = None,
    created_by_admin_id: str | None = None,
) -> str:
    normalized_status = normalize_a2p_text(status, 20).upper() or "FAILED"
    if normalized_status not in {"PENDING", "SUCCESS", "FAILED"}:
        normalized_status = "FAILED"
    now = now_iso()
    log = {
        "id": str(uuid4()),
        "provider": normalize_a2p_text(provider, 80) or "SMART_MESSAGING_SUITE",
        "purpose": normalize_a2p_text(purpose, 80).upper() or "GENERAL",
        "destination": normalize_a2p_text(destination, 32),
        "destination_masked": safe_mask_a2p_destination(destination),
        "source": normalize_a2p_text(source, 80),
        "message_text": normalize_a2p_text(message_text, 1000),
        "message_preview": normalize_a2p_text(message_text, 160),
        "status": normalized_status,
        "smart_status": normalize_a2p_text(smart_status, 80),
        "http_status": http_status,
        "message_id": normalize_a2p_text(message_id, 120),
        "response_summary": normalize_a2p_text(response_summary, 1000),
        "error_message": normalize_a2p_text(error_message, 1000),
        "request_context": sanitize_summary(request_context or {}),
        "created_by_admin_id": created_by_admin_id,
        "created_at": now,
        "updated_at": now,
    }
    store = a2p_messaging_store()
    logs = [log, *[item for item in store.get("messageLogs", []) if isinstance(item, dict)]]
    store["messageLogs"] = logs[:A2P_MAX_MESSAGE_LOGS]
    save_persisted_a2p_messaging_store()
    return log["id"]


def send_a2p_sms_message(
    destination: str,
    message_text: str,
    source: str | None = None,
    *,
    purpose: str = "GENERAL",
    request_context: dict[str, Any] | None = None,
    created_by_admin_id: str | None = None,
    registered_delivery: bool | None = None,
) -> dict[str, Any]:
    raw_destination = normalize_a2p_text(destination, 32)
    raw_message = normalize_a2p_text(message_text, 1000)
    clean_source = ""
    store = a2p_messaging_store()
    try:
        if not store.get("enabled"):
            raise HTTPException(status_code=400, detail="A2P Messaging is disabled in System Settings.")
        clean_message = normalize_a2p_text(message_text, 500)
        if not clean_message:
            raise HTTPException(status_code=400, detail="SMS message text is required.")
        clean_destination = normalize_a2p_destination(destination)
        clean_source = normalize_a2p_text(source if source is not None else store.get("default_source"), 80)
        headers, extra_params = a2p_auth_headers_and_params(store)
        headers["Accept"] = "text/plain"
        delivery_requested = store.get("registered_delivery") if registered_delivery is None else bool(registered_delivery)
        form_data = {
            **extra_params,
            "destination": clean_destination,
            "text": clean_message,
            "registered": "1" if delivery_requested else "0",
        }
        if clean_source:
            form_data["source"] = clean_source
        status_code, response_text = a2p_http_request(
            a2p_join_url(store["base_url"], store["send_path"]),
            method="POST",
            headers=headers,
            form_data=form_data,
            timeout=30,
        )
        text = normalize_a2p_text(response_text, 1000)
        message_id_match = re.search(r"Message[- ]ID\s*:\s*([^\s]+)", text, re.IGNORECASE)
        message_id = message_id_match.group(1) if message_id_match else ""
        if status_code >= 400:
            error = f"Smart SMS send failed: HTTP {status_code} {text[:240]}"
            record_a2p_message_log(
                status="FAILED",
                destination=clean_destination,
                source=clean_source,
                message_text=clean_message,
                purpose=purpose,
                http_status=status_code,
                message_id=message_id,
                response_summary=text[:500],
                error_message=error,
                request_context=request_context,
                created_by_admin_id=created_by_admin_id,
            )
            raise HTTPException(status_code=400, detail=error)
        accepted = bool(re.match(r"^\s*0\s+\d{3}\s+OK", text, re.IGNORECASE))
        if not accepted:
            error = f"Smart SMS was not accepted: {text[:300]}"
            record_a2p_message_log(
                status="FAILED",
                destination=clean_destination,
                source=clean_source,
                message_text=clean_message,
                purpose=purpose,
                http_status=status_code,
                smart_status="NOT_ACCEPTED",
                message_id=message_id,
                response_summary=text[:500],
                error_message=error,
                request_context=request_context,
                created_by_admin_id=created_by_admin_id,
            )
            raise HTTPException(status_code=400, detail=error)
        record_a2p_message_log(
            status="SUCCESS",
            destination=clean_destination,
            source=clean_source,
            message_text=clean_message,
            purpose=purpose,
            http_status=status_code,
            smart_status="ACCEPTED",
            message_id=message_id,
            response_summary=text[:500],
            request_context=request_context,
            created_by_admin_id=created_by_admin_id,
        )
        return {
            "status": "SUCCESS",
            "destination": safe_mask_a2p_destination(clean_destination),
            "message_id": message_id,
            "response_summary": text[:300],
        }
    except HTTPException as exc:
        if not str(exc.detail).startswith("Smart SMS"):
            record_a2p_message_log(
                status="FAILED",
                destination=raw_destination,
                source=clean_source or source,
                message_text=raw_message,
                purpose=purpose,
                error_message=str(exc.detail),
                request_context=request_context,
                created_by_admin_id=created_by_admin_id,
            )
        raise
    except Exception as exc:
        record_a2p_message_log(
            status="FAILED",
            destination=raw_destination,
            source=clean_source or source,
            message_text=raw_message,
            purpose=purpose,
            error_message=str(exc),
            request_context=request_context,
            created_by_admin_id=created_by_admin_id,
        )
        raise HTTPException(status_code=400, detail=f"Smart SMS send failed: {exc}") from exc


def a2p_admin_notification_from_log(log: dict[str, Any], read_ids: set[str]) -> dict[str, Any]:
    status = normalize_a2p_text(log.get("status"), 20).upper()
    notification_id = f"a2p-{log.get('id')}"
    failed = status == "FAILED"
    success = status == "SUCCESS"
    return {
        "id": notification_id,
        "category": "A2P_SMS_FAILED" if failed else "A2P_SMS_SUCCESS" if success else "A2P_SMS_PENDING",
        "severity": "DANGER" if failed else "SUCCESS" if success else "WARNING",
        "title": "A2P SMS failed" if failed else "A2P SMS accepted" if success else "A2P SMS pending",
        "message": (
            f"{log.get('purpose') or 'SMS'} to {log.get('destination_masked') or 'destination'} failed: {log.get('error_message') or log.get('response_summary') or 'No response detail'}"
            if failed else
            f"{log.get('purpose') or 'SMS'} to {log.get('destination_masked') or 'destination'} was accepted by Smart."
            if success else
            f"{log.get('purpose') or 'SMS'} to {log.get('destination_masked') or 'destination'} is pending."
        ),
        "target_page": "System Settings",
        "target_url": "/system-settings?tab=A2P%20Messaging&subtab=Messages",
        "related_table": "a2p_message_logs",
        "related_id": str(log.get("id") or ""),
        "status": "READ" if notification_id in read_ids else "UNREAD",
        "metadata": {
            "purpose": log.get("purpose"),
            "destination": log.get("destination_masked"),
            "http_status": log.get("http_status"),
            "smart_status": log.get("smart_status"),
            "message_id": log.get("message_id"),
        },
        "created_at": log.get("created_at"),
        "read_at": log.get("read_at") if notification_id in read_ids else None,
        "source": "SYSTEM",
    }


def a2p_admin_notifications(limit: int = 40) -> list[dict[str, Any]]:
    store = a2p_messaging_store()
    read_ids = set(store.get("notificationReadIds") or [])
    logs = [log for log in store.get("messageLogs", []) if isinstance(log, dict)]
    notifications = [a2p_admin_notification_from_log(log, read_ids) for log in logs]
    notifications.sort(key=lambda item: (item.get("status") == "UNREAD", str(item.get("created_at") or "")), reverse=True)
    return notifications[:limit]


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


@router.get("/api/system-settings/backups")
def get_backup_metadata(admin=Depends(require_admin)):
    return public_backup_metadata()


@router.get("/api/system-settings/backups/configuration")
def download_configuration_backup(admin=Depends(require_admin)):
    payload = build_backup_payload("configuration", admin)
    add_audit(
        "system_configuration_backup_downloaded",
        "SystemBackup",
        "configuration",
        {"backup_type": "configuration"},
        admin["username"],
    )
    return backup_json_response(payload, "configuration")


@router.get("/api/system-settings/backups/full")
def download_full_backup(admin=Depends(require_admin)):
    payload = build_backup_payload("full", admin)
    database_section = payload.get("sections", {}).get("database", {})
    database_data = database_section.get("data", {}) if isinstance(database_section, dict) else {}
    add_audit(
        "system_full_backup_downloaded",
        "SystemBackup",
        "full",
        {
            "backup_type": "full",
            "database_status": database_data.get("status") if isinstance(database_data, dict) else "unknown",
        },
        admin["username"],
    )
    return backup_json_response(payload, "full")


@router.post("/api/system-settings/backups/restore")
def restore_backup(payload: BackupRestorePayload, admin=Depends(require_admin)):
    return restore_backup_data(payload.backup, admin)


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
    save_persisted_system_settings(*[section for section in ["branding", "business", "deployment"] if section in changed])
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


@router.get("/api/system-settings/a2p-messaging")
def get_a2p_messaging_settings(admin=Depends(require_admin)):
    return public_a2p_messaging_settings()


@router.patch("/api/system-settings/a2p-messaging")
def update_a2p_messaging_settings(payload: A2PMessagingSettingsPayload, admin=Depends(require_admin)):
    store = a2p_messaging_store()
    data = payload.model_dump(exclude_unset=True)
    for key in ("enabled", "registered_delivery"):
        if key in data and data.get(key) is not None:
            store[key] = bool(data.get(key))
    for key in ("provider", "api_id", "default_source", "notes"):
        if key in data and data.get(key) is not None:
            store[key] = normalize_a2p_text(data.get(key), 1000 if key == "notes" else 200)
    if "base_url" in data and data.get("base_url") is not None:
        store["base_url"] = normalize_a2p_base_url(data.get("base_url"))
    for key in ("send_path", "query_path", "cancel_path", "start_batch_path", "send_batch_path", "credits_path"):
        if key in data and data.get(key) is not None:
            store[key] = normalize_a2p_path(data.get(key), A2P_DEFAULT_SETTINGS[key])
    if "auth_method" in data and data.get("auth_method") is not None:
        auth_method = normalize_a2p_text(data.get("auth_method"), 40).upper()
        if auth_method not in A2P_AUTH_METHODS:
            raise HTTPException(status_code=400, detail="Unsupported A2P authentication method")
        store["auth_method"] = auth_method
    if data.get("clear_api_key"):
        store["api_key"] = ""
    elif "api_key" in data:
        api_key = normalize_a2p_text(data.get("api_key"), 500)
        if api_key:
            store["api_key"] = api_key
    if "username" in data and data.get("username") is not None:
        store["username"] = normalize_a2p_text(data.get("username"), 200)
    if data.get("clear_password"):
        store["password"] = ""
    elif "password" in data:
        password = normalize_a2p_text(data.get("password"), 500)
        if password:
            store["password"] = password
    if "monthly_credit_limit" in data:
        store["monthly_credit_limit"] = data.get("monthly_credit_limit")
    if "monthly_reset_day" in data and data.get("monthly_reset_day") is not None:
        store["monthly_reset_day"] = min(31, max(1, int(data.get("monthly_reset_day"))))
    if "source_addresses" in data and data.get("source_addresses") is not None:
        store["source_addresses"] = normalize_a2p_source_addresses(data.get("source_addresses"))
    save_persisted_a2p_messaging_store()
    add_audit(
        "system_a2p_messaging_settings_updated",
        "SystemA2PMessaging",
        "a2p_messaging",
        {
            "enabled": bool(store.get("enabled")),
            "provider": store.get("provider"),
            "auth_method": store.get("auth_method"),
            "api_key_configured": bool(normalize_a2p_text(store.get("api_key"))),
            "username_configured": bool(normalize_a2p_text(store.get("username"))),
            "password_configured": bool(normalize_a2p_text(store.get("password"))),
        },
        admin["username"],
    )
    return public_a2p_messaging_settings()


@router.post("/api/system-settings/a2p-messaging/check-credits")
def check_a2p_messaging_credits(admin=Depends(require_admin)):
    store = a2p_messaging_store()
    url = a2p_join_url(store["base_url"], store["credits_path"])
    username = normalize_a2p_text(store.get("username"), 200)
    password = normalize_a2p_text(store.get("password"), 500)
    if not username or not password:
        raise HTTPException(
            status_code=400,
            detail="Smart credits check requires the HTTP API username and password. The credits endpoint is documented with Basic Authentication, even if SMS sending uses API key headers.",
        )
    token_value = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
    headers = {
        "Accept": "text/plain",
        "Authorization": f"Basic {token_value}",
        "User-Agent": "3JMain/0.1 a2p-credits-check",
    }
    checked_at = now_iso()
    try:
        status_code, response_text = a2p_http_request(url, method="GET", headers=headers, timeout=20)
        text = normalize_a2p_text(response_text, 1000)
        if status_code >= 400:
            auth_hint = " The Smart credits endpoint is documented for prepaid accounts using Basic Authentication. Verify the saved username/password and confirm credits API access is provisioned on the Smart account."
            raise HTTPException(status_code=400, detail=f"Smart credits check failed: HTTP {status_code} {text[:200]}{auth_hint}")
        available = parse_a2p_credit_available(text)
        store["last_credit_check_at"] = checked_at
        store["last_credit_check_status"] = "SUCCESS"
        store["last_credit_available"] = available
        store["last_credit_response"] = text[:500]
        store["last_credit_error"] = "" if available is not None else f"Could not parse credits response: {text[:200]}"
        save_persisted_a2p_messaging_store()
        add_audit(
            "system_a2p_messaging_credits_checked",
            "SystemA2PMessaging",
            "a2p_messaging",
            {"status": "SUCCESS", "available": available},
            admin["username"],
        )
        return {
            **public_a2p_messaging_settings(),
            "credit_check": {
                "status": "SUCCESS",
                "available": available,
                "response_summary": text[:300],
                "checked_at": checked_at,
            },
        }
    except HTTPException as exc:
        store["last_credit_check_at"] = checked_at
        store["last_credit_check_status"] = "FAILED"
        store["last_credit_error"] = str(exc.detail)
        save_persisted_a2p_messaging_store()
        raise


@router.post("/api/system-settings/a2p-messaging/test-send")
def test_send_a2p_messaging(payload: A2PMessagingTestSendPayload, admin=Depends(require_admin)):
    store = a2p_messaging_store()
    message_text = normalize_a2p_text(payload.message_text, 500)
    if not message_text:
        raise HTTPException(status_code=400, detail="Message text is required")
    source = normalize_a2p_text(payload.source if payload.source is not None else store.get("default_source"), 80)
    registered = store.get("registered_delivery") if payload.registered_delivery is None else bool(payload.registered_delivery)
    sent_at = now_iso()
    destination = normalize_a2p_text(payload.destination, 32)
    try:
        sms_result = send_a2p_sms_message(
            destination,
            message_text,
            source=source,
            purpose="TEST_SEND",
            request_context={"origin": "system_settings_test_send"},
            created_by_admin_id=admin["id"],
            registered_delivery=registered,
        )
        store["last_test_send_at"] = sent_at
        store["last_test_send_status"] = "SUCCESS"
        store["last_test_send_destination"] = sms_result.get("destination") or safe_mask_a2p_destination(destination)
        store["last_test_send_message_id"] = sms_result.get("message_id")
        store["last_test_send_response"] = sms_result.get("response_summary") or ""
        store["last_test_send_error"] = ""
        save_persisted_a2p_messaging_store()
        add_audit(
            "system_a2p_messaging_test_sms_sent",
            "SystemA2PMessaging",
            "a2p_messaging",
            {
                "status": "SUCCESS",
                "destination": sms_result.get("destination") or safe_mask_a2p_destination(destination),
                "message_id": sms_result.get("message_id"),
            },
            admin["username"],
        )
        return {
            **public_a2p_messaging_settings(),
            "test_send": {
                "status": "SUCCESS",
                "destination": sms_result.get("destination") or safe_mask_a2p_destination(destination),
                "message_id": sms_result.get("message_id"),
                "response_summary": sms_result.get("response_summary") or "",
                "sent_at": sent_at,
            },
        }
    except HTTPException as exc:
        store["last_test_send_at"] = sent_at
        store["last_test_send_status"] = "FAILED"
        store["last_test_send_destination"] = safe_mask_a2p_destination(destination)
        store["last_test_send_message_id"] = None
        store["last_test_send_response"] = ""
        store["last_test_send_error"] = str(exc.detail)
        save_persisted_a2p_messaging_store()
        raise
    except Exception as exc:
        store["last_test_send_at"] = sent_at
        store["last_test_send_status"] = "FAILED"
        store["last_test_send_destination"] = safe_mask_a2p_destination(destination)
        store["last_test_send_message_id"] = None
        store["last_test_send_response"] = ""
        store["last_test_send_error"] = str(exc)
        save_persisted_a2p_messaging_store()
        raise HTTPException(status_code=400, detail=f"Smart test SMS failed: {exc}") from exc


@router.get("/api/system-settings/a2p-messaging/messages")
def list_a2p_messaging_messages(
    status: str | None = None,
    search: str | None = None,
    purpose: str | None = None,
    page: int = 1,
    page_size: int = 20,
    admin=Depends(require_admin),
):
    selected_status = normalize_a2p_text(status, 20).upper() if status else ""
    selected_purpose = normalize_a2p_text(purpose, 80).upper() if purpose else ""
    query_text = normalize_a2p_text(search, 120).lower()
    if selected_status and selected_status != "ALL" and selected_status not in {"PENDING", "SUCCESS", "FAILED"}:
        raise HTTPException(status_code=400, detail="Unsupported A2P message status filter.")
    logs = [log for log in a2p_messaging_store().get("messageLogs", []) if isinstance(log, dict)]

    def matches(log: dict[str, Any]) -> bool:
        if selected_status and selected_status != "ALL" and normalize_a2p_text(log.get("status"), 20).upper() != selected_status:
            return False
        if selected_purpose and selected_purpose != "ALL" and normalize_a2p_text(log.get("purpose"), 80).upper() != selected_purpose:
            return False
        if query_text:
            haystack = " ".join(
                normalize_a2p_text(log.get(key), 1000)
                for key in ["destination", "destination_masked", "source", "purpose", "message_text", "message_id", "response_summary", "error_message"]
            ).lower()
            return query_text in haystack
        return True

    filtered = [log for log in logs if matches(log)]
    safe_page_size = min(100, max(5, int(page_size or 20)))
    safe_page = max(1, int(page or 1))
    offset = (safe_page - 1) * safe_page_size
    items = filtered[offset:offset + safe_page_size]
    purpose_counts: dict[str, int] = {}
    for log in logs:
        key = normalize_a2p_text(log.get("purpose"), 80).upper() or "GENERAL"
        purpose_counts[key] = purpose_counts.get(key, 0) + 1
    return {
        "items": [a2p_message_log_public(log) for log in items],
        "total": len(filtered),
        "page": safe_page,
        "page_size": safe_page_size,
        "summary": {
            "total": len(logs),
            "success": sum(1 for log in logs if normalize_a2p_text(log.get("status"), 20).upper() == "SUCCESS"),
            "failed": sum(1 for log in logs if normalize_a2p_text(log.get("status"), 20).upper() == "FAILED"),
            "today": sum(1 for log in logs if normalize_a2p_text(log.get("created_at"), 32)[:10] == datetime.now(timezone.utc).date().isoformat()),
            "this_month": sum(1 for log in logs if normalize_a2p_text(log.get("created_at"), 32)[:7] == datetime.now(timezone.utc).strftime("%Y-%m")),
            "last_failed_at": next((log.get("created_at") for log in logs if normalize_a2p_text(log.get("status"), 20).upper() == "FAILED"), None),
            "last_sent_at": logs[0].get("created_at") if logs else None,
        },
        "purposes": [{"purpose": key, "count": count} for key, count in sorted(purpose_counts.items())],
    }


@router.get("/api/admin/notifications")
def list_admin_notifications(limit: int = 40, admin=Depends(require_admin)):
    safe_limit = min(100, max(10, int(limit or 40)))
    items = a2p_admin_notifications(safe_limit)
    unread_items = [item for item in items if item.get("status") == "UNREAD"]
    return {
        "items": items,
        "unread_count": len(unread_items),
        "a2p_failure_unread_count": sum(1 for item in unread_items if item.get("category") == "A2P_SMS_FAILED"),
        "a2p_success_unread_count": sum(1 for item in unread_items if item.get("category") == "A2P_SMS_SUCCESS"),
        "support_unread_count": 0,
    }


@router.post("/api/admin/notifications/read-all")
def mark_all_admin_notifications_read(admin=Depends(require_admin)):
    store = a2p_messaging_store()
    notifications = a2p_admin_notifications(100)
    read_ids = set(store.get("notificationReadIds") or [])
    read_ids.update(item["id"] for item in notifications)
    store["notificationReadIds"] = sorted(read_ids)
    save_persisted_a2p_messaging_store()
    return {"status": "OK"}


@router.post("/api/admin/notifications/{notification_id}/read")
def mark_admin_notification_read(notification_id: str, admin=Depends(require_admin)):
    normalized_id = normalize_a2p_text(notification_id, 120)
    if not normalized_id.startswith("a2p-"):
        raise HTTPException(status_code=404, detail="Notification not found")
    store = a2p_messaging_store()
    known_ids = {item["id"] for item in a2p_admin_notifications(100)}
    if normalized_id not in known_ids:
        raise HTTPException(status_code=404, detail="Notification not found")
    read_ids = set(store.get("notificationReadIds") or [])
    read_ids.add(normalized_id)
    store["notificationReadIds"] = sorted(read_ids)
    save_persisted_a2p_messaging_store()
    return next(item for item in a2p_admin_notifications(100) if item["id"] == normalized_id)


@router.get("/api/system-settings/avatars")
def get_avatars(admin=Depends(require_admin)):
    return public_avatar_settings()


@router.get("/api/system-settings/map-images")
def get_map_images(admin=Depends(require_admin)):
    return public_map_image_settings()


@router.get("/api/system-settings/map-providers")
@router.get("/api/system/map-providers")
def get_map_providers(admin=Depends(require_admin)):
    return public_map_provider_settings()


@router.patch("/api/system-settings/map-providers")
@router.patch("/api/system/map-providers")
def update_map_providers(payload: MapProviderSettingsPayload, admin=Depends(require_admin)):
    changed = payload.model_dump()
    normalized = normalize_map_provider_store({
        "defaultProviderId": changed.get("defaultProviderId") or changed.get("default_provider_id"),
        "providers": changed.get("providers") or [],
    })
    usable = [provider for provider in normalized["providers"] if map_provider_is_usable(provider)]
    if not usable:
        raise HTTPException(status_code=400, detail="Enable and configure at least one map provider")
    store = settings_store()
    store["mapProviders"] = normalized
    save_persisted_map_provider_store()
    add_audit(
        "system_map_providers_updated",
        "SystemMapProviders",
        "map-providers",
        {
            "defaultProviderId": normalized.get("defaultProviderId"),
            "enabled": [provider["id"] for provider in normalized["providers"] if provider.get("enabled")],
            "usable": [provider["id"] for provider in usable],
        },
        admin["username"],
    )
    return public_map_provider_settings()


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
