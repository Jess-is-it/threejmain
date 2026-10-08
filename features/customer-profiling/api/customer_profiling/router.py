import hashlib
import json
import logging
import math
import os
import re
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field
from .staging_reset import execute_staging_reset, preview_staging_reset, require_staging_owner

try:
    import psycopg
    from psycopg.rows import dict_row
    from psycopg.types.json import Json
except Exception:  # pragma: no cover - allows local syntax checks without optional DB client.
    psycopg = None
    dict_row = None
    Json = None

try:
    from system_settings import ensure_location_record
except Exception:  # pragma: no cover - keeps module usable before System Settings is wired.
    ensure_location_record = None


router = APIRouter(prefix="/api/customer-profiling", tags=["customer-profiling"])
logger = logging.getLogger(__name__)

customers: list[dict[str, Any]] = []

_current_admin: Callable[[str | None], dict[str, Any]] | None = None
_audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None] | None = None
_service_catalog_provider: Callable[[], list[dict[str, Any]]] | None = None
_service_migration_provider: Callable[[dict[str, Any], str], dict[str, Any]] | None = None
_billing_migration_provider: Callable[[dict[str, Any], str], dict[str, Any]] | None = None
_billing_promotion_provider: Callable[[], list[dict[str, Any]]] | None = None
_customer_location_backfill_complete = False

CUSTOMER_TYPES = ["RESIDENTIAL", "BUSINESS", "ENTERPRISE"]
CUSTOMER_STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED", "PENDING"]
CUSTOMER_GENDERS = ["MALE", "FEMALE"]
LOCATION_CATALOG = json.loads(
    Path(__file__).with_name("cagayan_isabela_locations.json").read_text(encoding="utf-8")
)
LOCATION_CATALOG_PROVINCES = LOCATION_CATALOG["provinces"]
PROVINCES = list(LOCATION_CATALOG_PROVINCES)
MUNICIPALITIES_BY_PROVINCE = {
    province: list(cities)
    for province, cities in LOCATION_CATALOG_PROVINCES.items()
}
BARANGAYS_BY_PROVINCE_CITY = {
    f"{province}::{city}": barangays
    for province, cities in LOCATION_CATALOG_PROVINCES.items()
    for city, barangays in cities.items()
}
BULK_UPLOAD_HEADERS = [
    "firstName",
    "middleName",
    "lastName",
    "birthDate",
    "contactNumber",
    "alternateMobileNumber",
    "facebookAccountName",
    "facebookProfileLink",
    "email",
    "addressLine1",
    "addressLine2",
    "locationId",
    "locationName",
    "landmark",
    "province",
    "city",
    "barangay",
    "latitude",
    "longitude",
    "gender",
]
REQUIRED_BULK_UPLOAD_HEADERS = [
    "firstName",
    "lastName",
    "contactNumber",
    "barangay",
]
EXISTING_SUBSCRIBER_PROFILE_HEADERS = [
    header for header in BULK_UPLOAD_HEADERS
    if header not in {"locationId", "locationName"}
]
EXISTING_SUBSCRIBER_MIGRATION_HEADERS = [
    *EXISTING_SUBSCRIBER_PROFILE_HEADERS,
    "monthlyRate",
    "billingMode",
    "serviceStartDate",
    "serviceStatus",
    "qualifiedPromotionCodes",
    "lastPaymentPromotionCode",
    "lastPaymentDate",
    "lastPaymentAmount",
    "paymentCoverageFromMonth",
    "lastPaidThroughMonth",
    "outstandingBalance",
    "balanceAsOfDate",
]
REQUIRED_EXISTING_SUBSCRIBER_HEADERS = [
    *REQUIRED_BULK_UPLOAD_HEADERS,
    "monthlyRate",
    "billingMode",
    "serviceStartDate",
    "serviceStatus",
]
EXISTING_SUBSCRIBER_COLUMN_GUIDE = {
    "firstName": {"purpose": "Customer's given name.", "format": "Text", "example": "JUAN"},
    "middleName": {"purpose": "Customer's middle name or initial, when known.", "format": "Optional text", "example": "D"},
    "lastName": {"purpose": "Customer's family name.", "format": "Text", "example": "DELA CRUZ"},
    "birthDate": {"purpose": "Customer's date of birth, when available.", "format": "Optional YYYY-MM-DD", "example": "1990-05-18"},
    "contactNumber": {"purpose": "Primary mobile or telephone number used to identify and contact the customer.", "format": "Text; preserve the leading zero", "example": "09171234567"},
    "alternateMobileNumber": {"purpose": "Secondary mobile number, when available.", "format": "Optional text; preserve the leading zero", "example": "09180000001"},
    "facebookAccountName": {"purpose": "Customer's Facebook display name for contact reference.", "format": "Optional text", "example": "JUAN DELA CRUZ"},
    "facebookProfileLink": {"purpose": "Direct link to the customer's Facebook profile.", "format": "Optional URL", "example": "https://www.facebook.com/juan.delacruz"},
    "email": {"purpose": "Customer's email address.", "format": "Optional email address", "example": "juan.delacruz@example.com"},
    "addressLine1": {"purpose": "Primary service-address detail such as house number, street, zone, or purok.", "format": "Optional text", "example": "PUROK 1"},
    "addressLine2": {"purpose": "Additional service-address detail.", "format": "Optional text", "example": "SITIO CENTRO"},
    "landmark": {"purpose": "Nearby landmark that helps identify the installed line's location.", "format": "Optional text", "example": "NEAR BARANGAY HALL"},
    "province": {"purpose": "Province of the installed service address.", "format": "Dropdown: CAGAYAN or ISABELA", "example": "CAGAYAN"},
    "city": {"purpose": "City or municipality of the installed service address; choices depend on Province.", "format": "Dependent dropdown", "example": "ENRILE"},
    "barangay": {"purpose": "Barangay of the installed service address; choices depend on Province and City.", "format": "Dependent dropdown", "example": "ALIBAGO"},
    "latitude": {"purpose": "North/south GPS coordinate of the installed line; used to create the internal location record.", "format": "Optional decimal (-90 to 90) or degrees/minutes/seconds with N/S", "example": "17°31'31.42\"N"},
    "longitude": {"purpose": "East/west GPS coordinate of the installed line; used to create the internal location record.", "format": "Optional decimal (-180 to 180) or degrees/minutes/seconds with E/W", "example": "121°41'05.74\"E"},
    "gender": {"purpose": "Customer gender used by the profile and avatar settings.", "format": "Optional dropdown: MALE or FEMALE", "example": "MALE"},
    "monthlyRate": {"purpose": "Current monthly amount charged for the installed line; combined with Billing Mode for plan mapping.", "format": "Non-negative number; no currency symbol", "example": "1000"},
    "billingMode": {"purpose": "Identifies whether service is paid before or after the service month.", "format": "Dropdown: PREPAID or POSTPAID", "example": "PREPAID"},
    "serviceStartDate": {"purpose": "Original date the already-installed internet line became active.", "format": "YYYY-MM-DD", "example": "2024-01-15"},
    "serviceStatus": {"purpose": "Current operating status of the installed line at migration.", "format": "Dropdown: ACTIVE or SUSPENDED", "example": "ACTIVE"},
    "qualifiedPromotionCodes": {"purpose": "Billing promotions the subscriber should qualify for after migration.", "format": "Optional Billing promo codes separated by semicolons", "example": "EARLY-BIRD-200;LOYALTY-50"},
    "lastPaymentPromotionCode": {"purpose": "Promotion actually applied to the imported last payment; used to explain a discounted payment amount.", "format": "Optional single Billing promo code", "example": "EARLY-BIRD-200"},
    "lastPaymentDate": {"purpose": "Date of the latest payment in the old system; stored as reference evidence, not new cash.", "format": "Optional YYYY-MM-DD", "example": "2026-08-05"},
    "lastPaymentAmount": {"purpose": "Amount of the latest old-system payment; helps infer how many months it covered.", "format": "Optional non-negative number", "example": "2000"},
    "paymentCoverageFromMonth": {"purpose": "First service month covered by the last payment.", "format": "Optional YYYY-MM", "example": "2026-06"},
    "lastPaidThroughMonth": {"purpose": "Latest service month that is fully paid; arrears begin after this month.", "format": "Optional YYYY-MM", "example": "2026-07"},
    "outstandingBalance": {"purpose": "Total unpaid balance carried from the old system; enter zero when nothing is owed.", "format": "Optional non-negative number", "example": "2000"},
    "balanceAsOfDate": {"purpose": "Date on which Outstanding Balance was accurate; used for a reviewed opening balance.", "format": "Optional YYYY-MM-DD", "example": "2026-09-16"},
}
MIGRATION_PROFILE_FIELDS = set(EXISTING_SUBSCRIBER_PROFILE_HEADERS)
MIGRATION_STATUSES = {"ACTIVE", "SUSPENDED"}
MONTH_PATTERN = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
ONBOARDING_VERIFICATION_RULES = {
    "SERVICEABILITY": {
        "storageKey": "serviceability",
        "outcomes": {"QUALIFIED", "NEEDS_REVIEW", "NOT_SERVICEABLE"},
    },
    "NETWORK_EQUIPMENT": {
        "storageKey": "networkEquipment",
        "outcomes": {"VERIFIED", "NEEDS_ATTENTION"},
    },
}

CUSTOMER_STORAGE_MODE = os.getenv("CUSTOMER_PROFILING_STORAGE") or ("postgres" if os.getenv("DATABASE_URL") else "memory")
CUSTOMER_SEED_DEMO = os.getenv("CUSTOMER_PROFILING_SEED_DEMO", "false").strip().lower() in {"1", "true", "yes", "on"}
SUBSCRIBER_MIGRATION_TIMEZONE = os.getenv("BILLING_TIMEZONE", "Asia/Manila").strip() or "Asia/Manila"
try:
    SUBSCRIBER_MIGRATION_ZONE = ZoneInfo(SUBSCRIBER_MIGRATION_TIMEZONE)
except ZoneInfoNotFoundError:
    logger.warning("Unknown BILLING_TIMEZONE %s for subscriber migration; falling back to UTC", SUBSCRIBER_MIGRATION_TIMEZONE)
    SUBSCRIBER_MIGRATION_TIMEZONE = "UTC"
    SUBSCRIBER_MIGRATION_ZONE = ZoneInfo("UTC")


class CustomerPayload(BaseModel):
    accountNumber: str | None = None
    firstName: str | None = None
    lastName: str | None = None
    middleName: str | None = None
    businessName: str | None = None
    birthDate: str | None = None
    recommendedByCustomer: bool | str | None = None
    recommendedByCustomerId: str | None = None
    recommendedByCustomerAccountNumber: str | None = None
    recommendedByCustomerName: str | None = None
    contactNumber: str | None = None
    alternateMobileNumber: str | None = None
    facebookAccountName: str | None = None
    facebookProfileLink: str | None = None
    secondaryContacts: list[dict[str, Any]] = Field(default_factory=list)
    secondaryContactName: str | None = None
    secondaryContactNumber: str | None = None
    secondaryContactFacebookAccount: str | None = None
    secondaryContactRelationship: str | None = None
    email: str | None = None
    locationId: str | None = None
    locationName: str | None = None
    landmark: str | None = None
    addressLine1: str | None = None
    addressLine2: str | None = None
    barangay: str | None = None
    city: str | None = None
    province: str | None = None
    latitude: str | float | None = None
    longitude: str | float | None = None
    gender: str | None = None
    customerType: str | None = None
    status: str | None = None


class OnboardingVerificationPayload(BaseModel):
    outcome: str
    reference: str | None = None
    notes: str | None = None
    networkAccessVerified: bool | None = None
    equipmentAssignmentVerified: bool | None = None


class ExistingSubscriberMigrationBatchPayload(BaseModel):
    filename: str = "existing-subscribers.csv"
    rows: list[dict[str, Any]] = Field(default_factory=list)


class ExistingSubscriberMigrationCommitPayload(BaseModel):
    planMappings: dict[str, dict[str, Any]] = Field(default_factory=dict)
    promotionMappings: dict[str, dict[str, Any]] = Field(default_factory=dict)
    rowDecisions: dict[str, dict[str, Any]] = Field(default_factory=dict)


class CustomerProfileStore:
    def __init__(self) -> None:
        self.database_url = os.getenv("DATABASE_URL", "").strip()
        self.storage_mode = CUSTOMER_STORAGE_MODE.strip().lower()
        self._schema_ready = False

    @property
    def postgres_enabled(self) -> bool:
        return self.storage_mode == "postgres"

    def _connect(self):
        if not self.postgres_enabled:
            return None
        if psycopg is None or dict_row is None:
            raise HTTPException(status_code=503, detail="Customer Profiling database driver is not installed")
        if not self.database_url:
            raise HTTPException(status_code=503, detail="Customer Profiling database URL is not configured")
        return psycopg.connect(self.database_url, autocommit=True, row_factory=dict_row)

    def ensure_schema(self) -> bool:
        if not self.postgres_enabled:
            return False
        if self._schema_ready:
            return True
        try:
            with self._connect() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT to_regclass('public.customer_profiles') AS table_name")
                    row = cursor.fetchone() or {}
                    if not row.get("table_name"):
                        raise HTTPException(status_code=503, detail="Customer Profiling database migration has not run")
            self._schema_ready = True
            return True
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Customer Profiling database schema initialization failed")
            raise HTTPException(status_code=503, detail=f"Customer Profiling database is unavailable: {exc}") from exc

    def _row_to_customer(self, row: dict[str, Any]) -> dict[str, Any]:
        payload = dict(row.get("data") or {})
        payload.update(
            {
                "id": row.get("id"),
                "accountNumber": row.get("account_number") or payload.get("accountNumber"),
                "createdAt": (row.get("created_at").isoformat() if hasattr(row.get("created_at"), "isoformat") else row.get("created_at")) or payload.get("createdAt"),
                "updatedAt": (row.get("updated_at").isoformat() if hasattr(row.get("updated_at"), "isoformat") else row.get("updated_at")) or payload.get("updatedAt"),
                "deletedAt": (row.get("deleted_at").isoformat() if hasattr(row.get("deleted_at"), "isoformat") else row.get("deleted_at")) or payload.get("deletedAt"),
                "createdByUserId": row.get("created_by_user_id") or payload.get("createdByUserId"),
                "updatedByUserId": row.get("updated_by_user_id") or payload.get("updatedByUserId"),
            },
        )
        return payload

    def list_customers(self) -> list[dict[str, Any]] | None:
        if not self.ensure_schema():
            return None
        with self._connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT * FROM customer_profiles ORDER BY created_at DESC, id")
                return [self._row_to_customer(row) for row in cursor.fetchall()]

    def save_customer(self, customer: dict[str, Any]) -> bool:
        if not self.ensure_schema():
            return False
        if Json is None:
            raise HTTPException(status_code=503, detail="Customer Profiling JSON database adapter is not installed")
        payload = dict(customer)
        created_at = payload.get("createdAt") or now_iso()
        updated_at = payload.get("updatedAt") or created_at
        deleted_at = payload.get("deletedAt") or None
        with self._connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO customer_profiles (
                        id,
                        account_number,
                        full_name,
                        customer_type,
                        status,
                        gender,
                        province,
                        city,
                        barangay,
                        contact_number,
                        email,
                        location_id,
                        data,
                        created_at,
                        updated_at,
                        deleted_at,
                        created_by_user_id,
                        updated_by_user_id
                    )
                    VALUES (
                        %(id)s,
                        %(account_number)s,
                        %(full_name)s,
                        %(customer_type)s,
                        %(status)s,
                        %(gender)s,
                        %(province)s,
                        %(city)s,
                        %(barangay)s,
                        %(contact_number)s,
                        %(email)s,
                        %(location_id)s,
                        %(data)s,
                        %(created_at)s,
                        %(updated_at)s,
                        %(deleted_at)s,
                        %(created_by_user_id)s,
                        %(updated_by_user_id)s
                    )
                    ON CONFLICT (id) DO UPDATE SET
                        account_number = EXCLUDED.account_number,
                        full_name = EXCLUDED.full_name,
                        customer_type = EXCLUDED.customer_type,
                        status = EXCLUDED.status,
                        gender = EXCLUDED.gender,
                        province = EXCLUDED.province,
                        city = EXCLUDED.city,
                        barangay = EXCLUDED.barangay,
                        contact_number = EXCLUDED.contact_number,
                        email = EXCLUDED.email,
                        location_id = EXCLUDED.location_id,
                        data = EXCLUDED.data,
                        updated_at = EXCLUDED.updated_at,
                        deleted_at = EXCLUDED.deleted_at,
                        updated_by_user_id = EXCLUDED.updated_by_user_id
                    """,
                    {
                        "id": payload["id"],
                        "account_number": payload.get("accountNumber") or "",
                        "full_name": customer_full_name(payload),
                        "customer_type": payload.get("customerType") or "",
                        "status": payload.get("status") or "",
                        "gender": payload.get("gender") or "",
                        "province": payload.get("province") or "",
                        "city": payload.get("city") or "",
                        "barangay": payload.get("barangay") or "",
                        "contact_number": payload.get("contactNumber") or "",
                        "email": payload.get("email") or "",
                        "location_id": payload.get("locationId") or "",
                        "data": Json(payload),
                        "created_at": created_at,
                        "updated_at": updated_at,
                        "deleted_at": deleted_at,
                        "created_by_user_id": payload.get("createdByUserId") or "",
                        "updated_by_user_id": payload.get("updatedByUserId") or "",
                    },
                )
        return True

    def status(self) -> dict[str, Any]:
        if not self.postgres_enabled:
            return {"mode": "memory", "ready": False, "reason": "CUSTOMER_PROFILING_STORAGE is not postgres"}
        self.ensure_schema()
        with self._connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT count(*) AS total, count(*) FILTER (WHERE deleted_at IS NULL) AS active FROM customer_profiles")
                row = cursor.fetchone()
        return {
            "mode": "postgres",
            "ready": True,
            "table": "customer_profiles",
            "totalRows": int(row.get("total") or 0),
            "activeRows": int(row.get("active") or 0),
            "demoSeedEnabled": CUSTOMER_SEED_DEMO,
        }


customer_store = CustomerProfileStore()


class SubscriberMigrationStore:
    def __init__(self) -> None:
        self._batches: dict[str, dict[str, Any]] = {}
        self._rows: dict[str, list[dict[str, Any]]] = {}

    @property
    def postgres_enabled(self) -> bool:
        return customer_store.postgres_enabled

    def ensure_schema(self) -> bool:
        if not self.postgres_enabled:
            return False
        customer_store.ensure_schema()
        with customer_store._connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT to_regclass('public.subscriber_migration_batches') AS batches, to_regclass('public.subscriber_migration_rows') AS rows")
                record = cursor.fetchone() or {}
                if not record.get("batches") or not record.get("rows"):
                    raise HTTPException(status_code=503, detail="Existing-subscriber migration database migration has not run")
        return True

    @staticmethod
    def _timestamp(value: Any) -> Any:
        return value.isoformat() if hasattr(value, "isoformat") else value

    def _batch_from_row(self, record: dict[str, Any]) -> dict[str, Any]:
        data = dict(record.get("data") or {})
        data.update(
            {
                "id": record.get("id"),
                "filename": record.get("filename"),
                "fileHash": record.get("file_hash"),
                "cutoverDate": self._timestamp(record.get("cutover_date")),
                "status": record.get("status"),
                "createdAt": self._timestamp(record.get("created_at")),
                "updatedAt": self._timestamp(record.get("updated_at")),
                "createdByUserId": record.get("created_by_user_id"),
                "updatedByUserId": record.get("updated_by_user_id"),
            }
        )
        return data

    def _migration_row_from_record(self, record: dict[str, Any]) -> dict[str, Any]:
        data = dict(record.get("data") or {})
        data.update(
            {
                "id": record.get("id"),
                "batchId": record.get("batch_id"),
                "rowNumber": record.get("row_number"),
                "fingerprint": record.get("row_fingerprint"),
                "status": record.get("status"),
                "result": dict(record.get("result") or {}),
                "error": record.get("error") or "",
                "createdAt": self._timestamp(record.get("created_at")),
                "updatedAt": self._timestamp(record.get("updated_at")),
            }
        )
        return data

    def save_batch(self, batch: dict[str, Any]) -> None:
        if not self.ensure_schema():
            self._batches[batch["id"]] = dict(batch)
            return
        if Json is None:
            raise HTTPException(status_code=503, detail="Customer Profiling JSON database adapter is not installed")
        data = {key: value for key, value in batch.items() if key not in {"id", "filename", "fileHash", "cutoverDate", "status", "createdAt", "updatedAt", "createdByUserId", "updatedByUserId"}}
        with customer_store._connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO subscriber_migration_batches (id, filename, file_hash, cutover_date, status, data, created_at, updated_at, created_by_user_id, updated_by_user_id)
                    VALUES (%(id)s, %(filename)s, %(file_hash)s, %(cutover_date)s, %(status)s, %(data)s, %(created_at)s, %(updated_at)s, %(created_by)s, %(updated_by)s)
                    ON CONFLICT (id) DO UPDATE SET cutover_date = EXCLUDED.cutover_date, status = EXCLUDED.status, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at, updated_by_user_id = EXCLUDED.updated_by_user_id
                    """,
                    {
                        "id": batch["id"], "filename": batch["filename"], "file_hash": batch.get("fileHash", ""),
                        "cutover_date": batch["cutoverDate"], "status": batch["status"], "data": Json(data),
                        "created_at": batch["createdAt"], "updated_at": batch["updatedAt"],
                        "created_by": batch.get("createdByUserId", ""), "updated_by": batch.get("updatedByUserId", ""),
                    },
                )

    def save_row(self, row: dict[str, Any]) -> None:
        if not self.ensure_schema():
            rows = self._rows.setdefault(row["batchId"], [])
            for index, current in enumerate(rows):
                if current["id"] == row["id"]:
                    rows[index] = dict(row)
                    break
            else:
                rows.append(dict(row))
            return
        if Json is None:
            raise HTTPException(status_code=503, detail="Customer Profiling JSON database adapter is not installed")
        data = {key: value for key, value in row.items() if key not in {"id", "batchId", "rowNumber", "fingerprint", "status", "result", "error", "createdAt", "updatedAt"}}
        with customer_store._connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO subscriber_migration_rows (id, batch_id, row_number, row_fingerprint, status, data, result, error, created_at, updated_at)
                    VALUES (%(id)s, %(batch_id)s, %(row_number)s, %(fingerprint)s, %(status)s, %(data)s, %(result)s, %(error)s, %(created_at)s, %(updated_at)s)
                    ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, data = EXCLUDED.data, result = EXCLUDED.result, error = EXCLUDED.error, updated_at = EXCLUDED.updated_at
                    """,
                    {
                        "id": row["id"], "batch_id": row["batchId"], "row_number": row["rowNumber"], "fingerprint": row["fingerprint"],
                        "status": row["status"], "data": Json(data), "result": Json(row.get("result") or {}), "error": row.get("error", ""),
                        "created_at": row["createdAt"], "updated_at": row["updatedAt"],
                    },
                )

    def get_batch(self, batch_id: str) -> dict[str, Any] | None:
        if not self.ensure_schema():
            batch = self._batches.get(batch_id)
            return dict(batch) if batch else None
        with customer_store._connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT * FROM subscriber_migration_batches WHERE id = %s", (batch_id,))
                record = cursor.fetchone()
        return self._batch_from_row(record) if record else None

    def list_rows(self, batch_id: str) -> list[dict[str, Any]]:
        if not self.ensure_schema():
            return [dict(row) for row in sorted(self._rows.get(batch_id, []), key=lambda item: item["rowNumber"])]
        with customer_store._connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT * FROM subscriber_migration_rows WHERE batch_id = %s ORDER BY row_number", (batch_id,))
                records = cursor.fetchall()
        return [self._migration_row_from_record(record) for record in records]

    def find_imported_fingerprint(self, fingerprint: str) -> dict[str, Any] | None:
        if not self.ensure_schema():
            for rows in self._rows.values():
                for row in rows:
                    if row.get("fingerprint") == fingerprint and row.get("status") == "IMPORTED":
                        return dict(row)
            return None
        with customer_store._connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT * FROM subscriber_migration_rows WHERE row_fingerprint = %s AND status = 'IMPORTED' LIMIT 1", (fingerprint,))
                record = cursor.fetchone()
        return self._migration_row_from_record(record) if record else None


subscriber_migration_store = SubscriberMigrationStore()


def configure_customer_profiling(
    current_admin: Callable[[str | None], dict[str, Any]],
    audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None],
    service_catalog_provider: Callable[[], list[dict[str, Any]]] | None = None,
    service_migration_provider: Callable[[dict[str, Any], str], dict[str, Any]] | None = None,
    billing_migration_provider: Callable[[dict[str, Any], str], dict[str, Any]] | None = None,
    billing_promotion_provider: Callable[[], list[dict[str, Any]]] | None = None,
) -> None:
    global _current_admin, _audit_logger, _service_catalog_provider, _service_migration_provider, _billing_migration_provider, _billing_promotion_provider, _customer_location_backfill_complete
    _current_admin = current_admin
    _audit_logger = audit_logger
    _service_catalog_provider = service_catalog_provider
    _service_migration_provider = service_migration_provider
    _billing_migration_provider = billing_migration_provider
    _billing_promotion_provider = billing_promotion_provider
    _customer_location_backfill_complete = False


def require_admin(authorization: str | None = Header(default=None)):
    if _current_admin is None:
        raise HTTPException(status_code=500, detail="Customer Profiling module is not configured")
    return _current_admin(authorization)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def subscriber_migration_business_date(current: datetime | None = None) -> str:
    moment = current or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(SUBSCRIBER_MIGRATION_ZONE).date().isoformat()


def add_audit(action: str, target_type: str, target_id: str, details: dict[str, Any] | None, actor: str) -> None:
    if _audit_logger is not None:
        _audit_logger(action, target_type, target_id, details, actor)


def normalize_upper(value: Any) -> str:
    return str(value or "").strip().upper()


def clean_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip()
    return value


def normalize_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "y", "on"}


def customer_full_name(customer: dict[str, Any]) -> str:
    parts = [customer.get("firstName"), customer.get("middleName"), customer.get("lastName")]
    return " ".join(str(part).strip() for part in parts if part)


def visible_customers() -> list[dict[str, Any]]:
    return [customer for customer in all_customers() if not customer.get("deletedAt")]


def customer_summary(customer: dict[str, Any]) -> dict[str, Any]:
    return {
        **customer,
        "fullName": customer_full_name(customer),
    }


def all_customers() -> list[dict[str, Any]]:
    stored_customers = customer_store.list_customers()
    if stored_customers is not None:
        customers[:] = stored_customers
    return customers


def save_customer_record(customer: dict[str, Any]) -> None:
    if customer_store.save_customer(customer):
        customers[:] = customer_store.list_customers() or []
        return
    for index, existing in enumerate(customers):
        if existing["id"] == customer["id"]:
            customers[index] = customer
            return
    customers.append(customer)


def sync_customer_lifecycle_status(
    customer_id: str,
    status: str,
    details: dict[str, Any] | None = None,
    actor: str = "system",
) -> dict[str, Any]:
    seed_customer_data()
    normalized_status = normalize_upper(status)
    if normalized_status not in CUSTOMER_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid customer status")
    customer = find_customer(customer_id)
    previous_status = customer.get("status") or ""
    if previous_status == normalized_status:
        return {**customer_summary(customer), "statusChanged": False}
    customer["status"] = normalized_status
    customer["updatedAt"] = now_iso()
    customer["updatedByUserId"] = actor
    save_customer_record(customer)
    add_audit(
        "customer_status_synced",
        "Customer",
        customer["id"],
        {
            "accountNumber": customer.get("accountNumber"),
            "previousStatus": previous_status,
            "status": normalized_status,
            **(details or {}),
        },
        actor,
    )
    return {**customer_summary(customer), "statusChanged": True, "previousStatus": previous_status}


def count_by(rows: list[dict[str, Any]], field: str) -> list[dict[str, Any]]:
    counts: dict[str, int] = {}
    for row in rows:
        value = str(row.get(field) or "UNSPECIFIED")
        counts[value] = counts.get(value, 0) + 1
    return [{"name": key, "count": counts[key]} for key in sorted(counts, key=lambda item: counts[item], reverse=True)]


def customer_metrics() -> dict[str, int]:
    rows = visible_customers()
    return {
        "customers": len(rows),
        "active": sum(1 for customer in rows if customer.get("status") == "ACTIVE"),
        "pending": sum(1 for customer in rows if customer.get("status") == "PENDING"),
    }


def generate_account_number() -> str:
    existing = {customer["accountNumber"] for customer in all_customers()}
    seed = 58392741
    candidate = seed + len(existing) * 7919
    while True:
        account_number = str(candidate % 90000000 + 10000000)
        if account_number not in existing:
            return account_number
        candidate += 7919


def parse_iso_date(value: Any, field_name: str, required: bool = False) -> str:
    text = str(value or "").strip()
    if not text:
        if required:
            raise ValueError(f"{field_name} is required")
        return ""
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError as exc:
        raise ValueError(f"{field_name} must use YYYY-MM-DD") from exc


def parse_month(value: Any, field_name: str, required: bool = False) -> str:
    text = str(value or "").strip()
    if not text:
        if required:
            raise ValueError(f"{field_name} is required")
        return ""
    if not MONTH_PATTERN.fullmatch(text):
        raise ValueError(f"{field_name} must use YYYY-MM")
    return text


def month_number(value: str) -> int:
    year, month = (int(part) for part in value.split("-"))
    return year * 12 + month - 1


def month_value(number: int) -> str:
    return f"{number // 12:04d}-{number % 12 + 1:02d}"


def months_inclusive(start: str, end: str) -> list[str]:
    if not start or not end or month_number(start) > month_number(end):
        return []
    return [month_value(number) for number in range(month_number(start), month_number(end) + 1)]


def money_value(value: Any, field_name: str, required: bool = False) -> float:
    text = str(value if value is not None else "").strip().replace(",", "")
    if not text:
        if required:
            raise ValueError(f"{field_name} is required")
        return 0.0
    try:
        amount = round(float(text), 2)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be a number") from exc
    if amount < 0:
        raise ValueError(f"{field_name} cannot be negative")
    return amount


def migration_plan_key(row: dict[str, Any]) -> str:
    return "|".join(
        [
            f"{float(row.get('monthlyRate') or 0):.2f}",
            normalize_upper(row.get("billingMode")),
        ]
    )


def migration_plan_label(row: dict[str, Any]) -> str:
    return f"Legacy {normalize_upper(row.get('billingMode')).title()} Rate {float(row.get('monthlyRate') or 0):,.2f}"


def migration_identity_key(row: dict[str, Any]) -> str:
    contact = re.sub(r"\D", "", str(row.get("contactNumber") or ""))
    return "|".join(
        [
            normalize_upper(row.get("firstName")),
            normalize_upper(row.get("lastName")),
            contact,
            normalize_upper(row.get("addressLine1") or row.get("landmark")),
            normalize_upper(row.get("barangay")),
            normalize_upper(row.get("city")),
        ]
    )


def migration_row_fingerprint(row: dict[str, Any]) -> str:
    material = "|".join(
        [
            migration_identity_key(row),
            migration_plan_key(row),
            str(row.get("serviceStartDate") or ""),
        ]
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def migration_billing_schedule(billing_mode: str, effective_date: str, paid_through_month: str = "") -> dict[str, Any]:
    effective_month_number = month_number(parse_iso_date(effective_date, "effectiveDate", required=True)[:7])
    mode = normalize_upper(billing_mode)
    if mode not in {"PREPAID", "POSTPAID"}:
        raise ValueError("billingMode must be PREPAID or POSTPAID")
    base_next_month_number = effective_month_number + (1 if mode == "PREPAID" else 0)
    paid_through_next_month_number = month_number(paid_through_month) + 1 if paid_through_month else base_next_month_number
    next_month_number = max(base_next_month_number, paid_through_next_month_number)
    return {
        "billingDay": 1,
        "nextBillingDate": f"{month_value(next_month_number)}-01",
        "scheduleSource": "BILLING_MODE_AND_PAID_THROUGH",
    }


def normalize_promotion_code(value: Any) -> str:
    return re.sub(r"\s+", "-", str(value or "").strip().upper())


def parse_promotion_codes(value: Any) -> list[str]:
    codes: list[str] = []
    for raw_code in str(value or "").split(";"):
        code = normalize_promotion_code(raw_code)
        if code and code not in codes:
            codes.append(code)
    return codes


def migration_promotion_discount_amount(promotion: dict[str, Any], base_amount: float) -> float:
    discount_type = normalize_upper(promotion.get("discountType"))
    if discount_type == "WAIVE":
        return round(base_amount, 2)
    if discount_type == "PERCENT":
        return round(base_amount * float(promotion.get("discountPercent") or 0) / 100, 2)
    return round(min(base_amount, float(promotion.get("discountAmount") or 0)), 2)


def migration_promotion_is_compatible(promotion: dict[str, Any], billing_mode: str) -> bool:
    promotion_mode = normalize_upper(promotion.get("billingMode"))
    return (
        normalize_upper(promotion.get("appliesTo")) == "MONTHLY_SERVICE"
        and not bool(promotion.get("requiresApproval"))
        and (not promotion_mode or promotion_mode == normalize_upper(billing_mode))
    )


def payment_and_balance_preview(
    row: dict[str, Any],
    effective_date: str,
    last_payment_promotion: dict[str, Any] | None = None,
) -> dict[str, Any]:
    monthly_rate = float(row["monthlyRate"])
    payment_amount = float(row.get("lastPaymentAmount") or 0)
    coverage_from = str(row.get("paymentCoverageFromMonth") or "")
    paid_through = str(row.get("lastPaidThroughMonth") or "")
    coverage_source = "EXPLICIT" if coverage_from and paid_through else ""
    warnings: list[str] = []
    covered_month_count = 0
    imported_promotion_code = normalize_promotion_code(row.get("lastPaymentPromotionCode"))
    promotion_discount_per_month = 0.0
    discounted_monthly_amount = monthly_rate
    promotion_match_status = "NONE"
    if imported_promotion_code and last_payment_promotion:
        promotion_discount_per_month = migration_promotion_discount_amount(last_payment_promotion, monthly_rate)
        discounted_monthly_amount = round(max(0, monthly_rate - promotion_discount_per_month), 2)
        promotion_match_status = "PENDING_AMOUNT_CHECK"
    elif imported_promotion_code:
        promotion_match_status = "UNRESOLVED"
        warnings.append(f"Map last-payment promotion {imported_promotion_code} before verifying the discounted payment amount.")

    payment_monthly_basis = discounted_monthly_amount if promotion_match_status == "PENDING_AMOUNT_CHECK" else monthly_rate
    exact_months = payment_amount / payment_monthly_basis if payment_monthly_basis > 0 and payment_amount > 0 else 0
    exact_month_count = int(round(exact_months)) if abs(exact_months - round(exact_months)) < 0.0001 else 0
    if exact_months and not exact_month_count:
        basis_label = "discounted monthly amount" if promotion_match_status == "PENDING_AMOUNT_CHECK" else "imported monthly rate"
        warnings.append(f"Last payment amount is not an exact multiple of the {basis_label}.")

    if coverage_from and paid_through:
        covered_month_count = len(months_inclusive(coverage_from, paid_through))
        expected_payment_amount = round(covered_month_count * payment_monthly_basis, 2)
        if payment_amount and expected_payment_amount != round(payment_amount, 2):
            basis_label = "after the mapped promotion" if promotion_match_status == "PENDING_AMOUNT_CHECK" else "at the imported rate"
            warnings.append(f"Explicit payment coverage does not equal last payment amount {basis_label}.")
            if promotion_match_status == "PENDING_AMOUNT_CHECK":
                promotion_match_status = "AMOUNT_MISMATCH"
        elif payment_amount and promotion_match_status == "PENDING_AMOUNT_CHECK":
            promotion_match_status = "MATCHED"
    elif paid_through and exact_month_count:
        coverage_from = month_value(month_number(paid_through) - exact_month_count + 1)
        covered_month_count = exact_month_count
        coverage_source = "INFERRED_FROM_DISCOUNTED_AMOUNT_AND_PAID_THROUGH" if last_payment_promotion else "INFERRED_FROM_AMOUNT_AND_PAID_THROUGH"
        if promotion_match_status == "PENDING_AMOUNT_CHECK":
            promotion_match_status = "MATCHED"
    elif coverage_from and exact_month_count:
        paid_through = month_value(month_number(coverage_from) + exact_month_count - 1)
        covered_month_count = exact_month_count
        coverage_source = "INFERRED_FROM_DISCOUNTED_AMOUNT_AND_COVERAGE_START" if last_payment_promotion else "INFERRED_FROM_AMOUNT_AND_COVERAGE_START"
        if promotion_match_status == "PENDING_AMOUNT_CHECK":
            promotion_match_status = "MATCHED"
    elif payment_amount:
        warnings.append("Provide a paid-through month or coverage start to anchor the last payment.")

    expected_discounted_amount = round(covered_month_count * discounted_monthly_amount, 2) if covered_month_count and last_payment_promotion else 0.0
    legacy_promotion = {
        "importedCode": imported_promotion_code,
        "id": str((last_payment_promotion or {}).get("id") or ""),
        "code": str((last_payment_promotion or {}).get("promoCode") or imported_promotion_code),
        "name": str((last_payment_promotion or {}).get("name") or ""),
        "discountType": str((last_payment_promotion or {}).get("discountType") or ""),
        "regularMonthlyRate": round(monthly_rate, 2),
        "discountPerMonth": promotion_discount_per_month,
        "discountedMonthlyAmount": discounted_monthly_amount,
        "expectedDiscountedAmount": expected_discounted_amount,
        "matchStatus": promotion_match_status,
    }

    schedule = migration_billing_schedule(row["billingMode"], effective_date, paid_through)
    next_cycle_month = schedule["nextBillingDate"][:7]
    arrear_start = month_value(month_number(paid_through) + 1) if paid_through else ""
    arrear_end = month_value(month_number(next_cycle_month) - 1)
    arrear_months = months_inclusive(arrear_start, arrear_end) if arrear_start else []
    calculated_balance = round(len(arrear_months) * monthly_rate, 2)
    balance_was_supplied = bool(row.get("outstandingBalanceSupplied"))
    supplied_balance = float(row.get("outstandingBalance") or 0)
    balance_variance = round(supplied_balance - calculated_balance, 2) if balance_was_supplied else 0.0

    if balance_was_supplied and abs(balance_variance) > 0.009:
        classification = "BALANCE_VARIANCE"
        warnings.append("Outstanding balance differs from the reconstructed unpaid months; choose monthly invoices or one opening balance.")
    elif arrear_months and paid_through:
        classification = "VERIFIED_ARREARS" if coverage_source == "EXPLICIT" else "INFERRED_COVERAGE" if coverage_source else "CALCULATED_ARREARS"
    elif supplied_balance > 0 and not paid_through:
        classification = "INSUFFICIENT_INFORMATION"
        warnings.append("A balance exists without a paid-through month; use a reviewed opening balance.")
    elif supplied_balance <= 0 and not arrear_months:
        classification = "NO_ARREARS"
    else:
        classification = "INSUFFICIENT_INFORMATION"

    default_resolution = "OPENING_BALANCE" if classification in {"BALANCE_VARIANCE", "INSUFFICIENT_INFORMATION"} and supplied_balance > 0 else "MONTHLY_INVOICES"
    return {
        "classification": classification,
        "coverageFromMonth": coverage_from,
        "paidThroughMonth": paid_through,
        "coverageSource": coverage_source,
        "coveredMonthCount": covered_month_count,
        "arrearMonths": arrear_months,
        "calculatedBalance": calculated_balance,
        "suppliedBalance": supplied_balance,
        "balanceVariance": balance_variance,
        "defaultResolution": default_resolution,
        "paymentAmountInterpretation": "PROMOTION_DISCOUNTED" if promotion_match_status == "MATCHED" else "REGULAR_RATE",
        "legacyPaymentPromotion": legacy_promotion,
        **schedule,
        "warnings": warnings,
    }


def duplicate_candidates(row: dict[str, Any]) -> list[dict[str, Any]]:
    row_contact = re.sub(r"\D", "", str(row.get("contactNumber") or ""))
    row_name = f"{normalize_upper(row.get('firstName'))}|{normalize_upper(row.get('lastName'))}"
    row_address = f"{normalize_upper(row.get('addressLine1') or row.get('landmark'))}|{normalize_upper(row.get('barangay'))}|{normalize_upper(row.get('city'))}"
    matches: list[dict[str, Any]] = []
    for customer in visible_customers():
        score = 0
        reasons: list[str] = []
        customer_contact = re.sub(r"\D", "", str(customer.get("contactNumber") or ""))
        if row_contact and row_contact == customer_contact:
            score += 60
            reasons.append("same contact number")
        if row_name == f"{normalize_upper(customer.get('firstName'))}|{normalize_upper(customer.get('lastName'))}":
            score += 30
            reasons.append("same name")
        customer_address = f"{normalize_upper(customer.get('addressLine1') or customer.get('landmark'))}|{normalize_upper(customer.get('barangay'))}|{normalize_upper(customer.get('city'))}"
        if row_address.strip("|") and row_address == customer_address:
            score += 20
            reasons.append("same address")
        if score >= 30:
            matches.append({"id": customer["id"], "accountNumber": customer.get("accountNumber", ""), "fullName": customer_full_name(customer), "contactNumber": customer.get("contactNumber", ""), "address": customer_location_address(customer), "score": score, "reasons": reasons})
    return sorted(matches, key=lambda item: (-item["score"], item["fullName"]))[:5]


def normalize_migration_coordinate(value: str, field: str) -> str:
    if not value:
        return ""
    limit = 90 if field == "latitude" else 180
    directions = "NS" if field == "latitude" else "EW"
    dms = re.fullmatch(
        r"(?P<sign>[+-]?)(?P<degrees>\d{1,3})\s*°\s*"
        r"(?P<minutes>\d{1,2})\s*['′’]\s*"
        r"(?P<seconds>\d{1,2}(?:\.\d+)?)\s*[\"″”]?\s*"
        r"(?P<direction>[NSEW])?",
        value,
        re.IGNORECASE,
    )
    if dms:
        direction = (dms.group("direction") or "").upper()
        if direction and (direction not in directions or dms.group("sign")):
            raise ValueError(f"{field} has an invalid compass direction")
        minutes = int(dms.group("minutes"))
        seconds = float(dms.group("seconds"))
        if minutes >= 60 or seconds >= 60:
            raise ValueError(f"{field} minutes and seconds must be less than 60")
        coordinate = int(dms.group("degrees")) + minutes / 60 + seconds / 3600
        if direction in {"S", "W"} or dms.group("sign") == "-":
            coordinate = -coordinate
        normalized = f"{coordinate:.8f}".rstrip("0").rstrip(".")
    else:
        try:
            coordinate = float(value)
        except ValueError as exc:
            raise ValueError(f"{field} must be decimal degrees or degrees/minutes/seconds") from exc
        normalized = value
    if not math.isfinite(coordinate) or abs(coordinate) > limit:
        raise ValueError(f"{field} must be between -{limit} and {limit}")
    return normalized


def normalize_migration_row(
    raw_row: dict[str, Any],
    row_number: int,
    effective_date: str | None = None,
    promotion_catalog: list[dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    row = {header: str(raw_row.get(header) if raw_row.get(header) is not None else "").strip() for header in EXISTING_SUBSCRIBER_MIGRATION_HEADERS}
    errors: list[str] = []
    for field in REQUIRED_EXISTING_SUBSCRIBER_HEADERS:
        if not row.get(field):
            errors.append(f"{field} is required")
    for field in ("latitude", "longitude"):
        try:
            row[field] = normalize_migration_coordinate(row[field], field)
        except ValueError as exc:
            errors.append(str(exc))
    try:
        row["monthlyRate"] = money_value(row.get("monthlyRate"), "monthlyRate", required=True)
        row["lastPaymentAmount"] = money_value(row.get("lastPaymentAmount"), "lastPaymentAmount")
        row["outstandingBalanceSupplied"] = bool(row.get("outstandingBalance"))
        row["outstandingBalance"] = money_value(row.get("outstandingBalance"), "outstandingBalance")
        row["serviceStartDate"] = parse_iso_date(row.get("serviceStartDate"), "serviceStartDate", required=True)
        row["lastPaymentDate"] = parse_iso_date(row.get("lastPaymentDate"), "lastPaymentDate")
        row["balanceAsOfDate"] = parse_iso_date(row.get("balanceAsOfDate"), "balanceAsOfDate")
        row["paymentCoverageFromMonth"] = parse_month(row.get("paymentCoverageFromMonth"), "paymentCoverageFromMonth")
        row["lastPaidThroughMonth"] = parse_month(row.get("lastPaidThroughMonth"), "lastPaidThroughMonth")
    except ValueError as exc:
        errors.append(str(exc))
    for amount_field in ["monthlyRate", "lastPaymentAmount", "outstandingBalance"]:
        if not isinstance(row.get(amount_field), (int, float)):
            row[amount_field] = 0.0
    row["billingMode"] = normalize_upper(row.get("billingMode"))
    row["serviceStatus"] = normalize_upper(row.get("serviceStatus") or "ACTIVE")
    row["qualifiedPromotionCodes"] = parse_promotion_codes(row.get("qualifiedPromotionCodes"))
    row["lastPaymentPromotionCode"] = normalize_promotion_code(row.get("lastPaymentPromotionCode"))
    if row["billingMode"] not in {"PREPAID", "POSTPAID"}:
        errors.append("billingMode must be PREPAID or POSTPAID")
    if row["serviceStatus"] not in MIGRATION_STATUSES:
        errors.append("serviceStatus must be ACTIVE or SUSPENDED")
    row["planName"] = migration_plan_label(row)
    row["planReferenceSource"] = "MONTHLY_RATE_AND_BILLING_MODE"
    row["rowNumber"] = row_number
    row["planKey"] = migration_plan_key(row)
    row["groupKey"] = migration_identity_key(row)
    row["fingerprint"] = migration_row_fingerprint(row)
    row["duplicates"] = duplicate_candidates(row)
    if not errors:
        promotion_by_code = {
            normalize_promotion_code(promotion.get("promoCode")): promotion
            for promotion in promotion_catalog or []
        }
        last_payment_promotion = promotion_by_code.get(row["lastPaymentPromotionCode"])
        if last_payment_promotion and not migration_promotion_is_compatible(last_payment_promotion, row["billingMode"]):
            last_payment_promotion = None
        preview = payment_and_balance_preview(
            row,
            effective_date or subscriber_migration_business_date(),
            last_payment_promotion,
        )
        row["billingDay"] = preview["billingDay"]
        row["nextBillingDate"] = preview["nextBillingDate"]
        row["billingPreview"] = preview
    else:
        row["billingPreview"] = {"classification": "INVALID", "warnings": []}
    return row, errors


def find_customer(customer_id: str) -> dict[str, Any]:
    for customer in all_customers():
        if customer["id"] == customer_id and not customer.get("deletedAt"):
            return customer
    raise HTTPException(status_code=404, detail="Customer not found")


def build_duplicate_fingerprint(data: dict[str, Any]) -> str:
    return "|".join(
        [
            normalize_upper(data.get("firstName")),
            normalize_upper(data.get("lastName")),
            normalize_upper(data.get("landmark")),
            normalize_upper(data.get("addressLine1")),
            normalize_upper(data.get("province")),
            normalize_upper(data.get("city")),
            normalize_upper(data.get("barangay")),
            str(data.get("latitude") or "").strip(),
            str(data.get("longitude") or "").strip(),
        ],
    )


def customer_location_address(record: dict[str, Any]) -> str:
    address_parts: list[str] = []
    seen_parts: set[str] = set()
    for field in ["addressLine1", "addressLine2", "barangay", "city", "province"]:
        value = str(record.get(field) or "").strip()
        value_key = value.upper()
        if value and value_key not in seen_parts:
            address_parts.append(value)
            seen_parts.add(value_key)
    return ", ".join(address_parts)


def ensure_customer_location(record: dict[str, Any], admin: dict[str, Any] | None = None) -> bool:
    if ensure_location_record is None:
        return False
    previous_location_id = record.get("locationId") or ""
    previous_location_name = record.get("locationName") or ""
    location_data = {
        "locationId": record.get("locationId"),
        "location_name": record.get("locationName") or record.get("landmark") or record.get("barangay") or record.get("city") or record.get("addressLine1"),
        "address": customer_location_address(record),
        "municipality": record.get("city"),
        "barangay": record.get("barangay"),
        "province": record.get("province"),
        "latitude": record.get("latitude") or None,
        "longitude": record.get("longitude") or None,
        "notes": "Manual location linked from Customer Profiling.",
    }
    location = ensure_location_record(location_data, actor=admin)
    if location:
        record["locationId"] = location.get("id") or record.get("locationId") or ""
        record["locationName"] = location.get("location_name") or record.get("locationName") or ""
    return (
        (record.get("locationId") or "") != previous_location_id
        or (record.get("locationName") or "") != previous_location_name
    )


def sync_customer_manual_locations(actor: dict[str, Any] | None = None) -> dict[str, int]:
    global _customer_location_backfill_complete
    if _customer_location_backfill_complete or ensure_location_record is None:
        return {"scanned": 0, "linked": 0}

    sync_actor = actor or {"id": "system", "username": "system"}
    rows = visible_customers()
    linked_count = 0
    for customer in rows:
        if ensure_customer_location(customer, sync_actor):
            save_customer_record(customer)
            linked_count += 1
    _customer_location_backfill_complete = True
    if rows:
        add_audit(
            "customer_locations_linked_to_manual_catalog",
            "CustomerLocation",
            "bulk",
            {"scanned_count": len(rows), "linked_count": linked_count},
            sync_actor.get("username") or "system",
        )
    return {"scanned": len(rows), "linked": linked_count}


def assert_no_duplicate_customer(candidate: dict[str, Any], ignore_id: str | None = None) -> None:
    fingerprint = build_duplicate_fingerprint(candidate)
    if not fingerprint.replace("|", ""):
        return
    for customer in visible_customers():
        if ignore_id and customer["id"] == ignore_id:
            continue
        if build_duplicate_fingerprint(customer) == fingerprint:
            raise HTTPException(
                status_code=409,
                detail="Duplicate customer detected for the same name and service address.",
            )


def customer_payload_to_record(payload: CustomerPayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
    base = dict(current or {})
    incoming = payload.model_dump(exclude_unset=True)
    for key, value in incoming.items():
        base[key] = value or [] if key == "secondaryContacts" else clean_value(value)

    required = [
        "firstName",
        "lastName",
        "contactNumber",
    ]
    missing = [field for field in required if not base.get(field)]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required customer fields: {', '.join(missing)}")

    base["customerType"] = normalize_upper(base.get("customerType") or "RESIDENTIAL")
    base["status"] = normalize_upper(base.get("status") or "ACTIVE")
    base["gender"] = normalize_upper(base.get("gender") or "MALE")
    base["businessName"] = clean_value(base.get("businessName")) or ""
    base["birthDate"] = clean_value(base.get("birthDate")) or ""
    base["recommendedByCustomer"] = normalize_bool(base.get("recommendedByCustomer"))
    base["province"] = normalize_upper(base.get("province"))
    base["city"] = normalize_upper(base.get("city"))
    base["barangay"] = normalize_upper(base.get("barangay"))
    base["locationName"] = clean_value(base.get("locationName")) or ""

    if base["customerType"] not in CUSTOMER_TYPES:
        raise HTTPException(status_code=400, detail="Invalid customer type")
    if base["customerType"] == "BUSINESS" and not base["businessName"]:
        raise HTTPException(status_code=400, detail="Business Name is required for business customers.")
    if base["status"] not in CUSTOMER_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid customer status")
    if base["gender"] not in CUSTOMER_GENDERS:
        raise HTTPException(status_code=400, detail="Invalid customer gender")

    if base["recommendedByCustomer"]:
        recommender_id = clean_value(base.get("recommendedByCustomerId")) or ""
        if not recommender_id:
            raise HTTPException(status_code=400, detail="Recommended By Customer is required when referral is enabled.")
        if recommender_id == str(base.get("id") or ""):
            raise HTTPException(status_code=400, detail="A customer cannot recommend their own profile.")
        recommender = next(
            (customer for customer in visible_customers() if customer["id"] == recommender_id),
            None,
        )
        if not recommender:
            raise HTTPException(status_code=400, detail="Selected recommending customer was not found.")
        base["recommendedByCustomerId"] = recommender["id"]
        base["recommendedByCustomerAccountNumber"] = recommender.get("accountNumber") or ""
        base["recommendedByCustomerName"] = customer_full_name(recommender)
    else:
        base["recommendedByCustomerId"] = ""
        base["recommendedByCustomerAccountNumber"] = ""
        base["recommendedByCustomerName"] = ""

    secondary = list(base.get("secondaryContacts") or [])
    if base.get("secondaryContactName") and not secondary:
        secondary.append(
            {
                "name": base.get("secondaryContactName"),
                "contactNumber": base.get("secondaryContactNumber"),
                "facebookAccount": base.get("secondaryContactFacebookAccount"),
                "relationship": base.get("secondaryContactRelationship"),
            },
        )
    base["secondaryContacts"] = secondary
    return base


def seed_customer_data() -> None:
    if all_customers():
        sync_customer_manual_locations()
        return
    if not CUSTOMER_SEED_DEMO:
        sync_customer_manual_locations()
        return
    created_at = now_iso()
    seed_rows = [
        {
            "accountNumber": "58392741",
            "firstName": "MARIA",
            "lastName": "SANTOS",
            "middleName": "LOPEZ",
            "birthDate": "2002-05-18",
            "contactNumber": "09171234567",
            "alternateMobileNumber": "09180000001",
            "facebookAccountName": "MARIA SANTOS",
            "facebookProfileLink": "https://www.facebook.com/maria.santos",
            "email": "maria.santos@example.com",
            "addressLine1": "BLK 12 LOT 5 SAN ISIDRO VILLAGE",
            "locationName": "ALIBAGO",
            "barangay": "ALIBAGO",
            "city": "ENRILE",
            "province": "CAGAYAN",
            "latitude": "17.559311",
            "longitude": "121.684928",
            "gender": "FEMALE",
            "customerType": "RESIDENTIAL",
            "status": "ACTIVE",
            "secondaryContacts": [{"name": "PEDRO SANTOS", "contactNumber": "09175551234", "relationship": "Spouse"}],
        },
        {
            "accountNumber": "76149028",
            "firstName": "JUAN",
            "lastName": "DELA CRUZ",
            "businessName": "DELA CRUZ SARI-SARI STORE",
            "birthDate": "1995-09-12",
            "contactNumber": "09180000001",
            "facebookAccountName": "JUAN DELA CRUZ",
            "email": "juan.delacruz@example.com",
            "addressLine1": "PUROK 1",
            "addressLine2": "",
            "locationName": "BATU",
            "barangay": "BATU",
            "city": "ENRILE",
            "province": "CAGAYAN",
            "latitude": "",
            "longitude": "",
            "gender": "MALE",
            "customerType": "BUSINESS",
            "status": "PENDING",
            "secondaryContacts": [{"name": "ANA DELA CRUZ", "contactNumber": "09181230000", "relationship": "Owner"}],
        },
        {
            "accountNumber": "83476195",
            "firstName": "ANGELA",
            "lastName": "REYES",
            "birthDate": "1999-01-24",
            "contactNumber": "09180000002",
            "facebookAccountName": "ANGELA REYES",
            "email": "a.reyes@example.com",
            "addressLine1": "SUNSET HOMES PHASE 2",
            "locationName": "DIVISORIA",
            "barangay": "DIVISORIA",
            "city": "SANTA MARIA",
            "province": "ISABELA",
            "latitude": "",
            "longitude": "",
            "gender": "FEMALE",
            "customerType": "RESIDENTIAL",
            "status": "ACTIVE",
            "secondaryContacts": [],
        },
        {
            "accountNumber": "67921453",
            "firstName": "KERVIN",
            "lastName": "TAN",
            "birthDate": "1988-07-03",
            "contactNumber": "09180000003",
            "facebookAccountName": "KERVIN TAN",
            "email": "kervin.tan@example.com",
            "addressLine1": "8 INDUSTRIAL ROAD",
            "locationName": "CENTRO",
            "barangay": "CENTRO",
            "city": "CABAGAN",
            "province": "ISABELA",
            "latitude": "",
            "longitude": "",
            "gender": "MALE",
            "customerType": "ENTERPRISE",
            "status": "SUSPENDED",
            "secondaryContacts": [{"name": "LIZA TAN", "contactNumber": "09189999999", "relationship": "Office Admin"}],
        },
        {
            "accountNumber": "94573268",
            "firstName": "LIZA",
            "lastName": "GARCIA",
            "birthDate": "2001-11-09",
            "contactNumber": "09180000004",
            "facebookAccountName": "LIZA GARCIA",
            "addressLine1": "24 MAPLE ST",
            "locationName": "SAN ANTONIO",
            "barangay": "SAN ANTONIO",
            "city": "ENRILE",
            "province": "CAGAYAN",
            "latitude": "",
            "longitude": "",
            "gender": "FEMALE",
            "customerType": "RESIDENTIAL",
            "status": "ACTIVE",
            "secondaryContacts": [],
        },
    ]
    for row in seed_rows:
        ensure_customer_location(row, {"id": "seed", "username": "seed"})
        save_customer_record(
            {
                "id": str(uuid4()),
                "createdAt": created_at,
                "updatedAt": created_at,
                "deletedAt": None,
                "createdByUserId": "seed",
                "updatedByUserId": "seed",
                **row,
            },
        )
    sync_customer_manual_locations()


@router.get("/meta")
def customer_profiling_meta(admin=Depends(require_admin)):
    cities = sorted({city for cities in MUNICIPALITIES_BY_PROVINCE.values() for city in cities})
    barangays = sorted({barangay for barangays in BARANGAYS_BY_PROVINCE_CITY.values() for barangay in barangays})
    return {
        "customerTypes": CUSTOMER_TYPES,
        "customerStatuses": CUSTOMER_STATUSES,
        "customerGenders": CUSTOMER_GENDERS,
        "provinces": PROVINCES,
        "cities": cities,
        "citiesByProvince": MUNICIPALITIES_BY_PROVINCE,
        "barangays": barangays,
        "barangaysByProvinceCity": BARANGAYS_BY_PROVINCE_CITY,
        "locationCatalog": {
            "source": LOCATION_CATALOG.get("source"),
            "sourceUrl": LOCATION_CATALOG.get("sourceUrl"),
            "retrievedDate": LOCATION_CATALOG.get("retrievedDate"),
        },
        "bulkUploadHeaders": BULK_UPLOAD_HEADERS,
        "requiredBulkUploadHeaders": REQUIRED_BULK_UPLOAD_HEADERS,
    }


@router.get("/readiness")
def customer_profiling_readiness(admin=Depends(require_admin)):
    storage = customer_store.status()
    return {
        "module": "customer-profiling",
        "realDataReady": storage.get("ready") is True and storage.get("mode") == "postgres",
        "storage": storage,
        "remainingProductionStages": [
            "Add role/permission enforcement beyond the current shared admin guard.",
            "Move browser-local customer drafts to authenticated server-side draft storage if drafts must survive device changes.",
            "Add backup/restore runbooks and operational monitoring before live customer import.",
        ],
    }


class StagingSubscriberResetPayload(BaseModel):
    previewToken: str
    confirmation: str


@router.get("/staging-reset/availability")
def staging_subscriber_reset_availability(admin=Depends(require_admin)):
    require_staging_owner(admin)
    return {"available": True}


@router.get("/staging-reset/preview")
def staging_subscriber_reset_preview(admin=Depends(require_admin)):
    return preview_staging_reset(admin)


@router.post("/staging-reset")
def staging_subscriber_reset(payload: StagingSubscriberResetPayload, admin=Depends(require_admin)):
    result = execute_staging_reset(admin, payload.previewToken, payload.confirmation)
    add_audit("staging_subscriber_reset", "CustomerProfiling", "all", {"deleted": result["deleted"], "backupFile": result["backupFile"]}, admin.get("username") or "system")
    return result


@router.get("/customers/overview")
def customer_overview(admin=Depends(require_admin)):
    seed_customer_data()
    rows = visible_customers()
    current_month = datetime.now(timezone.utc).strftime("%Y-%m")
    return {
        "totalCustomers": len(rows),
        "activeCustomers": sum(1 for customer in rows if customer["status"] == "ACTIVE"),
        "pendingCustomers": sum(1 for customer in rows if customer["status"] == "PENDING"),
        "suspendedCustomers": sum(1 for customer in rows if customer["status"] == "SUSPENDED"),
        "enrileCustomers": sum(1 for customer in rows if customer["province"] == "CAGAYAN" and customer["city"] == "ENRILE"),
        "newCustomersThisMonth": sum(1 for customer in rows if str(customer.get("createdAt", "")).startswith(current_month)),
        "averageNewCustomersLast6Months": round(len(rows) / 6, 2),
        "trendDirection": "FLAT",
        "trendDelta": 0,
        "byCustomerType": count_by(rows, "customerType"),
        "municipalities": [{"city": item["name"], "count": item["count"]} for item in count_by(rows, "city")],
        "topBarangays": [{"barangay": item["name"], "count": item["count"]} for item in count_by(rows, "barangay")[:10]],
    }


@router.get("/customers")
def list_customers(
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=10, ge=1, le=100),
    search: str = "",
    customerType: str = "",
    status: str = "",
    province: str = "",
    city: str = "",
    barangay: str = "",
    sortBy: str = "createdAt",
    sortDir: str = "desc",
    admin=Depends(require_admin),
):
    seed_customer_data()
    rows = visible_customers()
    if search:
        needle = search.strip().lower()
        searchable_fields = [
            "accountNumber",
            "firstName",
            "middleName",
            "lastName",
            "recommendedByCustomerName",
            "recommendedByCustomerAccountNumber",
            "contactNumber",
            "alternateMobileNumber",
            "facebookAccountName",
            "email",
        ]
        rows = [
            customer
            for customer in rows
            if needle in customer_full_name(customer).lower()
            or any(needle in str(customer.get(field) or "").lower() for field in searchable_fields)
        ]
    if customerType:
        rows = [customer for customer in rows if customer.get("customerType") == normalize_upper(customerType)]
    if status:
        rows = [customer for customer in rows if customer.get("status") == normalize_upper(status)]
    if province:
        rows = [customer for customer in rows if normalize_upper(province) in customer.get("province", "")]
    if city:
        rows = [customer for customer in rows if normalize_upper(city) in customer.get("city", "")]
    if barangay:
        rows = [customer for customer in rows if normalize_upper(barangay) in customer.get("barangay", "")]

    sortable_fields = {
        "accountNumber": lambda customer: str(customer.get("accountNumber") or "").lower(),
        "fullName": lambda customer: customer_full_name(customer).lower(),
        "businessName": lambda customer: str(customer.get("businessName") or "").lower(),
        "birthDate": lambda customer: str(customer.get("birthDate") or "").lower(),
        "recommendedByCustomerName": lambda customer: " ".join(
            [
                str(customer.get("recommendedByCustomerName") or "").lower(),
                str(customer.get("recommendedByCustomerAccountNumber") or "").lower(),
            ],
        ),
        "contactNumber": lambda customer: str(customer.get("contactNumber") or "").lower(),
        "alternateMobileNumber": lambda customer: str(customer.get("alternateMobileNumber") or "").lower(),
        "facebookAccountName": lambda customer: str(customer.get("facebookAccountName") or "").lower(),
        "facebookProfileLink": lambda customer: str(customer.get("facebookProfileLink") or "").lower(),
        "email": lambda customer: str(customer.get("email") or "").lower(),
        "secondaryContacts": lambda customer: " ".join(
            str(contact.get(field) or "").lower()
            for contact in customer.get("secondaryContacts", [])
            for field in ["name", "relationship", "contactNumber"]
        ),
        "customerType": lambda customer: str(customer.get("customerType") or "").lower(),
        "status": lambda customer: str(customer.get("status") or "").lower(),
        "locationName": lambda customer: str(customer.get("locationName") or customer.get("locationId") or "").lower(),
        "landmark": lambda customer: str(customer.get("landmark") or "").lower(),
        "province": lambda customer: str(customer.get("province") or "").lower(),
        "city": lambda customer: str(customer.get("city") or "").lower(),
        "barangay": lambda customer: str(customer.get("barangay") or "").lower(),
        "address": lambda customer: " ".join(
            str(customer.get(field) or "").lower()
            for field in ["province", "city", "barangay", "addressLine1", "addressLine2"]
        ),
        "coordinates": lambda customer: f"{customer.get('longitude') or ''} {customer.get('latitude') or ''}".lower(),
        "longitude": lambda customer: str(customer.get("longitude") or "").lower(),
        "latitude": lambda customer: str(customer.get("latitude") or "").lower(),
        "createdAt": lambda customer: str(customer.get("createdAt") or "").lower(),
    }
    reverse = sortDir.lower() != "asc"
    sort_key = sortable_fields.get(sortBy, sortable_fields["createdAt"])
    rows = sorted(rows, key=sort_key, reverse=reverse)
    total = len(rows)
    start = (page - 1) * pageSize
    end = start + pageSize
    return {
        "data": [customer_summary(customer) for customer in rows[start:end]],
        "page": page,
        "pageSize": pageSize,
        "total": total,
        "totalPages": max(1, (total + pageSize - 1) // pageSize),
    }


@router.get("/customers/bulk-upload-template")
def customer_bulk_upload_template(admin=Depends(require_admin)):
    return {
        "filename": "customer-bulk-upload-template.csv",
        "headers": BULK_UPLOAD_HEADERS,
        "sample": {
            "firstName": "JUAN",
            "middleName": "D",
            "lastName": "DELA CRUZ",
            "birthDate": "2002-05-18",
            "contactNumber": "09171234567",
            "alternateMobileNumber": "09180000001",
            "facebookAccountName": "JUAN DELA CRUZ",
            "facebookProfileLink": "https://www.facebook.com/juan.delacruz",
            "email": "juan.delacruz@example.com",
            "addressLine1": "PUROK 1",
            "addressLine2": "",
            "locationId": "",
            "locationName": "ALIBAGO",
            "landmark": "ALIBAGO",
            "province": "CAGAYAN",
            "city": "ENRILE",
            "barangay": "ALIBAGO",
            "latitude": "",
            "longitude": "",
            "gender": "MALE",
        },
        "allowedValues": {
            "gender": CUSTOMER_GENDERS,
            "province": PROVINCES,
            "city": sorted({city for cities in MUNICIPALITIES_BY_PROVINCE.values() for city in cities}),
            "citiesByProvince": MUNICIPALITIES_BY_PROVINCE,
            "barangay": sorted({barangay for barangays in BARANGAYS_BY_PROVINCE_CITY.values() for barangay in barangays}),
            "barangaysByProvinceCity": BARANGAYS_BY_PROVINCE_CITY,
        },
    }


@router.get("/customers/existing-subscriber-template")
def existing_subscriber_template(admin=Depends(require_admin)):
    promotions = migration_promotions()
    sample_promotion = next(
        (promotion for promotion in promotions if normalize_upper(promotion.get("paymentRule")) == "EARLY_BIRD"),
        None,
    )
    sample_promotion_code = str((sample_promotion or {}).get("promoCode") or "")
    sample_discounted_amount = round(1000 - migration_promotion_discount_amount(sample_promotion, 1000), 2) if sample_promotion else 2000
    base = {
        "middleName": "",
        "birthDate": "",
        "alternateMobileNumber": "",
        "facebookAccountName": "",
        "facebookProfileLink": "",
        "email": "",
        "addressLine2": "",
        "latitude": "",
        "longitude": "",
        "balanceAsOfDate": "2026-10-01",
        "qualifiedPromotionCodes": "",
        "lastPaymentPromotionCode": "",
    }
    return {
        "filename": "existing-subscribers-migration-template.xlsx",
        "headers": EXISTING_SUBSCRIBER_MIGRATION_HEADERS,
        "requiredHeaders": REQUIRED_EXISTING_SUBSCRIBER_HEADERS,
        "columnGuide": [
            {
                "column": header,
                "required": "Yes" if header in REQUIRED_EXISTING_SUBSCRIBER_HEADERS else "No",
                **EXISTING_SUBSCRIBER_COLUMN_GUIDE[header],
            }
            for header in EXISTING_SUBSCRIBER_MIGRATION_HEADERS
        ],
        "allowedValues": {
            "gender": CUSTOMER_GENDERS,
            "billingMode": ["PREPAID", "POSTPAID"],
            "serviceStatus": sorted(MIGRATION_STATUSES),
            "promotionCode": [promotion.get("promoCode") for promotion in promotions if promotion.get("promoCode")],
            "province": PROVINCES,
            "citiesByProvince": MUNICIPALITIES_BY_PROVINCE,
            "barangaysByProvinceCity": BARANGAYS_BY_PROVINCE_CITY,
        },
        "locationCatalog": {
            "source": LOCATION_CATALOG.get("source"),
            "sourceUrl": LOCATION_CATALOG.get("sourceUrl"),
            "retrievedDate": LOCATION_CATALOG.get("retrievedDate"),
        },
        "promotions": promotions,
        "samples": [
            {
                **base,
                "firstName": "JUAN", "lastName": "DELA CRUZ", "contactNumber": "09171234567",
                "addressLine1": "PUROK 1", "landmark": "NEAR BARANGAY HALL",
                "province": "CAGAYAN", "city": "ENRILE", "barangay": "ALIBAGO", "gender": "MALE",
                "latitude": "17.559311", "longitude": "121.684928", "monthlyRate": "1000", "billingMode": "PREPAID",
                "serviceStartDate": "2024-01-15", "serviceStatus": "ACTIVE",
                "qualifiedPromotionCodes": sample_promotion_code, "lastPaymentPromotionCode": sample_promotion_code,
                "lastPaymentDate": "2026-08-05", "lastPaymentAmount": str(sample_discounted_amount),
                "paymentCoverageFromMonth": "2026-08" if sample_promotion else "",
                "lastPaidThroughMonth": "2026-08" if sample_promotion else "2026-07", "outstandingBalance": "1000" if sample_promotion else "2000",
            },
            {
                **base,
                "firstName": "MARIA", "lastName": "SANTOS", "contactNumber": "09181234567",
                "addressLine1": "ZONE 2", "landmark": "PUBLIC MARKET",
                "province": "ISABELA", "city": "CABAGAN", "barangay": "CENTRO", "gender": "FEMALE",
                "latitude": "17.425624", "longitude": "121.769104", "monthlyRate": "1500", "billingMode": "POSTPAID",
                "serviceStartDate": "2025-03-01", "serviceStatus": "ACTIVE",
                "lastPaymentDate": "2026-09-15", "lastPaymentAmount": "1500", "paymentCoverageFromMonth": "2026-09",
                "lastPaidThroughMonth": "2026-09", "outstandingBalance": "0",
            },
            {
                **base,
                "firstName": "PEDRO", "lastName": "REYES", "contactNumber": "09191234567",
                "addressLine1": "PUROK 4", "landmark": "ELEMENTARY SCHOOL",
                "province": "CAGAYAN", "city": "ENRILE", "barangay": "SAN ANTONIO", "gender": "MALE",
                "latitude": "17.574188", "longitude": "121.695244", "monthlyRate": "900", "billingMode": "PREPAID",
                "serviceStartDate": "2023-06-10", "serviceStatus": "SUSPENDED",
                "lastPaymentDate": "2026-06-10", "lastPaymentAmount": "900", "paymentCoverageFromMonth": "",
                "lastPaidThroughMonth": "", "outstandingBalance": "2750",
            },
        ],
        "notes": [
            "Each Subscribers worksheet row is one already-installed internet line.",
            "Account and Service Account numbers are generated during import.",
            "Location ID and location name are generated by the system from the imported address and coordinates.",
            "Imported monthly rate and billing mode are used to find or create the Service Catalog plan during review.",
            "Use qualifiedPromotionCodes for future promotion eligibility and lastPaymentPromotionCode only when that promotion explains the imported historical payment amount.",
            "Separate multiple qualified promotion codes with semicolons. Every combined promotion must be stackable in Billing.",
            "Billing day and next billing date are derived from billing mode, the migration effective date, and the paid-through month.",
            "The Province, City, and Barangay columns contain dependent dropdowns for Cagayan and Isabela.",
            "A discounted last payment is reconciled against its mapped promotion and paid-through coverage; it does not create a remaining balance for the discount.",
            "Legacy payment rows are reference evidence and are excluded from current cash reports.",
        ],
    }


def migration_catalogs() -> list[dict[str, Any]]:
    if _service_catalog_provider is None:
        return []
    return _service_catalog_provider()


def migration_promotions() -> list[dict[str, Any]]:
    if _billing_promotion_provider is None:
        return []
    return _billing_promotion_provider()


def migration_plan_groups(rows: list[dict[str, Any]], catalogs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    for row in rows:
        plan_key = row["planKey"]
        if plan_key not in groups:
            suggestions = [
                catalog for catalog in catalogs
                if round(float(catalog.get("monthlyRate") or 0), 2) == round(float(row.get("monthlyRate") or 0), 2)
                and normalize_upper(catalog.get("billingMode")) == row.get("billingMode")
            ]
            exact = suggestions[0] if len(suggestions) == 1 else None
            groups[plan_key] = {
                "planKey": plan_key,
                "planName": row.get("planName"),
                "planReferenceSource": "MONTHLY_RATE_AND_BILLING_MODE",
                "monthlyRate": row.get("monthlyRate"),
                "billingMode": row.get("billingMode"),
                "rowCount": 0,
                "suggestions": suggestions[:5],
                "suggestedMapping": {"action": "MAP_EXISTING", "catalogId": exact["id"]} if exact else {"action": "REVIEW"},
            }
        groups[plan_key]["rowCount"] += 1
    return list(groups.values())


def migration_promotion_groups(rows: list[dict[str, Any]], promotions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    promotions_by_code = {
        normalize_promotion_code(promotion.get("promoCode")): promotion
        for promotion in promotions
    }
    for row in rows:
        qualified_codes = list(row.get("qualifiedPromotionCodes") or [])
        last_payment_code = normalize_promotion_code(row.get("lastPaymentPromotionCode"))
        for code in dict.fromkeys([*qualified_codes, *([last_payment_code] if last_payment_code else [])]):
            if code not in groups:
                exact = promotions_by_code.get(code)
                groups[code] = {
                    "importedCode": code,
                    "qualificationRowCount": 0,
                    "lastPaymentRowCount": 0,
                    "billingModes": [],
                    "suggestedMapping": (
                        {"action": "MAP_EXISTING", "promotionId": exact["id"]}
                        if exact and migration_promotion_is_compatible(exact, row.get("billingMode"))
                        else {"action": "REVIEW"}
                    ),
                }
            group = groups[code]
            if code in qualified_codes:
                group["qualificationRowCount"] += 1
            if code == last_payment_code:
                group["lastPaymentRowCount"] += 1
            if row.get("billingMode") and row["billingMode"] not in group["billingModes"]:
                group["billingModes"].append(row["billingMode"])
            mapped = promotions_by_code.get(code)
            if mapped and not all(migration_promotion_is_compatible(mapped, mode) for mode in group["billingModes"]):
                group["suggestedMapping"] = {"action": "REVIEW"}
    return list(groups.values())


def mapped_migration_promotion(
    imported_code: str,
    promotion_mappings: dict[str, dict[str, Any]],
    promotions: list[dict[str, Any]],
    billing_mode: str,
) -> dict[str, Any] | None:
    code = normalize_promotion_code(imported_code)
    mapping = dict(promotion_mappings.get(code) or {})
    action = normalize_upper(mapping.get("action"))
    if action == "IGNORE":
        return None
    if action != "MAP_EXISTING" or not mapping.get("promotionId"):
        raise HTTPException(status_code=400, detail=f"Resolve imported promotion {code}")
    promotion = next((item for item in promotions if item.get("id") == mapping.get("promotionId")), None)
    if promotion is None:
        raise HTTPException(status_code=400, detail=f"Choose an active Billing promotion for {code}")
    if not migration_promotion_is_compatible(promotion, billing_mode):
        raise HTTPException(status_code=400, detail=f"Promotion {promotion.get('promoCode') or promotion.get('name')} is not compatible with {billing_mode} billing")
    return promotion


def resolve_row_migration_promotions(
    normalized: dict[str, Any],
    promotion_mappings: dict[str, dict[str, Any]],
    promotions: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any] | None, bool]:
    qualified: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for code in normalized.get("qualifiedPromotionCodes") or []:
        promotion = mapped_migration_promotion(code, promotion_mappings, promotions, normalized.get("billingMode"))
        if promotion and promotion.get("id") not in seen_ids:
            qualified.append(promotion)
            seen_ids.add(str(promotion.get("id")))
    if len(qualified) > 1 and any(not bool(promotion.get("stackable")) for promotion in qualified):
        raise HTTPException(status_code=400, detail="Multiple imported promotions require every selected promotion to be stackable")

    last_payment_code = normalize_promotion_code(normalized.get("lastPaymentPromotionCode"))
    last_payment_mapping = dict(promotion_mappings.get(last_payment_code) or {}) if last_payment_code else {}
    last_payment_ignored = bool(last_payment_code and normalize_upper(last_payment_mapping.get("action")) == "IGNORE")
    last_payment_promotion = (
        mapped_migration_promotion(last_payment_code, promotion_mappings, promotions, normalized.get("billingMode"))
        if last_payment_code
        else None
    )
    return qualified, last_payment_promotion, last_payment_ignored


def migration_batch_response(batch: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        **batch,
        "rows": rows,
        "summary": {
            "total": len(rows),
            "ready": sum(1 for row in rows if not row.get("validationErrors") and not row.get("duplicates")),
            "needsReview": sum(1 for row in rows if row.get("duplicates") or (row.get("billingPreview") or {}).get("classification") in {"BALANCE_VARIANCE", "INSUFFICIENT_INFORMATION"}),
            "invalid": sum(1 for row in rows if row.get("validationErrors")),
            "imported": sum(1 for row in rows if row.get("status") == "IMPORTED"),
            "failed": sum(1 for row in rows if row.get("status") == "FAILED"),
            "skipped": sum(1 for row in rows if row.get("status") in {"SKIPPED", "DUPLICATE_IMPORTED"}),
        },
    }


@router.post("/subscriber-migrations")
def create_subscriber_migration_batch(payload: ExistingSubscriberMigrationBatchPayload, admin=Depends(require_admin)):
    seed_customer_data()
    if not payload.rows:
        raise HTTPException(status_code=400, detail="The CSV has no subscriber rows")
    if len(payload.rows) > 5000:
        raise HTTPException(status_code=400, detail="A migration batch may contain at most 5000 installed lines")
    timestamp = now_iso()
    pending_effective_date = subscriber_migration_business_date(datetime.fromisoformat(timestamp))
    batch_id = str(uuid4())
    promotions = migration_promotions()
    normalized_rows: list[dict[str, Any]] = []
    for index, raw_row in enumerate(payload.rows, start=2):
        normalized, errors = normalize_migration_row(raw_row, index, pending_effective_date, promotions)
        normalized_rows.append(
            {
                "id": str(uuid4()), "batchId": batch_id, "rowNumber": index,
                "fingerprint": normalized["fingerprint"], "status": "INVALID" if errors else "READY",
                "raw": dict(raw_row), "normalized": normalized, "planKey": normalized["planKey"],
                "groupKey": normalized["groupKey"], "duplicates": normalized["duplicates"],
                "billingPreview": normalized["billingPreview"], "validationErrors": errors,
                "result": {}, "error": "", "createdAt": timestamp, "updatedAt": timestamp,
            }
        )
    file_hash = hashlib.sha256(str(payload.rows).encode("utf-8")).hexdigest()
    catalogs = migration_catalogs()
    batch = {
        "id": batch_id, "filename": payload.filename, "fileHash": file_hash, "cutoverDate": pending_effective_date,
        "effectiveDateStatus": "PENDING_COMMIT", "effectiveDateTimezone": SUBSCRIBER_MIGRATION_TIMEZONE, "migrationCommittedAt": "",
        "status": "REVIEW", "catalogs": catalogs, "planGroups": migration_plan_groups([row["normalized"] for row in normalized_rows], catalogs),
        "promotions": promotions, "promotionGroups": migration_promotion_groups([row["normalized"] for row in normalized_rows], promotions),
        "createdAt": timestamp, "updatedAt": timestamp, "createdByUserId": admin.get("id", ""), "updatedByUserId": admin.get("id", ""),
    }
    subscriber_migration_store.save_batch(batch)
    for row in normalized_rows:
        subscriber_migration_store.save_row(row)
    add_audit("existing_subscriber_migration_preview_created", "SubscriberMigrationBatch", batch_id, {"filename": payload.filename, "rowCount": len(normalized_rows), "fileHash": file_hash}, admin.get("username") or "system")
    return migration_batch_response(batch, normalized_rows)


@router.get("/subscriber-migrations/{batch_id}")
def get_subscriber_migration_batch(batch_id: str, admin=Depends(require_admin)):
    batch = subscriber_migration_store.get_batch(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Migration batch not found")
    return migration_batch_response(batch, subscriber_migration_store.list_rows(batch_id))


@router.get("/subscriber-migrations/{batch_id}/current-customers")
def subscriber_migration_current_customers(batch_id: str, admin=Depends(require_admin)):
    """Resolve imported customer status from current profiles in one read."""
    batch = subscriber_migration_store.get_batch(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Migration batch not found")
    customer_ids = {
        (row.get("result") or {}).get("customerId")
        for row in subscriber_migration_store.list_rows(batch_id)
        if row.get("status") == "IMPORTED"
    }
    return [
        {"id": customer["id"], "status": customer.get("status", ""),
         "firstName": customer.get("firstName", ""), "lastName": customer.get("lastName", "")}
        for customer in all_customers()
        if customer["id"] in customer_ids and not customer.get("deletedAt")
    ]


def migration_customer(row: dict[str, Any], decision: dict[str, Any], batch: dict[str, Any], admin: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    if result.get("customerId"):
        customer = find_customer(result["customerId"])
        migration = dict(customer.get("migration") or {})
        fingerprints = list(dict.fromkeys([*(migration.get("lineFingerprints") or []), row["fingerprint"]]))
        if fingerprints != migration.get("lineFingerprints"):
            migration["lineFingerprints"] = fingerprints
            customer["migration"] = migration
            customer["updatedAt"] = now_iso()
            customer["updatedByUserId"] = admin.get("id", "")
            save_customer_record(customer)
        return customer
    action = normalize_upper(decision.get("customerAction"))
    duplicates = row.get("duplicates") or []
    if not action:
        action = "REVIEW" if duplicates else "CREATE"
    if action == "REVIEW":
        raise HTTPException(status_code=400, detail="Review the possible existing customer before importing this line")
    if action in {"LINK", "LINK_UPDATE"}:
        customer_id = str(decision.get("customerId") or "").strip()
        if not customer_id:
            raise HTTPException(status_code=400, detail="Choose the existing customer to link")
        customer = find_customer(customer_id)
        if action == "LINK_UPDATE":
            profile_values = {field: row["normalized"].get(field) for field in MIGRATION_PROFILE_FIELDS if row["normalized"].get(field) not in [None, ""]}
            record = customer_payload_to_record(CustomerPayload(**profile_values), customer)
            customer.update(record)
    elif action == "CREATE":
        profile_values = {field: row["normalized"].get(field) for field in MIGRATION_PROFILE_FIELDS}
        record = customer_payload_to_record(CustomerPayload(**profile_values))
        record["status"] = "PENDING"
        record["accountNumber"] = generate_account_number()
        assert_no_duplicate_customer(record)
        timestamp = now_iso()
        customer = {"id": str(uuid4()), "createdAt": timestamp, "updatedAt": timestamp, "deletedAt": None, "createdByUserId": admin.get("id", ""), "updatedByUserId": admin.get("id", ""), **record}
    else:
        raise HTTPException(status_code=400, detail="customerAction must be CREATE, LINK, LINK_UPDATE, or SKIP")

    migration = dict(customer.get("migration") or {})
    fingerprints = list(dict.fromkeys([*(migration.get("lineFingerprints") or []), row["fingerprint"]]))
    migration.update({"existingSubscriber": True, "source": "EXISTING_SUBSCRIBER_CSV", "batchId": batch["id"], "lineFingerprints": fingerprints, "installationWorkflow": "NOT_REQUIRED", "migratedAt": now_iso(), "migratedBy": admin.get("username") or "system"})
    customer["migration"] = migration
    customer["updatedAt"] = now_iso()
    customer["updatedByUserId"] = admin.get("id", "")
    ensure_customer_location(customer, admin)
    save_customer_record(customer)
    return customer


@router.post("/subscriber-migrations/{batch_id}/commit")
def commit_subscriber_migration_batch(batch_id: str, payload: ExistingSubscriberMigrationCommitPayload, admin=Depends(require_admin)):
    if _service_migration_provider is None or _billing_migration_provider is None:
        raise HTTPException(status_code=503, detail="Service and Billing migration providers are not configured")
    batch = subscriber_migration_store.get_batch(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Migration batch not found")
    rows = subscriber_migration_store.list_rows(batch_id)
    commit_timestamp = now_iso()
    if not batch.get("migrationCommittedAt"):
        if batch.get("status") == "REVIEW":
            batch["cutoverDate"] = subscriber_migration_business_date(datetime.fromisoformat(commit_timestamp))
            batch["migrationCommittedAt"] = commit_timestamp
        else:
            batch["migrationCommittedAt"] = batch.get("updatedAt") or commit_timestamp
        batch["effectiveDateStatus"] = "ASSIGNED"
        batch["effectiveDateTimezone"] = SUBSCRIBER_MIGRATION_TIMEZONE
    batch["status"] = "IMPORTING"
    batch["updatedAt"] = commit_timestamp
    batch["updatedByUserId"] = admin.get("id", "")
    subscriber_migration_store.save_batch(batch)
    actor = admin.get("username") or "system"
    group_customers: dict[str, str] = {
        row.get("groupKey", ""): (row.get("result") or {}).get("customerId", "")
        for row in rows if (row.get("result") or {}).get("customerId")
    }

    for row in rows:
        if row.get("status") in {"IMPORTED", "SKIPPED", "DUPLICATE_IMPORTED", "INVALID"}:
            continue
        decision = dict(payload.rowDecisions.get(row["id"]) or {})
        if normalize_upper(decision.get("customerAction")) == "SKIP":
            row.update({"status": "SKIPPED", "updatedAt": now_iso(), "error": ""})
            subscriber_migration_store.save_row(row)
            continue
        prior = subscriber_migration_store.find_imported_fingerprint(row["fingerprint"])
        if prior and prior.get("id") != row["id"]:
            row.update({"status": "DUPLICATE_IMPORTED", "result": prior.get("result") or {}, "updatedAt": now_iso(), "error": "This installed line was already imported in another batch."})
            subscriber_migration_store.save_row(row)
            continue
        normalized = dict(row["normalized"])
        result = dict(row.get("result") or {})
        try:
            qualified_promotions, last_payment_promotion, last_payment_promotion_ignored = resolve_row_migration_promotions(
                normalized,
                payload.promotionMappings,
                list(batch.get("promotions") or []),
            )
            preview_row = {
                **normalized,
                "lastPaymentPromotionCode": "" if last_payment_promotion_ignored else normalized.get("lastPaymentPromotionCode"),
            }
            preview = payment_and_balance_preview(preview_row, batch["cutoverDate"], last_payment_promotion)
            normalized["billingDay"] = preview["billingDay"]
            normalized["nextBillingDate"] = preview["nextBillingDate"]
            normalized["qualifiedPromotionIds"] = [promotion["id"] for promotion in qualified_promotions]
            normalized["resolvedQualifiedPromotions"] = [
                {
                    "id": promotion.get("id"),
                    "promoCode": promotion.get("promoCode"),
                    "name": promotion.get("name"),
                    "paymentRule": promotion.get("paymentRule"),
                }
                for promotion in qualified_promotions
            ]
            row["normalized"] = normalized
            row["billingPreview"] = preview
            subscriber_migration_store.save_row(row)

            plan_mapping = dict(payload.planMappings.get(row["planKey"]) or {})
            plan_action = normalize_upper(plan_mapping.get("action"))
            if plan_action not in {"MAP_EXISTING", "CREATE_LEGACY"}:
                raise HTTPException(status_code=400, detail=f"Resolve imported rate {normalized.get('monthlyRate'):.2f} ({normalized.get('billingMode')})")
            if plan_action == "MAP_EXISTING" and not plan_mapping.get("catalogId"):
                raise HTTPException(status_code=400, detail=f"Choose a Service Catalog plan for rate {normalized.get('monthlyRate'):.2f} ({normalized.get('billingMode')})")
            row.update({"status": "IMPORTING", "updatedAt": now_iso(), "error": ""})
            subscriber_migration_store.save_row(row)

            group_customer_id = group_customers.get(row.get("groupKey", ""))
            if group_customer_id and not result.get("customerId"):
                result["customerId"] = group_customer_id
            customer = migration_customer(row, decision, batch, admin, result)
            result.update({"customerId": customer["id"], "accountNumber": customer.get("accountNumber", "")})
            group_customers[row.get("groupKey", "")] = customer["id"]
            row["result"] = result
            subscriber_migration_store.save_row(row)

            service_payload = {
                **normalized, **plan_mapping,
                "planAction": plan_action, "customerId": customer["id"], "serviceAddress": customer_location_address(customer),
                "migrationFingerprint": row["fingerprint"], "batchId": batch_id, "rowId": row["id"], "cutoverDate": batch["cutoverDate"],
            }
            service_result = _service_migration_provider(service_payload, actor)
            account = dict(service_result.get("account") or {})
            catalog = dict(service_result.get("catalog") or {})
            result.update({"serviceAccountId": account.get("id", ""), "serviceAccountNumber": account.get("serviceAccountNumber", ""), "catalogId": catalog.get("id", ""), "catalogName": catalog.get("name", "")})
            row["result"] = result
            subscriber_migration_store.save_row(row)

            resolution = normalize_upper(decision.get("balanceResolution") or preview.get("defaultResolution") or "MONTHLY_INVOICES")
            if resolution not in {"MONTHLY_INVOICES", "OPENING_BALANCE"}:
                raise HTTPException(status_code=400, detail="balanceResolution must be MONTHLY_INVOICES or OPENING_BALANCE")
            if resolution == "OPENING_BALANCE" and float(normalized.get("outstandingBalance") or 0) <= 0:
                raise HTTPException(status_code=400, detail="A positive supplied outstanding balance is required for opening-balance resolution")
            billing_result = _billing_migration_provider(
                {
                    **normalized,
                    "customerId": customer["id"], "serviceAccount": account, "catalog": catalog,
                    "planName": catalog.get("name") or normalized.get("planName"),
                    "migrationFingerprint": row["fingerprint"], "batchId": batch_id, "rowId": row["id"], "cutoverDate": batch["cutoverDate"],
                    "balanceResolution": resolution, "arrearMonths": preview.get("arrearMonths") or [],
                    "paymentCoverageFromMonth": preview.get("coverageFromMonth") or normalized.get("paymentCoverageFromMonth"),
                    "lastPaidThroughMonth": preview.get("paidThroughMonth") or normalized.get("lastPaidThroughMonth"),
                    "coverageSource": preview.get("coverageSource") or "",
                    "qualifiedPromotionIds": normalized.get("qualifiedPromotionIds") or [],
                    "qualifiedPromotionCodes": normalized.get("qualifiedPromotionCodes") or [],
                    "lastPaymentRegularMonthlyRate": (preview.get("legacyPaymentPromotion") or {}).get("regularMonthlyRate") or normalized.get("monthlyRate"),
                    "lastPaymentPromotionId": (preview.get("legacyPaymentPromotion") or {}).get("id") or "",
                    "lastPaymentPromotionCode": (preview.get("legacyPaymentPromotion") or {}).get("code") or "",
                    "lastPaymentPromotionName": (preview.get("legacyPaymentPromotion") or {}).get("name") or "",
                    "lastPaymentPromotionDiscountPerMonth": (preview.get("legacyPaymentPromotion") or {}).get("discountPerMonth") or 0,
                    "lastPaymentExpectedDiscountedAmount": (preview.get("legacyPaymentPromotion") or {}).get("expectedDiscountedAmount") or 0,
                    "lastPaymentPromotionMatchStatus": (preview.get("legacyPaymentPromotion") or {}).get("matchStatus") or "NONE",
                },
                actor,
            )
            subscription = dict(billing_result.get("subscription") or {})
            imported_invoices = list(billing_result.get("invoices") or [])
            result.update({
                "subscriptionId": subscription.get("id", ""),
                "invoiceNumbers": [invoice.get("invoiceNumber", "") for invoice in imported_invoices],
                "invoiceCount": len(imported_invoices),
                "balanceResolution": resolution,
                "qualifiedPromotionCodes": [promotion.get("promoCode") for promotion in qualified_promotions if promotion.get("promoCode")],
                "lastPaymentPromotionCode": (preview.get("legacyPaymentPromotion") or {}).get("code") or "",
                "lastPaymentPromotionMatchStatus": (preview.get("legacyPaymentPromotion") or {}).get("matchStatus") or "NONE",
            })
            row.update({"status": "IMPORTED", "result": result, "updatedAt": now_iso(), "error": ""})
            subscriber_migration_store.save_row(row)
        except Exception as exc:
            detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
            row.update({"status": "FAILED", "result": result, "updatedAt": now_iso(), "error": str(detail)})
            subscriber_migration_store.save_row(row)

    rows = subscriber_migration_store.list_rows(batch_id)
    imported_count = sum(1 for row in rows if row.get("status") == "IMPORTED")
    failed_count = sum(1 for row in rows if row.get("status") == "FAILED")
    batch["status"] = "COMPLETED" if failed_count == 0 else "PARTIAL" if imported_count else "FAILED"
    batch["updatedAt"] = now_iso()
    subscriber_migration_store.save_batch(batch)
    add_audit(
        "existing_subscriber_migration_committed",
        "SubscriberMigrationBatch",
        batch_id,
        {
            "status": batch["status"],
            "importedCount": imported_count,
            "failedCount": failed_count,
            "effectiveDate": batch.get("cutoverDate"),
            "effectiveDateTimezone": batch.get("effectiveDateTimezone"),
        },
        actor,
    )
    return migration_batch_response(batch, rows)


@router.get("/subscriber-migrations/{batch_id}/result")
def subscriber_migration_result(batch_id: str, admin=Depends(require_admin)):
    batch = subscriber_migration_store.get_batch(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Migration batch not found")
    rows = subscriber_migration_store.list_rows(batch_id)
    headers = ["rowNumber", "status", "firstName", "lastName", "contactNumber", "planName", "qualifiedPromotionCodes", "lastPaymentPromotionCode", "lastPaymentPromotionMatchStatus", "accountNumber", "serviceAccountNumber", "subscriptionId", "invoiceNumbers", "balanceResolution", "error"]
    output_rows = []
    for row in rows:
        normalized = row.get("normalized") or {}
        result = row.get("result") or {}
        qualified_promotion_codes = (
            result.get("qualifiedPromotionCodes")
            if "qualifiedPromotionCodes" in result
            else normalized.get("qualifiedPromotionCodes")
        ) or []
        last_payment_promotion_code = (
            result.get("lastPaymentPromotionCode")
            if "lastPaymentPromotionCode" in result
            else normalized.get("lastPaymentPromotionCode", "")
        )
        output_rows.append({
            "rowNumber": row.get("rowNumber"), "status": row.get("status"), "firstName": normalized.get("firstName"), "lastName": normalized.get("lastName"),
            "contactNumber": normalized.get("contactNumber"), "planName": result.get("catalogName") or normalized.get("planName"), "accountNumber": result.get("accountNumber", ""),
            "qualifiedPromotionCodes": ";".join(qualified_promotion_codes),
            "lastPaymentPromotionCode": last_payment_promotion_code,
            "lastPaymentPromotionMatchStatus": result.get("lastPaymentPromotionMatchStatus", ""),
            "serviceAccountNumber": result.get("serviceAccountNumber", ""), "subscriptionId": result.get("subscriptionId", ""),
            "invoiceNumbers": ";".join(result.get("invoiceNumbers") or []), "balanceResolution": result.get("balanceResolution", ""), "error": row.get("error", ""),
        })
    return {"filename": f"existing-subscriber-import-{batch_id[:8]}-results.csv", "headers": headers, "rows": output_rows}


@router.get("/customers/{customer_id}")
def get_customer(customer_id: str, admin=Depends(require_admin)):
    seed_customer_data()
    return customer_summary(find_customer(customer_id))


@router.patch("/customers/{customer_id}/onboarding-verifications/{step}")
def update_onboarding_verification(
    customer_id: str,
    step: str,
    payload: OnboardingVerificationPayload,
    admin=Depends(require_admin),
):
    seed_customer_data()
    customer = find_customer(customer_id)
    normalized_step = normalize_upper(step).replace("-", "_")
    rule = ONBOARDING_VERIFICATION_RULES.get(normalized_step)
    if not rule:
        raise HTTPException(status_code=400, detail="Invalid onboarding verification step")

    outcome = normalize_upper(payload.outcome)
    if outcome not in rule["outcomes"]:
        raise HTTPException(status_code=400, detail=f"Invalid {normalized_step.lower()} verification outcome")
    if normalized_step == "NETWORK_EQUIPMENT" and outcome == "VERIFIED":
        if payload.networkAccessVerified is not True or payload.equipmentAssignmentVerified is not True:
            raise HTTPException(
                status_code=400,
                detail="Network access and equipment assignment must both be verified",
            )

    timestamp = now_iso()
    verification = {
        "step": normalized_step,
        "outcome": outcome,
        "reference": clean_value(payload.reference) or "",
        "notes": clean_value(payload.notes) or "",
        "networkAccessVerified": payload.networkAccessVerified is True,
        "equipmentAssignmentVerified": payload.equipmentAssignmentVerified is True,
        "verifiedAt": timestamp,
        "verifiedByUserId": admin.get("id") or "",
        "verifiedBy": admin.get("fullName") or admin.get("username") or "",
    }
    verifications = dict(customer.get("onboardingVerifications") or {})
    verifications[rule["storageKey"]] = verification
    customer["onboardingVerifications"] = verifications
    customer["updatedAt"] = timestamp
    customer["updatedByUserId"] = admin.get("id") or ""
    save_customer_record(customer)
    add_audit(
        "customer_onboarding_verification_updated",
        "Customer",
        customer["id"],
        {
            "accountNumber": customer.get("accountNumber"),
            "step": normalized_step,
            "outcome": outcome,
            "reference": verification["reference"],
        },
        admin.get("username") or "system",
    )
    return customer_summary(customer)


@router.post("/customers")
def create_customer(payload: CustomerPayload, request: Request, admin=Depends(require_admin)):
    seed_customer_data()
    record = customer_payload_to_record(payload)
    record["status"] = "PENDING"
    if record.get("accountNumber") and any(
        customer["accountNumber"] == record["accountNumber"] and not customer.get("deletedAt") for customer in all_customers()
    ):
        raise HTTPException(status_code=409, detail="Account number already exists")
    record["accountNumber"] = record.get("accountNumber") or generate_account_number()
    assert_no_duplicate_customer(record)
    ensure_customer_location(record, admin)
    timestamp = now_iso()
    customer = {
        "id": str(uuid4()),
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
        "createdByUserId": admin["id"],
        "updatedByUserId": admin["id"],
        **record,
    }
    save_customer_record(customer)
    add_audit(
        "customer_created",
        "Customer",
        customer["id"],
        {"accountNumber": customer["accountNumber"], "client": request.client.host if request.client else None},
        admin["username"],
    )
    return customer_summary(customer)


@router.patch("/customers/{customer_id}")
def update_customer(customer_id: str, payload: CustomerPayload, admin=Depends(require_admin)):
    seed_customer_data()
    current = find_customer(customer_id)
    record = customer_payload_to_record(payload, current)
    if record.get("accountNumber") and any(
        customer["accountNumber"] == record["accountNumber"] and customer["id"] != customer_id and not customer.get("deletedAt")
        for customer in all_customers()
    ):
        raise HTTPException(status_code=409, detail="Account number already exists")
    assert_no_duplicate_customer(record, ignore_id=customer_id)
    ensure_customer_location(record, admin)
    current.update(record)
    current["updatedAt"] = now_iso()
    current["updatedByUserId"] = admin["id"]
    save_customer_record(current)
    add_audit("customer_updated", "Customer", current["id"], {"accountNumber": current["accountNumber"]}, admin["username"])
    return customer_summary(current)


@router.delete("/customers/{customer_id}")
def delete_customer(customer_id: str, admin=Depends(require_admin)):
    seed_customer_data()
    current = find_customer(customer_id)
    current["deletedAt"] = now_iso()
    current["updatedAt"] = now_iso()
    current["updatedByUserId"] = admin["id"]
    save_customer_record(current)
    add_audit("customer_deleted", "Customer", current["id"], {"accountNumber": current["accountNumber"]}, admin["username"])
    return {"status": "ok"}
