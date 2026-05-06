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
    for barangay, municipality, province in DEFAULT_LOCATION_SEEDS:
        seed = {
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
        if find_matching_location(seed):
            continue
        _locations.append(location_record_from_data(seed, source="PRELOADED"))


def ensure_location_record(data: dict[str, Any], actor: dict[str, Any] | None = None) -> dict[str, Any] | None:
    seed_default_locations()
    if data.get("locationId"):
        for location in _locations:
            if location["id"] == data["locationId"]:
                merge_missing_location_fields(location, data)
                return public_location(location)
    if not synthesize_address(data):
        return None
    existing = find_matching_location(data)
    if existing:
        merge_missing_location_fields(existing, data)
        return public_location(existing)
    location = location_record_from_data(data, actor=actor, source=data.get("geocode_source") or "CUSTOMER_PROFILING")
    _locations.insert(0, location)
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
    _locations.remove(location)
    add_audit(
        "system_location_deleted",
        "SystemLocation",
        location_id,
        {"address": location["address"]},
        admin["username"],
    )
    return {"status": "ok"}
