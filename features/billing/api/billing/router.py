import hashlib
import json
import logging
import os
from contextlib import contextmanager
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from functools import wraps
from math import ceil
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


router = APIRouter(prefix="/api/billing", tags=["billing"])
logger = logging.getLogger(__name__)

subscriptions: list[dict[str, Any]] = []
invoices: list[dict[str, Any]] = []
payments: list[dict[str, Any]] = []
adjustments: list[dict[str, Any]] = []
installation_charges: list[dict[str, Any]] = []
promotions: list[dict[str, Any]] = []

_current_admin: Callable[[str | None], dict[str, Any]] | None = None
_audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None] | None = None
_customer_resolver: Callable[[str], dict[str, Any]] | None = None
_customer_searcher: Callable[[str], list[dict[str, Any]]] | None = None
_customer_seed: Callable[[], None] | None = None

BILLING_MODES = ["PREPAID", "POSTPAID"]
PRICING_SOURCES = ["MANUAL", "SERVICE_CATALOG", "PRICE_OVERRIDE"]
SUBSCRIPTION_STATUSES = ["ACTIVE", "PAUSED", "CANCELLED", "PENDING"]
INVOICE_STATUSES = ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID"]
PAYMENT_STATUSES = ["POSTED", "VOID"]
PAYMENT_METHODS = ["CASH", "GCASH", "BANK_TRANSFER", "CARD", "CHECK", "OTHER"]
ADJUSTMENT_TYPES = ["CREDIT", "DEBIT"]
ADJUSTMENT_STATUSES = ["POSTED", "VOID"]
INSTALLATION_CHARGE_STATUSES = ["PENDING", "INVOICED", "WAIVED", "NO_FEE", "VOID"]
PROMOTION_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "EXPIRED", "ARCHIVED"]
PROMOTION_SCOPES = ["MONTHLY_SERVICE", "INSTALLATION_FEE"]
PROMOTION_DISCOUNT_TYPES = ["FIXED_AMOUNT", "PERCENT", "WAIVE"]
PROMOTION_PAYMENT_RULES = ["ANY_PAYMENT", "EARLY_BIRD"]
MONTHLY_INVOICE_TYPES = {"MONTHLY", "FIRST_PRORATED", "FIRST_FULL"}
BILLING_RECORD_COLLECTIONS = {
    "subscription": subscriptions,
    "invoice": invoices,
    "payment": payments,
    "adjustment": adjustments,
    "installation_charge": installation_charges,
    "promotion": promotions,
}
BILLING_STORAGE_MODE = os.getenv("BILLING_STORAGE") or ("postgres" if os.getenv("DATABASE_URL") else "memory")
BILLING_SEED_DEMO = os.getenv("BILLING_SEED_DEMO", "false").strip().lower() in {"1", "true", "yes", "on"}
DEFAULT_EARLY_BIRD_DISCOUNT = 200.0


class SubscriptionPayload(BaseModel):
    customerId: str | None = None
    serviceAccountId: str | None = None
    serviceAccountNumber: str | None = None
    serviceOrderId: str | None = None
    catalogId: str | None = None
    catalogCode: str | None = None
    catalogName: str | None = None
    planName: str | None = None
    serviceId: str | None = None
    listMonthlyRate: float | None = Field(default=None, ge=0)
    monthlyRate: float | None = Field(default=None, ge=0)
    priceOverrideAmount: float | None = Field(default=None, ge=0)
    priceOverrideReason: str | None = None
    pricingSource: str | None = None
    billingMode: str | None = None
    billingDay: int | None = Field(default=None, ge=1, le=28)
    startDate: str | None = None
    nextInvoiceDate: str | None = None
    dueDays: int | None = Field(default=None, ge=0, le=60)
    earlyBirdEligible: bool | None = None
    earlyBirdPromotionId: str | None = None
    earlyBirdPromotionCode: str | None = None
    earlyBirdPromotionName: str | None = None
    earlyBirdDiscountAmount: float | None = Field(default=None, ge=0)
    status: str | None = None
    notes: str | None = None


class InvoicePayload(BaseModel):
    customerId: str | None = None
    subscriptionId: str | None = None
    billingCycleStart: str | None = None
    billingCycleEnd: str | None = None
    issueDate: str | None = None
    dueDate: str | None = None
    status: str | None = None
    lineItems: list[dict[str, Any]] | None = None
    notes: str | None = None


class PaymentPayload(BaseModel):
    invoiceId: str | None = None
    customerId: str | None = None
    amount: float | None = Field(default=None, gt=0)
    method: str | None = None
    paymentDate: str | None = None
    referenceNumber: str | None = None
    collectionChannel: str | None = None
    promotionId: str | None = None
    status: str | None = None
    notes: str | None = None


class AdjustmentPayload(BaseModel):
    invoiceId: str | None = None
    customerId: str | None = None
    type: str | None = None
    amount: float | None = Field(default=None, gt=0)
    reason: str | None = None
    status: str | None = None
    notes: str | None = None


class InstallationChargePayload(BaseModel):
    customerId: str | None = None
    serviceAccountId: str | None = None
    serviceAccountNumber: str | None = None
    serviceOrderId: str | None = None
    serviceId: str | None = None
    catalogId: str | None = None
    catalogCode: str | None = None
    catalogName: str | None = None
    billingMode: str | None = None
    status: str | None = None
    standardAmount: float | None = Field(default=None, ge=0)
    chargedAmount: float | None = Field(default=None, ge=0)
    waiverReason: str | None = None
    promoCode: str | None = None
    promotionId: str | None = None
    promotionCode: str | None = None
    promotionName: str | None = None
    issueDate: str | None = None
    dueDate: str | None = None
    notes: str | None = None


class PromotionPayload(BaseModel):
    name: str | None = None
    promoCode: str | None = None
    description: str | None = None
    appliesTo: str | None = None
    discountType: str | None = None
    discountAmount: float | None = Field(default=None, ge=0)
    discountPercent: float | None = Field(default=None, ge=0, le=100)
    startDate: str | None = None
    endDate: str | None = None
    status: str | None = None
    billingMode: str | None = None
    customerId: str | None = None
    catalogId: str | None = None
    paymentRule: str | None = None
    priority: int | None = Field(default=None, ge=0)
    requiresApproval: bool | None = None
    stackable: bool | None = None
    notes: str | None = None


class BillingRecordStore:
    def __init__(self) -> None:
        self.database_url = os.getenv("DATABASE_URL", "").strip()
        self.storage_mode = BILLING_STORAGE_MODE.strip().lower()
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

    @property
    def in_read_snapshot(self) -> bool:
        return int(getattr(self._state, "read_depth", 0)) > 0

    def _connect(self, autocommit: bool = True):
        if not self.postgres_enabled:
            return None
        if psycopg is None or dict_row is None:
            raise HTTPException(status_code=503, detail="Billing database driver is not installed")
        if not self.database_url:
            raise HTTPException(status_code=503, detail="Billing database URL is not configured")
        return psycopg.connect(self.database_url, autocommit=autocommit, row_factory=dict_row)

    @contextmanager
    def _connection_scope(self, connection=None, autocommit: bool = True) -> Iterator[Any]:
        active_connection = connection or getattr(self._state, "connection", None)
        owns_connection = active_connection is None
        conn = active_connection or self._connect(autocommit=autocommit)
        try:
            yield conn
        finally:
            if owns_connection and conn is not None:
                conn.close()

    def ensure_schema(self, connection=None) -> bool:
        if not self.postgres_enabled:
            return False
        if self._schema_ready:
            return True
        try:
            with self._connection_scope(connection) as conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT
                            to_regclass('public.billing_records') AS records_table,
                            to_regclass('public.billing_invoice_document_seq') AS invoice_sequence,
                            to_regclass('public.billing_receipt_document_seq') AS receipt_sequence,
                            to_regclass('public.billing_posting_events') AS events_table
                        """
                    )
                    row = cursor.fetchone() or {}
                    if not all(
                        row.get(name)
                        for name in ["records_table", "invoice_sequence", "receipt_sequence", "events_table"]
                    ):
                        raise HTTPException(status_code=503, detail="Billing financial integrity migration has not run")
            self._schema_ready = True
            return True
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Billing database schema initialization failed")
            raise HTTPException(status_code=503, detail=f"Billing database is unavailable: {exc}") from exc

    def load_records(self, force: bool = False, connection=None) -> bool:
        if not self.ensure_schema(connection):
            return False
        if self._loaded and not force:
            return True
        with self._connection_scope(connection) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT record_type, record_id, data
                    FROM billing_records
                    ORDER BY created_at DESC, record_type, record_id
                    """,
                )
                rows = cursor.fetchall()
        with self._process_lock:
            for collection in BILLING_RECORD_COLLECTIONS.values():
                collection.clear()
            for row in rows:
                collection = BILLING_RECORD_COLLECTIONS.get(row["record_type"])
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
            raise HTTPException(status_code=503, detail="Billing JSON database adapter is not installed")
        payload = dict(record)
        record_id = str(payload.get("id") or "").strip()
        if not record_id:
            raise HTTPException(status_code=500, detail="Billing record is missing an id")
        created_at = payload.get("createdAt") or now_iso()
        updated_at = payload.get("updatedAt") or created_at
        deleted_at = payload.get("deletedAt") or None
        invoice_id = payload.get("invoiceId") or (record_id if record_type == "invoice" else "")
        document_number = payload.get("invoiceNumber") if record_type == "invoice" else payload.get("receiptNumber") if record_type == "payment" else ""
        customer_payload = payload.get("customer") if isinstance(payload.get("customer"), dict) else {}
        with self._connection_scope(connection) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO billing_records (
                        record_type,
                        record_id,
                        customer_id,
                        service_account_id,
                        invoice_id,
                        status,
                        document_number,
                        subscription_id,
                        billing_cycle_start,
                        idempotency_key,
                        data,
                        created_at,
                        updated_at,
                        deleted_at,
                        created_by_user_id,
                        updated_by_user_id
                    )
                    VALUES (
                        %(record_type)s,
                        %(record_id)s,
                        %(customer_id)s,
                        %(service_account_id)s,
                        %(invoice_id)s,
                        %(status)s,
                        %(document_number)s,
                        %(subscription_id)s,
                        %(billing_cycle_start)s,
                        %(idempotency_key)s,
                        %(data)s,
                        %(created_at)s,
                        %(updated_at)s,
                        %(deleted_at)s,
                        %(created_by_user_id)s,
                        %(updated_by_user_id)s
                    )
                    ON CONFLICT (record_type, record_id) DO UPDATE SET
                        customer_id = EXCLUDED.customer_id,
                        service_account_id = EXCLUDED.service_account_id,
                        invoice_id = EXCLUDED.invoice_id,
                        status = EXCLUDED.status,
                        document_number = EXCLUDED.document_number,
                        subscription_id = EXCLUDED.subscription_id,
                        billing_cycle_start = EXCLUDED.billing_cycle_start,
                        idempotency_key = EXCLUDED.idempotency_key,
                        data = EXCLUDED.data,
                        updated_at = EXCLUDED.updated_at,
                        deleted_at = EXCLUDED.deleted_at,
                        updated_by_user_id = EXCLUDED.updated_by_user_id
                    """,
                    {
                        "record_type": record_type,
                        "record_id": record_id,
                        "customer_id": payload.get("customerId") or customer_payload.get("id") or "",
                        "service_account_id": payload.get("serviceAccountId") or "",
                        "invoice_id": invoice_id or "",
                        "status": payload.get("status") or "",
                        "document_number": document_number or "",
                        "subscription_id": payload.get("subscriptionId") or "",
                        "billing_cycle_start": payload.get("billingCycleStart") or None,
                        "idempotency_key": payload.get("idempotencyKey") or "",
                        "data": Json(payload),
                        "created_at": created_at,
                        "updated_at": updated_at,
                        "deleted_at": deleted_at,
                        "created_by_user_id": payload.get("createdByUserId") or payload.get("postedByUsername") or "",
                        "updated_by_user_id": payload.get("updatedByUserId") or "",
                    },
                )
        return True

    def save_all(self, connection=None) -> bool:
        if not self.ensure_schema(connection):
            return False
        for record_type, collection in BILLING_RECORD_COLLECTIONS.items():
            for record in collection:
                self.save_record(record_type, record, connection=connection)
        return True

    def next_document_number(self, document_type: str, prefix: str) -> str:
        if not self.postgres_enabled:
            raise RuntimeError("Database document numbers require PostgreSQL")
        sequence_name = {
            "invoice": "billing_invoice_document_seq",
            "receipt": "billing_receipt_document_seq",
        }.get(document_type)
        if sequence_name is None:
            raise HTTPException(status_code=500, detail="Unknown Billing document type")
        self.ensure_schema()
        active_connection = getattr(self._state, "connection", None)
        owns_connection = active_connection is None
        conn = active_connection or self._connect(autocommit=False)
        try:
            with conn.cursor() as cursor:
                cursor.execute(f"SELECT nextval('{sequence_name}') AS sequence_value")
                row = cursor.fetchone() or {}
            if owns_connection:
                conn.commit()
        except Exception:
            if owns_connection:
                conn.rollback()
            raise
        finally:
            if owns_connection:
                conn.close()
        sequence_value = int(row.get("sequence_value") or 0)
        return f"{prefix}-{datetime.now(timezone.utc).strftime('%Y%m')}-{sequence_value:06d}"

    def find_idempotent_record(self, record_type: str, idempotency_key: str) -> dict[str, Any] | None:
        if not idempotency_key:
            return None
        collection = BILLING_RECORD_COLLECTIONS.get(record_type, [])
        return next((record for record in collection if record.get("idempotencyKey") == idempotency_key), None)

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
    ) -> dict[str, Any]:
        event = {
            "id": str(uuid4()),
            "operationId": getattr(self._state, "operation_id", str(uuid4())),
            "action": action,
            "targetType": target_type,
            "targetId": target_id,
            "details": details or {},
            "actor": actor,
            "createdAt": now_iso(),
        }
        if self.in_transaction:
            self._state.pending_audits.append(event)
            self._state.dirty = True
        return event

    def _save_audits(self, events: list[dict[str, Any]], connection) -> None:
        if not events:
            return
        if Json is None:
            raise HTTPException(status_code=503, detail="Billing JSON database adapter is not installed")
        with connection.cursor() as cursor:
            for event in events:
                cursor.execute(
                    """
                    INSERT INTO billing_posting_events (
                        id,
                        operation_id,
                        event_type,
                        target_type,
                        target_id,
                        actor,
                        details,
                        created_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        event["id"],
                        event["operationId"],
                        event["action"],
                        event["targetType"],
                        event["targetId"],
                        event["actor"],
                        Json(event["details"]),
                        event["createdAt"],
                    ),
                )

    def _collection_snapshot(self) -> dict[str, list[dict[str, Any]]]:
        return {record_type: deepcopy(collection) for record_type, collection in BILLING_RECORD_COLLECTIONS.items()}

    def _restore_snapshot(self, snapshot: dict[str, list[dict[str, Any]]]) -> None:
        for record_type, collection in BILLING_RECORD_COLLECTIONS.items():
            collection.clear()
            collection.extend(deepcopy(snapshot.get(record_type, [])))

    def _dispatch_audits(self, events: list[dict[str, Any]]) -> None:
        if _audit_logger is None:
            return
        for event in events:
            try:
                _audit_logger(
                    event["action"],
                    event["targetType"],
                    event["targetId"],
                    event["details"],
                    event["actor"],
                )
            except Exception:
                logger.exception("Billing audit event dispatch failed after transaction commit")

    @contextmanager
    def transaction(self) -> Iterator[None]:
        if self.in_transaction:
            yield
            return

        connection = None
        committed_audits: list[dict[str, Any]] = []
        snapshot: dict[str, list[dict[str, Any]]] | None = None
        with self._process_lock:
            try:
                if self.postgres_enabled:
                    self.ensure_schema()
                    connection = self._connect(autocommit=False)
                    self._state.connection = connection
                    with connection.cursor() as cursor:
                        cursor.execute(
                            "SELECT pg_advisory_xact_lock(hashtext(%s))",
                            ("threejmain.billing.financial-posting",),
                        )
                    self.load_records(force=True, connection=connection)
                snapshot = self._collection_snapshot()
                self._state.in_transaction = True
                self._state.operation_id = str(uuid4())
                self._state.pending_audits = []
                self._state.dirty = False

                yield

                if self._state.dirty:
                    refresh_invoice_statuses_for_storage()
                    if self.postgres_enabled:
                        self.save_all(connection=connection)
                        self._save_audits(self._state.pending_audits, connection)
                if connection is not None:
                    connection.commit()
                committed_audits = list(self._state.pending_audits)
            except Exception as exc:
                if connection is not None:
                    connection.rollback()
                if snapshot is not None:
                    self._restore_snapshot(snapshot)
                if psycopg is not None and isinstance(exc, psycopg.errors.UniqueViolation):
                    raise HTTPException(status_code=409, detail="Duplicate Billing posting was prevented") from exc
                raise
            finally:
                for attribute in ["connection", "in_transaction", "operation_id", "pending_audits", "dirty"]:
                    if hasattr(self._state, attribute):
                        delattr(self._state, attribute)
                if connection is not None:
                    connection.close()
        self._dispatch_audits(committed_audits)

    @contextmanager
    def read_snapshot(self) -> Iterator[None]:
        if self.in_transaction:
            yield
            return
        current_depth = int(getattr(self._state, "read_depth", 0))
        if current_depth:
            self._state.read_depth = current_depth + 1
            try:
                yield
            finally:
                self._state.read_depth -= 1
            return
        with self._process_lock:
            self._state.read_depth = 1
            try:
                self.load_records(force=self.postgres_enabled)
                yield
            finally:
                delattr(self._state, "read_depth")

    def status(self) -> dict[str, Any]:
        if not self.postgres_enabled:
            return {
                "mode": "memory",
                "ready": False,
                "reason": "BILLING_STORAGE is not postgres",
                "demoSeedEnabled": BILLING_SEED_DEMO,
            }
        self.ensure_schema()
        with self._connection_scope() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        record_type,
                        count(*) AS total,
                        count(*) FILTER (WHERE deleted_at IS NULL) AS active
                    FROM billing_records
                    GROUP BY record_type
                    ORDER BY record_type
                    """,
                )
                rows = cursor.fetchall()
                cursor.execute(
                    """
                    SELECT 'invoice' AS document_type, CASE WHEN is_called THEN last_value ELSE 0 END AS last_value
                    FROM billing_invoice_document_seq
                    UNION ALL
                    SELECT 'receipt' AS document_type, CASE WHEN is_called THEN last_value ELSE 0 END AS last_value
                    FROM billing_receipt_document_seq
                    ORDER BY document_type
                    """
                )
                sequence_rows = cursor.fetchall()
                cursor.execute("SELECT count(*) AS total FROM billing_posting_events")
                event_row = cursor.fetchone() or {}
        return {
            "mode": "postgres",
            "ready": True,
            "table": "billing_records",
            "recordCounts": {
                row["record_type"]: {
                    "totalRows": int(row.get("total") or 0),
                    "activeRows": int(row.get("active") or 0),
                }
                for row in rows
            },
            "integrity": {
                "transactionalPosting": True,
                "immutablePostedRecords": True,
                "idempotencyEnforced": True,
                "subscriptionCycleUniqueness": True,
                "documentSequences": {row["document_type"]: int(row.get("last_value") or 0) for row in sequence_rows},
                "postingEvents": int(event_row.get("total") or 0),
            },
            "demoSeedEnabled": BILLING_SEED_DEMO,
        }


billing_store = BillingRecordStore()


def billing_mutation(function: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(function)
    def wrapped(*args, **kwargs):
        with billing_store.transaction():
            return function(*args, **kwargs)

    return wrapped


def billing_read_snapshot(function: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(function)
    def wrapped(*args, **kwargs):
        with billing_store.read_snapshot():
            return function(*args, **kwargs)

    return wrapped


def configure_billing(
    current_admin: Callable[[str | None], dict[str, Any]],
    audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None],
    customer_resolver: Callable[[str], dict[str, Any]] | None = None,
    customer_searcher: Callable[[str], list[dict[str, Any]]] | None = None,
    customer_seed: Callable[[], None] | None = None,
) -> None:
    global _current_admin, _audit_logger, _customer_resolver, _customer_searcher, _customer_seed
    _current_admin = current_admin
    _audit_logger = audit_logger
    _customer_resolver = customer_resolver
    _customer_searcher = customer_searcher
    _customer_seed = customer_seed


def require_admin(authorization: str | None = Header(default=None)):
    if _current_admin is None:
        raise HTTPException(status_code=500, detail="Billing module is not configured")
    return _current_admin(authorization)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_iso() -> str:
    return date.today().isoformat()


def add_audit(action: str, target_type: str, target_id: str, details: dict[str, Any] | None, actor: str) -> None:
    event = billing_store.queue_audit(action, target_type, target_id, details, actor)
    if not billing_store.in_transaction and _audit_logger is not None:
        _audit_logger(action, target_type, target_id, event["details"], actor)


def normalize_upper(value: Any) -> str:
    return str(value or "").strip().upper()


def admin_display_name(admin: dict[str, Any]) -> str:
    display_name = str(
        admin.get("fullName")
        or admin.get("full_name")
        or admin.get("name")
        or admin.get("username")
        or "Billing user"
    ).strip()
    return display_name or "Billing user"


def money(value: Any) -> float:
    return round(float(value or 0), 2)


def round_up_to_peso(value: Any) -> float:
    return float(ceil(float(value or 0)))


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def clean_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def ensure_billing_data_loaded(force: bool = False) -> None:
    force_refresh = force or (
        billing_store.postgres_enabled
        and not billing_store.in_transaction
        and not billing_store.in_read_snapshot
    )
    billing_store.load_records(force=force_refresh)


def refresh_invoice_statuses_for_storage() -> None:
    for invoice in invoices:
        if not invoice.get("deletedAt"):
            invoice_summary(invoice)


def persist_billing_state() -> None:
    refresh_invoice_statuses_for_storage()
    if billing_store.in_transaction:
        billing_store.mark_dirty()
        return
    if billing_store.postgres_enabled:
        raise RuntimeError("PostgreSQL Billing writes must run inside billing_store.transaction()")
    billing_store.save_all()


def parse_day(value: str | None, field_name: str) -> date:
    try:
        return date.fromisoformat(value or today_iso())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{field_name} must be YYYY-MM-DD") from exc


def add_months(source: date, months: int = 1) -> date:
    month = source.month - 1 + months
    year = source.year + month // 12
    month = month % 12 + 1
    month_lengths = [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    return date(year, month, min(source.day, month_lengths[month - 1]))


def month_start(source: date) -> date:
    return date(source.year, source.month, 1)


def month_end(source: date) -> date:
    return add_months(month_start(source), 1) - timedelta(days=1)


def next_month_start(source: date) -> date:
    return month_end(source) + timedelta(days=1)


def inclusive_days(start: date, end: date) -> int:
    return (end - start).days + 1


def customer_name(customer: dict[str, Any]) -> str:
    parts = [customer.get("firstName"), customer.get("middleName"), customer.get("lastName")]
    return " ".join(str(part).strip() for part in parts if str(part or "").strip()) or customer.get("name") or "Unnamed customer"


def customer_snapshot(customer: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": customer["id"],
        "accountNumber": customer.get("accountNumber", ""),
        "firstName": customer.get("firstName", ""),
        "lastName": customer.get("lastName", ""),
        "name": customer_name(customer),
        "status": customer.get("status", ""),
        "gender": customer.get("gender", ""),
        "contactNumber": customer.get("contactNumber", ""),
        "address": ", ".join(
            part
            for part in [
                customer.get("addressLine1"),
                customer.get("barangay"),
                customer.get("city"),
                customer.get("province"),
            ]
            if part
        ),
    }


def seed_customers() -> None:
    if _customer_seed is not None:
        _customer_seed()


def resolve_customer(customer_id: str) -> dict[str, Any]:
    seed_customers()
    if not customer_id:
        raise HTTPException(status_code=400, detail="customerId is required")
    if _customer_resolver is None:
        raise HTTPException(status_code=400, detail="Customer Profiling provider is not available")
    return customer_snapshot(_customer_resolver(customer_id))


def search_customers(search: str = "") -> list[dict[str, Any]]:
    seed_customers()
    if _customer_searcher is None:
        return []
    return [customer_snapshot(customer) for customer in _customer_searcher(search)]


def visible_subscriptions() -> list[dict[str, Any]]:
    ensure_billing_data_loaded()
    return [subscription for subscription in subscriptions if not subscription.get("deletedAt")]


def visible_invoices() -> list[dict[str, Any]]:
    ensure_billing_data_loaded()
    return [invoice for invoice in invoices if not invoice.get("deletedAt")]


def visible_payments() -> list[dict[str, Any]]:
    ensure_billing_data_loaded()
    return [payment for payment in payments if not payment.get("deletedAt")]


def visible_adjustments() -> list[dict[str, Any]]:
    ensure_billing_data_loaded()
    return [adjustment for adjustment in adjustments if not adjustment.get("deletedAt")]


def visible_installation_charges() -> list[dict[str, Any]]:
    ensure_billing_data_loaded()
    return [charge for charge in installation_charges if not charge.get("deletedAt")]


def visible_promotions() -> list[dict[str, Any]]:
    ensure_billing_data_loaded()
    return [promotion for promotion in promotions if not promotion.get("deletedAt")]


def find_row(rows: list[dict[str, Any]], row_id: str, label: str) -> dict[str, Any]:
    ensure_billing_data_loaded()
    for row in rows:
        if row["id"] == row_id and not row.get("deletedAt"):
            return row
    raise HTTPException(status_code=404, detail=f"{label} not found")


def find_subscription(subscription_id: str) -> dict[str, Any]:
    return find_row(subscriptions, subscription_id, "Subscription")


def find_invoice(invoice_id: str) -> dict[str, Any]:
    return find_row(invoices, invoice_id, "Invoice")


def find_payment(payment_id: str) -> dict[str, Any]:
    return find_row(payments, payment_id, "Payment")


def find_adjustment(adjustment_id: str) -> dict[str, Any]:
    return find_row(adjustments, adjustment_id, "Adjustment")


def find_installation_charge(charge_id: str) -> dict[str, Any]:
    return find_row(installation_charges, charge_id, "Installation charge")


def find_promotion(promotion_id: str) -> dict[str, Any]:
    return find_row(promotions, promotion_id, "Promotion")


def next_number(prefix: str, rows: list[dict[str, Any]], field_name: str) -> str:
    ensure_billing_data_loaded()
    if billing_store.postgres_enabled:
        document_type = {"INV": "invoice", "OR": "receipt"}.get(prefix)
        if document_type is None:
            raise HTTPException(status_code=500, detail="Unknown Billing document prefix")
        return billing_store.next_document_number(document_type, prefix)
    sequence_value = 0
    for row in rows:
        suffix = str(row.get(field_name) or "").rsplit("-", 1)[-1]
        if suffix.isdigit():
            sequence_value = max(sequence_value, int(suffix))
    return f"{prefix}-{datetime.now(timezone.utc).strftime('%Y%m')}-{sequence_value + 1:06d}"


def normalize_idempotency_key(value: Any, *, required: bool = True) -> str:
    key = clean_text(value)
    if required and not key:
        raise HTTPException(status_code=400, detail="Idempotency-Key header is required")
    if len(key) > 128:
        raise HTTPException(status_code=400, detail="Idempotency-Key header cannot exceed 128 characters")
    return key


def posting_fingerprint(record_type: str, payload: BaseModel | dict[str, Any]) -> str:
    payload_data = payload.model_dump(exclude_unset=True) if isinstance(payload, BaseModel) else payload
    serialized = json.dumps(
        {"recordType": record_type, "payload": payload_data},
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def idempotent_replay(record_type: str, idempotency_key: str, fingerprint: str) -> dict[str, Any] | None:
    existing = billing_store.find_idempotent_record(record_type, idempotency_key)
    if existing is None:
        return None
    if existing.get("idempotencyFingerprint") != fingerprint:
        raise HTTPException(status_code=409, detail="Idempotency-Key was already used with a different request")
    return {**existing, "idempotentReplay": True}


def normalize_promo_code(value: Any) -> str:
    return clean_text(value).upper().replace(" ", "-")


def next_promo_code(current_promotion_id: str | None = None) -> str:
    today_prefix = datetime.now(timezone.utc).strftime("%Y%m")
    existing = {
        normalize_promo_code(promotion.get("promoCode"))
        for promotion in visible_promotions()
        if promotion.get("id") != current_promotion_id
    }
    next_index = len(existing) + 1
    while True:
        candidate = f"PROMO-{today_prefix}-{next_index:04d}"
        if candidate not in existing:
            return candidate
        next_index += 1


def promotion_effective_status(promotion: dict[str, Any], as_of: date | None = None) -> str:
    status = normalize_upper(promotion.get("status") or "DRAFT")
    if status != "ACTIVE":
        return status
    as_of_day = as_of or date.today()
    start_day = parse_day(promotion.get("startDate"), "startDate")
    end_value = promotion.get("endDate") or ""
    end_day = parse_day(end_value, "endDate") if end_value else None
    if start_day > as_of_day:
        return "SCHEDULED"
    if end_day and end_day < as_of_day:
        return "EXPIRED"
    return "ACTIVE"


def promotion_is_active(promotion: dict[str, Any], as_of: date | None = None) -> bool:
    return promotion_effective_status(promotion, as_of) == "ACTIVE"


def promotion_discount_amount(promotion: dict[str, Any], base_amount: float) -> float:
    discount_type = normalize_upper(promotion.get("discountType"))
    if discount_type == "WAIVE":
        return money(base_amount)
    if discount_type == "PERCENT":
        return money(base_amount * money(promotion.get("discountPercent")) / 100)
    return money(min(base_amount, money(promotion.get("discountAmount"))))


def promotion_payment_rule(promotion: dict[str, Any]) -> str:
    rule = normalize_upper(promotion.get("paymentRule") or promotion.get("paymentTimingRule") or "ANY_PAYMENT")
    return rule if rule in PROMOTION_PAYMENT_RULES else "ANY_PAYMENT"


def promotion_priority(promotion: dict[str, Any]) -> int:
    try:
        return int(promotion.get("priority") or 0)
    except (TypeError, ValueError):
        return 0


def promotion_summary(promotion: dict[str, Any]) -> dict[str, Any]:
    effective_status = promotion_effective_status(promotion)
    return {
        **promotion,
        "paymentRule": promotion_payment_rule(promotion),
        "priority": promotion_priority(promotion),
        "effectiveStatus": effective_status,
        "activeNow": effective_status == "ACTIVE",
    }


def ensure_unique_promo_code(promo_code: str, current_promotion_id: str | None = None) -> None:
    for promotion in visible_promotions():
        if promotion.get("id") == current_promotion_id:
            continue
        if normalize_promo_code(promotion.get("promoCode")) == promo_code:
            raise HTTPException(status_code=409, detail="Promotion code already exists")


def normalize_promotion_payload(payload: PromotionPayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    record = dict(current or {})
    clearable_fields = {"description", "endDate", "billingMode", "customerId", "catalogId", "notes", "paymentRule", "priority"}
    record.update({key: value for key, value in data.items() if value is not None or key in clearable_fields})
    record["name"] = clean_text(record.get("name"))
    provided_promo_code = normalize_promo_code(record.get("promoCode"))
    record["promoCode"] = provided_promo_code or next_promo_code(record.get("id"))
    record["promoCodeAutoGenerated"] = not provided_promo_code
    record["description"] = clean_text(record.get("description"))
    record["appliesTo"] = normalize_upper(record.get("appliesTo") or "MONTHLY_SERVICE")
    record["discountType"] = normalize_upper(record.get("discountType") or "FIXED_AMOUNT")
    record["status"] = normalize_upper(record.get("status") or "ACTIVE")
    record["billingMode"] = normalize_upper(record.get("billingMode") or "")
    record["customerId"] = clean_text(record.get("customerId"))
    record["catalogId"] = clean_text(record.get("catalogId"))
    record["paymentRule"] = normalize_upper(record.get("paymentRule") or "ANY_PAYMENT") if record["appliesTo"] == "MONTHLY_SERVICE" else "ANY_PAYMENT"
    record["priority"] = promotion_priority(record)
    record["notes"] = clean_text(record.get("notes"))
    missing = [field for field in ["name", "startDate"] if record.get(field) in [None, ""]]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required promotion fields: {', '.join(missing)}")
    if record["appliesTo"] not in PROMOTION_SCOPES:
        raise HTTPException(status_code=400, detail="Invalid promotion scope")
    if record["discountType"] not in PROMOTION_DISCOUNT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid promotion discount type")
    if record["status"] not in PROMOTION_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid promotion status")
    if record["paymentRule"] not in PROMOTION_PAYMENT_RULES:
        raise HTTPException(status_code=400, detail="Invalid promotion payment rule")
    if record["billingMode"] and record["billingMode"] not in BILLING_MODES:
        raise HTTPException(status_code=400, detail="Invalid promotion billing mode target")
    record["discountAmount"] = money(record.get("discountAmount"))
    record["discountPercent"] = money(record.get("discountPercent"))
    if record["discountType"] == "FIXED_AMOUNT" and record["discountAmount"] <= 0:
        raise HTTPException(status_code=400, detail="Fixed amount promotions require a discount amount")
    if record["discountType"] == "PERCENT" and not 0 < record["discountPercent"] <= 100:
        raise HTTPException(status_code=400, detail="Percent promotions require a discount percent from 1 to 100")
    if record["discountType"] == "WAIVE":
        record["discountAmount"] = 0
        record["discountPercent"] = 100
    start_day = parse_day(record.get("startDate"), "startDate")
    record["startDate"] = start_day.isoformat()
    if record.get("endDate"):
        end_day = parse_day(record.get("endDate"), "endDate")
        if end_day < start_day:
            raise HTTPException(status_code=400, detail="Promotion end date cannot be before start date")
        record["endDate"] = end_day.isoformat()
    else:
        record["endDate"] = ""
    record["requiresApproval"] = clean_bool(record.get("requiresApproval"))
    record["stackable"] = clean_bool(record.get("stackable"))
    ensure_unique_promo_code(record["promoCode"], record.get("id"))
    return record


def validate_promotion_for_subscription(promotion: dict[str, Any], subscription: dict[str, Any]) -> None:
    if promotion.get("appliesTo") != "MONTHLY_SERVICE":
        raise HTTPException(status_code=400, detail="Promotion is not valid for monthly service billing")
    if promotion_payment_rule(promotion) != "EARLY_BIRD":
        raise HTTPException(status_code=400, detail="Subscription promotion qualification requires an Early Bird payment condition")
    if not promotion_is_active(promotion):
        raise HTTPException(status_code=400, detail="Promotion is not currently active")
    if clean_bool(promotion.get("requiresApproval")):
        raise HTTPException(status_code=400, detail="Approval-required promotions cannot be selected for automatic subscription discounts yet")
    if promotion.get("billingMode") and promotion.get("billingMode") != subscription.get("billingMode"):
        raise HTTPException(status_code=400, detail="Promotion is not valid for this billing mode")
    if promotion.get("customerId") and promotion.get("customerId") != subscription.get("customerId"):
        raise HTTPException(status_code=400, detail="Promotion is not valid for this customer")
    if promotion.get("catalogId") and promotion.get("catalogId") != subscription.get("catalogId"):
        raise HTTPException(status_code=400, detail="Promotion is not valid for this plan")


def validate_promotion_for_installation_charge(promotion: dict[str, Any], charge: dict[str, Any]) -> None:
    if promotion.get("appliesTo") != "INSTALLATION_FEE":
        raise HTTPException(status_code=400, detail="Promotion is not valid for installation fees")
    if not promotion_is_active(promotion):
        raise HTTPException(status_code=400, detail="Promotion is not currently active")
    if promotion.get("customerId") and promotion.get("customerId") != charge.get("customerId"):
        raise HTTPException(status_code=400, detail="Promotion is not valid for this customer")
    if promotion.get("catalogId") and promotion.get("catalogId") != charge.get("catalogId"):
        raise HTTPException(status_code=400, detail="Promotion is not valid for this plan")
    if promotion.get("billingMode") and promotion.get("billingMode") != charge.get("billingMode"):
        raise HTTPException(status_code=400, detail="Promotion is not valid for this billing mode")


def normalize_subscription_payload(payload: SubscriptionPayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    record = dict(current or {})
    clearable_fields = {
        "priceOverrideAmount",
        "priceOverrideReason",
        "pricingSource",
        "serviceOrderId",
        "earlyBirdPromotionId",
        "earlyBirdPromotionCode",
        "earlyBirdPromotionName",
    }
    record.update({key: value for key, value in data.items() if value is not None or key in clearable_fields})
    required = ["customerId", "planName", "billingMode", "startDate"]
    missing = [field for field in required if record.get(field) in [None, ""]]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required subscription fields: {', '.join(missing)}")
    record["billingMode"] = normalize_upper(record.get("billingMode"))
    record["status"] = normalize_upper(record.get("status") or "ACTIVE")
    if record["billingMode"] not in BILLING_MODES:
        raise HTTPException(status_code=400, detail="Invalid billing mode")
    if record["status"] not in SUBSCRIPTION_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid subscription status")
    record["serviceAccountId"] = clean_text(record.get("serviceAccountId"))
    record["serviceAccountNumber"] = clean_text(record.get("serviceAccountNumber"))
    record["serviceOrderId"] = clean_text(record.get("serviceOrderId"))
    record["catalogId"] = clean_text(record.get("catalogId"))
    record["catalogCode"] = clean_text(record.get("catalogCode"))
    record["catalogName"] = clean_text(record.get("catalogName"))
    record["serviceId"] = clean_text(record.get("serviceId"))
    record["notes"] = clean_text(record.get("notes"))
    record["planName"] = clean_text(record.get("catalogName") or record.get("planName"))
    if record.get("monthlyRate") in [None, ""] and record.get("listMonthlyRate") in [None, ""]:
        raise HTTPException(status_code=400, detail="monthlyRate or listMonthlyRate is required")
    record["listMonthlyRate"] = money(record.get("listMonthlyRate") if record.get("listMonthlyRate") is not None else record.get("monthlyRate"))
    override_amount = record.get("priceOverrideAmount")
    override_reason = clean_text(record.get("priceOverrideReason"))
    linked_to_service = bool(record["serviceAccountId"])
    if linked_to_service:
        if not record["catalogId"]:
            raise HTTPException(status_code=400, detail="catalogId is required for Service Account billing")
        if not record["serviceId"]:
            raise HTTPException(status_code=400, detail="serviceId is required for Service Account billing")
        has_override = override_amount is not None and money(override_amount) != record["listMonthlyRate"]
        if has_override:
            if not override_reason:
                raise HTTPException(status_code=400, detail="priceOverrideReason is required when overriding catalog price")
            record["priceOverrideAmount"] = money(override_amount)
            record["monthlyRate"] = record["priceOverrideAmount"]
            record["pricingSource"] = "PRICE_OVERRIDE"
        else:
            record["priceOverrideAmount"] = None
            record["priceOverrideReason"] = ""
            record["monthlyRate"] = record["listMonthlyRate"]
            record["pricingSource"] = "SERVICE_CATALOG"
    else:
        record["monthlyRate"] = money(record["monthlyRate"])
        record["listMonthlyRate"] = record["monthlyRate"]
        record["priceOverrideAmount"] = None
        record["priceOverrideReason"] = ""
        record["pricingSource"] = "MANUAL"
    if record["pricingSource"] not in PRICING_SOURCES:
        raise HTTPException(status_code=400, detail="Invalid pricing source")
    record["priceOverrideReason"] = override_reason if record["pricingSource"] == "PRICE_OVERRIDE" else ""
    record["billingDay"] = int(record.get("billingDay") or min(parse_day(record["startDate"], "startDate").day, 28))
    record["dueDays"] = int(record.get("dueDays") if record.get("dueDays") is not None else 0)
    record["earlyBirdEligible"] = clean_bool(record.get("earlyBirdEligible")) if record["billingMode"] in BILLING_MODES else False
    record["earlyBirdPromotionId"] = clean_text(record.get("earlyBirdPromotionId"))
    record["earlyBirdPromotionCode"] = clean_text(record.get("earlyBirdPromotionCode"))
    record["earlyBirdPromotionName"] = clean_text(record.get("earlyBirdPromotionName"))
    if record["earlyBirdEligible"]:
        if not record["earlyBirdPromotionId"]:
            raise HTTPException(status_code=400, detail="Select a promotion before qualifying this subscription")
        promotion = find_promotion(record["earlyBirdPromotionId"])
        validate_promotion_for_subscription(promotion, record)
        record["earlyBirdPromotionCode"] = promotion["promoCode"]
        record["earlyBirdPromotionName"] = promotion["name"]
        record["earlyBirdDiscountAmount"] = promotion_discount_amount(promotion, record["monthlyRate"])
    else:
        record["earlyBirdPromotionId"] = ""
        record["earlyBirdPromotionCode"] = ""
        record["earlyBirdPromotionName"] = ""
        record["earlyBirdDiscountAmount"] = 0
    record["startDate"] = parse_day(record.get("startDate"), "startDate").isoformat()
    record["nextInvoiceDate"] = parse_day(record.get("nextInvoiceDate") or record["startDate"], "nextInvoiceDate").isoformat()
    record["billingCycleAnchor"] = "CALENDAR_MONTH"
    return record


def ensure_service_target_available(record: dict[str, Any], current_subscription_id: str | None = None) -> None:
    service_account_id = record.get("serviceAccountId", "")
    service_order_id = record.get("serviceOrderId", "")
    if not service_account_id and not service_order_id:
        return
    for subscription in visible_subscriptions():
        if subscription["id"] == current_subscription_id:
            continue
        if subscription.get("status") == "CANCELLED":
            continue
        if service_account_id and subscription.get("serviceAccountId") == service_account_id:
            raise HTTPException(status_code=409, detail="Service Account is already linked to an active Billing subscription")
        if service_order_id and subscription.get("serviceOrderId") == service_order_id:
            raise HTTPException(status_code=409, detail="Service Order is already linked to an active Billing subscription")


def installation_charge_for_service_account(service_account_id: str) -> dict[str, Any] | None:
    if not service_account_id:
        return None
    for charge in visible_installation_charges():
        if charge.get("serviceAccountId") == service_account_id and charge.get("status") != "VOID":
            return charge
    return None


def ensure_installation_fee_resolved(record: dict[str, Any], current_subscription: dict[str, Any] | None = None) -> None:
    service_account_id = record.get("serviceAccountId", "")
    if not service_account_id:
        return
    if current_subscription and current_subscription.get("serviceAccountId") == service_account_id:
        return
    charge = installation_charge_for_service_account(service_account_id)
    if not charge or charge.get("status") not in ["INVOICED", "WAIVED", "NO_FEE"]:
        raise HTTPException(status_code=400, detail="Resolve the installation fee before starting monthly billing for this Service Account")


def normalize_installation_charge_payload(payload: InstallationChargePayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    record = dict(current or {})
    record.update({key: value for key, value in data.items() if value is not None})
    required = ["customerId", "serviceAccountId"]
    missing = [field for field in required if record.get(field) in [None, ""]]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required installation charge fields: {', '.join(missing)}")

    status = normalize_upper(record.get("status") or "INVOICED")
    if status not in INSTALLATION_CHARGE_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid installation charge status")

    for field_name in [
        "serviceAccountId",
        "serviceAccountNumber",
        "serviceOrderId",
        "serviceId",
        "catalogId",
        "catalogCode",
        "catalogName",
        "billingMode",
        "promoCode",
        "promotionId",
        "promotionCode",
        "promotionName",
        "notes",
    ]:
        record[field_name] = clean_text(record.get(field_name))
    record["billingMode"] = normalize_upper(record.get("billingMode") or "")
    if record["billingMode"] and record["billingMode"] not in BILLING_MODES:
        raise HTTPException(status_code=400, detail="Invalid installation fee billing mode")

    standard_amount = money(record.get("standardAmount"))
    charged_amount = money(record.get("chargedAmount"))
    waiver_reason = clean_text(record.get("waiverReason"))

    if status == "NO_FEE":
        record["promotionId"] = ""
        record["promotionCode"] = ""
        record["promotionName"] = ""
        record["promoCode"] = ""
    elif record["promotionId"]:
        if standard_amount <= 0:
            standard_amount = charged_amount
        if standard_amount <= 0:
            raise HTTPException(status_code=400, detail="standardAmount is required before applying an installation fee promotion")
        promotion = find_promotion(record["promotionId"])
        validate_promotion_for_installation_charge(promotion, record)
        discount_amount = promotion_discount_amount(promotion, standard_amount)
        charged_amount = money(max(0, standard_amount - discount_amount))
        waiver_reason = waiver_reason or f"Promotion {promotion['promoCode']} - {promotion['name']}"
        record["promoCode"] = promotion["promoCode"]
        record["promotionCode"] = promotion["promoCode"]
        record["promotionName"] = promotion["name"]
        status = "WAIVED" if charged_amount <= 0 else "INVOICED"
    elif not record["promotionCode"]:
        record["promotionName"] = ""

    if status == "INVOICED":
        if charged_amount <= 0:
            raise HTTPException(status_code=400, detail="chargedAmount must be greater than zero when charging an installation fee")
        if standard_amount <= 0:
            standard_amount = charged_amount
        if charged_amount > standard_amount:
            standard_amount = charged_amount
        waived_amount = money(max(0, standard_amount - charged_amount))
        if waived_amount > 0 and not waiver_reason:
            raise HTTPException(status_code=400, detail="waiverReason is required when the charged amount is below the standard fee")
    elif status == "WAIVED":
        if standard_amount <= 0:
            raise HTTPException(status_code=400, detail="standardAmount must be greater than zero when waiving an installation fee")
        charged_amount = 0
        waived_amount = standard_amount
        if not waiver_reason:
            raise HTTPException(status_code=400, detail="waiverReason is required when waiving an installation fee")
    elif status == "NO_FEE":
        standard_amount = 0
        charged_amount = 0
        waived_amount = 0
        waiver_reason = waiver_reason or "No installation fee required"
    else:
        waived_amount = money(max(0, standard_amount - charged_amount))

    record["standardAmount"] = standard_amount
    record["chargedAmount"] = charged_amount
    record["waivedAmount"] = money(waived_amount)
    record["waiverReason"] = waiver_reason
    record["status"] = status
    record["issueDate"] = parse_day(record.get("issueDate"), "issueDate").isoformat()
    record["dueDate"] = parse_day(record.get("dueDate") or record["issueDate"], "dueDate").isoformat()
    return record


def installation_invoice_line(charge: dict[str, Any]) -> dict[str, Any]:
    return {
        "description": "Installation Fee",
        "quantity": 1,
        "unitPrice": charge["chargedAmount"],
        "amount": charge["chargedAmount"],
        "serviceAccountId": charge.get("serviceAccountId", ""),
        "serviceOrderId": charge.get("serviceOrderId", ""),
        "serviceId": charge.get("serviceId", ""),
        "catalogId": charge.get("catalogId", ""),
        "catalogCode": charge.get("catalogCode", ""),
        "catalogName": charge.get("catalogName", ""),
        "listMonthlyRate": 0,
        "pricingSource": "INSTALLATION_FEE",
        "priceOverrideAmount": None,
        "priceOverrideReason": charge.get("waiverReason", ""),
        "promotionId": charge.get("promotionId", ""),
        "promotionCode": charge.get("promotionCode") or charge.get("promoCode", ""),
        "promotionName": charge.get("promotionName", ""),
    }


def sync_installation_charge_invoice(charge: dict[str, Any]) -> dict[str, Any] | None:
    if charge.get("status") != "INVOICED":
        return None
    timestamp = now_iso()
    if charge.get("invoiceId"):
        invoice = find_invoice(charge["invoiceId"])
        if invoice.get("status") != "DRAFT":
            raise HTTPException(status_code=409, detail="Issued installation fee invoices are immutable; void and recreate the fee decision")
        if invoice_payments(invoice["id"]):
            raise HTTPException(status_code=400, detail="Installation fee invoice already has payments and cannot be edited")
        invoice.update(
            {
                "customerId": charge["customerId"],
                "customer": charge["customer"],
                "serviceAccountId": charge.get("serviceAccountId", ""),
                "serviceAccountNumber": charge.get("serviceAccountNumber", ""),
                "serviceOrderId": charge.get("serviceOrderId", ""),
                "serviceId": charge.get("serviceId", ""),
                "catalogId": charge.get("catalogId", ""),
                "catalogCode": charge.get("catalogCode", ""),
                "catalogName": charge.get("catalogName", ""),
                "billingMode": "ONE_TIME",
                "promotionId": charge.get("promotionId", ""),
                "promotionCode": charge.get("promotionCode") or charge.get("promoCode", ""),
                "promotionName": charge.get("promotionName", ""),
                "invoiceType": "INSTALLATION_FEE",
                "billingCycleStart": charge["issueDate"],
                "billingCycleEnd": charge["issueDate"],
                "issueDate": charge["issueDate"],
                "dueDate": charge["dueDate"],
                "lineItems": [installation_invoice_line(charge)],
                "notes": charge.get("notes") or "One-time installation fee.",
                "updatedAt": timestamp,
            }
        )
        return invoice_summary(invoice)

    invoice = {
        "id": str(uuid4()),
        "invoiceNumber": next_number("INV", invoices, "invoiceNumber"),
        "idempotencyKey": f"installation-charge:{charge['id']}",
        "idempotencyFingerprint": posting_fingerprint(
            "invoice",
            {"source": "INSTALLATION_CHARGE", "installationChargeId": charge["id"]},
        ),
        "customerId": charge["customerId"],
        "customer": charge["customer"],
        "subscriptionId": None,
        "serviceAccountId": charge.get("serviceAccountId", ""),
        "serviceAccountNumber": charge.get("serviceAccountNumber", ""),
        "serviceOrderId": charge.get("serviceOrderId", ""),
        "serviceId": charge.get("serviceId", ""),
        "catalogId": charge.get("catalogId", ""),
        "catalogCode": charge.get("catalogCode", ""),
        "catalogName": charge.get("catalogName", ""),
        "listMonthlyRate": None,
        "pricingSource": "INSTALLATION_FEE",
        "priceOverrideAmount": None,
        "priceOverrideReason": charge.get("waiverReason", ""),
        "promotionId": charge.get("promotionId", ""),
        "promotionCode": charge.get("promotionCode") or charge.get("promoCode", ""),
        "promotionName": charge.get("promotionName", ""),
        "billingMode": "ONE_TIME",
        "invoiceType": "INSTALLATION_FEE",
        "billingCycleStart": charge["issueDate"],
        "billingCycleEnd": charge["issueDate"],
        "issueDate": charge["issueDate"],
        "dueDate": charge["dueDate"],
        "status": "ISSUED",
        "lineItems": [installation_invoice_line(charge)],
        "notes": charge.get("notes") or "One-time installation fee.",
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
    }
    invoices.append(invoice)
    charge["invoiceId"] = invoice["id"]
    charge["invoiceNumber"] = invoice["invoiceNumber"]
    return invoice_summary(invoice)


def installation_charge_summary(charge: dict[str, Any]) -> dict[str, Any]:
    summary = dict(charge)
    if charge.get("invoiceId"):
        try:
            invoice = invoice_summary(find_invoice(charge["invoiceId"]))
            summary["invoice"] = invoice
            summary["invoiceNumber"] = invoice["invoiceNumber"]
            summary["invoiceStatus"] = invoice["status"]
            summary["invoiceBalance"] = invoice["balance"]
        except HTTPException:
            summary["invoice"] = None
    return summary


def line_amount(item: dict[str, Any]) -> float:
    quantity = money(item.get("quantity", 1) or 1)
    unit_price = money(item.get("unitPrice", item.get("amount", 0)))
    return money(quantity * unit_price)


def subscription_line_item(
    subscription: dict[str, Any],
    description: str | None = None,
    amount: float | None = None,
    item_type: str = "MONTHLY_SERVICE",
    proration: dict[str, Any] | None = None,
) -> dict[str, Any]:
    service_ref = subscription.get("serviceId")
    line_description = description or f"{subscription['planName']} monthly internet service"
    if service_ref and not description:
        line_description = f"{line_description} ({service_ref})"
    item = {
        "description": line_description,
        "quantity": 1,
        "unitPrice": money(amount if amount is not None else subscription["monthlyRate"]),
        "serviceAccountId": subscription.get("serviceAccountId", ""),
        "serviceOrderId": subscription.get("serviceOrderId", ""),
        "serviceId": service_ref or "",
        "catalogId": subscription.get("catalogId", ""),
        "catalogCode": subscription.get("catalogCode", ""),
        "catalogName": subscription.get("catalogName", ""),
        "listMonthlyRate": subscription.get("listMonthlyRate", subscription["monthlyRate"]),
        "pricingSource": subscription.get("pricingSource", "MANUAL"),
        "priceOverrideAmount": subscription.get("priceOverrideAmount"),
        "priceOverrideReason": subscription.get("priceOverrideReason", ""),
        "billingItemType": item_type,
    }
    item["amount"] = line_amount(item)
    if proration:
        item["proration"] = proration
    return item


def normalize_line_items(items: list[dict[str, Any]] | None, subscription: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    if not items and subscription is not None:
        items = [subscription_line_item(subscription)]
    normalized = []
    for item in items or []:
        description = str(item.get("description") or "Billing item").strip()
        quantity = money(item.get("quantity", 1) or 1)
        unit_price = money(item.get("unitPrice", item.get("amount", 0)))
        normalized_item = {
            "description": description,
            "quantity": quantity,
            "unitPrice": unit_price,
            "amount": money(quantity * unit_price),
            "serviceAccountId": item.get("serviceAccountId") or (subscription.get("serviceAccountId", "") if subscription else ""),
            "serviceOrderId": item.get("serviceOrderId") or (subscription.get("serviceOrderId", "") if subscription else ""),
            "serviceId": item.get("serviceId") or (subscription.get("serviceId", "") if subscription else ""),
            "catalogId": item.get("catalogId") or (subscription.get("catalogId", "") if subscription else ""),
            "catalogCode": item.get("catalogCode") or (subscription.get("catalogCode", "") if subscription else ""),
            "catalogName": item.get("catalogName") or (subscription.get("catalogName", "") if subscription else ""),
            "listMonthlyRate": money(item.get("listMonthlyRate") or (subscription.get("listMonthlyRate", unit_price) if subscription else unit_price)),
            "pricingSource": item.get("pricingSource") or (subscription.get("pricingSource", "MANUAL") if subscription else "MANUAL"),
            "priceOverrideAmount": item.get("priceOverrideAmount") or (subscription.get("priceOverrideAmount") if subscription else None),
            "priceOverrideReason": item.get("priceOverrideReason") or (subscription.get("priceOverrideReason", "") if subscription else ""),
            "billingItemType": item.get("billingItemType") or "MANUAL",
        }
        if item.get("proration"):
            normalized_item["proration"] = item["proration"]
        normalized.append(normalized_item)
    if not normalized:
        raise HTTPException(status_code=400, detail="At least one invoice line item is required")
    return normalized


def invoice_adjustments(invoice_id: str) -> list[dict[str, Any]]:
    return [adjustment for adjustment in visible_adjustments() if adjustment.get("invoiceId") == invoice_id and adjustment["status"] == "POSTED"]


def invoice_payments(invoice_id: str) -> list[dict[str, Any]]:
    return [payment for payment in visible_payments() if payment.get("invoiceId") == invoice_id and payment["status"] == "POSTED"]


def early_bird_discount_adjustment(invoice_id: str) -> dict[str, Any] | None:
    for adjustment in invoice_adjustments(invoice_id):
        if adjustment.get("adjustmentSource") == "EARLY_BIRD_DISCOUNT":
            return adjustment
    return None


def invoice_early_bird_details(invoice: dict[str, Any], amounts: dict[str, float]) -> dict[str, Any]:
    eligible = clean_bool(invoice.get("earlyBirdEligible")) and invoice.get("billingMode") in BILLING_MODES and invoice.get("invoiceType") == "MONTHLY"
    discount_amount = money(invoice.get("earlyBirdDiscountAmount"))
    cutoff_date = invoice.get("earlyBirdCutoffDate") or invoice.get("billingCycleStart") or ""
    cutoff_day = parse_day(cutoff_date, "earlyBirdCutoffDate") if cutoff_date else None
    available_until = (cutoff_day - timedelta(days=1)).isoformat() if cutoff_day else ""
    applied_adjustment = early_bird_discount_adjustment(invoice["id"]) if eligible else None
    applied_amount = money(applied_adjustment["amount"]) if applied_adjustment else 0
    max_discount = money(min(discount_amount, amounts["balance"]))
    today_day = date.today()
    available_now = bool(eligible and not applied_adjustment and cutoff_day and today_day < cutoff_day and max_discount > 0)
    payable_balance = money(max(0, amounts["balance"] - max_discount)) if available_now else amounts["balance"]
    return {
        "earlyBirdEligible": eligible,
        "earlyBirdDiscountAmount": discount_amount if eligible else 0,
        "earlyBirdCutoffDate": cutoff_day.isoformat() if cutoff_day else "",
        "earlyBirdAvailableUntil": available_until,
        "earlyBirdDiscountApplied": bool(applied_adjustment),
        "earlyBirdDiscountAppliedAmount": applied_amount,
        "earlyBirdDiscountAdjustmentId": applied_adjustment["id"] if applied_adjustment else "",
        "earlyBirdAvailableNow": available_now,
        "earlyBirdPayableBalance": payable_balance,
    }


def invoice_amounts(invoice: dict[str, Any]) -> dict[str, float]:
    subtotal = money(sum(item.get("amount", line_amount(item)) for item in invoice.get("lineItems", [])))
    adjustment_total = money(
        sum(
            adjustment["amount"] if adjustment["type"] == "DEBIT" else -adjustment["amount"]
            for adjustment in invoice_adjustments(invoice["id"])
        )
    )
    total = money(max(0, subtotal + adjustment_total))
    paid = money(sum(payment["amount"] for payment in invoice_payments(invoice["id"])))
    balance = money(max(0, total - paid))
    return {"subtotal": subtotal, "adjustmentsTotal": adjustment_total, "total": total, "paidTotal": paid, "balance": balance}


def derived_invoice_status(invoice: dict[str, Any], amounts: dict[str, float] | None = None) -> str:
    if invoice.get("status") == "VOID":
        return "VOID"
    if invoice.get("status") == "DRAFT":
        return "DRAFT"
    amounts = amounts or invoice_amounts(invoice)
    if amounts["balance"] <= 0:
        return "PAID"
    if amounts["paidTotal"] > 0:
        return "PARTIALLY_PAID"
    due = parse_day(invoice.get("dueDate"), "dueDate")
    if due < date.today():
        return "OVERDUE"
    return "ISSUED"


def validate_invoice_payment(invoice: dict[str, Any], amount: float, current_payment: dict[str, Any] | None = None) -> dict[str, Any]:
    summary = invoice_summary(invoice)
    if summary["status"] in ["VOID", "DRAFT"]:
        raise HTTPException(status_code=400, detail="Invoice is not payable")
    available_balance = summary["balance"]
    if current_payment and current_payment.get("invoiceId") == invoice["id"] and current_payment.get("status") == "POSTED":
        available_balance = money(available_balance + current_payment["amount"])
    if amount > available_balance:
        raise HTTPException(status_code=400, detail="Payment amount cannot exceed invoice balance")
    return summary


def invoice_summary(invoice: dict[str, Any]) -> dict[str, Any]:
    amounts = invoice_amounts(invoice)
    status = derived_invoice_status(invoice, amounts)
    invoice["status"] = status
    return {**invoice, **amounts, **invoice_early_bird_details(invoice, amounts)}


def payment_promotion_adjustment(invoice_id: str) -> dict[str, Any] | None:
    for adjustment in invoice_adjustments(invoice_id):
        if adjustment.get("adjustmentSource") == "PAYMENT_PROMOTION":
            return adjustment
    return None


def promotion_matches_invoice_scope(promotion: dict[str, Any], invoice: dict[str, Any]) -> bool:
    invoice_type = normalize_upper(invoice.get("invoiceType") or "MANUAL")
    applies_to = normalize_upper(promotion.get("appliesTo"))
    if applies_to == "MONTHLY_SERVICE":
        return invoice_type in MONTHLY_INVOICE_TYPES
    if applies_to == "INSTALLATION_FEE":
        return invoice_type == "INSTALLATION_FEE"
    return False


def payment_promotion_option(invoice: dict[str, Any], promotion: dict[str, Any], payment_day: date) -> dict[str, Any] | None:
    summary = invoice_summary(invoice)
    if summary["status"] in ["VOID", "DRAFT", "PAID"] or money(summary.get("balance")) <= 0:
        return None
    if payment_promotion_adjustment(invoice["id"]):
        return None
    if not promotion_matches_invoice_scope(promotion, invoice):
        return None
    if not promotion_is_active(promotion, payment_day):
        return None
    if clean_bool(promotion.get("requiresApproval")):
        return None
    if promotion.get("billingMode") and promotion.get("billingMode") != invoice.get("billingMode"):
        return None
    if promotion.get("customerId") and promotion.get("customerId") != invoice.get("customerId"):
        return None
    if promotion.get("catalogId") and promotion.get("catalogId") != invoice.get("catalogId"):
        return None
    payment_rule = promotion_payment_rule(promotion)
    auto_apply = False
    if payment_rule == "EARLY_BIRD":
        if not summary.get("earlyBirdEligible") or clean_text(summary.get("earlyBirdPromotionId")) != promotion["id"]:
            return None
        cutoff_date = summary.get("earlyBirdCutoffDate")
        if not cutoff_date:
            return None
        cutoff_day = parse_day(cutoff_date, "earlyBirdCutoffDate")
        if payment_day >= cutoff_day:
            return None
        auto_apply = True
    discount_amount = money(min(promotion_discount_amount(promotion, money(summary["balance"])), money(summary["balance"])))
    if discount_amount <= 0:
        return None
    discounted_payable = money(max(0, money(summary["balance"]) - discount_amount))
    if discounted_payable <= 0:
        return None
    return {
        **promotion_summary(promotion),
        "invoiceId": invoice["id"],
        "invoiceNumber": invoice["invoiceNumber"],
        "invoiceBalance": money(summary["balance"]),
        "discountAmountForInvoice": discount_amount,
        "discountedPayable": discounted_payable,
        "paymentRule": payment_rule,
        "priority": promotion_priority(promotion),
        "autoApply": auto_apply,
        "applicationSource": "PAYMENT_PROMOTION",
    }


def eligible_payment_promotions(invoice: dict[str, Any], payment_day: date) -> list[dict[str, Any]]:
    options = [
        option
        for promotion in visible_promotions()
        if (option := payment_promotion_option(invoice, promotion, payment_day)) is not None
    ]
    return sorted(
        options,
        key=lambda promotion: (
            -promotion_priority(promotion),
            -money(promotion.get("discountAmountForInvoice")),
            promotion.get("promoCode") or promotion.get("name") or "",
        ),
    )


def recommended_payment_promotion(options: list[dict[str, Any]]) -> dict[str, Any] | None:
    return next((option for option in options if option.get("autoApply")), options[0] if options else None)


def automatic_payment_promotion_for_payment(invoice: dict[str, Any], amount: float, payment_day: date) -> dict[str, Any] | None:
    for option in eligible_payment_promotions(invoice, payment_day):
        if option.get("autoApply") and amount == money(option.get("discountedPayable")):
            return option
    return None


def payment_promotion_for_payment(invoice: dict[str, Any], promotion_id: str, amount: float, payment_day: date) -> dict[str, Any]:
    promotion = find_promotion(promotion_id)
    option = payment_promotion_option(invoice, promotion, payment_day)
    if option is None:
        raise HTTPException(status_code=400, detail="Promotion is not eligible for this invoice payment")
    discounted_payable = money(option["discountedPayable"])
    if amount > discounted_payable:
        raise HTTPException(status_code=400, detail=f"Payment amount cannot exceed promo payable balance of {discounted_payable:.2f}")
    if amount != discounted_payable:
        raise HTTPException(status_code=400, detail=f"Payment amount must equal promo payable balance of {discounted_payable:.2f} to apply this promotion")
    return option


def invoice_month_key(invoice: dict[str, Any]) -> str:
    cycle_start = parse_day(invoice.get("billingCycleStart") or invoice.get("issueDate"), "billingCycleStart")
    return cycle_start.strftime("%Y-%m")


def monthly_unpaid_invoices(invoice_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        invoice
        for invoice in invoice_rows
        if invoice.get("invoiceType") in MONTHLY_INVOICE_TYPES
        and invoice.get("status") not in ["PAID", "VOID", "DRAFT"]
        and money(invoice.get("balance")) > 0
    ]


def unpaid_month_summary(invoice_rows: list[dict[str, Any]]) -> dict[str, Any]:
    unpaid_rows = monthly_unpaid_invoices(invoice_rows)
    month_keys = sorted({invoice_month_key(invoice) for invoice in unpaid_rows})
    return {
        "unpaidMonths": len(month_keys),
        "unpaidMonthlyInvoices": len(unpaid_rows),
        "unpaidMonthKeys": month_keys,
        "oldestUnpaidMonth": month_keys[0] if month_keys else "",
        "newestUnpaidMonth": month_keys[-1] if month_keys else "",
        "unpaidMonthlyBalance": money(sum(invoice["balance"] for invoice in unpaid_rows)),
    }


def monthly_invoice_cycle_keys(subscription_id: str, invoice_rows: list[dict[str, Any]]) -> set[str]:
    return {
        invoice_month_key(invoice)
        for invoice in invoice_rows
        if invoice.get("subscriptionId") == subscription_id
        and invoice.get("invoiceType") in MONTHLY_INVOICE_TYPES
        and invoice.get("status") != "VOID"
    }


def billing_cycle_invoice_due_date(subscription: dict[str, Any], cycle_start: date) -> date:
    if subscription.get("billingMode") == "PREPAID":
        return cycle_start
    return month_end(cycle_start)


def expected_billing_cycle_keys(subscription: dict[str, Any], as_of: date | None = None) -> list[str]:
    if subscription.get("status") != "ACTIVE":
        return []
    as_of_day = as_of or date.today()
    cycle_start = parse_day(subscription.get("startDate") or subscription.get("nextInvoiceDate"), "startDate")
    cycle_keys: list[str] = []
    for _ in range(240):
        if billing_cycle_invoice_due_date(subscription, cycle_start) > as_of_day:
            break
        cycle_keys.append(cycle_start.strftime("%Y-%m"))
        cycle_start = next_month_start(cycle_start)
    return cycle_keys


def missing_billing_cycle_keys(subscription: dict[str, Any], invoice_rows: list[dict[str, Any]], as_of: date | None = None) -> list[str]:
    billed_keys = monthly_invoice_cycle_keys(subscription["id"], invoice_rows)
    return [cycle_key for cycle_key in expected_billing_cycle_keys(subscription, as_of) if cycle_key not in billed_keys]


def missing_billing_cycle_summary(subscription: dict[str, Any], invoice_rows: list[dict[str, Any]], as_of: date | None = None) -> dict[str, Any]:
    cycle_keys = missing_billing_cycle_keys(subscription, invoice_rows, as_of)
    return {
        "missingBillingCycles": len(cycle_keys),
        "missingBillingCycleKeys": cycle_keys,
        "oldestMissingBillingCycle": cycle_keys[0] if cycle_keys else "",
        "newestMissingBillingCycle": cycle_keys[-1] if cycle_keys else "",
        "missingBillingCycleEstimate": money(len(cycle_keys) * money(subscription.get("monthlyRate"))),
    }


def missing_billing_cycle_summary_for_subscriptions(
    subscription_rows: list[dict[str, Any]],
    invoice_rows: list[dict[str, Any]],
    as_of: date | None = None,
) -> dict[str, Any]:
    summaries = [missing_billing_cycle_summary(subscription, invoice_rows, as_of) for subscription in subscription_rows]
    oldest_keys = [summary["oldestMissingBillingCycle"] for summary in summaries if summary["oldestMissingBillingCycle"]]
    newest_keys = [summary["newestMissingBillingCycle"] for summary in summaries if summary["newestMissingBillingCycle"]]
    cycle_keys = sorted({cycle_key for summary in summaries for cycle_key in summary["missingBillingCycleKeys"]})
    return {
        "missingBillingCycles": sum(summary["missingBillingCycles"] for summary in summaries),
        "missingBillingCycleKeys": cycle_keys,
        "oldestMissingBillingCycle": min(oldest_keys) if oldest_keys else "",
        "newestMissingBillingCycle": max(newest_keys) if newest_keys else "",
        "missingBillingCycleEstimate": money(sum(summary["missingBillingCycleEstimate"] for summary in summaries)),
    }


def subscription_summary(subscription: dict[str, Any], invoice_rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {**subscription, **missing_billing_cycle_summary(subscription, invoice_rows)}


def billing_customer_snapshot(customer_id: str) -> dict[str, Any]:
    for row in [
        *visible_subscriptions(),
        *visible_invoices(),
        *visible_payments(),
        *visible_adjustments(),
        *visible_installation_charges(),
    ]:
        if row.get("customerId") != customer_id or not isinstance(row.get("customer"), dict):
            continue
        snapshot = dict(row["customer"])
        snapshot.setdefault("id", customer_id)
        snapshot.setdefault("name", customer_name(snapshot))
        snapshot.setdefault("accountNumber", "")
        snapshot.setdefault("firstName", "")
        snapshot.setdefault("lastName", "")
        snapshot.setdefault("status", "")
        snapshot.setdefault("gender", "")
        snapshot.setdefault("contactNumber", "")
        snapshot.setdefault("address", "")
        return snapshot
    return {
        "id": customer_id,
        "accountNumber": "",
        "firstName": "",
        "lastName": "",
        "name": "Unknown customer",
        "status": "",
        "gender": "",
        "contactNumber": "",
        "address": "",
    }


def customer_balance(customer_id: str) -> dict[str, Any]:
    customer_subscriptions = [subscription for subscription in visible_subscriptions() if subscription["customerId"] == customer_id]
    customer_invoices = [
        invoice_summary(invoice)
        for invoice in visible_invoices()
        if invoice["customerId"] == customer_id and invoice.get("status") != "VOID"
    ]
    customer_payments = [
        payment for payment in visible_payments() if payment["customerId"] == customer_id and payment["status"] == "POSTED"
    ]
    customer_adjustments = [adjustment for adjustment in visible_adjustments() if adjustment["customerId"] == customer_id]
    try:
        customer = resolve_customer(customer_id)
    except HTTPException as exc:
        if exc.status_code != 404 or not (customer_subscriptions or customer_invoices or customer_payments or customer_adjustments):
            raise
        customer = billing_customer_snapshot(customer_id)
    invoiced_total = money(sum(invoice["total"] for invoice in customer_invoices))
    paid_total = money(sum(payment["amount"] for payment in customer_payments))
    balance = money(invoiced_total - paid_total)
    overdue_total = money(sum(invoice["balance"] for invoice in customer_invoices if invoice["status"] == "OVERDUE"))
    unpaid_months = unpaid_month_summary(customer_invoices)
    missing_cycles = missing_billing_cycle_summary_for_subscriptions(customer_subscriptions, customer_invoices)
    return {
        "customer": customer,
        "invoicedTotal": invoiced_total,
        "paidTotal": paid_total,
        "balance": balance,
        "credit": money(abs(balance)) if balance < 0 else 0,
        "overdueTotal": overdue_total,
        "openInvoices": sum(1 for invoice in customer_invoices if invoice["status"] not in ["PAID", "VOID"]),
        **unpaid_months,
        **missing_cycles,
    }


@billing_read_snapshot
def billing_metrics() -> dict[str, float | int]:
    seed_billing_data()
    invoice_rows = [invoice_summary(invoice) for invoice in visible_invoices()]
    posted_payments = [payment for payment in visible_payments() if payment["status"] == "POSTED"]
    current_month = datetime.now(timezone.utc).strftime("%Y-%m")
    return {
        "active_subscriptions": sum(1 for subscription in visible_subscriptions() if subscription["status"] == "ACTIVE"),
        "open_invoices": sum(1 for invoice in invoice_rows if invoice["status"] not in ["PAID", "VOID"]),
        "overdue": sum(1 for invoice in invoice_rows if invoice["status"] == "OVERDUE"),
        "collections": money(sum(payment["amount"] for payment in posted_payments if str(payment["paymentDate"]).startswith(current_month))),
        "monthly_recurring_revenue": money(
            sum(subscription["monthlyRate"] for subscription in visible_subscriptions() if subscription["status"] == "ACTIVE")
        ),
        "outstanding_balance": money(sum(invoice["balance"] for invoice in invoice_rows if invoice["status"] != "VOID")),
    }


def early_bird_invoice_fields(subscription: dict[str, Any], cycle_start_day: date, invoice_type: str, due_day: date | None = None) -> dict[str, Any]:
    promotion_id = clean_text(subscription.get("earlyBirdPromotionId"))
    eligible = (
        subscription.get("billingMode") in BILLING_MODES
        and invoice_type == "MONTHLY"
        and bool(subscription.get("earlyBirdEligible"))
        and bool(promotion_id)
    )
    discount_amount = 0
    promotion_code = clean_text(subscription.get("earlyBirdPromotionCode"))
    promotion_name = clean_text(subscription.get("earlyBirdPromotionName"))
    if eligible:
        try:
            promotion = find_promotion(promotion_id)
        except HTTPException:
            promotion = None
        promotion_valid = bool(
            promotion
            and promotion.get("appliesTo") == "MONTHLY_SERVICE"
            and promotion_payment_rule(promotion) == "EARLY_BIRD"
            and promotion_is_active(promotion, cycle_start_day)
            and not clean_bool(promotion.get("requiresApproval"))
            and (not promotion.get("billingMode") or promotion.get("billingMode") == subscription.get("billingMode"))
            and (not promotion.get("customerId") or promotion.get("customerId") == subscription.get("customerId"))
            and (not promotion.get("catalogId") or promotion.get("catalogId") == subscription.get("catalogId"))
        )
        if promotion_valid:
            promotion_code = promotion["promoCode"]
            promotion_name = promotion["name"]
            discount_amount = promotion_discount_amount(promotion, money(subscription.get("monthlyRate")))
        else:
            eligible = False
            discount_amount = 0
            promotion_id = ""
            promotion_code = ""
            promotion_name = ""
    if subscription.get("billingMode") == "POSTPAID" and due_day:
        cutoff_day = due_day + timedelta(days=1)
    else:
        cutoff_day = cycle_start_day
    return {
        "earlyBirdEligible": eligible,
        "earlyBirdDiscountAmount": discount_amount,
        "earlyBirdPromotionId": promotion_id if eligible else "",
        "earlyBirdPromotionCode": promotion_code if eligible else "",
        "earlyBirdPromotionName": promotion_name if eligible else "",
        "earlyBirdCutoffDate": cutoff_day.isoformat() if eligible else "",
    }


def invoice_for_subscription_cycle(subscription_id: str, cycle_start: str) -> dict[str, Any] | None:
    ensure_billing_data_loaded()
    return next(
        (
            invoice
            for invoice in invoices
            if invoice.get("subscriptionId") == subscription_id
            and invoice.get("billingCycleStart") == cycle_start
        ),
        None,
    )


def create_invoice_from_subscription(
    subscription: dict[str, Any],
    cycle_start: str | None = None,
    idempotency_key: str = "",
) -> dict[str, Any]:
    cycle_start_day = parse_day(cycle_start or subscription.get("nextInvoiceDate") or today_iso(), "billingCycleStart")
    cycle_start_value = cycle_start_day.isoformat()
    posting_key = normalize_idempotency_key(
        idempotency_key or f"subscription-cycle:{subscription['id']}:{cycle_start_value}",
        required=False,
    )
    fingerprint = posting_fingerprint(
        "invoice",
        {
            "source": "SUBSCRIPTION_CYCLE",
            "subscriptionId": subscription["id"],
            "billingCycleStart": cycle_start_value,
        },
    )
    existing = invoice_for_subscription_cycle(subscription["id"], cycle_start_value)
    if existing is not None:
        if existing.get("status") == "VOID":
            raise HTTPException(status_code=409, detail="This subscription cycle already has a voided invoice and requires a reissue workflow")
        return {**invoice_summary(existing), "idempotentReplay": True}
    cycle_end_day = month_end(cycle_start_day)
    issue_day = cycle_start_day if subscription["billingMode"] == "PREPAID" else cycle_end_day
    due_day = cycle_start_day if subscription["billingMode"] == "PREPAID" else cycle_end_day + timedelta(days=subscription["dueDays"])
    timestamp = now_iso()
    invoice = {
        "id": str(uuid4()),
        "invoiceNumber": next_number("INV", invoices, "invoiceNumber"),
        "idempotencyKey": posting_key,
        "idempotencyFingerprint": fingerprint,
        "customerId": subscription["customerId"],
        "customer": subscription["customer"],
        "subscriptionId": subscription["id"],
        "serviceAccountId": subscription.get("serviceAccountId", ""),
        "serviceAccountNumber": subscription.get("serviceAccountNumber", ""),
        "serviceOrderId": subscription.get("serviceOrderId", ""),
        "serviceId": subscription.get("serviceId", ""),
        "catalogId": subscription.get("catalogId", ""),
        "catalogCode": subscription.get("catalogCode", ""),
        "catalogName": subscription.get("catalogName", ""),
        "listMonthlyRate": subscription.get("listMonthlyRate", subscription["monthlyRate"]),
        "pricingSource": subscription.get("pricingSource", "MANUAL"),
        "priceOverrideAmount": subscription.get("priceOverrideAmount"),
        "priceOverrideReason": subscription.get("priceOverrideReason", ""),
        "billingMode": subscription["billingMode"],
        "billingCycleAnchor": subscription.get("billingCycleAnchor", "CALENDAR_MONTH"),
        "invoiceType": "MONTHLY",
        **early_bird_invoice_fields(subscription, cycle_start_day, "MONTHLY", due_day),
        "billingCycleStart": cycle_start_day.isoformat(),
        "billingCycleEnd": cycle_end_day.isoformat(),
        "issueDate": issue_day.isoformat(),
        "dueDate": due_day.isoformat(),
        "status": "ISSUED",
        "lineItems": normalize_line_items(None, subscription),
        "notes": "",
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
    }
    invoices.append(invoice)
    subscription["nextInvoiceDate"] = (cycle_end_day + timedelta(days=1)).isoformat()
    subscription["updatedAt"] = timestamp
    return invoice_summary(invoice)


def first_subscription_invoice_details(subscription: dict[str, Any]) -> dict[str, Any]:
    cycle_start_day = parse_day(subscription["startDate"], "startDate")
    cycle_end_day = month_end(cycle_start_day)
    service_days = inclusive_days(cycle_start_day, cycle_end_day)
    days_in_cycle = cycle_end_day.day
    monthly_rate = money(subscription["monthlyRate"])
    is_prorated = service_days < days_in_cycle
    amount = round_up_to_peso(monthly_rate * service_days / days_in_cycle) if is_prorated else monthly_rate
    return {
        "cycleStart": cycle_start_day,
        "cycleEnd": cycle_end_day,
        "serviceDays": service_days,
        "daysInCycle": days_in_cycle,
        "monthlyRate": monthly_rate,
        "amount": amount,
        "isProrated": is_prorated,
        "invoiceType": "FIRST_PRORATED" if is_prorated else "FIRST_FULL",
        "nextFullCycleStart": next_month_start(cycle_start_day),
    }


def create_first_subscription_invoice(subscription: dict[str, Any]) -> dict[str, Any] | None:
    if not subscription.get("serviceAccountId") or subscription.get("billingMode") not in ["PREPAID", "POSTPAID"] or subscription.get("status") != "ACTIVE":
        return None
    if subscription.get("firstInvoiceId"):
        try:
            return invoice_summary(find_invoice(subscription["firstInvoiceId"]))
        except HTTPException:
            subscription["firstInvoiceId"] = ""
    details = first_subscription_invoice_details(subscription)
    cycle_start_value = details["cycleStart"].isoformat()
    existing = invoice_for_subscription_cycle(subscription["id"], cycle_start_value)
    if existing is not None:
        summary = invoice_summary(existing)
        subscription["firstInvoiceId"] = summary["id"]
        subscription["firstInvoiceNumber"] = summary["invoiceNumber"]
        return {**summary, "idempotentReplay": True}
    is_prepaid = subscription["billingMode"] == "PREPAID"
    issue_day = details["cycleStart"] if is_prepaid else details["cycleEnd"]
    due_day = details["cycleStart"] if is_prepaid else details["cycleEnd"] + timedelta(days=subscription["dueDays"])
    service_ref = subscription.get("serviceId")
    mode_label = "prepaid" if is_prepaid else "postpaid"
    description = f"{subscription['planName']} {'prorated ' if details['isProrated'] else ''}{mode_label} internet service"
    description = f"{description} ({details['cycleStart'].isoformat()} to {details['cycleEnd'].isoformat()})"
    if service_ref:
        description = f"{description} - {service_ref}"
    proration = {
        "policy": "CALENDAR_MONTH_ACTUAL_DAYS",
        "serviceDays": details["serviceDays"],
        "daysInCycle": details["daysInCycle"],
        "monthlyRate": details["monthlyRate"],
        "proratedAmount": details["amount"],
        "isProrated": details["isProrated"],
    }
    timestamp = now_iso()
    invoice = {
        "id": str(uuid4()),
        "invoiceNumber": next_number("INV", invoices, "invoiceNumber"),
        "idempotencyKey": f"subscription-first:{subscription['id']}:{cycle_start_value}",
        "idempotencyFingerprint": posting_fingerprint(
            "invoice",
            {
                "source": "SUBSCRIPTION_FIRST",
                "subscriptionId": subscription["id"],
                "billingCycleStart": cycle_start_value,
            },
        ),
        "customerId": subscription["customerId"],
        "customer": subscription["customer"],
        "subscriptionId": subscription["id"],
        "serviceAccountId": subscription.get("serviceAccountId", ""),
        "serviceAccountNumber": subscription.get("serviceAccountNumber", ""),
        "serviceOrderId": subscription.get("serviceOrderId", ""),
        "serviceId": subscription.get("serviceId", ""),
        "catalogId": subscription.get("catalogId", ""),
        "catalogCode": subscription.get("catalogCode", ""),
        "catalogName": subscription.get("catalogName", ""),
        "listMonthlyRate": subscription.get("listMonthlyRate", subscription["monthlyRate"]),
        "pricingSource": subscription.get("pricingSource", "MANUAL"),
        "priceOverrideAmount": subscription.get("priceOverrideAmount"),
        "priceOverrideReason": subscription.get("priceOverrideReason", ""),
        "billingMode": subscription["billingMode"],
        "billingCycleAnchor": subscription.get("billingCycleAnchor", "CALENDAR_MONTH"),
        "invoiceType": details["invoiceType"],
        **early_bird_invoice_fields(subscription, details["cycleStart"], details["invoiceType"]),
        "proration": proration,
        "billingCycleStart": details["cycleStart"].isoformat(),
        "billingCycleEnd": details["cycleEnd"].isoformat(),
        "issueDate": issue_day.isoformat(),
        "dueDate": due_day.isoformat(),
        "status": "ISSUED",
        "lineItems": [
            subscription_line_item(
                subscription,
                description=description,
                amount=details["amount"],
                item_type="PRORATED_MONTHLY_SERVICE" if details["isProrated"] else "FIRST_MONTHLY_SERVICE",
                proration=proration,
            )
        ],
        "notes": "Automatically created when monthly billing started after installation fee resolution.",
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
    }
    invoices.append(invoice)
    summary = invoice_summary(invoice)
    subscription.update(
        {
            "firstInvoiceId": summary["id"],
            "firstInvoiceNumber": summary["invoiceNumber"],
            "firstInvoiceType": summary["invoiceType"],
            "firstInvoiceAmount": summary["total"],
            "firstInvoiceCycleStart": summary["billingCycleStart"],
            "firstInvoiceCycleEnd": summary["billingCycleEnd"],
            "firstInvoiceDueDate": summary["dueDate"],
            "firstInvoiceProrated": details["isProrated"],
            "nextInvoiceDate": details["nextFullCycleStart"].isoformat(),
            "updatedAt": timestamp,
        }
    )
    return summary


def seed_billing_data() -> None:
    ensure_billing_data_loaded()
    if not BILLING_SEED_DEMO:
        return
    if subscriptions or _customer_searcher is None:
        return
    if not billing_store.in_transaction:
        with billing_store.transaction():
            seed_billing_data()
        return
    seed_customers()
    customer_rows = search_customers("")[:2]
    if not customer_rows:
        return
    plans = [
        ("Home Fiber 50 Mbps", "PREPAID", 999),
        ("Business Fiber 100 Mbps", "POSTPAID", 2499),
    ]
    for customer, (plan_name, billing_mode, rate) in zip(customer_rows, plans):
        timestamp = now_iso()
        start = date.today().replace(day=1).isoformat()
        subscription = {
            "id": str(uuid4()),
            "customerId": customer["id"],
            "customer": customer,
            "planName": plan_name,
            "serviceAccountId": "",
            "serviceAccountNumber": "",
            "serviceOrderId": "",
            "catalogId": "",
            "catalogCode": "",
            "catalogName": "",
            "serviceId": f"SVC-{customer.get('accountNumber') or customer['id'][:6]}",
            "listMonthlyRate": money(rate),
            "monthlyRate": money(rate),
            "priceOverrideAmount": None,
            "priceOverrideReason": "",
            "pricingSource": "MANUAL",
            "billingMode": billing_mode,
            "billingDay": 1,
            "startDate": start,
            "nextInvoiceDate": start,
            "dueDays": 0 if billing_mode == "PREPAID" else 7,
            "earlyBirdEligible": False,
            "earlyBirdDiscountAmount": 0,
            "status": "ACTIVE",
            "notes": "Seed subscription for first working Billing shell.",
            "createdAt": timestamp,
            "updatedAt": timestamp,
            "deletedAt": None,
        }
        subscriptions.append(subscription)
        create_invoice_from_subscription(subscription, start)
    persist_billing_state()


def filter_rows(rows: list[dict[str, Any]], search: str = "", status: str = "", customer_id: str = "") -> list[dict[str, Any]]:
    filtered = rows
    if customer_id:
        filtered = [row for row in filtered if row.get("customerId") == customer_id]
    if status:
        filtered = [row for row in filtered if normalize_upper(row.get("status")) == normalize_upper(status)]
    if search:
        needle = search.lower().strip()
        filtered = [
            row
            for row in filtered
            if needle in str(row.get("invoiceNumber", "")).lower()
            or needle in str(row.get("receiptNumber", "")).lower()
            or needle in str(row.get("planName", "")).lower()
            or needle in str(row.get("serviceAccountNumber", "")).lower()
            or needle in str(row.get("serviceId", "")).lower()
            or needle in str(row.get("catalogCode", "")).lower()
            or needle in str(row.get("customer", {}).get("name", "")).lower()
            or needle in str(row.get("customer", {}).get("accountNumber", "")).lower()
        ]
    return filtered


@router.get("/meta")
def billing_meta(admin=Depends(require_admin)):
    return {
        "billingModes": BILLING_MODES,
        "pricingSources": PRICING_SOURCES,
        "subscriptionStatuses": SUBSCRIPTION_STATUSES,
        "invoiceStatuses": INVOICE_STATUSES,
        "paymentStatuses": PAYMENT_STATUSES,
        "paymentMethods": PAYMENT_METHODS,
        "adjustmentTypes": ADJUSTMENT_TYPES,
        "adjustmentStatuses": ADJUSTMENT_STATUSES,
        "installationChargeStatuses": INSTALLATION_CHARGE_STATUSES,
        "promotionStatuses": PROMOTION_STATUSES,
        "promotionScopes": PROMOTION_SCOPES,
        "promotionDiscountTypes": PROMOTION_DISCOUNT_TYPES,
        "promotionPaymentRules": PROMOTION_PAYMENT_RULES,
    }


@router.get("/readiness")
def billing_readiness(admin=Depends(require_admin)):
    storage = billing_store.status()
    integrity = storage.get("integrity") or {}
    return {
        "module": "billing",
        "realDataReady": storage.get("ready") is True and storage.get("mode") == "postgres",
        "financialPostingIntegrityReady": all(
            integrity.get(control) is True
            for control in [
                "transactionalPosting",
                "immutablePostedRecords",
                "idempotencyEnforced",
                "subscriptionCycleUniqueness",
            ]
        ),
        "storage": storage,
        "remainingProductionStages": [
            "Normalize invoice lines and payment allocations into dedicated relational tables as volume grows.",
            "Add database-level foreign key enforcement once Service Accounts and cross-module records are durable.",
            "Add production backup/restore coverage and operational monitoring for Billing tables.",
        ],
    }


@router.get("/customers")
def billing_customers(search: str = "", admin=Depends(require_admin)):
    return search_customers(search)[:50]


@router.get("/promotions")
@billing_read_snapshot
def list_promotions(
    search: str = "",
    status: str = "",
    appliesTo: str = "",
    admin=Depends(require_admin),
):
    rows = visible_promotions()
    if search:
        needle = search.lower().strip()
        rows = [
            promotion
            for promotion in rows
            if needle in str(promotion.get("name", "")).lower()
            or needle in str(promotion.get("promoCode", "")).lower()
            or needle in str(promotion.get("description", "")).lower()
            or needle in str(promotion.get("notes", "")).lower()
        ]
    if status:
        rows = [promotion for promotion in rows if promotion_effective_status(promotion) == normalize_upper(status) or normalize_upper(promotion.get("status")) == normalize_upper(status)]
    if appliesTo:
        rows = [promotion for promotion in rows if normalize_upper(promotion.get("appliesTo")) == normalize_upper(appliesTo)]
    return sorted([promotion_summary(promotion) for promotion in rows], key=lambda promotion: promotion["createdAt"], reverse=True)


@router.post("/promotions")
@billing_mutation
def create_promotion(payload: PromotionPayload, admin=Depends(require_admin)):
    record = normalize_promotion_payload(payload)
    timestamp = now_iso()
    promotion = {
        "id": str(uuid4()),
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
        **record,
    }
    promotions.append(promotion)
    add_audit("billing_promotion_created", "BillingPromotion", promotion["id"], {"promoCode": promotion["promoCode"], "appliesTo": promotion["appliesTo"]}, admin["username"])
    persist_billing_state()
    return promotion_summary(promotion)


@router.patch("/promotions/{promotion_id}")
@billing_mutation
def update_promotion(promotion_id: str, payload: PromotionPayload, admin=Depends(require_admin)):
    current = find_promotion(promotion_id)
    record = normalize_promotion_payload(payload, current)
    current.update(record)
    current["updatedAt"] = now_iso()
    add_audit("billing_promotion_updated", "BillingPromotion", current["id"], {"promoCode": current["promoCode"], "appliesTo": current["appliesTo"]}, admin["username"])
    persist_billing_state()
    return promotion_summary(current)


@router.delete("/promotions/{promotion_id}")
@billing_mutation
def delete_promotion(promotion_id: str, admin=Depends(require_admin)):
    current = find_promotion(promotion_id)
    current["status"] = "ARCHIVED"
    current["deletedAt"] = now_iso()
    current["updatedAt"] = current["deletedAt"]
    add_audit("billing_promotion_archived", "BillingPromotion", current["id"], {"promoCode": current["promoCode"]}, admin["username"])
    persist_billing_state()
    return {"status": "ok"}


@router.get("/overview")
@billing_read_snapshot
def billing_overview(admin=Depends(require_admin)):
    seed_billing_data()
    invoice_rows = [invoice_summary(invoice) for invoice in visible_invoices()]
    return {
        "metrics": billing_metrics(),
        "recentInvoices": sorted(invoice_rows, key=lambda invoice: invoice["createdAt"], reverse=True)[:5],
        "recentPayments": sorted(visible_payments(), key=lambda payment: payment["createdAt"], reverse=True)[:5],
        "atRisk": [invoice for invoice in invoice_rows if invoice["status"] in ["OVERDUE", "PARTIALLY_PAID"]][:5],
    }


@router.get("/subscriptions")
@billing_read_snapshot
def list_subscriptions(
    search: str = "",
    status: str = "",
    customerId: str = "",
    admin=Depends(require_admin),
):
    seed_billing_data()
    rows = filter_rows(visible_subscriptions(), search, status, customerId)
    invoice_rows = [invoice_summary(invoice) for invoice in visible_invoices()]
    return sorted([subscription_summary(row, invoice_rows) for row in rows], key=lambda row: row["createdAt"], reverse=True)


@router.post("/subscriptions")
@billing_mutation
def create_subscription(payload: SubscriptionPayload, admin=Depends(require_admin)):
    record = normalize_subscription_payload(payload)
    ensure_service_target_available(record)
    ensure_installation_fee_resolved(record)
    customer = resolve_customer(record["customerId"])
    timestamp = now_iso()
    subscription = {
        "id": str(uuid4()),
        "customer": customer,
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
        **record,
    }
    subscriptions.append(subscription)
    add_audit("billing_subscription_created", "BillingSubscription", subscription["id"], {"customerId": customer["id"]}, admin["username"])
    first_invoice = create_first_subscription_invoice(subscription)
    if first_invoice:
        add_audit("billing_invoice_generated", "BillingInvoice", first_invoice["id"], {"subscriptionId": subscription["id"], "invoiceType": first_invoice["invoiceType"]}, admin["username"])
    persist_billing_state()
    return {**subscription, "firstInvoice": first_invoice}


@router.patch("/subscriptions/{subscription_id}")
@billing_mutation
def update_subscription(subscription_id: str, payload: SubscriptionPayload, admin=Depends(require_admin)):
    current = find_subscription(subscription_id)
    record = normalize_subscription_payload(payload, current)
    ensure_service_target_available(record, current["id"])
    ensure_installation_fee_resolved(record, current)
    if record["customerId"] != current["customerId"]:
        record["customer"] = resolve_customer(record["customerId"])
    current.update(record)
    current["updatedAt"] = now_iso()
    add_audit("billing_subscription_updated", "BillingSubscription", current["id"], {"customerId": current["customerId"]}, admin["username"])
    persist_billing_state()
    return current


@router.delete("/subscriptions/{subscription_id}")
@billing_mutation
def delete_subscription(subscription_id: str, admin=Depends(require_admin)):
    current = find_subscription(subscription_id)
    current["status"] = "CANCELLED"
    current["deletedAt"] = now_iso()
    current["updatedAt"] = current["deletedAt"]
    add_audit("billing_subscription_deleted", "BillingSubscription", current["id"], {"customerId": current["customerId"]}, admin["username"])
    persist_billing_state()
    return {"status": "ok"}


@router.post("/subscriptions/{subscription_id}/generate-invoice")
@billing_mutation
def generate_subscription_invoice(
    subscription_id: str,
    cycleStart: str | None = None,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    admin=Depends(require_admin),
):
    subscription = find_subscription(subscription_id)
    if subscription["status"] != "ACTIVE":
        raise HTTPException(status_code=400, detail="Only active subscriptions can generate invoices")
    posting_key = normalize_idempotency_key(idempotency_key, required=False)
    if posting_key:
        replay = billing_store.find_idempotent_record("invoice", posting_key)
        if replay is not None:
            requested_cycle = parse_day(cycleStart, "billingCycleStart").isoformat() if cycleStart else ""
            if replay.get("subscriptionId") != subscription_id or (
                requested_cycle and replay.get("billingCycleStart") != requested_cycle
            ):
                raise HTTPException(status_code=409, detail="Idempotency-Key was already used for a different invoice cycle")
            return {**invoice_summary(replay), "idempotentReplay": True}
    invoice = create_invoice_from_subscription(
        subscription,
        cycleStart,
        posting_key,
    )
    if invoice.get("idempotentReplay"):
        return invoice
    add_audit("billing_invoice_generated", "BillingInvoice", invoice["id"], {"subscriptionId": subscription_id}, admin["username"])
    persist_billing_state()
    return invoice


@router.get("/installation-charges")
@billing_read_snapshot
def list_installation_charges(
    search: str = "",
    status: str = "",
    customerId: str = "",
    admin=Depends(require_admin),
):
    seed_billing_data()
    rows = [installation_charge_summary(charge) for charge in visible_installation_charges()]
    rows = filter_rows(rows, search, status, customerId)
    return sorted(rows, key=lambda row: row["createdAt"], reverse=True)


@router.post("/installation-charges")
@billing_mutation
def create_installation_charge(payload: InstallationChargePayload, admin=Depends(require_admin)):
    record = normalize_installation_charge_payload(payload)
    existing = installation_charge_for_service_account(record["serviceAccountId"])
    if existing:
        raise HTTPException(status_code=409, detail="Installation fee decision already exists for this Service Account")
    customer = resolve_customer(record["customerId"])
    timestamp = now_iso()
    charge = {
        "id": str(uuid4()),
        "customerId": customer["id"],
        "customer": customer,
        "invoiceId": "",
        "invoiceNumber": "",
        "invoiceStatus": "",
        "invoiceBalance": 0,
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
        **record,
    }
    installation_charges.append(charge)
    invoice = sync_installation_charge_invoice(charge)
    if invoice:
        charge["invoiceStatus"] = invoice["status"]
        charge["invoiceBalance"] = invoice["balance"]
    add_audit(
        "billing_installation_charge_recorded",
        "BillingInstallationCharge",
        charge["id"],
        {"customerId": customer["id"], "serviceAccountId": charge["serviceAccountId"], "status": charge["status"], "invoiceId": charge.get("invoiceId")},
        admin["username"],
    )
    persist_billing_state()
    return installation_charge_summary(charge)


@router.patch("/installation-charges/{charge_id}")
@billing_mutation
def update_installation_charge(charge_id: str, payload: InstallationChargePayload, admin=Depends(require_admin)):
    current = find_installation_charge(charge_id)
    if current.get("invoiceId"):
        raise HTTPException(status_code=409, detail="Invoiced installation fee decisions are immutable; void and recreate the decision")
    record = normalize_installation_charge_payload(payload, current)
    if current.get("invoiceId") and current.get("status") == "INVOICED" and record["status"] != "INVOICED":
        raise HTTPException(status_code=400, detail="Void this installation fee decision before changing an invoiced fee to waived or no fee")
    existing = installation_charge_for_service_account(record["serviceAccountId"])
    if existing and existing["id"] != current["id"]:
        raise HTTPException(status_code=409, detail="Installation fee decision already exists for this Service Account")
    if record["customerId"] != current["customerId"]:
        record["customer"] = resolve_customer(record["customerId"])
    else:
        record["customer"] = current["customer"]
    current.update(record)
    current["updatedAt"] = now_iso()
    invoice = sync_installation_charge_invoice(current)
    if invoice:
        current["invoiceStatus"] = invoice["status"]
        current["invoiceBalance"] = invoice["balance"]
    add_audit(
        "billing_installation_charge_updated",
        "BillingInstallationCharge",
        current["id"],
        {"customerId": current["customerId"], "serviceAccountId": current["serviceAccountId"], "status": current["status"], "invoiceId": current.get("invoiceId")},
        admin["username"],
    )
    persist_billing_state()
    return installation_charge_summary(current)


@router.delete("/installation-charges/{charge_id}")
@billing_mutation
def delete_installation_charge(charge_id: str, admin=Depends(require_admin)):
    current = find_installation_charge(charge_id)
    if current.get("status") == "VOID":
        return {"status": "ok", "idempotentReplay": True}
    timestamp = now_iso()
    if current.get("invoiceId"):
        invoice = find_invoice(current["invoiceId"])
        if invoice_payments(invoice["id"]):
            raise HTTPException(status_code=400, detail="Installation fee invoice has payments and cannot be voided")
        if invoice_adjustments(invoice["id"]):
            raise HTTPException(status_code=409, detail="Void posted adjustments before voiding this installation fee decision")
        invoice["status"] = "VOID"
        invoice["voidedAt"] = timestamp
        invoice["voidedByUsername"] = admin["username"]
        invoice["voidReason"] = "Installation fee decision voided"
        invoice["updatedAt"] = timestamp
    current["status"] = "VOID"
    current["voidedAt"] = timestamp
    current["voidedByUsername"] = admin["username"]
    current["voidReason"] = "Installation fee decision voided"
    current["updatedAt"] = timestamp
    add_audit(
        "billing_installation_charge_voided",
        "BillingInstallationCharge",
        current["id"],
        {"customerId": current["customerId"], "serviceAccountId": current["serviceAccountId"], "invoiceId": current.get("invoiceId")},
        admin["username"],
    )
    persist_billing_state()
    return {"status": "ok"}


@router.get("/invoices")
@billing_read_snapshot
def list_invoices(
    search: str = "",
    status: str = "",
    customerId: str = "",
    admin=Depends(require_admin),
):
    seed_billing_data()
    rows = [invoice_summary(invoice) for invoice in visible_invoices()]
    rows = filter_rows(rows, search, status, customerId)
    return sorted(rows, key=lambda row: row["createdAt"], reverse=True)


@router.post("/invoices")
@billing_mutation
def create_invoice(
    payload: InvoicePayload,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    admin=Depends(require_admin),
):
    posting_key = normalize_idempotency_key(idempotency_key)
    fingerprint = posting_fingerprint("invoice", payload)
    replay = idempotent_replay("invoice", posting_key, fingerprint)
    if replay is not None:
        return invoice_summary(replay)
    subscription = find_subscription(payload.subscriptionId) if payload.subscriptionId else None
    customer_id = payload.customerId or (subscription["customerId"] if subscription else "")
    customer = subscription["customer"] if subscription else resolve_customer(customer_id)
    issue_day = parse_day(payload.issueDate, "issueDate")
    cycle_start = parse_day(payload.billingCycleStart or issue_day.isoformat(), "billingCycleStart")
    cycle_end = parse_day(payload.billingCycleEnd or (add_months(cycle_start, 1) - timedelta(days=1)).isoformat(), "billingCycleEnd")
    if cycle_end < cycle_start:
        raise HTTPException(status_code=400, detail="billingCycleEnd cannot be before billingCycleStart")
    status = normalize_upper(payload.status or "ISSUED")
    if status not in INVOICE_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid invoice status")
    if status not in ["DRAFT", "ISSUED"]:
        raise HTTPException(status_code=400, detail="New invoices must be saved as DRAFT or ISSUED")
    due_day = parse_day(payload.dueDate or cycle_end.isoformat(), "dueDate")
    invoice_type = "MONTHLY" if subscription else "MANUAL"
    if subscription and invoice_for_subscription_cycle(subscription["id"], cycle_start.isoformat()) is not None:
        raise HTTPException(status_code=409, detail="An invoice already exists for this subscription billing cycle")
    timestamp = now_iso()
    invoice = {
        "id": str(uuid4()),
        "invoiceNumber": next_number("INV", invoices, "invoiceNumber"),
        "idempotencyKey": posting_key,
        "idempotencyFingerprint": fingerprint,
        "customerId": customer["id"],
        "customer": customer,
        "subscriptionId": subscription["id"] if subscription else None,
        "serviceAccountId": subscription.get("serviceAccountId", "") if subscription else "",
        "serviceAccountNumber": subscription.get("serviceAccountNumber", "") if subscription else "",
        "serviceOrderId": subscription.get("serviceOrderId", "") if subscription else "",
        "serviceId": subscription.get("serviceId", "") if subscription else "",
        "catalogId": subscription.get("catalogId", "") if subscription else "",
        "catalogCode": subscription.get("catalogCode", "") if subscription else "",
        "catalogName": subscription.get("catalogName", "") if subscription else "",
        "listMonthlyRate": subscription.get("listMonthlyRate", subscription["monthlyRate"]) if subscription else None,
        "pricingSource": subscription.get("pricingSource", "MANUAL") if subscription else "MANUAL",
        "priceOverrideAmount": subscription.get("priceOverrideAmount") if subscription else None,
        "priceOverrideReason": subscription.get("priceOverrideReason", "") if subscription else "",
        "billingMode": subscription["billingMode"] if subscription else None,
        "invoiceType": invoice_type,
        **(early_bird_invoice_fields(subscription, cycle_start, invoice_type, due_day) if subscription else {"earlyBirdEligible": False, "earlyBirdDiscountAmount": 0, "earlyBirdCutoffDate": ""}),
        "billingCycleStart": cycle_start.isoformat(),
        "billingCycleEnd": cycle_end.isoformat(),
        "issueDate": issue_day.isoformat(),
        "dueDate": due_day.isoformat(),
        "status": status,
        "lineItems": normalize_line_items(payload.lineItems, subscription),
        "notes": payload.notes or "",
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
    }
    invoices.append(invoice)
    add_audit("billing_invoice_created", "BillingInvoice", invoice["id"], {"customerId": customer["id"]}, admin["username"])
    persist_billing_state()
    return invoice_summary(invoice)


@router.patch("/invoices/{invoice_id}")
@billing_mutation
def update_invoice(invoice_id: str, payload: InvoicePayload, admin=Depends(require_admin)):
    current = find_invoice(invoice_id)
    if current.get("status") != "DRAFT":
        raise HTTPException(status_code=409, detail="Posted invoices are immutable; use a credit or debit adjustment for corrections")
    data = payload.model_dump(exclude_unset=True)
    if "subscriptionId" in data:
        if data["subscriptionId"]:
            subscription = find_subscription(data["subscriptionId"])
            current["subscriptionId"] = subscription["id"]
            current["customerId"] = subscription["customerId"]
            current["customer"] = subscription["customer"]
            current["serviceAccountId"] = subscription.get("serviceAccountId", "")
            current["serviceAccountNumber"] = subscription.get("serviceAccountNumber", "")
            current["serviceOrderId"] = subscription.get("serviceOrderId", "")
            current["serviceId"] = subscription.get("serviceId", "")
            current["catalogId"] = subscription.get("catalogId", "")
            current["catalogCode"] = subscription.get("catalogCode", "")
            current["catalogName"] = subscription.get("catalogName", "")
            current["listMonthlyRate"] = subscription.get("listMonthlyRate", subscription["monthlyRate"])
            current["pricingSource"] = subscription.get("pricingSource", "MANUAL")
            current["priceOverrideAmount"] = subscription.get("priceOverrideAmount")
            current["priceOverrideReason"] = subscription.get("priceOverrideReason", "")
            current["billingMode"] = subscription["billingMode"]
            current["invoiceType"] = current.get("invoiceType") or "MONTHLY"
        else:
            current["subscriptionId"] = None
            current["serviceAccountId"] = ""
            current["serviceAccountNumber"] = ""
            current["serviceOrderId"] = ""
            current["serviceId"] = ""
            current["catalogId"] = ""
            current["catalogCode"] = ""
            current["catalogName"] = ""
            current["listMonthlyRate"] = None
            current["pricingSource"] = "MANUAL"
            current["priceOverrideAmount"] = None
            current["priceOverrideReason"] = ""
            current["billingMode"] = None
            current["invoiceType"] = "MANUAL"
            current["earlyBirdEligible"] = False
            current["earlyBirdDiscountAmount"] = 0
            current["earlyBirdCutoffDate"] = ""
    elif "customerId" in data and data["customerId"]:
        current["customerId"] = data["customerId"]
        current["customer"] = resolve_customer(data["customerId"])
    for field_name in ["billingCycleStart", "billingCycleEnd", "issueDate", "dueDate", "notes"]:
        if field_name in data and data[field_name] is not None:
            current[field_name] = parse_day(data[field_name], field_name).isoformat() if field_name != "notes" else data[field_name]
    if "status" in data and data["status"] is not None:
        status = normalize_upper(data["status"])
        if status not in INVOICE_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid invoice status")
        if status == "VOID":
            raise HTTPException(status_code=400, detail="Use the invoice void action instead of changing status")
        current["status"] = status
    if "lineItems" in data and data["lineItems"] is not None:
        subscription = find_subscription(current["subscriptionId"]) if current.get("subscriptionId") else None
        current["lineItems"] = normalize_line_items(data["lineItems"], subscription)
    if current.get("subscriptionId"):
        subscription = find_subscription(current["subscriptionId"])
        existing_cycle_invoice = invoice_for_subscription_cycle(current["subscriptionId"], current["billingCycleStart"])
        if existing_cycle_invoice is not None and existing_cycle_invoice["id"] != current["id"]:
            raise HTTPException(status_code=409, detail="An invoice already exists for this subscription billing cycle")
        current["invoiceType"] = current.get("invoiceType") or "MONTHLY"
        current.update(early_bird_invoice_fields(
            subscription,
            parse_day(current.get("billingCycleStart"), "billingCycleStart"),
            current["invoiceType"],
            parse_day(current.get("dueDate"), "dueDate"),
        ))
    current["updatedAt"] = now_iso()
    add_audit("billing_invoice_updated", "BillingInvoice", current["id"], {"customerId": current["customerId"]}, admin["username"])
    persist_billing_state()
    return invoice_summary(current)


@router.delete("/invoices/{invoice_id}")
@billing_mutation
def delete_invoice(invoice_id: str, reason: str = "", admin=Depends(require_admin)):
    current = find_invoice(invoice_id)
    if current.get("status") == "VOID":
        return {"status": "ok", "idempotentReplay": True}
    if current.get("subscriptionId"):
        raise HTTPException(status_code=409, detail="Subscription invoices cannot be voided directly; post a credit or debit adjustment")
    if current.get("invoiceType") == "INSTALLATION_FEE":
        raise HTTPException(status_code=409, detail="Void the installation fee decision to reverse this invoice")
    if invoice_payments(current["id"]):
        raise HTTPException(status_code=409, detail="Void posted payments before voiding this invoice")
    if invoice_adjustments(current["id"]):
        raise HTTPException(status_code=409, detail="Void posted adjustments before voiding this invoice")
    timestamp = now_iso()
    current["status"] = "VOID"
    current["voidedAt"] = timestamp
    current["voidedByUsername"] = admin["username"]
    current["voidReason"] = clean_text(reason) or "Voided by Billing user"
    current["updatedAt"] = timestamp
    add_audit(
        "billing_invoice_voided",
        "BillingInvoice",
        current["id"],
        {"customerId": current["customerId"], "reason": current["voidReason"]},
        admin["username"],
    )
    persist_billing_state()
    return {"status": "ok"}


@router.get("/invoices/{invoice_id}/eligible-promotions")
@billing_read_snapshot
def invoice_eligible_promotions(invoice_id: str, paymentDate: str = "", admin=Depends(require_admin)):
    invoice = find_invoice(invoice_id)
    payment_day = parse_day(paymentDate or today_iso(), "paymentDate")
    promotion_options = eligible_payment_promotions(invoice, payment_day)
    recommended_promotion = recommended_payment_promotion(promotion_options)
    return {
        "invoice": invoice_summary(invoice),
        "paymentDate": payment_day.isoformat(),
        "recommendedPromotionId": recommended_promotion["id"] if recommended_promotion else "",
        "promotions": promotion_options,
    }


@router.get("/payments")
@billing_read_snapshot
def list_payments(search: str = "", customerId: str = "", admin=Depends(require_admin)):
    seed_billing_data()
    rows = filter_rows(visible_payments(), search, "", customerId)
    return sorted(rows, key=lambda row: row["createdAt"], reverse=True)


def early_bird_discount_for_payment(invoice: dict[str, Any], amount: float, payment_day: date) -> dict[str, Any] | None:
    summary = invoice_summary(invoice)
    if clean_text(summary.get("earlyBirdPromotionId")):
        return None
    if not summary.get("earlyBirdEligible") or summary.get("earlyBirdDiscountApplied"):
        return None
    cutoff_day = parse_day(summary.get("earlyBirdCutoffDate"), "earlyBirdCutoffDate")
    if payment_day >= cutoff_day:
        return None
    discount_amount = money(min(summary.get("earlyBirdDiscountAmount"), summary["balance"]))
    if discount_amount <= 0:
        return None
    discounted_payable = money(max(0, summary["balance"] - discount_amount))
    if amount > discounted_payable:
        raise HTTPException(status_code=400, detail=f"Payment amount cannot exceed early bird payable balance of {discounted_payable:.2f}")
    if amount == discounted_payable:
        return {
            "amount": discount_amount,
            "cutoffDate": summary["earlyBirdCutoffDate"],
            "availableUntil": summary["earlyBirdAvailableUntil"],
            "discountedPayable": discounted_payable,
        }
    return None


def create_early_bird_discount_adjustment(
    invoice: dict[str, Any],
    payment: dict[str, Any],
    discount: dict[str, Any],
    admin: dict[str, Any],
    timestamp: str,
) -> dict[str, Any]:
    promotion_name = clean_text(invoice.get("earlyBirdPromotionName"))
    promotion_code = clean_text(invoice.get("earlyBirdPromotionCode"))
    reason = f"Early bird discount - {promotion_name}" if promotion_name else "Early bird discount"
    promo_note = f" Promo {promotion_code}." if promotion_code else ""
    adjustment = {
        "id": str(uuid4()),
        "invoiceId": invoice["id"],
        "invoiceNumber": invoice["invoiceNumber"],
        "customerId": invoice["customerId"],
        "customer": invoice["customer"],
        "type": "CREDIT",
        "amount": discount["amount"],
        "reason": reason,
        "adjustmentSource": "EARLY_BIRD_DISCOUNT",
        "promotionId": invoice.get("earlyBirdPromotionId", ""),
        "promotionCode": promotion_code,
        "promotionName": promotion_name,
        "paymentId": payment["id"],
        "paymentReceiptNumber": payment["receiptNumber"],
        "status": "POSTED",
        "postedByUsername": admin["username"],
        "postedByName": admin_display_name(admin),
        "notes": f"Applied because payment was posted before {discount['cutoffDate']}.{promo_note}",
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
    }
    adjustments.append(adjustment)
    payment["earlyBirdDiscountApplied"] = True
    payment["earlyBirdDiscountAmount"] = adjustment["amount"]
    payment["earlyBirdDiscountAdjustmentId"] = adjustment["id"]
    invoice["updatedAt"] = timestamp
    add_audit("billing_adjustment_posted", "BillingAdjustment", adjustment["id"], {"invoiceId": invoice["id"], "source": "EARLY_BIRD_DISCOUNT", "paymentId": payment["id"]}, admin["username"])
    return adjustment


def void_early_bird_discount_for_payment(
    payment: dict[str, Any],
    timestamp: str,
    admin: dict[str, Any],
) -> None:
    adjustment_id = payment.get("earlyBirdDiscountAdjustmentId")
    adjustment = None
    if adjustment_id:
        try:
            adjustment = find_adjustment(adjustment_id)
        except HTTPException:
            adjustment = None
    if adjustment is None:
        adjustment = next(
            (
                row
                for row in visible_adjustments()
                if row.get("paymentId") == payment["id"]
                and row.get("adjustmentSource") == "EARLY_BIRD_DISCOUNT"
                and row.get("status") == "POSTED"
            ),
            None,
        )
    if adjustment is None or adjustment.get("status") != "POSTED":
        return
    adjustment["status"] = "VOID"
    adjustment["voidedAt"] = timestamp
    adjustment["voidedByUsername"] = admin["username"]
    adjustment["voidReason"] = "Related payment voided"
    adjustment["updatedAt"] = timestamp
    payment["earlyBirdDiscountApplied"] = False
    add_audit(
        "billing_adjustment_voided",
        "BillingAdjustment",
        adjustment["id"],
        {
            "invoiceId": adjustment["invoiceId"],
            "source": "EARLY_BIRD_DISCOUNT",
            "paymentId": payment["id"],
            "reason": adjustment["voidReason"],
        },
        admin["username"],
    )


def create_payment_promotion_adjustment(
    invoice: dict[str, Any],
    payment: dict[str, Any],
    promotion_option: dict[str, Any],
    admin: dict[str, Any],
    timestamp: str,
) -> dict[str, Any]:
    promotion_name = clean_text(promotion_option.get("name"))
    promotion_code = clean_text(promotion_option.get("promoCode"))
    reason = f"Promotion discount - {promotion_name}" if promotion_name else "Promotion discount"
    promo_note = f" Promo {promotion_code}." if promotion_code else ""
    adjustment = {
        "id": str(uuid4()),
        "invoiceId": invoice["id"],
        "invoiceNumber": invoice["invoiceNumber"],
        "customerId": invoice["customerId"],
        "customer": invoice["customer"],
        "type": "CREDIT",
        "amount": money(promotion_option["discountAmountForInvoice"]),
        "reason": reason,
        "adjustmentSource": "PAYMENT_PROMOTION",
        "promotionId": promotion_option["id"],
        "promotionCode": promotion_code,
        "promotionName": promotion_name,
        "paymentId": payment["id"],
        "paymentReceiptNumber": payment["receiptNumber"],
        "status": "POSTED",
        "postedByUsername": admin["username"],
        "postedByName": admin_display_name(admin),
        "notes": f"Applied during payment.{promo_note}",
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
    }
    adjustments.append(adjustment)
    payment["promotionDiscountApplied"] = True
    payment["promotionDiscountAmount"] = adjustment["amount"]
    payment["promotionDiscountAdjustmentId"] = adjustment["id"]
    payment["promotionId"] = promotion_option["id"]
    payment["promotionCode"] = promotion_code
    payment["promotionName"] = promotion_name
    invoice["updatedAt"] = timestamp
    add_audit(
        "billing_adjustment_posted",
        "BillingAdjustment",
        adjustment["id"],
        {"invoiceId": invoice["id"], "source": "PAYMENT_PROMOTION", "paymentId": payment["id"]},
        admin["username"],
    )
    return adjustment


def void_payment_promotion_for_payment(
    payment: dict[str, Any],
    timestamp: str,
    admin: dict[str, Any],
) -> None:
    adjustment_id = payment.get("promotionDiscountAdjustmentId")
    adjustment = None
    if adjustment_id:
        try:
            adjustment = find_adjustment(adjustment_id)
        except HTTPException:
            adjustment = None
    if adjustment is None:
        adjustment = next(
            (
                row
                for row in visible_adjustments()
                if row.get("paymentId") == payment["id"]
                and row.get("adjustmentSource") == "PAYMENT_PROMOTION"
                and row.get("status") == "POSTED"
            ),
            None,
        )
    if adjustment is None or adjustment.get("status") != "POSTED":
        return
    adjustment["status"] = "VOID"
    adjustment["voidedAt"] = timestamp
    adjustment["voidedByUsername"] = admin["username"]
    adjustment["voidReason"] = "Related payment voided"
    adjustment["updatedAt"] = timestamp
    payment["promotionDiscountApplied"] = False
    add_audit(
        "billing_adjustment_voided",
        "BillingAdjustment",
        adjustment["id"],
        {
            "invoiceId": adjustment["invoiceId"],
            "source": "PAYMENT_PROMOTION",
            "paymentId": payment["id"],
            "reason": adjustment["voidReason"],
        },
        admin["username"],
    )


@router.post("/payments")
@billing_mutation
def create_payment(
    payload: PaymentPayload,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    admin=Depends(require_admin),
):
    posting_key = normalize_idempotency_key(idempotency_key)
    fingerprint = posting_fingerprint("payment", payload)
    replay = idempotent_replay("payment", posting_key, fingerprint)
    if replay is not None:
        return replay
    invoice = find_invoice(payload.invoiceId) if payload.invoiceId else None
    customer_id = payload.customerId or (invoice["customerId"] if invoice else "")
    customer = invoice["customer"] if invoice else resolve_customer(customer_id)
    amount = money(payload.amount)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than zero")
    method = normalize_upper(payload.method or "CASH")
    status = normalize_upper(payload.status or "POSTED")
    if method not in PAYMENT_METHODS:
        raise HTTPException(status_code=400, detail="Invalid payment method")
    if status not in PAYMENT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid payment status")
    if status != "POSTED":
        raise HTTPException(status_code=400, detail="New payments must be posted; use the void action for reversals")
    payment_day = parse_day(payload.paymentDate, "paymentDate")
    selected_promotion_id = clean_text(payload.promotionId)
    early_bird_discount = None
    payment_promotion = None
    if invoice is not None and status == "POSTED":
        if selected_promotion_id:
            payment_promotion = payment_promotion_for_payment(invoice, selected_promotion_id, amount, payment_day)
        else:
            payment_promotion = automatic_payment_promotion_for_payment(invoice, amount, payment_day)
            if payment_promotion is None:
                early_bird_discount = early_bird_discount_for_payment(invoice, amount, payment_day)
        validate_invoice_payment(invoice, amount)
    timestamp = now_iso()
    payment = {
        "id": str(uuid4()),
        "receiptNumber": next_number("OR", payments, "receiptNumber"),
        "idempotencyKey": posting_key,
        "idempotencyFingerprint": fingerprint,
        "invoiceId": invoice["id"] if invoice else None,
        "invoiceNumber": invoice["invoiceNumber"] if invoice else "",
        "customerId": customer["id"],
        "customer": customer,
        "amount": amount,
        "method": method,
        "paymentDate": payment_day.isoformat(),
        "referenceNumber": payload.referenceNumber or "",
        "collectionChannel": clean_text(payload.collectionChannel) or "BILLING",
        "postedByUsername": admin["username"],
        "postedByName": admin_display_name(admin),
        "status": status,
        "earlyBirdDiscountApplied": False,
        "earlyBirdDiscountAmount": 0,
        "earlyBirdDiscountAdjustmentId": "",
        "promotionDiscountApplied": False,
        "promotionDiscountAmount": 0,
        "promotionDiscountAdjustmentId": "",
        "promotionId": selected_promotion_id,
        "promotionCode": "",
        "promotionName": "",
        "notes": payload.notes or "",
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
    }
    payments.append(payment)
    if invoice is not None and payment_promotion is not None:
        create_payment_promotion_adjustment(invoice, payment, payment_promotion, admin, timestamp)
    elif invoice is not None and early_bird_discount is not None:
        create_early_bird_discount_adjustment(invoice, payment, early_bird_discount, admin, timestamp)
    if invoice is not None:
        invoice["updatedAt"] = timestamp
    add_audit("billing_payment_posted", "BillingPayment", payment["id"], {"customerId": customer["id"], "invoiceId": payment["invoiceId"]}, admin["username"])
    persist_billing_state()
    return payment


@router.patch("/payments/{payment_id}")
@billing_mutation
def update_payment(payment_id: str, payload: PaymentPayload, admin=Depends(require_admin)):
    current = find_payment(payment_id)
    if current.get("status") == "POSTED":
        raise HTTPException(status_code=409, detail="Posted payments are immutable; void the receipt and post a replacement")
    raise HTTPException(status_code=409, detail="Voided payments are immutable")


@router.delete("/payments/{payment_id}")
@billing_mutation
def delete_payment(payment_id: str, reason: str = "", admin=Depends(require_admin)):
    current = find_payment(payment_id)
    if current.get("status") == "VOID":
        return {"status": "ok", "idempotentReplay": True}
    timestamp = now_iso()
    current["status"] = "VOID"
    current["voidedAt"] = timestamp
    current["voidedByUsername"] = admin["username"]
    current["voidReason"] = clean_text(reason) or "Voided by POS or Billing user"
    current["updatedAt"] = timestamp
    void_early_bird_discount_for_payment(current, timestamp, admin)
    void_payment_promotion_for_payment(current, timestamp, admin)
    if current.get("invoiceId"):
        find_invoice(current["invoiceId"])["updatedAt"] = timestamp
    add_audit(
        "billing_payment_voided",
        "BillingPayment",
        current["id"],
        {"customerId": current["customerId"], "invoiceId": current.get("invoiceId"), "reason": current["voidReason"]},
        admin["username"],
    )
    persist_billing_state()
    return {"status": "ok"}


@router.get("/adjustments")
@billing_read_snapshot
def list_adjustments(customerId: str = "", admin=Depends(require_admin)):
    seed_billing_data()
    rows = visible_adjustments()
    if customerId:
        rows = [row for row in rows if row["customerId"] == customerId]
    return sorted(rows, key=lambda row: row["createdAt"], reverse=True)


@router.post("/adjustments")
@billing_mutation
def create_adjustment(
    payload: AdjustmentPayload,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    admin=Depends(require_admin),
):
    posting_key = normalize_idempotency_key(idempotency_key)
    fingerprint = posting_fingerprint("adjustment", payload)
    replay = idempotent_replay("adjustment", posting_key, fingerprint)
    if replay is not None:
        return replay
    invoice = find_invoice(payload.invoiceId or "")
    invoice_status = invoice_summary(invoice)["status"]
    if invoice_status in ["DRAFT", "VOID"]:
        raise HTTPException(status_code=400, detail="Adjustments can only be posted to an issued invoice")
    adjustment_type = normalize_upper(payload.type or "CREDIT")
    status = normalize_upper(payload.status or "POSTED")
    amount = money(payload.amount)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Adjustment amount must be greater than zero")
    if adjustment_type not in ADJUSTMENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid adjustment type")
    if status not in ADJUSTMENT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid adjustment status")
    if status != "POSTED":
        raise HTTPException(status_code=400, detail="New adjustments must be posted; use the void action for reversals")
    if adjustment_type == "CREDIT" and amount > invoice_amounts(invoice)["total"]:
        raise HTTPException(status_code=400, detail="Credit adjustment cannot exceed the invoice total")
    timestamp = now_iso()
    adjustment = {
        "id": str(uuid4()),
        "idempotencyKey": posting_key,
        "idempotencyFingerprint": fingerprint,
        "invoiceId": invoice["id"],
        "invoiceNumber": invoice["invoiceNumber"],
        "customerId": invoice["customerId"],
        "customer": invoice["customer"],
        "type": adjustment_type,
        "amount": amount,
        "reason": payload.reason or "Billing adjustment",
        "status": status,
        "notes": payload.notes or "",
        "postedByUsername": admin["username"],
        "postedByName": admin_display_name(admin),
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
    }
    adjustments.append(adjustment)
    invoice["updatedAt"] = timestamp
    add_audit("billing_adjustment_posted", "BillingAdjustment", adjustment["id"], {"invoiceId": invoice["id"]}, admin["username"])
    persist_billing_state()
    return adjustment


@router.patch("/adjustments/{adjustment_id}")
@billing_mutation
def update_adjustment(adjustment_id: str, payload: AdjustmentPayload, admin=Depends(require_admin)):
    current = find_adjustment(adjustment_id)
    if current.get("status") == "POSTED":
        raise HTTPException(status_code=409, detail="Posted adjustments are immutable; void the adjustment and post a replacement")
    raise HTTPException(status_code=409, detail="Voided adjustments are immutable")


@router.delete("/adjustments/{adjustment_id}")
@billing_mutation
def delete_adjustment(adjustment_id: str, reason: str = "", admin=Depends(require_admin)):
    current = find_adjustment(adjustment_id)
    if current.get("status") == "VOID":
        return {"status": "ok", "idempotentReplay": True}
    if current.get("paymentId"):
        linked_payment = next((payment for payment in payments if payment.get("id") == current["paymentId"]), None)
        if linked_payment and linked_payment.get("status") == "POSTED":
            raise HTTPException(status_code=409, detail="Void the related payment to reverse this promotional adjustment")
    timestamp = now_iso()
    current["status"] = "VOID"
    current["voidedAt"] = timestamp
    current["voidedByUsername"] = admin["username"]
    current["voidReason"] = clean_text(reason) or "Voided by Billing user"
    current["updatedAt"] = timestamp
    find_invoice(current["invoiceId"])["updatedAt"] = timestamp
    add_audit(
        "billing_adjustment_voided",
        "BillingAdjustment",
        current["id"],
        {"invoiceId": current["invoiceId"], "reason": current["voidReason"]},
        admin["username"],
    )
    persist_billing_state()
    return {"status": "ok"}


@router.get("/balances")
@billing_read_snapshot
def list_balances(admin=Depends(require_admin)):
    seed_billing_data()
    customer_ids = sorted(
        {
            row["customerId"]
            for row in [*visible_subscriptions(), *visible_invoices(), *visible_payments(), *visible_adjustments()]
            if row.get("customerId")
        }
    )
    return [customer_balance(customer_id) for customer_id in customer_ids]


@router.get("/customers/{customer_id}/balance")
@billing_read_snapshot
def get_customer_balance(customer_id: str, admin=Depends(require_admin)):
    seed_billing_data()
    return customer_balance(customer_id)
