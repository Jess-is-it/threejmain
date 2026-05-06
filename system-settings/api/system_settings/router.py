import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone
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


class SettingsPayload(BaseModel):
    branding: dict[str, Any] | None = None
    business: dict[str, Any] | None = None
    deployment: dict[str, Any] | None = None


class LocationPayload(BaseModel):
    location_name: str | None = None
    address: str
    municipality: str | None = None
    barangay: str | None = None
    province: str | None = None
    region: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    geocode_source: str | None = None
    raw_geocode: dict[str, Any] | None = None
    notes: str | None = None


def configure_system_settings(
    current_admin: Callable[[str | None], dict[str, Any]],
    audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None],
    settings_store: dict[str, Any],
    port_registry: Callable[[], list[dict[str, Any]]],
) -> None:
    global _current_admin, _audit_logger, _settings, _port_registry
    _current_admin = current_admin
    _audit_logger = audit_logger
    _settings = settings_store
    _port_registry = port_registry


def require_admin(authorization: str | None = Header(default=None)):
    if _current_admin is None:
        raise HTTPException(status_code=500, detail="System Settings module is not configured")
    return _current_admin(authorization)


def settings_store() -> dict[str, Any]:
    if _settings is None:
        raise HTTPException(status_code=500, detail="System Settings store is not configured")
    return _settings


def add_audit(action: str, target_type: str, target_id: str, details: dict[str, Any] | None, actor: str) -> None:
    if _audit_logger is not None:
        _audit_logger(action, target_type, target_id, details, actor)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def sanitize_summary(value):
    if isinstance(value, dict):
        clean = {}
        for key, item in value.items():
            if any(word in key.lower() for word in ["password", "secret", "token", "authorization", "csrf"]):
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


def public_location(location: dict[str, Any]) -> dict[str, Any]:
    return dict(location)


def find_location(location_id: str) -> dict[str, Any]:
    for location in _locations:
        if location["id"] == location_id:
            return location
    raise HTTPException(status_code=404, detail="Location not found")


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


@router.get("/api/system-settings/locations")
@router.get("/api/locations")
def list_locations(admin=Depends(require_admin)):
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
    address = payload.address.strip()
    if not address:
        raise HTTPException(status_code=400, detail="Address is required")

    created_at = now_iso()
    location = {
        "id": str(uuid4()),
        "location_name": payload.location_name.strip() if payload.location_name else "",
        "address": address,
        "municipality": payload.municipality or "",
        "barangay": payload.barangay or "",
        "province": payload.province or "",
        "region": payload.region or "",
        "latitude": payload.latitude,
        "longitude": payload.longitude,
        "geocode_source": payload.geocode_source or "MANUAL",
        "raw_geocode": sanitize_summary(payload.raw_geocode or {}),
        "notes": payload.notes or "",
        "created_by_admin_id": admin.get("id"),
        "created_by_username": admin.get("username"),
        "created_at": created_at,
        "updated_at": created_at,
    }
    _locations.insert(0, location)
    add_audit(
        "system_location_created",
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
    _locations.remove(location)
    add_audit(
        "system_location_deleted",
        "SystemLocation",
        location_id,
        {"address": location["address"]},
        admin["username"],
    )
    return {"status": "ok"}
