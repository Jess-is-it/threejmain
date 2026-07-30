import logging
import os
from contextlib import contextmanager
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from functools import wraps
from threading import RLock, local
from typing import Any, Callable, Iterator
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

try:
    import psycopg
    from psycopg.rows import dict_row
    from psycopg.types.json import Json
except Exception:  # pragma: no cover - keeps local syntax checks independent of optional deps.
    psycopg = None
    dict_row = None
    Json = None


router = APIRouter(prefix="/api/collector", tags=["collector"])
logger = logging.getLogger(__name__)

claims: list[dict[str, Any]] = []
collections: list[dict[str, Any]] = []
remittances: list[dict[str, Any]] = []

COLLECTOR_RECORD_COLLECTIONS = {
    "claim": claims,
    "collection": collections,
    "remittance": remittances,
}

_current_admin: Callable[[str | None], dict[str, Any]] | None = None
_audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None] | None = None
_customer_resolver: Callable[[str], dict[str, Any]] | None = None
_customer_searcher: Callable[[str], list[dict[str, Any]]] | None = None
_billing_aging_provider: Callable[..., list[dict[str, Any]]] | None = None
_billing_payment_poster: Callable[..., dict[str, Any]] | None = None
_sms_sender: Callable[..., dict[str, Any]] | None = None

COLLECTOR_STORAGE_MODE = os.getenv("COLLECTOR_STORAGE") or ("postgres" if os.getenv("DATABASE_URL") else "memory")
CLAIM_DEFAULT_MINUTES = 15
CLAIM_MAX_MINUTES = 240
COLLECTOR_SMS_SENDER_ID = "3J BILL"

COLLECTOR_ROLE_NAMES = {"collector"}
FINANCE_ROLE_NAMES = {"finance_officer", "cashier_treasury", "finance_approver"}
SUPERVISOR_ROLE_NAMES = {"collection_supervisor"}
ADMIN_ROLE_NAMES = {"owner", "admin", "system_admin"}
PORTAL_ROLE_NAMES = COLLECTOR_ROLE_NAMES | FINANCE_ROLE_NAMES | SUPERVISOR_ROLE_NAMES | ADMIN_ROLE_NAMES

PAYMENT_METHODS = ["CASH", "GCASH"]
CLAIM_STATUSES = ["CLAIMED", "RELEASED", "EXPIRED"]
COLLECTION_CUSTODY_STATUSES = ["HELD", "SUBMITTED", "UNDER_REVIEW", "SETTLED"]
REMITTANCE_STATUSES = ["SUBMITTED", "VARIANCE", "CLOSED"]


class ClaimPayload(BaseModel):
    minutes: int = Field(default=CLAIM_DEFAULT_MINUTES, ge=10, le=CLAIM_MAX_MINUTES)


class CollectionAllocationPayload(BaseModel):
    invoiceId: str
    amount: float = Field(gt=0)
    promotionIds: list[str] = Field(default_factory=list)
    promotionQuoteDate: str | None = None
    promotionQuoteFingerprint: str | None = None


class CollectionPayload(BaseModel):
    customerId: str
    amount: float = Field(gt=0)
    receivedAmount: float | None = Field(default=None, gt=0)
    returnedAmount: float | None = Field(default=None, ge=0)
    allocations: list[CollectionAllocationPayload] = Field(default_factory=list)
    advanceAmount: float = Field(default=0, ge=0)
    allocationMode: str | None = None
    method: str
    paymentDate: str | None = None
    referenceNumber: str | None = None
    tenderedAmount: float | None = Field(default=None, ge=0)
    smsDestination: str | None = None
    notes: str | None = None


class PrintEventPayload(BaseModel):
    reason: str | None = None


class RemittancePayload(BaseModel):
    collectionIds: list[str] = Field(default_factory=list)
    declaredCash: float | None = Field(default=None, ge=0)
    gcashTransferredAmount: float | None = Field(default=None, ge=0)
    gcashTransferReference: str | None = None
    companyGcashAccount: str | None = None
    notes: str | None = None


class RemittanceConfirmationPayload(BaseModel):
    countedCash: float = Field(ge=0)
    confirmedGcashAmount: float = Field(ge=0)
    companyGcashReference: str | None = None
    notes: str | None = None
    acceptVariance: bool = False


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_iso() -> str:
    return date.today().isoformat()


def money(value: Any) -> float:
    return round(float(value or 0), 2)


def clean_text(value: Any, limit: int = 1000) -> str:
    return str(value or "").strip()[:limit]


def normalize_upper(value: Any) -> str:
    return clean_text(value, 100).upper()


def actor_role(actor: dict[str, Any]) -> str:
    return clean_text(actor.get("role"), 100).lower()


def actor_username(actor: dict[str, Any]) -> str:
    return clean_text(actor.get("username"), 160) or "unknown"


def actor_display_name(actor: dict[str, Any]) -> str:
    return (
        clean_text(actor.get("full_name") or actor.get("fullName") or actor.get("name"), 200)
        or actor_username(actor)
    )


def actor_permissions(actor: dict[str, Any]) -> set[str]:
    return {clean_text(code, 160) for code in actor.get("permissions", []) if clean_text(code, 160)}


def has_permission(actor: dict[str, Any], permission: str) -> bool:
    permissions = actor_permissions(actor)
    return (
        actor_role(actor) in ADMIN_ROLE_NAMES
        or "*" in permissions
        or permission in permissions
    )


def is_finance_actor(actor: dict[str, Any]) -> bool:
    return (
        actor_role(actor) in FINANCE_ROLE_NAMES | SUPERVISOR_ROLE_NAMES | ADMIN_ROLE_NAMES
        or has_permission(actor, "collector.finance.view")
    )


def is_collector_actor(actor: dict[str, Any]) -> bool:
    return (
        actor_role(actor) in COLLECTOR_ROLE_NAMES | SUPERVISOR_ROLE_NAMES | ADMIN_ROLE_NAMES
        or has_permission(actor, "collector.portal.view")
    )


def require_collector_permission(actor: dict[str, Any], permission: str) -> None:
    if actor_role(actor) not in PORTAL_ROLE_NAMES and not has_permission(actor, permission):
        raise HTTPException(status_code=403, detail="Collector Portal access is required")
    if not has_permission(actor, permission):
        role_defaults = {
            "collector.portal.view": PORTAL_ROLE_NAMES,
            "collector.payment.collect": COLLECTOR_ROLE_NAMES | SUPERVISOR_ROLE_NAMES | ADMIN_ROLE_NAMES,
            "collector.remittance.submit": COLLECTOR_ROLE_NAMES | SUPERVISOR_ROLE_NAMES | ADMIN_ROLE_NAMES,
            "collector.finance.view": FINANCE_ROLE_NAMES | SUPERVISOR_ROLE_NAMES | ADMIN_ROLE_NAMES,
            "collector.finance.confirm": FINANCE_ROLE_NAMES | SUPERVISOR_ROLE_NAMES | ADMIN_ROLE_NAMES,
        }
        if actor_role(actor) not in role_defaults.get(permission, set()):
            raise HTTPException(status_code=403, detail=f"Missing permission: {permission}")


def parse_payment_date(value: str | None) -> str:
    text = clean_text(value, 20) or today_iso()
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="paymentDate must be YYYY-MM-DD") from exc


def parse_timestamp(value: Any) -> datetime | None:
    text = clean_text(value, 80)
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def configure_collector(
    current_admin: Callable[[str | None], dict[str, Any]],
    audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None] | None = None,
    customer_resolver: Callable[[str], dict[str, Any]] | None = None,
    customer_searcher: Callable[[str], list[dict[str, Any]]] | None = None,
    billing_aging_provider: Callable[..., list[dict[str, Any]]] | None = None,
    billing_payment_poster: Callable[..., dict[str, Any]] | None = None,
    sms_sender: Callable[..., dict[str, Any]] | None = None,
) -> None:
    global _current_admin, _audit_logger, _customer_resolver, _customer_searcher
    global _billing_aging_provider, _billing_payment_poster, _sms_sender
    _current_admin = current_admin
    _audit_logger = audit_logger
    _customer_resolver = customer_resolver
    _customer_searcher = customer_searcher
    _billing_aging_provider = billing_aging_provider
    _billing_payment_poster = billing_payment_poster
    _sms_sender = sms_sender


def require_actor(authorization: str | None = Header(default=None)):
    if _current_admin is None:
        raise HTTPException(status_code=500, detail="Collector module is not configured")
    actor = _current_admin(authorization)
    require_collector_permission(actor, "collector.portal.view")
    return actor


class CollectorRecordStore:
    def __init__(self) -> None:
        self.database_url = os.getenv("DATABASE_URL", "").strip()
        self.storage_mode = COLLECTOR_STORAGE_MODE.strip().lower()
        self._schema_ready = False
        self._loaded = False
        self._process_lock = RLock()
        self._state = local()

    @property
    def postgres_enabled(self) -> bool:
        return self.storage_mode == "postgres"

    @property
    def in_transaction(self) -> bool:
        return bool(getattr(self._state, "in_transaction", False))

    def _connect(self, autocommit: bool = True):
        if not self.postgres_enabled:
            return None
        if psycopg is None or dict_row is None:
            raise HTTPException(status_code=503, detail="Collector database driver is not installed")
        if not self.database_url:
            raise HTTPException(status_code=503, detail="Collector database URL is not configured")
        return psycopg.connect(self.database_url, autocommit=autocommit, row_factory=dict_row)

    def ensure_schema(self, connection=None) -> bool:
        if not self.postgres_enabled:
            return False
        if self._schema_ready:
            return True
        owns_connection = connection is None
        conn = connection or self._connect()
        try:
            with conn.cursor() as cursor:
                cursor.execute("SELECT to_regclass('public.collector_records') AS table_name")
                row = cursor.fetchone() or {}
                if not row.get("table_name"):
                    raise HTTPException(status_code=503, detail="Collector database migration has not run")
            self._schema_ready = True
            return True
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Collector database schema initialization failed")
            raise HTTPException(status_code=503, detail=f"Collector database is unavailable: {exc}") from exc
        finally:
            if owns_connection and conn is not None:
                conn.close()

    def load_records(self, force: bool = False, connection=None) -> bool:
        if not self.ensure_schema(connection):
            return False
        if self._loaded and not force:
            return True
        owns_connection = connection is None
        conn = connection or self._connect()
        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT record_type, record_id, data
                    FROM collector_records
                    WHERE deleted_at IS NULL
                    ORDER BY created_at DESC, record_type, record_id
                    """
                )
                rows = cursor.fetchall()
        finally:
            if owns_connection and conn is not None:
                conn.close()
        for collection in COLLECTOR_RECORD_COLLECTIONS.values():
            collection.clear()
        for row in rows:
            collection = COLLECTOR_RECORD_COLLECTIONS.get(row["record_type"])
            if collection is None:
                continue
            payload = dict(row.get("data") or {})
            payload.setdefault("id", row["record_id"])
            collection.append(payload)
        self._loaded = True
        return True

    def save_record(self, record_type: str, record: dict[str, Any], connection=None) -> bool:
        if not self.ensure_schema(connection):
            return False
        if Json is None:
            raise HTTPException(status_code=503, detail="Collector JSON database adapter is not installed")
        owns_connection = connection is None
        conn = connection or self._connect()
        payload = dict(record)
        record_id = clean_text(payload.get("id"), 160)
        if not record_id:
            raise HTTPException(status_code=500, detail="Collector record is missing an id")
        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO collector_records (
                        record_type,
                        record_id,
                        collector_username,
                        customer_id,
                        billing_payment_id,
                        status,
                        method,
                        reference_number,
                        idempotency_key,
                        data,
                        created_at,
                        updated_at,
                        deleted_at
                    )
                    VALUES (
                        %(record_type)s,
                        %(record_id)s,
                        %(collector_username)s,
                        %(customer_id)s,
                        %(billing_payment_id)s,
                        %(status)s,
                        %(method)s,
                        %(reference_number)s,
                        %(idempotency_key)s,
                        %(data)s,
                        %(created_at)s,
                        %(updated_at)s,
                        %(deleted_at)s
                    )
                    ON CONFLICT (record_type, record_id) DO UPDATE SET
                        collector_username = EXCLUDED.collector_username,
                        customer_id = EXCLUDED.customer_id,
                        billing_payment_id = EXCLUDED.billing_payment_id,
                        status = EXCLUDED.status,
                        method = EXCLUDED.method,
                        reference_number = EXCLUDED.reference_number,
                        idempotency_key = EXCLUDED.idempotency_key,
                        data = EXCLUDED.data,
                        updated_at = EXCLUDED.updated_at,
                        deleted_at = EXCLUDED.deleted_at
                    """,
                    {
                        "record_type": record_type,
                        "record_id": record_id,
                        "collector_username": payload.get("collectorUsername") or "",
                        "customer_id": payload.get("customerId") or "",
                        "billing_payment_id": payload.get("billingPaymentId") or "",
                        "status": payload.get("status") or payload.get("custodyStatus") or "",
                        "method": payload.get("method") or "",
                        "reference_number": payload.get("referenceNumber") or payload.get("gcashTransferReference") or "",
                        "idempotency_key": payload.get("idempotencyKey") or "",
                        "data": Json(payload),
                        "created_at": payload.get("createdAt") or now_iso(),
                        "updated_at": payload.get("updatedAt") or payload.get("createdAt") or now_iso(),
                        "deleted_at": payload.get("deletedAt") or None,
                    },
                )
            if owns_connection:
                conn.commit()
        finally:
            if owns_connection and conn is not None:
                conn.close()
        return True

    def save_all(self, connection=None) -> bool:
        if not self.postgres_enabled:
            return False
        for record_type, collection in COLLECTOR_RECORD_COLLECTIONS.items():
            for record in collection:
                self.save_record(record_type, record, connection=connection)
        return True

    def mark_dirty(self) -> None:
        if self.in_transaction:
            self._state.dirty = True

    def queue_audit(
        self,
        action: str,
        target_type: str,
        target_id: str,
        details: dict[str, Any] | None,
        actor: str,
    ) -> None:
        event = {
            "action": action,
            "targetType": target_type,
            "targetId": target_id,
            "details": details or {},
            "actor": actor,
        }
        if self.in_transaction:
            self._state.pending_audits.append(event)
        elif _audit_logger is not None:
            _audit_logger(action, target_type, target_id, details or {}, actor)

    def _snapshot(self) -> dict[str, list[dict[str, Any]]]:
        return {record_type: deepcopy(collection) for record_type, collection in COLLECTOR_RECORD_COLLECTIONS.items()}

    def _restore(self, snapshot: dict[str, list[dict[str, Any]]]) -> None:
        for record_type, collection in COLLECTOR_RECORD_COLLECTIONS.items():
            collection.clear()
            collection.extend(deepcopy(snapshot.get(record_type, [])))

    @contextmanager
    def transaction(self) -> Iterator[None]:
        if self.in_transaction:
            yield
            return
        connection = None
        snapshot: dict[str, list[dict[str, Any]]] | None = None
        committed_audits: list[dict[str, Any]] = []
        with self._process_lock:
            try:
                if self.postgres_enabled:
                    self.ensure_schema()
                    connection = self._connect(autocommit=False)
                    with connection.cursor() as cursor:
                        cursor.execute(
                            "SELECT pg_advisory_xact_lock(hashtext(%s))",
                            ("threejmain.collector.operational-records",),
                        )
                    self.load_records(force=True, connection=connection)
                snapshot = self._snapshot()
                self._state.in_transaction = True
                self._state.dirty = False
                self._state.pending_audits = []
                yield
                if self._state.dirty and self.postgres_enabled:
                    self.save_all(connection=connection)
                if connection is not None:
                    connection.commit()
                committed_audits = list(self._state.pending_audits)
            except Exception as exc:
                if connection is not None:
                    connection.rollback()
                if snapshot is not None:
                    self._restore(snapshot)
                if psycopg is not None and isinstance(exc, psycopg.errors.UniqueViolation):
                    constraint = clean_text(getattr(exc.diag, "constraint_name", ""), 160)
                    if constraint == "uq_collector_gcash_reference":
                        raise HTTPException(status_code=409, detail="This GCash transaction reference was already recorded") from exc
                    raise HTTPException(status_code=409, detail="Duplicate Collector transaction was prevented") from exc
                raise
            finally:
                for attribute in ["in_transaction", "dirty", "pending_audits"]:
                    if hasattr(self._state, attribute):
                        delattr(self._state, attribute)
                if connection is not None:
                    connection.close()
        if _audit_logger is not None:
            for event in committed_audits:
                try:
                    _audit_logger(
                        event["action"],
                        event["targetType"],
                        event["targetId"],
                        event["details"],
                        event["actor"],
                    )
                except Exception:
                    logger.exception("Collector audit dispatch failed after commit")

    def ensure_loaded(self) -> None:
        if self.postgres_enabled:
            self.load_records(force=not self.in_transaction)
        elif not self._loaded:
            self._loaded = True

    def status(self) -> dict[str, Any]:
        if not self.postgres_enabled:
            return {"mode": "memory", "ready": False, "reason": "COLLECTOR_STORAGE is not postgres"}
        self.ensure_schema()
        conn = self._connect()
        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT record_type, count(*) AS total
                    FROM collector_records
                    WHERE deleted_at IS NULL
                    GROUP BY record_type
                    ORDER BY record_type
                    """
                )
                rows = cursor.fetchall()
        finally:
            conn.close()
        return {
            "mode": "postgres",
            "ready": True,
            "table": "collector_records",
            "recordCounts": {row["record_type"]: int(row["total"]) for row in rows},
        }


collector_store = CollectorRecordStore()


def collector_mutation(function: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(function)
    def wrapped(*args, **kwargs):
        with collector_store.transaction():
            return function(*args, **kwargs)

    return wrapped


def add_audit(
    action: str,
    target_type: str,
    target_id: str,
    details: dict[str, Any] | None,
    actor: str,
) -> None:
    collector_store.queue_audit(action, target_type, target_id, details, actor)


def find_record(rows: list[dict[str, Any]], record_id: str, label: str) -> dict[str, Any]:
    collector_store.ensure_loaded()
    row = next((item for item in rows if item.get("id") == record_id and not item.get("deletedAt")), None)
    if row is None:
        raise HTTPException(status_code=404, detail=f"{label} not found")
    return row


def clear_expired_claims() -> None:
    current_time = datetime.now(timezone.utc)
    changed = False
    for claim in claims:
        if claim.get("status") != "CLAIMED":
            continue
        expires_at = parse_timestamp(claim.get("expiresAt"))
        if expires_at is not None and expires_at <= current_time:
            claim["status"] = "EXPIRED"
            claim["updatedAt"] = now_iso()
            changed = True
    if changed:
        collector_store.mark_dirty()


def active_claim_for_customer(customer_id: str) -> dict[str, Any] | None:
    clear_expired_claims()
    return next(
        (
            claim
            for claim in claims
            if claim.get("customerId") == customer_id
            and claim.get("status") == "CLAIMED"
            and not claim.get("deletedAt")
        ),
        None,
    )


def customer_detail(customer_id: str) -> dict[str, Any]:
    if _customer_resolver is None:
        return {}
    try:
        return dict(_customer_resolver(customer_id) or {})
    except HTTPException:
        return {}


def customer_location(raw: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
    address_parts = [
        raw.get("addressLine1"),
        raw.get("addressLine2"),
        raw.get("barangay"),
        raw.get("city"),
        raw.get("province"),
    ]
    address = ", ".join(clean_text(part, 200) for part in address_parts if clean_text(part, 200))
    return {
        "address": address or fallback.get("address") or "",
        "addressLine1": raw.get("addressLine1") or "",
        "addressLine2": raw.get("addressLine2") or "",
        "barangay": raw.get("barangay") or "",
        "city": raw.get("city") or "",
        "province": raw.get("province") or "",
        "locationId": raw.get("locationId") or "",
        "latitude": raw.get("latitude") or None,
        "longitude": raw.get("longitude") or None,
    }


def billing_accounts(search: str = "") -> list[dict[str, Any]]:
    if _billing_aging_provider is None:
        raise HTTPException(status_code=503, detail="Billing collectible-account provider is not configured")
    rows = _billing_aging_provider(search=search)
    collector_store.ensure_loaded()
    clear_expired_claims()
    enriched = []
    for row in rows:
        customer = dict(row.get("customer") or {})
        customer_id = clean_text(customer.get("id") or row.get("customerId"), 160)
        raw = customer_detail(customer_id)
        customer.update(
            {
                "contactNumber": raw.get("contactNumber") or customer.get("contactNumber") or "",
                "alternateMobileNumber": raw.get("alternateMobileNumber") or "",
                **customer_location(raw, customer),
            }
        )
        claim = active_claim_for_customer(customer_id)
        last_collection = next(
            (
                item
                for item in collections
                if item.get("customerId") == customer_id and item.get("status") == "POSTED"
            ),
            None,
        )
        enriched.append(
            {
                **row,
                "customerId": customer_id,
                "customer": customer,
                "claim": public_claim(claim) if claim else None,
                "lastCollection": {
                    "receiptNumber": last_collection.get("receiptNumber"),
                    "amount": last_collection.get("amount"),
                    "createdAt": last_collection.get("createdAt"),
                    "collectorName": last_collection.get("collectorName"),
                }
                if last_collection
                else None,
            }
        )
    return enriched


def invoice_promotion_quote(invoice: dict[str, Any]) -> dict[str, Any]:
    quote = dict(invoice.get("promotionQuote") or {})
    balance = money(invoice.get("balance"))
    promotion_ids = [
        clean_text(promotion_id, 160)
        for promotion_id in quote.get("promotionIds") or []
        if clean_text(promotion_id, 160)
    ]
    discount_amount = money(quote.get("promotionDiscountAmount"))
    discounted_payable = money(quote.get("discountedPayable", balance))
    if not promotion_ids or discount_amount <= 0 or discounted_payable <= 0:
        promotion_ids = []
        discount_amount = 0.0
        discounted_payable = balance
    return {
        **quote,
        "promotionIds": promotion_ids,
        "promotionDiscountAmount": discount_amount,
        "discountedPayable": discounted_payable,
        "paymentDate": clean_text(quote.get("paymentDate"), 20),
        "quoteFingerprint": clean_text(quote.get("quoteFingerprint"), 128),
    }


def automatic_collection_allocations(
    invoices: list[dict[str, Any]],
    raw_amount: float,
) -> tuple[list[dict[str, Any]], float]:
    """Allocate actual funds FIFO, applying an automatic promo only on full discounted payoff."""
    remaining = money(raw_amount)
    allocation_rows: list[dict[str, Any]] = []
    for invoice in invoices:
        if remaining <= 0:
            break
        balance = money(invoice.get("balance"))
        if balance <= 0:
            continue
        quote = invoice_promotion_quote(invoice)
        promotion_ids = quote["promotionIds"]
        discounted_payable = quote["discountedPayable"]
        if promotion_ids and remaining >= discounted_payable:
            applied_amount = discounted_payable
            allocation_rows.append(
                {
                    "invoiceId": invoice.get("id"),
                    "amount": applied_amount,
                    "promotionIds": promotion_ids,
                    "promotionQuoteDate": quote["paymentDate"],
                    "promotionQuoteFingerprint": quote["quoteFingerprint"],
                }
            )
        else:
            applied_amount = money(min(balance, remaining))
            allocation_rows.append(
                {
                    "invoiceId": invoice.get("id"),
                    "amount": applied_amount,
                    "promotionIds": [],
                    "promotionQuoteDate": "",
                    "promotionQuoteFingerprint": "",
                }
            )
        remaining = money(remaining - applied_amount)
    return allocation_rows, remaining


def public_claim(claim: dict[str, Any] | None) -> dict[str, Any] | None:
    if claim is None:
        return None
    return dict(claim)


def public_collection(collection: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any]:
    row = dict(collection)
    if not is_finance_actor(actor) and row.get("collectorUsername") != actor_username(actor):
        raise HTTPException(status_code=403, detail="This collection belongs to another collector")
    row.pop("gcashReceivingNumber", None)
    return row


def visible_collections_for_actor(actor: dict[str, Any]) -> list[dict[str, Any]]:
    collector_store.ensure_loaded()
    rows = [row for row in collections if not row.get("deletedAt")]
    if not is_finance_actor(actor):
        rows = [row for row in rows if row.get("collectorUsername") == actor_username(actor)]
    return rows


def visible_remittances_for_actor(actor: dict[str, Any]) -> list[dict[str, Any]]:
    collector_store.ensure_loaded()
    rows = [row for row in remittances if not row.get("deletedAt")]
    if not is_finance_actor(actor):
        rows = [row for row in rows if row.get("collectorUsername") == actor_username(actor)]
    return rows


def open_custody_collections(username: str) -> list[dict[str, Any]]:
    return [
        row
        for row in collections
        if row.get("collectorUsername") == username
        and row.get("status") == "POSTED"
        and row.get("custodyStatus") == "HELD"
        and not row.get("deletedAt")
    ]


def collection_totals(rows: list[dict[str, Any]]) -> dict[str, float | int]:
    cash_rows = [row for row in rows if row.get("method") == "CASH"]
    gcash_rows = [row for row in rows if row.get("method") == "GCASH"]
    return {
        "collections": len(rows),
        "cash": money(sum(row.get("amount", 0) for row in cash_rows)),
        "gcash": money(sum(row.get("amount", 0) for row in gcash_rows)),
        "total": money(sum(row.get("amount", 0) for row in rows)),
    }


def collector_metrics() -> dict[str, int | float]:
    collector_store.ensure_loaded()
    clear_expired_claims()
    posted = [row for row in collections if row.get("status") == "POSTED" and not row.get("deletedAt")]
    open_custody = [row for row in posted if row.get("custodyStatus") in {"HELD", "SUBMITTED", "UNDER_REVIEW"}]
    return {
        "activeClaims": sum(1 for row in claims if row.get("status") == "CLAIMED"),
        "collections": len(posted),
        "amountCollected": money(sum(row.get("amount", 0) for row in posted)),
        "cashInCustody": money(sum(row.get("amount", 0) for row in open_custody if row.get("method") == "CASH")),
        "gcashInCustody": money(sum(row.get("amount", 0) for row in open_custody if row.get("method") == "GCASH")),
        "openRemittances": sum(1 for row in remittances if row.get("status") in {"SUBMITTED", "VARIANCE"}),
        "unresolvedVariances": sum(1 for row in remittances if row.get("status") == "VARIANCE"),
    }


def seed_collector_data() -> None:
    """Collector starts empty but eagerly validates/loads its durable store."""
    collector_store.ensure_loaded()


@router.get("/health")
def health():
    return {"status": "ok", "module": "collector", "phase": "functional-portal"}


@router.get("/meta")
def meta(actor=Depends(require_actor)):
    return {
        "module": "collector",
        "name": "Collector",
        "status": "functional-portal",
        "route": "/collector",
        "apiPrefix": "/api/collector",
        "paymentMethods": PAYMENT_METHODS,
        "claimStatuses": CLAIM_STATUSES,
        "custodyStatuses": COLLECTION_CUSTODY_STATUSES,
        "remittanceStatuses": REMITTANCE_STATUSES,
        "claimDefaultMinutes": CLAIM_DEFAULT_MINUTES,
        "role": actor_role(actor),
        "permissions": sorted(actor_permissions(actor)),
        "canCollect": is_collector_actor(actor) and (
            actor_role(actor) in COLLECTOR_ROLE_NAMES | SUPERVISOR_ROLE_NAMES | ADMIN_ROLE_NAMES
            or has_permission(actor, "collector.payment.collect")
        ),
        "canSubmitRemittance": (
            actor_role(actor) in COLLECTOR_ROLE_NAMES | SUPERVISOR_ROLE_NAMES | ADMIN_ROLE_NAMES
            or has_permission(actor, "collector.remittance.submit")
        ),
        "canViewFinance": is_finance_actor(actor),
        "canConfirmFinance": (
            actor_role(actor) in FINANCE_ROLE_NAMES | SUPERVISOR_ROLE_NAMES | ADMIN_ROLE_NAMES
            or has_permission(actor, "collector.finance.confirm")
        ),
    }


@router.get("/readiness")
def readiness(actor=Depends(require_actor)):
    storage = collector_store.status()
    return {
        "realDataReady": bool(storage.get("ready")),
        "storage": storage,
        "providers": {
            "customers": _customer_resolver is not None,
            "billingAging": _billing_aging_provider is not None,
            "billingPayments": _billing_payment_poster is not None,
            "a2pMessaging": _sms_sender is not None,
            "audit": _audit_logger is not None,
        },
    }


@router.get("/overview")
def overview(actor=Depends(require_actor)):
    collector_store.ensure_loaded()
    metrics = collector_metrics()
    own_rows = [
        row
        for row in collections
        if row.get("collectorUsername") == actor_username(actor)
        and row.get("status") == "POSTED"
        and not row.get("deletedAt")
    ]
    held_rows = [row for row in own_rows if row.get("custodyStatus") == "HELD"]
    today_rows = [row for row in own_rows if clean_text(row.get("paymentDate"), 20) == today_iso()]
    return {
        "metrics": metrics,
        "today": collection_totals(today_rows),
        "custody": collection_totals(held_rows),
        "myActiveClaimCount": sum(
            1
            for row in claims
            if row.get("status") == "CLAIMED" and row.get("collectorUsername") == actor_username(actor)
        ),
        "myOpenRemittanceCount": sum(
            1
            for row in remittances
            if row.get("collectorUsername") == actor_username(actor)
            and row.get("status") in {"SUBMITTED", "VARIANCE"}
        ),
    }


@router.get("/customers")
def list_collectible_customers(search: str = "", actor=Depends(require_actor)):
    rows = billing_accounts(search)
    return {
        "items": rows,
        "total": len(rows),
        "outstandingTotal": money(sum(row.get("outstandingBalance", 0) for row in rows)),
        "overdueTotal": money(sum(row.get("overdueBalance", 0) for row in rows)),
    }


@router.post("/customers/{customer_id}/claim")
@collector_mutation
def claim_customer(customer_id: str, payload: ClaimPayload, actor=Depends(require_actor)):
    require_collector_permission(actor, "collector.payment.collect")
    rows = billing_accounts("")
    account = next((row for row in rows if row.get("customerId") == customer_id), None)
    if account is None:
        raise HTTPException(status_code=404, detail="Customer has no collectible Billing balance")
    existing = active_claim_for_customer(customer_id)
    timestamp = now_iso()
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=payload.minutes)).isoformat()
    if existing:
        if existing.get("collectorUsername") != actor_username(actor):
            raise HTTPException(
                status_code=409,
                detail=f"{existing.get('collectorName') or existing.get('collectorUsername')} is already handling this customer",
            )
        existing["expiresAt"] = expires_at
        existing["updatedAt"] = timestamp
        collector_store.mark_dirty()
        add_audit(
            "collector_claim_renewed",
            "CollectorClaim",
            existing["id"],
            {"customerId": customer_id, "expiresAt": expires_at},
            actor_username(actor),
        )
        return public_claim(existing)
    claim = {
        "id": str(uuid4()),
        "customerId": customer_id,
        "customer": account.get("customer") or {},
        "collectorId": actor.get("id") or "",
        "collectorUsername": actor_username(actor),
        "collectorName": actor_display_name(actor),
        "status": "CLAIMED",
        "claimedAt": timestamp,
        "expiresAt": expires_at,
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
    }
    claims.insert(0, claim)
    collector_store.mark_dirty()
    add_audit(
        "collector_customer_claimed",
        "CollectorClaim",
        claim["id"],
        {"customerId": customer_id, "expiresAt": expires_at},
        actor_username(actor),
    )
    return public_claim(claim)


@router.delete("/claims/{claim_id}")
@collector_mutation
def release_claim(claim_id: str, actor=Depends(require_actor)):
    claim = find_record(claims, claim_id, "Claim")
    if claim.get("collectorUsername") != actor_username(actor) and not is_finance_actor(actor):
        raise HTTPException(status_code=403, detail="Only the collector handling this customer can release it")
    if claim.get("status") == "CLAIMED":
        claim["status"] = "RELEASED"
        claim["releasedAt"] = now_iso()
        claim["updatedAt"] = claim["releasedAt"]
        collector_store.mark_dirty()
        add_audit(
            "collector_claim_released",
            "CollectorClaim",
            claim["id"],
            {"customerId": claim["customerId"]},
            actor_username(actor),
        )
    return {"status": "ok", "claim": public_claim(claim)}


def find_collection_by_idempotency_key(idempotency_key: str) -> dict[str, Any] | None:
    return next(
        (
            row
            for row in collections
            if row.get("idempotencyKey") == idempotency_key and not row.get("deletedAt")
        ),
        None,
    )


def gcash_reference_exists(reference_number: str) -> bool:
    normalized = clean_text(reference_number, 160).lower()
    return any(
        row.get("method") == "GCASH"
        and clean_text(row.get("referenceNumber"), 160).lower() == normalized
        and row.get("status") == "POSTED"
        and not row.get("deletedAt")
        for row in collections
    )


def collection_sms_message(record: dict[str, Any]) -> str:
    customer = record.get("customer") or {}
    first_name = clean_text(customer.get("firstName"), 80)
    if not first_name:
        customer_name = clean_text(customer.get("name"), 160)
        first_name = customer_name.split()[0] if customer_name else "Customer"
    message = (
        f"Thank you, {first_name}! "
        f"We received your payment of P{money(record.get('amount')):,.2f}."
    )
    remaining_balance = money(record.get("balanceAfter"))
    if remaining_balance > 0:
        return f"{message} You have a remaining balance of P{remaining_balance:,.2f}."
    return f"{message} Your account is now fully paid."


def send_collection_sms(record: dict[str, Any], actor: dict[str, Any], destination: str) -> dict[str, Any]:
    if not destination:
        return {
            "status": "SKIPPED",
            "senderId": COLLECTOR_SMS_SENDER_ID,
            "error": "Customer has no SMS destination",
        }
    if _sms_sender is None:
        return {
            "status": "FAILED",
            "senderId": COLLECTOR_SMS_SENDER_ID,
            "error": "A2P Messaging provider is not configured",
        }
    try:
        result = _sms_sender(
            destination=destination,
            message_text=collection_sms_message(record),
            source=COLLECTOR_SMS_SENDER_ID,
            purpose="COLLECTOR_PAYMENT_CONFIRMATION",
            request_context={
                "collectorCollectionId": record["id"],
                "billingPaymentId": record["billingPaymentId"],
                "receiptNumber": record["receiptNumber"],
                "customerId": record["customerId"],
            },
            created_by_admin_id=actor.get("id") or actor_username(actor),
        )
        return {
            "status": result.get("status") or "SUCCESS",
            **result,
            "senderId": COLLECTOR_SMS_SENDER_ID,
        }
    except HTTPException as exc:
        return {
            "status": "FAILED",
            "senderId": COLLECTOR_SMS_SENDER_ID,
            "error": clean_text(exc.detail, 500),
        }
    except Exception as exc:  # pragma: no cover - defensive provider boundary.
        logger.exception("Collector payment confirmation SMS failed")
        return {
            "status": "FAILED",
            "senderId": COLLECTOR_SMS_SENDER_ID,
            "error": clean_text(exc, 500),
        }


@router.post("/collections")
def create_collection(
    payload: CollectionPayload,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    actor=Depends(require_actor),
):
    require_collector_permission(actor, "collector.payment.collect")
    posting_key = clean_text(idempotency_key, 200)
    if len(posting_key) < 8:
        raise HTTPException(status_code=400, detail="A stable Idempotency-Key header is required")
    method = normalize_upper(payload.method)
    if method not in PAYMENT_METHODS:
        raise HTTPException(status_code=400, detail="Payment method must be CASH or GCASH")
    amount = money(payload.amount)
    allocation_total = money(sum(money(row.amount) for row in payload.allocations))
    advance_amount = money(payload.advanceAmount)
    if money(allocation_total + advance_amount) != amount:
        raise HTTPException(
            status_code=400,
            detail="Collection amount must equal invoice allocations plus advance credit",
        )
    reference_number = clean_text(payload.referenceNumber, 160)
    if method == "GCASH":
        if not reference_number:
            raise HTTPException(status_code=400, detail="GCash transaction reference is required")
    received_amount = money(
        payload.receivedAmount
        if payload.receivedAmount is not None
        else payload.tenderedAmount
        if method == "CASH" and payload.tenderedAmount is not None
        else amount
    )
    returned_amount = money(
        payload.returnedAmount
        if payload.returnedAmount is not None
        else max(0, received_amount - amount)
        if method == "CASH"
        else 0
    )
    if received_amount < amount:
        raise HTTPException(status_code=400, detail="Amount received cannot be less than the posted payment")
    if money(received_amount - returned_amount) != amount:
        raise HTTPException(
            status_code=400,
            detail="Amount received minus the returned amount must equal the posted payment",
        )
    tendered_amount = received_amount if method == "CASH" else amount
    payment_date = parse_payment_date(payload.paymentDate)

    with collector_store.transaction():
        replay = find_collection_by_idempotency_key(posting_key)
        if replay is not None:
            response = public_collection(replay, actor)
            response["idempotentReplay"] = True
            return response
        if method == "GCASH" and gcash_reference_exists(reference_number):
            raise HTTPException(status_code=409, detail="This GCash transaction reference was already recorded")
        claim = active_claim_for_customer(payload.customerId)
        if claim is None:
            raise HTTPException(status_code=409, detail="Open this customer's payment entry again before posting")
        if claim.get("collectorUsername") != actor_username(actor):
            raise HTTPException(status_code=409, detail="Another collector is currently handling this customer")
        accounts_before = billing_accounts("")
        account_before = next((row for row in accounts_before if row.get("customerId") == payload.customerId), None)
        if account_before is None:
            raise HTTPException(status_code=409, detail="Customer is no longer available for collection")
        quoted_payment_date = clean_text(account_before.get("paymentDate"), 20)
        if quoted_payment_date and quoted_payment_date != payment_date:
            raise HTTPException(
                status_code=409,
                detail="The payment date or promotion quote changed. Refresh the customer account before collecting payment",
            )
        invoice_by_id = {row["id"]: row for row in account_before.get("invoices", [])}
        expected_allocations, expected_unapplied = automatic_collection_allocations(
            account_before.get("invoices") or [],
            allocation_total,
        )
        submitted_allocations = [
            {
                "invoiceId": allocation.invoiceId,
                "amount": money(allocation.amount),
                "promotionIds": [
                    clean_text(promotion_id, 160)
                    for promotion_id in allocation.promotionIds
                    if clean_text(promotion_id, 160)
                ],
                "promotionQuoteDate": clean_text(allocation.promotionQuoteDate, 20),
                "promotionQuoteFingerprint": clean_text(allocation.promotionQuoteFingerprint, 128),
            }
            for allocation in payload.allocations
        ]
        if expected_unapplied > 0 or submitted_allocations != expected_allocations:
            raise HTTPException(
                status_code=409,
                detail="Invoice balances or automatic promotions changed. Refresh the customer account before collecting payment",
            )
        authoritative_payable = money(
            account_before.get(
                "payableToday",
                sum(invoice_promotion_quote(invoice)["discountedPayable"] for invoice in invoice_by_id.values()),
            )
        )
        if advance_amount > 0 and allocation_total != authoritative_payable:
            raise HTTPException(
                status_code=400,
                detail="Advance credit can only be stored after all current invoices are fully paid",
            )
        if _billing_payment_poster is None:
            raise HTTPException(status_code=503, detail="Billing payment provider is not configured")
        payment = _billing_payment_poster(
            payload={
                "customerId": payload.customerId,
                "amount": amount,
                "allocations": [
                    {
                        "invoiceId": row.invoiceId,
                        "amount": money(row.amount),
                        "promotionIds": list(row.promotionIds),
                        "promotionQuoteDate": clean_text(row.promotionQuoteDate, 20),
                        "promotionQuoteFingerprint": clean_text(row.promotionQuoteFingerprint, 128),
                    }
                    for row in payload.allocations
                ],
                "advanceAmount": advance_amount,
                "method": method,
                "paymentDate": payment_date,
                "referenceNumber": reference_number,
                "collectionChannel": "COLLECTOR",
                "status": "POSTED",
                "notes": clean_text(payload.notes, 1000),
            },
            idempotency_key=posting_key,
            actor=actor,
        )
        accounts_after = billing_accounts("")
        account_after = next((row for row in accounts_after if row.get("customerId") == payload.customerId), None)
        balance_after = money(account_after.get("outstandingBalance")) if account_after else 0
        timestamp = now_iso()
        allocation_rows = []
        payment_allocations = {
            row.get("invoiceId"): row for row in payment.get("allocations", []) if isinstance(row, dict)
        }
        after_invoice_by_id = {
            row.get("id"): row
            for row in (account_after or {}).get("invoices", [])
            if isinstance(row, dict)
        }
        promotion_adjustments = [
            row
            for row in (
                list(payment.get("promotionDiscountAdjustments") or [])
                + list(payment.get("earlyBirdDiscountAdjustments") or [])
            )
            if isinstance(row, dict)
        ]
        for allocation in payload.allocations:
            invoice = invoice_by_id[allocation.invoiceId]
            billing_allocation = payment_allocations.get(allocation.invoiceId) or {}
            balance_before = money(billing_allocation.get("balanceBefore", invoice.get("balance")))
            after_invoice = after_invoice_by_id.get(allocation.invoiceId)
            allocation_promotions = [
                {
                    "promotionId": clean_text(row.get("promotionId"), 160),
                    "promotionCode": clean_text(row.get("promotionCode"), 160),
                    "promotionName": clean_text(row.get("promotionName"), 200) or "Automatic promotion",
                    "amount": money(row.get("amount")),
                }
                for row in promotion_adjustments
                if row.get("invoiceId") == allocation.invoiceId and money(row.get("amount")) > 0
            ]
            promotion_discount_amount = money(
                sum(row["amount"] for row in allocation_promotions)
            )
            allocation_rows.append(
                {
                    "invoiceId": allocation.invoiceId,
                    "invoiceNumber": invoice.get("invoiceNumber") or billing_allocation.get("invoiceNumber") or "",
                    "billingCycleStart": invoice.get("billingCycleStart") or "",
                    "billingCycleEnd": invoice.get("billingCycleEnd") or "",
                    "dueDate": invoice.get("dueDate") or "",
                    "statusBefore": invoice.get("status") or "",
                    "statusAfter": after_invoice.get("status") if after_invoice else "PAID",
                    "amount": money(allocation.amount),
                    "balanceBefore": balance_before,
                    "balanceAfter": money(after_invoice.get("balance")) if after_invoice else 0.0,
                    "promotionIds": list(billing_allocation.get("promotionIds") or allocation.promotionIds),
                    "promotions": allocation_promotions,
                    "promotionDiscountAmount": promotion_discount_amount,
                    "settledAmount": money(allocation.amount + promotion_discount_amount),
                    "catalogName": invoice.get("catalogName") or "",
                    "lineItems": invoice.get("lineItems") or [],
                }
            )
        promotion_discount_total = money(
            sum(row["promotionDiscountAmount"] for row in allocation_rows)
        )
        customer = dict(account_before.get("customer") or {})
        sms_destination = clean_text(payload.smsDestination or customer.get("contactNumber"), 40)
        record = {
            "id": str(uuid4()),
            "idempotencyKey": posting_key,
            "billingPaymentId": payment.get("id") or "",
            "receiptNumber": payment.get("receiptNumber") or "",
            "billingPaymentStatus": payment.get("status") or "POSTED",
            "customerId": payload.customerId,
            "customer": customer,
            "collectorId": actor.get("id") or "",
            "collectorUsername": actor_username(actor),
            "collectorName": actor_display_name(actor),
            "claimId": claim["id"],
            "amount": amount,
            "receivedAmount": received_amount,
            "returnedAmount": returned_amount,
            "appliedAmount": money(allocation_total),
            "advanceAmount": advance_amount,
            "allocationMode": normalize_upper(payload.allocationMode or "OLDEST"),
            "method": method,
            "paymentDate": payment_date,
            "referenceNumber": reference_number,
            "tenderedAmount": tendered_amount if method == "CASH" else amount,
            "changeAmount": returned_amount if method == "CASH" else 0,
            "allocations": allocation_rows,
            "balanceBefore": money(account_before.get("outstandingBalance")),
            "amountDueBefore": money(account_before.get("payableToday", account_before.get("outstandingBalance"))),
            "promotionDiscountAmount": promotion_discount_total,
            "balanceAfter": balance_after,
            "accountCreditBefore": money(account_before.get("accountCredit")),
            "accountCreditAfter": money(payment.get("accountCreditAfter")),
            "status": "POSTED",
            "custodyStatus": "HELD",
            "remittanceId": "",
            "smsDestination": sms_destination,
            "sms": {"status": "PENDING"},
            "printHistory": [],
            "notes": clean_text(payload.notes, 1000),
            "createdAt": timestamp,
            "updatedAt": timestamp,
            "deletedAt": None,
        }
        collections.insert(0, record)
        claim["status"] = "RELEASED"
        claim["releasedAt"] = timestamp
        claim["releaseReason"] = "PAYMENT_COLLECTED"
        claim["updatedAt"] = timestamp
        collector_store.mark_dirty()
        add_audit(
            "collector_payment_recorded",
            "CollectorCollection",
            record["id"],
            {
                "customerId": payload.customerId,
                "billingPaymentId": record["billingPaymentId"],
                "receiptNumber": record["receiptNumber"],
                "method": method,
                "amount": amount,
                "appliedAmount": record["appliedAmount"],
                "promotionDiscountAmount": promotion_discount_total,
                "advanceAmount": advance_amount,
                "accountCreditAfter": record["accountCreditAfter"],
            },
            actor_username(actor),
        )

    sms_result = send_collection_sms(record, actor, record.get("smsDestination") or "")
    with collector_store.transaction():
        current = find_record(collections, record["id"], "Collection")
        current["sms"] = {**sms_result, "attemptedAt": now_iso()}
        current["updatedAt"] = now_iso()
        collector_store.mark_dirty()
        add_audit(
            "collector_payment_sms_processed",
            "CollectorCollection",
            current["id"],
            {"receiptNumber": current["receiptNumber"], "smsStatus": current["sms"].get("status")},
            actor_username(actor),
        )
        return public_collection(current, actor)


@router.get("/collections")
def list_collections(
    search: str = "",
    custodyStatus: str = "",
    actor=Depends(require_actor),
):
    rows = visible_collections_for_actor(actor)
    needle = clean_text(search, 200).lower()
    selected_status = normalize_upper(custodyStatus)
    if selected_status:
        rows = [row for row in rows if normalize_upper(row.get("custodyStatus")) == selected_status]
    if needle:
        rows = [
            row
            for row in rows
            if needle in clean_text(row.get("receiptNumber"), 200).lower()
            or needle in clean_text(row.get("referenceNumber"), 200).lower()
            or needle in clean_text(row.get("collectorName"), 200).lower()
            or needle in clean_text((row.get("customer") or {}).get("name"), 300).lower()
            or needle in clean_text((row.get("customer") or {}).get("accountNumber"), 160).lower()
        ]
    rows = sorted(rows, key=lambda row: row.get("createdAt") or "", reverse=True)
    return {
        "items": [public_collection(row, actor) for row in rows],
        "total": len(rows),
        "totals": collection_totals(rows),
    }


@router.get("/collections/{collection_id}")
def get_collection(collection_id: str, actor=Depends(require_actor)):
    return public_collection(find_record(collections, collection_id, "Collection"), actor)


@router.post("/collections/{collection_id}/print-events")
@collector_mutation
def record_print_event(
    collection_id: str,
    payload: PrintEventPayload,
    actor=Depends(require_actor),
):
    record = find_record(collections, collection_id, "Collection")
    public_collection(record, actor)
    history = record.setdefault("printHistory", [])
    event = {
        "id": str(uuid4()),
        "copyNumber": len(history) + 1,
        "label": "ORIGINAL" if not history else "REPRINT",
        "reason": clean_text(payload.reason, 300),
        "printedByUsername": actor_username(actor),
        "printedByName": actor_display_name(actor),
        "requestedAt": now_iso(),
    }
    history.append(event)
    record["updatedAt"] = now_iso()
    collector_store.mark_dirty()
    add_audit(
        "collector_receipt_print_requested",
        "CollectorCollection",
        record["id"],
        {
            "receiptNumber": record.get("receiptNumber"),
            "copyNumber": event["copyNumber"],
            "label": event["label"],
        },
        actor_username(actor),
    )
    return {"collection": public_collection(record, actor), "printEvent": event}


@router.post("/remittances")
@collector_mutation
def submit_remittance(payload: RemittancePayload, actor=Depends(require_actor)):
    require_collector_permission(actor, "collector.remittance.submit")
    username = actor_username(actor)
    held = open_custody_collections(username)
    if payload.collectionIds:
        requested = set(payload.collectionIds)
        selected = [row for row in held if row.get("id") in requested]
        if len(selected) != len(requested):
            raise HTTPException(status_code=409, detail="One or more selected collections are unavailable for remittance")
    else:
        selected = held
    if not selected:
        raise HTTPException(status_code=400, detail="There are no held collections to remit")
    totals = collection_totals(selected)
    declared_cash = money(payload.declaredCash if payload.declaredCash is not None else totals["cash"])
    transferred_gcash = money(
        payload.gcashTransferredAmount
        if payload.gcashTransferredAmount is not None
        else totals["gcash"]
    )
    transfer_reference = clean_text(payload.gcashTransferReference, 160)
    if money(totals["gcash"]) > 0 and not transfer_reference:
        raise HTTPException(status_code=400, detail="Company GCash transfer reference is required")
    timestamp = now_iso()
    remittance = {
        "id": str(uuid4()),
        "remittanceNumber": f"REM-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{str(uuid4())[:8].upper()}",
        "collectorId": actor.get("id") or "",
        "collectorUsername": username,
        "collectorName": actor_display_name(actor),
        "collectionIds": [row["id"] for row in selected],
        "collectionCount": len(selected),
        "expectedCash": money(totals["cash"]),
        "expectedGcash": money(totals["gcash"]),
        "expectedTotal": money(totals["total"]),
        "declaredCash": declared_cash,
        "gcashTransferredAmount": transferred_gcash,
        "gcashTransferReference": transfer_reference,
        "companyGcashAccount": clean_text(payload.companyGcashAccount, 80),
        "status": "SUBMITTED",
        "notes": clean_text(payload.notes, 1000),
        "submittedAt": timestamp,
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
    }
    remittances.insert(0, remittance)
    for collection in selected:
        collection["custodyStatus"] = "SUBMITTED"
        collection["remittanceId"] = remittance["id"]
        collection["updatedAt"] = timestamp
    collector_store.mark_dirty()
    add_audit(
        "collector_remittance_submitted",
        "CollectorRemittance",
        remittance["id"],
        {
            "remittanceNumber": remittance["remittanceNumber"],
            "collectionCount": len(selected),
            "expectedCash": remittance["expectedCash"],
            "expectedGcash": remittance["expectedGcash"],
        },
        username,
    )
    return remittance


@router.get("/remittances")
def list_remittances(status: str = "", actor=Depends(require_actor)):
    rows = visible_remittances_for_actor(actor)
    selected_status = normalize_upper(status)
    if selected_status:
        rows = [row for row in rows if normalize_upper(row.get("status")) == selected_status]
    rows = sorted(rows, key=lambda row: row.get("createdAt") or "", reverse=True)
    return {"items": rows, "total": len(rows)}


@router.get("/finance/overview")
def finance_overview(actor=Depends(require_actor)):
    require_collector_permission(actor, "collector.finance.view")
    collector_store.ensure_loaded()
    open_rows = [
        row for row in remittances if row.get("status") in {"SUBMITTED", "VARIANCE"} and not row.get("deletedAt")
    ]
    closed_rows = [
        row for row in remittances if row.get("status") == "CLOSED" and not row.get("deletedAt")
    ]
    return {
        "metrics": {
            "pendingBatches": len(open_rows),
            "pendingCash": money(sum(row.get("expectedCash", 0) for row in open_rows)),
            "pendingGcash": money(sum(row.get("expectedGcash", 0) for row in open_rows)),
            "varianceBatches": sum(1 for row in open_rows if row.get("status") == "VARIANCE"),
            "closedToday": sum(
                1
                for row in closed_rows
                if clean_text(row.get("closedAt"), 20).startswith(today_iso())
            ),
        },
        "openRemittances": sorted(open_rows, key=lambda row: row.get("submittedAt") or ""),
        "recentClosed": sorted(
            closed_rows,
            key=lambda row: row.get("closedAt") or "",
            reverse=True,
        )[:20],
    }


@router.post("/remittances/{remittance_id}/confirm")
@collector_mutation
def confirm_remittance(
    remittance_id: str,
    payload: RemittanceConfirmationPayload,
    actor=Depends(require_actor),
):
    require_collector_permission(actor, "collector.finance.confirm")
    remittance = find_record(remittances, remittance_id, "Remittance")
    if remittance.get("status") == "CLOSED":
        return remittance
    if remittance.get("status") not in {"SUBMITTED", "VARIANCE"}:
        raise HTTPException(status_code=409, detail="Remittance is not available for confirmation")
    company_reference = clean_text(payload.companyGcashReference, 160)
    if money(remittance.get("expectedGcash")) > 0 and not company_reference:
        raise HTTPException(status_code=400, detail="Company GCash receiving reference is required")
    counted_cash = money(payload.countedCash)
    confirmed_gcash = money(payload.confirmedGcashAmount)
    cash_variance = money(counted_cash - money(remittance.get("expectedCash")))
    gcash_variance = money(confirmed_gcash - money(remittance.get("expectedGcash")))
    total_variance = money(cash_variance + gcash_variance)
    notes = clean_text(payload.notes, 1000)
    has_variance = cash_variance != 0 or gcash_variance != 0
    if has_variance and not payload.acceptVariance:
        next_status = "VARIANCE"
    elif has_variance and not notes:
        raise HTTPException(status_code=400, detail="A variance resolution note is required")
    else:
        next_status = "CLOSED"
    timestamp = now_iso()
    remittance.update(
        {
            "countedCash": counted_cash,
            "confirmedGcashAmount": confirmed_gcash,
            "companyGcashReference": company_reference,
            "cashVariance": cash_variance,
            "gcashVariance": gcash_variance,
            "totalVariance": total_variance,
            "status": next_status,
            "financeNotes": notes,
            "receivedById": actor.get("id") or "",
            "receivedByUsername": actor_username(actor),
            "receivedByName": actor_display_name(actor),
            "receivedAt": timestamp,
            "updatedAt": timestamp,
        }
    )
    if next_status == "CLOSED":
        remittance["closedAt"] = timestamp
    linked_ids = set(remittance.get("collectionIds") or [])
    for collection in collections:
        if collection.get("id") not in linked_ids:
            continue
        collection["custodyStatus"] = "SETTLED" if next_status == "CLOSED" else "UNDER_REVIEW"
        if next_status == "CLOSED":
            collection["settledAt"] = timestamp
        collection["updatedAt"] = timestamp
    collector_store.mark_dirty()
    add_audit(
        "collector_remittance_closed" if next_status == "CLOSED" else "collector_remittance_variance_recorded",
        "CollectorRemittance",
        remittance["id"],
        {
            "remittanceNumber": remittance.get("remittanceNumber"),
            "cashVariance": cash_variance,
            "gcashVariance": gcash_variance,
            "status": next_status,
        },
        actor_username(actor),
    )
    return remittance
